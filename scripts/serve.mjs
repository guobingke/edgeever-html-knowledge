import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const allowed = new Set(['demo', 'dist']);
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.json': 'application/json;charset=utf-8', '.css': 'text/css;charset=utf-8' };
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const raw = decodeURIComponent((request.url || '/').split('?')[0]);
    if (raw.includes('\\') || raw.includes('\0')) throw new Error('Invalid path');
    const segments = raw.split('/').filter(Boolean);
    if (segments.some(value => value === '.' || value === '..') || !allowed.has(segments[0])) {
      response.writeHead(404).end('Not found'); return;
    }
    let target = path.resolve(root, ...segments);
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    target = await realpath(target);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !allowed.has(relative.split(path.sep)[0])) throw new Error('Outside root');
    const extension = path.extname(target);
    if (!types[extension]) { response.writeHead(404).end(); return; }
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extension], 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404).end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local demo: http://127.0.0.1:4173/demo/ | Manifest: http://127.0.0.1:4173/dist/manifest.json'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
