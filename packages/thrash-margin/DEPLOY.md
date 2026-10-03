# DEPLOY.md — Thrash Margin deployment guide

## Stack

| Layer    | Service    | Cost              |
|----------|------------|-------------------|
| Frontend | Vercel     | Free tier         |
| API      | Vercel     | Free tier (serverless functions) |
| Database | Supabase   | Free tier (500MB) |
| Domain   | Cloudflare | ~£10/yr (optional)|

---

## 1. Supabase — run the schema

1. Go to your Supabase project → **SQL Editor**
2. Paste the contents of `db/schema.sql` (repo root) and run it
3. Go to **Settings → Database → Connection string → Transaction mode**
4. Copy the URL — it looks like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
   This is your `DATABASE_URL`.
5. Admins: nothing to run. The role column and the `login_failures` and `admin_audit` tables
   are added automatically on first use. On a database with no admin yet, the first admin is the
   first sign-in matching `ADMIN_USERNAMES` (capitals ignored), or failing that the oldest account;
   after that the variable is ignored and can be removed, and admins are granted and removed on
   the portal's Admin page.
6. Backups: in Supabase, **Database → Backups**, confirm daily backups are listed. The table
   definitions are in `db/schema.sql`, but the data exists only in Supabase and its backups.

---

## 2. Vercel — deploy frontend + API

**This project no longer deploys standalone.** As of the Banco di Niccolo portal (see repo-root `vercel.json`), the single Vercel project covers the whole monorepo: a landing page at `/`, this app under `/thrash-margin/`, Niccolo under `/niccolo/`, and this app's `api/` functions re-exported via thin shims at repo-root `/api/*`. Root Directory is **empty / repo root**, not `thrash-margin` — leave it that way. The build is driven by `scripts/build-portal.sh`, not by anything in this folder.

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import `AAtithe/ThrashMargin`
2. Leave **Root Directory** empty (repo root)
3. Framework preset: **Other** (Vercel auto-detects from the repo-root `vercel.json`)
4. Add these **Environment Variables** in the Vercel dashboard (same as before — the API's env vars are unaffected by the portal restructuring):

   | Key              | Value                                      |
   |------------------|--------------------------------------------|
   | `DATABASE_URL`   | Your Supabase Transaction mode URL (above) |
   | `JWT_SECRET`     | Run `openssl rand -base64 32` to generate  |
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
DATABASE_URL=postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres
JWT_SECRET=<32+ char random string>
CORS_ORIGIN=https://your-domain.vercel.app
```
