# Persistent request conversations

Issue #181, with backend #182 and browser #183. The integration starts at `1643595c193f408f9840f1544c732b481390a158`, the model scope work in PR #180.

## Plan and ownership

`src/request-conversation.ts` defines the shared TypeBox schemas. Backend work owns `demo/change-requests.ts`, `demo/server.ts`, `src/model-proposal.ts`, `src/model-script.ts`, and their tests. Browser work owns the conversation component, API client, annotation evidence, and minimal hooks in `demo/room-app.ts`. The coordinator owns package wiring, disposable integration fixtures, and combined evidence.

The model-first layout session owns the application frame. It supplies `#request-chat-mount` inside `#editor-panel`; the conversation component supplies inner `#request-chat`. The existing composer and single model canvas remain shared. No other static mount is required.

## Wire contract

Contract commit `ef7a500` introduces `ConversationReply`, `ConversationVisual`, `ConversationMessage`, and `RequestConversation`. The ticket response includes `conversation`. A reply posts to `/api/change-requests/:id/messages` and returns `202 {ticket}`.

Each reply supplies `messageId`, `expectedSequence`, `baseRevisionId`, `text`, immutable `sources`, and optional `visual`. Visual evidence names its accepted or proposed snapshot, view mode, level, selected stable entity IDs, and pin or arrow coordinates in model metres. Evidence grants no model write authority. The backend validates snapshot identity before using evidence.

User messages, assistant messages, and decisions have separate schemas. Assistant content distinguishes a clarification question with answer options, a proposal with an immutable revision binding, and an explanation. A user reply continues the ticket and never approves a proposal.

The transcript has explicit limits of 48 messages, 20 user turns, and 1,000 characters per message. Source references across the conversation are limited to four files and 12 MiB. Exceeding a limit produces an error; earlier evidence must not be silently removed.

## Acceptance evidence

Root validation and changed-path policy checks run in an isolated server container. Focused tests cover persistence, replay, stale sequence refusal, cancellation, late results, restart recovery, clarification through ScriptBox, earlier proposal retention, and explicit review. Existing request, source, scope, and versioned project tests remain enabled.

A disposable fixture uses a deterministic worker with the real ScriptBox executor and model validators. Browser proof covers a follow-up question, a reply with a file and snapshot-bound visual evidence, a continuation proposal, explicit review, reload, and desktop and phone layouts. The fixture uses fresh project data and never reads live preview state.

Builds and tests use SSH to `frederik@192.168.1.17`, cached image `bim-qvm-tools:20261025`, immutable Git bundle source, a unique `/ssd1/bim-forge-qualification/181-<sha>` directory, at most 0.5 CPU, 1 GiB memory, and no swap. Publication remains a draft stacked on PR #180. Human review is required for persistence and model behavior.

Completed results and the inspectable model delta are recorded in [Request conversation qualification](../evidence/request-conversations-181.md).
