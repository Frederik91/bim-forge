# Contributing

Start with an issue that describes the desired BIM or product outcome. Small, reviewable pull requests are preferred over broad rewrites.

Before opening a pull request:

1. Read `AGENTS.md`, `LOOP.md`, and `policy/loop-constraints.md`.
2. Work in a dedicated branch/worktree.
3. Run `npm run validate`.
4. For model changes, include fixtures, semantic deltas, validator output, and rollback notes.
5. Open a draft pull request and identify the required human reviewers.

The project is intentionally conservative around model mutation. A passing CI check is necessary but never sufficient for geometry, coordination, schema, permission, or security changes.
