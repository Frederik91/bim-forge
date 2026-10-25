import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { Sha256Schema } from './protocol.ts';

const text = Type.String({ minLength: 1, maxLength: 256 });
const objectOptions = { additionalProperties: false };
export const AuthorityInputSchema = Type.Object({
  proposalId: text, candidateSha256: Sha256Schema, expectedHead: text, actualHead: text,
  requiredDisciplines: Type.Array(text, { minItems: 2, uniqueItems: true }),
  conflicts: Type.Array(Type.Object({ conflictId: text, resolvedByCandidateSha256: Type.Union([Sha256Schema, Type.Null()]) }, objectOptions)),
  actors: Type.Array(Type.Object({ actorId: text, kind: Type.Literal('simulated-test-actor'), disciplines: Type.Array(text, { uniqueItems: true }) }, objectOptions)),
  decisions: Type.Array(Type.Object({ evidenceSha256: Sha256Schema, actorId: text, discipline: text,
    proposalId: text, candidateSha256: Sha256Schema, decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')]),
  }, objectOptions)),
}, objectOptions);
export type AuthorityInput = Static<typeof AuthorityInputSchema>;
export type AuthorityDecision = { kind: 'eligible'; evidence: string[] } | { kind: 'blocked'; reasons: string[] };

export function parseAuthorityInput(input: unknown): AuthorityInput {
  if (!Check(AuthorityInputSchema, input)) throw new Error('Invalid discipline authority test input.');
  if (new Set(input.actors.map((actor) => actor.actorId)).size !== input.actors.length) throw new Error('Duplicate actor identity.');
  return input;
}

// This is a prepublication oracle. Eligibility does not perform or prove atomic acceptance.
export function evaluateAuthority(input: AuthorityInput): AuthorityDecision {
  const reasons: string[] = [];
  if (input.expectedHead !== input.actualHead) reasons.push('The accepted head changed.');
  if (input.conflicts.some((conflict) => conflict.resolvedByCandidateSha256 !== input.candidateSha256)) reasons.push('Semantic conflicts remain unresolved for this candidate.');
  const usedActors = new Set<string>();
  const evidence: string[] = [];
  for (const discipline of input.requiredDisciplines) {
    const matching = input.decisions.filter((decision) => decision.discipline === discipline
      && decision.proposalId === input.proposalId && decision.candidateSha256 === input.candidateSha256);
    const decision = matching[0];
    if (matching.length !== 1 || !decision || decision.decision !== 'approve') {
      reasons.push(`A distinct approval is required for ${discipline}.`);
      continue;
    }
    const actor = input.actors.find((candidate) => candidate.actorId === decision.actorId);
    if (!actor?.disciplines.includes(discipline) || usedActors.has(decision.actorId) || evidence.includes(decision.evidenceSha256)) {
      reasons.push(`Approval authority or distinct evidence is missing for ${discipline}.`);
      continue;
    }
    usedActors.add(decision.actorId);
    evidence.push(decision.evidenceSha256);
  }
  return reasons.length > 0 ? { kind: 'blocked', reasons } : { kind: 'eligible', evidence };
}
