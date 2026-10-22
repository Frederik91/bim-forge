import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { approvePackage } from './publish-request.mjs';
import { withPublisherIdentity } from './publisher-identity.mjs';
import { publishApproved } from './publisher.mjs';
import { openPublication } from './publish-store.mjs';
import { readScheduledPermit, guardScheduledRequest } from './scheduled-publication.mjs';

let store;
try {
  const { values } = parseArgs({ options: { inspect: { type: 'string' }, 'approved-sha': { type: 'string' }, 'scheduled-sha': { type: 'string' } } });
  if (Object.values(values).filter(Boolean).length !== 1) throw new Error('Select exactly one publication mode');
  if (values.inspect && !values['approved-sha']) {
    const fd = fs.openSync(values.inspect, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let bytes;
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
    const permit = () => { if (scheduled) readScheduledPermit(digest); };
    permit();
    store = openPublication({ digest, ...(scheduled ? { approvalsDir: '/var/lib/bim-forge-approvals/scheduled' } : {}) });
    const locallyPaused = () => {
      try { fs.lstatSync('/var/lib/bim-forge-approvals/PAUSED'); return true; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    };
    if (locallyPaused()) throw new Error('Publisher is locally paused');
    const key = fs.readFileSync(`${process.env.CREDENTIALS_DIRECTORY}/github-app-key`);
    permit();
    const result = await withPublisherIdentity(key, (request) => publishApproved({ bytes: store.bytes,
      approvedSha256: digest, request: guardScheduledRequest(request, permit), record: store.record, hasPendingDraftIntent: store.hasPendingDraftIntent,
      isLocallyPaused: locallyPaused }));
    store.finish({ ...result, tokenRevoked: true });
    console.log(JSON.stringify({ ...result, tokenRevoked: true }));
  }
} catch (error) {
  const recognized = /^(?:Publication|Publisher|Approved|Required|CODEOWNERS|Repository|Pinned|Created|Cannot|Unsupported|Existing|GitHub|Invalid|Previous|An earlier)/.test(error.message);
  const result = { status: 'stopped', message: recognized ? error.message : 'Publication stopped; inspect the private run ledger. No credentials were logged.' };
  try { store?.finish(result); } catch { /* Preserve an interrupted ledger for administrator recovery. */ }
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally { store?.close(); }
