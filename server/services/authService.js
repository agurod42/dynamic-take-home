import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { argon2id } from '@noble/hashes/argon2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { badRequest, conflict, unauthorized } from '../httpError.js';
import { sql } from '../db.js';

const TOKEN_BYTES = 48;

const PASSWORD_SALT_BYTES = 16;
const ARGON2_MEMORY_KIB = 64 * 1024; // 64 MiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;

function derivePasswordHash(password, saltBuffer) {
  return argon2id(password, saltBuffer, {
    m: ARGON2_MEMORY_KIB,
    t: ARGON2_ITERATIONS,
    p: ARGON2_PARALLELISM,
    dkLen: ARGON2_HASH_LENGTH,
  });
}

async function hashPassword(password) {
  const saltBuffer = randomBytes(PASSWORD_SALT_BYTES);
  const derived = derivePasswordHash(password, saltBuffer);
  return { salt: bytesToHex(saltBuffer), hash: bytesToHex(derived) };
}

async function verifyPassword(password, saltHex, expectedHashHex) {
  try {
    const saltBuffer = Buffer.from(hexToBytes(saltHex));
    const derived = Buffer.from(derivePasswordHash(password, saltBuffer));
    const expected = Buffer.from(hexToBytes(expectedHashHex));
    if (derived.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function registerUser({ email, password }) {
  if (!email || !password) {
    throw badRequest('Email and password are required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const trimmedPassword = String(password);
  if (trimmedPassword.length < 8) {
    throw badRequest('Password must be at least 8 characters long');
  }

  const existing = await sql`select 1 from users where email = ${normalizedEmail} limit 1`;
  if (existing.rowCount > 0) {
    throw conflict('User already exists');
  }

  const { salt, hash } = await hashPassword(trimmedPassword);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await sql`insert into users (id, email, password_salt, password_hash, created_at)
            values (${id}, ${normalizedEmail}, ${salt}, ${hash}, ${createdAt})`;
  return { id, email: normalizedEmail };
}

export async function loginUser({ email, password }) {
  if (!email || !password) {
    throw badRequest('Email and password are required');
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await sql`select id, email, password_salt, password_hash from users where email = ${normalizedEmail} limit 1`;
  if (result.rowCount === 0) {
    throw unauthorized('Invalid credentials');
  }
  const user = result.rows[0];
  const ok = await verifyPassword(String(password), user.password_salt, user.password_hash);
  if (!ok) {
    throw unauthorized('Invalid credentials');
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = hashSessionToken(token);
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  await sql`delete from sessions where user_id = ${user.id}`;
  await sql`insert into sessions (id, user_id, token, created_at, last_seen_at)
            values (${sessionId}, ${user.id}, ${tokenHash}, ${now}, ${now})`;

  return { token, user: { id: user.id, email: user.email } };
}

export async function requireAuth(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    throw unauthorized();
  }
  const token = auth.slice('Bearer '.length).trim();
  const tokenHash = hashSessionToken(token);
  const result = await sql`
    select u.id, u.email, s.id as session_id
    from sessions s
    join users u on u.id = s.user_id
    where s.token = ${tokenHash}
    limit 1
  `;
  if (result.rowCount === 0) {
    throw unauthorized();
  }
  const row = result.rows[0];
  await sql`update sessions set last_seen_at = ${new Date().toISOString()} where id = ${row.session_id}`;
  return { id: row.id, email: row.email };
}
