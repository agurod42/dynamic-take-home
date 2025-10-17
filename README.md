# VenCura – Custodial Wallet Playground

VenCura is a lightweight backend + UI that demonstrates how a custodial wallet platform could manage user accounts, generate wallets, and perform typical operations such as signing messages and sending transactions. The focus is on clear API design, basic security practices, and providing a realistic end-to-end flow that can be easily extended.

## Tech stack

- **Node.js (ES modules)** for the API server.
- **Vercel Postgres** for persistent storage.
- **Ethers.js v6** for key management, message signing, and on-chain transactions.


```bash
# Install Node.js 18+ (v20 tested) and install dependencies
npm install

# Run the API + UI
npm start
# Visit http://127.0.0.1:3000

# During development (auto-reload)
npm run dev

# Run tests
npm test
```

Environment variables:

- `PORT` – overrides the listening port (default `3000`).
- `HOST` – bind host (defaults to `127.0.0.1` inside this project).
- `CHAIN_MODE` – `simulated` (default) keeps everything local; `sepolia` enables live on-chain flow.
- `SEPOLIA_RPC_URL` – HTTPS RPC endpoint to use when `CHAIN_MODE=sepolia` (defaults to the provided Infura URL).
- `KEY_ENCRYPTION_SECRET` – passphrase used to encrypt wallet private keys at rest (change this in any real deployment).
- `SUPPRESS_LOGS` – set to suppress startup logs.

The server stores all data in Postgres.

## API overview

All routes are served under `/api` and expect/return JSON.

| Method | Route | Description |
| ------ | ----- | ----------- |
| `GET` | `/config` | Public configuration (chain mode, RPC host, deposit availability). |
| `POST` | `/auth/register` | Register a user (`{ email, password }`). |
| `POST` | `/auth/login` | Login and receive `{ token, user }`. |
| `GET` | `/wallets` | List wallets for the authenticated user. |
| `POST` | `/wallets` | Create a new wallet (`{ label? }`). |
| `GET` | `/wallets/:walletId` | Fetch wallet metadata. |
| `GET` | `/wallets/:walletId/balance` | Retrieve current balance. |
| `POST` | `/wallets/:walletId/sign` | Sign a message (`{ message }`). |
| `POST` | `/wallets/:walletId/send` | Transfer funds (`{ to, amount, memo? }`). |
| `GET` | `/wallets/:walletId/transactions` | View transaction history. |
| `POST` | `/wallets/:walletId/deposit` | Top up a wallet with simulated funds (`{ amount }`, simulated mode only). |

Authentication uses a bearer token returned from `POST /auth/login`.

### Wallet behaviour

- Wallets are generated with Ethers (`secp256k1` keys) and private keys are encrypted at rest with AES-256-GCM.
- In simulated mode balances live in Postgres; in Sepolia mode balances are fetched from the RPC provider.
- Balances update with each transaction; internal transfers credit the recipient wallet automatically.
- A transaction history is recorded locally for auditability (on-chain transactions include their hash).

## UI walkthrough

The bundled dashboard (`/frontend`) lets you:

1. Register and sign in.
2. Create multiple wallets.
3. Inspect wallet metadata and balances.
4. Sign arbitrary messages.
5. Send internal or “external” transfers by wallet ID/address.
6. Deposit simulated funds when running in ledger mode (disabled automatically in Sepolia mode).
7. Review transaction history for each wallet.

Everything runs locally, so refreshing the page while logged in is safe—the UI stores the session token in `localStorage`.

### On-chain (Sepolia) mode

Set `CHAIN_MODE=sepolia`, point `SEPOLIA_RPC_URL` to your RPC provider (Infura/Alchemy/etc.), and change `KEY_ENCRYPTION_SECRET` to a secure secret. In this mode:

- Wallet balances and transfers interact with the live Sepolia testnet.
- `sendTransaction` signs and broadcasts a real transaction through the configured RPC endpoint.
- Deposits are disabled in the UI; fund wallets via a faucet instead.
- Transaction hashes returned by the API can be opened on an explorer for verification.

## Testing

Coming soon: SQL-backed tests using the same Postgres instance.

## Security considerations

While the project is intentionally lightweight, the implementation keeps security in mind:

- Passwords are hashed with `scrypt` and salted per user.
- Authentication tokens are long-lived random values; only one active session is stored per user for simplicity.
- Wallet private keys never leave the backend API, are never exposed via responses, and are encrypted at rest using AES-256-GCM with a configurable secret.
- Input is validated on every API boundary, returning `400` on malformed requests.
- The UI communicates only with the backend using bearer tokens over HTTP; in production this should be served over HTTPS.

Further hardening (out of scope for the take-home but recommended in a production setting):

- Move encrypted keys into an HSM or dedicated key-management service.
- Replace the simple token store with signed JWTs or opaque tokens backed by a secure session store.
- Add rate limiting, audit logging, and monitoring.
- Rotate RPC keys securely and add transaction status tracking when broadcasting on-chain transactions.
- Add role-based access control for shared wallets, invites, or multi-user accounts.
- Swap the JSON file for a durable datastore (Postgres, DynamoDB, etc.) and wrap mutations in transactions.

## Deployment notes

Deployment can happen on any provider that supports Node.js. Set `HOST=0.0.0.0` in those environments so the server binds to all interfaces. For Sepolia mode remember to supply `CHAIN_MODE=sepolia`, `SEPOLIA_RPC_URL`, and a strong `KEY_ENCRYPTION_SECRET` via your platform’s secrets manager.

## Future enhancements

- Multi-account support per user with configurable account types.
- Shared wallets with invite flows.
- Transaction status polling and integration with on-chain explorers.
- Notifications or messaging (e.g., XMTP) for signed events.
- Replace the vanilla UI with a component library (React/Vue) once requirements grow.

## Deploying to Vercel

This repo includes a `vercel.json` and a serverless function under `api/index.js` so it can be deployed to Vercel with no code changes. The function reuses the existing `App` from `server/app.js`, and the static UI is served via rewrites to files in `frontend/`.

Steps:

1. Install the Vercel CLI and log in:

   ```bash
   npm i -g vercel
   vercel login
   ```

2. Set required environment variables (recommended at project level in the Vercel dashboard or via CLI):

   - `KEY_ENCRYPTION_SECRET` – strong secret for AES-256-GCM at-rest key encryption.
   - Optional chain settings:
     - `CHAIN_MODE` – `simulated` (default) or `sepolia`.
     - `SEPOLIA_RPC_URL` – HTTPS RPC endpoint when using `sepolia`.

3. Deploy:

   ```bash
   vercel        # preview
   vercel --prod # production
   ```

4. Local test with Vercel runtime (optional):

   ```bash
   vercel dev
   ```

Notes:

- The UI is static and references `/app.js` and `/styles.css`; `vercel.json` rewrites map these to files in `frontend/`.

### Using Vercel Postgres

The app can run fully on Vercel Postgres using `@vercel/postgres`. The schema is auto-initialized on boot.

Environment variables:

- `POSTGRES_URL` – full connection string (provided by Vercel Postgres integration). Alternatively, set `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` (supported by `@vercel/postgres`).
- `KEY_ENCRYPTION_SECRET` – required. Used to encrypt wallet private keys at rest.
- Optional:
  - `CHAIN_MODE` – `simulated` (default) or `sepolia`.
  - `SEPOLIA_RPC_URL` – HTTPS RPC endpoint for Sepolia.

Local dev will use the same Postgres URL you configure (intentionally mirroring prod). To run locally:

```bash
export POSTGRES_URL="..."      # from Vercel Postgres
export KEY_ENCRYPTION_SECRET="a-strong-secret"
npm run dev
# open http://127.0.0.1:3000
```
