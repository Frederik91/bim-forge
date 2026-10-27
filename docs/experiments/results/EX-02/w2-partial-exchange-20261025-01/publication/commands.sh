#!/bin/bash
set -eu
cd /qualification/sources/w2-debug
PACKAGE=/qualification/w2-runs/w2-terminal-package-20261025-01
LOGS="$PACKAGE/publication"
mkdir "$LOGS"
cp /qualification/sources/w2-publish-terminal-metadata.sh "$LOGS/commands.sh"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOGS/started-at.txt"
node --input-type=module <<'JS'
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseRun } from '/qualification/sources/w2-debug/experiments/contracts/schema.ts';
const root = '/qualification/w2-runs/w2-terminal-package-20261025-01';
await mkdir(`${root}/publication-inputs`);
for (const id of ['EX-02', 'EX-08']) {
  const original = parseRun(JSON.parse(await readFile(`${root}/inputs/${id}.input.json`, 'utf8')));
  const record = parseRun({ ...original, limitations: original.limitations.map(item => item === 'No terminal result was published. These are verified W0 input records for coordinator review; no PR merge or model approval is implied.'
    ? 'Terminal metadata publication records the failed/inconclusive evidence only; it is not registry adoption, PR merge or engineering/model approval.' : item) });
  if (JSON.stringify(record.observations) !== JSON.stringify(original.observations)) throw new Error('Publication must preserve executed observations exactly');
  await writeFile(`${root}/publication-inputs/${id}.input.json`, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
}
JS
node experiments/contracts/cli.ts publish "$PACKAGE/publication-inputs/EX-02.input.json" "$PACKAGE/evidence" "$PACKAGE/published" > "$LOGS/EX-02.log" 2>&1
cat "$LOGS/EX-02.log"
node experiments/contracts/cli.ts publish "$PACKAGE/publication-inputs/EX-08.input.json" "$PACKAGE/evidence" "$PACKAGE/published" > "$LOGS/EX-08.log" 2>&1
cat "$LOGS/EX-08.log"
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = '/qualification/w2-runs/w2-terminal-package-20261025-01';
const entries = [];
for (const [id, runId] of [['EX-02', 'w2-partial-exchange-20261025-01'], ['EX-08', 'w2-partial-coordinates-20261025-01']]) {
  const path = `published/${id}/${runId}/result.json`;
  const bytes = await readFile(`${root}/${path}`);
  const result = JSON.parse(bytes.toString('utf8'));
  entries.push({ experimentId: id, path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength, conclusion: result.conclusion,
    observations: result.observations.length, failedObservations: result.observations.filter(row => !row.passed).length });
}
await writeFile(`${root}/publication/receipt.json`, `${JSON.stringify({ publishedAt: new Date().toISOString(), evidenceRoot: `${root}/evidence`, preparationExecuted: false, databaseJobsExecuted: false,
  fullHospitalBranchTouched: false, records: entries }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(entries));
JS
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOGS/finished-at.txt"