# W1 semantic qualification

This source slice belongs to [#124](https://github.com/Frederik91/bim-forge/issues/124), under [#122](https://github.com/Frederik91/bim-forge/issues/122). Its module commit is rebased onto W0 contract v1, `19118447930f41218bc732466b55442e5d83adf5`, on `feature/issue-124-qualification-semantic`. The intended draft PR base is `feature/issue-123-qualification-contracts`.

Execution status: the coordinator reported that the first baseline server run passed root validation and scoped typechecking, with 65 of 66 tests passing. CLI binding failed because W0 supplied Git's safe-directory value with a trailing slash. W0 owns that fix. The candidate source added after that run remains unexecuted. No local builds or tests have run. The coordinator allocates server containers and supplies validation evidence before a draft PR opens.

The implementation exercises `src/room-model.ts` with its existing room shell and `src/asset-fixture.ts` assets. `fixture.ts` adds four deterministic furnishings and uses a fixed disposable project ID. No product code, package scripts, shared registry, or design files change. Raw cases label `baseline-room-model` and `VM-C1-semantic-prototype` separately. VM-C1 remains proposed and unqualified.

## Files and acceptance evidence

| File | Purpose |
| --- | --- |
| `fixture.ts` | Deterministic native shell, furniture, and asset inputs; calls the real proposal and acceptance APIs |
| `protocol.ts` | Imports W0's authoritative TypeBox observation contract, then checks W1 scope and unique case IDs |
| `coverage.ts` | Maps every exact registry assertion to case IDs with complete, partial, or missing coverage |
| `identity.ts` | EX-01 native identity, restore, duplicate IDs, churn, split/merge, and EX-03 occurrence/family isolation |
| `concurrency.ts` | EX-04 independent orders, cross-object occupancy, phantom insertion, retries; EX-05 changed assumptions; EX-06 field conflicts and dependent heights |
| `candidate.ts` | Isolated VM-C1 proposal, reconciliation, predicate, field-rule, lineage, and command-receipt prototype |
| `candidate-cases.ts` | Repeats the targeted baseline inputs and expectation text against the candidate, including both acceptance orders |
| `runner.ts` | Collects observations and matching raw artifacts |
| `cli.ts` | Writes raw evidence into a new directory and emits the observation array to stdout |
| `semantic.test.ts` | Checks actual accepted values, deltas, restored histories, expected gaps, determinism, schemas, and CLI output integrity |
| `tsconfig.json` | Extends repository strict options for an optional additional scoped typecheck |

The CLI emits exactly `{experimentId, caseId, expected, observed, passed, limitations}[]`. It stores input snapshots, serialized proposal/application records, exact deltas, operations, errors, and independent predicate calculations in `raw.json`. W0's `bindingFor` binds committed design, definition, fixture, schema, writer, and runner bytes. The parsed W0 tiny fixture is retained with an explicit description of how it differs from the native operation fixtures.

`coverage.json` accounts for every exact assertion in each W1 definition separately for both variants. Changed definitions or unobserved baseline case references fail collection. Candidate coverage includes only cases that actually execute; missing counterparts remain partial or not covered. W0's `describeArtifact` supplies hashes for `raw.json` and `coverage.json` in `manifest.json`. Files are created exclusively. Reusing a directory fails before case execution and never replaces old evidence. An interrupted run can leave an incomplete directory; preserve it and choose a fresh run ID.

Successful collection exits zero even when observations fail. Qualification depends on each `passed` value and full experiment coverage. Exceptions exit nonzero. The node tests assert current baseline limitations as well as supported behavior, so passing tests do not mean every experiment passed. An unexpected baseline behavior change requires review of the observations and assertions.

## Expected baseline limitations

These are source-review expectations, awaiting server execution:

- EX-01 should retain native IDs and exact restore bytes, distinguish identical chair shapes at separate placements, and reject duplicate native IDs. Object churn and split/merge expose only removal/addition deltas. The baseline rejects a lineage field. Paired real exports remain explicitly not covered until W2 supplies actual artifacts.
- EX-03 should isolate an occurrence resize and reject an in-place family rewrite. An explicit new family ID rebinds exactly the listed instances. General property dictionaries, unit definitions, and content deduplication remain unqualified; recipe isolation does not establish those capabilities.
- EX-04 should preserve independent desk/bed edits in either order and reject actual overlap between different objects. A phantom chair occupies a reserved clearance region without intersecting the desk footprint. The independent region oracle should fail while baseline acceptance succeeds. An exact `acceptFrom` retry should reject an already decided proposal, while `accept` should return an old decision even if its supplied actor changes. Both outcomes expose missing command/payload retry semantics.
- EX-05 should accept a geometrically valid desk proposal after the north wall moves, changing the declared 0.4 m gap to 1.4 m. The baseline records intent text but does not evaluate that relationship. A separate case checks that unrelated applications have actual applied revisions and deltas but no explicit approval-equivalence record.
- EX-06 should conservatively reject name/classification changes on one entity, exposing the lack of field rules. The proposed independent-field rule applies only to a chair-to-plant classification with identical dimensions, placement, and no dependants. It is an oracle, not an installed merger. Divergent names should conflict. Canonical units should reject `mm`, and separately valid desk/ceiling heights should fail combined clearance validation. General derived property regeneration remains unqualified.

Fixture worker labels and acceptance actors are marked as fixtures. The stored tool-call entry is fixture metadata required by the existing review API; no AI tool invocation is claimed. The code invokes acceptance only in disposable in-memory state to observe bookkeeping. No observation, decision ID, test, or CLI exit code represents human approval or adoption authority.

## Compare the minimal VM-C1 prototype

The caller creates `SemanticCandidate` from the same native snapshot, calls `draft` with a target snapshot and typed predicate/rule/lineage declarations, then passes the draft and fixture actor to `apply`. The result contains a new immutable state and the exact application receipt. The state calls the current product's `validateSnapshot`, `diffSnapshots`, `furnitureFootprint`, and rectangular-room checks. It does not invoke or modify product acceptance.

A wrapper around `RoomRepository.acceptFrom` could add precondition checks but could not demonstrate an independent field merger because baseline acceptance rejects the entire changed entity. The separate envelope therefore implements the experimental reconciliation and retains the native snapshot validator. This is the only additional model path, and it remains inside this module.

The prototype adds these bounded behaviors:

- Empty-region and north-wall-gap predicates run against the complete combined candidate. Accepted predicates remain attached to the model revision and run again on later edits. Tests cover insertion and moved-wall changes in both orders. Unsupported occupancy types and out-of-room regions reject. Predicate changes participate in revision identity.
- The named `isolated-furniture-name-kind-v1` rule permits only chair/plant classification and name changes on one floor occurrence without a support with unchanged dimensions, placement, rotation, and no dependants or relationships. Both concurrent applications must declare the rule. Missing rules, authored shape changes, and divergent values still conflict. The complete combined snapshot must validate.
- Replacement, split, and merge lineage names exactly the removed and added native identities. Missing, duplicate, fabricated, or resurrected identity endpoints reject. Lineage is retained in the new revision and receipt. It does not prove physical equivalence or source-export identity.
- Command receipts bind the full canonical proposal payload and actor. Exact retries return the original receipt without rewinding a later head. Reusing a command ID with a changed actor, predicate, or rule rejects. A different command ID cannot apply the same proposal again. Receipt publication occurs only after reconciliation, predicates, lineage, and native validators succeed.
- Reconciled applications record `native-delta-and-predicates-v1`, the selected field rule, the actual predicate checks, and the application delta. This is fixture equivalence evidence, not human approval reuse.

Candidate case IDs prefix the matching baseline ID with `vmc1-` and reuse its expectation text. Raw artifacts link the baseline ID and capture actual candidate drafts, errors, immutable states, receipts, and deltas. Baseline observations and tests retain their original expectations. The candidate covers the targeted semantic gaps plus independent, overlap, divergent-field, and unit/ceiling controls. It does not rerun every baseline case or fill missing EX-03 property dictionary and paired-export coverage.

The prototype is synchronous and in memory. It has no persistence adapter, restored receipt replay, concurrent writers, compare-and-swap publication, crash recovery, complete version index, configurable property dictionary, or general geometry engine. Predicate retirement is deliberately absent, so accepted constraints can over-restrict later intentional changes. Retain these limitations in the W0 run records even if the bounded comparison cases pass.

## Run in the coordinator's server slot

Use the coordinator's disposable `bim-qvm-tools:20261025` container, image ID `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`. Supply the committed Git bundle clone on `/ssd1`, make the image's root dependencies available to that checkout, and mount an isolated writable `/evidence` directory. Copy source with `cp -R` when a copy is needed; the coordinator's container requires owned files rather than preserved ownership from `cp -a`. The full Git object database is required by `bindingFor`; a source-only archive is insufficient. The raw artifact includes `sourceGit` metadata. The coordinator records actual resources and slot. Run from the repository root:

```sh
npm run validate
npm run test:qualification-contracts
node node_modules/typescript/bin/tsc --noEmit --project experiments/semantic/tsconfig.json
node --test experiments/semantic/semantic.test.ts src/room-model.test.ts src/asset-family.test.ts src/asset-history.test.ts src/asset-placement.test.ts
RUN_ID="w1-124-$(node -p 'crypto.randomUUID()')"
mkdir -p /evidence
node experiments/semantic/cli.ts --artifacts "/evidence/$RUN_ID" > "/evidence/$RUN_ID-observations.json"
node experiments/contracts/cli.ts observations "/evidence/$RUN_ID-observations.json"
```

The coordinator can inspect the scoped source policy without changing shared scripts:

```sh
git diff --name-only 19118447930f41218bc732466b55442e5d83adf5 HEAD
git -c core.whitespace=cr-at-eol diff --check 19118447930f41218bc732466b55442e5d83adf5 HEAD
```

W0 extends the root lint and TypeScript config to include `experiments` and `benchmarks`. The explicit stream typecheck is an additional focused check; `npm run validate` covers W1 too. No shared package script changes are part of this module.

## Integrate W0 and W2

The collector imports W0's observation schema and type from `experiments/contracts/schema.ts` and its binding and artifact functions from `records.ts`. `authoritativeW0ContractCommit` records `19118447930f41218bc732466b55442e5d83adf5`. It does not invent a parallel terminal-result contract. Actual environment, execution times, and run IDs must come from the coordinator's server run before W0's `verifyRun` and `publishRun` can produce an authoritative result. This source slice creates no terminal result, registry update, or review record.

For each experiment and variant, the coordinator binds only that variant's matching observations, `coverage.json` entry, and raw artifacts into W0's result record, with a unique `docs/experiments/results/<EX-ID>/<run-id>/` destination. Preserve raw hashes and failed observations. Missing W2 exports, partial coverage, and case limitations prevent a passed conclusion. W0 refuses a passed run with limited observations. Do not combine baseline failures with candidate results or convert process success or passing unit tests into an experiment approval.

The W2 paired-export case must consume real artifact paths, source metadata, and hashes before its coverage changes. This slice supplies no external-engine substitute and does not qualify IFC exchange, persistence, concurrency across processes, crash recovery, or engineering geometry.
