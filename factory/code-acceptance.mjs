import assert from 'node:assert/strict';
import { codingProfile } from './coding.mjs';
const statuses = ['running', 'succeeded', 'needs-input', 'failed', 'timed-out', 'cancelled', 'interrupted', 'blocked'];
const expected = (records) => ({ total: records.length,
  byStatus: Object.fromEntries(statuses.map((status) => [status, records.filter((record) => record.status === status).length])),
  attentionRequired: records.some((record) => ['needs-input', 'failed', 'timed-out', 'interrupted', 'blocked'].includes(record.status)),
});
export const healthAcceptanceCases = [
  ...[[], [{ status: 'succeeded' }, { status: 'running' }],
    statuses.map((status) => ({ status, privateMetadata: 'DO_NOT_REPRODUCE' })),
    Array.from({ length: 1000 }, () => ({ status: 'cancelled' }))]
    .map((records, index) => ({ mode: 'cli', name: `valid-${index}`, input: JSON.stringify(records), output: expected(records) })),
  ...['{', '{}', '[null]', '[1]', '[[]]', '[{}]', '[{"status":"other"}]',
    JSON.stringify(Array.from({ length: 1001 }, () => ({ status: 'succeeded' }))),
    `[${' '.repeat(65536)}]`]
    .map((input, index) => ({ mode: 'cli', name: `invalid-${index}`, input, output: null })),
];
healthAcceptanceCases.push(...healthAcceptanceCases.filter((item) => !['invalid-0', 'invalid-8'].includes(item.name))
  .map((item) => ({ ...item, mode: 'api', name: `api-${item.name}` })));

const ready = { enabled: true, paused: false, scopeApproved: true, activeRun: false, attemptsToday: 0, dailyLimit: 1 };
const scheduleValid = [
  [{ ...ready, enabled: false, paused: true, scopeApproved: false, activeRun: true, attemptsToday: 1 }, 'disabled'],
  [{ ...ready, paused: true, scopeApproved: false, activeRun: true, attemptsToday: 1 }, 'paused'],
  [{ ...ready, scopeApproved: false, activeRun: true, attemptsToday: 1 }, 'scope-not-approved'],
  [{ ...ready, activeRun: true, attemptsToday: 1 }, 'busy'],
  [{ ...ready, attemptsToday: 1 }, 'daily-limit'],
  [ready, 'ready'],
  [{ ...ready, attemptsToday: 2, dailyLimit: 3 }, 'ready'],
  [{ ...ready, attemptsToday: 1000, dailyLimit: 3 }, 'daily-limit'],
].map(([input, reason], index) => ({ name: `schedule-valid-${index}`, input: JSON.stringify(input),
  output: { eligible: reason === 'ready', reason } }));
const scheduleInvalid = [null, [], {}, { ...ready, enabled: 'true' }, { ...ready, attemptsToday: -1 },
  { ...ready, dailyLimit: 4 }, { ...ready, credential: 'DO_NOT_REPRODUCE' }]
  .map((input, index) => ({ name: `schedule-invalid-${index}`, input: JSON.stringify(input), output: null }));
export const scheduleAcceptanceCases = [
  ...['cli', 'api'].flatMap((mode) => [...scheduleValid, ...scheduleInvalid].map((item) => ({ mode, ...item, name: `${mode}-${item.name}` }))),
  { mode: 'cli', name: 'schedule-malformed', input: '{', output: null },
  { mode: 'cli', name: 'schedule-byte-limit', input: `${JSON.stringify(ready)}${' '.repeat(4096)}`, output: null },
];

export function assertCodingObservation(acceptance, observation, paths = ['factory/health.ts', 'factory/health.test.ts']) {
  const profile = codingProfile(paths);
  assert.ok(Number.isInteger(observation.exitCode) && observation.exitCode >= 0 && !observation.signal, 'candidate did not exit normally');
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
