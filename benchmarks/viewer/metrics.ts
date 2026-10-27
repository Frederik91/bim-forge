import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

const sampleSchema = Type.Object({ operation: Type.String({ minLength: 1 }), durationMs: Type.Number({ minimum: 0 }),
  drawCalls: Type.Integer({ minimum: 0 }), triangles: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const ResultSchema = Type.Object({
  version: Type.Literal(1), candidate: Type.Union([Type.Literal('babylon'), Type.Literal('fragments')]),
  profile: Type.Literal('viewer-192-v1'), purpose: Type.Literal('setup-smoke'),
  status: Type.Union([Type.Literal('completed'), Type.Literal('failed')]), qualified: Type.Literal(false),
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

export function parseResult(input: unknown): Result {
  if (!Check(ResultSchema, input)) throw new Error('Invalid benchmark result');
  if (input.samples.some(sample => !Number.isFinite(sample.durationMs))
    || input.frameIntervalsMs.some(value => !Number.isFinite(value))) throw new Error('Non-finite measurements');
  if (input.status === 'completed' && (input.error !== null || !input.samples.length
    || !['load', 'proposal', 'comparison', 'discard', 'renderer-readback', 'pick', 'filter', 'section'].every(check => input.checks.includes(check))
    || !['load', 'proposal', 'comparison', 'discard', 'pick', 'filter', 'section'].every(operation => input.samples.some(sample => sample.operation === operation)))) {
    throw new Error('Completed result is missing scenario evidence');
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
