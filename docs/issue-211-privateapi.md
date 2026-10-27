# Project evidence panel (#211, parent #197)

Base `40b207c`; #199 owns `src/model-evidence.ts`, including required
`anchor.target` (DesignTarget) and read-set `target` (WritableDesignTarget).

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
Parent owns submission, applicability, read-set freezing, review and acceptance.
Promise callbacks disable choices until settled; rejection stays visible.

`await panel.show(context)` / `await panel.bind(context)` loads the first pages.
`panel.update(context)` updates parent display context; binding changes reload.
`refresh()` clears chosen context and reloads project history.
Context: `{projectId, target, revisionId, selectedObject: {id,name}|null,
entityName?: (id: string) => string|undefined}`. Target comes from EvidenceEntry's
anchor type. `bind(null)` clears and aborts work. `dispose()` releases the mount.
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
| 1 | Setup failed: /dependencies symlink broke Node sibling resolution; no tests ran. |
| 2 | Lint passed (259 files); same mount failure prevented typecheck. Fixed mount to /work/node_modules. |
| 3 | Lint passed; parent change-requests.ts blocked typecheck: branded target, readonly pins, missing evidenceUses. No owned diagnostics; no tests ran. |
| 4 | Scoped policy passed; 17/19 tests passed. DOM assertion expected different four-file guard wording (also failing wrapper). Fixed assertion, retained guard. |
| 5 | Scoped policy passed; 20/20 focused tests and browser bundling passed. |
| 6 | At parent adf5dbf: root validate, scoped policy (6 files), 20/20 focused tests passed. No code changes after qualification. |

Code handoff: `acac4c3`, integrated by parent as `ef56f1a`. No model delta.
Focused files: `demo/project-evidence-{client,ui}.test.ts` and
`demo/request-composer.test.ts`. DOM harness and browser bundling do not qualify
real-browser layout, keyboard, touch or the combined workspace.

```text
Strict TypeScript valid. 262 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 0 changed file(s) checked.  [root default]
Policy valid. 6 changed file(s) checked.  [explicit scope]
tests 20; pass 20; fail 0; skipped 0
```

Runner, source hash and output: slot `evidence-ui211-a6` files
`run.sh`, `manifest.txt`, `qualification.log`. Slots use the SSD prefix above;
containers `bim-evidence-ui211-aN`. Six of ten attempts consumed.
