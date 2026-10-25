import test from 'node:test';
import assert from 'node:assert/strict';
import { entity, hash } from '../../../experiments/storage/contract.ts';
import type { Json } from '../../../experiments/storage/contract.ts';
import { qualificationRevisionFacts } from './inspect-qualification.ts';

function revision(payload: Json, commandId: string, parentId: string | null = null) {
  return { revision_id: hash(payload), parent_id: parentId, command_id: commandId, payload_hash: hash(payload), payload };
}

test('initial revision facts validate the exact load command, branch, hash and root link', () => {
  const payload = { operation: 'initial-load', branch: 'b', fingerprint: { count: 1, sum: hash('sum'), xor: hash('xor') }, countsByKind: { wall: 1 } };
  const row = revision(payload, `load:${hash(payload)}`);
  const expected = { branch: 'b', commandId: row.command_id, kind: 'initial' } satisfies Parameters<typeof qualificationRevisionFacts>[1];
  assert.equal(qualificationRevisionFacts(row, expected)?.payloadMatches, true);
  assert.equal(qualificationRevisionFacts(row, expected)?.identityMatches, true);
  assert.equal(qualificationRevisionFacts({ ...row, command_id: 'wrong' }, expected)?.identityMatches, false);
  assert.equal(qualificationRevisionFacts({ ...row, payload_hash: hash('wrong') }, expected)?.identityMatches, false);
  assert.equal(qualificationRevisionFacts({ ...row, parent_id: hash('parent') }, expected)?.payloadMatches, false);
  assert.equal(qualificationRevisionFacts(row, { ...expected, branch: 'foreign' })?.payloadMatches, false);
  assert.equal(qualificationRevisionFacts(null, expected), null);
});

test('accepted revision facts retain single-object command identities and reject wrong scopes', () => {
  const put = entity({ entityId: 'e', kind: 'wall', typeId: null, containerId: null, systemId: null,
    fromId: null, toId: null, document: { qualificationRun: 'run' } });
  const parent = hash('parent');
  const payload = { branch: 'b', commandId: 'run:accepted:0', expectedHead: parent,
    assumptions: [{ entityId: 'e', versionId: null }], puts: [put], deletes: [] };
  const expected = { branch: 'b', commandId: payload.commandId, kind: 'accepted' } satisfies Parameters<typeof qualificationRevisionFacts>[1];
  const facts = qualificationRevisionFacts(revision(payload, payload.commandId, parent), expected);
  assert.equal(facts?.payloadMatches, true);
  assert.equal(facts?.putEntityId, 'e');
  assert.equal(facts?.putVersionId, hash(put));
  assert.equal(qualificationRevisionFacts(revision(payload, payload.commandId), expected)?.payloadMatches, false);
  assert.equal(qualificationRevisionFacts(revision({ ...payload, branch: 'foreign' }, payload.commandId, parent), expected)?.payloadMatches, false);
  const extra = { ...payload, puts: [put, { ...put, entityId: 'other' }],
    assumptions: [...payload.assumptions, { entityId: 'other', versionId: null }] };
  assert.equal(qualificationRevisionFacts(revision(extra, payload.commandId, parent), expected)?.payloadMatches, false);
  const malformed = qualificationRevisionFacts(revision({ unexpected: true }, payload.commandId), expected);
  assert.equal(malformed?.payloadMatches, false);
  assert.notEqual(malformed?.validationError, null);
});
