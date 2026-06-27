# DEPLOY.md — Thrash Margin deployment guide

## Overview

| Layer    | Service  | Cost       |
|----------|----------|------------|
| Backend  | Railway  | Free tier  |
| Database | Railway  | Free tier (500MB)  |
| Frontend | Vercel   | Free tier  |
| Domain   | Cloudflare | ~£10/yr  |

---

## 1. GitHub

```bash
git init
git add .
git commit -m "Initial commit — Thrash Margin"
git remote add origin https://github.com/YOUR_USERNAME/thrash-margin.git
git push -u origin main
```

---

## 2. Railway (backend + database)

1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select `thrash-margin`, set root directory to `server/`
3. Add a Postgres plugin to the project
4. Set environment variables in Railway dashboard:
   - `DATABASE_URL` — Railway auto-injects this from the Postgres plugin
   - `JWT_SECRET` — generate with `openssl rand -base64 32`
   - `JWT_EXPIRES_IN` — `7d`
   - `NODE_ENV` — `production`
   - `CORS_ORIGIN` — your Vercel frontend URL (add after Vercel deploy)
5. Railway build command: `npm install && npm run build`
6. Railway start command: `npm start`
7. Run migrations: in Railway shell → `npm run migrate`

---

## 3. Vercel (frontend)

1. Go to vercel.com → New Project → Import from GitHub
2. Select `thrash-margin`, set root directory to `client/`
3. Framework preset: Vite
4. Set environment variables:
   - `VITE_API_URL` — your Railway backend URL (e.g. https://thrash-margin-api.railway.app)
5. Deploy

---

## 4. Cloudflare (domain + SSL)

1. Buy `threshmargin.com` (or your chosen domain) via Cloudflare Registrar
2. Add a CNAME record pointing to your Vercel deployment
3. SSL is automatic via Cloudflare
4. Update `CORS_ORIGIN` in Railway to your custom domain

---

## Environment variable summary

### Server (Railway)
```
DATABASE_URL=<auto from Railway Postgres plugin>
JWT_SECRET=<32+ char random string>
JWT_EXPIRES_IN=7d
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://yourdomain.com
```

### Client (Vercel)
```
VITE_API_URL=https://your-railway-backend.railway.app
```
