import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { parseFixture } from '../fixtures/fixture.ts';
import type { Fixture } from '../fixtures/fixture.ts';

const text = Type.String({ minLength: 1, maxLength: 256 });
const id = Type.String({ pattern: '^[a-z][a-z0-9-]*$' });
const positive = Type.Number({ exclusiveMinimum: 0 });
const vector = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);
const propertyBase = { pset: text, name: text };
export const PropertySchema = Type.Union([
  Type.Object({ ...propertyBase, kind: Type.Literal('label'), value: text }, { additionalProperties: false }),
  Type.Object({ ...propertyBase, kind: Type.Literal('real'), value: Type.Number() }, { additionalProperties: false }),
  Type.Object({ ...propertyBase, kind: Type.Literal('boolean'), value: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ ...propertyBase, kind: Type.Literal('labels'), value: Type.Array(text, { minItems: 1 }) }, { additionalProperties: false }),
]);
const box = { id, name: text, size: vector, position: vector };
export const NativeModelSchema = Type.Object({
  format: Type.Literal('w2-native-slice-v1'), revision: Type.Union([Type.Literal(1), Type.Literal(2)]),
  basis: Type.Object({ id: text, sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }),
  variant: Type.Union([Type.Literal('m'), Type.Literal('mm'), Type.Literal('rotated-m'), Type.Literal('rotated-mm')]),
  lengthUnit: Type.Union([Type.Literal('m'), Type.Literal('mm')]),
  storey: Type.Object({ origin: vector, rotationDegrees: Type.Number() }, { additionalProperties: false }),
  map: Type.Object({ eastings: Type.Number(), northings: Type.Number(), height: Type.Number(),
    xAxisAbscissa: Type.Number(), xAxisOrdinate: Type.Number(), scale: positive,
  }, { additionalProperties: false }),
  wallType: Type.Object({ id, name: text, properties: Type.Array(PropertySchema) }, { additionalProperties: false }),
  walls: Type.Array(Type.Object({ ...box, typeId: id, properties: Type.Array(PropertySchema) }, { additionalProperties: false }), { minItems: 2, maxItems: 2 }),
  opening: Type.Object({ ...box, hostId: id }, { additionalProperties: false }),
  space: Type.Object(box, { additionalProperties: false }),
  boundary: Type.Object({ id, spaceId: id, wallId: id }, { additionalProperties: false }),
}, { additionalProperties: false });
export type NativeModel = Static<typeof NativeModelSchema>;
export type Property = Static<typeof PropertySchema>;

export function parseNativeModel(input: unknown): NativeModel {
  if (!Check(NativeModelSchema, input)) throw new Error('Invalid W2 native fixture boundary');
  const ids = [input.wallType.id, ...input.walls.map(wall => wall.id), input.opening.id, input.space.id, input.boundary.id];
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate logical identities');
  for (const wall of input.walls) {
    if (wall.typeId !== input.wallType.id) throw new Error('Unresolved wall type');
  }
  for (const item of [...input.walls, input.opening, input.space]) {
    if (item.size.some(value => value <= 0)) throw new Error('Nonpositive box dimensions');
  }
  if (!input.walls.some(wall => wall.id === input.opening.hostId)) throw new Error('Unresolved opening host');
  if (input.boundary.spaceId !== input.space.id || !input.walls.some(wall => wall.id === input.boundary.wallId)) throw new Error('Unresolved space boundary');
  for (const owner of [input.wallType, ...input.walls]) {
    const keys = owner.properties.map(property => `${property.pset}/${property.name}`);
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate source property names');
  }
  if (Math.abs(Math.hypot(input.map.xAxisAbscissa, input.map.xAxisOrdinate) - 1) > 1e-12) throw new Error('Map axis must be normalized');
  return input;
}

export function fixture(variant: NativeModel['variant'], revision: NativeModel['revision'], basis: { fixture: Fixture; sha256: string }): NativeModel {
  const mm = variant.endsWith('mm');
  const u = mm ? 1000 : 1;
  const rotated = variant.startsWith('rotated');
  function quantity(entityId: string, property: string): number {
    const entity = basis.fixture.entities.find(item => item.id === entityId);
    const value = entity?.properties[property];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing numeric W0 input ${entityId}/${property}`);
    return value;
  }
  const wallLength = quantity('shared-wall', 'length');
  const wallThickness = quantity('shared-wall', 'thickness');
  const wallHeight = quantity('shared-wall', 'height');
  return parseNativeModel({
    format: 'w2-native-slice-v1', basis: { id: basis.fixture.id, sha256: basis.sha256 }, revision, variant, lengthUnit: mm ? 'mm' : 'm',
    storey: { origin: [10 * u, 20 * u, 3 * u], rotationDegrees: rotated ? 30 : 0 },
    map: { eastings: 500000, northings: 6600000, height: 100, xAxisAbscissa: 0.8, xAxisOrdinate: 0.6, scale: 1 / u },
    wallType: { id: 'wall-type', name: 'Qualification wall type', properties: [
      { pset: 'W2_Declared', name: 'ThicknessMetres', kind: 'real', value: wallThickness },
      { pset: 'Vendor_Unknown', name: 'Recipe', kind: 'label', value: "Maker's opaque recipe" },
    ] },
    walls: ['wall-a', 'wall-b'].map((wallId, index) => ({
      id: wallId, name: wallId, typeId: 'wall-type', size: [(wallLength + (revision === 2 && index === 0 ? 1 : 0)) * u, wallThickness * u, wallHeight * u],
      position: [0, index * 4 * u, 0], properties: [
        { pset: 'Pset_WallCommon', name: 'FireRating', kind: 'label', value: 'EI60' },
        { pset: 'Vendor_Unknown', name: 'Flag', kind: 'boolean', value: true },
        { pset: 'Vendor_Unknown', name: 'Layers', kind: 'labels', value: ['skin', "Maker's core"] },
      ],
    })),
    opening: { id: 'opening-a', name: 'opening-a', hostId: 'wall-a', size: [quantity('door', 'width') * u, 2 * wallThickness * u, quantity('door', 'height') * u], position: [quantity('door', 'offset') * u, -wallThickness * u / 2, 0] },
    space: { id: 'space-a', name: 'space-a', size: [(quantity('office', 'maxX') - quantity('office', 'minX')) * u, (quantity('office', 'maxY') - quantity('office', 'minY')) * u, wallHeight * u], position: [0, wallThickness * u, 0] },
    boundary: { id: 'boundary-a', spaceId: 'space-a', wallId: 'wall-a' },
  });
}

const InventorySchema = Type.Array(Type.Object({ ownerId: id, properties: Type.Array(PropertySchema) }, { additionalProperties: false }));
type Inventory = Static<typeof InventorySchema>;

function parseInventory(input: unknown): Inventory {
  if (!Check(InventorySchema, input)) throw new Error('Invalid independent reader inventory');
  return input;
}

// Narrow import overlays properties onto retained authored inputs. It does not infer authoring intent from a solid.
export function importProperties(model: NativeModel, inventory: unknown): NativeModel {
  const entries = parseInventory(inventory);
  const expectedOwners = [model.wallType.id, ...model.walls.map(wall => wall.id)];
  if (entries.length !== expectedOwners.length || new Set(entries.map(item => item.ownerId)).size !== expectedOwners.length
      || entries.some(item => !expectedOwners.includes(item.ownerId))) throw new Error('Incomplete property inventory');
  function properties(ownerId: string): Property[] {
    const item = entries.find(entry => entry.ownerId === ownerId);
    if (!item) throw new Error(`Missing property owner ${ownerId}`);
    return item.properties;
  }
  return parseNativeModel({ ...model,
    wallType: { ...model.wallType, properties: properties(model.wallType.id) },
    walls: model.walls.map(wall => ({ ...wall, properties: properties(wall.id) })),
  });
}

async function main(): Promise<void> {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === 'generate' && first && !second) {
    const source = await readFile(new URL('../fixtures/tiny-building.json', import.meta.url), 'utf8');
    const input: unknown = JSON.parse(source);
    const basis = { fixture: parseFixture(input), sha256: createHash('sha256').update(source).digest('hex') };
    await mkdir(first, { recursive: false });
    await writeFile(path.join(first, 'w0-source.json'), source);
    await writeFile(path.join(first, 'native-model.schema.json'), JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#', ...NativeModelSchema,
    }, null, 2));
    for (const variant of ['m', 'mm', 'rotated-m', 'rotated-mm'] satisfies NativeModel['variant'][]) {
      for (const revision of [1, 2] satisfies NativeModel['revision'][]) {
        await writeFile(path.join(first, `${variant}-r${revision}.json`), JSON.stringify(fixture(variant, revision, basis), null, 2));
      }
    }
    return;
  }
  if (command === 'import-properties' && first && second && third) {
    const model: unknown = JSON.parse(await readFile(first, 'utf8'));
    const inventory: unknown = JSON.parse(await readFile(second, 'utf8'));
    await writeFile(third, JSON.stringify(importProperties(parseNativeModel(model), inventory), null, 2), { flag: 'wx' });
    return;
  }
  throw new Error('Usage: native.ts generate NEW_DIRECTORY | import-properties MODEL INVENTORY NEW_FILE');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
