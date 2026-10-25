# W4 admission CPU diagnostic, 2026-10-25

This is a CPU-side diagnostic, not a database benchmark or terminal EX-13 result. No database connection or hospital-branch writes were made. The coordinator's original smoke evidence remains authoritative, including its failed exploratory page budget.

Server artifacts: `/ssd1/bim-forge-qualification/qvm-20261025/artifacts/w5-admission-profile-a/`. Sidecar: tools image `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`, `--network none --cpus=0.5 --memory=1g`, Node v24.22.1, TypeBox 1.4.3. The host has four CPUs and was shared with coordinator work; its initial load average was 1.66 / 1.16 / 0.94. This is not an exclusive hospital performance window.

`profile-admission.ts` consumes real W4 smoke entity COPY bytes (6,805 rows, SHA-256 `25e83b667e73846f79804fa0f5e8f31ea2777c90af03f48a608b24687f45a624`). It selects at most two unchanged rows per kind: 65 rows covering all 35 kinds, with 293,361 canonical envelope bytes. It exercises the real COPY decoder, W4 admission, repeated loader entity check, canonical serialization and SHA-256. The timed region consumes all admitted outputs into a checksum. Generation and row selection are outside the measured admission region. All payload fields remain intact. This sample does not represent every large-payload cohort or relationship/parameter mix.

Before baseline: W5 `5afa6abe3da54dccd4d360a39f2e52d58a225c84`. `admission-before.cpuprofile` and `profile-summary-before.json` record 2,007 CPU samples, of which 1,515 (75.5%) are inclusive TypeBox frames; schema reference resolution and guard traversal appear throughout the hot path. Instrumented phase times are dominated by wire admission and repeated entity validation, while decoding/canonicalization/hashing are small. Profiling timings are diagnostic and are not throughput comparison samples.

Fix: cache TypeBox compiled validators by schema identity, keep the exact original schemas and post-schema semantic checks, and hoist the W4 property-object schema for reuse. Validation is neither skipped nor replaced by a reduced payload. `validation.test.ts` compares compiled/interpreted acceptance on valid typed documents and commands, extra fields, malformed identifiers, wrong property shapes, undefined/functions/bigints, non-finite numbers and nested values. It also asserts that validation returns the original value unchanged.

`admission-after.cpuprofile` records the changed hot path. Five unprofiled before/after pairs alternate in the same capped sidecar, writing `before-repeat-1.json` through `after-repeat-5.json`. Each checks admitted rows, canonical bytes, source hash and output hash. Both variants retain output hash `e0b8b0dea473b2b5195d7ffc18ead7006439d7b4c4081ba23419c2a95eeb631e`. These replay samples measure CPU admission only; fresh-process startup and first-use compilation affect short samples. No database throughput, interactive latency, full-load capacity or performance winner follows from this diagnostic. Main must rerun smoke/reduced/full under new immutable run IDs.

Representative reproduction, in the capped diagnostic container with real generator source/dependencies mounted:

```bash
node benchmarks/hospital/generator/cli.ts --scale smoke --table entities --seed bim-forge-hospital-200k-v1 > /diagnostics/entities.tsv
node --cpu-prof --cpu-prof-dir=/diagnostics --cpu-prof-name=admission.cpuprofile experiments/storage/profile-admission.ts /diagnostics/entities.tsv
node experiments/storage/profile-summary.ts /diagnostics/admission.cpuprofile
```

For native snapshot input, use the actual existing product implementation in the server container (new output path only):

```bash
node --input-type=module -e 'import { RoomRepository } from "./src/room-model.ts"; import { writeFile } from "node:fs/promises"; const repo = await RoomRepository.create("W5 native baseline"); await writeFile(process.argv[1], JSON.stringify(repo.view(repo.head("main")).snapshot, null, 2) + "\n", { flag: "wx" });' /evidence/NEW_RUN_ID-native.json
```

Use `format=native-snapshot`, `scale=fixture`, `dataset` pointing to this file, mode `load-and-measure`. For deep history use purpose `smaller-fixture-history`, `historyRevisions=1000`; retain `repeats=5` for alternating bounded native materialization samples. Run as `measurement=correctness` under shared correctness allocation while manifest generation continues; its raw alternating samples do not claim an isolated relative winner. Formal `comparative` mode still requires the coordinator's exclusive measurement lease. All decision bindings, reserves and watchdog fields remain required.
