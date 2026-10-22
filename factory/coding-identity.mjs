import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256 } from './coding.mjs';

const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 10000,
  maxBuffer: 256 * 1024, env: { PATH: '/usr/bin:/bin', LANG: 'C', HOME: '/nonexistent' } }).trim();
const dummy = '00000000-0000-0000-0000-000000000000';
export const deploymentUnits = Object.freeze(['bim-forge-code-generate@.service', 'bim-forge-code-case@.service',
  'bim-forge-code-verify@.service', 'bim-forge-publish@.service', 'bim-forge-scheduled-publish@.service',
  'bim-forge-schedule.service', 'bim-forge-schedule.timer']);

export function assertEffectiveUnit(state, filename) {
  if (state.LoadState !== 'loaded' || state.FragmentPath !== filename || state.DropInPaths !== ''
      || state.NeedDaemonReload !== 'no') throw new Error('Unsupported effective unit or pending daemon reload');
}

export function assertUnitDeployment(unit) {
  const match = /^(bim-forge-code-(?:generate|case|verify)|bim-forge-scheduled-publish)@([a-f0-9-]+)\.service$/.exec(unit);
  if (!match || !(match[1] === 'bim-forge-scheduled-publish' ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/).test(match[2])) {
    throw new Error('Unsupported exact service instance');
  }
  const filename = `/etc/systemd/system/${match[1]}@.service`;
  assertImmutableAncestors(filename);
  const state = Object.fromEntries(command('/usr/bin/systemctl', ['show', unit,
    '-p', 'LoadState', '-p', 'FragmentPath', '-p', 'DropInPaths', '-p', 'NeedDaemonReload'])
    .split('\n').map((line) => { const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)]; }));
  assertEffectiveUnit(state, filename);
}

export function assertImmutableAncestors(filename, ownerUid = 0) {
  let current = filename;
  while (true) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || stat.uid !== ownerUid || (stat.mode & 0o022)) {
      throw new Error(`Mutable or linked trusted path: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

// Hash a complete installed tree, including internal link names and their targets.
// External links, special files, writable ancestors and oversized trees fail closed.
export function measureTree(directory, { ownerUid = 0, checkAncestors = true } = {}) {
  if (checkAncestors) assertImmutableAncestors(directory, ownerUid);
  const entries = []; let total = 0;
  const visit = (relative) => {
    if (entries.length >= 20000) throw new Error('Trusted tree exceeds its file limit');
    const filename = path.join(directory, relative);
    const stat = fs.lstatSync(filename);
    if (stat.uid !== ownerUid || (!stat.isSymbolicLink() && (stat.mode & 0o022))) throw new Error('Mutable trusted tree');
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(filename);
      if (!target.startsWith(`${directory}${path.sep}`)) throw new Error('Trusted link escapes its closure');
      entries.push([relative, 'link', fs.readlinkSync(filename)]);
    } else if (stat.isDirectory()) {
      entries.push([relative, 'directory', stat.mode & 0o777]);
      for (const name of fs.readdirSync(filename).sort()) visit(path.join(relative, name));
    } else if (stat.isFile() && stat.nlink === 1) {
      total += stat.size;
      if (total > 768 * 1024 * 1024 || stat.size > 256 * 1024 * 1024) throw new Error('Trusted tree exceeds its byte limit');
      entries.push([relative, stat.mode & 0o777, sha256(fs.readFileSync(filename))]);
    } else throw new Error('Unsupported trusted tree entry');
  };
  visit('');
  return { sha256: sha256(JSON.stringify(entries)), entries: entries.length, bytes: total };
}

export function measureDeployment() {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Deployment measurement requires the VM administrator');
  const release = fs.realpathSync('/opt/bim-forge/coding-current');
  if (!/^\/opt\/bim-forge\/releases\/[a-zA-Z0-9-]+$/.test(release)
      || fs.realpathSync('/opt/bim-forge/publisher-current') !== release) throw new Error('Coding and publishing need the same reviewed release');
  assertImmutableAncestors('/opt/bim-forge');
  for (const alias of ['coding-current', 'publisher-current']) {
    const stat = fs.lstatSync(`/opt/bim-forge/${alias}`);
    if (!stat.isSymbolicLink() || stat.uid !== 0) throw new Error('Unsupported release alias');
  }
  const node = fs.realpathSync('/opt/bim-forge/node');
  const nodeAlias = fs.lstatSync('/opt/bim-forge/node');
  if ((!nodeAlias.isSymbolicLink() && !nodeAlias.isDirectory()) || nodeAlias.uid !== 0
      || !/^\/opt\/bim-forge\/(?:node|runtime\/node-v\d+\.\d+\.\d+-linux-x64)$/.test(node)
      || fs.realpathSync(process.execPath) !== `${node}/bin/node`
      || fs.realpathSync(fileURLToPath(new URL('.', import.meta.url))) !== `${release}/factory`) {
    throw new Error('Unsupported installed Node alias or running controller');
  }
  // The existing generator hardcodes this installation. Its private auth is NOT read.
  assertImmutableAncestors('/var/lib/bim-forge/tools');
  const trees = [release, node, '/var/lib/bim-forge/tools']
    .map((directory) => [directory, measureTree(directory)]);
  const properties = ['LoadState', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'Type', 'User', 'Group',
    'NoNewPrivileges', 'ProtectSystem', 'ProtectHome', 'PrivateTmp', 'PrivateDevices', 'ProtectKernelTunables',
    'ProtectKernelModules', 'ProtectControlGroups', 'RestrictSUIDSGID', 'RestrictAddressFamilies',
    'CapabilityBoundingSet', 'ReadWritePaths', 'ReadOnlyPaths', 'InaccessiblePaths', 'MemoryMax', 'CPUQuotaPerSecUSec',
    'TasksMax', 'TimeoutStartUSec', 'TimeoutStopUSec', 'TimeoutStartFailureMode', 'KillMode', 'KillSignal',
    'Restart', 'RemainAfterExit', 'Environment', 'WorkingDirectory', 'LoadCredential', 'DynamicUser',
    'PrivateNetwork', 'TemporaryFileSystem', 'BindReadOnlyPaths'];
  const units = deploymentUnits.map((name) => {
    const filename = `/etc/systemd/system/${name}`;
    assertImmutableAncestors(filename);
    const target = name.replace('@.', `@${dummy}.`);
    const state = Object.fromEntries(command('/usr/bin/systemctl', ['show', target,
      ...properties.flatMap((property) => ['-p', property])]).split('\n').map((line) => {
      const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
    }));
    assertEffectiveUnit(state, filename);
    return [name, sha256(fs.readFileSync(filename)), state];
  });
  // Ubuntu's root-managed OS/toolchain is the trusted base, not an attested OS image.
  // Record the binaries and dynamically linked libraries used by the controller.
  const binaries = ['/usr/bin/git', '/usr/bin/systemctl', '/usr/bin/journalctl', '/usr/bin/dash', '/opt/bim-forge/node/bin/node'];
  const files = new Set(binaries.map((file) => fs.realpathSync(file)));
  for (const binary of binaries) {
    const dependencies = command('/usr/bin/ldd', [binary]);
    if (/not found/.test(dependencies)) throw new Error('Missing runtime dependency');
    for (const match of dependencies.matchAll(/(?:=>\s*)?(\/[^\s()]+)/g)) files.add(fs.realpathSync(match[1]));
  }
  const runtime = [...files].sort().map((file) => {
    assertImmutableAncestors(file);
    return [file, sha256(fs.readFileSync(file))];
  });
  const evidence = { version: 1, release, node, trees, units, runtime, systemd: command('/usr/bin/systemctl', ['--version']).split('\n')[0] };
  return { sha256: sha256(JSON.stringify(evidence)), evidence };
}
