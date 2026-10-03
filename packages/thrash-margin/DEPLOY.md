# DEPLOY.md — Thrash Margin deployment guide

## Stack

| Layer    | Service    | Cost              |
|----------|------------|-------------------|
| Frontend | Vercel     | Free tier         |
| API      | Vercel     | Free tier (serverless functions) |
| Database | Neon       | Free tier         |
| Domain   | Cloudflare | ~£10/yr (optional)|

---

## 1. Neon — run the schema

Neon replaced Supabase in October 2026. Supabase's free tier pauses a project after a week without
traffic and it stays down until someone restores it by hand; Neon suspends idle compute too, but
the next query wakes it automatically in well under a second, so a quiet week never takes the site
down.

1. Create a project at [neon.tech](https://neon.tech) (pick the region closest to the Vercel functions, e.g. London / `eu-west-2`)
2. From the repo root, apply the schema with the **direct** connection string (Connect → pooling off):
   ```
   psql "<direct url>" -f db/schema.sql
   ```
   The schema is idempotent, so re-running it is harmless.
3. Copy the **pooled** connection string (Connect → pooling on). It looks like:
   ```
   postgresql://[user]:[password]@ep-[name]-pooler.[region].aws.neon.tech/neondb?sslmode=require
   ```
   This is your `DATABASE_URL`. Use the pooled one for the app: every Vercel function invocation
   opens its own connection and the pooler absorbs that.

### Moving existing data off Supabase (one-off)

```
SOURCE_URL="<Supabase session-mode URL, port 5432>" \
TARGET_URL="<Neon direct URL>" \
bash scripts/migrate-to-neon.sh
```

It applies the schema, refuses to run if the target already holds users, copies the five app
tables in one transaction, and compares row counts table by table. Only after it prints `Done`,
change `DATABASE_URL` in Vercel and redeploy. Keep the Supabase project until a signed-in save
and load has been confirmed on the live site; it is the rollback.

Passwords are bcrypt hashes in the `users` table and JWTs are signed with `JWT_SECRET`, neither of
which depends on the database host, so existing accounts and sessions carry over unchanged.

---

## 2. Vercel — deploy frontend + API

**This project no longer deploys standalone.** As of the Banco di Niccolo portal (see repo-root `vercel.json`), the single Vercel project covers the whole monorepo: a landing page at `/`, this app under `/thrash-margin/`, Niccolo under `/niccolo/`, and this app's `api/` functions re-exported via thin shims at repo-root `/api/*`. Root Directory is **empty / repo root**, not `thrash-margin` — leave it that way. The build is driven by `scripts/build-portal.sh`, not by anything in this folder.

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import `AAtithe/ThrashMargin`
2. Leave **Root Directory** empty (repo root)
3. Framework preset: **Other** (Vercel auto-detects from the repo-root `vercel.json`)
4. Add these **Environment Variables** in the Vercel dashboard (same as before — the API's env vars are unaffected by the portal restructuring):

   | Key              | Value                                      |
   |------------------|--------------------------------------------|
   | `DATABASE_URL`   | Your Neon pooled URL (above)               |
   | `JWT_SECRET`     | Run `openssl rand -base64 32` to generate  |
   | `JWT_EXPIRES_IN` | `7d`                                       |
   | `CORS_ORIGIN`    | Your Vercel deployment URL (add after first deploy, e.g. `https://thrash-margin.vercel.app`) |

5. Deploy — Vercel runs `scripts/build-portal.sh` (builds Niccolo and this client under their own subpaths, assembles the landing page) and deploys the root-level `api/` functions automatically.

---

## 3. Local development

```bash
# Install dependencies
npm install && cd client && npm install && cd ..

# Copy and fill in env vars
cp .env.example .env.local

# Run everything (Vercel CLI serves frontend + API functions on one port)
npm run dev   # runs `vercel dev` on http://localhost:3000
```

Install Vercel CLI if you don't have it: `npm i -g vercel`  
On first run, `vercel dev` will ask you to link to your Vercel project.

---

## 4. Custom domain (optional)

1. Buy a domain via Cloudflare Registrar
2. In Vercel: Settings → Domains → Add your domain
3. Add the CNAME record Vercel gives you in Cloudflare DNS
4. Update `CORS_ORIGIN` in Vercel env vars to your custom domain

---

## Environment variable summary

```
DATABASE_URL=postgresql://[user]:[pw]@ep-[name]-pooler.[region].aws.neon.tech/neondb?sslmode=require
JWT_SECRET=<32+ char random string>
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://your-domain.vercel.app
```
