# Project evidence panel (#211, parent #197)

Baseline `40b207c`; branch `feature/issue-211-evidence-ui`.
Depends on #199's authoritative `src/model-evidence.ts`, including required
`anchor.target` (DesignTarget) and read-set `target` (WritableDesignTarget).
Do not copy older evidence types into this client.

## Frozen parent routes

- GET `/api/projects/:id/project-sources?after=<uuid>` returns
  `{sources: RequestSource[], next: string|null}` (20 metadata records).
- POST the same path with `{source: RequestSource}` returns `{source}`.
- GET `/api/projects/:id/evidence?after=<integer>` returns
  `{entries: {entry: EvidenceEntry, pin: EvidencePin}[], next: number|null}` (20).
- POST the same path with `{commandId, entry}` returns `{pin}`.
- Existing private POST `/api/projects/:id/sources/:uuid` uploads bytes using
  Content-Type and encoded X-Source-Name headers; GET authorizes downloads.

## Parent wiring contract

`new ProjectEvidencePanel(mount, {useSources, useEvidence, selectEntity?})`.
Chat callbacks receive `(selection, context|null, signal)` with complete chosen
descriptor/pin arrays for the existing composer (`sources` and `evidencePins`).
They receive empty arrays when binding changes. Honor the abort signal after
asynchronous work; an aborted binding must not replace the new composer's context.
`selectEntity(anchor)` receives the exact immutable anchor, including its target.
The parent remains responsible for request submission, target applicability,
read-set freezing, review and acceptance. Callbacks may return promises; the panel
disables the relevant action until they settle and reports rejection.

`await panel.show(context)` / `await panel.bind(context)` loads the first pages.
`panel.update(context)` updates parent display context; binding changes reload.
`refresh()` clears chosen context and reloads project history.
Context: `{projectId, target, revisionId, selectedObject: {id,name}|null,
entityName?: (id: string) => string|undefined}`. Target comes from EvidenceEntry's
anchor type. `bind(null)` clears and aborts work. `dispose()` releases the mount.
`selectedSourceDescriptors` / `selectedEvidencePins` expose chosen chat context.
No viewer, model repository, accepted-state cache, global resolution or fact
editing is owned here. Append commands are available on the separate client.

The parent owns actual mounts, styles, server and combined browser qualification.
Panel lists project history without selection filtering. Names supplied by
`entityName` describe the current display, not historical identity. Every record
shows immutable anchor IDs, target, revision/body hash, provenance, citations,
correction/basis/resolution references. Loaded-page links do not imply complete
history or current truth. File links use only private same-origin project/UUID
routes; claim locators remain text. File addition uploads first, then requires
an explicit Retain action; retries reuse the uploaded descriptor.

Optional parent CSS (reuse existing source/card/button styles):

```css
.project-evidence-panel { min-width: 0; overflow-wrap: anywhere; }
.project-evidence-panel .source-item { flex-wrap: wrap; }
.project-evidence-panel .source-copy { min-width: 0; flex: 1 1 14rem; }
.project-evidence-panel .source-actions { flex-wrap: wrap; gap: .5rem; }
.project-evidence-panel button { min-height: 44px; }
```

## Plan and qualification ledger

Own new client/panel, their behavior tests, this note, and minimal shared upload
helper extraction in `demo/request-source-ui.ts`. Validate bounded codecs,
metadata paging, hostile links/text, upload/retain separation, stale binding,
keyboard controls, errors/retry and callback selection. No model delta.

Ten total qualification attempts including setup authorized for this item.
Only `/ssd1/bim-forge-qualification/residential197/evidence-ui211-aN`, unique
container, image `bim-qvm-tools:20261025`, 1 CPU/2 GiB, network none, read-only
source/dependencies at `all-ready-195/final/dependencies`. No local tests/builds
or installs. Root validation requires current parent integration; no suppressions.

| Attempt | Result |
| --- | --- |
| 1 | Setup failed: dependency symlink at /dependencies broke Node sibling resolution. No tests ran. Browser checks remain parent-owned. |
| 2 | Lint passed (259 files); typecheck could not start for the same mount cause. Correct next slot to mount dependencies directly at /work/node_modules. |
| 3 | Lint passed; root typecheck blocked in parent change-requests.ts (branded target, readonly pins, pending ProposalReview.evidenceUses). No owned-file diagnostics. Focused tests not run. |
| 4 | Scoped policy 6 files passed; tests 17/19 passed. One DOM subtest expected different wording for the existing four-file guard (plus wrapper failure). Correct assertion; retain guard. |
| 5 | Scoped policy 6 files; all 20 focused tests passed, including browser bundling. Root WIP failures remain recorded in attempt 3. |
