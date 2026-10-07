#!/usr/bin/env node
// Qualification-only capability. Never registered by the product MCP server.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {z} from 'zod';
import {readBoundedText} from './host-qualification.js';

const hash = text => createHash('sha256').update(text).digest('hex');
export function repairFixture(config, source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 128 || !/^export\s+const\s+value\s*=\s*1\s*;\s*$/.test(source))
    throw new Error('Only the declared constant value repair is authorized');
  const root = fs.realpathSync(config.root), stat = fs.statSync(root);
  if (root !== config.root || stat.dev !== config.rootIdentity.dev || stat.ino !== config.rootIdentity.ino)
    throw new Error('Fixture root identity changed');
  const directory = path.join(root, 'src'), target = path.join(directory, 'value.js');
  if (fs.realpathSync(directory) !== directory || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Source directory changed');
  const descriptor = fs.openSync(target, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const file = fs.fstatSync(descriptor);
    if (!file.isFile() || file.size > 128 || file.nlink !== 1) throw new Error('Repair target must be one regular bounded file');
    const before = Buffer.alloc(file.size);
    if (fs.readSync(descriptor, before, 0, before.length, 0) !== before.length || hash(before) !== config.expectedFaultSha256)
      throw new Error('Repair target no longer matches the planted fault');
    const opened = fs.lstatSync(target);
    if (opened.ino !== file.ino || opened.dev !== file.dev || fs.realpathSync(directory) !== directory) throw new Error('Repair target identity changed');
    const content = Buffer.from(source);
    if (fs.writeSync(descriptor, content, 0, content.length, 0) !== content.length) throw new Error('Fixture repair write was incomplete');
    fs.ftruncateSync(descriptor, content.length); fs.fsyncSync(descriptor);
    return {complete: true, changedFile: 'src/value.js', beforeSha256: hash(before), afterSha256: hash(source),
      authority: 'fixture-source-edit-only', deploymentSafety: 'not-established'};
  } finally {fs.closeSync(descriptor);}
}

export function serveRepairFixture(config) {
  const receipt = {schemaVersion: 1, kind: 'bounded-fixture-repair', calls: [], rejectedAdditionalCalls: 0};
  const persist = () => fs.writeFileSync(config.receipt, JSON.stringify(receipt), {mode: 0o600});
  persist();
  const handle = serveStdio(() => {
    const server = new McpServer({name: 'testlore-fixture', version: '1.0.0'});
    server.registerTool('repair_fixture', {description: 'Write only src/value.js in the explicitly authorized disposable fixture. The source must implement the independent constant value contract. Tests and configuration cannot be edited.',
      inputSchema: z.strictObject({source: z.string().min(1).max(128)}), annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false}},
    async ({source}) => {
      const call = {requestedAt: Date.now(), sourceSha256: hash(source), result: null};
      if (receipt.calls.length) {receipt.rejectedAdditionalCalls = Math.min(1000, receipt.rejectedAdditionalCalls + 1); persist();
        return {isError: true, content: [{type: 'text', text: 'Exactly one fixture repair is authorized'}]};}
      receipt.calls.push(call); persist();
      try {call.result = repairFixture(config, source);} catch (error) {call.result = {complete: false, error: String(error.message).slice(0, 1000)};}
      call.respondedAt = Date.now(); persist();
      return {isError: !call.result.complete, content: [{type: 'text', text: JSON.stringify(call.result)}], structuredContent: call.result};
    });
    return server;
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {void handle.close();});
  return handle;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveRepairFixture(JSON.parse(readBoundedText(process.argv[2], 16384)));
}
