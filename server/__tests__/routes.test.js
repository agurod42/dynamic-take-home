import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.KEY_ENCRYPTION_SECRET =
  process.env.KEY_ENCRYPTION_SECRET || 'test-key-for-routing-12345678901234567890';
process.env.MOCK_SQL = '1';
process.env.MOCK_CRYPTO = '1';
process.env.MOCK_ETHERS = '1';

const { configureRoutes } = await import('../routes.js');

test('configureRoutes wires every endpoint with expected methods and auth requirements', () => {
  const calls = [];
  const fakeApp = {
    register(method, path, handler, options = {}) {
      calls.push({ method, path, handler, options });
    },
  };

  configureRoutes(fakeApp);
  assert.equal(calls.length, 11);

  const byKey = Object.fromEntries(calls.map((route) => [`${route.method} ${route.path}`, route]));

  assert.ok(byKey['GET /config']);
  assert.ok(byKey['POST /auth/register']);
  assert.ok(byKey['POST /auth/login']);
  assert.ok(byKey['GET /wallets']);
  assert.ok(byKey['POST /wallets']);
  assert.ok(byKey['GET /wallets/:walletId']);
  assert.ok(byKey['GET /wallets/:walletId/balance']);
  assert.ok(byKey['POST /wallets/:walletId/sign']);
  assert.ok(byKey['POST /wallets/:walletId/send']);
  assert.ok(byKey['GET /wallets/:walletId/transactions']);
  assert.ok(byKey['POST /wallets/:walletId/deposit']);

  const protectedRoutes = [
    'GET /wallets',
    'POST /wallets',
    'GET /wallets/:walletId',
    'GET /wallets/:walletId/balance',
    'POST /wallets/:walletId/sign',
    'POST /wallets/:walletId/send',
    'GET /wallets/:walletId/transactions',
    'POST /wallets/:walletId/deposit',
  ];

  for (const key of protectedRoutes) {
    assert.equal(byKey[key].options.auth, true, `${key} should be protected`);
  }

  const publicRoutes = ['GET /config', 'POST /auth/register', 'POST /auth/login'];
  for (const key of publicRoutes) {
    assert.equal(byKey[key].options.auth ?? false, false, `${key} should be public`);
  }
});
