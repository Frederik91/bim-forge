import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ChangeRequests } from './change-requests.ts';
import { RoomRepository } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { parseRequestConversation } from '../src/request-conversation.ts';
import { readGeometryEvidence } from '../src/geometry-evidence-contract.ts';
import { FixtureGeometrySource, cubeAuthoring, cubeMeasurement, geometryReview } from '../src/geometry-evidence.fixture.ts';

const secondMeasurement = { ...cubeMeasurement, subject: { ...cubeMeasurement.subject, candidateId: 'trial-cube',
  bounds: { min: [2.75, 1.75, 0], max: [3.25, 2.25, .5] } },
  against: { kind: 'query', query: { role: 'physical', region: { min: [-.1, 1, -1], max: [4.1, 3, 1.5] } } } };
const twoCubes = `${cubeAuthoring}
await model.previewAssets({families:[],instances:[{id:'trial-cube',type:'AssetInstance',name:'Trial cube',familyId:'evidence-cube',
  position:[3,2],rotationDeg:0,size:{width:.5,depth:.5,height:.5},placement:{kind:'single-room'}}],removeInstanceIds:[]});
await geometry.measure(${JSON.stringify(cubeMeasurement)});
await geometry.measure(${JSON.stringify(secondMeasurement)});`;
const worker: ModelWorker = { identity: { provider: 'test', model: 'draft-geometry-conversation' }, async run(session) {
  assert.ok(session.input && typeof session.input === 'object' && 'conversation' in session.input);
  const turns = parseRequestConversation(session.input.conversation).messages.filter(item => item.kind === 'user').length;
  const source = turns === 1 ? twoCubes
    : `await model.previewAssets({families:[],instances:[],removeInstanceIds:['trial-cube']});`;
  const result = await session.executeTool('run_model_script', { language: 'typescript',
    source: `${source}\nreturn {kind:'propose',review:${JSON.stringify(geometryReview)}};` });
  assert.equal(result.ok, true, JSON.stringify(result));
} };
async function ready(queue: ChangeRequests, id: string): Promise<void> {
  for (let count = 0; count < 3000; count++) {
    const ticket = queue.get(id);
    if (ticket.state === 'ready') return;
    assert.ok(['queued', 'working'].includes(ticket.state), JSON.stringify({ state: ticket.state, error: ticket.error }));
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Draft conversation did not become ready.');
}

test('a restored chat removes its trial cube, keeps all measurements and accepts only the alternative', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-geometry-240-'));
  const file = path.join(directory, 'queue.sqlite'); const source = new FixtureGeometrySource();
  let queue = await ChangeRequests.open(file, () => worker, { geometry: source });
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const original = await RoomRepository.create('Synthetic draft provenance');
  await queue.importProject(original.serialize());
  const captured = await queue.designCommand(original.projectId, 'baseline', { commandId: 'draft-as-is', name: 'As-is',
    from: original.freezeDesignTarget({ kind: 'main' }) });
  assert.ok(captured.created.kind === 'baseline');
  const branched = await queue.designCommand(original.projectId, 'alternative', { commandId: 'draft-alternative', name: 'Trial design',
    baselineId: captured.created.id });
  assert.ok(branched.created.kind === 'alternative');
  const repository = await RoomRepository.restore(branched.project);
  const before = repository.serialize(); const target = repository.freezeDesignTarget(branched.created);
  const submitted = await queue.submit(before, { requestId: 'two-cubes', baseRevisionId: target.revisionId,
    target, selectedObjectIds: [], instruction: 'Add two trial cubes.', visualIntent: { kind: 'selection' } });
  await ready(queue, submitted.id);
  const first = queue.get(submitted.id); assert.ok(first.result);
  const firstProject = await RoomRepository.restore(first.result.project);
  const firstEvidence = firstProject.review(first.request.proposalName).geometryEvidence; assert.ok(firstEvidence);
  assert.equal(readGeometryEvidence(firstEvidence).measurements.length, 2);
  await queue.close(); queue = await ChangeRequests.open(file, () => worker, { geometry: source });
  await queue.appendMessage(submitted.id, { messageId: 'one-cube', expectedSequence: queue.get(submitted.id).conversation?.sequence ?? 0,
    baseRevisionId: target.revisionId, text: 'Remove the trial cube. Keep one cube total.', sources: [], visual: null });
  await ready(queue, submitted.id);
  const revised = queue.get(submitted.id); assert.ok(revised.result);
  const proposal = await RoomRepository.restore(revised.result.project);
  const evidence = proposal.review(revised.request.proposalName).geometryEvidence; assert.ok(evidence);
  assert.deepEqual(readGeometryEvidence(evidence).measurements, readGeometryEvidence(firstEvidence).measurements);
  assert.equal(queue.project(repository.projectId), before);
  const review = proposal.review(revised.request.proposalName);
  const candidate = proposal.view(review.proposalRevisionId).snapshot;
  assert.deepEqual(candidate.entities.filter(item => item.type === 'AssetInstance').map(item => item.id), ['requested-cube']);
  await queue.close(); queue = await ChangeRequests.open(file, () => null, { geometry: source });
  const accepted = await queue.decide(submitted.id, { action: 'accept', decisionId: 'accept-one-cube', expectedRequestId: 'one-cube' });
  const saved = await RoomRepository.restore(accepted.project);
  assert.equal(saved.head('main'), repository.head('main'));
  assert.deepEqual(saved.designView(captured.created).snapshot, repository.designView(captured.created).snapshot);
  assert.deepEqual(saved.designView(branched.created).snapshot, candidate);
  assert.equal(saved.review(revised.request.proposalName).geometryEvidence, evidence);
  assert.equal((await RoomRepository.restore(saved.serialize())).serialize(), saved.serialize());
  assert.equal((await RoomRepository.restore(first.result.project)).review(first.request.proposalName).geometryEvidence, firstEvidence);
});
