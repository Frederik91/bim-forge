import assert from 'node:assert/strict';
import test from 'node:test';
import { SpatialTasks, StaleTaskResponse, TaskConflict } from './spatial-tasks.ts';
import type { TaskSubmission } from './spatial-tasks.ts';
import type { RequestSource } from '../src/request-sources.ts';

const revision = 'a'.repeat(64);
const attachment: RequestSource = { id: '25300000-0000-4000-8000-000000000001', name: 'brief.txt', mediaType: 'text/plain', byteLength: 5, sha256: 'b'.repeat(64) };
function ticket(id = 'ticket-one', projectId = 'project-one') {
  return { id, projectId, title: 'Improve this door', state: 'queued', createdAt: 1, updatedAt: 1, attempts: 0, error: null,
    request: { requestId: id, proposalName: 'door-change', instruction: 'Improve this door', baseRevisionId: revision, selectedObjectIds: [] },
    conversation: { version: 1, ticketId: id, sequence: 1, messages: [
      { kind: 'user', id: 'user-one', requestId: id, sequence: 1, at: 1, baseRevisionId: revision, text: 'Improve this door', sources: [], visual: null },
    ] } };
}
function submission(): TaskSubmission {
  return { project: 'original serialized project', request: { proposalName: 'door-change', baseRevisionId: revision,
    instruction: 'Improve this door', selectedObjectIds: [], sources: [attachment], visualIntent: { kind: 'selection' } } };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred promise not initialized.'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('lost acknowledgement replays the identical first submission and retained source pins', async () => {
  const bodies: string[] = []; const retained: (readonly RequestSource[])[] = [];
  const tasks = new SpatialTasks<{ text: string }>({
    retainSources: async (projectId, sources) => { assert.equal(projectId, 'project-one'); retained.push(sources); },
    fetch: async (_path, init) => {
      assert.equal(typeof init?.body, 'string'); bodies.push(String(init?.body));
      if (bodies.length === 1) throw new Error('Acknowledgement lost after save');
      return Response.json({ ticket: ticket() });
    },
  });
  tasks.setProject('project-one'); tasks.startTask('draft-one'); tasks.saveDraft(tasks.key, { text: 'Unsent content' });
  await assert.rejects(tasks.submit(submission()), /Acknowledgement lost/);
  assert.equal(tasks.getDraft(tasks.key)?.text, 'Unsent content');
  assert.equal(tasks.projection.ticketId, null);
  await tasks.submit({ ...submission(), project: 'refreshed serialization must not replace original' });
  assert.equal(bodies[0], bodies[1]); assert.deepEqual(retained, [[attachment], [attachment]]);
  assert.equal(tasks.projection.ticketId, 'ticket-one'); assert.equal(tasks.projection.tickets.length, 1);
  assert.equal(tasks.projection.drafts.size, 0);
});

test('follow-up replays identical message and sequence, then keeps draft on sequence conflict', async () => {
  const bodies: string[] = []; let conflict = false;
  const tasks = new SpatialTasks<{ text: string; sources: readonly RequestSource[] }>({ fetch: async (_path, init) => {
    if (!init) return Response.json({ ticket: ticket() });
    bodies.push(String(init?.body));
    if (conflict) return Response.json({ error: 'Conversation changed' }, { status: 409 });
    if (bodies.length === 1) throw new Error('Offline after append');
    return Response.json({ ticket: ticket() });
  } });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  const content = { baseRevisionId: revision, expectedSequence: 1, text: 'Make it wider', sources: [attachment], visual: null };
  tasks.saveDraft(tasks.key, { text: content.text, sources: content.sources });
  await assert.rejects(tasks.append(content), /Offline/);
  await tasks.append({ ...content, expectedSequence: 99 }); assert.equal(bodies[0], bodies[1]);
  conflict = true; tasks.saveDraft(tasks.key, { text: 'Keep this revision', sources: [attachment] });
  await assert.rejects(tasks.append(content), TaskConflict);
  assert.deepEqual(tasks.getDraft(tasks.key), { text: 'Keep this revision', sources: [attachment] });
});

test('late task A response cannot replace task B or a reopened A generation', async () => {
  const delayed = deferred<Response>(); let delay = true;
  const tasks = new SpatialTasks({ fetch: async path => {
    if (String(path).endsWith('ticket-one') && delay) { delay = false; return delayed.promise; }
    return Response.json({ ticket: ticket(String(path).split('/').at(-1)) });
  } });
  tasks.setProject('project-one'); const old = tasks.openTask('ticket-one');
  await tasks.openTask('ticket-two'); await tasks.openTask('ticket-one');
  delayed.resolve(Response.json({ ticket: { ...ticket(), title: 'Stale title' } }));
  await assert.rejects(old, StaleTaskResponse);
  assert.equal(tasks.projection.ticketId, 'ticket-one');
  assert.equal(tasks.projection.tickets.find(item => item.id === 'ticket-one')?.title, 'Improve this door');
});

test('project switch and return reject old backlog without losing independent unsent drafts', async () => {
  const delayed = deferred<Response>();
  const tasks = new SpatialTasks<{ text: string; sources: readonly RequestSource[] }>({ fetch: async () => delayed.promise });
  tasks.setProject('project-one'); tasks.startTask('draft-one'); const firstKey = tasks.key;
  tasks.saveDraft(firstKey, { text: 'First task', sources: [attachment] });
  const old = tasks.refresh(); tasks.setProject('project-two'); tasks.startTask('draft-two');
  tasks.saveDraft(tasks.key, { text: 'Second task', sources: [] }); tasks.setProject('project-one');
  delayed.resolve(Response.json({ tickets: [ticket()], project: null }));
  await assert.rejects(old, StaleTaskResponse);
  assert.equal(tasks.projection.tickets.length, 0); assert.equal(tasks.projection.drafts.size, 2);
  assert.deepEqual(tasks.getDraft(firstKey), { text: 'First task', sources: [attachment] });
});

test('late submission acknowledgement cannot open another task or clear its draft', async () => {
  const delayed = deferred<Response>(); const sent = deferred<void>();
  const tasks = new SpatialTasks<string>({ fetch: async () => { sent.resolve(); return delayed.promise; } });
  tasks.setProject('project-one'); tasks.startTask('first'); const old = tasks.submit(submission());
  await sent.promise; tasks.startTask('second'); tasks.saveDraft(tasks.key, 'Keep second draft');
  delayed.resolve(Response.json({ ticket: ticket() })); await assert.rejects(old, StaleTaskResponse);
  assert.equal(tasks.projection.ticketId, null); assert.equal(tasks.projection.draftId, 'second');
  assert.equal(tasks.getDraft(tasks.key), 'Keep second draft');
});

test('cancel, retry and decisions keep the existing server binding; late acceptance cannot change presentation', async () => {
  const requests: { action: string; expectedRequestId: string }[] = []; const delayed = deferred<Response>();
  const tasks = new SpatialTasks({ fetch: async (_path, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(body && typeof body === 'object' && 'action' in body && 'expectedRequestId' in body && 'decisionId' in body);
    assert.equal(typeof body.decisionId, 'string');
    requests.push({ action: String(body.action), expectedRequestId: String(body.expectedRequestId) });
    return body.action === 'accept' ? delayed.promise : Response.json({ project: 'accepted bytes' });
  } });
  tasks.setProject('project-one'); tasks.selectTask('ticket-one');
  for (const action of ['cancel', 'retry', 'reject']) await tasks.decide({ ticketId: 'ticket-one', action, expectedRequestId: 'turn-two' });
  const acceptance = tasks.decide({ ticketId: 'ticket-one', action: 'accept', expectedRequestId: 'turn-two' });
  tasks.selectTask('ticket-two'); delayed.resolve(Response.json({ project: 'accepted bytes' }));
  await assert.rejects(acceptance, StaleTaskResponse); assert.equal(tasks.projection.ticketId, 'ticket-two');
  assert.deepEqual(requests.map(item => item.action), ['cancel', 'retry', 'reject', 'accept']);
  assert.ok(requests.every(item => item.expectedRequestId === 'turn-two'));
});

test('poll deduplication does not block a new project generation', async () => {
  const delayed = deferred<void>(); const tasks = new SpatialTasks(); let reads = 0;
  tasks.setProject('project-one'); const old = tasks.poll('conversation', async () => { reads += 1; await delayed.promise; });
  await tasks.poll('conversation', async () => { reads += 1; }); assert.equal(reads, 1);
  tasks.setProject('project-two'); await tasks.poll('conversation', async () => { reads += 1; }); assert.equal(reads, 2);
  delayed.resolve(); await old;
});

test('readonly task observation keeps last server state beside offline freshness', async () => {
  const tasks = new SpatialTasks({ fetch: async () => Response.json({ ticket: ticket() }) });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one'); tasks.setOffline(true);
  assert.equal(tasks.projection.tickets[0]?.state, 'queued'); assert.equal(tasks.projection.offline, true);
  assert.ok(Object.isFrozen(tasks.projection)); assert.ok(Object.isFrozen(tasks.projection.tickets[0]?.request));
  assert.ok(Object.isFrozen(tasks.projection.conversation?.messages));
  let updates = 0; const unobserve = tasks.observeWorkspace(() => { updates += 1; });
  tasks.setOffline(false); unobserve(); tasks.setOffline(true); assert.equal(updates, 2);
});

test('edits made after an uncertain send remain unsent when the original envelope is confirmed', async () => {
  const bodies: string[] = [];
  const tasks = new SpatialTasks<string>({ fetch: async (_path, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) throw new Error('Lost acknowledgement');
    return Response.json({ ticket: ticket() });
  } });
  tasks.setProject('project-one'); tasks.startTask('first');
  await assert.rejects(tasks.submit(submission()), /Lost acknowledgement/);
  tasks.saveDraft(tasks.key, 'Later user edits'); const key = tasks.key;
  const response = await tasks.submit({ ...submission(), request: { ...submission().request, instruction: 'Later user edits' } });
  assert.equal(response.preserveDraft, true); assert.equal(bodies[0], bodies[1]);
  assert.equal(tasks.getDraft(key), 'Later user edits');
});

test('proposal inspection uses the exact current task message and is cleared on task switching', async () => {
  const proposalRevisionId = 'c'.repeat(64);
  const base = ticket();
  const proposal = { kind: 'assistant', id: 'assistant-one', requestId: 'ticket-one', replyTo: 'user-one', sequence: 2, at: 2,
    baseRevisionId: revision, content: { kind: 'proposal', text: 'Ready', proposalName: 'door-change', proposalRevisionId } };
  const tasks = new SpatialTasks({ fetch: async () => Response.json({ ticket: { ...base,
    conversation: { ...base.conversation, sequence: 2, messages: [...base.conversation.messages, proposal] } } }) });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  const view = { messageId: 'assistant-one', requestId: 'ticket-one', proposalRevisionId,
    summary: 'Ready', rationale: 'Intent', constraints: 'Keep host', uncertainty: 'Fixture', status: 'Ready',
    canAccept: true, canReject: true, canRevise: true, delta: true };
  assert.throws(() => tasks.inspectProposal({ ...view, messageId: 'other-message' }), /exact task proposal/);
  tasks.inspectProposal(view); assert.equal(tasks.projection.inspection?.messageId, view.messageId);
  tasks.selectTask('ticket-two'); assert.equal(tasks.projection.inspection, null);
  assert.throws(() => tasks.inspectProposal(view), /exact task proposal/);
});
