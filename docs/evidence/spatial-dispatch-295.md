# Personal assistant and spatial task dispatch (#295)

## Interaction

The personal assistant stays available in the viewport while submitted task agents remain at fixed places in the building. Sending a new instruction assigns an independent agent, then returns to a clean personal composer. Open a saved agent or its chat explicitly to follow up; **Personal assistant** returns to the private draft without replacing that task conversation.

Unsent drafts remain private entries in Chats. They do not create figures or Tasks entries. New task dispatch freezes the current reference point: marked region first, explicit native reference next, current Inside eye or Plan centre otherwise. An unreferenced Overview request stays unplaced. Hosted objects and wall tasks use a small offset toward the user beyond their wall face so their figures do not start inside the wall. Saved origins and target associations are never moved by later navigation or reference changes.

This uses the existing task backend and model worker. It does not add another LLM coordinator service, voice support or autonomous cross-agent negotiation. Saved proposals still need explicit human acceptance.

## Scope and model delta

`room-app.ts` owns assignment/return orchestration and per-project personal draft selection. `task-dispatch.ts` calculates the point from validated native geometry or captured markup. `model-viewer.ts` exposes a clear no-reference choice. The test commands include the new deterministic and browser cases.

No geometry, persistence schema, validators, permissions or accepted model data are changed by this UI feature. The normal request protocol persists each independently submitted task with its own immutable placement and context.

## Evidence

All app and fixture servers run on the Linux VM as `bimforge`; Windows is only the code/SSH/browser client. Isolated qualification clone: `/var/lib/bim-forge/previews/checks/dispatch295-b6ec869`.

At `bdbb8c1afb9d8cb32bb0c8e744983f53ea68f747`:

```text
Strict TypeScript valid. 388 source file(s) checked.
tsc --noEmit: passed
Policy valid. 0 changed file(s) checked.
task-dispatch.test.ts: 4 passed, 0 failed
build:demo: passed
spatial-dispatch-browser.test.ts: 1 passed, 0 failed (30.2 seconds)
```

The actual browser workflow holds the first door worker open after its real model script, moves to another room and draws a rectangle, dispatches a second agent bound to that region, then dispatches a third unreferenced task at the current eye. It proves independent task identities, original point retention, no phantom unsent figures, personal/task draft restoration, eye/facing and selection continuity on return, no page errors, and identical accepted project bytes before/after.

Final runtime source `5c3d5bc8f3203052374d196752a16c0091ac3d89` passes the same validation/build and four point tests, plus the expanded browser case (1/1, 37.2 seconds). It holds a real upload open while switching to a task, completes it there, then proves the file returns only with the personal draft. The final wall task asserts its selected object ID, faces its saved position, and opens that exact task by clicking the actual 3D body. The accepted project bytes remain unchanged.

## Diagnosed transition failure

The first expanded wall-visibility check failed because its supposed wall task was actually unreferenced: the test changed the 3D picker immediately after asynchronous New task activation. The picker appeared enabled while foreground work was busy, and the application ignored that selection. Dispatch correctly used the fallback eye.

A temporary read-only scene probe confirmed the supposed wall figure at Babylon `[6,1.84,3]`, corresponding to the user's eye plus the normal display offset, with facing `-0.259`, projected Y `1959`, and no construction occluder. Camera position was `[6,1.6,3]`, facing east/down. This proved an ignored reference/transition, not a hidden figure at the wall.

The 3D object picker now follows the existing inspector picker's disabled state during foreground transitions. Server agents working in the background do not disable selection, Walk, mouse-look or markup. The browser test waits for the editable personal mode, asserts the actual saved wall target, and retains its original visibility and physical ray-pick assertions. User approval authorized continued focused repairs after the repository's initial three-attempt stop.

The diagnostic module and app injection were removed before final qualification. The only later test cleanup removes a null-only diagnostic accessor; application runtime source and all acceptance assertions are unchanged.

The existing task-controller and markup replay browser tests now explicitly open the dispatched agent before asserting its transcript and reference overlays. Their assertions are retained; these adaptations reflect the intentional personal-assistant default.

Raw logs, a run ledger and screenshots are retained under `BIMForge/dispatch-295-evidence` in the client's Local AppData. No preview service or existing project data was changed by this standalone qualification.
