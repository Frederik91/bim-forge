import type { Client } from 'pg';
import { Type } from 'typebox';
import { IdSchema, parse } from './contract.ts';

const MissingReference = Type.Object({ entity_id: IdSchema, missing: IdSchema });

export const changedReferencesSql = `
  SELECT v.entity_id,refs.id AS missing
  FROM unnest($2::text[]) changed(id)
  JOIN qvm_storage.visibility v ON v.branch=$1 AND v.entity_id=changed.id
  CROSS JOIN LATERAL (VALUES(v.type_id),(v.container_id),(v.system_id),(v.from_id),(v.to_id)) refs(id)
  WHERE refs.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM qvm_storage.visibility target WHERE target.branch=$1 AND target.entity_id=refs.id
  ) LIMIT 1`;

export const deletedReferencesSql = `
  WITH missing AS MATERIALIZED (
    SELECT removed.id FROM unnest($2::text[]) removed(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM qvm_storage.visibility target WHERE target.branch=$1 AND target.entity_id=removed.id
    )
  )
  SELECT refs.entity_id,missing.id AS missing FROM missing
  CROSS JOIN LATERAL (
    SELECT entity_id FROM qvm_storage.visibility WHERE branch=$1 AND type_id=missing.id
    UNION ALL SELECT entity_id FROM qvm_storage.visibility WHERE branch=$1 AND container_id=missing.id
    UNION ALL SELECT entity_id FROM qvm_storage.visibility WHERE branch=$1 AND system_id=missing.id
    UNION ALL SELECT entity_id FROM qvm_storage.visibility WHERE branch=$1 AND from_id=missing.id
    UNION ALL SELECT entity_id FROM qvm_storage.visibility WHERE branch=$1 AND to_id=missing.id
    LIMIT 1
  ) refs LIMIT 1`;

/** Validate final visibility inside the caller's locked acceptance transaction.
 * Requires a previously valid branch and complete changed/deleted identity sets.
 */
export async function validateChangedReferences(
  client: Client, branch: string, changedIds: readonly string[], deletedIds: readonly string[],
): Promise<void> {
  for (const [sql, ids] of [[changedReferencesSql, changedIds], [deletedReferencesSql, deletedIds]] satisfies readonly (readonly [string, readonly string[]])[]) {
    if (ids.length === 0) continue;
    const result = await client.query<Record<string, unknown>>(sql, [branch, ids]);
    const first = result.rows[0];
    if (first !== undefined) {
      const row = parse(MissingReference, first, 'PostgreSQL missing reference');
      throw new Error(`Dangling reference ${row.entity_id} -> ${row.missing}`);
    }
  }
}
