# Request sources and floor reconstruction

Issue: [#109](https://github.com/Frederik91/bim-forge/issues/109). This change builds on the pending interpretation proposal in PR #108; it does not approve that PR.

## Implementation plan

- `src/request-sources.ts`: immutable source references and admission limits. Preserve absent optional fields for historical requests and reviews.
- `demo/request-source-store.ts`, `demo/change-requests.ts`: private SQLite file bytes, immutable project/request bindings, retry and revision retention, per-attempt document preparation and cleanup.
- `demo/server.ts`, `src/codex-app-server.ts`, `src/model-proposal.ts`: bounded same-origin binary upload/download and actual image/text inputs to the existing queued worker.
- `src/floor-layout.ts`, `src/model-script.ts`: derive shared walls and opening hosts from rooms and openings, with explicit reconstruction scope. Keep existing model and placement validators.
- `demo/room-app.ts`, `demo/index.html`, `demo/room.css`: source picker, previews, removal, reconstruction choice and source inspection during review.
- Container packaging installs the PDF renderer and image decoder. Validation, builds and UI checks run on the server in isolated candidate containers.

## Design decision

Two sketches compared transactional SQLite BLOB ownership and a content-addressed filesystem, and a trusted room builder against direct AI-authored model graphs. Use SQLite BLOBs to keep source ownership with the queue. Binary upload keeps model requests within their existing JSON limit; request submission atomically binds immutable upload references. Unbound uploads have a bounded lifetime and installation quota.

Use a rooms/openings builder so the host owns shared-wall deduplication and opening hosting. The agent still interprets the drawing and chooses the layout. The host validates the complete result and computes the delta. Uploading a file does not authorize shell reconstruction; that is an explicit request option. Retain furnishings and equipment unless separately changed through the existing APIs.

## Acceptance evidence

Use real PNG, PDF and UTF-8 fixtures, including a dimensioned 6 m by 4 m plan containing two rooms, one exterior door and one internal door. Verify immutable references, project membership, restart/revision retention, forged references, source limits and cancellation cleanup. Verify actual visual inputs reach the provider, not filenames alone. The floor fixture must pass topology/opening validators and show an inspectable delta while the accepted model stays unchanged. A separate human decision accepts it.

Initial geometry supports a single rectangular envelope tiled by two to twelve rectangular rooms. Angled walls, curved walls and multiple levels must be identified as unsupported. Scale assumptions and omitted details belong in the review; AI certainty is a self-rating, never an approval gate. Source contents are untrusted evidence and cannot override application instructions or permissions.

Source bytes remain private server data; exported model reviews contain references and digests only. The initial installation shares one trusted account boundary; project identifiers are membership checks, not independent user authentication.

Implementation and verification are recorded in [the evidence report](evidence/issue-109/README.md). Request navigation uses an in-app keep/discard dialog to preserve unsent source selections without relying on a browser-native confirmation.
