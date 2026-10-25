import assert from 'node:assert/strict';
import test from 'node:test';
import { assetGeometry, assetFootprint, parseAssetFamily, parseAssetInstance, parseAssetEdit } from './asset-family.ts';
import type { AssetPart } from './asset-family.ts';
import { personFamily, personInstance } from './asset-fixture.ts';
import { identifier } from './room-model.ts';
import type { ModelGraph } from './room-model.ts';

test('every primitive renders all analytic extrema after sizing and each quarter turn', () => {
  for (const kind of ['box', 'ellipsoid', 'cylinder']) {
    const family = parseAssetFamily({ id: 'primitive', type: 'AssetFamily', name: 'Primitive proxy', description: 'Concept proxy.',
      parts: [{ id: 'body', kind, min: [0, 0, 0], size: [1, 1, 1], color: '#6c8790' }] });
    const graph: ModelGraph = { units: 'm', entities: [family], relationships: [] };
    for (const rotationDeg of [0, 90, 180, 270]) {
      const instance = parseAssetInstance({ ...personInstance(), familyId: family.id, position: [2, 3], rotationDeg });
      const geometry = assetGeometry(graph, instance);
      const points = geometry.faces.flatMap((face) => face.points);
      assert.ok(points.length > 0 && points.length <= 16 * 72 * 4);
      assert.deepEqual({ minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
        minY: Math.min(...points.map((p) => p[1])), maxY: Math.max(...points.map((p) => p[1])),
        minZ: Math.min(...points.map((p) => p[2])), maxZ: Math.max(...points.map((p) => p[2])) }, geometry.bounds);
      assert.deepEqual(geometry.footprint, assetFootprint(graph, instance));
      assert.deepEqual(geometry.dimensions, { width: .5, depth: .3, height: 1.87 });
      assert.equal(geometry.family, family);
    }
  }
});

test('one normalized family scales to two person heights and returns detached derived geometry', () => {
  const family = personFamily(); const graph: ModelGraph = { units: 'm', entities: [family], relationships: [] };
  const before = JSON.stringify(family);
  const tall = assetGeometry(graph, personInstance()); const short = assetGeometry(graph, personInstance('short-person', 1.65));
  assert.equal(tall.bounds.maxZ, 1.87); assert.equal(short.bounds.maxZ, 1.65);
  assert.equal(tall.bounds.minZ, 0); assert.equal(short.bounds.minZ, 0);
  assert.deepEqual(tall.footprint, short.footprint);
  tall.faces.length = 0;
  assert.ok(assetGeometry(graph, personInstance()).faces.length > 0);
  assert.equal(JSON.stringify(family), before);
});

test('families require positive normalized primitives and raw analytic extrema on all six faces', () => {
  const family = personFamily();
  const unit: AssetPart = { id: 'unit', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#667788' };
  for (let axis = 0; axis < 3; axis += 1) {
    const inset = structuredClone(unit); inset.min[axis] = .001; inset.size[axis] = .999;
    const short = structuredClone(unit); short.size[axis] = .999;
    const escaped = structuredClone(unit); escaped.size[axis] = 1.001;
    const empty = structuredClone(unit); empty.size[axis] = 0;
    for (const part of [inset, short, escaped, empty]) assert.throws(() => parseAssetFamily({ ...family, parts: [part] }));
  }
  assert.throws(() => parseAssetFamily({ ...family, parts: [unit, unit] }), /unique/);
  assert.throws(() => parseAssetFamily({ ...family, parts: Array.from({ length: 17 }, (_, i) => ({ ...unit, id: 'part-' + i })) }), /sixteen/);
  assert.doesNotThrow(() => parseAssetFamily({ ...family, parts: Array.from({ length: 16 }, (_, i) => ({ ...unit, id: 'part-' + i })) }));
});

test('missing/non-family IDs cannot supply geometry or footprints', () => {
  const graph: ModelGraph = { units: 'm', entities: [{ id: identifier('standing-person'), type: 'Level', name: 'Not a family', elevation: 0 }], relationships: [] };
  assert.throws(() => assetFootprint(graph, personInstance()), /existing family/);
  assert.throws(() => assetGeometry(graph, personInstance()), /existing family/);
});

test('asset boundaries reject unknown fields, malformed bindings, blank/control text and off-grid placement', () => {
  const family = personFamily(); const instance = personInstance();
  for (const text of ['', '   ', 'bad\nname', 'bad\u007fname']) {
    assert.throws(() => parseAssetFamily({ ...family, name: text }));
    assert.throws(() => parseAssetFamily({ ...family, description: text }));
    assert.throws(() => parseAssetInstance({ ...instance, name: text }));
  }
  for (const changed of [
    { ...family, url: 'https://example.com/mesh' }, { ...family, parts: [{ ...family.parts[0], script: 'execute()' }] },
    { ...family, parts: [{ ...family.parts[0], kind: 'mesh' }] },
  ]) assert.throws(() => parseAssetFamily(changed));
  for (const changed of [
    { ...instance, bounds: {} }, { ...instance, levelId: 'level-ground' }, { ...instance, position: [0, 0, 0] },
    { ...instance, position: [1.0001, 2] }, { ...instance, rotationDeg: 45 }, { ...instance, size: { ...instance.size, height: 1.8701 } },
    { ...instance, placement: { kind: 'room' } }, { ...instance, placement: { kind: 'single-room', roomId: 'extra' } },
  ]) assert.throws(() => parseAssetInstance(changed));
  assert.throws(() => parseAssetEdit({ families: [], instances: [], removeInstanceIds: [], shell: {} }), /exact/);
  let called = false;
  const hostile = { ...family, parts: Object.defineProperty([], '0', { enumerable: true, get() { called = true; return family.parts[0]; } }) };
  assert.throws(() => parseAssetFamily(hostile), /plain data/); assert.equal(called, false);
});
