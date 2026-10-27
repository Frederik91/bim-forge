set -euo pipefail
N=/qualification/round3
trap 'echo "Budget monitor exited without a stop request" > "$N/BUDGET-MONITOR-FAILED"' ERR
while [ ! -f "$N/STOP-BUDGET-MONITOR" ]; do
 used=$(du -sb /qualification | cut -f1)
 root=$(df -B1 --output=avail /host-root | tail -1 | tr -d ' ')
 data=$(df -B1 --output=avail /qualification | tail -1 | tr -d ' ')
 mem=$(awk '/MemAvailable:/{printf "%.0f",$2*1024}' /host-root/proc/meminfo)
 printf '{"timestamp":"%s","usedBytes":%s,"rootAvailableBytes":%s,"dataAvailableBytes":%s,"hostAvailableMemoryBytes":%s}\n' "$(date -u +%FT%TZ)" "$used" "$root" "$data" "$mem" >> "$N/budget.ndjson"
 if [ "$used" -gt 214748364800 ] || [ "$root" -lt 4294967296 ] || [ "$data" -lt 107374182400 ] || [ "$mem" -lt 1073741824 ]; then
  echo 'Aggregate disk/free-space/host-memory reserve breached' > "$N/BUDGET-STOP"
  exit 2
 fi
 sleep 10
done
