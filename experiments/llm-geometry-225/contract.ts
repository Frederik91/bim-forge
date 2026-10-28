import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import fs from 'node:fs';
import type { Pin, V3 } from './fixtures.ts';

// Executable pilot output contract; the production API sketch is in the research note.
const vector = Type.Tuple([Type.Number(),Type.Number(),Type.Number()]);
const pin = Type.Object({ namespace: Type.String(), revision: Type.String(), sha256: Type.String(), occurrence: Type.String(), object: Type.String() }, { additionalProperties: false });
export const AnswerSchema = Type.Union([
  Type.Object({ kind: Type.Literal('abstain'), reason: Type.Union([Type.Literal('missing'),Type.Literal('stale'),Type.Literal('insufficient'),Type.Literal('no-fit')]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('proposal'), center: vector, yawDegrees: Type.Number(), side: Type.Union([Type.Literal(1),Type.Literal(-1)]), target: Type.String(), wall: pin,
    support: Type.String(), level: Type.String(), room: Type.String(), adjacent: Type.String(), nearest: Type.String() }, { additionalProperties: false }),
]);
export type Answer = Static<typeof AnswerSchema>;
export function parseAnswer(value: unknown): Answer { if (!Check(AnswerSchema, value)) throw new Error('Invalid pilot answer'); return value; }
export type Candidate = { center: V3; yawDegrees: number; side: 1 | -1; wall: Pin };
export type Failure = 'missing' | 'stale' | 'invalid-id' | 'limit' | 'unsupported';
export type ReadResult<T> = { kind: 'ok'; value: T; complete: boolean; toleranceMetres: number } | { kind: 'unavailable'; reason: Failure };
const TrialsSchema = Type.Object({ trials: Type.Array(Type.Object({arm:Type.String(),scene:Type.String(),answer:AnswerSchema},{additionalProperties:false})) });
if(process.argv[2]==='--check-trials') {
  const filename=process.argv[3]; if(!filename) throw new Error('trial receipt required');
  const value:unknown=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!Check(TrialsSchema,value)) throw new Error('Invalid external LLM trial contract');
  console.log(`Validated ${value.trials.length} external LLM answers.`);
}
