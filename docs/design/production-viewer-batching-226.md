# Retained production viewer and bounded batches — #226

Approved scope: integrate the renderer improvement into the existing ModelScene.
Accepted production model delta is zero; no authoring, storage or workspace
ownership changes. Source snapshots remain authoritative outside the renderer.

## Plan and acceptance before implementation

1. Merge reviewed benchmark #214, then #219, preserving current main's tests.
2. Keep ModelViewer and ModelScene's public interaction methods. Add a private
   batch owner for opaque, unhighlighted meshes, preserving source normals/UVs,
   logical meshes/IDs and bounds. Selected/outlined and transparent review parts
   use their original individual geometry/material behavior.
3. Retain render units across snapshots. Use existing modelChanges dependency
   invalidation, including hosts, supports, families, levels and stair openings.
   Remove/rebuild changed units only, preserving unchanged resources and camera.
4. Visibility-only changes update indices or whole-batch enable state, never
   vertex buffers. Batches are material/spatial groups capped at 128 parts and
   100,000 vertices, with an oversized single part preserved intact.
5. Validate actual ModelScene behavior on deterministic production fixtures,
   both material modes, picking/references, cutaways, selection and preview/
   compare/discard. Check untouched resources and 100-cycle resource recovery.
6. Use real Chrome A/B diagnostics and inspect focused images. Compare full
   triangle positions, normals and UVs; investigate float32 projection as a
   possible cause of the benchmark overview difference. Record residual image
   differences and unavailable GPU memory/presentation timing honestly.
7. Run npm run validate, relevant tests and CI; publish a draft with evidence,
   review it, then complete the user's approved merge when checks pass.

## Ownership sketch

```text
ModelViewer (unchanged owner, one canvas)
  ModelScene.setModel(snapshot, comparison)
    retained render units (existing domain dependency comparison)
    existing geometry generators -> logical source mesh records
    SceneMeshBatches.update(source parts)
      opaque/unhighlighted -> material/spatial batch, source geometry cached
      highlighted/transparent -> individual source mesh
      visibility change -> index-only update
    pick -> triangle range -> original source mesh -> stable BIM object ID
```

Private helper API: update(parts), pick(x,y,predicate), resources(), clear().
Retention requires an explicit project ID from the existing host repository.
Snapshots contain no project identity; legacy callers that omit the optional ID
keep full-replacement behavior. Switching projects always releases prior parts,
even when entity IDs and geometry coincide. The application supplies its existing
repository project ID; this adds no authoring or persistence state.
Source geometry caches belong to the helper only while the logical source mesh
is alive. Removing a part releases its cache and affected batch membership.
Clearing/disposal removes batch buffers and shadow casters. Diagnostic constructor
option `off` keeps individual rendering for A/B checks; the product default is
automatic batching above a bounded size threshold, with no new user setting.

## Limits

Transparent context and previous-state ghosts retain individual sorting and
wireframe semantics. This delivery does not claim a 200k+ sqm qualification,
source rights/area admission or primary-laptop/GPU-memory capacity. Those remain
open in #192. Private West Riverside data and images must not enter Git.

## Run ledger

- Approved implementation started in isolated branch
  `codex/issue-226-production-viewer`, based on the integrated benchmark stack.
- Benchmark integration found a package.json test-command conflict with compact
  workspace #215; preserved both test sets and the browser test command.

## Implementation and review outcome

**Current: production fixture checks passed; ready for human review after final CI.**
The failures below are retained historical evidence, superseded by the renewed
completion recorded at the end of this report. The implementation
is in the existing ModelScene/ModelViewer path. Two code-review axes found no
remaining source-level blockers after fixes, and the renewed browser run now passes exact parity, readiness and resource checks.
The metadata-only evidence is [issue-226-production-viewer.json](../evidence/issue-226-production-viewer.json).
All source models, images, traces and raw logs remain ignored and private.

The validated fixture has 91 entities and 146 logical render parts, within the
unchanged 100-item model array limit. Basic overview draw calls are 146 -> 25;
Realistic overview calls, including the shadow pass, are 283 -> 48. Triangle
counts remain 1,782 and 3,456 respectively. These counts describe this fixture;
there is no general latency, FPS, laptop capacity or 200k+ sqm claim.

Comparison rendering intentionally keeps all source meshes individual, including
changed opaque parts. Context transparency, before wireframes and source caster
order take priority over batching in that pass. This did **not** eliminate the
small repeated Realistic comparison difference. Do not describe comparison draw
calls as optimized or the current production change as pixel-identical.

### Completed checks and fixes

- 36 production scene tests pass: full triangle position/winding, normals and
  UV equivalence; stable picking/highlights; index-only filtering; retained
  untouched parts; changed level/support/host dependencies; mutable caller
  snapshots; project identity replacement; 100-cycle resource recovery.
- 13 existing real-browser chat/workspace checks pass with the installed
  Playwright browser. No workspace mount or second product viewer was added.
- Shared source geometry is captured before detaching GPU users. Detached
  logical meshes release stale submeshes; selecting restores source geometry.
- Final placement matrices are forced when capturing newly built geometry in
  a scene that has already rendered. This fixes doors/stairs rebuilt at origin.
- Rebuilt hidden batches invalidate their index-mask cache. Restoring visibility
  restores all source triangles; the regression checks all 4,608 box indices.
- Project changes cancel a live reference drag. Actual Chrome interaction reaches
  a valid floor/wall target, switches only project identity, then releases with
  zero reference callbacks and cleared marking state.
- SourceShadowLight keeps the original logical caster bounds for projection,
  preserving overview shadow coverage despite larger batch bounding boxes.
- The diagnostic worker has a 180-second lifecycle watchdog and browser-process
  tree cleanup. Failed output and cleanup errors are retained, never scored fast.
- npm run validate passes. Accepted production model delta is zero. Validators,
  model schema/storage, production CSP and dataset admission are unchanged.

### Historical qualification attempts and escalation

Three multi-session checks are retained in the evidence, with every completed
candidate and failure. No further multi-session attempt is authorized under the
repository's three-failure rule without escalation.

1. `qualified-local-001`, source 7c24b53: ten candidate runs complete, including
   100 cycles per mode on the last pair. Exact A/B fails: four Realistic
   comparison images differ by 21-23 of 480,000 pixels. All other images match.
2. `formal-local-002`, source 4f3288d: six candidates complete, then 4-retained
   times out waiting 15 seconds for actual ModelViewer readiness. No page errors
   are reported. The worker closes and its process tree is cleaned up. The
   remaining candidates are not executed and this is a failed partial run.
3. `readiness-diagnostic-001`, source 4f3288d plus recorded readiness diagnostic
   file hashes: all ten candidates and actual UI drag checks complete, but four
   Realistic comparison images again differ by 21-23 pixels. This uses only two
   cycles in the final pair and is not the final 100-cycle qualification.

The repeated difference remains after individual comparison rendering and
canonical shadow caster ordering. The recorded changed pixels have channel
changes up to three intensity values in the first failed pair. Root cause and
acceptability remain open; the zero-difference check was not relaxed. The one
intermittent UI readiness timeout also needs a reproducible cause, rather than
being hidden by later passing checks. Basic, overview, preview and discard
images match in the completed paired image sets; within-candidate discard
restores baseline pixels and settled resource counts.

**Next investigation:** capture failing actual-UI readiness details using the
new bounded diagnostics; isolate Realistic comparison shadow/depth ordering
from retained source ordering, with fixed camera and stable inputs. Resolve or
explicitly review the image difference, then rerun five alternating pairs with
100-cycle recovery on the final pair. Obtain a renewed qualification budget
before attempting that rerun. Keep #192 and #226 open.

### West Riverside overview diagnostic

A separate one-load diagnostic uses all seven disciplines: 97,590 source render
parts, 53,329 unique source geometries and 15,334,885 instanced triangles. The
original individual adapter renders 97,590 calls; the old benchmark batch adapter
renders 1,677; the production helper renders 1,679. All render the same triangle
count. At 1,280 x 800, the old adapter reproduces 1,822 differing overview pixels;
the production helper has zero. Source GPU float32 positions and absolute world
coordinates avoid the old batch-origin rounding path.

This diagnostic's exact compiled bundle and dataset hashes are retained. It was
built from the working tree before the final logical-submesh cleanup and is not
an exact-final-head production replay. Do not extend its result to proposal
updates, engineering geometry equivalence or the full production UI. Private
bundle, images and diagnostic sources are under
`artifacts/private/production-viewer/west-fidelity-001`.

The existing [West Riverside admission report](../evidence/viewer-benchmark/west-riverside-initial/README.md)
continues to govern rights and suitability: gross area is unknown, the release
chain for these IFC exports remains unresolved, discipline placement/physical
identity and conversion completeness remain unqualified. Keep data local and
retain attribution; do not sum floor area across disciplines.

### Broader validation and merge sequence

The complete Windows npm test invocation is **not green**: 739 pass, 38 fail,
32 skip. Failures include SQLite EBUSY/EPERM cleanup and unavailable PDF tools;
a hung server test process was explicitly stopped. The unchanged benchmark
branch independently reproduces the SQLite source-store restart cleanup failure.
No unrelated test or production code was changed to suppress these failures.
Ubuntu CI installs Poppler and must pass independently before merge.

Reproduce focused checks with `npm run validate`, `npm run test:production-viewer`
and `npm run test:chat-browser` (install Playwright Chromium first). The bounded
A/B command is `npm run benchmark:production-viewer -- --output <fresh-private-directory>
--sessions 5 --cycles 100`; it currently has known blockers above and is listed
for a renewed, explicitly authorized investigation, not another automatic retry.

Merge order remains #214 -> #219 -> this production PR. GitHub requires an
approving review from a reviewer with write access; chat authorization does not
create that review record. After parent squash merges, retarget/rebase each
child to main and rerun integration checks. The production PR remains draft
until its browser blockers are addressed. Do not bypass repository protection.

## Renewed diagnostic pass (maintainer approved continuation)

The renewed attempt uses `codex/issue-226-diagnostics` in its own worktree,
continuing PR #227. Scope: ModelViewer's readiness transition, ModelScene's GPU
anti-aliasing, and the production browser/worker harness. Keep accepted model
state, geometry generators, validators and the three-frame/pixel gates intact.
Re-run focused checks first, then at most three full qualification attempts.

The diagnostic loop reproduces the old readiness failure by holding Babylon's
public scene readiness check false until the viewer's draw budget is exhausted.
After release, the old implementation reports scene readiness true but leaves
the DOM flag false and can idle before rendering the ready transition. The fix
renders that transition before idling. This is exercised in the actual browser
UI through `uiDeferredReadiness`, with no timeout increase.

A separate GPU readback probe captures twelve identical-input frames and records
camera matrices, transparent draw order and pixels. Default-framebuffer MSAA
produces two pixel states even after settling; matrices and draw order stay
unchanged. Turning off shadows, dithering or canvas alpha does not remove it.
Turning off MSAA makes all twelve frame hashes equal from the first frame on
both renderer configurations. Explicit FXAA with an unmultisampled default
framebuffer also makes all twelve hashes equal while retaining anti-aliasing.
This locates the observed instability in the default multisampled framebuffer
path on the local Chrome/ANGLE/NVIDIA configuration; it does not diagnose a
specific upstream driver defect. Preserve the original failed evidence.

The real ModelViewer and benchmark both use ModelScene-owned FXAA. This changes
the anti-aliasing method and adds one postprocess draw call. It does not change
model geometry, identity or picking. The before/after images require review as
part of the existing renderer PR. NullEngine has no rendering canvas and does
not create this GPU postprocess; it cannot qualify AA or shader behavior.

The benchmark also omitted engine beginFrame/endFrame. It now performs the same
engine lifecycle as the real runRenderLoop, still submitting three scene frames.
The old engine counter stayed zero, and Babylon's ObjectRenderer could not reset
its frame-keyed scene-UBO pool. New samples assert and record frame progression;
resource checks include live uniform-buffer counts. This corrects the harness,
not a claim that the missing lifecycle alone caused every pixel difference.
WebGL's optional general UBO tracking feature is disabled in this configuration;
the ObjectRenderer's scene-UBO pool independently keys on engine.frameId.

Acceptance for this pass: controlled late-readiness regression passes; strict
A/B and discard image checks remain zero-difference; both modes retain source
triangles and visible proposals; 100-cycle live resources, including uniform
buffers, recover; applicable tests and CI pass. The final five alternating pairs
are pending at this implementation freeze. #192's dataset/device qualification
and GitHub's required human approving review remain separate merge conditions.


## Renewed completion at 51fe3d0

The first renewed qualification attempt passes all ten candidates in five
alternating A/B pairs. All fifty paired overview/baseline/preview/comparison/
discard images are pixel-identical, and every within-candidate discard restores
its own baseline exactly. Both configurations complete 100 preview/compare/
discard cycles per mode in the final pair. No page errors or invalid WebGL
warnings occur. All ten actual ModelViewer deferred-readiness regressions and
project-switch drag checks pass.

The Basic overview is 147 -> 26 draw calls; Realistic is 284 -> 49, including
its shadow pass. These counts include the new single FXAA draw. Source triangle
counts remain 1,782 / 3,456. Both modes restore meshes, geometries, materials,
textures, source caches, batches, shadow casters and **37 live uniform buffers**
after 100 cycles for both configurations. Raw heap samples are retained, but
include diagnostic sample accumulation and JIT caches; they do not qualify GPU
memory or prove the complete absence of leaks.

The exact frozen implementation and harness are 51fe3d0; the public evidence
retains source-file, input, raw-result and diagnostic-bundle hashes. Later report
edits add no runtime changes. All 36 scene tests and 13 workspace/chat browser
tests pass; root validation passes (279 TypeScript files). Both review axes
report no remaining source-level blockers at the frozen commit. Final CI must
pass at the published head; human review still covers the changed AA appearance.

No pixel threshold, timeout, source validator or production array limit was
relaxed. Default MSAA is replaced by explicit camera-owned FXAA in both real UI
and harness. Diagnostics rule out shadows, draw order, dithering and alpha as
the observed MSAA variation's cause; they do not establish the upstream driver
implementation defect. The earlier failed runs remain part of the record.

The 200k+ sqm data admission, engineering/coordination completeness and device
qualification remain open in #192. Merge order and GitHub approval requirements
remain #214 -> #219 -> #227. No issue should auto-close from this delivery.
