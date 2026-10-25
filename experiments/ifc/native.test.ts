import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { parseFixture } from '../fixtures/fixture.ts';
import { fixture, importProperties, parseNativeModel } from './native.ts';

const source = await readFile(new URL('../fixtures/tiny-building.json', import.meta.url), 'utf8');
const input: unknown = JSON.parse(source);
const basis = { fixture: parseFixture(input), sha256: createHash('sha256').update(source).digest('hex') };

test('W2 derives the narrow dimensions from the authoritative W0 fixture and changes one occurrence', () => {
  const first = fixture('rotated-mm', 1, basis);
  const second = fixture('rotated-mm', 2, basis);
  assert.deepEqual(first.walls.map(wall => wall.id), second.walls.map(wall => wall.id));
  const [wallA, wallB] = first.walls;
  const [changedA, unchangedB] = second.walls;
  assert.ok(wallA && wallB && changedA && unchangedB);
  assert.equal(changedA.size[0] - wallA.size[0], 1000);
  assert.deepEqual(wallB, unchangedB);
  assert.equal(first.basis.sha256, basis.sha256);
  assert.deepEqual(first.opening.size, [900, 400, 2100]);
});

test('native boundary refuses duplicate identities, dangling relationships and unsupported property forms', () => {
  const model = fixture('m', 1, basis);
  assert.throws(() => parseNativeModel({ ...model, opening: { ...model.opening, id: 'wall-a' } }), /Duplicate/);
  assert.throws(() => parseNativeModel({ ...model, opening: { ...model.opening, hostId: 'absent' } }), /host/);
  assert.throws(() => parseNativeModel({ ...model, wallType: { ...model.wallType, properties: [{ pset: 'Unknown', name: 'Range', kind: 'bounded', value: [2, 12] }] } }), /Invalid/);
});

test('property overlay preserves unfamiliar typed values and rejects incomplete independent inventories', () => {
  const model = fixture('m', 1, basis);
  const inventory = [model.wallType, ...model.walls].map(owner => ({ ownerId: owner.id, properties: owner.properties }));
  assert.deepEqual(importProperties(model, inventory), model);
  assert.throws(() => importProperties(model, inventory.slice(1)), /Incomplete/);
  assert.throws(() => importProperties(model, [...inventory, inventory[0]]), /Invalid|Incomplete/);
});
