#!/bin/sh
set -eu
# Run on the server, never on the workstation. Argument is a fresh 40-char commit.
revision="$1"
case "$revision" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#revision}" -eq 40 ]
root=/ssd1/bim-forge-qualification/issue225
run="$root/run-$revision"
[ ! -e "$run" ]
mkdir -p "$run/artifacts/tmp" "$run/artifacts/home"
git clone --quiet "$root/input/source.bundle" "$run/source"
git -C "$run/source" checkout --quiet --detach "$revision"
mkdir -p "$run/source/node_modules"
git -C "$run/source" diff --name-only e7f6ff36a895feaf72b8cf88342278b6a3bf2dc2 "$revision" > "$run/artifacts/changed-paths.txt"
{ date -u; uptime; nproc; docker image inspect bim-qvm-tools:20261025 --format '{{.Id}}'; } > "$run/artifacts/host.txt"
name="bim-225-$(printf %s "$revision" | cut -c1-10)"
set +e
docker run --name "$name" --network none --read-only --cpus 2 --memory 3g --memory-swap 3g --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges:true --user 1000:1000 \
  --mount type=bind,src="$run/source",dst=/work,readonly \
  --mount type=bind,src=/ssd1/bim-forge-qualification/all-ready-195/final/dependencies,dst=/work/node_modules,readonly \
  --mount type=bind,src="$run/artifacts",dst=/evidence \
  -e TMPDIR=/evidence/tmp -e TMP=/evidence/tmp -e TEMP=/evidence/tmp -e HOME=/evidence/home -w /work --entrypoint sh bim-qvm-tools:20261025 -c '
    set -eu
    npm run validate > /evidence/validate.log 2>&1
    node scripts/validate-policy.ts --changed-files $(cat /evidence/changed-paths.txt) > /evidence/policy.log 2>&1
    timeout 240 node experiments/llm-geometry-225/pilot.ts /evidence/pilot > /evidence/pilot.log 2>&1
    node experiments/llm-geometry-225/contract.ts --check-trials experiments/llm-geometry-225/receipts/llm-trials.json > /evidence/trial-contract.log 2>&1
    timeout 120 python3 experiments/llm-geometry-225/oracle.py /evidence/pilot experiments/llm-geometry-225/receipts/llm-trials.json > /evidence/oracle.log 2>&1
  '
status=$?
set -e
docker inspect "$name" > "$run/artifacts/container-inspect.json"
printf '%s\n' "$status" > "$run/artifacts/exit-code.txt"
cat "$run/artifacts/validate.log"
[ ! -f "$run/artifacts/oracle.log" ] || cat "$run/artifacts/oracle.log"
exit "$status"
