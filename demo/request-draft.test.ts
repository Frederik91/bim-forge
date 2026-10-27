import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChangeRequests } from './change-requests.ts';
import { createDemoServer } from './server.ts';
import { ModelScripts } from '../src/model-script.ts';
import type { ModelScriptBinding } from '../src/model-script.ts';
import { RoomRepository, rectangleLayout } from '../src/room-model.ts';
import type { ModelSnapshot } from '../src/room-model.ts';
import type { ModelWorker, ModelWorkerSession } from '../src/model-proposal.ts';
import { freezeModelScope } from '../src/model-scope.ts';
import { parseRequestDraft } from '../src/request-draft.ts';

const propose = `return {kind:'propose',review:{summary:'Widen entry.',rationale:'Requested width fits the host.',
  constraints:'Retain unrelated elements.',uncertainty:'Tentative concept.',
  intent:{interpretation:'Widen entry.',assumptions:[],certainty:95,basis:'Explicit request.'}}};`;
const inspect = `const view=await model.inspect();const layout=view.placement.layout;if(!layout)throw new Error('Missing room');`;
const change = (width: number) => `await model.previewRectangle({...layout,door:{...layout.door,widthMm:${width}}});`;
const source = `${inspect}${change(1100)}${change(1200)}${propose}`;
function initial(repo: RoomRepository, requestId: string) {
  const door = repo.view(repo.head('main')).snapshot.entities.find(entity => entity.id === 'door-entry'); assert.ok(door);
  return { requestId, baseRevisionId: repo.head('main'), selectedObjectIds: [door.id], instruction: 'Widen the entry.', visualIntent: { kind: 'selection' } } satisfies ModelScriptBinding & { requestId: string; instruction: string };
}
async function until(check: () => boolean): Promise<void> {
  for (let index = 0; index < 3000; index++) {
    if (check()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Draft test timed out.');
}
function execute(session: ModelWorkerSession, body = source) {
  return session.executeTool('run_model_script', { language: 'javascript', source: body });
}
function worker(run: ModelWorker['run']): ModelWorker { return { identity: { provider: 'test', model: 'live-draft' }, run }; }

test('draft parser binds a complete validated model and refuses malformed identity, sequence and geometry', async () => {
  const repo = await RoomRepository.create();
  const snapshot = repo.view(repo.head('main')).snapshot;
  const input = { ticketId: 'ticket', requestId: 'request', baseRevisionId: repo.head('main'), attempt: 1, sequence: 2, snapshot };
  assert.deepEqual(parseRequestDraft(input), input);
  assert.equal(parseRequestDraft(null), null);
  for (const invalid of [undefined, {}, { ...input, sequence: 0 }, { ...input, sequence: 1.5 }, { ...input, attempt: 4 },
    { ...input, baseRevisionId: 'unbound' }, { ...input, requestId: '../other' }, { ...input, sources: [] },
    { ...input, snapshot: { ...snapshot, entities: [] } }]) assert.throws(() => parseRequestDraft(invalid));
});

test('real ScriptBox stages publish before execution settles; two writes roll back after failure and cannot change accepted data', async t => {
  const repo = await RoomRepository.create(); const accepted = repo.serialize();
  const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  const previews: (ModelSnapshot | null)[] = [];
  let settled = false;
  const result = await scripts.run({ base: repo.view(repo.head('main')).snapshot, binding: initial(repo, 'rollback'),
    language: 'javascript', source: `${inspect}${change(1100)}${change(1200)}throw new Error('Rollback');`,
    signal: new AbortController().signal, remainingHostCalls: 64, onActivity: () => {}, onPreview: snapshot => {
      assert.equal(settled, false); previews.push(snapshot);
    } });
  settled = true;
  assert.equal(result.kind, 'failed');
  assert.deepEqual(previews.map(snapshot => snapshot && rectangleLayout(snapshot).door.widthMm), [null, 1100, 1200, null]);
  assert.equal(result.evidence.calls.filter(call => call.method === 'model.previewRectangle' && call.disposition === 'completed').length, 2);
  assert.equal(repo.serialize(), accepted);
});

test('invalid geometry and writes outside frozen scope never enter the preview feed', async t => {
  const repo = await RoomRepository.create(); const base = repo.view(repo.head('main')).snapshot;
  const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  for (const scoped of [false, true]) {
    const previews: (ModelSnapshot | null)[] = [];
    const scope = freezeModelScope({ graph: base, baseRevisionId: repo.head('main'),
      query: { version: 1, allOf: [{ kind: 'ids', ids: ['door-entry'] }], anyOf: [], excludeIds: [] } });
    const result = await scripts.run({ base, binding: { ...initial(repo, 'invalid'), ...(scoped ? { scope } : {}) },
      language: 'javascript', source: scoped
        ? `await model.previewRectangle({boundsMm:{minX:0,minY:0,maxX:7000,maxY:4000},door:{widthMm:900,offsetMm:1000}});${propose}`
        : `${inspect}${change(999999)}${propose}`,
      signal: new AbortController().signal, remainingHostCalls: 64, onActivity: () => {}, onPreview: snapshot => previews.push(snapshot) });
    assert.ok(result.kind === 'failed');
    if (scoped) assert.match(result.diagnostic.message, /Out-of-scope entity write/);
    assert.ok(previews.length >= 2); assert.ok(previews.every(snapshot => snapshot === null));
  }
});

test('new executions reset prior previews and observation, clarification, decline and unawaited failure discard stages', async t => {
  const repo = await RoomRepository.create(); const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  let visible: ModelSnapshot | null = null;
  const run = (body: string) => scripts.run({ base: repo.view(repo.head('main')).snapshot, binding: initial(repo, 'execution'),
    source: body, language: 'javascript', signal: new AbortController().signal, remainingHostCalls: 64,
    onActivity: () => {}, onPreview: snapshot => { visible = snapshot; } });
  for (const finish of ["return {kind:'observe',observation:null};", "return {kind:'clarify',question:'Which width?',options:[]};",
    "return {kind:'decline',reason:'No change.',uncertainty:'Needs input.'};", "throw new Error('Discard');"]) {
    assert.equal((await run(source)).kind, 'proposal'); assert.ok(visible);
    const result = await run(`${inspect}${change(1100)}${finish}`);
    assert.notEqual(result.kind, 'proposal'); assert.equal(visible, null);
  }
  assert.equal((await run(`${inspect}void model.previewRectangle({...layout,door:{...layout.door,widthMm:1200}});throw new Error('Unawaited');`)).kind, 'failed');
  assert.equal(visible, null);
  await new Promise<void>(resolve => setTimeout(resolve, 30)); assert.equal(visible, null);
});

test('queue keeps independent live drafts before workers finish, removes final previews and still requires explicit acceptance', async t => {
  const release = Promise.withResolvers<void>(); const seen = new Set<string>();
  const queue = await ChangeRequests.open(':memory:', () => worker(async session => {
    const result = await execute(session); assert.equal(result.done, true, JSON.stringify(result));
    const input = session.input;
    assert.ok(input && typeof input === 'object' && 'request' in input && input.request && typeof input.request === 'object' && 'requestId' in input.request);
    assert.equal(typeof input.request.requestId, 'string'); seen.add(String(input.request.requestId));
    await release.promise;
  }));
  t.after(async () => { release.resolve(); await queue.close(); });
  const repo = await RoomRepository.create(); const accepted = repo.serialize();
  const first = await queue.submit(accepted, initial(repo, 'first'));
  const second = await queue.submit(accepted, initial(repo, 'second'));
  await until(() => seen.size === 2);
  for (const ticket of [first, second]) {
    const draft = queue.draft(ticket.id); assert.ok(draft);
    assert.equal(draft.ticketId, ticket.id); assert.equal(draft.requestId, ticket.request.requestId);
    assert.equal(draft.baseRevisionId, repo.head('main')); assert.equal(draft.attempt, 1); assert.equal(draft.sequence, 2);
    assert.equal(rectangleLayout(draft.snapshot).door.widthMm, 1200);
    assert.equal(queue.get(ticket.id).state, 'working');
    assert.equal(queue.get(ticket.id).result, null);
  }
  assert.equal(queue.project(repo.projectId), accepted);
  release.resolve(); await until(() => queue.get(first.id).state === 'ready' && queue.get(second.id).state === 'ready');
  assert.equal(queue.draft(first.id), null); assert.equal(queue.draft(second.id), null);
  assert.equal(queue.project(repo.projectId), accepted);
  await assert.rejects(() => queue.decide(first.id, { action: 'accept', decisionId: 'wrong', expectedRequestId: 'other' }));
  const decision = await queue.decide(first.id, { action: 'accept', decisionId: 'explicit-human', expectedRequestId: 'first' });
  const applied = await RoomRepository.restore(decision.project);
  assert.equal(rectangleLayout(applied.view(applied.head('main')).snapshot).door.widthMm, 1200);
  assert.equal(queue.draft(first.id), null);
});

test('cancel and reply supersession immediately clear drafts and reject late old-turn work', async t => {
  const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
  const reached = new Set<string>(); let lateCalls = 0;
  const queue = await ChangeRequests.open(':memory:', () => worker(async session => {
    const result = await execute(session); assert.equal(result.done, true, JSON.stringify(result));
    const input = session.input;
    assert.ok(input && typeof input === 'object' && 'request' in input && input.request && typeof input.request === 'object' && 'requestId' in input.request);
    const id = String(input.request.requestId); const gate = Promise.withResolvers<void>(); gates.set(id, gate); reached.add(id);
    await gate.promise;
    if (session.signal.aborted) {
      await assert.rejects(() => execute(session)); lateCalls++;
    }
  }));
  t.after(async () => { for (const gate of gates.values()) gate.resolve(); await queue.close(); });
  const repo = await RoomRepository.create(); const accepted = repo.serialize();
  await queue.submit(accepted, initial(repo, 'cancel-me')); await queue.submit(accepted, initial(repo, 'old-turn'));
  await until(() => reached.size === 2);
  assert.ok(queue.draft('cancel-me')); assert.ok(queue.draft('old-turn'));
  await queue.decide('cancel-me', { action: 'cancel', decisionId: 'cancel', expectedRequestId: 'cancel-me' });
  assert.equal(queue.draft('cancel-me'), null); assert.ok(queue.draft('old-turn'), 'other chat is unaffected');
  await queue.appendMessage('old-turn', { messageId: 'new-turn', expectedSequence: queue.get('old-turn').conversation?.sequence ?? 0,
    baseRevisionId: repo.head('main'), text: 'Use the latest instruction.', sources: [], visual: null });
  assert.equal(queue.draft('old-turn'), null);
  gates.get('cancel-me')?.resolve(); gates.get('old-turn')?.resolve();
  await until(() => reached.has('new-turn'));
  const current = queue.draft('old-turn'); assert.ok(current); assert.equal(current.requestId, 'new-turn'); assert.equal(current.attempt, 1);
  assert.equal(lateCalls, 2); assert.equal(queue.project(repo.projectId), accepted);
  gates.get('new-turn')?.resolve(); await until(() => queue.get('old-turn').state === 'ready'); assert.equal(queue.draft('old-turn'), null);
});

test('provider failure, retry and shutdown revoke previews without saving them or altering accepted state', async t => {
  let runs = 0; const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]; let reached = 0;
  const queue = await ChangeRequests.open(':memory:', () => worker(async session => {
    const index = runs++; assert.equal((await execute(session)).done, true); reached++;
    await gates[index]?.promise;
    if (index === 0) throw new Error('Provider disconnected.');
  }));
  t.after(async () => { for (const gate of gates) gate.resolve(); await queue.close(); });
  const repo = await RoomRepository.create(); const accepted = repo.serialize();
  await queue.submit(accepted, initial(repo, 'retry-me')); await until(() => reached === 1); assert.equal(queue.draft('retry-me')?.attempt, 1);
  gates[0]?.resolve(); await until(() => queue.get('retry-me').state === 'failed'); assert.equal(queue.draft('retry-me'), null);
  await queue.decide('retry-me', { action: 'retry', decisionId: 'retry', expectedRequestId: 'retry-me' });
  assert.equal(queue.draft('retry-me'), null); await until(() => reached === 2);
  assert.equal(queue.draft('retry-me')?.attempt, 2); assert.equal(queue.draft('retry-me')?.sequence, 2);
  assert.equal(queue.project(repo.projectId), accepted);
  const closing = queue.close(); assert.throws(() => queue.draft('retry-me'), /closed/);
  gates[1]?.resolve(); await closing;
});

test('HTTP draft feed is read-only, same-origin, uncached and ends when the final proposal is ready', async t => {
  const reached = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
  const server = await createDemoServer({ modelWorker: worker(async session => {
    assert.equal((await execute(session)).done, true); reached.resolve(); await release.promise;
  }) });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-http-')); const socketPath = path.join(directory, 'server.sock');
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  t.after(async () => {
    release.resolve(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await server.closeModelWorkers(); fs.rmSync(directory, { recursive: true, force: true });
  });
  const request = (target: string, method = 'GET', body?: unknown, headers: http.OutgoingHttpHeaders = {}) => new Promise<{status: number | undefined; value: unknown; headers: http.IncomingHttpHeaders}>((resolve, reject) => {
    const req = http.request({ socketPath, path: target, method, headers: { Host: 'localhost', 'Content-Type': 'application/json', ...headers } }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => { try { resolve({ status: response.statusCode, value: JSON.parse(text), headers: response.headers }); } catch (error) { reject(error); } });
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const repo = await RoomRepository.create();
  assert.equal((await request('/api/change-requests', 'POST', { project: repo.serialize(), request: initial(repo, 'http-draft') })).status, 202);
  await reached.promise;
  const response = await request('/api/change-requests/http-draft/draft');
  assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
  const body = response.value; assert.ok(body && typeof body === 'object' && 'draft' in body);
  const draft = parseRequestDraft(body.draft); assert.ok(draft); assert.equal(draft.sequence, 2); assert.equal(rectangleLayout(draft.snapshot).door.widthMm, 1200);
  assert.equal((await request('/api/change-requests/http-draft/draft', 'POST')).status, 405);
  assert.equal((await request('/api/change-requests/unknown/draft')).status, 400);
  assert.equal((await request('/api/change-requests/http-draft/draft', 'GET', undefined, { Origin: 'https://attacker.example' })).status, 400);
  release.resolve();
  for (let index = 0; index < 1000; index++) {
    const latest = (await request('/api/change-requests/http-draft/draft')).value;
    assert.ok(latest && typeof latest === 'object' && 'draft' in latest);
    if (latest.draft === null) return;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Final proposal retained a tentative draft.');
});
