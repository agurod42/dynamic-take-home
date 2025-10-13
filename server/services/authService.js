import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { db } from '../database.js';
import { badRequest, conflict, unauthorized } from '../httpError.js';

const TOKEN_BYTES = 48;

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return timingSafeEqual(derived, expected);
}

export function registerUser({ email, password }) {
  if (!email || !password) {
    throw badRequest('Email and password are required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const trimmedPassword = String(password);
  if (trimmedPassword.length < 8) {
    throw badRequest('Password must be at least 8 characters long');
  }

  const existing = db.getState().users.find((u) => u.email === normalizedEmail);
  if (existing) {
    throw conflict('User already exists');
  }

  const user = db.update((state) => {
    const { salt, hash } = hashPassword(trimmedPassword);
    const newUser = {
      id: randomUUID(),
      email: normalizedEmail,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };
    state.users.push(newUser);
    return newUser;
  });

  return { id: user.id, email: user.email };
}

export function loginUser({ email, password }) {
  if (!email || !password) {
    throw badRequest('Email and password are required');
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.getState().users.find((u) => u.email === normalizedEmail);
  if (!user) {
    throw unauthorized('Invalid credentials');
  }
  const ok = verifyPassword(String(password), user.passwordSalt, user.passwordHash);
  if (!ok) {
    throw unauthorized('Invalid credentials');
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const session = db.update((state) => {
    const newSession = {
      id: randomUUID(),
      userId: user.id,
      token,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    state.sessions = state.sessions.filter((s) => s.userId !== user.id);
    state.sessions.push(newSession);
    return newSession;
  });

  return { token: session.token, user: { id: user.id, email: user.email } };
}

export function requireAuth(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    throw unauthorized();
  }
  const token = auth.slice('Bearer '.length).trim();
  const session = db.getState().sessions.find((s) => s.token === token);
  if (!session) {
    throw unauthorized();
  }
  const user = db.getState().users.find((u) => u.id === session.userId);
  if (!user) {
    throw unauthorized();
  }
  db.update((state) => {
    const target = state.sessions.find((s) => s.id === session.id);
    if (target) {
      target.lastSeenAt = new Date().toISOString();
    }
  });
  return user;
}
