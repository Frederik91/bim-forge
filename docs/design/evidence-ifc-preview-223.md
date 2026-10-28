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
| Review-text contract | `b4de06f` | Shared unchanged text bounds, generated agent guidance and field-specific repair feedback |
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
and scope. **Reference in request** attaches a named source-context note with the pinned identity and
original object properties to the unsent composer, keeping machine identifiers out of the message field. It does not submit,
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
- Parent check 3, `14422ff`: root validation, explicit policy, build and 49 focused checks passed. Browser setup stopped before tests because its generator requires a new output directory; removed the helper's premature directory creation.
- Parent check 4, same source: both shipped floor-plan/IFC workflows and all five chat cases passed. The existing workspace suite could not find its cached default browser; fixed only the harness's browser-cache environment.
- Parent check 5, same source: all 15 actual-browser checks passed, including desktop/phone layout, baseline/alternative isolation, linked canvas picking/visibility and no submission on reference.
- Screenshot inspection prompted compact IFC controls, a corrected reference-frame enable state and named source-context attachments instead of raw JSON in the message field. Final-source qualification follows.
- Parent check 6, `9140400`: root validation, explicit policy, build, 49 focused checks and all 15 browser checks passed with the refined UI. The full root suite passed 810 checks with two existing optional skips and one packaging failure: the Docker context allowlist omitted the new linked store/routes. Added the two explicit entries; no validator changed. Assets tests had not yet run because the root command stopped at that failure.
- Parent check 7, `e99740f`: root validation, explicit 41-path policy, build and 51 focused checks passed. Full `npm test` passed: 5 qualification-contract checks, 811 of 813 main checks (two existing optional skips) and all 21 asset checks. The source-only image preflight initially referenced the pre-squash approved commit, absent from the bounded bundle; corrected the preflight to the merged base and checked unchanged production dependency metadata against the actual approved base image.
- Parent check 8, same executable source: source-only image built with no pull/install and no new dependencies. Actual image plus a separate spool-only converter passed all three HTTP/security/conversion/recovery/preservation tests as UID 65032:33, under production app limits. Runtime/dependency file manifests were checked before enabling conversion.
- Initial publication passed at `e99740f`, preserving the original eight projects, 22 requests and ChatGPT connection. Live IFC conversion, source properties and unsent context passed. The live floor-plan request generated valid geometry but twice failed the unchanged `review.constraints` text contract. Accepted Main remained at the initial root. The complete failed history remains in its conversation.
- A separate scoped review-contract correction reproduced the failure through the actual guest and passed 61 focused checks. It derives agent guidance and field-specific repair diagnostics from one contract, retaining the exact existing limits and accepted grammar. See [the red/green evidence](review-text-contract-223.md).
- Corrected combined source `c534eea`: root validation (290 TypeScript files), explicit 47-path policy, build, 59 focused checks and 15 browser checks passed. Full `npm test` passed 5 contract, 819 main and 21 asset checks, with two existing optional skips. Focused checks are a subset, not additional full-suite passes. Actual image with a separate converter passed all three server/security/recovery checks.
- Corrected source publication passed on its first cutover attempt, preserving nine projects, 23 request identities, accepted models, sources and ChatGPT connection. The extra project/request at that point belonged to this synthetic QA workflow. Live-provider reconstruction, explicit Main acceptance, baseline capture and alternative-only partition acceptance subsequently passed as recorded below.

### Current qualified source and live workflow

Deployed executable: `c534eeadf8e675ba09ebf9e108de389e331d251e`.
Image: `bim-forge-preview-app:c534eeadf8e675ba09ebf9e108de389e331d251e`,
ID `sha256:6aba31a8f280a30ced05ff5235c040c4f20cd507a7d5f5eb5cc9b504a7bdbdaa`.
Paired browser/runtime publication is live at <https://192.168.1.17:9443/>. Later receipt-only
commits do not change executable files. Corrected root/full/browser/image evidence and paired rollback
are retained under `build-c534eeadf8e675ba09ebf9e108de389e331d251e/`, including `rollback-review-a1/`.

| Corrected-source artifact | SHA-256 |
| --- | --- |
| `artifacts/full.log` | `27484e5aabb7bdb1572a186d326f325b344183808ebd44f8769f5a0babe0b614` |
| `artifacts/image-canary.log` | `cd7b395b175bec94772b5d00ff530bfd23bef437b3e91f092b43eb293a05baf9` |
| `artifacts/live-workflow-receipt.json` | `99ee3be606960c0c6c72c85e949d7960d107b08042f523d6366181949600d755` |

The real connected ChatGPT workflow used only the separate invented project **Floor plan + IFC —
preview verification — 28 Oct** (`a5af9d2f-39c2-44db-a4c3-80dd34a308b4`). All submission, target
switching and acceptance happened through the UI. A separate resource-bounded network-off container
then opened only SQLite database/WAL/shared-memory file mounts read-only and queried that project.
The existing store/repository validators reconstructed its stored graph and verified revision hashes,
target authority and the [retained semantic delta](fixtures/evidence-ifc-223/live-workflow-receipt.json).
The probe made no database changes and did not read credentials or other project contents.

1. Attach the synthetic drawing and confirm **overall width 6000 mm**, dimension provenance
   **Dimension on drawing**, reference **Between wall centrelines**. Submit reconstruction in chat.
2. After the contract fix, reply in the original conversation to retry the same reconstruction. The
   retained earlier failures, drawing and measurement remain in history. Request
   `95b9efa4-540d-432f-a23d-c32feb2b5985` produces a 6 m × 4 m floor, two rooms and two doors.
   Inspect assumptions, then explicitly **Accept into Main**.
3. **+ Alternative** captures the locked As-is baseline at Main revision
   `0d9a3621ec7046724d065311a42f8ba5ee294a7427c7386d48792e49a4e5bcc5` and creates Alternative 1.
4. Request `03fa4d7b-fe8b-4436-ae71-95a857ca2e46` asks for Living to be 3300 mm between
   centrelines, Office at least 2500 mm clear, fixed outside footprint and entrance, and a shared
   doorway that travels with its host without changing its offset. Inspect Plan and 3D, then
   explicitly **Accept into Alternative 1**.
5. Alternative revision becomes `7a735c70e705c971f677372c1d3c43c9fc45683e59576a4220552ba3212de1f6`.
   Main and the immutable As-is baseline both retain the exact original revision above. Living changes
   from 12 to 13.2 m² and Office from 12 to 10.8 m², with 2550 mm clear width. The stored delta is
   exactly one partition and two room bounds; no additions, removals or relationship changes. The fourth
   highlighted item is the hosted doorway's evaluated placement, whose stored identity/body/offset remain
   unchanged. Its 850 mm host offset is preserved.

This verifies workflow and isolation with a live provider, not survey reconstruction accuracy. The
6000 mm width is the user-confirmed dimension; other dimensions and offsets retain their documented
source interpretation or assumptions. Human acceptance is not construction/code approval.

The same project retains a ready synthetic IFC source with hierarchy and original properties.
Selecting `wall-a` and choosing **Reference in request** adds `IFC wall-a.txt` to an unsent message;
it does not create a ticket. Linked visibility and native selection remain separate. Arbitrary exports
and large-model performance remain unqualified.

![Accepted live-provider alternative, retained chat decision and moved shared partition](fixtures/evidence-ifc-223/live-alternative-accepted.jpg)

![Unchanged locked As-is baseline after alternative acceptance](fixtures/evidence-ifc-223/live-baseline-unchanged.jpg)

### Initial qualified source and retained evidence

Initial qualified executable source: `e99740fc952527f900bd891298248c9315417f18`.
Image: `bim-forge-preview-app:e99740fc952527f900bd891298248c9315417f18`,
ID `sha256:e56d752c1d5206a1a66ed4ff550410f250949a83e64ee9bc0ae4690e8bb13e93`.
Later receipt-only commits do not change executable files.

The image is a source-only layer over the exact already-qualified approved preview image
`sha256:c3497c848dceca6fbf01c08f64649a444e69cfe65570ffca63b2f4b36508bcc3`.
The lockfile and production dependency metadata match. This avoids reinstalling unchanged dependencies
on a nearly full root filesystem; it is a retained preview build path, not a replacement for the clean
repository Dockerfile. That Dockerfile and its context allowlist now include both new server modules.

The initial 15 browser checks ran on `9140400`; all UI/domain/server/guest/worker files are identical to
the initial executable `e99740f`. Only the Docker-context allowlist and receipt changed afterward. Browser source,
trace, screenshots and inspectable delta are retained under
`build-9140400048c17591899ad96254e0fa25cc9cabaf/browser-a06/`.
Final root/full/image/canary evidence is under `build-e99740fc952527f900bd891298248c9315417f18/`.
Containers had read-only roots/source/dependencies, no network, bounded CPU/memory/PIDs, and SSD-backed
private state, spool and artifacts. The actual image app has no Python mounts; the converter has no app
state, credentials, native database or Docker socket.

| Retained artifact | SHA-256 |
| --- | --- |
| Final `artifacts/full.log` | `bf78e019863c0f285159a239bbc1b37780982cfa13d56e8f050358bf35768519` |
| Actual-image `artifacts/image-canary.log` | `a1ec95376dd836068b66edd8707f712e82539a037458017f502f9b8fd4f8e7fa` |

These [synthetic model deltas](fixtures/evidence-ifc-223/floor-alternative-delta.json) show Main and
the fixed As-is baseline retaining their revision while only Alternative 1 accepts the shared-wall move.
They contain invented test data, not the owner's house.

![Linked reference with a named unsent attachment](fixtures/evidence-ifc-223/linked-desktop.png)

![Phone layout retains the model above the composer](fixtures/evidence-ifc-223/linked-phone.png)

The owner permits ten attempts per interactive item, without weakening validators or changing factory
policy. IFC worker #218 used all ten and handed back its final passing source; this parent work does
not authorize that worker to rerun an unchanged exhausted item.
