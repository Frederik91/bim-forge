import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ChangeRequests, BacklogConflict } from './change-requests.ts';
import { RoomRepository, rectangleLayout } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { parseRequestConversation } from '../src/request-conversation.ts';

async function settled(queue: ChangeRequests, id: string): Promise<void> {
  for (let index = 0; index < 6000; index++) {
    if (['ready', 'needs-input', 'failed'].includes(queue.get(id).state)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Conversation turn timed out.');
}
function initial(repo: RoomRepository, requestId: string) {
  return { requestId, baseRevisionId: repo.head('main'), selectedObjectIds: ['door-entry'], instruction: 'Please widen the entry.', visualIntent: { kind: 'selection' } };
}
function reply(queue: ChangeRequests, id: string, messageId: string, text: string, baseRevisionId: string) {
  return { messageId, expectedSequence: queue.get(id).conversation?.sequence ?? 0, baseRevisionId, text, sources: [], visual: null };
}
const chatWorker: ModelWorker = { identity: { provider: 'test', model: 'conversation' }, async run(session) {
  assert.ok(session.input && typeof session.input === 'object' && 'conversation' in session.input);
  const conversation = parseRequestConversation(session.input.conversation);
  if (conversation.messages.filter(message => message.kind === 'user').length === 1) {
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: "return {kind:'clarify',question:'Which entry width?',options:['1100 mm','1200 mm']};" });
    assert.equal(result.done, true); return;
  }
  const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
    const inspection = await model.inspect();
    const layout = inspection.placement.layout;
    if (!layout) throw new Error('Missing rectangular room');
    await model.previewRectangle({...layout,door:{...layout.door,widthMm:1200}});
    return {kind:'propose',review:{summary:'Widen entry to 1200 mm.',rationale:'The user answered the question.',constraints:'Retain shell.',uncertainty:'Concept only.',intent:{interpretation:'Widen entry.',assumptions:[],certainty:95,basis:'Explicit user reply.'}}};
  ` });
  assert.equal(result.done, true, JSON.stringify(result));
} };

test('structured ScriptBox clarification, reply replay/CAS, proposal and explicit decision survive restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'request-chat-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'queue.sqlite');
  const repo = await RoomRepository.create();
  let queue = await ChangeRequests.open(file, () => chatWorker);
  await queue.submit(repo.serialize(), initial(repo, 'question'));
  await settled(queue, 'question');
  assert.equal(queue.get('question').state, 'needs-input', queue.get('question').error ?? '');
  const question = queue.get('question').conversation?.messages.at(-1);
  assert.ok(question?.kind === 'assistant' && question.content.kind === 'clarification');
  assert.deepEqual(question.content.options, ['1100 mm', '1200 mm']);
  await queue.close();
  queue = await ChangeRequests.open(file, () => null);
  const input = reply(queue, 'question', 'answer', 'Use 1200 mm.', repo.head('main'));
  await queue.appendMessage('question', input);
  assert.equal((await queue.appendMessage('question', input)).conversation?.sequence, 3);
  await assert.rejects(() => queue.appendMessage('question', { ...input, messageId: 'stale' }), BacklogConflict);
  await assert.rejects(() => queue.appendMessage('question', { ...input, text: 'Different replay.' }), BacklogConflict);
  await queue.close();
  queue = await ChangeRequests.open(file, () => chatWorker);
  await settled(queue, 'question');
  const ready = queue.get('question');
  assert.equal(ready.state, 'ready', ready.error ?? '');
  assert.equal(ready.history.length, 1);
  assert.equal(queue.project(repo.projectId), repo.serialize());
  const result = await queue.decide('question', { action: 'accept', decisionId: 'human-accepted', expectedRequestId: 'answer' });
  const accepted = await RoomRepository.restore(result.project);
  assert.equal(rectangleLayout(accepted.view(accepted.head('main')).snapshot).door.widthMm, 1200);
  assert.equal(queue.get('question').conversation?.messages.at(-1)?.kind, 'decision');
  await queue.close();
  queue = await ChangeRequests.open(file, () => null); t.after(() => queue.close());
  assert.equal(queue.get('question').conversation?.messages.length, 5);
  assert.equal(queue.get('question').state, 'completed');
});

test('reply supersedes a working turn without a late response overwriting it; per-ticket execution is serialized', async t => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const running = new Promise<void>(resolve => { started = resolve; });
  let active = 0; let maximum = 0; let runs = 0;
  const worker: ModelWorker = { identity: { provider: 'test', model: 'late' }, async run(session) {
    active++; maximum = Math.max(maximum, active); runs++;
    try {
      if (runs === 1) {
        started(); await new Promise<void>(resolve => { release = resolve; });
        await assert.rejects(() => session.executeTool('run_model_script', { language: 'javascript', source: "return {kind:'clarify',question:'Late question?',options:[]};" }));
      } else await session.executeTool('run_model_script', { language: 'javascript', source: "return {kind:'clarify',question:'Current question?',options:[]};" });
    } finally { active--; }
  } };
  const repo = await RoomRepository.create();
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
  await queue.submit(repo.serialize(), initial(repo, 'old-turn')); await running;
  await queue.appendMessage('old-turn', reply(queue, 'old-turn', 'new-turn', 'Keep the entry modest.', repo.head('main')));
  assert.equal(queue.get('old-turn').state, 'queued');
  assert.equal(queue.get('old-turn').request.requestId, 'new-turn');
  release(); await settled(queue, 'old-turn');
  assert.equal(maximum, 1);
  assert.equal(queue.get('old-turn').state, 'needs-input', queue.get('old-turn').error ?? '');
  const messages = queue.get('old-turn').conversation?.messages;
  assert.equal(messages?.length, 4);
  assert.ok(!JSON.stringify(messages).includes('Late question?'));
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('legacy tickets seed transcript once without rewriting their review or model bytes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-chat-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'queue.sqlite');
  const repo = await RoomRepository.create();
  let queue = await ChangeRequests.open(file, () => chatWorker);
  await queue.submit(repo.serialize(), initial(repo, 'legacy-question')); await settled(queue, 'legacy-question');
  const original = queue.get('legacy-question');
  await queue.close();
  const db = new DatabaseSync(file); db.exec('DELETE FROM request_messages'); db.close();
  queue = await ChangeRequests.open(file, () => null); t.after(() => queue.close());
  assert.equal(queue.get('legacy-question').conversation?.messages.length, 2);
  assert.deepEqual(queue.get('legacy-question').result, original.result);
  assert.equal(queue.project(repo.projectId), repo.serialize());
});

test('continuation begins with the earlier private draft and retains its review and explicit rejection', async t => {
  let runs = 0;
  const worker: ModelWorker = { identity: { provider: 'test', model: 'draft-refinement' }, async run(session) {
    runs++;
    assert.ok(session.input && typeof session.input === 'object');
    if (runs === 2) assert.ok('priorProposalDraft' in session.input);
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const inspected = await model.inspect();
      const layout = inspected.placement.layout;
      if (!layout) throw new Error('Missing layout');
      ${runs === 1 ? "await model.previewRectangle({...layout,door:{...layout.door,widthMm:1200}});" : "if (layout.door.widthMm !== 1200) throw new Error('Earlier width was lost'); await model.previewRectangle({...layout,door:{...layout.door,offsetMm:2000}});"}
      return {kind:'propose',review:{summary:'Refine entry.',rationale:'Retain earlier width and refine offset.',constraints:'Keep shell.',uncertainty:'Concept only.',intent:{interpretation:'Refine door.',assumptions:[],certainty:95,basis:'Explicit reply.'}}};
    ` });
    assert.equal(result.done, true, JSON.stringify(result));
  } };
  const repo = await RoomRepository.create();
  const queue = await ChangeRequests.open(':memory:', () => worker); t.after(() => queue.close());
  await queue.submit(repo.serialize(), initial(repo, 'draft-first')); await settled(queue, 'draft-first');
  const first = queue.get('draft-first'); assert.equal(first.state, 'ready', first.error ?? '');
  await queue.decide('draft-first', { action: 'reject', decisionId: 'reject-first', expectedRequestId: 'draft-first' });
  await queue.appendMessage('draft-first', reply(queue, 'draft-first', 'draft-refine', 'Retain the width and move the entry offset to 2000 mm.', repo.head('main')));
  await settled(queue, 'draft-first');
  const refined = queue.get('draft-first'); assert.equal(refined.state, 'ready', refined.error ?? '');
  const proposed = await RoomRepository.restore(refined.result?.project);
  const layout = rectangleLayout(proposed.view(proposed.head(refined.request.proposalName)).snapshot);
  assert.equal(layout.door.widthMm, 1200); assert.equal(layout.door.offsetMm, 2000);
  const archived: unknown = JSON.parse(refined.history[0] ?? 'null');
  assert.ok(archived && typeof archived === 'object' && 'result' in archived && 'decisionId' in archived);
  assert.deepEqual(archived.result, first.result); assert.equal(archived.decisionId, 'reject-first');
  assert.ok(refined.conversation?.messages.some(message => message.kind === 'decision' && message.action === 'reject'));
  assert.equal(queue.project(repo.projectId), repo.serialize());
});
