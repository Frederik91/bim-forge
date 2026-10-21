import assert from 'node:assert/strict';
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

export function assertCodingObservation(acceptance, observation) {
  assert.ok(Number.isInteger(observation.exitCode) && observation.exitCode >= 0 && !observation.signal, 'candidate did not exit normally');
  if (acceptance.output === null) {
    assert.notEqual(observation.exitCode, 0, 'invalid input must fail');
    assert.equal(observation.stdout, '');
    assert.equal(observation.stderr, 'Invalid run records\n');
  } else {
    assert.equal(observation.exitCode, 0);
    assert.equal(observation.stderr, '');
    assert.equal(observation.stdout, `${JSON.stringify(acceptance.output)}\n`);
  }
}
