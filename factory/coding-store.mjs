import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readCodingSpec, sha256 } from './coding.mjs';
import { parseScheduleApproval } from './schedule-approval.mjs';

export function saveCodingJson(filename, value) {
  const pending = `${filename}.${randomUUID()}.pending`;
  const fd = fs.openSync(pending, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(pending, filename);
  const directory = fs.openSync(path.dirname(filename), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

export function readProtectedCodingFile(filename, ownerUid = 0, maximum = 256 * 1024) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== ownerUid || (stat.mode & 0o022) || stat.nlink !== 1 || stat.size > maximum) {
      throw new Error('Coding input must be a protected administrator-owned regular file');
    }
    const bytes = fs.readFileSync(fd);
    if (bytes.length > maximum) throw new Error('Coding input grew beyond its limit');
    return bytes;
  } finally { fs.closeSync(fd); }
}

export function openCodingRun({ root, bytes, retry = false, ownerUid = 0, schedule }) {
  const spec = readCodingSpec(bytes);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownerUid || (stat.mode & 0o022)) {
    throw new Error('Coding store must be administrator-owned and protected');
  }
  const ledger = path.join(root, 'ledger');
  if (!fs.existsSync(ledger)) fs.mkdirSync(ledger, { mode: 0o700 });
  const ledgerStat = fs.lstatSync(ledger);
  if (!ledgerStat.isDirectory() || ledgerStat.isSymbolicLink() || ledgerStat.uid !== ownerUid || (ledgerStat.mode & 0o077)) {
    throw new Error('Coding ledger must be private');
  }
  const lockPath = path.join(ledger, 'coding.lock');
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  const digest = sha256(bytes);
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, digest })); fs.fsyncSync(lock);
    const syncLedger = () => { const fd = fs.openSync(ledger, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
    syncLedger();
    const records = fs.readdirSync(ledger).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .map((name) => JSON.parse(readProtectedCodingFile(path.join(ledger, name), ownerUid)));
    if (records.some((record) => !/^[a-f0-9-]{36}$/.test(record.id ?? '') || !/^[a-f0-9]{64}$/.test(record.specSha256 ?? '')
        || !Number.isSafeInteger(record.issue) || record.issue < 1 || !Number.isInteger(record.attempt)
        || record.attempt < 1 || record.attempt > 3 || !['running', 'verified', 'failed', 'interrupted'].includes(record.status)
        || (record.scheduleApprovalSha256 !== undefined && (typeof record.scheduleApprovalSha256 !== 'string'
          || !/^[a-f0-9]{64}$/.test(record.scheduleApprovalSha256))))) {
      throw new Error('Coding ledger is corrupt; administrator recovery required');
    }
    const consumedApprovals = records.filter((record) => record.scheduleApprovalSha256 !== undefined)
      .map((record) => record.scheduleApprovalSha256);
    if (new Set(consumedApprovals).size !== consumedApprovals.length) {
      throw new Error('Coding ledger has corrupt duplicate approval consumption; administrator recovery required');
    }
    if (records.some((record) => record.status === 'running')) throw new Error('Interrupted coding run requires administrator recovery');
    const prior = records.filter((record) => record.specSha256 === digest).sort((a, b) => a.attempt - b.attempt).at(-1);
    const close = ({ preserveLock = false } = {}) => {
      fs.closeSync(lock);
      if (!preserveLock) { fs.unlinkSync(lockPath); syncLedger(); }
    };
    let approvalDigest;
    if (schedule !== undefined) {
      const now = new Date();
      if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)
          || Object.keys(schedule).sort().join(',') !== 'approvalBytes,approvedSha256,deploymentSha256'
          || retry) throw new Error('Scheduled admission requires exact approval inputs and no retry');
      const approval = parseScheduleApproval(schedule.approvalBytes, schedule.approvedSha256, now);
      if (approval.scopeSha256 !== digest || approval.deploymentSha256 !== schedule.deploymentSha256) {
        throw new Error('Scheduled admission scope or deployment binding changed');
      }
      if (records.some((record) => typeof record.startedAt !== 'string'
          || !Number.isFinite(Date.parse(record.startedAt))
          || new Date(record.startedAt).toISOString() !== record.startedAt
          || Date.parse(record.startedAt) > now.getTime())
          || new Set(records.map((record) => record.id)).size !== records.length) {
        throw new Error('Scheduled accounting is corrupt or future-dated; administrator recovery required');
      }
      approvalDigest = schedule.approvedSha256;
      const consumed = records.filter((record) => record.scheduleApprovalSha256 === approvalDigest);
      if (consumed.length && (consumed[0].specSha256 !== digest || consumed[0].issue !== spec.issue.number)) {
        throw new Error('Scheduled approval consumption is corrupt; administrator recovery required');
      }
      if (consumed.length) return { run: consumed[0], reused: true, close };
      if (prior) throw new Error('Scheduled scope was already attempted; no automatic retry');
      if (records.filter((record) => record.startedAt.slice(0, 10) === now.toISOString().slice(0, 10)).length >= approval.dailyLimit) {
        throw new Error('Scheduled UTC-day start limit reached');
      }
    }
    if (prior && (!retry || prior.status === 'verified')) return { run: prior, reused: true, close };
    const attempts = records.filter((record) => record.issue === spec.issue.number).length;
    if (attempts >= 3) throw new Error('Coding issue attempt limit reached; escalate to the maintainer');
    const run = { id: randomUUID(), specSha256: digest, issue: spec.issue.number, baseSha: spec.baseSha,
      planSha256: sha256(JSON.stringify(spec.plan)), acceptanceSha256: sha256(JSON.stringify(spec.acceptanceCases)),
      attempt: attempts + 1, startedAt: new Date().toISOString(), status: 'running', usage: null, cost: null };
    if (approvalDigest) run.scheduleApprovalSha256 = approvalDigest;
    const recordPath = path.join(ledger, `${run.id}.json`);
    saveCodingJson(recordPath, run);
    return { run, reused: false,
      record(fields) { Object.assign(run, fields); saveCodingJson(recordPath, run); },
      close,
    };
  } catch (error) { fs.closeSync(lock); fs.unlinkSync(lockPath); throw error; }
}
