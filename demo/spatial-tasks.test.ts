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
function turn(requestId = 'ticket-one', sequence = 1, state = 'queued') {
  const base = ticket();
  return { ...base, state, request: { ...base.request, requestId },
    conversation: { ...base.conversation, sequence, messages: Array.from({ length: sequence }, (_, index) => ({
      ...base.conversation.messages[0], kind: 'user', id: `message-${index}`, requestId: index ? requestId : 'ticket-one',
      sequence: index + 1, at: 1, baseRevisionId: revision, text: index ? 'Make it wider' : 'Improve this door', sources: [], visual: null,
    })) } };
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

test('first submission acknowledges a ticket summary before a separate conversation read', async () => {
  const { conversation: _conversation, ...summary } = ticket();
  const tasks = new SpatialTasks<string>({ fetch: async (_path, init) => Response.json({ ticket: init ? summary : ticket() }) });
  tasks.setProject('project-one'); tasks.startTask('first'); const key = tasks.key;
  tasks.saveDraft(key, 'First sent text');
  const acknowledgement = await tasks.submit(submission());
  assert.equal(acknowledgement.preserveDraft, false);
  assert.equal(tasks.getDraft(key), undefined);
  assert.equal(tasks.projection.ticketId, summary.id);
  const acknowledged = tasks.projection;
  assert.equal(acknowledged.conversation, null);
  await tasks.readTask(summary.id);
  assert.equal(tasks.projection.conversation?.ticketId, summary.id);
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

test('an older same-task poll cannot replace a confirmed appended conversation', async () => {
  const delayed = deferred<Response>(); let reads = 0;
  const tasks = new SpatialTasks({ fetch: async (_path, init) => {
    if (init?.method === 'POST') return Response.json({ ticket: turn('reply-two', 2) });
    if (++reads === 1) return Response.json({ ticket: turn() });
    return delayed.promise;
  } });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  const oldPoll = tasks.readTask('ticket-one');
  const confirmation = await tasks.append({ expectedSequence: 1, baseRevisionId: revision, text: 'Make it wider', sources: [], visual: null });
  tasks.receiveTask(confirmation.ticket);
  delayed.resolve(Response.json({ ticket: turn() }));
  await assert.rejects(oldPoll, StaleTaskResponse);
  assert.equal(tasks.projection.conversation?.sequence, 2);
  assert.equal(tasks.projection.tickets[0]?.request.requestId, 'reply-two');
});

test('an older backlog snapshot retains newer detail and still admits unrelated tasks', async () => {
  const delayed = deferred<Response>();
  const tasks = new SpatialTasks({ fetch: async path => String(path).includes('/api/projects/')
    ? delayed.promise : Response.json({ ticket: turn('reply-two', 2) }) });
  tasks.setProject('project-one'); const oldBacklog = tasks.refresh(); await tasks.openTask('ticket-one');
  delayed.resolve(Response.json({ tickets: [turn(), ticket('unrelated-task')], project: null }));
  const refreshed = await oldBacklog;
  assert.equal(tasks.projection.conversation?.sequence, 2);
  assert.equal(tasks.projection.tickets.find(item => item.id === 'ticket-one')?.request.requestId, 'reply-two');
  assert.equal(refreshed.tickets.find(item => item.id === 'ticket-one')?.request.requestId, 'reply-two');
  assert.ok(refreshed.tickets.some(item => item.id === 'unrelated-task'));
});

test('fresh remote turns and failed-to-queued retry states update without timestamp or state ranking', async () => {
  const updates = [turn(), turn('reply-two', 2, 'failed'), turn('reply-two', 2, 'queued'), turn('reply-two', 2, 'working')];
  const tasks = new SpatialTasks({ fetch: async () => Response.json({ ticket: updates.shift() }) });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  await tasks.readTask('ticket-one'); assert.equal(tasks.projection.tickets[0]?.state, 'failed');
  await tasks.readTask('ticket-one'); assert.equal(tasks.projection.tickets[0]?.state, 'queued');
  await tasks.readTask('ticket-one'); assert.equal(tasks.projection.tickets[0]?.state, 'working');
  assert.equal(tasks.projection.tickets[0]?.updatedAt, 1);
  assert.equal(tasks.projection.conversation?.sequence, 2);
});

test('a higher authoritative sequence wins even from an earlier dispatch, and a later lower sequence cannot regress it', async () => {
  const delayed = deferred<Response>(); let reads = 0;
  const tasks = new SpatialTasks({ fetch: async () => ++reads === 2 ? delayed.promise : Response.json({ ticket: turn() }) });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  const earlierDispatch = tasks.readTask('ticket-one');
  await tasks.readTask('ticket-one');
  delayed.resolve(Response.json({ ticket: turn('remote-turn', 2) })); await earlierDispatch;
  await assert.rejects(tasks.readTask('ticket-one'), StaleTaskResponse);
  assert.equal(tasks.projection.conversation?.sequence, 2);
  assert.equal(tasks.projection.tickets[0]?.request.requestId, 'remote-turn');
});

test('a summary cannot publish a different known request binding until a full detail confirms the remote turn', async () => {
  const delayed = deferred<Response>(); const confirming = deferred<void>(); let reads = 0;
  const { conversation: _conversation, ...summary } = turn('remote-turn', 2);
  const tasks = new SpatialTasks({ fetch: async path => {
    if (String(path).includes('/api/projects/')) return Response.json({ tickets: [summary], project: null });
    if (++reads === 1) return Response.json({ ticket: turn() });
    confirming.resolve(); return delayed.promise;
  } });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  const refresh = tasks.refresh(); await confirming.promise;
  assert.equal(tasks.projection.tickets[0]?.request.requestId, 'ticket-one');
  assert.equal(tasks.projection.conversation?.sequence, 1);
  delayed.resolve(Response.json({ ticket: turn('remote-turn', 2) }));
  const result = await refresh;
  assert.equal(result.tickets[0]?.request.requestId, 'remote-turn');
  assert.equal(tasks.projection.conversation?.sequence, 2);
});

test('an earlier same-sequence response and its retained UI adapters cannot replace a newer detail', async () => {
  const delayed = deferred<Response>(); let reads = 0;
  const tasks = new SpatialTasks({ fetch: async () => {
    if (++reads === 2) return delayed.promise;
    return Response.json({ ticket: turn('ticket-one', 1, reads === 1 ? 'queued' : 'working') });
  } });
  tasks.setProject('project-one'); const first = await tasks.openTask('ticket-one');
  const oldPoll = tasks.readTask('ticket-one'); await tasks.readTask('ticket-one');
  delayed.resolve(Response.json({ ticket: turn() })); await assert.rejects(oldPoll, StaleTaskResponse);
  assert.throws(() => tasks.receiveTask(first.ticket), StaleTaskResponse);
  assert.throws(() => tasks.updateTicket(tasks.parseTicket(first.ticket)), StaleTaskResponse);
  assert.equal(tasks.projection.tickets[0]?.state, 'working');
});

test('reapplying an explicitly received detail cannot give the same old response a new age', () => {
  const tasks = new SpatialTasks(); const original = turn();
  tasks.setProject('project-one'); tasks.receiveTask(original);
  tasks.receiveTask(turn('ticket-one', 1, 'working'));
  assert.throws(() => tasks.receiveTask(original), StaleTaskResponse);
  assert.equal(tasks.projection.tickets[0]?.state, 'working');
});

test('a confirmed decision fences old live drafts and old accepted-project backlog snapshots', async () => {
  const backlog = deferred<Response>(); const draft = deferred<Response>();
  const tasks = new SpatialTasks({ fetch: async (path, init) => {
    if (init?.method === 'POST') return Response.json({ project: 'accepted-project-after-decision' });
    if (String(path).includes('/api/projects/')) return backlog.promise;
    if (String(path).endsWith('/draft')) return draft.promise;
    return Response.json({ ticket: turn() });
  } });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  const oldBacklog = tasks.refresh(); const oldDraft = tasks.readDraft('ticket-one');
  await tasks.decide({ ticketId: 'ticket-one', action: 'cancel', expectedRequestId: 'ticket-one' });
  backlog.resolve(Response.json({ tickets: [turn()], project: 'old-accepted-project' }));
  draft.resolve(Response.json({ draft: null }));
  assert.equal((await oldBacklog).project, 'accepted-project-after-decision');
  await assert.rejects(oldDraft, StaleTaskResponse);
});

test('a newly confirmed remote turn clears the previous proposal inspection atomically', async () => {
  const base = ticket(); const proposalRevisionId = 'c'.repeat(64);
  const ready = { ...base, state: 'ready', conversation: { ...base.conversation, sequence: 2, messages: [...base.conversation.messages,
    { kind: 'assistant', id: 'assistant-one', requestId: 'ticket-one', replyTo: 'user-one', sequence: 2, at: 2,
      baseRevisionId: revision, content: { kind: 'proposal', text: 'Ready', proposalName: 'door-change', proposalRevisionId } },
  ] } };
  const next = { ...ready, state: 'queued', request: { ...ready.request, requestId: 'remote-turn' },
    conversation: { ...ready.conversation, sequence: 3, messages: [...ready.conversation.messages,
      { ...base.conversation.messages[0], kind: 'user', id: 'remote-user', requestId: 'remote-turn', sequence: 3,
        at: 3, baseRevisionId: revision, text: 'Revise', sources: [], visual: null },
    ] } };
  const delayed = deferred<Response>(); const started = deferred<void>(); let reads = 0;
  const tasks = new SpatialTasks({ fetch: async path => {
    if (String(path).includes('/api/projects/')) { const { conversation: _conversation, ...summary } = next; return Response.json({ tickets: [summary], project: null }); }
    if (++reads === 1) return Response.json({ ticket: ready }); started.resolve(); return delayed.promise;
  } });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  tasks.inspectProposal({ messageId: 'assistant-one', requestId: 'ticket-one', proposalRevisionId, summary: 'Ready', rationale: 'Intent',
    constraints: 'Keep host', uncertainty: 'Fixture', status: 'Ready', canAccept: true, canReject: true, canRevise: true, delta: true });
  const refresh = tasks.refresh(); await started.promise;
  assert.equal(tasks.projection.inspection?.requestId, 'ticket-one');
  assert.equal(tasks.projection.tickets[0]?.request.requestId, 'ticket-one');
  delayed.resolve(Response.json({ ticket: next })); await refresh;
  assert.equal(tasks.projection.inspection, null);
  assert.equal(tasks.projection.conversation?.sequence, 3);
  assert.equal(tasks.projection.tickets[0]?.request.requestId, 'remote-turn');
});

test('unchanged backlog polling does not starve a slower live draft read', async () => {
  const delayed = deferred<Response>();
  const tasks = new SpatialTasks({ fetch: async path => {
    if (String(path).endsWith('/draft')) return delayed.promise;
    if (String(path).includes('/api/projects/')) return Response.json({ tickets: [turn()], project: null });
    return Response.json({ ticket: turn() });
  } });
  tasks.setProject('project-one'); await tasks.openTask('ticket-one');
  const draft = tasks.readDraft('ticket-one'); await tasks.refresh();
  delayed.resolve(Response.json({ draft: null })); assert.equal(await draft, null);
});

test('an initial detail cannot contradict a newer summary binding before its first conversation is known', async () => {
  const delayed = deferred<Response>(); let reads = 0;
  const { conversation: _conversation, ...summary } = turn('remote-turn', 2);
  const tasks = new SpatialTasks({ fetch: async path => {
    if (String(path).includes('/api/projects/')) return Response.json({ tickets: [summary], project: null });
    return ++reads === 1 ? delayed.promise : Response.json({ ticket: turn('remote-turn', 2) });
  } });
  tasks.setProject('project-one'); const opening = tasks.openTask('ticket-one'); await tasks.refresh();
  delayed.resolve(Response.json({ ticket: turn() })); await assert.rejects(opening, StaleTaskResponse);
  assert.equal(tasks.projection.tickets[0]?.request.requestId, 'remote-turn');
  const pending = tasks.projection; assert.equal(pending.conversation, null);
  await tasks.readTask('ticket-one'); assert.equal(tasks.projection.conversation?.sequence, 2);
});
