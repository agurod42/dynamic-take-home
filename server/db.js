import { sql } from '@vercel/postgres';

let initialized = false;

export async function initSchemaIfNeeded() {
  if (initialized) return;
  // Create tables if they don't exist. Keep it simple and idempotent.
  await sql`create table if not exists users (
    id uuid primary key,
    email text unique not null,
    password_salt text not null,
    password_hash text not null,
    created_at timestamptz not null
  )`;

  await sql`create table if not exists sessions (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    token text unique not null,
    created_at timestamptz not null,
    last_seen_at timestamptz not null
  )`;

  await sql`create table if not exists wallets (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    label text not null,
    address text unique not null,
    public_key text not null,
    private_key_encrypted text not null,
    balance numeric,
    chain text,
    created_at timestamptz not null
  )`;

  await sql`create table if not exists transactions (
    id uuid primary key,
    hash text not null,
    from_wallet_id uuid,
    to_text text not null,
    amount numeric not null,
    memo text,
    type text not null,
    created_at timestamptz not null
  )`;

  initialized = true;
}

export { sql };


