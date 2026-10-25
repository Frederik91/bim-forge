import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CodexAccountConnection } from '../src/codex-app-server.ts';
import { prepareModelProposal } from '../src/model-proposal.ts';
import type { ModelProposalResult } from '../src/model-proposal.ts';
import { ModelScripts } from '../src/model-script.ts';
import { RoomRepository, diffSnapshots, furnitureFootprint, validateSnapshot } from '../src/room-model.ts';
import type { Furniture, ModelSnapshot, Point } from '../src/room-model.ts';
import { residentialFloor } from '../src/residential-floor.ts';
import type { VisualRequest } from '../src/visual-request.ts';

interface Scenario {
  id: string;
  snapshot: ModelSnapshot;
  selectedId: string;
  instruction: string;
  visualIntent: VisualRequest;
  verify: (result: ModelProposalResult, before: ModelSnapshot, after: ModelSnapshot) => void;
}
function furniture(snapshot: ModelSnapshot, id: string): Furniture {
  const item = snapshot.entities.find(entity => entity.id === id);
  assert.ok(item?.type === 'Furniture', `Missing furniture ${id}.`);
  return item;
}
function ready(result: ModelProposalResult): void { assert.equal(result.status, 'ready', result.review.rationale); }
function near(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) <= .02, `${actual} must be near ${expected}.`); }
function preserve(before: ModelSnapshot, after: ModelSnapshot, allowed: readonly string[]): void {
  const delta = diffSnapshots(before, after);
  assert.equal(delta.entities.added.length, 0); assert.equal(delta.entities.removed.length, 0);
  assert.deepEqual(delta.relationships, { added: [], removed: [], modified: [] });
  assert.ok(delta.entities.modified.every(item => allowed.includes(item.id)));
}
function supportedMove(before: ModelSnapshot, after: ModelSnapshot): void {
  const original = furniture(before, 'office-desk'); const moved = furniture(after, original.id);
  assert.equal(moved.rotationDeg, original.rotationDeg);
  for (const item of before.entities) {
    if (item.type !== 'Furniture' || item.supportId !== original.id) continue;
    const next = furniture(after, item.id);
    assert.equal(next.supportId, original.id);
    near(next.position[0] - moved.position[0], item.position[0] - original.position[0]);
    near(next.position[1] - moved.position[1], item.position[1] - original.position[1]);
  }
}
function quarterTurn(snapshot: ModelSnapshot): ModelSnapshot {
  const turn = ([x, y]: Point): Point => [-y, x];
  const rotation: Record<Furniture['rotationDeg'], Furniture['rotationDeg']> = { 0: 90, 90: 180, 180: 270, 270: 0 };
  return validateSnapshot({ ...snapshot, entities: snapshot.entities.map(item => {
    if (item.type === 'Wall') return { ...item, name: `Boundary ${item.id}`, start: turn(item.start), end: turn(item.end) };
    if (item.type === 'Furniture') return { ...item, position: turn(item.position), rotationDeg: rotation[item.rotationDeg] };
    if (item.type === 'Space') return { ...item, bounds: { minX: -item.bounds.maxY, maxX: -item.bounds.minY, minY: item.bounds.minX, maxY: item.bounds.maxX } };
    if (item.type === 'Equipment') return { ...item, position: turn(item.position), width: item.depth, depth: item.width };
    return item;
  }) });
}
const floor = residentialFloor();
const plantFloor = validateSnapshot({ ...floor, entities: floor.entities.map(item => item.type === 'Furniture' && item.id === 'living-plant' ? { ...item, position: [.45, 2.5] } : item) });
const scenarios: Scenario[] = [
  { id: 'desk-wall', snapshot: floor, selectedId: 'office-desk', instruction: 'Move the selected desk all the way to the wall.', visualIntent: { kind: 'selection' },
    verify(result, before, after) {
      ready(result); near(furnitureFootprint(furniture(after, 'office-desk')).minY, .1);
      supportedMove(before, after); preserve(before, after, ['office-desk', 'office-monitor', 'office-laptop', 'office-chair']);
    } },
  { id: 'rotated-desk-wall', snapshot: quarterTurn(floor), selectedId: 'office-desk', instruction: 'Move the selected desk all the way to the wall.', visualIntent: { kind: 'selection' },
    verify(result, before, after) {
      ready(result); near(furnitureFootprint(furniture(after, 'office-desk')).maxX, -.1);
      supportedMove(before, after); preserve(before, after, ['office-desk', 'office-monitor', 'office-laptop', 'office-chair']);
    } },
  { id: 'plant-wall', snapshot: plantFloor, selectedId: 'living-plant', instruction: 'Push this right up to the wall.', visualIntent: { kind: 'selection' },
    verify(result, before, after) { ready(result); near(furnitureFootprint(furniture(after, 'living-plant')).minX, .1); preserve(before, after, ['living-plant']); } },
  { id: 'explicit-freestanding', snapshot: floor, selectedId: 'office-desk',
    instruction: 'Move this to the marked floor point as a freestanding desk. Keep the chair where it is.', visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [10400, 2200] } },
    verify(result, before, after) { ready(result); assert.deepEqual(furniture(after, 'office-desk').position, [10.4, 2.2]); supportedMove(before, after); preserve(before, after, ['office-desk', 'office-monitor', 'office-laptop']); } },
  { id: 'another-desk-only', snapshot: floor, selectedId: 'office-desk',
    instruction: 'Add another desk at the marked point, without a computer, monitor, laptop or chair. Keep all existing furniture.', visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [10400, 2500] } },
    verify(result, before, after) {
      ready(result); const delta = diffSnapshots(before, after);
      assert.equal(delta.entities.added.length, 1); assert.equal(delta.entities.removed.length, 0); assert.equal(delta.entities.modified.length, 0);
      const added = delta.entities.added[0]; assert.ok(added?.type === 'Furniture' && added.kind === 'desk'); assert.deepEqual(added.position, [10.4, 2.5]);
      assert.deepEqual(delta.relationships, { added: [], removed: [], modified: [] });
    } },
  { id: 'choose-a-reasonable-wall', snapshot: floor, selectedId: 'living-table',
    instruction: 'Put this against a wall, whichever seems most sensible.', visualIntent: { kind: 'selection' },
    verify(result, before, after) { ready(result); preserve(before, after, ['living-table']); assert.notDeepEqual(furniture(before, 'living-table').position, furniture(after, 'living-table').position); } },
  { id: 'unsupported-topology', snapshot: floor, selectedId: 'room-office',
    instruction: 'Add a second room east of this room, retaining the original room and every existing object.', visualIntent: { kind: 'selection' },
    verify(result, before, after) { assert.equal(result.status, 'declined'); assert.deepEqual(after, before); } },
];
const caseIndex = process.argv.indexOf('--case');
const selected = caseIndex < 0 ? scenarios : scenarios.filter(item => item.id === process.argv[caseIndex + 1]);
if (!selected.length) throw new Error('Unknown intent evaluation case.');
const baseline = process.argv.includes('--baseline');
const evidenceDirectory = process.env.BIM_FORGE_INTENT_EVIDENCE_DIRECTORY;
if (evidenceDirectory) await fs.mkdir(evidenceDirectory, { recursive: true });
const connection = await CodexAccountConnection.open();
const scripts = new ModelScripts();
try {
  const worker = connection.modelWorker();
  console.log(JSON.stringify({ evaluation: 'model-intent-v1', provider: worker.identity, baseline, samplesPerCase: 1, note: 'Live stochastic samples, not a calibrated reliability estimate.' }));
  for (const scenario of selected) {
    const repo = await RoomRepository.createProject({ projectId: globalThis.crypto.randomUUID(), name: `Intent evaluation ${scenario.id}`, snapshot: scenario.snapshot });
    const original = repo.serialize();
    try {
      const result = await prepareModelProposal(repo, { requestId: `eval-${scenario.id}`, proposalName: `eval-${scenario.id}`,
        baseRevisionId: repo.head('main'), selectedObjectIds: [scenario.selectedId], instruction: scenario.instruction, visualIntent: scenario.visualIntent }, worker, undefined, { scripts });
      const after = result.repository.view(result.repository.head(result.status === 'ready' ? `eval-${scenario.id}` : 'main')).snapshot;
      assert.equal(repo.serialize(), original); assert.equal(result.repository.head('main'), repo.head('main'));
      scenario.verify(result, scenario.snapshot, after);
      if (!baseline) {
        assert.ok(result.review.intent, 'The agent must disclose its interpretation and self-assessment.');
        if (result.status === 'ready' && !scenario.id.startsWith('explicit-')) assert.ok(result.review.intent.assumptions.length > 0, 'Inferred choices must be disclosed.');
      }
      if (evidenceDirectory) await fs.writeFile(path.join(evidenceDirectory, `${scenario.id}.project.json`), result.repository.serialize());
      console.log(JSON.stringify({ case: scenario.id, passed: true, status: result.status, review: result.review, changes: diffSnapshots(scenario.snapshot, after) }));
    } catch (error) { process.exitCode = 1; console.log(JSON.stringify({ case: scenario.id, passed: false, error: error instanceof Error ? error.message : 'Evaluation failed.' })); }
  }
} finally { await scripts.dispose(); connection.close(); }
