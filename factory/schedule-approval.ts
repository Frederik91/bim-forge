import { createHash } from 'node:crypto';

type Sha256 = string & { readonly __brand: 'Sha256' };

export interface ScheduleApproval {
  readonly version: 1;
  readonly repository: 'Frederik91/bim-forge';
  readonly scopeSha256: Sha256;
  readonly deploymentSha256: Sha256;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly dailyLimit: number;
}

const keys: (keyof ScheduleApproval)[] = [
  'version', 'repository', 'scopeSha256', 'deploymentSha256', 'notBefore', 'expiresAt', 'dailyLimit',
];
const keySet = new Set<string>(keys);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is Sha256 {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return Number.NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : Number.NaN;
}

export function parseScheduleApproval(
  bytes: unknown,
  approvedSha256: unknown,
  now: unknown = new Date(),
): Readonly<ScheduleApproval> {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024) {
    throw new Error('Schedule approval requires a Buffer of at most 16 KiB');
  }
  if (!isSha256(approvedSha256)
      || createHash('sha256').update(bytes).digest('hex') !== approvedSha256) {
    throw new Error('Schedule approval digest does not match the exact bytes');
  }
  const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(json);
  if (!bytes.equals(Buffer.from(`${JSON.stringify(parsed)}\n`))) {
    throw new Error('Schedule approval requires canonical compact JSON plus newline');
  }
  if (!isRecord(parsed)
      || Object.keys(parsed).length !== keys.length
      || Object.keys(parsed).some((key) => !keySet.has(key))
      || parsed.version !== 1 || parsed.repository !== 'Frederik91/bim-forge'
      || !isSha256(parsed.scopeSha256) || !isSha256(parsed.deploymentSha256)
      || typeof parsed.dailyLimit !== 'number' || !Number.isSafeInteger(parsed.dailyLimit)
      || parsed.dailyLimit < 1 || parsed.dailyLimit > 6) {
    throw new Error('Invalid schedule approval fields');
  }
  const notBefore = timestamp(parsed.notBefore);
  const expiresAt = timestamp(parsed.expiresAt);
  const current = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(notBefore) || !Number.isFinite(expiresAt) || !Number.isFinite(current)
      || notBefore >= expiresAt || expiresAt - notBefore > 24 * 60 * 60 * 1000
      || current < notBefore || current >= expiresAt) {
    throw new Error('Invalid schedule approval time window');
  }
  if (typeof parsed.notBefore !== 'string' || typeof parsed.expiresAt !== 'string') {
    throw new Error('Invalid schedule approval time window');
  }
  const approval: ScheduleApproval = {
    version: parsed.version,
    repository: parsed.repository,
    scopeSha256: parsed.scopeSha256,
    deploymentSha256: parsed.deploymentSha256,
    notBefore: parsed.notBefore,
    expiresAt: parsed.expiresAt,
    dailyLimit: parsed.dailyLimit,
  };
  return Object.freeze(approval);
}
