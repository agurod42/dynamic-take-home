const state = {
  token: null,
  email: null,
  wallets: [],
  selectedWallet: null,
  chainInfo: {
    mode: 'simulated',
    label: 'Simulated Ledger',
    depositEnabled: true,
    rpcHost: null
  }
};

const selectors = {
  app: document.getElementById('app'),
  authPanel: document.getElementById('auth-panel'),
  dashboard: document.getElementById('dashboard'),
  registerForm: document.getElementById('register-form'),
  loginForm: document.getElementById('login-form'),
  walletForm: document.getElementById('wallet-form'),
  walletList: document.getElementById('wallet-list'),
  walletDetail: document.getElementById('wallet-detail'),
  detailTitle: document.getElementById('detail-title'),
  detailAddress: document.getElementById('detail-address'),
  detailBalance: document.getElementById('detail-balance'),
  detailChain: document.getElementById('detail-chain'),
  transactionList: document.getElementById('transaction-list'),
  sessionEmail: document.getElementById('session-email'),
  sessionChain: document.getElementById('session-chain'),
  logoutBtn: document.getElementById('logout-btn'),
  signForm: document.getElementById('sign-form'),
  sendForm: document.getElementById('send-form'),
  depositForm: document.getElementById('deposit-form'),
  signResult: document.getElementById('sign-result'),
  sendResult: document.getElementById('send-result'),
  depositResult: document.getElementById('deposit-result'),
  depositDisabled: document.getElementById('deposit-disabled')
};

const CHAIN_LABELS = {
  simulated: 'Simulated Ledger',
  sepolia: 'Ethereum Sepolia'
};

function getChainLabel(mode) {
  return CHAIN_LABELS[mode] || mode || 'Unknown';
}

function currentChainLabel() {
  return state.chainInfo?.label || getChainLabel(state.chainInfo?.mode || 'simulated');
}

function getCurrencyUnit() {
  return state.chainInfo?.mode === 'sepolia' ? 'ETH' : 'VC';
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return `${value}`;
  }
  const unit = getCurrencyUnit();
  const decimals = unit === 'ETH' ? 4 : 2;
  return `${amount.toFixed(decimals)} ${unit}`;
}

function saveSession(token, email) {
  state.token = token;
  state.email = email;
  if (token) {
    localStorage.setItem('vencura_token', token);
    localStorage.setItem('vencura_email', email);
  } else {
    localStorage.removeItem('vencura_token');
    localStorage.removeItem('vencura_email');
  }
  updateView();
}

function restoreSession() {
  const token = localStorage.getItem('vencura_token');
  const email = localStorage.getItem('vencura_email');
  if (token && email) {
    state.token = token;
    state.email = email;
    updateView();
    loadWallets().catch(console.error);
  }
}

function updateView() {
  const authenticated = Boolean(state.token);
  selectors.authPanel.hidden = authenticated;
  selectors.dashboard.hidden = !authenticated;
  if (authenticated) {
    selectors.sessionEmail.textContent = state.email;
    selectors.app.dataset.state = 'dashboard';
  } else {
    selectors.sessionEmail.textContent = '';
    selectors.app.dataset.state = 'auth';
    clearWalletDetail();
    state.wallets = [];
    renderWallets();
  }
  updateSessionBar();
  updateDepositState();
}

async function api(path, options = {}) {
  const url = `/api${path}`;
  const headers = options.headers ? { ...options.headers } : {};
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Failed to parse response for ${path}: ${text}`);
    }
  }
  if (!response.ok) {
    const message = payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function updateSessionBar() {
  if (!selectors.sessionChain) return;
  const label = currentChainLabel();
  if (state.token) {
    selectors.sessionChain.textContent = `· ${label}`;
  } else {
    selectors.sessionChain.textContent = '';
  }
}

function updateDepositState() {
  if (!selectors.depositForm || !selectors.depositResult || !selectors.depositDisabled) {
    return;
  }
  const detailVisible = !selectors.walletDetail.hidden;
  if (!detailVisible) {
    selectors.depositForm.hidden = false;
    selectors.depositResult.hidden = false;
    selectors.depositDisabled.hidden = true;
    return;
  }
  const depositAllowed = state.chainInfo?.depositEnabled ?? true;
  selectors.depositForm.hidden = !depositAllowed;
  selectors.depositResult.hidden = !depositAllowed;
  selectors.depositDisabled.hidden = depositAllowed;
  if (!depositAllowed) {
    selectors.depositResult.textContent = '';
  }
}

async function loadConfig() {
  try {
    const config = await api('/config');
    state.chainInfo = {
      mode: config.mode,
      label: config.label || getChainLabel(config.mode),
      depositEnabled: config.depositEnabled ?? true,
      rpcHost: config.rpcHost ?? null
    };
  } catch (error) {
    console.warn('Failed to load config; defaulting to simulated mode', error);
    state.chainInfo = {
      mode: 'simulated',
      label: getChainLabel('simulated'),
      depositEnabled: true,
      rpcHost: null
    };
  }
  updateSessionBar();
  updateDepositState();
}

function renderWallets() {
  selectors.walletList.innerHTML = '';
  if (!state.wallets.length) {
    selectors.walletList.innerHTML = '<p>No wallets yet. Create one above.</p>';
    return;
  }
  state.wallets.forEach((wallet) => {
    const card = document.createElement('article');
    card.className = 'wallet-card';
    const chainLabel = wallet.chain ? getChainLabel(wallet.chain) : currentChainLabel();
    card.innerHTML = `
      <h3>${wallet.label}</h3>
      <p><strong>ID:</strong> ${wallet.id}</p>
      <p><strong>Address:</strong> ${wallet.address}</p>
      <p><strong>Network:</strong> ${chainLabel}</p>
      <p><strong>Created:</strong> ${new Date(wallet.createdAt).toLocaleString()}</p>
    `;
    const button = document.createElement('button');
    button.textContent = 'View details';
    button.type = 'button';
    button.addEventListener('click', () => selectWallet(wallet.id));
    card.appendChild(button);
    selectors.walletList.appendChild(card);
  });
}

async function loadWallets() {
  if (!state.token) return;
  try {
    state.wallets = await api('/wallets');
    renderWallets();
    if (state.wallets.length) {
      const existing = state.wallets.find((w) => w.id === state.selectedWallet?.id);
      selectWallet(existing ? existing.id : state.wallets[0].id);
    } else {
      clearWalletDetail();
    }
  } catch (error) {
    handleError(error);
  }
}

async function selectWallet(walletId) {
  const wallet = state.wallets.find((w) => w.id === walletId);
  if (!wallet) return;
  state.selectedWallet = wallet;
  selectors.walletDetail.hidden = false;
  selectors.detailTitle.textContent = wallet.label;
  selectors.detailAddress.textContent = wallet.address;
  selectors.detailChain.textContent = wallet.chain ? getChainLabel(wallet.chain) : currentChainLabel();
  selectors.detailBalance.textContent = '';
  selectors.signResult.textContent = '';
  selectors.sendResult.textContent = '';
  selectors.depositResult.textContent = '';
  updateDepositState();
  await refreshWalletDetail(walletId);
}

async function refreshWalletDetail(walletId) {
  try {
    const [balance, transactions] = await Promise.all([
      api(`/wallets/${walletId}/balance`),
      api(`/wallets/${walletId}/transactions`)
    ]);
    selectors.detailBalance.textContent = formatAmount(balance.balance);
    renderTransactions(transactions);
    updateDepositState();
  } catch (error) {
    handleError(error);
  }
}

function renderTransactions(transactions) {
  selectors.transactionList.innerHTML = '';
  if (!transactions.length) {
    selectors.transactionList.innerHTML = '<li>No transactions yet.</li>';
    return;
  }
  transactions
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach((tx) => {
      const item = document.createElement('li');
      item.className = 'transaction';
      item.innerHTML = `
        <div><strong>${tx.type ?? 'tx'}</strong> &middot; ${new Date(tx.createdAt).toLocaleString()}</div>
        <div><strong>Amount:</strong> ${formatAmount(tx.amount)}</div>
        <div><strong>To:</strong> ${tx.to}</div>
        <div><strong>Hash:</strong> ${tx.hash}</div>
        ${tx.memo ? `<div><strong>Memo:</strong> ${tx.memo}</div>` : ''}
      `;
      selectors.transactionList.appendChild(item);
    });
}

function clearWalletDetail() {
  selectors.walletDetail.hidden = true;
  selectors.detailTitle.textContent = '';
  selectors.detailAddress.textContent = '';
  selectors.detailBalance.textContent = '';
  if (selectors.detailChain) {
    selectors.detailChain.textContent = '';
  }
  selectors.transactionList.innerHTML = '';
  state.selectedWallet = null;
  updateDepositState();
}

function handleError(error) {
  console.error(error);
  window.alert(error.message || 'Something went wrong');
}

selectors.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(selectors.registerForm);
  const email = formData.get('email');
  const password = formData.get('password');
  try {
    await api('/auth/register', {
      method: 'POST',
      body: { email, password }
    });
    window.alert('Account created! You can now sign in.');
    selectors.registerForm.reset();
  } catch (error) {
    handleError(error);
  }
});

selectors.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(selectors.loginForm);
  const email = formData.get('email');
  const password = formData.get('password');
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    saveSession(result.token, result.user.email);
    selectors.loginForm.reset();
    await loadWallets();
  } catch (error) {
    handleError(error);
  }
});

selectors.logoutBtn.addEventListener('click', () => {
  saveSession(null, null);
});

selectors.walletForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(selectors.walletForm);
  const label = formData.get('label');
  try {
    await api('/wallets', {
      method: 'POST',
      body: { label }
    });
    selectors.walletForm.reset();
    await loadWallets();
  } catch (error) {
    handleError(error);
  }
});

selectors.signForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedWallet) return;
  const formData = new FormData(selectors.signForm);
  const message = formData.get('message');
  try {
    const result = await api(`/wallets/${state.selectedWallet.id}/sign`, {
      method: 'POST',
      body: { message }
    });
    selectors.signResult.textContent = JSON.stringify(result, null, 2);
    selectors.signForm.reset();
  } catch (error) {
    handleError(error);
  }
});

selectors.sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedWallet) return;
  const formData = new FormData(selectors.sendForm);
  const to = formData.get('to');
  const amount = Number(formData.get('amount'));
  const memo = formData.get('memo') || undefined;
  try {
    const result = await api(`/wallets/${state.selectedWallet.id}/send`, {
      method: 'POST',
      body: { to, amount, memo }
    });
    selectors.sendResult.textContent = JSON.stringify(result, null, 2);
    selectors.sendForm.reset();
    await loadWallets();
    if (state.selectedWallet) {
      await refreshWalletDetail(state.selectedWallet.id);
    }
  } catch (error) {
    handleError(error);
  }
});

selectors.depositForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedWallet) return;
  if (state.chainInfo?.depositEnabled === false) {
    window.alert('Deposits are disabled in on-chain mode. Please use a faucet to fund your wallet.');
    return;
  }
  const formData = new FormData(selectors.depositForm);
  const amount = Number(formData.get('amount'));
  try {
    const result = await api(`/wallets/${state.selectedWallet.id}/deposit`, {
      method: 'POST',
      body: { amount }
    });
    selectors.depositResult.textContent = JSON.stringify(result, null, 2);
    selectors.depositForm.reset();
    await loadWallets();
    if (state.selectedWallet) {
      await refreshWalletDetail(state.selectedWallet.id);
    }
  } catch (error) {
    handleError(error);
  }
});

async function initialize() {
  await loadConfig();
  updateView();
  restoreSession();
}

initialize().catch((error) => {
  console.error('Failed to initialize VenCura UI', error);
});
