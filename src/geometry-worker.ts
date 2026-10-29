import { parentPort, workerData } from 'node:worker_threads';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { DesignTargetSchema } from './design-target-contract.ts';
import { GeometryRefSchema, parseGeometryReceipts } from './geometry-contract.ts';
import { createGeometryContext, geometryDigest, validateGeometryReceipts } from './geometry-query.ts';
import type { GeometryContextInput } from './geometry-query.ts';
import { parseLinkedPrepared } from './linked-model.ts';
import { validateSnapshot } from './room-model.ts';

const exact = { additionalProperties: false };
const small = Type.String({ minLength: 1, maxLength: 128 });
const bound = Type.Integer({ minimum: 1, maximum: 2000000 });
const contextSchema = Type.Object({ projectId: small,
  native: Type.Object({ snapshot: Type.Unknown(), revisionId: Type.String({ pattern: '^[a-f0-9]{64}$' }), target: DesignTargetSchema,
    readableIds: Type.Optional(Type.Array(small, { maxItems: 100, uniqueItems: true })) }, exact),
  linked: Type.Array(Type.Unknown(), { maxItems: 64 }), unavailableSources: Type.Optional(Type.Array(Type.Object({ id: small, reason: Type.String({ maxLength: 1024 }) }, exact), { maxItems: 64 })),
  limits: Type.Optional(Type.Object({ maxObjects: Type.Optional(bound), maxTriangles: Type.Optional(bound), maxWork: Type.Optional(bound), maxPairs: Type.Optional(bound),
    maxMilliseconds: Type.Optional(bound), maxResponseBytes: Type.Optional(bound), maxReceipts: Type.Optional(bound) }, exact)) }, exact);
const revalidationSchema = Type.Object({ current: contextSchema, candidate: Type.Optional(contextSchema), receipts: Type.Unknown(),
  correspondences: Type.Optional(Type.Array(Type.Object({ historical: GeometryRefSchema, current: GeometryRefSchema }, exact), { maxItems: 4096 })) }, exact);
const dataSchema = Type.Union([Type.Object({ kind: Type.Literal('session'), input: contextSchema }, exact),
  Type.Object({ kind: Type.Literal('revalidate'), input: revalidationSchema }, exact)]);
const callSchema = Type.Object({ id: Type.Integer({ minimum: 1, maximum: 128 }), method: Type.Union([
  Type.Literal('describe'), Type.Literal('query'), Type.Literal('relations'), Type.Literal('measure')]), input: Type.Unknown() }, exact);
function context(value: unknown): GeometryContextInput {
  if (!Check(contextSchema, value)) throw new Error('Invalid geometry worker context envelope.');
  return { projectId: value.projectId, native: { ...value.native, snapshot: validateSnapshot(value.native.snapshot) }, linked: value.linked.map(parseLinkedPrepared),
    ...(value.unavailableSources ? { unavailableSources: value.unavailableSources } : {}), ...(value.limits ? { limits: value.limits } : {}) };
}
const port = parentPort;
if (!port) throw new Error('Geometry worker requires a private worker message port.');
try {
  const data: unknown = workerData;
  if (!Check(dataSchema, data)) throw new Error('Invalid geometry worker startup.');
  if (data.kind === 'revalidate') {
    const current = createGeometryContext(context(data.input.current));
    const candidate = data.input.candidate ? createGeometryContext(context(data.input.candidate)) : undefined;
    const receipts = parseGeometryReceipts(data.input.receipts);
    const verified = new Set((data.input.correspondences ?? []).map(pair => {
      if (pair.historical.kind !== 'ifc' || pair.current.kind !== 'ifc') throw new Error('Only verified IFC source correspondence may cross external revisions.');
      return geometryDigest(pair);
    }));
    port.postMessage(validateGeometryReceipts({ receipts, current, ...(candidate ? { candidate } : {}),
      verifyCorrespondence: (historical, currentRef) => verified.has(geometryDigest({ historical, current: currentRef })) }));
  } else {
    const readModel = createGeometryContext(context(data.input));
    let expectedId = 1;
    port.on('message', (message: unknown) => {
      try {
        if (!Check(callSchema, message) || message.id !== expectedId++) throw new Error('Invalid or replayed geometry worker call.');
        let result;
        switch (message.method) {
          case 'describe': result = readModel.describe(message.input); break;
          case 'query': result = readModel.query(message.input); break;
          case 'relations': result = readModel.relations(message.input); break;
          case 'measure': result = readModel.measure(message.input); break;
          default: { const exhaustive: never = message.method; throw new Error(`Unsupported method: ${exhaustive}`); }
        }
        if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) throw new Error('Geometry worker response exceeds its byte envelope.');
        port.postMessage({ kind: 'result', id: message.id, value: result });
      } catch { port.postMessage({ kind: 'error', id: typeof message === 'object' && message !== null && 'id' in message ? message.id : -1 }); }
    });
    port.postMessage({ kind: 'ready', id: 0 });
  }
} catch { port.postMessage({ kind: 'error', id: 0 }); }
