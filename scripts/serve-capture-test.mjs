// Local-only real-worker verification fixture. Never included in the APK/web
// production bundle. All model, fixture and runtime resources are same-origin.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const workspace = resolve(import.meta.dirname, '..');
const webRoot = resolve(workspace, 'web');
const fixtures = new Map([
  ['/', resolve(workspace, 'tests/browser/capture-harness.html')],
  ['/capture-harness.html', resolve(workspace, 'tests/browser/capture-harness.html')],
  ['/capture-harness.js', resolve(workspace, 'tests/browser/capture-harness.js')],
  ['/test-portrait.jpg', resolve(workspace, 'tests/fixtures/mediapipe-portrait.jpg')],
]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'";
createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4181').pathname);
    const file = fixtures.get(pathname) || resolve(webRoot, `.${pathname}`);
    if (!fixtures.has(pathname) && !file.startsWith(webRoot + sep)) { response.writeHead(403); response.end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4181, '127.0.0.1', () => console.log('Dewdrop capture fixture: http://127.0.0.1:4181/capture-harness.html'));
