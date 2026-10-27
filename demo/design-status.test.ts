import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesignTarget } from '../src/design-targets.ts';
import { designSaveStatus } from './design-status.ts';

test('a fixed baseline is identified as fixed rather than an outdated editable model', () => {
  assert.equal(designSaveStatus({ name: 'As-is', target: { kind: 'baseline', id: 'as-is' },
    displayedRevisionId: 'original1234', serverRevisionId: 'new-alternative' }), 'As-is · fixed baseline · original12');
});

test('freshness compares the selected alternative and names the design that needs reopening', () => {
  const target = { kind: 'alternative', id: 'option-a' } satisfies DesignTarget;
  assert.equal(designSaveStatus({ name: 'Option A', target, displayedRevisionId: 'current', serverRevisionId: 'current' }), 'Saved · Option A · current');
  assert.equal(designSaveStatus({ name: 'Option A', target, displayedRevisionId: 'old', serverRevisionId: 'new' }),
    'Option A has an update · reopen the current design · your message is kept');
});
