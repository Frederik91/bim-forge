# EX-13: w4-full-manifest-20261025a

Outcome: inconclusive. Execution: completed.

The full seeded hospital generator can produce the declared inventory, exact logical property cohorts, typed graph counts and query oracles with bounded memory. This generator-only run cannot establish all EX-13 database assertions.

Variant: VM-C1 synthetic initial revision, full hospital profile, standalone manifest production without SQL backend execution..

- w4-full-generated-counts: passed; expected Full profile inventory and logical typed property count match exact declared cohort allocation; valid topology determines relation count without padding.; observed Full manifest: 6,777,445 entities across 35 kinds, 18,742,644 relationships within target tolerance, 1,500,000 parameters and 145,118,512 logical properties. Includes 3,000,000 ports and 1,400,000 studs.
- w4-full-degree-reconciliation: passed; expected For each relationship kind, sum of generated incoming and outgoing degrees equals the streamed relationship count.; observed createManifest completed without its degree-reconciliation assertion failing; exact degree histograms and relationship counts are in manifest.json. Independent per-endpoint smoke checks passed earlier.
- w4-full-generator-resource-envelope: passed; expected Manifest generation completes within two hours under a 1 CPU / 1 GiB container limit while honoring budget stop and shared reserves.; observed Exit 0, stderr empty, no OOM and no budget stop. GNU time elapsed 8:41.13, user 514.67 s, system 0.96 s, maximum process RSS 181,612 KiB. Shared watchdog sampled every 20 seconds.
- w4-synthetic-claim-boundary: passed; expected Generated results explicitly retain the synthetic claim boundary and separate external reference metadata from materialized artifact bytes.; observed Manifest claim and limitations remain explicit: 100,000 external artifact references, zero materialized external artifact bytes, synthetic proxies and initial-revision metadata only.

Limitations:

- This is an inconclusive EX-13 generator contribution. Database admission, full SQL integrity, history, query/delta execution, traffic, durability, recovery and approval evidence remain separate coordinator/W5 work.
- Independent endpoint, duplicate and COPY round-trip checks ran at smoke scale earlier. Full generation checked aggregate degrees and hashed all emitted rows without loading them into a second system.
- Synthetic bounds, inventory, source references and external URIs do not qualify real hospital inventory, rendering, clashes, IFC fidelity or geometry regeneration.
- Only initial revision 1 is materialized; external artifact bytes are zero. Payload compression/deduplication uses bounded samples.
- GNU time reports 8:41.13 and 181612 KiB maximum process RSS. These are generation admission metadata under overlapping activity, not isolated comparative performance or whole-service peak memory.
- Earlier rounding and boundary-test failures remain documented in prior-failures.md. Their complete raw console output is in the task transcript, not a retained standalone log; no failed-run timestamps or terminal record were invented.
- The archive in this result directory retains the raw evidence. Extract it into an evidence root, retain the archive itself there too, and verify with W0 a98b6cd. No human acceptance, registry update or merge approval is recorded here.
