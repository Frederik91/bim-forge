import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';

const ERROR = 'Invalid schedule snapshot';
const KEYS = [
  'enabled', 'paused', 'scopeApproved', 'activeRun',
  'attemptsToday', 'dailyLimit',
];
const MAX_BYTES = 4096;

function invalid() {
  return new Error(ERROR);
}

export function checkSchedule(snapshot) {
  try {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw invalid();
    }
    const keys = Reflect.ownKeys(snapshot);
    if (keys.length !== KEYS.length || keys.some((key) => !KEYS.includes(key))) {
      throw invalid();
    }
    const values = Object.create(null);
    for (const key of KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid();
      values[key] = descriptor.value;
    }
    for (const key of KEYS.slice(0, 4)) {
      if (typeof values[key] !== 'boolean') throw invalid();
    }
    if (!Number.isSafeInteger(values.attemptsToday) ||
        values.attemptsToday < 0 || values.attemptsToday > 1000 ||
        !Number.isSafeInteger(values.dailyLimit) ||
        values.dailyLimit < 1 || values.dailyLimit > 3) {
      throw invalid();
    }
    if (!values.enabled) return { eligible: false, reason: 'disabled' };
    if (values.paused) return { eligible: false, reason: 'paused' };
    if (!values.scopeApproved) return { eligible: false, reason: 'scope-not-approved' };
    if (values.activeRun) return { eligible: false, reason: 'busy' };
    if (values.attemptsToday >= values.dailyLimit) {
      return { eligible: false, reason: 'daily-limit' };
    }
    return { eligible: true, reason: 'ready' };
  } catch {
    throw invalid();
  }
}

async function main() {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw invalid();
      chunks.push(chunk);
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(Buffer.concat(chunks, bytes));
    const result = checkSchedule(JSON.parse(text));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${ERROR}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
