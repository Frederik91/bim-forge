import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDemoServer } from './server.ts';
import type { DemoServer } from './server.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { parseRequestConversation } from '../src/request-conversation.ts';
import { parseFrozenModelScope } from '../src/model-scope-contract.ts';
import { combinedFixtureRepository, combinedPreviewWorker } from './fixtures/combined-preview-agent.ts';

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function ticket(value: unknown): Record<string, unknown> { assert.ok(object(value) && object(value.ticket)); return value.ticket; }
function project(value: unknown): string { assert.ok(object(value) && typeof value.project === 'string'); return value.project; }
async function call(server: DemoServer, target: string, input?: { json: unknown } | { source: Buffer; name: string }) {
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const body = input === undefined ? undefined : 'json' in input ? Buffer.from(JSON.stringify(input.json)) : input.source;
  const headers = input === undefined ? {} : { 'Content-Length': body?.length ?? 0, ...('json' in input
    ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'text/markdown', 'x-source-name': encodeURIComponent(input.name) }) };
  return new Promise<{ status: number; value: unknown }>((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: address.port, path: target, method: input ? 'POST' : 'GET', headers }, response => {
      const chunks: Buffer[] = []; response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => { try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve({ status: response.statusCode ?? 0, value }); } catch (error) { reject(error); } });
    }); request.once('error', reject); request.end(body);
  });
}
async function start(file: string, repository: RoomRepository): Promise<DemoServer> {
  const server = await createDemoServer({ backlogFile: file, modelWorker: combinedPreviewWorker(repository) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return server;
}
async function stop(server: DemoServer): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await server.closeModelWorkers();
}
async function settled(server: DemoServer, id: string, state: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await call(server, '/api/change-requests/' + id); assert.equal(result.status, 200);
    const current = ticket(result.value); if (current.state === state) return current;
    assert.ok(current.state === 'queued' || current.state === 'working', JSON.stringify({ state: current.state, error: current.error }));
    await new Promise(resolve => setTimeout(resolve, 20));
  } throw new Error('Combined request did not reach its expected review state.');
}

test('saved scopes, conversational visual/file evidence and independent acceptance compose across HTTP restart', { timeout: 180_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-combined185-')); const file = path.join(directory, 'combined.sqlite');
  const repository = await combinedFixtureRepository(); const before = repository.view(repository.head('main')).snapshot;
  let server = await start(file, repository); let closed = false;
  t.after(async () => { if (!closed) await stop(server); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await call(server, '/api/projects', { json: { project: repository.serialize() } })).status, 200);
  const endpoint = '/api/projects/' + repository.projectId; const baseRevisionId = repository.head('main');
  const query = { version: 1, allOf: [{ kind: 'in-spaces', spaceIds: ['room-office'] }, { kind: 'furniture-kind', furnitureKind: 'desk' }], anyOf: [], excludeIds: [] };
  const preview = await call(server, endpoint + '/scope-preview', { json: { baseRevisionId, query } }); assert.equal(preview.status, 200); assert.ok(object(preview.value));
  const binding = parseFrozenModelScope(preview.value.scope); assert.deepEqual(binding.targetIds, ['office-desk']);
  assert.deepEqual(binding.dependentIds, ['office-laptop', 'office-monitor']);
  assert.equal((await call(server, endpoint + '/scopes', { json: { id: 'office-desks', name: 'Office desks', query, expectedVersion: null } })).status, 200);
  const visual = { snapshot: { kind: 'accepted', revisionId: baseRevisionId }, view: '2d', levelId: 'level-ground',
    selectedObjectIds: ['office-desk'], annotations: [{ kind: 'pin', position: [9.5, 1.5, 0], label: 'Preserve this setup' }] };
  const initial = { requestId: 'combined-desk', baseRevisionId, selectedObjectIds: ['office-desk'], instruction: 'Make this desk wider and retain its devices.',
    visualIntent: { kind: 'selection' }, conversationVisual: visual, scope: { query, savedScopeId: 'office-desks' } };
  assert.equal((await call(server, '/api/change-requests', { json: { project: repository.serialize(), request: initial } })).status, 202);
  const question = await settled(server, 'combined-desk', 'needs-input'); const history = parseRequestConversation(question.conversation);
  const last = history.messages.at(-1); assert.ok(last?.kind === 'assistant' && last.content.kind === 'clarification');
  const upload = await call(server, endpoint + '/sources/' + crypto.randomUUID(), { source: Buffer.from('Keep the monitor, laptop and other rooms unchanged.'), name: 'office-notes.md' });
  assert.equal(upload.status, 201); assert.ok(object(upload.value));
  const reply = { messageId: 'combined-answer', expectedSequence: history.sequence, baseRevisionId, text: 'Use 1800 mm width.', sources: [upload.value.source], visual: { ...visual, view: '3d' } };
  assert.equal((await call(server, '/api/change-requests/combined-desk/messages', { json: reply })).status, 202);
  await settled(server, 'combined-desk', 'ready');
  assert.equal((await call(server, '/api/change-requests', { json: { project: repository.serialize(), request: { requestId: 'combined-bed', baseRevisionId,
    selectedObjectIds: ['main-bed'], instruction: 'Widen this bed by 0.2 m.', visualIntent: { kind: 'selection' },
    scope: { query: { version: 1, allOf: [{ kind: 'ids', ids: ['main-bed'] }], anyOf: [], excludeIds: [] } } } } })).status, 202);
  await settled(server, 'combined-bed', 'ready');
  await stop(server); closed = true; server = await start(file, repository); closed = false;
  for (const id of ['combined-bed', 'combined-desk']) {
    const pending = await settled(server, id, 'ready'); assert.ok(object(pending.request) && typeof pending.request.requestId === 'string');
    const accepted = await call(server, `/api/change-requests/${id}/decision`, { json: { action: 'accept', decisionId: 'accept-' + id, expectedRequestId: pending.request.requestId } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.value)); assert.equal(ticket(accepted.value).state, 'completed');
  }
  const accepted = await RoomRepository.restore(project((await call(server, endpoint)).value)); const after = accepted.view(accepted.head('main')).snapshot;
  assert.deepEqual(diffSnapshots(before, after).entities.modified.map(item => item.id).sort(), ['main-bed', 'office-desk']);
  assert.deepEqual(diffSnapshots(before, after).relationships, { added: [], removed: [], modified: [] });
  for (const id of ['office-monitor', 'office-laptop']) assert.deepEqual(after.entities.find(item => item.id === id), before.entities.find(item => item.id === id));
  const completed = ticket((await call(server, '/api/change-requests/combined-desk')).value);
  assert.deepEqual(parseFrozenModelScope(completed.scope), binding);
  const transcript = parseRequestConversation(completed.conversation); assert.equal(transcript.messages.length, 5); assert.equal(transcript.messages.at(-1)?.kind, 'decision');
  const messages = transcript.messages.filter(message => message.kind === 'user'); assert.equal(messages[0]?.visual?.view, '2d'); assert.equal(messages[1]?.visual?.view, '3d'); assert.equal(messages[1]?.sources.length, 1);
  const saved = await call(server, endpoint + '/scopes'); assert.equal(saved.status, 200); assert.ok(object(saved.value) && Array.isArray(saved.value.scopes) && saved.value.scopes.length === 1);
});
