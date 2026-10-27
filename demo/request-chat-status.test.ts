import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVITY_STAGES } from '../src/request-activity.ts';
import type { RequestActivity } from '../src/request-activity.ts';
import type { ConversationMessage, RequestConversation } from '../src/request-conversation.ts';
import { anchoredChatScrollTop, canDecideProposal, chatDomKey, chatRequestStatus, groupTurnActivity, matchingProposalReview, shouldFollowChat, visibleChatAnchor } from './request-chat-status.ts';
import type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';
import type { RequestState } from './change-requests.ts';

const baseRevisionId = 'a'.repeat(64);
const proposalRevisionId = 'b'.repeat(64);

function user(requestId: string, sequence: number): ConversationMessage {
  return { kind: 'user', id: requestId, requestId, sequence, at: 1000, baseRevisionId, text: 'Move the desk', sources: [], visual: null };
}

const proposal = {
  kind: 'assistant', id: 'assistant:first', requestId: 'turn-one', sequence: 2, at: 1001, baseRevisionId, replyTo: 'turn-one',
  content: { kind: 'proposal', text: 'Desk moved in a private proposal', proposalName: 'desk-position', proposalRevisionId },
} satisfies ConversationMessage;

const review: RequestChatProposalReview = {
  messageId: proposal.id, requestId: proposal.requestId, proposalRevisionId,
  summary: 'Move one desk', rationale: 'Provide clearance', constraints: 'Retain the walls', uncertainty: 'Confirm clearance on site',
  status: 'Ready for your review', canAccept: true, canReject: true, canRevise: true, delta: false,
};

function event(requestId: string, sequence: number, stage: RequestActivity['stage'], attempt = 1): RequestActivity {
  return { requestId, sequence, stage, attempt, at: 1000, message: `Server-reported ${stage}` };
}

function conversation(): RequestConversation {
  return { version: 1, ticketId: 'ticket-one', sequence: 3, messages: [user('turn-one', 1), proposal, user('turn-two', 3)] };
}

test('reported history stays grouped by turn across archived requests and restarted sequence numbers', () => {
  const history = [event('turn-one', 1, 'queued', 0), event('turn-one', 2, 'validation-failed'),
    event('turn-two', 1, 'queued', 0), event('turn-one', 3, 'validated', 2), event('turn-two', 2, 'started')];
  const input = conversation(); const before = JSON.stringify({ input, history });
  const groups = groupTurnActivity(input, history);
  assert.deepEqual(groups.get('turn-one'), [history[0], history[1], history[3]]);
  assert.deepEqual(groups.get('turn-two'), [history[2], history[4]]);
  assert.equal(groups.size, 2);
  assert.equal(JSON.stringify({ input, history }), before);
});

test('missing legacy history remains empty and unrelated request activity is never attached to a turn', () => {
  assert.deepEqual([...groupTurnActivity(conversation(), [])], [['turn-one', []], ['turn-two', []]]);
  assert.deepEqual([...groupTurnActivity(conversation(), [event('foreign', 1, 'completed')])], [['turn-one', []], ['turn-two', []]]);
});

test('only the explicitly inspected exact proposal receives review details', () => {
  assert.equal(matchingProposalReview(proposal, review), review);
  assert.equal(matchingProposalReview(proposal, null), null);
  assert.equal(matchingProposalReview(user('turn-one', 1), review), null);
  assert.equal(matchingProposalReview({ ...proposal, content: { kind: 'explanation', text: 'No proposal' } }, review), null);
  assert.equal(matchingProposalReview({ ...proposal, content: { kind: 'clarification', question: 'Where?', options: [] } }, review), null);
});

test('each review binding must match, including full revisions with identical display prefixes', () => {
  const mismatches: RequestChatProposalReview[] = [
    { ...review, messageId: 'assistant:earlier' }, { ...review, requestId: 'turn-two' },
    { ...review, proposalRevisionId: `${proposalRevisionId.slice(0, 63)}c` },
  ];
  for (const candidate of mismatches) assert.equal(matchingProposalReview(proposal, candidate), null);
});

test('historical proposals with the same revision still require their own inspected message and request', () => {
  const historical: ConversationMessage = { ...proposal, id: 'assistant:historical', requestId: 'turn-older' };
  assert.equal(matchingProposalReview(historical, review), null);
  assert.equal(matchingProposalReview(historical, { ...review, messageId: historical.id, requestId: historical.requestId })?.messageId, historical.id);
});

test('accept, reject and revise each require an exact inspection and the parent capability', () => {
  const actions: readonly RequestChatDecision[] = ['accept', 'reject', 'revise'];
  for (const action of actions) {
    const input = { message: proposal, review, action, disabled: false, offline: false };
    assert.equal(canDecideProposal(input), true);
    assert.equal(canDecideProposal({ ...input, review: null }), false);
    assert.equal(canDecideProposal({ ...input, review: { ...review, messageId: 'another-message' } }), false);
    assert.equal(canDecideProposal({ ...input, review: { ...review, canAccept: false, canReject: false, canRevise: false } }), false);
    assert.equal(canDecideProposal({ ...input, disabled: true }), false);
    assert.equal(canDecideProposal({ ...input, offline: true }), false);
  }
  const restricted = { ...review, canAccept: false, canReject: true, canRevise: false };
  assert.deepEqual(actions.map(action => canDecideProposal({ message: proposal, review: restricted, action, disabled: false, offline: false })), [false, true, false]);
});

test('missing activity never fabricates tool execution or success for queued and working requests', () => {
  assert.deepEqual(chatRequestStatus({ requestState: 'queued', offline: false, activity: [] }), {
    kind: 'queued', label: 'Queued', detail: 'Waiting for an available agent.',
  });
  assert.deepEqual(chatRequestStatus({ requestState: 'working', offline: false, activity: [] }), {
    kind: 'working', label: 'Working', detail: 'Waiting for the next reported action.',
  });
});

test('working status repeats the actual most recent reported action including validation failure', () => {
  const activity = [event('turn-two', 1, 'validated'), event('turn-two', 2, 'validation-failed')];
  assert.deepEqual(chatRequestStatus({ requestState: 'working', offline: false, activity }), {
    kind: 'working', label: 'Working', detail: 'Validation failed · Server-reported validation-failed',
  });
});

test('current progress does not borrow reported tool success from an older turn', () => {
  const grouped = groupTurnActivity(conversation(), [event('turn-one', 1, 'completed')]);
  assert.equal(chatRequestStatus({ requestState: 'working', offline: false, activity: grouped.get('turn-two') ?? [] }).detail,
    'Waiting for the next reported action.');
});

test('all reported stage labels retain the actual server message', () => {
  const stages: readonly RequestActivity['stage'][] = ['queued', 'started', 'inspecting', 'validating', 'validated', 'validation-failed',
    'submitting', 'declined', 'ready', 'needs-input', 'failed', 'cancelled', 'completed', 'rejected', 'recovered'];
  for (const stage of stages) {
    const activity = [event('turn-two', 1, stage)];
    assert.equal(chatRequestStatus({ requestState: 'working', offline: false, activity }).detail, `${ACTIVITY_STAGES[stage]} · Server-reported ${stage}`);
  }
  const reported = event('turn-two', 1, 'inspecting');
  reported.message = 'run_model_script: inspected 12 bound elements';
  assert.equal(chatRequestStatus({ requestState: 'working', offline: false, activity: [reported] }).detail,
    'Inspecting model · run_model_script: inspected 12 bound elements');
});

test('offline supersedes progress and reconnecting restores the last reported status', () => {
  const input = { requestState: 'working', activity: [event('turn-two', 1, 'inspecting')] } satisfies { requestState: RequestState; activity: readonly RequestActivity[] };
  assert.deepEqual(chatRequestStatus({ ...input, offline: true }), {
    kind: 'offline', label: 'Offline', detail: 'Last received status: Working. Reconnect to refresh.',
  });
  assert.equal(chatRequestStatus({ ...input, offline: false }).kind, 'working');
});

test('terminal and input states are displayed without inventing progress', () => {
  const expected: readonly [RequestState, string][] = [['ready', 'Ready for review'], ['needs-input', 'Needs your input'],
    ['completed', 'Accepted'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['failed', 'Attempt failed']];
  for (const [requestState, label] of expected) assert.deepEqual(chatRequestStatus({ requestState, offline: false, activity: [] }), { kind: 'idle', label, detail: '' });
});

const scroll = { previousConversationKey: 'project:ticket', nextConversationKey: 'project:ticket', scrollTop: 100, scrollHeight: 1000, clientHeight: 400, previouslyFollowing: false };

test('new chats and conversation switches follow to the end', () => {
  assert.equal(shouldFollowChat({ ...scroll, previousConversationKey: null }), true);
  assert.equal(shouldFollowChat({ ...scroll, nextConversationKey: 'project:other-ticket' }), true);
  assert.equal(shouldFollowChat({ ...scroll, nextConversationKey: 'other-project:ticket' }), true);
});

test('polling, activity and review updates preserve manual scroll until the reader returns to the bottom', () => {
  assert.equal(shouldFollowChat(scroll), false);
  assert.equal(shouldFollowChat({ ...scroll, scrollTop: 575 }), false);
  assert.equal(shouldFollowChat({ ...scroll, scrollTop: 576 }), true);
  assert.equal(shouldFollowChat({ ...scroll, scrollTop: 600 }), true);
  assert.equal(shouldFollowChat({ ...scroll, scrollTop: 601 }), true);
});

test('short transcripts follow new content while already at the end', () => {
  assert.equal(shouldFollowChat({ ...scroll, scrollHeight: 250, scrollTop: 0 }), true);
});

test('hidden history retains follow intent rather than treating zero-sized manual readers as at the bottom', () => {
  const hidden = { ...scroll, clientHeight: 0, scrollHeight: 0, scrollTop: 0 };
  assert.equal(shouldFollowChat(hidden), false);
  assert.equal(shouldFollowChat({ ...hidden, previouslyFollowing: true }), true);
  assert.equal(shouldFollowChat({ ...hidden, nextConversationKey: 'project:new-chat' }), true);
  assert.equal(shouldFollowChat({ ...scroll, previouslyFollowing: true }), false);
});

test('message-local keys isolate source details and controls without delimiter collisions', () => {
  assert.notEqual(chatDomKey('turn-one', 'detail', 0), chatDomKey('turn-two', 'detail', 0));
  assert.notEqual(chatDomKey('turn-one', 'detail', 0), chatDomKey('turn-one', 'control', 0));
  assert.notEqual(chatDomKey('turn:control', 'control', 'delta'), chatDomKey('turn', 'control', 'control:delta'));
  const savedOpenDetails = new Set([chatDomKey('turn-one', 'detail', 0), chatDomKey('turn-one', 'detail', 2)]);
  assert.deepEqual([0, 1, 2].map(index => savedOpenDetails.has(chatDomKey('turn-one', 'detail', index))), [true, false, true]);
  assert.equal(savedOpenDetails.has(chatDomKey('turn-two', 'detail', 0)), false);
});

test('the first intersecting message anchors a reader partway through a long turn', () => {
  const messages = [{ messageId: 'earlier', top: 0, bottom: 100 }, { messageId: 'reading', top: 100, bottom: 450 },
    { messageId: 'later', top: 480, bottom: 800 }];
  assert.deepEqual(visibleChatAnchor(messages, { top: 125, bottom: 525 }), { messageId: 'reading', offset: -25 });
  assert.deepEqual(visibleChatAnchor(messages, { top: 100, bottom: 500 }), { messageId: 'reading', offset: 0 });
});

test('messages fully outside the viewport never become reading anchors', () => {
  const messages = [{ messageId: 'above', top: 0, bottom: 100 }, { messageId: 'below', top: 500, bottom: 800 }];
  assert.equal(visibleChatAnchor(messages, { top: 100, bottom: 500 }), null);
  assert.equal(visibleChatAnchor([], { top: 100, bottom: 500 }), null);
});

test('activity inserted above the viewport preserves the same message and visible offset', () => {
  const anchor = visibleChatAnchor([{ messageId: 'reading', top: 80, bottom: 400 }], { top: 100, bottom: 500 });
  assert.ok(anchor);
  const nextScrollTop = anchoredChatScrollTop({ scrollTop: 300, previousOffset: anchor.offset, currentOffset: 130 });
  assert.equal(nextScrollTop, 450);
  assert.equal(130 - (nextScrollTop - 300), anchor.offset);
});

test('removing content above the reader compensates for browser scroll clamping', () => {
  const nextScrollTop = anchoredChatScrollTop({ scrollTop: 120, previousOffset: -30, currentOffset: -60 });
  assert.equal(nextScrollTop, 90);
  assert.equal(-60 - (nextScrollTop - 120), -30);
  assert.equal(anchoredChatScrollTop({ scrollTop: 10, previousOffset: 20, currentOffset: 0 }), 0);
});

test('unchanged message bounds do not move a manual reader', () => {
  assert.equal(anchoredChatScrollTop({ scrollTop: 300, previousOffset: -25, currentOffset: -25 }), 300);
});
