import { isDeepStrictEqual } from 'node:util';
import {createHash} from 'node:crypto';

export class CodexWorkerError extends Error {
  constructor(code, message,diagnostics={}) { super(message); this.name = 'CodexWorkerError'; this.code = code; this.diagnostics=diagnostics; }
}
export const failure = (code, message,diagnostics) => new CodexWorkerError(code, message,diagnostics);
const nativeReasons=new Set(['authentication','usage-limit','context-limit','connectivity','unclassified']);
function nativeErrorReason(value){
 const message=typeof value==='string'?value.slice(0,2048):'';
 if(/unauthorized|authentication|not logged|\b401\b|invalid.{0,20}(?:token|key)/i.test(message))return 'authentication';
 if(/rate.limit|quota|usage.limit|too many requests|\b429\b/i.test(message))return 'usage-limit';
 if(/context.window|maximum context|context_length/i.test(message))return 'context-limit';
 if(/reconnect|connection|network|timed out|stream.{0,20}disconnect|transport/i.test(message))return 'connectivity';
 return 'unclassified';
}
/** Fixed diagnostics only: never copy provider messages, prompts or credentials. */
export function describeWorkerFailure(error){
 const code=typeof error?.code==='string'&&/^[A-Z][A-Z_]{0,47}$/.test(error.code)?error.code:'INPUT_INVALID';
 const nativeFailureReason=nativeReasons.has(error?.diagnostics?.nativeFailureReason)?error.diagnostics.nativeFailureReason:null;
 const hash=error?.diagnostics?.nativeItemTypeSha256;
 return {code,nativeFailureReason,nativeItemTypeSha256:typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)?hash:null,
  nextAction:nativeFailureReason==='authentication'?'Repair the existing native CLI login before a new bounded attempt.':nativeFailureReason==='usage-limit'?'Check native account usage and reset availability before a new bounded attempt.':nativeFailureReason==='connectivity'?'Check native CLI connectivity before a new bounded attempt.':nativeFailureReason==='context-limit'?'Review request size against native context limits; preserve this rejected attempt.':code.startsWith('INPUT_')?'Repair the supplied worker request before another bounded attempt.':code==='ITEM_UNKNOWN'?'Inspect the native CLI protocol version; unsupported items cannot establish a qualified result.':code==='TOOL_ATTEMPT'?'Reject this generation output; supplied-source-only workers must not attempt tools.':'Inspect the retained failure and native CLI prerequisites before another bounded attempt.'};
}
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
    if (event.type === 'error' || event.type === 'turn.failed') throw failure('TURN_FAILED', 'Codex reported an error or failed turn',{nativeFailureReason:nativeErrorReason(event.message||event.error?.message)});
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
      if(item.type==='error')throw failure('NATIVE_ERROR_ITEM','Codex reported a native error item; generation response rejected',{nativeFailureReason:nativeErrorReason(item.message)});
      if (!['agent_message', 'reasoning'].includes(item.type)) throw failure('ITEM_UNKNOWN', 'Codex emitted an unsupported item type',{nativeItemTypeSha256:createHash('sha256').update(item.type).digest('hex')});
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
