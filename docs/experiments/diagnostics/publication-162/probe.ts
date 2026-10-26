import { appendFileSync, writeFileSync } from 'node:fs';
import { Type } from 'typebox';
import type { Client } from 'pg';
import { parse, JsonObjectSchema, JsonSchema } from '../../../../experiments/storage/contract.ts';
import type { Json } from '../../../../experiments/storage/contract.ts';
import type { Storage } from '../../../../experiments/storage/store.ts';
import { fullReferencesSql } from '../../../../experiments/storage/reference-validation.ts';

const root = '/e';
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
const expected = new Map([
  ['changes', 'INSERT INTO qvm_storage.changes SELECT $1,entity_id,version_id FROM w5_load_stage'],
  ['visibility', 'INSERT INTO qvm_storage.visibility SELECT $1,v.entity_id,v.version_id,v.kind,v.type_id,v.container_id,v.system_id,v.from_id,v.to_id FROM w5_load_stage s JOIN qvm_storage.versions v USING(version_id)'],
  ['references', normalize(fullReferencesSql)],
]);
const captured = new Map<string, Json>();
let noticeFailure: string | null = null;

export async function initializeProbe(client: Client): Promise<void> {
  client.on('notice', (raw: unknown) => {
    try {
      const notice = parse(Type.Object({ message: Type.String() }, { additionalProperties: true }), raw, 'PG notice');
      const marker = 'plan:\n';
      const offset = notice.message.indexOf(marker);
      if (offset < 0) return;
      const decoded: unknown = JSON.parse(notice.message.slice(offset + marker.length));
      const plan = parse(JsonObjectSchema, decoded, 'auto_explain JSON');
      const header = parse(Type.Object({ 'Query Text': Type.String() }, { additionalProperties: true }), decoded, 'plan query');
      const match = [...expected].find(([, sql]) => sql === normalize(header['Query Text']));
      if (!match || captured.has(match[0])) throw new Error('Unexpected or repeated instrumented statement');
      captured.set(match[0], plan);
      writeFileSync(`${root}/plan-${match[0]}.json`, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      noticeFailure = error instanceof Error ? error.message : String(error);
    }
  });
  await client.query(`LOAD 'auto_explain'`);
  await client.query(`SET auto_explain.log_min_duration=-1; SET auto_explain.log_analyze=off;
    SET auto_explain.log_buffers=on; SET auto_explain.log_wal=on; SET auto_explain.log_triggers=on;
    SET auto_explain.log_timing=on; SET auto_explain.log_verbose=on; SET auto_explain.log_format=json;
    SET auto_explain.log_level=notice; SET auto_explain.log_nested_statements=off;
    SET auto_explain.sample_rate=1; SET client_min_messages=notice`);
}

export async function phase(store: Storage, name: string): Promise<void> {
  await store.client.query('SET auto_explain.log_min_duration=-1; SET auto_explain.log_analyze=off');
  if (noticeFailure !== null) throw new Error(noticeFailure);
  await store.client.query('SELECT pg_stat_clear_snapshot()');
  const [row] = await store.rows(Type.Object({ snapshot: JsonSchema }), `SELECT jsonb_build_object(
    'at',clock_timestamp(),'database',(SELECT to_jsonb(d) FROM pg_stat_database d WHERE datname=current_database()),
    'wal',(SELECT to_jsonb(w) FROM pg_stat_wal w),'bgwriter',(SELECT to_jsonb(b) FROM pg_stat_bgwriter b),
    'lsn',pg_current_wal_lsn()::text,
    'relations',(SELECT jsonb_agg(to_jsonb(t)) FROM pg_statio_user_tables t WHERE schemaname='qvm_storage'),
    'indexes',(SELECT jsonb_agg(to_jsonb(i)) FROM pg_statio_user_indexes i WHERE schemaname='qvm_storage'),
    'transactionCounters',(SELECT jsonb_agg(to_jsonb(x)) FROM pg_stat_xact_user_tables x WHERE schemaname='qvm_storage')
  ) AS snapshot`);
  if (!row) throw new Error('Missing phase snapshot');
  appendFileSync(`${root}/phases.ndjson`, `${JSON.stringify({ phase: name, at: new Date().toISOString(), snapshot: row.snapshot })}\n`);
  if (['changes-before', 'visibility-before', 'references-before'].includes(name)) {
    await store.client.query('SET auto_explain.log_analyze=on; SET auto_explain.log_min_duration=0');
  }
}

export function assertPlans(): void {
  if (noticeFailure !== null) throw new Error(noticeFailure);
  if (captured.size !== 3) throw new Error('Missing one of three required plans');
  const triggerPlan = Type.Object({ Triggers: Type.Array(Type.Object({
    Calls: Type.Number(), Time: Type.Number(), 'Constraint Name': Type.String(),
  }, { additionalProperties: true })) }, { additionalProperties: true });
  for (const name of ['changes', 'visibility']) {
    const plan = parse(triggerPlan, captured.get(name), `${name} trigger plan`);
    if (plan.Triggers.length !== 2 || plan.Triggers.some((trigger) => trigger.Calls !== 270205)) {
      throw new Error(`${name} did not execute both FK triggers for every source row`);
    }
  }
  const reference = parse(Type.Object({ Plan: Type.Object({ 'Actual Rows': Type.Number() }, { additionalProperties: true }) },
    { additionalProperties: true }), captured.get('references'), 'reference plan');
  if (reference.Plan['Actual Rows'] !== 0) throw new Error('Reference validator returned a witness');
}
