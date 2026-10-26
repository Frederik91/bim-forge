import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const dependency = new URL('../node_modules/@babylonjs/core/', import.meta.url);
const license = await fs.readFile(new URL('license.md', dependency), 'utf8');
const notice = await fs.readFile(new URL('NOTICE.md', dependency), 'utf8');

await build({
  entryPoints: ['demo/room-app.ts'], bundle: true, platform: 'browser', format: 'esm',
  target: 'es2023', minify: true, outfile: 'dist/demo/room-app.mjs', logLevel: 'info',
  banner: { js: `/*! Babylon.js 9.32.0 third-party license and notices\n${license}\n${notice}\n*/` },
});

const output = new URL('../dist/demo/', import.meta.url);
const assets = ['index.html', 'room.css', 'request-chat.css'];
await Promise.all(assets.map(name => fs.copyFile(new URL('../demo/' + name, import.meta.url), new URL(name, output))));
const files = await Promise.all([...assets, 'room-app.mjs'].map(async name => {
  const bytes = await fs.readFile(new URL(name, output));
  return { name, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
await fs.writeFile(new URL('manifest.json', output), JSON.stringify({ version: 1, files }, null, 2) + '\n');
