import { createHash } from 'node:crypto';
import { canonical, entity } from './contract.ts';
import type { StoredEntity } from './contract.ts';

// Own an immutable byte snapshot before a producer can reuse or mutate its object.
export class PreparedEntity {
  readonly entityId: string;
  readonly kind: string;
  readonly versionId: string;
  readonly canonicalBytes: number;
  readonly propertyCount: number;
  readonly #wire: string;

  private constructor(record: StoredEntity) {
    const body = canonical(record);
    this.entityId = record.entityId;
    this.kind = record.kind;
    this.versionId = createHash('sha256').update(body).digest('hex');
    this.canonicalBytes = Buffer.byteLength(body);
    const properties = record.document.properties;
    this.propertyCount = properties !== null && typeof properties === 'object' ? Object.keys(properties).length : 0;
    const columns = JSON.stringify({ versionId: this.versionId, entityId: record.entityId, kind: record.kind,
      typeId: record.typeId, containerId: record.containerId, systemId: record.systemId,
      fromId: record.fromId, toId: record.toId });
    this.#wire = `${columns.slice(0, -1)},"body":${body}}`;
    Object.freeze(this);
  }

  static from(input: unknown): PreparedEntity { return new PreparedEntity(entity(input)); }
  get wire(): string { return this.#wire; }
}

export function versionBatch(items: readonly PreparedEntity[]): string {
  return `[${items.map((item) => item.wire).join(',')}]`;
}

export const versionInputSql = `SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
  "versionId" text,"entityId" text,kind text,"typeId" text,"containerId" text,
  "systemId" text,"fromId" text,"toId" text,body jsonb)`;
export const versionColumnsSql = `"versionId","entityId",kind,"typeId","containerId","systemId","fromId","toId",body`;
