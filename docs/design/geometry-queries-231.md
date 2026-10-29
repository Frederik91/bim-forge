# Unified geometry read contract

Component [#231](https://github.com/Frederik91/bim-forge/issues/231) of
[integration #230](https://github.com/Frederik91/bim-forge/issues/230).
Implementation base: `f4285c644e52b5bdba8e4f6afeb6e099bc02b891`.
This component changes derived read records and calculations. Native model delta is empty.

Qualification status on 2026-10-29: **kernel checks pass in parent integration; product qualification pending**.
The parent reported attempt 4 at `aee595c4217273b09814353bb645c25841ee49c5`: root validation on 315 sources, explicit policy on 97 paths,
geometry 31/31, and geometry-source integration 3/3 passed, including the clearance and canonical-array corrections.
Combined ScriptBox, final acceptance, real converter, and connected UI checks remain pending.
The parent reserves the sole serial qualification slot. No child server runs or local substitutes occurred.

## Host construction and authority

`createGeometryContext` in `src/geometry-query.ts` constructs a pure synchronous read model.
Its input contains `projectId`, `native`, `linked`, optional `unavailableSources`, and lowered optional `limits`.
`native` contains the complete authorized evaluation `snapshot`, `revisionId`, `target`, and optional `readableIds`.
The full native graph supplies level, host, roof, family, and opening dependencies.
Only the identities in `readableIds` and relationships to visible targets reach a scoped caller.
Omitting `readableIds` means project-authorized native access. An empty array exposes no native objects.
This distinction belongs to trusted host construction. Guest inputs cannot change it.

`linked` contains immutable `LinkedPrepared` occurrences from the authorized current catalog.
An active source whose artifacts cannot be resolved belongs in `unavailableSources` as `{id,reason}`.
A staged or failed replacement does not make an available current version unavailable.
The context does not fetch sources, resolve databases, clone accepted native history, or grant write authority.
Scope filtering never substitutes a partial snapshot for the complete private evaluation graph.

Every receipt identifies its authorized domain. Query pages and measurements also expose that domain.
`authorized-native-scope` means completeness within the supplied scope, not whole-project absence.
An acceptance policy that needs project-wide collision checks needs a project-authorized validation context.

## Four caller operations

`src/geometry-contract.ts` owns TypeBox schemas and schema-derived wire types.
Fixed coordinate and matrix arrays use homogeneous `Type.Array` schemas with equal minimum and maximum lengths.
They accept the same JSON as the former homogeneous tuples while avoiding tuple-only keywords outside ScriptBox's closed schema subset.
All public wire types remain derived through `Static`. The math kernel retains fixed `Vec3` tuples and `MathBounds`.
`vector3` validates and constructs a triple where wire box bounds enter the kernel. No casts, unsafe schemas, schema stripping, or second wire family are used.
The canonical `uniqueItems:true` constraints on query classes and categories remain intact.
The parent and ScriptBox owner are auditing all nested schema keywords before another guest bootstrap attempt.
The array representation correction alone does not claim full compatibility with ScriptBox 0.1.1.
Both source kinds use `describe`, `query`, `relations`, and `measure`.
Qualified references preserve project, native target or source namespace, revision, source hash, occurrence, and placement identity.
An IFC reference has read-only authority. A native reference retains human review authority.

`query({query,cursor?,limit?})` supports normalized `categories`, original `classes`, `role`, `region`, `level`, and explicit `exclude` identities.
For example, `categories:['wall']` discovers both native `Wall` and `IfcWall` objects.
The default role is physical. Semantic level and space discovery uses `role:'context'`.
Nonspatial identity discovery does not require physical meshes.
A spatial predicate without known geometry remains partial rather than excluding an unknown obstruction.
An unavailable active source also makes discovery partial because its membership cannot be established.
Cursor identity includes the exact frozen references and predicate. Each page receipts the full candidate set.
Explicit exclusions require current revision, source hash, and placement pins during dispatch.
An automatic measured-candidate exclusion is recorded separately and requires the final candidate context during freshness replay.

`describe(ref)` supplies project bounds, units, source authority, capability, and at most twelve triangle surface samples.
Each sample supplies a point, a unit normal in mesh winding order, and triangle area.
Samples can be truncated. They do not describe all planes, oriented extents, or connected patches.
Native level descriptions expose elevation. Native space descriptions expose their declared footprint at the owning level.
IFC levels expose an elevation only when validated placement preserves a horizontal level plane.
Unsupported IFC space footprints remain unknown.

`relations(ref)` returns declared hosting, support, level, space, containment, and decomposition facts where represented.
Declared IFC containment is distinct from measured solid containment.
It does not imply a physical support or clearance certificate.

`measure` accepts an existing object or a rigidly placed candidate box, and an explicit object or candidate query.
Operations are `distance`, `clearance`, `intersection`, and `containment`.
Containment requires one explicit container object. Union containment across a query is unsupported.
A clearance query region must enclose the candidate expanded by the requested gap and numeric tolerance.
Results identify witnesses, distance, relation, numeric tolerance, representation accuracy, and the tested domain.
`contact` means closed-mesh boundaries are within the reported distance tolerance and a common supporting face plane proves disjoint interiors.
The plane check uses exact integer signs of the supplied binary floating-point coordinates, not AABB overlap or an epsilon penetration allowance.
It requires vertices on the plane and strictly opposite nonzero sides for the two shapes.
Surface contact can remain `contact-or-overlap` where solid penetration cannot be distinguished reliably.
That state never certifies zero-gap nonpenetration. Explicit overlap and containment violate zero clearance too.
An ambiguous relation blocks clearance for every requested gap, including positive gaps smaller than the numeric tolerance.
For a query measurement, `relation` summarizes all candidate obstructions by severity. `nearest`, distance, and witnesses still describe the closest tested pair.
An exterior support contact cannot hide another unresolved or penetrating candidate. Ambiguity makes the result partial even when the nearest pair is certified contact.
Certified `contact` satisfies a requested minimum gap of zero. It does not satisfy a positive requested gap larger than the reported tolerance.
The final-proposal surroundings policy can admit `contact` while continuing to reject `contact-or-overlap`, containment, and penetration.

## Generic placement sequence

One caller sequence for a rotated wall uses public facts without a wall-specific answer helper:

1. Discover a wall through `query({query:{categories:['wall']}})` and describe its qualified reference.
2. Choose a large wall-side surface sample. Its normal and on-surface point define a candidate plane.
3. Construct a candidate box with the requested size. For a unit normal `n`, its axis-aligned support radius is `sum(abs(n[i])*size[i]/2)`.
4. Position the centre on the chosen side at `sample.point + n*(supportRadius + requestedGap)`.
5. Measure the candidate against the wall and against the complete relevant physical query.
6. Inspect the measured relation and witnesses. Change the candidate when a jamb, lintel, or another obstacle blocks it.

Opposite mesh winding chooses the opposite side. Samples do not identify a preferred free side.
An opening, an irregular wall, or another obstruction can invalidate the initial plane-based candidate.
Only the subsequent prepared-geometry measurements support the geometric claim.
The final native proposal must be measured again from its evaluated geometry after reconciliation.
The live connected-agent version of this sequence belongs to parent UI qualification and remains unproven here.

## Product worker boundary

`createGeometrySession` in `src/geometry-session.ts` provides the async four-operation host surface.
`src/geometry-worker.ts` retains one immutable read context in a private Node worker.
The host has hard construction, operation, abort, and lifetime termination paths.
The default construction deadline is 3000 ms. The default operation deadline is 1500 ms.
The default lifetime is 180000 ms, distinct from CPU operation time. Hosts can set a bounded provider-compatible lifetime.
The process admits at most four geometry workers. Each has a 192 MiB old-generation limit, 32 MiB young-generation limit, and 4 MiB stack limit.
Input admission is bounded to sixteen MiB and 600000 visited values. Replies are schema checked and bounded to 512 KiB.
The pure executor has additional object, triangle, pair, work, reply, receipt-count, and accumulated-evidence limits.
These are configured caps, not measured resource use or latency claims.

Successful replies must match the private pending operation, project, schema, and operation digest.
`geometryPublicResultDigest` hashes every public result field except `receipt`.
The producer hashes the same public payload that each method returns, including flattened query and relation replies.
The session checks that hash against `receipt.resultDigest` before collecting an observation.
The receipt hash is a consistency check on the private worker transport, not an independent authentication credential.
Abort, timeout, malformed reply, or worker failure prevents receipt publication, including earlier successful observations.
`receipts()` is host-only and requires all calls to have completed. The host captures receipts before closing the session.
Source validation, BVH work, containment, and freshness replay run outside the app event loop.
The bounded input admission walk and structured clone still execute in the caller. Their latency is unqualified.
The Docker image must include `geometry-worker.ts` next to the session module.

## Receipts and relevant freshness

Receipts record consumed object projections and complete query membership, including an empty set.
Discovery membership records identities and predicate completeness. It does not fingerprint unreturned object geometry.
The descriptions returned on a page have separate object observations.
An off-page height edit that leaves membership unchanged therefore does not invalidate identity discovery alone.
Measurement predicate observations additionally fingerprint all matching candidate geometry, including objects outside the returned page or nearest result.
Geometry projections contain evaluated world geometry and relevant dependencies.
Description and relation projections retain the facts the caller consumed.
File and native revision metadata remain pinned but do not alone decide staleness.
A new relevant object, a moved-in object, missing source, changed transform, or changed evaluated candidate invalidates affected evidence.
Unrelated objects outside a spatial predicate do not change its signature.

`validateGeometryReceipts` provides pure replay for bounded tests.
`validateGeometryReceiptsInWorker` provides the product host boundary.
Its input contains `current`, optional final `candidate`, `receipts`, and optional verified IFC `correspondences`.
Each correspondence is an exact historical and current reference pair supplied by the source-version owner.
Matching names or GlobalIds alone do not authorize correspondence across external revisions.
Freshness replay rebinds historical explicit exclusions only through the same verified identity policy.
Dispatch never accepts a stale exclusion directly.

Object candidate receipts require a matching final reconciled candidate context.
Box receipts bind that descriptor alone. They do not prove that the final native object equals the guest box.
The proposal owner must bind and independently remeasure final evaluated native geometry.
Receipts are trusted host observations, not guest credentials or independently authenticated permission tokens.
The proposal owner binds their digest into evidence and keeps host-only methods out of the guest capability list.

Freshness replay and all geometry calculations occur before the final catalog guard.
The short guarded section compares catalog generation and publishes an already computed native decision.
The source catalog owner and proposal owner supply the cross-process transaction guard.
This geometry component owns no adoption or native publication transaction.

## Accuracy and unsupported cases

Prepared IFC vertices and product placements are already in metres.
The executor composes product-to-source followed by occurrence-to-project once.
It never reapplies millimetre metadata, survey map conversion, or viewer origin offsets.
Only rigid positive-handed transforms are supported. Nonfinite or oversized geometry is rejected.
Equal GlobalIds remain distinct across namespaces and occurrences.

Triangle BVHs provide broad-phase acceleration. Triangle distance and winding calculations refine shape decisions.
The nominal numeric tolerance is `1e-7` metres. Original IFC tessellation error remains `null` because the prepared artifact does not qualify it.
`satisfied-mesh` means relative to the prepared representation within the reported numeric tolerance.
It is not an exact original-solid or regulatory certificate.

Closed topology uses exact-coordinate welding and paired oriented edges.
It does not prove that the mesh is free of self intersections.
Open or unsupported topology produces partial solid measurements rather than inferred containment.
The contact certificate checks at most 64 actual triangle face planes and charges exact coordinate work to the existing budget.
Failure to find a plane remains ambiguous. In particular, edge contacts without a common supporting face plane and some non-convex contacts are not certified.
Exact signs do not qualify original source tessellation, load capacity, contact area, or physical support stability.
Native furniture reuses display surfaces, which can be intentionally open. Its solid clearance remains unsupported.
Native wall openings, roof clipping, slab stair voids, and native family evaluation use existing evaluators.
Internal faces of multiple native components can underestimate separation. Curved native family tessellation has unknown source error.
High-complexity containment can exhaust the bounded work budget. No hospital-scale performance claim is made.

## Evidence matrix and defect record

Component statuses below refer to parent kernel attempt 4, which includes executable component head `75cca36` and its prerequisites.
The historical failures and exact evidence directory remain in the qualification record.

| Requirement | Authored evidence | Execution status |
| --- | --- | --- |
| Shared native and IFC semantics | Equivalent native and IFC wall measurement test | Parent attempt 4 passed |
| Units and transforms | Independent composed rotation, translation, 200 km offset, and mm-metadata fixture | Parent attempt 4 passed |
| Irregular shapes and openings | Independently authored L-prism and U-profile triangle fixtures | Parent attempt 4 passed |
| Solid distance and witnesses | Analytic cube gap and containment invariants | Parent attempt 4 passed |
| Supported boundary contact | Evaluated native asset on a native slab, native wall, rotated IFC wall, positive-gap rejection, sub-tolerance penetration and coincident/coplanar ambiguity controls | Parent attempt 4 passed |
| Contact and penetration | Zero-gap and positive-gap overlap, containment, and contact controls | Parent attempt 4 passed |
| Identity and scope | Namespace, occurrence, stale reference, private host, filtered relations, and scope-domain tests | Parent attempt 4 passed |
| Complete candidate membership | Absence, new obstruction, off-page membership changes, discovery-only height change, measurement geometry change, missing mesh, and unavailable source tests | Parent attempt 4 passed |
| Relevant updates | Verified correspondence, property-only change, and moved source controls | Parent attempt 4 passed |
| Final candidate binding | Object candidate versus changed reconciled geometry test | Parent attempt 4 passed |
| Budgets and termination | Work and pair limits, deterministic deadline, abort, and late-reply controls | Parent attempt 4 passed |
| ScriptBox schema representation | Fixed-array length/type/range controls, internal vector construction, and absence of tuple-only keywords | Component controls passed; actual guest bootstrap pending |
| Real converter and connected UI | Parent and independent #234 qualification | Pending |
| Root validation and changed-path policy | Parent serial kernel run, 315 sources and 97 changed paths | Parent attempt 4 passed |

The defect record retains source-review findings and subsequent runtime failures:

| Defect | Correction | Evidence state |
| --- | --- | --- |
| Parameter property conflicts with `erasableSyntaxOnly` | Explicit error field and constructor assignment | Parent compiler check passed |
| Containment returned distance zero with separated witnesses | Coincident solid witnesses for contained points | Parent component checks passed |
| Zero requested gap could bless penetration | Overlap and containment always violate clearance | Parent component checks passed |
| Semantic context discovery inherited missing-solid uncertainty | Nonspatial membership and solid capability are distinct | Parent component checks passed |
| Full native graph could expose private scope identities | Private evaluation followed by authorized record and relation filtering | Parent component checks passed |
| Worker lifetime could expire during a valid provider turn | Separate 180 s default lifetime and hard per-operation deadline | Parent component checks passed |
| A stale exclusion could hide a current obstruction | Resolve explicit pins before selection and rebind only during verified replay | Parent component checks passed |
| Discovery inherited unconsumed off-page geometry dependencies | Separate discovery membership from measurement geometry observations | Parent component checks passed |
| A schema-valid changed reply could retain its prior receipt hash | Hash the canonical public payload and check it before collecting receipts | Parent component checks passed |
| TypeScript loses optional `query.level` narrowing inside a callback | Capture the validated level identity key before the callback | Attempt 1 failed TS2345; parent attempt 4 passed |
| Floor-standing geometry could only return unresolved boundary contact | Certify nonpenetration through exact common supporting-plane signs on closed meshes; retain ambiguous fallback | Parent component checks passed |
| Sub-tolerance positive gaps could promote ambiguous coincident geometry | Ambiguity blocks all clearance values and produces a partial result | Parent component checks passed; independent static follow-up confirms the source fix |
| A closer contact could hide a different near-contained obstruction | Aggregate every obstruction independently of the closest pair | Parent component checks passed; independent static follow-up confirms the source fix |
| ScriptBox 0.1.1 rejects tuple-only schema keywords during bootstrap | Equivalent canonical bounded arrays with validated fixed-vector math boundary | Component schema controls passed; actual guest rerun pending |

## Qualification record

The owner allows ten total attempts for this new interactive item, as recorded in
`docs/design/synthetic-residential-197.md`. Issue218 remains exhausted and is not rerun.
Independent issue231 runs: **0**. Parent combined attempts are tracked by the issue230 ledger.
Parent SSH and HTTPS kickoff failures were infrastructure probes, not executed test failures.
The parent subsequently ran combined component attempt 1 at `88daaa82e38f3491d62b0866ba458bbf0bbada2c`.
Its strict lint passed on 306 sources. TypeScript reported TS2345 at `geometry-query.ts:219` because callback access widened `query.level` to include `undefined`.
The correction captures the already validated identity key outside that callback, without casts or non-null assertions.
The retained parent log is `/ssd1/bim-forge-qualification/issue230/run-88daaa82e38f3491d62b0866ba458bbf0bbada2c-component-01/artifacts/validate.log`.
This is parent-reported execution evidence. No independent child container or server probe ran.
The parent later reported combined component attempt 3 at source `f6ef6f9`: root validation on 314 sources, explicit changed-path policy, and browser build passed.
The geometry suite passed 28/28 including the then-current contact controls, and linked revision tests passed 12/12.
Actual ScriptBox bootstrap then rejected tuple-only JSON schema keywords in `@frederik91/scriptbox` 0.1.1.
These passes predate the subsequent clearance-aggregation and canonical-array corrections and do not qualify those later edits.
The parent then reported kernel attempt 4 at `aee595c4217273b09814353bb645c25841ee49c5`, including component head `75cca36` and the clearance fix `c941208`.
Root `npm run validate` passed on 315 sources, the explicit 97-path policy check passed, geometry tests passed 31/31, and geometry-source integration tests passed 3/3.
Evidence is retained at `/ssd1/bim-forge-qualification/issue230/run-aee595c4217273b09814353bb645c25841ee49c5-kernel-04/artifacts`.
Unchanged linked revision checks and ScriptBox bootstrap were not repeated in this kernel run. Linked revision 12/12 remains prior-source evidence from attempt 3.
Independent follow-up review found both clearance P1 paths closed in source. Combined ScriptBox, acceptance, converter, and UI qualification still remain pending.
The early Windows shell profile changed the working directory and hid the Git worktree.
Explicit PowerShell path, `login:false`, and the exact work directory corrected command routing.
Initial file-copy approvals completed. The owner later supplied direct worktree write access.

`experiments/geometry-231/qualify.sh` records exact source, image, raw output, explicit changed paths,
exit status, hashes, and Docker inspection in a new issue-specific `/ssd1` directory.
The script uses the cached tools image and read-only dependencies, no network, a read-only source mount,
2 CPUs, 3 GiB RAM with no additional swap, 256 PIDs, dropped capabilities, and bounded commands.
This standalone child script has not run. The qualified kernel evidence above comes from the parent's serial runner.
The script does not open a PR or modify a preview.
Root `npm run validate`, explicit changed-path policy, and all component tests must pass before a draft component PR.
Parent owns package registration, Docker packaging, shared server mounts, independent IFC and browser qualification, and combined publication.
