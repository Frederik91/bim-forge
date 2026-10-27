# One reduced publication profile: work PASS, harness ISSUES

Overall outcome is ISSUES. The sole authorized reduced dataset case completed its original source/readback/property oracles and captured valid plans. Client exit was zero. Controller finalization subsequently failed after stopping its owned resources, so this is not a clean benchmark or monitoring pass. There is no native controller terminal record. No dataset retry, comparison arm, or full run occurred.

## Exact source and actual evidence

| Item | Identity |
| --- | --- |
| Measured storage/generator source | `3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098` |
| Executed instrumentation/controller source | `de4762f48d33365ea499e229dfb71c00031711fe` |
| Prep-c ready seal SHA-256 | `dc4ba4a156edf1a79ff3b306665f7ccc67ee1a00275b9fd7805aa785996e9080` |
| Executed control.py SHA-256 | `9ee19021dd5cec190b97264cd1082fc3936a98f6d22accbca0342863d086cabe` |
| Complete-only budget.py SHA-256 | `6af01809b8f60e73c599285d5f55de6d12ebb692b7b390f5e47cac1d49318f22` |
| Reduced manifest SHA-256 | `6214eed2616670c697fa0a90b7a3c3257c116faaeca0591b32cab58c5a4aa3ca` |
| Lease | `house161-profile-20261026c`, 05:58:30 to 06:13:30 UTC on 26 October 2026 |
| Published revision | `519e59bbb6a0847209f05fd13a7167d718270814bcd93ae2df9ab8c7a18abfff` |

Raw root is `/ssd1/bim-forge-qualification/house-161/issue162-reduced-profile-20261026a`. Read-only post hoc recovery is at sibling `issue162-profile-review-20261026c`. [Facts](publication-profile-20261026c/facts.json) include original oracle content, source hashes, actual container states/limits, phase boundaries, and recovery input hashes. [Recovery metadata](publication-profile-20261026c/recovery.json) explicitly identifies itself as post hoc evidence.

The controller created a new isolated PostgreSQL 15.14 cluster with no published port, 1.5 CPU/3 GiB and no swap. Client plus generator used the pinned tools image at 1 CPU/1 GiB/no swap. Settings retained fsync, synchronous commit, full-page writes, shared_buffers 256 MiB, work_mem 8 MiB, maintenance_work_mem 256 MiB, max_wal_size 8 GiB, and hash_mem_multiplier 2. The original schema checks, FK triggers, full reference validator, fingerprints, and complete property/body readback remained enabled.

## What actually passed

Original `profile-result.json` reports PASS. `run/errors.json` is empty, and all original observations passed. Exact logical counts are 270,205 versions, changes, and visible rows, one revision, and one receipt. The driver also asserted one branch, its revision head, and the receipt payload/revision identity. All constraints in the retained catalog snapshot were validated and all retained triggers had enablement `O`.

Canonical fingerprint count is 270,205, sum `7a7dce5cc0865f0bf3aa82a0fe14ca5a115e8a5258b60a4f24442bb7d5600082`, xor `50c0078fc4df5d1d4fca3e065a4ea698cf7d53cae90fceb20a6a9ffe2cce472a`. Expected and actual property counts match: entities 1,452,336, relationships 34,800, parameters 75,000. Original source/readback fingerprints and kind maps match completely. These raw oracle results are embedded in the facts file and retained byte hashes identify their originals.

Client execution finished at 06:00:22.150488 UTC with exit zero and no OOM. No restart readback or recovery-durability experiment followed. This is a generated reduced fixture, not independent real-hospital validation.

## Narrow phase findings

Session-local auto_explain captured the actual statements once, while the original reference validator consumed its usual result. The instrumented modules add phase hooks and change the workload's load-module import; original measured modules remain intact. Node times below include their children. FK AFTER-trigger time is separate from the main insert plan. The values are one instrumented observation in milliseconds, not a speedup comparison.

| Actual plan | Main top-node time | Input plan time | FK times, each with 270,205 calls |
| --- | --- | --- | --- |
| [Changes insert](publication-profile-20261026c/plan-changes.json) | 5,004.591 ms | Stage sequential scan 57.165 ms | Revision FK 1,495.094 ms; version FK 2,594.313 ms |
| [Visibility insert](publication-profile-20261026c/plan-visibility.json) | 13,859.564 ms | Stage/versions hash join 416.848 ms | Branch FK 1,539.795 ms; version FK 2,668.330 ms |
| [Full-reference validator](publication-profile-20261026c/plan-references.json) | 504.832 ms | Gather with hash anti-join and memoized reference expansion | Zero missing-reference witnesses |

The changes scan returned exactly 270,205 rows, with no temporary spill reported in that plan. Its main insert work and two FK timings are material beyond the short input scan. The plan does not separately measure heap insertion, index maintenance, and WAL costs.

The visibility input joined exactly 270,205 rows. Its hash used eight batches, with 7,842 temporary blocks read and written at the join/top node. That proves a spill in this reduced case. Its 416.848 ms join is much smaller than the surrounding 13,859.564 ms insert plan, and its FK triggers add separate work. Eliminating the join spill alone would not remove the other observed insert/constraint work. These inclusive counters must not be summed across parent and child nodes.

The reference hash anti-join used one hash batch and reported no temporary IO. It returned zero witnesses. Parallel node times/rows are per-loop reporting; they are not independent wall intervals to add together.

Boundary windows were approximately 9,144 ms for changes, 18,118 ms for visibility, and 512 ms for references. They include collection queries and instrumentation toggles. The original load timer reports 29,591.624 ms publication, with prepublication analyze, the publication transaction, reference validation, and callbacks included. Those timing scopes are different. No claim compares these profiled values with earlier uninstrumented admissions.

This narrows reduced-case costs. It does not prove which relation caused the historical full-trial DataFileRead waits, whether full-size cache behavior matches, or an overall limiter. Full-run limiter, comparative speedup, and full capacity remain inconclusive. The benchmark checklist found no repeated or source-equivalent comparison from which to infer improvement.

## Why finalization is ISSUES

1. The source driver wrote `client.stdout.log` and `client.stderr.log` as UID 0, mode 0644. Those original files remain unchanged.
2. The controller's `finally` called `stop_owned()` before artifact collection. PG exited zero at 06:00:24.182401; budget was then deliberately killed and exited 137 without an OOM. The client had already exited zero.
3. Executed `control.py` tried to write Docker stdout back into the same `client.stdout.log` filename as host user frederik. That raised PermissionError. This was an ownership/name collision, not a logging timeout.
4. The exception occurred before native `terminal.json`, `controller-done.json`, and the final evidence manifest were written. None has been fabricated in the original run directory.
5. With no completion marker, the independent watchdog subsequently saw stale telemetry from the already-stopped budget collector. Its 06:00:37.715079 event says `Budget stale or breached`. All 47 retained budget samples have empty breach lists; the last sample is 06:00:22.306958. This event does not demonstrate a budget threshold breach or interrupted dataset work.

The in-run maximum additional allocation was 1,904,033,792 bytes and aggregate allocation 157,631,528,960 bytes. Minimum SSD/root/host-memory availability remained above the declared reserves. Sampling is not a filesystem quota. The record does not upgrade this into a monitoring-uptime or capacity pass.

Post hoc collection copied raw files, captured read-only Docker state/logs under distinct names, retained the finalization source excerpt and original log ownership, and hashed those artifacts. `recovered-terminal.json` is named and labeled as operator recovery metadata. The native terminal gap is still visible.

All three owned containers have PID zero and are stopped; the watchdog and controller processes exited. `bim-qvm-db` retains ID `28c0471fd5ebaead5d81ac57ee1bcb0e2d036e6320be8e33033751059561c130` and is running. `bim-qvm-r3-db` retains ID `f9de27ac9264129b88193d18d0b724a5d27afa7fc242a258827152ef35968d86` and is stopped. Main independently verified/released the lease at 06:04:20 UTC. Preview 9443 and historical databases were not mutated. All data/resources remain retained; no rerun occurred.

## Separately tested future correction

Future source `73b096a08cdc76844ec969678c905454cc0e8f60` uses distinct `host-*` capture names, records individual artifact errors, and writes terminal evidence in `finally`. It acknowledges the watchdog only after ownership cleanup is verified, before optional collection. Unverified cleanup does not acknowledge completion. The source is unsealed and was not used in the actual profile.

Root validation, strict compilation, and 19 guard tests passed in a network-none .25 CPU/1 GiB tools container. New tests preserve client logs, inject PermissionError and logging timeout without losing terminal/work status, and reject watchdog completion for unverified cleanup. Raw checks are `/ssd1/bim-forge-qualification/house-161/issue162-finalization-check-20261026c/checks.log`. No DB ran for those tests. Original prepared copies and seals remain unchanged.

The [offline summary reader](publication-profile-162.py) verifies raw recovery hashes and actual source/oracle/plan/ownership facts. Root validation for the final documentation is recorded with the PR handoff. No further measurement is requested or authorized by this review.
