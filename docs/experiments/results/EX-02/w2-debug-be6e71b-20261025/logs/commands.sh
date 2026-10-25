#!/bin/bash
set -eu
cd /qualification/sources/w2-debug
export PYTHONPATH=/qualification/w2-runs/w2-debug-378c0ad-attempt2/python-deps
export PYTHONDONTWRITEBYTECODE=1
PY=/qualification/python/bin/python
RUN=/qualification/w2-runs/w2-debug-be6e71b-ifc-attempt2
LOGS="$RUN-logs"
mkdir "$LOGS"
cp /qualification/sources/w2-debug-final-commands.sh "$LOGS/commands.sh"
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
SOURCE_COMMIT=$(git -c safe.directory=/qualification/sources/w2-debug rev-parse HEAD)
printf '%s\n' "$SOURCE_COMMIT" > "$LOGS/source-commit.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOGS/started-at.txt"
cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max > "$LOGS/container-limits.txt"
run_step validate npm run validate
run_step strict-typecheck ./node_modules/.bin/tsc --project experiments/ifc/tsconfig.json --noEmit
run_step native-unit node --test experiments/ifc/native.test.ts
run_step python-unit "$PY" -m unittest discover -s experiments/ifc -p 'test_*.py' -v
run_step generate node experiments/ifc/native.ts generate "$RUN-inputs"
run_step prepare "$PY" experiments/ifc/run.py prepare --inputs "$RUN-inputs" --output "$RUN" --source-commit "$SOURCE_COMMIT"
run_step import-native node experiments/ifc/native.ts import-properties "$RUN-inputs/rotated-mm-r1.json" "$RUN/property-inventory.json" "$RUN/native-roundtrip.json"
run_step import-bounded node experiments/ifc/native.ts import-properties "$RUN-inputs/rotated-mm-r1.json" "$RUN/bounded-property-inventory.json" "$RUN/bounded-native-roundtrip.json"
if run_step roundtrip "$PY" experiments/ifc/run.py roundtrip --inputs "$RUN-inputs" --output "$RUN"; then
  printf 'Roundtrip returned zero: inspect observations for changed capability\n'
else
  code=$?
  if [ "$code" -ne 1 ]; then exit "$code"; fi
  printf 'Roundtrip exit 1 retained; check exact failed observations\n'
fi
run_step w0-observations node experiments/contracts/cli.ts observations "$RUN/roundtrip/all-observations.json"
run_step coverage-bundle node experiments/ifc/observations.ts "$RUN/roundtrip/all-observations.json" "$RUN/review-bundle.json"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOGS/finished-at.txt"