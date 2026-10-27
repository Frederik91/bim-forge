# Checkpoint comparison review

QVM-01, issue #151. Reviewed after all ten fresh reduced admissions completed on 25 October 2026. This is a database-configuration comparison at reduced scale. It does not change either failed full trial or adopt a language or storage architecture.

[EX-13 checkpoint-comparison-20261025a](../results/EX-13/checkpoint-comparison-20261025a/result.json) completed with complete fidelity in every sample. Both variants used runtime `962d6023119baf070bd6c2a8c599e2cf0ea3186e`, the same 270,205 source records, loader 1 CPU / 1 GiB and PostgreSQL 1.5 CPUs / 3 GiB. Five alternating pairs used fresh databases. Only max_wal_size changed between 1 GiB and 8 GiB.

| Measurement | Control median, range | Tuned median, range |
| --- | --- | --- |
| Complete client job | 105.7 s, 97.7–119.6 s | 95.2 s, 92.1–110.5 s |
| Ingestion | 54.2 s, 49.4–69.1 s | 44.4 s, 43.7–59.2 s |
| Publication | 27.9 s, 26.4–29.9 s | 26.6 s, 26.2–29.0 s |
| Client process-group CPU | 48.1 s, 45.8–51.7 s | 45.1 s, 44.7–52.0 s |
| Cluster WAL generated | 931.8 MB, 884.1–1,007.2 MB | 807.6 MB, 806.0–808.1 MB |
| Requested checkpoints during job | 1, 1–1 | 0, 0–0 |

The [raw samples and summary](round3-20261025/wal-comparison-summary.json) retain finer values, WAL sync timing and exact client cgroup peaks. Timings use actual Docker completion, rather than the coordinator's polling interval. The job includes client setup, source generation, staging, publication and full readback/property verification after database creation. A private-cluster checkpoint completed before each job.

The checkpoint count and WAL-byte changes support the intended configuration effect. Job-time ranges overlap. A general timing improvement is not established by these samples. In particular, reduced results do not predict full working-set or cache behavior. Cluster counters can include private-cluster background maintenance; database-specific counters and raw activity are retained. Existing host services remained active, with no host cache flush or cold-cache claim. I/O timing and no-swap settings were held constant in the new cluster. Those settings differ from the second round, so these are not direct timing comparisons with that round.

The independent audit found a possible terminal race: the initial coordinator success check did not itself reject a late independent stop or stale final monitor state. It also identified missing independent SQL cleanup after coordinator loss. No incorrect admission was demonstrated. A separate [audit of all ten recorded boundaries](round3-20261025/wal-envelope-audit.json) confirms successful fidelity, deadlines, fresh boundary monitor samples, sampled reserves and absent stop markers. The original terminal record remains unchanged.

The next orchestration explicitly rejects stop, monitoring and deadline failures. Independent termination validates the owned private client and cleans up matching database/application/PID/backend-start identities. A [server probe](round3-20261025/enforcer-probe-facts.json) stopped the owned client and lingering SQL backend while an unrelated client and backend survived. These are monitoring correctness checks, not hospital capacity tests. Global cgroup sampling began during the first control; its early interval is unavailable. Per-trial Docker sampling and SQL start/end counters cover every trial. Sampled reserves are not continuous peak proof.

W0 verified and published the result. Its frozen private evidence root is `/ssd1/bim-forge-qualification/qvm-20261025/round3/artifacts/checkpoint-comparison-20261025a-terminal-evidence`. All prior data and artifacts remain retained. The next declared experiments separately measure resource sensitivity and byte-bounded batching, then attempt medium/full completion at the original CPU/RAM caps. Native computation ownership is a separate [draft proposal #154](https://github.com/Frederik91/bim-forge/pull/154). No production model, schema or preview changed.
