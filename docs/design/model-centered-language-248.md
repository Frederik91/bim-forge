# Model-centered design language

Issue: https://github.com/Frederik91/bim-forge/issues/248

## Plan

1. Inspect current Canvas Studio and visual evidence at bc7fbd3.
2. Record the confirmed product brief in PRODUCT.md.
3. Compare distinct workspace concepts using the same synthetic model, selected door, conversation and proposed door-width change.
4. Inspect desktop and narrow renders, model visibility, state labeling and keyboard controls.
5. Present concepts and tradeoffs for a maintainer direction choice. No production UI replacement or final DESIGN.md before that choice.

## Maintainer direction correction

The maintainer rejected the side-panel recommendation: the conversation should belong to a selected object or area in the 3D model. Clicking there starts typing, or speech in a future voice mode. Spatial markers retain conversations and indicate agent work in that area; a secondary list retrieves conversations and returns to their location. The initial three static concepts are superseded as candidate defaults, not adopted.

The subsequent confirmed direction is recorded in the canonical [product vision](../product-vision.md#a-multiplayer-building-workspace): concurrent task conversations assign agents in places, permitted people and agents coordinate overlapping dependencies, and conversation visibility includes personal, discipline, and company audiences. Personal work reveals no presence to other participants. Detailed privacy design remains open. The maintainer is discussing the interaction verbally while away from a computer; visual review is deferred.

## UX walkthrough for the confirmed vision

The next study follows one continuous work session, rather than separate dashboard, chat, and review pages:

1. Enter a room at a saved working location. Show the current room and view with a nearby route to Plan, Section, and Overview.
2. Look toward the entry door and select it. Confirm the selected object in place without forcing a camera move or opening a permanent assistant panel.
3. Start a task conversation at the door. Make its audience and agent recipient readable before sending. Retain the existing personal, discipline, and company visibility choices without inventing a default.
4. Express an intent in text, or use an explicitly activated voice control in a future supported voice implementation. Show whether the recipient is an agent or a person.
5. Move elsewhere while the agent works. Leave an appropriately scoped task marker at the door. Hide personal task presence from other participants.
6. Encounter permitted activity on the adjoining wall. Let the person identify the task and contact its owner through built-in text or voice communication without looking up external contact details.
7. Represent an overlap between the door and wall tasks. Explain their shared dependency and the decision needed. Any simulated agent exchange is labeled illustrative.
8. Open Plan or Section to inspect the relationship. Preserve selection, task, and a location reference. Returning Inside restores the prior position and orientation.
9. Return to the door task through its marker or the secondary task list. Show the proposed geometry against the existing geometry while retaining spatial context.
10. In the intended product, revise or explicitly accept through the existing governed proposal boundary. The current study ends at an illustrative width preview and conversation; it does not implement acceptance or make a saved model change.

## Interaction decisions to test

- How much anchored conversation can be read while leaving the object and room legible? What happens when its anchor leaves the view?
- How are overlapping markers grouped without hiding task status, ownership, or required decisions?
- How does Inside navigation preserve orientation through a jump, plan switch, section cut, and return?
- How does a person distinguish speaking to an engineer, speaking in a shared channel, and instructing an agent before activating voice?
- How do users see a conversation's audience and intentionally change it? Detailed privacy defaults and authorization design remain open.

## Acceptance evidence for the next study

Use the same door and adjoining-wall example throughout. Inspect an Inside view, a plan or section transition, an anchored task, a permitted teammate activity cue, a secondary task-list return, and an in-context proposal review. Demonstrate text interaction; label voice, multiplayer presence, agent coordination, and privacy behavior as simulated wherever they are not implemented. Include keyboard access and a narrow viewport. Do not treat the initial orbit-only study as proof of this experience.

## Current evidence and remaining work

### Deferred speech-and-gesture interaction

[Planning issue #250](https://github.com/Frederik91/bim-forge/issues/250) records a future instruction that combines time-aligned speech, pointing, selection, and progressive drawing. The example is two objects and two arrows while the person says "this one this way, then this one this way." The agent should recover the correct object and gesture for each phrase, including when speech slightly precedes or follows a stroke.

A later study must explore capture, replay and correction of those associations, camera changes, ambiguous references, and the intended mouse, touch, and VR inputs. Detailed timing, transcription, capture, storage, and privacy decisions remain open. The maintainer explicitly deferred implementation on 2026-10-31. Do not add it to this study's runtime or treat it as an acceptance requirement for the current review.

### Current study

- Confirmed product vision and design context are recorded. No privacy enforcement or multiplayer implementation is claimed.
- The initial three static concepts were rendered on a local comparison page but are superseded by the maintainer's spatial direction.
- The isolated study now uses typed source and generates its browser bundle under ignored `dist/`. The initial JavaScript source-check failure is retained as attempt history; no validator was changed.
- Browser inspection used the built study at 1440 by 1000 and 390 by 844. Inside starts at eye height. Text entry did not move the camera. Plan and Section retained the task and text draft; returning Inside restored the same projected marker position. Task-list retrieval intentionally returned to the task. Simulated replies completed while switching between tasks. Keyboard movement and turning worked only with the model focused; offscreen markers hid and exposed a Return to task control. Browser warning and error logs were empty during these checks.
- An independent finish reviewer found that Plan clipping hid the wall footprint. Synthetic cut caps, a door swing, and a separate amber plan overlay corrected the study. The reviewer scored this material fix resolved and returned SHIP for study feedback. That disposition is not production or design-system approval.
- The narrow layout had no horizontal overflow. Its conversation was about 358 pixels high against a 730-pixel model stage. Nested scrolling still hides some history and composing or preview controls; this remains a known interaction limitation. Only two fixed tasks are modeled, so dense or multiple conversations at the same place remain unproven.
- No production UI, accepted model, authorization, or deployment has changed. Human visual review, final design-system adoption, live providers, and production integration remain pending.

## Evidence

- [Desktop Inside conversation](spatial-conversation-248/desktop.png)
- [Narrow conversation and preview](spatial-conversation-248/mobile.png)
- [Validator output](spatial-conversation-248/validation.txt)

Additional Plan, Section and offscreen captures were reviewed locally under `.impeccable/review/`. The interaction study runs separately using [its local build instructions](../../experiments/spatial-conversation-248/README.md).

## Provisional source tokens

These values describe the study, not an adopted visual system. The source uses Segoe UI with Arial and sans-serif fallbacks, a 14-pixel base, and mostly 13-pixel labels. Deep-blue chrome uses `#172f41`; the mineral background uses `#e9eef0`; selection and primary controls use `#234eaa`; amber status uses `#86500b`. Controls generally have 44-pixel minimum height and 6-pixel corners. The desktop conversation is 358 pixels wide; the narrow version is bounded to 49 percent of the stage with scrolling. Focus, text selection, caret, and scrollbars use the same palette. Final `DESIGN.md` and token authority are deliberately deferred until the maintainer reviews the spatial interaction and visual language.

## Direction contract

THESIS: Conversation belongs to a place in the model; selection opens local interaction rather than a separate assistant workspace.

OWN-WORLD: Provisional mineral canvas and deep-blue project chrome, high-contrast sans text, cobalt selection, amber proposed geometry and text-labeled work status. These are exploratory tokens, not an adopted design system.

STORY: Select a door or wall, type an intent at its spatial anchor, see illustrative agent activity there, then return through the marker or secondary conversation list.

FIRST VIEWPORT: Inside places the person at a synthetic room location at eye height. Compact controls expose Plan, Section, and Overview. A conversation appears at its selected object or region; a secondary list opens only on request. The built study and browser evidence now exercise this direction; it remains separate from production.

FORM: Maintainer-pinned spatial conversation direction supersedes the initial seven-candidate exploration; initial seed:222a739c27ec2966 is historical, not authority over the correction.

FINISH: This interaction study ends with built-browser evidence, the independent finish verdict, documented provisional tokens and limitations, and a human direction review. It does not adopt a visual world or create final design-system authority. Production implementation and its design-system finish gates remain future work.

## Scope

Development-only concept artifacts, product context and this brief. No geometry, model schemas, persistence, authorization or deployment changes. Model delta: zero. Voice and agent behavior in concepts are demonstrative, not live capabilities.

## Acceptance evidence

The built study has desktop and narrow evidence, persistent task context across views, an illustrative existing/proposed width distinction, and labeled keyboard-accessible controls. `npm run validate` and the explicit changed-file policy check must pass before draft PR publication. The spatial interaction direction is confirmed; human visual feedback and final system adoption remain pending.
