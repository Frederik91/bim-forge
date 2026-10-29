import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ChangeRequests } from './change-requests.ts';
import { RoomRepository, rectangleLayout, previewFurnishings, previewAssets, diffSnapshots } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { readGeometryEvidence, parseGeometryEvidence, geometrySnapshotHash } from '../src/geometry-evidence.ts';
import { FixtureGeometrySource, evidenceWall, evidenceFloor, geometryProposalScript, geometryReview, cubeAuthoring, cubeMeasurement } from '../src/geometry-evidence.fixture.ts';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';

const doorScript = `const view = await model.inspect(); if(!view.placement.layout) throw new Error('Fixture layout');
  await model.previewRectangle({...view.placement.layout,door:{...view.placement.layout.door,widthMm:1200}});
  return {kind:'propose',review:${JSON.stringify(geometryReview)}};`;
function agent(script = geometryProposalScript, onSuccess: () => void = () => {}): ModelWorker {
  return { identity: { provider: 'test', model: 'geometry-evidence-queue' }, async run(session) {
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: script });
    assert.equal(result.ok, true, JSON.stringify(result));
    onSuccess();
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
  await queue.importProject(repository.serialize());
  const baseline = await queue.designCommand(repository.projectId, 'baseline', { commandId: 'capture-as-is', name: 'As-is',
    from: repository.freezeDesignTarget({ kind: 'main' }) });
  assert.ok(baseline.created.kind === 'baseline');
  const alternative = await queue.designCommand(repository.projectId, 'alternative', { commandId: 'fork-test-alternative',
    name: 'Test alternative', baselineId: baseline.created.id });
  assert.ok(alternative.created.kind === 'alternative');
  repository = await RoomRepository.restore(alternative.project);
  const target = repository.freezeDesignTarget(alternative.created);
  const ticket = await queue.submit(repository.serialize(), { ...request(repository, 'alternative-cube'), selectedObjectIds: [], target });
  await ready(queue, ticket.id);
  const reviewProject = queue.get(ticket.id).result?.project; assert.ok(reviewProject);
  const proposed = await RoomRepository.restore(reviewProject); const historical = proposed.review('alternative-cube').geometryEvidence;
  assert.deepEqual(proposed.review('alternative-cube').selectedObjectIds, []);
  assert.ok(historical); assert.match(historical, /"revision":"v1"/);
  await queue.close(); queue = await ChangeRequests.open(file, () => null, { geometry: source });
  source.replace([evidenceWall({ version: 'v2', name: 'Changed metadata only' })]);
  const accepted = await accept(queue, ticket.id); const saved = await RoomRepository.restore(accepted.project);
  assert.equal(saved.head('main'), main); assert.equal(saved.designView(baseline.created).revisionId, main);
  assert.deepEqual(saved.designView(baseline.created).snapshot, repository.designView(baseline.created).snapshot);
  assert.notEqual(saved.designView(alternative.created).revisionId, target.revisionId);
  assert.equal(saved.review('alternative-cube').geometryEvidence, historical);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT body FROM request_geometry_acceptances WHERE decision_id=?').get('accept-geometry');
    assert.equal(typeof row?.body, 'string'); if (typeof row?.body !== 'string') assert.fail('Missing final acceptance evidence');
    const proof: unknown = JSON.parse(row.body);
    assert.ok(proof && typeof proof === 'object' && 'verifiedCandidateSha256' in proof);
    assert.equal(proof.verifiedCandidateSha256, geometrySnapshotHash(saved.designView(alternative.created).snapshot));
    assert.ok('finalMeasurements' in proof && Array.isArray(proof.finalMeasurements) && proof.finalMeasurements.length > 0);
  } finally { db.close(); }
});

test('final native endpoint replay is symmetric for object order and query members, and preserves actual final measurements', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geometry-final-endpoints-'));
  const queues: ChangeRequests[] = [];
  t.after(async () => { for (const queue of queues) await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  for (const endpoint of ['native-subject', 'native-against', 'native-query-member']) {
    for (const scenario of [{ x: 2.3, operation: 'clearance' }, { x: 3.5, operation: 'clearance' },
      ...(endpoint === 'native-against' ? [{ x: 2.3, operation: 'distance' }, { x: 3.5, operation: 'distance' }] : [])]) {
      const { x, operation } = scenario;
      const initial = await RoomRepository.create();
      const instance = { id: 'requested-cube', type: 'AssetInstance', name: 'Requested cube', familyId: 'evidence-cube', position: [3, 2],
        rotationDeg: 0, size: { width: .5, depth: .5, height: .5 }, placement: { kind: 'single-room' } };
      const snapshot = previewAssets(initial.view(initial.head('main')).snapshot, {
        families: [{ id: 'evidence-cube', type: 'AssetFamily', name: 'Cube', description: 'Synthetic cube',
          parts: [{ id: 'body', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#546778' }] }],
        instances: [instance], removeInstanceIds: [],
      });
      const repository = await RoomRepository.createProject({ projectId: initial.projectId, name: endpoint, snapshot });
      const native = { kind: 'object', ref: { kind: 'native', projectId: repository.projectId, revisionId: repository.head('main'),
        target: { kind: 'main' }, entityId: instance.id } };
      const subject = endpoint === 'native-subject' ? JSON.stringify(native) : "{kind:'object',ref:wall.ref}";
      const against = endpoint === 'native-subject' ? "{kind:'object',ref:wall.ref}" : endpoint === 'native-against'
        ? JSON.stringify(native) : "{kind:'query',query:{role:'physical',categories:['asset']}}";
      const script = `const page = await geometry.query({query:{categories:['wall'],region:{min:[2,.5,0],max:[2.25,3.5,2.5]}}});
        if(page.kind === 'unavailable') throw new Error('Missing source wall');
        const wall = page.items.find(item => item.ref.kind === 'ifc'); if(!wall) throw new Error('Missing source wall');
        const measured = await geometry.measure({subject:${subject},against:${against},operation:${JSON.stringify(operation)},clearanceMetres:.5});
        if(measured.kind !== 'complete'${operation === 'clearance' ? " || measured.value.clearance !== 'satisfied-mesh'" : ''}) throw new Error('Initial measurement not proven');
        await model.previewAssets(${JSON.stringify({ families: [], instances: [{ ...instance, position: [x, 2] }], removeInstanceIds: [] })});
        return {kind:'propose',review:${JSON.stringify(geometryReview)}};`;
      const source = new FixtureGeometrySource(); source.replace([evidenceWall({ x: 2 })]);
      const file = path.join(directory, `${endpoint}-${operation}-${x}.sqlite`);
      let guestSucceeded = false;
      const queue = await ChangeRequests.open(file, () => agent(script, () => { guestSucceeded = true; }), { geometry: source }); queues.push(queue);
      const ticket = await queue.submit(repository.serialize(), { ...request(repository, `${endpoint}-${operation}-${x === 3.5 ? 'safe' : 'overlap'}`), selectedObjectIds: [instance.id] });
      if (x === 3.5) {
        await ready(queue, ticket.id);
        assert.equal(guestSucceeded, true, 'The actual TypeScript guest must succeed before final validation.');
        const result = await accept(queue, ticket.id); const saved = await RoomRepository.restore(result.project);
        const evidence = readGeometryEvidence(saved.review(ticket.request.proposalName).geometryEvidence);
        assert.equal(evidence.measurements[0]?.result.kind, 'complete');
        const original = evidence.measurements[0]?.result;
        assert.ok(original?.kind === 'complete'); assert.equal(original.value.distanceMetres, .5);
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          const row = db.prepare('SELECT body FROM request_geometry_acceptances WHERE decision_id=?').get('accept-geometry');
          assert.equal(typeof row?.body, 'string'); if (typeof row?.body !== 'string') assert.fail('Missing final acceptance proof');
          const proof: unknown = JSON.parse(row.body);
          assert.ok(proof && typeof proof === 'object' && 'finalReceipts' in proof && 'finalMeasurements' in proof);
          const final = parseGeometryEvidence({ ...evidence, receipts: proof.finalReceipts, measurements: proof.finalMeasurements,
            proposalSnapshotSha256: geometrySnapshotHash(saved.view(saved.head('main')).snapshot) });
          const replay = final.measurements.find(item => item.request.operation === operation)?.result;
          assert.ok(replay?.kind === 'complete'); assert.equal(replay.value.distanceMetres, 1);
        } finally { db.close(); }
        const moved = saved.view(saved.head('main')).snapshot.entities.find(item => item.id === instance.id);
        assert.ok(moved?.type === 'AssetInstance'); assert.deepEqual(moved.position, [3.5, 2]);
      } else {
        const deadline = Date.now() + 30000;
        while (queue.get(ticket.id).state === 'queued' || queue.get(ticket.id).state === 'working') {
          assert.ok(Date.now() < deadline, `Endpoint case ${endpoint} did not finish`); await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(guestSucceeded, true, 'An unsafe final candidate must be rejected after successful guest execution.');
        assert.equal(queue.get(ticket.id).state, 'failed', endpoint);
        assert.equal(queue.get(ticket.id).result, null); assert.equal(queue.project(repository.projectId), repository.serialize());
      }
    }
  }
});

test('tolerance-expanded final surroundings include nearby open surfaces while ignoring distant open surfaces', async t => {
  for (const x of [1.25 + 5e-8, 1.25 + 1.5e-7, 20]) {
    const source = new FixtureGeometrySource(); source.replace([evidenceWall(), evidenceWall({ namespace: 'open-panel', x, open: true })]);
    const script = `const page = await geometry.query({query:{categories:['wall'],region:{min:[0,1,0],max:[.25,3,2]}}});
      if(page.kind === 'unavailable') throw new Error('Missing wall');
      const wall = page.items.find(item => item.ref.kind === 'ifc'); if(!wall) throw new Error('Missing wall');
      ${cubeAuthoring}
      const result = await geometry.measure({...${JSON.stringify(cubeMeasurement)},against:{kind:'object',ref:wall.ref}});
      if(result.kind !== 'complete' || result.value.clearance !== 'satisfied-mesh') throw new Error('Initial wall gap unavailable');
      return {kind:'propose',review:${JSON.stringify(geometryReview)}};`;
    const repository = await RoomRepository.create(); const queue = await ChangeRequests.open(':memory:', () => agent(script), { geometry: source });
    t.after(() => queue.close()); const ticket = await queue.submit(repository.serialize(), request(repository, 'bounded-surroundings'));
    if (x === 20) { await ready(queue, ticket.id); assert.equal((await accept(queue, ticket.id)).ticket.state, 'completed'); }
    else {
      const deadline = Date.now() + 30000;
      while (queue.get(ticket.id).state === 'queued' || queue.get(ticket.id).state === 'working') {
        assert.ok(Date.now() < deadline, 'Tolerance enclosure case did not finish'); await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(queue.get(ticket.id).state, 'failed'); assert.equal(queue.project(repository.projectId), repository.serialize());
    }
  }
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
  const base = repository.view(repository.head('main')).snapshot;
  assert.equal(rectangleLayout(base).door.widthMm, 900);
  const cube = await queue.submit(repository.serialize(), request(repository, 'independent-cube')); await ready(queue, cube.id);
  const cubeProject = await RoomRepository.restore(queue.get(cube.id).result?.project);
  const originalCube = cubeProject.review('independent-cube');
  currentWorker = agent(doorScript);
  const door = await queue.submit(repository.serialize(), { ...request(repository, 'independent-door'), selectedObjectIds: ['door-entry'] });
  await ready(queue, door.id);
  const doorResult = await accept(queue, door.id, 'accept-door'); const acceptedDoor = await RoomRepository.restore(doorResult.project);
  const originalDoor = acceptedDoor.review('independent-door');
  assert.equal(originalDoor.decision.status, 'accepted'); assert.equal(originalDoor.decision.decisionId, 'accept-door');
  const nativeDelta = diffSnapshots(base, acceptedDoor.view(acceptedDoor.head('main')).snapshot);
  assert.deepEqual(nativeDelta.entities.modified.map(item => item.id), ['door-entry']);
  assert.deepEqual(nativeDelta.entities.added, []); assert.deepEqual(nativeDelta.entities.removed, []);
  assert.deepEqual(nativeDelta.relationships, { added: [], modified: [], removed: [] });
  assert.equal(rectangleLayout(acceptedDoor.view(acceptedDoor.head('main')).snapshot).door.widthMm, 1200);
  assert.equal(queue.get(cube.id).state, 'ready');
  const result = await accept(queue, cube.id, 'accept-cube'); const saved = await RoomRepository.restore(result.project);
  assert.equal(rectangleLayout(saved.view(saved.head('main')).snapshot).door.widthMm, 1200);
  assert.ok(saved.view(saved.head('main')).snapshot.entities.some(item => item.id === 'requested-cube'));
  const geometryDelta = diffSnapshots(acceptedDoor.view(acceptedDoor.head('main')).snapshot, saved.view(saved.head('main')).snapshot);
  assert.deepEqual(geometryDelta.entities.added.map(item => item.id).sort(), ['evidence-cube', 'requested-cube']);
  assert.deepEqual(geometryDelta.entities.modified, []); assert.deepEqual(geometryDelta.entities.removed, []);
  assert.deepEqual(geometryDelta.relationships, { added: [], modified: [], removed: [] });
  assert.equal(saved.view(saved.head('main')).parentId, acceptedDoor.head('main'));
  const retainedDoor = saved.review('independent-door'); const appliedCube = saved.review('independent-cube');
  assert.equal(retainedDoor.decision.status, 'superseded');
  assert.deepEqual({ ...retainedDoor, decision: null }, { ...originalDoor, decision: null });
  assert.deepEqual({ ...retainedDoor.decision, status: null }, { ...originalDoor.decision, status: null });
  assert.equal(appliedCube.decision.status, 'accepted'); assert.equal(appliedCube.decision.decisionId, 'accept-cube');
  assert.deepEqual({ ...appliedCube, decision: null }, { ...originalCube, decision: null });
  assert.equal(queue.get(door.id).state, 'completed'); assert.equal(queue.get(door.id).decisionId, 'accept-door');
  assert.equal(queue.get(cube.id).state, 'completed'); assert.equal(queue.get(cube.id).attempts, 1);
  const history = queue.history({ projectId: repository.projectId, before: null, limit: 3 });
  assert.deepEqual(history.entries.slice(0, 2).map(item => item.requestId), ['independent-cube', 'independent-door']);
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

test('final native floor support accepts only certified contact; positive gap, sub-tolerance penetration and open surface remain blocked', async t => {
  for (const condition of ['native-contact', 'positive-required-gap', 'sub-tolerance-penetration', 'open-floor']) {
    const source = new FixtureGeometrySource();
    source.replace(condition === 'sub-tolerance-penetration' ? [evidenceFloor({ top: 1e-10 })]
      : condition === 'open-floor' ? [evidenceFloor({ open: true })] : []);
    const repository = await RoomRepository.createProject({ projectId: globalThis.crypto.randomUUID(), name: condition, snapshot: multiStoreySnapshot() });
    const measurement = { ...cubeMeasurement,
      subject: { ...cubeMeasurement.subject, bounds: { min: [5.75, 4.55, 0], max: [6.25, 5.05, .5] } },
      against: { kind: 'object', ref: { kind: 'native', projectId: repository.projectId, target: { kind: 'main' },
        revisionId: repository.head('main'), entityId: 'level-ground-slab' } },
      clearanceMetres: condition === 'positive-required-gap' ? .5 : 0 };
    const authoring = cubeAuthoring.replace('position:[1,2]', 'position:[6,4.8]')
      .replace("placement:{kind:'single-room'}", "placement:{kind:'room',roomId:'level-ground-east'}");
    const script = `${authoring}
      const result = await geometry.measure(${JSON.stringify(measurement)});
      if(result.kind !== 'complete' || result.value.clearance !== 'satisfied-mesh') throw new Error('Requested support clearance is not verified');
      return {kind:'propose',review:${JSON.stringify({ ...geometryReview, summary: 'Place the cube on the ground slab.',
        rationale: 'Certified supporting-plane contact must not waive penetration or positive clearance.' })}};`;
    const worker: ModelWorker = { identity: { provider: 'test', model: 'certified-floor-support' }, async run(session) {
      const output = await session.executeTool('run_model_script', { language: 'typescript', source: script });
      assert.equal(output.ok, condition !== 'positive-required-gap', JSON.stringify(output));
    } };
    const queue = await ChangeRequests.open(':memory:', () => worker, { geometry: source }); t.after(() => queue.close());
    const ticket = await queue.submit(repository.serialize(), { ...request(repository, 'floor-support'), selectedObjectIds: [],
      instruction: 'Place a cube on the ground slab with no penetration.' });
    if (condition === 'native-contact') {
      await ready(queue, ticket.id);
      const accepted = await accept(queue, ticket.id); assert.equal(accepted.ticket.state, 'completed');
      const saved = await RoomRepository.restore(accepted.project);
      const evidence = readGeometryEvidence(saved.review('floor-support').geometryEvidence);
      const measured = evidence.measurements[0]?.result;
      assert.ok(measured?.kind === 'complete'); assert.equal(measured.value.relation, 'contact');
      assert.equal(measured.value.clearance, 'satisfied-mesh');
    } else {
      const deadline = Date.now() + 30000;
      while (queue.get(ticket.id).state === 'queued' || queue.get(ticket.id).state === 'working') {
        assert.ok(Date.now() < deadline, `Floor case ${condition} did not finish`); await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(queue.get(ticket.id).state, 'failed', condition);
      assert.equal(queue.get(ticket.id).result, null); assert.equal(queue.project(repository.projectId), repository.serialize());
    }
  }
});

test('a review-only continuation inherits authenticated geometry dependencies and cannot accept after a relevant source update', async t => {
  for (const relevant of [false, true]) {
    const source = new FixtureGeometrySource(); let currentWorker = agent();
    const queue = await ChangeRequests.open(':memory:', () => currentWorker, { geometry: source }); t.after(() => queue.close());
    const repository = await RoomRepository.create(); const first = await queue.submit(repository.serialize(), request(repository, 'geometry-parent'));
    await ready(queue, first.id);
    const original = queue.get(first.id); const originalProject = await RoomRepository.restore(original.result?.project);
    const originalEvidence = originalProject.review(original.request.proposalName).geometryEvidence;
    source.replace([evidenceWall({ version: 'v2', x: relevant ? .1 : 0 })]);
    currentWorker = agent(`return {kind:'propose',review:${JSON.stringify(geometryReview)}};`);
    await queue.appendMessage(first.id, { messageId: 'geometry-child', expectedSequence: original.conversation?.sequence,
      baseRevisionId: repository.head('main'), text: 'Keep the private cube and clarify its review, without new geometry calls.', sources: [], visual: null });
    if (relevant) {
      const deadline = Date.now() + 30000;
      while (queue.get(first.id).state === 'queued' || queue.get(first.id).state === 'working') {
        assert.ok(Date.now() < deadline, 'Inherited geometry validation did not finish'); await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(queue.get(first.id).state, 'failed'); assert.equal(queue.get(first.id).result, null);
    } else {
      await ready(queue, first.id); const child = queue.get(first.id);
      const proposed = await RoomRepository.restore(child.result?.project); const review = proposed.review(child.request.proposalName);
      const inherited = readGeometryEvidence(review.geometryEvidence);
      assert.equal(inherited.requestId, 'geometry-child'); assert.equal(inherited.measurements.length, 1);
      assert.equal(inherited.inheritedFrom?.[0]?.requestId, 'geometry-parent');
      assert.ok(inherited.receipts.some(receipt => receipt.reads.some(read => read.kind === 'query' && read.members.some(ref => ref.kind === 'ifc' && ref.revision === 'v1'))));
      assert.deepEqual(review.scriptExecutions?.flatMap(execution => execution.calls.filter(call => call.method.startsWith('geometry.'))), []);
      assert.notEqual(review.geometryEvidence, originalEvidence);
      source.replace([evidenceWall({ version: 'v3', x: .1 })]);
      await assert.rejects(accept(queue, first.id), /geometry|Geometry|projection|membership/);
    }
    assert.equal(queue.project(repository.projectId), repository.serialize()); assert.ok(queue.get(first.id).history.length);
  }
});

test('completed geometry acceptance is native baseline, while missing prior host origin blocks private-draft inheritance', async t => {
  const source = new FixtureGeometrySource(); let currentWorker = agent();
  const queue = await ChangeRequests.open(':memory:', () => currentWorker, { geometry: source }); t.after(() => queue.close());
  const repository = await RoomRepository.create(); const ticket = await queue.submit(repository.serialize(), request(repository, 'accepted-parent'));
  await ready(queue, ticket.id); const accepted = await accept(queue, ticket.id); const current = await RoomRepository.restore(accepted.project);
  source.replace([evidenceWall({ version: 'v2', x: .1 })]); currentWorker = agent(doorScript);
  const before = queue.get(ticket.id);
  await queue.appendMessage(ticket.id, { messageId: 'unrelated-native-child', expectedSequence: before.conversation?.sequence,
    baseRevisionId: current.head('main'), text: 'Widen the native door; retain the already accepted cube.', sources: [], visual: null });
  await ready(queue, ticket.id); const child = queue.get(ticket.id); const proposed = await RoomRepository.restore(child.result?.project);
  assert.equal(proposed.review(child.request.proposalName).geometryEvidence, undefined);
  assert.equal((await accept(queue, ticket.id, 'accept-native-child')).ticket.state, 'completed');

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'geometry-inherit-origin-')); const file = path.join(directory, 'queue.sqlite');
  const privateSource = new FixtureGeometrySource(); const privateQueue = await ChangeRequests.open(file, () => agent(), { geometry: privateSource });
  t.after(async () => { await privateQueue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const privateRepository = await RoomRepository.create(); const privateTicket = await privateQueue.submit(privateRepository.serialize(), request(privateRepository, 'private-parent'));
  await ready(privateQueue, privateTicket.id);
  const db = new DatabaseSync(file); try { db.prepare('DELETE FROM request_geometry_evidence WHERE request_id=?').run('private-parent'); } finally { db.close(); }
  const prior = privateQueue.get(privateTicket.id);
  await privateQueue.appendMessage(privateTicket.id, { messageId: 'untrusted-child', expectedSequence: prior.conversation?.sequence,
    baseRevisionId: privateRepository.head('main'), text: 'Keep the earlier private draft.', sources: [], visual: null });
  const deadline = Date.now() + 30000;
  while (privateQueue.get(privateTicket.id).state === 'queued' || privateQueue.get(privateTicket.id).state === 'working') {
    assert.ok(Date.now() < deadline, 'Missing inherited origin did not finish'); await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(privateQueue.get(privateTicket.id).state, 'failed'); assert.match(privateQueue.get(privateTicket.id).error ?? '', /Trusted geometry/);
  assert.equal(privateQueue.project(privateRepository.projectId), privateRepository.serialize());
});
