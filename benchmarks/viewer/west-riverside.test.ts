import assert from 'node:assert/strict';
import test from 'node:test';
import { disciplines, transformedPositions } from './west-riverside.ts';
import { admission, applyProposal, parseModel, unchangedModel } from './contract.ts';
import { smokeModel } from './fixtures.ts';

test('all seven disciplines have distinct IFC4 sources, without duplicate schema exports', () => {
  assert.equal(disciplines.length, 7); assert.equal(new Set(disciplines.map(item => item.file)).size, 7);
  assert.ok(disciplines.every(item => item.file.endsWith('_ifc4.ifc')));
  assert.deepEqual(disciplines.map(item => item.id).sort(), ['architecture', 'electrical', 'fire-alarm', 'mechanical', 'plumbing', 'sprinklers', 'structure']);
});
test('IFC matrix baking retains rotation and metre scale while translation stays on the element', () => {
  const matrix = [0, .001, 0, 0, -.001, 0, 0, 0, 0, 0, .001, 0, 100, 200, 300, 1];
  assert.deepEqual(transformedPositions([1000, 2000, 3000, 0, 0, 1], matrix), [-2, 1, 3]);
  assert.throws(() => transformedPositions([0], matrix));
  assert.throws(() => transformedPositions([Infinity, 0, 0, 0, 0, 0], matrix));
});
test('unknown floor area and publicly mirrored provenance cannot become qualified', () => {
  const source = smokeModel();
  const model = parseModel({ ...source, grossFloorAreaM2: null, provenance: { kind: 'public-unverified', sourceHashes: ['a'.repeat(64)],
    permissionEvidence: 'Local evaluation authorized; redistribution unresolved', floorAreaEvidence: 'Unknown',
    coordinateReference: 'test', conversionEvidence: 'test', inventoryEvidence: 'test', limitations: ['Unverified identity'] } });
  assert.equal(model.grossFloorAreaM2, null); assert.equal(admission(model).qualified, false);
  assert.ok(admission(model).reasons.includes('Gross floor area is unknown'));
  model.grossFloorAreaM2 = 300000;
  assert.ok(admission(model).reasons.some(reason => reason.includes('rights')));
});

test('owned input may transfer after validation; default parsing still isolates the caller', () => {
  const input = smokeModel(); const isolated = parseModel(input);
  assert.notEqual(isolated, input); assert.notEqual(isolated.geometries, input.geometries);
  assert.equal(parseModel(input, 'transfer'), input);
  assert.throws(() => parseModel({ ...input, elements: [{ ...input.elements[0], geometryId: 'missing' }] }, 'transfer'));
});

test('review shares tessellation but isolates element metadata; exact audit detects any accepted mutation', () => {
  const base = smokeModel(); const unchanged = unchangedModel(base);
  const proposal = applyProposal(base, { id: 'audit', baseRevision: base.revision, nextRevision: 'audit', remove: [], upsert: [] });
  assert.equal(proposal.geometries, base.geometries); assert.notEqual(proposal.elements[0], base.elements[0]);
  proposal.elements[0].properties.Name = 'Changed'; assert.equal(unchanged(), true);
  const original = base.geometries[0].positions[1];
  base.geometries[0].positions[1] += .01; assert.equal(unchanged(), false);
  base.geometries[0].positions[1] = original; assert.equal(unchanged(), true);
  base.elements[0].properties.Name = 'Unauthorized'; assert.equal(unchanged(), false);
});
