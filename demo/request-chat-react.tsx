import { Fragment, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { Root } from 'react-dom/client';
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { CONVERSATION_LIMITS } from '../src/request-conversation.ts';
import type { ConversationMessage, ConversationVisual } from '../src/request-conversation.ts';
import { ACTIVITY_STAGES } from '../src/request-activity.ts';
import type { RequestActivity } from '../src/request-activity.ts';
import { renderSourceContext } from './request-source-ui.ts';
import { annotationDescription, visualLabel } from './request-chat-evidence.ts';
import { canDecideProposal, chatRequestStatus, groupTurnActivity, matchingProposalReview } from './request-chat-status.ts';
import type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';
import type { RequestChatActions, RequestChatInput } from './request-chat.ts';
import { Button } from './ui/button.tsx';

interface ChatView extends Omit<RequestChatInput, 'conversation'> {
  conversation: RequestChatInput['conversation'] | null;
  review: RequestChatProposalReview | null;
  offline: boolean;
  disabled: boolean;
}
export interface RequestChatRenderActions extends RequestChatActions {
  interact: (message: ConversationMessage, action: () => void) => void;
  decide: (message: ConversationMessage, action: RequestChatDecision) => void;
  showDelta: (message: ConversationMessage) => void;
}
interface MessageProps { message: ConversationMessage; view: ChatView; actions: RequestChatRenderActions }
const noMessages: readonly ConversationMessage[] = [];

function convertMessage(message: ConversationMessage): ThreadMessageLike {
  const text = message.kind === 'user' ? message.text : message.kind === 'decision' ? `Recorded: ${message.action}.`
    : message.content.kind === 'clarification' ? message.content.question : message.content.text;
  return { id: message.id, role: message.kind === 'user' ? 'user' : 'assistant', createdAt: new Date(message.at), content: [{ type: 'text', text }] };
}
async function sendThroughExistingComposer(): Promise<void> {
  throw new Error('Send messages through the BIM Forge request composer.');
}

function Control({ message, view, actions, children, onClick, focusKey, primary = false, pressed }: MessageProps & {
  children: ReactNode; onClick: () => void; focusKey: string; primary?: boolean; pressed?: boolean;
}) {
  return <Button type="button" variant={primary ? 'default' : 'outline'} size="sm" className={primary ? 'button primary' : 'button outline'}
    data-focus-key={focusKey} disabled={view.disabled || view.offline} aria-pressed={pressed}
    onClick={() => actions.interact(message, onClick)}>{children}</Button>;
}

function SourceContext({ projectId, message }: { projectId: string; message: Extract<ConversationMessage, { kind: 'user' }> }) {
  const host = useRef<HTMLElement>(null);
  const sourceKey = JSON.stringify(message.sources);
  useLayoutEffect(() => {
    if (host.current) renderSourceContext(host.current, projectId, { sources: message.sources }, true);
  }, [projectId, sourceKey]);
  return <section ref={host} />;
}

function Status({ view, activity }: { view: ChatView; activity: readonly RequestActivity[] }) {
  const status = chatRequestStatus({ requestState: view.requestState, offline: view.offline, activity });
  return <div className="request-chat-status" data-status={status.kind} role="status" aria-live="polite">
    <strong>{status.label}</strong>{status.detail && <span>{status.detail}</span>}
  </div>;
}

function Activity({ message, activity }: { message: ConversationMessage; activity: readonly RequestActivity[] }) {
  return <details className="request-chat-activity" data-detail-key={`activity:${message.id}`}>
    <summary>Activity · {activity.length}</summary>
    {activity.length ? <ol>{activity.map(event => <li key={`${event.attempt}:${event.sequence}`} data-activity-sequence={event.sequence}>
      <strong>{ACTIVITY_STAGES[event.stage]}</strong><p>{event.message}</p>
      <small>Attempt {event.attempt} · #{event.sequence} · {new Date(event.at).toLocaleString()}</small>
    </li>)}</ol> : <p>No activity was reported for this turn.</p>}
    <p>#{message.sequence} · {new Date(message.at).toLocaleString()} · Message {message.id} · Request {message.requestId} · Base revision {message.baseRevisionId}</p>
  </details>;
}

function VisualEvidence({ visual, ...props }: MessageProps & { visual: ConversationVisual }) {
  return <details className="request-chat-visual" data-detail-key={`visual:${props.message.id}`}>
    <summary>{visualLabel(visual)}</summary><p>Selected IDs: {visual.selectedObjectIds.join(', ') || 'None'}</p>
    {visual.annotations.map((annotation, index) => <p key={index}>{annotationDescription(annotation)}</p>)}
    <Control {...props} focusKey="inspect-visual" onClick={() => props.actions.inspect(visual)}>Inspect bound snapshot</Control>
  </details>;
}

function ProposalCard(props: MessageProps & { message: Extract<ConversationMessage, { kind: 'assistant' }> }) {
  const { message, view, actions } = props;
  if (message.content.kind !== 'proposal') return null;
  const content = message.content;
  const review = matchingProposalReview(message, view.review);
  const targetLabel = review?.targetLabel?.trim() || (review?.target?.target.kind === 'main' ? 'Main design'
    : review?.target?.target.kind === 'alternative' ? 'selected alternative' : 'selected design');
  const decisions: readonly [RequestChatDecision, string][] = [['accept', `Accept into ${targetLabel}`], ['revise', 'Request revision'], ['reject', 'Reject proposal']];
  const technical = <details className="request-chat-technical" data-detail-key={`proposal:${message.id}`}>
    <summary>Proposal details</summary><dl className="request-chat-review-details">
      {review && <>
        {[['Rationale', review.rationale], ['Constraints', review.constraints], ['Uncertainty', review.uncertainty]].map(([label, text]) =>
          <Fragment key={label}><dt>{label}</dt><dd>{text}</dd></Fragment>)}
        {content.text.trim() !== review.summary.trim() && <><dt>Agent note</dt><dd>{content.text}</dd></>}
        {review.target && <><dt>Target identity</dt><dd>{review.target.target.kind === 'main' ? 'Main design' : `Alternative ${review.target.target.id}`}</dd>
          <dt>Target revision</dt><dd>{review.target.revisionId}</dd></>}
      </>}
      {[['Message', message.id], ['Sequence', String(message.sequence)], ['Request', message.requestId], ['Base revision', message.baseRevisionId],
        ['Proposal revision', content.proposalRevisionId], ['Proposal name', content.proposalName]].map(([label, text]) =>
        <Fragment key={label}><dt>{label}</dt><dd>{text}</dd></Fragment>)}
      {!!review?.evidenceUses?.length && <><dt>Source assumptions</dt><dd><details data-detail-key={`evidence:${message.id}`}>
        <summary>Evidence choices for this proposal · {review.evidenceUses.length}</summary>
        <p>These are design assumptions for your review. Conflicting source history remains unchanged.</p>
        {review.evidenceUses.map((use, index) => <Fragment key={index}><p>{use.rationale}</p>
          <small>{use.subject.anchor.entityId} · {use.subject.property.definitionId} · {use.pin.entryId} · SHA-256 {use.pin.hash}</small></Fragment>)}
      </details></dd></>}
    </dl>
  </details>;
  return <section className="request-chat-proposal">
    <header className="request-chat-proposal-heading"><h4>Proposal</h4>{review && <span className="request-chat-review-status">{review.status}</span>}</header>
    <p className="request-chat-outcome">{review?.summary ?? content.text}</p>
    {review ? <>
      <p className="request-chat-target">Target: {targetLabel}</p>
      {!!review.uncertainty.trim() && <p className="request-chat-assumption">Assumptions: {review.uncertainty}</p>}
      <div className="ticket-actions">
        <Control {...props} focusKey="delta" pressed={review.delta} onClick={() => actions.showDelta(message)}>{review.delta ? 'Hide changes' : 'View changes'}</Control>
        {decisions.filter(([action]) => canDecideProposal({ message, review, action, disabled: false, offline: false })).map(([action, label]) =>
          <Control {...props} key={action} focusKey={action} primary={action === 'accept'} onClick={() => actions.decide(message, action)}>{label}</Control>)}
      </div><p className="chat-turn-count">Only explicit acceptance applies changes.</p>
    </> : <Control {...props} focusKey="inspect-proposal" onClick={() => actions.proposal(message)}>Inspect proposal</Control>}
    {technical}
  </section>;
}

function MessageContent(props: MessageProps) {
  const { message, view, actions } = props;
  if (message.kind === 'user') return <>
    <p>{message.text}</p><SourceContext projectId={view.projectId} message={message} />
    {!!message.evidencePins?.length && <details data-detail-key={`evidence-pins:${message.id}`}>
      <summary>Bound evidence records · {message.evidencePins.length}</summary>
      {message.evidencePins.map(pin => <p key={pin.entryId}>{pin.entryId} · SHA-256 {pin.hash}</p>)}
    </details>}
    {message.visual && <VisualEvidence {...props} visual={message.visual} />}
  </>;
  if (message.kind === 'assistant' && message.content.kind === 'proposal') return <ProposalCard {...props} message={message} />;
  return <>
    {message.kind === 'decision' ? <p>Recorded: {message.action}.</p> : message.content.kind === 'clarification' ? <>
      <p>{message.content.question}</p><div className="ticket-actions">{message.content.options.map(option =>
        <Control {...props} key={option} focusKey={option} onClick={() => actions.answer(option)}>{option}</Control>)}</div>
    </> : <p>{message.content.text}</p>}
    <details className="request-chat-technical" data-detail-key={`message:${message.id}`}>
      <summary>Message details</summary><p>#{message.sequence} · {new Date(message.at).toLocaleString()}</p>
      <p>Message {message.id} · Request {message.requestId} · Base revision {message.baseRevisionId}</p>
      {message.kind === 'decision' && <p>Decision {message.decisionId}</p>}
    </details>
  </>;
}

function MessageCard(props: MessageProps & { activity: readonly RequestActivity[] }) {
  const { message } = props;
  return <MessagePrimitive.Root asChild><li className={`request-chat-message request-chat-${message.kind}`} data-message-id={message.id}>
    <header className="request-chat-message-heading"><strong>{message.kind === 'user' ? 'You' : message.kind === 'assistant' ? 'Assistant' : 'Review decision'}</strong>
      <time dateTime={new Date(message.at).toISOString()} title={new Date(message.at).toLocaleString()}>{new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </header><MessageContent {...props} />
    {message.kind === 'user' && <Activity message={message} activity={props.activity} />}
  </li></MessagePrimitive.Root>;
}

function RequestChatView({ view, actions }: { view: ChatView; actions: RequestChatRenderActions }) {
  const messages = view.conversation?.messages ?? noMessages;
  const runtime = useExternalStoreRuntime({ messages, convertMessage, isRunning: !!view.conversation && (view.requestState === 'working' || view.requestState === 'queued'),
    isDisabled: view.disabled || view.offline, isSendDisabled: true, onNew: sendThroughExistingComposer });
  const activity = view.conversation ? groupTurnActivity(view.conversation, view.activity) : new Map<string, readonly RequestActivity[]>();
  const latestUser = messages.findLast(message => message.kind === 'user');
  const byId = new Map(messages.map(message => [message.id, message]));
  return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root asChild>
    <section id="request-chat" className="request-chat" aria-label="Request conversation" data-chat-framework="assistant-ui">
      {view.conversation ? <>
        <header><h3 title={view.title}>Chat</h3><span className="pill">{view.state}</span>
          <span className="chat-turn-count">{messages.filter(message => message.kind === 'user').length}/{CONVERSATION_LIMITS.userTurns} turns</span></header>
        <ol id="request-chat-transcript" className="request-chat-transcript"><ThreadPrimitive.Messages>{({ message }) => {
          const source = byId.get(message.id);
          return source ? <MessageCard key={source.id} message={source} view={view} actions={actions} activity={activity.get(source.requestId) ?? []} /> : null;
        }}</ThreadPrimitive.Messages></ol>
        <Status view={view} activity={latestUser ? activity.get(latestUser.requestId) ?? [] : []} />
      </> : <><div className="chat-welcome"><span className="chat-welcome-mark">✦</span><h3>What would you like to change?</h3>
        <p>Describe an idea, paste a plan, or reference an item in the model. Your AI will prepare a proposal to review.</p></div>
        {view.offline && <Status view={view} activity={[]} />}</>}
    </section>
  </ThreadPrimitive.Root></AssistantRuntimeProvider>;
}

/** A durable sequence mounts atomically; runtime adapter effects must not defer new history past host anchoring. */
export function renderRequestChat(root: Root, view: ChatView, actions: RequestChatRenderActions): void {
  const snapshotKey = view.conversation ? `${view.projectId}:${view.conversation.ticketId}:${view.conversation.sequence}` : 'new';
  flushSync(() => root.render(<RequestChatView key={snapshotKey} view={view} actions={actions} />));
}
