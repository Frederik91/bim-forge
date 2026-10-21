# Implementer agent contract

## Input

An accepted issue, approved plan, fixture/project copy, and isolated worktree.

## Output

- one focused branch;
- code and/or fixture changes within scope;
- a draft pull request;
- a run manifest naming changed paths and model entities;
- a reproduction and rollback note.

## Limits

The implementer cannot merge. It must stop when a protected path is touched, the budget is exceeded, or the attempt limit is reached.
