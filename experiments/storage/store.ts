import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';
import { Type } from 'typebox';
import type { Static, TSchema } from 'typebox';
import { command, entity, hash, parse, EntitySchema, HashSchema, IdSchema, JsonSchema } from './contract.ts';
import type { Command, Json, StoredEntity } from './contract.ts';

const HeadRow = Type.Object({ head: Type.Union([HashSchema, Type.Null()]) });
const BodyRow = Type.Object({ body: EntitySchema, version_id: HashSchema });
const ReceiptRow = Type.Object({ payload_hash: HashSchema, revision_id: HashSchema });
const ChangeRow = Type.Object({ entity_id: IdSchema, version_id: Type.Union([HashSchema, Type.Null()]) });
export type VersionedEntity = { entity: StoredEntity; versionId: string };

const ancestry = `WITH RECURSIVE ancestry AS (
  SELECT revision_id,parent_id,0 AS depth FROM qvm_storage.revisions WHERE revision_id=$1
  UNION ALL SELECT r.revision_id,r.parent_id,a.depth+1
  FROM qvm_storage.revisions r JOIN ancestry a ON r.revision_id=a.parent_id
), resolved AS (
  SELECT DISTINCT ON (c.entity_id) c.entity_id,c.version_id
  FROM ancestry a JOIN qvm_storage.changes c USING(revision_id)
  ORDER BY c.entity_id, a.depth
)`;

export class Storage {
  readonly client: Client;
  constructor(client: Client) { this.client = client; }

  async rows<T extends TSchema>(schema: T, sql: string, values: unknown[] = []): Promise<Static<T>[]> {
    const result = await this.client.query<Record<string, unknown>>(sql, values);
    return result.rows.map((row) => parse(schema, row, 'PostgreSQL row'));
  }

  async assertIsolated(): Promise<void> {
    const [row] = await this.rows(Type.Object({ name: Type.String(), version: Type.String() }),
      `SELECT current_database() AS name,current_setting('server_version_num') AS version`);
    if (!row || !(row.name === 'qvm' || row.name.startsWith('qvm_w5_'))) throw new Error('Refusing non-qualification database');
    if (!row.version.startsWith('15')) throw new Error('This candidate is pinned to PostgreSQL 15');
  }

  async initialize(): Promise<void> {
    await this.assertIsolated();
    const ddl = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    const schemaHash = hash(ddl);
    await this.transaction(async () => {
      await this.client.query(`SELECT pg_advisory_xact_lock(128001)`);
      const [existing] = await this.rows(Type.Object({ name: Type.Union([Type.String(), Type.Null()]) }),
        `SELECT to_regnamespace('qvm_storage')::text AS name`);
      if (existing?.name !== null) {
        const [meta] = await this.rows(Type.Object({ schema_hash: HashSchema }), `SELECT schema_hash FROM qvm_storage.meta`);
        if (meta?.schema_hash !== schemaHash) throw new Error('Existing candidate schema differs; use a fresh isolated database');
        return;
      }
      await this.client.query(ddl);
      await this.client.query(`CREATE TABLE qvm_storage.meta (schema_hash text PRIMARY KEY)`);
      await this.client.query(`INSERT INTO qvm_storage.meta VALUES ($1)`, [schemaHash]);
    });
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    try {
      const result = await work();
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async head(branch: string): Promise<string | null> {
    parse(IdSchema, branch, 'branch');
    const [row] = await this.rows(HeadRow, `SELECT head FROM qvm_storage.branches WHERE branch=$1`, [branch]);
    if (!row) throw new Error(`Unknown branch ${branch}`);
    return row.head;
  }

  async detail(input: { branch: string; entityId: string }): Promise<VersionedEntity | null> {
    parse(IdSchema, input.branch, 'branch'); parse(IdSchema, input.entityId, 'entity id');
    const [row] = await this.rows(BodyRow, `SELECT v.body,v.version_id FROM qvm_storage.visibility c
      JOIN qvm_storage.versions v USING(version_id) WHERE c.branch=$1 AND c.entity_id=$2`, [input.branch, input.entityId]);
    return row ? { entity: entity(row.body), versionId: row.version_id } : null;
  }

  async projectOpen(input: { branch: string; limit: number }) {
    parse(IdSchema, input.branch, 'branch');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error('Open page bound must be 1..1000');
    const nullableHash = Type.Union([HashSchema, Type.Null()]);
    const schema = Type.Object({ head: nullableHash, parent_id: nullableHash,
      command_id: Type.Union([IdSchema, Type.Null()]), created_at: Type.Union([Type.String(), Type.Null()]),
      manifest: JsonSchema, page: Type.Array(Type.Object({ entity: EntitySchema, versionId: HashSchema })) });
    // One SQL statement gives metadata and bounded visible bodies from the same MVCC snapshot.
    const [row] = await this.rows(schema, `SELECT b.head,r.parent_id,r.command_id,r.created_at::text,
      jsonb_build_object('operation',r.payload->'operation','initialFingerprint',r.payload->'fingerprint',
        'initialCountsByKind',r.payload->'countsByKind',
        'putCount',jsonb_array_length(COALESCE(r.payload->'puts','[]'::jsonb)),
        'deleteCount',jsonb_array_length(COALESCE(r.payload->'deletes','[]'::jsonb))) AS manifest,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('entity',p.body,'versionId',p.version_id) ORDER BY p.entity_id)
        FROM (SELECT c.entity_id,v.body,v.version_id FROM qvm_storage.visibility c
          JOIN qvm_storage.versions v USING(version_id) WHERE c.branch=b.branch ORDER BY c.entity_id LIMIT $2) p), '[]'::jsonb) AS page
      FROM qvm_storage.branches b LEFT JOIN qvm_storage.revisions r ON r.revision_id=b.head WHERE b.branch=$1`, [input.branch, input.limit]);
    if (!row) throw new Error('Unknown branch');
    return row;
  }

  async createBranch(input: { branch: string; revisionId: string | null }): Promise<void> {
    parse(IdSchema, input.branch, 'branch');
    if (input.revisionId !== null) parse(HashSchema, input.revisionId, 'revision');
    await this.transaction(async () => {
      await this.client.query(`INSERT INTO qvm_storage.branches VALUES ($1,$2)`, [input.branch, input.revisionId]);
      if (input.revisionId !== null) {
        await this.client.query(`${ancestry}
          INSERT INTO qvm_storage.visibility
          SELECT $2,v.entity_id,v.version_id,v.kind,v.type_id,v.container_id,v.system_id,v.from_id,v.to_id
          FROM resolved r JOIN qvm_storage.versions v USING(version_id)`, [input.revisionId, input.branch]);
      }
    });
  }

  async insertVersions(items: StoredEntity[]): Promise<void> {
    if (items.length === 0) return;
    const records = items.map((item) => ({ versionId: hash(item), ...item }));
    await this.client.query(`INSERT INTO qvm_storage.versions
      SELECT x."versionId",x."entityId",x.kind,x."typeId",x."containerId",x."systemId",x."fromId",x."toId",x.body
      FROM jsonb_to_recordset($1::jsonb) AS x("versionId" text,"entityId" text,kind text,"typeId" text,
        "containerId" text,"systemId" text,"fromId" text,"toId" text,body jsonb)
      ON CONFLICT (version_id) DO NOTHING`, [JSON.stringify(records.map(({ versionId, ...body }) => ({ ...body, body, versionId })))]);
  }

  async validateReferences(branch: string): Promise<void> {
    const [row] = await this.rows(Type.Object({ entity_id: IdSchema, missing: IdSchema }), `
      SELECT v.entity_id,refs.id AS missing FROM qvm_storage.visibility v
      CROSS JOIN LATERAL (VALUES(v.type_id),(v.container_id),(v.system_id),(v.from_id),(v.to_id)) refs(id)
      LEFT JOIN LATERAL (
        SELECT target.entity_id FROM qvm_storage.visibility target
        WHERE target.branch=$1 AND target.entity_id=refs.id LIMIT 1
      ) target ON true
      WHERE v.branch=$1 AND refs.id IS NOT NULL AND target.entity_id IS NULL LIMIT 1`, [branch]);
    if (row) throw new Error(`Dangling reference ${row.entity_id} -> ${row.missing}`);
  }

  async accept(input: unknown): Promise<{ revisionId: string; replayed: boolean }> {
    const proposal: Command = command(input);
    const payloadHash = hash(proposal);
    const revisionId = payloadHash;
    return this.transaction(async () => {
      const [locked] = await this.rows(HeadRow, `SELECT head FROM qvm_storage.branches WHERE branch=$1 FOR UPDATE`, [proposal.branch]);
      if (!locked) throw new Error('Unknown branch');
      const [receipt] = await this.rows(ReceiptRow, `SELECT payload_hash,revision_id FROM qvm_storage.receipts WHERE command_id=$1`, [proposal.commandId]);
      if (receipt) {
        if (receipt.payload_hash !== payloadHash) throw new Error('Command identity reused with different payload');
        return { revisionId: receipt.revision_id, replayed: true };
      }
      if (locked.head !== proposal.expectedHead) throw new Error('Head CAS conflict; prepare and validate again');
      const visible = await this.rows(ChangeRow,
        `SELECT entity_id,version_id FROM qvm_storage.visibility WHERE branch=$1 AND entity_id=ANY($2::text[])`,
        [proposal.branch, proposal.assumptions.map((item) => item.entityId)]);
      const versions = new Map(visible.map((row) => [row.entity_id, row.version_id]));
      for (const assumption of proposal.assumptions) {
        if ((versions.get(assumption.entityId) ?? null) !== assumption.versionId) throw new Error(`Semantic CAS conflict: ${assumption.entityId}`);
      }
      await this.insertVersions(proposal.puts);
      await this.client.query(`INSERT INTO qvm_storage.revisions(revision_id,parent_id,command_id,payload_hash,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [revisionId, locked.head, proposal.commandId, payloadHash, JSON.stringify(proposal)]);
      const changes = [...proposal.puts.map((item) => ({ entityId: item.entityId, versionId: hash(item) })),
        ...proposal.deletes.map((entityId) => ({ entityId, versionId: null }))];
      await this.client.query(`INSERT INTO qvm_storage.changes
        SELECT $1,x."entityId",x."versionId" FROM jsonb_to_recordset($2::jsonb) x("entityId" text,"versionId" text)`,
        [revisionId, JSON.stringify(changes)]);
      await this.client.query(`DELETE FROM qvm_storage.visibility WHERE branch=$1 AND entity_id=ANY($2::text[])`,
        [proposal.branch, changes.map((item) => item.entityId)]);
      await this.client.query(`INSERT INTO qvm_storage.visibility
        SELECT $1,v.entity_id,v.version_id,v.kind,v.type_id,v.container_id,v.system_id,v.from_id,v.to_id
        FROM qvm_storage.changes c JOIN qvm_storage.versions v USING(version_id) WHERE c.revision_id=$2`,
        [proposal.branch, revisionId]);
      await this.validateReferences(proposal.branch);
      await this.client.query(`UPDATE qvm_storage.branches SET head=$2 WHERE branch=$1`, [proposal.branch, revisionId]);
      await this.client.query(`INSERT INTO qvm_storage.receipts VALUES($1,$2,$3)`, [proposal.commandId, payloadHash, revisionId]);
      return { revisionId, replayed: false };
    });
  }

  async page(input: { branch: string; after: string; limit: number; kind?: string }): Promise<VersionedEntity[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10000) throw new Error('Page limit must be 1..10000');
    const rows = await this.rows(BodyRow, `SELECT v.body,v.version_id FROM qvm_storage.visibility c
      JOIN qvm_storage.versions v USING(version_id) WHERE c.branch=$1 AND c.entity_id>$2
      AND ($4::text IS NULL OR c.kind=$4) ORDER BY c.entity_id LIMIT $3`,
      [input.branch, input.after, input.limit, input.kind ?? null]);
    return rows.map((row) => ({ entity: entity(row.body), versionId: row.version_id }));
  }

  async historical(input: { revisionId: string; after: string; limit: number }): Promise<VersionedEntity[]> {
    parse(HashSchema, input.revisionId, 'revision');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10000) throw new Error('Page limit must be 1..10000');
    const rows = await this.rows(BodyRow, `${ancestry} SELECT v.body,v.version_id FROM resolved r
      JOIN qvm_storage.versions v USING(version_id) WHERE r.entity_id>$2 ORDER BY r.entity_id LIMIT $3`,
      [input.revisionId, input.after, input.limit]);
    return rows.map((row) => ({ entity: entity(row.body), versionId: row.version_id }));
  }

  async history(entityId: string): Promise<Json[]> {
    return this.rows(Type.Object({ revision_id: HashSchema, parent_id: Type.Union([HashSchema, Type.Null()]),
      version_id: Type.Union([HashSchema, Type.Null()]), command_id: IdSchema, created_at: Type.String() }),
    `SELECT r.revision_id,r.parent_id,c.version_id,r.command_id,r.created_at::text FROM qvm_storage.changes c
      JOIN qvm_storage.revisions r USING(revision_id) WHERE c.entity_id=$1 ORDER BY r.created_at,r.revision_id`, [entityId]);
  }

  async delta(revisionId: string): Promise<Static<typeof ChangeRow>[]> {
    return this.rows(ChangeRow, `SELECT entity_id,version_id FROM qvm_storage.changes WHERE revision_id=$1 ORDER BY entity_id`, [revisionId]);
  }

  async projection(input: { branch: string; field: 'type_id' | 'container_id' | 'system_id' | 'from_id'; id: string; limit: number }): Promise<VersionedEntity[]> {
    const columns = { type_id: 'type_id', container_id: 'container_id', system_id: 'system_id', from_id: 'from_id' };
    if (input.limit < 1 || input.limit > 10000) throw new Error('Projection bound must be 1..10000');
    const rows = await this.rows(BodyRow, `SELECT v.body,v.version_id FROM qvm_storage.visibility c
      JOIN qvm_storage.versions v USING(version_id) WHERE c.branch=$1 AND c.${columns[input.field]}=$2
      ORDER BY c.entity_id LIMIT $3`, [input.branch, input.id, input.limit]);
    return rows.map((row) => ({ entity: entity(row.body), versionId: row.version_id }));
  }

  async metrics(): Promise<Json> {
    const [row] = await this.rows(Type.Object({ metrics: JsonSchema }), `SELECT jsonb_build_object(
      'version',version(),'settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings
        WHERE name IN ('shared_buffers','work_mem','maintenance_work_mem','max_connections','max_parallel_workers_per_gather',
          'fsync','synchronous_commit','full_page_writes','wal_level','checkpoint_timeout','data_directory','statement_timeout')),
      'collation',(SELECT jsonb_build_object('collate',datcollate,'ctype',datctype) FROM pg_database WHERE datname=current_database()),
      'databaseBytes',pg_database_size(current_database()),'walLsn',pg_current_wal_lsn()::text,
      'retainedWalBytes',CASE WHEN has_function_privilege('pg_ls_waldir()','EXECUTE')
        THEN (SELECT sum(size) FROM pg_ls_waldir()) ELSE NULL END,
      'walStats',(SELECT to_jsonb(w) FROM pg_stat_wal w),
      'databaseStats',(SELECT to_jsonb(d) FROM pg_stat_database d WHERE datname=current_database()),
      'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'heapBytes',pg_relation_size(c.oid),
        'totalBytes',pg_total_relation_size(c.oid),'indexBytes',pg_indexes_size(c.oid),
        'toastBytes',CASE WHEN c.reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END,
        'estimatedRows',c.reltuples)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='qvm_storage' AND c.relkind='r'),
      'counts',jsonb_build_object('versions',(SELECT count(*) FROM qvm_storage.versions),
        'revisions',(SELECT count(*) FROM qvm_storage.revisions),'changes',(SELECT count(*) FROM qvm_storage.changes),
        'visibility',(SELECT count(*) FROM qvm_storage.visibility),'receipts',(SELECT count(*) FROM qvm_storage.receipts)),
      'locks',(SELECT jsonb_agg(to_jsonb(l)) FROM pg_locks l WHERE l.database=(SELECT oid FROM pg_database WHERE datname=current_database())),
      'activity',(SELECT jsonb_agg(jsonb_build_object('state',state,'waitEventType',wait_event_type,'waitEvent',wait_event))
        FROM pg_stat_activity WHERE datname=current_database())
    ) AS metrics`);
    if (!row) throw new Error('Missing metrics');
    return row.metrics;
  }

  async propertyCounts(branch: string): Promise<Record<string, number>> {
    const rows = await this.rows(Type.Object({ category: Type.String(), values: Type.String() }), `
      SELECT CASE WHEN c.entity_id LIKE 'entity:%' THEN 'entities' WHEN c.entity_id LIKE 'relationship:%' THEN 'relationships'
        WHEN c.entity_id LIKE 'parameter:%' THEN 'parameters' ELSE 'unclassified' END AS category,
      sum(CASE jsonb_typeof(v.body->'document'->'properties')
        WHEN 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v.body->'document'->'properties'))
        WHEN 'array' THEN jsonb_array_length(v.body->'document'->'properties') ELSE 0 END)::text AS values
      FROM qvm_storage.visibility c JOIN qvm_storage.versions v USING(version_id) WHERE c.branch=$1 GROUP BY 1`, [branch]);
    return Object.fromEntries(rows.map((row) => {
      const count = Number(row.values);
      if (!Number.isSafeInteger(count)) throw new Error('Property count exceeds safe integer reporting bound');
      return [row.category, count];
    }));
  }
}
