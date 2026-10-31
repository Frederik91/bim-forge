import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

await build({
  entryPoints:[fileURLToPath(new URL('./app.ts',import.meta.url))],
  outfile:fileURLToPath(new URL('../../dist/spatial-conversation-248/app.js',import.meta.url)),
  bundle:true,
  format:'esm',
  platform:'browser',
  target:'es2023',
  minify:true,
  sourcemap:false,
  logLevel:'warning',
});
process.stdout.write('Built local spatial conversation study.\n');
