import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { Storage } from '../storage/store.ts';
import { CommandSchema, HashSchema, IdSchema, JsonSchema, canonical, command, entity, hash } from '../storage/contract.ts';
import type { Command, Json, StoredEntity } from '../storage/contract.ts';
import { FixtureSchema, parseFixture } from '../fixtures/fixture.ts';
import type { Fixture } from '../fixtures/fixture.ts';
import { AuthorityInputSchema, evaluateAuthority, parseAuthorityInput } from './authority.ts';
import type { AuthorityInput } from './authority.ts';
import { createPackage, copyPackageForFault, importPackage, readCurrent, readRegularFile, sha256, verifyPackage } from './package.ts';
import type { VerifiedPackage } from './package.ts';
import type { PackageManifest, Observation } from './protocol.ts';
import { parseObservations } from './protocol.ts';
import { pendingStorageObservations, storageScenarios } from './scenarios.ts';
import { bindingFor } from '../contracts/records.ts';
import { encodeHistory, readHistory, readHistoryV1 } from './history.ts';

const text = Type.String({ minLength: 1 });
const options = { additionalProperties: false };
const ConfigSchema = Type.Object({ sourceUrl: text, restoreUrl: text, outputRoot: text,
  imageDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  runId: Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$' }) }, options);
const DatabaseLeaseSchema = Type.Object({ leaseId: text, expiresAt: text, artifactRoot: text,
  databaseNames: Type.Array(Type.String({ pattern: '^qvm_w5_recovery(?:_[a-z0-9_]+)?$' }), { minItems: 2, uniqueItems: true }),
  permittedHelper: Type.Literal('w6-database-writer'), allowSourceConnectionBlock: Type.Boolean(),
}, options);
const WorkSchema = Type.Object({ databaseUrl: text, command: CommandSchema, authority: AuthorityInputSchema,
  sourcePackage: text, artifactRoot: text }, options);
const WorkerSchema = Type.Object({ work: WorkSchema, lease: DatabaseLeaseSchema, marker: text,
  stage: Type.Union([Type.Literal('after-stage-before-publish'), Type.Literal('after-database-commit')]) }, options);
type DatabaseConfig = Static<typeof ConfigSchema>;
type DatabaseLease = Static<typeof DatabaseLeaseSchema>;
type QualifiedWork = Static<typeof WorkSchema>;
type DatabaseWorker = Static<typeof WorkerSchema>;

const trustedActors: AuthorityInput['actors'] = [
  { actorId: 'w6-simulated-mechanical', kind: 'simulated-test-actor', disciplines: ['mechanical'] },
  { actorId: 'w6-simulated-electrical', kind: 'simulated-test-actor', disciplines: ['electrical'] },
];

function databaseName(url: string): string {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== 'bim-qvm-db'
      || !/^qvm_w5_recovery(?:_[a-z0-9_]+)?$/.test(name) || parsed.username !== 'qvm' || parsed.password !== '' || parsed.search !== '') {
    throw new Error('W6 requires private bim-qvm-db and a dedicated qvm_w5_recovery database without URL secrets/options.');
  }
  return name;
}

async function authorize(lease: DatabaseLease, root: string, urls: string[]): Promise<void> {
  const expiry = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Database execution lease expired.');
  for (const url of urls) if (!lease.databaseNames.includes(databaseName(url))) throw new Error('Database is outside the execution lease.');
  const relative = path.relative(path.resolve(lease.artifactRoot), path.resolve(root));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Database evidence must stay within the leased artifact root.');
  let existing = path.resolve(root);
  let actual: string;
  for (;;) {
    try { actual = await realpath(existing); break; }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  const actualRelative = path.relative(await realpath(lease.artifactRoot), actual);
  if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) throw new Error('Database evidence path escapes through a symlink.');
}

async function connected<T>(url: string, work: (storage: Storage) => Promise<T>): Promise<T> {
  databaseName(url);
  const client = new Client({ connectionString: url, application_name: 'w6-recovery', connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query(`SET statement_timeout='20s'; SET lock_timeout='5s'; SET TIME ZONE 'UTC'`);
    const storage = new Storage(client);
    await storage.assertIsolated();
    return await work(storage);
  } finally { await client.end(); }
}

function storedFixture(fixture: Fixture): StoredEntity[] {
  return [
    ...fixture.entities.map((item) => entity({ entityId: item.id, kind: item.kind, typeId: null, containerId: null,
      systemId: null, fromId: null, toId: null, document: item })),
    ...fixture.relationships.map((item) => entity({ entityId: item.id, kind: item.kind, typeId: null, containerId: null,
      systemId: null, fromId: item.source, toId: item.target, document: item })),
  ];
}

async function currentEntities(storage: Storage, branch: string): Promise<StoredEntity[]> {
  const result: StoredEntity[] = [];
  let after = '';
  for (;;) {
    const page = await storage.page({ branch, after, limit: 20 });
    if (page.length === 0) return result;
    result.push(...page.map((row) => row.entity));
    assert.ok(result.length <= 10000, 'W6 correctness fixture exceeded 10,000 rows.');
    const last = page.at(-1);
    assert.ok(last && last.entity.entityId > after);
    after = last.entity.entityId;
  }
}

function decisionsFor(proposal: Command): AuthorityInput {
  const candidateSha256 = hash(proposal);
  assert.ok(proposal.expectedHead);
  return parseAuthorityInput({ proposalId: proposal.commandId, candidateSha256,
    expectedHead: proposal.expectedHead, actualHead: proposal.expectedHead,
    requiredDisciplines: ['mechanical', 'electrical'], actors: trustedActors, conflicts: [],
    decisions: trustedActors.map((actor) => {
      const discipline = actor.disciplines[0];
      assert.ok(discipline);
      const decision = { actorId: actor.actorId, discipline, proposalId: proposal.commandId, candidateSha256, decision: 'approve' };
      return { ...decision, evidenceSha256: hash(decision) };
    }),
  });
}

async function modelAt(storage: Storage, branch: string, original: Fixture): Promise<Fixture> {
  const rows = await currentEntities(storage, branch);
  const byId = new Map(rows.map((row) => [row.entityId, row.document]));
  return parseFixture({ ...original, entities: original.entities.map((item) => byId.get(item.id)),
    relationships: original.relationships.map((item) => byId.get(item.id)) });
}

// Governance is deliberately outside W5. Evidence records enter the same W5 transaction as model changes.
async function qualifiedAccept(storage: Storage, input: QualifiedWork, checkpoint?: (stage: DatabaseWorker['stage']) => Promise<void>): Promise<{ revisionId: string; replayed: boolean }> {
  const proposal = command(input.command);
  const authority = parseAuthorityInput(input.authority);
  assert.equal(authority.proposalId, proposal.commandId);
  assert.equal(authority.candidateSha256, hash(proposal));
  assert.equal(authority.expectedHead, proposal.expectedHead);
  assert.equal(canonical(authority.actors), canonical(trustedActors), 'Caller cannot grant its own simulated authority.');
  assert.deepEqual(authority.requiredDisciplines, ['mechanical', 'electrical']);
  const source = await verifyPackage(input.sourcePackage);
  const revision = source.manifest.revisions.find((item) => item.revisionId === hash(proposal));
  assert.ok(revision, 'Package does not contain this candidate.');
  for (const decision of authority.decisions) {
    assert.ok(revision.requiredArtifacts.includes(decision.evidenceSha256));
    assert.ok(source.manifest.artifacts.some((artifact) => artifact.sha256 === decision.evidenceSha256 && artifact.role === 'review'));
    const raw: unknown = JSON.parse((await readRegularFile(path.join(source.root, 'objects', decision.evidenceSha256))).toString('utf8'));
    const { evidenceSha256, ...body } = decision;
    assert.equal(hash(body), evidenceSha256);
    assert.deepEqual(raw, body, 'Discipline evidence bytes do not bind the decision.');
  }
  const evidence: StoredEntity[] = authority.decisions.map((decision) => entity({ entityId: `w6/review/${proposal.commandId}/${decision.discipline}`,
    kind: 'w6-review', typeId: null, containerId: null, systemId: null, fromId: null, toId: null,
    document: { ...decision, actorKind: 'simulated-test-actor' } }));
  evidence.push(entity({ entityId: `w6/acceptance/${proposal.commandId}`, kind: 'w6-acceptance',
    typeId: null, containerId: null, systemId: null, fromId: null, toId: null,
    document: { proposalSha256: hash(proposal), artifactRevisionSha256: hash(revision), requiredArtifacts: revision.requiredArtifacts,
      expectedHead: proposal.expectedHead, authority, interpretation: revision.interpretation, modelSha256: revision.modelSha256 } }));
  const enriched = command({ ...proposal, puts: [...proposal.puts, ...evidence],
    assumptions: [...proposal.assumptions, ...evidence.map((item) => ({ entityId: item.entityId, versionId: null }))] });
  const receipts = await storage.rows(Type.Object({ payload_hash: HashSchema, revision_id: HashSchema }),
    `SELECT payload_hash,revision_id FROM qvm_storage.receipts WHERE command_id=$1`, [proposal.commandId]);
  if (receipts.length > 0) {
    // Storage compares the entire enriched payload before replay, even if the current head has moved.
    return storage.accept(enriched);
  }
  const decision = evaluateAuthority({ ...authority, actualHead: await storage.head(proposal.branch) ?? 'empty' });
  if (decision.kind === 'blocked') throw new Error(decision.reasons.join(' '));
  const rawModel: unknown = JSON.parse((await readRegularFile(path.join(source.root, 'objects', revision.modelSha256))).toString('utf8'));
  const model = parseFixture(rawModel);
  const pump = model.entities.find((item) => item.id === 'pump');
  if (pump?.properties.designDecision === 'reviewed-coordination-resolution') {
    const mechanical = pump.properties.sourceMechanicalRevision;
    const electrical = pump.properties.sourceElectricalRevision;
    assert.ok(typeof mechanical === 'string' && typeof electrical === 'string', 'Reconciliation must retain both source revision identities.');
    assert.equal(mechanical, await storage.head('company-a'));
    assert.equal(electrical, await storage.head('company-b'));
    const sourceValues: (string | number | boolean | null)[] = [];
    for (const revisionId of [mechanical, electrical]) {
      const row = (await storage.historical({ revisionId, after: 'pum', limit: 20 })).find((item) => item.entity.entityId === 'pump');
      assert.ok(row && Check(FixtureSchema.properties.entities.items, row.entity.document));
      const value = row.entity.document.properties.designDecision;
      assert.ok(value !== undefined);
      sourceValues.push(value);
    }
    assert.notEqual(sourceValues[0], sourceValues[1], 'Reconciliation fixture does not contain the declared property conflict.');
    assert.ok(authority.conflicts.some((conflict) => conflict.conflictId === 'pump-designDecision'
      && conflict.resolvedByCandidateSha256 === hash(proposal)), 'Actual divergent property conflict lacks a candidate-bound resolution.');
  }
  const predicted = new Map((await currentEntities(storage, proposal.branch)).filter((item) => !item.entityId.startsWith('w6/'))
    .map((item) => [item.entityId, item]));
  for (const item of proposal.puts) predicted.set(item.entityId, item);
  for (const id of proposal.deletes) predicted.delete(id);
  const sort = (items: StoredEntity[]) => items.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en'));
  assert.equal(canonical(sort([...predicted.values()])), canonical(sort(storedFixture(model))), 'Pinned model does not match the proposed full state.');
  await importPackage({ source: source.root, destination: input.artifactRoot,
    checkpoint: async (stage) => { if (stage === 'after-stage-before-publish') await checkpoint?.(stage); } });
  const accepted = await storage.accept(enriched);
  await checkpoint?.('after-database-commit');
  return accepted;
}

const tables = ['meta', 'versions', 'revisions', 'changes', 'receipts', 'branches', 'visibility', 'snapshots'] satisfies string[];
const SnapshotSchema = Type.Object({ database: text,
  tables: Type.Record(Type.String(), JsonSchema), queries: Type.Record(Type.String(), JsonSchema),
}, options);
type DatabaseSnapshot = Static<typeof SnapshotSchema>;

async function snapshot(url: string, output: string): Promise<DatabaseSnapshot> {
  const result = await connected(url, async (storage) => {
    const data: Record<string, Json> = {};
    const queries: Record<string, Json> = {};
    for (const table of tables) {
      const [count] = await storage.rows(Type.Object({ count: Type.Integer() }), `SELECT count(*)::int AS count FROM qvm_storage.${table}`);
      assert.ok(count && count.count <= 10000, 'W6 table export exceeds its small-fixture bound.');
      const [row] = await storage.rows(Type.Object({ body: JsonSchema }),
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS body FROM qvm_storage.${table} t`);
      assert.ok(row);
      data[table] = row.body;
    }
    const versions = await storage.rows(Type.Object({ body: JsonSchema, version_id: HashSchema }), `SELECT body,version_id FROM qvm_storage.versions`);
    for (const row of versions) assert.equal(hash(entity(row.body)), row.version_id, 'Stored canonical envelope hash differs.');
    const branches = await storage.rows(Type.Object({ branch: IdSchema, head: Type.Union([HashSchema, Type.Null()]) }),
      `SELECT branch,head FROM qvm_storage.branches ORDER BY branch COLLATE "C"`);
    for (const branch of branches) queries[`branch/${branch.branch}`] = await currentEntities(storage, branch.branch);
    const revisions = await storage.rows(Type.Object({ revision_id: HashSchema }), `SELECT revision_id FROM qvm_storage.revisions ORDER BY revision_id`);
    for (const revision of revisions) {
      const resolved: Json[] = [];
      let after = '';
      for (;;) {
        const page = await storage.historical({ revisionId: revision.revision_id, after, limit: 20 });
        if (page.length === 0) break;
        resolved.push(...page);
        assert.ok(resolved.length <= 10000);
        const last = page.at(-1);
        assert.ok(last && last.entity.entityId > after);
        after = last.entity.entityId;
      }
      queries[`revision/${revision.revision_id}`] = resolved;
      queries[`delta/${revision.revision_id}`] = await storage.delta(revision.revision_id);
    }
    return { database: databaseName(url), tables: data, queries };
  });
  await writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' });
  await writeFile(output + '.sha256', sha256(await readFile(output)) + '\n', { flag: 'wx' });
  return result;
}

async function checkEmpty(url: string): Promise<void> {
  await connected(url, async (storage) => {
    const [row] = await storage.rows(Type.Object({ name: Type.Union([Type.String(), Type.Null()]) }), `SELECT to_regnamespace('qvm_storage')::text AS name`);
    assert.ok(row && row.name === null, 'Dedicated database must be empty; W6 never drops or resets an existing schema.');
  });
}

async function cli(args: { executable: string; argv: string[]; directory: string; name: string }): Promise<void> {
  try {
    const result = await promisify(execFile)(args.executable, args.argv, { maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PGOPTIONS: '-c statement_timeout=20000 -c lock_timeout=5000' } });
    await writeFile(path.join(args.directory, args.name + '.stdout.txt'), result.stdout, { flag: 'wx' });
    await writeFile(path.join(args.directory, args.name + '.stderr.txt'), result.stderr, { flag: 'wx' });
  } catch (error) {
    await writeFile(path.join(args.directory, args.name + '.failure.txt'), error instanceof Error ? error.stack ?? error.message : String(error), { flag: 'wx' });
    throw error;
  }
}

async function expectRejected(operation: () => Promise<unknown>, output: string, pattern?: RegExp): Promise<void> {
  try { await operation(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(output, error instanceof Error ? error.stack ?? message : message, { flag: 'wx' });
    if (pattern) assert.match(message, pattern);
    return;
  }
  throw new Error('Candidate unexpectedly accepted a command that must be rejected.');
}

async function killWriter(worker: DatabaseWorker, root: string): Promise<void> {
  await authorize(worker.lease, root, [worker.work.databaseUrl]);
  const config = path.join(root, 'worker.json');
  await writeFile(config, JSON.stringify(worker), { flag: 'wx' });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--writer', config], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let finished = false;
  child.stdout.on('data', (bytes: Buffer) => { stdout += bytes.toString('utf8'); });
  child.stderr.on('data', (bytes: Buffer) => { stderr += bytes.toString('utf8'); });
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => { finished = true; resolve({ code, signal }); });
  }).then((value) => ({ kind: 'exit', value } satisfies { kind: 'exit'; value: { code: number | null; signal: NodeJS.Signals | null } }),
    (error: unknown) => ({ kind: 'error', error } satisfies { kind: 'error'; error: unknown }));
  try {
    let reached = false;
    const deadline = Date.now() + 30000;
    while (!finished && Date.now() < deadline) {
      try {
        const marker: unknown = JSON.parse(await readFile(worker.marker, 'utf8'));
        assert.deepEqual(marker, { stage: worker.stage, commandId: worker.work.command.commandId });
        reached = true;
        break;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      await setTimeout(25);
    }
    assert.ok(reached, 'Database writer did not reach the real checkpoint.');
    await authorize(worker.lease, root, [worker.work.databaseUrl]);
    assert.ok(child.kill('SIGKILL'));
    const outcome = await ended;
    if (outcome.kind === 'error') throw outcome.error;
    assert.equal(outcome.value.signal, 'SIGKILL');
    await writeFile(path.join(root, 'process.json'), JSON.stringify({ leaseId: worker.lease.leaseId,
      pid: child.pid, stage: worker.stage, commandId: worker.work.command.commandId, ...outcome.value }, null, 2), { flag: 'wx' });
  } finally {
    if (!finished) child.kill('SIGKILL');
    await ended;
    await writeFile(path.join(root, 'stdout.txt'), stdout, { flag: 'wx' });
    await writeFile(path.join(root, 'stderr.txt'), stderr, { flag: 'wx' });
  }
}

async function worker(input: DatabaseWorker): Promise<void> {
  await authorize(input.lease, input.work.artifactRoot, [input.work.databaseUrl]);
  await connected(input.work.databaseUrl, (storage) => qualifiedAccept(storage, input.work, async (stage) => {
    if (stage !== input.stage) return;
    await writeFile(input.marker + '.pending', JSON.stringify({ stage, commandId: input.work.command.commandId }), { flag: 'wx' });
    await rename(input.marker + '.pending', input.marker);
    for (;;) await setTimeout(1000);
  }));
}

async function packageFor(args: { root: string; parent: VerifiedPackage | null; fixture: Fixture;
  revisionId: string; parents: string[]; authority: AuthorityInput | null }): Promise<VerifiedPackage> {
  const objects = new Map<string, Uint8Array>();
  const artifacts: PackageManifest['artifacts'] = [];
  if (args.parent) {
    artifacts.push(...args.parent.manifest.artifacts);
    for (const artifact of artifacts) objects.set(artifact.sha256,
      await readRegularFile(path.join(args.parent.root, 'objects', artifact.sha256)));
  }
  const add = (role: PackageManifest['artifacts'][number]['role'], bytes: Buffer): string => {
    const digest = sha256(bytes);
    if (!objects.has(digest)) {
      artifacts.push({ sha256: digest, byteLength: bytes.byteLength, role, mediaType: 'application/json' });
      objects.set(digest, bytes);
    }
    return digest;
  };
  const previousRevision = args.parent?.manifest.revisions.at(-1);
  const interpretation = previousRevision?.interpretation ?? {
    schema: { version: 'w0-fixture-v1', sha256: add('schema', Buffer.from(JSON.stringify(FixtureSchema))) },
    dictionary: { version: 'w6-declared-disciplines-v1', sha256: add('dictionary', Buffer.from(canonical({ disciplines: ['mechanical', 'electrical'] }))) },
    canonicalization: { version: 'w5-contract-v1', sha256: add('canonicalization', await readFile(new URL('../storage/contract.ts', import.meta.url))) },
    kernel: { version: 'no-geometry-engine-executed', sha256: add('kernel', Buffer.from(canonical({ geometryEngineExecuted: false }))) },
  };
  const modelSha256 = add('model', Buffer.from(JSON.stringify(parseFixture(args.fixture))));
  const reviewHashes = (args.authority?.decisions ?? []).map(({ evidenceSha256, ...decision }) => {
    const digest = add('review', Buffer.from(canonical(decision)));
    assert.equal(digest, evidenceSha256);
    return digest;
  });
  const requiredArtifacts = [...new Set([modelSha256, ...Object.values(interpretation).map((pin) => pin.sha256), ...reviewHashes])];
  const manifest: PackageManifest = { format: 'bim-forge-w6-package-v1', projectId: 'w6-disposable-recovery-fixture', artifacts,
    revisions: [...(args.parent?.manifest.revisions ?? []), { revisionId: args.revisionId, parents: args.parents,
      modelSha256, requiredArtifacts, interpretation }],
    branches: [...(args.parent?.manifest.branches ?? []), { name: `candidate/${args.revisionId}`, revisionId: args.revisionId }],
  };
  return createPackage({ root: args.root, manifest, objects });
}

async function unionPackages(args: { left: VerifiedPackage; right: VerifiedPackage; root: string }): Promise<VerifiedPackage> {
  const artifacts = new Map(args.left.manifest.artifacts.map((item) => [item.sha256, item]));
  const revisions = new Map(args.left.manifest.revisions.map((item) => [item.revisionId, item]));
  const branches = new Map(args.left.manifest.branches.map((item) => [item.name, item]));
  const objects = new Map<string, Uint8Array>();
  for (const source of [args.left, args.right]) {
    for (const artifact of source.manifest.artifacts) {
      const existing = artifacts.get(artifact.sha256);
      if (existing) assert.deepEqual(existing, artifact);
      artifacts.set(artifact.sha256, artifact);
      objects.set(artifact.sha256, await readRegularFile(path.join(source.root, 'objects', artifact.sha256)));
    }
    for (const revision of source.manifest.revisions) {
      const existing = revisions.get(revision.revisionId);
      if (existing) assert.deepEqual(existing, revision);
      revisions.set(revision.revisionId, revision);
    }
    for (const branch of source.manifest.branches) {
      const existing = branches.get(branch.name);
      if (existing) assert.deepEqual(existing, branch);
      branches.set(branch.name, branch);
    }
  }
  return createPackage({ root: args.root, objects, manifest: { ...args.left.manifest,
    artifacts: [...artifacts.values()], revisions: [...revisions.values()], branches: [...branches.values()] } });
}

async function assertAcceptance(url: string, work: QualifiedWork, expectedRevision: string): Promise<void> {
  await connected(url, async (storage) => {
    assert.equal(await storage.head(work.command.branch), expectedRevision);
    const [row] = await storage.rows(Type.Object({ revisions: Type.Integer(), receipts: Type.Integer(), evidence: Type.Integer() }),
      `SELECT (SELECT count(*)::int FROM qvm_storage.revisions WHERE command_id=$1) AS revisions,
      (SELECT count(*)::int FROM qvm_storage.receipts WHERE command_id=$1 AND revision_id=$2) AS receipts,
      (SELECT count(*)::int FROM qvm_storage.changes c JOIN qvm_storage.versions v USING(version_id)
        WHERE c.revision_id=$2 AND v.kind IN ('w6-review','w6-acceptance')) AS evidence`,
      [work.command.commandId, expectedRevision]);
    assert.deepEqual(row, { revisions: 1, receipts: 1, evidence: 3 });
    const delta = await storage.delta(expectedRevision);
    assert.equal(delta.length, work.command.puts.length + work.command.deletes.length + 3);
  });
}

async function historyUpgrade(url: string, original: Fixture, root: string, seedRevision: string): Promise<string> {
  const before = encodeHistory(original, 'v1');
  const after = encodeHistory(original, 'v2');
  assert.notEqual(sha256(before), sha256(after));
  assert.equal(canonical(readHistoryV1(before)), canonical(original));
  assert.throws(() => readHistoryV1(after));
  assert.equal(canonical(readHistory(after)), canonical(original));
  const readerSha256 = sha256(await readFile(new URL('./history.ts', import.meta.url)));
  await writeFile(path.join(root, 'history-original.json'), before, { flag: 'wx' });
  await writeFile(path.join(root, 'history-upgraded.json'), after, { flag: 'wx' });
  const representation = (bytes: Buffer, format: string, dictionary: string, canonicalization: string): StoredEntity => entity({
    entityId: 'w6/history/representation', kind: 'w6-history', typeId: null, containerId: null, systemId: null, fromId: null, toId: null,
    document: { format, dictionary, canonicalization, bytesBase64: bytes.toString('base64'), contentSha256: sha256(bytes), readerSha256,
      kernel: 'not-executed' },
  });
  const v1 = representation(before, 'w6-history-v1', 'owners-v1', 'w5-sorted-compact-v1');
  const v2 = representation(after, 'w6-history-v2', 'disciplines-v2', 'ordered-pretty-json-v2');
  const receipts = await connected(url, async (storage) => {
    await storage.createBranch({ branch: 'history-upgrades', revisionId: seedRevision });
    const first = await storage.accept({ branch: 'history-upgrades', commandId: 'w6-history-v1', expectedHead: seedRevision,
      assumptions: [{ entityId: v1.entityId, versionId: null }], puts: [v1], deletes: [] });
    const second = await storage.accept({ branch: 'history-upgrades', commandId: 'w6-history-v2', expectedHead: first.revisionId,
      assumptions: [{ entityId: v1.entityId, versionId: hash(v1) }], puts: [v2], deletes: [] });
    return { first, second };
  });
  await connected(url, async (storage) => {
    const oldRows = await storage.historical({ revisionId: receipts.first.revisionId, after: 'w6/history/', limit: 20 });
    const retained = oldRows.find((row) => row.entity.entityId === v1.entityId);
    assert.ok(retained);
    assert.equal(retained.versionId, hash(v1));
    assert.equal(canonical(retained.entity), canonical(v1));
    const bytesValue = retained.entity.document.bytesBase64;
    assert.equal(typeof bytesValue, 'string');
    if (typeof bytesValue !== 'string') throw new Error('Historical representation bytes absent.');
    const bytes = Buffer.from(bytesValue, 'base64');
    assert.deepEqual(bytes, before);
    assert.equal(canonical(readHistoryV1(bytes)), canonical(original));
    assert.equal(canonical(readHistory(bytes)), canonical(original));
    const upgraded = (await currentEntities(storage, 'history-upgrades')).find((row) => row.entityId === v2.entityId);
    assert.ok(upgraded);
    assert.equal(canonical(upgraded), canonical(v2));
    await writeFile(path.join(root, 'history-query-evidence.json'), JSON.stringify({ receipts, old: retained,
      upgraded, readerSha256, originalBytesSha256: sha256(before), upgradedBytesSha256: sha256(after) }, null, 2), { flag: 'wx' });
  });
  return `Real PostgreSQL retained exact ${sha256(before)} bytes and canonical version ${hash(v1)} after changing the representation shape, owner dictionary keys and serialization. Both the pinned v1 reader and upgraded reader reopened the historical model. No geometry kernel was executed.`;
}

export async function runPostgresCases(config: DatabaseConfig, lease: DatabaseLease): Promise<Observation[]> {
  const root = path.resolve(config.outputRoot, config.runId);
  assert.notEqual(databaseName(config.sourceUrl), databaseName(config.restoreUrl));
  await authorize(lease, root, [config.sourceUrl, config.restoreUrl]);
  await mkdir(config.outputRoot, { recursive: true });
  await mkdir(root);
  const observations = pendingStorageObservations();
  const sourceArtifacts = path.join(root, 'source-artifacts');
  const restoredArtifacts = path.join(root, 'restored-artifacts');
  const candidateByHead = new Map<string, string>();
  let packageIndex = 0;
  const record = async (caseId: string, operation: () => Promise<string>, limitations: string[] = []): Promise<void> => {
    await authorize(lease, root, [config.sourceUrl, config.restoreUrl]);
    const definition = storageScenarios.find((item) => item.caseId === caseId);
    assert.ok(definition);
    const observation: Observation = { ...definition, observed: 'Execution did not complete.', passed: false, limitations };
    try { observation.observed = await operation(); observation.passed = true; }
    catch (error) {
      observation.observed = error instanceof Error ? error.message : String(error);
      await writeFile(path.join(root, `${caseId}.error.txt`), error instanceof Error ? error.stack ?? error.message : String(error), { flag: 'wx' });
    }
    const index = observations.findIndex((item) => item.caseId === caseId);
    observations[index] = observation;
    await writeFile(path.join(root, 'observations-progress.json'), JSON.stringify(observations, null, 2));
  };
  try {
    const repository = fileURLToPath(new URL('../../', import.meta.url));
    const bindingPaths = ['docs/design/versioned-model-candidate.md', 'docs/experiments/registry.json',
      'experiments/fixtures/tiny-building.json', 'experiments/fixtures/fixture.ts', 'experiments/storage/schema.sql',
      'experiments/storage/store.ts', 'experiments/storage/contract.ts', 'experiments/recovery/postgres.ts', 'experiments/recovery/history.ts'];
    const sourceBindings = await Promise.all(bindingPaths.map((filename) => bindingFor(repository, filename)));
    await writeFile(path.join(root, 'source-bindings.json'), JSON.stringify(sourceBindings, null, 2), { flag: 'wx' });
    await writeFile(path.join(root, 'execution-input.json'), JSON.stringify({ config, lease }, null, 2), { flag: 'wx' });
    await checkEmpty(config.sourceUrl);
    await checkEmpty(config.restoreUrl);
    const environment = await connected(config.sourceUrl, async (storage) => {
      const [row] = await storage.rows(Type.Object({ version: text, fsync: text, synchronous_commit: text, full_page_writes: text }),
        `SELECT version() AS version,current_setting('fsync') AS fsync,current_setting('synchronous_commit') AS synchronous_commit,
        current_setting('full_page_writes') AS full_page_writes`);
      assert.ok(row);
      assert.equal(row.fsync, 'on');
      assert.equal(row.synchronous_commit, 'on');
      assert.equal(row.full_page_writes, 'on');
      return row;
    });
    await writeFile(path.join(root, 'environment.json'), JSON.stringify({ ...environment, host: os.hostname(), node: process.version,
      imageDigest: config.imageDigest, imageDigestSource: 'coordinator supplied', leaseId: lease.leaseId,
      databaseNames: [databaseName(config.sourceUrl), databaseName(config.restoreUrl)],
      measurementKind: 'small deterministic correctness cases; no scale claim' }, null, 2), { flag: 'wx' });
    const rawFixture: unknown = JSON.parse(await readFile(new URL('../fixtures/tiny-building.json', import.meta.url), 'utf8'));
    const original = parseFixture(rawFixture);
    const initialItems = storedFixture(original);
    const seed = command({ branch: 'accepted', commandId: 'w6-seed', expectedHead: null,
      assumptions: initialItems.map((item) => ({ entityId: item.entityId, versionId: null })), puts: initialItems, deletes: [] });
    const baseline = await connected(config.sourceUrl, async (storage) => {
      await storage.initialize();
      await storage.createBranch({ branch: 'accepted', revisionId: null });
      return storage.accept(seed);
    });
    candidateByHead.set(baseline.revisionId, baseline.revisionId);
    const initialPackage = await packageFor({ root: path.join(root, 'input-seed'), parent: null, fixture: original,
      revisionId: baseline.revisionId, parents: [], authority: null });
    await importPackage({ source: initialPackage.root, destination: sourceArtifacts });
    const prepare = async (args: { url: string; artifactRoot: string; branch: string; id: string; entityId: string;
      properties: Record<string, string | number | boolean | null> }): Promise<QualifiedWork> => {
      const state = await connected(args.url, async (storage) => {
        const head = await storage.head(args.branch);
        assert.ok(head);
        const before = await modelAt(storage, args.branch, original);
        assert.ok(before.entities.some((item) => item.id === args.entityId));
        const after = parseFixture({ ...before, entities: before.entities.map((item) => item.id === args.entityId
          ? { ...item, properties: { ...item.properties, ...args.properties } } : item) });
        const put = storedFixture(after).find((item) => item.entityId === args.entityId);
        const old = storedFixture(before).find((item) => item.entityId === args.entityId);
        assert.ok(put && old);
        return { after, proposal: command({ branch: args.branch, commandId: args.id, expectedHead: head,
          assumptions: [{ entityId: args.entityId, versionId: hash(old) }], puts: [put], deletes: [] }) };
      });
      const authority = decisionsFor(state.proposal);
      const parent = await readCurrent(args.artifactRoot);
      assert.ok(parent);
      const parentId = candidateByHead.get(state.proposal.expectedHead ?? '');
      assert.ok(parentId, 'Missing artifact ancestry for the actual database head.');
      packageIndex += 1;
      const candidate = await packageFor({ root: path.join(root, `input-${packageIndex}`), parent, fixture: state.after,
        revisionId: hash(state.proposal), parents: [parentId], authority });
      await writeFile(path.join(root, `command-${packageIndex}.json`), JSON.stringify({ command: state.proposal,
        authority, candidateManifestSha256: candidate.manifestSha256 }, null, 2), { flag: 'wx' });
      return { databaseUrl: args.url, command: state.proposal, authority,
        sourcePackage: candidate.root, artifactRoot: args.artifactRoot };
    };
    const accept = async (work: QualifiedWork): Promise<{ revisionId: string; replayed: boolean }> => {
      const result = await connected(work.databaseUrl, (storage) => qualifiedAccept(storage, work));
      candidateByHead.set(result.revisionId, hash(work.command));
      return result;
    };
    await record('database-stage-crash', async () => {
      const work = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'accepted', id: 'w6-stage-crash',
        entityId: 'chair-a', properties: { x: 2.25 } });
      const before = await snapshot(config.sourceUrl, path.join(root, 'stage-before.json'));
      const processRoot = path.join(root, 'stage-crash');
      await mkdir(processRoot);
      await killWriter({ work, lease, marker: path.join(processRoot, 'checkpoint.json'), stage: 'after-stage-before-publish' }, processRoot);
      const after = await snapshot(config.sourceUrl, path.join(root, 'stage-killed.json'));
      assert.equal(canonical(after.tables), canonical(before.tables));
      const result = await accept(work);
      assert.equal(result.replayed, false);
      await assertAcceptance(config.sourceUrl, work, result.revisionId);
      return `Actual writer SIGKILL after artifact staging left every database table unchanged. Retry committed exactly one revision and receipt ${result.revisionId} with three evidence records.`;
    }, ['A process crash at the stated checkpoint is exercised; database-container and host power-loss recovery are outside this case.']);
    await record('database-after-commit-retry', async () => {
      const work = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'accepted', id: 'w6-after-commit',
        entityId: 'chair-b', properties: { x: 8.25 } });
      const processRoot = path.join(root, 'after-commit-crash');
      await mkdir(processRoot);
      await killWriter({ work, lease, marker: path.join(processRoot, 'checkpoint.json'), stage: 'after-database-commit' }, processRoot);
      const committed = await snapshot(config.sourceUrl, path.join(root, 'after-commit-killed.json'));
      const result = await accept(work);
      assert.equal(result.replayed, true);
      await assertAcceptance(config.sourceUrl, work, result.revisionId);
      const retried = await snapshot(config.sourceUrl, path.join(root, 'after-commit-retried.json'));
      assert.equal(canonical(committed.tables), canonical(retried.tables));
      const changed = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'accepted', id: work.command.commandId,
        entityId: 'chair-b', properties: { x: 8.5 } });
      await expectRejected(() => accept(changed), path.join(root, 'changed-payload-rejected.txt'), /different payload/);
      await assertAcceptance(config.sourceUrl, work, result.revisionId);
      return `Actual writer SIGKILL occurred after PostgreSQL COMMIT. Identical retry replayed ${result.revisionId} without a table change; changed payload reuse was rejected.`;
    });
    await record('database-incomplete-artifacts', async () => {
      for (const kind of ['missing', 'corrupt'] satisfies ('missing' | 'corrupt')[]) {
        const work = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'accepted', id: `w6-${kind}`,
          entityId: 'chair-a', properties: { x: 2.75 } });
        const before = await snapshot(config.sourceUrl, path.join(root, `${kind}-before.json`));
        const source = await verifyPackage(work.sourcePackage);
        const revision = source.manifest.revisions.find((item) => item.revisionId === hash(work.command));
        assert.ok(revision);
        const broken = path.join(root, `broken-${kind}`);
        await copyPackageForFault({ source: source.root, destination: broken, hash: revision.modelSha256, kind });
        await expectRejected(() => accept({ ...work, sourcePackage: broken }), path.join(root, `${kind}-artifact-rejected.txt`));
        const after = await snapshot(config.sourceUrl, path.join(root, `${kind}-after.json`));
        assert.equal(canonical(after.tables), canonical(before.tables));
        const retained = await readCurrent(sourceArtifacts);
        assert.ok(retained);
      }
      return 'Missing and corrupt model artifacts each prevented governed publication; fresh SQL exports of all tables were byte-equivalent and the retained complete artifact package reopened.';
    });
    const historical: Observation = { experimentId: 'EX-09', caseId: 'postgres-history-format-dictionary-upgrade',
      expected: 'Change a real representation format, property dictionary and serialization while retaining exact old database bytes and querying them with pinned and upgraded readers.',
      observed: 'History upgrade did not complete.', passed: false,
      limitations: ['This is a disposable W6 representation format over the W0 fixture. No production schema or geometry engine is migrated.'],
    };
    try { historical.observed = await historyUpgrade(config.sourceUrl, original, root, baseline.revisionId); historical.passed = true; }
    catch (error) { historical.observed = error instanceof Error ? error.message : String(error); }
    observations.push(historical);
    const fullHistory = observations.find((item) => item.caseId === 'pinned-historical-query');
    assert.ok(fullHistory);
    fullHistory.observed = 'Partial execution is recorded by postgres-history-format-dictionary-upgrade. A geometry-kernel upgrade has not executed, so the complete EX-09 assertion remains unqualified.';
    fullHistory.limitations = ['No real old/new geometry engine is available in this runner. Version descriptor changes cannot substitute for executing an engine upgrade.'];
    await record('independent-database-restore', async () => {
      const before = await snapshot(config.sourceUrl, path.join(root, 'dump-source.json'));
      const dump = path.join(root, 'recovery.dump');
      await cli({ executable: 'pg_dump', argv: ['--version'], directory: root, name: 'pg-dump-version' });
      await cli({ executable: 'pg_restore', argv: ['--version'], directory: root, name: 'pg-restore-version' });
      await cli({ executable: 'pg_dump', argv: ['--format=custom', '--no-owner', '--no-acl', '--file', dump, '--dbname', config.sourceUrl], directory: root, name: 'pg-dump' });
      await writeFile(dump + '.sha256', sha256(await readFile(dump)) + '\n', { flag: 'wx' });
      await cli({ executable: 'pg_restore', argv: ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', config.restoreUrl, dump], directory: root, name: 'pg-restore' });
      const source = await readCurrent(sourceArtifacts);
      assert.ok(source);
      const copied = await importPackage({ source: source.root, destination: restoredArtifacts });
      assert.equal(copied.manifestSha256, source.manifestSha256);
      assert.ok(lease.allowSourceConnectionBlock, 'Main must authorize blocking connections to the dedicated source database.');
      const sourceName = databaseName(config.sourceUrl);
      let blocked = false;
      let offline = false;
      try {
        await connected(config.restoreUrl, async (storage) => { await storage.client.query(`ALTER DATABASE "${sourceName}" ALLOW_CONNECTIONS false`); });
        blocked = true;
        await expectRejected(() => connected(config.sourceUrl, (storage) => storage.head('accepted')),
          path.join(root, 'source-connection-rejected.txt'), /not currently accepting connections/);
        await rename(sourceArtifacts, sourceArtifacts + '-offline');
        offline = true;
        const after = await snapshot(config.restoreUrl, path.join(root, 'restore-independent.json'));
        assert.equal(canonical(after.tables), canonical(before.tables));
        assert.equal(canonical(after.queries), canonical(before.queries));
        const independent = await readCurrent(restoredArtifacts);
        assert.ok(independent);
        assert.equal(independent.manifestSha256, source.manifestSha256);
      } finally {
        if (offline) await rename(sourceArtifacts + '-offline', sourceArtifacts);
        if (blocked) await connected(config.restoreUrl, async (storage) => { await storage.client.query(`ALTER DATABASE "${sourceName}" ALLOW_CONNECTIONS true`); });
      }
      return `Restored complete pg_dump into ${databaseName(config.restoreUrl)} and a separate artifact root. All table contents, canonical version hashes, paginated branch/historical documents, ancestry, deltas and receipts matched while source DB connections were rejected and source artifact paths were unavailable.`;
    }, ['Two databases share a PostgreSQL server and the qvm test role. Separate identity providers, encryption keys and host failure domains are not qualified.']);
    await record('disconnected-database-branches', async () => {
      const commonHead = await connected(config.sourceUrl, (storage) => storage.head('accepted'));
      assert.ok(commonHead);
      assert.equal(await connected(config.restoreUrl, (storage) => storage.head('accepted')), commonHead);
      await connected(config.sourceUrl, (storage) => storage.createBranch({ branch: 'company-a', revisionId: commonHead }));
      await connected(config.restoreUrl, (storage) => storage.createBranch({ branch: 'company-b', revisionId: commonHead }));
      const a = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'company-a', id: 'w6-local-a',
        entityId: 'pump', properties: { designDecision: 'company-a-routing' } });
      const aReceipt = await accept(a);
      const b = await prepare({ url: config.restoreUrl, artifactRoot: restoredArtifacts, branch: 'company-b', id: 'w6-local-b',
        entityId: 'pump', properties: { designDecision: 'company-b-routing' } });
      const bReceipt = await accept(b);
      assert.notEqual(aReceipt.revisionId, bReceipt.revisionId);
      const aPackage = await readCurrent(sourceArtifacts);
      const bPackage = await readCurrent(restoredArtifacts);
      assert.ok(aPackage && bPackage);
      const exchanged = await unionPackages({ left: aPackage, right: bPackage, root: path.join(root, 'portable-exchange') });
      await importPackage({ source: exchanged.root, destination: sourceArtifacts });
      await importPackage({ source: exchanged.root, destination: restoredArtifacts });
      await connected(config.restoreUrl, (storage) => storage.createBranch({ branch: 'company-a', revisionId: commonHead }));
      await connected(config.sourceUrl, (storage) => storage.createBranch({ branch: 'company-b', revisionId: commonHead }));
      const aImported = await accept({ ...a, databaseUrl: config.restoreUrl, artifactRoot: restoredArtifacts, sourcePackage: exchanged.root });
      const bImported = await accept({ ...b, databaseUrl: config.sourceUrl, artifactRoot: sourceArtifacts, sourcePackage: exchanged.root });
      assert.equal(aImported.revisionId, aReceipt.revisionId);
      assert.equal(bImported.revisionId, bReceipt.revisionId);
      const source = await snapshot(config.sourceUrl, path.join(root, 'divergence-source.json'));
      const restored = await snapshot(config.restoreUrl, path.join(root, 'divergence-restored.json'));
      // Independent replay has distinct database-created timestamps. Immutable content and ancestry IDs must agree.
      assert.equal(canonical(source.queries), canonical(restored.queries));
      await assertAcceptance(config.sourceUrl, a, aReceipt.revisionId);
      await assertAcceptance(config.sourceUrl, b, bReceipt.revisionId);
      const [aAncestry, bAncestry] = await connected(config.sourceUrl, async (storage) => Promise.all([
        storage.history('pump'), storage.delta(bReceipt.revisionId) ]));
      assert.ok(aAncestry.length >= 3 && bAncestry.length === 4);
      return `Independent databases created divergent pump changes from ${commonHead}. Portable exchange and governed replay preserved both branch tips ${aReceipt.revisionId} and ${bReceipt.revisionId}, full documents and both disciplines' evidence.`;
    }, ['Replay exchanges declared commands and portable artifacts. W5 retains single-parent database ancestry; this is not a full synchronization service or a multi-parent database merge.']);
    await record('discipline-atomic-acceptance', async () => {
      const work = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'accepted', id: 'w6-reconcile',
        entityId: 'pump', properties: { designDecision: 'reviewed-coordination-resolution' } });
      const aModel = await connected(config.sourceUrl, (storage) => modelAt(storage, 'company-a', original));
      const bModel = await connected(config.sourceUrl, (storage) => modelAt(storage, 'company-b', original));
      const aPump = aModel.entities.find((item) => item.id === 'pump');
      const bPump = bModel.entities.find((item) => item.id === 'pump');
      assert.ok(aPump && bPump && aPump.properties.designDecision !== bPump.properties.designDecision,
        'The actual two branch queries must exhibit a same-property semantic conflict.');
      const before = await snapshot(config.sourceUrl, path.join(root, 'authority-before.json'));
      const denied: AuthorityInput[] = [
        { ...work.authority, conflicts: [{ conflictId: 'pump-designDecision', resolvedByCandidateSha256: null }] },
        { ...work.authority, conflicts: [] },
        { ...work.authority, decisions: work.authority.decisions.slice(0, 1) },
        { ...work.authority, actors: [{ actorId: 'host-owner', kind: 'simulated-test-actor', disciplines: ['mechanical', 'electrical'] }] },
        { ...work.authority, candidateSha256: sha256('stale candidate') },
      ];
      await writeFile(path.join(root, 'denied-authority-inputs.json'), JSON.stringify(denied, null, 2), { flag: 'wx' });
      for (const [index, authority] of denied.entries()) await expectRejected(() => accept({ ...work, authority }),
        path.join(root, `authority-${index}-rejected.txt`));
      const unchanged = await snapshot(config.sourceUrl, path.join(root, 'authority-denied.json'));
      assert.equal(canonical(before.tables), canonical(unchanged.tables));
      const racing = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'accepted', id: 'w6-racing-head',
        entityId: 'chair-a', properties: { x: 2.875 } });
      await accept(racing);
      await expectRejected(() => accept(work), path.join(root, 'racing-head-rejected.txt'), /accepted head changed/);
      const refreshed = await prepare({ url: config.sourceUrl, artifactRoot: sourceArtifacts, branch: 'accepted', id: 'w6-reconcile-current',
        entityId: 'pump', properties: { designDecision: 'reviewed-coordination-resolution',
          sourceMechanicalRevision: await connected(config.sourceUrl, (storage) => storage.head('company-a')),
          sourceElectricalRevision: await connected(config.sourceUrl, (storage) => storage.head('company-b')) } });
      refreshed.authority.conflicts = [{ conflictId: 'pump-designDecision', resolvedByCandidateSha256: hash(refreshed.command) }];
      const result = await accept(refreshed);
      await assertAcceptance(config.sourceUrl, refreshed, result.revisionId);
      await snapshot(config.sourceUrl, path.join(root, 'authority-accepted.json'));
      return `Actual divergent same-property values required reconciliation. Unresolved conflict, one discipline, host-only authority, stale candidate and racing head were rejected; two distinct simulated discipline decisions, model delta, three evidence records, receipt and head committed together as ${result.revisionId}.`;
    }, ['Actors and decisions are explicitly simulated test policy. Conflict detection covers this scalar fixture property; no geometry solver, identity federation or cryptographic review authentication is claimed.']);
    // EX-09 retains its original uncovered status: keeping version labels is not an executed kernel upgrade.
    const final = await snapshot(config.sourceUrl, path.join(root, 'final-source.json'));
    await writeFile(path.join(root, 'historical-retention.json'), JSON.stringify({ seedRevision: baseline.revisionId,
      originalModelHash: initialPackage.manifest.revisions[0]?.modelSha256, snapshotSha256: hash(final.tables),
      limitation: 'Canonical full envelopes and historical queries are checked, but no old/new geometry engine or schema migration was executed.' }, null, 2), { flag: 'wx' });
  } catch (error) {
    await writeFile(path.join(root, 'setup-or-finalization-error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), { flag: 'wx' });
  }
  const validated = parseObservations(observations);
  const bytes = JSON.stringify(validated, null, 2) + '\n';
  await writeFile(path.join(root, 'observations.json'), bytes, { flag: 'wx' });
  await writeFile(path.join(root, 'observations.sha256'), sha256(bytes) + '\n', { flag: 'wx' });
  return validated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--writer' && process.argv[3] && process.argv.length === 4) {
    const input: unknown = JSON.parse(await readFile(process.argv[3], 'utf8'));
    if (!Check(WorkerSchema, input)) throw new Error('Invalid database writer input.');
    await worker(input);
  } else {
    const configPath = process.argv[2];
    const leasePath = process.argv[3];
    if (!configPath || !leasePath || process.argv.length !== 4) throw new Error('Usage: node experiments/recovery/postgres.ts <config.json> <main-database-lease.json>');
    const config: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    const lease: unknown = JSON.parse(await readFile(leasePath, 'utf8'));
    if (!Check(ConfigSchema, config) || !Check(DatabaseLeaseSchema, lease)) throw new Error('Invalid W6 PostgreSQL configuration/lease.');
    const observations = await runPostgresCases(config, lease);
    process.stdout.write(JSON.stringify(observations, null, 2) + '\n');
    if (observations.some((observation) => !observation.passed)) process.exitCode = 1;
  }
}
