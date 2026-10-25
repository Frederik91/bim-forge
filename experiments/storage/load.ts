import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { entity, hash, parse, IdSchema } from './contract.ts';
import type { StoredEntity } from './contract.ts';
import type { Storage } from './store.ts';
import { boundedLines } from './lines.ts';
import { PreparedEntity } from './prepared.ts';

export class Fingerprint {
  count = 0;
  private sum = 0n;
  private xor = 0n;
  add(value: StoredEntity): void {
    this.addHash(hash(value));
  }
  addPrepared(value: PreparedEntity): void { this.addHash(value.versionId); }
  private addHash(value: string): void {
    const digest = BigInt(`0x${value}`);
    this.count += 1;
    this.sum = (this.sum + digest) % (1n << 256n);
    this.xor ^= digest;
  }
  value(): { count: number; sum: string; xor: string } {
    return { count: this.count, sum: this.sum.toString(16).padStart(64, '0'), xor: this.xor.toString(16).padStart(64, '0') };
  }
}

export async function fileHash(filename: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Expected file bytes');
    digest.update(chunk);
  }
  return digest.digest('hex');
}

export async function* envelopes(filename: string): AsyncGenerator<StoredEntity> {
  const input = createReadStream(filename);
  try {
    for await (const line of boundedLines(input)) {
      if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('Envelope exceeds 4 MiB admission bound');
      if (!line.trim()) throw new Error('Blank NDJSON record');
      const value: unknown = JSON.parse(line);
      yield entity(value);
    }
  } finally { input.destroy(); }
}

export async function load(store: Storage, input: AsyncIterable<StoredEntity>, branch: string, control?: { checkpoint: () => Promise<void> }): Promise<{
  revisionId: string; fingerprint: ReturnType<Fingerprint['value']>; countsByKind: Record<string, number>;
  phasesMs: { ingest: number; publication: number; analyze: number }; canonicalBytes: number;
  propertyValuesByRecordCategory: Record<string, number>; recordBytesHistogram: Record<string, number>;
}> {
  parse(IdSchema, branch, 'load branch');
  const start = performance.now();
  const fingerprint = new Fingerprint();
  const countsByKind: Record<string, number> = Object.create(null);
  let canonicalBytes = 0;
  const propertyValuesByRecordCategory: Record<string, number> = Object.create(null);
  const recordBytesHistogram: Record<string, number> = Object.create(null);
  let batch: PreparedEntity[] = [];
  let batchBytes = 0;
  await store.client.query(`CREATE TEMP TABLE w5_load_stage(entity_id text PRIMARY KEY,version_id text NOT NULL) ON COMMIT PRESERVE ROWS`);
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await control?.checkpoint();
    await store.stageVersions(batch);
    batch = []; batchBytes = 0;
  };
  try {
    for await (const value of input) {
      const record = PreparedEntity.from(value);
      const bytes = record.canonicalBytes;
      fingerprint.addPrepared(record);
      countsByKind[record.kind] = (countsByKind[record.kind] ?? 0) + 1;
      canonicalBytes += bytes;
      const category = record.entityId.startsWith('entity:') ? 'entities' : record.entityId.startsWith('relationship:') ? 'relationships'
        : record.entityId.startsWith('parameter:') ? 'parameters' : 'unclassified';
      const propertyCount = record.propertyCount;
      propertyValuesByRecordCategory[category] = (propertyValuesByRecordCategory[category] ?? 0) + propertyCount;
      const upperBound = String(2 ** Math.ceil(Math.log2(Math.max(1, bytes))));
      recordBytesHistogram[upperBound] = (recordBytesHistogram[upperBound] ?? 0) + 1;
      batch.push(record); batchBytes += bytes;
      if (batch.length >= 250 || batchBytes >= 4 * 1024 * 1024) await flush();
    }
    await flush();
    await control?.checkpoint();
    if (fingerprint.count === 0) throw new Error('Cannot publish empty imported dataset');
    const ingestDone = performance.now();
    const payload = { operation: 'initial-load', branch, fingerprint: fingerprint.value(), countsByKind };
    const revisionId = hash(payload);
    await store.transaction(async () => {
      await store.client.query(`INSERT INTO qvm_storage.branches VALUES($1,NULL)`, [branch]);
      await store.client.query(`INSERT INTO qvm_storage.revisions(revision_id,parent_id,command_id,payload_hash,payload)
        VALUES($1,NULL,$2,$1,$3::jsonb)`, [revisionId, `load:${revisionId}`, JSON.stringify(payload)]);
      await store.client.query(`INSERT INTO qvm_storage.changes SELECT $1,entity_id,version_id FROM w5_load_stage`, [revisionId]);
      await store.client.query(`INSERT INTO qvm_storage.visibility
        SELECT $1,v.entity_id,v.version_id,v.kind,v.type_id,v.container_id,v.system_id,v.from_id,v.to_id
        FROM w5_load_stage s JOIN qvm_storage.versions v USING(version_id)`, [branch]);
      await store.validateReferences(branch);
      await control?.checkpoint();
      await store.client.query(`UPDATE qvm_storage.branches SET head=$2 WHERE branch=$1`, [branch, revisionId]);
      await store.client.query(`INSERT INTO qvm_storage.receipts VALUES($1,$2,$2)`, [`load:${revisionId}`, revisionId]);
    });
    const published = performance.now();
    await store.client.query('ANALYZE qvm_storage.versions');
    await store.client.query('ANALYZE qvm_storage.visibility');
    await store.client.query('ANALYZE qvm_storage.changes');
    await control?.checkpoint();
    return { revisionId, fingerprint: fingerprint.value(), countsByKind, canonicalBytes, propertyValuesByRecordCategory, recordBytesHistogram,
      phasesMs: { ingest: ingestDone - start, publication: published - ingestDone, analyze: performance.now() - published } };
  } finally { await store.client.query('DROP TABLE w5_load_stage'); }
}

export async function inspectBranch(store: Storage, branch: string): Promise<{
  fingerprint: ReturnType<Fingerprint['value']>; countsByKind: Record<string, number>;
}> {
  const fingerprint = new Fingerprint();
  const countsByKind: Record<string, number> = Object.create(null);
  let after = '';
  while (true) {
    const page = await store.page({ branch, after, limit: 250 });
    if (page.length === 0) break;
    for (const row of page) {
      const prepared = PreparedEntity.from(row.entity);
      fingerprint.addPrepared(prepared);
      countsByKind[row.entity.kind] = (countsByKind[row.entity.kind] ?? 0) + 1;
      if (prepared.versionId !== row.versionId) throw new Error('Stored body/version hash mismatch');
    }
    const last = page.at(-1);
    if (!last) throw new Error('Missing page tail');
    after = last.entity.entityId;
  }
  return { fingerprint: fingerprint.value(), countsByKind };
}

export async function walDifference(store: Storage, before: string): Promise<string> {
  const [row] = await store.rows(Type.Object({ bytes: Type.String() }),
    `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),$1::pg_lsn)::text AS bytes`, [before]);
  if (!row) throw new Error('Missing WAL measurement');
  return row.bytes;
}
