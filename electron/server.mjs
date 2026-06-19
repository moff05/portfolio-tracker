import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = parseInt(process.env.PORT ?? '3847', 10);
const DIST = process.env.DIST_PATH;

if (!DIST) throw new Error('DIST_PATH env var is required');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
};

// Load the Nitro fetch handler (dynamic import resolves ./assets/* relative to server.js)
const { default: handler } = await import(
  pathToFileURL(join(DIST, 'server', 'server.js')).href
);

const httpServer = createServer(async (req, res) => {
  try {
    // Serve from dist/client/ for static assets
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
    const staticPath = join(DIST, 'client', pathname);

    try {
      const s = await stat(staticPath);
      if (s.isFile()) {
        const ext = extname(staticPath).toLowerCase();
        const content = await readFile(staticPath);
        res.writeHead(200, {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Cache-Control': pathname.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        });
        res.end(content);
        return;
      }
    } catch {
      // not a static file — fall through to SSR handler
    }

    // Collect request body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuf = chunks.length > 0 ? Buffer.concat(chunks) : null;

    const hasBody = bodyBuf && bodyBuf.length > 0 && req.method !== 'GET' && req.method !== 'HEAD';

    const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
      method: req.method,
      headers: (() => {
        const h = new Headers();
        for (const [key, val] of Object.entries(req.headers)) {
          if (val != null) h.set(key, Array.isArray(val) ? val.join(', ') : String(val));
        }
        return h;
      })(),
      ...(hasBody ? { body: bodyBuf, duplex: 'half' } : {}),
    });

    const response = await handler.fetch(request);

    const resHeaders = {};
    for (const [key, val] of response.headers.entries()) resHeaders[key] = val;
    res.writeHead(response.status, resHeaders);

    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error('[server error]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end('Internal Server Error');
  }
});

httpServer.listen(PORT, '127.0.0.1', () => {
  process.parentPort?.postMessage({ type: 'ready', port: PORT });
  console.log(`[server] ready on ${PORT}`);
});
