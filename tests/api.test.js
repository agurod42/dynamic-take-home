import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DB_RELATIVE = '../data/test-db.json';
const TEST_DB_PATH = resolve(__dirname, TEST_DB_RELATIVE);

process.env.DATABASE_FILE = TEST_DB_RELATIVE;
process.env.CHAIN_MODE = 'simulated';

const { resetDatabase } = await import('../server/database.js');
const authService = await import('../server/services/authService.js');
const walletService = await import('../server/services/walletService.js');

test.beforeEach(() => {
  resetDatabase();
});

test.after(() => {
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH);
  }
});

test('user registration enforces constraints', () => {
  assert.throws(
    () => authService.registerUser({ email: '', password: 'short' }),
    /Email and password are required/
  );

  assert.throws(
    () => authService.registerUser({ email: 'user@example.com', password: 'short' }),
    /Password must be at least 8 characters long/
  );
});

test('user can register and login to receive a session token', () => {
  const email = 'user@example.com';
  const password = 'supersecret';
  const user = authService.registerUser({ email, password });
  assert.ok(user.id);
  assert.equal(user.email, email);

  const login = authService.loginUser({ email, password });
  assert.ok(login.token);
  assert.equal(login.user.email, email);
});

test('wallet lifecycle supports balance, signing, and transfers', async () => {
  const email = 'wallet@example.com';
  const password = 'supersecret';
  const user = authService.registerUser({ email, password });
  authService.loginUser({ email, password });

  const walletA = walletService.createWallet(user.id, { label: 'Primary' });
  assert.equal(walletA.label, 'Primary');
  assert.ok(walletA.address.startsWith('0x'));
  assert.equal(walletA.userId, undefined);

  const walletB = walletService.createWallet(user.id, { label: 'Savings' });

  const balanceA = await walletService.getBalance(user.id, walletA.id);
  assert.equal(balanceA.balance, 1000);

  const signature = await walletService.signMessage(user.id, walletA.id, 'hello world');
  assert.equal(signature.message, 'hello world');
  assert.ok(signature.signature.length > 10);

  await walletService.sendTransaction(user.id, walletA.id, { to: walletB.id, amount: 250, memo: 'Rent' });

  const updatedBalanceA = await walletService.getBalance(user.id, walletA.id);
  const updatedBalanceB = await walletService.getBalance(user.id, walletB.id);
  assert.equal(updatedBalanceA.balance, 750);
  assert.equal(updatedBalanceB.balance, 1250);

  const transactions = walletService.listTransactions(user.id, walletA.id);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 250);
  assert.equal(transactions[0].memo, 'Rent');
});
