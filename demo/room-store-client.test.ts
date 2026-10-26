import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository, previewRectangle, rectangleLayout } from '../src/room-model.ts';
import { ProjectClient, ProjectServerError, RoomStore, RoomStoreError, MAX_PROJECT_BYTES, parseLegacyRecord } from './room-store.ts';
import type { ProjectHistoryEntry } from './versioned-project-contract.ts';

function json(value: unknown, status = 200): Response { return Response.json(value, { status }); }

async function reviewedProject() {
  const base = await RoomRepository.create('Recovery study');
  const snapshot = base.view(base.head('main')).snapshot;
  const layout = rectangleLayout(snapshot);
  const proposed = await base.proposeReviewedModel({ name: 'wider-entry', from: base.head('main'),
    snapshot: previewRectangle(snapshot, { ...layout, door: { ...layout.door, widthMm: 1200, offsetMm: 1500 } }),
    review: { requestId: 'request-wider-entry', selectedObjectIds: ['door-entry'], instruction: 'Widen and move the entry.',
      summary: 'Widen and move the entry.', rationale: 'Requested dimensions fit the host.', constraints: 'Keep the host wall.', uncertainty: 'Concept only.',
      worker: { provider: 'fixture', model: 'recovery-fixture', responseIds: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      toolCalls: [{ name: 'preview_rectangle', status: 'accepted', error: null }], validator: 'room-graph-v1' } });
  return { base, proposed, accepted: proposed.accept('wider-entry', { decisionId: 'human-entry', actor: 'human' }) };
}

test('register waits for the server and returns its accepted head, preserving the older browser bytes', async () => {
  const { base, accepted } = await reviewedProject();
  const original = base.serialize();
  const requests: Array<{ path: string; body: string | null }> = [];
  const response = Promise.withResolvers<Response>();
  const client = new ProjectClient(async (input, options) => {
    requests.push({ path: String(input), body: typeof options?.body === 'string' ? options.body : null });
    assert.equal(options?.method, 'POST'); assert.equal(options.cache, 'no-store');
    return response.promise;
  });
  let displayed: RoomRepository | null = null;
  const registration = client.register(base).then(result => { displayed = result; return result; });
  await Promise.resolve();
  assert.equal(displayed, null, 'No browser document is published before the server responds.');
  response.resolve(json({ project: accepted.serialize() }));
  const result = await registration;
  assert.equal(result.serialize(), accepted.serialize());
  assert.notEqual(result.head('main'), base.head('main'));
  assert.equal(base.serialize(), original);
  assert.deepEqual(requests, [{ path: '/api/projects', body: JSON.stringify({ project: original }) }]);
});

test('fresh clients reopen the latest server head without registering a cached or pending document', async () => {
  const { base, proposed, accepted } = await reviewedProject();
  let current = base;
  const requests: string[] = [];
  const request: typeof fetch = async (input, options) => {
    assert.equal(options?.method, undefined);
    requests.push(String(input)); return json({ project: current.serialize() });
  };
  const first = await new ProjectClient(request).read(base.projectId);
  assert.equal(first.head('main'), base.head('main'));
  assert.equal(proposed.head('main'), base.head('main'), 'A preview has not been accepted.');
  current = accepted;
  const fresh = await new ProjectClient(request).read(base.projectId);
  assert.equal(fresh.head('main'), accepted.head('main'));
  assert.equal(fresh.review('wider-entry').decision.status, 'accepted');
  assert.deepEqual(requests, [`/api/projects/${base.projectId}`, `/api/projects/${base.projectId}`]);
});

test('pending proposals in an imported new identity remain pending after server registration', async () => {
  const { base, proposed } = await reviewedProject();
  const client = new ProjectClient(async () => json({ project: proposed.serialize() }));
  const result = await client.register(proposed);
  assert.equal(result.head('main'), base.head('main'));
  assert.equal(result.review('wider-entry').decision.status, 'pending');
});

test('failed, disconnected and interrupted registration never falls back to accepting browser state', async () => {
  const { proposed } = await reviewedProject();
  for (const status of [409, 500, 503]) {
    const client = new ProjectClient(async () => json({ error: 'refused' }, status));
    await assert.rejects(client.register(proposed), (error: unknown) => error instanceof ProjectServerError && error.status === status);
  }
  await assert.rejects(new ProjectClient(async () => { throw new Error('connection lost'); }).register(proposed), /disconnected/);
  await assert.rejects(new ProjectClient(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('interrupted')); } }))).register(proposed), /interrupted/);
  assert.equal(proposed.review('wider-entry').decision.status, 'pending');
});

test('project boundary rejects forged identity, mismatched original, malformed and oversized data', async () => {
  const { base, accepted } = await reviewedProject();
  const other = await RoomRepository.create('Other identity');
  const differentRoot = await RoomRepository.createProject({ projectId: base.projectId, name: base.name, snapshot: accepted.view(accepted.head('main')).snapshot });
  for (const value of [{ project: other.serialize() }, { project: differentRoot.serialize() }, { project: 12 }, { project: '{broken' },
    { project: ' '.repeat(MAX_PROJECT_BYTES + 1) }]) {
    await assert.rejects(new ProjectClient(async () => json(value)).register(base));
  }
  await assert.rejects(new ProjectClient(async () => new Response('broken')).read(base.projectId), /unreadable JSON/);
  await assert.rejects(new ProjectClient(async () => new Response(' '.repeat(MAX_PROJECT_BYTES * 6 + 1025))).read(base.projectId), /bounded demo limit/);
});

test('saved project choices are bounded, schema checked and preserve literal display text', async () => {
  const { base } = await reviewedProject();
  const summary = { projectId: base.projectId, name: '<img src=x onerror=alert(1)>', headRevisionId: base.head('main'), recordedAt: 123456 };
  assert.deepEqual(await new ProjectClient(async () => json({ projects: [summary] })).list(), [summary]);
  for (const projects of [[summary, summary], Array.from({ length: 33 }, (_, index) => ({ ...summary, projectId: String(index) })),
    [{ ...summary, recordedAt: -1 }], [{ ...summary, headRevisionId: null }]]) {
    await assert.rejects(new ProjectClient(async () => json({ projects })).list(), /invalid saved-project list/);
  }
});

test('history sends bounded project-specific cursors and retains actual changes, relationship IDs and bindings', async () => {
  const { base, accepted } = await reviewedProject();
  const root: ProjectHistoryEntry = { revisionId: base.root(), parentRevisionId: null, changedEntityIds: ['wall-south', 'door-entry'],
    changedRelationshipIds: ['door-entry-host'], recordedAt: 2200, origin: 'imported', requestId: null, decisionId: null };
  const entry: ProjectHistoryEntry = { revisionId: accepted.head('main'), parentRevisionId: base.root(), changedEntityIds: ['door-entry'],
    changedRelationshipIds: ['door-entry-host'], recordedAt: 2300, origin: 'accepted', requestId: 'request-wider-entry', decisionId: 'human-entry' };
  const calls: string[] = [];
  const client = new ProjectClient(async input => {
    calls.push(String(input));
    return calls.length === 1 ? json({ entries: [entry], nextCursor: entry.revisionId }) : json({ entries: [root], nextCursor: null });
  });
  assert.deepEqual(await client.history(base.projectId, null, 1), { entries: [entry], nextCursor: entry.revisionId });
  assert.deepEqual(await client.history(base.projectId, entry.revisionId, 1), { entries: [root], nextCursor: null });
  assert.deepEqual(calls, [`/api/projects/${base.projectId}/history?limit=1`, `/api/projects/${base.projectId}/history?limit=1&before=${entry.revisionId}`]);
  assert.equal(root.recordedAt, 2200, 'Imported timestamps are store recording times, not inferred acceptance dates.');
});

test('history rejects invalid bounds, broken ancestry, repeated/exclusive cursors and invalid bindings', async () => {
  const entry: ProjectHistoryEntry = { revisionId: 'head', parentRevisionId: 'root', changedEntityIds: [], changedRelationshipIds: [],
    recordedAt: 0, origin: 'accepted', requestId: 'request', decisionId: 'decision' };
  const invalid: unknown[] = [
    { entries: [entry, entry], nextCursor: null },
    { entries: [entry, { ...entry, revisionId: 'unrelated' }], nextCursor: null },
    { entries: [entry], nextCursor: 'wrong-cursor' },
    { entries: [{ ...entry, parentRevisionId: null }], nextCursor: 'head' },
    { entries: [{ ...entry, recordedAt: 'yesterday' }], nextCursor: null },
    { entries: [{ ...entry, requestId: {} }], nextCursor: null },
    { entries: [{ ...entry, changedRelationshipIds: [4] }], nextCursor: null },
    { entries: [{ ...entry, origin: 'pending' }], nextCursor: null },
  ];
  for (const value of invalid) await assert.rejects(new ProjectClient(async () => json(value)).history('project'));
  await assert.rejects(new ProjectClient(async () => json({ entries: [entry], nextCursor: null })).history('project', 'head'), /inconsistent history/);
  await assert.rejects(new ProjectClient(async () => json({ entries: [entry, { ...entry, revisionId: 'root', parentRevisionId: null }], nextCursor: null })).history('project', null, 1), /invalid history page/);
  let calls = 0;
  const client = new ProjectClient(async () => { calls += 1; return json({}); });
  for (const limit of [0, 51, 1.5, Number.NaN]) await assert.rejects(client.history('project', null, limit), /between 1 and 50/);
  assert.equal(calls, 0);
});

test('legacy recovery preserves exact text even when its generation or envelope is corrupt', () => {
  const text = '  {"unreadable": true} \r\n';
  assert.deepEqual(parseLegacyRecord(undefined), { generation: 0, text: null });
  assert.deepEqual(parseLegacyRecord({ generation: 3, text }), { generation: 3, text });
  for (const record of [{ generation: -1, text }, { text }, { generation: 'bad', text }]) {
    assert.throws(() => parseLegacyRecord(record), (error: unknown) => error instanceof RoomStoreError && error.savedText === text);
  }
  const malformed = { generation: 1, wrongField: 'still recoverable' };
  assert.throws(() => parseLegacyRecord(malformed), (error: unknown) => error instanceof RoomStoreError && error.savedText === JSON.stringify(malformed));
  assert.deepEqual(malformed, { generation: 1, wrongField: 'still recoverable' });
});

test('unavailable browser storage reports recovery access failure independently of server reads', async () => {
  await assert.rejects(RoomStore.open(), /Browser recovery storage is unavailable/);
  const project = await RoomRepository.create();
  const opened = await new ProjectClient(async () => json({ project: project.serialize() })).read(project.projectId);
  assert.equal(opened.serialize(), project.serialize());
});
