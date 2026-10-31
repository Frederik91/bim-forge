import assert from 'node:assert/strict';
import test from 'node:test';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { previewHostedDoorWidth } from './hosted-opening.ts';
import { validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { freezeModelScope } from './model-scope.ts';
import { modelWorkingGraph } from './model-script.ts';

const input = { doorId: 'level-ground-door-inner', widthMetres: 1.1, anchor: 'centre' };
function centre(snapshot: ModelSnapshot, doorId = input.doorId) {
  const door = snapshot.entities.find(item => item.id === doorId); assert.ok(door?.type === 'Door');
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
