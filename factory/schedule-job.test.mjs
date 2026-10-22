import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { dispatchOnce, assertVerifiedEvidence, assertRecordedUnit } from './schedule-job.mjs';
import { POLICY, assertScheduledPermit, guardScheduledRequest } from './scheduled-publication.mjs';
import { sha256, prepareCodingPackage } from './coding.mjs';
import { measureTree, assertEffectiveUnit } from './coding-identity.mjs';
import { openCodingRun } from './coding-store.mjs';
import { createCodingInput, exposeCodingCandidate, stageWithEvidence, collectVerifierEvidence, runUnit } from './code-job.mjs';
import { healthAcceptanceCases } from './code-acceptance.mjs';

const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const runId = '01234567-89ab-cdef-0123-456789abcdef';
const bootId = 'abcdef01-2345-6789-abcd-ef0123456789';
const paths = ['factory/health.mjs', 'factory/health.test.mjs'];
const spec = () => ({ version: 1, repository: 'Frederik91/bim-forge', baseSha: 'a'.repeat(40),
  issue: { number: 17, title: 'Run health', body: 'Summarize disposable runs only.', updated_at: '2026-10-21T00:00:00Z' },
  plan: { outcome: 'Summarize runs', changeClass: 'read-only', paths, steps: ['Implement the command'],
    acceptanceChecks: ['Fixed independent stdin cases'], reviewers: ['Frederik91'], questions: [] },
  paths, acceptanceCases: [healthAcceptanceCases[0]] });
const policy = JSON.parse(fs.readFileSync(new URL('../policy/gate.json', import.meta.url)));
const baselinePackage = JSON.stringify({ scripts: { test: 'node --test factory/baseline.test.mjs' } });
const unit = `bim-forge-code-generate@${runId}.service`;

function fixture() {
  const events = [];
  const scopeBytes = encode(spec());
  const approval = { version: 1, repository: 'Frederik91/bim-forge', scopeSha256: sha256(scopeBytes),
    deploymentSha256: 'b'.repeat(64), notBefore: '2026-10-22T00:00:00.000Z',
    expiresAt: '2026-10-23T00:00:00.000Z', dailyLimit: 1 };
  const approvalBytes = encode(approval); const approvedSha256 = sha256(approvalBytes);
  let active; let receipt;
  const state = { now: new Date('2026-10-22T12:00:00.000Z'), monotonicNs: 5n, bootId,
    activation: encode({ version: 1, approvalSha256: approvedSha256, publicationPolicy: POLICY }), paused: false,
    deployment: approval.deploymentSha256, absent: true, resources: true, active: false, validUnit: true };
  const io = {
    clock: () => ({ now: new Date(state.now), monotonicNs: state.monotonicNs, bootId: state.bootId }),
    activation: () => state.activation,
    assertNoActive() { if (state.active) throw new Error('busy or interrupted'); },
    receipt: () => receipt,
    approval: () => approvalBytes,
    scope: () => scopeBytes,
    measure: () => state.deployment,
    assertUnit() { if (!state.validUnit) throw new Error('instance override'); },
    assertUnpaused() { if (state.paused) throw new Error('paused'); },
    assertResources() { if (!state.resources) throw new Error('resources'); },
    pathsAbsent: () => state.absent,
    invocationId: () => 'a'.repeat(32),
    claim(value) { events.push('claim'); active = value; state.active = true; return active; },
    saveActive(value) { active = value; },
    recordUnit(value, name) { assertRecordedUnit(value, name); value.units.push(name); events.push('unit'); },
    async code(value, bytes, options) {
      events.push('admit');
      assert.deepEqual(value, spec()); assert.equal(sha256(bytes), approval.scopeSha256);
      assert.equal(options.schedule.approvedSha256, approvedSha256);
      try {
        await options.onAdmitted({ id: runId });
        await options.guard({ unit });
        events.push('model');
        const publication = await options.onVerified({ id: runId });
        return { id: runId, scheduledPublication: publication };
      } finally { await options.onCleanup?.(); events.push('lease-release'); }
    },
    verifiedPackage() { events.push('evidence'); return Buffer.from('exact verified package'); },
    stage(digest, bytes, permit) {
      events.push('stage'); assert.equal(sha256(bytes), digest);
      assert.equal(assertScheduledPermit(permit, digest, state.activation, io.clock()).permit.runId, runId);
    },
    async publish(digest, value, guard) {
      await guard({ unit: `bim-forge-scheduled-publish@${digest}.service` });
      events.push('publish'); return { status: 'published', digest, tokenRevoked: true };
    },
    cleanup() { events.push('cleanup'); },
    saveInterrupted(value) { events.push('interrupted'); active = value; },
    finish(value, result) { events.push('finish'); receipt = result; state.active = false; },
  };
  return { io, state, events, approval, approvalBytes, approvedSha256, getActive: () => active };
}

test('disabled, empty and existing profiles never claim, generate, stage or publish', async () => {
  for (const mode of ['disabled', 'empty', 'existing']) {
    const f = fixture();
    if (mode === 'disabled') f.state.activation = null;
    if (mode === 'empty') f.state.activation = encode({ version: 1, approvalSha256: null, publicationPolicy: POLICY });
    if (mode === 'existing') f.state.absent = false;
    const result = await dispatchOnce(f.io);
    assert.equal(result.status, mode === 'disabled' ? 'disabled' : 'idle');
    assert.deepEqual(f.events, []);
  }
});

test('one guarded wake publishes exact bytes while the same coding lease is held; duplicate returns receipt', async () => {
  const f = fixture(); const first = await dispatchOnce(f.io);
  assert.equal(first.status, 'published');
  assert.deepEqual(f.events, ['claim', 'admit', 'unit', 'model', 'evidence', 'stage', 'unit', 'publish', 'cleanup', 'lease-release', 'finish']);
  const count = f.events.length;
  assert.deepEqual(await dispatchOnce(f.io), { ...first, reused: true });
  assert.equal(f.events.length, count);
});

test('intake refuses invalid bindings, unavailable resources, pause, expiry and interrupted ownership without effects', async () => {
  const changes = [
    (f) => { f.state.active = true; }, (f) => { f.state.paused = true; },
    (f) => { f.state.resources = false; }, (f) => { f.state.deployment = 'c'.repeat(64); },
    (f) => { f.state.now = new Date('2026-10-23T00:00:00.000Z'); },
    (f) => { f.io.scope = () => Buffer.from('tampered'); },
    (f) => { f.io.approval = () => Buffer.from('{}\n'); },
    (f) => { f.state.activation = Buffer.from('{"version":1}\n'); },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    await assert.rejects(dispatchOnce(f.io)); assert.deepEqual(f.events, []);
  }
});

test('activation, deployment, pauses, expiry, reboot, clock rollback and original deadline stop mid-job and never retry', async () => {
  const changes = [
    (f) => { f.state.activation = null; }, (f) => { f.state.paused = true; },
    (f) => { f.state.deployment = 'd'.repeat(64); },
    (f) => { f.state.now = new Date('2026-10-23T00:00:00.000Z'); },
    (f) => { f.state.bootId = runId; },
    (f) => { f.state.now = new Date('2026-10-22T11:59:59.000Z'); },
    (f) => { f.state.monotonicNs += 1200000000000n; },
  ];
  for (const change of changes) {
    const f = fixture(); const code = f.io.code;
    f.io.code = (...args) => { change(f); return code(...args); };
    const result = await dispatchOnce(f.io);
    assert.equal(result.status, 'stopped'); assert.equal(f.events.includes('model'), false);
    assert.equal(f.events.includes('publish'), false);
    f.state.activation = encode({ version: 1, approvalSha256: f.approvedSha256, publicationPolicy: POLICY });
    const count = f.events.length;
    assert.equal((await dispatchOnce(f.io)).reused, true); assert.equal(f.events.length, count);
  }
});

test('unknown publication is terminal; later wake cannot retry even with unchanged approval', async () => {
  for (const publication of [{ status: 'published', tokenRevoked: false }, { status: 'stopped' }, null]) {
    const f = fixture(); f.io.publish = async () => publication;
    assert.equal((await dispatchOnce(f.io)).status, 'stopped');
    const count = f.events.length;
    assert.equal((await dispatchOnce(f.io)).reused, true); assert.equal(f.events.length, count);
  }
});

test('failed cleanup preserves active ownership and requires recovery, not another model call', async () => {
  const f = fixture(); f.io.cleanup = () => { throw new Error('group not empty'); };
  await assert.rejects(dispatchOnce(f.io), /recovery/);
  assert.equal(f.state.active, true); assert.equal(f.events.includes('finish'), false);
  await assert.rejects(dispatchOnce(f.io), /busy|interrupted/);
  const g = fixture(); g.io.code = async () => { throw Object.assign(new Error('cleanup'), { requiresRecovery: true }); };
  await assert.rejects(dispatchOnce(g.io), /cleanup/);
  assert.equal(g.events.includes('cleanup'), false); assert.equal(g.state.active, true);
});

test('a previously consumed coding scope is reported for manual reconciliation, never republished', async () => {
  const f = fixture(); f.io.code = async () => ({ reused: true, id: runId });
  assert.equal((await dispatchOnce(f.io)).status, 'recovery-required');
  assert.equal(f.events.includes('publish'), false);
});

test('cleanup accepts only exact recorded run services and case links', () => {
  const active = { runId, publicationSha256: 'b'.repeat(64) };
  for (const name of [unit, `bim-forge-code-verify@${runId}.service`, `bim-forge-scheduled-publish@${active.publicationSha256}.service`]) assert.doesNotThrow(() => assertRecordedUnit(active, name));
  const name = `bim-forge-code-case@${bootId}.service`;
  assert.doesNotThrow(() => assertRecordedUnit(active, name, () => `/var/lib/bim-forge-coding/jobs/${runId}/candidate`));
  for (const bad of ['ssh.service', 'bim-forge-code-case@*.service', `bim-forge-code-generate@${bootId}.service`, `bim-forge-publish@${active.publicationSha256}.service`, name]) {
    assert.throws(() => assertRecordedUnit(active, bad, () => '/unrelated'), /owned/);
  }
});

test('actual instance overrides stop before model start even when template measurement matches', async () => {
  const f = fixture(); f.state.validUnit = false;
  const result = await dispatchOnce(f.io);
  assert.equal(result.status, 'stopped'); assert.equal(f.events.includes('model'), false);
  const filename = '/etc/systemd/system/bim-forge-code-generate@.service';
  const state = { LoadState: 'loaded', FragmentPath: filename, DropInPaths: '', NeedDaemonReload: 'no' };
  assert.doesNotThrow(() => assertEffectiveUnit(state, filename));
  for (const change of [{ FragmentPath: '/etc/systemd/system/bim-forge-code-generate@real.service' },
    { DropInPaths: '/run/systemd/system/real.service.d/override.conf' }, { NeedDaemonReload: 'yes' }, { LoadState: 'not-found' }]) {
    assert.throws(() => assertEffectiveUnit({ ...state, ...change }, filename));
  }
});

test('evidence parse or write failure cannot mask the original cleanup recovery signal', async () => {
  const cleanup = Object.assign(new Error('unclean child group'), { requiresRecovery: true });
  await assert.rejects(stageWithEvidence(async () => { throw cleanup; }, () => { JSON.parse('{'); }),
    (error) => error === cleanup && error.requiresRecovery === true);
  await assert.rejects(stageWithEvidence(async () => 'ok', () => { throw new Error('evidence unavailable'); }), /evidence unavailable/);
});

test('isolated job inputs remain readable under the scheduler restrictive umask', { skip: process.platform !== 'linux' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-umask-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previous = process.umask(0o077);
  try {
    const job = path.join(directory, 'job'); createCodingInput(job);
    createCodingInput(path.join(job, 'spec.json'), '{}');
    assert.equal(fs.statSync(job).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(job, 'spec.json')).mode & 0o777, 0o644);
    const candidate = path.join(job, 'candidate'); fs.mkdirSync(candidate);
    fs.writeFileSync(path.join(candidate, 'source'), 'read-only');
    exposeCodingCandidate(candidate);
    assert.equal(fs.statSync(candidate).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(candidate, 'source')).mode & 0o777, 0o644);
  } finally { process.umask(previous); }
});

function evidenceFixture() {
  const value = spec(); const approval = fixture().approval; const approvedSha256 = fixture().approvedSha256;
  const prepared = prepareCodingPackage(value, { summary: 'Read-only profile.', questions: [],
    files: paths.map((file) => ({ path: file, content: 'export const example = true;\n' })) }, policy, baselinePackage);
  const files = Object.fromEntries(prepared.proposal.files.map((file) => [file.path, file.content]));
  const observations = [{ name: value.acceptanceCases[0].name, mode: 'cli', exitCode: 0, signal: null,
    execMainCode: 1, result: 'success', invocationId: 'a'.repeat(32), stdout: `${JSON.stringify(value.acceptanceCases[0].output)}\n`, stderr: '' }];
  const acceptanceSha256 = sha256(JSON.stringify(value.acceptanceCases));
  const verification = Buffer.from([
    { command: 'node', args: ['scripts/validate-policy.mjs', '--changed-files', ...prepared.proposal.files.map((file) => file.path)], exitCode: 0 },
    { command: 'npm', args: ['test'], exitCode: 0 },
    { status: 'supplemental-checks-passed', acceptanceSha256, paths: prepared.proposal.files.map((file) => file.path) },
  ].map(JSON.stringify).join('\n') + '\n');
  const run = { id: runId, status: 'verified', scheduleApprovalSha256: approvedSha256,
    specSha256: approval.scopeSha256, issue: value.issue.number, baseSha: value.baseSha,
    planSha256: sha256(JSON.stringify(value.plan)), acceptanceSha256,
    publicationSha256: sha256(prepared.bytes), verificationSha256: sha256(verification),
    observationsSha256: sha256(JSON.stringify(observations)), verifierExecution: { exitCode: 0, signal: null,
      execMainCode: 1, result: 'success', invocationId: 'b'.repeat(32) } };
  return { run, spec: value, approval, approvedSha256, bytes: prepared.bytes, observations, verification, files, policy, baselinePackage };
}

function verifierJournal(f, extraProcessOutput = '') {
  const verifierUnit = `bim-forge-code-verify@${runId}.service`;
  const invocation = f.run.verifierExecution.invocationId;
  const record = (MESSAGE, fields = {}) => ({ MESSAGE, _SYSTEMD_UNIT: verifierUnit,
    _SYSTEMD_INVOCATION_ID: invocation, _TRANSPORT: 'stdout', ...fields });
  const records = [record('Starting verifier', { _SYSTEMD_UNIT: 'init.scope', _TRANSPORT: 'journal' }),
    record('old invocation', { _SYSTEMD_INVOCATION_ID: 'c'.repeat(32) }),
    record('different unit', { _SYSTEMD_UNIT: 'another.service' }),
    record('different transport', { _TRANSPORT: 'journal' }),
    ...f.verification.toString('utf8').trim().split('\n').map((line) => record(line)),
    ...(extraProcessOutput ? [record(extraProcessOutput)] : []),
    record('Stopped verifier', { _SYSTEMD_UNIT: 'init.scope', _TRANSPORT: 'journal' })];
  const journal = (args) => {
    const filters = args.filter((arg) => arg.startsWith('_')).map((arg) => arg.split('='));
    const selected = filters.length ? records.filter((item) => filters.every(([key, value]) => item[key] === value)) : records;
    return Buffer.from(selected.map((item) => item.MESSAGE).join('\n') + '\n');
  };
  return { verifierUnit, journal };
}

test('verifier collection excludes lifecycle messages and unrelated process records before strict validation', () => {
  const f = evidenceFixture(); const { verifierUnit, journal } = verifierJournal(f);
  const collected = collectVerifierEvidence(verifierUnit, f.run.verifierExecution, journal);
  assert.deepEqual(collected.verification, f.verification);
  assert.match(collected.diagnostic.toString(), /Starting verifier/);
  assert.match(collected.diagnostic.toString(), /old invocation/);
  assert.match(collected.diagnostic.toString(), /Stopped verifier/);
  assert.deepEqual(assertVerifiedEvidence({ ...f, verification: collected.verification }), f.bytes);
});

test('unexpected verifier process output remains in evidence and fails the unchanged strict validator', () => {
  const f = evidenceFixture(); const { verifierUnit, journal } = verifierJournal(f, 'unexpected process stderr');
  const { verification } = collectVerifierEvidence(verifierUnit, f.run.verifierExecution, journal);
  assert.match(verification.toString(), /unexpected process stderr/);
  f.verification = verification; f.run.verificationSha256 = sha256(verification);
  assert.throws(() => assertVerifiedEvidence(f), /Scheduled verifier evidence changed/);
});

test('verifier collection refuses missing or malformed identity before reading any journal', () => {
  const verifierUnit = `bim-forge-code-verify@${runId}.service`;
  for (const [name, execution] of [[verifierUnit, undefined], [verifierUnit, {}],
    [verifierUnit, { invocationId: 'bad' }], [verifierUnit, { invocationId: 'a'.repeat(32) + '\n' }],
    ['another.service', { invocationId: 'a'.repeat(32) }],
    [`${verifierUnit}\n`, { invocationId: 'a'.repeat(32) }]]) {
    let calls = 0;
    assert.throws(() => collectVerifierEvidence(name, execution, () => { calls += 1; return Buffer.alloc(0); }));
    assert.equal(calls, 0);
  }
});

test('verifier journal failure propagates and failed execution evidence cannot become successful', () => {
  const f = evidenceFixture(); const { verifierUnit, journal } = verifierJournal(f);
  const failure = new Error('journal unavailable');
  assert.throws(() => collectVerifierEvidence(verifierUnit, f.run.verifierExecution, () => { throw failure; }), (error) => error === failure);
  let calls = 0;
  assert.throws(() => collectVerifierEvidence(verifierUnit, f.run.verifierExecution, (args) => {
    if (++calls === 2) throw failure;
    return journal(args);
  }), (error) => error === failure);
  assert.equal(calls, 2);
  f.run.verifierExecution.exitCode = 1; f.run.verifierExecution.result = 'exit-code';
  const { verification } = collectVerifierEvidence(verifierUnit, f.run.verifierExecution, journal);
  f.verification = verification; f.run.verificationSha256 = sha256(verification);
  assert.throws(() => assertVerifiedEvidence(f), /Scheduled verified ledger bindings changed/);
});

test('unit cleanup failure preserves observed invocation even when journal collection also fails', { skip: process.platform !== 'linux' }, async (t) => {
  const value = spec(); const invocationId = 'd'.repeat(32);
  const verifierUnit = `bim-forge-code-verify@${runId}.service`;
  // Emulate the administrator boundary without running a privileged process or command.
  t.mock.method(process, 'getuid', () => 0);
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, text: async () => JSON.stringify(
    url.endsWith('git/ref/heads/main') ? { object: { sha: value.baseSha } }
      : url.endsWith(`issues/${value.issue.number}`) ? { ...value.issue, state: 'open' } : []) }));
  t.mock.method(childProcess, 'execFileSync', (command, args) => {
    if (command === '/usr/bin/git') return 'paused: false\n';
    assert.equal(command, '/usr/bin/systemctl');
    if (args[0] === 'stop') throw new Error('cleanup failed');
    assert.equal(args[0], 'show');
    return `Result=success\nExecMainStatus=0\nExecMainCode=1\nInvocationID=${invocationId}\n`;
  });
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  let execution; let journalReads = 0;
  await assert.rejects(stageWithEvidence(async () => {
    try { await runUnit(verifierUnit, value, new AbortController().signal); }
    catch (error) { execution = error.execution; throw error; }
  }, () => {
    assert.equal(execution?.invocationId, invocationId);
    collectVerifierEvidence(verifierUnit, execution, () => { journalReads += 1; throw new Error('journal unavailable'); });
  }), (error) => error.requiresRecovery === true && error.execution?.invocationId === invocationId);
  assert.equal(journalReads, 1);
});

test('independent staging checks ledger, outputs, verification and exact manifest; no candidate import', () => {
  const f = evidenceFixture(); assert.deepEqual(assertVerifiedEvidence(f), f.bytes);
  for (const mutate of [
    (g) => { g.run.status = 'running'; }, (g) => { g.run.scheduleApprovalSha256 = 'e'.repeat(64); },
    (g) => { g.observations[0].stdout = 'forged'; }, (g) => { g.run.verifierExecution.signal = 9; },
    (g) => { g.files[paths[0]] += 'changed'; }, (g) => { g.verification = Buffer.from('not checked'); },
    (g) => { const p = JSON.parse(g.bytes); p.files.at(-1).content = '{}\n'; g.bytes = encode(p); g.run.publicationSha256 = sha256(g.bytes); },
    (g) => { const p = JSON.parse(g.bytes); p.files.push({ path: 'factory/code-job.mjs', content: 'unapproved' }); g.bytes = encode(p); g.run.publicationSha256 = sha256(g.bytes); },
  ]) { const g = evidenceFixture(); mutate(g); assert.throws(() => assertVerifiedEvidence(g)); }
});

test('permit is checked immediately before every repository request', async () => {
  let permitted = true; const effects = [];
  const request = guardScheduledRequest(async (method) => { effects.push(method); }, () => { if (!permitted) throw new Error('expired'); });
  await request('GET', '/'); permitted = false;
  await assert.rejects(request('POST', '/pulls'), /expired/); assert.deepEqual(effects, ['GET']);
});

test('scheduled publication is an exclusive mode, never a manual fallback', () => {
  for (const args of [['--scheduled-sha', 'a'.repeat(64)], ['--scheduled-sha', 'a'.repeat(64), '--approved-sha', 'a'.repeat(64)], ['--scheduled-sha', 'bad']]) {
    const result = spawnSync(process.execPath, ['factory/publish.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
  }
});

test('immutable closure measurement includes dependency bytes and refuses writable files and escaped links', { skip: process.platform !== 'linux' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-measure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'module'), 'first', { mode: 0o644 });
  const options = { ownerUid: process.getuid(), checkAncestors: false };
  const first = measureTree(directory, options).sha256;
  fs.writeFileSync(path.join(directory, 'module'), 'second'); assert.notEqual(measureTree(directory, options).sha256, first);
  fs.chmodSync(path.join(directory, 'module'), 0o666); assert.throws(() => measureTree(directory, options), /Mutable/);
  fs.chmodSync(path.join(directory, 'module'), 0o644); fs.symlinkSync('/etc/passwd', path.join(directory, 'escape'));
  assert.throws(() => measureTree(directory, options), /escapes/);
});

test('deployment measurement hashes every byte using bounded reads rather than whole-file allocation', { skip: process.platform !== 'linux' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-stream-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'binary');
  const content = Buffer.alloc(192 * 1024 + 7, 17); content[content.length - 1] = 99;
  fs.writeFileSync(filename, content, { mode: 0o600 });
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === filename) throw new Error('Whole-file allocation is forbidden for trusted runtime measurement');
    return original(file, ...args);
  });
  const originalRead = fs.readSync; let reads = 0;
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
    assert.ok(length > 0 && length <= 65536, 'Each requested read must stay within 64 KiB');
    reads += 1;
    return originalRead(fd, buffer, offset, Math.min(length, 511), position);
  });
  const value = measureTree(directory, { ownerUid: process.getuid(), checkAncestors: false });
  const expected = [['', 'directory', fs.statSync(directory).mode & 0o777], ['binary', 0o600, sha256(content)]];
  assert.deepEqual(value, { sha256: sha256(JSON.stringify(expected)), entries: 2, bytes: content.length });
  assert.ok(reads >= Math.ceil(content.length / 511), 'Short positive reads must not truncate the digest');
});

test('deployment measurement still rejects the aggregate byte budget before reading contents', { skip: process.platform !== 'linux' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-budget-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'oversized'); fs.writeFileSync(filename, 'x');
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (file, ...args) => {
    const stat = original(file, ...args);
    if (file === filename) stat.size = 768 * 1024 * 1024 + 1;
    return stat;
  });
  assert.throws(() => measureTree(directory, { ownerUid: process.getuid(), checkAncestors: false }), /byte limit/);
});

test('deployment measurement refuses changes to file contents, size, metadata or path during reads', { skip: process.platform !== 'linux' }, (t) => {
  for (const action of ['truncate', 'replace', 'grow', 'rewrite', 'metadata']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-change-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'binary'); fs.writeFileSync(filename, Buffer.alloc(128 * 1024, 7));
    const original = fs.readSync; let changed = false;
    const mock = t.mock.method(fs, 'readSync', (...args) => {
      const count = original(...args);
      if (!changed) {
        changed = true;
        if (action === 'truncate') fs.truncateSync(filename, 1);
        else if (action === 'replace') { fs.renameSync(filename, `${filename}-old`); fs.writeFileSync(filename, Buffer.alloc(128 * 1024, 7)); }
        else if (action === 'grow') fs.appendFileSync(filename, 'x');
        else if (action === 'metadata') fs.chmodSync(filename, 0o444);
        else { fs.writeFileSync(filename, Buffer.alloc(128 * 1024, 8)); fs.utimesSync(filename, new Date(0), new Date(1)); }
      }
      return count;
    });
    assert.throws(() => measureTree(directory, { ownerUid: process.getuid(), checkAncestors: false }), /Trusted file (?:ended|changed)/);
    mock.mock.restore();
  }
});

test('a cleanup failure can retain the shared coding lease without deleting durable history', { skip: process.platform !== 'linux' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-retain-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = openCodingRun({ root: directory, bytes: encode(spec()), ownerUid: process.getuid() });
  run.record({ status: 'interrupted' }); run.close({ preserveLock: true });
  assert.equal(fs.existsSync(path.join(directory, 'ledger', 'coding.lock')), true);
  assert.equal(fs.existsSync(path.join(directory, 'ledger', `${run.run.id}.json`)), true);
  assert.throws(() => openCodingRun({ root: directory, bytes: encode(spec()), ownerUid: process.getuid() }), /EEXIST/);
});
