import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openPublication } from './publish-store.mjs';

const linux = process.platform === 'linux';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-publish-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const approvalsDir = path.join(root, 'approvals'); const ledgerDir = path.join(root, 'ledger');
  fs.mkdirSync(approvalsDir, { mode: 0o750 }); fs.mkdirSync(ledgerDir, { mode: 0o700 });
  const stage = (label = 'one') => {
    const bytes = Buffer.from(JSON.stringify({ version: 1, repository: 'Frederik91/bim-forge', issue: 14,
      issueUpdatedAt: '2026-10-21T19:30:00Z', issueSha256: 'c'.repeat(64), baseSha: 'a'.repeat(40),
      title: `Approved ${label}`, body: 'Operator-approved change', files: [{ path: 'docs/proposal.md', content: 'approved bytes' }] }));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const filename = path.join(approvalsDir, `${digest}.json`); fs.writeFileSync(filename, bytes, { mode: 0o640 });
    return { digest, filename, bytes };
  };
  return { root, approvalsDir, ledgerDir, stage, open: (digest) => openPublication({ digest, approvalsDir, ledgerDir, ownerUid: process.getuid() }) };
}

test('approved files are privately snapshotted and only one publisher can run', { skip: !linux }, (t) => {
  const f = fixture(t); const item = f.stage(); const store = f.open(item.digest);
  try {
    assert.throws(() => f.open(item.digest), /busy or interrupted/);
    fs.writeFileSync(item.filename, 'changed after snapshot');
    assert.deepEqual(store.bytes, item.bytes);
    store.record({ stage: 'approved', attemptLimit: 3 }); store.finish({ status: 'published' });
  } finally { store.close(); }
  const events = fs.readFileSync(path.join(f.ledgerDir, `${item.digest}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((event) => event.stage), ['started', 'approved', 'finished']);
  assert.equal(fs.existsSync(path.join(f.ledgerDir, 'publisher.lock')), false);
});

test('writable, aliased, symlinked, and unapproved package files are refused', { skip: !linux }, (t) => {
  const f = fixture(t);
  const writable = f.stage('writable'); fs.chmodSync(writable.filename, 0o660);
  assert.throws(() => f.open(writable.digest), /protected regular/);
  const linked = f.stage('hardlink'); fs.linkSync(linked.filename, `${linked.filename}.alias`);
  assert.throws(() => f.open(linked.digest), /protected regular/);
  const symlink = f.stage('symlink'); fs.unlinkSync(symlink.filename); fs.symlinkSync(linked.filename, symlink.filename);
  assert.throws(() => f.open(symlink.digest));
  const changed = f.stage('changed'); fs.appendFileSync(changed.filename, '\n');
  assert.throws(() => f.open(changed.digest), /approval/);
  fs.chmodSync(f.approvalsDir, 0o770);
  assert.throws(() => f.open(changed.digest), /Approval directory/);
});

test('draft intent survives an interrupted request and blocks another package for the issue', { skip: !linux }, (t) => {
  const f = fixture(t); const item = f.stage(); let store = f.open(item.digest);
  store.record({ stage: 'approved', attemptLimit: 3 }); store.record({ stage: 'write-intent', resource: '/pulls' }); store.finish({ status: 'stopped' }); store.close();
  store = f.open(item.digest);
  assert.equal(store.hasPendingDraftIntent, true);
  store.finish({ status: 'published' }); store.close();
  const second = f.stage('second');
  store = f.open(second.digest); store.record({ stage: 'approved', attemptLimit: 3 }); store.record({ stage: 'write-intent', resource: '/pulls' }); store.finish({ status: 'stopped' }); store.close();
  assert.throws(() => f.open(item.digest), /earlier issue publication is unresolved/);
});

test('three failed mutation attempts stop writes across different approved packages', { skip: !linux }, (t) => {
  const f = fixture(t);
  for (let index = 0; index < 3; index += 1) {
    const item = f.stage(`attempt-${index}`); const store = f.open(item.digest);
    store.record({ stage: 'approved', attemptLimit: 3 }); store.record({ stage: 'write-intent', resource: '/git/trees' }); store.finish({ status: 'stopped' }); store.close();
  }
  const item = f.stage('fourth'); const store = f.open(item.digest);
  try {
    store.record({ stage: 'approved', attemptLimit: 3 });
    assert.throws(() => store.record({ stage: 'write-intent', resource: '/git/trees' }), /attempt limit/);
    store.finish({ status: 'stopped' });
  } finally { store.close(); }
});

test('interrupted locks and corrupt history are never automatically discarded', { skip: !linux }, (t) => {
  const f = fixture(t); const item = f.stage(); const lock = path.join(f.ledgerDir, 'publisher.lock');
  fs.writeFileSync(lock, '{"pid":99999999}', { mode: 0o600 });
  assert.throws(() => f.open(item.digest), /interrupted/);
  assert.equal(fs.existsSync(lock), true);
  fs.unlinkSync(lock);
  fs.writeFileSync(path.join(f.ledgerDir, `${item.digest}.jsonl`), '{incomplete', { mode: 0o600 });
  assert.throws(() => f.open(item.digest));
});
