import { Type } from 'typebox';
import type { Static } from 'typebox';
import { command, entity, errorMessage, hash, parse, EntitySchema, HashSchema, IdSchema, JsonSchema } from '../../../experiments/storage/contract.ts';
import type { Json } from '../../../experiments/storage/contract.ts';
import type { Storage } from '../../../experiments/storage/store.ts';

const InputSchema = Type.Object({ branch: IdSchema, runId: IdSchema, initialRevisionId: HashSchema }, { additionalProperties: false });
type Input = Static<typeof InputSchema>;
const nullableHash = Type.Union([HashSchema, Type.Null()]);
const RevisionSchema = Type.Object({ revision_id: HashSchema, parent_id: nullableHash,
  command_id: IdSchema, payload_hash: HashSchema, payload: JsonSchema });
type Revision = Static<typeof RevisionSchema>;
const ReceiptSchema = Type.Object({ command_id: IdSchema, payload_hash: HashSchema, revision_id: HashSchema });
type Receipt = Static<typeof ReceiptSchema>;
const ChangeSchema = Type.Object({ entity_id: IdSchema, version_id: nullableHash });
type Change = Static<typeof ChangeSchema>;
const BodySchema = Type.Object({ version_id: HashSchema, body: EntitySchema });
type Body = Static<typeof BodySchema>;
const InitialPayloadSchema = Type.Object({ operation: Type.Literal('initial-load'), branch: IdSchema,
  fingerprint: Type.Object({ count: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), sum: HashSchema, xor: HashSchema }),
  countsByKind: Type.Record(Type.String(), Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) });

/** Pure validation of retained revision metadata; no qualification verdict. */
export function qualificationRevisionFacts(revision: Revision | null, expected: {
  branch: string; commandId: string; kind: 'initial' | 'accepted';
}) {
  if (revision === null) return null;
  const computedPayloadHash = hash(revision.payload);
  const identityMatches = revision.command_id === expected.commandId
    && revision.payload_hash === computedPayloadHash && revision.revision_id === computedPayloadHash;
  try {
    if (expected.kind === 'initial') {
      const payload = parse(InitialPayloadSchema, revision.payload, 'initial-load payload');
      return { computedPayloadHash, identityMatches, payloadMatches: payload.branch === expected.branch && revision.parent_id === null,
        putEntityId: null, putVersionId: null, validationError: null };
    }
    const payload = command(revision.payload);
    const put = payload.puts[0];
    return { computedPayloadHash, identityMatches,
      payloadMatches: payload.branch === expected.branch && payload.commandId === expected.commandId
        && payload.expectedHead === revision.parent_id && payload.puts.length === 1 && payload.deletes.length === 0
        && payload.assumptions.length === 1 && payload.assumptions[0]?.entityId === put?.entityId,
      putEntityId: put?.entityId ?? null, putVersionId: put ? hash(put) : null, validationError: null };
  } catch (error) {
    // Only pure payload validation is caught. SQL failures propagate from the reader.
    return { computedPayloadHash, identityMatches, payloadMatches: false, putEntityId: null, putVersionId: null,
      validationError: errorMessage(error) };
  }
}

type Step = { commandId: string; receipt: Receipt | null; revision: Revision | null; selectedDelta: Change | null;
  revisionFacts: ReturnType<typeof qualificationRevisionFacts>; receiptMatchesRevision: boolean | null;
  expectedParent: string | null; parentMatches: boolean | null; deltaMatchesPut: boolean | null };

/** Requires an idle, exclusively owned connected client; never initializes the schema. */
export async function inspectQualification(store: Storage, rawInput: Input) {
  const input = parse(InputSchema, structuredClone(rawInput), 'qualification inspection input');
  await store.client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    // Prevent a nested caller transaction from silently weakening the promised read mode.
    const [mode] = await store.rows(Type.Object({ isolation: Type.String(), read_only: Type.String() }),
      `SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only`);
    if (mode?.isolation !== 'repeatable read' || mode.read_only !== 'on') throw new Error('Inspection requires a read-only repeatable-read transaction');
    const [branch] = await store.rows(Type.Object({ head: nullableHash }),
      'SELECT head FROM qvm_storage.branches WHERE branch=$1', [input.branch]);
    const readRevision = async (id: string): Promise<Revision | null> => {
      const [row] = await store.rows(RevisionSchema, `SELECT revision_id,parent_id,command_id,payload_hash,payload
        FROM qvm_storage.revisions WHERE revision_id=$1 AND payload->>'branch'=$2`, [id, input.branch]);
      return row ?? null;
    };
    const initialRevision = await readRevision(input.initialRevisionId);
    const initialFacts = qualificationRevisionFacts(initialRevision,
      { branch: input.branch, commandId: `load:${input.initialRevisionId}`, kind: 'initial' });
    // Only a correctly linked initial-load revision can select this branch's source identity.
    const initialLinkValid = initialFacts?.identityMatches === true && initialFacts.payloadMatches;
    const initialRows = initialLinkValid ? await store.rows(ChangeSchema,
      `SELECT entity_id,version_id FROM qvm_storage.changes WHERE revision_id=$1 ORDER BY entity_id LIMIT 1`,
      [input.initialRevisionId]) : [];
    const first = initialRows[0] ?? null;
    const steps: Step[] = [];
    for (const index of [0, 1]) {
      const commandId = `${input.runId}:accepted:${index}`;
      const [receipt] = await store.rows(ReceiptSchema,
        'SELECT command_id,payload_hash,revision_id FROM qvm_storage.receipts WHERE command_id=$1', [commandId]);
      const revision = receipt ? await readRevision(receipt.revision_id) : null;
      const revisionFacts = qualificationRevisionFacts(revision, { branch: input.branch, commandId, kind: 'accepted' });
      const deltas = revision && first ? await store.rows(ChangeSchema,
        'SELECT entity_id,version_id FROM qvm_storage.changes WHERE revision_id=$1 AND entity_id=$2',
        [revision.revision_id, first.entity_id]) : [];
      const selectedDelta = deltas[0] ?? null;
      const expectedParent = index === 0 ? input.initialRevisionId : steps[0]?.receipt?.revision_id ?? null;
      steps.push({ commandId, receipt: receipt ?? null, revision, selectedDelta, revisionFacts, expectedParent,
        receiptMatchesRevision: receipt ? revision !== null && receipt.payload_hash === revision.payload_hash
          && receipt.command_id === revision.command_id && receipt.revision_id === revision.revision_id : null,
        parentMatches: revision ? expectedParent !== null && revision.parent_id === expectedParent : null,
        deltaMatchesPut: revision && first ? selectedDelta !== null && revisionFacts?.payloadMatches === true
          && revisionFacts.putEntityId === first.entity_id && selectedDelta.version_id === revisionFacts.putVersionId : null });
    }
    const states: { state: 'initial' | 'changed' | 'restored'; versionId: string | null }[] = [
      { state: 'initial', versionId: first?.version_id ?? null },
      { state: 'changed', versionId: steps[0]?.selectedDelta?.version_id ?? null },
      { state: 'restored', versionId: steps[1]?.selectedDelta?.version_id ?? null },
    ];
    const bodies: Body[] = [];
    const readIds = new Set<string>();
    for (const state of states) {
      if (state.versionId === null || readIds.has(state.versionId) || readIds.size >= 2) continue;
      readIds.add(state.versionId);
      const [row] = await store.rows(BodySchema,
        'SELECT version_id,body FROM qvm_storage.versions WHERE version_id=$1', [state.versionId]);
      if (row) bodies.push({ version_id: row.version_id, body: entity(row.body) });
    }
    const entityStates = states.map((state) => {
      const body = bodies.find((row) => row.version_id === state.versionId);
      return { ...state, body: body?.body ?? null,
        bodyRead: state.versionId === null ? 'no-version' : !readIds.has(state.versionId) ? 'two-body-limit'
          : body ? 'found' : 'missing',
        bodyHashMatches: body ? hash(body.body) === body.version_id : null,
        entityMatches: body && first ? body.body.entityId === first.entity_id : null };
    });
    const result = { ...input, scope: 'bounded-metadata-facts-only',
      branch: { name: input.branch, exists: branch !== undefined, head: branch?.head ?? null },
      initial: { revision: initialRevision, facts: initialFacts, loadLinkValid: initialLinkValid, sourceFirstEntity: first },
      commands: steps, entityStates,
      restoredVersionMatchesInitial: first?.version_id && steps[1]?.selectedDelta?.version_id
        ? first.version_id === steps[1].selectedDelta.version_id : null,
      bounds: { revisions: 3, receipts: 2, selectedChanges: 3, bodyLookups: 2 },
    } satisfies Json;
    await store.client.query('COMMIT');
    return result;
  } catch (error) {
    try { await store.client.query('ROLLBACK'); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Inspection failed and rollback also failed'); }
    throw error;
  }
}

export type QualificationInspection = Awaited<ReturnType<typeof inspectQualification>>;
