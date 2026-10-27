# Bounded allocation measurement

Issue [#159](https://github.com/Frederik91/bim-forge/issues/159). The round-three budget monitor failed when `du` raced with deletion of a PostgreSQL temporary file. That failed run, its monitor script and evidence remain unchanged. No new full admission is authorized by this correction.

`read-allocation.sh` is a Linux/GNU operational helper. It accepts only a successful complete `du --bytes` scan. A failed scan emits diagnostics and starts a fresh scan, at most three times. Each attempt has a ten-second timeout and one-second termination grace. Persistent failures, timeouts and malformed accounting return nonzero with no estimate. It never ignores an error, uses partial output, reuses an old estimate or alters resource thresholds. Like the original live-directory scan, a successful result is sampled accounting, not an atomic filesystem snapshot.

For a newly declared monitor, replace only its allocation-read command:

```bash
used=$(bash /source/benchmarks/hospital/operations/read-allocation.sh /qualification)
```

Keep the monitor's failure trap, aggregate 200 GiB allocation ceiling, free-space/memory reserves, ten-second cadence and independent stale-monitor stop. Worst-case scan timeout/grace is 33 seconds; with the cadence it remains below the existing 90-second freshness threshold. A failed helper must still fail the monitor and stop its owned job. This helper is not applied to the frozen round-three run.

Plan and acceptance: change only this helper, its shell regression probe and these instructions; no model entities, application API, schema, validation or accepted geometry changes. Run root validation and the probe in the server tools container. The probe checks a real allocation, a simulated disappearing-file failure followed by a complete scan, persistent failure, malformed output, three real timeout terminations and an actual missing directory. It retains its fixtures and diagnostics in the supplied artifact directory.

```bash
QVM_MONITOR_TEST_ROOT=/qualification/round3/artifacts/allocation-reader-check \
  bash benchmarks/hospital/operations/read-allocation.test.sh
```

No full hospital capacity, monitoring uptime or performance result follows from this small probe. A future full run needs its own declaration after the repository's retry escalation is reviewed.
