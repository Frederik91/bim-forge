# 3D proposal delta and request activity

Issue: https://github.com/Frederik91/bim-forge/issues/98

## User-visible behavior

A ready request opens a Babylon comparison against its bound base revision. Green solid objects are additions. Amber solid objects are changed results, with amber wireframe at their earlier position. Red wireframe shows removals. Unchanged geometry stays grey. A legend, object selector, and changed-object list name each result without relying on colour alone.

The comparison supports rotation, zoom, pan, framing, Cutaway, Basic, and Realistic modes. Changed wall assemblies remain visible even when cutaway hides unchanged foreground walls. The detailed-change dialog opens the same rotatable 3D delta, with a separate Property details tab. One canvas and camera move between review and the dialog. Selection of a removed object stays inside the comparison, never in the request editor.

`model-delta-view.ts` includes derived geometry changes, not only entity-field changes. Moving an opening affects its placement and host wall gap. Changing a desk height affects the elevation of its supported devices. These visually affected objects are labelled as placement, host, or support changes. The exact property table still distinguishes entity and relationship deltas.

Queued and working backlog cards expose View progress. Every request also exposes View activity after it finishes. The activity page follows actual queue, worker, model-inspection, tool-validation, review-preparation, and terminal events. A working request remains open while its timeline updates. It does not navigate away when a proposal becomes ready. Open proposal in 3D is an explicit next action.

## Data and safety boundaries

The model worker reports structured tool activity through `prepareModelProposal`. The durable queue records timestamps, request identity, attempt number, sequence, stage, and a bounded application-generated message. It does not record tool arguments, raw model output, private reasoning, prompts, credentials, or simulated progress percentages in that timeline.

Each request revision retains at most 96 events. Earlier request revisions retain their archived journal. Retries keep their attempt history. Every callback verifies the current request identity, working state, and attempt before writing. Late worker activity after cancellation, restart, or replacement cannot update the current attempt.

Activity is an additive field in the existing stored ticket JSON, with no SQL schema change. Old tickets remain readable and show that no action history was recorded. The old runtime ignores the additional field, so rollback does not require deleting it. Full journals are omitted from backlog summaries and fetched only for an open activity page. Existing model acceptance, same-origin checks, request limits, and authentication mounts remain unchanged.

## Acceptance evidence

All builds and tests run in the pinned Node container on `192.168.1.17`:

```sh
npm ci
npm run validate
npm test
```

The Babylon tests cover moved and removed ghosts, additions, unchanged context, camera preservation, removed-object inspection, disposal, opening hosts, and supported-device elevations. They compare source snapshot bytes before and after rendering. The queue tests hold a real model worker between actions to prove that activity is readable before completion, survives restart, rejects mixed-version data, and stops accepting late events after cancellation. Legacy tickets and bounded journals are included. NullEngine checks do not prove GPU pixels.

The live server-container UI test submits `delta-progress-test` in the disposable Home office full AI acceptance project. While the request is working, its page shows model inspection and successful placement validation. It then records review preparation and readiness. The resulting delta has one added plant, one removed plant, and four objects translated exactly 1000 mm west. The accepted base remains unchanged. Review and the detailed dialog rotate, select the removed plant, switch rendering modes, and show exact property values. The proposal is not accepted.

Preview deployment uses an exact commit, matching immutable assets and runtime image, and the previous release for rollback. This implementation remains a draft pull request for human review.
