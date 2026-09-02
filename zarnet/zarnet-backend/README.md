# Zarnet backend

Multi-site voucher API + Omada captive-portal integration + Solana/ZRT
settlement. See the top-level README for the product picture; this file is
the operational reference for this service specifically.

## Install & run

```bash
npm install
cp .env.example .env
npm run migrate          # creates tables, seeds a 'demo' site + 5 packages
npm run create-admin -- --email=you@zarnet.online --password=yourpassword
npm run dev
```

`GET /health` should return `{"ok":true}`.

## Onboarding a new client site

```bash
npm run create-site -- --slug=sunset-backpackers --name="Sunset Backpackers" --wallet=<their-solana-pubkey>
npm run create-admin -- --email=ops@sunsetbackpackers.com --password=... --site=sunset-backpackers
```
Then, either via the admin dashboard's Site Settings panel or `PATCH /sites/:slug`,
fill in that site's Omada controller details once the hardware is on-site.

## Enabling real ZRT settlement

Redemptions work and vouchers activate immediately without this — settlement
just queues as `pending` until you run this once:

```bash
npm run setup-zrt-mint
```

This creates the ZRT token mint and a treasury keypair, airdrops itself
devnet SOL to pay for the mint-creation transaction, and prints the two
values to paste into `.env`: `ZRT_MINT_ADDRESS` and `ZRT_TREASURY_SECRET_KEY`.
Restart the backend after adding them — the settlement worker will start
draining the pending queue automatically.

## What to register / provision before going beyond a local pilot

See the checklist in the handoff message — it covers Postgres hosting, Node
hosting (needs to be a persistent process, not serverless, because of the
background workers), Solana devnet vs mainnet, and the FSCA consideration
around the ZRT settlement design.

## Architecture notes

- **Every table is scoped by `site_id`.** Route-level middleware
  (`requireSiteAccess`) enforces that an operator token can only touch their
  own site's data; a `super_admin` token (no site) can touch any site.
- **Redemption is synchronous, settlement is async.** `POST
  /sites/:slug/vouchers/:code/redeem` talks to Omada and writes the DB
  change (voucher activation + session + ledger entry) in one transaction,
  then returns immediately. `src/workers/settlementWorker.js` drains
  `ledger_entries` on its own schedule and retries failures with a cap
  (`ZRT_SETTLEMENT_MAX_ATTEMPTS`) before parking them as `failed` for
  manual review in the dashboard.
- **Two purchase paths, one redemption path.** `payment_method` is either
  `'solana'` (customer paid live via their own wallet — `solana_tx_sig` gets
  set once `check-payment` confirms it on-chain) or `'cash_reseller'`
  (pre-generated via `/batch`, no wallet involved). Both are equally "paid"
  at redeem time; the ZRT settlement step afterward is identical either way.
- **Omada credentials are per-site**, not global — every client runs their
  own OC200. `src/services/omada.js` takes the site row as a parameter
  rather than reading a single global env var.
- **Unhandled async errors don't crash the process.** `express-async-errors`
  is required first in `src/server.js` specifically because Express 4 does
  not catch rejected promises from async route handlers by default — without
  it, one site's misconfigured Omada controller would take down every site's
  portal at once. Found this the hard way during testing; keep it.

## Known, deliberately-unbuilt gaps

- No forced early disconnect from Omada before natural expiry (see top-level
  README).
- `ZAR_PER_SOL` is a hardcoded env var. Fine for devnet; wire to a live
  price feed (Pyth's SOL/USD, converted to ZAR) before any mainnet money
  moves through the direct-wallet-payment path.
- `omada_operator_password` is stored in plaintext in the `sites` table for
  pilot simplicity. Encrypt at rest (e.g. `pgcrypto`, or move it to a
  secrets manager) before handling real client credentials at scale.
