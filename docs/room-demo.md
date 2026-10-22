# Request and review a room model change

This disposable demo turns a visual gesture and written request into input for a model-working AI. The human sketch is never committed directly. The AI can inspect the request's exact base revision, use a bounded rectangular-room tool, and either return a validated separate proposal or explain why it cannot.

## Start the model-backed server

Use Node.js 24 or newer. Start the local server without an API key:

```sh
node demo/server.mjs
```

Open `http://127.0.0.1:4173`, choose **Connect ChatGPT**, and complete consent in the browser. Eligible accounts can use their ChatGPT plan for proposals through the official [Sign in with ChatGPT open-source flow](https://developers.openai.com/siwc/token-sharing-open-source). The local server performs OAuth with PKCE, validates the OpenAI ID token, stores rotating credentials outside the browser and project, discovers account-visible models, and sends stateless streaming Responses requests. No API key or client secret is used.

The current restricted static preview cannot run this flow because sign-in requires a loopback callback and protected local credential storage. Never place OAuth tokens in static assets, browser storage, project JSON, logs or exported evidence.

## Request, review and revise

1. Create a project or load the sample in the opening dialog. The main navigation then leads through **Request**, **Review** and **History** instead of exposing every control at once.
2. On **Request**, select a stable wall or door identity in the plan. On narrow screens, **Mark up model** and **Describe request** are separate substeps rather than one long page. The preserved original is available in its own dialog.
3. Drag a handle or enter dimensions to sketch the intended move or size. The sketch is visual intent, like markup with an arrow; it is not authoritative model geometry.
4. Describe the desired outcome and choose a new proposal name.
5. Connect an eligible ChatGPT plan, choose an available model, then choose **Prepare proposal**. The request includes the exact base revision, selected object identity, written instruction and visual layout intent.
6. The model-working AI can inspect the bound snapshot, try complete rectangular layouts through the validator, and submit only its latest valid preview. It can also decline when the bounded tools cannot safely represent the request.
7. On **Review**, inspect what changed, why, proposal-specific constraints, uncertainty, the request identity, base revision and selected objects. Open the detailed model-delta dialog when field-level evidence is useful.
8. Choose **Accept this version** to advance the current model pointer to the proposal revision. The original revision and proposal branch remain available. Choose **Request a revision** to start another request from the selected proposal; use a new proposal name so the earlier proposal stays unchanged.

Escape cancels an active drag and restores the pre-drag request sketch. Invalid dimensions retain the last valid sketch and block submission. Wall height and thickness, door height and hosting remain unchanged by the bounded tool. Shortening a wall never silently shrinks or repositions the door.

## Model-working AI seam

The proposal module presents four strict tools:

- `inspect_model` reads the exact bound revision and selected identities.
- `preview_rectangle` applies a complete millimetre layout to an immutable copy and runs deterministic model validation.
- `submit_proposal` records the last valid preview as a separate revision with a plain-language summary, rationale, constraints and uncertainty.
- `decline_request` ends without changing model history.

The model cannot send arbitrary snapshots, choose a different base revision, alter stable identifiers, bypass hosting checks or write browser storage. A twelve-call tool budget, eight-turn provider budget, 30-second timeout per provider request and 256 KiB provider-response ceiling bound each request. The ChatGPT plan route does not support a client-set output-token ceiling. Provider response identities and reported token usage are recorded with the proposal. The application persists only a validated returned repository, using the existing compare-and-swap browser save.

## Storage and evidence

The demo saves one project in browser IndexedDB. Saving checks the expected generation and replaces the complete project atomically, so a stale tab cannot overwrite a newer save. Invalid or damaged saved data is not silently overwritten. Import remains limited to 256 KiB of encoded JSON, 32 revisions, 32 branches and 100 entities per snapshot; revision hashes and ancestry are rechecked.

Each AI proposal persists its request binding, summary, rationale, constraints, uncertainty, worker identity, provider response identities and token usage, bounded tool evidence, validator identity and human decision. These review records are included in export and restored after reload. ChatGPT account credentials are held separately in protected local server storage and are not exported. Shared project storage and multi-user authorization remain future work.

When configured, request text and the bounded room snapshot are sent to the selected OpenAI model. This demo must not be used with production, confidential or regulated model data.

## What the model represents

Dimensions use metres on a 1 mm grid. The fixture is 6 m by 4 m, with four connected axis-aligned walls and one hosted entry door. Each revision contains a full immutable snapshot and its parent's identity. The original root remains addressable after an accepted proposal advances `main`.

Comparisons include added, removed and modified entities and relationships. Conflict inspection conservatively flags different changes to the same whole object. It does not merge proposals, resolve fields automatically or certify combined geometry.

## Boundaries

This is the bounded issue #40 flow built from the useful model, validation, comparison and visual-request parts of the preserved experiment. The experiment's failed touch-drag assertion is not treated as passed; physical touch, pointer cancellation and cross-browser behavior remain unqualified.

The demo does not parse or export IFC, render 3D solids, perform building-code or clash checks, edit production BIM files, authenticate BIM Forge users, or implement shared durable storage. The ChatGPT connection authorizes model-plan usage only; it is not project authorization. Schematic fit validation is not construction approval. The source remains an unapproved draft for human change review and is separate from factory readiness.
