import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { FixtureSchema, parseFixture } from '../fixtures/fixture.ts';
import { PackageSchema, Sha256Schema, parseManifest } from './protocol.ts';
import { readCurrent, readRegularFile, sha256 } from './package.ts';

const text = Type.String({ minLength: 1 });
export const CopyExportSchema = Type.Object({ format: Type.Literal('w6-independent-copy-export-v1'),
  manifestSha256: Sha256Schema, manifestBytesBase64: text, manifest: PackageSchema,
  models: Type.Array(Type.Object({ revisionId: text, modelSha256: Sha256Schema, bytesBase64: text,
    fixture: FixtureSchema }, { additionalProperties: false })),
}, { additionalProperties: false });
export type CopyExport = Static<typeof CopyExportSchema>;

export function parseCopyExport(input: unknown): CopyExport {
  if (!Check(CopyExportSchema, input)) throw new Error('Invalid independent copy data export.');
  const manifest = parseManifest(input.manifest);
  const manifestBytes = Buffer.from(input.manifestBytesBase64, 'base64');
  const rawManifest: unknown = JSON.parse(manifestBytes.toString('utf8'));
  if (sha256(manifestBytes) !== input.manifestSha256 || JSON.stringify(parseManifest(rawManifest)) !== JSON.stringify(manifest)) {
    throw new Error('Exported manifest bytes or hash differ from the query.');
  }
  if (input.models.length !== manifest.revisions.length
      || new Set(input.models.map((model) => model.revisionId)).size !== input.models.length) throw new Error('Incomplete exported revision queries.');
  for (const revision of manifest.revisions) {
    const model = input.models.find((item) => item.revisionId === revision.revisionId);
    if (!model || model.modelSha256 !== revision.modelSha256) throw new Error('Exported query does not match revision model hash.');
    const bytes = Buffer.from(model.bytesBase64, 'base64');
    const raw: unknown = JSON.parse(bytes.toString('utf8'));
    if (sha256(bytes) !== model.modelSha256 || JSON.stringify(parseFixture(raw)) !== JSON.stringify(model.fixture)) {
      throw new Error('Exported model bytes or hash differ from the query.');
    }
  }
  return input;
}

// A separate process can query only this independent artifact root. It needs no source paths.
export async function exportIndependentCopy(root: string): Promise<CopyExport> {
  const retained = await readCurrent(root);
  if (!retained) throw new Error('No complete package to export.');
  const models: CopyExport['models'] = [];
  for (const revision of retained.manifest.revisions) {
    const bytes = await readRegularFile(path.join(retained.root, 'objects', revision.modelSha256));
    const raw: unknown = JSON.parse(bytes.toString('utf8'));
    models.push({ revisionId: revision.revisionId, modelSha256: sha256(bytes), bytesBase64: bytes.toString('base64'), fixture: parseFixture(raw) });
  }
  return parseCopyExport({ format: 'w6-independent-copy-export-v1', manifestSha256: retained.manifestSha256,
    manifestBytesBase64: retained.manifestBytes.toString('base64'),
    manifest: retained.manifest, models });
}

export async function verifyCopyExport(filename: string): Promise<CopyExport> {
  const raw: unknown = JSON.parse(await readFile(filename, 'utf8'));
  return parseCopyExport(raw);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  const output = process.argv[3];
  if (!root || !output || process.argv.length !== 4) throw new Error('Usage: node experiments/recovery/exports.ts <independent-artifact-root> <new-output.json>');
  const bytes = JSON.stringify(await exportIndependentCopy(root), null, 2) + '\n';
  await writeFile(output, bytes, { flag: 'wx' });
  await writeFile(output + '.sha256', sha256(bytes) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ output, sha256: sha256(bytes) }) + '\n');
}
