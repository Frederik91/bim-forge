import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { entityElevation, entityLevel } from './building-levels.ts';
import { doorClearanceBounds } from './floor-plan.ts';
import { createModelScopeIndex } from './model-scope.ts';
import { plainScopeData } from './model-scope-contract.ts';
import { diffSnapshots, identifier, validateSnapshot } from './room-model.ts';
import type { ModelGraph } from './room-model.ts';

const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const exact = { additionalProperties: false };
export const HostedDoorWidthRequestSchema = Type.Object({ doorId: id,
  widthMetres: Type.Number({ minimum: .001, maximum: 100 }), anchor: Type.Literal('centre') }, exact);
export type HostedDoorWidthRequest = Static<typeof HostedDoorWidthRequestSchema>;
const state = Type.Object({ widthMetres: Type.Number(), offsetMetres: Type.Number(),
  centreMetres: Type.Array(Type.Number(), { minItems: 3, maxItems: 3 }) }, exact);
export const HostedDoorWidthImpactSchema = Type.Object({ doorId: id, hostWallId: id, relationshipId: id,
  anchor: Type.Literal('centre'), before: state, after: state }, exact);

/** Pure native preview. Read dependencies and stored writes confer no acceptance authority. */
export function previewHostedDoorWidth(baseSnapshot: unknown, value: unknown, options: { readable?: ModelGraph } = {}) {
  const input = plainScopeData(value);
  if (!Check(HostedDoorWidthRequestSchema, input)) throw new Error('Provide an exact native door ID, bounded widthMetres and centre anchor.');
  const widthMm = input.widthMetres * 1000;
  if (Math.abs(widthMm - Math.round(widthMm)) > 1e-6) throw new Error('Door width requires a 1 mm grid.');
  const base = validateSnapshot(baseSnapshot);
  const doorId = identifier(input.doorId);
  const door = base.entities.find(item => item.id === doorId);
  if (door?.type !== 'Door') throw new Error('Choose an existing native Door. Linked and IFC identities are read-only.');
  const hosts = base.relationships.filter(link => link.source === door.id);
  const host = hosts[0];
  const wall = base.entities.find(item => item.id === host?.target);
  if (hosts.length !== 1 || !host || wall?.type !== 'Wall'
      || (wall.start[0] !== wall.end[0] && wall.start[1] !== wall.end[1])) throw new Error('Door requires exactly one supported axis-aligned native wall host.');
  const oldWidthMm = Math.round(door.width * 1000);
  if (door.width !== oldWidthMm / 1000 || host.offset !== Math.round(host.offset * 1000) / 1000) {
    throw new Error('Existing door width and host offset must use the canonical 1 mm grid; centre anchoring cannot silently snap them.');
  }
  const offsetMm = Math.round(host.offset * 1000) + (oldWidthMm - Math.round(widthMm)) / 2;
  if (!Number.isInteger(offsetMm)) throw new Error('Centre anchoring requires a hosted offset on the 1 mm grid.');
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  if (offsetMm < 0 || offsetMm + Math.round(widthMm) > Math.round(length * 1000)) throw new Error('Centred door must fit inside its host wall.');
  const widthMetres = Math.round(widthMm) / 1000;
  const candidate = { ...base,
    entities: base.entities.map(item => item.id === door.id ? { ...door, width: widthMetres } : item),
    relationships: base.relationships.map(link => link.id === host.id ? { ...host, offset: offsetMm / 1000 } : link) };
  const nextDoor = { ...door, width: widthMetres };
  const zone = doorClearanceBounds(candidate, nextDoor);
  const owner = entityLevel(base, door);
  const index = createModelScopeIndex(candidate);
  const dependencies = new Set<string>([door.id, wall.id, ...(owner ? [owner.id] : [])]);
  for (const item of index.entities) {
    if (owner && !item.levelIds.includes(owner.id)) continue;
    const b = item.bounds;
    if (b && ['Furniture', 'AssetInstance', 'Stair', 'Roof', 'Space'].includes(item.type)
        && b.minX <= zone.maxX && b.maxX >= zone.minX && b.minY <= zone.maxY && b.maxY >= zone.minY) {
      dependencies.add(item.id);
      if (item.familyId) dependencies.add(item.familyId);
    }
  }
  const hostLinks = base.relationships.filter(link => link.target === wall.id);
  for (const link of hostLinks) dependencies.add(link.source);
  if (options.readable) {
    const entities = new Set<string>(options.readable.entities.map(item => item.id));
    const relationships = new Set<string>(options.readable.relationships.map(link => link.id));
    if ([...dependencies].some(id => !entities.has(id)) || hostLinks.some(link => !relationships.has(link.id))) {
      throw new Error('Hosted door dependencies must already be readable within the frozen model scope; request a fresh scope.');
    }
  }
  // Legacy single-room validation does not check sibling opening overlap.
  for (const link of hostLinks) {
    if (link.id === host.id) continue;
    const sibling = base.entities.find(item => item.id === link.source);
    if (sibling && (sibling.type === 'Door' || sibling.type === 'Window')
        && offsetMm / 1000 < link.offset + sibling.width - 1e-9 && offsetMm / 1000 + widthMetres > link.offset + 1e-9) {
      throw new Error('Hosted openings cannot overlap.');
    }
  }
  const snapshot = validateSnapshot(candidate);
  const centre = (width: number, offset: number): [number, number, number] => {
    const distance = offset + width / 2;
    return [wall.start[0] + (wall.end[0] - wall.start[0]) / length * distance,
      wall.start[1] + (wall.end[1] - wall.start[1]) / length * distance, entityElevation(base, door)];
  };
  const impact = { doorId: door.id, hostWallId: wall.id, relationshipId: host.id, anchor: input.anchor,
    before: { widthMetres: door.width, offsetMetres: host.offset, centreMetres: centre(door.width, host.offset) },
    after: { widthMetres, offsetMetres: offsetMm / 1000, centreMetres: centre(widthMetres, offsetMm / 1000) } } satisfies Static<typeof HostedDoorWidthImpactSchema>;
  return { snapshot, delta: diffSnapshots(base, snapshot), impact };
}
