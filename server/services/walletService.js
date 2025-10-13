import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync
} from 'crypto';
import { JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';
import { db } from '../database.js';
import { badRequest, forbidden, notFound } from '../httpError.js';

const INITIAL_BALANCE = 1000;
let chainMode = (process.env.CHAIN_MODE || 'simulated').toLowerCase();
const RPC_URL = process.env.SEPOLIA_RPC_URL;
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

function serializeWallet(wallet) {
  const { privateKeyEncrypted, userId, ...rest } = wallet;
  return rest;
}

function ensureOwner(wallet, userId) {
  if (wallet.userId !== userId) {
    throw forbidden('You do not have access to this wallet');
  }
}

export function createWallet(userId, { label }) {
  const trimmedLabel = label ? String(label).trim() : undefined;
  const generatedWallet = Wallet.createRandom();
  const storedWallet = db.update((state) => {
    const newWallet = {
      id: randomUUID(),
      userId,
      label: trimmedLabel || `Wallet ${state.wallets.length + 1}`,
      address: generatedWallet.address,
      publicKey: generatedWallet.publicKey,
      privateKeyEncrypted: encryptPrivateKey(generatedWallet.privateKey),
      balance: isOnChainMode() ? undefined : INITIAL_BALANCE,
      createdAt: new Date().toISOString()
    };
    if (isOnChainMode()) {
      newWallet.chain = 'sepolia';
    }
    state.wallets.push(newWallet);
    return newWallet;
  });
  return serializeWallet(storedWallet);
}

export function listWallets(userId) {
  const wallets = db.getState().wallets.filter((w) => w.userId === userId);
  return wallets.map(serializeWallet);
}

export function getWallet(userId, walletId) {
  const wallet = db.getState().wallets.find((w) => w.id === walletId);
  if (!wallet) {
    throw notFound('Wallet not found');
  }
  ensureOwner(wallet, userId);
  return serializeWallet(wallet);
}

export async function getBalance(userId, walletId) {
  const wallet = db.getState().wallets.find((w) => w.id === walletId);
  if (!wallet) {
    throw notFound('Wallet not found');
  }
  ensureOwner(wallet, userId);
  if (isOnChainMode()) {
    const provider = getProvider();
    const wei = await provider.getBalance(wallet.address);
    return { walletId, balance: Number.parseFloat(formatEther(wei)) };
  }
  return { walletId, balance: wallet.balance };
}

export async function signMessage(userId, walletId, message) {
  if (!message) {
    throw badRequest('Message is required');
  }
  const wallet = db.getState().wallets.find((w) => w.id === walletId);
  if (!wallet) {
    throw notFound('Wallet not found');
  }
  ensureOwner(wallet, userId);
  const signer = new Wallet(decryptPrivateKey(wallet.privateKeyEncrypted));
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

  const state = db.getState();
  const wallet = state.wallets.find((w) => w.id === walletId);
  if (!wallet) {
    throw notFound('Wallet not found');
  }
  ensureOwner(wallet, userId);
  if (!isOnChainMode() && wallet.balance < numericAmount) {
    throw badRequest('Insufficient balance');
  }

  const targetWallet =
    state.wallets.find((w) => w.id === to) ||
    state.wallets.find((w) => w.address.toLowerCase() === String(to).toLowerCase());

  if (isOnChainMode()) {
    const provider = getProvider();
    const destination = targetWallet ? targetWallet.address : String(to);
    if (!destination.startsWith('0x')) {
      throw badRequest('Destination must be a valid wallet ID or address');
    }
    const privateKey = decryptPrivateKey(wallet.privateKeyEncrypted);
    const signer = new Wallet(privateKey, provider);
    let weiValue;
    try {
      weiValue = parseEther(String(numericAmount));
    } catch (error) {
      throw badRequest('Amount must be a valid decimal value');
    }
    const currentBalance = await provider.getBalance(wallet.address);
    if (currentBalance < weiValue) {
      throw badRequest('Insufficient on-chain balance');
    }
    const tx = await signer.sendTransaction({
      to: destination,
      value: weiValue
    });
    db.update((draft) => {
      draft.transactions.push({
        id: randomUUID(),
        hash: tx.hash,
        fromWalletId: walletId,
        to: destination,
        amount: numericAmount,
        memo: memo ? String(memo) : undefined,
        type: targetWallet ? 'internal-onchain' : 'onchain',
        createdAt: new Date().toISOString()
      });
    });
    return { transactionHash: tx.hash };
  }

  const txHash = createHash('sha256')
    .update([walletId, to, numericAmount, Date.now()].join(':'))
    .digest('hex');

  db.update((draft) => {
    const source = draft.wallets.find((w) => w.id === walletId);
    if (!source) {
      throw notFound('Wallet not found');
    }
    if (source.balance < numericAmount) {
      throw badRequest('Insufficient balance');
    }
    source.balance -= numericAmount;

    let destinationType = 'external';
    if (targetWallet) {
      const destination = draft.wallets.find((w) => w.id === targetWallet.id);
      if (destination) {
        destination.balance += numericAmount;
        destinationType = 'internal';
      }
    }

    draft.transactions.push({
      id: randomUUID(),
      hash: txHash,
      fromWalletId: walletId,
      to,
      amount: numericAmount,
      memo: memo ? String(memo) : undefined,
      type: destinationType,
      createdAt: new Date().toISOString()
    });
  });

  return { transactionHash: txHash };
}

export function listTransactions(userId, walletId) {
  const wallet = db.getState().wallets.find((w) => w.id === walletId);
  if (!wallet) {
    throw notFound('Wallet not found');
  }
  ensureOwner(wallet, userId);
  const transactions = db
    .getState()
    .transactions.filter((tx) => tx.fromWalletId === walletId || tx.to === walletId || tx.to === wallet.address);
  return transactions.map((tx) => ({ ...tx }));
}

export function deposit(userId, walletId, amount) {
  if (isOnChainMode()) {
    throw badRequest('Deposits are not available in on-chain mode. Please fund the wallet directly.');
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw badRequest('Amount must be positive');
  }
  const wallet = db.getState().wallets.find((w) => w.id === walletId);
  if (!wallet) {
    throw notFound('Wallet not found');
  }
  ensureOwner(wallet, userId);
  const updated = db.update((draft) => {
    const target = draft.wallets.find((w) => w.id === walletId);
    if (!target) {
      throw notFound('Wallet not found');
    }
    target.balance += numericAmount;
    draft.transactions.push({
      id: randomUUID(),
      hash: createHash('sha256').update([walletId, 'deposit', Date.now()].join(':')).digest('hex'),
      fromWalletId: null,
      to: walletId,
      amount: numericAmount,
      memo: 'Deposit',
      type: 'deposit',
      createdAt: new Date().toISOString()
    });
    return { walletId: target.id, balance: target.balance };
  });
  return updated;
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
