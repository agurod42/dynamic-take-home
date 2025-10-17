import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync
} from 'crypto';
import { JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';
import { badRequest, forbidden, notFound } from '../httpError.js';
import { sql } from '../db.js';

const INITIAL_BALANCE = 1000;
const CHAIN_MODE = (process.env.CHAIN_MODE || 'simulated').toLowerCase();
const RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  'https://sepolia.infura.io/v3/<REDACTED>';
function resolveKeyEncryptionSecret() {
  const raw = process.env.KEY_ENCRYPTION_SECRET;
  const secret = typeof raw === 'string' ? raw.trim() : '';
  if (!secret || secret.length < 32 || secret === 'development-secret') {
    throw new Error(
      'KEY_ENCRYPTION_SECRET must be set to a high-entropy value (minimum 32 characters) before starting the service.'
    );
  }
  return secret;
}

const KEY_ENCRYPTION_SECRET = resolveKeyEncryptionSecret();
const KEY_SALT = 'vencura-private-key';
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // recommended for AES-GCM
const ALGORITHM = 'aes-256-gcm';

let providerCache = null;

function isOnChainMode() {
  return CHAIN_MODE === 'sepolia';
}

function deriveEncryptionKey() {
  return scryptSync(KEY_ENCRYPTION_SECRET, KEY_SALT, KEY_LENGTH);
}

function encryptPrivateKey(privateKey) {
  const key = deriveEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptPrivateKey(payload) {
  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buffer.subarray(IV_LENGTH + 16);
  const key = deriveEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function getProvider() {
  if (!isOnChainMode()) {
    throw new Error('Provider requested in simulated mode');
  }
  if (!providerCache) {
    providerCache = new JsonRpcProvider(RPC_URL);
  }
  return providerCache;
}

function mapWalletRow(row) {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    publicKey: row.public_key,
    createdAt: row.created_at,
    chain: row.chain || undefined,
    // balance is omitted in on-chain mode
    ...(row.balance !== null && row.balance !== undefined ? { balance: Number(row.balance) } : {})
  };
}

function ensureOwnerRow(row, userId) {
  if (row.user_id !== userId) {
    throw forbidden('You do not have access to this wallet');
  }
}

export async function createWallet(userId, { label }) {
  const trimmedLabel = label ? String(label).trim() : undefined;
  const generatedWallet = Wallet.createRandom();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const chain = isOnChainMode() ? 'sepolia' : null;
  const balance = isOnChainMode() ? null : INITIAL_BALANCE;
  const privateKeyEncrypted = encryptPrivateKey(generatedWallet.privateKey);
  const finalLabel = trimmedLabel || `Wallet ${id.slice(0, 8)}`;

  await sql`
    insert into wallets (id, user_id, label, address, public_key, private_key_encrypted, balance, chain, created_at)
    values (${id}, ${userId}, ${finalLabel}, ${generatedWallet.address}, ${generatedWallet.publicKey}, ${privateKeyEncrypted}, ${balance}, ${chain}, ${createdAt})
  `;
  const row = (await sql`select * from wallets where id = ${id} limit 1`).rows[0];
  return mapWalletRow(row);
}

export async function listWallets(userId) {
  const result = await sql`select * from wallets where user_id = ${userId} order by created_at asc`;
  return result.rows.map(mapWalletRow);
}

export async function getWallet(userId, walletId) {
  const result = await sql`select * from wallets where id = ${walletId} limit 1`;
  if (result.rowCount === 0) {
    throw notFound('Wallet not found');
  }
  const row = result.rows[0];
  ensureOwnerRow(row, userId);
  return mapWalletRow(row);
}

export async function getBalance(userId, walletId) {
  const result = await sql`select * from wallets where id = ${walletId} limit 1`;
  if (result.rowCount === 0) {
    throw notFound('Wallet not found');
  }
  const row = result.rows[0];
  ensureOwnerRow(row, userId);
  if (isOnChainMode()) {
    const provider = getProvider();
    const wei = await provider.getBalance(row.address);
    return { walletId, balance: Number.parseFloat(formatEther(wei)) };
  }
  return { walletId, balance: Number(row.balance) };
}

export async function signMessage(userId, walletId, message) {
  if (!message) {
    throw badRequest('Message is required');
  }
  const result = await sql`select * from wallets where id = ${walletId} limit 1`;
  if (result.rowCount === 0) {
    throw notFound('Wallet not found');
  }
  const row = result.rows[0];
  ensureOwnerRow(row, userId);
  const signer = new Wallet(decryptPrivateKey(row.private_key_encrypted));
  const signature = await signer.signMessage(String(message));
  return {
    walletId,
    message,
    signature,
    signedAt: new Date().toISOString()
  };
}

export async function sendTransaction(userId, walletId, { to, amount, memo }) {
  if (!to || amount === undefined) {
    throw badRequest('Destination and amount are required');
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw badRequest('Amount must be a positive number');
  }

  const rowResult = await sql`select * from wallets where id = ${walletId} limit 1`;
  if (rowResult.rowCount === 0) {
    throw notFound('Wallet not found');
  }
  const source = rowResult.rows[0];
  ensureOwnerRow(source, userId);
  if (!isOnChainMode() && Number(source.balance) < numericAmount) {
    throw badRequest('Insufficient balance');
  }

  const toText = String(to).trim();
  const targetResult = await sql`select * from wallets where id::text = ${toText} or lower(address) = lower(${toText}) limit 1`;
  const targetWallet = targetResult.rowCount ? targetResult.rows[0] : null;

  if (isOnChainMode()) {
    const provider = getProvider();
    const destination = targetWallet ? targetWallet.address : String(to);
    if (!destination.startsWith('0x')) {
      throw badRequest('Destination must be a valid wallet ID or address');
    }
    const privateKey = decryptPrivateKey(source.private_key_encrypted);
    const signer = new Wallet(privateKey, provider);
    let weiValue;
    try {
      weiValue = parseEther(String(numericAmount));
    } catch (error) {
      throw badRequest('Amount must be a valid decimal value');
    }
    const currentBalance = await provider.getBalance(source.address);
    if (currentBalance < weiValue) {
      throw badRequest('Insufficient on-chain balance');
    }
    const tx = await signer.sendTransaction({
      to: destination,
      value: weiValue
    });
    await sql`insert into transactions (id, hash, from_wallet_id, to_text, amount, memo, type, created_at)
              values (${randomUUID()}, ${tx.hash}, ${walletId}, ${destination}, ${numericAmount}, ${memo ? String(memo) : null}, ${targetWallet ? 'internal-onchain' : 'onchain'}, ${new Date().toISOString()})`;
    return { transactionHash: tx.hash };
  }

  const txHash = createHash('sha256')
    .update([walletId, to, numericAmount, Date.now()].join(':'))
    .digest('hex');

  // Deduct from source
  await sql`update wallets set balance = balance - ${numericAmount} where id = ${walletId}`;

  // Credit destination if internal
  let destinationType = 'external';
  if (targetWallet) {
    await sql`update wallets set balance = balance + ${numericAmount} where id = ${targetWallet.id}`;
    destinationType = 'internal';
  }

  await sql`insert into transactions (id, hash, from_wallet_id, to_text, amount, memo, type, created_at)
            values (${randomUUID()}, ${txHash}, ${walletId}, ${String(to)}, ${numericAmount}, ${memo ? String(memo) : null}, ${destinationType}, ${new Date().toISOString()})`;

  return { transactionHash: txHash };
}

export async function listTransactions(userId, walletId) {
  const walletResult = await sql`select * from wallets where id = ${walletId} limit 1`;
  if (walletResult.rowCount === 0) {
    throw notFound('Wallet not found');
  }
  const walletRow = walletResult.rows[0];
  ensureOwnerRow(walletRow, userId);
  const txs = await sql`
    select * from transactions
    where from_wallet_id = ${walletId}
       or to_text = ${walletId}
       or to_text = ${walletRow.address}
  `;
  return txs.rows.map((r) => ({
    id: r.id,
    hash: r.hash,
    fromWalletId: r.from_wallet_id,
    to: r.to_text,
    amount: Number(r.amount),
    memo: r.memo || undefined,
    type: r.type,
    createdAt: r.created_at
  }));
}

export async function deposit(userId, walletId, amount) {
  if (isOnChainMode()) {
    throw badRequest('Deposits are not available in on-chain mode. Please fund the wallet directly.');
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw badRequest('Amount must be positive');
  }
  const walletResult = await sql`select * from wallets where id = ${walletId} limit 1`;
  if (walletResult.rowCount === 0) {
    throw notFound('Wallet not found');
  }
  const walletRow = walletResult.rows[0];
  ensureOwnerRow(walletRow, userId);
  await sql`update wallets set balance = balance + ${numericAmount} where id = ${walletId}`;
  const txHash = createHash('sha256').update([walletId, 'deposit', Date.now()].join(':')).digest('hex');
  await sql`insert into transactions (id, hash, from_wallet_id, to_text, amount, memo, type, created_at)
            values (${randomUUID()}, ${txHash}, ${null}, ${walletId}, ${numericAmount}, ${'Deposit'}, ${'deposit'}, ${new Date().toISOString()})`;
  const updated = await sql`select balance from wallets where id = ${walletId}`;
  return { walletId, balance: Number(updated.rows[0].balance) };
}

function detectRpcHost() {
  try {
    const { host } = new URL(RPC_URL);
    return host;
  } catch {
    return null;
  }
}

const CHAIN_LABELS = {
  simulated: 'Simulated Ledger',
  sepolia: 'Ethereum Sepolia'
};

function getLabel(mode) {
  return CHAIN_LABELS[mode] || mode;
}

export function getChainInfo() {
  const mode = isOnChainMode() ? 'sepolia' : CHAIN_MODE;
  return {
    mode,
    label: getLabel(mode),
    depositEnabled: !isOnChainMode(),
    rpcHost: isOnChainMode() ? detectRpcHost() : null
  };
}
