import type { Observation } from './protocol.ts';

export const storageScenarios = [
  { experimentId: 'EX-09', caseId: 'pinned-historical-query',
    expected: 'Query the old accepted revision through its pinned reader before and after schema, dictionary, canonicalization and kernel changes; original model and representation bytes remain unchanged.' },
  { experimentId: 'EX-11', caseId: 'database-stage-crash',
    expected: 'Kill a leased dedicated W5 writer after verified artifact staging and before head publication. A fresh connection sees the old head and no receipt or partial accepted state.' },
  { experimentId: 'EX-11', caseId: 'database-after-commit-retry',
    expected: 'Kill the leased writer after database commit but before acknowledgement. Retry the identical command and payload; SQL reports exactly one revision, head advance and acceptance receipt. Changed payload reuse is rejected.' },
  { experimentId: 'EX-11', caseId: 'independent-database-restore',
    expected: 'Restore metadata into a new dedicated PostgreSQL database and a separate artifact root, then independently query entities, ancestry, branches, reviews and hashes with source access unavailable.' },
  { experimentId: 'EX-11', caseId: 'database-incomplete-artifacts',
    expected: 'A missing and a corrupt required artifact each prevent database publication; a fresh query still opens the last complete accepted revision.' },
  { experimentId: 'EX-12', caseId: 'disconnected-database-branches',
    expected: 'Two independent databases continue from a common ancestor, exchange packages and retain both divergent contributions and evidence. Query retained data without source keys, credentials or artifact access.' },
  { experimentId: 'EX-12', caseId: 'discipline-atomic-acceptance',
    expected: 'Unresolved semantic conflicts, host-only authority, one discipline, stale approvals and a racing head each block acceptance. A resolved candidate with two distinct simulated authorized discipline decisions commits its delta, evidence, receipt and head atomically.' },
] satisfies Pick<Observation, 'experimentId' | 'caseId' | 'expected'>[];

export function pendingStorageObservations(): Observation[] {
  return storageScenarios.map((scenario) => ({ ...scenario, passed: false,
    observed: 'Not executed: awaiting coordinator-supplied W5 PostgreSQL schema/CLI implementation contract and a server execution lease. W0 contract v1 is available.',
    limitations: ['This is an uncovered case, not an observed candidate failure.', 'Portable package checks do not qualify database recovery, model interpretation or atomic acceptance.'],
  }));
}
