import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { ModelParameterSchema, plainScopeData } from './model-scope-contract.ts';

const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const entityType = Type.Union([
  Type.Literal('Wall'), Type.Literal('Door'), Type.Literal('Window'), Type.Literal('Equipment'),
  Type.Literal('Furniture'), Type.Literal('Level'), Type.Literal('Space'), Type.Literal('Slab'),
  Type.Literal('Stair'), Type.Literal('Roof'), Type.Literal('AssetFamily'), Type.Literal('AssetInstance'),
]);
const furnitureKind = Type.Union([
  Type.Literal('desk'), Type.Literal('monitor'), Type.Literal('laptop'), Type.Literal('chair'),
  Type.Literal('table'), Type.Literal('plant'), Type.Literal('bed'), Type.Literal('sofa'), Type.Literal('cabinet'),
]);
const boundsSchema = Type.Object({ minX: Type.Number(), minY: Type.Number(), maxX: Type.Number(), maxY: Type.Number() }, { additionalProperties: false });
const relation = Type.Union([Type.Literal('hosted-by'), Type.Literal('supported-by'), Type.Literal('instance-of'), Type.Literal('contained-in')]);
export const ModelScopeIndexEntitySchema = Type.Object({
  id, type: entityType, furnitureKind: Type.Union([furnitureKind, Type.Null()]),
  levelIds: Type.Array(id, { uniqueItems: true }), spaceIds: Type.Array(id, { uniqueItems: true }),
  familyId: Type.Union([id, Type.Null()]), bounds: Type.Union([boundsSchema, Type.Null()]), parameters: Type.Array(ModelParameterSchema, { maxItems: 32 }),
}, { additionalProperties: false });
export const ModelScopeIndexEdgeSchema = Type.Object({
  id: Type.Union([id, Type.Null()]), relation, source: id, target: id,
}, { additionalProperties: false });
/** Derived search data only: no immutable entity bodies, geometry recipes or source stubs. */
export const ModelScopeIndexSchema = Type.Object({ version: Type.Literal(1),
  entities: Type.Array(ModelScopeIndexEntitySchema, { maxItems: 100 }),
  edges: Type.Array(ModelScopeIndexEdgeSchema, { maxItems: 10_000 }),
}, { additionalProperties: false });
export type ModelScopeIndexEntity = Static<typeof ModelScopeIndexEntitySchema>;
export type ModelScopeIndexEdge = Static<typeof ModelScopeIndexEdgeSchema>;
export type ModelScopeIndex = Static<typeof ModelScopeIndexSchema>;

export function parseModelScopeIndex(input: unknown): ModelScopeIndex {
  // Derived edge arrays can exceed the wire query's 100-item bound. Each record
  // still passes the shared descriptor-only boundary before schema checking.
  if (input === null || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Reflect.ownKeys(input).length !== 3) throw new Error('Invalid compact model scope index.');
  const field = (name: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Scope index accessors are not allowed.');
    return descriptor.value;
  };
  const records = (items: unknown, limit: number): unknown[] => {
    if (!Array.isArray(items) || Object.getPrototypeOf(items) !== Array.prototype || items.length > limit
      || Reflect.ownKeys(items).length !== items.length + 1) throw new Error('Scope index records must be dense and bounded.');
    return Array.from({ length: items.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Scope index accessors are not allowed.');
      return plainScopeData(descriptor.value);
    });
  };
  const value = { version: plainScopeData(field('version')), entities: records(field('entities'), 100), edges: records(field('edges'), 10_000) };
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024) throw new Error('Compact scope index exceeds the byte bound.');
  if (!Check(ModelScopeIndexSchema, value)) throw new Error('Invalid compact model scope index.');
  const entities = new Map(value.entities.map((entity) => [entity.id, entity]));
  if (entities.size !== value.entities.length) throw new Error('Duplicate scope index entity ID.');
  for (const entity of value.entities) {
    if ((entity.type === 'Furniture') !== (entity.furnitureKind !== null)
      || (entity.type === 'AssetInstance') !== (entity.familyId !== null)
      || ((entity.type === 'AssetFamily' || entity.type === 'Level') && entity.bounds !== null)) throw new Error('Invalid scope index entity attributes.');
    for (const id of entity.levelIds) if (entities.get(id)?.type !== 'Level') throw new Error('Invalid scope index level reference.');
    for (const id of entity.spaceIds) if (entities.get(id)?.type !== 'Space') throw new Error('Invalid scope index space reference.');
    if (entity.familyId && entities.get(entity.familyId)?.type !== 'AssetFamily') throw new Error('Invalid scope index family reference.');
    if (entity.bounds && (entity.bounds.minX > entity.bounds.maxX || entity.bounds.minY > entity.bounds.maxY
      || Object.values(entity.bounds).some((value) => !Number.isFinite(value)))) throw new Error('Invalid scope index bounds.');
    if (new Set(entity.parameters.map((parameter) => parameter.definitionId)).size !== entity.parameters.length) throw new Error('Duplicate scope index parameter definition.');
  }
  const seen = new Set<string>(); const relationshipIds = new Set<string>();
  for (const edge of value.edges) {
    const key = canonical(edge);
    if (seen.has(key) || !entities.has(edge.source) || !entities.has(edge.target)) throw new Error('Duplicate or dangling scope index edge.');
    seen.add(key);
    if (edge.id !== null) {
      if (relationshipIds.has(edge.id) || edge.relation !== 'hosted-by') throw new Error('Invalid scope index relationship identity.');
      relationshipIds.add(edge.id);
    }
    if ((edge.relation === 'hosted-by' && (edge.id === null || !['Door', 'Window'].includes(entities.get(edge.source)?.type ?? '') || entities.get(edge.target)?.type !== 'Wall'))
      || (edge.relation === 'supported-by' && (entities.get(edge.source)?.type !== 'Furniture' || entities.get(edge.target)?.type !== 'Furniture'))
      || (edge.relation === 'instance-of' && (entities.get(edge.source)?.type !== 'AssetInstance' || entities.get(edge.source)?.familyId !== edge.target))
      || (edge.relation === 'contained-in' && !['Space', 'Level'].includes(entities.get(edge.target)?.type ?? ''))) throw new Error('Invalid scope index relation endpoints.');
  }
  return structuredClone(value);
}
import type { Bounds, Entity, ModelGraph } from './room-model.ts';
import type { FrozenModelScope, ModelParameterValue, ModelScopePredicate, ModelScopeQuery } from './model-scope-contract.ts';
import { parseFrozenModelScope, parseModelScopeQuery } from './model-scope-contract.ts';
import { modelParameters } from './model-parameters.ts';

export type ResolvedModelScope = Pick<FrozenModelScope, 'targetIds' | 'contextIds' | 'dependentIds' | 'writableIds' | 'relationshipIds'>;
const ordered = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();
const touches = (a: Bounds, b: Bounds): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const contains = (a: Bounds, b: Bounds): boolean => a.minX <= b.minX && a.maxX >= b.maxX && a.minY <= b.minY && a.maxY >= b.maxY;
const sameLevel = (a: ModelScopeIndexEntity, b: ModelScopeIndexEntity): boolean =>
  (!a.levelIds.length && !b.levelIds.length) || a.levelIds.some((id) => b.levelIds.includes(id));

function centred(x: number, y: number, width: number, depth: number): Bounds {
  return { minX: x - width / 2, minY: y - depth / 2, maxX: x + width / 2, maxY: y + depth / 2 };
}
function observedBounds(graph: ModelGraph, entity: Entity): Bounds | null {
  switch (entity.type) {
    case 'AssetFamily': case 'Level': return null;
    case 'Space': case 'Slab': case 'Roof': return { ...entity.bounds };
    case 'Wall': return { minX: Math.min(...[entity.start[0], entity.end[0]]) - entity.thickness / 2,
      maxX: Math.max(entity.start[0], entity.end[0]) + entity.thickness / 2,
      minY: Math.min(entity.start[1], entity.end[1]) - entity.thickness / 2,
      maxY: Math.max(entity.start[1], entity.end[1]) + entity.thickness / 2 };
    case 'Furniture': case 'AssetInstance': {
      const size = entity.type === 'Furniture' ? entity : entity.size;
      const sideways = entity.rotationDeg === 90 || entity.rotationDeg === 270;
      return centred(entity.position[0], entity.position[1], sideways ? size.depth : size.width, sideways ? size.width : size.depth);
    }
    case 'Equipment': return centred(entity.position[0], entity.position[1], entity.width, entity.depth);
    case 'Stair': {
      const horizontal = entity.start[1] === entity.end[1];
      return { minX: Math.min(entity.start[0], entity.end[0]) - (horizontal ? 0 : entity.width / 2),
        maxX: Math.max(entity.start[0], entity.end[0]) + (horizontal ? 0 : entity.width / 2),
        minY: Math.min(entity.start[1], entity.end[1]) - (horizontal ? entity.width / 2 : 0),
        maxY: Math.max(entity.start[1], entity.end[1]) + (horizontal ? entity.width / 2 : 0) };
    }
    case 'Door': case 'Window': {
      const host = graph.relationships.find((edge) => edge.source === entity.id);
      const wall = graph.entities.find((item) => item.id === host?.target);
      if (!host || wall?.type !== 'Wall') throw new Error('Scope opening requires an existing wall host.');
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
      if (length === 0) throw new Error('Scope opening requires a nonzero wall host.');
      const dx = (wall.end[0] - wall.start[0]) / length; const dy = (wall.end[1] - wall.start[1]) / length;
      const x = wall.start[0] + dx * host.offset; const y = wall.start[1] + dy * host.offset;
      return { minX: Math.min(x, x + dx * entity.width) - Math.abs(dy) * wall.thickness / 2,
        maxX: Math.max(x, x + dx * entity.width) + Math.abs(dy) * wall.thickness / 2,
        minY: Math.min(y, y + dy * entity.width) - Math.abs(dx) * wall.thickness / 2,
        maxY: Math.max(y, y + dy * entity.width) + Math.abs(dx) * wall.thickness / 2 };
    }
    default: { const exhaustive: never = entity; return exhaustive; }
  }
}

export function createModelScopeIndex(graph: ModelGraph): ModelScopeIndex {
  const firstLevel = graph.entities.filter((entity) => entity.type === 'Level')
    .sort((a, b) => a.elevation - b.elevation || a.id.localeCompare(b.id))[0];
  const levelIds = (entity: Entity): string[] => {
    if (entity.type === 'AssetFamily') return [];
    if (entity.type === 'Level') return [entity.id];
    if (entity.type === 'Stair') return ordered([entity.fromLevelId, entity.toLevelId]);
    if (entity.type === 'Door' || entity.type === 'Window') {
      const host = graph.relationships.find((edge) => edge.source === entity.id);
      const wall = graph.entities.find((item) => item.id === host?.target);
      return wall?.type === 'Wall' ? levelIds(wall) : [];
    }
    if (entity.type === 'AssetInstance') {
      if (entity.placement.kind === 'single-room') return [];
      const roomId = entity.placement.roomId;
      const room = graph.entities.find((item) => item.type === 'Space' && item.id === roomId);
      return room?.type === 'Space' ? [room.levelId] : [];
    }
    return 'levelId' in entity ? [entity.levelId] : graph.version !== 2 && firstLevel ? [firstLevel.id] : [];
  };
  const entities = graph.entities.map((entity): ModelScopeIndexEntity => ({
    id: entity.id, type: entity.type, furnitureKind: entity.type === 'Furniture' ? entity.kind : null,
    levelIds: levelIds(entity), spaceIds: [], familyId: entity.type === 'AssetInstance' ? entity.familyId : null,
    bounds: observedBounds(graph, entity), parameters: modelParameters(entity),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const rooms = entities.filter((entity) => entity.type === 'Space');
  for (const record of entities) {
    const source = graph.entities.find((entity) => entity.id === record.id);
    if (record.type === 'Space') record.spaceIds = [record.id];
    else if (source?.type === 'AssetInstance' && source.placement.kind === 'room') record.spaceIds = [source.placement.roomId];
    else if (record.bounds) {
      const bounds = record.bounds;
      record.spaceIds = ordered(rooms.filter((room) => room.bounds && sameLevel(record, room)
        && ((record.type === 'Furniture' || record.type === 'Equipment' || record.type === 'AssetInstance')
          ? contains(room.bounds, bounds) : touches(room.bounds, bounds))).map((room) => room.id));
    }
  }
  const edges: ModelScopeIndexEdge[] = graph.relationships.map((edge) => ({ id: edge.id, relation: edge.type, source: edge.source, target: edge.target }));
  for (const record of entities) {
    const source = graph.entities.find((entity) => entity.id === record.id);
    if (source?.type === 'Furniture' && source.supportId) edges.push({ id: null, relation: 'supported-by', source: record.id, target: source.supportId });
    if (record.familyId) edges.push({ id: null, relation: 'instance-of', source: record.id, target: record.familyId });
    for (const target of ordered([...record.spaceIds, ...record.levelIds])) {
      if (target !== record.id) edges.push({ id: null, relation: 'contained-in', source: record.id, target });
    }
  }
  return parseModelScopeIndex({ version: 1, entities, edges });
}

function requireEntity(index: ModelScopeIndex, id: string, type?: ModelScopeIndexEntity['type']): ModelScopeIndexEntity {
  const entity = index.entities.find((entity) => entity.id === id);
  if (!entity || (type && entity.type !== type)) throw new Error(`Unknown or wrong-type scope identifier: ${id}${type ? ' (expected ' + type + ')' : ''}.`);
  return entity;
}
function numeric(value: ModelParameterValue): number | null {
  switch (value.kind) {
    case 'length': return value.unit === 'mm' ? value.value / 1000 : value.value;
    case 'duration': return value.value * (value.unit === 'h' ? 3600 : value.unit === 'min' ? 60 : 1);
    case 'number': case 'angle': return value.value;
    case 'text': case 'boolean': return null;
    default: { const exhaustive: never = value; return exhaustive; }
  }
}
function validatePredicate(index: ModelScopeIndex, predicate: ModelScopePredicate): void {
  switch (predicate.kind) {
    case 'ids': predicate.ids.forEach((id) => requireEntity(index, id)); break;
    case 'in-spaces': predicate.spaceIds.forEach((id) => requireEntity(index, id, 'Space')); break;
    case 'on-levels': case 'bounds': predicate.levelIds.forEach((id) => requireEntity(index, id, 'Level')); break;
    case 'asset-family': requireEntity(index, predicate.familyId, 'AssetFamily'); break;
    case 'related': predicate.fromIds.forEach((id) => requireEntity(index, id)); break;
    case 'entity-type': if (!Check(entityType, predicate.entityType)) throw new Error('Unknown scope entity type.'); break;
    case 'furniture-kind': if (!Check(furnitureKind, predicate.furnitureKind)) throw new Error('Unknown scope furniture kind.'); break;
    case 'parameter-compare': {
      if ((predicate.value.kind === 'boolean' || predicate.value.kind === 'text') && predicate.operator !== 'eq' && predicate.operator !== 'ne') {
        throw new Error('Ordered parameter comparison requires a numeric quantity.');
      }
      const values = index.entities.flatMap((entity) => entity.parameters.filter((parameter) => parameter.definitionId === predicate.definitionId));
      if (values.some((parameter) => parameter.value.kind !== predicate.value.kind)) throw new Error('Parameter comparison kind or units do not match the definition.');
      break;
    }
    case 'all': case 'parameter-exists': case 'parameter-kind': break;
    default: { const exhaustive: never = predicate; throw new Error(`Unsupported scope predicate: ${exhaustive}`); }
  }
}
function traversal(index: ModelScopeIndex, predicate: Extract<ModelScopePredicate, { kind: 'related' }>): Set<string> {
  const seen = new Set(predicate.fromIds); const result = new Set<string>(); let frontier = predicate.fromIds;
  for (let step = 0; step < predicate.depth && frontier.length; step += 1) {
    const next: string[] = [];
    for (const edge of index.edges) {
      if (edge.relation !== predicate.relation) continue;
      const candidates = [
        ...(predicate.direction !== 'incoming' && frontier.includes(edge.source) ? [edge.target] : []),
        ...(predicate.direction !== 'outgoing' && frontier.includes(edge.target) ? [edge.source] : []),
      ];
      for (const id of candidates) if (!seen.has(id)) { seen.add(id); result.add(id); next.push(id); }
    }
    frontier = next;
  }
  return result;
}
function compare(value: ModelParameterValue, predicate: Extract<ModelScopePredicate, { kind: 'parameter-compare' }>): boolean {
  if (value.kind !== predicate.value.kind) return false;
  const a = numeric(value); const b = numeric(predicate.value);
  if (a === null || b === null) return predicate.operator === 'eq' ? value.value === predicate.value.value : value.value !== predicate.value.value;
  switch (predicate.operator) {
    case 'eq': return a === b; case 'ne': return a !== b; case 'lt': return a < b;
    case 'lte': return a <= b; case 'gt': return a > b; case 'gte': return a >= b;
    default: { const exhaustive: never = predicate.operator; return exhaustive; }
  }
}
function matches(entity: ModelScopeIndexEntity, predicate: ModelScopePredicate, related: Map<ModelScopePredicate, Set<string>>): boolean {
  switch (predicate.kind) {
    case 'all': return true;
    case 'ids': return predicate.ids.includes(entity.id);
    case 'in-spaces': return entity.spaceIds.some((id) => predicate.spaceIds.includes(id));
    case 'on-levels': return entity.levelIds.some((id) => predicate.levelIds.includes(id));
    case 'entity-type': return entity.type === predicate.entityType;
    case 'furniture-kind': return entity.furnitureKind === predicate.furnitureKind;
    case 'asset-family': return entity.familyId === predicate.familyId;
    case 'parameter-exists': return entity.parameters.some((parameter) => parameter.definitionId === predicate.definitionId);
    case 'parameter-kind': return entity.parameters.some((parameter) => parameter.value.kind === predicate.valueKind);
    case 'parameter-compare': return entity.parameters.some((parameter) => parameter.definitionId === predicate.definitionId && compare(parameter.value, predicate));
    case 'bounds': return entity.bounds !== null && (!predicate.levelIds.length || entity.levelIds.some((id) => predicate.levelIds.includes(id)))
      && (predicate.mode === 'contained' ? contains(predicate.bounds, entity.bounds) : touches(predicate.bounds, entity.bounds));
    case 'related': return related.get(predicate)?.has(entity.id) ?? false;
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}

export function resolveIndexedModelScope({ index, query: input }: { index: ModelScopeIndex; query: ModelScopeQuery }): ResolvedModelScope {
  const query = parseModelScopeQuery(input);
  const predicates = [...query.allOf, ...query.anyOf];
  predicates.forEach((predicate) => validatePredicate(index, predicate));
  query.excludeIds.forEach((id) => requireEntity(index, id));
  const related = new Map<ModelScopePredicate, Set<string>>();
  for (const predicate of predicates) if (predicate.kind === 'related') related.set(predicate, traversal(index, predicate));
  const targetIds = ordered(index.entities.filter((entity) => !query.excludeIds.includes(entity.id)
    && query.allOf.every((predicate) => matches(entity, predicate, related))
    && (!query.anyOf.length || query.anyOf.some((predicate) => matches(entity, predicate, related)))).map((entity) => entity.id));
  const writable = new Set(targetIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of index.edges) if ((edge.relation === 'hosted-by' || edge.relation === 'supported-by' || edge.relation === 'instance-of')
      && writable.has(edge.target) && !writable.has(edge.source)) { writable.add(edge.source); expanded = true; }
  }
  const relevant = new Set(writable);
  for (const predicate of predicates) {
    const refs = predicate.kind === 'ids' ? predicate.ids : predicate.kind === 'in-spaces' ? predicate.spaceIds
      : predicate.kind === 'on-levels' || predicate.kind === 'bounds' ? predicate.levelIds
      : predicate.kind === 'asset-family' ? [predicate.familyId] : predicate.kind === 'related' ? predicate.fromIds : [];
    refs.forEach((id) => relevant.add(id));
    for (const id of related.get(predicate) ?? []) relevant.add(id);
  }
  // Only writable objects seed collision context; context never grants more writes.
  for (const id of writable) {
    const entity = requireEntity(index, id);
    for (const other of index.entities) {
      if (other.id === id || !sameLevel(entity, other)) continue;
      const sameRoom = entity.spaceIds.some((room) => other.spaceIds.includes(room));
      if (sameRoom || (entity.bounds && other.bounds && touches(entity.bounds, other.bounds))) relevant.add(other.id);
      // Adjacent rooms are read observations, not an implicit selection of their contents.
      const otherBounds = other.bounds;
      if (other.type === 'Space' && otherBounds && entity.spaceIds.some((roomId) => {
        const room = requireEntity(index, roomId, 'Space'); return room.bounds && touches(room.bounds, otherBounds);
      })) relevant.add(other.id);
    }
  }
  expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of index.edges) if (relevant.has(edge.source) && !relevant.has(edge.target)) { relevant.add(edge.target); expanded = true; }
  }
  const relationshipIds = ordered(index.edges.filter((edge) => edge.id !== null && relevant.has(edge.source) && relevant.has(edge.target))
    .flatMap((edge) => edge.id === null ? [] : [edge.id]));
  const result = { targetIds, contextIds: ordered([...relevant].filter((id) => !writable.has(id))),
    dependentIds: ordered([...writable].filter((id) => !targetIds.includes(id))), writableIds: ordered(writable), relationshipIds };
  if (Object.values(result).some((ids) => ids.length > 100)) throw new Error('Resolved scope exceeds the frozen binding limit.');
  return result;
}
export function resolveModelScope({ graph, query }: { graph: ModelGraph; query: ModelScopeQuery }): ResolvedModelScope {
  return resolveIndexedModelScope({ index: createModelScopeIndex(graph), query });
}
export function freezeModelScope({ graph, query, baseRevisionId }: { graph: ModelGraph; query: ModelScopeQuery; baseRevisionId: string }): FrozenModelScope {
  return parseFrozenModelScope({ version: 1, baseRevisionId, query, ...resolveModelScope({ graph, query }) });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map((item: unknown) => canonical(item)).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]: [string, unknown]) => JSON.stringify(key) + ':' + canonical(entry)).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
function verifiedBinding(base: ModelGraph, input: FrozenModelScope): FrozenModelScope {
  const binding = parseFrozenModelScope(input);
  const expected = freezeModelScope({ graph: base, query: binding.query, baseRevisionId: binding.baseRevisionId });
  if (canonical(binding) !== canonical(expected)) throw new Error('Frozen scope evidence does not match the base; forged or changed binding.');
  return binding;
}
export function assertModelScopeFresh({ base, current, binding: input }: { base: ModelGraph; current: ModelGraph; binding: FrozenModelScope }): void {
  const binding = verifiedBinding(base, input);
  const now = freezeModelScope({ graph: current, query: binding.query, baseRevisionId: binding.baseRevisionId });
  if (canonical(now) !== canonical(binding)) throw new Error('Frozen scope membership or dependencies changed.');
  const ids = new Set([...binding.writableIds, ...binding.contextIds]);
  for (const id of ids) if (canonical(base.entities.find((entity) => entity.id === id)) !== canonical(current.entities.find((entity) => entity.id === id))) {
    throw new Error(`Frozen scope relevant entity changed: ${id}.`);
  }
  for (const id of binding.relationshipIds) if (canonical(base.relationships.find((edge) => edge.id === id)) !== canonical(current.relationships.find((edge) => edge.id === id))) {
    throw new Error(`Frozen scope relevant relationship changed: ${id}.`);
  }
}
export function assertModelScopeWrites({ before, after, binding: input }: { before: ModelGraph; after: ModelGraph; binding: FrozenModelScope }): void {
  const binding = verifiedBinding(before, input);
  const writable = new Set(binding.writableIds); const readable = new Set([...binding.contextIds, ...binding.writableIds]);
  if (before.version !== after.version || before.units !== after.units) throw new Error('Out-of-scope model format change.');
  for (const id of new Set([...before.entities, ...after.entities].map((entity) => entity.id))) {
    const previous = before.entities.find(entity => entity.id === id); const next = after.entities.find(entity => entity.id === id);
    if (previous?.type === 'AssetInstance' && next?.type === 'AssetInstance' && previous.familyId !== next.familyId
        && before.entities.some(entity => entity.id === next.familyId) && !readable.has(next.familyId)) {
      throw new Error(`Out-of-scope family dependency: ${next.familyId}.`);
    }
    if (!previous && next?.type === 'AssetFamily') {
      const instances = after.entities.filter(entity => entity.type === 'AssetInstance').filter(entity => entity.familyId === id);
      const originals = instances.map(instance => before.entities.find(entity => entity.id === instance.id));
      const originalFamilies = new Set(originals.flatMap(entity => entity?.type === 'AssetInstance' ? [entity.familyId] : []));
      if (instances.length && instances.every(instance => writable.has(instance.id))
          && originals.every(entity => entity?.type === 'AssetInstance') && originalFamilies.size === 1
          && [...originalFamilies].every(familyId => readable.has(familyId))) continue;
    }
    if (!writable.has(id) && canonical(previous) !== canonical(next)) {
      throw new Error(`Out-of-scope entity write: ${id}.`);
    }
  }
  for (const id of new Set([...before.relationships, ...after.relationships].map((edge) => edge.id))) {
    const a = before.relationships.find((edge) => edge.id === id); const b = after.relationships.find((edge) => edge.id === id);
    if (canonical(a) === canonical(b)) continue;
    if ((a && (!binding.relationshipIds.includes(a.id) || !writable.has(a.source) || !readable.has(a.target)))
      || (b && (!writable.has(b.source) || !readable.has(b.target)))) throw new Error(`Out-of-scope relationship write: ${id}.`);
  }
}
