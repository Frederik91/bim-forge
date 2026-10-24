export const MAX_SCRIPT_EXECUTIONS = 6;
export const MAX_SCRIPT_HOST_CALLS = 64;
export const MAX_SCRIPT_EVIDENCE_BYTES = 32768;

const statuses = ['completed', 'failed', 'cancelled', 'timed-out', 'resource-limit'] as const;
const dispositions = ['observation', 'proposal', 'declined', 'discarded'] as const;
const validations = ['passed', 'failed', 'not-run'] as const;
const callDispositions = [
  'completed', 'replaced', 'denied', 'unknown-method', 'invalid-arguments', 'invalid-result',
  'app-error', 'host-failure', 'host-timeout', 'response-too-large', 'revoked', 'queue-full', 'request-too-large',
] as const;

export interface ScriptExecutionEvidence {
  version: 1;
  executionId: string;
  language: 'javascript' | 'typescript';
  sourceSha256: string;
  status: typeof statuses[number];
  disposition: typeof dispositions[number];
  validation: typeof validations[number];
  contractSha256: string;
  policyVersion: string;
  runtime: { packageVersion: string; guestAbi: number; bootstrapVersion: number; artifactSha256: string };
  calls: { sequence: number; method: string; disposition: typeof callDispositions[number] }[];
  diagnostic: { code: string; message: string; line: number | null; column: number | null } | null;
}

function fail(message: string): never { throw new Error(`Invalid script evidence: ${message}`); }

function record(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected a plain record.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key))) fail('unexpected fields.');
  const result: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('accessors are unsupported.');
    result[key] = descriptor.value;
  }
  return result;
}

function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum
      || Reflect.ownKeys(value).length !== value.length + 1) fail('expected a dense bounded array.');
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('array accessors or holes are unsupported.');
    result.push(descriptor.value);
  }
  return result;
}

function readable(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum
      || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail('expected bounded readable text.');
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('expected a lowercase SHA-256 digest.');
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('expected a positive safe integer.');
  return value;
}

function choice<const T extends string>(value: unknown, choices: readonly T[]): T {
  const found = choices.find((item) => item === value);
  if (found === undefined) fail('unknown enum value.');
  return found;
}

function execution(value: unknown): ScriptExecutionEvidence {
  const item = record(value, ['version', 'executionId', 'language', 'sourceSha256', 'status', 'disposition', 'validation',
    'contractSha256', 'policyVersion', 'runtime', 'calls', 'diagnostic']);
  if (item.version !== 1) fail('unsupported version.');
  const executionId = readable(item.executionId, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(executionId)) fail('invalid execution identity.');
  const runtime = record(item.runtime, ['packageVersion', 'guestAbi', 'bootstrapVersion', 'artifactSha256']);
  let sequence = 0;
  const calls = list(item.calls, MAX_SCRIPT_HOST_CALLS).map((value): ScriptExecutionEvidence['calls'][number] => {
    const call = record(value, ['sequence', 'method', 'disposition']);
    const nextSequence = positiveInteger(call.sequence);
    if (nextSequence <= sequence) fail('host-call sequences must increase.');
    sequence = nextSequence;
    return { sequence, method: readable(call.method, 256), disposition: choice(call.disposition, callDispositions) };
  });
  let diagnostic: ScriptExecutionEvidence['diagnostic'] = null;
  if (item.diagnostic !== null) {
    const value = record(item.diagnostic, ['code', 'message', 'line', 'column']);
    diagnostic = {
      code: readable(value.code, 80), message: readable(value.message, 1000),
      line: value.line === null ? null : positiveInteger(value.line),
      column: value.column === null ? null : positiveInteger(value.column),
    };
  }
  return {
    version: 1, executionId, language: choice(item.language, ['javascript', 'typescript']),
    sourceSha256: sha256(item.sourceSha256), status: choice(item.status, statuses),
    disposition: choice(item.disposition, dispositions), validation: choice(item.validation, validations),
    contractSha256: sha256(item.contractSha256), policyVersion: readable(item.policyVersion, 128),
    runtime: {
      packageVersion: readable(runtime.packageVersion, 128), guestAbi: positiveInteger(runtime.guestAbi),
      bootstrapVersion: positiveInteger(runtime.bootstrapVersion), artifactSha256: sha256(runtime.artifactSha256),
    },
    calls, diagnostic,
  };
}

function checkBytes(executions: ScriptExecutionEvidence[]): void {
  if (new TextEncoder().encode(JSON.stringify(executions)).byteLength > MAX_SCRIPT_EVIDENCE_BYTES) {
    fail('executions exceed the 32768 UTF-8 byte limit.');
  }
}

export function parseScriptExecutionEvidence(value: unknown): ScriptExecutionEvidence {
  const parsed = execution(value);
  checkBytes([parsed]);
  return parsed;
}

export function parseScriptExecutions(value: unknown): ScriptExecutionEvidence[] {
  const parsed = list(value, MAX_SCRIPT_EXECUTIONS).map(execution);
  if (new Set(parsed.map((item) => item.executionId)).size !== parsed.length) fail('duplicate execution identity.');
  if (parsed.reduce((total, item) => total + item.calls.length, 0) > MAX_SCRIPT_HOST_CALLS) {
    fail('executions exceed the 64 host-call limit.');
  }
  checkBytes(parsed);
  return parsed;
}
