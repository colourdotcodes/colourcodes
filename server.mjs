// Static files from public/ plus the JSON API from server/api.mjs. No dependencies.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 9070);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

let api = null;
try { api = (await import('./server/api.mjs')).default; } catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); decodeURIComponent(url.pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }

  if (url.pathname.startsWith('/api/')) {
    if (!api) { res.writeHead(503, { 'content-type': TYPES['.json'] }).end('{"status":"api_not_ready"}'); return; }
    try { await api(req, res, url); }
    catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': TYPES['.json'] });
      res.end('{"error":"internal"}');
    }
    return;
  }

  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(301, { location: url.pathname + '/' }).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(body);
  } catch {
    // clean URLs: /verify → verify.html
    const pretty = !extname(path) ? await readFile(join(ROOT, path.replace(/\/$/, '') + '.html')).catch(() => null) : null;
    if (pretty) { res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }).end(pretty); return; }
    const page = await readFile(join(ROOT, '404.html')).catch(() => null);
    if (page) res.writeHead(404, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }).end(page);
    else res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, HOST, () => console.log(`colour.codes → http://${HOST}:${PORT}`));
