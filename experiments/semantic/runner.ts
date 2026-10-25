import { concurrencyCases } from './concurrency.ts';
import { identityCases } from './identity.ts';
import { candidateCases } from './candidate-cases.ts';
import { parseObservations } from './protocol.ts';
import type { CaseArtifact, Observation } from './protocol.ts';

export async function runSemanticCases(): Promise<{ observations: Observation[]; artifacts: CaseArtifact[] }> {
  const baseline = [...await identityCases(), ...await concurrencyCases()];
  const cases = [...baseline, ...await candidateCases(baseline.map((item) => item.observation))];
  return { observations: parseObservations(cases.map((item) => item.observation)),
    artifacts: cases.map((item) => item.artifact) };
}

export async function runCandidateCases(input: unknown): Promise<{ observations: Observation[]; artifacts: CaseArtifact[] }> {
  const baseline = parseObservations(input);
  if (baseline.some((item) => item.caseId.startsWith('vmc1-'))) throw new Error('Candidate-only mode requires baseline observations.');
  const cases = await candidateCases(baseline);
  return { observations: parseObservations(cases.map((item) => item.observation)), artifacts: cases.map((item) => item.artifact) };
}
