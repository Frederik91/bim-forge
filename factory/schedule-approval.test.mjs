import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseScheduleApproval } from './schedule-approval.mjs';

const start = '2026-10-22T00:00:00.000Z';
const end = '2026-10-23T00:00:00.000Z';
const fixture = (changes = {}) => ({
  version: 1,
  repository: 'Frederik91/bim-forge',
  scopeSha256: 'a'.repeat(64),
  deploymentSha256: 'b'.repeat(64),
  notBefore: start,
  expiresAt: end,
  dailyLimit: 3,
  ...changes,
});
const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const parse = (value, now = new Date(start)) => {
  const bytes = encode(value);
  return parseScheduleApproval(bytes, digest(bytes), now);
};
const rejectBytes = (bytes, error) => assert.throws(
  () => parseScheduleApproval(bytes, digest(bytes), new Date(start)), error,
);

test('returns exactly the validated approval and freezes it without changing inputs', () => {
  const value = fixture();
  const bytes = encode(value);
  const original = Buffer.from(bytes);
  const now = new Date(start);
  const result = parseScheduleApproval(bytes, digest(bytes), now);
  assert.deepEqual(result, value);
  assert.notEqual(result, value);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.dailyLimit = 1; }, TypeError);
  assert.throws(() => { result.command = 'run'; }, TypeError);
  assert.deepEqual(bytes, original);
  assert.equal(now.toISOString(), start);
});

test('accepts every allowed daily limit and lowercase hexadecimal digest characters', () => {
  for (const dailyLimit of [1, 2, 3, 4, 5, 6]) {
    const value = fixture({ dailyLimit, scopeSha256: '0123456789abcdef'.repeat(4), deploymentSha256: '0'.repeat(64) });
    assert.deepEqual(parse(value), value);
  }
});

test('not-before is inclusive, expiry is exclusive, and a 24-hour window is allowed', () => {
  assert.deepEqual(parse(fixture(), new Date(start)), fixture());
  assert.deepEqual(parse(fixture(), new Date(Date.parse(end) - 1)), fixture());
  for (const time of [Date.parse(start) - 1, Date.parse(end), Date.parse(end) + 1]) {
    assert.throws(() => parse(fixture(), new Date(time)), /time window/);
  }
  const value = fixture({ expiresAt: '2026-10-22T00:00:00.001Z' });
  assert.deepEqual(parse(value), value);
  assert.throws(() => parse(value, new Date(value.expiresAt)), /time window/);
});

test('rejects zero, reversed, and over-24-hour windows', () => {
  for (const changes of [
    { expiresAt: start },
    { expiresAt: '2026-10-21T23:59:59.999Z' },
    { expiresAt: '2026-10-23T00:00:00.001Z' },
  ]) assert.throws(() => parse(fixture(changes)), /time window/);
});

test('binds approval to exact bytes and requires a lowercase 64-hex trusted digest', () => {
  const bytes = encode(fixture());
  const trusted = digest(bytes);
  const corrupt = `${trusted[0] === '0' ? '1' : '0'}${trusted.slice(1)}`;
  for (const supplied of [corrupt, trusted.toUpperCase(), 'g'.repeat(64), 'a'.repeat(63),
    'a'.repeat(65), `${trusted}\n`, '', null, undefined, 123, {}, [trusted]]) {
    assert.throws(() => parseScheduleApproval(bytes, supplied, new Date(start)), /digest/);
  }
  for (const changes of [
    { dailyLimit: 1 }, { scopeSha256: 'c'.repeat(64) }, { deploymentSha256: 'd'.repeat(64) },
    { notBefore: '2026-10-21T23:59:59.999Z' }, { expiresAt: '2026-10-22T23:59:59.999Z' },
  ]) {
    assert.throws(() => parseScheduleApproval(encode(fixture(changes)), trusted, new Date(start)), /digest/);
  }
});

test('requires a bounded Buffer and rejects oversized input before parsing', () => {
  for (const bytes of [null, undefined, '', '{}\n', {}, [], new Uint8Array(encode(fixture()))]) {
    assert.throws(() => parseScheduleApproval(bytes, 'a'.repeat(64), new Date(start)), /Buffer/);
  }
  const base = encode(fixture());
  for (const size of [16 * 1024, 16 * 1024 + 1]) {
    const bytes = Buffer.concat([base, Buffer.alloc(size - base.length, 0x20)]);
    rejectBytes(bytes, size === 16 * 1024 ? /canonical/ : /16 KiB/);
  }
});

test('uses fatal UTF-8 decoding for malformed, truncated, overlong, and surrogate sequences', () => {
  const bytes = encode(fixture());
  const offset = bytes.indexOf('Frederik91');
  for (const invalid of [[0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) {
    rejectBytes(Buffer.concat([bytes.subarray(0, offset), Buffer.from(invalid), bytes.subarray(offset + 1)]), TypeError);
  }
  rejectBytes(Buffer.concat([bytes, Buffer.from([0xe2, 0x82])]), TypeError);
});

test('rejects noncanonical encodings even with a matching exact-byte digest', () => {
  const value = fixture();
  const compact = JSON.stringify(value);
  for (const text of [
    compact, `${compact}\r\n`, `${compact}\n\n`, ` ${compact}\n`, `${compact} \n`,
    `${JSON.stringify(value, null, 2)}\n`,
    `${compact.replace('"version":1', '"version":1.0')}\n`,
    `${compact.replace('"dailyLimit":3', '"dailyLimit":3e0')}\n`,
    `${compact.replace('Frederik91', '\\u0046rederik91')}\n`,
    `${compact.replace('"version"', '"\\u0076ersion"')}\n`,
    `\ufeff${compact}\n`,
  ]) rejectBytes(Buffer.from(text), /canonical/);
});

test('rejects duplicate fields including identical values and escaped field names', () => {
  const compact = JSON.stringify(fixture());
  for (const prefix of ['"version":1,', '"version":2,', '"dailyLimit":1,', '"\\u0076ersion":1,']) {
    rejectBytes(Buffer.from(`{${prefix}${compact.slice(1)}\n`), /canonical/);
  }
});

test('rejects malformed JSON and non-object JSON values', () => {
  for (const text of ['', '{', '{"version":1,}\n', '{}\n{}\n']) rejectBytes(Buffer.from(text), SyntaxError);
  for (const value of [null, true, false, 1, 'approval', [], [fixture()]]) {
    assert.throws(() => parse(value), /fields/);
  }
});

test('requires all seven keys and forbids every additional control field', () => {
  for (const key of Object.keys(fixture())) {
    const value = fixture();
    delete value[key];
    assert.throws(() => parse(value), /fields/, key);
  }
  for (const key of ['command', 'commands', 'path', 'paths', 'model', 'api', 'credentials',
    'issue', 'merge', 'retry', 'constructor', '__proto__']) {
    assert.throws(() => parse({ ...fixture(), [key]: 'untrusted' }), /fields/, key);
  }
  const renamed = fixture();
  delete renamed.scopeSha256;
  assert.throws(() => parse({ ...renamed, scope: 'a'.repeat(64) }), /fields/);
});

test('requires version 1 and the exact fixed repository', () => {
  for (const version of [0, 2, '1', null, true, {}, []]) {
    assert.throws(() => parse(fixture({ version })), /fields/);
  }
  for (const repository of ['frederik91/bim-forge', 'Frederik91/other', 'Frederik91/bim-forge ',
    'https://github.com/Frederik91/bim-forge', null, 1, {}, []]) {
    assert.throws(() => parse(fixture({ repository })), /fields/);
  }
});

test('scope and deployment bindings must be primitive lowercase 64-hex strings', () => {
  for (const key of ['scopeSha256', 'deploymentSha256']) {
    for (const value of [null, 1, true, {}, [], ['a'.repeat(64)], '', 'a'.repeat(63), 'a'.repeat(65),
      'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}\n`, 'sha256:' + 'a'.repeat(64),
      'node factory/run.mjs', '../deployment', 'main']) {
      assert.throws(() => parse(fixture({ [key]: value })), /fields/, key);
    }
  }
});

test('daily limit must be a safe integer from 1 through 6', () => {
  for (const dailyLimit of [0, -1, 7, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1,
    '1', true, null, {}, [1]]) {
    assert.throws(() => parse(fixture({ dailyLimit })), /fields/);
  }
  for (const literal of ['NaN', 'Infinity', '1e309']) {
    const text = JSON.stringify(fixture()).replace('"dailyLimit":3', `"dailyLimit":${literal}`);
    rejectBytes(Buffer.from(`${text}\n`));
  }
});

test('timestamps require real calendar dates in canonical UTC with milliseconds', () => {
  for (const key of ['notBefore', 'expiresAt']) {
    for (const value of [null, 0, true, {}, [], [start], '', 'not-a-date',
      '2026-10-22', '2026-10-22T00:00:00Z', '2026-10-22T00:00:00.00Z',
      '2026-10-22T00:00:00.0000Z', '2026-10-22T00:00:00.000+00:00',
      '2026-10-22T01:00:00.000+01:00', '2026-10-22t00:00:00.000z',
      '2026-02-29T00:00:00.000Z', '2026-02-30T00:00:00.000Z',
      '2026-13-01T00:00:00.000Z', '2026-10-00T00:00:00.000Z',
      '2026-10-22T24:00:00.000Z', '2026-10-22T00:00:60.000Z',
      '+010000-10-22T00:00:00.000Z', `${start}\n`]) {
      assert.throws(() => parse(fixture({ [key]: value })), /time window/, `${key}: ${String(value)}`);
    }
  }
  const leapDay = fixture({ notBefore: '2028-02-29T00:00:00.000Z', expiresAt: '2028-03-01T00:00:00.000Z' });
  assert.deepEqual(parse(leapDay, new Date(leapDay.notBefore)), leapDay);
});

test('rejects invalid clocks and clocks outside the approved interval', () => {
  for (const now of [new Date(NaN), null, start, Date.parse(start), {}, [], true,
    new Date('2026-10-21T23:59:59.999Z'), new Date(end)]) {
    assert.throws(() => parse(fixture(), now), /time window/);
  }
});
