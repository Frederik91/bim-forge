"""Create additional instrumented modules; never overwrite measured source files."""
import hashlib
import json
import pathlib
import sys


def instrument(source, output):
    source, output = pathlib.Path(source), pathlib.Path(output)
    output.mkdir(parents=True, exist_ok=True)
    original = (source / "experiments/storage/load.ts").read_text()
    text = original
    points = [
        ("ingest", "  await store.client.query(`CREATE TEMP TABLE w5_load_stage(entity_id text PRIMARY KEY,version_id text NOT NULL) ON COMMIT PRESERVE ROWS`);", False),
        ("analyze-stage", "    await store.client.query('ANALYZE w5_load_stage');", True),
        ("analyze-versions", "    await store.client.query('ANALYZE qvm_storage.versions');", True),
        ("changes", "      await store.client.query(`INSERT INTO qvm_storage.changes SELECT $1,entity_id,version_id FROM w5_load_stage`, [revisionId]);", True),
        ("visibility", "      await store.client.query(`INSERT INTO qvm_storage.visibility\n        SELECT $1,v.entity_id,v.version_id,v.kind,v.type_id,v.container_id,v.system_id,v.from_id,v.to_id\n        FROM w5_load_stage s JOIN qvm_storage.versions v USING(version_id)`, [branch]);", True),
        ("analyze-visibility", "      await store.client.query('ANALYZE qvm_storage.visibility');", True),
        ("references", "      await store.validateReferences(branch);", True),
        ("head", "      await store.client.query(`UPDATE qvm_storage.branches SET head=$2 WHERE branch=$1`, [branch, revisionId]);", True),
        ("receipt", "      await store.client.query(`INSERT INTO qvm_storage.receipts VALUES($1,$2,$2)`, [`load:${revisionId}`, revisionId]);", True),
        ("analyze-changes", "    await store.client.query('ANALYZE qvm_storage.changes');", True),
    ]
    for name, statement, after in points:
        if text.count(statement) != 1:
            raise ValueError("Measured source hook no longer unique: " + name)
        prefix = " " * (len(statement) - len(statement.lstrip()))
        replacement = prefix + "await phase(store, '" + name + "-before');\n" + statement
        if after:
            replacement += "\n" + prefix + "await phase(store, '" + name + "-after');"
        text = text.replace(statement, replacement)
    needle = "    const published = performance.now();"
    if text.count(needle) != 1:
        raise ValueError("Commit hook changed")
    text = text.replace(needle, "    await phase(store, 'commit-after');\n" + needle)
    text = "import { phase } from '../../docs/experiments/diagnostics/publication-162/probe.ts';\n" + text
    (output / "load-profile.ts").write_text(text)
    workload = (source / "experiments/storage/workload.ts").read_text()
    old_import = "from './load.ts';"
    if workload.count(old_import) != 1:
        raise ValueError("Workload load import changed")
    (output / "workload-profile.ts").write_text(workload.replace(old_import, "from './load-profile.ts';"))
    manifest = {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                for name in ("load-profile.ts", "workload-profile.ts")}
    manifest["originalLoadSha256"] = hashlib.sha256((source / "experiments/storage/load.ts").read_bytes()).hexdigest()
    (output / "instrumentation.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    instrument(*sys.argv[1:])
