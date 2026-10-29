#!/bin/sh
set -eu
# Server-only qualification. A new attempt consumes the owner-authorized issue231 budget.
revision="$1"
attempt="$2"
case "$revision" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#revision}" -eq 40 ]
case "$attempt" in 1|2|3|4|5|6|7|8|9|10) ;; *) exit 2;; esac
root=/ssd1/bim-forge-qualification/issue231
run="$root/attempt-$attempt-$revision"
[ -f "$root/input/source.bundle" ]
[ ! -e "$run" ]
mkdir -p "$run/artifacts/tmp" "$run/artifacts/home" "$run/artifacts/npm"
git clone --quiet "$root/input/source.bundle" "$run/source"
git -C "$run/source" checkout --quiet --detach "$revision"
mkdir -p "$run/source/node_modules"
git -C "$run/source" diff --name-only f4285c644e52b5bdba8e4f6afeb6e099bc02b891 "$revision" > "$run/artifacts/changed-paths.txt"
{ date -u; git -C "$run/source" rev-parse HEAD; docker image inspect bim-qvm-tools:20261025 --format '{{.Id}}'; } > "$run/artifacts/source-image.txt"
name="bim-231-attempt-$attempt"
set +e
timeout --signal=TERM --kill-after=15 360 docker run --name "$name" --init --stop-timeout 5 --network none --read-only \
  --cpus 2 --memory 3g --memory-swap 3g --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges:true --user 1000:1000 \
  --mount type=bind,src="$run/source",dst=/work,readonly \
  --mount type=bind,src=/ssd1/bim-forge-qualification/all-ready-195/final/dependencies,dst=/work/node_modules,readonly \
  --mount type=bind,src="$run/artifacts",dst=/evidence \
  -e TMPDIR=/evidence/tmp -e TMP=/evidence/tmp -e TEMP=/evidence/tmp -e HOME=/evidence/home -e npm_config_cache=/evidence/npm \
  -w /work --entrypoint sh bim-qvm-tools:20261025 -c '
    exec timeout --signal=TERM --kill-after=10 300 sh -c '\''
      set -eu
      npm run validate > /evidence/validate.log 2>&1
      node scripts/validate-policy.ts --changed-files $(cat /evidence/changed-paths.txt) > /evidence/policy.log 2>&1
      node --test src/geometry-query.test.ts > /evidence/geometry-tests.log 2>&1
    '\''
  ' > "$run/artifacts/container.log" 2>&1
status=$?
set -e
docker inspect "$name" > "$run/artifacts/container-inspect.json" 2>&1 || true
printf '%s\n' "$status" > "$run/artifacts/exit-code.txt"
find "$run/artifacts" -type f ! -name sha256.txt -exec sha256sum {} \; > "$run/artifacts/sha256.txt"
exit "$status"
