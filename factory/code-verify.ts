import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCodingSpec, sha256 } from './coding.ts';
import { readProtectedCodingFile } from './coding-store.ts';
import { approvePackage } from './publish-request.ts';

export function verifyCodingCandidate(id: unknown): void {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || process.platform !== 'linux'
      || typeof process.getuid !== 'function' || process.getuid() === 0) {
    throw new Error('Credential-free verifier required');
  }
  const job = `/var/lib/bim-forge-coding/jobs/${id}`;
  const candidate = path.join(job, 'candidate');
  const spec = readCodingSpec(readProtectedCodingFile(path.join(job, 'spec.json')));
  const proposalBytes = readProtectedCodingFile(path.join(job, 'preliminary.json'), 0, 512 * 1024);
  const proposal = approvePackage(proposalBytes, sha256(proposalBytes)).proposal;
  const checkFiles = () => {
    for (const file of proposal.files) {
      if (sha256(readProtectedCodingFile(path.join(candidate, file.path))) !== sha256(file.content)) throw new Error('Candidate bytes changed');
    }
  };
  checkFiles();
  const commands: [string, string[]][] = [
    ['/opt/bim-forge/node/bin/node', ['scripts/validate-policy.ts', '--changed-files', ...proposal.files.map((file) => file.path)]],
    ['/opt/bim-forge/node/bin/npm', ['run', 'validate']],
    ['/opt/bim-forge/node/bin/npm', ['test']],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: candidate, encoding: 'utf8', timeout: 120000,
      killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      env: { PATH: '/opt/bim-forge/node/bin:/usr/bin:/bin', LANG: 'C.UTF-8',
        HOME: '/tmp', CANDIDATE_ROOT: candidate } });
    console.log(JSON.stringify({ command: path.basename(command), args, exitCode: result.status,
      stdout: typeof result.stdout === 'string' ? result.stdout.slice(-10000) : undefined,
      stderr: typeof result.stderr === 'string' ? result.stderr.slice(-2000) : undefined }));
    if (result.error || result.status !== 0) throw new Error('Fixed coding verification failed');
    checkFiles();
  }
  console.log(JSON.stringify({ status: 'supplemental-checks-passed', acceptanceSha256: sha256(JSON.stringify(spec.acceptanceCases)),
    paths: proposal.files.map((file) => file.path) }));
}
