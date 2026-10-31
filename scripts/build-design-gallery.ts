import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { viewerBuilding } from '../demo/building-viewer-fixture.ts';
import { spatialTokenCss } from '../demo/ui/design-tokens.ts';

const output = new URL('../dist/design-system/', import.meta.url);
await fs.mkdir(output, { recursive: true });
await build({ entryPoints: ['demo/design-system-gallery.tsx'], bundle: true, platform: 'browser', format: 'esm',
  target: 'es2023', minify: true, jsx: 'automatic', outfile: fileURLToPath(new URL('gallery.mjs', output)),
  define: { 'process.env.NODE_ENV': '"production"', GALLERY_SNAPSHOT: JSON.stringify(viewerBuilding()) } });
const cssInput = new URL('../demo/canvas-studio.css', import.meta.url);
const css = await postcss([tailwindcss()]).process(await fs.readFile(cssInput, 'utf8'), { from: fileURLToPath(cssInput) });
const primitiveCss = await fs.readFile(new URL('../demo/ui/spatial-primitives.css', import.meta.url), 'utf8');
const galleryCss = await fs.readFile(new URL('../demo/design-system-gallery.css', import.meta.url), 'utf8');
await fs.writeFile(new URL('gallery.css', output), spatialTokenCss() + css.css + primitiveCss + galleryCss);
await fs.writeFile(new URL('index.html', output), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BIM Forge · Inside-first design system</title><link rel="stylesheet" href="./gallery.css"></head>
<body class="canvas-studio design-gallery spatial-ui"><div id="gallery"></div><script type="module" src="./gallery.mjs"></script></body></html>\n`);
process.stdout.write('Built fixture gallery: dist/design-system/index.html\n');
