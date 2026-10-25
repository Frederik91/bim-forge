import { Check } from 'typebox/value';
import { createHash } from 'node:crypto';
import { validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { entityLevel, levels } from './building-levels.ts';
import { FloorLayoutSchema } from './building-schema.ts';
import type { FloorLayout } from './building-schema.ts';
export { FloorLayoutSchema } from './building-schema.ts';
export type { FloorLayout } from './building-schema.ts';
type Room = FloorLayout['rooms'][number];
type Side = FloorLayout['openings'][number]['side'];
interface Edge { axis: 'h' | 'v'; at: number; start: number; end: number }

// Inspect descriptors before schema validation so arbitrary unknown callers cannot run accessors.
export function plainLayoutInput(value: unknown, depth = 0): unknown {
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
      return plainLayoutInput(descriptor.value, depth + 1);
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
    return [key, plainLayoutInput(descriptor.value, depth + 1)];
  }));
}

export function parseFloorLayout(input: unknown): FloorLayout {
  const value = plainLayoutInput(input);
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
  if (base.version === 2) {
    const level = levels(base).find((item) => item.id === layout.level.id);
    if (!level) throw new Error('Level reconstruction requires an existing stable level identity.');
    const shell = compileFloorLayout(layout, { kind: 'building', elevation: level.elevation });
    const removed = new Set(base.entities.filter((item) => entityLevel(base, item)?.id === level.id
      && (item.type === 'Level' || item.type === 'Space' || item.type === 'Wall' || item.type === 'Door' || item.type === 'Window')).map((item) => item.id));
    return validateSnapshot({ version: 2, units: 'm', entities: [...base.entities.filter((item) => !removed.has(item.id)), ...shell.entities],
      relationships: [...base.relationships.filter((link) => !removed.has(link.source) && !removed.has(link.target)), ...shell.relationships] });
  }
  const shell = compileFloorLayout(layout, { kind: 'legacy' });
  return validateSnapshot({ units: 'm', entities: [...base.entities.filter((item) => item.type === 'Furniture' || item.type === 'Equipment'), ...shell.entities],
    relationships: shell.relationships });
}

/** Shared shell compiler; whole-building topology is validated after all floors and stairs exist. */
export function compileFloorLayout(layout: FloorLayout, format: { kind: 'legacy' } | { kind: 'building'; elevation: number }): {
  entities: unknown[]; relationships: unknown[];
} {
  const idFor = (edge: Edge): string => format.kind === 'legacy' ? wallId(edge)
    : 'building-wall-' + BigInt('0x' + createHash('sha256').update(layout.level.id + ':' + wallId(edge)).digest('hex')).toString(36);
  const rooms = new Map<string, Room>();
  for (const room of layout.rooms) {
    const b = room.boundsMm;
    if (rooms.has(room.id)) throw new Error('Duplicate room identifier.');
    if (b.minX >= b.maxX || b.minY >= b.maxY) throw new Error('Room bounds must have positive width and depth.');
    rooms.set(room.id, room);
  }
  const walls = wallUnions(layout.rooms);
  const entities: unknown[] = [
    { ...layout.level, type: 'Level', elevation: format.kind === 'building' ? format.elevation : 0 },
    ...layout.rooms.map((room) => {
      const b = room.boundsMm;
      return { id: room.id, type: 'Space', name: room.name, levelId: layout.level.id,
        bounds: { minX: b.minX / 1000, minY: b.minY / 1000, maxX: b.maxX / 1000, maxY: b.maxY / 1000 } };
    }),
    ...walls.map((wall) => ({
      id: idFor(wall), type: 'Wall', name: 'Floor wall ' + wallId(wall),
      ...(format.kind === 'building' ? { levelId: layout.level.id } : {}),
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
    return { id: hostId(item.id), type: 'hosted-by', source: item.id, target: idFor(wall),
      offset: (edge.start - wall.start + item.offsetMm) / 1000 };
  });
  return { entities, relationships };
}
