# Test a workstation move

Use the furnished office from [the home office workflow](home-office-acceptance.md).
Export the saved project before the test.

## Mark and review a destination

1. Open the room model and select the desk in Plan.
2. Check **Moves together**. Expect the desk, its monitor and laptop, and one associated chair.
3. Drag the teal **Move workstation** handle to the middle of another wall.
4. Confirm that the wall highlights and the workstation appears as a dashed ghost.
5. Confirm that the revision remains unchanged and the badge reads **Request sketch**.
6. Export the project while the ghost is visible. Compare the export with the file from before the drag. Expect identical bytes.
7. Select **Clear move**. Expect the ghost to disappear and the original instruction to return.
8. Switch to 3D and repeat the drag using the wall's floor edge.
9. Check the included objects and destination wall before submitting.
10. Select **Ask AI to move workstation**. If the proposal name is already used, enter an unused name in the request details.
11. Inspect the proposal's detailed delta. Expect four modified entities, no additions or removals, and no changed relationships.
12. Confirm that the desk, devices, and chair rotate together. Check that the table, plant, walls, and door stay fixed.
13. Accept the proposal and reload. Expect the moved workstation to remain in the current model.
14. Inspect the previous revision in history. Expect the workstation at its original wall.

For keyboard input, focus the move handle and press Enter to focus **Destination wall**.
Select a wall from that list, inspect the ghost, and submit the same AI request.
The wall picker also avoids precision dragging on small screens.

## Check failure paths

1. Drop the handle away from all walls. Expect the previous request to remain unchanged.
2. During a drag, press Escape. Expect the previous request to return without a model change.
3. Select a wall near a conflicting object or doorway. Expect an amber ghost and a validation explanation.
4. Submit that request. Expect the AI to find a valid location along the same wall or decline.
5. Test a desk with an ambiguous chair association. Expect an explanation rather than a randomly selected chair.

Run `npm run validate` and `npm test` in the pinned server container before deployment.
The workstation tests cover rigid transforms for every wall, repeated moves, protected unrelated objects, invalid placement, support preservation, proposal acceptance, and restore.
The server rejects missing, extra, or stale workstation membership before invoking the model worker.

## Verification limits

The chair association uses proximity, not a saved workstation ownership relationship.
A chair must be within 2.5 m of the desk and clearly closer to that desk than to another desk.
Ambiguous associations require a separate clarification request.
The agent can adjust the desk centre along the indicated wall and use a wall gap from 100 through 600 mm.
It cannot move unrelated objects or change dimensions, supports, the building shell, or the destination wall during this request.

The ghost is not accepted geometry. Model validation still runs in the bounded AI preview tool.
Clearance checks are not a code, accessibility, or ergonomics assessment.
Mouse drags in Plan and 3D, clearing a request, and the wall picker were checked in the server UI.
The 390 px layout was checked for horizontal overflow. This does not qualify real touch dragging.

New review records contain the `preview_workstation_move` tool name.
Older releases can reject those records. Retain an export and the newer release when testing rollback.
