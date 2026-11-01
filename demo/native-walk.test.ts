import assert from 'node:assert/strict';
import test from 'node:test';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { validateSnapshot } from '../src/room-model.ts';
import type { ModelSnapshot, Point } from '../src/room-model.ts';
import { viewerBuilding } from './building-viewer-fixture.ts';
import { compileNativeWalk } from './native-walk.ts';
import type { NativeWalk, WalkPlacement, WalkResult, XY } from './native-walk.ts';

function enter(world: NativeWalk, levelId: string, point: XY): WalkPlacement {
  const result = world.enter({ levelId, point }); assert.ok(result, `entry ${levelId}: ${point}`); return result;
}
function travel(world: NativeWalk, start: WalkPlacement, delta: XY, frames: number): WalkResult[] {
  const results: WalkResult[] = []; let current = start;
  for (let frame = 0; frame < frames; frame++) {
    const next = world.advance(current.state, delta, .05); results.push(next); current = next;
    if (next.kind === 'blocked') break;
  }
  return results;
}
function last(results: WalkResult[]): WalkResult { const result = results.at(-1); assert.ok(result); return result; }
function reach(world: NativeWalk, start: WalkPlacement, target: XY): WalkResult[] {
  const results: WalkResult[] = []; let current = start;
  for (let frame = 0; frame < 100 && Math.hypot(current.pose.eye[0] - target[0], current.pose.eye[1] - target[1]) > 1e-7; frame++) {
    const next = world.advance(current.state, [target[0] - current.pose.eye[0], target[1] - current.pose.eye[1]], .05);
    results.push(next); current = next; if (next.kind === 'blocked') break;
  }
  return results;
}
function checked(input: unknown): ModelSnapshot { return validateSnapshot(input); }

test('slab support is the solid union, with real hole margins and no partition seams', () => {
  const world = compileNativeWalk(multiStoreySnapshot(), 'r1');
  for (const x of [.75, 1, 1.25, 2.75, 3, 3.25]) assert.equal(enter(world, 'level-ground', [x, 3]).pose.eye[2], 1.6);
  assert.equal(world.enter({ levelId: 'level-ground', point: [2, 1.5] }), null);
  assert.equal(world.enter({ levelId: 'level-ground', point: [2, 2.1] }), null);
  assert.ok(world.enter({ levelId: 'level-ground', point: [2, 2.13] }));
  assert.equal(world.enter({ levelId: null, point: [2, 3] }), null);
  assert.equal(world.enter({ levelId: 'missing', point: [2, 3] }), null);
  assert.equal(world.enter({ levelId: 'level-ground', point: [.1, 3] }), null);
});

test('valid .8 and .9 hosted Door voids pass in both host directions with body margins', () => {
  const base = multiStoreySnapshot();
  for (const width of [.8, .9]) for (const reverse of [false, true]) {
    const snapshot = checked({ ...base,
      entities: base.entities.map(entity => entity.id === 'level-ground-door-inner' && entity.type === 'Door' ? { ...entity, width }
        : entity.id === 'level-ground-wall-inner' && entity.type === 'Wall' && reverse ? { ...entity, start: entity.end, end: entity.start } : entity),
      relationships: base.relationships.map(link => link.source === 'level-ground-door-inner' && reverse ? { ...link, offset: 6 - 3 - width } : link),
    });
    const world = compileNativeWalk(snapshot, 'door'); const y = 3 + width / 2;
    const result = last(travel(world, enter(world, 'level-ground', [3.5, y]), [.1, 0], 10));
    assert.equal(result.kind, 'moved'); assert.ok(result.pose.eye[0] > 4.49);
    const back = last(travel(world, result, [-.1, 0], 10)); assert.equal(back.kind, 'moved'); assert.ok(back.pose.eye[0] < 3.51);
    const jamb = last(travel(world, enter(world, 'level-ground', [3.5, 3.1]), [.1, 0], 10));
    assert.equal(jamb.kind, 'blocked'); assert.ok(jamb.pose.eye[0] < 3.79);
  }
});

test('low doors and sill-zero windows remain body barriers despite authored/rendered opening voids', () => {
  const base = multiStoreySnapshot();
  const low = checked({ ...base, entities: base.entities.map(entity => entity.id === 'level-ground-door-inner' ? { ...entity, height: 1.7 } : entity) });
  const world = compileNativeWalk(low, 'low');
  assert.equal(last(travel(world, enter(world, 'level-ground', [3.5, 3.45]), [.1, 0], 10)).kind, 'blocked');
  const window = checked({ ...base, entities: [...base.entities, { id: 'ground-window', type: 'Window', name: 'Ground window', width: .9, height: 2, sillHeight: 0 }],
    relationships: [...base.relationships, { id: 'window-host', type: 'hosted-by', source: 'ground-window', target: 'level-ground-wall-inner', offset: 4.5 }] });
  const other = compileNativeWalk(window, 'window');
  assert.equal(last(travel(other, enter(other, 'level-ground', [3.5, 4.95]), [.1, 0], 10)).kind, 'blocked');
});

test('actual .2 and .25 risers traverse both ways with continuous eye and atomic full-body landing arrival', () => {
  for (const source of [multiStoreySnapshot(), viewerBuilding()]) {
    const fixture = source.entities.find(entity => entity.type === 'Stair'); assert.ok(fixture?.type === 'Stair');
    const world = compileNativeWalk(source, 'stairs');
    const startX = Math.max(.275, fixture.start[0] - .5); const start = enter(world, fixture.fromLevelId, [startX, fixture.start[1]]);
    const results = reach(world, start, [fixture.end[0] + .225, fixture.end[1]]);
    assert.ok(results.length > 20); assert.ok(results.every(result => result.kind === 'moved'));
    let previous = start.pose;
    for (const result of results) {
      assert.ok(Math.abs(result.pose.eye[2] - previous.eye[2]) < .251);
      if (result.pose.support.kind === 'stair') assert.equal(result.pose.levelId, fixture.fromLevelId);
      if (result.pose.levelId === fixture.toLevelId) assert.ok(result.pose.eye[0] > fixture.end[0] + .22);
      previous = result.pose;
    }
    const top = last(results); assert.equal(top.pose.levelId, fixture.toLevelId);
    const down = last(reach(world, top, [startX, fixture.start[1]])); assert.equal(down.kind, 'moved'); assert.equal(down.pose.levelId, fixture.fromLevelId);
    assert.ok(Math.abs(down.pose.eye[0] - startX) < 1e-7);
  }
});

test('stair basis supports all four signed axes without inventing ramp support or side entry', () => {
  const base = multiStoreySnapshot();
  const routes: { start: Point; end: Point; entry: XY; delta: XY }[] = [
    { start: [1, 1.5], end: [3, 1.5], entry: [.5, 1.5], delta: [.1, 0] },
    { start: [3, 1.5], end: [1, 1.5], entry: [3.5, 1.5], delta: [-.1, 0] },
    { start: [2, 1], end: [2, 3], entry: [2, .5], delta: [0, .1] },
    { start: [2, 3], end: [2, 1], entry: [2, 3.5], delta: [0, -.1] },
  ];
  for (const route of routes) {
    const snapshot = checked({ ...base, entities: base.entities.map(entity => entity.id === 'stair-basement-ground' ? { ...entity, start: route.start, end: route.end } : entity) });
    const world = compileNativeWalk(snapshot, 'axes');
    const up = last(travel(world, enter(world, 'level-basement', route.entry), route.delta, 30));
    assert.equal(up.kind, 'moved'); assert.equal(up.pose.levelId, 'level-ground');
    const down = last(travel(world, up, [-route.delta[0], -route.delta[1]], 30));
    assert.equal(down.kind, 'moved'); assert.equal(down.pose.levelId, 'level-basement');
  }
  const world = compileNativeWalk(base, 'side');
  const side = last(travel(world, enter(world, 'level-basement', [2.5, 2.4]), [0, -.1], 10));
  assert.equal(side.kind, 'blocked'); assert.equal(side.pose.support.kind, 'floor');
});

test('mid-flight bookmark round trips retain lagging eye and last landing, and reversal returns to the same floor', () => {
  const snapshot = multiStoreySnapshot(); const world = compileNativeWalk(snapshot, 'saved');
  const mid = last(travel(world, enter(world, 'level-basement', [.5, 1.5]), [.1, 0], 12));
  assert.equal(mid.kind, 'moved'); assert.equal(mid.pose.support.kind, 'stair');
  const bookmark: unknown = JSON.parse(JSON.stringify(world.bookmark(mid.state)));
  const restored = world.restore(bookmark); assert.ok(restored); assert.deepEqual(restored.pose, mid.pose);
  const recompiled = compileNativeWalk(snapshot, 'saved'); assert.deepEqual(recompiled.restore(bookmark)?.pose, mid.pose);
  assert.equal(compileNativeWalk(snapshot, 'other-source').restore(bookmark), null);
  const changed = checked({ ...snapshot, entities: snapshot.entities.map(entity => entity.id === 'stair-basement-ground' ? { ...entity, steps: 16 } : entity) });
  assert.equal(compileNativeWalk(changed, 'saved').restore(bookmark), null);
  assert.equal(world.restore({ ...world.bookmark(mid.state), eye: 99 }), null);
  assert.equal(world.restore({ ...world.bookmark(mid.state), anchor: { kind: 'stair', stairId: 'missing', point: [2, 1.5] } }), null);
  assert.equal(world.restore({ ...world.bookmark(mid.state), levelId: 'level-ground', anchor: { kind: 'floor', levelId: 'level-ground', point: [2, 1.5] } }), null);
  assert.equal(world.enter({ levelId: 'level-basement', point: [1.7, 1.5] }), null);
  const settled = world.advance(restored.state, [0, 0], .05);
  assert.notEqual(settled.pose.eye[2], restored.pose.eye[2]); assert.equal(settled.pose.eye[0], restored.pose.eye[0]);
  const down = last(travel(world, settled, [-.1, 0], 12)); assert.equal(down.kind, 'moved'); assert.equal(down.pose.levelId, 'level-basement');
  assert.throws(() => recompiled.advance(mid.state, [.1, 0], .05), /different native world/);
});

test('valid stacked adjacent flights block real headroom instead of teleporting to a coincident floor', () => {
  const base = multiStoreySnapshot();
  const snapshot = checked({ ...base, entities: base.entities.map(entity => entity.id === 'stair-ground-attic' ? { ...entity, start: [1, 1.5], end: [3, 1.5] } : entity) });
  const world = compileNativeWalk(snapshot, 'stacked');
  const result = last(travel(world, enter(world, 'level-basement', [.5, 1.5]), [.1, 0], 30));
  assert.equal(result.kind, 'blocked'); assert.equal(result.pose.levelId, 'level-basement');
  if (result.kind === 'blocked') assert.equal(result.reason, 'headroom');
});

test('conservative obstacles use real world height, including elevated equipment and upper slabs', () => {
  const base = multiStoreySnapshot();
  const withEquipment = (elevation: number): ModelSnapshot => checked({ ...base, entities: [...base.entities,
    { id: 'small-obstacle', type: 'Equipment', name: 'Small obstacle', category: 'mechanical', levelId: 'level-ground',
      position: [2, 3], elevation, width: .01, depth: .6, height: .1 }] });
  const low = compileNativeWalk(withEquipment(0), 'low-obstacle');
  assert.equal(last(travel(low, enter(low, 'level-ground', [1.5, 3]), [.1, 0], 10)).kind, 'blocked');
  const high = compileNativeWalk(withEquipment(2), 'high-obstacle');
  assert.equal(last(travel(high, enter(high, 'level-ground', [1.5, 3]), [.1, 0], 10)).kind, 'moved');
  const compressed = checked({ ...base, entities: base.entities.map(entity => entity.id === 'level-basement' ? { ...entity, elevation: -1.8 }
    : entity.type === 'Wall' && entity.levelId === 'level-basement' ? { ...entity, height: 1.6 }
      : entity.id === 'level-basement-door-inner' ? { ...entity, height: 1.5 }
        : entity.id === 'stair-basement-ground' ? { ...entity, steps: 9 } : entity) });
  const ceiling = compileNativeWalk(compressed, 'upper-slab');
  assert.equal(ceiling.enter({ levelId: 'level-basement', point: [2, 3] }), null);
});

test('frame caps and swept obstacles prevent tunneling and world geometry stays immutable', () => {
  const base = multiStoreySnapshot(); const bytes = JSON.stringify(base); const world = compileNativeWalk(base, 'cap');
  const initial = enter(world, 'level-ground', [2, 3]);
  const capped = world.advance(initial.state, [100, 0], 100);
  assert.equal(capped.kind, 'moved'); assert.ok(Math.abs(capped.pose.eye[0] - 2.1) < 1e-7);
  assert.equal(world.advance(capped.state, [Number.NaN, 0], .05).kind, 'blocked');
  const near = enter(world, 'level-ground', [3.65, 2.9]);
  const blocked = world.advance(near.state, [100, 0], 100);
  assert.equal(blocked.kind, 'blocked'); assert.ok(blocked.pose.eye[0] < 3.71);
  assert.equal(JSON.stringify(base), bytes);
});

test('settled eye follows physical tread support rather than a sloped ramp', () => {
  const world = compileNativeWalk(multiStoreySnapshot(), 'treads');
  let mid: WalkPlacement = last(travel(world, enter(world, 'level-basement', [.5, 1.5]), [.1, 0], 10));
  for (let frame = 0; frame < 30; frame++) mid = world.advance(mid.state, [0, 0], .05);
  assert.equal(mid.pose.support.kind, 'stair'); assert.ok(Math.abs(mid.pose.eye[0] - 1.5) < 1e-7);
  // The body footprint meets tread 6: -3 + 6*.2 + 1.6 = -.2, not the center ramp's -.65.
  assert.ok(Math.abs(mid.pose.eye[2] + .2) < 1e-6);
});

test('asset and furniture bounds are local obstacles and pitched roof clearance covers the whole body', () => {
  const base = multiStoreySnapshot();
  const snapshot = checked({ ...base, entities: [...base.entities,
    { id: 'walk-box-family', type: 'AssetFamily', name: 'Box', description: 'Closed box fixture',
      parts: [{ id: 'box', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#999999' }] },
    { id: 'walk-box-instance', type: 'AssetInstance', name: 'Box obstacle', familyId: 'walk-box-family', position: [2, 3], rotationDeg: 90,
      size: { width: .4, depth: .6, height: 1 }, placement: { kind: 'room', roomId: 'level-ground-west' } },
  ] });
  const world = compileNativeWalk(snapshot, 'asset');
  assert.equal(last(travel(world, enter(world, 'level-ground', [1.4, 3]), [.1, 0], 10)).kind, 'blocked');
  assert.ok(world.enter({ levelId: 'level-ground', point: [2, 4] }));
  assert.ok(world.enter({ levelId: 'level-attic', point: [2, 3] }));
  const furniture = compileNativeWalk(viewerBuilding(), 'furniture');
  assert.equal(last(travel(furniture, enter(furniture, 'ground', [3.5, 2]), [.1, 0], 10)).kind, 'blocked');
  const pitched = checked({ ...base, entities: base.entities.map(entity => entity.type === 'Roof'
    ? { ...entity, profile: { kind: 'gable', eaveHeight: 1.8, ridgeHeight: 4.2, ridgeAxis: 'x' } } : entity) });
  const roof = compileNativeWalk(pitched, 'roof');
  assert.equal(roof.enter({ levelId: 'level-attic', point: [2, .4] }), null);
  assert.ok(roof.enter({ levelId: 'level-attic', point: [2, .5] }));
});

test('a graph-valid stair with no full-body upper landing blocks without changing landing level', () => {
  const base = multiStoreySnapshot();
  const snapshot = checked({ ...base, entities: base.entities.map(entity => entity.id === 'stair-basement-ground'
    ? { ...entity, end: [3.7, 1.5] } : entity) });
  const world = compileNativeWalk(snapshot, 'short-landing');
  const result = last(travel(world, enter(world, 'level-basement', [.5, 1.5]), [.1, 0], 40));
  assert.equal(result.kind, 'blocked'); assert.equal(result.pose.levelId, 'level-basement');
  const steep = checked({ ...base, entities: base.entities.map(entity => entity.id === 'stair-basement-ground' ? { ...entity, steps: 10 } : entity) });
  const unsupported = compileNativeWalk(steep, 'unsupported-riser');
  assert.equal(last(travel(unsupported, enter(unsupported, 'level-basement', [.5, 1.5]), [.1, 0], 10)).kind, 'blocked');
});

test('a grazing sweep cannot cross an obstacle when both endpoint positions are clear', () => {
  const base = multiStoreySnapshot();
  const snapshot = checked({ ...base, entities: [...base.entities, { id: 'tiny-obstacle', type: 'Equipment', name: 'Tiny obstacle', category: 'mechanical',
    levelId: 'level-ground', position: [2, 3], elevation: 0, width: .001, depth: .001, height: .1 }] });
  const world = compileNativeWalk(snapshot, 'grazing');
  const start = enter(world, 'level-ground', [1.95, 2.785]);
  assert.ok(world.enter({ levelId: 'level-ground', point: [2.05, 2.785] }));
  const result = world.advance(start.state, [.1, 0], .05);
  assert.equal(result.kind, 'blocked'); assert.ok(result.pose.eye[0] < 2.05);
});
