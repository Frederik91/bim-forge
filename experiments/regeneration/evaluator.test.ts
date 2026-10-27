import assert from 'node:assert/strict';
import test from 'node:test';
import { dependencyCases } from './cases.ts';
import { parseObservations } from './contract.ts';

for (const entry of dependencyCases) {
  test(entry.caseId, () => entry.execute().verify());
}

test('observations enforce the frozen EX-07 protocol', () => {
  const observation = { experimentId: 'EX-07', caseId: 'sample', expected: 'expected',
    observed: 'observed', passed: false, limitations: ['not a result approval'] };
  assert.deepEqual(parseObservations([observation]), [observation]);
  assert.throws(() => parseObservations([{ ...observation, passed: 'yes' }]));
  assert.throws(() => parseObservations([{ ...observation, experimentId: 'EX-08' }]));
  assert.throws(() => parseObservations([{ ...observation, approval: 'approved' }]));
  assert.throws(() => parseObservations([observation, observation]));
});
