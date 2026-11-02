# Minimal spatial chat (#303)

The chat card previously repeated task navigation, usage explanations, account
details, advanced settings and a reconstruction prompt around the conversation.
Its persistent controls now consist of the title, compact New task/options/close
controls, the conversation and message composer. The shared move control remains
owned by #302. Secondary actions retain their existing identities and handlers in
a native top-layer options popup, so the popup escapes short-card clipping.

Chats, Personal assistant, Return to task, expansion, deletion, context refresh,
request settings and connection settings remain accessible. Scope and layout
permissions have a visible conditional indicator when enabled. A context warning
retains its full explanation in a disclosure; offline/failure explanations and
proposal assumptions remain available. Icon controls retain explicit accessible
names, tooltips, keyboard focus and 44 px targets. Escape dismisses disclosures
without closing the card or returning focus to a hidden control.

Reconstruction is a deliberate action in the existing composer `+` menu, rather
than a button in every message field. It still requires the original explicit
permission, source-bound dimension confirmation, proposal validation and human
acceptance. The persistent connected-account/help text and duplicate Accepted
status block were removed from the visual path. The actual accepted decision
remains in the saved conversation.

## Qualification

All app/fixture servers ran on the Linux VM in a disposable isolated checkout:
`/var/lib/bim-forge/previews/checks/minimal-chat-303`. No live preview or user's
project was modified by this worktree. App source qualified at
`9ebd3f24debc974c2e3d7a17740307b6954faf05`:

- `npm run validate`: strict TypeScript 396 source files, typecheck and policy pass.
- `npm run build:demo`: pass.
- `demo/minimal-chat-browser.test.ts`: 1/1 pass, 31.4 s. Quiet defaults, accessible
  options/history with retained draft, explicit reconstruction/cancel and active
  permission indicator, actual assigned task actions, truthful rendered request
  attributes, 390/320 × 600 pointer hits, Escape/focus retention, one canvas and
  zero browser errors.
- `demo/floor-plan-guide-browser.test.ts`: 1/1 pass, 86.7 s. Source PNG/PDF pixels,
  known dimension confirmation, unsent reload, explicit Main acceptance, As-is
  baseline, alternative-only exact partition delta and SQLite restart.
- `demo/canvas-studio-browser.test.ts`: 3/3 pass, 33.7 s. Offline retained-control
  fencing, Sources & checks → Revise with focused retained draft, pointer-exposed
  explicit acceptance, exact door-only delta and persistent single viewer.

The first run's floor test correctly reached acceptance HTTP 200, then waited for
the intentionally removed duplicate status block. Its oracle now checks the
rendered authoritative `completed` state and actual Accepted decision, retaining
all geometry/delta assertions. Batched screenshot review also exposed Escape
closing the whole card when the popup invoker retained focus; local Escape
handling and direct card-visible/focus assertions fixed that defect. Final
desktop and 320 px screenshots were inspected.

Retained external artifacts: `/var/lib/bim-forge/previews/ops/minimal-chat-303-artifacts/`;
Windows evidence receipts under `%LOCALAPPDATA%/BIMForge/minimal-chat-303-evidence/`.
These are deterministic fixture checks, not live provider-accuracy claims.

## Model delta and review

Construction/model delta: **none**. No backend, storage, schema, geometry,
permissions or validators changed. Source/permission/review enforcement stays
with its existing owners. The standalone draft is based on the current combined
preview `06a2982`; protected main and the running preview are not changed here.
