# Project evidence panel (#211, parent #197)

Base `40b207c`; #199 owns `src/model-evidence.ts` and required anchor/read-set targets.

## Frozen parent routes

Under `/api/projects/:id`, metadata pages have at most 20 items:

- GET `/project-sources?after=<uuid>`: `{sources: RequestSource[], next: string|null}`.
- POST `/project-sources` with `{source: RequestSource}`: `{source}`.
- GET `/evidence?after=<integer>`: `{entries: {entry: EvidenceEntry, pin: EvidencePin}[], next: number|null}`.
- POST `/evidence` with `{commandId, entry}`: `{pin}`.
- Existing private POST `/sources/:uuid`: bytes, Content-Type and encoded
  X-Source-Name headers. GET authorizes downloads.

## Parent wiring contract

`new ProjectEvidencePanel(mount, {useSources, useEvidence, selectEntity?})`.
Chat callbacks receive `(selection, context|null, signal)` with chosen descriptor/
pin arrays (`sources`/`evidencePins`) ONLY after explicit Use actions. Empty Use is
an explicit user clear. Navigation, refresh, bind(null) and dispose never call
them: parent owns per-chat drafts. Honor signal after async work; aborted callbacks
must not replace the new chat's context.
`selectEntity(anchor)` receives the exact immutable anchor, including its target.
Parent owns submission, applicability, read-set freezing, review and acceptance.
Promise callbacks disable choices until settled; rejection stays visible.

`await panel.show(context)` / `await panel.bind(context)` loads the first pages.
`panel.update(context)` updates parent display context; binding changes reload.
`refresh()` resets panel choices and reloads history without altering chat drafts.
Context: `{projectId, bindingId?: string, target, revisionId, selectedObject: {id,name}|null,
entityName?: (id: string) => string|undefined}`. Target comes from EvidenceEntry's
anchor type. `bind(null)` clears and aborts work. `dispose()` releases the mount.
Pass currentChatKey as bindingId to abort old-chat callbacks at the same revision.
Selection-only updates preserve loading.
`selectedSourceDescriptors` / `selectedEvidencePins` expose chosen chat context.
No viewer, model cache, fact editing or automatic resolution. Client exposes append.

Parent owns mounts, styles, server and combined browser qualification. Project
history is unfiltered; `entityName` labels the current display. Records show exact
anchors, target, revision/body hash, provenance, citations and correction/basis/
resolution references. Loaded-page links imply neither completeness nor current
truth. Downloads use private same-origin project/UUID routes; locators stay text.
Upload precedes explicit Retain; retention retries reuse the uploaded descriptor.

Parent CSS snippet:

```css
.project-evidence-panel { min-width: 0; overflow-wrap: anywhere; }
.project-evidence-panel .source-item { flex-wrap: wrap; }
.project-evidence-panel .source-copy { min-width: 0; flex: 1 1 14rem; }
.project-evidence-panel .source-actions { flex-wrap: wrap; gap: .5rem; }
.project-evidence-panel button { min-height: 44px; }
```

## Plan and qualification ledger

Own client/panel/tests, this note and shared upload helper in
`demo/request-source-ui.ts`. Check codecs, paging, hostile text/links,
upload/retain separation, stale bindings, errors/retry and callback selection.

Ten total qualification attempts including setup authorized for this item.
Only `/ssd1/bim-forge-qualification/residential197/evidence-ui211-aN`, unique
container, image `bim-qvm-tools:20261025`, 1 CPU/2 GiB, network none, read-only
source/dependencies at `all-ready-195/final/dependencies`. No local tests/builds
or installs; validators remain unchanged.

| Attempt | Result |
| --- | --- |
| 1 | Setup failed: wrong dependency mount; no tests ran. |
| 2 | Lint passed; same mount prevented typecheck. Fixed /work/node_modules mount. |
| 3 | Parent type errors: branded target, readonly pins, missing evidenceUses. No owned diagnostics; no tests ran. |
| 4 | Policy passed; 17/19 tests. Wrong four-file guard wording assertion (+ wrapper failure); fixed assertion, retained guard. |
| 5 | Scoped policy; 20/20 tests and browser bundling passed. |
| 6 | At parent adf5dbf: root validate, scoped policy (6 files), 20/20 tests passed. |
| 7 | Ownership correction: no implicit composer calls; bindingId aborts old chat work. Root validate, scoped policy, 22/22 tests passed. |

Code handoff: `acac4c3`, integrated by parent as `ef56f1a`. No model delta.
DOM harness and browser bundling do not qualify
real-browser layout, keyboard, touch or the combined workspace.

```text
Strict TypeScript valid. 262 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 0 changed file(s) checked.  [root default]
Policy valid. 6 changed file(s) checked.  [explicit scope]
tests 22; pass 22; fail 0; skipped 0
```

Runner, source hashes and output: slot `evidence-ui211-a7` files
`run.sh`, `manifest.txt`, `qualification.log`. Slots use the SSD prefix above;
containers `bim-evidence-ui211-aN`. Seven of ten attempts consumed.
