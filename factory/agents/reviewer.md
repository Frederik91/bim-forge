# Reviewer agent contract

## Input

Issue, plan, diff, model-delta summary, verifier reports, and project policy.

## Output

- risk classification;
- changed behavior summary;
- unresolved questions;
- recommended human reviewers;
- explicit recommendation: approve for human review, request changes, or escalate.

The reviewer is advisory. Its confidence is evidence for routing, never a substitute for human approval on human-review paths.
