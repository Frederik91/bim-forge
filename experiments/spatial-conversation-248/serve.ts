import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const bundle = fileURLToPath(new URL('../../dist/spatial-conversation-248/app.js', import.meta.url));
const assets = new Map([
  ['/', {filename:path.join(root,'index.html'), type:'text/html'}],
  ['/style.css', {filename:path.join(root,'style.css'), type:'text/css'}],
  ['/app.js', {filename:bundle, type:'text/javascript'}],
]);

http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {Allow:'GET, HEAD'});
    response.end();
    return;
  }
  const asset = assets.get(request.url ?? '');
  if (!asset) {response.writeHead(404);response.end();return;}
  try {
    const bytes = await fs.readFile(asset.filename);
    response.writeHead(200, {
      'Content-Type':asset.type+'; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(500);
    response.end('Concept asset unavailable. Run the local study build first.');
  }
}).listen(4188, '127.0.0.1', () => {
  process.stdout.write('Spatial conversation study: http://127.0.0.1:4188\n');
});
