import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { approvePackage } from './publish-request.ts';
import { withPublisherIdentity } from './publisher-identity.ts';
import { publishApproved } from './publisher.ts';
import { openPublication, type PublicationStore } from './publish-store.ts';
import { readScheduledPermit, guardScheduledRequest } from './scheduled-publication.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown publication failure';
}

let store: PublicationStore | undefined;
try {
  const { values } = parseArgs({ options: { inspect: { type: 'string' }, 'approved-sha': { type: 'string' }, 'scheduled-sha': { type: 'string' } } });
  if (Object.values(values).filter(Boolean).length !== 1) throw new Error('Select exactly one publication mode');
  if (values.inspect && !values['approved-sha']) {
    const fd = fs.openSync(values.inspect, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > 512 * 1024) throw new Error('Invalid package size or type');
      bytes = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
    const digest = createHash('sha256').update(bytes).digest('hex');
    const { proposal, branch } = approvePackage(bytes, digest);
    console.log(JSON.stringify({ digest, issue: proposal.issue, title: proposal.title, baseSha: proposal.baseSha,
      issueSha256: proposal.issueSha256, branch, files: proposal.files.map((file) => ({ path: file.path,
        bytes: Buffer.byteLength(file.content), sha256: createHash('sha256').update(file.content).digest('hex') })) }, null, 2));
  } else {
    if (values.inspect || process.platform !== 'linux' || !process.env.CREDENTIALS_DIRECTORY) {
      throw new Error('Use --inspect <package> or start the isolated approved-sha service on Linux');
    }
    const scheduled = Boolean(values['scheduled-sha']);
    const digest = values['scheduled-sha'] ?? values['approved-sha'];
    const permit = (): void => { if (scheduled) readScheduledPermit(digest); };
    permit();
    const publicationStore = openPublication({ digest, ...(scheduled ? { approvalsDir: '/var/lib/bim-forge-approvals/scheduled' } : {}) });
    store = publicationStore;
    const locallyPaused = (): boolean => {
      try { fs.lstatSync('/var/lib/bim-forge-approvals/PAUSED'); return true; }
      catch (error) { if (isRecord(error) && error.code === 'ENOENT') return false; throw error; }
    };
    if (locallyPaused()) throw new Error('Publisher is locally paused');
    const key = fs.readFileSync(`${process.env.CREDENTIALS_DIRECTORY}/github-app-key`);
    permit();
    const result = await withPublisherIdentity(key, (request) => publishApproved({ bytes: publicationStore.bytes,
      approvedSha256: digest, request: guardScheduledRequest(request, permit), record: publicationStore.record, hasPendingDraftIntent: publicationStore.hasPendingDraftIntent,
      isLocallyPaused: locallyPaused }));
    publicationStore.finish({ ...result, tokenRevoked: true });
    console.log(JSON.stringify({ ...result, tokenRevoked: true }));
  }
} catch (error) {
  const message = errorMessage(error);
  const recognized = /^(?:Publication|Publisher|Approved|Required|CODEOWNERS|Repository|Pinned|Created|Cannot|Unsupported|Existing|GitHub|Invalid|Previous|An earlier)/.test(message);
  const result = { status: 'stopped', message: recognized ? message : 'Publication stopped; inspect the private run ledger. No credentials were logged.' };
  try { store?.finish(result); } catch { /* Preserve an interrupted ledger for administrator recovery. */ }
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally { store?.close(); }
