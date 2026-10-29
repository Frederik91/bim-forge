# Independent geometry qualification (#234)

This directory owns synthetic fixture generation, an independent geometry oracle,
and qualification receipts for parent #230. It changes no accepted model or app authority.
All runtime results are **UNQUALIFIED / NOT RUN** until source-bound server receipts exist.

The ten-total-attempt interactive allowance applies to new #234 items. Preserve every
red/green receipt; inspect failures before retrying. It does not reopen worker218.

## Plan, ownership and acceptance evidence

- `generate.py`: deterministic invented IFC4, immutable new output directory, real
  `IfcRelVoidsElement`, concave extruded profile, building/storey relative placements,
  metre/mm sources and version series. No production geometry or oracle imports.
- `oracle.py`: separate analytical footprint/prism calculation in project metres.
  The wall is decomposed into material prisms independently of the writer's CSG void.
  Handles separation, containment, contact, vertical gaps and rigid transforms for
  these finite vertical-prism fixtures. It is not a general IFC geometry engine.
- `test_qualification.py`: real production converter as system under test; independent
  signed mesh volume, project-coordinate vertices and oblique ray parity inspect
  emitted triangles. Tests source hashes, immutable outputs and failed publication.
- `geometry-runtime.test.ts`: consumes verified artifacts from a passing converter
  attempt at the same commit and withheld analytical probes. Compares the actual
  `GeometryContext` to the independent metre/mm/occurrence/distance controls. Retains
  every result before asserting, including zero-clearance containment/penetration and
  contact cases. Tests missing sources and meshless Level/Space semantic discovery.
- `receiving-native.ts`: writes an ordinary broad named receiving hall/service room
  at elevation 3.5 m, with shell, slab and doors. Existing validators and portable
  roundtrip check the generated context. No assets, candidate locations, normals,
  measurements, proposals, alternatives or oracle facts are generated into it.
- `demo/geometry-workflow-browser.test.ts`: actual public UI/server/sidecar attach,
  read-only properties, hostile property as source text, unsent reference pin,
  original bytes, Main preservation, cross-project source refusal and phone layout.
  Starts with a native door selected, selects an IFC wall, checks its action strip,
  hidden native Move, linked Properties navigation and exact source-bound Ask pin.
  Native reselection clears linked selection. A second property-version source with
  the same GlobalId keeps the first pin immutable and cannot mix old source binding
  with new properties. These assertions require the parent's linked-selection fix.
  The receiving project enters through the existing `#import-file` UI. It uses a
  fresh disposable UUID for live runs; the generator records the actual ID and hash.
  There is no fake provider or test-only product bypass. It does not qualify touch.
- `requirements.tsv`: full matrix with narrow written checks and every pending row.
- `run-server.sh`: bounded network-off/read-only server container supervisor; exact
  source archive/hash, image inspect, raw log, exit code and append-only attempts.
- `ledger.json`: initial availability and defect/attempt status. Never replace red logs.

No production model entity is edited. Fixture entities are invented `IfcProject`,
`IfcSite`, `IfcBuilding`, `IfcBuildingStorey`, `IfcWall`, `IfcOpeningElement`,
`IfcBuildingElementProxy`, profiles, placements, properties and relationships.
All newly invented fixture data is dedicated to the public domain under CC0-1.0.
No external source fetches, survey claims, credentials or existing user projects.

## Fixture and version inventory

Each unit (`m`, `mm`) has `v1`, `property`, `unrelated`, `wall-motion`,
`added-obstruction`, `removed`, `reidentified`, `placement`, `partial`, `empty`,
`unsupported`, `duplicate`, `huge` and `budget`. Two extra originals are malformed
and over the source-byte limit. Total: 30 generated originals, no checked-in IFC
output or claim that generation has run. A repeat generation must match hashes.
Every source also contains a declared IFC space without a physical representation,
so semantic discovery can be tested without inventing a solid for its context.

Wall local dimensions are 6 x .3 x 3 m; a 1 x .3 x 2.2 m through-thickness void
is actually removed, retaining a lintel. Wall volume is 4.74 m3, versus a filled
enclosure's 5.4 m3. The L extrusion is 10 m3, versus its enclosure's 18 m3.
These numbers are independently checkable controls, not answers supplied to the AI.
The fixture carries intentionally hostile text which is never authority.

Nested rotations are building +30 degrees and storey -15 degrees, with independent
translations and elevation. Two external namespace/occurrence bindings reuse the
same GlobalIds; occurrence B adds +90 degrees and [100,-30,2] m. Conversion checks
must compose product, source and occurrence exactly once, preserving metre/mm parity.

`property` changes FireRating only; `unrelated` moves a far object. The consumed
wall geometry remains identical. `wall-motion` moves that wall .4 m; `placement`
changes the storey translation; `added-obstruction` introduces a physical element
in the previously empty x=8 m probe region. `removed` removes the wall/void;
`reidentified` replaces its ID without authorizing correspondence. The fixtures
express possible outcomes, not the product's freshness policy.

The private manifest includes source hashes and independently used identities.
Keep it, oracle results, and analytical probes outside model prompts/context/tools.
Only attach an invented original IFC through the actual UI. Seeing source geometry
does not grant access to the private oracle or native acceptance authority.

## Server use and boundaries

The owner/parent must reserve the server and combined source first. All storage is
under `/ssd1`; supply a clean committed server checkout, cached dependencies/image,
and compatible cached Python executable. No installs or image pulls are performed.
Inspect the image/Python paths before the first attempt; they are configuration,
not evidence that the cached venv works in an arbitrary base image.

```sh
export QUAL_SERVER_RESERVATION=issue234
export QUAL_NODE_DEPS='<cached direct node_modules directory under /ssd1>'
export QUAL_PYTHON_IMAGE='<already-cached-compatible-image>'
export QUAL_PYTHON_BIN='/ssd1/bim-forge-qualification/qvm-20261025/python/bin/python'
bash experiments/geometry-qualification-230/run-server.sh converter /ssd1/.../source /ssd1/.../issue234
bash experiments/geometry-qualification-230/run-server.sh validate /ssd1/.../source /ssd1/.../issue234
export QUAL_CONVERTER_ARTIFACTS='/ssd1/.../issue234/attempt-1-converter-<sha>/artifacts'
bash experiments/geometry-qualification-230/run-server.sh runtime /ssd1/.../source /ssd1/.../issue234
# Parent supplies and retains a new disposable project UUID for every live trial.
export QUAL_PROJECT_ID='<fresh disposable UUID>'
bash experiments/geometry-qualification-230/run-server.sh native /ssd1/.../source /ssd1/.../issue234
# After successful conversion and parent-reserved isolated converter sidecar:
export QUAL_FIXTURES='/ssd1/.../issue234/attempt-1-converter-<sha>/artifacts/fixtures'
export QUAL_RECEIVING_PROJECT='/ssd1/.../issue234/attempt-4-native-<sha>/artifacts/receiving-project.json'
export QUAL_IFC_SPOOL='/ssd1/.../issue234/browser-spool'
bash experiments/geometry-qualification-230/run-server.sh browser /ssd1/.../source /ssd1/.../issue234
```

The converter must pass before runtime consumption. Converter and native prerequisite
receipts must both pass at the browser run's exact source commit. The native generator
must pass separately before any real connected-provider trial; source planning alone
does not establish that the receiving project is valid or importable.

The browser container has no provider or external network. A separate parent-owned
bounded converter container serves only that disposable spool. This runner never
launches, reconfigures or replays the old worker218 qualification. Its library cache
may be mounted read-only. Parent owns connected-provider UI, actual-image migration,
preview, shared mounts and all acceptance/adoption coordination.

Root validation is `npm run validate`. The runner additionally passes **all changed
paths versus the docs baseline** to `scripts/validate-policy.ts --changed-files`.
The policy's default zero-path success is not enough. Full relevant suites, combined
query tests, sidecar isolation and mutation/race matrix must also pass before claiming
merge readiness. Component draft PR targets `codex/issue-230-unified-geometry` only
after server validation; no draft PR has been opened from this unqualified state.

## Pending interface work and limits

#231's actual `src/geometry-contract.ts` defines qualified refs, source capabilities,
project points, queries, measurements/witnesses and trusted receipts. The unqualified
`createGeometryContext` runtime was integrated from the parent at f5c3210. Host runtime
tests consume its public interface as the system under test. Its geometry math is
never imported by the oracle. Scoped `readableIds` exposure and receipt-domain binding
remain pending a concrete implementation contract; the full private graph must still
evaluate hosts/families while hidden IDs and relation targets remain unreadable.

#232 proposed `snapshotCurrent`, `readVersion`, `withCatalogGuard`, including missing
active sources, a short SQLite publication fence and thenable refusal. The announced
route family adds `/catalog`, `/:linkId/candidate` with `X-Expected-Generation`,
`/:linkId/versions/:jobId/review|original|adopt`, and `/:linkId/placement` under the
existing project-authorized prefix. Source handback and accessible UI names remain
pending; do not manufacture an adoption flow or treat an API-only replay as UI proof.
Stale selection after adoption of a changed source/version/occurrence transform is
also pending those real public UI operations. Independent attachments are separate
sources, not a substitute for repeated replacement of one stable project link.
#233 proposal applicability and final publication must exercise relevant-only reads,
absence membership and revalidation. Neither fabricated output nor a scripted fixture
worker qualifies the parent's real connected-model request.

The existing converter calls an artifact `state: complete` when its conversion job
finishes even if individual products have no mesh. This pack requires explicit
missing-geometry diagnostics; **job completion is not geometric completeness**.
An active link with missing index/mesh or unavailable artifacts must make complete
absence/clearance unprovable. A failed staged candidate must preserve current geometry,
its readiness and historical original; the converter artifact check alone does not
prove the app lifecycle. Those product assertions remain pending rows G07/G11.

No runtime defect has been reproduced here yet. Static harness corrections are not
product defect evidence. No generated fixture, root validation, converter, browser,
provider, proposal, race, restart, accepted alternative or As-is preservation run has
been performed while the server is unreachable. Main-only attachment preservation is
the narrow browser assertion. Review `requirements.tsv` before interpreting any green
test as broader qualification.

Preserving the previous native picker value under linked selection is a background
navigation check. It does **not** prove correct submitted `selectedObjectIds` or
proposal anchor semantics. The real connected-provider trial must inspect that payload
and the host's geometry/evidence refs, with intentional native context retained and
no implicit targeting of the previously selected Door. No fake worker is added here
to hide the parent's outstanding anchor contract.
