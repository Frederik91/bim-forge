import { parseObservations as parseContractObservations } from '../contracts/schema.ts';
import type { Observation } from '../contracts/schema.ts';
export { ObservationSchema } from '../contracts/schema.ts';
export type { Observation } from '../contracts/schema.ts';

export const W0_CONTRACT_COMMIT = '29583f735c1803872ace3fa663dcf6d7a145434a';
export type ExperimentId = 'EX-01' | 'EX-03' | 'EX-04' | 'EX-05' | 'EX-06';
export const EXPERIMENT_IDS: ExperimentId[] = ['EX-01', 'EX-03', 'EX-04', 'EX-05', 'EX-06'];

export function parseObservations(input: unknown): Observation[] {
  const observations = parseContractObservations(input);
  if (observations.some((item) => !EXPERIMENT_IDS.some((id) => id === item.experimentId))) {
    throw new Error('Invalid W1 experiment identity.');
  }
  if (new Set(observations.map((item) => item.caseId)).size !== observations.length) {
    throw new Error('Case identities must be unique within a W1 run.');
  }
  return observations;
}

export interface CaseArtifact {
  caseId: string;
  variant: 'baseline-room-model' | 'VM-C1-semantic-prototype';
  operations: string[];
  raw: unknown;
}
export interface CaseResult { observation: Observation; artifact: CaseArtifact }

export function result(input: Observation & { operations: string[]; raw: unknown }): CaseResult {
  const { operations, raw, ...observation } = input;
  return { observation, artifact: { caseId: observation.caseId, variant: 'baseline-room-model', operations, raw } };
}

export const BASELINE_LIMITATIONS = [
  'Disposable native baseline only; no external engine, IFC exchange, persistent store, or production adoption is qualified.',
  'Operation fixtures are the existing native single-room and asset fixtures; the W0 multilevel fixture is bound as a reference, not executed through a native adapter.',
  'Fixture acceptance actors and worker labels exercise API bookkeeping; they are not human approvals or AI execution evidence.',
];
