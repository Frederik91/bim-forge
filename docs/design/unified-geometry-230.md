# Unified geometry and external IFC revisions

Parent [#230](https://github.com/Frederik91/bim-forge/issues/230). Exact base
`f4285c644e52b5bdba8e4f6afeb6e099bc02b891`, research PR228 over unmerged PR224.
This design is the coordination record; source contracts and qualified behavior must agree with it.
No merge is authorized. The owner requests a complete, adversarially tested merge handoff.

## Work phases

- [x] Ground existing source, native acceptance, query research and deployment constraints.
- [x] Compare immutable evaluated-read-model and per-source-provider design candidates.
- [x] Synthesize the initial contract and publish separate ownership.
- [ ] Implement the three tracks, reviewing material seam changes here.
- [ ] Combine actual source, validate on the server and fix reproduced defects.
- [ ] Exercise real connected-agent UI workflows and difficult external update cases.
- [ ] Audit every requirement against retained evidence; publish a qualified preview/draft PR.
- [ ] Replace the design if repeated implementation workarounds contradict its ownership.

## Problem and authority

The viewer already receives converted IFC meshes, but agent requests receive properties/identity.
Native definitions and immutable external IFC sources remain authoritative in their own domains.
`RoomRepository` retains native proposal/reconciliation/acceptance authority. The derived geometry
read model has no acceptance or linked-write capability. Source text and user selection are context,
not permissions or proof of geometry completeness.

Native evaluation must include hosting, family/level placement and opening/roof dependencies. IFC
evaluation composes product-to-source and occurrence-to-project once in engineering metres, with
explicit source units, representation and approximation diagnostics. Viewer origin changes are not
measurement transforms. Missing shape/placement and unsupported geometry remain explicit.

## Usage and shape

The AI uses one `geometry` namespace for native and linked objects. Source kind is reference metadata,
not a second method family. The caller discovers/describes objects, queries relations and measures a
candidate; the host owns spatial arithmetic, completeness, budgets, receipts and independent validation.

```text
native snapshot + current prepared IFC versions
       -> immutable evaluated read context
       -> describe / query / relations / measure
       -> trusted object projections + predicate read observations
       -> native proposal, relevant revalidation, explicit human acceptance
```

The shared source contract belongs to #231 (`src/geometry-contract.ts`). It derives wire types from
TypeBox and supplies qualified native/IFC references, finite project-coordinate geometry, explicit
complete/partial/unavailable unions, descriptions, queries, relations, measurements and read receipts.
The constructor consumes an authorized native snapshot plus immutable prepared linked inputs. It
must not read a second authoritative entity database or expose source storage internals to the guest.
Exact exported names are published by #231 before consumer implementation freezes.

Measurements bind the candidate shape and full obstacle query, not just IDs returned on a page.
Bounds provide lower-bound discovery; narrow-phase shape checks establish the supported distance,
intersection or containment predicate. Distinguish contact, inside, support and passage semantics.
Return witnesses, numeric tolerance and representation limits. Mesh-relative correctness is not an
exact-original-solid claim. Unsupported operations cannot become clearance certificates.

One request uses a frozen read context; pagination shares its complete candidate-set signature.
Host-generated receipts accumulate automatically, and the guest cannot omit or forge observations.
Object projections fingerprint consumed geometry/transform/semantics and evaluated dependencies.
Predicate observations fingerprint complete matching membership, including absence and missing data.
An added obstacle/new active link/moved-in object can invalidate an empty-region result. Relevant
native mutations require measurements of the final candidate, including after reconciliation.

## External link lifecycle and freshness

#232 owns a stable project link and occurrence, immutable source/prepared versions, versioned project
placement, candidate jobs, correspondence and atomic adoption. Legacy installed links must remain
available. A new version is prepared separately; failure/cancel/restart leaves current geometry intact.
The UI shows a readable property inspector, candidate status, semantic/source delta, version history,
original downloads and explicit adoption. Retention is bounded visibly without silently deleting pins.

Historical references keep the exact version inspected. Applicability across replacements is a new
attestation comparing relevant projections/predicates under verified identity correspondence. Do not
rewrite old references, equate GlobalIds across namespaces/occurrences, infer correspondence from names
or treat a whole-file source hash change as blanket model staleness. Ambiguity is a visible result.

The linked store must expose small project-authorized seams for current catalog snapshots, historical
prepared-version resolution and a final catalog/publication guard. A snapshot identifies current
link/source/occurrence/placement versions and an optimistic catalog token. This catalog token is only
a concurrency fence: it must not itself decide semantic staleness.

Proposed coordination contract (implementation names may be improved by the owner):

```text
snapshotCurrent(projectId) -> immutable catalog token + current linked prepared inputs
readVersion(projectId, qualified version reference) -> immutable historical prepared input
withCatalogGuard(projectId, expectedCatalogToken, synchronousCommit) -> result | catalog-changed
```

#233 revalidates geometry observations against the current native/linked read context outside the
short final publication critical section. It then publishes the already computed native decision
under the guard and existing native transaction. A changed catalog restarts bounded revalidation;
an unrelated source edit is not rejected merely for a changed catalog token. Relevant changes need
fresh measurement/proposal evidence, never silent acceptance of stale clearance.

The separate linked SQLite and native SQLite stores need a cross-process publication/adoption fence.
A synchronous in-process callback alone is insufficient if another process can adopt. Candidate
design: reserve the linked catalog with a short `BEGIN IMMEDIATE` transaction, compare the optimistic
token and execute the synchronous native publication before releasing it. No geometry work or awaits
inside that section. Both tracks must examine lock ordering, nested transactions, failure recovery
and supported application-instance assumptions before committing to that mechanism. Parent will
review the actual seam; no lock may create a second native acceptance authority.

## Synthesis decision

Two read-only design agents inspected exact base f4285c6. Candidate A materializes immutable normalized
facts/indexes with shared shape references. Candidate B executes over per-source pinned providers.
Both converge on one query surface, source-bound immutable reads, independent geometric refinement,
predicate-based absence freshness and guarded publication. The parent selects A's coherent evaluated
read context and grafts B's lazy source-local shape/acceleration reuse and source-capability handling.
No second canonical entity store and no duplicated native-versus-IFC public query families.

Rubric: uniform caller surface; evaluated dependency and absence correctness; relevant-only freshness;
bounded resource/representation cost; atomic adoption/acceptance and maintainable ownership. A wins
coherent query membership and consumer simplicity; B wins potential lazy shape reuse. Both need a new
catalog guard and real IFC qualification. There was no independent cross-family judge: the available
delegation tools require the inherited model unless the owner requests another model. Parent review
screens both candidates for duplicated authority, exposed internals, duplicated method families and
hand-maintained contract lists. Tests must try to disprove this synthesis.

## Ownership and mount seams

| Owner | Writable scope | Shared seam |
| --- | --- | --- |
| #231 geometry session | New `src/geometry-contract/query/math/native*.ts`, pure host read assembly and tests; excludes #233 evidence files | TypeBox contract, normalized read context, query/measure, trusted receipt/revalidation primitives |
| #232 IFC revisions session | `src/linked-model.ts`, linked store/routes/client/panel and tests, conversion worker only if needed | Current/historical prepared inputs, catalog guard, stable display/occurrence identity |
| #233 ScriptBox/evidence session | Script/proposal/review evidence, native queue/versioned store acceptance plumbing and tests | Injected geometry context, automatic read receipts, final guarded publication |
| Parent #230 | This record; `demo/server.ts`, `demo/room-app.ts`, viewer/render mounts, package/Docker registration, combined QA | One mounted viewer/chat, bound request selection, runtime wiring and final qualification |
| #234 independent QA | New `experiments/geometry-qualification-230/` and `demo/geometry-workflow-browser.test.ts` | Real deterministic IFC/version fixtures, independent geometry oracle and browser/edge-case evidence |

Every writer has its own checkout. Changes to ownership must be agreed and recorded before edits.
Component PRs base on the parent branch once published; final integration remains one coherent issue.
Research PR228 and foundation PR224 remain traceable dependencies, not silently closed/superseded PRs.

Sessions: [geometry](codex://threads/01a18417-ed3d-7c23-aa12-e49d80f1e6b3),
[IFC revisions](codex://threads/01a18417-f0d3-73a2-83ed-878d92cf9026),
[ScriptBox/evidence](codex://threads/01a18417-f76a-7250-9322-b99b2a4b857b),
[independent QA](codex://threads/01a1841b-c906-7b93-be0f-fc8ee2ca5898).

Initial concrete construction seam published by #231: `createGeometryContext` consumes authorized
project/native snapshot/revision/target plus immutable linked prepared inputs, and exposes the same
four operations plus host-retained receipts. Its `validateGeometryReceipts` checks relevant
projections/predicate membership and requires verified correspondence across source versions. Exact
TypeBox exports remain with #231; consumers must use those exports instead of duplicating schemas.
#232 proposed `snapshot`/`resolve`, staged replacement review and synchronous CAS adoption/placement.
#233 owns the injected request context and final native publication callback. Native frozen readable
scopes remain enforced; obtaining a convenient full snapshot cannot widen guest permissions.

Guard review must cover separate connections/processes, lock ordering and rejection of asynchronous
callbacks/thenables at runtime. Existing converter job/source/occurrence identity coupling must be
changed and tested at the actual artifact boundary where stable link occurrences span version jobs.

## Requirements and evidence matrix

All rows are unproven until exact current-source evidence is retained. A green narrow test cannot
prove a broader row. Parent keeps raw red/green failures and an edge-case ledger with root cause,
fix, source, command, result and remaining limitation.

| Requirement | Required evidence | State |
| --- | --- | --- |
| One native/IFC geometry interface | Actual generated guest tools/docs and equivalent native/IFC tasks | Pending |
| Coordinates, units, identity, occurrence | Real converted mm/metre, composed rotation/translation, duplicate GlobalId/occurrence fixtures | Pending |
| Shape-aware measurements | Independent clearance/intersection/containment oracle, doorway/L-shape/enclosed-candidate/contact fixtures | Pending |
| Complete bounded queries | Pagination, missing meshes, candidate-set absence, limits and hard deadline tests | Pending |
| Authorized geometry domain | Frozen native readable IDs and relations only, private host/family evaluation, explicit restricted-domain coverage and domain-bound freshness | Pending |
| Repeated external update | UI v1/v2/v3 replacement, semantic delta, adoption, historical original/source pins | Pending |
| Failure and concurrency | Conversion failure/restart/cancel, CAS adoption/placement races, cross-process publication fence | Pending |
| Relevant-only freshness | Moved referenced wall/new obstruction/removed identity blocked; unrelated source edit remains acceptable | Pending |
| Trusted proposal evidence | Forged receipt/source text, cross-project handle, stale/late result, final candidate/reconciled-state checks | Pending |
| Real AI geometry use | UI linked-wall request, actual query activity, unaccepted native proposal, independently verified 500 mm clearance | Pending |
| Baseline/accepted data preservation | Explicit alternative acceptance, unchanged Main/As-is, accepted/source/auth cutover receipts | Pending |
| Usable desktop and phone UI | Browser screenshots/traces of properties, replacement/adoption and chat review, no overflow or duplicate viewer | Pending |
| Repository and actual image | Server root validate, explicit changed paths, appropriate full suites, actual-image converter isolation/recovery | Pending |
| Merge readiness | Exact combined draft head, required green CI/review evidence, retained rollback and qualified server preview | Pending |

## Qualification boundary and initial ledger

Build/test only in bounded isolated server containers, read-only source/dependencies and network off;
all source bundles, cache, dependencies, artifacts and temp stay on `/ssd1`. Connected-provider/UI work
uses synthetic test projects and the existing authorized connection. Do not copy credentials, mutate
existing user projects, weaken validators, restart factory loops or touch the independent viewer work.

Owner's ten-total-attempt allowance applies to each new interactive item, with cause inspection and
retained failures. It does not reopen exhausted worker218. No GitHub merge or protection change is
authorized. Publish qualified combined changes to preview under standing deployment authorization,
with paired browser/runtime rollback and accepted/source/auth preservation.

Initial resource probe: SSH to `192.168.1.17:22` timed out; a separate bounded HTTPS health connection
also timed out. No test/container ran. Continue code/design work while the server is unavailable;
do not substitute local tests or repeatedly consume attempts on an unreachable host.

### Parent findings before executable qualification

- Server remains unreachable on a subsequent bounded SSH probe. Read-only route inspection shows
  the server-specific `/32` route uses Twingate, ahead of the Wi-Fi subnet route. This narrows the
  availability investigation; no route, VPN, firewall, credential or security setting was changed.
  The owner has a pending asynchronous server/address question. No implementation test has run.
- #231 draft used a constructor parameter property despite `erasableSyntaxOnly: true`. Parent
  requested an explicit field/assignment and a corrected source before qualification.
- #231 draft containment returned solid distance zero with separated nearest-boundary witnesses.
  Parent requested consistent witness semantics plus an independent regression assertion. This is
  static inspection, not an executed pass/failure or a claim of a verified fix.
- Some #231 draft files initially landed in the session visualization directory rather than its
  Git checkout. Parent requested absolute owned source paths and an early schema commit for #233.
  Shell startup profiles also reset worker working directories: workers were instructed to set
  the outer `exec_command` to `login:false`, an explicit shell and exact workdir; an inner
  `pwsh -NoProfile` alone does not fix a parent shell that already changed directories.
- Parent prepared ignored `artifacts/private/qualify230.sh` for isolated root validation/build/full
  tests, explicit all-changed-path policy, pinned tools image and retained logs/inspection. It is
  not executed or qualified. Browser, actual-image, live-provider, independent-oracle and preservation
  gates remain separate and cannot be inferred from that runner's exit code.

### First executable source integration (not qualified)

- Composed #231 core `3063bd210995d47a66f7839d02f9eb76415e435e` locally, retaining its
  history. The shared contract now includes source-neutral categories and bounded surface
  samples. Source-level unavailable metadata makes spatial completeness explicit. The pure
  synchronous executor is not yet the live product boundary: its owner is adding a hard-
  terminated asynchronous worker session before live tool wiring.
- Composed #234 initial harness `faa6a80274adce99aaf8758d786e52d082e17391` locally.
  Its runner and README were inspected; the fixture generator, independent oracle and browser
  assertions are source only. No IFC fixture generation, runtime test or browser check has run.
  All qualification-matrix rows above remain pending.
- Static inspection identified a possible zero-clearance certification defect in the core:
  volume overlap can reach the nonnegative distance comparison and report satisfied clearance.
  Sent to #231 and independent QA for explicit contained/overlapping/contact/separated cases.
  This is an inspection finding, not a reproduced failure or verified correction.
- Static inspection also found semantic context discovery marked partial whenever a Level or
  Space intentionally has no solid representation. Its owner must separate complete identity
  discovery from proof of a spatial predicate or solid clearance; accepting incomplete physical
  clearance receipts is not an acceptable workaround.
- The initial native input has no authorized readable-ID domain. Filtering the snapshot before
  evaluation can lose hosts/families; exposing the complete private graph violates frozen request
  scope. #231 and #233 must supply full private evaluation input plus a host-derived public domain,
  prune unreadable relations, identify restricted coverage, and bind that domain into freshness.
  Scoped absence must never be presented as a whole-project clearance certificate. This structural
  gap was observed in committed source; no leakage test has yet executed.
- Initial UI submission still includes the preceding implicit native selection while a linked
  object is selected. The existing parser requires a native anchor. Parent and #233 are resolving
  the legitimate authoring context without silently targeting the preceding door/desk, discarding
  explicitly attached native visuals, or weakening the validator to hide the mismatch. Browser
  qualification must inspect the actual submitted context, not just the visible action label.
- Parent UI source `1b58d0bb322bb410f80a745bee3e43efb7aa56eb` aligns Ask, Properties and
  native Move visibility with the actual linked selection. Context attachment checks the full
  source/occurrence/placement pin before combining it with current properties. Independent
  browser coverage is being extended; these source changes are not yet qualified.
- Latest bounded SSH probe still timed out. No server container started, no new preview was
  published, and no GitHub PR was merged. #232 versioned storage and #233 trusted proposal
  evidence/final publication wiring remain in their dedicated sessions.

### Browser registration and connected-trial preflight

- Parent integrated #234 follow-up `423bfc37c0de68c9e4bee805eded8a5418e7f2ec` and registered
  `npm run test:geometry-workflow`. It requires the isolated server-container environment,
  generated fixture files, a reserved converter spool, and a built demo. It is not a local
  smoke test and does not silently replace the connected-provider or acceptance gates.
- The source checks cover native-to-linked selection actions and exact unsent source pins,
  including two sources reusing a GlobalId. Preserving the native picker is not proof of the
  submitted request's intended native selection; actual payload context remains a live-UI gate.
- The generated IFC is translated and elevated by its building/storey placements, whereas the
  default native room is near the origin at zero elevation. Native assets require a bound room
  and have no world-placement/elevation override. QA must generate an ordinary broad receiving
  room at the proper level, validate it on server, and import through the normal project UI.
  Do not reposition or axis-align the IFC for an answer-specific trial, or expose oracle facts.
- Reviewed #231's staged asynchronous session source without treating it as a committed handback.
  Construction/operation hard termination exists in the draft, but its default 60-second lifetime
  is shorter than the existing 120-second provider turn. Owners must align the request lifecycle
  and cleanup without disabling per-operation deadlines. No runtime timing claim is qualified.

### Source integration after command approvals cleared

- Owner cleared the expected command approvals. #233 confirmed that its geometry-evidence source
  write had been waiting for approval and has now returned. Component sessions are progressing;
  none was restarted. Server SSH still timed out on the fresh connectivity check.
- Parent composed #231 `3cb9db6f15fa51b14b2f2123a6ff76c9e04d2b63`: asynchronous geometry session,
  private worker message protocol, worker-based receipt replay and adversarial query tests.
  Registered `npm run test:geometry` and included it in the standard `npm test` chain so these
  checks cannot be omitted from the combined default suite. No dependency or lockfile change.
- That committed core explicitly refuses zero-clearance satisfaction for volume overlap and
  containment. Its tests and worker boundary remain unrun. Native readable-domain, semantic
  discovery and extended-lifetime corrections are still in #231's next source handback; do not
  infer that those fixes are present merely because the worker files have been integrated.

### Combined source checkpoints (still unqualified)

| Component | Exact locally composed source | Implementation present; runtime evidence still missing |
| --- | --- | --- |
| Geometry #231 | `c150e715ccb9a60f5c85f31ba4f07587c95b9da3` | Readable native domain, filtered relations, discovery/measurement receipts, canonical public-result verification, worker lifecycle/concurrency and focused tests |
| IFC updates #232 | `8556f7d53eca98d799a7fb883b35bf90c4747d90` | Immutable unique versions, retained legacy pins, staged review/adopt/history/placement UI, catalog guard and retry/resolution fixes |
| Independent QA #234 | `52c5da0ff493880c45c0524b6fd17a0c5c6bd7c3` | Receiving-native generator, real-IFC versus withheld prism runtime probes, prerequisite-bound server runner and UI import source |

`npm run test:linked-revisions` is registered in the default `npm test` chain alongside geometry.
These are local Git composition checkpoints, not GitHub merges or passing qualification results.
Two bounded read-only reviews examine the geometry boundary and IFC publication/history guard
while parent completes proposal/server wiring. Reviewers may not run local tests or edit owned
component files. All acceptance-evidence matrix entries above remain pending.

The bounded static reviews found five additional issues, with no runtime reproduction claimed:

- IFC current resolution could select an earlier preparation of identical source bytes, and the
  adoption retry shortcut could acknowledge a stale request after an intervening placement.
  #232 source `50f862e` fixes both and adds controls; those controls remain unrun.
- Geometry query exclusions could discard stale pins by reducing them to identity; discovery
  receipts consumed unreturned geometry; worker replies did not verify their public payload
  against the receipt result digest. #231 source `c150e71` adds explicit-pin checks, separate
  discovery/measurement observations and verified public result digests, with unrun controls.
- Source-version identity must use the immutable version/job ID, with `originalSha256` reserved
  for integrity and content deduplication. Reusing the content hash as the revision token makes
  exact historical preparation identity ambiguous after repeated unchanged exports. #232 is
  source `8556f7d` updates the unpublished producer/private-worker contract and tests together. Exact-base
  inspection corrected an earlier parent assumption: pre-feature jobs used the content hash
  as revision. Preserve those retained records/pins; the worker validates one general bounded
  revision token, which naturally accepts existing hashes and new IDs. No live data conversion
  or hash-specific compatibility layer is required.
- The proposal data provider must receive only the consumed historical IFC references when
  computing verified correspondences. Eagerly enumerating every object in every retained
  version would violate bounded resource goals and the worker message/pair limits. Parent/#233
  are adding that host-only input before server wiring, preserving full current-catalog coverage.

No repository server runner is registered in the GitHub runner query; the existing validation
workflow uses a hosted runner. It cannot substitute for the owner's required server-container
qualification. No runner, workflow, network route or VPN settings were changed.

The unsent linked-context attachment now includes a full `GeometryRef`, including project,
source version, occurrence and placement digest. Browser WebCrypto hashes the canonical matrix
array, avoiding a Node-only dependency in the browser and allowing the agent to call the same
`describe` API directly from the pin. Reference preparation rechecks chat/design/project and
current source identity after hashing; Send stays gated until preparation/upload completes.
This changes no accepted model or approval authority. Independent browser assertions are being
extended; the new UI behavior has not yet been built or exercised on the server.

Primary IFC selection now clears the native 3D highlight and omits the preceding implicit native
object from a new request. Explicit native visual attachments and room/level navigation context
are retained. The matching #233 input contract must allow deliberate project-context requests
with no selected native objects; a formerly nonempty selection lost during rebase must not
silently broaden into project context. That parser/rebase change and actual sent-payload UI
evidence are still pending, so the source combination is not ready for deployment.

### Restored server and first combined qualification

Owner cleared the expected command approvals. SSH recovered on 29 October; the preview remains
at its prior executable. The server has approximately 4.6 GiB available memory and almost no
free swap, so parent reserves one serial 2 CPU / 3 GiB / no-swap qualification slot. Source,
dependencies and containers remain read-only/network-off with writable evidence/temp on SSD.

Root attempt 1 at `88daaa82e38f3491d62b0866ba458bbf0bbada2c` passed strict lint (306 source
files), then failed TypeScript at `src/geometry-query.ts:219`: narrowing of an optional level
reference did not survive a callback. No tests ran. Logs and stopped container are retained in
`/ssd1/bim-forge-qualification/issue230/run-88daaa82e38f3491d62b0866ba458bbf0bbada2c-component-01`.
Source correction `e7b24a5` captures the validated identity before the callback; it changes no
validator or semantics and awaits rerun.

Parent has composed #233 through `bfb9db5`, including explicit empty native-selection semantics,
browser-safe evidence restoration, trusted request-attempt receipts, final-candidate measurement
replay, and source-guarded acceptance. `test:geometry-evidence` registers its two test files plus
the parent provider tests in default `npm test`. The server injects `demo/geometry-source.ts`;
the production image allowlist and COPY include that module. Native-only requests keep the same
interface. Authorization precedes source reads. Only consumed historical references are resolved,
with one preparation cached per version/placement during each snapshot; all unavailable active
links remain explicit. #232 `2b783b1` supplies the exact retained-pin lookup without requiring a
caller-supplied matrix or loading every historical mesh.

Independent static follow-ups confirm the prior three geometry and two IFC findings are
addressed in source. A separate provider review found no concrete defect given the source owner's
exact-pin contract. These are source reviews, not runtime receipts. Ordinary floor contact remains
a known qualification blocker: #231 is adding a geometric nonpenetration certificate and controls;
#233 must accept only certified contact while retaining ambiguous-contact/penetration rejection.
All live-provider, converter/oracle, actual-image, browser, preservation and deployment gates remain pending.
