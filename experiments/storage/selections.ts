import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { HashSchema, IdSchema, parse } from './contract.ts';
import type { Observation } from './contract.ts';
import type { Storage } from './store.ts';

const definitions = [
  { caseId: 'hot-space-members', wireField: 'space_id', column: 'container_id' },
  { caseId: 'shared-type-members', wireField: 'type_id', column: 'type_id' },
  { caseId: 'system-members-including-ports', wireField: 'system_id', column: 'system_id' },
] as const;
type Definition = typeof definitions[number];
const ManifestSchema = Type.Object({ oracles: Type.Array(Type.Object({
  caseId: Type.String({ minLength: 1 }), sql: Type.String(), expected: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }),
  orderedIdCopySql: Type.Optional(Type.String()), orderedIdSha256: Type.Optional(HashSchema),
})) });
const IdRowSchema = Type.Object({ entity_id: Type.String() });
const maxBigint = 9223372036854775807n;

export function numericId(value: string): string {
  const match = /^entity:([0-9]{19})$/.exec(value);
  const digits = match?.[1];
  if (!digits) throw new Error(`Not a padded W4 entity identity: ${value}`);
  const number = BigInt(digits);
  if (number < 1n || number > maxBigint) throw new Error('W4 entity identity exceeds positive PostgreSQL bigint bounds');
  return number.toString();
}

function projectedId(value: string): string {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) throw new Error('Oracle target must be a canonical positive bigint');
  const id = BigInt(value);
  if (id > maxBigint) throw new Error('Oracle target exceeds PostgreSQL bigint');
  return `entity:${value.padStart(19, '0')}`;
}

export function selectionOracles(input: unknown) {
  const manifest = parse(ManifestSchema, input, 'W4 selection manifest');
  const known = new Set<string>(definitions.map((item) => item.caseId));
  for (const oracle of manifest.oracles) {
    if (!known.has(oracle.caseId) && (oracle.orderedIdCopySql !== undefined || oracle.orderedIdSha256 !== undefined)) {
      throw new Error(`Unsupported ordered-ID oracle: ${oracle.caseId}`);
    }
  }
  return definitions.map((definition) => {
    const matches = manifest.oracles.filter((oracle) => oracle.caseId === definition.caseId);
    const oracle = matches[0];
    if (matches.length !== 1 || !oracle || oracle.orderedIdSha256 === undefined) throw new Error(`Missing or duplicate selection oracle: ${definition.caseId}`);
    const pattern = new RegExp(`^SELECT count\\(\\*\\) FROM entities WHERE ${definition.wireField} = ([1-9][0-9]{0,18})$`);
    const target = pattern.exec(oracle.sql)?.[1];
    if (!target) throw new Error(`Unexpected selection predicate for ${definition.caseId}`);
    const expectedCopy = `COPY (SELECT id FROM entities WHERE ${definition.wireField} = ${target} ORDER BY id) TO STDOUT`;
    if (oracle.orderedIdCopySql !== expectedCopy) throw new Error(`Ordered-ID predicate differs for ${definition.caseId}`);
    return { ...definition, targetId: projectedId(target), expectedCount: oracle.expected, expectedSha256: oracle.orderedIdSha256 };
  });
}

export async function digestIds(rows: AsyncIterable<string>, maximumRows: number): Promise<{
  count: number; sha256: string; complete: boolean;
}> {
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 1) throw new Error('Maximum rows must be a positive safe integer');
  const digest = createHash('sha256');
  let count = 0;
  let previous = 0n;
  for await (const row of rows) {
    if (count === maximumRows) return { count, sha256: digest.digest('hex'), complete: false };
    const id = numericId(row);
    const numeric = BigInt(id);
    if (numeric <= previous) throw new Error('Selection IDs must be strictly increasing, with no duplicates');
    digest.update(`${id}\n`, 'utf8');
    previous = numeric; count += 1;
  }
  return { count, sha256: digest.digest('hex'), complete: true };
}

async function* selectedIds(store: Storage, definition: Definition, input: {
  branch: string; targetId: string; pageSize: number; deadline: number; statementTimeoutMs: number;
}): AsyncGenerator<string> {
  let after = '';
  while (true) {
    const remaining = Math.floor(input.deadline - performance.now());
    if (remaining < 1) throw new Error('Selection verification wall-time limit exceeded');
    await store.client.query(`SELECT set_config('statement_timeout',$1,true)`, [String(Math.min(input.statementTimeoutMs, remaining))]);
    // Only this source-owned whitelist can select a column. No SQL text from the manifest is executed.
    const rows = await store.rows(IdRowSchema, `SELECT entity_id FROM qvm_storage.visibility
      WHERE branch=$1 AND ${definition.column}=$2 AND entity_id>$3 AND entity_id LIKE 'entity:%'
      ORDER BY entity_id LIMIT $4`, [input.branch, input.targetId, after, input.pageSize]);
    for (const row of rows) yield row.entity_id;
    const last = rows.at(-1);
    if (!last || rows.length < input.pageSize) return;
    after = last.entity_id;
  }
}

export async function verifySelections(store: Storage, manifest: unknown, input: {
  branch: string; manifestSha256: string; pageSize: number; maximumRows: number; statementTimeoutMs: number; wallTimeMs: number;
}) {
  if (!process.env.QVM_EXECUTION_LEASE) throw new Error('Coordinator correctness lease is required');
  parse(IdSchema, input.branch, 'oracle branch');
  parse(HashSchema, input.manifestSha256, 'manifest hash');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 1000) throw new Error('Selection page size must be 1..1000');
  for (const [name, value] of Object.entries({ maximumRows: input.maximumRows, statementTimeoutMs: input.statementTimeoutMs, wallTimeMs: input.wallTimeMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  }
  const oracles = selectionOracles(manifest);
  const startedAt = new Date().toISOString();
  const deadline = performance.now() + input.wallTimeMs;
  const observations: Observation[] = [];
  const results: { caseId: string; projection: string; targetId: string; expectedCount: number; expectedSha256: string;
    count: number; sha256: string; complete: boolean; elapsedMs: number; passed: boolean }[] = [];
  await store.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await store.client.query(`SELECT set_config('statement_timeout',$1,true)`, [String(Math.min(input.statementTimeoutMs, input.wallTimeMs))]);
    const revisionId = await store.head(input.branch);
    if (revisionId === null) throw new Error('Selection verification requires a published branch');
    for (const oracle of oracles) {
      const started = performance.now();
      const remaining = Math.floor(deadline - performance.now());
      if (remaining < 1) throw new Error('Selection verification wall-time limit exceeded');
      await store.client.query(`SELECT set_config('statement_timeout',$1,true)`, [String(Math.min(input.statementTimeoutMs, remaining))]);
      const actual = await digestIds(selectedIds(store, oracle, { ...input, targetId: oracle.targetId, deadline }), input.maximumRows);
      const passed = actual.complete && actual.count === oracle.expectedCount && actual.sha256 === oracle.expectedSha256;
      results.push({ caseId: oracle.caseId, projection: oracle.column, targetId: oracle.targetId,
        expectedCount: oracle.expectedCount, expectedSha256: oracle.expectedSha256,
        ...actual, elapsedMs: performance.now() - started, passed });
      observations.push({ experimentId: 'EX-13', caseId: oracle.caseId,
        expected: `count=${oracle.expectedCount}; SHA-256 of ascending decimal numeric IDs plus LF=${oracle.expectedSha256}`,
        observed: JSON.stringify(actual), passed,
        limitations: actual.complete ? [] : ['Row bound reached: count and hash describe only the consumed prefix; full selection remains unverified.'] });
    }
    await store.client.query('COMMIT');
    return { branch: input.branch, revisionId, manifestSha256: input.manifestSha256, startedAt, finishedAt: new Date().toISOString(),
      pageSize: input.pageSize, maximumRows: input.maximumRows, statementTimeoutMs: input.statementTimeoutMs,
      wallTimeMs: input.wallTimeMs, executionLease: process.env.QVM_EXECUTION_LEASE,
      results, observations, passed: results.every((result) => result.passed),
      limitations: ['Read-only projection verification only; no performance, geometry, approval or full EX-13 coverage claim.'] };
  } catch (error) {
    await store.client.query('ROLLBACK');
    throw error;
  }
}

export async function verifySelectionFile(store: Storage, filename: string, input: {
  branch: string; pageSize: number; maximumRows: number; statementTimeoutMs: number; wallTimeMs: number;
}) {
  const bytes = await readFile(filename);
  const manifest: unknown = JSON.parse(bytes.toString('utf8'));
  return verifySelections(store, manifest, { ...input, manifestSha256: createHash('sha256').update(bytes).digest('hex') });
}
