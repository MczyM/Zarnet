# Deploying the investor demo to demo.zarnet.online

I've already created the Netlify site for this (name: `zarnet-demo-portal`,
id: `ce4552d5-45e0-4f66-81c8-255dc26c1c1e`) under your Netlify account. What's
left needs to run from your laptop — Netlify and Railway's chat integrations
can configure an existing project, but neither can push fresh files into one
from here. These are the only two things you need to do.

Do these in order — the backend needs to exist before the frontend's proxy
config points at it.

## 1. Backend → Railway (~5 min)

```bash
cd zarnet-backend
npm install -g @railway/cli      # skip if you already have it
railway login                    # opens a browser to sign in/sign up
railway init                     # creates a new Railway project — say yes
railway add --database postgres  # provisions a free Postgres instance
railway up                       # deploys this folder
```

Then set the required environment variables (Railway dashboard → your
project → Variables tab, or `railway variables set KEY=value` per line):

```
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
SOLANA_CLUSTER_URL=https://api.devnet.solana.com
CORS_ORIGINS=https://demo.zarnet.online
```
`DATABASE_URL` is set automatically by `railway add --database postgres`.

Then run the one-time setup against that deployed instance:
```bash
railway run npm run migrate
railway run npm run create-admin -- --email=you@zarnet.online --password=yourpassword
```

Railway will give you a public URL like `https://zarnet-backend-production.up.railway.app`
(Settings → Networking → Generate Domain if it's not shown yet). **Copy that URL.**

## 2. Frontend + admin → Netlify (~3 min)

Open `netlify.toml` in this folder and replace `REPLACE-WITH-YOUR-BACKEND-URL`
with the Railway URL you just copied (no `https://`, no trailing slash — just
the host, e.g. `zarnet-backend-production.up.railway.app`).

Then:
```bash
npm install -g netlify-cli       # skip if you already have it
netlify login
netlify link --id ce4552d5-45e0-4f66-81c8-255dc26c1c1e
netlify deploy --prod
```

That gives you a live URL at `https://zarnet-demo-portal.netlify.app` immediately.

## 3. Point demo.zarnet.online at it (~2 min)

In the Netlify dashboard (app.netlify.com → zarnet-demo-portal → Domain
management → Add a domain) add `demo.zarnet.online`. Netlify will show you
either one CNAME record or a couple of DNS records to add — go to wherever
you manage zarnet.online's DNS (your domain registrar, or Cloudflare if
that's in front of it) and add exactly what Netlify shows you. This part
Netlify explains inline with copy-paste-ready values, so I won't guess at
DNS records you haven't confirmed to me.

DNS usually takes a few minutes to a few hours to propagate. Once it does,
`https://demo.zarnet.online` is your investor link — pre-seeded with the
`demo` site's 5 packages, ready to walk someone through purchase → connect →
admin dashboard.

## After that, ping me back

Send me the Railway backend URL and I'll verify it's actually responding
correctly (health check + a real purchase/redeem cycle) rather than just
assuming it's fine.
