import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowRight, Check, Eye, GitPullRequest, History, Layers, MessageSquare, PanelRightClose, Files, ListChecks } from 'lucide-react';
import { Button } from './ui/button.tsx';
import type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';

/** Render once before the application binds its command elements. Controllers own command state. */
export function mountCanvasStudioChrome(host: HTMLElement): void {
  document.body.classList.add('canvas-studio');
  const root = createRoot(host);
  flushSync(() => root.render(
    <nav className="canvas-rail" aria-label="Workspace tools">
      <Button id="workspace-navigation-toggle" type="button" variant="ghost" className="canvas-rail-button" aria-label="Model explorer" aria-controls="workspace-navigation" aria-expanded="false" title="Model explorer">
        <Layers aria-hidden="true" /><span data-rail-label>Model</span>
      </Button>
      <Button id="open-chat" type="button" variant="ghost" className="canvas-rail-button" aria-label="Assistant" aria-controls="workspace-context" title="Assistant">
        <MessageSquare aria-hidden="true" /><span data-rail-label>Assistant</span>
      </Button>
      <nav id="journey" className="journey canvas-journey" aria-label="Model change process">
        <Button id="nav-request" type="button" variant="ghost" className="canvas-rail-button canvas-request-command" aria-label="Change request" aria-pressed="true" title="Change request">
          <MessageSquare aria-hidden="true" /><span data-rail-label>Request</span>
        </Button>
        <Button id="nav-backlog" type="button" variant="ghost" className="canvas-rail-button" aria-label="Change requests" aria-controls="workspace-navigation" aria-pressed="false" disabled title="Change requests">
          <ListChecks aria-hidden="true" /><span data-rail-label>Requests</span>
        </Button>
        <Button id="nav-review" type="button" variant="ghost" className="canvas-rail-button" aria-label="Proposal review" aria-controls="workspace-context" aria-pressed="false" disabled title="Proposal review">
          <GitPullRequest aria-hidden="true" /><span data-rail-label>Review</span>
        </Button>
        <Button id="nav-history" type="button" variant="ghost" className="canvas-rail-button" aria-label="Model history" aria-controls="workspace-navigation" aria-pressed="false" disabled title="Model history">
          <History aria-hidden="true" /><span data-rail-label>History</span>
        </Button>
      </nav>
      <Button id="open-project-evidence" type="button" variant="ghost" className="canvas-rail-button" aria-label="Project evidence" aria-controls="workspace-navigation" disabled title="Project evidence">
        <Files aria-hidden="true" /><span data-rail-label>Evidence</span>
      </Button>
      <Button id="workspace-context-toggle" type="button" variant="ghost" className="canvas-rail-button canvas-rail-bottom" aria-label="Toggle assistant panel" aria-controls="workspace-context" aria-expanded="true" title="Toggle assistant panel">
        <PanelRightClose aria-hidden="true" /><span id="workspace-context-toggle-label" data-rail-label>Assistant</span>
      </Button>
    </nav>,
  ));
}

export interface ProposalTrayActions {
  inspect(messageId: string): void;
  delta(messageId: string): void;
  decision(action: RequestChatDecision, messageId: string): void;
}

function ProposalTray({ review, actions }: { review: RequestChatProposalReview; actions: ProposalTrayActions }) {
  return (
    <section className="canvas-proposal-tray" aria-label="Canvas proposal review" data-proposal-message={review.messageId}>
      <header>
        <span className="canvas-tray-kicker"><GitPullRequest aria-hidden="true" />Proposal · {review.targetLabel ?? 'Selected design'}</span>
        <span className="canvas-tray-status">{review.status}</span>
      </header>
      <h3>{review.summary}</h3>
      <div className="canvas-tray-actions">
        <Button type="button" variant="ghost" className="canvas-tray-inspect" onClick={() => actions.inspect(review.messageId)}>
          Sources & checks<ArrowRight aria-hidden="true" />
        </Button>
        <div>
          <Button type="button" variant="outline" aria-pressed={review.delta} onClick={() => actions.delta(review.messageId)}><Eye aria-hidden="true" />{review.delta ? 'Hide changes' : 'Show changes'}</Button>
          <Button type="button" variant="outline" disabled={!review.canRevise} onClick={() => actions.decision('revise', review.messageId)}>Revise</Button>
          <Button type="button" disabled={!review.canAccept} onClick={() => actions.decision('accept', review.messageId)}><Check aria-hidden="true" />Accept into {review.targetLabel ?? 'design'}</Button>
        </div>
      </div>
      <p className="canvas-tray-note">Only explicit acceptance applies changes.</p>
    </section>
  );
}

/** The same parent-validated review feeds chat and tray; this component owns no model state. */
export function mountProposalTray(host: HTMLElement, actions: ProposalTrayActions): { show(review: RequestChatProposalReview | null): void } {
  const root = createRoot(host);
  host.hidden = true;
  return {
    show(review) {
      host.hidden = review === null;
      flushSync(() => root.render(review ? <ProposalTray review={review} actions={actions} /> : null));
    },
  };
}
