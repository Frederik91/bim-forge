import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ChangeRequests } from './change-requests.ts';
import { RoomRepository, rectangleLayout, previewFurnishings } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { readGeometryEvidence, geometrySnapshotHash } from '../src/geometry-evidence.ts';
import { FixtureGeometrySource, evidenceWall, geometryProposalScript, geometryReview, cubeAuthoring, cubeMeasurement } from '../src/geometry-evidence.fixture.ts';

const doorScript = `const view = await model.inspect(); if(!view.placement.layout) throw new Error('Fixture layout');
  await model.previewRectangle({...view.placement.layout,door:{...view.placement.layout.door,widthMm:1200}});
  return {kind:'propose',review:${JSON.stringify(geometryReview)}};`;
function agent(script = geometryProposalScript): ModelWorker {
  return { identity: { provider: 'test', model: 'geometry-evidence-queue' }, async run(session) {
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: script });
    assert.equal(result.ok, true, JSON.stringify(result));
  } };
}
function request(repository: RoomRepository, id: string) {
  return { requestId: id, proposalName: id, baseRevisionId: repository.head('main'), selectedObjectIds: ['wall-west'],
    instruction: 'Add a cube 500 mm clear of the inspected wall.', visualIntent: { kind: 'selection' } };
}
async function ready(queue: ChangeRequests, id: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ticket = queue.get(id);
    if (ticket.state === 'ready') return;
    assert.ok(ticket.state === 'queued' || ticket.state === 'working', JSON.stringify({ state: ticket.state, error: ticket.error }));
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('The synthetic geometry proposal did not become ready.');
}
function accept(queue: ChangeRequests, id: string, decisionId = 'accept-geometry') {
  return queue.decide(id, { action: 'accept', decisionId, expectedRequestId: queue.get(id).request.requestId });
}

test('property-only revision adoption accepts an alternative while retaining Main, As-is and historical source pins across restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geometry-evidence-queue-')); const file = path.join(directory, 'queue.sqlite');
  const source = new FixtureGeometrySource(); let queue = await ChangeRequests.open(file, () => agent(), { geometry: source });
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  let repository = await RoomRepository.create('Historical geometry evidence'); const main = repository.head('main');
  repository = repository.captureBaseline({ id: 'as-is', name: 'As-is', from: repository.freezeDesignTarget({ kind: 'main' }) })
    .forkAlternative({ id: 'test-alternative', name: 'Test alternative', baselineId: 'as-is' });
  const target = repository.freezeDesignTarget({ kind: 'alternative', id: 'test-alternative' });
  const ticket = await queue.submit(repository.serialize(), { ...request(repository, 'alternative-cube'), selectedObjectIds: [], target });
  await ready(queue, ticket.id);
  const reviewProject = queue.get(ticket.id).result?.project; assert.ok(reviewProject);
  const proposed = await RoomRepository.restore(reviewProject); const historical = proposed.review('alternative-cube').geometryEvidence;
  assert.deepEqual(proposed.review('alternative-cube').selectedObjectIds, []);
  assert.ok(historical); assert.match(historical, /"revision":"v1"/);
  await queue.close(); queue = await ChangeRequests.open(file, () => null, { geometry: source });
  source.replace([evidenceWall({ version: 'v2', name: 'Changed metadata only' })]);
  const accepted = await accept(queue, ticket.id); const saved = await RoomRepository.restore(accepted.project);
  assert.equal(saved.head('main'), main); assert.equal(saved.designView({ kind: 'baseline', id: 'as-is' }).revisionId, main);
  assert.notEqual(saved.designView({ kind: 'alternative', id: 'test-alternative' }).revisionId, target.revisionId);
  assert.equal(saved.review('alternative-cube').geometryEvidence, historical);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT body FROM request_geometry_acceptances WHERE decision_id=?').get('accept-geometry');
    assert.equal(typeof row?.body, 'string'); if (typeof row?.body !== 'string') assert.fail('Missing final acceptance evidence');
    const proof: unknown = JSON.parse(row.body);
    assert.ok(proof && typeof proof === 'object' && 'verifiedCandidateSha256' in proof);
    assert.equal(proof.verifiedCandidateSha256, geometrySnapshotHash(saved.designView({ kind: 'alternative', id: 'test-alternative' }).snapshot));
  } finally { db.close(); }
});

test('a previously nonempty selection cannot become implicit project context after all anchors are removed', async t => {
  let currentWorker = agent(doorScript); const queue = await ChangeRequests.open(':memory:', () => currentWorker); t.after(() => queue.close());
  const initial = await RoomRepository.create();
  const repository = await RoomRepository.createProject({ projectId: initial.projectId, name: 'Removed context fixture',
    snapshot: previewFurnishings(initial.view(initial.head('main')).snapshot, { furnishings: [{ id: 'anchor-plant', type: 'Furniture',
      name: 'Context plant', kind: 'plant', position: [4, 2], width: .4, depth: .4, height: .8, rotationDeg: 0, supportId: null }] }) });
  const original = await queue.submit(repository.serialize(), { ...request(repository, 'selected-context'), selectedObjectIds: ['anchor-plant'] });
  await ready(queue, original.id);
  currentWorker = agent(`await model.previewFurnishings({furnishings:[]}); return {kind:'propose',review:${JSON.stringify(geometryReview)}};`);
  const removal = await queue.submit(repository.serialize(), { ...request(repository, 'remove-anchor'), selectedObjectIds: ['anchor-plant'] });
  await ready(queue, removal.id); const accepted = await accept(queue, removal.id, 'accept-removal');
  assert.equal(queue.get(original.id).state, 'needs-input');
  const current = await RoomRepository.restore(accepted.project);
  await assert.rejects(queue.revise(original.id, accepted.project, { ...request(current, 'empty-rebase'), selectedObjectIds: [] }), /originally selected.*disappeared/);
  assert.deepEqual(queue.get(original.id).request.selectedObjectIds, ['anchor-plant']);
});

test('ready proposal rejects moved, removed and newly obstructing source changes without a native decision', async t => {
  for (const change of ['move', 'remove', 'new-obstacle']) {
    const source = new FixtureGeometrySource(); const queue = await ChangeRequests.open(':memory:', () => agent(), { geometry: source });
    t.after(() => queue.close());
    const repository = await RoomRepository.create(change); const ticket = await queue.submit(repository.serialize(), request(repository, 'source-change'));
    await ready(queue, ticket.id); const before = queue.project(repository.projectId);
    source.replace(change === 'remove' ? [] : change === 'move' ? [evidenceWall({ version: 'v2', x: .2 })]
      : [evidenceWall(), evidenceWall({ namespace: 'new-obstacle', x: .9 })]);
    assert.equal((await queue.refreshProposal(ticket.id)).state, 'needs-input');
    await assert.rejects(accept(queue, ticket.id), /geometry|Geometry|projection|membership|correspondence/);
    assert.equal(queue.project(repository.projectId), before); assert.equal(queue.get(ticket.id).decisionId, null);
  }
});

test('catalogue updates between revalidation and final publication retry unrelated changes but reject relevant ones', async t => {
  for (const relevant of [false, true]) {
    const source = new FixtureGeometrySource(); const queue = await ChangeRequests.open(':memory:', () => agent(), { geometry: source });
    t.after(() => queue.close()); const repository = await RoomRepository.create();
    const ticket = await queue.submit(repository.serialize(), request(repository, 'pending-acceptance')); await ready(queue, ticket.id);
    const before = queue.project(repository.projectId);
    source.guards = 0;
    source.onGuard = () => { if (source.guards === 1) source.replace([evidenceWall({ version: 'v2', x: relevant ? .2 : 0 })]); };
    if (relevant) {
      await assert.rejects(accept(queue, ticket.id), /geometry|Geometry|projection|membership/);
      assert.equal(queue.project(repository.projectId), before);
    } else {
      const result = await accept(queue, ticket.id); assert.equal(result.ticket.state, 'completed'); assert.equal(source.guards, 2);
      assert.equal((await accept(queue, ticket.id)).project, result.project, 'the accepted decision replays without a second write');
    }
  }
});

test('proposal-result binding has the same relevant-only catalogue guard as explicit acceptance', async t => {
  for (const relevant of [false, true]) {
    const source = new FixtureGeometrySource();
    source.onGuard = () => { if (source.guards === 1) source.replace([evidenceWall({ version: 'v2', x: relevant ? .1 : 0 })]); };
    const queue = await ChangeRequests.open(':memory:', () => agent(), { geometry: source }); t.after(() => queue.close());
    const repository = await RoomRepository.create(); const ticket = await queue.submit(repository.serialize(), request(repository, 'binding-race'));
    if (!relevant) { await ready(queue, ticket.id); assert.equal(source.guards, 2); }
    else {
      const deadline = Date.now() + 30000;
      while (queue.get(ticket.id).state === 'queued' || queue.get(ticket.id).state === 'working') {
        assert.ok(Date.now() < deadline, 'Binding race did not finish'); await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(queue.get(ticket.id).state, 'failed'); assert.equal(queue.get(ticket.id).result, null);
    }
    assert.equal((await RoomRepository.restore(queue.project(repository.projectId))).head('main'), repository.head('main'));
  }
});

test('unrelated native acceptance is retained when a geometry proposal reconciles against the newer native head', async t => {
  const source = new FixtureGeometrySource(); let currentWorker = agent();
  const queue = await ChangeRequests.open(':memory:', () => currentWorker, { geometry: source }); t.after(() => queue.close());
  const repository = await RoomRepository.create();
  const cube = await queue.submit(repository.serialize(), request(repository, 'independent-cube')); await ready(queue, cube.id);
  currentWorker = agent(doorScript);
  const door = await queue.submit(repository.serialize(), { ...request(repository, 'independent-door'), selectedObjectIds: ['door-entry'] });
  await ready(queue, door.id); await accept(queue, door.id, 'accept-door');
  const result = await accept(queue, cube.id, 'accept-cube'); const saved = await RoomRepository.restore(result.project);
  assert.equal(rectangleLayout(saved.view(saved.head('main')).snapshot).door.widthMm, 1200);
  assert.ok(saved.view(saved.head('main')).snapshot.entities.some(item => item.id === 'requested-cube'));
  assert.equal(saved.review('independent-door').decision.status, 'accepted');
});

test('finite against-object measurements are not a loophole for an uninspected new obstruction', async t => {
  const source = new FixtureGeometrySource();
  const finite = `const page = await geometry.query({query:{categories:['wall'],region:{min:[0,1,0],max:[.25,3,2]}}});
    if(page.kind === 'unavailable') throw new Error('Missing wall');
    const wall = page.items.find(item => item.ref.kind === 'ifc'); if(!wall) throw new Error('Missing wall');
    ${cubeAuthoring}
    await geometry.measure({...${JSON.stringify(cubeMeasurement)},against:{kind:'object',ref:wall.ref}});
    return {kind:'propose',review:${JSON.stringify(geometryReview)}};`;
  const queue = await ChangeRequests.open(':memory:', () => agent(finite), { geometry: source }); t.after(() => queue.close());
  const repository = await RoomRepository.create(); const ticket = await queue.submit(repository.serialize(), request(repository, 'finite-wall'));
  await ready(queue, ticket.id); const before = queue.project(repository.projectId);
  source.replace([evidenceWall(), evidenceWall({ namespace: 'unread-obstruction', x: .9 })]);
  await assert.rejects(accept(queue, ticket.id), /candidate|intersects|geometry|Geometry/);
  assert.equal(queue.project(repository.projectId), before);
});

test('unread native-only proposals keep legacy acceptance semantics even if geometry verification later becomes unavailable', async t => {
  const source = new FixtureGeometrySource(); const queue = await ChangeRequests.open(':memory:', () => agent(doorScript), { geometry: source });
  t.after(() => queue.close()); const repository = await RoomRepository.create();
  const ticket = await queue.submit(repository.serialize(), request(repository, 'native-only')); await ready(queue, ticket.id);
  const projected = queue.get(ticket.id).result?.project; const proposed = await RoomRepository.restore(projected);
  assert.equal(proposed.review('native-only').geometryEvidence, undefined);
  source.onSnapshot = () => { throw new Error('Source store unavailable'); };
  assert.equal((await accept(queue, ticket.id)).ticket.state, 'completed');
});

test('a syntactically valid portable receipt cannot replace the host-authenticated request-attempt binding', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geometry-evidence-auth-')); const file = path.join(directory, 'queue.sqlite');
  const source = new FixtureGeometrySource(); const queue = await ChangeRequests.open(file, () => agent(), { geometry: source });
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const repository = await RoomRepository.create(); const ticket = await queue.submit(repository.serialize(), request(repository, 'receipt-authority'));
  await ready(queue, ticket.id); const before = queue.project(repository.projectId);
  const projected = queue.get(ticket.id).result?.project; const proposed = await RoomRepository.restore(projected);
  assert.equal(readGeometryEvidence(proposed.review('receipt-authority').geometryEvidence).requestId, 'receipt-authority');
  const db = new DatabaseSync(file);
  try { db.prepare('DELETE FROM request_geometry_evidence WHERE request_id=?').run('receipt-authority'); } finally { db.close(); }
  await assert.rejects(accept(queue, ticket.id), /Trusted geometry read evidence/);
  assert.equal(queue.project(repository.projectId), before);
});
