# Test the AI home office workflow

Use a separate browser study. Export the current project before replacing it.
The server container runs the model worker with the installation's ChatGPT sign-in.
No API key or local AI process is required.

## Build and inspect the office

1. Create a project named `Home office acceptance` and open its room model.
2. Confirm that the shell has four walls and one entry door.
3. Enter this request:

   > Build a home office in this room. Keep exactly one entry door and preserve the shell. Add a desk with a computer monitor and laptop on it, one office chair, a small table in a corner, and a potted plant. Create visible 3D components with sensible dimensions and a clear route from the door to the chair. Return one reviewable proposal containing every item.

4. Enter an unused proposal name and select **Prepare proposal**.
5. Wait for the review page. The progress dialog must remain responsive during the AI turn.
6. Inspect the plan and 3D views. Confirm that all six furnishings are identifiable.
7. Open **Inspect detailed model delta**. Expect six added entities, no removed or modified entities, and no changed hosting relationships.
8. Accept the proposal. Confirm that the page reports an accepted version and still responds to navigation.
9. Reload the page. Expect six furnishings, 11 model objects, and the accepted revision in the overview.
10. Export the project and import the exported file. Confirm the same revision and object count.
11. Open history and inspect the ancestor revision. Expect the original five-object shell with no furnishings.
12. Return to the accepted model. Select a furnishing in 3D and switch to plan. Confirm the same stable selection.

## Run container checks

In the server's isolated source directory, run `npm ci`, `npm run validate`, and `npm test` inside the pinned Node container.
Do not mount the installation's auth storage during automated tests.
For a live subscription test, stop the preview AI runtime before a candidate uses the same auth storage.
Stop the candidate before restarting or replacing the preview runtime.

The automated tests cover a complete office proposal, human acceptance, restore, geometry generation, invalid placements, and the House Pilot shell.
HTTP tests cover immediate job acknowledgement, duplicate requests, changed-input conflicts, and readable provider failures.

## Prototype limits

The six furnishing kinds are desk, monitor, laptop, chair, table, and plant.
Geometry uses metre coordinates on a 1 mm grid and cardinal rotations.
Monitors and laptops require a desk or table support. Their elevation follows that support's height.
The furnishing tool replaces the complete furnishing set but cannot change walls, openings, or equipment.
The agent must include existing furnishings that it intends to retain.

Validation checks room containment, floor-item and device overlaps, equipment conflicts, support footprints, ceiling height, and the entry clearance zone.
It does not certify ergonomics, a traversable circulation route, accessibility, door swing, building codes, or discipline coordination.
The 3D view cuts down the two camera-facing walls for visibility without changing model geometry.

Completed proposal jobs expire 15 minutes after submission, with at most two active jobs and eight retained jobs.
A server restart loses unfinished jobs but does not change the browser's saved model.
The browser reports expired jobs and model-worker failures without accepting a partial proposal.
The final proposal is saved only after the worker completes, so its provider event and token usage can be retained.

Existing project files remain readable. Older app releases cannot read newly furnished snapshots.
Export furnished projects before rolling back the preview to an older release.
