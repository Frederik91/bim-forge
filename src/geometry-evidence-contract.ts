import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { GeometryReceiptSchema, GeometryMeasureRequestSchema, GeometryMeasureResultSchema,
  geometryPlainData, parseGeometryMeasureRequest, parseGeometryReceipts } from './geometry-contract.ts';
import type { ModelSnapshot } from './room-model.ts';

const identity = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
export const GeometryEvidenceSchema = Type.Object({
  version: Type.Literal(1), projectId: identity, requestId: identity, baseRevisionId: hash, proposalSnapshotSha256: hash,
  receipts: Type.Array(GeometryReceiptSchema, { maxItems: 128 }),
  measurements: Type.Array(Type.Object({ request: GeometryMeasureRequestSchema, result: GeometryMeasureResultSchema },
    { additionalProperties: false }), { maxItems: 64 }),
}, { additionalProperties: false });
export type GeometryEvidence = Static<typeof GeometryEvidenceSchema>;
export const MAX_GEOMETRY_EVIDENCE_BYTES = 64 * 1024;

/** Geometry wire digests sort JSON keys lexically; no platform locale or Node-only hashing is involved. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  throw new Error('Geometry evidence requires finite JSON data.');
}

export function parseGeometryEvidence(input: unknown): GeometryEvidence {
  const value = geometryPlainData(input);
  if (!Check(GeometryEvidenceSchema, value)
      || new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_GEOMETRY_EVIDENCE_BYTES) throw new Error('Invalid bounded geometry evidence.');
  parseGeometryReceipts(value.receipts);
  for (const receipt of value.receipts) if (receipt.projectId !== value.projectId) throw new Error('Geometry evidence crosses projects.');
  for (const measurement of value.measurements) {
    parseGeometryMeasureRequest(measurement.request);
    if (!value.receipts.some(receipt => canonical(receipt) === canonical(measurement.result.receipt))) {
      throw new Error('Geometry measurement is not bound to its host observation.');
    }
  }
  return value;
}
export function readGeometryEvidence(value: unknown): GeometryEvidence {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_GEOMETRY_EVIDENCE_BYTES) throw new Error('Invalid stored geometry evidence.');
  return parseGeometryEvidence(JSON.parse(value));
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Browser and server restoration verify the exact proposal and typed request/result digests. */
export async function assertGeometryEvidenceBound(evidence: GeometryEvidence, snapshot: ModelSnapshot): Promise<void> {
  if (await digest(snapshot) !== evidence.proposalSnapshotSha256) throw new Error('Geometry evidence does not match the final authored snapshot.');
  for (const measurement of evidence.measurements) {
    const { receipt, ...outcome } = measurement.result;
    if (await digest({ method: 'measure', input: measurement.request }) !== receipt.operationDigest
        || await digest(outcome) !== receipt.resultDigest) throw new Error('Geometry measurement request or result digest changed.');
  }
}
