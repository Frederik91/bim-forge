import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { Type } from 'typebox';
import { hash, parse, JsonSchema } from '../../../experiments/storage/contract.ts';
import type { Json } from '../../../experiments/storage/contract.ts';
import { Storage } from '../../../experiments/storage/store.ts';
import { inspectBranch, load } from '../../../experiments/storage/load.ts';
import { fromArray } from '../../../experiments/storage/fixture.ts';
import { w4Record } from '../../../experiments/storage/w4.ts';
import { QualificationSchema, runQualification, validatePriorAdmission } from './qualification.ts';

const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
async function document(filename: string): Promise<unknown> { return JSON.parse(await readFile(filename, 'utf8')); }

test('source-bound admitted branch gets bounded samples and durable edits, while incomplete admissions fail closed', async (t) => {
  const root = process.env.QVM142_ARTIFACT_ROOT;
  if (!root || !process.env.DATABASE_URL || !process.env.QVM_EXECUTION_LEASE) throw new Error('Server container, own database, lease and artifact root required');
  await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'runner-'));
  const prior = path.join(directory, 'prior'); await mkdir(prior);
  const branch = `issue142-${randomUUID()}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const store = new Storage(client); await store.initialize();
    const cells = [
      ['1', 'space', '1', null, null, null, '1', '{"name":"space"}', '{}', '{}'],
      ['2', 'typeDefinition', '1', null, null, null, '1', '{"name":"type"}', '{}', '{}'],
      ['3', 'system', '1', null, null, null, '1', '{"name":"system"}', '{}', '{}'],
      ['4', 'wall', '1', '2', '1', '3', '1', '{"name":"wall"}', '{}', '{}'],
    ];
    const records = cells.map((row) => w4Record('entities', row));
    records.push(w4Record('relationships', ['1', 'contains', '4', '1', '1', '{}']));
    records.push(w4Record('parameters', ['1', '4', 'length', 'quantity', '{"value":2}', '2', '1', '{}']));
    const selectedHash = digest('4\n');
    const tables = { entities: { rows: 4, sha256: digest(JSON.stringify(cells)) },
      relationships: { rows: 1, sha256: hash(records[4] ?? null) }, parameters: { rows: 1, sha256: hash(records[5] ?? null) } };
    const manifest = { scale: 'smoke', inventoryFraction: 0.00001, tables,
      countsByKind: { space: 1, typeDefinition: 1, system: 1, wall: 1 }, relationshipCounts: { contains: 1 },
      parameterForms: { quantity: 1 }, logicalPropertyValues: 4,
      oracles: [
        { caseId: 'hot-space-members', field: 'space_id', target: 1 },
        { caseId: 'shared-type-members', field: 'type_id', target: 2 },
        { caseId: 'system-members-including-ports', field: 'system_id', target: 3 },
      ].map(({ caseId, field, target }) => ({ caseId, sql: `SELECT count(*) FROM entities WHERE ${field} = ${target}`,
        expected: 1, orderedIdCopySql: `COPY (SELECT id FROM entities WHERE ${field} = ${target} ORDER BY id) TO STDOUT`, orderedIdSha256: selectedHash })) };
    const manifestFile = path.join(directory, 'manifest.json');
    await writeFile(manifestFile, JSON.stringify(manifest));
    const admission = { schemaVersion: 1, sourceManifest: { file: 'manifest.json', sha256: digest(await readFile(manifestFile)) },
      tables: { entities: { ...tables.entities, file: 'entities.copy' }, relationships: { ...tables.relationships, file: 'relationships.copy' },
        parameters: { ...tables.parameters, file: 'parameters.copy' } } };
    const admissionFile = path.join(directory, 'admission.json'); await writeFile(admissionFile, JSON.stringify(admission));
    const admissionHash = digest(await readFile(admissionFile));
    const loaded = await load(store, fromArray(records), branch);
    const actual = await inspectBranch(store, branch); const properties = await store.propertyCounts(branch);
    const sourceCommit = '1146065ebabab93bdaef932402fb796b9f82cc4e';
    const documents: Record<string, Json> = {
      'config.json': { branch, scale: 'smoke', experimentId: 'EX-13', format: 'w4-copy', dataset: admissionFile,
        execution: { mode: { kind: 'load-only' } }, environment: { sourceCommit } },
      'load.json': { ...loaded, fileSha256: admissionHash },
      'oracle.json': { expected: { fingerprint: loaded.fingerprint, countsByKind: loaded.countsByKind }, actual },
      'property-values.json': { expected: properties, actual: properties },
      'observations.json': [{ caseId: 'source-query-oracle', passed: true }, { caseId: 'initial-inventory', passed: true }], 'errors.json': [],
    };
    const pins: Record<string, string> = {};
    for (const [name, value] of Object.entries(documents)) {
      const bytes = `${JSON.stringify(value)}\n`; await writeFile(path.join(prior, name), bytes); pins[name] = digest(bytes);
    }
    const config = parse(QualificationSchema, { runId: `run-${randomUUID()}`, branch, scale: 'smoke', sourceCommit,
      manifest: { file: manifestFile, sha256: digest(await readFile(manifestFile)) }, admission: { file: admissionFile, sha256: admissionHash },
      priorAdmissionDir: prior, priorSha256: pins, repeats: 2, pageSize: 3, maximumSelectionRows: 10, statementTimeoutMs: 2000, wallTimeMs: 30000 }, 'test config');
    await t.test('exact successful admission validates without a database query', async () => {
      const result = await validatePriorAdmission(config, async () => undefined);
      assert.equal(result.loaded.revisionId, loaded.revisionId);
    });
    async function rejected(name: string, changes: Record<string, Json>, configChanges: Json = {}) {
      const casePrior = path.join(directory, `${name}-prior`); await mkdir(casePrior); const casePins: Record<string, string> = {};
      for (const [file, value] of Object.entries({ ...documents, ...changes })) {
        const bytes = `${JSON.stringify(value)}\n`; await writeFile(path.join(casePrior, file), bytes); casePins[file] = digest(bytes);
      }
      assert.ok(configChanges !== null && typeof configChanges === 'object' && !Array.isArray(configChanges));
      const output = path.join(directory, name);
      const result = await runQualification({ ...config, ...configChanges, priorAdmissionDir: casePrior, priorSha256: casePins }, output);
      assert.equal(result.passed, false); assert.ok(result.observations.some((row) => !row.passed));
      assert.equal(await store.head(branch), loaded.revisionId); assert.equal(result.committedChanges, 0);
      assert.ok(Array.isArray(await document(path.join(output, 'errors.json'))));
    }
    await t.test('load record alone is insufficient', () => rejected('no-observations', { 'observations.json': [] }));
    await t.test('fingerprint mismatch fails even with repinned artifact bytes', () => rejected('wrong-fingerprint', {
      'oracle.json': { expected: actual, actual: { ...actual, fingerprint: { ...actual.fingerprint, sum: '0'.repeat(64) } } },
    }));
    await t.test('property mismatch fails even with repinned bytes', () => rejected('wrong-properties', {
      'property-values.json': { expected: properties, actual: { ...properties, entities: 99 } },
    }));
    await t.test('prior branch must match the requested branch', () => rejected('wrong-branch', {}, { branch: 'absent' }));
    await t.test('smoke records cannot qualify a full inventory', () => rejected('false-full', {}, { scale: 'full' }));
    await t.test('prior errors prohibit continuation', () => rejected('prior-errors', { 'errors.json': ['load failed'] }));
    await t.test('failed initial inventory observation prohibits continuation', () => rejected('failed-initial', {
      'observations.json': [{ caseId: 'source-query-oracle', passed: true }, { caseId: 'initial-inventory', passed: false }],
    }));
    await t.test('exact admission hash is retained and checked', async () => {
      const output = path.join(directory, 'tampered-admission');
      const result = await runQualification({ ...config, admission: { ...config.admission, sha256: '0'.repeat(64) } }, output);
      assert.equal(result.passed, false); assert.match(result.errors.join(), /exact bytes hash mismatch/);
      assert.deepEqual(await readFile(path.join(output, 'admission.json')), await readFile(admissionFile));
    });
    await t.test('independent selection mismatch stops before accepted changes', async () => {
      const filename = path.join(directory, 'bad-selection-manifest.json');
      await writeFile(filename, JSON.stringify({ ...manifest, oracles: manifest.oracles.map((oracle) => ({ ...oracle, expected: 2 })) }));
      const manifestHash = digest(await readFile(filename));
      const badAdmission = path.join(directory, 'bad-selection-admission.json');
      await writeFile(badAdmission, JSON.stringify({ ...admission, sourceManifest: { ...admission.sourceManifest, sha256: manifestHash } }));
      await rejected('bad-selection', { 'load.json': { ...loaded, fileSha256: digest(await readFile(badAdmission)) } },
        { manifest: { file: filename, sha256: manifestHash }, admission: { file: badAdmission, sha256: digest(await readFile(badAdmission)) } });
    });
    await t.test('real PostgreSQL samples, durable delta/history and restore pass', async () => {
      const output = path.join(directory, 'success'); const result = await runQualification(config, output);
      assert.equal(result.passed, true, result.errors.join('\n'));
      assert.equal(result.committedChanges, 2); assert.equal(result.verifiedChanges, 2);
      for (const operation of ['page', 'detail', 'one-hop']) assert.deepEqual(result.sampleCounts[operation], { attempted: 2, succeeded: 2, errors: 0 });
      const samples = (await readFile(path.join(output, 'samples.ndjson'), 'utf8')).trim().split('\n'); assert.equal(samples.length, 8);
      const final = await inspectBranch(store, branch); assert.deepEqual(final, actual);
      assert.notEqual(await store.head(branch), loaded.revisionId);
      assert.deepEqual(await readFile(path.join(output, 'admission.json')), await readFile(admissionFile));
      assert.deepEqual(await readFile(path.join(output, 'prior-load.json')), await readFile(path.join(prior, 'load.json')));
      const histories = parse(Type.Array(JsonSchema), await document(path.join(output, 'history-1.json')), 'history'); assert.equal(histories.length, 3);
      const rerun = await runQualification({ ...config, runId: `${config.runId}-rerun` }, path.join(directory, 'changed-head'));
      assert.equal(rerun.passed, false); assert.match(rerun.errors.join(), /Branch head differs/);
    });
  } finally { await client.end(); }
});
