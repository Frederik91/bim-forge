import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageAfterReviewDecision } from './review-workflow.ts';

test('accepting a proposal continues to its saved history', () => {
  assert.equal(pageAfterReviewDecision('accepted'), 'history');
});

test('requesting a revision returns to the request workflow', () => {
  assert.equal(pageAfterReviewDecision('revision-requested'), 'request');
});
