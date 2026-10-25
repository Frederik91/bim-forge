import { Type } from 'typebox';
import { validateSnapshot, diffSnapshots } from '../../src/room-model.ts';
import { canonical, entity, hash, parse, JsonSchema } from './contract.ts';
import type { StoredEntity, Json } from './contract.ts';
import type { Storage } from './store.ts';

export const BASELINE_BYTES = 256 * 1024;
export const BASELINE_ENTITIES = 100;
export const BASELINE_RELATIONSHIPS = 100;

export function nativeEnvelopes(input: unknown): { snapshot: Json; entities: StoredEntity[] } {
  const snapshot = validateSnapshot(input);
  const document = parse(JsonSchema, snapshot, 'native snapshot JSON');
  return { snapshot: document, entities: [
    ...snapshot.entities.map((item) => entity({ entityId: item.id, kind: item.type,
      typeId: null, containerId: 'levelId' in item ? item.levelId : null, systemId: null, fromId: null, toId: null,
      document: parse(Type.Record(Type.String(), JsonSchema), item, 'native entity JSON') })),
    ...snapshot.relationships.map((item) => entity({ entityId: item.id, kind: item.type,
      typeId: null, containerId: null, systemId: null, fromId: item.source, toId: item.target,
      document: parse(Type.Record(Type.String(), JsonSchema), item, 'native relationship JSON') })),
  ] };
}

export async function saveSnapshot(store: Storage, revisionId: string, snapshot: Json): Promise<void> {
  const native = validateSnapshot(snapshot);
  const bytes = Buffer.byteLength(canonical(snapshot));
  if (bytes > BASELINE_BYTES || native.entities.length > BASELINE_ENTITIES || native.relationships.length > BASELINE_RELATIONSHIPS) {
    throw new Error('Baseline exceeds existing product bounds');
  }
  await store.client.query(`INSERT INTO qvm_storage.snapshots VALUES($1,$2::jsonb,$3,$4)`,
    [revisionId, JSON.stringify(snapshot), bytes, hash(snapshot)]);
}

export async function snapshotAt(store: Storage, revisionId: string): Promise<Json> {
  const [row] = await store.rows(Type.Object({ body: JsonSchema }),
    `SELECT body FROM qvm_storage.snapshots WHERE revision_id=$1`, [revisionId]);
  if (!row) throw new Error('No bounded snapshot at this revision');
  return nativeEnvelopes(row.body).snapshot;
}

export function rebuildNative(template: Json, items: StoredEntity[]): Json {
  const snapshot = validateSnapshot(template);
  return nativeEnvelopes({ ...(snapshot.version === 2 ? { version: 2 } : {}), units: snapshot.units,
    entities: items.filter((item) => item.fromId === null).map((item) => item.document),
    relationships: items.filter((item) => item.fromId !== null).map((item) => item.document) }).snapshot;
}

export function nativeDeltaIds(before: unknown, after: unknown): string[] {
  const delta = diffSnapshots(before, after);
  return [...delta.entities.added.map((item) => item.id), ...delta.entities.modified.map((item) => item.after.id),
    ...delta.entities.removed.map((item) => item.id), ...delta.relationships.added.map((item) => item.id),
    ...delta.relationships.modified.map((item) => item.after.id), ...delta.relationships.removed.map((item) => item.id)].sort();
}
