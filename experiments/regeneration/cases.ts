import assert from 'node:assert/strict';
import { parseModel } from './contract.ts';
import type { Model, Node } from './contract.ts';
import { initialize, regenerate } from './evaluator.ts';
import type { Evaluation, Snapshot } from './evaluator.ts';
import { fixture } from './fixture.ts';

export interface CaseExecution { artifact: unknown; verify: () => void }
export interface DependencyCase { caseId: string; expected: string; execute: () => CaseExecution }

function edit(model: Model, change: (node: Node) => Node): Model {
  return { ...model, nodes: model.nodes.map(change) };
}
function levelEdit(model: Model): Model {
  return edit(model, (node) => node.kind === 'level' && node.id === 'level-ground'
    ? { ...node, elevationMm: 500 } : node);
}
function values(snapshot: Snapshot): [string, number][] {
  return snapshot.states.map(({ authored, evaluated }) => [authored.id,
    evaluated.kind === 'position' ? evaluated.elevationMm : evaluated.distanceMm]);
}
function unchanged(baseline: Snapshot, before: string, outcome: Evaluation): void {
  assert.equal(JSON.stringify(baseline), before, 'accepted baseline changed');
  if (outcome.kind !== 'evaluated') {
    assert.strictEqual(outcome.retained, baseline);
    assert.equal('candidate' in outcome, false, 'failed evaluation exposed a candidate');
    assert.equal('delta' in outcome, false, 'failed evaluation exposed a publishable delta');
  }
}
function scenario(input: {
  caseId: string; expected: string; change: (model: Model) => Model;
  verify: (outcome: Evaluation, baseline: Snapshot) => void;
}): DependencyCase {
  return { caseId: input.caseId, expected: input.expected, execute() {
    const model = fixture();
    const baseline = initialize(model);
    const before = JSON.stringify(baseline);
    const candidate = input.change(model);
    const outcome = regenerate({ accepted: baseline, candidate });
    return { artifact: { baseline, requested: candidate, outcome }, verify() {
      unchanged(baseline, before, outcome);
      input.verify(outcome, baseline);
    } };
  } };
}

export const dependencyCases: DependencyCase[] = [
  scenario({ caseId: 'level-full-dependent-delta',
    expected: 'Level +500 mm changes exactly level-ground, wall, opening, handle and clearance, with complete before/after states.',
    change: levelEdit,
    verify(outcome, baseline) {
      assert.ok(outcome.kind === 'evaluated');
      assert.deepEqual(outcome.delta.map((entry) => entry.id), ['clearance', 'handle', 'level-ground', 'opening', 'wall']);
      assert.deepEqual(values(baseline), [['clearance', 1800], ['handle', 2100], ['level-ground', 0],
        ['level-upper', 3000], ['opening', 1200], ['upper-equipment', 3050], ['wall', 200]]);
      assert.deepEqual(values(outcome.candidate), [['clearance', 1300], ['handle', 2600], ['level-ground', 500],
        ['level-upper', 3000], ['opening', 1700], ['upper-equipment', 3050], ['wall', 700]]);
      for (const entry of outcome.delta) {
        assert.deepEqual(entry.before, baseline.states.find((state) => state.authored.id === entry.id));
        assert.deepEqual(entry.after, outcome.candidate.states.find((state) => state.authored.id === entry.id));
      }
    } }),
  scenario({ caseId: 'host-full-dependent-delta',
    expected: 'Wall offset +200 mm changes wall, opening, handle and cross-level clearance; neither level nor independent equipment changes.',
    change: (model) => edit(model, (node) => node.kind === 'hosted' && node.id === 'wall' ? { ...node, offsetMm: 400 } : node),
    verify(outcome) {
      assert.ok(outcome.kind === 'evaluated');
      assert.deepEqual(outcome.delta.map((entry) => entry.id), ['clearance', 'handle', 'opening', 'wall']);
      assert.deepEqual(values(outcome.candidate), [['clearance', 1600], ['handle', 2300], ['level-ground', 0],
        ['level-upper', 3000], ['opening', 1400], ['upper-equipment', 3050], ['wall', 400]]);
    } }),
  ...(['fatal', 'pending'] satisfies ('fatal' | 'pending')[]).map((kind) => scenario({
    caseId: `${kind}-atomic-rollback`,
    expected: `${kind} at the handle after staging the level, wall, opening and clearance preserves accepted state and exposes no candidate.`,
    change: (model) => edit(levelEdit(model), (node) => {
      if (node.kind !== 'hosted' || node.id !== 'handle') return node;
      return kind === 'fatal' ? { ...node, ceilingMm: 2500 }
        : { ...node, attachment: { kind: 'unresolved', reason: 'split-face-has-two-successors' } };
    }),
    verify(outcome, baseline) {
      assert.ok(outcome.kind !== 'evaluated');
      assert.equal(outcome.kind, kind);
      assert.equal(outcome.diagnostic, kind === 'fatal' ? 'ceiling-exceeded:handle'
        : 'unresolved-attachment:handle:split-face-has-two-successors');
      assert.deepEqual(outcome.attemptedDelta.map((entry) => entry.id), ['clearance', 'level-ground', 'opening', 'wall']);
      assert.equal(outcome.evaluationOrder.at(-1), 'handle');
      assert.ok(outcome.attemptedDelta.length > 0, 'failure must happen after real staging');
      const retry = regenerate({ accepted: baseline, candidate: levelEdit(baseline.model) });
      assert.ok(retry.kind === 'evaluated', 'a failed attempt must not poison later evaluation');
      assert.deepEqual(values(retry.candidate), [['clearance', 1300], ['handle', 2600], ['level-ground', 500],
        ['level-upper', 3000], ['opening', 1700], ['upper-equipment', 3050], ['wall', 700]]);
    } })),
  scenario({ caseId: 'dependency-cycle-rejected',
    expected: 'A wall -> handle -> opening -> wall dependency cycle is fatal before staging.',
    change: (model) => edit(model, (node) => node.kind === 'hosted' && node.id === 'wall' ? { ...node, hostId: 'handle' } : node),
    verify(outcome) {
      assert.ok(outcome.kind === 'fatal');
      assert.match(outcome.diagnostic, /^dependency-cycle:/);
      assert.deepEqual(outcome.attemptedDelta, []);
      assert.deepEqual(outcome.evaluationOrder, []);
    } }),
  scenario({ caseId: 'connectivity-cycle-allowed',
    expected: 'A physical wall/opening/handle connectivity triangle does not become a dependency cycle; evaluation is a no-op.',
    change: (model) => model,
    verify(outcome, baseline) {
      assert.ok(outcome.kind === 'evaluated');
      assert.equal(baseline.model.connectivity.length, 3);
      assert.deepEqual(outcome.delta, []);
      assert.deepEqual(outcome.candidate, baseline);
    } }),
  scenario({ caseId: 'missing-host-rejected', expected: 'A missing host is fatal before staging.',
    change: (model) => edit(model, (node) => node.kind === 'hosted' && node.id === 'wall' ? { ...node, hostId: 'missing-host' } : node),
    verify(outcome) {
      assert.ok(outcome.kind === 'fatal');
      assert.equal(outcome.diagnostic, 'missing-dependency:missing-host');
      assert.deepEqual(outcome.attemptedDelta, []);
    } }),
  scenario({ caseId: 'duplicate-entity-rejected', expected: 'Duplicate IDs cannot alias two authored entities.',
    change: (model) => ({ ...model, nodes: [...model.nodes, { kind: 'level', id: 'wall', elevationMm: 20 }] }),
    verify(outcome) {
      assert.ok(outcome.kind === 'fatal');
      assert.equal(outcome.diagnostic, 'duplicate-entity-id');
      assert.deepEqual(outcome.attemptedDelta, []);
    } }),
  scenario({ caseId: 'input-order-independent', expected: 'Reversing fixture node order preserves evaluated values, delta and deterministic evaluation order.',
    change: (model) => ({ ...levelEdit(model), nodes: levelEdit(model).nodes.toReversed() }),
    verify(outcome, baseline) {
      const forward = regenerate({ accepted: baseline, candidate: levelEdit(baseline.model) });
      assert.ok(outcome.kind === 'evaluated' && forward.kind === 'evaluated');
      assert.deepEqual(outcome.candidate.states, forward.candidate.states);
      assert.deepEqual(outcome.delta, forward.delta);
      assert.deepEqual(outcome.evaluationOrder, forward.evaluationOrder);
    } }),
  { caseId: 'typebox-input-boundary', expected: 'TypeBox rejects out-of-range, unknown-field and wrong-kind input before evaluation.',
    execute() {
      const invalid: unknown[] = [
        { nodes: [{ kind: 'level', id: 'level', elevationMm: 1000001 }], connectivity: [] },
        { nodes: [{ kind: 'level', id: 'level', elevationMm: 0, typo: true }], connectivity: [] },
        { nodes: [{ kind: 'invented', id: 'level' }], connectivity: [] },
      ];
      const observed = invalid.map((input) => {
        try { parseModel(input); return 'accepted'; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      });
      return { artifact: { invalid, observed }, verify() {
        assert.deepEqual(observed, invalid.map(() => 'Invalid bounded EX-07 model input'));
      } };
    } },
];
