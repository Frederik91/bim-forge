import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarizeRunHealth } from './health.ts';
import type { RunHealthStatus } from './health.ts';

const statuses: RunHealthStatus[] = [
  'running', 'succeeded', 'needs-input', 'failed',
  'timed-out', 'cancelled', 'interrupted', 'blocked',
];
const command = fileURLToPath(new URL('./health.ts', import.meta.url));

function cli(input: string | Buffer) {
  const result = spawnSync(process.execPath, [command], {
    input,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function assertRejected(input: string | Buffer) {
  const result = cli(input);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Invalid run records\n');
}

test('empty arrays produce the exact ordered zero summary', () => {
  const result = summarizeRunHealth([]);
  assert.deepEqual(result, {
    total: 0,
    byStatus: Object.fromEntries(statuses.map((status) => [status, 0])),
    attentionRequired: false,
  });
  assert.deepEqual(Object.keys(result), ['total', 'byStatus', 'attentionRequired']);
  assert.deepEqual(Object.keys(result.byStatus), statuses);
});

test('mixed statuses count every run', () => {
  const runs = statuses.map((status) => ({ status }));
  runs.push({ status: 'succeeded' });
  assert.deepEqual(summarizeRunHealth(runs), {
    total: 9,
    byStatus: {
      running: 1,
      succeeded: 2,
      'needs-input': 1,
      failed: 1,
      'timed-out': 1,
      cancelled: 1,
      interrupted: 1,
      blocked: 1,
    },
    attentionRequired: true,
  });
});

test('each status independently determines attention', () => {
  for (const status of statuses) {
    assert.equal(
      summarizeRunHealth([{ status }]).attentionRequired,
      ['needs-input', 'failed', 'timed-out', 'interrupted', 'blocked'].includes(status),
      status,
    );
  }
});

test('sensitive-looking metadata is neither inspected nor reproduced', () => {
  const run = Object.freeze({
    status: 'succeeded',
    credentials: 'private-token',
    path: '/private/model.ifc',
    get secret() { throw new Error('Metadata must not be read'); },
  });
  assert.deepEqual(
    summarizeRunHealth(Object.freeze([run])),
    summarizeRunHealth([{ status: 'succeeded' }]),
  );
});

test('invalid collections, records, and statuses are rejected', () => {
  const invalid = [
    null, undefined, {}, '', 1, true,
    [null], [undefined], [[]], ['running'], [1], [false], [{}],
    [{ status: null }], [{ status: 1 }], [{ status: {} }],
    [{ status: 'unknown' }], [{ status: 'Running' }],
    [{ status: '__proto__' }], [{ status: 'toString' }],
    new Array(1),
    Array.from({ length: 1001 }, () => ({ status: 'running' })),
  ];
  for (const input of invalid) {
    assert.throws(() => summarizeRunHealth(input), {
      name: 'TypeError', message: 'Invalid run records',
    });
  }
});

test('1000 records are accepted', () => {
  const runs = Array.from({ length: 1000 }, () => ({ status: 'running' }));
  const result = summarizeRunHealth(runs);
  assert.equal(result.total, 1000);
  assert.equal(result.byStatus.running, 1000);
  assert.equal(result.attentionRequired, false);
});

test('CLI prints exactly one summary and omits metadata', () => {
  const input = [{ status: 'blocked', secret: 'private-token', model: '/private/model.ifc' }];
  const result = cli(JSON.stringify(input));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(summarizeRunHealth(input))}\n`);
  assert.equal(result.stdout.includes('private'), false);
});

test('CLI accepts an empty array', () => {
  const result = cli('[]');
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(summarizeRunHealth([]))}\n`);
});

test('CLI rejects malformed JSON and invalid records without leaking input', () => {
  for (const input of [
    '', '[', '[] []', '{"secret":"private-token"}',
    'null', '[null]', '[[]]', '[{}]', '[{"status":"unknown"}]',
    JSON.stringify(Array.from({ length: 1001 }, () => ({ status: 'running' }))),
  ]) {
    assertRejected(input);
  }
});

test('CLI enforces the 64 KiB byte boundary', () => {
  const exact = '[]' + ' '.repeat(65534);
  const result = cli(exact);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(summarizeRunHealth([]))}\n`);
  assertRejected(exact + ' ');
  assertRejected(' '.repeat(128 * 1024));
});

test('CLI counts UTF-8 bytes, including ignored metadata', () => {
  const input = JSON.stringify([{ status: 'running', secret: 'é'.repeat(33000) }]);
  assert.ok(input.length < 65536);
  assert.ok(Buffer.byteLength(input, 'utf8') > 65536);
  assertRejected(input);
});

test('CLI rejects invalid UTF-8', () => {
  assertRejected(Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]));
});
