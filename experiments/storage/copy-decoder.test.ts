import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCopyCell } from './w4.ts';

test('COPY literal spans and every supported escape preserve exact decoded values', () => {
  const cases: [string, string | null][] = [['', ''], ['literal æøå😀', 'literal æøå😀'], ['\\N', null],
    ['\\\\N', '\\N'], ['x\\ty\\nz\\r', 'x\ty\nz\r'], ['\\b\\f\\v', '\b\f\v'],
    ['left\\\\right\\\\', 'left\\right\\'], ['a'.repeat(50000), 'a'.repeat(50000)]];
  for (const [source, expected] of cases) assert.equal(decodeCopyCell(source), expected);
  for (const invalid of ['\\', 'end\\', '\\q', '\\0', '\\Nx']) assert.throws(() => decodeCopyCell(invalid), /COPY escape/);
});
