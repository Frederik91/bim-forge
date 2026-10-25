# EX-07 dependency evaluation and geometric references

W3, [#126](https://github.com/Frederik91/bim-forge/issues/126), parent [#122](https://github.com/Frederik91/bim-forge/issues/122). The coordinator reported passing validation, scoped type checking and 11 Node tests on the first module commit. Real OCP execution passed six bounded assertions on kernel attempt 3 after two binding failures. **This is not a terminal qualification result.** No registry change, production model change or PR is included.

Foundation: W0 `1911844` (repository-root normalization follow-up), PR base `feature/issue-123-qualification-contracts`. `contract.ts` uses W0's observation schema/parser and adds EX-07 identity, cardinality and duplicate checks. `run.ts` emits the frozen observation array, raw artifacts, exact registry assertion coverage, and a dataset manifest. W0 owns terminal record verification/publication and approval remains human.

## Plan and scope

| Files | Role and acceptance evidence |
| --- | --- |
| `contract.ts`, `fixture.ts`, `fixture.json` | TypeBox boundaries and W0 tiny-fixture projection with explicit W3 datum extensions |
| `evaluator.ts` | Ordered dependency graph evaluation, complete authored/evaluated entity deltas, fatal/pending staging rollback |
| `cases.ts`, `evaluator.test.ts` | Ten deterministic cases plus observation-boundary tests; independent numeric expectations and exact delta membership |
| `topology.py`, `requirements.txt` | Actual OCP/OCCT plane split, topology history and anchor classification, six observations and real BREP artifacts |
| `run.ts`, `tsconfig.json` | Shared-protocol observations, coverage, raw evidence and additional unchecked-index type checking |

W0 supplies `ground` and `first` elevations and the wall/door hosting relationships. W3 projects their identities to `level-ground`, `level-upper`, `wall`, `opening`; `dataset-manifest.json` records that mapping and both fixture hashes. All values become millimetres. The additional 200 mm wall datum offset, 1000 mm opening datum offset, 900 mm handle offset, clearance dimension and connectivity triangle are synthetic W3 extensions. The W0 door's horizontal `offset` property is **not** reinterpreted as an elevation.

The level edit changes level, wall, opening, handle and cross-level clearance; the host edit changes wall, opening, handle and clearance. Full before/after authored and evaluated states are emitted, including unchanged independent equipment for comparison. The evaluator fully recomputes this small graph; it does not claim incremental cache correctness or minimal recomputation.

Fatal ceiling violation and unresolved attachment occur at the handle after real changes have been staged. Both retain the exact baseline and expose no candidate or publishable delta. Staged differences are diagnostic `attemptedDelta` only. Retrying a valid edit must still produce the complete expected candidate. No function accepts an engineering revision. Dependency cycles fail before evaluation, while physical connectivity cycles are legal.

## Actual topology counterexample

The script imports `OCP` directly, constructs a 10 × 8 × 2 mm box, and uses `BRepAlgoAPI_Splitter` with a plane at x=5 mm. It requires valid real shapes and two modified successors of the old top face. It records actual unique face counts, areas, centroids, bounds, history candidates, kernel/wrapper versions, and baseline BREP preservation.

The comparator records what the original raw top-face index would now select. A split history with two candidates stays pending with `chosen: null`; selecting the first successor is forbidden. The top-plane datum also yields two candidates. Adding the interior point (2,3,2) must resolve one actual successor. The seam point (5,3,2) must remain ambiguous. `BRepClass_FaceClassifier` performs the classification; no simulated geometry engine is used.

The real split is followed by an explicitly adversarial traversal permutation: cyclically repackage its actual OCCT faces in a new compound so the old raw index points away from the anchored face. Classification must resolve the same physical OCCT face (`IsSame`), while the raw index demonstrably refers to another face without the anchor. The cyclic shift and classifications are preserved. This compound exercises traversal order; it is not represented as another valid solid or a naturally occurring second Boolean edit.

## Coordinator-only server commands

Do not execute builds/tests locally. The coordinator allocates a server slot and runs these commands inside its disposable containers from the committed repository root. Keep the Git object database available via the `/ssd1` bundle clone. Use a new immutable run ID and disjoint output paths. A missing Python binding, unsupported API, failed split or failed assertion remains failed evidence; do not substitute mocks or adjust expectations merely to pass.

Prepared tooling image: `bim-qvm-tools:20261025`, coordinator-reported image ID `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. Record the actual identifier and resource allocation at execution. The shared Python 3.11 venv must be active (or invoke its Python by absolute path). The OCP pin agreed with the coordinator is `8.0.1.1.0`:

```sh
python -m pip install --only-binary=:all: -r experiments/regeneration/requirements.txt
```

This also pins `cadquery-ocp-proxy==8.0.1.1.0` and `vtk==9.6.2`. VTK has further dependencies; freeze the installed environment and retain the tooling image/venv lock. The full `cadquery` application is not required.

Set `W3_EVIDENCE` to a new absolute directory on `/ssd1`, mounted at the same path in each container. Retain it independently of container lifetime. Its parent must already exist. Prepare the root once:

```sh
: "${W3_EVIDENCE:?set coordinator-allocated absolute evidence path}"
mkdir "$W3_EVIDENCE"
mkdir "$W3_EVIDENCE/logs"
git rev-parse HEAD > "$W3_EVIDENCE/source-commit.txt"
git status --porcelain > "$W3_EVIDENCE/source-status.txt"
node --version > "$W3_EVIDENCE/node-version.txt"
python --version > "$W3_EVIDENCE/python-version.txt" 2>&1
python -m pip freeze --all > "$W3_EVIDENCE/python-freeze.txt"
```

Run in the coordinator's Node container with root dependencies installed. Capture each exit status without losing subsequent evidence:

```sh
set +e
npm run validate > "$W3_EVIDENCE/logs/validate.txt" 2>&1
printf 'validate\t%s\n' "$?" >> "$W3_EVIDENCE/check-exits.tsv"
npm run test:qualification-contracts > "$W3_EVIDENCE/logs/contracts.txt" 2>&1
printf 'contracts\t%s\n' "$?" >> "$W3_EVIDENCE/check-exits.tsv"
./node_modules/.bin/tsc --project experiments/regeneration/tsconfig.json > "$W3_EVIDENCE/logs/regeneration-typecheck.txt" 2>&1
printf 'regeneration-typecheck\t%s\n' "$?" >> "$W3_EVIDENCE/check-exits.tsv"
node --test experiments/regeneration/evaluator.test.ts > "$W3_EVIDENCE/logs/regeneration-tests.txt" 2>&1
printf 'regeneration-tests\t%s\n' "$?" >> "$W3_EVIDENCE/check-exits.tsv"
```

Then run the bounded kernel case in the coordinator's Python slot. `timeout` is a server utility; if it kills the process, preserve exit 124 and the partial BREP directory as timed-out evidence. A container-level resource kill may prevent the Python error handler from completing:

```sh
set +e
timeout 180s python experiments/regeneration/topology.py --out "$W3_EVIDENCE/occt" > "$W3_EVIDENCE/logs/occt.txt" 2>&1
printf 'occt\t%s\n' "$?" >> "$W3_EVIDENCE/check-exits.tsv"
```

After the kernel process ends, run the observation adapter in the Node container:

```sh
set +e
node experiments/regeneration/run.ts --out "$W3_EVIDENCE/node" --occt "$W3_EVIDENCE/occt/observations.json" > "$W3_EVIDENCE/logs/observations.txt" 2>&1
printf 'observations\t%s\n' "$?" >> "$W3_EVIDENCE/check-exits.tsv"
node experiments/contracts/cli.ts observations "$W3_EVIDENCE/node/observations.json" > "$W3_EVIDENCE/logs/observation-contract.txt" 2>&1
printf 'observation-contract\t%s\n' "$?" >> "$W3_EVIDENCE/check-exits.tsv"
```

The runner creates `--out` exclusively; rerunning requires another path and run ID. Missing or invalid OCP observations produce an explicit failed observation. Supplying `--occt` copies and hashes the original observation bytes. Running without `--occt` is useful only for dependency preparation: it exits nonzero with `occt-not-executed` and cannot qualify EX-07. All logs and nonzero statuses must be retained, including failed attempts.

## Evidence interpretation and handoff

The server debug lease used one `bim-qvm-w3-debug` container, 0.5 CPU, 1 GiB memory and no network, against the pinned tooling image and shared Python 3.11 venv. OCP 8 moved the shape list to `OCP.collections.List_TopoDS_Shape` and the face conversion to the namespace function `TopoDS.Face`. The runner uses actual `TopExp_Explorer` traversal, deduplicating shared faces with `IsSame`, and obtains bounds via `CornerMin`/`CornerMax` to avoid the new overloaded `Get` return. No expectation was weakened.

Retained server evidence under `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/`:

- `w3-first/occt/`: coordinator's attempt 1, failed old `TopTools_IndexedMapOfShape` import.
- `w3-debug-bindings-20261025/`: installed binding signatures used to diagnose the API changes.
- `w3-debug-attempt-2/`: exit 1; failed old `TopoDS.Face_s` conversion, with raw observations and traceback retained.
- `w3-debug-attempt-3/`: exit 0; `occt.log`, `exit-status.txt`, six observations, topology descriptors and four hashed BREP artifacts.

Attempt 3 tested Python source SHA-256 `5626f425916ed87fa9c2edb03c25ec2566ee2686de7124dd45bc1c7f3b19198f`. Actual counts were 6 initial faces and 11 split/reordered faces. The top-face history had successors 2 and 9. Raw index 5 instead referred to a 16 mm² vertical face with no interior anchor. The interior point resolved to face 2, the seam point returned two candidates with no chosen face, and reordering resolved the same physical face at index 1. Baseline BREP bytes were unchanged and both solid shapes passed OCCT validity checks. These bounded observations retain the limitations below.

`node/observations.json` is an array of `{experimentId,caseId,expected,observed,passed,limitations}`. `node/dependency-artifacts.json` contains requested models, baseline snapshots, candidate/full deltas or rollback diagnostics, and assertion errors. `node/coverage.json` uses the four exact EX-07 registry assertion strings. `node/dataset-manifest.json` hashes the shared fixture and W3 extension. `occt/topology-artifacts.json` records topology descriptors, real counts and ambiguity, environment, decisions and BREP hashes. Keep the `occt/*.brep`, source-observation copy, logs and exit statuses alongside them.

No code here writes a terminal `Run`. The coordinator uses W0 `bindingFor` for design/definition bindings, `sha256` for the dataset manifest, `describeArtifact` for retained artifacts, and `verifyRun`/`publishRun` for the complete, actual run record. Populate source/runner commit, actual image/resource/slot metadata, executed commands, timing, errors and limitations from execution, never from this preparation document. Bind exactly the registry assertion set used by `coverage.json`.

The bounded topology assertion remains `partial` in coverage. Observations deliberately retain scope limitations. Under W0 v1, a run with case limitations or partial coverage cannot have conclusion `passed`; use `inconclusive` for successful bounded checks, or `failed` when the evidence rejects the hypothesis. Expected failure states (fatal/pending with correct rollback) can pass their individual assertion. This does not erase limits or imply adoption.

Once the coordinator supplies validation and reviewed runtime evidence, prepare a draft PR stacked on `feature/issue-123-qualification-contracts`. Publish any terminal record only through W0 into a fresh `docs/experiments/results/EX-07/<run-id>/`; W7 alone updates the shared registry. Do not open the PR before that evidence arrives.

Coverage limits: one-dimensional synthetic dependencies, complete recomputation, one planar OCCT split, fixed tolerance, explicit traversal permutation, and no integration between the Python anchor result and a production acceptance transaction. No general solver, parametric kernel, persistent face naming, curved/filleted topology, IFC round-trip, Revit API, storage rollback/crash durability, or production model qualification is established.

## Primary references

- [CadQuery API layers and OCP](https://cadquery.readthedocs.io/en/stable/primer.html): OCP exposes the underlying OCCT API.
- [OCCT splitter API](https://occt3d.com/dev/doc/refman/html/class_b_rep_algo_a_p_i___splitter.html): Boolean splitting and Modified/Generated/IsDeleted history.
- [OCCT face classifier](https://occt3d.com/dev/doc/refman/html/class_b_rep_class___face_classifier.html): classification of points on actual faces.
- [OCP 8.0.1.1.0 distributions](https://pypi.org/project/cadquery-ocp/8.0.1.1.0/): published Python wheel targets and pinned package.
