import { URL } from 'url';
import { badRequest, HttpError, notFound } from './httpError.js';
import { requireAuth } from './services/authService.js';

function pathToRegex(pathPattern) {
  const keys = [];
  const pattern = pathPattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const regex = new RegExp(`^${pattern}$`);
  return { regex, keys };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString();
      if (raw.length > 1e6) {
        reject(badRequest('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (error) {
        reject(badRequest('Invalid JSON payload'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

export class App {
  constructor({ basePath = '/api', authResolver = requireAuth } = {}) {
    this.basePath = basePath;
    this.routes = [];
    this.authResolver = authResolver;
  }

  register(method, path, handler, { auth = false } = {}) {
    const fullPath = this.basePath ? `${this.basePath}${path}` : path;
    const { regex, keys } = pathToRegex(fullPath);
    this.routes.push({ method: method.toUpperCase(), path: fullPath, handler, regex, keys, auth });
  }

  async handle(req, res) {
    try {
      if (req.method === 'OPTIONS') {
        this.#writeCors(res);
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = this.routes.find((r) => r.method === req.method && r.regex.test(url.pathname));

      if (!route) {
        throw notFound('Route not found');
      }

      const match = url.pathname.match(route.regex);
      const params = {};
      if (match) {
        route.keys.forEach((key, index) => {
          params[key] = decodeURIComponent(match[index + 1]);
        });
      }

      const query = Object.fromEntries(url.searchParams.entries());
      const context = { req, res, params, query, user: null };

      if (route.auth) {
        context.user = await this.authResolver(req);
      }

      if (req.method !== 'GET' && req.method !== 'DELETE') {
        context.body = await readBody(req);
      } else {
        context.body = null;
      }

      const result = await route.handler(context);
      if (result === undefined) {
        res.writeHead(204, this.#headers());
        res.end();
        return;
      }
      this.#writeJson(res, 200, result);
    } catch (error) {
      this.#handleError(res, error);
    }
  }

  #headers() {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    };
  }

  #writeCors(res) {
    const headers = this.#headers();
    delete headers['Content-Type'];
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  }

  #writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, this.#headers());
    res.end(JSON.stringify(payload));
  }

  #handleError(res, error) {
    const headers = this.#headers();
    let status = 500;
    let message = 'Unexpected error';
    if (error instanceof HttpError) {
      status = error.status;
      message = error.message;
    } else if (error.code === 'ENOENT') {
      status = 404;
      message = 'Resource not found';
    } else {
      console.error('Unhandled error:', error);
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify({ error: message }));
  }
}
