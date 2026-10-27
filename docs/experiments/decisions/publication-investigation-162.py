"""Read retained round3 evidence without connecting to or changing PostgreSQL.

Usage: python3 publication-investigation-162.py /qualification/round3
Writes JSON to stdout. All input paths are opened read-only. No subprocesses.
"""

import collections
import datetime
import hashlib
import json
import pathlib
import sys


def timestamp(value):
    return datetime.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))


def fields(value):
    return {key: int(count) for key, count in (line.split() for line in value.splitlines())}


def io_fields(value):
    return {
        parts[0]: {key: int(count) for key, count in (item.split("=") for item in parts[1:])}
        for parts in (line.split() for line in value.splitlines())
    }


def difference(before, after):
    result = {key: after[key] - before[key] for key in before.keys() & after.keys()}
    if any(value < 0 for value in result.values()):
        raise ValueError("Counter decreased; evidence may cross a counter reset")
    return result


def cgroup_difference(before, after):
    old_io, new_io = io_fields(before["io.stat"]), io_fields(after["io.stat"])
    return {
        "cpu": difference(fields(before["cpu.stat"]), fields(after["cpu.stat"])),
        "memoryEvents": difference(fields(before["memory.events"]), fields(after["memory.events"])),
        "memoryCounters": difference(
            {key: value for key, value in fields(before["memory.stat"]).items()
             if key in ("workingset_refault_file", "pgscan_direct", "pgsteal_direct", "pgmajfault")},
            fields(after["memory.stat"]),
        ),
        "ioByDevice": {key: difference(old_io[key], new_io[key]) for key in old_io.keys() & new_io.keys()},
        "memoryCurrentBytesBefore": int(before["memory.current"]),
        "memoryCurrentBytesAfter": int(after["memory.current"]),
    }


def main():
    if len(sys.argv) != 2:
        raise ValueError("Expected exactly one retained round3 directory")
    root = pathlib.Path(sys.argv[1]).resolve(strict=True)
    run = "r3-hospital-full-20261025a"
    artifact = root / "artifacts" / run
    diagnostic = root / "artifacts" / "monitor-stop-diagnostic-20261026a"
    hashes = {}

    def fingerprint(path):
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        hashes[str(path.relative_to(root))] = {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}

    def read_json(path):
        fingerprint(path)
        return json.loads(path.read_text(encoding="utf-8"))

    def read_text(path):
        fingerprint(path)
        return path.read_text(encoding="utf-8").strip()

    def read_lines(path):
        fingerprint(path)
        with path.open(encoding="utf-8") as source:
            for line in source:
                yield json.loads(line)

    facts = read_json(artifact / "execution-facts.json")
    source = read_text(artifact / "source-commit.txt")
    if source != "3a0b1ef3ec44c2e741fa5858d83d0ef8a7ce5098" or facts["sourceCommit"] != source:
        raise ValueError("Unexpected measured source")
    config = read_json(artifact / "config.json")
    start = timestamp(read_text(artifact / "job-started-at.txt"))
    end = timestamp(read_text(artifact / "job-finished-at.txt"))
    observations = [read_json(diagnostic / name) for name in
                    ("publication-observation-2231.json", "publication-observation-2348.json")]
    metadata = read_json(diagnostic / "diagnostic.json")
    for entry in metadata["artifacts"]:
        path = diagnostic / entry["path"]
        fingerprint(path)
        actual = hashes[str(path.relative_to(root))]
        if actual != {"bytes": entry["bytes"], "sha256": entry["sha256"]}:
            raise ValueError("Retained diagnostic hash mismatch: " + entry["path"])
    for row in observations:
        if row["application"] != run or row["query"] != (
            "INSERT INTO qvm_storage.changes SELECT $1,entity_id,version_id FROM w5_load_stage"
        ):
            raise ValueError("Unexpected query observation")
        hours, minutes, seconds = row["queryAge"].split(":")
        age = datetime.timedelta(hours=int(hours), minutes=int(minutes), seconds=float(seconds))
        row["inferredQueryStart"] = (timestamp(row["at"]) - age).isoformat()

    before = read_json(artifact / "postgres-cgroup-before.json")
    after = read_json(artifact / "postgres-cgroup-after.json")
    metrics_before = read_json(artifact / "metrics-before.json")
    metrics_after = read_json(artifact / "metrics-after.json")
    if metrics_before["wal"]["stats_reset"] != metrics_after["wal"]["stats_reset"]:
        raise ValueError("Cluster statistics reset")
    if metrics_before["database"]["datid"] != metrics_after["database"]["datid"]:
        raise ValueError("Database identity changed")
    if metrics_before["database"]["stats_reset"] != metrics_after["database"]["stats_reset"]:
        raise ValueError("Database statistics reset")
    counters = ("blks_read", "blks_hit", "temp_bytes", "temp_files", "blk_read_time", "blk_write_time", "xact_rollback")

    progress = list(read_lines(artifact / "progress.ndjson"))
    owned = [row for row in progress if start <= timestamp(row["at"]) <= end]
    activity = collections.Counter(
        (item["state"], item["wait"], item["event"])
        for row in owned for item in row["activity"] if item["application"] == run
    )
    cgroups = [row for row in read_lines(root / "cgroup-resources.ndjson")
              if start <= timestamp(row["timestamp"]) <= end]
    if not cgroups or not owned:
        raise ValueError("No retained samples within job timestamps")
    interval_start, interval_end = (timestamp(row["at"]) for row in observations)
    interval = [row for row in cgroups if interval_start <= timestamp(row["timestamp"]) <= interval_end]
    if len(interval) < 2:
        raise ValueError("Missing cgroup samples between point observations")
    stats = list(read_lines(artifact / "resources.ndjson"))
    client_cpu = [float(row["stats"]["CPUPerc"].removesuffix("%")) for row in stats
                  if row["stats"]["Name"] == "bim-qvm-" + run
                  and interval_start <= timestamp(row["timestamp"]) <= interval_end]
    result = {
        "status": "ISSUES",
        "method": "Offline file reads and counter subtraction; no DB execution; no speedup or overall-limiter verdict",
        "measuredSource": source,
        "evidenceReviewBase": "2e65ae825eb9542de02b54f197eede4de0906a56",
        "runDecisionCommit": read_text(artifact / "decision-commit.txt"),
        "jobStart": start.isoformat(), "jobEnd": end.isoformat(),
        "jobElapsedSeconds": (end - start).total_seconds(),
        "terminal": facts,
        "resources": config["environment"],
        "queryObservations": observations,
        "wholeJobCgroupDeltaIncludingCleanup": cgroup_difference(before, after),
        "wholeJobDatabaseDeltaIncludingObservers": {
            key: metrics_after["database"][key] - metrics_before["database"][key] for key in counters
        },
        "wholeJobClusterWalBytesDelta": metrics_after["wal"]["wal_bytes"] - metrics_before["wal"]["wal_bytes"],
        "wholeJobCgroupSampleCount": len(cgroups),
        "wholeJobCgroupMaxGapSeconds": max(
            (timestamp(right["timestamp"]) - timestamp(left["timestamp"])).total_seconds()
            for left, right in zip(cgroups, cgroups[1:])
        ),
        "ownedActivitySampleCounts": [
            {"state": state, "waitType": wait, "event": event, "count": count}
            for (state, wait, event), count in activity.items()
        ],
        "activityCaveat": "Periodic whole-job point samples without SQL text; counts are not durations or publication attribution",
        "betweenObservationsCgroupWindow": {
            "firstAt": interval[0]["timestamp"], "lastAt": interval[-1]["timestamp"],
            "samples": len(interval), "delta": cgroup_difference(interval[0], interval[-1]),
            "clientCpuPercentSamples": len(client_cpu),
            "clientCpuPercentRange": [min(client_cpu), max(client_cpu)] if client_cpu else None,
            "caveat": "Cluster-wide cgroup counters; samples bounded inside query observations; not query-exclusive telemetry",
        },
        "postRunState": read_json(artifact / "exact-state.json"),
        "hashes": hashes,
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
