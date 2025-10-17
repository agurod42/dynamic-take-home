import { strict as assert } from 'node:assert';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function toMap(items = []) {
  const map = new Map();
  for (const item of items) {
    map.set(item.id, clone(item));
  }
  return map;
}

function normalize(strings) {
  return strings
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function createInMemorySql(initial = {}) {
  const state = {
    users: toMap(initial.users),
    sessions: toMap(initial.sessions),
    wallets: toMap(initial.wallets),
    transactions: initial.transactions ? initial.transactions.map(clone) : [],
  };

  const helpers = {
    findUserByEmail(email) {
      const target = String(email).trim().toLowerCase();
      for (const user of state.users.values()) {
        if (user.email === target) {
          return user;
        }
      }
      return null;
    },
    findWalletById(id) {
      return state.wallets.get(id) || null;
    },
    findWalletByAddress(address) {
      if (!address) return null;
      const target = String(address).trim().toLowerCase();
      for (const wallet of state.wallets.values()) {
        if (String(wallet.address).toLowerCase() === target) {
          return wallet;
        }
      }
      return null;
    },
    cloneWallet(wallet) {
      return clone(wallet);
    },
  };

  async function sql(strings, ...values) {
    const text = normalize(strings);

    if (text.startsWith('create table if not exists')) {
      return { rowCount: 0, rows: [] };
    }

    if (text.startsWith('select 1 from users where email =')) {
      const user = helpers.findUserByEmail(values[0]);
      if (user) {
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (text.startsWith('insert into users')) {
      const [id, email, salt, hash, createdAt] = values;
      assert(!state.users.has(id), 'User already exists');
      state.users.set(id, {
        id,
        email: String(email).trim().toLowerCase(),
        password_salt: salt,
        password_hash: hash,
        created_at: createdAt,
      });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith('select id, email, password_salt, password_hash from users where email =')) {
      const user = helpers.findUserByEmail(values[0]);
      if (!user) {
        return { rowCount: 0, rows: [] };
      }
      const { id, email, password_salt, password_hash } = user;
      return { rowCount: 1, rows: [{ id, email, password_salt, password_hash }] };
    }

    if (text.startsWith('delete from sessions where user_id =')) {
      const userId = values[0];
      for (const [sessionId, session] of state.sessions.entries()) {
        if (session.user_id === userId) {
          state.sessions.delete(sessionId);
        }
      }
      return { rowCount: 0, rows: [] };
    }

    if (text.startsWith('insert into sessions')) {
      const [id, userId, token, createdAt, lastSeenAt] = values;
      state.sessions.set(id, {
        id,
        user_id: userId,
        token,
        created_at: createdAt,
        last_seen_at: lastSeenAt,
      });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith('select u.id, u.email, s.id as session_id from sessions s join users u on u.id = s.user_id where s.token =')) {
      const token = values[0];
      for (const session of state.sessions.values()) {
        if (session.token === token) {
          const user = state.users.get(session.user_id);
          if (!user) {
            break;
          }
          return {
            rowCount: 1,
            rows: [{ id: user.id, email: user.email, session_id: session.id }],
          };
        }
      }
      return { rowCount: 0, rows: [] };
    }

    if (text.startsWith('update sessions set last_seen_at =')) {
      const [lastSeenAt, sessionId] = values;
      const session = state.sessions.get(sessionId);
      if (session) {
        session.last_seen_at = lastSeenAt;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (text.startsWith('insert into wallets')) {
      const [id, userId, label, address, publicKey, privateKeyEncrypted, balance, chain, createdAt] = values;
      state.wallets.set(id, {
        id,
        user_id: userId,
        label,
        address,
        public_key: publicKey,
        private_key_encrypted: privateKeyEncrypted,
        balance: balance === null || balance === undefined ? null : Number(balance),
        chain,
        created_at: createdAt,
      });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith('select * from wallets where id =')) {
      const walletId = values[0];
      const wallet = helpers.findWalletById(walletId);
      if (!wallet) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [helpers.cloneWallet(wallet)] };
    }

    if (text.startsWith('select * from wallets where user_id =')) {
      const userId = values[0];
      const rows = [...state.wallets.values()]
        .filter((wallet) => wallet.user_id === userId)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((wallet) => helpers.cloneWallet(wallet));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('select * from wallets where id::text =')) {
      const searchId = String(values[0]);
      const searchAddress = String(values[1]).toLowerCase();
      let wallet = helpers.findWalletById(searchId);
      if (!wallet) {
        wallet = helpers.findWalletByAddress(searchAddress);
      }
      if (!wallet) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [helpers.cloneWallet(wallet)] };
    }

    if (text.startsWith('update wallets set balance = balance -')) {
      const [amount, walletId] = values;
      const wallet = helpers.findWalletById(walletId);
      if (wallet) {
        wallet.balance = Number(wallet.balance ?? 0) - Number(amount);
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (text.startsWith('update wallets set balance = balance +')) {
      const [amount, walletId] = values;
      const wallet = helpers.findWalletById(walletId);
      if (wallet) {
        wallet.balance = Number(wallet.balance ?? 0) + Number(amount);
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (text.startsWith('select balance from wallets where id =')) {
      const walletId = values[0];
      const wallet = helpers.findWalletById(walletId);
      if (!wallet) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [{ balance: wallet.balance }] };
    }

    if (text.startsWith('insert into transactions')) {
      const [id, hash, fromWalletId, toText, amount, memo, type, createdAt] = values;
      state.transactions.push({
        id,
        hash,
        from_wallet_id: fromWalletId || null,
        to_text: toText,
        amount: Number(amount),
        memo: memo ?? null,
        type,
        created_at: createdAt,
      });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith('select * from transactions')) {
      const [walletId, walletIdAgain, address] = values;
      const rows = state.transactions.filter((tx) => {
        return (
          tx.from_wallet_id === walletId ||
          tx.to_text === walletIdAgain ||
          String(tx.to_text).toLowerCase() === String(address).toLowerCase()
        );
      });
      return { rowCount: rows.length, rows: rows.map(clone) };
    }

    throw new Error(`Unsupported query in in-memory SQL mock: ${text}`);
  }

  return { sql, state };
}
