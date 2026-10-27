import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { ModelParameterValueSchema, plainScopeData } from './model-scope-contract.ts';
import type { ModelParameterValue } from './model-scope-contract.ts';

export const MAX_EVIDENCE_ENTRIES = 256;
export const MAX_EVIDENCE_ENTRY_BYTES = 16 * 1024;
export const MAX_EVIDENCE_PROJECT_BYTES = 4 * 1024 * 1024;
export const MAX_EVIDENCE_PINS = 32;
export const MAX_EVIDENCE_PAGE = 20;
const exact = { additionalProperties: false };
const identity = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const entityId = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const readable = Type.String({ minLength: 1, maxLength: 4096, pattern: '\\S' });
const sourceId = Type.String({ pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' });
export const EvidencePinSchema = Type.Object({ entryId: identity, hash }, exact);
export type EvidencePin = Static<typeof EvidencePinSchema>;
export const EvidenceAnchorSchema = Type.Object({ projectId: identity, revisionId: hash, entityId, bodyHash: hash }, exact);
export type EvidenceAnchor = Static<typeof EvidenceAnchorSchema>;
export const EvidencePropertySchema = Type.Object({ definitionId: entityId,
  valueKind: Type.Union([Type.Literal('length'), Type.Literal('angle'), Type.Literal('duration'),
    Type.Literal('number'), Type.Literal('text'), Type.Literal('boolean')]) }, exact);
export type EvidenceProperty = Static<typeof EvidencePropertySchema>;
const citation = Type.Object({ sourceId, sha256: hash, locator: readable }, exact);
const citations = Type.Array(citation, { minItems: 1, maxItems: 4, uniqueItems: true });
const basis = Type.Array(EvidencePinSchema, { maxItems: MAX_EVIDENCE_PINS, uniqueItems: true });
export const EvidenceAssertionSchema = Type.Union([
  Type.Object({ kind: Type.Literal('measured'), value: ModelParameterValueSchema, citations }, exact),
  Type.Object({ kind: Type.Literal('observed'), value: ModelParameterValueSchema, citations }, exact),
  Type.Object({ kind: Type.Literal('documented'), value: ModelParameterValueSchema, citations }, exact),
  Type.Object({ kind: Type.Literal('inferred'), value: ModelParameterValueSchema, rationale: readable,
    basis: Type.Array(EvidencePinSchema, { minItems: 1, maxItems: MAX_EVIDENCE_PINS, uniqueItems: true }) }, exact),
  Type.Object({ kind: Type.Literal('assumed'), value: ModelParameterValueSchema, rationale: readable, basis }, exact),
  Type.Object({ kind: Type.Literal('unknown'), reason: readable }, exact),
  Type.Object({ kind: Type.Literal('resolution'), candidateIds: Type.Array(identity, { minItems: 2, maxItems: MAX_EVIDENCE_PINS, uniqueItems: true }),
    selectedEntryId: identity, rationale: readable }, exact),
]);
export type EvidenceAssertion = Static<typeof EvidenceAssertionSchema>;
export const EvidenceEntrySchema = Type.Object({ id: identity, anchor: EvidenceAnchorSchema, property: EvidencePropertySchema,
  predecessor: Type.Union([EvidencePinSchema, Type.Null()]), assertion: EvidenceAssertionSchema }, exact);
export type EvidenceEntry = Static<typeof EvidenceEntrySchema>;
export const EvidenceSubjectSchema = Type.Object({ anchor: EvidenceAnchorSchema, property: EvidencePropertySchema }, exact);
export type EvidenceSubject = Static<typeof EvidenceSubjectSchema>;
export const EvidenceReadSetSchema = Type.Object({ version: Type.Literal(1), projectId: identity, revisionId: hash,
  pins: basis, subjects: Type.Array(Type.Object({ subject: EvidenceSubjectSchema, signature: hash }, exact),
    { maxItems: MAX_EVIDENCE_PINS, uniqueItems: true }) }, exact);
export type EvidenceReadSet = Static<typeof EvidenceReadSetSchema>;

export function evidenceCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(evidenceCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${evidenceCanonical(entry)}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  throw new Error('Evidence requires finite JSON data.');
}
export function parseEvidenceEntry(input: unknown): EvidenceEntry {
  const value = plainScopeData(input);
  if (!Check(EvidenceEntrySchema, value)) throw new Error('Invalid bounded evidence entry.');
  if (new TextEncoder().encode(evidenceCanonical(value)).byteLength > MAX_EVIDENCE_ENTRY_BYTES) throw new Error('Evidence entry exceeds 16 KiB.');
  if ('value' in value.assertion && value.assertion.value.kind !== value.property.valueKind) throw new Error('Evidence property value kind mismatch.');
  if (value.predecessor?.entryId === value.id) throw new Error('Evidence cannot correct itself.');
  if (value.assertion.kind === 'resolution' && !value.assertion.candidateIds.includes(value.assertion.selectedEntryId)) {
    throw new Error('Resolution must select an original candidate.');
  }
  return value;
}
export function parseEvidencePin(input: unknown): EvidencePin {
  const value = plainScopeData(input);
  if (!Check(EvidencePinSchema, value)) throw new Error('Invalid evidence pin.');
  return value;
}
export function parseEvidenceReadSet(input: unknown): EvidenceReadSet {
  const value = plainScopeData(input);
  if (!Check(EvidenceReadSetSchema, value) || new Set(value.pins.map(pin => pin.entryId)).size !== value.pins.length) {
    throw new Error('Invalid bounded evidence read set.');
  }
  if (new Set(value.subjects.map(item => evidenceCanonical(item.subject))).size !== value.subjects.length) throw new Error('Duplicate evidence subject.');
  return value;
}
/** Compare compatible engineering values in metres/seconds, retaining original units in claims. */
export function normalizedEvidenceValue(value: ModelParameterValue): ModelParameterValue {
  switch (value.kind) {
    case 'length': return { kind: 'length', value: value.unit === 'mm' ? value.value / 1000 : value.value, unit: 'm' };
    case 'duration': return { kind: 'duration', value: value.value * (value.unit === 'h' ? 3600 : value.unit === 'min' ? 60 : 1), unit: 's' };
    case 'angle': case 'number': case 'text': case 'boolean': return value;
    default: { const exhaustive: never = value; return exhaustive; }
  }
}
export function evidenceDependencies(entry: EvidenceEntry): EvidencePin[] {
  return [...(entry.predecessor ? [entry.predecessor] : []),
    ...('basis' in entry.assertion ? entry.assertion.basis : [])];
}
