import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemorySql } from '../test/inMemorySql.js';

process.env.MOCK_SQL = '1';
process.env.MOCK_CRYPTO = '1';
process.env.MOCK_ETHERS = '1';

const { setSqlClient } = await import('../db.js');
const { registerUser, loginUser, requireAuth } = await import('../services/authService.js');

let state;

beforeEach(() => {
  const mock = createInMemorySql();
  state = mock.state;
  setSqlClient(mock.sql);
});

test('registerUser validates inputs and normalizes email', async () => {
  await assert.rejects(registerUser({ email: '', password: '' }), {
    message: 'Email and password are required',
  });

  await assert.rejects(registerUser({ email: 'user@example.com', password: 'short' }), {
    message: 'Password must be at least 8 characters long',
  });

  const user = await registerUser({ email: 'User@Example.com ', password: 'password123' });
  assert.match(user.id, /[0-9a-f-]{36}/);
  assert.equal(user.email, 'user@example.com');
  assert.equal(state.users.size, 1);
  const stored = state.users.get(user.id);
  assert.notEqual(stored.password_hash, 'password123');
  assert.equal(stored.email, 'user@example.com');
});

test('registerUser rejects duplicate emails', async () => {
  await registerUser({ email: 'taken@example.com', password: 'password123' });
  await assert.rejects(registerUser({ email: 'taken@example.com', password: 'password123' }), {
    message: 'User already exists',
  });
});

test('loginUser validates credentials and creates session', async () => {
  const registered = await registerUser({ email: 'login@example.com', password: 'password123' });
  const result = await loginUser({ email: 'login@example.com', password: 'password123' });

  assert.ok(result.token);
  assert.equal(result.user.id, registered.id);
  assert.equal(result.user.email, 'login@example.com');
  assert.equal(state.sessions.size, 1);
  const session = [...state.sessions.values()][0];
  assert.equal(session.user_id, registered.id);
  assert.ok(session.token);
});

test('loginUser rejects invalid credentials', async () => {
  await registerUser({ email: 'wrong@example.com', password: 'password123' });
  await assert.rejects(loginUser({ email: 'wrong@example.com', password: 'nope1234' }), {
    message: 'Invalid credentials',
  });
  await assert.rejects(loginUser({ email: 'missing@example.com', password: 'password123' }), {
    message: 'Invalid credentials',
  });
});

test('requireAuth enforces bearer token presence and validity', async () => {
  const registered = await registerUser({ email: 'auth@example.com', password: 'password123' });
  const login = await loginUser({ email: 'auth@example.com', password: 'password123' });

  const before = [...state.sessions.values()][0].last_seen_at;
  const result = await requireAuth({ headers: { authorization: `Bearer ${login.token}` } });

  assert.equal(result.id, registered.id);
  assert.equal(result.email, 'auth@example.com');
  const session = [...state.sessions.values()][0];
  assert.notEqual(session.last_seen_at, before);

  await assert.rejects(requireAuth({ headers: {} }), { message: 'Unauthorized' });
  await assert.rejects(requireAuth({ headers: { authorization: 'Bearer nope' } }), {
    message: 'Unauthorized',
  });
});
