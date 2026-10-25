import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Static } from '@frederik91/scriptbox';
import { AssetFamilySchema, AssetInstanceSchema, AssetEditSchema, assetGeometry } from './asset-family.ts';
import { ModelScripts } from './model-script.ts';
import { prepareModelProposal } from './model-proposal.ts';
import type { ModelWorker, ModelWorkerSession } from './model-proposal.ts';
import { RoomRepository, diffSnapshots, previewAssets } from './room-model.ts';
import type { Entity } from './room-model.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { ChangeRequests } from '../demo/change-requests.ts';

type FamilyInput = Static<typeof AssetFamilySchema>;
type InstanceInput = Static<typeof AssetInstanceSchema>;
type EditInput = Static<typeof AssetEditSchema>;

// Test-authored recipe only. The production API has no person preset or category.
function personFamily(): FamilyInput {
  return { id: 'authored-person-v1', type: 'AssetFamily', name: 'Standing person proxy',
    description: 'Approximate primitive standing figure, without anatomical or product certification.', parts: [
      { id: 'left-shoe', kind: 'box', min: [.18, 0, 0], size: [.26, 1, .08], color: '#354152' },
      { id: 'right-shoe', kind: 'box', min: [.56, 0, 0], size: [.26, 1, .08], color: '#354152' },
      { id: 'left-leg', kind: 'cylinder', min: [.22, .3, .08], size: [.18, .4, .42], color: '#4d6982' },
      { id: 'right-leg', kind: 'cylinder', min: [.6, .3, .08], size: [.18, .4, .42], color: '#4d6982' },
      { id: 'torso', kind: 'box', min: [.15, .25, .5], size: [.7, .5, .28], color: '#587e98' },
      { id: 'left-arm', kind: 'cylinder', min: [0, .3, .48], size: [.15, .4, .3], color: '#587e98' },
      { id: 'right-arm', kind: 'cylinder', min: [.85, .3, .48], size: [.15, .4, .3], color: '#587e98' },
      { id: 'neck', kind: 'cylinder', min: [.4, .35, .78], size: [.2, .3, .04], color: '#c89c7e' },
      { id: 'head', kind: 'ellipsoid', min: [.25, .2, .82], size: [.5, .6, .18], color: '#c89c7e' },
    ] };
}
function person(id = 'person-1870', height = 1.87, x = 1.2, placement: InstanceInput['placement'] = { kind: 'single-room' }): InstanceInput {
  return { id, type: 'AssetInstance', name: `Standing person ${height} m`, familyId: 'authored-person-v1',
    position: [x, 2.8], rotationDeg: 0, size: { width: .55, depth: .35, height }, placement };
}
function personEdit(): EditInput { return { families: [personFamily()], instances: [person()], removeInstanceIds: [] }; }
function markerEdit(): EditInput {
  return { families: [{ id: 'authored-marker-v1', type: 'AssetFamily', name: 'Unrelated marker',
    description: 'Synthetic floor-standing marker proxy.', parts: [{ id: 'marker-body', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#c7a548' }] }],
    instances: [{ id: 'unrelated-marker', type: 'AssetInstance', name: 'Retained marker', familyId: 'authored-marker-v1',
      position: [4.8, 2.8], rotationDeg: 0, size: { width: .3, depth: .3, height: .8 }, placement: { kind: 'single-room' } }], removeInstanceIds: [] };
}
const review = { summary: 'Author standing person proxies from one reusable primitive recipe.',
  rationale: 'The authored recipe scales to the requested heights without changing unrelated model objects.',
  constraints: 'Retain geometry, existing assets and historical revisions; human acceptance is separate.',
  uncertainty: 'Conceptual proxy only, without anatomical fidelity or product certification.',
  intent: { interpretation: 'Add the requested standing figure and a second height from the same recipe.',
    assumptions: ['Use an approximate standing silhouette made from inert primitives.'], certainty: 85,
    basis: 'The request specifies the height and authorizes a conceptual proxy.' } };
const propose = `return {kind:'propose',review:${JSON.stringify(review)}};`;
function worker(run: (session: ModelWorkerSession) => Promise<void>): ModelWorker {
  return { identity: { provider: 'test', model: 'asset-authoring-contract' }, run };
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function request(repository: RoomRepository, id: string) {
  return { requestId: id, proposalName: id, baseRevisionId: repository.head('main'), selectedObjectIds: ['wall-north'],
    instruction: 'Author a recognizable standing-person proxy exactly 1.87 m tall, then reuse its family for a 1.65 m person. Preserve unrelated objects.',
    visualIntent: { kind: 'selection' } };
}
async function withMarker(): Promise<RoomRepository> {
  const original = await RoomRepository.create('Asset fixture source');
  return RoomRepository.createProject({ projectId: randomUUID(), name: 'Asset authoring with unrelated content',
    snapshot: previewAssets(original.view(original.head('main')).snapshot, markerEdit()) });
}

test('ordinary TypeScript authors a 1870 mm person and reuses its family at another height without replacing unrelated legacy objects', async () => {
  const repository = await withMarker(); const original = repository.serialize();
  const before = repository.view(repository.head('main')).snapshot;
  const result = await prepareModelProposal(repository, request(repository, 'authored-people'), worker(async session => {
    assert.match(session.instructions, /do not decline just because there is no catalog entry/);
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const first: AssetEdit = ${JSON.stringify(personEdit())};
      await model.previewAssets(first);
      const second: AssetInstance = ${JSON.stringify(person('person-1650', 1.65, 2.7))};
      await model.previewAssets({families:[],instances:[second],removeInstanceIds:[]});
      const view = await model.inspect();
      if (view.model.version !== undefined) throw new Error('Asset authoring upgraded a legacy shell.');
      const family = view.model.entities.find(item => item.type === 'AssetFamily' && item.id === 'authored-person-v1');
      if (!family || family.type !== 'AssetFamily' || family.parts.length < 5) throw new Error('Missing authored body parts.');
      const people = view.model.entities.filter(item => item.type === 'AssetInstance' && item.familyId === family.id);
      if (people.length !== 2) throw new Error('The second instance did not reuse the family.');
      const context = view.placement.assetFamilies.find(item => item.familyId === family.id);
      if (context?.instanceIds.length !== 2) throw new Error('Inspection lost shared-family membership.');
      const guide = await docs.read('/guides/assets.md');
      if (!JSON.stringify(guide).includes('all six')) throw new Error('Missing normalized geometry contract.');
      ${propose}
    ` });
    assert.equal(output.ok, true, JSON.stringify(output)); assert.equal(output.done, true);
  }));
  assert.equal(result.status, 'ready'); assert.equal(repository.serialize(), original);
  assert.equal(result.repository.head('main'), repository.head('main'));
  const after = result.repository.view(result.repository.head('authored-people')).snapshot;
  assert.equal(after.version, undefined);
  const delta = diffSnapshots(before, after);
  assert.deepEqual(delta.entities.added.map(item => item.id), ['authored-person-v1', 'person-1650', 'person-1870']);
  assert.deepEqual(delta.entities.modified, []); assert.deepEqual(delta.entities.removed, []);
  assert.deepEqual(after.relationships, before.relationships);
  for (const [id, height] of [['person-1870', 1.87], ['person-1650', 1.65]] satisfies [string, number][]) {
    const instance: Entity | undefined = after.entities.find(item => item.id === id); assert.ok(instance?.type === 'AssetInstance');
    assert.equal(assetGeometry(after, instance).bounds.maxZ, height);
    assert.equal(instance.size.height * 1000, Math.round(height * 1000));
  }
  const evidence = result.repository.review('authored-people').scriptExecutions;
  assert.equal(evidence?.[0]?.validation, 'passed');
  assert.equal(evidence?.[0]?.calls.filter(call => call.method === 'model.previewAssets').length, 2);
  const accepted = result.repository.accept('authored-people', { decisionId: 'human-accept-people', actor: 'Fixture reviewer' });
  const restored = await RoomRepository.restore(accepted.serialize());
  assert.equal(restored.serialize(), accepted.serialize());
  assert.deepEqual(restored.view(repository.root()).snapshot, before);
  assert.equal(restored.head('main'), restored.head('authored-people'));
});

test('room placement derives V2 levels for coincident XY instances and keeps family definitions nonspatial', async t => {
  const base = multiStoreySnapshot(); const original = JSON.stringify(base);
  const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  const edit: EditInput = { families: [personFamily()], instances: [
    person('attic-person', 1.87, 2.2, { kind: 'room', roomId: 'level-attic-west' }),
    person('basement-person', 1.65, 2.2, { kind: 'room', roomId: 'level-basement-west' }),
  ], removeInstanceIds: [] };
  const result = await scripts.run({ base, binding: { baseRevisionId: 'a'.repeat(64),
    selectedObjectIds: base.entities.filter(item => item.id === 'level-attic-west').map(item => item.id), visualIntent: { kind: 'selection' } },
  language: 'typescript', signal: new AbortController().signal, remainingHostCalls: 64, onActivity: () => {}, source: `
    const edit: AssetEdit = ${JSON.stringify(edit)};
    await model.previewAssets(edit);
    const view = await model.inspect();
    for (const [id,level,room,z] of [['attic-person','level-attic','level-attic-west',3],['basement-person','level-basement','level-basement-west',-3]] satisfies [string,string,string,number][]) {
      const instance = view.placement.assetInstances.find(item => item.entityId === id);
      if (instance?.levelId !== level || instance.roomId !== room || instance.elevation !== z) throw new Error('Wrong resolved asset context.');
      const membership = view.placement.rooms.find(item => item.id === room)?.entityIds;
      if (!membership?.includes(id) || membership.filter(item => item.endsWith('-person')).length !== 1) throw new Error('Cross-level XY membership leak.');
    }
    if (view.placement.entities.find(item => item.entityId === 'authored-person-v1')?.levelId !== null) throw new Error('A family definition acquired level ownership.');
    ${propose}
  ` });
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind !== 'proposal') return;
  assert.equal(result.snapshot.version, 2);
  assert.deepEqual(diffSnapshots(base, result.snapshot).entities.modified, []);
  assert.deepEqual(result.snapshot.relationships, base.relationships);
  assert.equal(JSON.stringify(base), original);
});

test('a failed asset script discards every staged definition and instance before the next execution', async () => {
  const repository = await withMarker(); const original = repository.serialize();
  const before = repository.view(repository.head('main')).snapshot;
  const result = await prepareModelProposal(repository, request(repository, 'asset-rollback'), worker(async session => {
    const failed = await session.executeTool('run_model_script', { language: 'typescript', source:
      `await model.previewAssets(${JSON.stringify(personEdit())}); throw new Error('Discard this authored family.');` });
    assert.equal(failed.ok, false);
    const observed = await session.executeTool('run_model_script', { language: 'typescript', source:
      "return {kind:'observe',observation:(await model.inspect()).model};" });
    assert.equal(observed.ok, true, JSON.stringify(observed)); assert.deepEqual(observed.observation, before);
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source:
      `await model.previewAssets(${JSON.stringify(personEdit())}); ${propose}` })).ok, true);
  }));
  assert.equal(result.status, 'ready'); assert.equal(repository.serialize(), original);
  assert.deepEqual(result.repository.review('asset-rollback').scriptExecutions?.map(execution => execution.disposition), ['discarded', 'observation', 'proposal']);
});

test('family immutability and all-six-extrema validation reject atomic edits while leaving unrelated assets available', async () => {
  const repository = await withMarker();
  const changed = markerEdit(); changed.families[0].description = 'A different definition under the same identity.';
  const underfilled = personEdit(); underfilled.families[0].parts = [{ id: 'underfilled', kind: 'box', min: [0, 0, 0], size: [1, 1, .9], color: '#546778' }];
  const result = await prepareModelProposal(repository, request(repository, 'asset-validation'), worker(async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const before = await model.inspect();
      for (const edit of [${JSON.stringify(changed)},${JSON.stringify(underfilled)}] satisfies AssetEdit[]) {
        try { await model.previewAssets(edit); throw new Error('Invalid family edit was accepted.'); }
        catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
        if (JSON.stringify((await model.inspect()).model) !== JSON.stringify(before.model)) throw new Error('Invalid asset edit partially changed the draft.');
      }
      await model.previewAssets(${JSON.stringify(personEdit())});
      ${propose}
    ` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }));
  assert.equal(result.status, 'ready');
});

test('ordinary asset requests keep typed execution evidence through queued processing, human acceptance and restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bim-asset-agent-'));
  const repository = await withMarker(); const original = repository.serialize();
  const database = path.join(directory, 'assets.sqlite');
  let queue = new ChangeRequests(database, () => null);
  t.after(async () => { await queue.close(); await rm(directory, { recursive: true, force: true }); });
  const input = request(repository, 'queued-asset');
  await queue.submit(original, input); await queue.close();
  queue = new ChangeRequests(database, () => worker(async session => {
    assert.ok(object(session.input) && object(session.input.request));
    assert.equal(Object.hasOwn(session.input.request, 'authoringScope'), false);
    const output = await session.executeTool('run_model_script', { language: 'typescript', source:
      `const edit: AssetEdit = ${JSON.stringify(personEdit())}; await model.previewAssets(edit);
      await model.previewAssets(${JSON.stringify({ families: [], instances: [person('person-1650', 1.65, 2.7)], removeInstanceIds: [] })}); ${propose}` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }));
  for (let count = 0; count < 2000 && ['queued', 'working'].includes(queue.get(input.requestId).state); count++) await new Promise<void>(resolve => setTimeout(resolve, 10));
  const ready = queue.get(input.requestId); assert.equal(ready.state, 'ready', ready.error ?? ''); assert.ok(ready.result);
  assert.equal(queue.project(repository.projectId), original);
  const proposed = await RoomRepository.restore(ready.result.project);
  assert.equal(proposed.review(input.proposalName).decision.status, 'pending');
  assert.ok(queue.executions(input.requestId)[0]?.evidence.calls.some(call => call.method === 'model.previewAssets' && call.disposition === 'completed'));
  await queue.close(); queue = new ChangeRequests(database, () => null);
  const accepted = await queue.decide(input.requestId, { action: 'accept', decisionId: 'human-accept-assets', expectedRequestId: input.requestId });
  assert.equal(accepted.ticket.state, 'completed');
  const restored = await RoomRepository.restore(accepted.project);
  assert.equal(restored.head('main'), proposed.head(input.proposalName)); assert.equal(restored.serialize(), accepted.project);
  await queue.close(); queue = new ChangeRequests(database, () => null);
  assert.equal(queue.project(repository.projectId), accepted.project); assert.equal(queue.get(input.requestId).state, 'completed');
});
