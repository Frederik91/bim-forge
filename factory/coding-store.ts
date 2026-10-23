import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readCodingSpec, sha256 } from './coding.ts';
import { parseScheduleApproval } from './schedule-approval.ts';

export interface CodingRun extends Record<string, unknown> {
  id: string;
  specSha256: string;
  issue: number;
  baseSha: string;
  planSha256: string;
  acceptanceSha256: string;
  attempt: number;
  startedAt: string;
  status: 'running' | 'verified' | 'failed' | 'interrupted';
  usage: unknown;
  cost: unknown;
  scheduleApprovalSha256?: string;
}

interface OpenCodingRunOptions {
  readonly root: string;
  readonly bytes: unknown;
  readonly retry?: boolean;
  readonly ownerUid?: number;
  readonly schedule?: unknown;
}

interface CloseCodingRunOptions {
  readonly preserveLock?: boolean;
}

export interface CodingRunStore {
  readonly run: CodingRun;
  readonly reused: boolean;
  readonly record: (fields: Record<string, unknown>) => void;
  readonly close: (options?: CloseCodingRunOptions) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCodingRun(value: unknown): CodingRun {
  const scheduleDigestValid = isRecord(value) && (value.scheduleApprovalSha256 === undefined
    || (typeof value.scheduleApprovalSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.scheduleApprovalSha256)));
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
      || typeof value.specSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.specSha256)
      || typeof value.issue !== 'number' || !Number.isSafeInteger(value.issue) || value.issue < 1
      || typeof value.baseSha !== 'string' || typeof value.planSha256 !== 'string'
      || typeof value.acceptanceSha256 !== 'string' || typeof value.attempt !== 'number'
      || !Number.isInteger(value.attempt) || value.attempt < 1 || value.attempt > 3
      || (value.status !== 'running' && value.status !== 'verified' && value.status !== 'failed' && value.status !== 'interrupted')
      || typeof value.startedAt !== 'string' || !scheduleDigestValid) {
    throw new Error('Coding ledger is corrupt; administrator recovery required');
  }
  const scheduleApprovalSha256 = typeof value.scheduleApprovalSha256 === 'string'
    ? value.scheduleApprovalSha256 : undefined;
  return {
    ...value,
    id: value.id,
    specSha256: value.specSha256,
    issue: value.issue,
    baseSha: value.baseSha,
    planSha256: value.planSha256,
    acceptanceSha256: value.acceptanceSha256,
    attempt: value.attempt,
    startedAt: value.startedAt,
    status: value.status,
    usage: value.usage,
    cost: value.cost,
    ...(scheduleApprovalSha256 === undefined ? {} : { scheduleApprovalSha256 }),
  };
}

export function saveCodingJson(filename: string, value: unknown): void {
  const pending = `${filename}.${randomUUID()}.pending`;
  const fd = fs.openSync(pending, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(pending, filename);
  const directory = fs.openSync(path.dirname(filename), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

export function readProtectedCodingFile(filename: string, ownerUid = 0, maximum = 256 * 1024): Buffer {
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

export function openCodingRun({
  root,
  bytes,
  retry = false,
  ownerUid = 0,
  schedule,
}: OpenCodingRunOptions): CodingRunStore {
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
  if (!Buffer.isBuffer(bytes)) throw new Error('Coding scope exceeds its limit');
  const digest = sha256(bytes);
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, digest }));
    fs.fsyncSync(lock);
    const syncLedger = (): void => {
      const fd = fs.openSync(ledger, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    };
    syncLedger();
    const records = fs.readdirSync(ledger).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .map((name) => parseCodingRun(JSON.parse(readProtectedCodingFile(path.join(ledger, name), ownerUid).toString('utf8'))));
    const consumedApprovals = records.flatMap((record) => record.scheduleApprovalSha256 === undefined
      ? [] : [record.scheduleApprovalSha256]);
    if (new Set(consumedApprovals).size !== consumedApprovals.length) {
      throw new Error('Coding ledger has corrupt duplicate approval consumption; administrator recovery required');
    }
    if (records.some((record) => record.status === 'running')) {
      throw new Error('Interrupted coding run requires administrator recovery');
    }
    const prior = records.filter((record) => record.specSha256 === digest)
      .sort((left, right) => left.attempt - right.attempt).at(-1);
    const close = ({ preserveLock = false }: CloseCodingRunOptions = {}): void => {
      fs.closeSync(lock);
      if (!preserveLock) { fs.unlinkSync(lockPath); syncLedger(); }
    };
    const rejectReusedRecord = (): void => { throw new Error('A reused coding run cannot be changed'); };
    let approvalDigest: string | undefined;
    if (schedule !== undefined) {
      const now = new Date();
      if (!isRecord(schedule) || Object.keys(schedule).sort().join(',') !== 'approvalBytes,approvedSha256,deploymentSha256'
          || retry) {
        throw new Error('Scheduled admission requires exact approval inputs and no retry');
      }
      const approval = parseScheduleApproval(schedule.approvalBytes, schedule.approvedSha256, now);
      if (approval.scopeSha256 !== digest || approval.deploymentSha256 !== schedule.deploymentSha256) {
        throw new Error('Scheduled admission scope or deployment binding changed');
      }
      if (records.some((record) => !Number.isFinite(Date.parse(record.startedAt))
          || new Date(record.startedAt).toISOString() !== record.startedAt
          || Date.parse(record.startedAt) > now.getTime())
          || new Set(records.map((record) => record.id)).size !== records.length) {
        throw new Error('Scheduled accounting is corrupt or future-dated; administrator recovery required');
      }
      if (typeof schedule.approvedSha256 !== 'string') {
        throw new Error('Scheduled admission requires exact approval inputs and no retry');
      }
      approvalDigest = schedule.approvedSha256;
      const consumed = records.filter((record) => record.scheduleApprovalSha256 === approvalDigest);
      if (consumed.length && (consumed[0]?.specSha256 !== digest || consumed[0]?.issue !== spec.issue.number)) {
        throw new Error('Scheduled approval consumption is corrupt; administrator recovery required');
      }
      if (consumed[0]) return { run: consumed[0], reused: true, record: rejectReusedRecord, close };
      if (prior) throw new Error('Scheduled scope was already attempted; no automatic retry');
      if (records.filter((record) => record.startedAt.slice(0, 10) === now.toISOString().slice(0, 10)).length >= approval.dailyLimit) {
        throw new Error('Scheduled UTC-day start limit reached');
      }
    }
    if (prior && (!retry || prior.status === 'verified')) return { run: prior, reused: true, record: rejectReusedRecord, close };
    const attempts = records.filter((record) => record.issue === spec.issue.number).length;
    if (attempts >= 3) throw new Error('Coding issue attempt limit reached; escalate to the maintainer');
    const run: CodingRun = {
      id: randomUUID(),
      specSha256: digest,
      issue: spec.issue.number,
      baseSha: spec.baseSha,
      planSha256: sha256(JSON.stringify(spec.plan)),
      acceptanceSha256: sha256(JSON.stringify(spec.acceptanceCases)),
      attempt: attempts + 1,
      startedAt: new Date().toISOString(),
      status: 'running',
      usage: null,
      cost: null,
      ...(approvalDigest === undefined ? {} : { scheduleApprovalSha256: approvalDigest }),
    };
    const recordPath = path.join(ledger, `${run.id}.json`);
    saveCodingJson(recordPath, run);
    return {
      run,
      reused: false,
      record(fields): void { Object.assign(run, fields); saveCodingJson(recordPath, run); },
      close,
    };
  } catch (error) {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
    throw error;
  }
}
