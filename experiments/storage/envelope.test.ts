import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBudgets, ExecutionSchema, validateExecution } from './envelope.ts';
import { parse } from './contract.ts';
import type { Json } from './contract.ts';

function config() {
  return {
    scale: 'fixture', clients: 1, historyRevisions: 10, repeats: 5, leaseMode: 'shared-correctness',
    environment: { nodeCpuLimit: 1, nodeMemoryLimitBytes: 1024 ** 3, postgresCpuLimit: 1.5,
      postgresMemoryLimitBytes: 3 * 1024 ** 3, diskBudgetBytes: 200 * 1024 ** 3 },
    execution: parse(ExecutionSchema, {
      decisionPath: 'decision.md', decisionSha256: 'a'.repeat(64), mode: { kind: 'load-and-measure' },
      purpose: 'bounded-updates', measurement: 'warm-single-client-exploratory', maxBoundedUpdates: 10, loadWallTimeLimitMs: 7200000,
      space: { dataPath: '/qualification', hostRootPath: '/host-root', dataBudgetBytes: 200 * 1024 ** 3,
        dataReserveBytes: 100 * 1024 ** 3, rootReserveBytes: 4 * 1024 ** 3, monitorEvidence: 'coordinator-watchdog.json' },
      exploratoryP95Ms: { detail: 300, page: 1000, oneHop: 1000, boundedDelta: 2000, smallAccept: 4000 },
    }, 'test envelope'),
  };
}

test('predeclared envelope rejects larger resource limits and posthoc budget relaxation', () => {
  const declared = config(); validateExecution(declared);
  assert.throws(() => validateExecution({ ...declared, environment: { ...declared.environment, nodeMemoryLimitBytes: 1536 * 1024 ** 2 } }), /Resource declaration/);
  assert.throws(() => parse(ExecutionSchema, { ...declared.execution,
    exploratoryP95Ms: { ...declared.execution.exploratoryP95Ms, detail: 301 } }, 'relaxed budget'), /Invalid/);
  assert.throws(() => parse(ExecutionSchema, { ...declared.execution, loadWallTimeLimitMs: 7200001 }, 'longer load'), /Invalid/);
  assert.throws(() => parse(ExecutionSchema, { ...declared.execution,
    space: { ...declared.execution.space, rootReserveBytes: 3 * 1024 ** 3 } }, 'lower reserve'), /Invalid/);
});

test('full inventory starts alone at one revision; deep history stays on smaller fixtures', () => {
  const declared = config();
  const initial = { ...declared, scale: 'full', historyRevisions: 1, execution: { ...declared.execution,
    purpose: 'initial-inventory', mode: { kind: 'load-only' } } };
  const parsedInitial = { ...initial, execution: parse(ExecutionSchema, initial.execution, 'initial inventory') };
  validateExecution(parsedInitial);
  assert.throws(() => validateExecution({ ...parsedInitial, historyRevisions: 2 }), /exactly one revision/);
  assert.throws(() => validateExecution({ ...declared, scale: 'full' }), /separate stages/);
  const deep = { ...declared, historyRevisions: 1000, execution: parse(ExecutionSchema,
    { ...declared.execution, purpose: 'smaller-fixture-history' }, 'small deep history') };
  validateExecution(deep);
  assert.throws(() => validateExecution({ ...deep, scale: 'full' }), /deep history/);
});

test('five alternating repetitions and exclusive lease apply to relative comparisons', () => {
  const declared = config();
  validateExecution({ ...declared, repeats: 1 });
  const comparative = { ...declared, execution: parse(ExecutionSchema, { ...declared.execution, measurement: 'comparative' }, 'comparison') };
  assert.throws(() => validateExecution(comparative), /alternating repeats/);
  validateExecution({ ...comparative, leaseMode: 'exclusive-measurement' });
  assert.throws(() => validateExecution({ ...comparative, leaseMode: 'exclusive-measurement', repeats: 4 }), /alternating repeats/);
});

test('slow, missing or failed exploratory operations stay failed at the declared budget', () => {
  const declared = config();
  const samples: Json[] = [
    { operation: 'entity-detail', variant: 'candidate', elapsedMs: 301, error: null },
    { operation: 'page-query', variant: 'candidate', elapsedMs: 100, error: 'database timeout' },
    { operation: 'bounded-delta', variant: 'candidate', elapsedMs: 2000, error: null },
  ];
  const assessed = assessBudgets(declared.execution, samples);
  assert.equal(assessed.operations.find((item) => item.operation === 'entity-detail')?.passed, false);
  assert.equal(assessed.operations.find((item) => item.operation === 'page-query')?.passed, false);
  assert.equal(assessed.operations.find((item) => item.operation === 'one-hop')?.passed, false);
  assert.equal(assessed.operations.find((item) => item.operation === 'bounded-delta')?.passed, true);
  assert.equal(assessBudgets({ ...declared.execution, measurement: 'correctness' }, samples).operations.some((item) => item.passed), false);
});
