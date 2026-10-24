# Babylon viewer acceptance

Issue: https://github.com/Frederik91/bim-forge/issues/96

## Scope and ownership

`demo/model-scene.ts` projects a validated `ModelSnapshot` into Babylon meshes. It has no repository, worker, or model-writing API. `demo/model-viewer.ts` owns one browser canvas, engine, camera inputs, keyboard object selector, and annotation gestures. `demo/room-app.ts` mounts that canvas on the visible request or review page. Plan remains SVG. The obsolete SVG 3D camera and its callers are removed.

Two engines, one per workflow page, would duplicate GPU resources and split camera state. The shared viewer retains its camera and selection when switching rendering modes and pages. It rebuilds meshes only when snapshot content changes. It stops rendering on hidden pages and renders visible scenes on demand, including camera inertia and asynchronous shader readiness.

Basic uses simple materials without shadows. Realistic uses PBR materials, local procedural oak, directional lighting, shadows, and tone mapping. Both display the same authoritative geometry. Camera-facing wall assemblies are hidden only in Cutaway mode. Doors and windows occupy actual wall gaps. The furnishings remain concept silhouettes, not manufacturer assets or photorealistic deliverables.

Babylon's embedded BRDF image uses a Blob URL under the unchanged content-security policy. No CDN or remote texture is required. The browser bundle includes the pinned dependency's license and notices.

## Requests and model boundaries

A 3D handle drag ray-picks a visible wall or the room floor. The result is a millimetre-bound spatial reference, not a move operation or an assembly. Release commits the annotation. Escape, pointer cancellation, or release outside the canvas restores the previous reference. Hidden cutaway walls cannot intercept picks. Keyboard users can select objects inside either viewer and mark coordinates using the existing spatial-context controls.

Blank, whitespace-only, or omitted request names receive a readable instruction prefix and a deterministic 128-bit suffix derived from request identity. Explicit names retain existing validation and uniqueness checks. Retries retain their name; separate requests and revisions receive distinct names. The UI hides the automatic identity suffix in request titles, but preserves it in branch identity and audit data. Model acceptance and revision binding are unchanged.

## Repeatable checks

Run in the server's pinned Node container:

```sh
npm ci
npm run validate
npm test
```

`demo/model-scene.test.ts` runs real Babylon `NullEngine` scenes. It checks supported objects and elevations, wall gaps, mode and camera preservation, resource disposal, unchanged snapshots, ray selection through cutaways, and floor references. `demo/change-requests.test.ts` checks unnamed requests, concurrent submission, retries, revisions, and explicit-name validation. NullEngine does not prove GPU output.

The server-container browser acceptance uses a disposable existing test project, not the user's deployed home office. A desk handle marks floor point `[692, 1217]` mm. An unnamed request asks for a small plant there while preserving every existing object. The live agent produces one added plant and no modified or removed objects. The proposal is inspected in both Babylon modes and remains unaccepted. Request and review share one canvas. A 390-pixel phone breakpoint has no horizontal page overflow and retains object selection and rendering controls.

Browser testing caught two integration errors that headless scene creation alone missed: the embedded BRDF image could not load under the CSP, and ray picking needed explicit registration. A deterministic pick test also guards against invisible cutaway walls intercepting visible objects.

## Deployment boundary

Build, validation, tests, and image creation run on `192.168.1.17` in containers. Publish an exact commit to an immutable static release and matching app image. Preserve the existing authentication mount, durable request database, network boundary, validators, and previous release for rollback. Deployment is a preview; the code remains a draft pull request for human review.
