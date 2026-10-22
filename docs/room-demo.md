# Review a room proposal

This disposable demo lets you reshape a rectangular room and move or resize its door. Preview the change, then save a separate proposal beside the preserved original.

## Start locally

Use Node.js 24 or newer. From the repository, run:

```sh
node demo/server.mjs
```

Open `http://127.0.0.1:4173`. The server accepts only local requests and serves an explicit list of static assets. It has no upload, model-write or account API.

## Create and compare

1. Enter a project name and choose **Create project**.
2. Inspect the original room. Its entry door is 900 mm wide.
3. Select the entry door in the editable plan or the object list. Enter a width such as 1200 mm, or drag the square resize handle. The round handle moves the door along its host wall.
4. Select a wall. Drag its round handle to move it, or enter its position or length in millimetres. Connected corners follow the wall. Length changes are anchored at the minimum coordinate and expand towards increasing coordinates.
5. Review the live plan and **What changes** summary. The dashed outline shows the original. Invalid input leaves the last valid geometry visible and blocks saving. Door offset is measured from the host wall's directed start, not from the global origin.
6. Enter a new proposal name and choose **Save proposal**. The original and previous proposals remain unchanged. To abandon the preview without saving, choose **Discard changes**.
7. Select any saved revision to start another proposal from that revision. Confirm before discarding an unsaved preview.
8. Reload the page to reopen the browser-local saved project. Reload discards unsaved previews.
9. Choose **Export project** to download saved demo history as JSON. The export excludes unsaved previews. **Import project** validates a saved demo before replacing the browser-local project.

Unchanged geometry creates no revision or storage write. A different proposal cannot reuse an existing branch name. A save creates one revision for the whole preview, not one revision per gesture.

To cancel a drag, press Escape. A cancelled pointer gesture restores the pre-drag preview. The object list and numeric fields offer the same edits without dragging. Wall heights, thicknesses, door height and hosting stay unchanged. Shortening a wall never silently shrinks or repositions the door.

## Storage and recovery

The demo saves one project in this browser's IndexedDB. Saving checks the expected generation and replaces the complete project atomically. A stale tab cannot overwrite a newer save. A failed save retains the preview. Export any saved work before reloading after a stale-tab error; unsaved edits need to be entered again.

Browser data can be cleared or become unavailable. Export important demo work. This is not shared storage, backup, or the production database. The PostgreSQL and object-storage direction in [the storage decision](storage.md) is unchanged.

Invalid or damaged saved data is not silently overwritten. Download a recovery copy before clearing the demo's browser storage to start again. Import is limited to 256 KiB of encoded JSON, 32 revisions, 32 branches and 100 entities per snapshot. Saved revision hashes and ancestry are rechecked. Hashes detect changed content; they do not authenticate its author.

## What the model represents

Dimensions use metres on a 1 mm grid. The fixture is 6 m by 4 m, with 3 m-high walls, 0.2 m wall thickness, and a 0.9 m-wide, 2.1 m-high door. Its hosting relationship records the supporting wall and opening offset.

Each revision contains a full immutable snapshot and its parent's identity. Content hashes exclude branch names and project names, so the same snapshot and parent produce the same revision identity. Branch pointers and project identity are separate from snapshot identity.

Comparisons include added, removed and modified entities and relationships. Conflict inspection conservatively flags different changes to the same whole entity or relationship. It does not merge proposals, resolve fields automatically or certify combined geometry.

## Boundaries

This extends the first demo from #37 under issue #40. It is not completion of the application milestone. Editing supports four connected axis-aligned walls and one entry door. Existing valid version 1 files with other layouts remain viewable and exportable, but this editor does not change them.

The demo does not parse or export IFC, render 3D solids, perform building-code or clash checks, edit production BIM files, authenticate users, or implement shared durable storage. Schematic wall joins are not construction geometry. A successful fit check does not approve a design for construction.

The source stays separate from factory setup. Product approval and merge require the owner's change review. No demo operation activates the factory or changes its permissions.
