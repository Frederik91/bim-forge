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
import type { IntentAssessment } from '../src/model-intent.ts';

interface EvaluationResult { status: ModelProposalResult['status']; review: { rationale: string; intent?: IntentAssessment } }

interface Scenario {
  id: string;
  snapshot: ModelSnapshot;
  selectedId: string;
  instruction: string;
  visualIntent: VisualRequest;
  verify: (result: EvaluationResult, before: ModelSnapshot, after: ModelSnapshot) => void;
}
function furniture(snapshot: ModelSnapshot, id: string): Furniture {
  const item = snapshot.entities.find(entity => entity.id === id);
  assert.ok(item?.type === 'Furniture', `Missing furniture ${id}.`);
  return item;
}
function ready(result: EvaluationResult): void { assert.equal(result.status, 'ready', result.review.rationale); }
function near(actual: number, expected: number, tolerance = .001): void { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} must be near ${expected}.`); }
function touchesWall(snapshot: ModelSnapshot, item: Furniture): boolean {
  const b = furnitureFootprint(item);
  return snapshot.entities.some(wall => {
    if (wall.type !== 'Wall') return false;
    if (wall.start[0] === wall.end[0]) return b.minY >= Math.min(wall.start[1], wall.end[1]) && b.maxY <= Math.max(wall.start[1], wall.end[1])
      && [b.minX - wall.start[0] - wall.thickness / 2, b.maxX - wall.start[0] + wall.thickness / 2].some(gap => Math.abs(gap) <= .001);
    if (wall.start[1] === wall.end[1]) return b.minX >= Math.min(wall.start[0], wall.end[0]) && b.maxX <= Math.max(wall.start[0], wall.end[0])
      && [b.minY - wall.start[1] - wall.thickness / 2, b.maxY - wall.start[1] + wall.thickness / 2].some(gap => Math.abs(gap) <= .001);
    return false;
  });
}
function preserve(before: ModelSnapshot, after: ModelSnapshot, allowed: readonly string[]): void {
  const delta = diffSnapshots(before, after);
  assert.equal(delta.entities.added.length, 0); assert.equal(delta.entities.removed.length, 0);
  assert.deepEqual(delta.relationships, { added: [], removed: [], modified: [] });
  assert.ok(delta.entities.modified.every(item => allowed.includes(item.id)));
}
function supportedMove(before: ModelSnapshot, after: ModelSnapshot, id = 'office-desk'): void {
  const original = furniture(before, id); const moved = furniture(after, original.id);
  assert.deepEqual({ ...moved, position: original.position }, original, 'The support changes position only.');
  for (const item of before.entities) {
    if (item.type !== 'Furniture' || item.supportId !== original.id) continue;
    const next = furniture(after, item.id);
    assert.deepEqual({ ...next, position: item.position }, item, 'Supported contents retain rotation, dimensions, identity and support.');
    near(next.position[0] - moved.position[0], item.position[0] - original.position[0], .000001);
    near(next.position[1] - moved.position[1], item.position[1] - original.position[1], .000001);
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
const multiDeskFloor = validateSnapshot({ ...floor, entities: [
  ...floor.entities.map(item => item.type === 'Furniture' && item.id === 'living-plant' ? { ...item, position: [.55, 1.8] } : item),
  { id: 'studio-desk', type: 'Furniture', name: 'Writing desk', kind: 'desk', position: [.7, 2.8], width: 1, depth: .6, height: .75, rotationDeg: 270, supportId: null },
  { id: 'studio-monitor', type: 'Furniture', name: 'Studio monitor', kind: 'monitor', position: [.6, 2.7], width: .4, depth: .15, height: .4, rotationDeg: 270, supportId: 'studio-desk' },
  { id: 'studio-laptop', type: 'Furniture', name: 'Studio laptop', kind: 'laptop', position: [.85, 3], width: .3, depth: .2, height: .2, rotationDeg: 270, supportId: 'studio-desk' },
  { id: 'studio-chair', type: 'Furniture', name: 'Writing chair', kind: 'chair', position: [1.5, 2.8], width: .5, depth: .5, height: .9, rotationDeg: 90, supportId: null },
] });
const scenarios: Scenario[] = [
  { id: 'all-desks-with-contents', snapshot: multiDeskFloor, selectedId: 'office-desk',
    instruction: 'Move all desks to touch the wall behind them.', visualIntent: { kind: 'selection' },
    verify(result, before, after) {
      ready(result); near(furnitureFootprint(furniture(after, 'office-desk')).minY, .1); near(furnitureFootprint(furniture(after, 'studio-desk')).minX, .1);
      supportedMove(before, after); supportedMove(before, after, 'studio-desk');
      preserve(before, after, ['office-desk', 'office-monitor', 'office-laptop', 'office-chair', 'studio-desk', 'studio-monitor', 'studio-laptop', 'studio-chair']);
    } },
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
    instruction: 'Move this to the marked floor point in the living room as a freestanding desk. Keep the office chair where it is.', visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [3800, 2300] } },
    verify(result, before, after) { ready(result); assert.deepEqual(furniture(after, 'office-desk').position, [3.8, 2.3]); supportedMove(before, after); preserve(before, after, ['office-desk', 'office-monitor', 'office-laptop']); } },
  { id: 'another-desk-only', snapshot: floor, selectedId: 'office-desk',
    instruction: 'Add another desk at the marked point in the living room, without a computer, monitor, laptop or chair. Keep all existing furniture.', visualIntent: { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [3800, 2300] } },
    verify(result, before, after) {
      ready(result); const delta = diffSnapshots(before, after);
      assert.equal(delta.entities.added.length, 1); assert.equal(delta.entities.removed.length, 0); assert.equal(delta.entities.modified.length, 0);
      const added = delta.entities.added[0]; assert.ok(added?.type === 'Furniture' && added.kind === 'desk'); assert.deepEqual(added.position, [3.8, 2.3]);
      assert.deepEqual(delta.relationships, { added: [], removed: [], modified: [] });
    } },
  { id: 'choose-a-reasonable-wall', snapshot: floor, selectedId: 'living-table',
    instruction: 'Put this against a wall, whichever seems most sensible.', visualIntent: { kind: 'selection' },
    verify(result, before, after) { ready(result); preserve(before, after, ['living-table']); assert.notDeepEqual(furniture(before, 'living-table').position, furniture(after, 'living-table').position); assert.ok(touchesWall(after, furniture(after, 'living-table')), 'The chosen table placement must actually touch a wall.'); } },
  { id: 'unsupported-topology', snapshot: floor, selectedId: 'room-office',
    instruction: 'Add a second room east of this room, retaining the original room and every existing object.', visualIntent: { kind: 'selection' },
    verify(result, before, after) { assert.equal(result.status, 'declined'); assert.deepEqual(after, before); } },
];
function verifySample(scenario: Scenario, result: EvaluationResult, repository: RoomRepository, baseline: boolean): ModelSnapshot {
  assert.deepEqual(repository.view(repository.root()).snapshot, scenario.snapshot);
  assert.equal(repository.head('main'), repository.root(), 'Evaluation proposals must never be accepted automatically.');
  const after = repository.view(repository.head(result.status === 'ready' ? `eval-${scenario.id}` : 'main')).snapshot;
  scenario.verify(result, scenario.snapshot, after);
  if (!baseline && result.status === 'ready') {
    assert.equal(repository.review(`eval-${scenario.id}`).decision.status, 'pending');
    assert.ok(result.review.intent, 'The agent must disclose its interpretation and self-assessment.');
    if (scenario.id.endsWith('wall') || scenario.id === 'all-desks-with-contents') assert.ok(result.review.intent.assumptions.length > 0, 'Inferred choices must be disclosed.');
  }
  return after;
}
const caseIndex = process.argv.indexOf('--case');
const selected = caseIndex < 0 ? scenarios : scenarios.filter(item => item.id === process.argv[caseIndex + 1]);
if (!selected.length) throw new Error('Unknown intent evaluation case.');
const baseline = process.argv.includes('--baseline');
const replayIndex = process.argv.indexOf('--replay');
if (replayIndex >= 0) {
  const directory = process.argv[replayIndex + 1];
  if (!directory) throw new Error('Replay requires the saved evidence directory.');
  for (const scenario of selected) {
    const repo = await RoomRepository.restore(await fs.readFile(path.join(directory, `${scenario.id}.project.json`), 'utf8'));
    const name = `eval-${scenario.id}`;
    const proposed = repo.branches().some(branch => branch.name === name);
    const result: EvaluationResult = { status: proposed ? 'ready' : 'declined', review: proposed ? repo.review(name) : { rationale: 'No proposal was saved.' } };
    verifySample(scenario, result, repo, baseline);
    console.log(JSON.stringify({ replay: scenario.id, passed: true, note: 'Rechecks saved live outputs without another model call.' }));
  }
} else {
  const evidenceDirectory = process.env.BIM_FORGE_INTENT_EVIDENCE_DIRECTORY;
  if (evidenceDirectory) {
    await fs.mkdir(evidenceDirectory, { recursive: true });
    if ((await fs.readdir(evidenceDirectory)).length) throw new Error('Use a fresh empty evidence directory for each live run. Previous samples must not mask failures.');
  }
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
        if (evidenceDirectory) await fs.writeFile(path.join(evidenceDirectory, `${scenario.id}.project.json`), result.repository.serialize(), { flag: 'wx' });
        assert.equal(repo.serialize(), original);
        const after = verifySample(scenario, result, result.repository, baseline);
        console.log(JSON.stringify({ case: scenario.id, passed: true, status: result.status, review: result.review, changes: diffSnapshots(scenario.snapshot, after) }));
      } catch (error) { process.exitCode = 1; console.log(JSON.stringify({ case: scenario.id, passed: false, error: error instanceof Error ? error.message : 'Evaluation failed.' })); }
    }
  } finally { await scripts.dispose(); connection.close(); }
}
