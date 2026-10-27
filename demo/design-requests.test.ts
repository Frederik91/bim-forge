import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChangeRequests } from './change-requests.ts';
import { RoomRepository } from '../src/room-model.ts';
import { syntheticResidentialFixture } from '../src/synthetic-residential-fixture.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

const wallWorker: ModelWorker = {
  identity: { provider: 'test', model: 'design-wall-fixture' },
  async run(session) {
    session.recordProviderEvent({ responseId: 'synthetic-wall-response', inputTokens: 50, outputTokens: 50, totalTokens: 100 });
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.previewWallShift({ wallId: 'wall-living-kitchen', offsetMetres: .2 });
      return { kind: 'propose', review: {
        summary: 'Move the partition 200 mm east.', rationale: 'Widen the living room in this alternative.',
        constraints: 'Keep the baseline and unrelated contents unchanged.', uncertainty: 'Synthetic concept geometry.',
        intent: { interpretation: 'Move the shared partition east.', assumptions: [], certainty: .95, basis: ['Explicit fixture instruction.'] }
      }};
    ` });
    assert.equal(result.ok, true, JSON.stringify(result));
  },
};
async function initial() {
  const fixture = syntheticResidentialFixture();
  return RoomRepository.createProject({ projectId: fixture.projectId, name: 'Synthetic design workflow', snapshot: fixture.snapshot });
}
async function ready(queue: ChangeRequests, id: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ticket = queue.get(id);
    if (ticket.state === 'ready') return ticket;
    assert.ok(ticket.state === 'queued' || ticket.state === 'working', JSON.stringify(ticket));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('The design proposal did not become reviewable.');
}

test('baseline and alternative commands replay after later metadata and survive restart without changing main', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-design-command-'));
  const file = path.join(directory, 'queue.sqlite');
  let queue = await ChangeRequests.open(file, () => null);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const original = await initial(); await queue.importProject(original.serialize());
  const command = { commandId: 'capture-as-is', name: 'As-is', from: original.freezeDesignTarget({ kind: 'main' }) };
  const captured = await queue.designCommand(original.projectId, 'baseline', command);
  assert.equal(captured.created.kind, 'baseline');
  if (captured.created.kind !== 'baseline') throw new Error('Expected a baseline.');
  const fork = { commandId: 'fork-kitchen', baselineId: captured.created.id, name: 'Wider kitchen' };
  const alternative = await queue.designCommand(original.projectId, 'alternative', fork);
  const replay = await queue.designCommand(original.projectId, 'baseline', command);
  assert.deepEqual(replay.created, captured.created);
  assert.equal(replay.project, alternative.project);
  await assert.rejects(queue.designCommand(original.projectId, 'baseline', { ...command, name: 'Different payload' }), /different inputs/);
  const restored = await RoomRepository.restore(replay.project);
  assert.equal(restored.head('main'), original.head('main'));
  assert.deepEqual(restored.designView(captured.created).snapshot, original.view(original.head('main')).snapshot);
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  const resumed = await queue.designCommand(original.projectId, 'alternative', fork);
  assert.deepEqual(resumed.created, alternative.created);
  assert.equal((await RoomRepository.restore(resumed.project)).designTargets().length, 3);
});

test('a queued wall request accepts only into its frozen alternative and retains native decisions after restart', { timeout: 60_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-design-accept-'));
  const file = path.join(directory, 'queue.sqlite');
  let queue = await ChangeRequests.open(file, () => wallWorker);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const original = await initial(); await queue.importProject(original.serialize());
  const captured = await queue.designCommand(original.projectId, 'baseline', {
    commandId: 'baseline-wall', name: 'As-is', from: original.freezeDesignTarget({ kind: 'main' }),
  });
  if (captured.created.kind !== 'baseline') throw new Error('Expected a baseline.');
  const fork = await queue.designCommand(original.projectId, 'alternative', { commandId: 'alternative-wall', name: 'Wider kitchen', baselineId: captured.created.id });
  if (fork.created.kind !== 'alternative') throw new Error('Expected an alternative.');
  const repository = await RoomRepository.restore(fork.project);
  const target = repository.freezeDesignTarget(fork.created);
  const request = { requestId: 'alternative-wall-request', proposalName: 'alternative-wall-proposal', target,
    baseRevisionId: target.revisionId, selectedObjectIds: ['wall-living-kitchen'], instruction: 'Move the living/kitchen partition 200 mm east.', visualIntent: { kind: 'selection' } };
  const submitted = await queue.submit(repository.serialize(), request);
  await ready(queue, submitted.id);
  const result = await queue.decide(submitted.id, { action: 'accept', decisionId: 'accept-alternative-wall', expectedRequestId: request.requestId });
  const accepted = await RoomRepository.restore(result.project);
  assert.equal(accepted.head('main'), original.head('main'));
  assert.deepEqual(accepted.designView(captured.created).snapshot, original.view(original.head('main')).snapshot);
  const wall = accepted.designView(fork.created).snapshot.entities.find(item => item.id === 'wall-living-kitchen');
  assert.ok(wall?.type === 'Wall'); assert.equal(wall.start[0], 5.2);
  assert.equal(accepted.review(request.proposalName).decision.status, 'accepted');
  await queue.close(); queue = await ChangeRequests.open(file, () => wallWorker);
  assert.equal(queue.get(submitted.id).state, 'completed');
  const saved = queue.project(original.projectId); assert.ok(saved);
  assert.equal((await RoomRepository.restore(saved)).designView(fork.created).revisionId, accepted.designView(fork.created).revisionId);
});
