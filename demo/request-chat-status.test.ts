import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVITY_STAGES } from '../src/request-activity.ts';
import type { RequestActivity } from '../src/request-activity.ts';
import type { ConversationMessage, RequestConversation } from '../src/request-conversation.ts';
import { canDecideProposal, chatRequestStatus, groupTurnActivity, matchingProposalReview, shouldFollowChat } from './request-chat-status.ts';
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

const scroll = { previousConversationKey: 'project:ticket', nextConversationKey: 'project:ticket', scrollTop: 100, scrollHeight: 1000, clientHeight: 400 };

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
