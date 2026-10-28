# Model workspace: request, review, and accept

The current prototype provides a model-first plan/3D workspace with request chat, bounded AI-prepared proposals, and explicit human acceptance. It has grown beyond the original single-room, browser-only demo. This guide describes the current entry point; issue-specific design and validation records retain the scope of their original work.

## Start locally

Use Node.js 24 or newer. From the repository root:

```sh
npm ci
npm run build:demo
node demo/server.ts
```

Open `http://127.0.0.1:4173`. The server binds to loopback by default; `PORT` can select another local port. Rebuild the browser bundle after frontend source changes. For a trusted private Docker installation, follow the [preview deployment guide](../deploy/preview/README.md), including matching frontend/runtime releases and state backup requirements.

You can open a disposable project and inspect the workspace without connecting a model account. To prepare AI proposals, choose **Connect ChatGPT → Continue with ChatGPT**, complete the device flow at the displayed OpenAI page, and select an available model. The server's pinned Codex runtime owns account persistence and refresh; no API key should be copied into the browser. A displayed model candidate is not proof of account entitlement.

The prototype uses one shared server account and does not implement independent BIM Forge user authorization. Keep it restricted to trusted users. Account connection is not project permission or engineering authority. Review the deployment guide's integration restrictions before offering a commercial or hosted service.

## Work with a disposable model

1. Open or create a project through the project controls. Use a sample or generated fixture rather than a production BIM model.
2. Inspect the accepted model in **Plan** or **3D**. The model explorer and selection context expose stable object identities and properties; the 3D view is concept geometry, not product-accurate visualization.
3. Select the design target in the header. Fixed baselines are read-only; create an alternative when you want to work from a frozen baseline. An alternative is a separate writable design, not an implicit replacement of the accepted design.
4. Open **Chat**, select relevant objects, and describe the desired outcome. Attach available model context or source files where useful. Selection and visual markup capture intent; they do not directly change accepted geometry.
5. Send the request to prepare a proposal. It is bound to its design target and source revision. The worker can ask for clarification, return a bounded validated proposal, or explain why the request is unsupported. Available operations depend on the fixture and worker contract; this is not unrestricted BIM editing.
6. Inspect the proposal, model delta, assumptions, uncertainty, source references, and validator evidence. Chat keeps decision actions close to the outcome; detailed evidence remains inspectable. **Activity & history** exposes the supporting workflow views.
7. Accept only the intended target-specific proposal after review, or request a revision. Acceptance is an explicit server-side decision, not a side effect of sending a message or viewing a preview. Stale or conflicting work must be reconciled or refused rather than silently replacing accepted changes.

The model remains visible while chat and navigation panels provide context. Retained source files can be found through the library and bounded context suggestions; temporary composer attachments are not sent until the request is submitted. Source retention does not turn an uploaded document into an accepted design fact.

For specific bounded workflows, see [model intent](model-intent.md), [residential floor preview](residential-floor-preview.md), [multi-storey houses](multi-storey-house.md), and [generated families](generated-families.md). The [compact workspace design](design/compact-workspace-213.md) describes the current model/chat interaction changes.

## Storage and recovery

The server is authoritative for saved projects, design targets, request/review state, and accepted history. The current preview uses SQLite with immutable model bodies, revision changes, document references, and compare-and-swap publication of accepted state. Acceptance and retained decision evidence share the queue/store transaction. See the [versioned house implementation](design/versioned-house-slice-161.md) for the persistence contract.

The local command-line server stores project/request state in `.bim-preview/bim-change-requests.sqlite` by default, or below `CODEX_HOME` if configured. Account credentials are managed separately by Codex; the private container places persistent state outside its image and frontend release. Back up state privately and consistently before migrations. An image rollback alone does not undo a database migration.

Legacy IndexedDB data is read-only recovery material. An old browser copy cannot overwrite the server's existing accepted head. Use project export/import for supported portable model data, but do not treat an exported document as a complete backup of server-side source bytes, external evidence, or credentials. Retained sources/evidence have their own server stores and references.

Portable model documents remain bounded to 256 KiB with limits including 32 revisions and 32 branches; model collections have additional schema bounds. Complete portable documents are still reconstructed for bounded operations. These safeguards do not establish hospital-scale storage, level streaming, or disconnected multi-installation synchronization.

## Validation and privacy

Run `npm run validate` and `npm test` before proposing code changes; the dedicated chat/workspace browser suite is separate. See [CONTRIBUTING.md](../CONTRIBUTING.md) for commands and prerequisites. Automated checks do not substitute for manual review of the actual proposal or qualify every browser/device combination.

When AI work is requested, request text, bounded model context, and applicable source inputs are sent to the selected provider. Treat uploaded source contents as untrusted evidence, not instructions that can override application policy. Use only disposable, non-confidential data in this prototype.

## Boundaries

The repository includes fixture authoring, a Babylon.js 3D viewer, and durable shared-installation project storage. It does not thereby provide a general IFC import/export authoring pipeline, unrestricted geometry editing, production BIM file editing, building-code certification, construction approval, independent multi-user authorization, or proven large-project performance.

Proposal checks establish the supported schematic/model invariants, not structural adequacy, fire/life safety, or statutory compliance. Production readiness, factory autonomy, and storage qualification are separate gates. The checked-in factory operating level remains L1; using this workspace does not authorize an unattended factory run or merge.
