import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dependencyCases } from './cases.ts';
import { parseObservations } from './contract.ts';
import type { Observation } from './contract.ts';
import type { Coverage } from '../contracts/schema.ts';
import { sha256 } from '../contracts/records.ts';

const { values } = parseArgs({ options: { out: { type: 'string' }, occt: { type: 'string' } } });
if (!values.out) throw new Error('Required: --out <new-run-directory> [--occt <occt-observations.json>]');
const output = resolve(values.out);
// Non-recursive creation prevents overwriting earlier evidence. The parent must exist.
mkdirSync(output);
const observations: Observation[] = [];
const raw: { caseId: string; artifact: unknown; error: string | null }[] = [];
for (const entry of dependencyCases) {
  let artifact: unknown = null;
  let error: string | null = null;
  try {
    const execution = entry.execute();
    artifact = execution.artifact;
    execution.verify();
  } catch (cause) { error = cause instanceof Error ? cause.stack ?? cause.message : String(cause); }
  raw.push({ caseId: entry.caseId, artifact, error });
  observations.push({ experimentId: 'EX-07', caseId: entry.caseId, expected: entry.expected,
    observed: error ?? JSON.stringify(artifact) ?? 'No artifact returned', passed: error === null,
    limitations: ['Bounded one-dimensional deterministic evaluator; no production model acceptance or external authoring API.'] });
}
writeFileSync(resolve(output, 'dependency-artifacts.json'), `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx' });
if (values.occt) {
  try {
    const source = readFileSync(values.occt);
    writeFileSync(resolve(output, 'occt-observations.source.json'), source, { flag: 'wx' });
    writeFileSync(resolve(output, 'occt-input.json'), `${JSON.stringify({
      source: values.occt, bytes: source.length, sha256: sha256(source),
    }, null, 2)}\n`, { flag: 'wx' });
    const value: unknown = JSON.parse(source.toString('utf8'));
    const imported = parseObservations(value);
    const expected = ['occt-real-face-split', 'occt-raw-index-reference', 'occt-datum-ambiguity',
      'occt-semantic-anchor', 'occt-boundary-anchor-pending', 'occt-reordered-traversal'];
    const actual = imported.map((entry) => entry.caseId).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) throw new Error('Incomplete or unexpected OCCT case set');
    observations.push(...imported);
  } catch (cause) {
    observations.push({ experimentId: 'EX-07', caseId: 'occt-observation-import-failed',
      expected: 'Complete TypeBox-valid observation array from the real OCCT runner.',
      observed: cause instanceof Error ? cause.stack ?? cause.message : String(cause), passed: false,
      limitations: ['OCCT output could not be ingested; keep original artifacts and logs.'] });
  }
} else {
  observations.push({ experimentId: 'EX-07', caseId: 'occt-not-executed',
    expected: 'Real OCCT face split/history, raw index and semantic anchor observations.',
    observed: 'No OCCT observation file supplied; actual B-rep reference behavior remains unqualified.',
    passed: false, limitations: ['Run topology.py in the coordinator-provided Python container, then supply --occt.'] });
}
writeFileSync(resolve(output, 'observations.json'), `${JSON.stringify(parseObservations(observations), null, 2)}\n`, { flag: 'wx' });
const assertions: { assertion: string; caseIds: string[]; boundedOnly: boolean }[] = [
  { assertion: 'Level/host edits record the complete evaluated dependent delta.',
    caseIds: ['level-full-dependent-delta', 'host-full-dependent-delta'], boundedOnly: false },
  { assertion: 'Failed or unresolved evaluation leaves accepted state unchanged.',
    caseIds: ['fatal-atomic-rollback', 'pending-atomic-rollback', 'dependency-cycle-rejected'], boundedOnly: false },
  { assertion: 'Face split and reordering do not silently reattach dependants.',
    caseIds: ['occt-raw-index-reference', 'occt-datum-ambiguity', 'occt-semantic-anchor',
      'occt-boundary-anchor-pending', 'occt-reordered-traversal'], boundedOnly: true },
  { assertion: 'A bounded real-kernel case is required for any claim about B-rep reference stability.',
    caseIds: ['occt-real-face-split'], boundedOnly: false },
];
const coverage: Coverage[] = assertions.map((entry) => {
  const present = observations.filter((item) => entry.caseIds.includes(item.caseId));
  const complete = present.length === entry.caseIds.length && present.every((item) => item.passed);
  return { assertion: entry.assertion, caseIds: present.map((item) => item.caseId),
    coverage: complete ? entry.boundedOnly ? 'partial' : 'covered' : present.length > 0 ? 'partial' : 'not-covered' };
});
writeFileSync(resolve(output, 'coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`, { flag: 'wx' });
const fixtures = ['experiments/fixtures/tiny-building.json', 'experiments/regeneration/fixture.json'].map((path) => {
  const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
});
writeFileSync(resolve(output, 'dataset-manifest.json'), `${JSON.stringify({
  name: 'W0 tiny building projected to W3 vertical dependency datums', seed: 'deterministic-no-randomness',
  units: 'millimetres (converted from W0 metres)', fixtures,
  identityProjection: { ground: 'level-ground', first: 'level-upper', 'shared-wall': 'wall', door: 'opening' },
}, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify(observations)}\n`);
if (observations.some((entry) => !entry.passed)) process.exitCode = 1;
