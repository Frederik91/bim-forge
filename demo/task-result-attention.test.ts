import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskResultAttentionStore } from './task-result-attention.ts';

function task(): Parameters<TaskResultAttentionStore['attention']>[0] { return { projectId: 'project-one', id: 'task-one', state: 'ready', attempts: 1, request: { requestId: 'turn-one' } }; }
test('new outcome is unread, viewing survives reload, later turns and retry attempts are unread again', () => {
  const stored = new Map<string, string>(); const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } };
  const first = new TaskResultAttentionStore(storage); const ticket = task();
  assert.equal(first.attention(ticket), 'unread'); assert.equal(first.markViewed(ticket), true); assert.equal(first.markViewed(ticket), false);
  assert.equal(new TaskResultAttentionStore(storage).attention(ticket), 'viewed');
  assert.equal(first.attention({ ...ticket, state: 'rejected' }), 'viewed', 'A human decision is not a newly delivered agent result');
  assert.equal(first.attention({ ...ticket, attempts: 2 }), 'unread');
  assert.equal(first.attention({ ...ticket, request: { requestId: 'turn-two' } }), 'unread');
  assert.equal(first.attention({ ...ticket, projectId: 'project-two' }), 'unread');
  for (const state of ['queued', 'working', 'completed', 'cancelled'] satisfies Parameters<TaskResultAttentionStore['attention']>[0]['state'][]) { assert.equal(first.attention({ ...ticket, state }), 'none'); assert.equal(first.markViewed({ ...ticket, state }), false); }
});
test('denied storage keeps viewing useful for this session without changing server state', () => {
  const store = new TaskResultAttentionStore({ getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Full'); } });
  const ticket = task(); const original = structuredClone(ticket);
  assert.equal(store.attention(ticket), 'unread'); assert.equal(store.markViewed(ticket), true); assert.equal(store.attention(ticket), 'viewed'); assert.deepEqual(ticket, original);
});
