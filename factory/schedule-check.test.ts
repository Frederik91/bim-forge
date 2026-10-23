import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSchedule } from './schedule-check.ts';

const cliPath = fileURLToPath(new URL('./schedule-check.ts', import.meta.url));
const ERROR = 'Invalid schedule snapshot';
const ready = {
  enabled: true,
  paused: false,
  scopeApproved: true,
  activeRun: false,
  attemptsToday: 0,
  dailyLimit: 1,
};

function cli(input: string | Buffer) {
  const result = spawnSync(process.execPath, [cliPath], {
    input,
    encoding: 'utf8',
    env: {},
    timeout: 10000,
    maxBuffer: 16384,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

function rejectCli(input: string | Buffer) {
  const result = cli(input);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${ERROR}\n`);
}

function rejectApi(snapshot: unknown) {
  assert.throws(() => checkSchedule(snapshot), (error) => {
    assert.equal(error instanceof Error ? error.message : undefined, ERROR);
    return true;
  });
}

// All combinations of the four boolean gates and an exhausted budget.
for (let bits = 0; bits < 32; bits += 1) {
  const enabled = Boolean(bits & 1);
  const paused = Boolean(bits & 2);
  const scopeApproved = Boolean(bits & 4);
  const activeRun = Boolean(bits & 8);
  const exhausted = Boolean(bits & 16);
  const snapshot = {
    enabled, paused, scopeApproved, activeRun,
    attemptsToday: exhausted ? 1 : 0,
    dailyLimit: 1,
  };
  let reason = 'ready';
  if (!enabled) reason = 'disabled';
  else if (paused) reason = 'paused';
  else if (!scopeApproved) reason = 'scope-not-approved';
  else if (activeRun) reason = 'busy';
  else if (exhausted) reason = 'daily-limit';
  const expected = { eligible: reason === 'ready', reason };
  test(`gate combination ${bits}: API and CLI agree`, () => {
    assert.deepEqual(checkSchedule(snapshot), expected);
    assert.deepEqual(Object.keys(checkSchedule(snapshot)), ['eligible', 'reason']);
    const result = cli(JSON.stringify(snapshot));
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `${JSON.stringify(expected)}\n`);
  });
}

test('integer boundaries and all daily limits', () => {
  for (const dailyLimit of [1, 2, 3]) {
    for (const attemptsToday of [0, dailyLimit - 1, dailyLimit, 1000]) {
      const snapshot = { ...ready, attemptsToday, dailyLimit };
      const expected = attemptsToday < dailyLimit
        ? { eligible: true, reason: 'ready' }
        : { eligible: false, reason: 'daily-limit' };
      assert.deepEqual(checkSchedule(snapshot), expected);
      const result = cli(JSON.stringify(snapshot));
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, `${JSON.stringify(expected)}\n`);
    }
  }
});

test('reject invalid top-level values', () => {
  for (const value of [null, [], true, false, 0, 'snapshot']) {
    rejectApi(value);
    rejectCli(JSON.stringify(value));
  }
  for (const value of [undefined, () => {}, Symbol('snapshot')]) rejectApi(value);
});

test('reject missing fields and extra metadata before reporting readiness', () => {
  for (const key of Object.keys(ready)) {
    const snapshot: Record<string, unknown> = { ...ready };
    delete snapshot[key];
    rejectApi(snapshot);
    rejectCli(JSON.stringify(snapshot));
  }
  for (const key of ['metadata', 'reason', 'eligible', '__proto__', 'constructor']) {
    const snapshot = { ...ready, enabled: false, [key]: 'private-value' };
    rejectApi(snapshot);
    rejectCli(JSON.stringify(snapshot));
  }
  const symbolMetadata = { ...ready, [Symbol('metadata')]: true };
  rejectApi(symbolMetadata);
  const hiddenMetadata = { ...ready };
  Object.defineProperty(hiddenMetadata, 'metadata', { value: true });
  rejectApi(hiddenMetadata);
});

test('reject invalid boolean types for every boolean field', () => {
  for (const key of ['enabled', 'paused', 'scopeApproved', 'activeRun']) {
    for (const value of [null, 0, 1, 'true', 'false', [], {}]) {
      const snapshot = { ...ready, [key]: value };
      rejectApi(snapshot);
      rejectCli(JSON.stringify(snapshot));
    }
    rejectApi({ ...ready, [key]: undefined });
  }
});

test('reject invalid integer types and ranges', () => {
  const cases = {
    attemptsToday: [-1, 1001, 0.5, Number.MAX_SAFE_INTEGER + 1],
    dailyLimit: [-1, 0, 4, 1.5, Number.MAX_SAFE_INTEGER + 1],
  };
  for (const [key, ranges] of Object.entries(cases)) {
    for (const value of [...ranges, null, true, '1', [], {}]) {
      const snapshot = { ...ready, enabled: false, [key]: value };
      rejectApi(snapshot);
      rejectCli(JSON.stringify(snapshot));
    }
    for (const value of [undefined, NaN, Infinity, -Infinity, 1n]) {
      rejectApi({ ...ready, [key]: value });
    }
  }
});

test('API requires own data fields and does not invoke accessors', () => {
  rejectApi(Object.create(ready));
  const snapshot = { ...ready };
  Object.defineProperty(snapshot, 'enabled', {
    get() { throw new Error('private accessor detail'); },
  });
  rejectApi(snapshot);
  rejectApi(new Proxy({}, {
    ownKeys() { throw new Error('private proxy detail'); },
  }));
});

test('API preserves frozen input and returns independent reports', () => {
  const snapshot = Object.freeze({ ...ready });
  const first = checkSchedule(snapshot);
  Reflect.set(first, 'reason', 'changed');
  assert.deepEqual(checkSchedule(snapshot), { eligible: true, reason: 'ready' });
  assert.deepEqual(snapshot, ready);
});

test('CLI rejects malformed JSON and multiple input objects', () => {
  for (const input of [
    '', ' ', '{', 'undefined', '{"enabled":true,}',
    `${JSON.stringify(ready)}\n${JSON.stringify(ready)}`,
    `${JSON.stringify(ready)} trailing`,
  ]) rejectCli(input);
});

test('CLI accepts surrounding JSON whitespace', () => {
  const result = cli(` \t\r\n${JSON.stringify(ready)}\n`);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, '{"eligible":true,"reason":"ready"}\n');
});

test('CLI byte limit includes whitespace and accepts exactly 4096 bytes', () => {
  const json = JSON.stringify(ready);
  for (const bytes of [4095, 4096]) {
    const input = json + ' '.repeat(bytes - Buffer.byteLength(json));
    assert.equal(Buffer.byteLength(input), bytes);
    const result = cli(input);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '{"eligible":true,"reason":"ready"}\n');
  }
  rejectCli(json + ' '.repeat(4097 - Buffer.byteLength(json)));
  rejectCli(' '.repeat(8192));
});

test('CLI rejects invalid UTF-8 rather than replacing bytes', () => {
  const json = JSON.stringify(ready);
  for (const bytes of [[0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) {
    rejectCli(Buffer.concat([
      Buffer.from(json.slice(0, -1) + ',"'),
      Buffer.from(bytes),
      Buffer.from('\":true}'),
    ]));
  }
  rejectCli(Buffer.concat([Buffer.from(json), Buffer.from([0xff])]));
});

test('CLI rejects Unicode metadata and counts encoded input bytes', () => {
  const input = JSON.stringify({ ...ready, metadata: 'é'.repeat(2100) });
  assert.ok(input.length < 4096);
  assert.ok(Buffer.byteLength(input) > 4096);
  rejectCli(input);
  rejectCli(JSON.stringify({ ...ready, 'é': true }));
});
