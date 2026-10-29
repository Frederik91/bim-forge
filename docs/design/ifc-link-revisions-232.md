# External IFC revision contracts

Child [#232](https://github.com/Frederik91/bim-forge/issues/232) of
[#230](https://github.com/Frederik91/bim-forge/issues/230). Implementation base
`f4285c644e52b5bdba8e4f6afeb6e099bc02b891`. Source handback only.
Server qualification, actual converter qualification, and browser checks remain unrun.

## Stable links and immutable versions

`LinkedModelStore` retains the existing `links` job table, source bytes, and prepared directories.
New `link_catalog`, `link_versions`, and `link_history` tables add stable project link identity,
candidate associations, and adopted source and occurrence-placement history. Opening the store
upgrades legacy jobs in one transaction. Existing ready links retain their IDs and source pins.
The upgrade does not touch native model storage or rewrite source bytes.

Every link has one occurrence. Separate attachments have separate namespaces and occurrences,
even when their original bytes and GlobalIds match. Occurrence placement changes independently
of source preparation. The private worker request now separates the job UUID from the stable
namespace and occurrence UUIDs. Result validation checks all three bindings.

The first successfully prepared version becomes current, preserving the existing attach workflow.
Replacement candidates leave current unchanged until explicit adoption. Preparation failure,
cancellation, timeout, and converter-restart failure keep the previous current version available.
Opening another application connection does not cancel another process's live jobs. Closing a
store cancels only jobs that this instance created. Unowned interrupted jobs expire after 90 seconds
or receive the converter's restart failure receipt.

Prepared files publish through a temporary directory and one rename. SQLite saves the ready job
and any initial current pointer in a savepoint. A publication failure rolls back those database
writes before the candidate becomes failed. An already published valid immutable directory can be
reused after interruption. The original file remains authoritative.

## Exported store methods

`snapshotCurrent(projectId): LinkedCurrentSnapshot` returns:

```typescript
{
	catalogToken: string;
	links: { linkId: string; generation: number; versionId: string; prepared: LinkedPrepared }[];
	unavailable: { linkId: string; reason: string }[];
}
```

The catalog token covers current membership, source version, occurrence placement, and current-file
availability metadata. It excludes staged candidate progress and failures. Missing or corrupt active
artifacts appear in `unavailable`; consumers must preserve that incomplete coverage. A changed token
requires outside-lock revalidation. The token does not decide semantic staleness.

`readVersion(projectId, selection: LinkedSelection): LinkedVersionResolution` resolves an adopted
source and occurrence-transform pin only when it identifies one retained preparation. The result is `{kind:'ok',versionId,prepared}` or
`{kind:'unavailable',reason}`. Cross-project pins, fabricated occurrence bindings, unadopted candidates,
missing objects, and unavailable artifacts fail closed. Historic original hashes and transforms stay
unchanged. `resolve(projectId, selection, 'current' | 'historical')` adds an exact-current check.
If the same source bytes and transform match multiple adopted preparation jobs, historical resolution
returns `ambiguous`, even when their derived artifacts happen to match. The selection does not contain
a preparation-job pin, so the store cannot claim which historical preparation the caller inspected.
Exact original downloads remain available because the original source bytes remain authoritative.
Current resolution loads `currentVersionId` directly and never falls back to an older preparation.

`prepareReplacement({projectId,linkId,expectedGeneration,name,bytes})` retains a separate candidate.
Repeating the same bytes and expected generation returns an existing live or ready candidate.
`reviewCandidate(projectId,linkId,candidateId)` returns its delta and conversion diagnostics.
`adopt({projectId,linkId,candidateId,expectedGeneration})` checks both the caller's generation and
the generation against which the candidate was prepared. Repeating a successful adoption request
returns the same current state. A placement change also makes a previously prepared candidate stale.
An adoption retry must also match the candidate's recorded preparation generation. A subsequent
placement cannot make a stale adoption request succeed merely because its candidate remains current.

`place({projectId,linkId,expectedGeneration,sourceToProjectMetres})` accepts only a finite, bounded,
right-handed rigid transform. The placed geometry must remain within the existing coordinate envelope.
The source file and product-to-source transforms stay unchanged.
A retry of the most recent successful placement returns the existing state. A stale command after
source adoption still fails, even when its requested transform happens to equal the current transform.

`originalVersion(projectId,versionId)` reads exact retained source bytes. `original(projectId,linkId)`
reads the current source. HTTP history downloads use `originalVersion`, including the first version
whose job ID is also the stable link ID.

## Publication and adoption exclusion

`withCatalogGuard<T>(projectId,expectedCatalogToken,synchronousCommit:()=>T)` returns either
`{kind:'committed',value:T}` or `{kind:'catalog-changed'}`. It reserves the linked SQLite writer with
`BEGIN IMMEDIATE`, compares the current token, and calls the already computed native publication.
Adoption, placement, attachment, and initial publication use the same SQLite writer reservation.
Other processes therefore cannot change the catalog during native publication.

Lock order is linked catalog, then native transaction. Reentrant catalog writes fail. Geometry work,
network work, and awaits belong outside the guard. Native publication must finish its own transaction
before the synchronous callback returns. The guard rejects declared async callbacks before invocation
and rejects returned thenables before releasing the linked transaction.

The databases do not share a durable transaction. The guard prevents concurrent adoption during a
native commit, but cannot undo an independently committed native database if a trusted caller violates
the callback contract and returns a thenable after side effects. Native publication must record the
geometry pins and evidence in its own transaction. A process crash after native commit leaves that
native transaction authoritative and releases the source reservation. Retained originals and history
preserve the evidence that native acceptance consumed.

## Delta and correspondence

`linkedDelta` compares only the same namespace and occurrence. It lists added, removed, moved,
geometry-changed, property-changed, ambiguous, and unchanged GlobalIds, plus occurrence-transform change.
Cross-file IDs remain hints. Changed matching IDs are marked ambiguous; removed and new IDs are never
paired by name, nearest position, or geometry similarity. This helper does not authorize correspondence
for geometry receipts. The parent must verify each historic/current pair against its consumed projection.

## HTTP and UI

All routes use the existing authorized `/api/projects/:projectId/ifc-links` mount.
Every method passes the existing authorization and project check. No source URL fetching is added.

| Method | Suffix | Body or result |
| --- | --- | --- |
| GET | `/catalog` | Current states and retained candidate/history jobs |
| POST | `/:linkId/candidate` | Original IFC bytes, `application/x-step`, encoded `X-Source-Name`, `X-Expected-Generation` |
| GET | `/:linkId/versions/:jobId/review` | Current generation, semantic delta, diagnostics, losses |
| GET | `/:linkId/versions/:jobId/original` | Exact authoritative original bytes |
| POST | `/:linkId/versions/:jobId/adopt` | JSON `{expectedGeneration}` |
| POST | `/:linkId/placement` | JSON `{expectedGeneration,sourceToProjectMetres}` |

The existing list, current prepared, current original, and cancel routes remain available.
The renderer receives stable display IDs equal to occurrence IDs. Candidate job IDs are not display IDs.
The panel keeps its existing callbacks: `changed`, `selected`, and `reference`.

Browser controls include **Prepare replacement for [filename]**, **Source versions and candidate changes**,
**Review candidate changes**, **Adopt reviewed IFC version**, **Download this original**, and
**Apply occurrence placement**. Current geometry remains usable while candidates fail. The property
inspector shows bounded readable name/value rows; original JSON remains in expandable source details.
The placement form supports project translation and rotation about Z. Arbitrary rigid 3D transforms
remain accepted by the store and API; tilted occurrences show a read-only placement panel.

## Limits and qualification ledger

Sources retain the existing 2 MiB limit and prepared output retains the 8 MiB limit. Limits are eight
links per project, 32 links per installation, eight retained revisions per link, 256 jobs and source/spool
entries per installation, and 64 placement-history entries per link. Limits fail visibly and never
delete source dependencies. Failed and cancelled candidates count toward retention. No automatic
garbage collection or deletion of source history is implemented.

Qualification attempts used: **0 of 10**. The parent reports repeated server connection timeouts.
No local build or test substitutes were run, and exhausted worker218 qualification was not rerun.
`git -c core.whitespace=cr-at-eol diff --check` passed during source review.

The new focused test file is `demo/linked-model-revisions.test.ts`. It covers staged adoption,
historical originals, same-ID namespace separation, duplicate IDs, bad or interrupted candidates,
placement bounds, optimistic conflicts, retention, deterministic legacy upgrade, callback misuse,
and exclusion across SQLite connections and processes. These are synthetic prepared-artifact tests.
HTTP tests cover every new route's origin check, project and version separation, bounded malformed
commands, candidate adoption, and exact historic downloads after source replacement.
They do not establish real IFC conversion, source placement, or geometry accuracy.

Before a draft PR, required server commands include `npm run validate`, the explicit complete changed-path
policy check, and `node --test demo/linked-model-revisions.test.ts`. Parent-owned package registration,
actual-image converter checks, real IFC fixtures, application/server regressions, and desktop/phone
replacement and adoption checks remain required. No validator or policy was weakened.

The new Python `test_runtime_worker.RevisionRequests` class checks actual command bindings for distinct
job, namespace, and occurrence IDs. It also checks malformed, extra-field, and oversized requests.
The server command from `experiments/ifc-link` is
`python -m unittest test_runtime_worker.RevisionRequests`. Its subprocess launch is intercepted to inspect
the exact command. Actual converter execution remains a separate qualification requirement.

Parent static review identified two source defects after the initial handback: same-source generations
could resolve an older preparation as current, and an adoption retry could mistake a later placement
for its own transition. The store now selects actual current preparation, rejects ambiguous historical
preparations, and checks the recorded candidate generation on retries. Focused regression sources cover
identical and differing derived preparations over identical original bytes, corrupt current artifacts,
and adoption followed by placement. These regressions remain unrun while the server is unavailable.
