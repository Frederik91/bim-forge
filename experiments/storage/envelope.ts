import { statfs } from 'node:fs/promises';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { HashSchema, parse } from './contract.ts';
import type { Json } from './contract.ts';

const GiB = 1024 ** 3;
const ExecutionProperties = {
  decisionPath: Type.String({ minLength: 1 }), decisionSha256: HashSchema,
  maxBoundedUpdates: Type.Integer({ minimum: 1, maximum: 100 }),
  space: Type.Object({
    dataPath: Type.String({ minLength: 1 }), hostRootPath: Type.String({ minLength: 1 }),
    dataBudgetBytes: Type.Integer({ minimum: 1, maximum: 200 * GiB }),
    dataReserveBytes: Type.Integer({ minimum: 100 * GiB }), rootReserveBytes: Type.Integer({ minimum: 4 * GiB }),
    monitorEvidence: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  exploratoryP95Ms: Type.Object({
    detail: Type.Number({ exclusiveMinimum: 0, maximum: 300 }), page: Type.Number({ exclusiveMinimum: 0, maximum: 1000 }),
    oneHop: Type.Number({ exclusiveMinimum: 0, maximum: 1000 }), boundedDelta: Type.Number({ exclusiveMinimum: 0, maximum: 2000 }),
    smallAccept: Type.Number({ exclusiveMinimum: 0, maximum: 4000 }),
  }, { additionalProperties: false }),
};
export const ExecutionSchema = Type.Union([
  Type.Object({
    ...ExecutionProperties,
    purpose: Type.Union([Type.Literal('initial-inventory'), Type.Literal('bounded-updates'), Type.Literal('smaller-fixture-history')]),
    mode: Type.Union([
      Type.Object({ kind: Type.Literal('load-only') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('load-and-measure') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('measure-existing'), loadRecord: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    ]),
    measurement: Type.Union([Type.Literal('correctness'), Type.Literal('warm-single-client-exploratory'), Type.Literal('comparative')]),
    loadWallTimeLimitMs: Type.Integer({ minimum: 1000, maximum: 7200000 }),
    loadStatementTimeoutMs: Type.Integer({ minimum: 1000, maximum: 7200000 }),
  }, { additionalProperties: false }),
  Type.Object({
    ...ExecutionProperties,
    purpose: Type.Literal('extended-initial-inventory'),
    mode: Type.Object({ kind: Type.Literal('load-only') }, { additionalProperties: false }),
    measurement: Type.Literal('correctness'),
    loadWallTimeLimitMs: Type.Integer({ minimum: 1000, maximum: 21600000 }),
    loadStatementTimeoutMs: Type.Integer({ minimum: 1000, maximum: 21600000 }),
  }, { additionalProperties: false }),
  Type.Object({
    ...ExecutionProperties,
    purpose: Type.Literal('resource-sensitivity-initial-inventory'),
    mode: Type.Object({ kind: Type.Literal('load-only') }, { additionalProperties: false }),
    measurement: Type.Literal('correctness'),
    loadWallTimeLimitMs: Type.Integer({ minimum: 1000, maximum: 7200000 }),
    loadStatementTimeoutMs: Type.Integer({ minimum: 1000, maximum: 7200000 }),
  }, { additionalProperties: false }),
]);
export type Execution = Static<typeof ExecutionSchema>;

export function validateExecution(config: {
  execution: Execution; scale: string; clients: number; historyRevisions: number; repeats: number; leaseMode: string;
  environment: { nodeCpuLimit: number; nodeMemoryLimitBytes: number; postgresCpuLimit: number; postgresMemoryLimitBytes: number; diskBudgetBytes: number };
}): void {
  const { execution, environment } = config;
  const resourceSensitivity = execution.purpose === 'resource-sensitivity-initial-inventory';
  if (environment.nodeCpuLimit > (resourceSensitivity ? 2 : 1) || environment.nodeMemoryLimitBytes > GiB
      || environment.postgresCpuLimit > (resourceSensitivity ? 2.5 : 1.5)
      || environment.postgresMemoryLimitBytes > (resourceSensitivity ? 6 : 3) * GiB) {
    throw new Error('Resource declaration exceeds the predeclared initial CPU/memory envelope');
  }
  if (environment.diskBudgetBytes !== execution.space.dataBudgetBytes) throw new Error('Disk budgets must agree');
  const full = config.scale === 'full' || config.scale === 'detail-stress';
  if (resourceSensitivity && ((config.scale !== 'reduced' && config.scale !== 'medium')
      || config.historyRevisions !== 1 || config.leaseMode !== 'exclusive-measurement')) {
    throw new Error('Resource sensitivity initial inventory requires reduced/medium scale, exactly one revision and an exclusive measurement lease');
  }
  if (execution.purpose === 'extended-initial-inventory'
      && (config.scale !== 'full' || config.historyRevisions !== 1 || config.leaseMode !== 'exclusive-measurement')) {
    throw new Error('Extended initial inventory requires full scale, exactly one revision and an exclusive measurement lease');
  }
  if (execution.purpose === 'initial-inventory' && (config.historyRevisions !== 1 || execution.mode.kind !== 'load-only')) {
    throw new Error('Initial inventory must load only, at exactly one revision');
  }
  if (execution.purpose === 'bounded-updates' && config.historyRevisions - 1 > execution.maxBoundedUpdates) {
    throw new Error('Requested updates exceed their predeclared bound');
  }
  if (full && (execution.mode.kind === 'load-and-measure' || execution.purpose === 'smaller-fixture-history')) {
    throw new Error('Full inventory and bounded measurements require separate stages; deep history uses a smaller fixture');
  }
  if (full && execution.mode.kind === 'measure-existing' && execution.purpose !== 'bounded-updates') {
    throw new Error('Full measurement must declare bounded updates against the completed initial inventory');
  }
  if (execution.measurement === 'warm-single-client-exploratory' && config.clients !== 1) throw new Error('Exploratory p95 budgets require one client');
  if (execution.measurement === 'comparative' && (config.repeats < 5 || config.leaseMode !== 'exclusive-measurement')) {
    throw new Error('Relative comparison requires at least five alternating repeats in an exclusive measurement slot');
  }
}

export async function spaceSnapshot(execution: Execution): Promise<{
  dataAvailableBytes: number; hostRootAvailableBytes: number; dataReserveBytes: number; rootReserveBytes: number;
}> {
  const [data, root] = await Promise.all([statfs(execution.space.dataPath), statfs(execution.space.hostRootPath)]);
  const result = { dataAvailableBytes: data.bavail * data.bsize, hostRootAvailableBytes: root.bavail * root.bsize,
    dataReserveBytes: execution.space.dataReserveBytes, rootReserveBytes: execution.space.rootReserveBytes };
  if (result.dataAvailableBytes < result.dataReserveBytes || result.hostRootAvailableBytes < result.rootReserveBytes) {
    throw new Error(`Predeclared free-space reserve breached: ${JSON.stringify(result)}`);
  }
  return result;
}

const SampleSchema = Type.Object({ operation: Type.String(), variant: Type.String(), elapsedMs: Type.Number(), error: Type.Union([Type.Null(), Type.String()]) });
export function assessBudgets(execution: Execution, samples: Json[]): {
  claim: string; eligible: boolean; operations: { operation: string; budgetMs: number; n: number; errors: number; p95Ms: number | null; passed: boolean }[];
} {
  const budgets = execution.exploratoryP95Ms;
  const groups = [
    { operation: 'entity-detail', budgetMs: budgets.detail }, { operation: 'page-query', budgetMs: budgets.page },
    { operation: 'one-hop', budgetMs: budgets.oneHop }, { operation: 'bounded-delta', budgetMs: budgets.boundedDelta },
    { operation: 'bounded-acceptance', budgetMs: budgets.smallAccept },
  ];
  const eligible = execution.measurement === 'warm-single-client-exploratory';
  const parsed = samples.map((sample) => parse(SampleSchema, sample, 'latency budget sample'));
  return { claim: 'Predeclared exploratory budgets, not product SLOs or a performance winner', eligible,
    operations: groups.map(({ operation, budgetMs }) => {
      const selected = parsed.filter((sample) => sample.operation === operation && sample.variant === 'candidate');
      const times = selected.filter((sample) => sample.error === null).map((sample) => sample.elapsedMs).sort((a, b) => a - b);
      const p95Ms = times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? null;
      const errors = selected.length - times.length;
      return { operation, budgetMs, n: selected.length, errors, p95Ms,
        passed: eligible && errors === 0 && p95Ms !== null && p95Ms <= budgetMs };
    }) };
}
