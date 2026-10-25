import process from 'node:process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Check } from 'typebox/value';
import { parseObservations } from '../../../experiments/contracts/schema.ts';
import type { Observation } from '../../../experiments/contracts/schema.ts';
import { Graph } from './graph.ts';
import { Dataset, KINDS, OCCURRENCE_KINDS, loadProfile, parseOptions } from './profile.ts';
import { createManifest, LIMITATIONS } from './manifest.ts';
import type { Manifest } from './manifest.ts';
import { PropertyValueSchema, definedKind, entityRow, lines, parameterRow } from './rows.ts';

export function decodeCopyLine(line: string): (string | null)[] {
  if (!line.endsWith('\n')) throw new Error('COPY row must end with LF.');
  return line.slice(0, -1).split('\t').map((cell) => {
    if (cell === '\\N') return null;
    let decoded = '';
    for (let index = 0; index < cell.length; index += 1) {
      const char = cell.charAt(index);
      if (char !== '\\') { decoded += char; continue; }
      index += 1;
      switch (cell.charAt(index)) {
        case '\\': decoded += '\\'; break;
        case 't': decoded += '\t'; break;
        case 'n': decoded += '\n'; break;
        case 'r': decoded += '\r'; break;
        default: throw new Error('Unsupported COPY escape.');
      }
    }
    return decoded;
  });
}

function digest(graph: Graph, table: 'entities' | 'relationships' | 'parameters') {
  const hash = createHash('sha256');
  let rows = 0;
  let bytes = 0;
  for (const line of lines(graph, table)) {
    hash.update(line); rows += 1; bytes += Buffer.byteLength(line);
    const columns = decodeCopyLine(line);
    const expectedColumns = table === 'entities' ? 10 : table === 'relationships' ? 6 : 8;
    if (columns.length !== expectedColumns) throw new Error(`Wrong ${table} column count.`);
    const jsonColumns = table === 'entities' ? [7, 8, 9] : table === 'relationships' ? [5] : [4, 7];
    for (const index of jsonColumns) {
      const column = columns[index];
      if (typeof column !== 'string') throw new Error('JSON cell cannot be SQL null.');
      const parsed: unknown = JSON.parse(column);
      if (parsed === null || typeof parsed !== 'object') throw new Error('Expected a JSON object cell.');
    }
  }
  return { rows, bytes, sha256: hash.digest('hex') };
}

function checkTopology(graph: Graph): string {
  const seen = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const portOwners = new Map<number, number>();
  let count = 0;
  for (const edge of graph.edges()) {
    if (graph.dataset.locate(edge.source.id).kind !== edge.source.kind || graph.dataset.locate(edge.target.id).kind !== edge.target.kind) throw new Error('Dangling or mistyped edge.');
    const key = `${edge.kind}:${edge.source.id}:${edge.target.id}`;
    if (seen.has(key) || edge.source.id === edge.target.id) throw new Error('Duplicate or self edge.');
    seen.add(key);
    const sourceKey = `${edge.kind}:${edge.source.id}`;
    const targetKey = `${edge.kind}:${edge.target.id}`;
    outgoing.set(sourceKey, (outgoing.get(sourceKey) ?? 0) + 1);
    incoming.set(targetKey, (incoming.get(targetKey) ?? 0) + 1);
    if (edge.kind === 'hasPort') {
      if (edge.target.kind !== 'connectionPort' || !graph.systemOf(edge.source)) throw new Error('Invalid port owner.');
      if (portOwners.has(edge.target.id)) throw new Error('Port has more than one owner.');
      portOwners.set(edge.target.id, edge.source.id);
    }
    if (edge.kind === 'instanceOf' && (edge.target.kind !== 'typeDefinition' || definedKind(edge.target) !== edge.source.kind)) throw new Error('Instance type class mismatch.');
    if (edge.kind === 'memberOfSystem' && edge.target.kind !== 'system') throw new Error('System endpoint mismatch.');
    if (edge.kind === 'hostedBy' && edge.target.kind !== 'wall') throw new Error('Invalid wall-host endpoint.');
    if (edge.kind === 'supportedBy' && !['slab', 'containmentSegment'].includes(edge.target.kind)) throw new Error('Invalid support endpoint.');
    if (edge.kind === 'boundsSpace' && (edge.source.kind !== 'wall' || edge.target.kind !== 'space')) throw new Error('Invalid boundary endpoints.');
    if (edge.kind === 'connectedTo') {
      if (edge.source.kind !== 'connectionPort' || edge.target.kind !== 'connectionPort') throw new Error('Connection must join ports.');
      const first = graph.systemOf(edge.source);
      const second = graph.systemOf(edge.target);
      if (!first || !second || first.id !== second.id || graph.ownerOf(edge.source).id === graph.ownerOf(edge.target).id) throw new Error('Ports do not have distinct compatible owners.');
      const firstRow = entityRow(graph, edge.source);
      const secondRow = entityRow(graph, edge.target);
      if (JSON.stringify(firstRow.properties.classCode) !== JSON.stringify(secondRow.properties.classCode)
          || JSON.stringify(firstRow.properties.nominalLength) !== JSON.stringify(secondRow.properties.nominalLength)) throw new Error('Connector class or size mismatch.');
    }
    count += 1;
  }
  if (portOwners.size !== graph.dataset.range('connectionPort').count) throw new Error('Unowned port.');
  for (const range of graph.dataset.ranges.values()) {
    for (let ordinal = 1; ordinal <= range.count; ordinal += 1) {
      const entity = graph.dataset.ref(range.kind, ordinal);
      const actualDegrees = graph.degrees(entity);
      for (const kind of graph.dataset.profile.relationships.kinds) {
        const actual = actualDegrees.get(kind) ?? { incoming: 0, outgoing: 0 };
        if (actual.incoming !== (incoming.get(`${kind}:${entity.id}`) ?? 0)
            || actual.outgoing !== (outgoing.get(`${kind}:${entity.id}`) ?? 0)) throw new Error(`Degree mismatch: ${kind}/${entity.id}`);
      }
      const contained = outgoing.get(`containedIn:${entity.id}`) ?? 0;
      if (contained !== (entity.kind === 'site' || entity.kind === 'connectionPort' ? 0 : 1)) throw new Error('Containment cardinality mismatch.');
      if ((outgoing.get(`instanceOf:${entity.id}`) ?? 0) !== (OCCURRENCE_KINDS.includes(entity.kind) ? 1 : 0)) throw new Error('Type cardinality mismatch.');
      if (entity.kind === 'connectionPort' && (incoming.get(`connectedTo:${entity.id}`) ?? 0) + (outgoing.get(`connectedTo:${entity.id}`) ?? 0) > 1) throw new Error('Port connected more than once.');
      const visited = new Set<number>();
      let current = entity;
      let parent = graph.parentOf(current);
      while (parent) {
        if (visited.has(parent.id)) throw new Error('Containment cycle.');
        visited.add(parent.id); current = parent; parent = graph.parentOf(current);
      }
      const space = graph.spaceOf(entity);
      if ((OCCURRENCE_KINDS.includes(entity.kind) || entity.kind === 'connectionPort') && !space) throw new Error('Occurrence or port lacks inherited spatial scope.');
      for (const property of Object.values(entityRow(graph, entity).properties)) {
        if (!Check(PropertyValueSchema, property)) throw new Error('Invalid typed property.');
      }
    }
  }
  return `${count} typed unique edges; all entity degrees match independently counted endpoints; all ports owned and spatial chains acyclic`;
}

function checkParameters(graph: Graph): string {
  const seen = new Set<number>();
  const dependencies = new Set<string>();
  for (const edge of graph.edges()) if (edge.kind === 'parameterDependsOn') dependencies.add(`${edge.source.id}:${edge.target.id}`);
  for (let index = 0; index < graph.dataset.parameterCount; index += 1) {
    const row = parameterRow(graph, index);
    if (row.id !== index + 1 || seen.has(row.entityId) || !dependencies.has(`${row.entityId}:${row.dependsOnEntityId}`)) throw new Error('Parameter owner/dependency mismatch.');
    graph.dataset.locate(row.entityId); graph.dataset.locate(row.dependsOnEntityId);
    if (graph.parameterIndex(graph.dataset.locate(row.entityId)) !== index) throw new Error('Parameter inverse mapping mismatch.');
    seen.add(row.entityId);
    const properties = JSON.stringify(row.properties);
    if (!properties.includes(`${row.entityId}@1`) || !properties.includes(`${row.dependsOnEntityId}@1`)) throw new Error('Missing version binding.');
  }
  return `${seen.size} unique version-bound parameters with matching typed dependency edges`;
}

export function runChecks(graph: Graph): { observations: Observation[]; manifest: Manifest | null } {
  if (graph.dataset.fraction > 0.001 || graph.dataset.entityCount > 10_000) throw new Error('Independent in-memory checker admits smoke or smaller only; full generation is streaming.');
  const observations: Observation[] = [];
  let manifest: Manifest | null = null;
  const observe = (caseId: string, expected: string, check: () => string): void => {
    try { observations.push({ experimentId: 'EX-13', caseId, expected, observed: check(), passed: true, limitations: LIMITATIONS }); }
    catch (error: unknown) { observations.push({ experimentId: 'EX-13', caseId, expected,
      observed: error instanceof Error ? error.message : 'Check failed.', passed: false, limitations: LIMITATIONS }); }
  };
  observe('hospital-generator-manifest', 'Counts, logical properties, exact degree sums and payload byte cohorts agree.', () => {
    manifest = createManifest(graph);
    if (manifest.tables.entities.rows !== graph.dataset.entityCount || manifest.tables.parameters.rows !== graph.dataset.parameterCount
        || Object.values(manifest.countsByKind).reduce((sum, count) => sum + count, 0) !== graph.dataset.entityCount) throw new Error('Inventory count mismatch.');
    const admittedPayloadBytes = new Set(graph.dataset.profile.geometryAndArtifacts.payloadCohorts.map((cohort) => cohort.bytes));
    if (manifest.payloadJsonBytes.histogram.some((bucket) => !admittedPayloadBytes.has(bucket.value))) throw new Error('Payload byte cohort mismatch.');
    if (Object.keys(manifest.countsByKind).length !== KINDS.length) throw new Error('Missing kinds.');
    return `${manifest.tables.entities.rows} entities; ${manifest.tables.relationships.rows} relationships; ${manifest.logicalPropertyValues} logical property values`;
  });
  observe('hospital-generator-topology', 'Typed endpoints, scope/cardinality, compatible port connections, no duplicates, exact degree histograms.', () => checkTopology(graph));
  observe('hospital-generator-parameters', 'Unique parameter records resolve owner/dependency IDs and revision bindings.', () => checkParameters(graph));
  observe('hospital-generator-copy-and-determinism', 'Exact COPY-byte SHA-256, row/byte counts, JSON round trips, repeated seeded streams agree.', () => {
    if (!manifest) throw new Error('Manifest unavailable from failed count check.');
    for (const table of ['entities', 'relationships', 'parameters'] satisfies ('entities' | 'relationships' | 'parameters')[]) {
      const first = digest(graph, table);
      const second = digest(graph, table);
      if (JSON.stringify(first) !== JSON.stringify(second) || JSON.stringify(first) !== JSON.stringify(manifest.tables[table])) throw new Error(`${table} digest mismatch.`);
    }
    return 'All three independently serialized table streams match manifest and repeat bytes exactly.';
  });
  return { observations: parseObservations(observations), manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const loaded = loadProfile(options.profile);
    const result = runChecks(new Graph(new Dataset(loaded.profile, loaded.sha256, options)));
    process.stdout.write(`${JSON.stringify(result.observations, null, 2)}\n`);
    if (result.observations.some((observation) => !observation.passed)) process.exitCode = 1;
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Generator checker failed.'}\n`);
    process.exitCode = 1;
  }
}
