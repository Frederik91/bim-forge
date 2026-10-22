# Request and review a room model change

This disposable demo turns a visual gesture and written request into input for a model-working AI. The human sketch is never committed directly. The AI can inspect the request's exact base revision, use a bounded rectangular-room tool, and either return a validated separate proposal or explain why it cannot.

## Start the model-backed server

Use Node.js 24 or newer. The server requires an explicitly configured OpenAI API credential and model:

```sh
OPENAI_API_KEY=... OPENAI_MODEL=... node demo/server.mjs
```

Open `http://127.0.0.1:4173`. The credential is read only by the server and is never served to the browser. If either setting is absent, static inspection still works but proposal requests return a clear unavailable response. The integration follows the official [Responses API function-calling flow](https://developers.openai.com/api/docs/guides/function-calling): the model chooses among strict bounded tools, the application executes them, and validated tool outputs are returned to the model.

The current restricted static preview cannot run this flow because it has no authenticated model backend. Do not place an API key in the static assets.

## Request, review and revise

1. Create a project or load the sample.
2. Select a stable wall or door identity in the plan.
3. Drag a handle or enter dimensions to sketch the intended move or size. The sketch is visual intent, like markup with an arrow; it is not authoritative model geometry.
4. Describe the desired outcome and choose a new proposal name.
5. Choose **Ask AI to prepare proposal**. The request includes the exact base revision, selected object identity, written instruction and visual layout intent.
6. The model-working AI can inspect the bound snapshot, try complete rectangular layouts through the validator, and submit only its latest valid preview. It can also decline when the bounded tools cannot safely represent the request.
7. Review what changed, why, uncertainty, the request identity, base revision and selected objects.
8. Choose **Accept this version** to advance the current model pointer to the proposal revision. The original revision and proposal branch remain available. Choose **Request a revision** to start another request from the selected proposal; use a new proposal name so the earlier proposal stays unchanged.

Escape cancels an active drag and restores the pre-drag request sketch. Invalid dimensions retain the last valid sketch and block submission. Wall height and thickness, door height and hosting remain unchanged by the bounded tool. Shortening a wall never silently shrinks or repositions the door.

## Model-working AI seam

The proposal module presents four strict tools:

- `inspect_model` reads the exact bound revision and selected identities.
- `preview_rectangle` applies a complete millimetre layout to an immutable copy and runs deterministic model validation.
- `submit_proposal` records the last valid preview as a separate revision with a plain-language summary, rationale and uncertainty.
- `decline_request` ends without changing model history.

The model cannot send arbitrary snapshots, choose a different base revision, alter stable identifiers, bypass hosting checks or write browser storage. A twelve-call tool budget and an eight-turn provider budget bound each request. The application persists only a validated returned repository, using the existing compare-and-swap browser save.

## Storage and evidence

The demo saves one project in browser IndexedDB. Saving checks the expected generation and replaces the complete project atomically, so a stale tab cannot overwrite a newer save. Invalid or damaged saved data is not silently overwritten. Import remains limited to 256 KiB of encoded JSON, 32 revisions, 32 branches and 100 entities per snapshot; revision hashes and ancestry are rechecked.

AI review text is transient in this increment and is not included in export or restored after reload. Model revisions, branch ancestry, stable identities and deterministic deltas are persisted. Durable review records, shared storage, authentication and multi-user authorization remain future work.

When configured, request text and the bounded room snapshot are sent to the selected OpenAI model. This demo must not be used with production, confidential or regulated model data.

## What the model represents

Dimensions use metres on a 1 mm grid. The fixture is 6 m by 4 m, with four connected axis-aligned walls and one hosted entry door. Each revision contains a full immutable snapshot and its parent's identity. The original root remains addressable after an accepted proposal advances `main`.

Comparisons include added, removed and modified entities and relationships. Conflict inspection conservatively flags different changes to the same whole object. It does not merge proposals, resolve fields automatically or certify combined geometry.

## Boundaries

This is the bounded issue #40 flow built from the useful model, validation, comparison and visual-request parts of the preserved experiment. The experiment's failed touch-drag assertion is not treated as passed; physical touch, pointer cancellation and cross-browser behavior remain unqualified.

The demo does not parse or export IFC, render 3D solids, perform building-code or clash checks, edit production BIM files, authenticate users, persist review explanations, or implement shared durable storage. Schematic fit validation is not construction approval. The source remains an unapproved draft for human change review and is separate from factory readiness.
