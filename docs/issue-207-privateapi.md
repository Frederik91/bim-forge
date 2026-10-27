# Shared-wall ScriptBox API (#207)

Parent: #197. Base: `d914ab41210a97966d715dfeab58d2c69064f832`.
Authority: [Synthetic residential workflow](design/synthetic-residential-197.md).

## Private integration seam

```ts
model.previewWallShift(input: {
  wallId: string;
  offsetMetres: number;
}): Promise<{
  model: ModelSnapshot;
  changes: ReturnType<typeof summarizeModelDelta>;
  impacts: WallShiftImpact[];
}>
```

`model` follows existing preview results: with a frozen scope it is a partial
working graph, not a complete portable project. `changes` summarizes stored
changes from the immutable execution base to the current draft. `impacts` comes
from the existing pure wall helper for this operation on the current draft.
Its `changed` flag describes stored bytes for that operation, not world motion.
A hosted door can move with its host while its body and hosting offset stay equal.

The TypeBox method has effect `draft-write` and capability
`model.previewWallShift`. The request contains exactly `wallId` and
`offsetMetres`. Offsets use metres on the millimetre grid, are nonzero, and are at
most one metre. Positive offsets follow global +X for vertical walls or +Y for
horizontal walls. Supported topology and geometry remain owned by
`src/wall-dependencies.ts`.

The host calls the existing helper inside `stage`, which validates the complete
candidate and applies `assertModelScopeWrites` before changing the private draft.
Neither impact IDs nor readable context grant write authority. A wall-only scope
refuses changed adjacent Space bodies. A fresh explicit wall-plus-spaces scope
can succeed when the existing dependency closure contains all actual writes.
No new scope expansion, target/evidence authority, acceptance, or publication is
introduced. Parent integration wires target context after this handoff.

`modelScriptApi` exports the existing namespace for a restricted host runtime;
it does not create a session or grant capabilities. Normal `ModelScripts` runs
grant the new method alongside existing ordinary draft tools. Runtime limits,
revocation checks, validation recovery, evidence and terminal decisions retain
their existing paths.

## Plan and acceptance evidence

Only `src/model-script.ts`, its new `src/model-script-wall.test.ts` test, and this
document are owned. The generated residential fixture already in the base supplies
the shared partition, adjacent Spaces, hosted doorway and unrelated contents.

Real WASM checks cover typed declarations and successful private proposals,
unchanged accepted/base bytes, deterministic validation and stored delta,
evaluated hosted-door clearance, invalid-content atomic rejection and recovery,
restricted read-only capability denial, frozen wall-only refusal, and explicit
wall-plus-spaces success. Existing script and geometry tests retain their full
validators. No geometry solver or fixture-specific behavior enters the host API.

## Qualification budget and ledger

The user authorizes ten total interactive qualification attempts, overriding the
default three-attempt limit only for this work. Every attempt uses a clean SSD
slot `/ssd1/bim-forge-qualification/residential197/script207-aN` and unique
container `bim-script207-aN` on `frederik@192.168.1.17`. Containers use at most
one CPU and 2 GiB, no network, a read-only root, SSD temporary files and read-only
cached dependencies from `all-ready-195/final/dependencies`, with image
`bim-qvm-tools:20261025`. No local npm, installation, image build, pruning or live
database credentials. Logs, commands and source hashes remain in each slot.

Before push/draft PR: root `npm run validate`, focused real-WASM and helper tests,
and policy validation with the exact changed paths. Draft base is
`feature/issue-197-synthetic-pilot`. Human merge review remains required.

| Attempt | Source / commands | Result | Cause / next action |
| --- | --- | --- | --- |
| 1 | Archive `178cf294b029ea277e84297b45a3f34f961e7f92d353e9b8a7b239d1358acc16`; commands below | Focused 72/72 PASS, changed-path policy PASS, demo build PASS; root validate FAIL | Test setup passed a plain source-descriptor string to branded `selectedObjectIds`. Parse through existing `identifier`, with no cast or validator changes. |
| 2 | Archive `f639f7bcf248467691acee37f5c0b8c76e96d256b84314c8f510b904b1a47d52`; commands below | PASS: root validate, 72/72 tests, changed-path policy for all 3 owned paths, demo build | No validator changes. Two of ten attempts used. |

Each attempt runs these commands in its own constrained container:

```sh
npm run validate
node --test --test-concurrency=1 src/model-script-wall.test.ts src/model-script.test.ts src/wall-dependencies.test.ts src/synthetic-residential-fixture.test.ts src/residential-workflow.test.ts src/model-scope.test.ts
node scripts/validate-policy.ts --changed-files src/model-script.ts src/model-script-wall.test.ts docs/issue-207-privateapi.md
npm run build:demo
```

Root validation has a 180-second limit, focused tests 300 seconds, and build
180 seconds. No retries run inside these commands. Logs are kept as
`evidence/{validate,focused,changed-path-policy,build}.log` and `status.tsv` in
each SSD slot. `container-inspect.json` records the limits and mounts;
`source-sha256.txt` binds the archive and edited TypeScript files.

Attempt 2 checked 246 TypeScript source files. All 72 tests passed with zero
skips, cancellations or failures, including eight new real-WASM wall tests.
The container exited zero without an OOM kill. Its inspected limits were
`NanoCpus=1000000000`, `Memory=2147483648`, `MemorySwap=2147483648`,
`ReadonlyRootfs=true`, and `NetworkMode=none`.

The final evidence note was completed after qualification. Both TypeScript files
are byte-identical to the tested SSD source:

| File | SHA-256 |
| --- | --- |
| `src/model-script.ts` | `617abcf4f9f672247c17eb81ea8e9a227268c225e6417bfa2c07d3c1ca20c635` |
| `src/model-script-wall.test.ts` | `2406f1a83f5a639aeebbfd0083794126c88c58fbc11a507ca26b1f36332de291` |

## Inspectable model delta and handoff

The generated fixture's 0.2 m preview moves `wall-living-kitchen` from x=5 to
x=5.2. Stored modifications are exactly `room-kitchen`, `room-living`, and
`wall-living-kitchen`. No entity is added or removed, and no relationship body
changes. The living room's maximum X and kitchen's minimum X become 5.2.
All unrelated entity bodies retain their original values.

The host returns the helper's complete `impacts` array. In the fixture,
`door-living-kitchen` has `kind: entity`, `reasons: [hosted-opening]`, and
`changed: false`. Its evaluated door-clearance X bounds move 0.2 m while its
stored Door and hosted-by bodies remain identical. Tests compare the actual
WASM host result to the full deterministic impact array and stored-delta summary.

Wall-only scope exposes the adjacent Spaces as context but refuses their writes.
After the caught rejection the graph and frozen scope remain identical; returning
a proposal then fails because its delta is empty. A separate scope explicitly
targeting the wall and adjacent Spaces succeeds using the existing hosted-object
closure. Neither operation changes frozen authority or the accepted repository.

Parent integration must run `src/model-script-wall.test.ts` explicitly alongside
the existing package tests because package files are outside this slice's
ownership. New target/evidence APIs are deliberately not imported. This evidence
does not qualify scenario/evidence integration, queue/UI behavior, real-device
interaction, or engineering compliance. No merge, deployment or issue closure
was performed by this slice.
