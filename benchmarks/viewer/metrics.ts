import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

const sampleSchema = Type.Object({ operation: Type.String({ minLength: 1 }), durationMs: Type.Number({ minimum: 0 }),
  drawCalls: Type.Integer({ minimum: 0 }), triangles: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const ResultSchema = Type.Object({
  version: Type.Literal(1), candidate: Type.Union([Type.Literal('babylon'), Type.Literal('fragments')]),
  profile: Type.Literal('viewer-192-v1'), purpose: Type.Literal('setup-smoke'),
  status: Type.Union([Type.Literal('completed'), Type.Literal('failed')]), qualified: Type.Literal(false),
  reviewCycles: Type.Integer({ minimum: 1, maximum: 100 }),
  samples: Type.Array(sampleSchema), frameIntervalsMs: Type.Array(Type.Number({ minimum: 0 })),
  checks: Type.Array(Type.String()), limitations: Type.Array(Type.String()),
  error: Type.Union([Type.Null(), Type.String()]),
  environment: Type.Object({ userAgent: Type.String(), hardwareConcurrency: Type.Integer({ minimum: 1 }),
    renderer: Type.String(), viewport: Type.Tuple([Type.Integer(), Type.Integer()]), devicePixelRatio: Type.Number(),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type Result = Static<typeof ResultSchema>;
export type Sample = Result['samples'][number];
export type Candidate = Result['candidate'];

export function parseResult(input: unknown, expected?: { candidate: Candidate; reviewCycles: number }): Result {
  if (!Check(ResultSchema, input)) throw new Error('Invalid benchmark result');
  if (expected && (input.candidate !== expected.candidate || input.reviewCycles !== expected.reviewCycles)) throw new Error('Benchmark result does not match requested candidate/cycles');
  if (input.samples.some(sample => !Number.isFinite(sample.durationMs))
    || input.frameIntervalsMs.some(value => !Number.isFinite(value))) throw new Error('Non-finite measurements');
  if (input.status === 'completed') {
    const operations = { load: 1, select: 1, properties: 1, pick: 1, filter: 1, section: 1,
      proposal: input.reviewCycles, comparison: input.reviewCycles, 'comparison-exit': input.reviewCycles, discard: input.reviewCycles };
    const checks = { ...operations, 'renderer-readback': 1, 'accepted-immutable': input.reviewCycles * 4, 'stale-rejected': 1 };
    if (input.error !== null || !input.frameIntervalsMs.length
      || !Object.entries(checks).every(([name, count]) => input.checks.filter(check => check === name).length === count)
      || !Object.entries(operations).every(([name, count]) => input.samples.filter(sample => sample.operation === name).length === count)) {
      throw new Error('Completed result is missing scenario evidence or has inconsistent counts');
    }
  }
  if (input.status === 'failed' && !input.error) throw new Error('Failed result is missing the error');
  return input;
}

export function summarize(values: number[]): { count: number; median: number | null; p95: number | null; maximum: number | null } {
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid timing sample');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number | null => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  return { count: sorted.length, median: at(.5), p95: sorted.length >= 100 ? at(.95) : null, maximum: at(1) };
}
