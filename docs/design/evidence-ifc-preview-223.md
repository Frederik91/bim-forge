# Evidence and IFC workspace integration

Integration [#223](https://github.com/Frederik91/bim-forge/issues/223), parent #197.
Base: merged PR #215, `882a50b7599ff926fb0648c2e070c51a2cffccfd`.

## Sources and ownership

| Component | Reviewed source | Responsibility |
| --- | --- | --- |
| Floor-plan workflow, PR #222 | `8812815` | Chat action, source-bound measurement confirmation, recovery and baseline/alternative workflow |
| Dimension helper, PR #220 | `11c8e65` | Bounded complete-partition preview, conservative minimum clear spans and evaluated dependencies |
| Read-only IFC, PR #221 | `ecd18db` | Source retention, isolated conversion, artifact validation, hierarchy, properties and disposable render layer |
| ScriptBox integration | `ee2f694` | Typed guest method, atomic staging, frozen read/write scope and generated documentation |
| Parent | This branch | Single-viewer/panel/server mounts, test registration, combined qualification and paired preview publication |

Every component has an isolated worktree. The parent integrates original histories rather than copying partial final documentation commits.
The independent viewer benchmark (#192 / PR #214) is outside this change.

## User workflow and authority

Use **Reconstruct a floor plan** in the chat composer. Attach an image/PDF and confirm a known feature,
dimension provenance and whether it measures wall centrelines or a clear span. The confirmation is a user
assertion bound to the original source, not certification of the drawing or every inferred dimension.
The AI prepares a reviewable proposal. Acceptance stays explicit. **+ Alternative** retains an As-is
baseline and opens a separate writable target.

`model.previewRoomDimensionChange` drives a complete shared partition from a centreline span and
checks optional conservative clear spans. Unresolved measurements do not mutate the draft. Source
reference text grants no evidence freshness or write authority. Every stored change still passes the
existing snapshot and frozen-scope validators; no general parametric solver is introduced.

**Navigate → Linked IFC models** retains an original IFC and reports asynchronous preparation.
Hierarchy, original properties, source diagnostics and visibility stay beside the existing model.
Linked meshes use the same Babylon scene and canvas. Their selection is separate from native selection
and scope. **Reference in request** appends source identity to an unsent message; it does not submit,
approve, import native objects or grant editing rights. IFC geometry is shown in 3D, with explicit
reference framing. Hover and selection use distinct outlines.

IFC conversion runs without network access in a separate hard-limited process/container. Only its
dedicated spool is writable; accepted models, application-private state, credentials and Docker sockets
are absent from converter mounts. Ready artifacts are validated and retained in application-private
storage. A configured spool is not a claim that the converter is healthy.

## Supported bounds

Floor reconstruction remains one rectangular storey tiled by supported rectangular rooms. Native
portable limits remain 100-item arrays, 32 revisions and 256 KiB. Centreline and clear spans cannot be
silently substituted.

The IFC path retains the reviewed small-fixture bounds: IFC4 metre/mm, 2 MiB original, 2,000 entities,
64 products, 50,000 vertices, 100,000 triangles and 8 MiB completed artifacts. Display/job identity must
equal the source occurrence identity at the display boundary. Full namespace/revision/hash/GlobalId
and occurrence transforms remain pinned. Source ownership and unsupported/lost information are
visible. This does not qualify arbitrary vendor exports, large hospitals, native IFC editing or survey
coordinate accuracy.

## Qualification and publication

Build/test only in bounded isolated server containers. Source/dependencies are read-only, tests use
network-none, and artifacts/cache/temp files live on `/ssd1`. Deterministic provider fixtures prove
application behavior separately from any live-provider interpretation check.

Parent evidence root: `/ssd1/bim-forge-qualification/issue223/`.
The first parent check at `8896658` passed root validation (286 TypeScript files), explicit 29-path
policy, browser build and 32 focused helper/guide/wall tests. This preliminary result does not qualify
the later server mounts, dimension bridge or combined browser workflow.

Combined acceptance must cover source upload/confirmation/recovery, proposal/explicit acceptance,
baseline/alternative isolation, real linked canvas picking and visibility, unsent-only references,
converter isolation/recovery and unchanged native accepted data. Inspect actual desktop/phone
screenshots. Register pure/ScriptBox tests in the root suite; the IFC browser command requires an
explicit disposable external converter spool and fixture, so it is invoked by the server harness.

Before publication retain exact source, commands, container inspections, logs, hashes and model delta.
Deploy paired static/runtime artifacts with rollback and accepted/source/auth preservation checks.
Do not merge new geometry/storage/security work without human approval.

### Attempt record

- Preparation: an isolated docs-only cherry-pick was aborted before product edits; full component
  histories were then integrated. No validator/test attempt ran during that correction.
- Parent check 1, `8896658`: validation, explicit policy, build and 32 focused checks passed.
- Parent check 2, `1b110b1`: strict lint passed; typecheck caught missing awaits in the new browser test's asynchronous repository restoration. No browser test ran; corrected the fixture.
- Final combined qualification and publication: pending.

The owner permits ten attempts per interactive item, without weakening validators or changing factory
policy. IFC worker #218 used all ten and handed back its final passing source; this parent work does
not authorize that worker to rerun an unchanged exhausted item.
