import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Graph } from './graph.ts';
import type { Edge } from './graph.ts';
import { mix, OCCURRENCE_KINDS } from './profile.ts';
import type { EntityRef, Kind } from './profile.ts';

const scope = Type.Union([Type.Literal('definition'), Type.Literal('occurrence'), Type.Literal('intrinsic')]);
const common = { scope, override: Type.Boolean() };
export const PropertyValueSchema = Type.Union([
  Type.Object({ ...common, state: Type.Literal('known'), kind: Type.Literal('quantity'), value: Type.Number(), unit: Type.String() }, { additionalProperties: false }),
  Type.Object({ ...common, state: Type.Literal('known'), kind: Type.Literal('text'), value: Type.String() }, { additionalProperties: false }),
  Type.Object({ ...common, state: Type.Literal('known'), kind: Type.Literal('boolean'), value: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ ...common, state: Type.Union([Type.Literal('missing'), Type.Literal('unknown'), Type.Literal('notApplicable')]), kind: Type.Literal('text') }, { additionalProperties: false }),
]);
export type PropertyValue = Static<typeof PropertyValueSchema>;
export type EntityRow = {
  entity: EntityRef; typeId: number | null; spaceId: number | null; systemId: number | null;
  properties: Record<string, PropertyValue>; payload: string; source: object;
};
export type ParameterRow = { id: number; entityId: number; name: string; kind: string;
  value: object; dependsOnEntityId: number; properties: object };

function cohortIndex(ordinal: number, count: number, fractions: readonly number[]): number {
  let upper = 0;
  for (let index = 0; index < fractions.length; index += 1) {
    const fraction = fractions[index];
    if (fraction === undefined) throw new Error('Missing internal cohort.');
    upper += index === fractions.length - 1 ? count : Math.floor(count * fraction);
    if (ordinal <= upper) return index;
  }
  throw new Error('Cohort did not cover admitted entity.');
}

export function propertyCount(graph: Graph, entity: EntityRef): number {
  const profile = graph.dataset.profile;
  if (entity.kind === 'connectionPort') return profile.properties.connectionPortCountPerEntity;
  if (entity.kind === 'typeDefinition') return profile.properties.typeDefinitionCountPerEntity;
  const cohorts = profile.properties.otherEntityCohorts;
  const cohort = cohorts[cohortIndex(entity.ordinal, graph.dataset.range(entity.kind).count, cohorts.map((item) => item.fraction))];
  if (!cohort) throw new Error('Missing property cohort.');
  return cohort.valueCount;
}

export function definedKind(entity: EntityRef): Kind | null {
  return entity.kind === 'typeDefinition' ? OCCURRENCE_KINDS[(entity.ordinal - 1) % OCCURRENCE_KINDS.length] ?? null : null;
}

export function propertiesFor(graph: Graph, entity: EntityRef): Record<string, PropertyValue> {
  const count = propertyCount(graph, entity);
  const properties: Record<string, PropertyValue> = {};
  const valueScope = entity.kind === 'typeDefinition' ? 'definition'
    : OCCURRENCE_KINDS.includes(entity.kind) ? 'occurrence' : 'intrinsic';
  const classKind = definedKind(entity) ?? entity.kind;
  const type = graph.typeOf(entity);
  const common = { scope: valueScope, override: type !== null && entity.ordinal % 17 === 0 } satisfies Pick<PropertyValue, 'scope' | 'override'>;
  const names = ['identifier', 'classCode', 'nominalLength', 'enabled', 'inspection', 'finish', 'maintenance', 'description'];
  for (let index = 0; index < count; index += 1) {
    const key = names[index] ?? `field${index.toString().padStart(3, '0')}`;
    const random = mix(graph.dataset.salt ^ entity.id ^ Math.imul(index + 1, 2654435761));
    let value: PropertyValue;
    if (index === 0) value = { ...common, state: 'known', kind: 'text', value: `${graph.dataset.profile.id}:${graph.dataset.salt}:${entity.id}` };
    else if (index === 1) value = { ...common, state: 'known', kind: 'text', value: entity.kind === 'connectionPort'
      ? `synthetic:connector:system-${graph.systemOf(entity)?.id}` : `synthetic:${classKind}:${entity.ordinal % 8}` };
    else if (index === 7) value = { ...common, state: 'known', kind: 'text', value: `${classKind}-${random.toString(36)}\tline\nsource\\synthetic` };
    else if (index === 4 && entity.ordinal % 11 === 0) value = { ...common, state: 'missing', kind: 'text' };
    else if (index === 5 && entity.ordinal % 13 === 0) value = { ...common, state: 'unknown', kind: 'text' };
    else if (index === 6 && entity.ordinal % 7 === 0) value = { ...common, state: 'notApplicable', kind: 'text' };
    else if (index % 4 === 2) {
      const classBase = classKind === 'stud' ? 3000 : classKind === 'connectionPort' ? 25 : 1200;
      // Same type has the same nominal length unless the occurrence declares an override.
      const nominal = classBase + mix(graph.dataset.salt ^ (entity.kind === 'connectionPort'
        ? graph.systemOf(entity)?.id ?? entity.id : type?.id ?? entity.id)) % 500;
      value = { ...common, state: 'known', kind: 'quantity', unit: index % 8 === 2 ? 'mm' : 'W',
        value: index === 2 ? nominal + (common.override ? 10 + random % 90 : 0) : 1 + random % 5000 };
    } else if (index % 4 === 3) value = { ...common, state: 'known', kind: 'boolean', value: random % 10 < 8 };
    else value = { ...common, state: 'known', kind: 'text', value: `${classKind}-${index}-${random.toString(36)}` };
    properties[key] = value;
  }
  return properties;
}

export function boundsFor(graph: Graph, entity: EntityRef): { min: number[]; max: number[] } {
  const room = graph.spaceOf(entity);
  const zone = room ? graph.parentOf(room) : null;
  const level = zone ? graph.parentOf(zone) : entity.kind === 'level' ? entity : null;
  const building = level ? graph.parentOf(level) : entity.kind === 'building' ? entity : null;
  const index = (room?.ordinal ?? entity.ordinal) - 1;
  const random = mix(graph.dataset.salt ^ entity.id);
  const x = (building?.ordinal ?? 1) * 400 + Math.floor(index % 100 / 10) * 6;
  const y = index % 10 * 6;
  const z = ((level?.ordinal ?? 1) - 1) * 4;
  const minimum = [x + random % 10 / 100, y + (random >>> 8) % 10 / 100, z];
  const size = entity.kind === 'stud' ? [0.04, 0.09, 3] : entity.kind === 'connectionPort' ? [0.01, 0.01, 0.01]
    : entity.kind === 'wall' ? [5, 0.2, 3] : entity.kind === 'slab' ? [6, 6, 0.2] : [1, 0.5, 1.5];
  return { min: minimum, max: minimum.map((value, axis) => Math.round((value + (size[axis] ?? 1)) * 1000) / 1000) };
}

function padding(length: number, seed: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  const chunks: string[] = [];
  let state = seed;
  for (let offset = 0; offset < length; offset += 1024) {
    let chunk = '';
    for (let index = offset; index < Math.min(length, offset + 1024); index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      chunk += alphabet.charAt(state >>> 26);
    }
    chunks.push(chunk);
  }
  return chunks.join('');
}

export function payloadFor(graph: Graph, entity: EntityRef): string {
  const profile = graph.dataset.profile.geometryAndArtifacts;
  // A bijection spreads exact global cohort sizes across kinds and neighborhoods.
  const rank = ((entity.id - 1) * graph.dataset.payloadPermutationStride + graph.dataset.salt) % graph.dataset.entityCount + 1;
  const cohort = profile.payloadCohorts[cohortIndex(rank, graph.dataset.entityCount, profile.payloadCohorts.map((item) => item.fraction))];
  if (!cohort) throw new Error('Missing payload cohort.');
  const base = { bounds: boundsFor(graph, entity), mediaType: 'application/x-bim-forge-synthetic-proxy', id: entity.id, data: '' };
  const length = cohort.bytes - Buffer.byteLength(JSON.stringify(base));
  if (length < 0) throw new Error('Proxy metadata exceeds declared payload cohort.');
  return JSON.stringify({ ...base, data: padding(length, mix(graph.dataset.salt ^ entity.id)) });
}

export function entityRow(graph: Graph, entity: EntityRef): EntityRow {
  const external = graph.externalOwners.countAt(entity) === 1;
  return {
    entity, typeId: graph.typeOf(entity)?.id ?? null, spaceId: graph.spaceOf(entity)?.id ?? null,
    systemId: graph.systemOf(entity)?.id ?? null, properties: propertiesFor(graph, entity), payload: payloadFor(graph, entity),
    source: { namespace: 'synthetic-hospital', sourceFile: `${domainOfSource(entity.kind)}-${graph.dataset.salt}.synthetic`,
      sourceId: `${entity.kind}:${entity.ordinal}`, sourceRevision: 1, entityVersion: `${entity.id}@1`,
      definedKind: definedKind(entity), externalArtifact: external ? { uri: graph.externalUri(entity),
        mediaType: 'application/x-bim-forge-synthetic-reference', materializedBytes: 0 } : null,
      ownerId: entity.kind === 'connectionPort' ? graph.ownerOf(entity).id : null },
  };
}

function domainOfSource(kind: Kind): string {
  if (['ductSegment', 'ductFitting', 'terminal', 'equipment'].includes(kind)) return 'mechanical';
  if (['pipeSegment', 'pipeFitting', 'pump', 'valve'].includes(kind)) return 'plumbing';
  if (['electricalOutlet', 'switch', 'luminaire', 'electricalPanel', 'circuit', 'cableSegment', 'sensor', 'containmentSegment'].includes(kind)) return 'electrical';
  return 'architectural';
}

export function parameterRow(graph: Graph, index: number): ParameterRow {
  const parameter = graph.parameter(index);
  const amount = 10 + mix(graph.dataset.salt ^ parameter.owner.id) % 5000;
  return { id: index + 1, entityId: parameter.owner.id, name: `p-${parameter.kind}`, kind: parameter.kind,
    value: parameter.kind === 'recipe' ? { recipe: 'linear-extrusion-metadata-v1', length: amount, unit: 'mm', solverExecuted: false }
      : parameter.kind === 'typeReference' || parameter.kind === 'dependencyInput'
        ? { entityId: parameter.dependency.id, property: 'nominalLength', entityVersion: `${parameter.dependency.id}@1` }
        : { quantity: amount, unit: 'mm' },
    dependsOnEntityId: parameter.dependency.id,
    properties: { ownerVersion: `${parameter.owner.id}@1`, dependencyVersion: `${parameter.dependency.id}@1`,
      formula: parameter.kind === 'recipe' ? 'length = input.nominalLength + offset' : null,
      synthetic: true, solverExecuted: false },
  };
}

export function copyCell(value: string | number | null | object): string {
  if (value === null) return '\\N';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
}
export function copyLine(cells: readonly (string | number | null | object)[]): string { return `${cells.map(copyCell).join('\t')}\n`; }
export function entityLine(row: EntityRow): string {
  return copyLine([row.entity.id, row.entity.kind, row.entity.ordinal, row.typeId, row.spaceId, row.systemId, 1,
    row.properties, row.payload, row.source]);
}
export function edgeLine(edge: Edge, id: number): string { return copyLine([id, edge.kind, edge.source.id, edge.target.id, 1, edge.properties]); }
export function parameterLine(row: ParameterRow): string {
  return copyLine([row.id, row.entityId, row.name, row.kind, row.value, row.dependsOnEntityId, 1, row.properties]);
}

export function* lines(graph: Graph, table: 'entities' | 'relationships' | 'parameters'): Generator<string> {
  if (table === 'entities') {
    for (const range of graph.dataset.ranges.values()) {
      for (let ordinal = 1; ordinal <= range.count; ordinal += 1) yield entityLine(entityRow(graph, graph.dataset.ref(range.kind, ordinal)));
    }
  } else if (table === 'relationships') {
    let id = 0;
    for (const edge of graph.edges()) { id += 1; yield edgeLine(edge, id); }
  } else {
    for (let index = 0; index < graph.dataset.parameterCount; index += 1) yield parameterLine(parameterRow(graph, index));
  }
}
