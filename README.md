# BIM Forge

AI-native, open-source BIM authoring and coordination infrastructure.

BIM Forge treats a building model as a versioned, queryable project graph. People capture intent, agents prepare bounded proposals, validators produce evidence, and engineers decide which changes to accept. The long-term ambition is full BIM authoring and coordination that can replace the Revit-centered workflow.

## Current status

The repository contains a **bounded authoring and review prototype**, a constrained issue-to-PR factory, and a separate model/storage qualification program. It is no longer only a bootstrap specification, but it is not a production BIM authoring system.

Implemented prototype capabilities include:

- A model workspace with synchronized plan and Babylon.js 3D views, stable object selection, model navigation, and request chat.
- Versioned room/house models, fixed baselines and writable alternatives, revision-bound requests, separate proposals, inspectable deltas, and explicit human acceptance.
- Bounded model scripting and fixture workflows for rooms, residential floors, multi-storey houses, furnishings, and assets.
- Server-authoritative SQLite project storage, request/review history, retained source inputs, and project evidence. Legacy browser storage is recovery material, not the accepted project authority.
- Factory planning, isolated coding attempts, verification, and draft-PR publication tools, subject to the repository's operating policy and configured gates.

These capabilities do not establish general IFC authoring, hospital-scale performance, multi-user authorization, independent-installation synchronization, engineering approval, or production readiness. Qualification results and remaining limits are recorded in the [experiment program](docs/experiments/README.md).

The checked-in operating state remains **L1 report-only**; implemented tools do not grant permission to run higher-autonomy workflows. No agent may merge or mutate a production model unattended. Read [STATE.md](STATE.md), [LOOP.md](LOOP.md), and [AGENTS.md](AGENTS.md) before contributing or operating the factory.

## Try the local prototype

Requires **Node.js 24 or newer** and npm. From a checkout:

```sh
npm ci
npm run build:demo
node demo/server.ts
```

Open `http://127.0.0.1:4173`. Use a disposable project or sample model. Browsing the workspace does not require a model account; AI proposal preparation requires the in-app **Connect ChatGPT** flow and an eligible account/model. No API key needs to be pasted into the application.

The local server binds to loopback by default. Its project/request database is stored in `.bim-preview/bim-change-requests.sqlite` by default, or below `CODEX_HOME` when configured. Account credentials are managed separately by the server's Codex runtime; they are not project exports. Keep state and credentials private.

See the [workspace guide](docs/room-demo.md) for request/review behavior, [Docker preview instructions](deploy/preview/README.md) for the trusted private deployment, and [contributing guide](CONTRIBUTING.md) for checks. The prototype shares one server account and does not implement independent BIM Forge user authorization. Do not expose it as an unrestricted public service or use confidential, regulated, or production model data.

## Local checks

```sh
npm run validate
npm test
```

- `npm run validate` runs the TypeScript lint/migration guard, type checking, and policy validation. It does not run the test suite.
- `npm test` runs qualification-contract checks, builds the browser demo, and runs the configured application/factory regression suites, including asset tests.
- `npm run test:chat-browser` is a separate Playwright browser suite. See [CONTRIBUTING.md](CONTRIBUTING.md) for browser and PDF-tool prerequisites.
- CI runs validation and tests, then checks changed PR paths against the policy denylist. The policy validator checks supplied paths only when passed `--changed-files`; the automated publication file-count budget is enforced separately by the publication code.

Passing checks is evidence about the tested scope, not construction approval or permission to weaken a review gate.

## Repository map

```text
src/                     Model, intent, validation, scripting, and worker modules
demo/                   Browser workspace, server APIs, SQLite stores, and tests
factory/                 Runner, planner, coding worker, publisher, and contracts
policy/                  Machine-readable gates and binding constraints
experiments/             Qualification implementations and small fixtures
benchmarks/              Viewer and model/storage workload harnesses
docs/                    Guides, design proposals, research, and evidence
scripts/                 Validation and browser-build tooling
deploy/preview/          Private Docker preview runtime and deployment guide
.github/                 Issue/PR templates and CI checks
STATE.md                 Checked-in loop state and kill-switch status
LOOP.md                  Operating model and permitted factory behavior
AGENTS.md                Instructions for human and agent contributors
```

## Design and storage

Model changes are versioned artifacts. Requests bind to a source revision and target; authoring and review remain separate; validation precedes acceptance; and consequential changes retain human authority.

The current bounded preview uses **SQLite**, with immutable model bodies, revision deltas, document references, and accepted-head publication. Its portable model documents remain bounded; it is not a large-project streaming API.

**PostgreSQL plus object storage** is the proposed larger-system direction, with a separate experimental implementation and qualification program. It is not the preview's storage engine or an adopted production-scale result. See [storage direction and current implementation](docs/storage.md) and [architecture](docs/architecture.md).

## Documentation paths

- **Use the prototype:** [workspace guide](docs/room-demo.md), [model intent](docs/model-intent.md), [multi-storey house](docs/multi-storey-house.md), [generated families](docs/generated-families.md).
- **Maintain the code:** [contributing](CONTRIBUTING.md), [agent rules](AGENTS.md), [CI workflow](.github/workflows/validate.yml).
- **Operate the factory:** [operating mode](docs/factory-operating-mode.md), [runner](docs/runner.md), [live planner](docs/live-planner.md), [coding worker](docs/coding-worker.md), [publisher](docs/publisher.md).
- **Understand the direction:** [product vision](docs/product-vision.md), [milestones](docs/milestones.md), [architecture](docs/architecture.md), [qualification results](docs/experiments/README.md).

Issue-specific design and validation records preserve the scope and evidence of their original work. Read them alongside current source and the maintained guides above; a historical plan is not proof of current deployment or completed qualification.

## Status and safety

This prototype is not a replacement for professional BIM coordination, structural review, fire/life-safety review, or statutory approval. Never use an unattended agent to approve a construction-critical model change.

Licensed under the MIT License.
