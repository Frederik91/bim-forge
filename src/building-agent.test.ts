import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ModelScripts } from './model-script.ts';
import type { ModelScriptBinding } from './model-script.ts';
import { prepareModelProposal, validateModelProposalRequest } from './model-proposal.ts';
import type { ModelWorker } from './model-proposal.ts';
import { parseAuthoringScope } from './request-sources.ts';
import { RoomRepository, diffSnapshots } from './room-model.ts';
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

test('building reconstruction scope parses explicitly and rejects inferred or unknown authority', () => {
  for (const scope of ['floor-plan-reconstruction', 'building-reconstruction']) assert.equal(parseAuthoringScope(scope), scope);
  for (const invalid of [undefined, null, '', 'selection', 'whole-building', { building: true }]) {
    assert.throws(() => parseAuthoringScope(invalid), /authoring scope/);
  }
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

test('queued V2 floor references retain their level and reconstruction scope across restart', async t => {
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
  const project = result.repository.serialize();
  const database = path.join(directory, 'queue.sqlite');
  let queue = new ChangeRequests(database, () => null);
  t.after(() => queue.close());
  const input = { requestId: 'attic-context', proposalName: 'attic-context',
    baseRevisionId: result.repository.head('queued-house'), selectedObjectIds: ['attic'],
    instruction: 'Review the attic point on its own level.', authoringScope: 'building-reconstruction',
    visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', levelId: 'attic', positionMm: [3500, 3000] } } };
  await queue.submit(project, input);
  assert.deepEqual(queue.get(input.requestId).request.visualIntent, input.visualIntent);
  await queue.close();
  queue = new ChangeRequests(database, () => null);
  const restored = queue.get(input.requestId);
  assert.deepEqual(restored.request.visualIntent, input.visualIntent);
  assert.equal(restored.request.authoringScope, 'building-reconstruction');
  assert.equal(restored.state, 'queued');
  assert.deepEqual(validateModelProposalRequest(result.repository, restored.request).visualIntent, input.visualIntent);
  assert.equal(queue.project(repository.projectId), project);
});
