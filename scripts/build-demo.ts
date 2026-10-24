import fs from 'node:fs/promises';
import { build } from 'esbuild';

const dependency = new URL('../node_modules/@babylonjs/core/', import.meta.url);
const license = await fs.readFile(new URL('license.md', dependency), 'utf8');
const notice = await fs.readFile(new URL('NOTICE.md', dependency), 'utf8');

await build({
  entryPoints: ['demo/room-app.ts'], bundle: true, platform: 'browser', format: 'esm',
  target: 'es2023', minify: true, outfile: 'dist/demo/room-app.mjs', logLevel: 'info',
  banner: { js: `/*! Babylon.js 9.32.0 third-party license and notices\n${license}\n${notice}\n*/` },
});
