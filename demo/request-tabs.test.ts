import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRequests, REQUEST_TABS } from './request-tabs.ts';
import type { RequestState } from './change-requests.ts';

test('backlog puts review first, followed by progress, waiting and finished work', () => {
  assert.deepEqual(REQUEST_TABS.map((tab) => tab.label), ['Ready for review', 'In progress', 'Waiting', 'Completed / rejected']);
});

test('every request remains visible, with questions and failures needing attention first', () => {
  const states: RequestState[] = ['queued', 'working', 'needs-input', 'ready', 'completed', 'rejected', 'cancelled', 'failed'];
  const requests = states.map((state, id) => ({ state, id }));
  const groups = groupRequests(requests);
  assert.deepEqual(groups.review.map((request) => request.state), ['needs-input', 'ready', 'failed']);
  assert.deepEqual(groups.progress.map((request) => request.state), ['working']);
  assert.deepEqual(groups.waiting.map((request) => request.state), ['queued']);
  assert.deepEqual(groups.finished.map((request) => request.state), ['completed', 'rejected', 'cancelled']);
  assert.equal(Object.values(groups).flat().length, requests.length);
  assert.equal(groups.review[0], requests[2]);
  assert.deepEqual(groupRequests([]), { review: [], progress: [], waiting: [], finished: [] });
});
