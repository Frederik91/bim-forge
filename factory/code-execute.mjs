import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { readProtectedCodingFile } from './coding-store.mjs';
import { codingProfile } from './coding.mjs';

const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id ?? '') || process.getuid() === 0) throw new Error('Isolated case execution required');
const directory = `/var/lib/bim-forge-coding/cases/${id}`;
const mode = readProtectedCodingFile(`${directory}/mode`).toString('utf8').trim();
const profile = codingProfile(JSON.parse(readProtectedCodingFile(`${directory}/paths.json`)));
const entry = fs.realpathSync(`${directory}/candidate/${profile.paths[0]}`);
if (mode === 'cli') {
  const child = spawn(process.execPath, [entry], { stdio: 'inherit', shell: false,
    env: { HOME: '/tmp', PATH: '/opt/bim-forge/node/bin:/usr/bin:/bin', LANG: 'C.UTF-8' } });
  child.once('error', () => { process.exitCode = 125; });
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code;
  });
} else if (mode === 'api') {
  try {
    const input = fs.readFileSync(0);
    if (input.length > 128 * 1024) throw new Error('Oversized case');
    const module = await import(pathToFileURL(entry).href);
    if (typeof module[profile.exportName] !== 'function') throw new Error('Missing export');
    const result = module[profile.exportName](JSON.parse(input.toString('utf8')));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch { process.stderr.write(`${profile.errorText}\n`); process.exitCode = 1; }
} else throw new Error('Unknown case mode');
