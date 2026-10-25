import { mkdir, open, readFile, statfs, writeFile, chmod } from 'node:fs/promises';
import { hostname, cpus, totalmem, release } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { errorMessage, hash, HashSchema, IdSchema, parse, JsonSchema } from './contract.ts';
import type { Json, Observation, StoredEntity } from './contract.ts';
import { Storage } from './store.ts';
import { envelopes, fileHash, Fingerprint, inspectBranch, load, walDifference } from './load.ts';
import { fixtureEnvelopes, fromArray } from './fixture.ts';
import { nativeEnvelopes, rebuildNative, saveSnapshot, snapshotAt } from './baseline.ts';
import { w4Input, w4Generator } from './w4.ts';
import { ExecutionSchema, assessBudgets, spaceSnapshot, validateExecution } from './envelope.ts';

export const ConfigSchema = Type.Object({
  experimentId: Type.Union([Type.Literal('EX-10'), Type.Literal('EX-13')]), runId: IdSchema, branch: IdSchema,
  dataset: Type.String({ minLength: 1 }), format: Type.Union([Type.Literal('envelopes'), Type.Literal('w0-fixture'), Type.Literal('native-snapshot'), Type.Literal('w4-copy'), Type.Literal('w4-generator')]),
  scale: Type.Union([Type.Literal('fixture'), Type.Literal('smoke'), Type.Literal('reduced'), Type.Literal('medium'), Type.Literal('full'), Type.Literal('detail-stress')]),
  repeats: Type.Integer({ minimum: 1, maximum: 100 }), historyRevisions: Type.Integer({ minimum: 1, maximum: 1000 }),
  clients: Type.Integer({ minimum: 1, maximum: 32 }), mixedOperationsPerClient: Type.Integer({ minimum: 2, maximum: 1000 }),
  writeEvery: Type.Integer({ minimum: 2, maximum: 10 }), pageSize: Type.Integer({ minimum: 1, maximum: 1000 }),
  cacheLabel: Type.String({ minLength: 1 }), leaseMode: Type.Union([Type.Literal('shared-correctness'), Type.Literal('exclusive-measurement')]),
  statementTimeoutMs: Type.Integer({ minimum: 1000, maximum: 3600000 }),
  materializationDiagnostic: Type.Boolean(),
  execution: ExecutionSchema,
  environment: Type.Object({
    nodeImage: Type.String({ minLength: 1 }), postgresImage: Type.String({ minLength: 1 }), sourceCommit: Type.String({ pattern: '^[a-f0-9]{40}$' }),
    nodeCpuLimit: Type.Number({ exclusiveMinimum: 0 }), nodeMemoryLimitBytes: Type.Integer({ minimum: 1 }),
    postgresCpuLimit: Type.Number({ exclusiveMinimum: 0 }), postgresMemoryLimitBytes: Type.Integer({ minimum: 1 }),
    diskBudgetBytes: Type.Integer({ minimum: 1 }), storageDescription: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type Config = Static<typeof ConfigSchema>;

async function procFile(filename: string): Promise<string> {
  try { return await readFile(filename, 'utf8'); } catch (error) { return `unavailable: ${errorMessage(error)}`; }
}

export async function inputFor(config: Pick<Config, 'dataset' | 'format'>): Promise<AsyncIterable<StoredEntity>> {
  if (config.format === 'envelopes') return envelopes(config.dataset);
  if (config.format === 'w4-copy') return w4Input(config.dataset);
  if (config.format === 'w4-generator') return w4Generator(config.dataset);
  const document: unknown = JSON.parse(await readFile(config.dataset, 'utf8'));
  return fromArray(config.format === 'w0-fixture' ? fixtureEnvelopes(document) : nativeEnvelopes(document).entities);
}

export async function runWorkload(store: Storage, rawConfig: unknown, directory: string): Promise<Observation[]> {
  const config = parse(ConfigSchema, rawConfig, 'workload config');
  validateExecution(config);
  if (await fileHash(config.execution.decisionPath) !== config.execution.decisionSha256) throw new Error('Predeclared execution decision hash mismatch');
  if (!process.env.QVM_EXECUTION_LEASE) throw new Error('Coordinator execution lease is required');
  if ((config.scale === 'full' || config.scale === 'detail-stress') && config.leaseMode !== 'exclusive-measurement') {
    throw new Error('Full capacity measurements require an exclusive coordinator lease');
  }
  const free = await statfs(path.dirname(directory));
  await spaceSnapshot(config.execution);
  await mkdir(directory);
  const observations: Observation[] = [];
  const errors: string[] = [];
  const samples = await open(path.join(directory, 'samples.ndjson'), 'wx');
  const sampleRows: Json[] = [];
  const artifact = async (name: string, value: unknown): Promise<void> => {
    await writeFile(path.join(directory, name), `${JSON.stringify(parse(JsonSchema, value, name), null, 2)}\n`, { flag: 'wx' });
  };
  const observe = (caseId: string, expected: string, observed: string, passed: boolean, limitations: string[] = []): void => {
    observations.push({ experimentId: config.experimentId, caseId, expected, observed, passed, limitations });
  };
  const sample = async (operation: string, repeat: number, variant: string, work: () => Promise<Json>): Promise<void> => {
    await spaceSnapshot(config.execution);
    const startedAt = new Date().toISOString();
    const start = performance.now();
    let result: Json = null;
    let error: string | null = null;
    try { result = await work(); } catch (failure) { error = errorMessage(failure); errors.push(`${operation}: ${error}`); }
    const row = { operation, repeat, variant, startedAt, elapsedMs: performance.now() - start,
      result, error, cacheLabel: config.cacheLabel, memory: process.memoryUsage(), resources: process.resourceUsage() };
    sampleRows.push(parse(JsonSchema, row, 'raw sample'));
    await samples.write(`${JSON.stringify(row)}\n`);
  };
  try {
    await store.client.query(`SELECT set_config('statement_timeout',$1,false)`, [String(config.execution.loadStatementTimeoutMs)]);
    await artifact('config.json', config);
    await artifact('execution-envelope.json', { ...config.execution, spaceBefore: await spaceSnapshot(config.execution),
      enforcement: 'Client checks reserves and cooperative load deadline; coordinator watchdog enforces total shared 200 GiB allocation and hard wall timeout.',
      claim: config.execution.purpose === 'extended-initial-inventory'
        ? 'Separate extended initial inventory completion experiment; cannot pass the original two-hour acceptance target.'
        : config.execution.purpose === 'resource-sensitivity-initial-inventory'
        ? 'Controlled reduced/medium resource sensitivity experiment; cannot qualify the original full inventory target.'
        : 'Exploratory budgets, not product SLOs; no winner without limiter and tuning evidence.' });
    await artifact('environment.json', {
      timestamp: new Date().toISOString(), host: hostname(), osRelease: release(), cpus: cpus().map((cpu) => cpu.model), totalmem: totalmem(),
      node: process.version, versions: process.versions, argv: process.argv, execArgv: process.execArgv,
      lease: process.env.QVM_EXECUTION_LEASE, declaredLimits: config.environment,
      cgroupCpu: await procFile('/sys/fs/cgroup/cpu.max'), cgroupMemory: await procFile('/sys/fs/cgroup/memory.max'),
      mounts: await procFile('/proc/mounts'), disk: { availableBytes: free.bavail * free.bsize, blockBytes: free.bsize },
    });
    await artifact('metrics-before.json', await store.metrics());
    const [lsn] = await store.rows(Type.Object({ lsn: Type.String() }), `SELECT pg_current_wal_lsn()::text AS lsn`);
    if (!lsn) throw new Error('Missing start WAL LSN');
    const loadStart = performance.now();
    const checkpoint = async (): Promise<void> => {
      const remaining = config.execution.loadWallTimeLimitMs - (performance.now() - loadStart);
      if (remaining <= 0) throw new Error('Predeclared load wall-time limit exceeded');
      await spaceSnapshot(config.execution);
      await store.client.query(`SELECT set_config('statement_timeout',$1,false)`, [String(Math.max(1, Math.floor(Math.min(config.execution.loadStatementTimeoutMs, remaining))))]);
    };
    const LoadSummary = Type.Object({ revisionId: HashSchema,
      fingerprint: Type.Object({ count: Type.Integer({ minimum: 1 }), sum: HashSchema, xor: HashSchema }),
      countsByKind: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
      propertyValuesByRecordCategory: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    });
    const mode = config.execution.mode;
    const loaded = mode.kind === 'measure-existing'
      ? parse(LoadSummary, JSON.parse(await readFile(mode.loadRecord, 'utf8')), 'preserved load artifact')
      : await load(store, await inputFor(config), config.branch, { checkpoint });
    if (await store.head(config.branch) !== loaded.revisionId) throw new Error('Measured branch must start at the pinned initial load revision');
    await artifact('load.json', { ...loaded, fileSha256: await fileHash(config.dataset), reused: mode.kind === 'measure-existing' });
    const actual = await inspectBranch(store, config.branch);
    const propertyValues = await store.propertyCounts(config.branch);
    await artifact('property-values.json', { expected: loaded.propertyValuesByRecordCategory, actual: propertyValues });
    await artifact('oracle.json', { expected: { fingerprint: loaded.fingerprint, countsByKind: loaded.countsByKind }, actual });
    const oracle = hash(actual) === hash({ fingerprint: loaded.fingerprint, countsByKind: loaded.countsByKind })
      && hash(propertyValues) === hash(loaded.propertyValuesByRecordCategory);
    observe('source-query-oracle', 'All source documents, counts by kind and canonical hashes survive load', JSON.stringify(actual), oracle);
    if (!oracle) throw new Error('Load checksum/count oracle failed; refusing timings');
    await store.client.query(`SELECT set_config('statement_timeout',$1,false)`, [String(config.statementTimeoutMs)]);
    if (mode.kind === 'load-only') {
      await artifact('metrics-loaded.json', await store.metrics());
      const extended = config.execution.purpose === 'extended-initial-inventory';
      const sensitivity = config.execution.purpose === 'resource-sensitivity-initial-inventory';
      if (extended || sensitivity) await checkpoint();
      observe(extended || sensitivity ? config.execution.purpose : 'initial-inventory',
        extended || sensitivity ? 'Separate initial inventory experiment published at one revision within the declared limit'
          : 'Initial inventory published at one revision before bounded updates',
        JSON.stringify({ revisionId: loaded.revisionId, records: loaded.fingerprint.count }), true,
        extended ? ['Separate completion experiment; cannot pass the original two-hour acceptance target.']
          : sensitivity ? ['Controlled reduced/medium resource sensitivity experiment; cannot qualify the original full inventory target.'] : []);
      return observations;
    }
    const firstPage = await store.page({ branch: config.branch, after: '', limit: config.pageSize });
    const first = firstPage[0];
    if (!first) throw new Error('No workload entity');
    const workingSetHash = hash(firstPage.map((row) => row.entity));
    const [graphSeed] = await store.rows(Type.Object({ id: Type.String() }),
      `SELECT from_id AS id FROM qvm_storage.visibility WHERE branch=$1 AND from_id IS NOT NULL ORDER BY entity_id LIMIT 1`, [config.branch]);
    let nativeSnapshot: Json | null = null;
    if (config.format === 'native-snapshot') {
      const source: unknown = JSON.parse(await readFile(config.dataset, 'utf8'));
      nativeSnapshot = nativeEnvelopes(source).snapshot;
      await saveSnapshot(store, loaded.revisionId, nativeSnapshot);
    }
    await artifact('metrics-ready.json', await store.metrics());
    // Explicit warmup; neither OS page cache nor PostgreSQL shared buffers are flushed.
    await store.page({ branch: config.branch, after: '', limit: config.pageSize });
    await sample('warmup-historical-page', -1, 'warmup', async () => {
      const page = await store.historical({ revisionId: loaded.revisionId, after: '', limit: config.pageSize });
      return { count: page.length, checksum: hash(page.map((row) => row.entity)) };
    });
    await store.detail({ branch: config.branch, entityId: first.entity.entityId });
    await store.projection({ branch: config.branch, field: 'from_id', id: graphSeed?.id ?? first.entity.entityId, limit: config.pageSize });
    if (config.materializationDiagnostic && nativeSnapshot === null) {
      await sample('full-materialization-diagnostic', 0, 'candidate', async () => {
        const result = (await inspectBranch(store, config.branch)).fingerprint;
        if (hash(result) !== hash(loaded.fingerprint)) throw new Error('Diagnostic source checksum mismatch');
        return result;
      });
    }
    for (let repeat = 0; repeat < config.repeats; repeat += 1) {
      const variants = repeat % 2 === 0 ? ['candidate', 'snapshot'] : ['snapshot', 'candidate'];
      for (const variant of variants) {
        if (nativeSnapshot === null) continue;
        await sample('bounded-native-materialization', repeat, variant, async () => {
          if (variant === 'snapshot') {
            const native = nativeEnvelopes(await snapshotAt(store, loaded.revisionId));
            const digest = new Fingerprint(); native.entities.forEach((item) => digest.add(item));
            const result = digest.value();
            if (hash(result) !== hash(loaded.fingerprint)) throw new Error('Snapshot/candidate checksum mismatch');
            return result;
          }
          const result = (await inspectBranch(store, config.branch)).fingerprint;
          if (hash(result) !== hash(loaded.fingerprint)) throw new Error('Candidate open checksum mismatch');
          return result;
        });
      }
      await sample('project-open', repeat, 'candidate', async () => {
        const opened = await store.projectOpen({ branch: config.branch, limit: config.pageSize });
        const checksum = hash(opened.page.map((row) => row.entity));
        if (opened.head !== loaded.revisionId || checksum !== workingSetHash) throw new Error('Project-open head/page oracle mismatch');
        return { head: opened.head, manifest: opened.manifest, count: opened.page.length, checksum };
      });
      await sample('page-query', repeat, 'candidate', async () => {
        const page = await store.page({ branch: config.branch, after: '', limit: config.pageSize });
        const checksum = hash(page.map((row) => row.entity));
        if (checksum !== workingSetHash) throw new Error('Working set checksum changed before edits');
        return { count: page.length, checksum };
      });
      await sample('entity-detail', repeat, 'candidate', async () => {
        const detail = await store.detail({ branch: config.branch, entityId: first.entity.entityId });
        if (detail?.versionId !== first.versionId) throw new Error('Detail oracle mismatch');
        return { versionId: detail.versionId, checksum: hash(detail.entity) };
      });
      await sample('one-hop', repeat, 'candidate', async () => {
        const edges = await store.projection({ branch: config.branch, field: 'from_id', id: graphSeed?.id ?? first.entity.entityId, limit: config.pageSize });
        return { count: edges.length, checksum: hash(edges.map((row) => row.entity)), capped: edges.length === config.pageSize };
      });
      await sample('historical-page', repeat, 'candidate', async () => {
        const page = await store.historical({ revisionId: loaded.revisionId, after: '', limit: config.pageSize });
        const checksum = hash(page.map((row) => row.entity));
        if (checksum !== workingSetHash) throw new Error('Historical reconstruction differs');
        return { count: page.length, checksum };
      });
      await sample('graph-traversal', repeat, 'candidate', async () => {
        const seed = graphSeed?.id ?? first.entity.entityId;
        const visited = new Set<string>([seed]);
        let frontier = [seed];
        const traversed: string[] = [];
        let capped = false;
        for (let depth = 0; depth < 3 && frontier.length > 0; depth += 1) {
          const next: string[] = [];
          for (const id of frontier) {
            const edges = await store.projection({ branch: config.branch, field: 'from_id', id, limit: config.pageSize });
            if (edges.length === config.pageSize) capped = true;
            for (const edge of edges) {
              traversed.push(edge.versionId);
              const target = edge.entity.toId;
              if (target && !visited.has(target) && visited.size < config.pageSize) { visited.add(target); next.push(target); }
              else if (target && !visited.has(target)) capped = true;
            }
          }
          frontier = next;
        }
        return { visited: visited.size, edges: traversed.length, checksum: hash(traversed.sort()), capped, depthBound: 3 };
      });
      await sample('type-fanout', repeat, 'candidate', async () => {
        const [type] = await store.rows(Type.Object({ id: Type.Union([Type.String(), Type.Null()]) }),
          `SELECT type_id AS id FROM qvm_storage.visibility WHERE branch=$1 AND type_id IS NOT NULL ORDER BY entity_id LIMIT 1`, [config.branch]);
        if (!type?.id) return { supported: false, reason: 'Dataset has no type projection' };
        const rows = await store.projection({ branch: config.branch, field: 'type_id', id: type.id, limit: config.pageSize });
        return { typeId: type.id, count: rows.length, checksum: hash(rows.map((row) => row.entity)), capped: rows.length === config.pageSize };
      });
    }
    observe('bounded-baseline', 'Five or more alternating repetitions at existing validated snapshot bounds',
      nativeSnapshot === null ? 'No native product snapshot supplied; relative baseline comparison not executed' : `${config.repeats} alternating open-checksum samples per variant`,
      nativeSnapshot !== null, nativeSnapshot === null ? ['Hospital/W0 entity kinds are outside the existing product snapshot contract. Run native-snapshot separately.'] :
        ['Snapshot layout is a PostgreSQL reference storing product-validated full snapshots; it is not the existing runtime persistence adapter.']);
    let head = loaded.revisionId;
    const editTarget = nativeSnapshot === null ? first.entity : nativeEnvelopes(nativeSnapshot).entities.find((item) => item.fromId === null && typeof item.document.name === 'string');
    if (!editTarget) throw new Error('No bounded edit target');
    let current: StoredEntity = editTarget;
    let currentHash = hash(current);
    for (let index = 1; index < config.historyRevisions; index += 1) {
      await sample('bounded-acceptance', index, 'candidate', async () => {
        const changed = { ...current, document: { ...current.document,
          ...(nativeSnapshot === null ? { qualificationRevision: index } : { name: `W5 revision ${index}` }) } };
        const accepted = await store.accept({ branch: config.branch, commandId: `${config.runId}:history:${index}`, expectedHead: head,
          assumptions: [{ entityId: current.entityId, versionId: currentHash }], puts: [changed], deletes: [] });
        head = accepted.revisionId; current = changed; currentHash = hash(changed);
        return { head, changedId: current.entityId, versionId: currentHash };
      });
      await sample('bounded-delta', index, 'candidate', async () => {
        const delta = await store.delta(head);
        if (delta.length !== 1 || delta[0]?.entity_id !== current.entityId || delta[0].version_id !== currentHash) throw new Error('Delta oracle mismatch');
        return { revisionId: head, delta };
      });
      if (nativeSnapshot !== null) {
        const all = await store.page({ branch: config.branch, after: '', limit: 1000 });
        nativeSnapshot = rebuildNative(nativeSnapshot, all.map((row) => row.entity));
        await sample('snapshot-retain', index, 'snapshot', async () => {
          if (nativeSnapshot === null) throw new Error('Missing native snapshot');
          await saveSnapshot(store, head, nativeSnapshot);
          return { revisionId: head, checksum: hash(nativeSnapshot) };
        });
      }
    }
    await sample('entity-history', 0, 'candidate', async () => {
      const rows = await store.history(current.entityId);
      return { count: rows.length, checksum: hash(rows) };
    });
    const oldPage = await store.historical({ revisionId: loaded.revisionId, after: '', limit: config.pageSize });
    observe('immutable-reconstruction', 'Initial revision remains identical after aged bounded edits',
      hash(oldPage.map((row) => row.entity)), hash(oldPage.map((row) => row.entity)) === workingSetHash);
    await artifact('metrics-aged.json', await store.metrics());
    await artifact('traffic.json', await mixed(store, config, current, sample));
    await artifact('metrics-after.json', await store.metrics());
    await artifact('growth.json', { walBytesSinceStart: await walDifference(store, lsn.lsn),
      walScope: 'cluster-wide LSN difference; includes concurrent activity under a shared correctness lease',
      processMemory: process.memoryUsage(), processResources: process.resourceUsage(),
      cgroupMemoryPeak: await procFile('/sys/fs/cgroup/memory.peak'), cgroupCpuStats: await procFile('/sys/fs/cgroup/cpu.stat') });
    observe('workload-errors', 'Every executed database operation completes without unexpected errors', JSON.stringify(errors), errors.length === 0);
    observe('capacity-scope', 'Full hospital capacity requires admitted full inventory and complete workload coverage',
      `${config.scale}: ${loaded.fingerprint.count} records; ${config.historyRevisions} requested history revisions`, false,
      ['Partial storage workload only: no geometry, solver, predicate conflicts, artifact bytes, backup/restore, offered-rate pacing, deletion churn or engineering validity claim.',
        'Graph and fanout queries are explicitly capped; reference validation scans the entire branch per acceptance.',
        'Historical reconstruction scans ancestry deltas without checkpoints. Current visibility is copied per branch.',
        'Type fanout is an indexed instance lookup, not evaluated regeneration. No independently varied 8/32-branch or 64-client matrix is implemented.',
        'Global PG metrics can include other correctness streams. Full measurements require exclusive scheduling.']);
  } catch (error) {
    errors.push(errorMessage(error));
    observe('execution-failure', 'Admitted workload completes', errorMessage(error), false, ['Failed behavior is retained as evidence.']);
  } finally {
    await samples.close();
    const budgets = assessBudgets(config.execution, sampleRows);
    await artifact('exploratory-budgets.json', budgets);
    if (config.execution.mode.kind !== 'load-only') {
      for (const result of budgets.operations) observe(`exploratory-p95-${result.operation}`,
        `Predeclared exploratory p95 <= ${result.budgetMs} ms; successful single-client samples required`,
        JSON.stringify(result), result.passed, budgets.eligible ? [] : ['Run is not the warm single-client exploratory scenario; budget qualification is unavailable.']);
    }
    await artifact('observations.json', observations);
    await artifact('errors.json', errors);
    await artifact('sample-summary.json', summarize(sampleRows));
    const files = ['samples.ndjson', 'observations.json', 'errors.json', 'sample-summary.json', 'exploratory-budgets.json'];
    await artifact('artifact-checksums.json', await Promise.all(files.map(async (file) => ({ file, sha256: await fileHash(path.join(directory, file)) }))));
    await Promise.all(files.map((file) => chmod(path.join(directory, file), 0o444)));
  }
  return observations;
}

function summarize(samples: Json[]): Json {
  const schema = Type.Object({ operation: Type.String(), variant: Type.String(), elapsedMs: Type.Number(), error: Type.Union([Type.String(), Type.Null()]) });
  const groups = new Map<string, number[]>();
  for (const sample of samples) {
    const row = parse(schema, sample, 'sample summary input');
    if (row.error !== null) continue;
    const key = `${row.operation}/${row.variant}`;
    const times = groups.get(key) ?? []; times.push(row.elapsedMs); groups.set(key, times);
  }
  return [...groups].map(([operation, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (fraction: number): number => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
    return { operation, n: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
  });
}

async function mixed(store: Storage, config: Config, target: StoredEntity,
  sample: (operation: string, repeat: number, variant: string, work: () => Promise<Json>) => Promise<void>): Promise<Json> {
  const connections: Client[] = [];
  const started = performance.now();
  try {
    for (let index = 0; index < config.clients; index += 1) {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect(); connections.push(client);
      await client.query(`SELECT set_config('statement_timeout',$1,false)`, [String(config.statementTimeoutMs)]);
    }
    await Promise.all(connections.map(async (client, clientIndex) => {
      const independent = new Storage(client);
      for (let index = 0; index < config.mixedOperationsPerClient; index += 1) {
        await sample(index % config.writeEvery === 0 ? 'mixed-write' : 'mixed-read', index, `client-${clientIndex}`, async () => {
          if (index % config.writeEvery !== 0) {
            const rows = await independent.page({ branch: config.branch, after: '', limit: config.pageSize });
            return { count: rows.length, checksum: hash(rows.map((row) => row.entity)) };
          }
          const expectedHead = await independent.head(config.branch);
          const [visible] = await independent.rows(Type.Object({ version_id: Type.String() }),
            `SELECT version_id FROM qvm_storage.visibility WHERE branch=$1 AND entity_id=$2`, [config.branch, target.entityId]);
          const changed = { ...target, document: { ...target.document,
            ...(config.format === 'native-snapshot' ? { name: `W5 mix ${clientIndex}/${index}` } : { mixedClient: clientIndex, mixedOperation: index }) } };
          try {
            const result = await independent.accept({ branch: config.branch, commandId: `${config.runId}:mixed:${clientIndex}:${index}`,
              expectedHead, assumptions: [{ entityId: target.entityId, versionId: visible?.version_id ?? null }], puts: [changed], deletes: [] });
            return { ...result, outcome: 'accepted' };
          } catch (error) {
            const reason = errorMessage(error);
            if (!reason.includes('CAS conflict')) throw error;
            return { outcome: 'conflict', reason };
          }
        });
      }
    }));
  } finally { await Promise.all(connections.map((client) => client.end())); }
  await store.validateReferences(config.branch);
  const elapsedMs = performance.now() - started;
  return { mode: 'closed-loop unpaced contention', clients: config.clients,
    attemptedOperations: config.clients * config.mixedOperationsPerClient, elapsedMs,
    achievedAttemptsPerSecond: config.clients * config.mixedOperationsPerClient / (elapsedMs / 1000),
    configuredWriteEvery: config.writeEvery, offeredRate: null,
    limitation: 'Includes connection setup, expected CAS rejection and final integrity validation; no offered-rate/latency budget qualification.' };
}
