set -euo pipefail
tar -xf /prepared/measured-source.tar -C /app
mkdir -p /app/docs/experiments/diagnostics/publication-162
cp /prepared/{driver.ts,probe.ts,tsconfig.json} /app/docs/experiments/diagnostics/publication-162/
cp /prepared/{load-profile.ts,workload-profile.ts} /app/experiments/storage/
ln -sf /qualification/qvm-20261025/node-storage/node_modules/pg /app/node_modules/pg
ln -sf /qualification/qvm-20261025/node-storage/node_modules/@types/pg /app/node_modules/@types/pg
node /app/docs/experiments/diagnostics/publication-162/driver.ts > /e/client.stdout.log 2> /e/client.stderr.log
