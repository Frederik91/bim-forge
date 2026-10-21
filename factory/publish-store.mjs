import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { approvePackage } from './publish-request.mjs';

export function openPublication({ digest, approvalsDir = '/var/lib/bim-forge-approvals',
  ledgerDir = '/var/lib/bim-forge-publisher', ownerUid = 0 }) {
  if (!/^[a-f0-9]{64}$/.test(digest ?? '')) throw new Error('Publication approval digest is invalid');
  const directory = fs.lstatSync(approvalsDir);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== ownerUid || (directory.mode & 0o022)) {
    throw new Error('Approval directory must be protected and owned by the administrator');
  }
  const filename = path.join(approvalsDir, `${digest}.json`);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== ownerUid || (stat.mode & 0o022) || stat.nlink !== 1 || stat.size > 512 * 1024) {
      throw new Error('Approved package is not a protected regular file');
    }
    bytes = fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  const approved = approvePackage(bytes, digest);
  const ledger = fs.lstatSync(ledgerDir);
  if (!ledger.isDirectory() || ledger.isSymbolicLink() || (ledger.mode & 0o077)) throw new Error('Publication ledger must be private');
  const lock = path.join(ledgerDir, 'publisher.lock');
  let lockDescriptor;
  try { lockDescriptor = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Publisher is busy or interrupted; administrator recovery is required');
    throw error;
  }
  const runId = randomUUID();
  const logPath = path.join(ledgerDir, `${digest}.jsonl`);
  const issuePath = path.join(ledgerDir, `issue-${approved.proposal.issue}.json`);
  const syncDirectory = () => { const fd = fs.openSync(ledgerDir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
  const append = (event) => {
    const fd = fs.openSync(logPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify({ runId, at: new Date().toISOString(), ...event })}\n`); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    syncDirectory();
  };
  const writeBudget = (budget) => {
    const temporary = `${issuePath}.${runId}.pending`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(budget)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, issuePath); syncDirectory();
  };
  try {
    fs.writeFileSync(lockDescriptor, JSON.stringify({ runId, pid: process.pid, digest }));
    fs.fsyncSync(lockDescriptor); syncDirectory();
    if (fs.existsSync(logPath) && fs.lstatSync(logPath).size > 8 * 1024 * 1024) throw new Error('Publication history exceeds its review limit');
    const prior = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
    const budget = fs.existsSync(issuePath) ? JSON.parse(fs.readFileSync(issuePath, 'utf8')) : { failures: 0 };
    if (!Number.isSafeInteger(budget.failures) || budget.failures < 0 || budget.failures > 3) throw new Error('Publication attempt ledger is invalid');
    if (budget.uncertainDigest && budget.uncertainDigest !== digest) throw new Error('An earlier issue publication is unresolved; administrator reconciliation is required');
    let mutationStarted = false;
    let finished = false;
    let attemptLimit = 0;
    append({ stage: 'started', digest, issue: approved.proposal.issue });
    return {
      bytes, hasPendingDraftIntent: budget.uncertainDigest === digest || prior.some((event) => event.stage === 'write-intent' && event.resource === '/pulls'),
      record(event) {
        if (event.stage === 'approved') {
          if (!Number.isInteger(event.attemptLimit) || event.attemptLimit < 1 || event.attemptLimit > 3) throw new Error('Publication attempt policy is invalid');
          attemptLimit = event.attemptLimit;
        }
        if (event.stage === 'write-intent') {
          if (attemptLimit === 0 || budget.failures >= attemptLimit) throw new Error('Publication issue attempt limit reached');
          mutationStarted = true;
          if (event.resource === '/pulls') { budget.uncertainDigest = digest; writeBudget(budget); }
        }
        append(event);
      },
      finish(result) {
        if (finished) throw new Error('Publication run has already finished');
        if (result.status !== 'published' && mutationStarted) { budget.failures += 1; writeBudget(budget); }
        if (result.status === 'published' && budget.uncertainDigest) { delete budget.uncertainDigest; writeBudget(budget); }
        append({ stage: 'finished', result }); finished = true;
      },
      close() { fs.closeSync(lockDescriptor); fs.unlinkSync(lock); syncDirectory(); },
    };
  } catch (error) { fs.closeSync(lockDescriptor); fs.unlinkSync(lock); syncDirectory(); throw error; }
}
