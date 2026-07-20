# Security Overview

This document summarizes the security controls in the ShreeVedha application
and the steps required for a safe production deployment.

## Production checklist

Before deploying with `APP_ENV=production`, set these environment variables
(see [.env.example](.env.example)):

- [ ] **`SECRET_KEY`** — 64-hex-char random value. The app **refuses to start**
      in production without it. Generate:
      `python -c "import secrets; print(secrets.token_hex(32))"`
- [ ] **`ADMIN_PASSWORD_HASH`** — hashed admin password (preferred over plaintext).
      Generate:
      `python -c "from werkzeug.security import generate_password_hash as g; print(g('your-password'))"`
- [ ] **`DATABASE_URL`** — a durable database (e.g. Postgres). The default SQLite
      file and local uploads are **ephemeral** on serverless hosts like Vercel.
- [ ] Serve exclusively over **HTTPS** (secure cookies + HSTS are enabled in prod).

## Controls implemented

| Area | Control |
|------|---------|
| **Secrets** | No hardcoded `SECRET_KEY`; required in prod, ephemeral random in dev. |
| **Admin auth** | Constant-time username/password comparison; supports a hashed password; session is regenerated on login. |
| **Sessions** | `HttpOnly`, `SameSite=Lax`, `Secure` (prod) cookies; 12 h lifetime; Flask-Login `session_protection='strong'`. |
| **CSRF** | Global `CSRFProtect`; 4 h token lifetime; tokens on all POST forms. |
| **Brute force** | Per-email lockout after N failed attempts (configurable); lockout checked before user lookup so it can't be bypassed with unknown emails. |
| **User enumeration** | Login always returns a generic error and runs a password check even when the user doesn't exist (uniform timing). |
| **Passwords** | Min length (default 8) + letters-and-numbers requirement, enforced on register and password change. |
| **File downloads** | `safe_static_path()` resolves stored paths and rejects directory-traversal (`../`) escapes outside `static/`. |
| **HTTP headers** | `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS (prod) on every response. |
| **Proxy awareness** | `ProxyFix` trusts `X-Forwarded-*` so secure cookies/scheme work behind a TLS-terminating proxy. |
| **Audit logging** | Logins, failed logins, password changes, and admin actions recorded with IP. |

## Known limitations / follow-ups

- **CSP allows `'unsafe-inline'`** because templates use inline `<style>`/`<script>`.
  Externalize those assets and switch to a nonce-based policy to fully close XSS vectors.
- **Uploads are stored on local disk**, which is ephemeral on serverless hosts.
  Move to object storage (S3-compatible) for durable production uploads.
- **Rate limiting** is auth-only (login lockout). Consider a global limiter
  (e.g. Flask-Limiter) for write endpoints if abuse becomes a concern.

## Reporting

Report suspected vulnerabilities privately to **security@shreevedha.com**.
