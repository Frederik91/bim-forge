import fs from 'node:fs';
import path from 'node:path';
import { readProtectedCodingFile } from './coding-store.ts';
import { sha256 } from './coding.ts';
import { parseScheduleApproval, type ScheduleApproval } from './schedule-approval.ts';

export const POLICY = 'profile-additions-draft-v1';

interface ScheduledActivation {
  readonly version: 1;
  readonly approvalSha256: string | null;
  readonly publicationPolicy: typeof POLICY;
}

interface ScheduledClock {
  readonly now: Date;
  readonly bootId: string;
  readonly monotonicNs: bigint;
}

interface ScheduledPermit {
  readonly version: 1;
  readonly publicationSha256: string;
  readonly approvalSha256: string;
  readonly approvalJson: string;
  readonly activationSha256: string;
  readonly runId: string;
  readonly bootId: string;
  readonly startedNs: string;
  readonly deadlineNs: string;
}

interface ScheduledPermitInput {
  readonly publicationSha256: unknown;
  readonly approvalBytes: unknown;
  readonly approvedSha256: unknown;
  readonly activationBytes: unknown;
  readonly runId: unknown;
  readonly bootId: unknown;
  readonly startedNs: unknown;
  readonly deadlineNs: unknown;
}

interface ReadScheduledPermitOptions {
  readonly approvalsDir?: string;
  readonly ownerUid?: number;
  readonly codingPausePath?: string;
  readonly clock?: unknown;
}

export interface ScheduledPermitResult {
  readonly permit: Readonly<ScheduledPermit>;
  readonly approval: Readonly<ScheduleApproval>;
}

export function guardScheduledRequest<Arguments extends unknown[], Result>(
  request: (...args: Arguments) => Promise<Result> | Result,
  assertPermit: () => void,
): (...args: Arguments) => Promise<Result> {
  return async (...args: Arguments): Promise<Result> => {
    assertPermit();
    return request(...args);
  };
}

const activationKeys = ['version', 'approvalSha256', 'publicationPolicy'];
const permitKeys = ['version', 'publicationSha256', 'approvalSha256', 'approvalJson',
  'activationSha256', 'runId', 'bootId', 'startedNs', 'deadlineNs'];
const durationNs = 1200000000000n;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}

function isNs(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,23})$/.test(value);
}

function encode(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function parseCanonical(bytes: unknown, maximum: number, keys: readonly string[], label: string): Record<string, unknown> {
  if (!Buffer.isBuffer(bytes) || bytes.length > maximum) {
    throw new Error(`${label} requires a bounded Buffer (at most ${maximum} bytes)`);
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`Invalid ${label} JSON or UTF-8`); }
  if (!bytes.equals(encode(value))) throw new Error(`${label} requires canonical compact JSON plus newline`);
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields`);
  }
  return value;
}

export function parseActivation(bytes: unknown): Readonly<ScheduledActivation> {
  const activation = parseCanonical(bytes, 4 * 1024, activationKeys, 'scheduled activation');
  if (activation.version !== 1 || activation.publicationPolicy !== POLICY
      || (activation.approvalSha256 !== null && !isDigest(activation.approvalSha256))) {
    throw new Error('Invalid scheduled activation fields or publication policy');
  }
  return Object.freeze({ version: 1, publicationPolicy: POLICY, approvalSha256: activation.approvalSha256 });
}

function readClock(clock: unknown): ScheduledClock {
  try {
    const source: unknown = clock === undefined ? {
      now: new Date(),
      bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      monotonicNs: process.hrtime.bigint(),
    } : clock;
    if (!isRecord(source) || !(source.now instanceof Date) || !isId(source.bootId)
        || typeof source.monotonicNs !== 'bigint' || source.monotonicNs < 0n) {
      throw new Error();
    }
    const time = source.now.getTime();
    if (!Number.isFinite(time)) throw new Error();
    return { now: new Date(time), bootId: source.bootId, monotonicNs: source.monotonicNs };
  } catch { throw new Error('Invalid scheduled publication clock'); }
}

export function createScheduledPermit(input: ScheduledPermitInput, clock?: unknown): Buffer {
  const current = readClock(clock);
  parseScheduleApproval(input.approvalBytes, input.approvedSha256, current.now);
  if (!Buffer.isBuffer(input.approvalBytes) || !Buffer.isBuffer(input.activationBytes)) {
    throw new Error('Invalid scheduled permit fields');
  }
  const bytes = encode({
    version: 1,
    publicationSha256: input.publicationSha256,
    approvalSha256: input.approvedSha256,
    approvalJson: input.approvalBytes.toString('utf8'),
    activationSha256: sha256(input.activationBytes),
    runId: input.runId,
    bootId: input.bootId,
    startedNs: input.startedNs,
    deadlineNs: input.deadlineNs,
  });
  assertScheduledPermit(bytes, input.publicationSha256, input.activationBytes, current);
  return bytes;
}

export function assertScheduledPermit(
  bytes: unknown,
  publicationSha256: unknown,
  activationBytes: unknown,
  clock?: unknown,
): ScheduledPermitResult {
  const parsed = parseCanonical(bytes, 32 * 1024, permitKeys, 'scheduled permit');
  const activation = parseActivation(activationBytes);
  if (parsed.version !== 1 || !isDigest(publicationSha256) || !isDigest(parsed.publicationSha256)
      || !isDigest(parsed.approvalSha256) || !isDigest(parsed.activationSha256)
      || typeof parsed.approvalJson !== 'string' || !isId(parsed.runId) || !isId(parsed.bootId)
      || !isNs(parsed.startedNs) || !isNs(parsed.deadlineNs) || !Buffer.isBuffer(activationBytes)) {
    throw new Error('Invalid scheduled permit fields');
  }
  const permit: ScheduledPermit = {
    version: 1,
    publicationSha256: parsed.publicationSha256,
    approvalSha256: parsed.approvalSha256,
    approvalJson: parsed.approvalJson,
    activationSha256: parsed.activationSha256,
    runId: parsed.runId,
    bootId: parsed.bootId,
    startedNs: parsed.startedNs,
    deadlineNs: parsed.deadlineNs,
  };
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

function assertDirectory(directory: string, ownerUid: number): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownerUid || (stat.mode & 0o022)) {
    throw new Error('Scheduled publication directory must be protected and administrator-owned');
  }
}

function assertUnpaused(filename: string): void {
  try { fs.lstatSync(filename); }
  catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  throw new Error('Scheduled publication is paused');
}

export function readScheduledPermit(
  digest: unknown,
  {
    approvalsDir = '/var/lib/bim-forge-approvals',
    ownerUid = 0,
    codingPausePath = '/var/lib/bim-forge-coding/PAUSED',
    clock,
  }: ReadScheduledPermitOptions = {},
): ScheduledPermitResult {
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
