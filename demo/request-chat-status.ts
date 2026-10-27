import { ACTIVITY_STAGES } from '../src/request-activity.ts';
import type { RequestActivity } from '../src/request-activity.ts';
import type { ConversationMessage, RequestConversation } from '../src/request-conversation.ts';
import type { ProposalReview } from '../src/room-model.ts';
import type { RequestState } from './change-requests.ts';

type ProposalContent = Extract<Extract<ConversationMessage, { kind: 'assistant' }>['content'], { kind: 'proposal' }>;

/** A parent-validated view of the exact proposal explicitly inspected in the viewer. */
export interface RequestChatProposalReview extends Pick<ConversationMessage, 'requestId'>,
  Pick<ProposalContent, 'proposalRevisionId'>,
  Pick<ProposalReview, 'summary' | 'rationale' | 'constraints' | 'uncertainty' | 'target' | 'evidenceUses'> {
  messageId: ConversationMessage['id'];
  status: string;
  canAccept: boolean;
  canReject: boolean;
  canRevise: boolean;
  /** Display only; the parent supplies the reviewed target's human-readable name. */
  targetLabel?: string;
  /** Whether the parent is currently displaying the reviewed delta. */
  delta: boolean;
}

export type RequestChatDecision = 'accept' | 'reject' | 'revise';

const stateLabels: Record<RequestState, string> = {
  queued: 'Queued', working: 'Working', 'needs-input': 'Needs your input', ready: 'Ready for review',
  completed: 'Accepted', rejected: 'Rejected', cancelled: 'Cancelled', failed: 'Attempt failed',
};

/** Use request identities, never timestamps, to associate archived activity with turns. */
export function groupTurnActivity(conversation: RequestConversation, activity: readonly RequestActivity[]): ReadonlyMap<string, readonly RequestActivity[]> {
  const groups = new Map<string, RequestActivity[]>();
  for (const message of conversation.messages) {
    if (message.kind === 'user' && !groups.has(message.requestId)) groups.set(message.requestId, []);
  }
  for (const event of activity) groups.get(event.requestId)?.push(event);
  return groups;
}

export function matchingProposalReview(message: ConversationMessage, review: RequestChatProposalReview | null): RequestChatProposalReview | null {
  return review && message.kind === 'assistant' && message.content.kind === 'proposal'
    && message.id === review.messageId && message.requestId === review.requestId
    && message.content.proposalRevisionId === review.proposalRevisionId ? review : null;
}

export function canDecideProposal(input: {
  message: ConversationMessage; review: RequestChatProposalReview | null; action: RequestChatDecision; disabled: boolean; offline: boolean;
}): boolean {
  const review = matchingProposalReview(input.message, input.review);
  if (!review || input.disabled || input.offline) return false;
  switch (input.action) {
    case 'accept': return review.canAccept;
    case 'reject': return review.canReject;
    case 'revise': return review.canRevise;
  }
}

export function chatRequestStatus(input: {
  requestState: RequestState; offline: boolean; activity: readonly RequestActivity[];
}): { kind: 'offline' | 'queued' | 'working' | 'idle'; label: string; detail: string } {
  if (input.offline) return { kind: 'offline', label: 'Offline', detail: `Last received status: ${stateLabels[input.requestState]}. Reconnect to refresh.` };
  const latest = input.activity.at(-1);
  const reported = latest ? `${ACTIVITY_STAGES[latest.stage]} · ${latest.message}` : '';
  switch (input.requestState) {
    case 'queued': return { kind: 'queued', label: 'Queued', detail: reported || 'Waiting for an available agent.' };
    case 'working': return { kind: 'working', label: 'Working', detail: reported || 'Waiting for the next reported action.' };
    default: return { kind: 'idle', label: stateLabels[input.requestState], detail: reported };
  }
}

export function shouldFollowChat(input: {
  previousConversationKey: string | null; nextConversationKey: string | null;
  scrollTop: number; scrollHeight: number; clientHeight: number; previouslyFollowing: boolean;
}): boolean {
  return input.previousConversationKey !== input.nextConversationKey
    || (input.clientHeight === 0 ? input.previouslyFollowing : input.scrollHeight - input.clientHeight - input.scrollTop <= 24);
}

export function chatDomKey(messageId: string, kind: 'detail' | 'control', localKey: string | number): string {
  return JSON.stringify([messageId, kind, localKey]);
}

export interface ChatMessageBounds { messageId: string; top: number; bottom: number }
export interface ChatScrollAnchor { messageId: string; offset: number }

export function visibleChatAnchor(messages: readonly ChatMessageBounds[], viewport: { top: number; bottom: number }): ChatScrollAnchor | null {
  const visible = messages.find(message => message.bottom > viewport.top && message.top < viewport.bottom);
  return visible ? { messageId: visible.messageId, offset: visible.top - viewport.top } : null;
}

export function anchoredChatScrollTop(input: { scrollTop: number; previousOffset: number; currentOffset: number }): number {
  return Math.max(0, input.scrollTop + input.currentOffset - input.previousOffset);
}
