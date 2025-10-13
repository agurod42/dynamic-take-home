import { registerUser, loginUser } from './services/authService.js';
import {
  createWallet,
  deposit,
  getChainInfo,
  getBalance,
  getWallet,
  listTransactions,
  listWallets,
  sendTransaction,
  signMessage
} from './services/walletService.js';
import { badRequest } from './httpError.js';

export function configureRoutes(app) {
  app.register('GET', '/config', async () => {
    return getChainInfo();
  });

  app.register('POST', '/auth/register', async ({ body }) => {
    return registerUser(body || {});
  });

  app.register('POST', '/auth/login', async ({ body }) => {
    return loginUser(body || {});
  });

  app.register('GET', '/wallets', async ({ user }) => {
    return listWallets(user.id);
  }, { auth: true });

  app.register('POST', '/wallets', async ({ user, body }) => {
    return createWallet(user.id, body || {});
  }, { auth: true });

  app.register('GET', '/wallets/:walletId', async ({ user, params }) => {
    return getWallet(user.id, params.walletId);
  }, { auth: true });

  app.register('GET', '/wallets/:walletId/balance', async ({ user, params }) => {
    return getBalance(user.id, params.walletId);
  }, { auth: true });

  app.register('POST', '/wallets/:walletId/sign', async ({ user, params, body }) => {
    if (!body) {
      throw badRequest('Message is required');
    }
    return signMessage(user.id, params.walletId, body.message);
  }, { auth: true });

  app.register('POST', '/wallets/:walletId/send', async ({ user, params, body }) => {
    return sendTransaction(user.id, params.walletId, body || {});
  }, { auth: true });

  app.register('GET', '/wallets/:walletId/transactions', async ({ user, params }) => {
    return listTransactions(user.id, params.walletId);
  }, { auth: true });

  app.register('POST', '/wallets/:walletId/deposit', async ({ user, params, body }) => {
    return deposit(user.id, params.walletId, body?.amount);
  }, { auth: true });
}
