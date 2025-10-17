<div align="center">
  <p><h1 style="margin:0;">VenCura – Custodial Wallet Playground</h1></p>

  <p>
    VenCura is a tiny, realistic backend + UI that demonstrates how a custodial wallet platform could manage user accounts, generate wallets, and perform typical operations such as signing messages and sending transactions. The focus is on clear API design, basic security practices, and providing a realistic end-to-end flow that can be easily extended.
  </p>

  <p>
    <img src="./docs/demo.gif" alt="VenCura demo" style="border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,.12); max-width: 100%; height: auto;" />
  </p>

  <p>
    <a href="https://nodejs.org/" target="_blank" rel="noreferrer noopener">
      <img alt="Node 18+" src="https://img.shields.io/badge/node-%3E%3D18-0b7285" />
    </a>
    <a href="#license">
      <img alt="License" src="https://img.shields.io/badge/license-MIT-0b7285" />
    </a>
    <a href="https://github.com/agurod42/dynamic-take-home/actions/workflows/tests.yml">
      <img alt="Backend tests" src="https://github.com/agurod42/dynamic-take-home/actions/workflows/tests.yml/badge.svg" />
    </a>
    <img alt="Tech" src="https://img.shields.io/badge/ethers.js-v6-0b7285" />
  </p>
</div>

---

## Design decisions

### Technical pillars

- Favor simplicity and clarity over breadth: small, focused modules in `server/services/*`, a thin `routes.js`, and a lightweight UI.
- Data model choices: single active session per user to simplify revocation and tracking.
- Cryptography decisions: Argon2id for password hashing; AES-256-GCM for key-at-rest encryption with a key derived via `scrypt`; private keys never leave the backend. Note: Initially, I used Node’s crypto.scryptSync for simplicity, but later decided to make the backend more realistic by introducing Argon2id, which follows the current OWASP recommendation.
- Auth transport: bearer tokens are pragmatic for a demo; JWTs or an expiring session store are called out as future hardening.

### Prioritization

1. Establish the core user journeys first: registration/login, wallet creation, balance display, message signing, and transfers.
2. Build a secure foundation up front: password hashing, session model, encrypted key storage, and a minimal but robust database schema with constraints.
3. Optimize for local developer experience: default to a simulated chain for fast iterations; keep on-chain mode opt-in via `CHAIN_MODE`.
4. Add production guardrails: env validation, per-request authorization, and mode-specific feature flags (e.g., disabling deposits on-chain).

### Future enhancements

- Multi-account support per user with configurable account types.
- Shared wallets with invite flows.
- Transaction status polling and integration with on-chain explorers.
- Notifications or messaging (e.g., XMTP) for signed events.
- Replace the vanilla UI with a component library (React/Vue) once requirements grow.

## Getting started

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

- `CHAIN_MODE` – `simulated` (default) keeps everything local; `sepolia` enables live on-chain flow.
- `SEPOLIA_RPC_URL` – HTTPS RPC endpoint to use when `CHAIN_MODE=sepolia` (defaults to the provided Infura URL).
- `KEY_ENCRYPTION_SECRET` – required secret used to encrypt wallet private keys at rest (minimum 32 characters). The service refuses to start if this is not set.

The server stores all data in Postgres.

## Security considerations

While the project is intentionally lightweight, the implementation keeps security in mind, organized by area:

### Authentication and sessions

- Passwords are hashed with memory-hard `Argon2id` and a per-user salt.
- Minimum password length of 8 characters is enforced at registration.
- Password verification uses constant‑time comparison to avoid timing leaks.
- Bearer tokens are required on protected routes via the `Authorization` header.
- Session tokens are 48-byte random values and are stored hashed (`SHA-256`) in the database.
- Only one active session per user is kept; logging in invalidates prior sessions. `last_seen_at` is updated per request.

### Key management and cryptography

- Wallet private keys never leave the backend and are never returned in API responses.
- Private keys are encrypted at rest with AES-256-GCM. The encryption key is derived from `KEY_ENCRYPTION_SECRET` using `scrypt` and each payload stores IV + auth tag with the ciphertext.
- The service refuses to start unless `KEY_ENCRYPTION_SECRET` is set to a high‑entropy value (min 32 chars; rejecting known weak defaults).

### Access control and data isolation

- Per-request authorization is enforced; wallet operations verify ownership and return `403` when the user does not own the wallet.
- Database constraints ensure uniqueness for user emails and wallet addresses, with foreign keys and `ON DELETE CASCADE` to avoid orphaned data.

### Transport, CORS, and API surface

- The UI communicates with the backend using bearer tokens; in production, serve strictly over HTTPS.
- CORS is intentionally permissive for the demo (`*` origin with preflight support). In production, restrict origins/headers/methods.

### Mode-specific behavior

- Two modes: `simulated` (local ledger) and `sepolia` (on-chain). Deposits are disabled in on-chain mode to avoid inconsistent balances.
- The JSON-RPC provider is only constructed and used in on-chain mode.

### Further hardening (out of scope for the take-home but recommended in production):

- Move encrypted keys into an HSM or dedicated key-management service.
- Replace the simple session model with signed JWTs or opaque tokens backed by a secure, expiring session store; add rotation/revocation.
- Add rate limiting, audit logging, and monitoring.
- Restrict CORS to trusted origins; if switching to cookies, use HttpOnly + SameSite and add CSRF protections.
- Rotate RPC credentials securely and add transaction status tracking.
- Introduce role-based access control (RBAC) for shared wallets and multi-user scenarios.

## License

MIT © 2025 Agu Rodríguez. See `LICENSE` for details.
