#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'Usage: read-allocation.sh directory' >&2
  exit 1
fi

# A disappearing temporary file invalidates that scan, not the next scan.
for attempt in 1 2 3; do
  if scan=$(LC_ALL=C timeout --kill-after=1s 10s du --summarize --bytes -- "$1"); then
    bytes=${scan%%$'\t'*}
    if [[ "$scan" != *$'\t'* || ! "$bytes" =~ ^[0-9]+$ || ${#bytes} -gt 18 ]]; then
      echo 'Allocation scan returned malformed byte accounting' >&2
      exit 1
    fi
    printf '%s\n' "$bytes"
    exit 0
  fi
  printf 'Allocation scan attempt %s failed; no estimate accepted\n' "$attempt" >&2
done

echo 'No complete allocation scan after three bounded attempts' >&2
exit 1
