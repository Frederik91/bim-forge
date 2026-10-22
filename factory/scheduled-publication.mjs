import fs from 'node:fs';
import path from 'node:path';
import { readProtectedCodingFile } from './coding-store.mjs';
import { sha256 } from './coding.mjs';
import { parseScheduleApproval } from './schedule-approval.mjs';

export const POLICY = 'profile-additions-draft-v1';

export const guardScheduledRequest = (request, assertPermit) => async (...args) => {
  assertPermit();
  return request(...args);
};

const activationKeys = ['version', 'approvalSha256', 'publicationPolicy'];
const permitKeys = ['version', 'publicationSha256', 'approvalSha256', 'approvalJson',
  'activationSha256', 'runId', 'bootId', 'startedNs', 'deadlineNs'];
const isDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isId = (value) => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const isNs = (value) => typeof value === 'string' && /^(0|[1-9][0-9]{0,23})$/.test(value);
const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const durationNs = 1200000000000n;

function parseCanonical(bytes, maximum, keys, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maximum) {
    throw new Error(`${label} requires a bounded Buffer (at most ${maximum} bytes)`);
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`Invalid ${label} JSON or UTF-8`);
  }
  if (!bytes.equals(encode(value))) throw new Error(`${label} requires canonical compact JSON plus newline`);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields`);
  }
  return value;
}

export function parseActivation(bytes) {
  const activation = parseCanonical(bytes, 4 * 1024, activationKeys, 'scheduled activation');
  if (activation.version !== 1 || activation.publicationPolicy !== POLICY
      || (activation.approvalSha256 !== null && !isDigest(activation.approvalSha256))) {
    throw new Error('Invalid scheduled activation fields or publication policy');
  }
  return Object.freeze(activation);
}

function readClock(clock) {
  try {
    const source = clock === undefined ? {
      now: new Date(),
      bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      monotonicNs: process.hrtime.bigint(),
    } : clock;
    const { now, bootId, monotonicNs } = source;
    const time = Date.prototype.getTime.call(now);
    if (!Number.isFinite(time) || !isId(bootId) || typeof monotonicNs !== 'bigint' || monotonicNs < 0n) {
      throw new Error();
    }
    return { now: new Date(time), bootId, monotonicNs };
  } catch {
    throw new Error('Invalid scheduled publication clock');
  }
}

export function createScheduledPermit({ publicationSha256, approvalBytes, approvedSha256,
  activationBytes, runId, bootId, startedNs, deadlineNs }, clock) {
  // Validate the original bytes before converting them into the embedded UTF-8 string.
  const current = readClock(clock);
  parseScheduleApproval(approvalBytes, approvedSha256, current.now);
  const bytes = encode({ version: 1, publicationSha256, approvalSha256: approvedSha256,
    approvalJson: approvalBytes.toString('utf8'), activationSha256: sha256(activationBytes),
    runId, bootId, startedNs, deadlineNs });
  assertScheduledPermit(bytes, publicationSha256, activationBytes, current);
  return bytes;
}

export function assertScheduledPermit(bytes, publicationSha256, activationBytes, clock) {
  const permit = parseCanonical(bytes, 32 * 1024, permitKeys, 'scheduled permit');
  const activation = parseActivation(activationBytes);
  if (permit.version !== 1 || !isDigest(publicationSha256) || !isDigest(permit.publicationSha256)
      || !isDigest(permit.approvalSha256) || !isDigest(permit.activationSha256)
      || typeof permit.approvalJson !== 'string' || !isId(permit.runId) || !isId(permit.bootId)
      || !isNs(permit.startedNs) || !isNs(permit.deadlineNs)) {
    throw new Error('Invalid scheduled permit fields');
  }
  if (activation.approvalSha256 === null) throw new Error('No active scheduled approval');
  if (permit.publicationSha256 !== publicationSha256
      || permit.activationSha256 !== sha256(activationBytes)
      || permit.approvalSha256 !== activation.approvalSha256
      || sha256(Buffer.from(permit.approvalJson, 'utf8')) !== permit.approvalSha256) {
    throw new Error('Scheduled permit digest or activation binding changed');
  }
  const current = readClock(clock);
  const started = BigInt(permit.startedNs);
  const deadline = BigInt(permit.deadlineNs);
  if (deadline - started !== durationNs || current.bootId !== permit.bootId
      || current.monotonicNs < started || current.monotonicNs >= deadline) {
    throw new Error('Scheduled permit boot or monotonic deadline is invalid');
  }
  const approval = parseScheduleApproval(Buffer.from(permit.approvalJson, 'utf8'), permit.approvalSha256, current.now);
  return { permit: Object.freeze(permit), approval };
}

function assertDirectory(directory, ownerUid) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownerUid || (stat.mode & 0o022)) {
    throw new Error('Scheduled publication directory must be protected and administrator-owned');
  }
}

function assertUnpaused(filename) {
  try {
    fs.lstatSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Scheduled publication is paused');
}

export function readScheduledPermit(digest, { approvalsDir = '/var/lib/bim-forge-approvals', ownerUid = 0,
  codingPausePath = '/var/lib/bim-forge-coding/PAUSED', clock } = {}) {
  if (!isDigest(digest)) throw new Error('Invalid scheduled publication digest');
  if (process.platform !== 'linux') throw new Error('Protected scheduled publication reads require Linux');
  const scheduled = path.join(approvalsDir, 'scheduled');
  const pause = path.join(approvalsDir, 'PAUSED');
  assertDirectory(approvalsDir, ownerUid);
  assertDirectory(scheduled, ownerUid);
  assertUnpaused(codingPausePath);
  assertUnpaused(pause);
  const activationBytes = readProtectedCodingFile(path.join(approvalsDir, 'SCHEDULED'), ownerUid, 4 * 1024);
  const bytes = readProtectedCodingFile(path.join(scheduled, `${digest}.permit.json`), ownerUid, 32 * 1024);
  const result = assertScheduledPermit(bytes, digest, activationBytes, clock);
  assertUnpaused(codingPausePath);
  assertUnpaused(pause);
  return result;
}
