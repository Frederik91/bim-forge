import { Type } from '@frederik91/scriptbox';
import type { Static } from '@frederik91/scriptbox';
import { Check } from 'typebox/value';
import { createHash } from 'node:crypto';
import { validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

const identifier = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const name = Type.String({ minLength: 1, maxLength: 80 });
const coordinate = Type.Integer({ minimum: -1000000, maximum: 1000000 });
const dimension = Type.Integer({ minimum: 1, maximum: 100000 });
const bounds = Type.Object({ minX: coordinate, minY: coordinate, maxX: coordinate, maxY: coordinate }, { additionalProperties: false });
const opening = {
  id: identifier, name, roomId: identifier,
  side: Type.Union([Type.Literal('north'), Type.Literal('south'), Type.Literal('east'), Type.Literal('west')]),
  offsetMm: Type.Integer({ minimum: 0, maximum: 1000000 }), widthMm: dimension, heightMm: dimension,
};

/** Room bounds follow wall centrelines. All dimensions are whole millimetres. */
export const FloorLayoutSchema = Type.Object({
  level: Type.Object({ id: identifier, name }, { additionalProperties: false }),
  rooms: Type.Array(Type.Object({ id: identifier, name, boundsMm: bounds }, { additionalProperties: false }), { minItems: 2, maxItems: 12 }),
  wallThicknessMm: dimension,
  heightMm: dimension,
  openings: Type.Array(Type.Union([
    Type.Object({ ...opening, type: Type.Literal('Door') }, { additionalProperties: false }),
    Type.Object({ ...opening, type: Type.Literal('Window'), sillHeightMm: Type.Integer({ minimum: 0, maximum: 100000 }) }, { additionalProperties: false }),
  ]), { maxItems: 100 }),
}, { title: 'FloorLayout', additionalProperties: false });

export type FloorLayout = Static<typeof FloorLayoutSchema>;
type Room = FloorLayout['rooms'][number];
type Side = FloorLayout['openings'][number]['side'];
interface Edge { axis: 'h' | 'v'; at: number; start: number; end: number }

// Inspect descriptors before schema validation so arbitrary unknown callers cannot run accessors.
function plainInput(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new Error('Floor layout must be bounded plain data.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null) throw new Error('Floor layout must be bounded plain data.');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 100 || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new Error('Floor layout requires dense bounded arrays.');
    }
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('Floor layout requires plain data.');
      return plainInput(descriptor.value, depth + 1);
    });
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length > 16) throw new Error('Floor layout requires plain data.');
  return Object.fromEntries(keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new Error('Floor layout requires plain data.');
    }
    return [key, plainInput(descriptor.value, depth + 1)];
  }));
}

export function parseFloorLayout(input: unknown): FloorLayout {
  const value = plainInput(input);
  if (!Check(FloorLayoutSchema, value)) throw new Error('Floor layout requires exact fields, two to twelve rooms and bounded whole millimetres.');
  return value;
}

function edgeFor(bounds: Room['boundsMm'], side: Side): Edge {
  switch (side) {
    case 'south': return { axis: 'h', at: bounds.minY, start: bounds.minX, end: bounds.maxX };
    case 'north': return { axis: 'h', at: bounds.maxY, start: bounds.minX, end: bounds.maxX };
    case 'west': return { axis: 'v', at: bounds.minX, start: bounds.minY, end: bounds.maxY };
    case 'east': return { axis: 'v', at: bounds.maxX, start: bounds.minY, end: bounds.maxY };
  }
}

function wallUnions(rooms: Room[]): Edge[] {
  const sides: Side[] = ['south', 'north', 'west', 'east'];
  const edges = rooms.flatMap((room) => sides.map((side) => edgeFor(room.boundsMm, side)))
    .sort((a, b) => (a.axis === b.axis ? 0 : a.axis === 'h' ? -1 : 1) || a.at - b.at || a.start - b.start || a.end - b.end);
  const unions: Edge[] = [];
  for (const edge of edges) {
    const last = unions.at(-1);
    if (last && last.axis === edge.axis && last.at === edge.at && edge.start <= last.end) last.end = Math.max(last.end, edge.end);
    else unions.push({ ...edge });
  }
  return unions;
}

function wallId(edge: Edge): string {
  const coordinateId = (value: number) => (value < 0 ? 'n' : 'p') + Math.abs(value);
  return ['floor-wall', edge.axis, coordinateId(edge.at), coordinateId(edge.start), coordinateId(edge.end)].join('-');
}

function hostId(openingId: string): string {
  const digest = createHash('sha256').update(openingId).digest('hex');
  // Base 36 retains all 256 bits and fits the model's 64-character identifier limit.
  return 'floor-host-' + BigInt('0x' + digest).toString(36);
}

/**
 * Replace the shell, retaining the current draft's Furniture/Equipment exactly.
 * Offsets start at a room side's minimum X (north/south) or Y (east/west).
 * A failed reconstruction leaves the caller's snapshot untouched.
 */
export function previewFloor(baseSnapshot: unknown, input: unknown): ModelSnapshot {
  const layout = parseFloorLayout(input);
  const base = validateSnapshot(baseSnapshot);
  const rooms = new Map<string, Room>();
  for (const room of layout.rooms) {
    const b = room.boundsMm;
    if (rooms.has(room.id)) throw new Error('Duplicate room identifier.');
    if (b.minX >= b.maxX || b.minY >= b.maxY) throw new Error('Room bounds must have positive width and depth.');
    rooms.set(room.id, room);
  }
  const walls = wallUnions(layout.rooms);
  const entities: unknown[] = [
    ...base.entities.filter((item) => item.type === 'Furniture' || item.type === 'Equipment'),
    { ...layout.level, type: 'Level', elevation: 0 },
    ...layout.rooms.map((room) => {
      const b = room.boundsMm;
      return { id: room.id, type: 'Space', name: room.name, levelId: layout.level.id,
        bounds: { minX: b.minX / 1000, minY: b.minY / 1000, maxX: b.maxX / 1000, maxY: b.maxY / 1000 } };
    }),
    ...walls.map((wall) => ({
      id: wallId(wall), type: 'Wall', name: 'Floor wall ' + wallId(wall),
      start: wall.axis === 'h' ? [wall.start / 1000, wall.at / 1000] : [wall.at / 1000, wall.start / 1000],
      end: wall.axis === 'h' ? [wall.end / 1000, wall.at / 1000] : [wall.at / 1000, wall.end / 1000],
      thickness: layout.wallThicknessMm / 1000, height: layout.heightMm / 1000,
    })),
  ];
  const relationships = layout.openings.map((item) => {
    const room = rooms.get(item.roomId);
    if (!room) throw new Error('Opening must reference a room in this floor layout.');
    const edge = edgeFor(room.boundsMm, item.side);
    if (item.offsetMm + item.widthMm > edge.end - edge.start) throw new Error('Opening must fit inside its named room side.');
    const wall = walls.find((candidate) => candidate.axis === edge.axis && candidate.at === edge.at
      && candidate.start <= edge.start && candidate.end >= edge.end);
    if (!wall) throw new Error('Opening requires a compiled wall host.');
    entities.push(item.type === 'Door'
      ? { id: item.id, type: 'Door', name: item.name, width: item.widthMm / 1000, height: item.heightMm / 1000 }
      : { id: item.id, type: 'Window', name: item.name, width: item.widthMm / 1000, height: item.heightMm / 1000, sillHeight: item.sillHeightMm / 1000 });
    return { id: hostId(item.id), type: 'hosted-by', source: item.id, target: wallId(wall),
      offset: (edge.start - wall.start + item.offsetMm) / 1000 };
  });
  return validateSnapshot({ units: 'm', entities, relationships });
}
