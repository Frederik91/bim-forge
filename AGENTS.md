# AGENTS.md

Instructions for humans and agents contributing to BIM Forge.

## Mission

Build an open BIM authoring and coordination system whose changes are explainable, versioned, testable, and reviewable by engineers.

## Default workflow

1. Start from a GitHub issue. If the issue is ambiguous, improve the issue before writing code.
2. Create one branch/worktree per attempt. Never share a worktree between concurrent agents.
3. Write a short plan naming the files, model entities, validators, and acceptance evidence.
4. Keep one issue and one coherent change per pull request.
5. Run `npm run validate` before opening or updating a pull request.
6. Attach validator output and a concise model-delta summary to the pull request.
7. Open a draft pull request first. A human decides when it is ready and whether it may merge.

## BIM change classes

- **Read-only analysis:** queries, reports, and visualizations. Usually L1 or L2.
- **Metadata change:** names, classifications, parameters, and relationships. L2 by default.
- **Geometry change:** placement, topology, dimensions, or representation. Human review required.
- **Coordination change:** clash resolution, system routing, host/linked-model relationships. Human review plus coordination evidence required.
- **Schema/storage change:** entity schemas, migrations, permissions, or persistence. Human review; never auto-merge.

## Protected behavior

- Never edit production model data, credentials, or deployment configuration from an unattended loop.
- Never disable, weaken, or delete a validator to make a pull request green.
- Never auto-merge geometry, coordination, schema, migration, permission, or security changes.
- Never close an issue or pull request without explicit maintainer approval.
- Stop after three failed attempts on one item and escalate with the evidence.
- Honor `loop-pause-all` and the budget in `policy/loop-constraints.md`.

## Quality bar

Tests should describe user-visible BIM behavior. A model-changing feature needs at least one fixture, one deterministic validator assertion, and one before/after or delta representation that a reviewer can inspect.
