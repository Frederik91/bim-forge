# Initial execution envelope

Program QVM-01, issue #130. Recorded before full dataset measurement on 25 October 2026. These are exploratory qualification conditions and initial targets, not adopted product service guarantees.

## Claim being tested

Can the experimental entity-version candidate retain the declared detailed hospital inventory, return correct indexed working-set results, publish bounded revision changes atomically, and restore its retained data within a declared server envelope? Relative layout comparisons use the same bounded logical fixtures and at least five alternating measured repetitions. A whole-product speedup or real-hospital capacity claim is outside this experiment.

## Observed host and isolation

The server reports four logical CPUs and 16,633,503,744 bytes RAM. Its root filesystem had approximately 6.7 GiB available during initial inspection, while `/ssd1` had approximately 758 GiB available. Existing services remain running and their presence is a limitation for performance interpretation. The qualification database has its own Docker network, container, and SSD-backed directory, with no host port.

Data root: `/ssd1/bim-forge-qualification/qvm-20261025`. PostgreSQL container `bim-qvm-db` uses the cached PG15 image. Observed server version is PostgreSQL 15.14. The qualification tools image ID is `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`.

Initial database allocation is 1.5 CPUs and 3 GiB RAM, with 256 MiB shared buffers, 8 MiB work memory, 256 MiB maintenance work memory, 80 connections, and one parallel worker per gather. Generator/client containers use at most one CPU and 1 GiB for full streaming loads. Resource changes require a new recorded run configuration.

## Admission and initial targets

- Preserve at least 100 GiB free on the SSD and 4 GiB on the root filesystem. Limit the qualification data, temporary data, retained WAL, and artifact allocation to 200 GiB before reevaluating capacity.
- Start full loading only after smoke and reduced generation, reference integrity, actual count/checksum oracles, and loader publication checks pass. The full inventory target is 6,777,445 semantic entities. Relationship counts follow validity rules and report any deviation from the requested range.
- Limit a full initial-load attempt to two hours. A timeout or resource boundary is an observed limit. It does not silently select a smaller dataset or become a passed result.
- Initial warm single-client component targets are p95 at most 300 ms for indexed entity detail, 1,000 ms for a bounded page or one-hop neighborhood, 2,000 ms for a bounded revision delta, and 4,000 ms for a small durable accepted change. These targets apply only to the explicitly measured query shapes and payloads.
- Initial load, historical reconstruction, large type changes, mixed-rate saturation, and backup/restore report measured durations, errors, counts, and resource peaks. Missing an applicable target remains visible. Do not invent a pass threshold after seeing a result.
- A restart is not a verified cold-cache test. Label cache state accurately. Full performance measurements use one exclusive slot on the relevant host/storage resources; no other qualification stream may load or benchmark that database during the slot.
- Full inventory and deep history are independent axes. Start full inventory at one revision, then bounded updates. Exercise 1,000-revision behavior on admitted smaller inventories before attempting their full Cartesian product. Report every actual inventory/history combination separately.

## Interpretation

Correct output, preserved accepted state, completed writes, error counts, raw samples, workload definitions, source hashes, and actual resources are prerequisites for a performance conclusion. No faster/slower adoption verdict is justified without a tuned comparison, repeatability, and evidence of the limiting resource.

All run records must state what executed and what remains unqualified. Human review of combined evidence decides any later production architecture adoption.
