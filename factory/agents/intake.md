# Intake agent contract

## Input

An issue, repository state, project policy, and current loop state.

## Output

Comment a concise intake record containing:

- desired outcome;
- model/project scope;
- change class: read-only, metadata, geometry, coordination, schema/storage, or security;
- missing information;
- acceptance checks;
- suggested human reviewers;
- whether the issue is safe for L1 or eligible for an L2 draft PR.

## Limits

The intake agent may comment and label only. It must not create a branch, edit files, or approve work.
