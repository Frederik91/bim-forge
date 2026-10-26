import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConversationReply, parseConversationMessage, parseRequestConversation, parseClarification } from './request-conversation.ts';
import type { ConversationReply, ConversationMessage } from './request-conversation.ts';

const revision = 'a'.repeat(64);
const reply: ConversationReply = { messageId: 'reply-one', expectedSequence: 2, baseRevisionId: revision,
  text: 'Keep the earlier requirement and widen this desk to 1800 mm.', sources: [],
  visual: { snapshot: { kind: 'accepted', revisionId: revision }, view: '3d', levelId: null, selectedObjectIds: ['office-desk'],
    annotations: [{ kind: 'pin', position: [1.2, 2.4, .8], label: 'This desk' }] } };

test('reply parsing preserves explicit snapshot, metre coordinates and immutable source references', () => {
  const source = { id: '18100000-0000-4000-8000-000000000001', name: 'desk.md', mediaType: 'text/markdown', byteLength: 24, sha256: 'b'.repeat(64) };
  const input = { ...reply, sources: [source] };
  const parsed = parseConversationReply(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.visual, input.visual);
  assert.deepEqual(parsed.visual?.annotations[0], { kind: 'pin', position: [1.2, 2.4, .8], label: 'This desk' });
});

test('replies cannot smuggle approval, provider roles or invalid snapshot evidence', () => {
  for (const input of [
    { ...reply, approved: true }, { ...reply, role: 'assistant' }, { ...reply, expectedSequence: -1 },
    { ...reply, visual: { ...reply.visual, snapshot: { kind: 'current' } } },
    { ...reply, visual: { ...reply.visual, snapshot: { kind: 'proposal', revisionId: revision } } },
    { ...reply, visual: { ...reply.visual, annotations: [{ kind: 'pin', position: [Infinity, 1, 2], label: '' }] } },
    { ...reply, sources: [{ id: '../private-file', name: 'desk.md', mediaType: 'text/markdown', byteLength: 24, sha256: 'b'.repeat(64) }] },
  ]) assert.throws(() => parseConversationReply(input));
});

test('clarification is a structured question and cannot claim a proposal or approval', () => {
  assert.deepEqual(parseClarification({ question: 'Which width do you need?', options: ['1800 mm', '1900 mm'] }),
    { question: 'Which width do you need?', options: ['1800 mm', '1900 mm'] });
  for (const input of [{ question: '', options: [] }, { question: 'Which width?', options: ['Same', 'Same'] },
    { question: 'Which width?', options: [], approve: true }]) assert.throws(() => parseClarification(input));
});

test('transcript recovery rejects missing, duplicated and reordered sequence numbers', () => {
  const user: ConversationMessage = { id: 'reply-one', sequence: 1, at: 1, requestId: 'request-one', baseRevisionId: revision,
    kind: 'user', text: reply.text, sources: [], visual: reply.visual };
  const assistant: ConversationMessage = { id: 'assistant-one', sequence: 2, at: 2, requestId: 'request-one', baseRevisionId: revision,
    kind: 'assistant', replyTo: user.id, content: { kind: 'clarification', question: 'Which width?', options: [] } };
  const conversation = { version: 1, ticketId: 'ticket-one', sequence: 2, messages: [user, assistant] };
  assert.deepEqual(parseRequestConversation(conversation), conversation);
  for (const input of [{ ...conversation, sequence: 1 }, { ...conversation, messages: [assistant, user] },
    { ...conversation, messages: [user, { ...assistant, sequence: 1 }] }]) assert.throws(() => parseRequestConversation(input), /sequence/);
  assert.throws(() => parseConversationMessage({ ...assistant, content: { kind: 'approval', approved: true } }));
});
