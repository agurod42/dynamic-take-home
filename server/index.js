import 'dotenv/config';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { App } from './app.js';
import { configureRoutes } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const STATIC_DIR = resolve(ROOT, 'frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

const app = new App({ basePath: '/api' });
configureRoutes(app);

async function serveStatic(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (filePath.includes('..')) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const target = resolve(STATIC_DIR, filePath);
  if (!target.startsWith(STATIC_DIR)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  try {
    const data = await readFile(target);
    const ext = extname(target);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (error) {
    if (extname(target) !== '.html') {
      try {
        const indexData = await readFile(join(STATIC_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(indexData);
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    app.handle(req, res).catch((error) => {
      console.error('Unhandled app error', error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Unexpected error' }));
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : PORT;
  if (!process.env.SUPPRESS_LOGS) {
    console.log(`VenCura server running on http://${HOST}:${resolvedPort}`);
  }
});

export { server };
