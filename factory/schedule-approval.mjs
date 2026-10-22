import { createHash } from 'node:crypto';

const keys = ['version', 'repository', 'scopeSha256', 'deploymentSha256', 'notBefore', 'expiresAt', 'dailyLimit'];
const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
};

export function parseScheduleApproval(bytes, approvedSha256, now = new Date()) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024) {
    throw new Error('Schedule approval requires a Buffer of at most 16 KiB');
  }
  if (!isSha256(approvedSha256)
      || createHash('sha256').update(bytes).digest('hex') !== approvedSha256) {
    throw new Error('Schedule approval digest does not match the exact bytes');
  }
  const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const approval = JSON.parse(json);
  if (!bytes.equals(Buffer.from(`${JSON.stringify(approval)}\n`))) {
    throw new Error('Schedule approval requires canonical compact JSON plus newline');
  }
  if (!approval || Array.isArray(approval) || typeof approval !== 'object'
      || Object.keys(approval).length !== keys.length
      || keys.some((key) => !Object.hasOwn(approval, key))
      || approval.version !== 1 || approval.repository !== 'Frederik91/bim-forge'
      || !isSha256(approval.scopeSha256) || !isSha256(approval.deploymentSha256)
      || !Number.isSafeInteger(approval.dailyLimit) || approval.dailyLimit < 1 || approval.dailyLimit > 3) {
    throw new Error('Invalid schedule approval fields');
  }
  const notBefore = timestamp(approval.notBefore);
  const expiresAt = timestamp(approval.expiresAt);
  const current = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(notBefore) || !Number.isFinite(expiresAt) || !Number.isFinite(current)
      || notBefore >= expiresAt || expiresAt - notBefore > 24 * 60 * 60 * 1000
      || current < notBefore || current >= expiresAt) {
    throw new Error('Invalid schedule approval time window');
  }
  return Object.freeze(approval);
}
