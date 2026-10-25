import { concurrencyCases } from './concurrency.ts';
import { identityCases } from './identity.ts';
import { parseObservations } from './protocol.ts';
import type { CaseArtifact, Observation } from './protocol.ts';

export async function runSemanticCases(): Promise<{ observations: Observation[]; artifacts: CaseArtifact[] }> {
  const cases = [...await identityCases(), ...await concurrencyCases()];
  return { observations: parseObservations(cases.map((item) => item.observation)),
    artifacts: cases.map((item) => item.artifact) };
}
