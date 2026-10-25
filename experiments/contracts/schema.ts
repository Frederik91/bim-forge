import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

const text = Type.String({ minLength: 1 });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const commit = Type.String({ pattern: '^[a-f0-9]{40}$' });
const experimentId = Type.String({ pattern: '^EX-(0[1-9]|1[0-3])$' });
const strings = Type.Array(text);
export const ObservationSchema = Type.Object({
  experimentId, caseId: text, expected: text, observed: text, passed: Type.Boolean(), limitations: strings,
}, { additionalProperties: false });
export type Observation = Static<typeof ObservationSchema>;

const artifact = Type.Object({ path: text, sha256: hash, bytes: Type.Integer({ minimum: 0 }), mediaType: text }, { additionalProperties: false });
const binding = Type.Object({ commit, path: text, sha256: hash }, { additionalProperties: false });
const environment = Type.Object({
  host: text, software: Type.Record(text, text), imageDigests: Type.Array(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), { minItems: 1 }),
  cpuLimit: Type.Number({ exclusiveMinimum: 0 }), memoryLimitBytes: Type.Integer({ minimum: 1 }),
  diskBudgetBytes: Type.Integer({ minimum: 1 }), storage: text, cacheProcedure: text, measurementSlot: text,
}, { additionalProperties: false });
export const CoverageSchema = Type.Object({
  assertion: text, caseIds: strings, coverage: Type.Union([Type.Literal('covered'), Type.Literal('partial'), Type.Literal('not-covered')]),
}, { additionalProperties: false });
export type Coverage = Static<typeof CoverageSchema>;
const runFields = {
  schemaVersion: Type.Literal(1), recordKind: Type.Literal('run'), experimentId, runId: Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$' }),
  startedAt: text, finishedAt: text, hypothesis: text, variant: text,
  design: Type.Object({ candidateId: text, ...binding.properties }, { additionalProperties: false }),
  definition: binding, implementation: Type.Object({ sourceCommit: commit, runnerCommit: commit, validators: strings }, { additionalProperties: false }),
  dataset: Type.Object({ name: text, seed: text, manifestSha256: hash }, { additionalProperties: false }),
  environment, commands: Type.Array(text, { minItems: 1 }), observations: Type.Array(ObservationSchema), coverage: Type.Array(CoverageSchema),
  evidence: Type.Array(artifact, { minItems: 1 }), errors: strings, limitations: strings, decisionImplications: strings,
};
export const RunSchema = Type.Union([
  Type.Object({ ...runFields, executionStatus: Type.Literal('completed'), conclusion: Type.Union([Type.Literal('passed'), Type.Literal('failed'), Type.Literal('inconclusive')]) }, { additionalProperties: false }),
  Type.Object({ ...runFields, executionStatus: Type.Union([Type.Literal('failed'), Type.Literal('cancelled'), Type.Literal('timed-out'), Type.Literal('resource-limit')]), conclusion: Type.Union([Type.Literal('failed'), Type.Literal('inconclusive')]) }, { additionalProperties: false }),
]);
export type Run = Static<typeof RunSchema>;

export function parseObservations(input: unknown): Observation[] {
  if (!Check(Type.Array(ObservationSchema), input)) throw new Error('Invalid case observations.');
  return input;
}

export function parseRun(input: unknown): Run {
  if (!Check(RunSchema, input)) throw new Error('A terminal run requires exact typed fields, bindings and evidence; templates are not runs.');
  if (!Number.isFinite(Date.parse(input.startedAt)) || !Number.isFinite(Date.parse(input.finishedAt))
      || Date.parse(input.finishedAt) < Date.parse(input.startedAt)) throw new Error('Invalid run time interval.');
  const caseIds = new Set(input.observations.map(item => item.caseId));
  if (caseIds.size !== input.observations.length) throw new Error('Duplicate case identity.');
  for (const item of input.observations) if (item.experimentId !== input.experimentId) throw new Error('Cross-experiment observation.');
  for (const item of input.coverage) for (const id of item.caseIds) if (!caseIds.has(id)) throw new Error('Coverage references an unknown case.');
  if (new Set(input.coverage.map(item => item.assertion)).size !== input.coverage.length) throw new Error('Duplicate assertion coverage.');
  if (input.conclusion === 'passed' && (input.observations.length === 0 || input.coverage.length === 0
      || input.observations.some(item => !item.passed) || input.coverage.some(item => item.coverage !== 'covered' || item.caseIds.length === 0)
      || input.errors.length > 0)) throw new Error('Passed requires successful observations and complete declared coverage.');
  if (input.conclusion === 'passed' && input.observations.some(item => item.limitations.length > 0)) throw new Error('Limited observations require an inconclusive result.');
  return input;
}
