import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Check } from 'typebox/value';
import { parseManifest, PointerSchema } from './protocol.ts';
import type { PackageManifest } from './protocol.ts';
import { sha256 } from '../contracts/records.ts';
export { sha256 } from '../contracts/records.ts';

export async function readRegularFile(filename: string, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Not a bounded regular file: ${filename}`);
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new Error(`File grew beyond the size limit: ${filename}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function directory(filename: string): Promise<void> {
  const stat = await lstat(filename);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${filename}`);
}

export type VerifiedPackage = { root: string; manifest: PackageManifest; manifestBytes: Buffer; manifestSha256: string };

export async function verifyPackage(packageRoot: string): Promise<VerifiedPackage> {
  await directory(packageRoot);
  const root = await realpath(packageRoot);
  await directory(path.join(root, 'objects'));
  const manifestBytes = await readRegularFile(path.join(root, 'manifest.json'), 16 * 1024 * 1024);
  const input: unknown = JSON.parse(manifestBytes.toString('utf8'));
  const manifest = parseManifest(input);
  for (const artifact of manifest.artifacts) {
    const bytes = await readRegularFile(path.join(root, 'objects', artifact.sha256));
    if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.sha256) {
      throw new Error(`Artifact content or length mismatch: ${artifact.sha256}`);
    }
  }
  return { root, manifest, manifestBytes, manifestSha256: sha256(manifestBytes) };
}

async function writeDurable(filename: string, bytes: Uint8Array | string): Promise<void> {
  const handle = await open(filename, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(filename: string): Promise<void> {
  const handle = await open(filename, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function createPackage(args: { root: string; manifest: PackageManifest; objects: ReadonlyMap<string, Uint8Array> }): Promise<VerifiedPackage> {
  const manifest = parseManifest(args.manifest);
  await mkdir(args.root, { recursive: false });
  await mkdir(path.join(args.root, 'objects'));
  for (const artifact of manifest.artifacts) {
    const bytes = args.objects.get(artifact.sha256);
    if (!bytes || bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.sha256) {
      throw new Error(`Missing or invalid source object: ${artifact.sha256}`);
    }
    await writeDurable(path.join(args.root, 'objects', artifact.sha256), bytes);
  }
  await writeDurable(path.join(args.root, 'manifest.json'), JSON.stringify(manifest));
  await syncDirectory(path.join(args.root, 'objects'));
  await syncDirectory(args.root);
  return verifyPackage(args.root);
}

export async function readCurrent(root: string): Promise<VerifiedPackage | null> {
  let bytes: Buffer;
  try { bytes = await readRegularFile(path.join(root, 'current.json'), 1024); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const pointer: unknown = JSON.parse(bytes.toString('utf8'));
  if (!Check(PointerSchema, pointer)) throw new Error('Invalid local complete-package pointer.');
  const current = await verifyPackage(path.join(root, 'packages', pointer.manifestSha256));
  if (current.manifestSha256 !== pointer.manifestSha256) throw new Error('Complete-package pointer hash mismatch.');
  return current;
}

export type ImportStage = 'after-stage-before-publish' | 'after-publish';

// This pointer publishes a complete portable copy, never an accepted database head.
// The coordinator must provide a single writer per independent artifact root.
export async function importPackage(args: {
  source: string; destination: string; checkpoint?: (stage: ImportStage) => Promise<void>;
}): Promise<VerifiedPackage> {
  const source = await verifyPackage(args.source);
  await mkdir(args.destination, { recursive: true });
  await directory(args.destination);
  const destination = await realpath(args.destination);
  if (source.root === destination || source.root.startsWith(destination + path.sep)
      || destination.startsWith(source.root + path.sep)) throw new Error('Copy roots must be independent.');
  await mkdir(path.join(destination, 'packages'), { recursive: true });
  await directory(path.join(destination, 'packages'));
  const old = await readCurrent(destination);
  if (old) assertRetainsHistory({ previous: old.manifest, next: source.manifest });
  const target = path.join(destination, 'packages', source.manifestSha256);
  try {
    const existing = await verifyPackage(target);
    if (existing.manifestSha256 !== source.manifestSha256) throw new Error('Immutable package path collision.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const staging = path.join(destination, 'packages', `staging-${randomUUID()}`);
    await mkdir(staging);
    await mkdir(path.join(staging, 'objects'));
    for (const artifact of source.manifest.artifacts) {
      // Re-read and verify staged bytes before publication, including a changed source during transfer.
      const bytes = await readRegularFile(path.join(source.root, 'objects', artifact.sha256));
      await writeDurable(path.join(staging, 'objects', artifact.sha256), bytes);
    }
    await writeDurable(path.join(staging, 'manifest.json'), source.manifestBytes);
    await verifyPackage(staging);
    await syncDirectory(path.join(staging, 'objects'));
    await syncDirectory(staging);
    await rename(staging, target);
    await syncDirectory(path.join(destination, 'packages'));
  }
  await args.checkpoint?.('after-stage-before-publish');
  const pointerTemp = path.join(destination, `pointer-${randomUUID()}.json`);
  await writeDurable(pointerTemp, JSON.stringify({ manifestSha256: source.manifestSha256 }));
  await rename(pointerTemp, path.join(destination, 'current.json'));
  await syncDirectory(destination);
  await args.checkpoint?.('after-publish');
  return verifyPackage(target);
}

export function assertRetainsHistory(args: { previous: PackageManifest; next: PackageManifest }): void {
  if (args.previous.projectId !== args.next.projectId) throw new Error('Cannot replace a different project.');
  for (const revision of args.previous.revisions) {
    const next = args.next.revisions.find((candidate) => candidate.revisionId === revision.revisionId);
    // Compare immutable metadata as well as model bytes. Branch heads may advance.
    if (!next || JSON.stringify(next) !== JSON.stringify(revision)) throw new Error(`Historical revision rewritten or omitted: ${revision.revisionId}`);
  }
  for (const artifact of args.previous.artifacts) {
    const next = args.next.artifacts.find((candidate) => candidate.sha256 === artifact.sha256);
    if (!next || JSON.stringify(next) !== JSON.stringify(artifact)) throw new Error(`Historical artifact omitted: ${artifact.sha256}`);
  }
  for (const branch of args.previous.branches) {
    if (!args.next.branches.some((candidate) => candidate.name === branch.name)) throw new Error(`Branch contribution omitted: ${branch.name}`);
  }
}

export async function copyPackageForFault(args: { source: string; destination: string; hash: string; kind: 'missing' | 'corrupt' }): Promise<void> {
  const source = await verifyPackage(args.source);
  if (!source.manifest.artifacts.some((artifact) => artifact.sha256 === args.hash)) throw new Error('Fault target is not in the package.');
  await mkdir(args.destination);
  await mkdir(path.join(args.destination, 'objects'));
  await writeFile(path.join(args.destination, 'manifest.json'), source.manifestBytes, { flag: 'wx' });
  for (const artifact of source.manifest.artifacts) {
    const target = path.join(args.destination, 'objects', artifact.sha256);
    if (artifact.sha256 !== args.hash) await copyFile(path.join(source.root, 'objects', artifact.sha256), target, constants.COPYFILE_EXCL);
    else if (args.kind === 'corrupt') await writeFile(target, 'intentionally corrupt W6 transfer', { flag: 'wx' });
  }
}
