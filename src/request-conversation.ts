import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { plainScopeData } from './model-scope-contract.ts';
import { parseRequestSources } from './request-sources.ts';
import { EvidencePinSchema, MAX_EVIDENCE_PINS, parseEvidencePin } from './model-evidence.ts';
import { SpatialMarkupSchema, parseSpatialMarkup } from './spatial-markup.ts';

export const CONVERSATION_LIMITS = Object.freeze({ messages: 48, userTurns: 20, textCharacters: 1000, sourceFiles: 4, sourceBytes: 12 * 1024 * 1024 });
const exact = { additionalProperties: false };
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const revision = Type.String({ pattern: '^[a-f0-9]{64}$' });
const text = Type.String({ minLength: 1, maxLength: 1000, pattern: '^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]+$' });
const point = Type.Tuple([Type.Number({ minimum: -1000000, maximum: 1000000 }), Type.Number({ minimum: -1000000, maximum: 1000000 }), Type.Number({ minimum: -1000000, maximum: 1000000 })]);
const source = Type.Object({ id: Type.String(), name: Type.String(), mediaType: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg'), Type.Literal('image/webp'), Type.Literal('application/pdf'), Type.Literal('text/plain'), Type.Literal('text/markdown')]), byteLength: Type.Integer(), sha256: Type.String() }, exact);
export const ConversationVisualSchema = Type.Object({
  snapshot: Type.Union([Type.Object({ kind: Type.Literal('accepted'), revisionId: revision }, exact), Type.Object({ kind: Type.Literal('proposal'), revisionId: revision, proposalName: id }, exact)]),
  view: Type.Union([Type.Literal('2d'), Type.Literal('3d')]), levelId: Type.Union([id, Type.Null()]),
  selectedObjectIds: Type.Array(id, { maxItems: 100, uniqueItems: true }),
  annotations: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal('pin'), position: point, label: Type.String({ maxLength: 120 }) }, exact),
    Type.Object({ kind: Type.Literal('arrow'), from: point, to: point, label: Type.String({ maxLength: 120 }) }, exact),
    SpatialMarkupSchema,
  ]), { maxItems: 16 }),
}, exact);
export type ConversationVisual = Static<typeof ConversationVisualSchema>;
function validateAnnotations(visual: ConversationVisual): void {
  for (const annotation of visual.annotations) if (annotation.kind !== 'pin' && annotation.kind !== 'arrow') parseSpatialMarkup(annotation);
}
export const ConversationReplySchema = Type.Object({ messageId: id, expectedSequence: Type.Integer({ minimum: 0 }), baseRevisionId: revision,
  text, sources: Type.Array(source, { maxItems: 4 }), visual: Type.Union([ConversationVisualSchema, Type.Null()]),
  evidencePins: Type.Optional(Type.Array(EvidencePinSchema, { maxItems: MAX_EVIDENCE_PINS })) }, exact);
export type ConversationReply = Static<typeof ConversationReplySchema>;
export const ClarificationSchema = Type.Object({ question: text, options: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 6, uniqueItems: true }) }, exact);
export type Clarification = Static<typeof ClarificationSchema>;
const common = { id, sequence: Type.Integer({ minimum: 1 }), at: Type.Integer({ minimum: 0 }), requestId: id, baseRevisionId: revision };
export const ConversationMessageSchema = Type.Union([
  Type.Object({ ...common, kind: Type.Literal('user'), text, sources: Type.Array(source, { maxItems: 4 }), visual: Type.Union([ConversationVisualSchema, Type.Null()]),
    evidencePins: Type.Optional(Type.Array(EvidencePinSchema, { maxItems: MAX_EVIDENCE_PINS })) }, exact),
  Type.Object({ ...common, kind: Type.Literal('assistant'), replyTo: id, content: Type.Union([
    Type.Object({ kind: Type.Literal('clarification'), ...ClarificationSchema.properties }, exact),
    Type.Object({ kind: Type.Literal('proposal'), text, proposalName: id, proposalRevisionId: revision }, exact),
    Type.Object({ kind: Type.Literal('explanation'), text }, exact),
  ]) }, exact),
  Type.Object({ ...common, kind: Type.Literal('decision'), action: Type.Union([Type.Literal('accept'), Type.Literal('reject'), Type.Literal('cancel'), Type.Literal('retry')]), decisionId: id }, exact),
]);
export type ConversationMessage = Static<typeof ConversationMessageSchema>;
export const RequestConversationSchema = Type.Object({ version: Type.Literal(1), ticketId: id, sequence: Type.Integer({ minimum: 0 }),
  messages: Type.Array(ConversationMessageSchema, { maxItems: 48 }) }, exact);
export type RequestConversation = Static<typeof RequestConversationSchema>;
function evidencePins(input: readonly Static<typeof EvidencePinSchema>[] | undefined): void {
  if (!input) return;
  input.forEach(parseEvidencePin);
  if (new Set(input.map(pin => pin.entryId)).size !== input.length) throw new Error('Choose each evidence entry only once.');
}
export function parseConversationReply(input: unknown): ConversationReply {
  const value = plainScopeData(input);
  if (!Check(ConversationReplySchema, value)) throw new Error('Invalid conversation reply. Send text, immutable source references and snapshot-bound visual evidence.');
  if (value.sources.length) parseRequestSources(value.sources);
  evidencePins(value.evidencePins);
  if (value.visual) validateAnnotations(value.visual);
  return value;
}
export function parseConversationMessage(input: unknown): ConversationMessage {
  const value = plainScopeData(input);
  if (!Check(ConversationMessageSchema, value)) throw new Error('Invalid stored conversation message.');
  if (value.kind === 'user' && value.sources.length) parseRequestSources(value.sources);
  if (value.kind === 'user') evidencePins(value.evidencePins);
  if (value.kind === 'user' && value.visual) validateAnnotations(value.visual);
  return value;
}
export function parseRequestConversation(input: unknown): RequestConversation {
  const value = plainScopeData(input);
  if (!Check(RequestConversationSchema, value)) throw new Error('Invalid request conversation.');
  value.messages.forEach(parseConversationMessage);
  if (value.sequence !== value.messages.length || value.messages.some((message, index) => message.sequence !== index + 1)) throw new Error('Invalid conversation sequence.');
  return value;
}
export function parseClarification(input: unknown): Clarification {
  const value = plainScopeData(input);
  if (!Check(ClarificationSchema, value)) throw new Error('A clarification requires a question and up to six answer options.');
  return value;
}

export function parseConversationVisual(input: unknown): ConversationVisual {
  const value = plainScopeData(input);
  if (!Check(ConversationVisualSchema, value)) throw new Error('Invalid snapshot-bound visual evidence.');
  validateAnnotations(value);
  return value;
}
