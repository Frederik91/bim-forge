import { createHash } from 'node:crypto';

const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const html = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const prose = (value, fallback) => typeof value === 'string' && value.trim()
  ? html(value.trim().replace(/\s+/g, ' ')).replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&') : fallback;

// Observations come from the controller after its comparisons, not from the model's answer.
export function renderChangeReview({ outcome, why, profile = {}, observations, run = {}, verificationSha256 } = {}) {
  const recorded = Array.isArray(observations) && observations.length > 0 && hash(run.acceptanceSha256)
    && observations.every((item) => item && typeof item.name === 'string' && ['cli', 'api'].includes(item.mode)
      && Number.isInteger(item.exitCode) && item.exitCode >= 0 && !item.signal
      && typeof item.stdout === 'string' && typeof item.stderr === 'string');
  const verified = hash(verificationSha256) && run.verifierExecution?.exitCode === 0
    && run.verifierExecution.execMainCode === 1 && run.verifierExecution.result === 'success'
    && !run.verifierExecution.signal;
  const checks = recorded
    ? `The controller checked ${observations.length} fixed input cases against the approved expected results.`
    : 'Acceptance evidence is missing or incomplete. No acceptance-test success is claimed.';
  const verification = verified
    ? 'Policy validation and the full candidate test command exited successfully in the credential-free test environment.'
    : 'Evidence that policy validation and the full candidate test command completed successfully is missing or incomplete.';
  const issue = Number.isSafeInteger(run.issue) && run.issue > 0
    ? `Related [issue #${run.issue}](https://github.com/Frederik91/bim-forge/issues/${run.issue}).`
    : 'The related issue has not been supplied.';
  const provenance = Object.fromEntries(Object.entries(run)
    .filter(([key]) => ['id', 'issue', 'attempt', 'verifierExecution'].includes(key) || /(?:Sha|Sha256)$/.test(key))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const details = {
    profile: { label: profile.label, paths: profile.paths, exportName: profile.exportName, errorText: profile.errorText },
    run: provenance,
    observationsSha256: Array.isArray(observations)
      ? createHash('sha256').update(JSON.stringify(observations)).digest('hex') : null,
    verificationSha256: verificationSha256 ?? null,
  };

  return `## What changes

${prose(outcome, 'The requested outcome has not been supplied.')}

## Why this is needed

${prose(why, 'The reason for this change has not been supplied.')}

${issue}

## Boundaries and risks

The approved scope is read-only and excludes changes to BIM model data. Incorrect results may still affect decisions based on them.
The narrow scope limits testing to fixed examples. Those tests do not prove general correctness. Behavior outside those cases and live operation remain unverified.
This proposal has not been deployed or activated. Merging source does not deploy or activate this change.

## What has been checked

${checks}
${verification}
Model claims are not test evidence. Independent technical review is pending. Tests do not establish that a code review occurred.

## Your decision

Recommendation: keep this pull request in draft until independent technical review and any missing checks are complete.
Decide whether the intended behavior is acceptable for a later source merge. Your approval accepts that behavior; it does not mean you audited the source code.
Agents remain responsible for technical inspection and testing. Human merge approval and required checks remain mandatory. There is no automatic merge.
Administrator approval to publish the proposal is separate from human approval to merge. Deployment or activation requires a separate decision.

<details>
<summary>Technical evidence and publication provenance</summary>

<pre>${html(JSON.stringify(details, null, 2))}</pre>

</details>
`;
}
