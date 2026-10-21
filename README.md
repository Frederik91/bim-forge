# BIM Forge

AI-native, open-source BIM authoring and coordination infrastructure.

BIM Forge treats a building model as a versioned, queryable project graph. Engineers describe work as issues. Agents inspect the model, plan a bounded change, work in an isolated branch, run BIM-aware validators, and open a pull request containing the proposed model delta. People remain the final authority for consequential changes.

The long-term ambition is full BIM authoring and coordination that can replace the Revit-centered workflow. The first milestone is smaller and deliberate: build the factory that can safely build the product.

## Current phase

This repository is the bootstrap specification and safety harness. It defines the loop, storage direction, agent contracts, and GitHub workflow before the first model-writing feature is added.

Default operating level is **L1 report-only**. No agent may merge or mutate a production model unattended.

## Design principles

- **Model changes are versioned artifacts.** A pull request carries an inspectable model delta, not only source-code text.
- **Issues are executable intent.** An issue names the outcome, scope, constraints, acceptance checks, and review class.
- **Agents work in isolation.** Every change attempt gets a dedicated branch/worktree and a bounded budget.
- **Validation precedes review.** Schema, geometry, coordination, and regression checks produce evidence before a human approves.
- **Human authority is configurable, never implied away.** Auto-approval is opt-in, path-scoped, confidence-scoped, and disabled for high-impact changes.
- **State is durable and observable.** Each loop records its inputs, decisions, costs, validators, and outcome.

## Repository map

```text
factory/                 Agent loop contract and role contracts
policy/                  Machine-readable gates and binding constraints
docs/                    Architecture, storage, milestones, issue bodies
scripts/                 Small deterministic local validators
.github/                 Issue/PR templates and required CI checks
STATE.md                 Current loop state and kill-switch status
LOOP.md                  Operating model for the factory
AGENTS.md                Instructions for human and agent contributors
```

## The factory loop

```text
Issue → intake → plan → isolated worktree → model/code change
      → BIM validators → agent review → human review → merge/release
```

The factory starts in L1 (report-only), can graduate to L2 (assisted PRs), and only reaches L3 (unattended actions) after the verifier has demonstrated a sustained, auditable record. See [LOOP.md](LOOP.md) and [factory/loop.json](factory/loop.json).

## Storage direction

The recommended starting point is a **PostgreSQL source of truth plus object storage for immutable model snapshots and large artifacts**. PostgreSQL stores project metadata, branches, issues, agent runs, model entities/indexes, permissions, and audit events. Object storage stores IFC/native exports, geometry payloads, diffs, validation reports, and evidence bundles. See [docs/storage.md](docs/storage.md).

## Local checks

Requires Node.js 20 or newer.

```bash
npm run validate
```

The validator checks the machine-readable policy and, when run in CI, rejects changed files that fall inside protected paths or exceed the configured change budget.

## Roadmap

The first six milestones are documented in [docs/milestones.md](docs/milestones.md). Ready-to-copy GitHub issue bodies are in [docs/github-issue-bodies.md](docs/github-issue-bodies.md).

## Status and safety

This is an early open-source design. It is not a replacement for professional BIM coordination, structural review, fire/life-safety review, or statutory approval. Never use an unattended agent to approve a construction-critical model change.

Licensed under the MIT License.
