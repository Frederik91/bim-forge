#!/usr/bin/env bash
set -euo pipefail

helper=$(cd -- "$(dirname -- "$0")" && pwd)/read-allocation.sh
fixture=$(mktemp -d "${QVM_MONITOR_TEST_ROOT:?Set a retained test artifact directory}/allocation-test.XXXXXX")
mkdir "$fixture/data" "$fixture/bin"
printf 'retained bytes\n' > "$fixture/data/a"
printf '1\n' > "$fixture/count"
cat > "$fixture/bin/du" <<'DU'
#!/usr/bin/env bash
set -euo pipefail
count=$(cat "$QVM_DU_COUNT")
printf '%s\n' "$((count+1))" > "$QVM_DU_COUNT"
case "$QVM_DU_CASE" in
  transient) if [ "$count" -eq 1 ]; then echo 'du: temporary file disappeared' >&2; exit 1; fi; exec /usr/bin/du "$@" ;;
  persistent) echo 'du: permission or persistent I/O failure' >&2; exit 1 ;;
  malformed) printf 'invalid\tpath\n' ;;
  timeout) exec sleep 60 ;;
esac
DU
chmod +x "$fixture/bin/du"
export QVM_DU_COUNT="$fixture/count"
expected=$(/usr/bin/du --summarize --bytes -- "$fixture/data" | cut -f1)
actual=$(bash "$helper" "$fixture/data")
test "$actual" = "$expected"
echo 'PASS real complete server-container allocation scan'

actual=$(PATH="$fixture/bin:$PATH" QVM_DU_CASE=transient bash "$helper" "$fixture/data")
test "$actual" = "$expected"
test "$(cat "$fixture/count")" = 3
echo 'PASS transient failure requires a fresh successful complete scan'

for scenario in persistent malformed timeout; do
  printf '1\n' > "$fixture/count"
  if PATH="$fixture/bin:$PATH" QVM_DU_CASE="$scenario" bash "$helper" "$fixture/data" > "$fixture/$scenario.stdout" 2> "$fixture/$scenario.stderr"; then
    echo "Unexpected accepted $scenario allocation" >&2
    exit 1
  fi
  test ! -s "$fixture/$scenario.stdout"
  if [ "$scenario" = malformed ]; then test "$(cat "$fixture/count")" = 2
  else test "$(cat "$fixture/count")" = 4; fi
  echo "PASS $scenario fails closed without an estimate"
done

if bash "$helper" "$fixture/missing" > "$fixture/missing.stdout" 2> "$fixture/missing.stderr"; then exit 1; fi
test ! -s "$fixture/missing.stdout"
echo 'PASS actual missing directory fails closed'
printf 'Retained fixture: %s\n' "$fixture"
