import { isDeepStrictEqual } from 'node:util';

export class CodexWorkerError extends Error {
  constructor(code, message) { super(message); this.name = 'CodexWorkerError'; this.code = code; }
}
export const failure = (code, message) => new CodexWorkerError(code, message);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const shape = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const toolTypes = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'todo_list', 'collab_tool_call', 'image_generation', 'dynamic_tool_call', 'function_call', 'custom_tool_call']);

// exec JSONL is a distinct protocol from app-server notifications and session logs.
export class CodexEventAudit {
  constructor(maxBytes, maxEvents = 10000) {
    this.maxBytes = maxBytes; this.maxEvents = maxEvents; this.bytes = 0; this.events = 0;
    this.decoder = new TextDecoder('utf-8', { fatal: true }); this.pending = '';
    this.state = 'initial'; this.items = new Map(); this.finalText = null; this.usage = null;
  }
  push(chunk) {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) throw failure('OUTPUT_LIMIT', 'Codex event stream exceeds declared byte budget');
    try { this.pending += this.decoder.decode(chunk, { stream: true }); }
    catch { throw failure('EVENT_UTF8', 'Codex event stream contains invalid UTF-8'); }
    let newline;
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline); this.pending = this.pending.slice(newline + 1);
      if (!line.trim()) throw failure('EVENT_MALFORMED', 'Codex event stream contains an empty record');
      let event;
      try { event = JSON.parse(line); } catch { throw failure('EVENT_MALFORMED', 'Codex event stream contains malformed JSON'); }
      this.accept(event);
    }
  }
  accept(event) {
    if (++this.events > this.maxEvents) throw failure('EVENT_LIMIT', 'Codex event count exceeds transport limit');
    if (!record(event) || typeof event.type !== 'string') throw failure('EVENT_MALFORMED', 'Codex event is missing its type');
    if (event.type === 'error' || event.type === 'turn.failed') throw failure('TURN_FAILED', 'Codex reported an error or failed turn');
    if (this.state === 'completed') throw failure('EVENT_ORDER', 'Codex emitted events after terminal completion');
    if (event.type === 'thread.started') {
      if (this.state !== 'initial' || !shape(event, ['type', 'thread_id']) || !text(event.thread_id)) throw failure('EVENT_ORDER', 'Invalid Codex thread start');
      this.state = 'thread'; return;
    }
    if (event.type === 'turn.started') {
      if (this.state !== 'thread' || !shape(event, ['type'])) throw failure('EVENT_ORDER', 'Invalid Codex turn start');
      this.state = 'turn'; return;
    }
    if (event.type === 'turn.completed') {
      const usage = event.usage;
      if (this.state !== 'turn' || !shape(event, ['type', 'usage']) || !shape(usage, ['input_tokens', 'cached_input_tokens', 'output_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens']) ||
        !['input_tokens', 'cached_input_tokens', 'output_tokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0) ||
        !Object.values(usage).every(value => Number.isSafeInteger(value) && value >= 0) ||
        [...this.items.values()].some(item => !item.completed) || this.finalText === null) throw failure('EVENT_INCOMPLETE', 'Codex terminal event is incomplete');
      this.state = 'completed'; this.usage = usage; return;
    }
    if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
      const item = event.item;
      if (!record(item) || !text(item.type)) throw failure('EVENT_MALFORMED', 'Codex item is missing its type');
      // Reject attempts as soon as any lifecycle event exposes them, including failed tools.
      if (toolTypes.has(item.type)) throw failure('TOOL_ATTEMPT', 'Codex attempted a tool; generation response rejected');
      if (!['agent_message', 'reasoning'].includes(item.type)) throw failure('ITEM_UNKNOWN', 'Codex emitted an unsupported item type');
      // Additional reasoning metadata is inert; item types and lifecycle remain audited.
      if (this.state !== 'turn' || !shape(event, ['type', 'item']) || !text(item.id) || typeof item.text !== 'string') throw failure('EVENT_MALFORMED', 'Codex item is malformed or outside its turn');
      if (item.type === 'agent_message' && !shape(item, ['id', 'type', 'text'])) throw failure('EVENT_MALFORMED', 'Codex agent message contains unsupported fields');
      const previous = this.items.get(item.id);
      if (previous && (previous.completed || previous.type !== item.type || event.type === 'item.started')) throw failure('EVENT_ORDER', 'Codex item lifecycle is inconsistent');
      const completed = event.type === 'item.completed';
      this.items.set(item.id, { type: item.type, completed });
      if (completed && item.type === 'agent_message') this.finalText = item.text;
      return;
    }
    throw failure('EVENT_UNKNOWN', 'Codex emitted an unsupported event type');
  }
  finish() {
    try { this.pending += this.decoder.decode(); } catch { throw failure('EVENT_UTF8', 'Codex event stream ended with invalid UTF-8'); }
    if (this.pending.length) throw failure('EVENT_TRUNCATED', 'Codex event stream ended without a complete JSONL record');
    if (this.state !== 'completed') throw failure('EVENT_INCOMPLETE', 'Codex event stream has no audited terminal completion');
    return { finalText: this.finalText, usage: this.usage, eventCount: this.events, eventBytes: this.bytes };
  }
}

export function validateResponse(value, schema) {
  let valid;
  if (schema.type === 'object') valid = record(value) && Object.keys(value).length === schema.required.length && schema.required.every(key => Object.hasOwn(value, key) && validateResponse(value[key], schema.properties[key]));
  else if (schema.type === 'array') valid = Array.isArray(value) && value.every(item => validateResponse(item, schema.items));
  else valid = typeof value === schema.type;
  return Boolean(valid);
}
export function agreeResponse(finalText, outputText, schema) {
  let eventValue, value;
  try { eventValue = JSON.parse(finalText); value = JSON.parse(outputText); }
  catch { throw failure('RESPONSE_JSON', 'Codex final response is not valid JSON'); }
  if (!isDeepStrictEqual(eventValue, value)) throw failure('RESPONSE_MISMATCH', 'Codex final event and response file disagree');
  if (!validateResponse(value, schema)) throw failure('RESPONSE_SCHEMA', 'Codex response does not match the requested schema');
  return value;
}
