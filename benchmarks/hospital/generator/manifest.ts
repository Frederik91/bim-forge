import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { Graph } from './graph.ts';
import { KINDS } from './profile.ts';
import { edgeLine, entityLine, entityRow, parameterLine, parameterRow } from './rows.ts';

class Distribution {
  readonly histogram = new Map<number, number>();
  count = 0;
  sum = 0;
  add(value: number, count = 1): void {
    this.histogram.set(value, (this.histogram.get(value) ?? 0) + count);
    this.count += count;
    this.sum += value * count;
  }
  report() {
    const histogram = [...this.histogram].sort(([a], [b]) => a - b);
    const quantile = (fraction: number): number => {
      const target = Math.max(1, Math.ceil(this.count * fraction));
      let cumulative = 0;
      for (const [value, count] of histogram) { cumulative += count; if (cumulative >= target) return value; }
      return 0;
    };
    return { count: this.count, sum: this.sum, mean: this.count === 0 ? 0 : this.sum / this.count,
      p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), maximum: histogram.at(-1)?.[0] ?? 0,
      histogram: histogram.map(([value, count]) => ({ value, count })) };
  }
}

class TableDigest {
  readonly hash = createHash('sha256');
  rows = 0;
  bytes = 0;
  add(line: string): void { this.hash.update(line); this.rows += 1; this.bytes += Buffer.byteLength(line); }
  report() { return { rows: this.rows, bytes: this.bytes, sha256: this.hash.digest('hex') }; }
}

export const LIMITATIONS = [
  'Synthetic densities and spatial proxies do not establish measured hospital inventory, rendering, clashes, IFC fidelity or geometric regeneration.',
  'Only revision 1 is materialized. Revision/branch/churn recipes and conflicts are input oracles; W5 must implement and measure storage-backed history and rejection behavior.',
  'Payload compression and duplicate ratios are bounded prefix samples per payload byte cohort, not full-dataset measurements.',
  'External artifact URIs are synthetic metadata; no external artifact bytes are materialized.',
  'Generator correctness observations do not cover all EX-10/EX-13 assertions or qualify database performance, durability, approvals or a production schema.',
];

export function createManifest(graph: Graph) {
  const dataset = graph.dataset;
  const entities = new TableDigest();
  const relationships = new TableDigest();
  const parameters = new TableDigest();
  const propertyBytes = new Distribution();
  const payloadBytes = new Distribution();
  const sourceBytes = new Distribution();
  const relationshipCounts: Record<string, number> = Object.fromEntries(dataset.profile.relationships.kinds.map((kind) => [kind, 0]));
  const countsByKind = Object.fromEntries(KINDS.map((kind) => [kind, dataset.range(kind).count]));
  const propertyValuesByKind: Record<string, number> = {};
  const degrees = new Map<string, { incoming: Distribution; outgoing: Distribution; total: Distribution }>();
  for (const kind of dataset.profile.relationships.kinds) degrees.set(kind, {
    incoming: new Distribution(), outgoing: new Distribution(), total: new Distribution(),
  });
  const samples = new Map<number, { count: number; bytes: number; compressedBytes: number; hashes: Set<string> }>();
  const selectedSpace = dataset.ref('space', 1);
  const selectedType = dataset.ref('typeDefinition', 1);
  const selectedSystem = dataset.ref('system', 1);
  const selections = [
    { caseId: 'hot-space-members', column: 'space_id', id: selectedSpace.id, count: 0, hash: createHash('sha256') },
    { caseId: 'shared-type-members', column: 'type_id', id: selectedType.id, count: 0, hash: createHash('sha256') },
    { caseId: 'system-members-including-ports', column: 'system_id', id: selectedSystem.id, count: 0, hash: createHash('sha256') },
  ];
  let logicalPropertyValues = 0;
  let externalArtifactReferences = 0;
  let explicitOverrides = 0;
  let parameterOwnerIdSum = 0;
  let parameterDependencyIdSum = 0;
  let selectedTypeParameterDependencies = 0;
  const parameterForms: Record<string, number> = {};
  for (const range of dataset.ranges.values()) {
    let values = 0;
    for (let ordinal = 1; ordinal <= range.count; ordinal += 1) {
      const entity = dataset.ref(range.kind, ordinal);
      const row = entityRow(graph, entity);
      const properties = JSON.stringify(row.properties);
      const propertyCount = Object.keys(row.properties).length;
      values += propertyCount;
      logicalPropertyValues += propertyCount;
      propertyBytes.add(Buffer.byteLength(properties));
      const size = Buffer.byteLength(row.payload);
      payloadBytes.add(size);
      sourceBytes.add(Buffer.byteLength(JSON.stringify(row.source)));
      entities.add(entityLine(row));
      externalArtifactReferences += graph.externalOwners.countAt(entity);
      if (Object.values(row.properties).some((property) => property.override)) explicitOverrides += 1;
      const sample = samples.get(size) ?? { count: 0, bytes: 0, compressedBytes: 0, hashes: new Set<string>() };
      if (sample.count < 64) {
        sample.count += 1;
        sample.bytes += size;
        sample.compressedBytes += deflateRawSync(row.payload).byteLength;
        sample.hashes.add(createHash('sha256').update(row.payload).digest('hex'));
        samples.set(size, sample);
      }
      for (const selection of selections) {
        const value = selection.column === 'space_id' ? row.spaceId : selection.column === 'type_id' ? row.typeId : row.systemId;
        if (value === selection.id) { selection.count += 1; selection.hash.update(`${entity.id}\n`); }
      }
      for (const [kind, degree] of graph.degrees(entity)) {
        const distributions = degrees.get(kind);
        if (!distributions) throw new Error(`Relationship kind not declared by profile: ${kind}`);
        if (degree.incoming > 0) distributions.incoming.add(degree.incoming);
        if (degree.outgoing > 0) distributions.outgoing.add(degree.outgoing);
        distributions.total.add(degree.incoming + degree.outgoing);
      }
    }
    propertyValuesByKind[range.kind] = values;
  }
  let edgeId = 0;
  for (const edge of graph.edges()) {
    edgeId += 1;
    relationships.add(edgeLine(edge, edgeId));
    relationshipCounts[edge.kind] = (relationshipCounts[edge.kind] ?? 0) + 1;
  }
  for (let index = 0; index < dataset.parameterCount; index += 1) {
    const row = parameterRow(graph, index);
    parameters.add(parameterLine(row));
    parameterOwnerIdSum += row.entityId;
    parameterDependencyIdSum += row.dependsOnEntityId;
    if (row.dependsOnEntityId === selectedType.id) selectedTypeParameterDependencies += 1;
    parameterForms[row.kind] = (parameterForms[row.kind] ?? 0) + 1;
  }
  const degreeDistributions = Object.fromEntries([...degrees].map(([kind, values]) => {
    for (const distribution of [values.incoming, values.outgoing, values.total]) {
      if (distribution.count < dataset.entityCount) distribution.add(0, dataset.entityCount - distribution.count);
    }
    const expected = relationshipCounts[kind] ?? 0;
    if (values.incoming.sum !== expected || values.outgoing.sum !== expected) throw new Error(`Degree oracle disagrees with generated ${kind} edges.`);
    return [kind, { incoming: values.incoming.report(), outgoing: values.outgoing.report(), total: values.total.report() }];
  }));
  const target = Math.floor(dataset.profile.relationships.targetCount * dataset.fraction);
  const tolerance = dataset.profile.relationships.targetToleranceFraction;
  const student = dataset.ref('stud', 1);
  const host = graph.parentOf(student);
  const overrideWall = dataset.ref('wall', Math.min(17, dataset.range('wall').count));
  return {
    schemaVersion: 1, wireFormat: 'bim-forge-hospital-copy-text-v1', profileId: dataset.profile.id,
    profileSha256: dataset.profileSha256, seed: dataset.seed, scale: dataset.options.scale, inventoryFraction: dataset.fraction,
    claim: 'Synthetic database stress input; no qualification or real hospital inventory is asserted.',
    tables: { entities: entities.report(), relationships: relationships.report(), parameters: parameters.report() },
    countsByKind, propertyValuesByKind, logicalPropertyValues, propertyEstimate: dataset.profile.properties.estimatedFullPropertyValueCount,
    propertyEstimateIsMeasured: false,
    rounding: KINDS.map((kind) => ({ kind, requested: dataset.profile.inventory.countsByKind[kind] * dataset.fraction,
      admitted: dataset.range(kind).count, adjustmentFromFloor: dataset.range(kind).count - Math.floor(dataset.profile.inventory.countsByKind[kind] * dataset.fraction) })),
    relationshipCounts, relationshipTarget: { target, toleranceFraction: tolerance, actual: edgeId,
      difference: edgeId - target, withinTolerance: Math.abs(edgeId - target) <= target * tolerance,
      rule: 'No graph padding; skeleton rounding may exceed reduced-scale target tolerance.' },
    degreeDistributions, degreePopulation: 'All admitted entities, including zero-degree entities, separately by predicate and direction.',
    propertyJsonBytes: propertyBytes.report(), payloadJsonBytes: payloadBytes.report(), sourceJsonBytes: sourceBytes.report(),
    payloadSamples: [...samples].map(([bytes, sample]) => ({ cohortBytes: bytes, strategy: 'first at most 64 entities in each byte cohort, in entity-ID order',
      count: sample.count, bytes: sample.bytes, deflateRawBytes: sample.compressedBytes,
      deflateRawRatio: sample.compressedBytes / sample.bytes, uniqueSha256: sample.hashes.size,
      duplicateFraction: 1 - sample.hashes.size / sample.count })),
    externalArtifactReferences, materializedExternalArtifactBytes: 0, explicitOverrideEntities: explicitOverrides,
    parameterForms,
    oracles: [
      { caseId: 'entity-count', sql: 'SELECT count(*) FROM entities', expected: dataset.entityCount },
      { caseId: 'entity-id-sum', sql: 'SELECT sum(id) FROM entities', expected: dataset.entityCount * (dataset.entityCount + 1) / 2 },
      { caseId: 'logical-property-values', sql: 'SELECT count(*) FROM entities e CROSS JOIN LATERAL jsonb_object_keys(e.properties) k', expected: logicalPropertyValues },
      { caseId: 'relationship-count', sql: 'SELECT count(*) FROM relationships', expected: edgeId },
      { caseId: 'parameter-count', sql: 'SELECT count(*) FROM parameters', expected: dataset.parameterCount },
      { caseId: 'parameter-owner-sum', sql: 'SELECT sum(entity_id) FROM parameters', expected: parameterOwnerIdSum },
      { caseId: 'parameter-dependency-sum', sql: 'SELECT sum(depends_on_entity_id) FROM parameters', expected: parameterDependencyIdSum },
      { caseId: 'external-artifact-reference-count', sql: "SELECT count(*) FROM entities WHERE source->'externalArtifact' <> 'null'::jsonb", expected: externalArtifactReferences },
      ...selections.map((selection) => ({ caseId: selection.caseId,
        sql: `SELECT count(*) FROM entities WHERE ${selection.column} = ${selection.id}`, expected: selection.count,
        orderedIdCopySql: `COPY (SELECT id FROM entities WHERE ${selection.column} = ${selection.id} ORDER BY id) TO STDOUT`,
        orderedIdSha256: selection.hash.digest('hex') })),
    ],
    deltaOracles: {
      ordinaryChange: { numerator: 1, denominator: 1000, changedEntities: Math.max(1, Math.floor(dataset.occurrenceCount / 1000)),
        entitySelection: 'Quantile positions floor(i * occurrenceCount / changedEntities) in profile occurrence-kind order.',
        immutableBaseRevision: 1, operation: 'Change description typed text value on each selected occurrence; preserve all IDs and other values.' },
      sharedTypeEdit: { typeId: selectedType.id, directOccurrences: selections.find((item) => item.column === 'type_id')?.count ?? 0,
        parameterDependencies: selectedTypeParameterDependencies, changedDefinitionRows: 1,
        operation: 'Change type nominalLength; explicit occurrence overrides survive, dependent parameters require reevaluation.' },
      deleteRecreate: { deletedId: student.id, replacementId: dataset.entityCount + 1, lineage: 'explicit replacementOf relation in proposal metadata',
        incidentEdgesRemoved: Object.fromEntries([...graph.degrees(student)].map(([kind, value]) => [kind, value.incoming + value.outgoing])),
        expected: 'New identity; preserve history and reject dangling host/port/parameter endpoints atomically.' },
      conflicts: [
        { caseId: 'delete-host-retain-dependent', hostId: host?.id ?? null, dependentId: student.id,
          expected: 'Reject deletion without removing or rehosting all dependents; no partial commit.' },
        { caseId: 'shared-type-versus-occurrence-override', entityId: overrideWall.id, typeId: graph.typeOf(overrideWall)?.id ?? null,
          hasExplicitOverride: overrideWall.ordinal % 17 === 0,
          expected: 'Preserve explicit occurrence scope; concurrent writes to the same scoped field conflict.' },
      ],
      historyRecipes: { acceptedRevisionCounts: [1, 10, 100, 1000], branchCounts: [1, 8, 32],
        includesMaterializedHistory: false, rejectedProposal: 'Two proposals write different known nominalLength values to the same entity/scope/base revision; preserve rejected evidence.' },
    },
    limitations: LIMITATIONS,
  };
}

export type Manifest = ReturnType<typeof createManifest>;
