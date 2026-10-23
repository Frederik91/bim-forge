import assert from 'node:assert/strict';
import { codingProfile, type CodingAcceptanceCase } from './coding.ts';

type RunStatus = 'running' | 'succeeded' | 'needs-input' | 'failed' | 'timed-out' | 'cancelled' | 'interrupted' | 'blocked';

interface RunRecord {
  readonly status: RunStatus;
}

interface ScheduleInput {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly scopeApproved: boolean;
  readonly activeRun: boolean;
  readonly attemptsToday: number;
  readonly dailyLimit: number;
}

const statuses: RunStatus[] = ['running', 'succeeded', 'needs-input', 'failed', 'timed-out', 'cancelled', 'interrupted', 'blocked'];

function expected(records: readonly RunRecord[]): Record<string, unknown> {
  return {
    total: records.length,
    byStatus: Object.fromEntries(statuses.map((status) => [status, records.filter((record) => record.status === status).length])),
    attentionRequired: records.some((record) => ['needs-input', 'failed', 'timed-out', 'interrupted', 'blocked'].includes(record.status)),
  };
}

const healthRecords: RunRecord[][] = [
  [],
  [{ status: 'succeeded' }, { status: 'running' }],
  statuses.map((status) => ({ status, privateMetadata: 'DO_NOT_REPRODUCE' })),
  Array.from({ length: 1000 }, () => ({ status: 'cancelled' })),
];

export const healthAcceptanceCases: CodingAcceptanceCase[] = [
  ...healthRecords.map((records, index): CodingAcceptanceCase => ({
    mode: 'cli', name: `valid-${index}`, input: JSON.stringify(records), output: expected(records),
  })),
  ...['{', '{}', '[null]', '[1]', '[[]]', '[{}]', '[{"status":"other"}]',
    JSON.stringify(Array.from({ length: 1001 }, () => ({ status: 'succeeded' }))),
    `[${' '.repeat(65536)}]`]
    .map((input, index): CodingAcceptanceCase => ({ mode: 'cli', name: `invalid-${index}`, input, output: null })),
];
healthAcceptanceCases.push(...healthAcceptanceCases.filter((item) => !['invalid-0', 'invalid-8'].includes(item.name))
  .map((item): CodingAcceptanceCase => ({ ...item, mode: 'api', name: `api-${item.name}` })));

const ready: ScheduleInput = {
  enabled: true, paused: false, scopeApproved: true, activeRun: false, attemptsToday: 0, dailyLimit: 1,
};
const scheduleValid: { readonly input: ScheduleInput; readonly reason: string }[] = [
  { input: { ...ready, enabled: false, paused: true, scopeApproved: false, activeRun: true, attemptsToday: 1 }, reason: 'disabled' },
  { input: { ...ready, paused: true, scopeApproved: false, activeRun: true, attemptsToday: 1 }, reason: 'paused' },
  { input: { ...ready, scopeApproved: false, activeRun: true, attemptsToday: 1 }, reason: 'scope-not-approved' },
  { input: { ...ready, activeRun: true, attemptsToday: 1 }, reason: 'busy' },
  { input: { ...ready, attemptsToday: 1 }, reason: 'daily-limit' },
  { input: ready, reason: 'ready' },
  { input: { ...ready, attemptsToday: 2, dailyLimit: 3 }, reason: 'ready' },
  { input: { ...ready, attemptsToday: 1000, dailyLimit: 3 }, reason: 'daily-limit' },
];
const scheduleValidCases = scheduleValid.map(({ input, reason }, index) => ({
  name: `schedule-valid-${index}`,
  input: JSON.stringify(input),
  output: { eligible: reason === 'ready', reason },
}));
const scheduleInvalidCases = [null, [], {}, { ...ready, enabled: 'true' }, { ...ready, attemptsToday: -1 },
  { ...ready, dailyLimit: 4 }, { ...ready, credential: 'DO_NOT_REPRODUCE' }]
  .map((input, index) => ({ name: `schedule-invalid-${index}`, input: JSON.stringify(input), output: null }));
const acceptanceModes: ('cli' | 'api')[] = ['cli', 'api'];

export const scheduleAcceptanceCases: CodingAcceptanceCase[] = [
  ...acceptanceModes.flatMap((mode) => [...scheduleValidCases, ...scheduleInvalidCases]
    .map((item): CodingAcceptanceCase => ({ mode, ...item, name: `${mode}-${item.name}` }))),
  { mode: 'cli', name: 'schedule-malformed', input: '{', output: null },
  { mode: 'cli', name: 'schedule-byte-limit', input: `${JSON.stringify(ready)}${' '.repeat(4096)}`, output: null },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertCodingObservation(
  acceptance: CodingAcceptanceCase,
  observation: unknown,
  paths: unknown = ['factory/health.ts', 'factory/health.test.ts'],
): void {
  const profile = codingProfile(paths);
  assert.ok(isRecord(observation), 'candidate observation is invalid');
  assert.ok(typeof observation.exitCode === 'number' && Number.isInteger(observation.exitCode)
    && observation.exitCode >= 0 && !observation.signal, 'candidate did not exit normally');
  assert.ok(typeof observation.stdout === 'string' && typeof observation.stderr === 'string', 'candidate output is invalid');
  if (acceptance.output === null) {
    assert.notEqual(observation.exitCode, 0, 'invalid input must fail');
    assert.equal(observation.stdout, '');
    assert.equal(observation.stderr, `${profile.errorText}\n`);
  } else {
    assert.equal(observation.exitCode, 0);
    assert.equal(observation.stderr, '');
    assert.equal(observation.stdout, `${JSON.stringify(acceptance.output)}\n`);
  }
}
