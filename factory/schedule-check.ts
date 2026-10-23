import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';

type ScheduleReason = 'disabled' | 'paused' | 'scope-not-approved' | 'busy' | 'daily-limit' | 'ready';

export interface ScheduleReport {
  eligible: boolean;
  reason: ScheduleReason;
}

const ERROR = 'Invalid schedule snapshot';
const KEYS = ['enabled', 'paused', 'scopeApproved', 'activeRun', 'attemptsToday', 'dailyLimit'];
const KEY_SET = new Set<string>(KEYS);
const MAX_BYTES = 4096;

function invalid(): Error {
  return new Error(ERROR);
}

function ownDataValue(snapshot: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid();
  return descriptor.value;
}

export function checkSchedule(snapshot: unknown): ScheduleReport {
  try {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw invalid();
    const keys = Reflect.ownKeys(snapshot);
    if (keys.length !== KEYS.length || keys.some((key) => typeof key !== 'string' || !KEY_SET.has(key))) throw invalid();
    const enabled = ownDataValue(snapshot, 'enabled');
    const paused = ownDataValue(snapshot, 'paused');
    const scopeApproved = ownDataValue(snapshot, 'scopeApproved');
    const activeRun = ownDataValue(snapshot, 'activeRun');
    const attemptsToday = ownDataValue(snapshot, 'attemptsToday');
    const dailyLimit = ownDataValue(snapshot, 'dailyLimit');
    if (typeof enabled !== 'boolean' || typeof paused !== 'boolean'
        || typeof scopeApproved !== 'boolean' || typeof activeRun !== 'boolean') throw invalid();
    if (typeof attemptsToday !== 'number' || !Number.isSafeInteger(attemptsToday)
        || attemptsToday < 0 || attemptsToday > 1000
        || typeof dailyLimit !== 'number' || !Number.isSafeInteger(dailyLimit)
        || dailyLimit < 1 || dailyLimit > 3) throw invalid();
    if (!enabled) return { eligible: false, reason: 'disabled' };
    if (paused) return { eligible: false, reason: 'paused' };
    if (!scopeApproved) return { eligible: false, reason: 'scope-not-approved' };
    if (activeRun) return { eligible: false, reason: 'busy' };
    if (attemptsToday >= dailyLimit) return { eligible: false, reason: 'daily-limit' };
    return { eligible: true, reason: 'ready' };
  } catch {
    throw invalid();
  }
}

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      if (!Buffer.isBuffer(chunk)) throw invalid();
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw invalid();
      chunks.push(chunk);
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes));
    const result = checkSchedule(JSON.parse(text));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${ERROR}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
