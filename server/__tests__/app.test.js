import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { badRequest, unauthorized } from '../httpError.js';

process.env.MOCK_SQL = '1';
process.env.MOCK_CRYPTO = '1';
process.env.MOCK_ETHERS = '1';

const { App } = await import('../app.js');

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = {};
    this.bodyChunks = [];
    this.finished = new Promise((resolve) => {
      this.on('finish', resolve);
    });
  }

  _write(chunk, encoding, callback) {
    this.bodyChunks.push(Buffer.from(chunk, encoding));
    callback();
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = { ...this.headers, ...headers };
  }

  setHeader(key, value) {
    this.headers[key] = value;
  }

  end(chunk) {
    if (chunk) {
      this.bodyChunks.push(Buffer.from(chunk));
    }
    super.end();
  }

  get body() {
    return Buffer.concat(this.bodyChunks).toString() || null;
  }
}

function createRequest({ method = 'GET', path = '/api/test', headers = {}, body } = {}) {
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = path;
  req.headers = { host: 'test.local', ...headers };
  process.nextTick(() => {
    if (body !== undefined) {
      req.push(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.push(null);
  });
  return req;
}

async function handleRequest(app, options) {
  const req = createRequest(options);
  const res = new MockResponse();
  await app.handle(req, res);
  await res.finished;
  return res;
}

test('handles GET routes and serialises JSON responses', async () => {
  const app = new App();
  app.register('GET', '/hello', async () => ({ message: 'hi' }));

  const res = await handleRequest(app, { method: 'GET', path: '/api/hello' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /application\/json/);
  assert.deepEqual(JSON.parse(res.body), { message: 'hi' });
});

test('parses JSON bodies for non-GET routes', async () => {
  const app = new App();
  app.register('POST', '/echo', async ({ body }) => body);

  const res = await handleRequest(app, {
    method: 'POST',
    path: '/api/echo',
    body: { hello: 'world' },
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { hello: 'world' });
});

test('returns 400 for invalid JSON payloads', async () => {
  const app = new App();
  app.register('POST', '/broken', async ({ body }) => body);

  const res = await handleRequest(app, {
    method: 'POST',
    path: '/api/broken',
    body: '{invalid}',
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Invalid JSON payload' });
});

test('returns 204 when handler returns undefined', async () => {
  const app = new App();
  app.register('DELETE', '/resource', async () => undefined);

  const res = await handleRequest(app, { method: 'DELETE', path: '/api/resource' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, null);
});

test('returns 404 when no route matches', async () => {
  const app = new App();
  const res = await handleRequest(app, { method: 'GET', path: '/api/missing' });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(JSON.parse(res.body), { error: 'Route not found' });
});

test('propagates HttpError instances from handlers', async () => {
  const app = new App();
  app.register('GET', '/fail', async () => {
    throw badRequest('Nope');
  });

  const res = await handleRequest(app, { method: 'GET', path: '/api/fail' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Nope' });
});

test('unexpected errors are converted into 500 responses', async () => {
  const app = new App();
  app.register('GET', '/boom', async () => {
    throw new Error('boom');
  });

  const res = await handleRequest(app, { method: 'GET', path: '/api/boom' });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(JSON.parse(res.body), { error: 'Unexpected error' });
});

test('OPTIONS requests trigger CORS preflight response', async () => {
  const app = new App();
  const res = await handleRequest(app, { method: 'OPTIONS', path: '/api/anything' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, null);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

test('auth-protected routes invoke the provided resolver', async () => {
  let called = false;
  const app = new App({
    authResolver: async () => {
      called = true;
      return { id: 'user-123' };
    },
  });

  app.register(
    'GET',
    '/secure',
    async ({ user }) => ({ user }),
    { auth: true },
  );

  const res = await handleRequest(app, {
    method: 'GET',
    path: '/api/secure',
    headers: { authorization: 'Bearer token' },
  });

  assert.equal(res.statusCode, 200);
  assert.ok(called);
  assert.deepEqual(JSON.parse(res.body), { user: { id: 'user-123' } });
});

test('auth resolver errors bubble up to the client', async () => {
  const app = new App({
    authResolver: async () => {
      throw unauthorized('No session');
    },
  });

  app.register(
    'GET',
    '/secure',
    async () => ({ ok: true }),
    { auth: true },
  );

  const res = await handleRequest(app, {
    method: 'GET',
    path: '/api/secure',
    headers: { authorization: 'Bearer bad' },
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(JSON.parse(res.body), { error: 'No session' });
});

test('path parameters and query strings are parsed correctly', async () => {
  const app = new App();
  app.register('GET', '/items/:itemId', async ({ params, query }) => ({ params, query }));

  const res = await handleRequest(app, {
    method: 'GET',
    path: '/api/items/abc123?limit=10&offset=5',
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    params: { itemId: 'abc123' },
    query: { limit: '10', offset: '5' },
  });
});
