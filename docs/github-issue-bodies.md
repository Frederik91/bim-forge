# Initial GitHub issue queue

Create these as milestone issues after the repository exists. Each issue should be linked to the milestone named in its heading and receive the label `roadmap`. A maintainer may apply `agent-ready` only to a concrete, bounded implementation task after reviewing its scope.

## M0 — Establish repository safety baseline

**Title:** Establish repository safety baseline and required checks

**Body:**

Implement the repository foundation described in `README.md`, `AGENTS.md`, `LOOP.md`, and `policy/`.

Acceptance criteria:

- CI runs the policy validator on pushes and pull requests.
- The default branch requires the validator check and pull-request review.
- Protected paths and human-review paths are documented and enforced.
- `loop-pause-all` and `STATE.md` pause behavior are documented.
- Issue and pull-request templates capture risk class, scope, evidence, and rollback.

## M1 — Build versioned model kernel

**Title:** Build the first immutable model revision and branch kernel

**Body:**

Implement a fixture-backed model kernel that can import a small IFC sample, assign stable entity identifiers, create immutable revisions, create branches, and compute an entity-level semantic diff.

Acceptance criteria:

- Revisions are immutable and linked to a parent revision.
- Branches do not mutate their source revision.
- Diffs include added, changed, removed, and relationship operations.
- Tests use disposable fixtures and cover a conflicting branch case.

## M2 — Add read-only model inspection

**Title:** Add read-only project and model inspection API

**Body:**

Expose projects, branches, revisions, entities, relationships, diffs, and validator findings through a stable read-only interface.

Acceptance criteria:

- A reviewer can inspect a revision and its provenance.
- Queries are scoped by project and permission.
- Responses include revision identifiers and evidence links.
- No endpoint mutates model state.

## M3 — Implement issue-to-draft-PR factory

**Title:** Implement the L1/L2 issue-to-draft-PR factory

**Body:**

Implement the first end-to-end factory loop from `factory/loop.json`: intake, plan, isolated worktree, draft PR, verifier, and review routing.

Acceptance criteria:

- Runs are linked to issues and record budgets, stages, and outcomes.
- Each attempt has an isolated branch/worktree.
- The factory stops on pause, budget, protected-path, failed-validator, or attempt-limit conditions.
- A draft PR contains a run manifest and verifier evidence.
- Merge remains a human action.

## M4 — Add one reversible metadata mutation

**Title:** Add a human-reviewed reversible metadata mutation

**Body:**

Implement one narrow metadata change, such as updating a classification or parameter, through the branch and semantic-diff path.

Acceptance criteria:

- The change is fixture-backed and reversible.
- The PR shows before/after values and affected entities.
- Validation rejects invalid values and out-of-scope entities.
- Human review is mandatory.

## M5 — Add coordination evidence and routing

**Title:** Add coordination validation and discipline-aware review routing

**Body:**

Add a first coordination validator and route findings to the required human reviewers.

Acceptance criteria:

- Coordination findings are reproducible and linked to evidence.
- High-severity findings block the PR.
- Reviewer routing is derived from the affected systems/disciplines.
- No coordination change is auto-merged.

## M6 — Add controlled automation

**Title:** Qualify controlled automation with explicit project policy

**Body:**

Introduce project-specific approval policy for narrowly scoped, low-risk actions after verifier performance has been evaluated against independently reviewed fixtures and failure cases.

Acceptance criteria:

- Project policy defaults to human approval and records every policy change.
- Confidence is calibrated against independent evidence; a model's self-reported confidence cannot authorize a merge.
- Pause, budget, retry, duplicate-run, and rollback scenarios are exercised.
- Geometry, coordination, schema, permissions, and security changes require human review.
- Publishing or enabling unattended operation requires a separate maintainer decision.
