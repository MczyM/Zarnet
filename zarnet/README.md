# Zarnet — token-based captive portal (multi-site)

This is the real backend + admin UI + captive-portal frontend for the
**Zarnet token-based product** — sold separately to hostels, schools, and
businesses. (Not the zarnet.online ISP-reseller website — that's a
different product.)

## How it actually works

1. A customer buys WiFi access one of two ways:
   - **Pays live with their own Solana wallet** at the portal (Solana Pay), or
   - **Buys a voucher code for cash** from the site (or a reseller), which
     the site operator pre-generates in bulk from the admin dashboard.
2. Either way, they end up with a voucher code and enter it at the captive
   portal (`connect.html`) after joining the WiFi.
3. The backend authorizes their device on that site's Omada controller
   **immediately** — no blockchain wait in the critical path.
4. In the background, the backend mints ZRT (Zarnet's own SPL token) to
   **that site's own wallet** — never the customer's — recording the
   redemption on-chain as an auditable revenue/access ledger. This is what
   "the voucher converts to Solana in the backend" means concretely: every
   redemption, regardless of how it was paid for, ends up as a real
   on-chain transaction the site operator can independently verify.
5. If the on-chain settlement fails (network hiccup, RPC timeout), it
   retries automatically in the background — the customer is never blocked
   by it, and nothing is ever silently dropped (the ledger row is written
   in the same DB transaction that activates the voucher).

## Multi-site from day one

One deployment serves every client. Each site (hostel/school/business) has
its own packages, its own Omada controller credentials, its own branding,
and its own Solana wallet. You (the admin) onboard a new site manually —
either through the admin dashboard or `npm run create-site` — there's no
public self-serve signup.

## What's in this download

```
zarnet-backend/     Express API — see zarnet-backend/README.md
zarnet-frontend/    Customer-facing pricing, purchase, and captive-portal pages
zarnet-admin/       Operator dashboard (login, stats, packages, vouchers, settings)
```

All three are plain HTML/JS or plain Node — no build step, no bundler.

## Deploying the investor demo to demo.zarnet.online

See `zarnet-site/DEPLOY.md` — a combined, deploy-ready bundle of the
frontend + admin dashboard (with the API calls already pointed at a
same-origin `/api` path that proxies through to your backend, so the whole
thing lives under one domain with no CORS to think about). I've already
created the Netlify site for it under your account; the guide is the exact
handful of commands left to run from your laptop to get the backend hosted
and both pieces live.

## Local pilot, start to finish

```bash
# 1. Backend
cd zarnet-backend
npm install
cp .env.example .env        # fill in DATABASE_URL at minimum
npm run migrate             # creates tables + a 'demo' site with 5 packages
npm run create-admin -- --email=you@zarnet.online --password=yourpassword
npm run dev                 # http://localhost:4000

# 2. Frontend (new terminal)
cd zarnet-frontend
npx serve -l 8080           # http://localhost:8080?site=demo

# 3. Admin dashboard (new terminal)
cd zarnet-admin
npx serve -l 8081           # http://localhost:8081 — log in with the admin you created
```

Full registration/infrastructure checklist for going beyond a local pilot
is in `zarnet-backend/README.md`.

## What I tested before handing this over

Ran the real thing end-to-end against a live Postgres instance and a mock
Omada controller (standing in for your OC200, which isn't here yet):
purchase → cash-voucher batch generation → redeem → device-limit
enforcement → idempotent re-redeem on the same device → ledger entry
queued → multi-tenant isolation (an operator on one site gets a 403 trying
to touch another site's data) → dashboard stats. Found and fixed three real
bugs along the way (a process-crashing unhandled rejection, a same-device
retry that was wrongly rejected, and a payment check that ignored a valid
cash-voucher path) — see the commit-style notes at the top of
`zarnet-backend/src/routes/vouchers.js` and `src/server.js` if you want the
detail.

## What's still genuinely unverified

- The actual OC200 External Portal API calls (`src/services/omada.js`) —
  correct per the documented flow, but not yet tested against your real
  controller's firmware. Test this first once hardware arrives.
- Forced early disconnect of a device before its voucher naturally expires
  isn't wired up — deliberately, because that Omada API call varies by
  firmware and I didn't want to guess at it. Cutoff currently relies on the
  `time` duration passed to Omada at authorization.
