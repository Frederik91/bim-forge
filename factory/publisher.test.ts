import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  approvePackage, assertHumanGate, type PublicationProposal,
} from './publish-request.ts';
import { publishApproved } from './publisher.ts';
import { BOT, issueFingerprint } from './publish-request.ts';
import { renderChangeReview } from './change-review.ts';
import { prepareCodingPackage, type CodingSpec } from './coding.ts';
import type { PublisherRequest } from './publisher-identity.ts';

const baseSha = 'c84f6dfddb91976deda4366ce1d52a53bcf3e7c5';
const issueScope = { number: 14, title: 'Publisher qualification', body: 'Publish only approved changes.' };
const proposal: PublicationProposal = {
  version: 1, repository: 'Frederik91/bim-forge', issue: 14, issueUpdatedAt: '2026-10-21T19:30:00Z', baseSha,
  issueSha256: issueFingerprint(issueScope),
  title: 'Add a factory publication report', body: 'Related to #14. Human approval is required.',
  files: [{ path: 'docs/factory-publication.md', content: '# Publication report\n\nThe factory proposes; the maintainer approves.\n' }],
};
const bytesFor = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const digest = (bytes: string | NodeJS.ArrayBufferView): string => createHash('sha256').update(bytes).digest('hex');

test('approval binds the exact package bytes and publication identity', () => {
  const bytes = bytesFor(proposal);
  const approved = approvePackage(bytes, digest(bytes));
  assert.equal(approved.digest, digest(bytes));
  assert.equal(approved.branch, `factory/publish/issue-14-${digest(bytes).slice(0, 20)}`);
  assert.deepEqual(approved.proposal, proposal);
  assert.throws(() => approvePackage(Buffer.concat([bytes, Buffer.from('\n')]), digest(bytes)), /approval/i);
  const duplicate = Buffer.from(bytes.toString().replace('"version":1', '"version":0,"version":1'));
  assert.throws(() => approvePackage(duplicate, digest(duplicate)), /duplicate field/);
});

test('an unapproved package cannot reach GitHub', async () => {
  let requests = 0;
  await assert.rejects(publishApproved({ bytes: bytesFor(proposal), approvedSha256: '0'.repeat(64),
    request: async () => { requests += 1; throw new Error('Network should not be reached'); },
  }), /approval/i);
  assert.equal(requests, 0);
});

const repository = { full_name: 'Frederik91/bim-forge', archived: false, allow_auto_merge: false };
interface ProtectionFixture {
  required_pull_request_reviews: {
    required_approving_review_count: number;
    require_code_owner_reviews: boolean;
    dismiss_stale_reviews: boolean;
    bypass_pull_request_allowances: { users: unknown[]; teams: unknown[]; apps: { slug: string }[] };
  };
  required_status_checks: { strict: boolean; checks: { context: string; app_id: number }[] };
  enforce_admins: { enabled: boolean };
  required_conversation_resolution: { enabled: boolean };
  required_linear_history: { enabled: boolean };
  allow_force_pushes: { enabled: boolean };
  allow_deletions: { enabled: boolean };
}

const protection: ProtectionFixture = {
  required_pull_request_reviews: { required_approving_review_count: 1, require_code_owner_reviews: true,
    dismiss_stale_reviews: true, bypass_pull_request_allowances: { users: [], teams: [], apps: [] } },
  required_status_checks: { strict: true, checks: [{ context: 'Policy and repository checks', app_id: 15368 }] },
  enforce_admins: { enabled: true }, required_conversation_resolution: { enabled: true },
  required_linear_history: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
};
const policy = { version: 1, maxAutomatedPublicationFiles: 12, maxAttemptsPerIssue: 3, denylist: ['**/credentials/**', '**/secrets/**'], autoMerge: { enabled: false } };
const codeowners = '# Human ownership\n* @Frederik91\n';
const blob = (text: string): string => { const bytes = Buffer.from(text); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); };

interface FixtureCall {
  method: unknown;
  resource: unknown;
  body: unknown;
}

interface FixtureTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

interface FixtureCommit {
  sha: string;
  tree: { sha: string };
  parents: { sha: string }[];
  message?: string;
}

interface FixtureRef { object: { type: string; sha: string } }

interface FixturePullRequest {
  number: number;
  state: string;
  draft: boolean;
  title: string;
  body: string;
  user: { login: string; type: string };
  auto_merge: unknown;
  base: { ref: string; repo: { full_name: string } };
  head: { ref: string; sha: string; repo: { full_name: string } };
  html_url: string;
}

interface FixtureState {
  repository: typeof repository;
  protection: typeof protection;
  policy: typeof policy;
  codeowners: string;
  paused: boolean;
  stateText: string;
  main: string;
  package: { scripts: Record<string, string> };
  issue: typeof issueScope & { state: string; updated_at: string; pull_request?: unknown };
  trees: Map<string, FixtureTreeEntry[]>;
  commits: Map<string, FixtureCommit>;
  rulesets: { enforcement: string }[];
  ref: FixtureRef | null;
  pr: FixturePullRequest | null;
  calls: FixtureCall[];
  events: Record<string, unknown>[];
  failPrBefore: boolean;
  failPrAfter: boolean;
  sequence: number;
}

interface HookContext {
  method: unknown;
  resource: unknown;
  body: unknown;
  state: FixtureState;
}

type FixtureHook = (context: HookContext) => Promise<void> | void;

interface GithubFixture {
  state: FixtureState;
  request: PublisherRequest;
  writes: () => FixtureCall[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Fixture expected ${field}`);
  return value;
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Fixture expected ${field}`);
  return value;
}

function writeTree(api: GithubFixture, index = 0): Record<string, unknown>[] {
  const call = api.writes()[index];
  assert.ok(call);
  const body = requiredRecord(call.body, 'write body');
  assert.ok(Array.isArray(body.tree));
  return body.tree.map((entry) => requiredRecord(entry, 'write tree entry'));
}

function githubFixture(hook: FixtureHook = () => {}): GithubFixture {
  const baseTree = '1'.repeat(40);
  const state: FixtureState = { repository: structuredClone(repository), protection: structuredClone(protection), policy: structuredClone(policy),
    codeowners, paused: false, stateText: '```yaml\npaused: false\n```\n', main: baseSha,
    package: { scripts: { validate: 'node scripts/validate-policy.ts', test: 'node --test factory/coding.test.ts' } },
    issue: { ...issueScope, state: 'open', updated_at: proposal.issueUpdatedAt },
    trees: new Map<string, FixtureTreeEntry[]>([[baseTree, [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob('# BIM Forge\n') }]]]),
    commits: new Map<string, FixtureCommit>([[baseSha, { sha: baseSha, tree: { sha: baseTree }, parents: [] }]]), rulesets: [],
    ref: null, pr: null, calls: [], events: [], failPrBefore: false, failPrAfter: false, sequence: 2,
  };
  const newSha = () => (state.sequence++).toString(16).padStart(40, '0');
  const request: PublisherRequest = async (method, resource, body, allowMissing = false) => {
    state.calls.push({ method, resource, body: structuredClone(body) });
    await hook({ method, resource, body, state });
    if (typeof method !== 'string' || typeof resource !== 'string') throw new Error('Invalid fixture request');
    let result: unknown;
    if (method === 'GET') {
      if (resource === '/') result = state.repository;
      else if (resource.startsWith('/rulesets?')) result = state.rulesets;
      else if (resource === '/branches/main/protection') result = state.protection;
      else if (resource === '/git/ref/heads/main') result = { object: { type: 'commit', sha: state.main } };
      else if (resource === '/issues/14') result = state.issue;
      else if (resource.startsWith('/issues?')) result = state.paused ? [{ number: 99 }] : [];
      else if (resource.startsWith('/contents/')) {
        const path = resource.slice('/contents/'.length).split('?')[0];
        const text = path === '.github/CODEOWNERS' ? state.codeowners : path === 'policy/gate.json' ? JSON.stringify(state.policy)
          : path === 'package.json' ? JSON.stringify(state.package) : state.stateText;
        result = { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') };
      } else if (resource.startsWith('/git/commits/')) result = state.commits.get(resource.split('/').at(-1) ?? '');
      else if (resource.startsWith('/git/trees/')) result = { truncated: false, tree: state.trees.get((resource.split('/').at(-1) ?? '').split('?')[0] ?? '') };
      else if (resource.startsWith('/git/ref/heads/factory/')) {
        if (!state.ref) { assert.equal(allowMissing, true); return null; }
        result = state.ref;
      } else if (resource.startsWith('/pulls?')) result = state.pr ? [state.pr] : [];
      else if (resource === '/pulls/15') result = state.pr;
      else assert.fail(`Unexpected GET ${resource}`);
    } else {
      assert.equal(method, 'POST');
      const requestBody = requiredRecord(body, 'request body');
      if (resource === '/git/trees') {
        const baseEntries = state.trees.get(requiredString(requestBody.base_tree, 'base tree'));
        assert.ok(baseEntries);
        assert.ok(Array.isArray(requestBody.tree));
        const entries = new Map(baseEntries.map((entry) => [entry.path, entry]));
        for (const item of requestBody.tree) {
          const file = requiredRecord(item, 'tree entry');
          const path = requiredString(file.path, 'tree path');
          entries.set(path, { path, mode: requiredString(file.mode, 'tree mode'), type: requiredString(file.type, 'tree type'), sha: blob(requiredString(file.content, 'tree content')) });
        }
        const sha = newSha(); state.trees.set(sha, [...entries.values()]); result = { sha };
      } else if (resource === '/git/commits') {
        assert.ok(Array.isArray(requestBody.parents));
        const sha = newSha();
        const commit: FixtureCommit = { sha, tree: { sha: requiredString(requestBody.tree, 'commit tree') }, message: requiredString(requestBody.message, 'commit message'), parents: requestBody.parents.map((parent) => ({ sha: requiredString(parent, 'parent sha') })) };
        result = commit;
        state.commits.set(sha, commit);
      } else if (resource === '/git/refs') {
        assert.equal(state.ref, null, 'Existing branches must never be updated');
        const ref = requiredString(requestBody.ref, 'ref');
        assert.match(ref, /^refs\/heads\/factory\/publish\/issue-14-/);
        result = state.ref = { object: { type: 'commit', sha: requiredString(requestBody.sha, 'ref sha') } };
      } else if (resource === '/pulls') {
        if (state.failPrBefore) { state.failPrBefore = false; throw new Error('Simulated connection failure before PR creation'); }
        assert.equal(state.pr, null, 'A duplicate PR must not be created');
        assert.ok(state.ref);
        result = state.pr = { number: 15, state: 'open', draft: requestBody.draft === true, title: requiredString(requestBody.title, 'PR title'), body: requiredString(requestBody.body, 'PR body'),
          user: { login: BOT, type: 'Bot' }, auto_merge: null,
          base: { ref: requiredString(requestBody.base, 'PR base'), repo: { full_name: repository.full_name } },
          head: { ref: requiredString(requestBody.head, 'PR head'), sha: state.ref.object.sha, repo: { full_name: repository.full_name } },
          html_url: 'https://github.com/Frederik91/bim-forge/pull/15' };
        if (state.failPrAfter) { state.failPrAfter = false; throw new Error('Simulated lost response after PR creation'); }
      } else assert.fail(`Unexpected write ${resource}`);
    }
    return structuredClone(result);
  };
  return { state, request, writes: () => state.calls.filter((call) => call.method !== 'GET') };
}
interface PublishOverrides {
  record?: (event: Record<string, unknown>) => unknown;
  hasPendingDraftIntent?: boolean;
  isLocallyPaused?: () => boolean | Promise<boolean>;
}

const publish = (api: GithubFixture, value: unknown = proposal, extra: PublishOverrides = {}) => {
  const bytes = bytesFor(value);
  return publishApproved({ bytes, approvedSha256: digest(bytes), request: api.request,
    record: (event) => api.state.events.push(event),
    hasPendingDraftIntent: api.state.events.some((event) => event.stage === 'write-intent' && event.resource === '/pulls'), ...extra });
};

const roomDemoFiles = [
  'GLOSSARY.md', 'demo/index.html', 'demo/room.css', 'demo/room-app.ts',
  'demo/room-store.ts', 'demo/server.ts', 'demo/server.test.ts',
  'src/room-model.ts', 'src/room-model.test.ts',
].map((path) => ({ path, content: `Reviewed room demo: ${path}\r\nRoom: \u00d8st\n` }));
const roomDemoPackage = (api: GithubFixture): PublicationProposal => ({ ...proposal, files: [...roomDemoFiles, {
  path: 'package.json', content: JSON.stringify({ ...api.state.package,
    scripts: { ...api.state.package.scripts,
      test: `${api.state.package.scripts.test} src/room-model.test.ts demo/server.test.ts` } }),
}] });

test('manual exact-byte approval publishes all six demo assets, glossary, matched source tests and manifest', async () => {
  const api = githubFixture();
  const value = roomDemoPackage(api);
  const bytes = bytesFor(value);
  await assert.rejects(publishApproved({ bytes: Buffer.concat([bytes, Buffer.from('\n')]),
    approvedSha256: digest(bytes), request: api.request, record: () => {} }), /approval/i);
  assert.equal(api.state.calls.length, 0);
  const result = await publish(api, value);
  assert.equal(result.status, 'published');
  assert.equal(result.digest, digest(bytes));
  assert.ok(api.state.pr);
  assert.equal(api.state.pr.draft, true);
  assert.equal(api.state.pr.auto_merge, null);
  assert.deepEqual(writeTree(api), value.files.map((file) => ({
    ...file, mode: '100644', type: 'blob',
  })));
  const writes = api.writes().length;
  assert.equal((await publish(api, value)).reused, true);
  assert.equal(api.writes().length, writes);
});

test('manual demo publishing rejects sibling paths, nested paths, traversal, case variants and agent instructions', async () => {
  const paths = [
    'glossary.md', 'Glossary.md', 'GLOSSARY.MD', 'GLOSSARY.md.bak', 'docs/GLOSSARY.md',
    'demo/other.mjs', 'demo/index.htm', 'demo/room.html', 'demo/room-app.test.mjs',
    'demo/room-store.test.ts', 'demo/server.test.ts.bak', 'demo/server.mjs/child.mjs',
    'demo/nested/server.mjs', 'demo//server.mjs', 'demo/./server.mjs',
    'demo/../server.mjs', 'demo/../demo/server.mjs', '../demo/server.mjs', './demo/server.mjs',
    'demo\\server.mjs', '/demo/server.mjs', 'Demo/server.mjs', 'demo/Server.mjs',
    'demo/INDEX.HTML', 'demo/ROOM.CSS', 'demo/ROOM-APP.mjs', 'demo/ROOM-STORE.mjs',
    'demo/SERVER.TEST.mjs', 'demo/server.mjs\n',
    'AGENTS.md', 'CLAUDE.md', 'SKILL.md', 'demo/AGENTS.md', 'demo/agents.md',
    'demo/CLAUDE.md', 'demo/SKILL.md', 'demo/.env', 'demo/credentials/key.mjs',
    'demo/deploy.mjs', 'policy/gate.json', '.github/workflows/demo.yml',
  ];
  for (const path of paths) {
    const api = githubFixture();
    await assert.rejects(publish(api, { ...proposal, files: [{ path, content: 'no' }] }), /unsupported path/);
    assert.equal(api.state.calls.length, 0, path);
  }
});

test('demo manifest permits only matched appended tests and preserves validator and lifecycle checks', async () => {
  const baseline = githubFixture().state.package;
  const invalidScripts = [
    ...['demo/other.test.mjs', 'demo/room-store.test.mjs', 'demo/Server.test.mjs',
      './demo/server.test.ts', 'demo/nested/server.test.ts', 'demo/../demo/server.test.ts',
      'demo\\server.test.ts', 'demo/server.test.ts;echo', 'demo/server.test.ts && echo injected',
      'demo/server.test.ts | echo injected', 'demo/server.test.ts > output',
      'demo/server.test.ts $(echo injected)', 'demo/server.test.ts `echo injected`',
      '--import=demo/server.mjs', '--test-reporter=demo/server.mjs']
      .map((suffix) => ({ ...baseline.scripts, test: `${baseline.scripts.test} ${suffix}` })),
    { ...baseline.scripts, test: 'node --test demo/server.test.ts' },
    { ...baseline.scripts, test: `echo bypassed ${baseline.scripts.test} demo/server.test.ts` },
    { ...baseline.scripts, test: `${baseline.scripts.test}; demo/server.test.ts` },
    { ...baseline.scripts, test: `${baseline.scripts.test} demo/server.test.ts`, validate: 'echo bypassed' },
    ...['pretest', 'posttest', 'prevalidate', 'postvalidate', 'preinstall', 'postinstall']
      .map((name) => ({ ...baseline.scripts, test: `${baseline.scripts.test} demo/server.test.ts`, [name]: 'echo injected' })),
  ];
  for (const scripts of invalidScripts) {
    const api = githubFixture();
    const value = roomDemoPackage(api);
    const manifest = value.files.at(-1);
    assert.ok(manifest);
    manifest.content = JSON.stringify({ ...api.state.package, scripts });
    await assert.rejects(publish(api, value), /validator|lifecycle/);
    assert.equal(api.writes().length, 0);
  }
  for (const missing of ['demo/server.ts', 'demo/server.test.ts']) {
    const api = githubFixture();
    const value = roomDemoPackage(api);
    value.files = value.files.filter((file) => file.path !== missing);
    await assert.rejects(publish(api, value), /validator|lifecycle/);
    assert.equal(api.writes().length, 0);
  }
});

test('demo and glossary additions retain credential scanning, file limits and pinned denylist checks', async () => {
  for (const path of ['GLOSSARY.md', 'demo/server.ts']) {
    const api = githubFixture();
    await assert.rejects(publish(api, { ...proposal, files: [{ path,
      content: '-----BEGIN RSA ' + 'PRIVATE KEY-----' }] }), /credential/);
    assert.equal(api.state.calls.length, 0);
  }
  const api = githubFixture();
  const value = roomDemoPackage(api);
  value.files.push(...['docs/one.md', 'docs/two.md', 'docs/three.md'].map((path) => ({ path, content: 'x' })));
  assert.equal(value.files.length, 13);
  await assert.rejects(publish(api, value), /Invalid publication package/);
  assert.equal(api.state.calls.length, 0);
  for (const path of ['GLOSSARY.md', 'demo/**']) {
    const denied = githubFixture();
    denied.state.policy.denylist.push(path);
    await assert.rejects(publish(denied, roomDemoPackage(denied)), /protected path/);
    assert.equal(denied.writes().length, 0);
  }
});

test('the final published change review keeps publication hashes in collapsed evidence', async () => {
  const api = githubFixture();
  const value = { ...proposal, body: renderChangeReview({ outcome: 'Report supplied metadata.',
    why: 'Support a read-only inventory.', run: { issue: proposal.issue } }) };
  const result = await publish(api, value);
  assert.ok(api.state.pr);
  const body = api.state.pr.body;
  let depth = 0;
  const visible = body.split(/(<details>|<\/details>)/).filter((part) => {
    if (part === '<details>') { depth += 1; return false; }
    if (part === '</details>') { depth -= 1; return false; }
    return depth === 0;
  }).join('');
  assert.equal(visible.includes(result.digest), false);
  assert.equal(visible.includes(proposal.baseSha), false);
  assert.ok(body.includes(`Publication approval: \`${result.digest}\``));
  assert.ok(body.includes(`Source revision: \`${proposal.baseSha}\``));
  assert.match(visible, /Your decision/);
  const before = api.writes().length;
  assert.equal((await publish(api, value)).reused, true);
  assert.equal(api.writes().length, before);
});

test('a prepared application package publishes its matched new tests without changing validators', async () => {
  const api = githubFixture();
  const paths = ['src/model-summary.ts', 'src/model-summary.test.ts'];
  const spec: CodingSpec = { version: 1, repository: 'Frederik91/bim-forge',
    issue: { ...issueScope, updated_at: proposal.issueUpdatedAt }, baseSha, paths,
    plan: { outcome: 'Count supplied metadata', changeClass: 'read-only', paths,
      steps: ['Implement the typed JSON contract'], acceptanceChecks: ['Exercise CLI and API inputs'],
      reviewers: ['Frederik91'], questions: [] },
    acceptanceCases: [
      { mode: 'cli', name: 'cli-valid', input: '{"elements":[]}', output: { total: 0 } },
      { mode: 'cli', name: 'cli-invalid', input: '{}', output: null },
      { mode: 'api', name: 'api-valid', input: '{"elements":[]}', output: { total: 0 } },
      { mode: 'api', name: 'api-invalid', input: '{}', output: null },
    ] };
  const answer = { summary: 'Count supplied metadata without changing a model.', questions: [],
    files: paths.map((path) => ({ path, content: 'export const example = true;\n' })) };
  const prepared = prepareCodingPackage(spec, answer, policy, JSON.stringify(api.state.package));
  const result = await publish(api, prepared.proposal);
  assert.equal(result.status, 'published');
  assert.ok(api.state.pr);
  assert.equal(api.state.pr.draft, true);
  const tree = writeTree(api);
  assert.deepEqual(tree.map((file) => file.path), [...paths, 'package.json']);
  const manifestEntry = tree.at(-1);
  assert.ok(manifestEntry);
  const manifest = requiredRecord(JSON.parse(requiredString(manifestEntry.content, 'manifest content')), 'manifest');
  const scripts = requiredRecord(manifest.scripts, 'manifest scripts');
  assert.equal(scripts.validate, api.state.package.scripts.validate);
  assert.equal(scripts.test, `${api.state.package.scripts.test} src/model-summary.test.ts`);
  const before = api.writes().length;
  assert.equal((await publish(api, prepared.proposal)).reused, true);
  assert.equal(api.writes().length, before);
  for (const extra of ['src/unrelated.test.ts', 'src/model-summary.test.ts;echo',
    '../src/model-summary.test.ts', '--import=src/model-summary.ts']) {
    const other = githubFixture();
    const changed = structuredClone(prepared.proposal);
    const changedManifest = changed.files.at(-1);
    assert.ok(changedManifest);
    const pkg = requiredRecord(JSON.parse(changedManifest.content), 'changed manifest');
    const pkgScripts = requiredRecord(pkg.scripts, 'changed manifest scripts');
    pkgScripts.test = `${other.state.package.scripts.test} ${extra}`;
    changedManifest.content = JSON.stringify(pkg);
    await assert.rejects(publish(other, changed), /validator|lifecycle/);
    assert.equal(other.writes().length, 0);
  }
});

test('publishes the exact approved files to a new bot-authored draft and reuses it without writes', async () => {
  const api = githubFixture();
  const events: Record<string, unknown>[] = [];
  const result = await publish(api, proposal, { record: (event) => events.push(event) });
  assert.equal(result.pullRequestUrl, 'https://github.com/Frederik91/bim-forge/pull/15');
  assert.equal(result.reused, false);
  assert.ok(api.state.pr);
  assert.equal(api.state.pr.draft, true);
  assert.deepEqual(api.writes().map((call) => call.resource), ['/git/trees', '/git/commits', '/git/refs', '/pulls']);
  const proposalFile = proposal.files[0];
  assert.ok(proposalFile);
  assert.deepEqual(writeTree(api)[0], { path: 'docs/factory-publication.md', content: proposalFile.content, mode: '100644', type: 'blob' });
  assert.equal(events.at(-1)?.stage, 'draft-observed');
  const writes = api.writes().length;
  const repeated = await publish(api);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.commitSha, result.commitSha);
  assert.equal(api.writes().length, writes);
});

test('rejects unsupported paths, operations, duplicate files, credentials, and oversized packages before network access', async () => {
  const invalid = [
    { ...proposal, repository: 'another/project' }, { ...proposal, command: 'run something' },
    ...['.github/workflows/ci.yml', 'policy/gate.json', 'STATE.md', '../docs/a.md', 'docs/../a.md', 'docs//a.md', 'factory/agents/agent.mjs']
      .map((path) => ({ ...proposal, files: [{ path, content: 'no' }] })),
    { ...proposal, files: [{ ...proposal.files[0], mode: '120000' }] },
    { ...proposal, files: [{ ...proposal.files[0], content: null }] },
    { ...proposal, files: [proposal.files[0], proposal.files[0]] },
    { ...proposal, files: Array.from({ length: 13 }, (_, index) => ({ path: `docs/file-${index}.md`, content: 'x' })) },
    { ...proposal, body: '-----BEGIN RSA ' + 'PRIVATE KEY-----' },
    { ...proposal, files: [{ path: 'docs/a.md', content: 'x'.repeat(65537) }] },
  ];
  for (const value of invalid) {
    const api = githubFixture();
    await assert.rejects(publish(api, value));
    assert.equal(api.state.calls.length, 0);
  }
});

test('missing human approval, code ownership, trusted CI, or non-bypass protection refuses all writes', async () => {
  const cases: ((state: FixtureState) => void)[] = [
    (state) => { state.protection.required_pull_request_reviews.required_approving_review_count = 0; },
    (state) => { state.protection.required_pull_request_reviews.require_code_owner_reviews = false; },
    (state) => { state.protection.required_pull_request_reviews.dismiss_stale_reviews = false; },
    (state) => { state.protection.required_pull_request_reviews.bypass_pull_request_allowances.apps = [{ slug: BOT }]; },
    (state) => { state.protection.required_status_checks.checks[0].app_id = 1; },
    (state) => { state.protection.enforce_admins.enabled = false; },
    (state) => { state.protection.allow_force_pushes.enabled = true; },
    (state) => { state.repository.allow_auto_merge = true; },
    (state) => { state.codeowners = '* @someone-else\n'; },
    (state) => { state.codeowners += 'docs/** @someone-else\n'; },
    (state) => { state.rulesets = [{ enforcement: 'active' }]; },
  ];
  for (const change of cases) {
    const api = githubFixture(); change(api.state);
    await assert.rejects(publish(api));
    assert.equal(api.writes().length, 0);
  }
  assert.doesNotThrow(() => assertHumanGate(repository, protection, codeowners));
});

test('stale scope, pause signals, or protected paths refuse all writes', async () => {
  const cases: ((state: FixtureState) => void)[] = [
    (state) => { state.main = 'a'.repeat(40); },
    (state) => { state.issue.state = 'closed'; },
    (state) => { state.issue.pull_request = {}; },
    (state) => { state.issue.updated_at = '2026-10-21T20:00:00Z'; },
    (state) => { state.issue.body = 'Different scope within the same timestamp second'; },
    (state) => { state.paused = true; },
    (state) => { state.stateText = 'paused: true\n'; },
    (state) => { state.stateText = 'paused: false\npaused: false\n'; },
    (state) => { state.policy.denylist = ['docs/**']; },
  ];
  for (const change of cases) {
    const api = githubFixture(); change(api.state);
    await assert.rejects(publish(api));
    assert.equal(api.writes().length, 0);
  }
  const api = githubFixture();
  await assert.rejects(publish(api, proposal, { isLocallyPaused: () => true }), /paused/);
  assert.equal(api.writes().length, 0);
});

test('a branch-only partial publication resumes without rewriting the branch', async () => {
  const api = githubFixture(({ method, resource, state }) => {
    if (method === 'POST' && resource === '/git/refs') state.paused = true;
  });
  await assert.rejects(publish(api), /pause/);
  assert.ok(api.state.ref);
  const original = api.state.ref.object.sha;
  api.state.paused = false;
  const result = await publish(api);
  assert.equal(result.commitSha, original);
  assert.equal(api.writes().filter((call) => call.resource === '/git/refs').length, 1);
  assert.equal(result.reused, true);
});

test('a lost PR response reconciles the existing draft instead of posting another', async () => {
  const api = githubFixture(); api.state.failPrAfter = true;
  await assert.rejects(publish(api), /Simulated/);
  const result = await publish(api);
  assert.equal(result.reused, true);
  assert.equal(api.writes().filter((call) => call.resource === '/pulls').length, 1);
});

test('unexpected branch contents or a changed PR fail closed without repair writes', async () => {
  const changes: ((state: FixtureState) => void)[] = [
    (state) => { assert.ok(state.ref); const commit = state.commits.get(state.ref.object.sha); assert.ok(commit); commit.message = 'unapproved'; },
    (state) => { assert.ok(state.pr); state.pr.draft = false; },
    (state) => { assert.ok(state.pr); state.pr.state = 'closed'; },
    (state) => { assert.ok(state.pr); state.pr.user.login = 'Frederik91'; },
    (state) => { assert.ok(state.pr); state.pr.body = 'changed'; },
    (state) => { assert.ok(state.pr); state.pr.base.ref = 'another-base'; },
  ];
  for (const change of changes) {
    const api = githubFixture(); await publish(api); change(api.state);
    const writes = api.writes().length;
    await assert.rejects(publish(api));
    assert.equal(api.writes().length, writes);
  }
});

test('pause activated after object creation prevents later branch or PR publication', async () => {
  let mutated = false;
  const api = githubFixture(({ method, resource, state }) => {
    if (method === 'POST' && resource === '/git/trees') mutated = true;
    else if (mutated) state.paused = true;
  });
  await assert.rejects(publish(api), /pause/);
  assert.equal(api.state.ref, null);
  assert.equal(api.state.pr, null);
  assert.deepEqual(api.writes().map((call) => call.resource), ['/git/trees']);
});

test('symlink parents cannot be used for publishing', async () => {
  const api = githubFixture();
  const tree = api.state.trees.get('1'.repeat(40));
  assert.ok(tree);
  tree.push({ path: 'docs', mode: '120000', type: 'blob', sha: '9'.repeat(40) });
  await assert.rejects(publish(api), /directory/);
  assert.equal(api.writes().length, 0);
});

test('an unresolved draft intent permits discovery but never another draft POST', async () => {
  const api = githubFixture(); api.state.failPrBefore = true;
  await assert.rejects(publish(api));
  const writes = api.writes().length;
  await assert.rejects(publish(api, proposal, { hasPendingDraftIntent: true }), /uncertain/);
  assert.equal(api.writes().length, writes);
});
