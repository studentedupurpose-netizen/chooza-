# ChoozaCoinX API foundation (test environment)

This is a development foundation, not a production-ready exchange. It includes registration/login, a PostgreSQL test ledger, balances, order book/trades endpoints, and a transactional limit-order matching prototype. Trading is disabled unless an operator manually marks an account `test_approved` and credits test balances directly in the database.

## Run locally
1. Install Docker and Node.js 20+.
2. `cd backend`
3. Copy `.env.example` to `.env`, set a unique random `JWT_SECRET` of 32+ characters.
4. `docker compose up -d`
5. `npm install`
6. `npm start`

API: `http://localhost:4000/api/health`

## Test-only operator setup
After registering a user, use a controlled local development database session to:
- set that user's status to `test_approved`;
- seed test balances in `accounts` (for example `USDT` and `BTC`).
Never expose direct database access or this process to customers. Do not seed real customer value.

## Critical production gaps
- No deposit/withdrawal, blockchain node integration, private-key handling, custody, fiat rails, or real funds.
- No production KYC/AML/sanctions provider, licensing/legal approval, travel-rule handling, market surveillance, fraud controls, or customer support workflows.
- No external liquidity or executable market data. Internal orders only match other approved test accounts.
- No MFA, email verification, password reset, session revocation, device management, admin RBAC, audit-grade immutable ledger, idempotency keys, websocket streaming, robust decimal arithmetic library, or comprehensive tests.
- Matching code is an educational prototype and requires independent correctness/security review before any use beyond local testing. In particular, fee accounting, partial-fill reserve accounting, concurrency, and edge cases must be formally tested and corrected.
- Do not accept deposits or promise real-money execution. Obtain jurisdiction-specific legal advice for each market and incorporate only after compliance, custody, security, liquidity, and operational controls are independently approved.
