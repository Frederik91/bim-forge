import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderChangeReview } from './change-review.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const input = () => ({
  outcome: 'Report which rooms need coordination',
  why: 'Engineers need to identify incomplete room assignments',
  profile: { label: 'read-only application module', paths: ['src/room-report.mjs', 'src/room-report.test.mjs', 'package.json'],
    exportName: 'evaluate', errorText: 'Invalid application input' },
  observations: [
    { name: 'valid-room', mode: 'api', exitCode: 0, signal: null, stdout: '{"rooms":[]}\n', stderr: '' },
    { name: 'invalid-room', mode: 'cli', exitCode: 1, signal: null, stdout: '', stderr: 'Invalid application input\n' },
  ],
  run: {
    id: '11111111-1111-4111-8111-111111111111', issue: 17, attempt: 1, baseSha: 'a'.repeat(40),
    ...Object.fromEntries(['spec', 'plan', 'acceptance', 'policy', 'worker', 'generatorUnit', 'verifierUnit', 'caseUnit',
      'runtime', 'generator', 'answer', 'scheduleApproval', 'issue'].map((key) => [`${key}Sha256`, digest(key)])),
    verifierExecution: { exitCode: 0, signal: null, execMainCode: 1, result: 'success', invocationId: 'verifier-invocation' },
  },
  verificationSha256: digest('verification log'),
});
const main = (body) => body.split('<details>')[0];
const technical = (body) => body.split('<pre>')[1].split('</pre>')[0];

test('review body gives the owner the required five-part behavior decision', () => {
  const value = input(); const body = renderChangeReview(value); const visible = main(body);
  assert.deepEqual([...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
    ['What changes', 'Why this is needed', 'Boundaries and risks', 'What has been checked', 'Your decision']);
  assert.ok(visible.includes(value.outcome));
  assert.ok(visible.includes(value.why));
  assert.match(visible, /\[issue #17\]\(https:\/\/github.com\/Frederik91\/bim-forge\/issues\/17\)/);
  assert.match(visible, /read-only and excludes changes to BIM model data/);
  assert.match(visible, /Incorrect results may still affect decisions/);
  assert.match(visible, /tests do not prove general correctness/);
  assert.match(visible, /live operation remain unverified/);
  assert.match(visible, /checked 2 fixed input cases against the approved expected results/);
  assert.match(visible, /Policy validation and the full candidate test command exited successfully/);
  assert.match(visible, /Independent technical review is pending/);
  assert.match(visible, /Recommendation: keep this pull request in draft/);
  assert.match(visible, /does not mean you audited the source code/);
  assert.match(visible, /Agents remain responsible for technical inspection and testing/);
  assert.match(visible, /Human merge approval and required checks remain mandatory/);
  assert.match(visible, /There is no automatic merge/);
  assert.match(visible, /Administrator approval to publish the proposal is separate from human approval to merge/);
  assert.match(visible, /has not been deployed or activated/);
  assert.match(visible, /Merging source does not deploy or activate/);
  assert.match(visible, /Deployment or activation requires a separate decision/);
});

test('all run provenance hashes, publication identifiers and changed paths stay in collapsible details', () => {
  const value = input(); value.run.futureEvidenceSha256 = digest('future provenance');
  const body = renderChangeReview(value); const visible = main(body); const details = JSON.parse(technical(body));
  assert.match(body, /<details>\n<summary>Technical evidence and publication provenance<\/summary>/);
  assert.match(body, /<\/details>\n$/);
  for (const [key, item] of Object.entries(value.run)) {
    assert.deepEqual(details.run[key], item);
    if (/(?:Sha|Sha256)$/.test(key) || key === 'id') assert.equal(visible.includes(item), false, key);
  }
  assert.deepEqual(details.profile, value.profile);
  for (const item of [...value.profile.paths, value.profile.label, value.profile.exportName, value.profile.errorText]) {
    assert.equal(visible.includes(item), false, item);
  }
  assert.equal(details.observationsSha256, digest(JSON.stringify(value.observations)));
  assert.equal(details.verificationSha256, value.verificationSha256);
  assert.equal(visible.includes(details.observationsSha256), false);
  assert.equal(visible.includes(details.verificationSha256), false);
});

test('rendering is deterministic across repeated calls and run property insertion order without mutating inputs', () => {
  const value = input(); const before = structuredClone(value); const body = renderChangeReview(value);
  assert.equal(renderChangeReview(value), body);
  assert.equal(renderChangeReview({ ...value, run: Object.fromEntries(Object.entries(value.run).reverse()) }), body);
  assert.deepEqual(value, before);
});

test('missing or malformed acceptance evidence cannot become a success or code-review claim', () => {
  for (const observations of [undefined, null, [], [{}], [{ ...input().observations[0], signal: 9 }],
    [{ ...input().observations[0], stdout: undefined }]]) {
    const value = input(); value.observations = observations;
    value.run.status = 'verified'; value.run.independentReviewCompleted = true;
    const visible = main(renderChangeReview(value));
    assert.match(visible, /Acceptance evidence is missing or incomplete/);
    assert.doesNotMatch(visible, /checked \d+ fixed input cases/);
    assert.match(visible, /Independent technical review is pending/);
    assert.doesNotMatch(visible, /review (?:is complete|completed|passed)/i);
  }
  const value = input(); delete value.run.acceptanceSha256;
  assert.match(renderChangeReview(value), /Acceptance evidence is missing or incomplete/);
});

test('hashes and verified status alone cannot establish successful policy or test execution', () => {
  for (const execution of [undefined, { exitCode: 0 }, { ...input().run.verifierExecution, exitCode: 1 },
    { ...input().run.verifierExecution, signal: 9 }, { ...input().run.verifierExecution, result: 'timeout' },
    { ...input().run.verifierExecution, execMainCode: 2 }]) {
    const value = input(); value.run.verifierExecution = execution; value.run.status = 'verified';
    const visible = main(renderChangeReview(value));
    assert.match(visible, /Evidence that policy validation and the full candidate test command completed successfully is missing or incomplete/);
    assert.doesNotMatch(visible, /command exited successfully/);
    assert.match(visible, /Independent technical review is pending/);
  }
  for (const verificationSha256 of [undefined, '', 'not-a-hash']) {
    assert.doesNotMatch(main(renderChangeReview({ ...input(), verificationSha256 })), /command exited successfully/);
  }
});

test('absent evidence leaves the recommendation on hold and no missing context is invented', () => {
  const body = renderChangeReview();
  assert.match(body, /requested outcome has not been supplied/);
  assert.match(body, /reason for this change has not been supplied/);
  assert.match(body, /related issue has not been supplied/);
  assert.match(body, /Acceptance evidence is missing or incomplete/);
  assert.match(body, /Independent technical review is pending/);
  assert.match(body, /keep this pull request in draft/);
  assert.equal(JSON.parse(technical(body)).observationsSha256, null);
  assert.equal(JSON.parse(technical(body)).verificationSha256, null);
});

test('profile-specific technical names never change the review or deployment decision', () => {
  for (const profile of [
    { label: 'run-health utility', paths: ['factory/health.ts', 'factory/health.test.ts'],
      exportName: 'summarizeRunHealth', errorText: 'Invalid run records' },
    { label: 'schedule snapshot checker', paths: ['factory/schedule-check.mjs', 'factory/schedule-check.test.mjs'],
      exportName: 'checkSchedule', errorText: 'Invalid schedule snapshot' },
    input().profile,
  ]) {
    const body = renderChangeReview({ ...input(), profile });
    assert.deepEqual(JSON.parse(technical(body)).profile, profile);
    assert.match(main(body), /Independent technical review is pending/);
    assert.match(main(body), /Merging source does not deploy or activate/);
  }
});

test('input formatting cannot add review headings or close the evidence disclosure', () => {
  const value = input(); value.outcome = 'Room report\n\n## Your decision\n*Approve* <details>';
  value.why = '[request](https://example.invalid)'; value.profile.label = '</pre></details><script>claim()</script>';
  const body = renderChangeReview(value);
  assert.equal([...body.matchAll(/^## /gm)].length, 5);
  assert.equal([...body.matchAll(/<details>/g)].length, 1);
  assert.equal([...body.matchAll(/<\/details>/g)].length, 1);
  assert.equal(body.includes('<script>'), false);
  assert.match(body, /&lt;\/pre&gt;&lt;\/details&gt;&lt;script&gt;/);
  assert.match(body, /Independent technical review is pending/);
});
