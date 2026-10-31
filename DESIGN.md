# BIM Forge visual system

## Authority and purpose

Operate mode: one engineer keeps the building present, starts a spatial conversation, navigates elsewhere and returns to inspect an explicit proposal. Preserve the approved Inside-first reference, draft [#249](https://github.com/Frederik91/bim-forge/pull/249), commit `9f5802d3f3d428fd91d367fba71477a787b26ad1`. This is a baseline extraction, not a new visual direction or authority to merge the prototype.

`demo/ui/design-tokens.ts` is the machine-readable authority. `spatialTokenCss()` generates `--spatial-{group}-{kebab-name}` variables during the demo and gallery builds. Do not hand-maintain a second CSS, Plan or Babylon palette. CSS semantic aliases in `canvas-studio.css` preserve existing callers. React may import `spatialTokens`; renderers receive readonly `Pick<SpatialTokens['color'], ...>` and `SpatialTokens['drafting']` subsets from their integration owner.

## Palette and typography

| Intent | Token | Approved value |
| --- | --- | --- |
| Structural ink/header | `color.ink` | `#172f41` |
| Action | `color.primary` | `#234eaa` |
| Selected object/task | `color.selection` | `#325cc2` |
| Keyboard focus | `color.focus` | `#3463c3`, 3 px with 3 px offset |
| Secondary text | `color.muted` | `#506775` |
| Conversation/panels | `color.paper` | `#fcfdfd` |
| Model backdrop | `color.canvas` | `#e9eef0` |
| Drawing paper/ink | `color.drawingPaper`, `color.drawingInk` | `#eef0ed`, `#253b49` |
| Existing / proposed | `color.existing`, `color.proposed` | `#647b89`, `#9b5b12` |
| Needs input / failure / accepted | `color.warning`, `color.error`, `color.success` | `#704308`, `#a1322a`, `#23665f` |

Chrome and transcript use Segoe UI, Arial, sans-serif at 14 px / 1.45. Headings use 18 px with weight 650; gallery title 24 px. Drawing annotations use Arial, Helvetica, sans-serif, dimensions 13 px in screen space. Use tabular numerals for measurements and task references. Avoid loading a remote font. Secondary text remains readable on both mineral and panel surfaces.

## Spacing, targets and surfaces

Spacing: 4, 8, 12, 16, 24 and 32 px. Conversation controls and view actions have a 44 px minimum target. Controls use 6 px radii, groups 7 px, floating conversation panels 12 px. The panel shadow is `0 9px 32px #172f4133`; do not add a second decorative elevation layer. Keep the model as the dominant surface; conversation width starts at the approved 358 px. On narrow screens stack gallery evidence and keep text, state and actions reachable without horizontal scrolling. Existing production panel placement remains owned by the shell integration issue.

Focus uses an outline, distinct from selection. Disabled actions retain their accessible names and native disabled semantics, with explicit disabled foreground/background tokens. Native controls, selection, carets and scrollbars use the same palette. Respect reduced motion. Never make agent movement, glow or color the only status cue.

## Drafting language

| Role | `drafting` key | Screen-space width |
| --- | --- | --- |
| Fine detail / dimension / extension | `detail`, `dimension` | 1 px |
| Object outline | `outline` | 1.3 px |
| Existing comparison | `existing`, `existingDash` | 1.5 px, `5 4` dash |
| Selected or proposed outline | `selected` | 2 px |
| Cut and foreground edge | `cut` | 2.3 px |

Walls keep their actual thickness; doors keep their actual opening and swing; furniture uses its real footprint. Fine contours, dimension ticks, labels and scale cues supply drafting detail. Dimensions state units and datum (for example wall axes), use 13 px readable text and a 4 px paper halo. Renderer owners preserve screen-space line weights during zoom. Selection and proposal colors add emphasis; dashed existing lines, solid proposed outlines, identifiers and textual before/after dimensions also distinguish them. Never substitute the study's synthetic coordinates for real project geometry. The gallery specimen reads the validated three-storey native fixture; it is not a general IFC section renderer or a production Plan implementation.

## Conversation and task primitives

Reuse `demo/ui/button.tsx`. `SpatialPanel`, `TaskIdentity`, `StateLabel` and `WorkspaceNotice` in `demo/ui/spatial-primitives.tsx` cover repeated panel, reference, status and recovery patterns. Pair with `spatial-primitives.css` and the `.spatial-ui` scope. A `StateLabel` is presentation: the controller supplies its truthful server-derived text and visual tone. Do not infer execution from a displayed agent.

| Existing state | Presentation tone | Shared color intent |
| --- | --- | --- |
| queued | neutral | muted / soft |
| working | active | primary / selectionFill |
| needs-input | waiting | warning / warningFill |
| failed | error | error / errorFill |
| ready | ready | proposedText / proposedFill |
| completed (displayed as Accepted) | settled | success / successFill |
| rejected, cancelled | neutral | muted / soft |
| stale source | stale | warning / warningFill |

Status names do not introduce new storage states. Task identity is project + ticket, displayed with a stable reference and title. Two tasks at the same place remain separate and have a textual Selected cue. A hovering agent represents the durable conversation and its fixed origin; targets are separate highlighted model objects/regions. `agentBody`, `agentFace` and `agentEyes` provide material inputs; graphics and lifecycle belong to #263/#257. The task list remains the fallback for unplaced or offscreen tasks. No privacy selector appears before server enforcement exists. The first milestone is a confirmed single-engineer workflow.

## Review gallery

Run `npm run build:design-gallery` and serve `dist/design-system` locally. This isolated presentation gallery includes the validated native fixture, all existing worker/review states, stale/empty/loading/error, native disabled actions, editable retained draft, same-place textual task identity and keyboard-operable examples. It never calls a provider or submits/accepts a model change. Evidence and replay commands live in `docs/evidence/spatial-design-system-252.md`.
