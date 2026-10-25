import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessBudgets, ExecutionSchema, validateExecution } from './envelope.ts';
import { parse } from './contract.ts';
import type { Json } from './contract.ts';
import { ConfigSchema } from './workload.ts';

function config() {
  return {
    scale: 'fixture', clients: 1, historyRevisions: 10, repeats: 5, leaseMode: 'shared-correctness',
    environment: { nodeCpuLimit: 1, nodeMemoryLimitBytes: 1024 ** 3, postgresCpuLimit: 1.5,
      postgresMemoryLimitBytes: 3 * 1024 ** 3, diskBudgetBytes: 200 * 1024 ** 3 },
    execution: parse(ExecutionSchema, {
      decisionPath: 'decision.md', decisionSha256: 'a'.repeat(64), mode: { kind: 'load-and-measure' },
      purpose: 'bounded-updates', measurement: 'warm-single-client-exploratory', maxBoundedUpdates: 10,
      loadWallTimeLimitMs: 7200000, loadStatementTimeoutMs: 7200000,
      space: { dataPath: '/qualification', hostRootPath: '/host-root', dataBudgetBytes: 200 * 1024 ** 3,
        dataReserveBytes: 100 * 1024 ** 3, rootReserveBytes: 4 * 1024 ** 3, monitorEvidence: 'coordinator-watchdog.json' },
      exploratoryP95Ms: { detail: 300, page: 1000, oneHop: 1000, boundedDelta: 2000, smallAccept: 4000 },
    }, 'test envelope'),
  };
}

function extendedConfig() {
  const declared = config();
  return { ...declared, scale: 'full', historyRevisions: 1, leaseMode: 'exclusive-measurement',
    execution: parse(ExecutionSchema, { ...declared.execution, purpose: 'extended-initial-inventory',
      mode: { kind: 'load-only' }, measurement: 'correctness',
      loadWallTimeLimitMs: 21600000, loadStatementTimeoutMs: 21600000 }, 'extended inventory') };
}

function resourceConfig() {
  const initial = extendedConfig();
  return { ...initial, scale: 'reduced',
    environment: { ...initial.environment, nodeCpuLimit: 2, postgresCpuLimit: 2.5, postgresMemoryLimitBytes: 6 * 1024 ** 3 },
    execution: parse(ExecutionSchema, { ...initial.execution, purpose: 'resource-sensitivity-initial-inventory',
      loadWallTimeLimitMs: 7200000, loadStatementTimeoutMs: 7200000 }, 'resource sensitivity inventory') };
}

test('both opt-in variants propagate through the complete workload configuration schema', () => {
  const example = parse(ConfigSchema, JSON.parse(readFileSync('benchmarks/hospital/workloads/workload.example.json', 'utf8')
    .replace('REPLACE_WITH_PREDECLARED_DECISION_SHA256', 'a'.repeat(64))
    .replace('REPLACE_WITH_SOURCE_COMMIT_40_HEX', 'a'.repeat(40))), 'existing workload example');
  validateExecution(example);
  for (const variant of [extendedConfig(), resourceConfig()]) {
    const admitted = parse(ConfigSchema, { ...example, ...variant,
      environment: { ...example.environment, ...variant.environment } }, 'opt-in workload');
    validateExecution(admitted);
    assert.deepEqual(admitted.execution, variant.execution);
  }
});

test('explicit resource sensitivity admits only reduced/medium initial correctness with bounded resources', () => {
  const declared = resourceConfig();
  for (const scale of ['reduced', 'medium']) validateExecution({ ...declared, scale });
  validateExecution({ ...declared, environment: config().environment });
  for (const excessive of [
    { nodeCpuLimit: 2.01 }, { nodeMemoryLimitBytes: 1024 ** 3 + 1 },
    { postgresCpuLimit: 2.51 }, { postgresMemoryLimitBytes: 6 * 1024 ** 3 + 1 },
  ]) {
    assert.throws(() => validateExecution({ ...declared, environment: { ...declared.environment, ...excessive } }), /Resource declaration/);
  }
  for (const scale of ['fixture', 'smoke', 'full', 'detail-stress']) {
    assert.throws(() => validateExecution({ ...declared, scale }), /Resource sensitivity initial inventory/);
  }
  assert.throws(() => validateExecution({ ...declared, historyRevisions: 2 }), /exactly one revision/);
  assert.throws(() => validateExecution({ ...declared, leaseMode: 'shared-correctness' }), /exclusive measurement lease/);
});

test('resource sensitivity cannot combine longer deadlines, measured modes or other measurement purposes', () => {
  const { execution } = resourceConfig();
  for (const invalid of [
    { loadWallTimeLimitMs: 7200001 }, { loadStatementTimeoutMs: 7200001 },
    { loadWallTimeLimitMs: 21600000, loadStatementTimeoutMs: 21600000 },
    { mode: { kind: 'load-and-measure' } }, { mode: { kind: 'measure-existing', loadRecord: 'load.json' } },
    { measurement: 'warm-single-client-exploratory' }, { measurement: 'comparative' },
    { decisionPath: '' }, { decisionSha256: 'bad-hash' }, { allowExtended: true },
  ]) {
    assert.throws(() => parse(ExecutionSchema, { ...execution, ...invalid }, 'incompatible resource sensitivity'), /Invalid/);
  }
  assert.equal(assessBudgets(execution, []).eligible, false);
});

test('ordinary and extended full purposes cannot bypass original CPU/RAM caps', () => {
  const ordinary = config();
  const initial = extendedConfig();
  for (const purpose of ['initial-inventory', 'bounded-updates', 'smaller-fixture-history', 'extended-initial-inventory']) {
    const declared = purpose === 'extended-initial-inventory' ? initial : { ...ordinary,
      execution: parse(ExecutionSchema, { ...ordinary.execution, purpose }, 'ordinary purpose') };
    for (const excessive of [
      { nodeCpuLimit: 1.01 }, { nodeMemoryLimitBytes: 1024 ** 3 + 1 },
      { postgresCpuLimit: 1.51 }, { postgresMemoryLimitBytes: 3 * 1024 ** 3 + 1 },
    ]) {
      assert.throws(() => validateExecution({ ...declared, environment: { ...declared.environment, ...excessive } }), /Resource declaration/);
    }
  }
  const resources = resourceConfig();
  assert.throws(() => validateExecution({ ...initial, environment: resources.environment }), /Resource declaration/);
});

test('explicit extended initial inventory admits six hours without changing ordinary two-hour contracts', () => {
  const extended = extendedConfig();
  validateExecution(extended);
  assert.equal(extended.execution.loadWallTimeLimitMs, 21600000);
  assert.equal(extended.execution.loadStatementTimeoutMs, 21600000);
  for (const purpose of ['initial-inventory', 'bounded-updates', 'smaller-fixture-history']) {
    const ordinary = { ...extended.execution, purpose, loadWallTimeLimitMs: 7200000, loadStatementTimeoutMs: 7200000 };
    assert.deepEqual(parse(ExecutionSchema, ordinary, 'ordinary two hours'), ordinary);
    for (const limit of ['loadWallTimeLimitMs', 'loadStatementTimeoutMs']) {
      for (const excessive of [7200001, 21600000]) {
        assert.throws(() => parse(ExecutionSchema, { ...ordinary, [limit]: excessive }, 'accidental extension'), /Invalid/);
      }
    }
  }
});

test('extended wall and statement limits independently reject invalid or unbounded deadlines', () => {
  const { execution } = extendedConfig();
  for (const limit of ['loadWallTimeLimitMs', 'loadStatementTimeoutMs']) {
    for (const value of [1000, 7200000, 7200001, 21600000]) {
      parse(ExecutionSchema, { ...execution, [limit]: value }, 'bounded extension');
    }
    for (const value of [undefined, 0, 999, 1000.5, 21600001, Number.POSITIVE_INFINITY]) {
      assert.throws(() => parse(ExecutionSchema, { ...execution, [limit]: value }, 'invalid extension'), /Invalid/);
    }
  }
});

test('extended admission rejects other modes, measurement purposes and undeclared opt-in fields', () => {
  const { execution } = extendedConfig();
  const incompatible: unknown[] = [
    { ...execution, purpose: undefined }, { ...execution, purpose: 'extended-inventory' },
    { ...execution, mode: { kind: 'load-and-measure' } },
    { ...execution, mode: { kind: 'measure-existing', loadRecord: 'load.json' } },
    { ...execution, mode: { kind: 'load-only', loadRecord: 'load.json' } },
    { ...execution, measurement: 'warm-single-client-exploratory' }, { ...execution, measurement: 'comparative' },
    { ...execution, allowExtended: true },
  ];
  for (const input of incompatible) assert.throws(() => parse(ExecutionSchema, input, 'incompatible extension'), /Invalid/);
});

test('extended admission requires full scale, initial history and an exclusive lease', () => {
  const extended = extendedConfig();
  for (const scale of ['fixture', 'smoke', 'reduced', 'medium', 'detail-stress']) {
    assert.throws(() => validateExecution({ ...extended, scale }), /Extended initial inventory/);
  }
  for (const historyRevisions of [0, 2, 1000]) {
    assert.throws(() => validateExecution({ ...extended, historyRevisions }), /Extended initial inventory/);
  }
  assert.throws(() => validateExecution({ ...extended, leaseMode: 'shared-correctness' }), /exclusive measurement lease/);
});

test('extended admission retains pinned decisions, resource, disk and exploratory budget validators', () => {
  const extended = extendedConfig();
  for (const invalid of [
    { decisionPath: undefined }, { decisionPath: '' }, { decisionSha256: undefined }, { decisionSha256: 'bad-hash' },
    { exploratoryP95Ms: { ...extended.execution.exploratoryP95Ms, detail: 301 } },
    { space: { ...extended.execution.space, rootReserveBytes: 3 * 1024 ** 3 } },
    { space: { ...extended.execution.space, dataBudgetBytes: 201 * 1024 ** 3 } },
  ]) {
    assert.throws(() => parse(ExecutionSchema, { ...extended.execution, ...invalid }, 'relaxed extension'), /Invalid/);
  }
  assert.throws(() => validateExecution({ ...extended, environment: { ...extended.environment, nodeCpuLimit: 1.1 } }), /Resource declaration/);
  assert.throws(() => validateExecution({ ...extended, environment: { ...extended.environment, diskBudgetBytes: 1 } }), /Disk budgets must agree/);
  assert.equal(assessBudgets(extended.execution, []).eligible, false);
});

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
