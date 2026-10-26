set -euo pipefail
tar -xf /prepared/review-source.tar -C /app
mkdir -p /app/docs/experiments/diagnostics/publication-162
cp /prepared/{budget.py,control.py,instrument.py,safety_test.py,probe.ts,driver.ts,tsconfig.json,README.md,client.sh,check.sh} /app/docs/experiments/diagnostics/publication-162/
ln -sf /qualification/qvm-20261025/node-storage/node_modules/pg /app/node_modules/pg
ln -sf /qualification/qvm-20261025/node-storage/node_modules/@types/pg /app/node_modules/@types/pg
cd /app
npm run validate -- --changed-files docs/experiments/diagnostics/publication-162/budget.py docs/experiments/diagnostics/publication-162/control.py docs/experiments/diagnostics/publication-162/instrument.py docs/experiments/diagnostics/publication-162/safety_test.py docs/experiments/diagnostics/publication-162/probe.ts docs/experiments/diagnostics/publication-162/driver.ts docs/experiments/diagnostics/publication-162/tsconfig.json docs/experiments/diagnostics/publication-162/README.md docs/experiments/diagnostics/publication-162/client.sh docs/experiments/diagnostics/publication-162/check.sh
mkdir -p /app/experiments/issue162-stylecheck
cp /prepared/{probe.ts,driver.ts} /app/experiments/issue162-stylecheck/
node scripts/validate-typescript.ts
python3 -m unittest discover -s /app/docs/experiments/diagnostics/publication-162 -p safety_test.py -v
mkdir /app/measured
tar -xf /prepared/measured-source.tar -C /app/measured
ln -s /app/node_modules /app/measured/node_modules
mkdir -p /app/measured/docs/experiments/diagnostics/publication-162
cp /prepared/{probe.ts,driver.ts,tsconfig.json} /app/measured/docs/experiments/diagnostics/publication-162/
python3 /prepared/instrument.py /measured /prepared/generated
cp /prepared/generated/{load-profile.ts,workload-profile.ts} /app/measured/experiments/storage/
cd /app/measured
/app/node_modules/.bin/tsc --noEmit -p docs/experiments/diagnostics/publication-162/tsconfig.json
cp /prepared/generated/{load-profile.ts,workload-profile.ts,instrumentation.json} /prepared/
bash -n /prepared/client.sh
printf '%s\n' 'PASS: root validation, diagnostic style/strict compile, safety cases, and client shell syntax. No DB started.'
