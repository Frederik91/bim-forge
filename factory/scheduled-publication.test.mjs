import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from './coding.mjs';
import { POLICY, parseActivation, createScheduledPermit, assertScheduledPermit,
  readScheduledPermit } from './scheduled-publication.mjs';

const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const publicationSha256 = 'c'.repeat(64);
const bootId = '01234567-89ab-cdef-0123-456789abcdef';
const runId = 'fedcba98-7654-3210-fedc-ba9876543210';
const startedNs = '5000000000';
const deadlineNs = '1205000000000';
const clock = () => ({ now: new Date('2026-10-22T12:00:00.000Z'), bootId, monotonicNs: BigInt(startedNs) });
const approval = (changes = {}) => ({ version: 1, repository: 'Frederik91/bim-forge',
  scopeSha256: 'a'.repeat(64), deploymentSha256: 'b'.repeat(64),
  notBefore: '2026-10-22T00:00:00.000Z', expiresAt: '2026-10-23T00:00:00.000Z', dailyLimit: 3,
  ...changes });
const activation = (approvalSha256 = sha256(encode(approval()))) => ({ version: 1, approvalSha256, publicationPolicy: POLICY });
function fixture(changes = {}) {
  const approvalBytes = encode(approval());
  return { publicationSha256, approvalBytes, approvedSha256: sha256(approvalBytes),
    activationBytes: encode(activation()), runId, bootId, startedNs, deadlineNs, ...changes };
}
const make = (input = fixture(), current = clock()) => createScheduledPermit(input, current);
const check = (bytes = make(), input = fixture(), current = clock()) =>
  assertScheduledPermit(bytes, input.publicationSha256, input.activationBytes, current);
const mutate = (changes) => encode({ ...JSON.parse(make()), ...changes });

test('activation has exactly three frozen fields; null means enabled and idle', () => {
  assert.equal(POLICY, 'profile-additions-draft-v1');
  for (const value of [activation(), activation(null)]) {
    const bytes = encode(value);
    const result = parseActivation(bytes);
    assert.deepEqual(result, value);
    assert.equal(Object.isFrozen(result), true);
    assert.throws(() => { result.approvalSha256 = null; }, TypeError);
    assert.deepEqual(bytes, encode(value));
  }
});

test('activation rejects missing, extra, mistyped and unknown policy fields', () => {
  for (const key of Object.keys(activation())) {
    const value = activation(); delete value[key];
    assert.throws(() => parseActivation(encode(value)), /fields/);
  }
  for (const value of [null, [], 1, true, 'activation', {}, { ...activation(), command: 'run' },
    { ...activation(), version: '1' }, { ...activation(), version: 2 },
    { ...activation(), publicationPolicy: 'unknown' }, { ...activation(), publicationPolicy: null }]) {
    assert.throws(() => parseActivation(encode(value)), /fields|policy/);
  }
  for (const approvalSha256 of ['', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65),
    `${'a'.repeat(64)}\n`, 1, true, [], {}]) {
    assert.throws(() => parseActivation(encode(activation(approvalSha256))), /fields/);
  }
});

test('activation and permit require bounded Buffers and exact compact JSON plus one newline', () => {
  for (const [bytes, parse, maximum] of [
    [encode(activation()), parseActivation, 4096],
    [make(), (bytes) => assertScheduledPermit(bytes, publicationSha256, fixture().activationBytes, clock()), 32768],
  ]) {
    for (const input of [undefined, null, bytes.toString(), new Uint8Array(bytes), {}]) {
      assert.throws(() => parse(input), /Buffer/);
    }
    for (const size of [maximum, maximum + 1]) {
      assert.throws(() => parse(Buffer.concat([bytes, Buffer.alloc(size - bytes.length, 32)])),
        size > maximum ? /bounded/ : /canonical/);
    }
    const json = bytes.toString().trimEnd();
    for (const input of [json, `${json}\r\n`, `${json}\n\n`, ` ${json}\n`, `${json} \n`,
      `${JSON.stringify(JSON.parse(json), null, 2)}\n`, `\ufeff${json}\n`,
      `${json.replace('"version":1', '"version":1.0')}\n`,
      `${json.replace('"version"', '"\\u0076ersion"')}\n`,
      `{"version":1,${json.slice(1)}\n`, `{"version":2,${json.slice(1)}\n`,
      `{"\\u0076ersion":1,${json.slice(1)}\n`]) {
      assert.throws(() => parse(Buffer.from(input)), /canonical/);
    }
    for (const input of ['', '{', '{}\n{}\n', '{"version":1,}\n']) {
      assert.throws(() => parse(Buffer.from(input)), /JSON/);
    }
    for (const invalid of [[255], [195], [192, 175], [237, 160, 128], [226, 130]]) {
      assert.throws(() => parse(Buffer.concat([bytes, Buffer.from(invalid)])), /UTF-8/);
    }
  }
});

test('permit is canonical, binds exact approval and activation bytes, and returns frozen values', () => {
  const input = fixture();
  const bytes = make(input);
  const { permit, approval: parsed } = check(bytes);
  assert.deepEqual(Object.keys(permit), ['version', 'publicationSha256', 'approvalSha256', 'approvalJson',
    'activationSha256', 'runId', 'bootId', 'startedNs', 'deadlineNs']);
  assert.deepEqual(permit, { version: 1, publicationSha256, approvalSha256: input.approvedSha256,
    approvalJson: input.approvalBytes.toString('utf8'), activationSha256: sha256(input.activationBytes),
    runId, bootId, startedNs, deadlineNs });
  assert.deepEqual(parsed, approval());
  assert.equal(Object.isFrozen(permit), true);
  assert.equal(Object.isFrozen(parsed), true);
  assert.deepEqual(bytes, encode(permit));
});

test('permit rejects all missing or extra fields and invalid shapes', () => {
  for (const key of Object.keys(JSON.parse(make()))) {
    const value = JSON.parse(make()); delete value[key];
    assert.throws(() => check(encode(value)), /fields/);
  }
  for (const value of [null, [], true, 1, 'permit', {}, { ...JSON.parse(make()), retry: true }]) {
    assert.throws(() => check(encode(value)), /fields/);
  }
  for (const changes of [{ version: 2 }, { version: '1' }, { approvalJson: null }, { approvalJson: {} }]) {
    assert.throws(() => check(mutate(changes)), /fields/);
  }
});

test('all digests require lowercase hexadecimal strings and wrong package never authorizes', () => {
  for (const key of ['publicationSha256', 'approvalSha256', 'activationSha256']) {
    for (const value of [null, 1, [], {}, '', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63),
      'a'.repeat(65), `${'a'.repeat(64)}\n`]) {
      assert.throws(() => check(mutate({ [key]: value })), /fields/);
    }
    assert.throws(() => check(mutate({ [key]: 'd'.repeat(64) })), /binding/);
  }
  for (const digest of [null, {}, ['c'.repeat(64)], 'C'.repeat(64), '../package', 'd'.repeat(64)]) {
    assert.throws(() => check(make(), fixture({ publicationSha256: digest })), /fields|binding/);
  }
  assert.throws(() => make(fixture({ approvedSha256: 'd'.repeat(64) })), /digest/);
  assert.throws(() => check(mutate({ approvalJson: encode(approval({ dailyLimit: 1 })).toString() })), /binding/);
});

test('activation revocation, replacement, unknown policy and absence block publication', () => {
  for (const bytes of [undefined, Buffer.alloc(0), encode(activation(null)),
    encode(activation('d'.repeat(64))), encode({ ...activation(), publicationPolicy: 'unknown' })]) {
    assert.throws(() => check(make(), fixture({ activationBytes: bytes })));
    assert.throws(() => make(fixture({ activationBytes: bytes })));
  }
  // Even rebinding the activation hash cannot override the pointer's chosen approval.
  const activationBytes = encode(activation('d'.repeat(64)));
  assert.throws(() => check(mutate({ activationSha256: sha256(activationBytes) }), fixture({ activationBytes })), /binding/);
  const reordered = fixture({ activationBytes: encode({ publicationPolicy: POLICY,
    approvalSha256: activation().approvalSha256, version: 1 }) });
  assert.throws(() => check(make(), reordered), /binding/);
  assert.doesNotThrow(() => check(make(reordered), reordered));
});

test('run and boot identifiers must be strict lowercase hyphenated UUID hex', () => {
  for (const key of ['runId', 'bootId']) {
    for (const value of [null, {}, [], 123, '', '-'.repeat(36), 'a'.repeat(36), bootId.toUpperCase(),
      bootId.replace('-', ''), `${bootId}\n`, ` ${bootId}`, bootId.replace('a', 'g')]) {
      assert.throws(() => check(mutate({ [key]: value })), /fields/);
      assert.throws(() => make(fixture({ [key]: value })), /fields/);
    }
  }
});

test('nanoseconds are canonical decimal strings of at most 24 digits', () => {
  for (const key of ['startedNs', 'deadlineNs']) {
    for (const value of [null, {}, [], 0, -1, '', '-1', '+1', '01', '1.0', '1e3', ' 1', '1\n', '9'.repeat(25)]) {
      assert.throws(() => check(mutate({ [key]: value })), /fields/);
      assert.throws(() => make(fixture({ [key]: value })), /fields/);
    }
  }
  const start = 999999999990000000000000n;
  const input = fixture({ startedNs: String(start), deadlineNs: String(start + 1200000000000n) });
  assert.doesNotThrow(() => check(make(input, { ...clock(), monotonicNs: start }), input,
    { ...clock(), monotonicNs: start }));
  assert.doesNotThrow(() => make(fixture({ startedNs: '0', deadlineNs: '1200000000000' }),
    { ...clock(), monotonicNs: 0n }));
});

test('same-boot 20-minute lifetime has inclusive start and exclusive deadline and rejects rollback', () => {
  const bytes = make();
  for (const monotonicNs of [BigInt(startedNs), BigInt(deadlineNs) - 1n]) {
    assert.doesNotThrow(() => check(bytes, fixture(), { ...clock(), monotonicNs }));
  }
  for (const monotonicNs of [BigInt(startedNs) - 1n, BigInt(deadlineNs), BigInt(deadlineNs) + 1n]) {
    const current = { ...clock(), monotonicNs };
    assert.throws(() => check(bytes, fixture(), current), /deadline/);
    assert.throws(() => make(fixture(), current), /deadline/);
  }
  for (const end of [BigInt(deadlineNs) - 1n, BigInt(deadlineNs) + 1n, BigInt(startedNs), 0n]) {
    assert.throws(() => check(mutate({ deadlineNs: String(end) })), /deadline/);
  }
  assert.throws(() => check(bytes, fixture(), { ...clock(), bootId: runId }), /boot/);
  assert.throws(() => make(fixture(), { ...clock(), bootId: runId }), /boot/);
});

test('embedded approval still uses the unchanged seven-field parser and current wall clock', () => {
  for (const changes of [{ repository: 'Frederik91/other' }, { version: 2 }, { command: 'run' },
    { dailyLimit: 0 }, { scopeSha256: 'wrong' }, { deploymentSha256: null },
    { notBefore: '2026-10-22T13:00:00.000Z' }, { expiresAt: '2026-10-22T12:00:00.000Z' }]) {
    const approvalBytes = encode(approval(changes));
    const approvedSha256 = sha256(approvalBytes);
    const activationBytes = encode(activation(approvedSha256));
    const input = fixture({ approvalBytes, approvedSha256, activationBytes });
    assert.throws(() => make(input));
    assert.throws(() => check(mutate({ approvalJson: approvalBytes.toString(), approvalSha256: approvedSha256,
      activationSha256: sha256(activationBytes) }), input));
  }
  for (const now of [new Date('2026-10-21T23:59:59.999Z'), new Date('2026-10-23T00:00:00.000Z')]) {
    assert.throws(() => check(make(), fixture(), { ...clock(), now }), /time window/);
  }
  const json = JSON.stringify(approval());
  for (const approvalBytes of [Buffer.from(json), Buffer.from(`{"version":1,${json.slice(1)}\n`),
    Buffer.concat([encode(approval()), Buffer.from([255])])]) {
    const approvedSha256 = sha256(approvalBytes);
    const activationBytes = encode(activation(approvedSha256));
    assert.throws(() => make(fixture({ approvalBytes, approvedSha256, activationBytes })));
  }
});

test('invalid clocks always fail with a generic error without disclosing supplied values', () => {
  const secret = 'private-clock-value';
  const hostile = { get now() { throw new Error(secret); } };
  for (const current of [null, {}, secret, hostile, { ...clock(), now: new Date(NaN) },
    { ...clock(), now: secret }, { ...clock(), bootId: secret }, { ...clock(), monotonicNs: secret },
    { ...clock(), monotonicNs: 1 }, { ...clock(), monotonicNs: -1n }]) {
    for (const invoke of [() => check(make(), fixture(), current), () => make(fixture(), current)]) {
      assert.throws(invoke, (error) => error.message === 'Invalid scheduled publication clock'
        && !error.message.includes(secret));
    }
  }
});

const linux = { skip: process.platform !== 'linux' };
function store(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduled-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.chmodSync(root, 0o700);
  const scheduled = path.join(root, 'scheduled');
  fs.mkdirSync(scheduled, { mode: 0o755 });
  const pointer = path.join(root, 'SCHEDULED');
  const permit = path.join(scheduled, `${publicationSha256}.permit.json`);
  fs.writeFileSync(pointer, fixture().activationBytes, { mode: 0o644 });
  fs.writeFileSync(permit, make(), { mode: 0o644 });
  const options = { approvalsDir: root, ownerUid: process.getuid(), codingPausePath: path.join(root, 'coding-PAUSED'), clock: clock() };
  return { root, scheduled, pointer, permit, options, read: () => readScheduledPermit(publicationSha256, options) };
}

test('protected read accepts administrator-owned app-readable files without filesystem writes', linux, (t) => {
  const value = store(t);
  const before = [value.root, value.scheduled, value.pointer, value.permit].map((file) => fs.statSync(file));
  assert.deepEqual(value.read(), check());
  const after = [value.root, value.scheduled, value.pointer, value.permit].map((file) => fs.statSync(file));
  for (let i = 0; i < before.length; i += 1) {
    assert.equal(after[i].mtimeMs, before[i].mtimeMs);
    assert.equal(after[i].size, before[i].size);
  }
  assert.deepEqual(fs.readdirSync(value.root).sort(), ['SCHEDULED', 'scheduled']);
  assert.deepEqual(fs.readdirSync(value.scheduled), [`${publicationSha256}.permit.json`]);
});

test('protected read rejects absent permits or activation without falling back to manual files', linux, (t) => {
  for (const key of ['pointer', 'permit']) {
    const value = store(t);
    fs.writeFileSync(path.join(value.root, `${publicationSha256}.json`), make(), { mode: 0o600 });
    fs.unlinkSync(value[key]);
    assert.throws(value.read, /ENOENT/);
  }
  const value = store(t);
  fs.writeFileSync(value.pointer, encode(activation(null)));
  assert.throws(value.read, /No active/);
  fs.writeFileSync(value.pointer, encode(activation('d'.repeat(64))));
  assert.throws(value.read, /binding/);
  for (const digest of ['../escape', 'A'.repeat(64), null, ['c'.repeat(64)]]) {
    assert.throws(() => readScheduledPermit(digest, value.options), /digest/);
  }
});

test('both directories must be real protected directories owned by the selected administrator', linux, (t) => {
  for (const key of ['root', 'scheduled']) {
    for (const mode of [0o775, 0o757, 0o777]) {
      const value = store(t); fs.chmodSync(value[key], mode);
      assert.throws(value.read, /directory/);
    }
    const value = store(t);
    const target = `${value[key]}-real`;
    fs.renameSync(value[key], target);
    if (key === 'root') t.after(() => fs.rmSync(target, { recursive: true, force: true }));
    fs.symlinkSync(target, value[key]);
    assert.throws(value.read, /directory/);
    fs.unlinkSync(value[key]);
    fs.writeFileSync(value[key], 'not a directory', { mode: 0o600 });
    assert.throws(value.read, /directory/);
  }
  const value = store(t);
  assert.throws(() => readScheduledPermit(publicationSha256, { ...value.options, ownerUid: process.getuid() + 1 }), /directory/);
});

test('both protected files reject writable modes, symlinks, hard links, directories and oversized bytes', linux, (t) => {
  for (const key of ['pointer', 'permit']) {
    for (const mode of [0o664, 0o646, 0o666]) {
      const value = store(t); fs.chmodSync(value[key], mode);
      assert.throws(value.read, /protected/);
    }
    for (const kind of ['symlink', 'hardlink', 'directory', 'oversized']) {
      const value = store(t);
      if (kind === 'symlink') {
        const target = `${value[key]}-real`; fs.renameSync(value[key], target); fs.symlinkSync(target, value[key]);
      } else if (kind === 'hardlink') {
        fs.linkSync(value[key], `${value[key]}-link`);
      } else if (kind === 'directory') {
        fs.unlinkSync(value[key]); fs.mkdirSync(value[key], { mode: 0o700 });
      } else {
        fs.writeFileSync(value[key], Buffer.alloc((key === 'pointer' ? 4096 : 32768) + 1));
      }
      assert.throws(value.read, /ELOOP|protected/);
    }
  }
});

test('both protected files independently reject a different owner', { skip: process.platform !== 'linux' || process.getuid() !== 0 }, (t) => {
  for (const key of ['pointer', 'permit', 'scheduled']) {
    const value = store(t);
    fs.chownSync(value[key], 1, 1);
    assert.throws(value.read, /protected|directory/);
  }
});

test('pause checks detect files, directories and dangling symlinks at either pause path', linux, (t) => {
  for (const which of ['coding', 'approvals']) {
    for (const kind of ['file', 'directory', 'symlink']) {
      const value = store(t);
      const pause = which === 'coding' ? value.options.codingPausePath : path.join(value.root, 'PAUSED');
      if (kind === 'file') fs.writeFileSync(pause, '');
      if (kind === 'directory') fs.mkdirSync(pause);
      if (kind === 'symlink') fs.symlinkSync(path.join(value.root, 'absent'), pause);
      assert.throws(value.read, /paused/);
    }
  }
});

test('protected reads recheck pause paths after permit validation and propagate inspection errors', linux, (t) => {
  for (const which of ['coding', 'approvals']) {
    const value = store(t);
    const pause = which === 'coding' ? value.options.codingPausePath : path.join(value.root, 'PAUSED');
    value.options.clock = { ...clock(), get now() {
      fs.writeFileSync(pause, '');
      return clock().now;
    } };
    assert.throws(value.read, /paused/);
  }
  const value = store(t);
  value.options.codingPausePath = path.join(value.pointer, 'PAUSED');
  assert.throws(value.read, /ENOTDIR/);
});
