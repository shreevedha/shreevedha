# Deploying to Vercel

This app is a Flask WSGI app served by Vercel's `@vercel/python` runtime via
[api/index.py](api/index.py). Postgres (Neon) and MongoDB (Atlas) are external,
so they persist across serverless cold starts; certificates are regenerated on
demand and uploads should use Mongo/GridFS (local disk is ephemeral on Vercel).

## 1. One-time: provision the database

Tables only need to be created once. Run locally with your **production**
`DATABASE_URL` in the environment:

```bash
python create_tables.py
```

(Our Neon database is already provisioned, so you can skip this.)

## 2. Set environment variables in Vercel

Project → **Settings → Environment Variables**. Add each for the
**Production** (and Preview) environments:

| Variable | Value |
|----------|-------|
| `APP_ENV` | `production` |
| `AUTO_CREATE_DB` | `0`  *(tables already exist; skip per-cold-start schema check)* |
| `SECRET_KEY` | *(64-hex random; generate below)* |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD_HASH` | *(hash of your admin password; generate below)* |
| `DATABASE_URL` | `postgresql://<user>:<password>@<neon-pooler-host>/<db>?sslmode=require` |
| `MONGO_URI` | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=Cluster0` |
| `MONGO_DB` | `shreevedha` |

> ⚠️ **Never commit real secret values to this file** — it is in the repo. Keep
> the actual values only in the Vercel dashboard and a password manager.

Generate the secret key and admin-password hash:

```bash
# SECRET_KEY
python -c "import secrets; print(secrets.token_hex(32))"

# ADMIN_PASSWORD_HASH (you'll be prompted for the password)
python -c "from werkzeug.security import generate_password_hash as g; print(g(input('admin password: ')))"
```

> In production the app **refuses to boot** without `SECRET_KEY` and an admin
> credential — that's intentional. `ADMIN_PASSWORD_HASH` is preferred over a
> plaintext `ADMIN_PASSWORD` so no plaintext lives in the environment.

## 3. Atlas / Neon network access

- **MongoDB Atlas** → Network Access → allow `0.0.0.0/0` (Vercel's egress IPs are
  dynamic), or Atlas's Vercel integration. Without this, Mongo auth/connection
  will fail and the app falls back to local JSON (which is ephemeral on Vercel).
- **Neon** already allows connections over SSL from anywhere by default.

## 4. Deploy

Connect the GitHub repo in the Vercel dashboard (Add New → Project → import the
repo), or from the CLI:

```bash
npm i -g vercel
vercel --prod
```

Vercel auto-detects `vercel.json` and `requirements.txt`.

## Notes & limitations on serverless

- **Cold starts**: each cold start opens new DB connections. We use Neon's
  *pooler* host + SQLAlchemy `pool_pre_ping`/short recycle to stay healthy.
- **No persistent disk**: anything written to `static/uploads/` or `static/data/`
  is lost between invocations. Public content uses MongoDB; certificates are
  regenerated on download. Move any remaining file uploads to GridFS for
  durability (helpers exist in [api/mongo_store.py](api/mongo_store.py)).
- **Secrets**: `.env` is git-ignored and is **not** uploaded. All config must be
  set in the Vercel dashboard as above.

## After first deploy — security

Rotate any credential that has been shared in plaintext (Neon password, Mongo
password). See [SECURITY.md](SECURITY.md).
