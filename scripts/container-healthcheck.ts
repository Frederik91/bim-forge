import http from 'node:http';

const socketPath = process.env.BIM_FORGE_SOCKET;
const publicOrigin = process.env.BIM_FORGE_PUBLIC_ORIGIN;
if (!socketPath || !publicOrigin) process.exit(1);

let host: string;
try { host = new URL(publicOrigin).host; }
catch { process.exit(1); }

const request = http.request({ socketPath, path: '/api/health', method: 'GET', headers: { Host: host } }, (response) => {
  response.resume();
  response.once('end', () => process.exit(response.statusCode === 200 ? 0 : 1));
});
request.setTimeout(3_000, () => request.destroy(new Error('Health check timed out.')));
request.once('error', () => process.exit(1));
request.end();
