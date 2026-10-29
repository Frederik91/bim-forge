# Source-bound qualification handoff

Parent [#230](https://github.com/Frederik91/bim-forge/issues/230).
No merge or preview deployment is claimed by this record.

## ScriptBox 4.1.1

The owner corrected the next release to **4.1.1**. Earlier unpublished 0.2.0/0.2.1
candidate receipts remain historical evidence, rather than release instructions.
[ScriptBox PR25](https://github.com/Frederik91/ScriptBox/pull/25) at
`bb0a5e3cce77c0062c9ebcfdb892cce51fa1bf14` passes all four GitHub checks, server
build/typecheck/lint, 193 Node tests with no skips, artifact checks and a clean
network-off official Node 24 consumer with real JS/TS and catalog calls.

Server receipts: `/ssd1/bim-forge-qualification/scriptbox24/release411-01/evidence/`
and `/ssd1/bim-forge-qualification/scriptbox24/release411-consumer-01/evidence/`.
The qualified tar SHA-256 is
`e4fec17c14697c2f877d7834bf5e29b4c32b00a93b91dc19dbb38a0e43887a6e`.
BIM's candidate lock binds its exact integrity. **4.1.1 is not yet public on npm**;
the registry URL in that lock is a release target, not an available installation.
Merge/staging authorization and maintainer npm two-factor approval remain necessary.
Check the actual published tar and its integrity before treating the lock as final:
the release workflow repacks and may produce different archive bytes.

Plan for the dependency integration: change only `package.json` and
`package-lock.json`; create a separate SSD dependency cache from the qualified
packed consumer; verify every unrelated dependency and nested compiler is unchanged;
run root validation and the full suite in a bounded network-off server container.
No model entities, persistence contracts or acceptance authority change in this bump.
The new dependency's integration results and final image remain pending here.

## Actual converter, geometry and UI

Exact BIM source: `19cd354a047e2aa930f2aa9a3ed299bfa801122b`, with the earlier
qualified private ScriptBox 0.2.0 candidate. Retained runs:
`/ssd1/bim-forge-qualification/issue230/issue234/shared-picker-05/`.
The five phases pass: validate, real converter/oracle, native receiving project,
five geometry runtime tests, and one full browser workflow. All earlier failed
attempts remain retained; this is cumulative attempts 30 through 34.

The real browser uses public UI actions and real server/converter routes. It proves:

- One viewer; linked selection hides native Move and exposes source properties.
  EI60 and hostile source text render as plain text. Native reselection clears
  linked selection. Scalar properties at the depth boundary are now visible.
- Exact project/source/version/GlobalId/occurrence context pins, independently
  checked occurrence-matrix hashes, and immutable older attachment bytes.
- Failed replacement preserves current geometry. Property and moved-wall versions
  can be reviewed/adopted, with stable identity and original download history.
- A second browser commits placement while an unchanged adoption request waits;
  the stale adoption returns 409. Fresh adoption retains the newer placement.
- Both actual chat submissions persist: chosen receiving hall/level, and an empty
  native selection in a legacy project. Neither includes the previously selected
  native door. No fake provider, auth, worker or proposal is used.
- Serialized Main stays unchanged. Foreign original/prepared reads are refused
  without source bytes. Desktop and 390 px layouts avoid horizontal page overflow.

The runtime/oracle tests cover actual rotated metre/mm geometry, doorway and
concave-shape bounds traps, zero-clearance safety, meshless semantic discovery,
incomplete geometry abstention, scoped hidden dependencies, and an ordinary
receiving floor at 3.5 m with no prefilled candidate assets or oracle answers.
Boundary-touching cases may explicitly abstain; this is not a universal solid or
clearance certificate. Responsive screenshots do not establish physical touch UX.

The browser receipt is `attempt-5-browser-19cd354a047e/artifacts/issue234-browser-receipt.json`.
Its concrete receiving and legacy outcomes both say `submitted`; its generic
provider note is stale about UI submission gates. Connected-provider behavior is
still untested by that receipt.

## Earlier core and image results

Core source `cac791b0dcab67ff5d74f0c14783634ddee42b60` passed 925 checks:
923 passed, zero failed, two optional skips, plus strict lint/typecheck/policy/build.
It does not substitute for testing the new 4.1.1 dependency.

Image `sha256:321fb719629148dfc22a8da297509d5b02fadd7a9ade5b6e29dc2a00563bf1ed`
at executable source `5721f53fcd5f2cc9d93f93b353781d1c6fde278c` passed actual
runtime and synthetic old-SQLite upgrade/restart preservation at image attempt 17/20.
Its legacy sample Main/baseline/alternative, retained IFC original and old checkpoint
were preserved. No connected provider or converted old-mesh migration was claimed.
That image still contains the earlier SDK, so it is **not the final 4.1.1 image**.
Failed images and their raw evidence are retained. Additional root image-store
growth remains capped at 2 GiB; source, deps, temporary files and logs stay on SSD.

## Remaining merge gates

- Public 4.1.1 artifact verification, final BIM lock/cache and integration checks.
- Final actual-image/static/converter qualification and paired rollback evidence.
- Real connected ChatGPT geometry query and native proposal independently verified
  at 500 mm clearance from a selected linked wall; no oracle answers in its prompt.
- Explicit acceptance in a disposable alternative, with unchanged Main/As-is.
- Final combined draft PR, required green CI and source-bound preservation/deployment
  receipts. Existing user projects and auth must remain untouched.

Single-server browser placement/adoption interleaving does not establish
cross-process acceptance, cancellation/restart, or final proposal freshness.
Those claims require their own core/runtime receipts; pending rows in the original
requirements matrix must not be inferred green from this UI run.
