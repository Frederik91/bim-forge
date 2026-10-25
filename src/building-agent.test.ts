import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelScripts } from './model-script.ts';
import type { ModelScriptBinding } from './model-script.ts';
import { prepareModelProposal, validateModelProposalRequest } from './model-proposal.ts';
import type { ModelWorker } from './model-proposal.ts';
import { parseAuthoringScope } from './request-sources.ts';
import type { RequestSource } from './request-sources.ts';
import { RoomRepository, diffSnapshots, previewFurnishings } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { previewBuilding } from './building-layout.ts';
import type { BuildingLayout, FloorLayout } from './building-schema.ts';
import { ChangeRequests } from '../demo/change-requests.ts';

const review = {
  summary: 'Prepare a basement, ground floor and attic.',
  rationale: 'Three coincident floor plans remain distinct and connect through straight stairs.',
  constraints: 'Preserve accepted history; human acceptance is required.',
  uncertainty: 'Estimated elevations and gabled roof are concept geometry, without headroom certification.',
  intent: { interpretation: 'Model three separate levels in the same house.',
    assumptions: ['Use 3 metre floor spacing and a straight stair between adjacent floors.'],
    certainty: 80, basis: 'The test request names the levels and supplies explicit dimensions.' },
};
const propose = `return {kind:'propose',review:${JSON.stringify(review)}};`;

function houseLayout(): BuildingLayout {
  const boundsMm = { minX: 0, minY: 0, maxX: 8000, maxY: 8000 };
  return {
    levels: ['basement', 'ground', 'attic'].map((id, index): BuildingLayout['levels'][number] => ({
      level: { id, name: id, elevationMm: (index - 1) * 3000 },
      rooms: [
        { id: `${id}-west`, name: `${id} west`, boundsMm: { ...boundsMm, maxX: 4000 } },
        { id: `${id}-east`, name: `${id} east`, boundsMm: { ...boundsMm, minX: 4000 } },
      ],
      wallThicknessMm: 150, heightMm: 2700, slabThicknessMm: 200,
      openings: [
        { id: `${id}-inner`, name: 'Internal door', type: 'Door', roomId: `${id}-west`,
          side: 'east', offsetMm: 6500, widthMm: 900, heightMm: 2100 },
        ...(id === 'ground' ? [{ id: 'house-entry', name: 'Exterior entry', type: 'Door' as const,
          roomId: 'ground-west', side: 'south' as const, offsetMm: 2500, widthMm: 900, heightMm: 2100 }] : []),
      ],
      roof: id === 'attic' ? { boundsMm, thicknessMm: 200,
        profile: { kind: 'gable', eaveHeightMm: 3000, ridgeHeightMm: 4200, ridgeAxis: 'y' } } : null,
    })),
    stairs: [
      { id: 'basement-stair', name: 'Basement stair', fromLevelId: 'basement', toLevelId: 'ground',
        startMm: [1200, 1000], endMm: [1200, 5000], widthMm: 900, steps: 18 },
      { id: 'attic-stair', name: 'Attic stair', fromLevelId: 'ground', toLevelId: 'attic',
        startMm: [2600, 1000], endMm: [2600, 5000], widthMm: 900, steps: 18 },
    ],
  };
}

function floorLayout(id: string): FloorLayout {
  const floor = houseLayout().levels.find((item) => item.level.id === id);
  assert.ok(floor);
  return { level: { id, name: floor.level.name }, rooms: floor.rooms,
    wallThicknessMm: floor.wallThicknessMm, heightMm: floor.heightMm, openings: floor.openings };
}

function scriptsFor(t: TestContext): ModelScripts {
  const scripts = new ModelScripts();
  t.after(() => scripts.dispose());
  return scripts;
}

function execute(scripts: ModelScripts, base: ModelSnapshot, binding: ModelScriptBinding, source: string) {
  return scripts.run({ base, binding, source, language: 'typescript', remainingHostCalls: 64,
    signal: new AbortController().signal, onActivity: () => {} });
}

async function finished(queue: ChangeRequests, id: string): Promise<void> {
  for (let count = 0; count < 2000; count++) {
    if (['ready', 'needs-input', 'failed'].includes(queue.get(id).state)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The building agent request did not finish.');
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

test('building reconstruction scope parses explicitly and rejects inferred or unknown authority', () => {
  for (const scope of ['floor-plan-reconstruction', 'building-reconstruction']) assert.equal(parseAuthoringScope(scope), scope);
  for (const invalid of [undefined, null, '', 'selection', 'whole-building', { building: true }]) {
    assert.throws(() => parseAuthoringScope(invalid), /authoring scope/);
  }
});

test('the registered agent contract inspects legacy and V2 snapshots without adding or losing stored fields', async t => {
  const repository = await RoomRepository.create('Read contract preservation');
  const original = repository.serialize();
  const legacy = repository.view(repository.head('main')).snapshot;
  const scripts = scriptsFor(t);
  for (const base of [legacy, previewBuilding(legacy, houseLayout())]) {
    const result = await execute(scripts, base, {
      baseRevisionId: repository.head('main'), selectedObjectIds: base.entities.filter(item => item.type === 'Wall').slice(0, 1).map(item => item.id),
      visualIntent: { kind: 'selection' },
    }, "return {kind:'observe',observation:(await model.inspect()).model};");
    assert.equal(result.kind, 'observation', JSON.stringify(result));
    if (result.kind !== 'observation') continue;
    assert.deepEqual(result.observation, base, 'the read schema must expose actual fields without normalizing historical data');
  }
  assert.equal(repository.serialize(), original);
});

test('selected levels and attached references cannot grant the building capability', async t => {
  const repository = await RoomRepository.create('Building authority');
  const original = repository.serialize();
  const base = previewBuilding(repository.view(repository.head('main')).snapshot, houseLayout());
  const scripts = scriptsFor(t);
  const selectedObjectIds = base.entities.filter((item) => item.id === 'ground').map((item) => item.id);
  for (const scope of [undefined, 'floor-plan-reconstruction'] as const) {
    const result = await execute(scripts, base, {
      baseRevisionId: repository.head('main'), selectedObjectIds, visualIntent: { kind: 'selection' },
      ...(scope ? { authoringScope: scope } : {}),
    }, `await model.previewBuilding(${JSON.stringify(houseLayout())}); ${propose}`);
    assert.equal(result.kind, 'failed', 'a selected Level is context, not whole-building authority');
    assert.ok(result.evidence.calls.some((call) => call.method === 'model.previewBuilding' && call.disposition === 'denied'));
  }
  const source = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'attic.txt', mediaType: 'text/plain',
    byteLength: 20, sha256: 'a'.repeat(64) };
  await assert.rejects(prepareModelProposal(repository, {
    requestId: 'attached-authority', proposalName: 'attached-authority', baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-north'], instruction: 'Use the attached basement and attic plans.',
    visualIntent: { kind: 'selection' }, sources: [source],
  }, { identity: { provider: 'test', model: 'building-agent-contract' }, run: async session => {
    const result = await session.executeTool('run_model_script', { language: 'typescript',
      source: `await model.previewBuilding(${JSON.stringify(houseLayout())}); ${propose}` });
    assert.equal(result.ok, false);
  } } satisfies ModelWorker, () => {}, { scripts, sourceInput: { images: [], documents: [{ sourceId: source.id, text: 'Model the whole house.' }] } }), /lost execution authority/);
  assert.equal(repository.serialize(), original);
});

test('typed building scripts preserve ownership, isolate coincident rooms and save review scope without accepting', async t => {
  const repository = await RoomRepository.create('Typed building agent');
  const original = repository.serialize();
  const scripts = scriptsFor(t);
  const plant = { id: 'basement-plant', type: 'Furniture', name: 'Basement plant', kind: 'plant',
    position: [3.5, 3], width: .3, depth: .3, height: 1, rotationDeg: 0, supportId: null };
  const groundPlant = { ...plant, id: 'ground-plant', name: 'Ground plant' };
  const atticPlant = { ...plant, id: 'attic-plant', name: 'Attic plant' };
  const ground = floorLayout('ground');
  ground.rooms[0] = { ...ground.rooms[0], name: 'Reviewed ground room' };
  const result = await prepareModelProposal(repository, {
    requestId: 'agent-house', proposalName: 'agent-house', baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-north'], instruction: 'Model basement, ground and attic as separate levels with stairs and a gabled roof.',
    visualIntent: { kind: 'selection' }, authoringScope: 'building-reconstruction',
  }, { identity: { provider: 'test', model: 'building-agent-contract' }, run: async session => {
    assert.match(session.instructions, /PDF pages may map to separate levels/);
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const layout: BuildingLayout = ${JSON.stringify(houseLayout())};
      const built = await model.previewBuilding(layout);
      if (!('version' in built.model) || built.model.version !== 2) throw new Error('Missing V2 result.');
      if (built.model.entities.some(item => item.type === 'Wall' && !item.levelId)) throw new Error('Lost required ownership.');
      const floor: FloorLayout = ${JSON.stringify(ground)};
      await model.previewFloor(floor);
      await model.previewFurnishings(${JSON.stringify({ furnishings: [plant, groundPlant],
        levelAssignments: [{ entityId: plant.id, levelId: 'basement' }, { entityId: groundPlant.id, levelId: 'ground' }] })});
      await model.previewFurnishings(${JSON.stringify({ furnishings: [plant, groundPlant] })});
      try { await model.previewFurnishings(${JSON.stringify({ furnishings: [plant, groundPlant, atticPlant] })}); throw new Error('Unassigned item was allowed.'); }
      catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
      await model.previewRoomFurnishings(${JSON.stringify({ roomId: 'attic-west', furnishings: [atticPlant] })});
      const inspected = await model.inspect();
      if (inspected.placement.levels.length !== 3) throw new Error('Missing level inspection.');
      for (const id of ['basement','ground','attic']) {
        const room = inspected.placement.rooms.find(room => room.id === id + '-west');
        if (!room || room.levelId !== id || !room.entityIds.includes(id + '-plant')) throw new Error('Missing level-bound membership.');
        if (room.entityIds.filter(id => id.endsWith('-plant')).length !== 1) throw new Error('XY membership leaked between floors.');
        const item = inspected.placement.entities.find(item => item.entityId === id + '-plant');
        if (item?.levelId !== id) throw new Error('Lost explicit ownership.');
      }
      const guide = await docs.read('/guides/model.md');
      if (!JSON.stringify(guide).includes('Never flatten basement and attic')) throw new Error('Missing multi-floor guide.');
      ${propose}
    ` });
    assert.equal(output.ok, true, JSON.stringify(output)); assert.equal(output.done, true);
  } } satisfies ModelWorker, () => {}, { scripts });
  assert.equal(result.status, 'ready');
  assert.equal(repository.serialize(), original);
  assert.equal(result.repository.head('main'), repository.head('main'));
  const proposed = result.repository.view(result.repository.head('agent-house')).snapshot;
  assert.equal(proposed.version, 2);
  assert.equal(result.repository.review('agent-house').authoringScope, 'building-reconstruction');
  assert.ok(diffSnapshots(repository.view(repository.head('main')).snapshot, proposed).entities.added.some(item => item.type === 'Roof'));
  assert.equal((await RoomRepository.restore(result.repository.serialize())).serialize(), result.repository.serialize());
});

test('floor-only building edits bind one selected level and preserve other floors after rejected retargeting', async t => {
  const repository = await RoomRepository.create('Bound level');
  const base = previewBuilding(repository.view(repository.head('main')).snapshot, houseLayout());
  const scripts = scriptsFor(t);
  const ground = floorLayout('ground');
  ground.rooms[0] = { ...ground.rooms[0], name: 'Changed ground room' };
  const result = await execute(scripts, base, {
    baseRevisionId: repository.head('main'), selectedObjectIds: base.entities.filter(item => item.id === 'ground' || item.id === 'basement-west').map(item => item.id),
    visualIntent: { kind: 'selection' }, authoringScope: 'floor-plan-reconstruction',
  }, `
    const before = await model.inspect();
    if (before.placement.selectedLevelId !== 'ground') throw new Error('Missing bound level.');
    try { await model.previewFloor(${JSON.stringify(floorLayout('basement'))}); throw new Error('Retargeting was allowed.'); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
    if (JSON.stringify((await model.inspect()).model) !== JSON.stringify(before.model)) throw new Error('Failed retargeting changed the draft.');
    await model.previewFloor(${JSON.stringify(ground)});
    ${propose}
  `);
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind !== 'proposal') return;
  assert.deepEqual(diffSnapshots(base, result.snapshot).entities.modified.map(item => item.id), ['ground-west']);
  assert.deepEqual(result.snapshot.relationships, base.relationships);
});

test('cross-level furnishing transfers require explicit ownership assignments and preserve supported groups atomically', async t => {
  const repository = await RoomRepository.create('Explicit level transfer');
  const building = previewBuilding(repository.view(repository.head('main')).snapshot, houseLayout());
  const desk = { id: 'move-desk', type: 'Furniture', name: 'Desk to transfer', kind: 'desk',
    position: [6, 3], width: 1, depth: .6, height: .75, rotationDeg: 0, supportId: null };
  const monitor = { id: 'move-monitor', type: 'Furniture', name: 'Supported monitor', kind: 'monitor',
    position: [6, 3], width: .6, depth: .2, height: .45, rotationDeg: 0, supportId: desk.id };
  const plant = { id: 'kept-plant', type: 'Furniture', name: 'Retained ground plant', kind: 'plant',
    position: [7, 5], width: .3, depth: .3, height: 1, rotationDeg: 0, supportId: null };
  const furnishings = [desk, monitor, plant];
  const base = previewFurnishings(building, { furnishings, levelAssignments: [
    { entityId: desk.id, levelId: 'basement' }, { entityId: monitor.id, levelId: 'basement' }, { entityId: plant.id, levelId: 'ground' },
  ] });
  const original = JSON.stringify(base);
  const transferReview = { ...review, summary: 'Move the desk and supported monitor from basement to attic.',
    rationale: 'Explicit assignments transfer both identities together while retaining the ground-floor plant.',
    intent: { ...review.intent, interpretation: 'Move the supported furnishing group to the selected attic level.' } };
  const result = await execute(scriptsFor(t), base, {
    baseRevisionId: repository.head('main'), selectedObjectIds: base.entities.filter(item => item.id === 'attic').map(item => item.id),
    visualIntent: { kind: 'selection' },
  }, `
    await model.previewFurnishings(${JSON.stringify({ furnishings })});
    const before = await model.inspect();
    if (before.placement.selectedLevelId !== 'attic') throw new Error('Missing destination context.');
    if (before.placement.entities.find(item => item.entityId === 'move-desk')?.levelId !== 'basement') throw new Error('Selection silently transferred ownership.');
    try { await model.previewRoomFurnishings(${JSON.stringify({ roomId: 'attic-east', furnishings: [desk, monitor] })}); throw new Error('Room tool transferred floors.'); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
    try { await model.previewFurnishings(${JSON.stringify({ furnishings, levelAssignments: [{ entityId: desk.id, levelId: 'attic' }] })}); throw new Error('Cross-level support was allowed.'); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
    if (JSON.stringify((await model.inspect()).model) !== JSON.stringify(before.model)) throw new Error('Rejected transfer partially changed ownership.');
    await model.previewFurnishings(${JSON.stringify({ furnishings, levelAssignments: [
      { entityId: desk.id, levelId: 'attic' }, { entityId: monitor.id, levelId: 'attic' },
    ] })});
    const after = await model.inspect();
    const attic = after.placement.rooms.find(room => room.id === 'attic-east');
    const basement = after.placement.rooms.find(room => room.id === 'basement-east');
    if (!attic?.entityIds.includes('move-desk') || !attic.entityIds.includes('move-monitor')) throw new Error('Destination room lost the supported group.');
    if (basement?.entityIds.includes('move-desk') || basement?.entityIds.includes('move-monitor')) throw new Error('Source room kept stale ownership.');
    if (after.placement.entities.find(item => item.entityId === 'kept-plant')?.levelId !== 'ground') throw new Error('Unrelated ownership changed.');
    return {kind:'propose',review:${JSON.stringify(transferReview)}};
  `);
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind !== 'proposal') return;
  const delta = diffSnapshots(base, result.snapshot);
  assert.deepEqual(delta.entities.modified.map(item => item.id), ['move-desk', 'move-monitor']);
  assert.deepEqual(delta.entities.added, []); assert.deepEqual(delta.entities.removed, []);
  assert.deepEqual(result.snapshot.relationships, base.relationships);
  assert.equal(JSON.stringify(base), original);
});

test('queued building sources, scope and level references survive processing, review, explicit acceptance and restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bim-building-agent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = await RoomRepository.create('Queued building context');
  const result = await prepareModelProposal(repository, {
    requestId: 'queued-house', proposalName: 'queued-house', baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-north'], instruction: 'Create three connected levels.',
    visualIntent: { kind: 'selection' }, authoringScope: 'building-reconstruction',
  }, { identity: { provider: 'test', model: 'building-agent-contract' }, run: async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript',
      source: `await model.previewBuilding(${JSON.stringify(houseLayout())}); ${propose}` });
    assert.equal(output.ok, true, JSON.stringify(output));
  } } satisfies ModelWorker);
  const acceptedFixture = result.repository.accept('queued-house', { decisionId: 'accept-fixture-house', actor: 'Fixture reviewer' });
  const project = acceptedFixture.serialize();
  const database = path.join(directory, 'queue.sqlite');
  let queue = new ChangeRequests(database, () => null);
  t.after(() => queue.close());
  const sourceText = ['Basement plan: retain the existing basement level.', 'Attic plan: retain the existing gabled roof and stair.'];
  const sources: RequestSource[] = [];
  for (const [index, content] of sourceText.entries()) sources.push(await queue.addSource({
    projectId: repository.projectId, id: randomUUID(), name: index === 0 ? 'basement.txt' : 'attic.txt',
    mediaType: 'text/plain', bytes: Buffer.from(content), signal: new AbortController().signal,
  }));
  const input = { requestId: 'attic-context', proposalName: 'attic-context', sources,
    baseRevisionId: acceptedFixture.head('main'), selectedObjectIds: ['attic'],
    instruction: 'Reconstruct the same house from the basement and attic notes; name the attic Reviewed attic.', authoringScope: 'building-reconstruction',
    visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', levelId: 'attic', positionMm: [3500, 3000] } } };
  await queue.submit(project, input);
  assert.deepEqual(queue.get(input.requestId).request.visualIntent, input.visualIntent);
  await queue.close();
  queue = new ChangeRequests(database, () => null);
  const restored = queue.get(input.requestId);
  assert.deepEqual(restored.request.visualIntent, input.visualIntent);
  assert.equal(restored.request.authoringScope, 'building-reconstruction');
  assert.deepEqual(restored.request.sources, sources);
  assert.equal(restored.state, 'queued');
  assert.deepEqual(validateModelProposalRequest(acceptedFixture, restored.request).visualIntent, input.visualIntent);
  assert.equal(queue.project(repository.projectId), project);
  await queue.close();

  const layout = houseLayout(); const attic = layout.levels.find(level => level.level.id === 'attic'); assert.ok(attic);
  attic.level.name = 'Reviewed attic';
  const sourceReview = { ...review, summary: 'Reconstruct the same house with a reviewed attic name.',
    rationale: `Retain separate basement and attic levels from sources ${sources.map(source => source.id).join(', ')}.`,
    intent: { ...review.intent, interpretation: input.instruction } };
  const worker: ModelWorker = { identity: { provider: 'test', model: 'building-queue-contract' }, run: async session => {
    assert.ok(object(session.input) && object(session.input.request));
    assert.equal(session.input.request.authoringScope, 'building-reconstruction');
    assert.deepEqual(session.input.request.visualIntent, input.visualIntent);
    assert.deepEqual(session.input.request.sources, sources);
    assert.ok(Array.isArray(session.input.sourceDocuments));
    assert.equal(session.input.sourceDocuments.length, sources.length);
    for (const [index, source] of sources.entries()) {
      const document: unknown = session.input.sourceDocuments[index];
      assert.ok(object(document)); assert.equal(document.sourceId, source.id);
      assert.equal(typeof document.text, 'string');
      assert.ok(typeof document.text === 'string' && document.text.endsWith(sourceText[index] ?? ''), 'private source delivery keeps the source/page mapping prefix and original text');
    }
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const before = await model.inspect();
      if (before.placement.selectedLevelId !== 'attic') throw new Error('Queued level binding changed.');
      const layout: BuildingLayout = ${JSON.stringify(layout)};
      await model.previewBuilding(layout);
      return {kind:'propose',review:${JSON.stringify(sourceReview)}};
    ` });
    assert.equal(output.ok, true, JSON.stringify(output)); assert.equal(output.done, true);
  } };
  queue = new ChangeRequests(database, () => worker);
  await finished(queue, input.requestId);
  const ready = queue.get(input.requestId);
  assert.equal(ready.state, 'ready', ready.error ?? ''); assert.ok(ready.result);
  assert.equal(queue.project(repository.projectId), project, 'worker completion must leave acceptance to a human decision');
  const proposed = await RoomRepository.restore(ready.result.project);
  const reviewed = proposed.review(input.proposalName);
  assert.equal(reviewed.decision.status, 'pending');
  assert.equal(reviewed.authoringScope, 'building-reconstruction'); assert.deepEqual(reviewed.sources, sources);
  assert.equal(reviewed.baseRevisionId, acceptedFixture.head('main'));
  assert.equal(proposed.head('main'), acceptedFixture.head('main'));
  assert.equal(proposed.serialize(), ready.result.project);
  assert.deepEqual(proposed.view(proposed.root()).snapshot, repository.view(repository.root()).snapshot);
  const journal = queue.executions(input.requestId);
  assert.equal(journal.length, 1);
  assert.ok(journal[0]?.evidence.calls.some(call => call.method === 'model.previewBuilding' && call.disposition === 'completed'));
  assert.equal(journal[0]?.evidence.validation, 'passed');

  const tampered: unknown = JSON.parse(ready.result.project);
  assert.ok(object(tampered) && Array.isArray(tampered.reviews));
  const changed = tampered.reviews.find((value: unknown) => object(value) && value.proposalName === input.proposalName);
  assert.ok(object(changed)); changed.authoringScope = 'implicit-building';
  await assert.rejects(RoomRepository.restore(JSON.stringify(tampered)), /authoring scope/);

  await queue.close(); queue = new ChangeRequests(database, () => null);
  assert.equal(queue.get(input.requestId).state, 'ready');
  assert.deepEqual(queue.get(input.requestId).request.sources, sources);
  assert.deepEqual(queue.executions(input.requestId), journal);
  const decision = { action: 'accept', decisionId: 'accept-attic-context', expectedRequestId: input.requestId };
  const accepted = await queue.decide(input.requestId, decision);
  assert.equal(accepted.ticket.state, 'completed');
  const current = await RoomRepository.restore(accepted.project);
  assert.equal(current.head('main'), proposed.head(input.proposalName));
  assert.equal(current.review(input.proposalName).decision.status, 'accepted');
  assert.equal(current.review(input.proposalName).authoringScope, 'building-reconstruction');
  assert.deepEqual(current.review(input.proposalName).sources, sources);
  assert.equal(current.serialize(), accepted.project);
  assert.equal(current.view(current.head('main')).snapshot.version, 2);

  await queue.close(); queue = new ChangeRequests(database, () => null);
  assert.equal(queue.get(input.requestId).state, 'completed');
  assert.deepEqual(queue.get(input.requestId).request.visualIntent, input.visualIntent);
  assert.equal(queue.project(repository.projectId), accepted.project);
  assert.equal((await queue.decide(input.requestId, decision)).project, accepted.project, 'replayed acceptance must be idempotent');
  assert.deepEqual(queue.executions(input.requestId), journal);
  for (const [index, source] of sources.entries()) assert.deepEqual(queue.source(repository.projectId, source.id).bytes, Buffer.from(sourceText[index] ?? ''));
});
