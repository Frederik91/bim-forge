#!/bin/bash
set -eu
cd /qualification/sources/w2-debug
RUN=/qualification/w2-runs/w2-source-unit-c30979d-20261025-01
mkdir "$RUN"
cp /qualification/sources/w2-final-source-unit-checks.sh "$RUN/commands.sh"
export PYTHONPATH="$RUN/python-deps"
export PYTHONDONTWRITEBYTECODE=1
PY=/qualification/python/bin/python
git -c safe.directory=/qualification/sources/w2-debug rev-parse HEAD > "$RUN/source-commit.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$RUN/started-at.txt"
run_step() {
  name="$1"
  shift
  set +e
  "$@" > "$RUN/$name.log" 2>&1
  code=$?
  set -e
  printf '%s\t%s\n' "$name" "$code" >> "$RUN/status.tsv"
  cat "$RUN/$name.log"
  printf '%s exit=%s\n' "$name" "$code"
  return "$code"
}
run_step dependencies "$PY" -m pip install --only-binary=:all: --target "$PYTHONPATH" -r experiments/ifc/requirements.txt
run_step validate npm run validate
run_step strict-typecheck ./node_modules/.bin/tsc --project experiments/ifc/tsconfig.json --noEmit
run_step native-unit node --test experiments/ifc/native.test.ts
run_step python-unit "$PY" -m unittest discover -s experiments/ifc -p 'test_*.py' -v
date -u +%Y-%m-%dT%H:%M:%SZ > "$RUN/finished-at.txt"