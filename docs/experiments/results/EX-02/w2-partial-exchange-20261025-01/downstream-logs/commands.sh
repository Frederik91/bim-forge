#!/bin/bash
set -eu
cd /qualification/sources/w2-debug
export PYTHONPATH=/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps
export PYTHONDONTWRITEBYTECODE=1
PY=/qualification/python/bin/python
UPSTREAM=/qualification/w2-runs/w2-debug-be6e71b-ifc-attempt2
TASK=/qualification/w2-runs/w2-downstream-be6e71b-20261025-01
LOGS="$TASK-logs"
mkdir "$LOGS"
cp /qualification/sources/w2-downstream-only.sh "$LOGS/commands.sh"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOGS/started-at.txt"
SOURCE_COMMIT=$(git -c safe.directory=/qualification/sources/w2-debug rev-parse HEAD)
if [ "$SOURCE_COMMIT" != be6e71b2cc641d669de9f2e57dec49623744100a ]; then exit 2; fi
printf '%s\n' "$SOURCE_COMMIT" > "$LOGS/source-commit.txt"
run_step() {
  name="$1"
  shift
  set +e
  "$@" > "$LOGS/$name.log" 2>&1
  code=$?
  set -e
  printf '%s\t%s\n' "$name" "$code" >> "$LOGS/status.tsv"
  cat "$LOGS/$name.log"
  printf '%s exit=%s\n' "$name" "$code"
  return "$code"
}
run_step verify-copy "$PY" - "$UPSTREAM" "$TASK" <<'PY'
import hashlib, json, shutil, sys
from pathlib import Path
source, target = map(Path, sys.argv[1:])
manifest = json.loads((source / 'manifest.json').read_text())
for item in manifest['artifacts']:
    path = (source / item['path']).resolve()
    path.relative_to(source.resolve())
    contents = path.read_bytes()
    if len(contents) != item['bytes'] or hashlib.sha256(contents).hexdigest() != item['sha256']:
        raise ValueError('Retained source artifact mismatch: ' + item['path'])
for name in ['property-inventory.json', 'bounded-property-inventory.json', 'inputs/rotated-mm-r1.json', 'inputs/native-model.schema.json', 'ifc-native/rotated-mm-r1.ifc', 'ifc-native/unfamiliar-bounded.ifc', 'core-observations.json']:
    if not (source / name).is_file():
        raise ValueError('Missing prerequisite: ' + name)
shutil.copytree(source, target)
provenance = {'runnerCommit': 'be6e71b2cc641d669de9f2e57dec49623744100a', 'upstream': str(source), 'upstreamManifestSha256': hashlib.sha256((source / 'manifest.json').read_bytes()).hexdigest(), 'verifiedArtifacts': len(manifest['artifacts']), 'prepareRerun': False, 'latestPytestAndJsonNullFixesExecuted': False}
(target / 'downstream-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print(json.dumps(provenance))
PY
run_step import-native node experiments/ifc/native.ts import-properties "$TASK/inputs/rotated-mm-r1.json" "$TASK/property-inventory.json" "$TASK/native-roundtrip.json"
run_step import-bounded node experiments/ifc/native.ts import-properties "$TASK/inputs/rotated-mm-r1.json" "$TASK/bounded-property-inventory.json" "$TASK/bounded-native-roundtrip.json"
if run_step roundtrip "$PY" experiments/ifc/run.py roundtrip --inputs "$TASK/inputs" --output "$TASK"; then
  printf 'Roundtrip exit zero; review actual observations\n'
else
  code=$?
  if [ "$code" -ne 1 ]; then exit "$code"; fi
  printf 'Roundtrip exit 1 preserved; no retry\n'
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOGS/finished-at.txt"