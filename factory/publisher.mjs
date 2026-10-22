import { createHash } from 'node:crypto';
import { approvePackage, assertHumanGate, assertChangePolicy, issueFingerprint, BOT, REPOSITORY } from './publish-request.mjs';

export async function publishApproved({ bytes, approvedSha256, request, record,
  isLocallyPaused = () => false, hasPendingDraftIntent = false }) {
  const { proposal, digest, branch } = approvePackage(bytes, approvedSha256);
  if (typeof record !== 'function') throw new Error('Publication requires an audit recorder');
  const blobSha = (content) => {
    const body = Buffer.from(content);
    return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  };
  const readText = async (path) => {
    const file = await request('GET', `/contents/${path}?ref=${proposal.baseSha}`);
    if (file?.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('Pinned control file is unavailable');
    const bytes = Buffer.from(file.content, 'base64');
    if (bytes.length > 64 * 1024) throw new Error('Pinned control file is too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
  const codeowners = await readText('.github/CODEOWNERS');
  const policy = JSON.parse(await readText('policy/gate.json'));
  assertChangePolicy(proposal, policy);
  const packageChange = proposal.files.find((file) => file.path === 'package.json');
  if (packageChange) {
    const baseline = JSON.parse(await readText('package.json'));
    const candidate = JSON.parse(packageChange.content);
    if (candidate.scripts?.validate !== baseline.scripts?.validate ||
        Object.keys(candidate.scripts ?? {}).some((name) => /^(?:pre|post)/.test(name)) ||
        !candidate.scripts?.test?.startsWith(`${baseline.scripts.test} `) ||
        !candidate.scripts.test.slice(baseline.scripts.test.length).trim().split(/\s+/)
          .every((file) => /^factory\/[a-z0-9.-]+\.test\.mjs$/.test(file)
            || ((/^src\/[a-z0-9]+(?:-[a-z0-9]+)*\.test\.mjs$/.test(file) || file === 'demo/server.test.mjs')
              && proposal.files.some((item) => item.path === file)
              && proposal.files.some((item) => item.path === file.replace(/\.test\.mjs$/, '.mjs'))))) {
      throw new Error('Publication would replace a validator or add unsupported lifecycle commands');
    }
  }
  const preflight = async () => {
    if (await isLocallyPaused()) throw new Error('Publisher is locally paused');
    const main = await request('GET', '/git/ref/heads/main');
    if (main?.object?.type !== 'commit' || main.object.sha !== proposal.baseSha) throw new Error('Approved main revision is stale');
    const repository = await request('GET', '/');
    const protection = await request('GET', '/branches/main/protection');
    assertHumanGate(repository, protection, codeowners);
    const rulesets = await request('GET', '/rulesets?includes_parents=true&per_page=100');
    if (!Array.isArray(rulesets) || rulesets.length >= 100 || rulesets.some((rule) => rule.enforcement !== 'disabled')) {
      throw new Error('Unsupported repository rulesets require operator review');
    }
    const issue = await request('GET', `/issues/${proposal.issue}`);
    if (issue?.number !== proposal.issue || issue.state !== 'open' || issue.pull_request ||
        issue.updated_at !== proposal.issueUpdatedAt || issueFingerprint(issue) !== proposal.issueSha256) {
      throw new Error('Approved issue is closed, changed, or not an issue');
    }
    const paused = await request('GET', '/issues?state=open&labels=loop-pause-all&per_page=1');
    if (!Array.isArray(paused) || paused.length) throw new Error('Repository pause signal is active or unknown');
    const state = await readText('STATE.md');
    const flags = [...state.matchAll(/^\s*paused:\s*(true|false)\s*$/gm)];
    if (flags.length !== 1 || flags[0][1] !== 'false') throw new Error('Repository pause state is active or unknown');
  };
  await preflight();
  await record({ stage: 'approved', digest, issue: proposal.issue, baseSha: proposal.baseSha, branch,
    attemptLimit: policy.maxAttemptsPerIssue, paths: proposal.files.map((file) => file.path) });
  const mutate = async (resource, body) => {
    await preflight();
    await record({ stage: 'write-intent', resource, digest, branch });
    const response = await request('POST', resource, body);
    await record({ stage: 'write-observed', resource, digest, branch });
    return response;
  };
  const readCommit = async (sha) => {
    if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('GitHub returned an invalid commit');
    const commit = await request('GET', `/git/commits/${sha}`);
    if (!/^[a-f0-9]{40}$/.test(commit?.tree?.sha ?? '')) throw new Error('GitHub returned an invalid commit tree');
    return commit;
  };
  const readTree = async (sha) => {
    const tree = await request('GET', `/git/trees/${sha}?recursive=1`);
    if (tree?.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 5000) throw new Error('Cannot verify the complete Git tree');
    const entries = new Map();
    for (const entry of tree.tree) {
      if (typeof entry.path !== 'string' || entries.has(entry.path) || !/^[a-f0-9]{40}$/.test(entry.sha ?? '')) throw new Error('Invalid Git tree inventory');
      entries.set(entry.path, entry);
    }
    return entries;
  };
  const base = await readCommit(proposal.baseSha);
  const expected = await readTree(base.tree.sha);
  for (const file of proposal.files) {
    const previous = expected.get(file.path);
    if (previous && (previous.type !== 'blob' || previous.mode !== '100644')) throw new Error('Unsupported existing file mode or object');
    if ([...expected.keys()].some((path) => path !== file.path && path.toLowerCase() === file.path.toLowerCase())) throw new Error('Publication path has a case collision');
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = expected.get(segments.slice(0, index).join('/'));
      if (ancestor && ancestor.type !== 'tree') throw new Error('Publication parent is not a directory');
    }
    const sha = blobSha(file.content);
    if (previous?.sha === sha) throw new Error('Publication includes an unchanged file');
    expected.set(file.path, { path: file.path, type: 'blob', mode: '100644', sha });
  }
  const leaves = (inventory) => [...inventory.values()].filter((entry) => entry.type !== 'tree')
    .map(({ path, mode, type, sha }) => JSON.stringify([path, mode, type, sha])).sort().join('\n');
  const expectedLeaves = leaves(expected);
  const message = `${proposal.title}\n\nBIM Forge publication ${digest}`;
  const verifyCommit = async (sha) => {
    const commit = await readCommit(sha);
    if (commit.parents?.length !== 1 || commit.parents[0].sha !== proposal.baseSha || commit.message !== message ||
        leaves(await readTree(commit.tree.sha)) !== expectedLeaves) throw new Error('Existing publication branch does not match the approved package');
  };
  const refResource = `/git/ref/heads/${branch}`;
  let ref = await request('GET', refResource, undefined, true);
  let reused = Boolean(ref);
  if (!ref) {
    if (hasPendingDraftIntent) throw new Error('Previous publication is uncertain; the approved branch is missing');
    const tree = await mutate('/git/trees', { base_tree: base.tree.sha,
      tree: proposal.files.map(({ path, content }) => ({ path, mode: '100644', type: 'blob', content })) });
    if (!/^[a-f0-9]{40}$/.test(tree?.sha ?? '') || leaves(await readTree(tree.sha)) !== expectedLeaves) throw new Error('Created tree differs from approved content');
    const commit = await mutate('/git/commits', { message, tree: tree.sha, parents: [proposal.baseSha] });
    await verifyCommit(commit?.sha);
    try {
      await mutate('/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
    } catch (error) {
      // A create-only collision may be the same request finishing after a timeout.
      if (error.status !== 422) throw error;
    }
    ref = await request('GET', refResource);
  }
  if (ref?.object?.type !== 'commit') throw new Error('Publication branch is not a commit');
  const commitSha = ref.object.sha;
  await verifyCommit(commitSha);
  await preflight();
  const body = `${proposal.body}\n\n<details>\n<summary>Publication identity</summary>\n\nRelated issue: #${proposal.issue}\nPublication approval: \`${digest}\`\nSource revision: \`${proposal.baseSha}\`\nHuman approval required. No automatic merge.\n\n</details>\n`;
  const query = `/pulls?state=all&head=${encodeURIComponent(`Frederik91:${branch}`)}&per_page=100`;
  const findPr = async () => {
    const matches = await request('GET', query);
    if (!Array.isArray(matches) || matches.length > 1) throw new Error('Ambiguous publication PR state');
    return matches[0];
  };
  let pr = await findPr();
  if (pr) reused = true;
  else {
    if (hasPendingDraftIntent) throw new Error('Previous draft creation is uncertain; operator reconciliation is required');
    try { pr = await mutate('/pulls', { title: proposal.title, body, base: 'main', head: branch, draft: true, maintainer_can_modify: false }); }
    catch (error) {
      if (error.status !== 422) throw error;
      pr = await findPr();
      reused = true;
    }
  }
  if (!Number.isSafeInteger(pr?.number)) throw new Error('Publication did not return a PR');
  pr = await request('GET', `/pulls/${pr.number}`);
  const url = `https://github.com/${REPOSITORY}/pull/${pr.number}`;
  if (pr.state !== 'open' || pr.draft !== true || pr.user?.login !== BOT || pr.user?.type !== 'Bot' ||
      pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== REPOSITORY || pr.head?.ref !== branch ||
      pr.head?.repo?.full_name !== REPOSITORY || pr.head?.sha !== commitSha || pr.title !== proposal.title ||
      pr.body !== body || pr.html_url !== url || pr.auto_merge) throw new Error('Publication PR does not match the approved draft');
  await record({ stage: 'draft-observed', digest, branch, commitSha, pullRequestUrl: url });
  await preflight();
  return { status: 'published', digest, issue: proposal.issue, branch, commitSha, pullRequestUrl: url, reused };
}
