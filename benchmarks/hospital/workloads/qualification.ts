import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { canonical, errorMessage, hash, HashSchema, IdSchema, JsonSchema, parse } from '../../../experiments/storage/contract.ts';
import type { Json, Observation } from '../../../experiments/storage/contract.ts';
import { Storage } from '../../../experiments/storage/store.ts';
import { selectionOracles, verifySelections } from '../../../experiments/storage/selections.ts';
import { W4GeneratorSchema, W4InputSchema } from '../../../experiments/storage/w4.ts';

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const counts = Type.Record(Type.String(), count);
const fingerprint = Type.Object({ count, sum: HashSchema, xor: HashSchema });
const inventory = Type.Object({ fingerprint, countsByKind: counts });
const priorFiles = Type.Object({ 'config.json': HashSchema, 'load.json': HashSchema, 'oracle.json': HashSchema,
  'property-values.json': HashSchema, 'observations.json': HashSchema, 'errors.json': HashSchema }, { additionalProperties: false });
const boundFile = Type.Object({ file: Type.String({ minLength: 1 }), sha256: HashSchema }, { additionalProperties: false });
export const QualificationSchema = Type.Object({
  runId: IdSchema, branch: IdSchema, scale: Type.Union([Type.Literal('full'), Type.Literal('smoke')]),
  sourceCommit: Type.String({ pattern: '^[a-f0-9]{40}$' }), manifest: boundFile, admission: boundFile,
  priorAdmissionDir: Type.String({ minLength: 1 }), priorSha256: priorFiles,
  repeats: Type.Integer({ minimum: 1, maximum: 5 }), pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  maximumSelectionRows: Type.Integer({ minimum: 1, maximum: 1000000 }),
  statementTimeoutMs: Type.Integer({ minimum: 100, maximum: 60000 }),
  wallTimeMs: Type.Integer({ minimum: 1000, maximum: 900000 }),
}, { additionalProperties: false });
type Config = Static<typeof QualificationSchema>;
const LoadSchema = Type.Object({ revisionId: HashSchema, fingerprint, countsByKind: counts,
  propertyValuesByRecordCategory: counts, fileSha256: HashSchema });
const ManifestSchema = Type.Object({ scale: Type.String(), inventoryFraction: Type.Number(),
  tables: Type.Object({ entities: Type.Object({ rows: count, sha256: HashSchema }),
    relationships: Type.Object({ rows: count, sha256: HashSchema }), parameters: Type.Object({ rows: count, sha256: HashSchema }) }),
  countsByKind: counts, relationshipCounts: counts, parameterForms: counts, logicalPropertyValues: count });
const PriorConfigSchema = Type.Object({ branch: IdSchema, scale: Type.String(), experimentId: Type.Literal('EX-13'),
  format: Type.Union([Type.Literal('w4-copy'), Type.Literal('w4-generator')]), dataset: Type.String(),
  execution: Type.Object({ mode: Type.Object({ kind: Type.Literal('load-only') }) }),
  environment: Type.Object({ sourceCommit: Type.String() }) });
const priorObservations = Type.Array(Type.Object({ caseId: Type.String(), passed: Type.Boolean() }));
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const json = (bytes: Buffer): unknown => JSON.parse(bytes.toString('utf8'));
function requireEqual(actual: Json, expected: Json, label: string): void {
  if (canonical(actual) !== canonical(expected)) throw new Error(`${label} mismatch`);
}

export async function validatePriorAdmission(config: Config, retain: (name: string, bytes: Buffer) => Promise<void>) {
  const readBound = async (file: string, expected: string, name: string): Promise<Buffer> => {
    const bytes = await readFile(file);
    await retain(name, bytes);
    if (sha256(bytes) !== expected) throw new Error(`${name} exact bytes hash mismatch`);
    return bytes;
  };
  const admissionBytes = await readBound(config.admission.file, config.admission.sha256, 'admission.json');
  const rawAdmission = json(admissionBytes);
  const manifestBytes = await readBound(config.manifest.file, config.manifest.sha256, 'manifest.json');
  const rawManifest = json(manifestBytes);
  const manifest = parse(ManifestSchema, rawManifest, 'hospital manifest');
  const documents = new Map<string, unknown>();
  for (const [name, digest] of Object.entries(config.priorSha256)) {
    documents.set(name, json(await readBound(path.join(config.priorAdmissionDir, name), digest, `prior-${name}`)));
  }
  const prior = parse(PriorConfigSchema, documents.get('config.json'), 'prior admission config');
  const admission = prior.format === 'w4-generator' ? parse(W4GeneratorSchema, rawAdmission, 'generator admission')
    : parse(W4InputSchema, rawAdmission, 'COPY admission');
  const loaded = parse(LoadSchema, documents.get('load.json'), 'prior load');
  const oracle = parse(Type.Object({ expected: inventory, actual: inventory }), documents.get('oracle.json'), 'prior oracle');
  const properties = parse(Type.Object({ expected: counts, actual: counts }), documents.get('property-values.json'), 'prior properties');
  const observations = parse(priorObservations, documents.get('observations.json'), 'prior observations');
  parse(Type.Array(Type.String(), { maxItems: 0 }), documents.get('errors.json'), 'prior errors');
  if (prior.branch !== config.branch || prior.scale !== config.scale || manifest.scale !== config.scale
      || prior.environment.sourceCommit !== config.sourceCommit) throw new Error('Prior branch/scale/source binding mismatch');
  // Retained config binds its dataset by exact admission bytes, independent of a relocated mount path.
  if (!prior.dataset || loaded.fileSha256 !== config.admission.sha256) throw new Error('Prior admission bytes binding mismatch');
  if (admission.sourceManifest.sha256 !== config.manifest.sha256) throw new Error('Source manifest binding mismatch');
  const tables: ('entities' | 'relationships' | 'parameters')[] = ['entities', 'relationships', 'parameters'];
  for (const table of tables) {
    const source = admission.tables[table]; const expected = manifest.tables[table];
    if (!source || !expected || source.rows !== expected.rows || source.sha256 !== expected.sha256) throw new Error('Source table binding mismatch');
  }
  if (config.scale === 'full' && (manifest.inventoryFraction !== 1 || manifest.tables.entities.rows !== 6777445
      || manifest.tables.relationships.rows !== 18742644 || manifest.tables.parameters.rows !== 1500000)) throw new Error('Full inventory required');
  const expectedKinds: Record<string, number> = {};
  for (const source of [manifest.countsByKind, manifest.relationshipCounts,
    Object.fromEntries(Object.entries(manifest.parameterForms).map(([kind, n]) => [`parameter:${kind}`, n]))]) {
    for (const [kind, n] of Object.entries(source)) expectedKinds[kind] = (expectedKinds[kind] ?? 0) + n;
  }
  const total = Object.values(manifest.tables).reduce((sum, table) => sum + table.rows, 0);
  if (total < 1 || loaded.fingerprint.count !== total || Object.values(expectedKinds).reduce((a, b) => a + b, 0) !== total) throw new Error('Admission count fidelity mismatch');
  requireEqual(loaded.countsByKind, expectedKinds, 'Manifest kind counts');
  const expectedInventory = { fingerprint: loaded.fingerprint, countsByKind: loaded.countsByKind };
  requireEqual(oracle.expected, expectedInventory, 'Load/oracle'); requireEqual(oracle.actual, expectedInventory, 'Readback oracle');
  requireEqual(properties.expected, loaded.propertyValuesByRecordCategory, 'Load/property oracle');
  requireEqual(properties.actual, properties.expected, 'Property fidelity');
  if (properties.actual.entities !== manifest.logicalPropertyValues) throw new Error('Manifest logical property count mismatch');
  for (const caseId of ['source-query-oracle', 'initial-inventory']) {
    const matches = observations.filter((row) => row.caseId === caseId);
    if (matches.length !== 1 || matches[0]?.passed !== true) throw new Error(`Missing successful ${caseId}`);
  }
  if (observations.some((row) => !row.passed)) throw new Error('Prior admission contains failed observations');
  selectionOracles(rawManifest);
  return { loaded, manifest: rawManifest };
}

export async function runQualification(rawConfig: unknown, directory: string) {
  const config = parse(QualificationSchema, rawConfig, 'qualification config');
  await mkdir(directory);
  const artifact = async (name: string, value: unknown): Promise<void> => {
    await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o444 });
  };
  const observations: Observation[] = []; const errors: string[] = []; const files: string[] = [];
  const observe = (caseId: string, passed: boolean, observed: string): void => {
    observations.push({ experimentId: 'EX-13', caseId, passed, expected: 'Bounded qualification check completes with fidelity', observed,
      limitations: ['Exploratory small sample, concurrency 1; no full history/branch/client matrix or combined qualification verdict.'] });
  };
  const connection: { client: Client | null } = { client: null }; let expired = false;
  let committedChanges = 0; let verifiedChanges = 0;
  const sampleCounts: Record<string, { attempted: number; succeeded: number; errors: number }> = {};
  const deadline = performance.now() + config.wallTimeMs;
  const timer = setTimeout(() => { expired = true; void connection.client?.end().catch(() => undefined); }, config.wallTimeMs);
  const connect = async (): Promise<Storage> => {
    const database = process.env.DATABASE_URL;
    if (!database || !process.env.QVM_EXECUTION_LEASE) throw new Error('Explicit DATABASE_URL and QVM_EXECUTION_LEASE required');
    const client = new Client({ connectionString: database, connectionTimeoutMillis: config.statementTimeoutMs,
      query_timeout: config.wallTimeMs, statement_timeout: config.statementTimeoutMs, application_name: config.runId });
    connection.client = client;
    await client.connect(); const store = new Storage(client); await store.assertIsolated(); return store;
  };
  const prepare = async (store: Storage): Promise<void> => {
    const remaining = Math.floor(deadline - performance.now());
    if (expired || remaining < 1) throw new Error('Qualification wall-time limit exceeded');
    await store.client.query(`SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$1,false)`,
      [String(Math.min(config.statementTimeoutMs, remaining))]);
  };
  const sample = async <T extends Json>(store: Storage, operation: string, repeat: number, work: () => Promise<T>): Promise<T> => {
    const started = performance.now(); let result: Json = null; let error: string | null = null;
    try { await prepare(store); result = await work(); return result; }
    catch (failure) { error = errorMessage(failure); throw failure; }
    finally {
      const totals = sampleCounts[operation] ?? { attempted: 0, succeeded: 0, errors: 0 };
      totals.attempted += 1; if (error === null) totals.succeeded += 1; else totals.errors += 1; sampleCounts[operation] = totals;
      await appendFile(path.join(directory, 'samples.ndjson'), `${JSON.stringify({ operation, repeat,
        elapsedMs: performance.now() - started, result, error })}\n`);
    }
  };
  try {
    await artifact('config.json', config);
    await writeFile(path.join(directory, 'samples.ndjson'), '', { flag: 'wx' });
    const admitted = await validatePriorAdmission(config, async (name, bytes) => {
      await writeFile(path.join(directory, name), bytes, { flag: 'wx', mode: 0o444 }); files.push(name);
    });
    let store = await connect(); await prepare(store);
    if (await store.head(config.branch) !== admitted.loaded.revisionId) throw new Error('Branch head differs from admitted revision');
    const [revision] = await store.rows(Type.Object({ payload: JsonSchema, command_id: IdSchema }),
      'SELECT payload,command_id FROM qvm_storage.revisions WHERE revision_id=$1', [admitted.loaded.revisionId]);
    const initialPayload = { operation: 'initial-load', branch: config.branch,
      fingerprint: admitted.loaded.fingerprint, countsByKind: admitted.loaded.countsByKind };
    if (!revision || revision.command_id !== `load:${admitted.loaded.revisionId}`) throw new Error('Not an initial load revision');
    requireEqual(revision.payload, initialPayload, 'Published admission payload');
    if (hash(revision.payload) !== admitted.loaded.revisionId) throw new Error('Published admission hash mismatch');
    observe('preserved-admission', true, JSON.stringify({ revisionId: admitted.loaded.revisionId, priorSha256: config.priorSha256 }));
    const selections = await verifySelections(store, admitted.manifest, { branch: config.branch,
      manifestSha256: config.manifest.sha256, pageSize: 1000, maximumRows: config.maximumSelectionRows,
      statementTimeoutMs: config.statementTimeoutMs, wallTimeMs: Math.max(1, Math.floor(deadline - performance.now())) });
    await artifact('selections.json', selections); observations.push(...selections.observations);
    if (!selections.passed || selections.revisionId !== admitted.loaded.revisionId) throw new Error('Independent selection oracle failed');
    await prepare(store);
    const firstPage = await store.page({ branch: config.branch, after: '', limit: config.pageSize });
    const first = firstPage[0]; if (!first) throw new Error('Missing admitted page');
    const checkRows = (rows: typeof firstPage): string => {
      if (rows.some((row) => hash(row.entity) !== row.versionId)) throw new Error('Body/version hash mismatch');
      return hash(rows.map((row) => row.entity));
    };
    const pageHash = checkRows(firstPage);
    const [seed] = await store.rows(Type.Object({ from_id: IdSchema }),
      'SELECT from_id FROM qvm_storage.visibility WHERE branch=$1 AND from_id IS NOT NULL ORDER BY from_id,entity_id LIMIT 1', [config.branch]);
    if (!seed) throw new Error('Missing one-hop seed');
    const edges = await store.projection({ branch: config.branch, field: 'from_id', id: seed.from_id, limit: config.pageSize });
    const edgeHash = checkRows(edges);
    for (let repeat = 0; repeat < config.repeats; repeat += 1) {
      await sample(store, 'page', repeat, async () => {
        const rows = await store.page({ branch: config.branch, after: '', limit: config.pageSize });
        requireEqual(checkRows(rows), pageHash, 'Page'); return { count: rows.length, checksum: pageHash };
      });
      await sample(store, 'detail', repeat, async () => {
        const row = await store.detail({ branch: config.branch, entityId: first.entity.entityId });
        if (!row || row.versionId !== first.versionId || hash(row.entity) !== first.versionId) throw new Error('Detail fidelity mismatch');
        return { count: 1, versionId: row.versionId };
      });
      await sample(store, 'one-hop', repeat, async () => {
        const rows = await store.projection({ branch: config.branch, field: 'from_id', id: seed.from_id, limit: config.pageSize });
        if (rows.some((row) => row.entity.fromId !== seed.from_id)) throw new Error('One-hop predicate mismatch');
        requireEqual(checkRows(rows), edgeHash, 'One-hop'); return { count: rows.length, checksum: edgeHash, capped: rows.length === config.pageSize };
      });
    }
    observe('interactive-samples', true, `${config.repeats} samples per operation; errors=0`);
    let head = admitted.loaded.revisionId; let version = first.versionId;
    const retainedVersions = new Map([[head, version]]);
    for (let index = 0; index < 2; index += 1) {
      const changed = index === 0 ? { ...first.entity, document: { ...first.entity.document, qualificationRun: config.runId } } : first.entity;
      const proposal = { branch: config.branch, commandId: `${config.runId}:accepted:${index}`, expectedHead: head,
        assumptions: [{ entityId: first.entity.entityId, versionId: version }], puts: [changed], deletes: [] };
      const accepted = await sample(store, 'accepted-change', index, () => store.accept(proposal));
      if (accepted.replayed) throw new Error('Fresh command unexpectedly replayed');
      committedChanges += 1;
      head = accepted.revisionId; version = hash(changed);
      retainedVersions.set(head, version);
      await artifact(`accepted-${index}.json`, { proposal, accepted, beforeVersion: proposal.assumptions[0]?.versionId, afterVersion: version });
      await store.client.end(); store = await connect(); await prepare(store);
      const replay = await store.accept(proposal);
      if (!replay.replayed || replay.revisionId !== head || await store.head(config.branch) !== head) throw new Error('Durable receipt/head mismatch');
      requireEqual(await store.delta(head), [{ entity_id: first.entity.entityId, version_id: version }], 'Durable delta');
      const current = await store.detail({ branch: config.branch, entityId: first.entity.entityId });
      if (!current || current.versionId !== version || hash(current.entity) !== version) throw new Error('Durable detail mismatch');
      const history = await store.rows(Type.Object({ revision_id: HashSchema, parent_id: Type.Union([HashSchema, Type.Null()]), version_id: HashSchema }),
        `SELECT r.revision_id,r.parent_id,c.version_id FROM qvm_storage.changes c JOIN qvm_storage.revisions r USING(revision_id)
        WHERE c.entity_id=$1 AND c.revision_id=ANY($2::text[]) ORDER BY r.created_at,r.revision_id LIMIT 3`,
        [first.entity.entityId, [...retainedVersions.keys()]]);
      await artifact(`history-${index}.json`, history);
      for (const [revisionId, expectedVersion] of retainedVersions) {
        if (!history.some((row) => row.revision_id === revisionId && row.version_id === expectedVersion)) throw new Error('Entity history lost a revision');
      }
      const [original] = await store.rows(Type.Object({ version_id: HashSchema, body: JsonSchema }),
        `SELECT c.version_id,v.body FROM qvm_storage.changes c JOIN qvm_storage.versions v USING(version_id)
        WHERE c.revision_id=$1 AND c.entity_id=$2`, [admitted.loaded.revisionId, first.entity.entityId]);
      if (!original || original.version_id !== first.versionId || hash(original.body) !== first.versionId) throw new Error('Original pinned version lost');
      verifiedChanges += 1;
      observe(`durable-change-${index}`, true, JSON.stringify({ head, version, deltaCount: 1, historyCount: history.length }));
    }
    if (expired) throw new Error('Qualification wall-time limit exceeded');
  } catch (failure) { errors.push(errorMessage(failure)); observe('execution-failure', false, errorMessage(failure)); }
  finally {
    clearTimeout(timer); await connection.client?.end().catch((failure: unknown) => { errors.push(errorMessage(failure)); observe('disconnect-failure', false, errorMessage(failure)); });
    await artifact('observations.json', observations); await artifact('errors.json', errors);
    await artifact('retained-sha256.json', await Promise.all(files.map(async (file) => ({ file, sha256: sha256(await readFile(path.join(directory, file))) }))));
  }
  const result = { runId: config.runId, passed: errors.length === 0 && observations.length > 0 && observations.every((row) => row.passed),
    concurrency: 1, requestedSamplesPerInteractiveOperation: config.repeats, sampleCounts, committedChanges, verifiedChanges,
    queryUpperBound: 256 + 2 * 3 * (Math.ceil(config.maximumSelectionRows / 1000) + 2),
    scope: 'exploratory-small-sample; combined terminal status requires main review', observations, errors };
  await artifact('result.json', result); return result;
}
