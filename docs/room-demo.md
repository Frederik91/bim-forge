# Review a room proposal

This disposable demo creates a room with four walls and one door. Save a wider-door proposal and compare it with the preserved original.

## Start locally

Use Node.js 24 or newer. From the repository, run:

```sh
node demo/server.mjs
```

Open `http://127.0.0.1:4173`. The server accepts only local requests and serves an explicit list of static assets. It has no upload, model-write or account API.

## Create and compare

1. Enter a project name and choose **Create project**.
2. Inspect the original room. Its entry door is 900 mm wide.
3. Enter a proposal name and a different door width, such as 1200 mm.
4. Choose **Save proposal**.
5. Compare the original and proposal. The door keeps its identity; the delta records its old and new width. The original remains unchanged.
6. Reload the page to reopen the browser-local saved project.
7. Choose **Export project** to download the complete demo history as JSON. **Import project** validates a saved demo before replacing the browser-local project.

An unchanged width creates no revision. Repeating the exact same proposal creates no duplicate revision or branch. A different proposal cannot reuse an existing branch name.

## Storage and recovery

The demo saves one project in this browser's IndexedDB. Saving checks the expected generation and replaces the complete project atomically. A stale tab cannot overwrite a newer save. Reload before continuing from another tab.

Browser data can be cleared or become unavailable. Export important demo work. This is not shared storage, backup, or the production database. The PostgreSQL and object-storage direction in [the storage decision](storage.md) is unchanged.

Invalid or damaged saved data is not silently overwritten. Download a recovery copy before clearing the demo's browser storage to start again. Import is limited to 256 KiB of encoded JSON, 32 revisions, 32 branches and 100 entities per snapshot. Saved revision hashes and ancestry are rechecked. Hashes detect changed content; they do not authenticate its author.

## What the model represents

Dimensions use metres on a 1 mm grid. The fixture is 6 m by 4 m, with 3 m-high walls, 0.2 m wall thickness, and a 0.9 m-wide, 2.1 m-high door. Its hosting relationship records the supporting wall and opening offset.

Each revision contains a full immutable snapshot and its parent's identity. Content hashes exclude branch names and project names, so the same snapshot and parent produce the same revision identity. Branch pointers and project identity are separate from snapshot identity.

Comparisons include added, removed and modified entities and relationships. Conflict inspection conservatively flags different changes to the same whole entity or relationship. It does not merge proposals, resolve fields automatically or certify combined geometry.

## Boundaries

This is an initial increment of issue #2, not completion of that milestone. It does not parse or export IFC, render 3D solids, perform building-code or clash checks, edit production BIM files, authenticate users, or implement shared durable storage. It does not approve a door design for construction. Only door-width proposals are offered in the UI.

The source stays separate from factory setup. Product approval and merge require the owner's change review. No demo operation activates the factory or changes its permissions.
