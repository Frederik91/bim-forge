import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeRequests, BacklogConflict } from './change-requests.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { modelScopeFixture } from '../src/model-scope-fixture.ts';
import { parseRequestConversation } from '../src/request-conversation.ts';
import { conversationWorker } from './fixtures/conversation-agent.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

async function settled(queue: ChangeRequests, id: string): Promise<void> {
  for (let index = 0; index < 6000; index++) {
    if (['needs-input', 'ready', 'failed'].includes(queue.get(id).state)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Conversation integration turn timed out.');
}

test('a clarification reply keeps document and snapshot evidence on one scoped ticket through explicit review', async t => {
  let deliveredEvidence = false;
  const worker: ModelWorker = { identity: conversationWorker.identity, async run(session) {
    if (JSON.stringify(session.input).includes('Reference: preserve the existing monitor and all other rooms.')) deliveredEvidence = true;
    await conversationWorker.run(session);
  } };
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
  const repo = await RoomRepository.createProject({ projectId: '18100000-0000-4000-8000-000000000001', name: 'Conversation evidence', snapshot: modelScopeFixture() });
  const original = repo.serialize(); const baseRevisionId = repo.head('main');
  await queue.submit(original, { requestId: 'desk-chat', baseRevisionId, selectedObjectIds: ['office-desk'],
    instruction: 'Make this desk wider. Keep its monitor and all other rooms.', visualIntent: { kind: 'selection' },
    scope: { query: { version: 1, allOf: [{ kind: 'ids', ids: ['office-desk'] }], anyOf: [], excludeIds: [] } } });
  await settled(queue, 'desk-chat');
  assert.equal(queue.get('desk-chat').state, 'needs-input', queue.get('desk-chat').error ?? '');
  const source = await queue.addSource({ projectId: repo.projectId, id: '18100000-0000-4000-8000-000000000002',
    name: 'desk-notes.md', mediaType: 'text/markdown', bytes: Buffer.from('Reference: preserve the existing monitor and all other rooms.'), signal: new AbortController().signal });
  const reply = { messageId: 'desk-answer', expectedSequence: queue.get('desk-chat').conversation?.sequence ?? 0,
    baseRevisionId, text: 'Use 1800 mm width and retain the earlier requirements.', sources: [source],
    visual: { snapshot: { kind: 'accepted', revisionId: baseRevisionId }, view: '3d', levelId: null,
      selectedObjectIds: ['office-desk'], annotations: [{ kind: 'pin', position: [3, 3, 0], label: 'Desk width request' }] } };
  await assert.rejects(() => queue.appendMessage('desk-chat', { ...reply, messageId: 'stale-visual',
    visual: { ...reply.visual, snapshot: { kind: 'accepted', revisionId: 'f'.repeat(64) } } }), BacklogConflict);
  assert.equal(queue.get('desk-chat').conversation?.sequence, reply.expectedSequence);
  await queue.appendMessage('desk-chat', reply);
  await settled(queue, 'desk-chat');
  const ready = queue.get('desk-chat');
  assert.equal(ready.state, 'ready', ready.error ?? ''); assert.ok(ready.result); assert.equal(deliveredEvidence, true);
  const transcript = parseRequestConversation(ready.conversation);
  assert.equal(transcript.messages.filter(message => message.kind === 'user').length, 2);
  const answer = transcript.messages.find(message => message.id === 'desk-answer');
  assert.ok(answer?.kind === 'user'); assert.deepEqual(answer.sources, [source]); assert.deepEqual(answer.visual, reply.visual);
  assert.equal(queue.project(repo.projectId), original);
  const proposed = await RoomRepository.restore(ready.result.project);
  const delta = diffSnapshots(repo.view(baseRevisionId).snapshot, proposed.view(proposed.head(ready.request.proposalName)).snapshot);
  assert.deepEqual(delta.changed.map(change => change.after.id), ['office-desk']);
  assert.equal(delta.added.length, 0); assert.equal(delta.removed.length, 0);
  await queue.decide('desk-chat', { action: 'accept', decisionId: 'desk-review', expectedRequestId: ready.request.requestId });
  assert.equal(queue.get('desk-chat').state, 'completed');
  assert.equal(queue.get('desk-chat').conversation?.messages.at(-1)?.kind, 'decision');
});
