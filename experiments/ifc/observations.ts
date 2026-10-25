import { readFile, writeFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { parseObservations } from '../contracts/schema.ts';
import type { Coverage, Observation } from '../contracts/schema.ts';

const RegistrySchema = Type.Object({ experiments: Type.Array(Type.Object({ id: Type.String(), assertions: Type.Array(Type.String()) })) });
type Rule = { assertion: string; coverage: Coverage['coverage']; caseCount: number; matches: (caseId: string) => boolean };
const rules: Record<'EX-02' | 'EX-08', Rule[]> = {
  'EX-02': [
    { assertion: 'Compare both narrow approaches using the same logical wall/opening/space/type fixture.', coverage: 'covered', caseCount: 8, matches: id => id.endsWith('/candidate-parity') },
    { assertion: 'Independent IFC checks preserve the declared IDs, properties and relationships.', coverage: 'partial', caseCount: 28, matches: id => id.endsWith('/semantic-contract') || id.endsWith('/successive-exports') || id.endsWith('/scalar-list-roundtrip') || id.endsWith('/full-unfamiliar-preservation') },
    { assertion: 'Every unsupported transformation appears in an explicit loss report.', coverage: 'partial', caseCount: 2, matches: id => id === 'unfamiliar-bounded/detected' || id === 'bounded-native-roundtrip/full-unfamiliar-preservation' },
  ],
  'EX-08': [
    { assertion: 'Metres, millimetres, local placements, rotation and survey transforms retain declared accuracy.', coverage: 'partial', caseCount: 32, matches: id => id.endsWith('/coordinates') || id.endsWith('/real-kernel') },
    { assertion: 'Canonical hashes and tolerance-aware geometric comparisons remain distinct.', coverage: 'covered', caseCount: 4, matches: id => id.endsWith('/m-vs-mm') || id.endsWith('/rotated-m-vs-mm') },
    { assertion: 'Exchange does not rewrite authoritative coordinates to match a viewer origin.', coverage: 'partial', caseCount: 16, matches: id => id.endsWith('/coordinates') },
  ],
};

export function coverageFor(experimentId: 'EX-02' | 'EX-08', observations: Observation[], assertions: string[]): Coverage[] {
  const applicable = rules[experimentId];
  if (assertions.length !== applicable.length || applicable.some(rule => !assertions.includes(rule.assertion))) throw new Error('Bound experiment assertions changed; update W2 coverage deliberately');
  return assertions.map(assertion => {
    const rule = applicable.find(item => item.assertion === assertion);
    if (!rule) throw new Error('Missing assertion rule');
    const caseIds = observations.filter(item => item.experimentId === experimentId && rule.matches(item.caseId)).map(item => item.caseId);
    return { assertion, caseIds, coverage: caseIds.length === 0 ? 'not-covered' : caseIds.length === rule.caseCount ? rule.coverage : 'partial' };
  });
}

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: observations.ts ALL_OBSERVATIONS NEW_REVIEW_BUNDLE');
const raw: unknown = JSON.parse(await readFile(input, 'utf8'));
const observations = parseObservations(raw);
if (observations.some(item => item.experimentId !== 'EX-02' && item.experimentId !== 'EX-08')) throw new Error('W2 accepts only EX-02 and EX-08 observations');
if (new Set(observations.map(item => `${item.experimentId}/${item.caseId}`)).size !== observations.length) throw new Error('Duplicate observation identity');
const registry: unknown = JSON.parse(await readFile(new URL('../../docs/experiments/registry.json', import.meta.url), 'utf8'));
if (!Check(RegistrySchema, registry)) throw new Error('Invalid experiment registry');
const experiments = (['EX-02', 'EX-08'] satisfies ('EX-02' | 'EX-08')[]).map(experimentId => {
  const definition = registry.experiments.find(item => item.id === experimentId);
  if (!definition) throw new Error(`Missing ${experimentId} definition`);
  const cases = observations.filter(item => item.experimentId === experimentId);
  return { experimentId, observations: cases, coverage: coverageFor(experimentId, cases, definition.assertions),
    suggestedConclusion: cases.some(item => !item.passed) ? 'failed' : 'inconclusive' };
});
await writeFile(output, `${JSON.stringify({ authoritativeResult: false, experiments,
  publication: 'Coordinator binds actual metadata and artifacts using W0 records.ts; this bundle is not a terminal run.' }, null, 2)}\n`, { flag: 'wx' });
