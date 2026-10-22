import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map([
  ['/', ['demo/index.html', 'text/html; charset=utf-8']],
  ['/room-app.mjs', ['demo/room-app.mjs', 'text/javascript; charset=utf-8']],
  ['/room-store.mjs', ['demo/room-store.mjs', 'text/javascript; charset=utf-8']],
  ['/room.css', ['demo/room.css', 'text/css; charset=utf-8']],
  ['/src/room-model.mjs', ['src/room-model.mjs', 'text/javascript; charset=utf-8']],
]);

export function createDemoServer() {
  return http.createServer(async (request, response) => {
    const allowedHost = /^127\.0\.0\.1(?::[0-9]{1,5})?$|^localhost(?::[0-9]{1,5})?$/;
    if (!allowedHost.test(request.headers.host ?? '')) { response.writeHead(403); response.end('Loopback access only.'); return; }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Read-only demo server.'); return;
    }
    const asset = assets.get(request.url);
    if (!asset) { response.writeHead(404); response.end('Not found.'); return; }
    try {
      const bytes = await fs.readFile(path.join(root, asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(500); response.end('Demo asset unavailable.'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 through 65535.');
  const server = createDemoServer();
  server.on('error', () => { console.error('The local demo could not start. Check whether its port is already in use.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`BIM Forge room demo: http://127.0.0.1:${port}`));
}
