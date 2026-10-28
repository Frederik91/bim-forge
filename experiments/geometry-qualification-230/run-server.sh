#!/usr/bin/env bash
# Run on frederik@192.168.1.17 only after parent authorizes a qualification reservation.+# No SSH retries, pulls, dependency installation, preview changes, or worker218 replays.
set -euo pipefail
umask 077
mode=${1:?Usage: run-server.sh converter|validate|browser SOURCE_CHECKOUT EVIDENCE_ROOT}
source_checkout=$(realpath "${2:?source checkout}")
evidence_root=$(realpath -m "${3:?new /ssd1 evidence root}")
case "$source_checkout" in /ssd1/*) ;; *) echo 'Source bundle must be under /ssd1' >&2; exit 2;; esac
case "$evidence_root" in /ssd1/*/issue234|/ssd1/*/issue234/*) ;; *) echo 'Use a dedicated /ssd1/.../issue234 evidence root' >&2; exit 2;; esac
case "$mode" in converter|validate|browser) ;; *) exit 2;; esac
test -f /.dockerenv && { echo 'Invoke the supervisor on the qualification server host' >&2; exit 2; }
test "${QUAL_SERVER_RESERVATION:-}" = issue234 || { echo 'Parent must reserve this source/run before execution' >&2; exit 2; }
sha=$(git -C "$source_checkout" rev-parse HEAD)
test -z "$(git -C "$source_checkout" status --porcelain --untracked-files=normal)" || { echo 'Source must be clean and committed' >&2; exit 2; }
deps=${QUAL_NODE_DEPS:?Set the cached direct node_modules directory under /ssd1, without installing packages}
node_image=${QUAL_NODE_IMAGE:-bim-qvm-tools:20261025}
python_prefix=${QUAL_PYTHON_PREFIX:-/ssd1/bim-forge-qualification/qvm-20261025/python}
python_deps=${QUAL_PYTHON_DEPS:-/ssd1/bim-forge-qualification/qvm-20261025/w2-runs/w2-source-unit-c30979d-20261025-01/python-deps}
python_image=${QUAL_PYTHON_IMAGE:?Set the already cached IfcOpenShell-compatible Python image, no image pulls}
python_bin=${QUAL_PYTHON_BIN:?Set the executable within the cached read-only Python prefix}
test -d "$deps" && test -d "$python_prefix" && test -d "$python_deps"
test -f "$deps/typescript/package.json" && test -f "$deps/playwright/package.json"
for mount_source in "$deps" "$python_prefix" "$python_deps"; do
  case "$(realpath "$mount_source")" in /ssd1/*) ;; *) echo 'Dependencies must stay on /ssd1' >&2; exit 2;; esac
done
mkdir -p "$evidence_root"
# One serialized reservation counts every started container run, including red runs.
exec 9>"$evidence_root/attempts.lock"
flock -x 9
ledger="$evidence_root/attempts.tsv"
test -f "$ledger" || printf 'attempt\tmode\tsource\tstarted_utc\texit\n' > "$ledger"
attempt=$(($(wc -l < "$ledger")))
test "$attempt" -le 10 || { echo 'Ten total attempts exhausted. Ask owner before retry.' >&2; exit 3; }
run="$evidence_root/attempt-$attempt-$mode-${sha:0:12}"
mkdir "$run"
printf '%s\t%s\t%s\t%s\tstarted\n' "$attempt" "$mode" "$sha" "$(date -u +%FT%TZ)" >> "$ledger"
flock -u 9
container_name="issue234-$mode-$attempt"
finish() {
  final_status=$?
  trap - EXIT
  # The daemon may outlive a timed-out docker CLI. Stop only this attempt's container.
  docker rm -f "$container_name" > "$run/container-cleanup.log" 2>&1 || true
  printf '%s\n' "$final_status" > "$run/exit-code.txt"
  flock -x 9
  printf '%s\t%s\t%s\t%s\t%s\n' "$attempt" "$mode" "$sha" "$(date -u +%FT%TZ)" "$final_status" >> "$evidence_root/results.tsv"
  flock -u 9
  echo "Retained $run; exit=$final_status"
  exit "$final_status"
}
trap finish EXIT
mkdir -p "$run/source" "$run/artifacts" "$run/tmp" "$run/home" "$run/cache" "$run/bundle"
printf '%s\n' "$sha" > "$run/source-sha.txt"
git -C "$source_checkout" archive "$sha" | tar -x -C "$run/source"
mkdir -p "$run/source/node_modules" "$run/source/dist"
git -C "$source_checkout" diff --name-only e43dd859a631ff8676d080011607447806beeb34 "$sha" > "$run/changed-paths.txt"
tar -C "$run/source" --exclude=node_modules --exclude=dist -cf "$run/source.tar" .
sha256sum "$run/source.tar" > "$run/source.tar.sha256"
common=(--pull=never --rm --log-driver none --network none --read-only --cpus 2 --memory 4g --pids-limit 256
  --cap-drop ALL --security-opt no-new-privileges --user "$(id -u):$(id -g)"
  --mount "type=bind,src=$run/source,dst=/src,readonly"
  --mount "type=bind,src=$deps,dst=/src/node_modules,readonly"
  --mount "type=bind,src=$run/artifacts,dst=/ssd1/run/artifacts"
  --mount "type=bind,src=$run/tmp,dst=/tmp"
  --mount "type=bind,src=$run/home,dst=/ssd1/run/home"
  --mount "type=bind,src=$run/cache,dst=/ssd1/run/cache"
  --env HOME=/ssd1/run/home --env XDG_CACHE_HOME=/ssd1/run/cache --env TMPDIR=/tmp
  --env QUAL_SERVER_CONTAINER=issue234 --env QUAL_ARTIFACTS=/ssd1/run/artifacts --env QUAL_SOURCE_SHA="$sha"
  --workdir /src)
exit_code=0
case "$mode" in
  converter)
    docker image inspect "$python_image" > "$run/image.json" 2>> "$run/raw.log"
    timeout --signal=TERM --kill-after=10s 240s docker run --name "$container_name" "${common[@]}" \
      --mount "type=bind,src=$python_prefix,dst=$python_prefix,readonly" \
      --mount "type=bind,src=$python_deps,dst=$python_deps,readonly" \
      --env "PYTHONPATH=$python_deps" --env PYTHONDONTWRITEBYTECODE=1 \
      "$python_image" "$python_bin" experiments/geometry-qualification-230/test_qualification.py > "$run/raw.log" 2>&1 || exit_code=$?
    ;;
  validate)
    docker image inspect "$node_image" > "$run/image.json" 2>> "$run/raw.log"
    timeout --signal=TERM --kill-after=10s 300s docker run --name "$container_name" "${common[@]}" \
      --mount "type=bind,src=$run/changed-paths.txt,dst=/ssd1/run/changed-paths.txt,readonly" \
      "$node_image" sh -eu -c 'npm run validate; node scripts/validate-policy.ts --changed-files $(cat /ssd1/run/changed-paths.txt)' > "$run/raw.log" 2>&1 || exit_code=$?
    ;;
  browser)
    # Parent must run converter sidecar on this dedicated spool, in its OWN bounded container.
    # No provider connection or production preview is available to this process.
    fixtures=$(realpath "${QUAL_FIXTURES:?retained successful converter attempt fixtures directory}")
    spool=$(realpath "${QUAL_IFC_SPOOL:?parent-reserved dedicated issue234 sidecar spool}")
    browsers=${QUAL_BROWSERS:-/ssd1/bim-forge-qualification/compact213/browsers}
    browser_libraries=${QUAL_BROWSER_LIBS:-/ssd1/bim-forge-qualification/issue218/browser-deps/extracted}
    for location in "$fixtures" "$spool" "$browsers" "$browser_libraries"; do
      case "$location" in /ssd1/*) ;; *) exit 2;; esac
    done
    docker image inspect "$node_image" > "$run/image.json" 2>> "$run/raw.log"
    timeout --signal=TERM --kill-after=10s 300s docker run --name "$container_name" "${common[@]}" \
      --mount "type=bind,src=$run/bundle,dst=/src/dist" \
      --mount "type=bind,src=$fixtures,dst=/ssd1/run/fixtures,readonly" \
      --mount "type=bind,src=$spool,dst=/ssd1/run/spool" \
      --mount "type=bind,src=$browsers,dst=$browsers,readonly" \
      --mount "type=bind,src=$browser_libraries,dst=$browser_libraries,readonly" \
      --env "PLAYWRIGHT_BROWSERS_PATH=$browsers" --env "LD_LIBRARY_PATH=$browser_libraries/usr/lib/x86_64-linux-gnu" \
      --env IFC_EXTERNAL_SPOOL=/ssd1/run/spool --env QUAL_FIXTURES=/ssd1/run/fixtures \
      "$node_image" sh -eu -c 'npm run build:demo; node --test --test-concurrency=1 demo/geometry-workflow-browser.test.ts' > "$run/raw.log" 2>&1 || exit_code=$?
    ;;
esac
exit "$exit_code"
