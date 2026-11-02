import assert from 'node:assert/strict';
import test from 'node:test';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { previewDoorToOpening, previewHostedDoorWidth } from './hosted-opening.ts';
import { validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { assertModelScopeWrites, createModelScopeIndex, freezeModelScope } from './model-scope.ts';
import { modelWorkingGraph } from './model-script.ts';
import { doorConnections } from './floor-plan.ts';
import { entityLevel } from './building-levels.ts';
import { nativeGeometryRecords } from './geometry-native.ts';
import { geometryWork } from './geometry-math.ts';
import { modelChanges } from './model-delta-view.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ModelScene, modelPoint } from '../demo/model-scene.ts';
import { createModelPlan } from '../demo/model-plan.ts';
import { spatialTokens } from '../demo/ui/design-tokens.ts';

const input = { doorId: 'level-ground-door-inner', widthMetres: 1.1, anchor: 'centre' };
function centre(snapshot: ModelSnapshot, doorId = input.doorId) {
  const door = snapshot.entities.find(item => item.id === doorId); assert.ok(door?.type === 'Door' || door?.type === 'Opening');
  const link = snapshot.relationships.find(item => item.source === doorId); assert.ok(link);
  const wall = snapshot.entities.find(item => item.id === link.target); assert.ok(wall?.type === 'Wall');
  const direction = [Math.sign(wall.end[0] - wall.start[0]), Math.sign(wall.end[1] - wall.start[1])];
  return [wall.start[0] + direction[0] * (link.offset + door.width / 2),
    wall.start[1] + direction[1] * (link.offset + door.width / 2)];
}
test('multi-room vertical, horizontal and reversed hosts retain independent physical centres and exact two-record deltas', () => {
  for (const doorId of ['level-ground-door-inner', 'door-entry', 'level-attic-door-inner']) for (const reversed of [false, true]) {
    const original = multiStoreySnapshot();
    const host = original.relationships.find(item => item.source === doorId); assert.ok(host);
    const base = validateSnapshot({ ...original, entities: original.entities.map(item => item.id === host.target && item.type === 'Wall' && reversed
      ? { ...item, start: item.end, end: item.start } : item) });
    const bytes = JSON.stringify(base);
    const result = previewHostedDoorWidth(base, { ...input, doorId });
    assert.deepEqual(centre(result.snapshot, doorId), centre(base, doorId));
    assert.deepEqual(result.impact.before.centreMetres, result.impact.after.centreMetres);
    assert.equal(result.impact.after.centreMetres[2], doorId.startsWith('level-attic') ? 3 : 0);
    assert.deepEqual(result.delta.entities.added, []); assert.deepEqual(result.delta.entities.removed, []);
    assert.deepEqual(result.delta.entities.modified.map(item => item.id), [doorId]);
    assert.deepEqual(result.delta.relationships.added, []); assert.deepEqual(result.delta.relationships.removed, []);
    assert.deepEqual(result.delta.relationships.modified.map(item => item.id), [host.id]);
    assert.deepEqual(result.snapshot.relationships.find(item => item.id === host.id), { ...host, offset: host.offset - .1 });
    const nextDoor = result.snapshot.entities.find(item => item.id === doorId);
    assert.deepEqual(nextDoor, { ...base.entities.find(item => item.id === doorId), width: 1.1 });
    for (const entity of base.entities.filter(item => item.id !== doorId)) assert.deepEqual(result.snapshot.entities.find(item => item.id === entity.id), entity);
    assert.deepEqual(validateSnapshot(result.snapshot), result.snapshot); assert.equal(JSON.stringify(base), bytes);
  }
});
test('exact finite metre schema and centre grid reject malformed, linked, unknown and unsupported targets atomically', () => {
  const base = multiStoreySnapshot(); const bytes = JSON.stringify(base);
  for (const value of [{ ...input, widthMetres: NaN }, { ...input, widthMetres: Infinity }, { ...input, widthMetres: 0 },
    { ...input, widthMetres: 100.001 }, { ...input, widthMetres: 1.1005 }, { ...input, widthMetres: 1.101 },
    { ...input, anchor: 'start' }, { ...input, extra: true }, { ...input, doorId: 'ifc:door' },
    { ...input, doorId: 'linked-door' }, { ...input, doorId: 'level-ground-wall-inner' }, { ...input, widthMetres: 7 }]) {
    assert.throws(() => previewHostedDoorWidth(base, value)); assert.equal(JSON.stringify(base), bytes);
  }
  const host = base.relationships.find(item => item.source === input.doorId); assert.ok(host);
  assert.throws(() => previewHostedDoorWidth({ ...base, relationships: base.relationships.map(item => item.id === host.id ? { ...item, offset: 3.0000000001 } : item) }, input), /cannot silently snap/);
  assert.throws(() => previewHostedDoorWidth({ ...base, relationships: base.relationships.filter(item => item.id !== host.id) }, input), /exactly one host/);
  assert.throws(() => previewHostedDoorWidth({ ...base, relationships: [...base.relationships, { ...host, id: 'extra-host' }] }, input), /duplicate hosting/);
  assert.throws(() => previewHostedDoorWidth({ units: 'm', entities: [
    { id: 'wall', type: 'Wall', name: 'Diagonal', start: [0, 0], end: [5, 5], thickness: .2, height: 3 },
    { id: 'door', type: 'Door', name: 'Door', width: .9, height: 2.1 }],
    relationships: [{ id: 'host', type: 'hosted-by', source: 'door', target: 'wall', offset: 2 }] }, { ...input, doorId: 'door' }), /axis-aligned/);
});
test('host endpoint, sibling overlap and newly enlarged clearance conflicts reject without partial changes', () => {
  const base = multiStoreySnapshot(); const bytes = JSON.stringify(base);
  for (const offset of [0, 5.1]) {
    const edge = validateSnapshot({ ...base, relationships: base.relationships.map(item => item.source === input.doorId ? { ...item, offset } : item) });
    assert.throws(() => previewHostedDoorWidth(edge, input), /fit inside/);
  }
  const sibling = validateSnapshot({ ...base, entities: [...base.entities, { id: 'sibling', type: 'Window', name: 'Sibling', width: .5, height: 1, sillHeight: 1 }],
    relationships: [...base.relationships, { id: 'host-sibling', type: 'hosted-by', source: 'sibling', target: 'level-ground-wall-inner', offset: 3.95 }] });
  assert.throws(() => previewHostedDoorWidth(sibling, input), /overlap/);
  const blocked = validateSnapshot({ ...base, entities: base.entities.map(item => item.id === 'level-ground-plant' ? { ...item, position: [2.8, 3.45] } : item) });
  assert.throws(() => previewHostedDoorWidth(blocked, input), /clearance/);
  assert.equal(JSON.stringify(base), bytes);
});
test('frozen dependency reads include host, siblings and clearance context without expanding authority', () => {
  const base = multiStoreySnapshot(); const scope = freezeModelScope({ graph: base, baseRevisionId: 'a'.repeat(64),
    query: { version: 1, allOf: [{ kind: 'ids', ids: [input.doorId] }], anyOf: [], excludeIds: [] } });
  const readable = modelWorkingGraph(base, scope);
  assert.equal(previewHostedDoorWidth(base, input, { readable }).impact.after.offsetMetres, 2.9);
  assert.throws(() => previewHostedDoorWidth(base, input, { readable: { ...readable, relationships: [] } }), /already be readable/);
  assert.throws(() => previewHostedDoorWidth(base, input, { readable: { ...readable, entities: readable.entities.filter(item => item.id !== 'level-ground-wall-inner') } }), /already be readable/);
});

test('Door to permanent 2 m Opening retains identity, host, height, centre, room access and source-bound deltas', () => {
  for (const doorId of ['door-entry', input.doorId]) {
    const base = multiStoreySnapshot(); const bytes = JSON.stringify(base);
    const result = previewDoorToOpening(base, { doorId, widthMetres: 2, anchor: 'centre' });
    const before = base.entities.find(item => item.id === doorId); assert.ok(before?.type === 'Door');
    const after = result.snapshot.entities.find(item => item.id === doorId); assert.ok(after?.type === 'Opening');
    assert.deepEqual(after, { ...before, type: 'Opening', width: 2 });
    assert.deepEqual(centre(result.snapshot, doorId), centre(base, doorId));
    assert.equal(result.impact.beforeKind, 'Door'); assert.equal(result.impact.afterKind, 'Opening');
    assert.equal(result.impact.after.widthMetres, 2); assert.deepEqual(result.impact.after.centreMetres, result.impact.before.centreMetres);
    assert.equal(entityLevel(result.snapshot, after)?.id, 'level-ground');
    assert.deepEqual(doorConnections(result.snapshot).find(link => link.door.id === doorId)?.roomIds,
      doorConnections(base).find(link => link.door.id === doorId)?.roomIds);
    assert.deepEqual(result.delta.entities.added, []); assert.deepEqual(result.delta.entities.removed, []);
    assert.deepEqual(result.delta.entities.modified.map(item => item.id), [doorId]);
    const host = base.relationships.find(link => link.source === doorId); assert.ok(host);
    assert.deepEqual(result.delta.relationships.modified.map(item => item.id), [host.id]);
    for (const entity of base.entities.filter(item => item.id !== doorId)) assert.deepEqual(result.snapshot.entities.find(item => item.id === entity.id), entity);
    const scope = freezeModelScope({ graph: base, baseRevisionId: 'a'.repeat(64), query: { version: 1, allOf: [{ kind: 'ids', ids: [doorId] }], anyOf: [], excludeIds: [] } });
    assert.doesNotThrow(() => assertModelScopeWrites({ before: base, after: result.snapshot, binding: scope }));
    assert.equal(createModelScopeIndex(result.snapshot).entities.find(item => item.id === doorId)?.type, 'Opening');
    assert.deepEqual(validateSnapshot(JSON.parse(JSON.stringify(result.snapshot))), result.snapshot);
    assert.ok(modelChanges(base, result.snapshot).some(change => change.id === host.target && change.reason === 'placement'));
    assert.equal(JSON.stringify(base), bytes);
  }
});

test('permanent openings enforce host, millimetre grid, sibling and access clearance without a fictitious leaf sweep', () => {
  const base = multiStoreySnapshot(); const bytes = JSON.stringify(base);
  for (const value of [{ doorId: 'ifc:door', widthMetres: 2, anchor: 'centre' }, { ...input, widthMetres: 2.0005 }, { ...input, widthMetres: 8 }, { ...input, extra: true }]) {
    assert.throws(() => previewDoorToOpening(base, value)); assert.equal(JSON.stringify(base), bytes);
  }
  const sibling = validateSnapshot({ ...base, entities: [...base.entities, { id: 'fixed-sibling', type: 'Opening', name: 'Existing doorless passage', width: .5, height: 2.1 }],
    relationships: [...base.relationships, { id: 'host-fixed-sibling', type: 'hosted-by', source: 'fixed-sibling', target: 'level-ground-wall-inner', offset: 4.35 }] });
  assert.throws(() => previewDoorToOpening(sibling, { ...input, widthMetres: 2 }), /overlap/);
  const blocked = validateSnapshot({ ...base, entities: base.entities.map(item => item.id === 'level-ground-plant' ? { ...item, position: [3.3, 4.4] } : item) });
  assert.throws(() => previewDoorToOpening(blocked, { ...input, widthMetres: 2 }), /clearance/);
  const converted = previewDoorToOpening(base, { ...input, widthMetres: 2 }).snapshot;
  assert.throws(() => validateSnapshot({ ...converted, relationships: converted.relationships.filter(link => link.source !== input.doorId) }), /exactly one host/);
  assert.throws(() => previewDoorToOpening(base, { ...input, widthMetres: 2 }, { readable: { ...base, relationships: [] } }), /already be readable/);
});

test('real Babylon rays and plan/geometry readers expose a 2 m empty wall void without a door leaf or swing', t => {
  const base = multiStoreySnapshot(); const result = previewDoorToOpening(base, { doorId: 'door-entry', widthMetres: 2, anchor: 'centre' });
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const viewer = new ModelScene(engine, 'off'); t.after(() => { viewer.dispose(); engine.dispose(); });
  viewer.setMode('basic'); viewer.setModel(base); viewer.setCutaway(false); viewer.scene.render();
  assert.ok(viewer.scene.meshes.some(mesh => mesh.name === 'door-entry-leaf'));
  viewer.setModel(result.snapshot); viewer.scene.render();
  assert.equal(viewer.scene.meshes.some(mesh => mesh.name === 'door-entry-leaf'), false);
  const [x,y] = result.impact.after.centreMetres;
  const wallOnly = (mesh: {name: string}) => mesh.name.startsWith(result.impact.hostWallId + '-solid-');
  const ray = (offset: number, height = 1) => new Ray(modelPoint(x + offset, y - .5, height), new Vector3(0,0,1), 1);
  for (const offset of [-.95, 0, .95]) assert.equal(viewer.scene.pickWithRay(ray(offset), wallOnly)?.hit, false, '2 m opening contains no wall infill');
  assert.equal(viewer.scene.pickWithRay(ray(1.05), wallOnly)?.hit, true, 'Wall remains outside the opening');
  assert.equal(viewer.scene.pickWithRay(ray(0, 2.3), wallOnly)?.hit, true, 'Wall remains above the retained opening height');
  const source = { projectId: '11111111-1111-4111-8111-111111111111', target: { kind: 'main' } satisfies { kind: 'main' }, revisionId: 'b'.repeat(64), snapshot: result.snapshot };
  const plan = createModelPlan({ source, comparison: null, selectedTargets: [{ kind: 'native', ...source, entityId: 'door-entry' }], levelId: 'level-ground', viewport: { width: 900, height: 650 }, tokens: spatialTokens });
  assert.equal(plan.dimensions.find(item => item.ref?.entityId === 'door-entry')?.metres, 2);
  const symbol = plan.primitives.find(item => item.kind === 'path' && item.hit?.ref.entityId === 'door-entry'); assert.ok(symbol?.kind === 'path');
  assert.equal(plan.primitives.filter(item => item.kind === 'path' && item.points.length === 25).length,
    doorConnections(result.snapshot).filter(link => link.door.type === 'Door' && entityLevel(result.snapshot, link.door)?.id === 'level-ground').length, 'Opening adds no door swing arc');
  const records = nativeGeometryRecords(source.projectId, source, geometryWork({ maxWork: 2_000_000, maxMilliseconds: 5000 }));
  const opening = records.find(record => record.description.ref.kind === 'native' && record.description.ref.entityId === 'door-entry');
  assert.equal(opening?.description.class, 'Opening'); assert.equal(opening?.description.role, 'context');
  assert.ok(opening?.shape); assert.equal(opening.shape.bounds.max[0] - opening.shape.bounds.min[0], 2);
});