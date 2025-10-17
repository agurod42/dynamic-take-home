import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemorySql } from '../test/inMemorySql.js';

process.env.KEY_ENCRYPTION_SECRET =
  process.env.KEY_ENCRYPTION_SECRET || 'test-key-for-wallets-12345678901234567890abcdef';
process.env.CHAIN_MODE = 'simulated';
process.env.MOCK_SQL = '1';
process.env.MOCK_CRYPTO = '1';
process.env.MOCK_ETHERS = '1';

const { setSqlClient } = await import('../db.js');
const {
  createWallet,
  listWallets,
  getWallet,
  getBalance,
  signMessage,
  sendTransaction,
  listTransactions,
  deposit,
  getChainInfo,
  __setChainModeForTesting,
} = await import('../services/walletService.js');

let state;

beforeEach(() => {
  const mock = createInMemorySql();
  state = mock.state;
  setSqlClient(mock.sql);
  __setChainModeForTesting('simulated');
});

test('createWallet persists encrypted keys and returns mapped payload', async () => {
  const wallet = await createWallet('user-1', { label: 'Primary' });
  assert.equal(wallet.label, 'Primary');
  assert.equal(wallet.balance, 1000);
  assert.ok(wallet.address.startsWith('0x'));
  const stored = state.wallets.get(wallet.id);
  assert.equal(stored.user_id, 'user-1');
  assert.equal(stored.label, 'Primary');
  assert.ok(stored.private_key_encrypted);
  assert.notEqual(stored.private_key_encrypted, '');
});

test('listWallets returns wallets sorted by creation time', async () => {
  const first = await createWallet('user-1', { label: 'First' });
  const second = await createWallet('user-1', { label: 'Second' });
  const result = await listWallets('user-1');
  assert.deepEqual(result.map((w) => w.id), [first.id, second.id]);
});

test('getWallet enforces ownership and existence', async () => {
  const wallet = await createWallet('user-1', { label: 'Mine' });
  const fetched = await getWallet('user-1', wallet.id);
  assert.equal(fetched.id, wallet.id);

  await assert.rejects(getWallet('user-2', wallet.id), {
    message: 'You do not have access to this wallet',
  });
  await assert.rejects(getWallet('user-1', 'missing'), { message: 'Wallet not found' });
});

test('getBalance returns the numeric balance in simulated mode', async () => {
  const wallet = await createWallet('user-1', { label: 'Balance' });
  const balance = await getBalance('user-1', wallet.id);
  assert.deepEqual(balance, { walletId: wallet.id, balance: 1000 });
});

test('signMessage produces deterministic signatures per message', async () => {
  const wallet = await createWallet('user-1', { label: 'Signer' });
  const message = 'hello world';
  const result = await signMessage('user-1', wallet.id, message);
  assert.equal(result.walletId, wallet.id);
  assert.ok(result.signature.startsWith('0x'));
  const repeat = await signMessage('user-1', wallet.id, message);
  assert.equal(result.signature, repeat.signature);
});

test('signMessage validates message presence and wallet ownership', async () => {
  const wallet = await createWallet('user-1', { label: 'Signer' });
  await assert.rejects(signMessage('user-1', wallet.id, ''), { message: 'Message is required' });
  await assert.rejects(signMessage('user-2', wallet.id, 'test'), {
    message: 'You do not have access to this wallet',
  });
  await assert.rejects(signMessage('user-1', 'missing', 'test'), { message: 'Wallet not found' });
});

test('sendTransaction moves balances for internal transfers', async () => {
  const source = await createWallet('user-1', { label: 'Source' });
  const destination = await createWallet('user-1', { label: 'Destination' });

  const result = await sendTransaction('user-1', source.id, {
    to: destination.id,
    amount: 150,
    memo: 'Internal transfer',
  });

  assert.equal(result.source.balance, 850);
  assert.equal(result.destination.balance, 1150);
  const sourceRow = state.wallets.get(source.id);
  const destRow = state.wallets.get(destination.id);
  assert.equal(sourceRow.balance, 850);
  assert.equal(destRow.balance, 1150);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].type, 'internal');
});

test('sendTransaction supports external destinations', async () => {
  const source = await createWallet('user-1', { label: 'Source' });
  const result = await sendTransaction('user-1', source.id, {
    to: 'external-destination',
    amount: 200,
  });
  assert.equal(result.source.balance, 800);
  assert.ok(!result.destination);
  assert.equal(state.transactions[0].type, 'external');
});

test('sendTransaction validates inputs and balances', async () => {
  const wallet = await createWallet('user-1', { label: 'Checks' });
  await assert.rejects(sendTransaction('user-1', wallet.id, { amount: 10 }), {
    message: 'Destination and amount are required',
  });
  await assert.rejects(sendTransaction('user-1', wallet.id, { to: 'dest', amount: 0 }), {
    message: 'Amount must be a positive number',
  });
  await assert.rejects(sendTransaction('user-1', wallet.id, { to: 'dest', amount: 2000 }), {
    message: 'Insufficient balance',
  });
  await assert.rejects(sendTransaction('user-2', wallet.id, { to: 'dest', amount: 10 }), {
    message: 'You do not have access to this wallet',
  });
  await assert.rejects(sendTransaction('user-1', 'missing', { to: 'dest', amount: 10 }), {
    message: 'Wallet not found',
  });
});

test('listTransactions aggregates activity involving the wallet', async () => {
  const wallet = await createWallet('user-1', { label: 'History' });
  await deposit('user-1', wallet.id, 50);
  await sendTransaction('user-1', wallet.id, { to: 'other', amount: 20 });

  const transactions = await listTransactions('user-1', wallet.id);
  assert.equal(transactions.length, 2);
  const hashes = transactions.map((t) => t.type).sort();
  assert.deepEqual(hashes, ['deposit', 'external']);
});

test('deposit increases balances in simulated mode and logs a transaction', async () => {
  const wallet = await createWallet('user-1', { label: 'Deposit' });
  const result = await deposit('user-1', wallet.id, 250);
  assert.deepEqual(result, { walletId: wallet.id, balance: 1250 });
  assert.equal(state.wallets.get(wallet.id).balance, 1250);
  assert.equal(state.transactions[0].type, 'deposit');
});

test('deposit validates amount and ownership', async () => {
  const wallet = await createWallet('user-1', { label: 'Deposit' });
  await assert.rejects(deposit('user-1', wallet.id, 0), { message: 'Amount must be positive' });
  await assert.rejects(deposit('user-2', wallet.id, 100), {
    message: 'You do not have access to this wallet',
  });
  await assert.rejects(deposit('user-1', 'missing', 100), { message: 'Wallet not found' });
});

test('deposit is disabled in on-chain mode', async () => {
  const wallet = await createWallet('user-1', { label: 'Deposit' });
  __setChainModeForTesting('sepolia');
  await assert.rejects(deposit('user-1', wallet.id, 10), {
    message: 'Deposits are not available in on-chain mode. Please fund the wallet directly.',
  });
});

test('getChainInfo reflects simulated and on-chain metadata', () => {
  let info = getChainInfo();
  assert.deepEqual(info, {
    mode: 'simulated',
    label: 'Simulated Ledger',
    depositEnabled: true,
    rpcHost: null,
  });

  __setChainModeForTesting('sepolia');
  info = getChainInfo();
  assert.equal(info.mode, 'sepolia');
  assert.equal(info.label, 'Ethereum Sepolia');
  assert.equal(info.depositEnabled, false);
  assert.ok(info.rpcHost.includes('infura'));
});
