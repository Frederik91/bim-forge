import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from '../../../experiments/storage/contract.ts';
import type { Json } from '../../../experiments/storage/contract.ts';
import { QualificationSchema, validatePriorAdmission } from './qualification.ts';

const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

// Synthetic archived evidence exercises admission gates without generating records or connecting to PG.
async function fixture(purpose: Json | undefined, scale = 'full') {
  const root = process.env.QVM152_ARTIFACT_ROOT ?? tmpdir();
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'prior-'));
  const prior = path.join(directory, 'prior'); await mkdir(prior);
  const full = scale === 'full';
  const entities = full ? 6777445 : 4;
  const relationships = full ? 18742644 : 1;
  const parameters = full ? 1500000 : 1;
  const logicalPropertyValues = full ? 145118512 : 4;
  const tables = { entities: { rows: entities, sha256: digest('entities') },
    relationships: { rows: relationships, sha256: digest('relationships') },
    parameters: { rows: parameters, sha256: digest('parameters') } };
  const manifest = { scale, inventoryFraction: full ? 1 : 0.00001, tables,
    countsByKind: { wall: entities }, relationshipCounts: { contains: relationships }, parameterForms: { quantity: parameters },
    logicalPropertyValues, oracles: [
      { caseId: 'hot-space-members', field: 'space_id' },
      { caseId: 'shared-type-members', field: 'type_id' },
      { caseId: 'system-members-including-ports', field: 'system_id' },
    ].map(({ caseId, field }) => ({ caseId, sql: `SELECT count(*) FROM entities WHERE ${field} = 1`, expected: 1,
      orderedIdCopySql: `COPY (SELECT id FROM entities WHERE ${field} = 1 ORDER BY id) TO STDOUT`, orderedIdSha256: digest('1\n') })) };
  const manifestFile = path.join(directory, 'manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest));
  const admission = { schemaVersion: 1, sourceManifest: { file: 'manifest.json', sha256: digest(await readFile(manifestFile)) },
    tables: { entities: { ...tables.entities, file: 'entities.copy' }, relationships: { ...tables.relationships, file: 'relationships.copy' },
      parameters: { ...tables.parameters, file: 'parameters.copy' } } };
  const admissionFile = path.join(directory, 'admission.json'); await writeFile(admissionFile, JSON.stringify(admission));
  const admissionHash = digest(await readFile(admissionFile));
  const sourceCommit = 'f5792ae37daa594d6fd1c5430aaf5799ef5a7da9';
  const fingerprint = { count: entities + relationships + parameters, sum: digest('sum'), xor: digest('xor') };
  const countsByKind = { wall: entities, contains: relationships, 'parameter:quantity': parameters };
  const properties = { entities: logicalPropertyValues, relationships: 0, parameters: 0 };
  const decisionFile = path.join(directory, 'decision.md');
  await writeFile(decisionFile, 'Separate extended completion experiment; cannot pass the original two-hour target.\n');
  const execution = { mode: { kind: 'load-only' }, ...(purpose === undefined ? {} : { purpose }), measurement: 'correctness',
    decisionPath: decisionFile, decisionSha256: digest(await readFile(decisionFile)), maxBoundedUpdates: 1,
    loadWallTimeLimitMs: purpose === 'extended-initial-inventory' ? 21600000 : 7200000,
    loadStatementTimeoutMs: purpose === 'extended-initial-inventory' ? 21600000 : 7200000,
    space: { dataPath: '/qualification', hostRootPath: '/host-root', dataBudgetBytes: 214748364800,
      dataReserveBytes: 107374182400, rootReserveBytes: 4294967296, monitorEvidence: 'watchdog.json' },
    exploratoryP95Ms: { detail: 300, page: 1000, oneHop: 1000, boundedDelta: 2000, smallAccept: 4000 } };
  const documents: Record<string, Json> = {
    'config.json': { branch: 'archived-branch', scale, experimentId: 'EX-13', format: 'w4-copy', dataset: admissionFile,
      historyRevisions: 1, leaseMode: 'exclusive-measurement', execution,
      environment: { sourceCommit, nodeCpuLimit: 1, nodeMemoryLimitBytes: 1073741824, postgresCpuLimit: 1.5,
        postgresMemoryLimitBytes: 3221225472, diskBudgetBytes: 214748364800 } },
    'load.json': { revisionId: digest('revision'), fingerprint, countsByKind, propertyValuesByRecordCategory: properties, fileSha256: admissionHash },
    'oracle.json': { expected: { fingerprint, countsByKind }, actual: { fingerprint, countsByKind } },
    'property-values.json': { expected: properties, actual: properties },
    'observations.json': [{ caseId: 'source-query-oracle', passed: true },
      { caseId: purpose === 'extended-initial-inventory' || purpose === 'resource-sensitivity-initial-inventory'
        ? purpose : 'initial-inventory', passed: true }],
    'errors.json': [],
  };
  const pins: Record<string, string> = {};
  async function repin(name: string, value: Json): Promise<void> {
    const bytes = `${JSON.stringify(value)}\n`; await writeFile(path.join(prior, name), bytes); pins[name] = digest(bytes);
  }
  for (const [name, value] of Object.entries(documents)) await repin(name, value);
  const config = parse(QualificationSchema, { runId: 'bounded-continuation', branch: 'archived-branch', scale, sourceCommit,
    manifest: { file: manifestFile, sha256: digest(await readFile(manifestFile)) }, admission: { file: admissionFile, sha256: admissionHash },
    priorAdmissionDir: prior, priorSha256: pins, repeats: 1, pageSize: 1, maximumSelectionRows: 2000000,
    statementTimeoutMs: 1000, wallTimeMs: 1000 }, 'pure continuation config');
  const validate = () => validatePriorAdmission(parse(QualificationSchema,
    { ...config, priorSha256: pins }, 'repinned continuation config'), async () => undefined);
  return { validate, repin, documents, config, prior, manifest, admission, fingerprint, countsByKind, properties };
}

test('complete pinned extended full admission continues using only its explicit completion label', async () => {
  const archived = await fixture('extended-initial-inventory');
  const before = await readFile(path.join(archived.prior, 'observations.json'));
  const admitted = await archived.validate();
  assert.equal(admitted.loaded.fingerprint.count, 27020089);
  assert.deepEqual(await readFile(path.join(archived.prior, 'observations.json')), before);
  assert.ok(!before.toString().includes('"caseId":"initial-inventory"'));
});

test('legacy omitted purpose and explicit ordinary initial inventory retain their original label', async () => {
  for (const purpose of [undefined, 'initial-inventory', 'bounded-updates', 'smaller-fixture-history']) {
    const archived = await fixture(purpose);
    await archived.validate();
  }
});

test('resource sensitivity reduced admission requires its explicit completion label', async () => {
  const archived = await fixture('resource-sensitivity-initial-inventory', 'reduced');
  assert.equal((await archived.validate()).loaded.fingerprint.count, 6);
});

test('mismatched inventory purpose/label and arbitrary successful cases cannot authorize continuation', async () => {
  for (const purpose of ['initial-inventory', 'extended-initial-inventory', 'resource-sensitivity-initial-inventory']) {
    const archived = await fixture(purpose, purpose === 'resource-sensitivity-initial-inventory' ? 'reduced' : 'full');
    for (const label of ['initial-inventory', 'extended-initial-inventory', 'resource-sensitivity-initial-inventory', 'unrelated-success']) {
      if (label === purpose) continue;
      await archived.repin('observations.json', [{ caseId: 'source-query-oracle', passed: true }, { caseId: label, passed: true }]);
      await assert.rejects(archived.validate(), /Missing successful/);
    }
  }
});

test('matching completion must be unique and passed, with a successful oracle and no prior errors', async () => {
  const archived = await fixture('extended-initial-inventory');
  const oracle = { caseId: 'source-query-oracle', passed: true };
  const completed = { caseId: 'extended-initial-inventory', passed: true };
  for (const observations of [[], [completed], [oracle, { ...completed, passed: false }], [oracle, completed, completed],
    [oracle, { ...completed, passed: false }, { caseId: 'initial-inventory', passed: true }],
    [oracle, completed, { caseId: 'unrelated-failure', passed: false }]]) {
    await archived.repin('observations.json', observations);
    await assert.rejects(archived.validate(), /Missing successful|failed observations/);
  }
  await archived.repin('observations.json', [oracle, completed]);
  await archived.repin('errors.json', ['admission failed']);
  await assert.rejects(archived.validate(), /Invalid prior errors/);
});

test('malformed or unknown purposes cannot fall back to an ordinary successful observation', async () => {
  for (const purpose of [null, 42, 'extended-inventory', { kind: 'extended-initial-inventory' }]) {
    const archived = await fixture(purpose);
    await archived.repin('observations.json', [{ caseId: 'source-query-oracle', passed: true }, { caseId: 'initial-inventory', passed: true }]);
    await assert.rejects(archived.validate(), /Invalid prior admission config/);
  }
});

test('extended continuation retains exact-byte pins and all full-inventory/source/oracle gates', async () => {
  const archived = await fixture('extended-initial-inventory');
  await writeFile(path.join(archived.prior, 'observations.json'), '[]');
  await assert.rejects(archived.validate(), /exact bytes hash mismatch/);
  await archived.repin('observations.json', archived.documents['observations.json'] ?? null);
  for (const [name, value, expected] of [
    ['oracle.json', { expected: { fingerprint: archived.fingerprint, countsByKind: archived.countsByKind },
      actual: { fingerprint: { ...archived.fingerprint, sum: digest('wrong') }, countsByKind: archived.countsByKind } }, /Readback oracle mismatch/],
    ['property-values.json', { expected: archived.properties, actual: { ...archived.properties, entities: 1 } }, /Property fidelity mismatch/],
  ] satisfies [string, Json, RegExp][]) {
    await archived.repin(name, value);
    await assert.rejects(archived.validate(), expected);
    await archived.repin(name, archived.documents[name] ?? null);
  }
  const partial = await fixture('extended-initial-inventory', 'smoke');
  await assert.rejects(validatePriorAdmission({ ...partial.config, scale: 'full' }, async () => undefined), /binding mismatch/);
  for (const change of ['fraction', 'entity-count']) {
    const full = await fixture('extended-initial-inventory');
    const manifest = change === 'fraction' ? { ...full.manifest, inventoryFraction: 0.5 }
      : { ...full.manifest, tables: { ...full.manifest.tables, entities: { ...full.manifest.tables.entities, rows: 4 } } };
    await writeFile(full.config.manifest.file, JSON.stringify(manifest));
    full.config.manifest.sha256 = digest(await readFile(full.config.manifest.file));
    await writeFile(full.config.admission.file, JSON.stringify({ ...full.admission,
      sourceManifest: { ...full.admission.sourceManifest, sha256: full.config.manifest.sha256 }, tables: {
        ...full.admission.tables, entities: { ...full.admission.tables.entities, ...manifest.tables.entities } } }));
    full.config.admission.sha256 = digest(await readFile(full.config.admission.file));
    const loaded = full.documents['load.json'];
    assert.ok(loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded));
    await full.repin('load.json', { ...loaded, fileSha256: full.config.admission.sha256 });
    await assert.rejects(full.validate(), /Full inventory required/);
  }
});
