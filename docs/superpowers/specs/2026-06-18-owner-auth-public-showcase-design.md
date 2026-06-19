# Owner Authentication + Public Showcase Mode — Design

**Date:** 2026-06-18
**Status:** Approved (pending final spec review)
**App:** job-viewer (LinkedIn job tracker fed by an n8n scraper)

## 1. Problem & Goals

The app is linked from a public portfolio, so anonymous visitors must be able to
*see* a believable job board, but must **not** be able to see the owner's real job
searches / PII, mutate any real data, or trigger the n8n scraping pipeline (an
expensive/external action).

Replicate the proven owner-auth pattern from the manga-tracker app, adapted to this
repo's stack (Express + TypeScript, currently flat JSON files).

Goals:

1. One **owner** account (the developer), seeded from env vars, with no public signup UI.
2. A **demo** account that logged-out visitors resolve to: a frozen sample of jobs they
   can drag/edit **client-side only** (resets on refresh), with all live/owner features
   hidden and rejected server-side.
3. Every expensive/external/private action becomes **owner-only**:
   - `POST /api/trigger-scrape` (fires the n8n scraper webhook)
   - `POST /api/generate-cover-letter` (fires an n8n AI webhook **and** reads owner PII)
   - all data mutations (create/patch/bulk-move/delete jobs)
4. Multi-user-ready backend: per-user data scoped by `user_id`.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Public visitor experience | **Interactive sandbox** — drag/edit allowed but never persisted (client-side only), resets on refresh; n8n scrape + AI cover letter are owner-only |
| Storage | **SQLite** (`better-sqlite3`), replacing flat JSON files; users + jobs tables with `user_id` scoping + one-time migration from existing JSON |
| Public sample data | **Reuse the existing 5 dummy "acting" jobs** from `jobs.json`, frozen into a committed `public-sample.json` |
| Inbound n8n webhook (`receive-jobs`) | **Shared-secret header** (`X-Webhook-Secret` from env) |
| identity.json PII | **Gitignore only** (stop tracking going forward; history scrub deferred as a follow-up) |

## 3. Architecture

Refactor the monolithic `server.ts` into small, single-purpose, injectable modules so
each can be unit-tested with an in-memory SQLite DB:

```
server.ts                 # thin entry: open DB at data/, createApp(db).listen(PORT)
src/server/
  db.ts                   # open SQLite (file or ':memory:'), schema, migration, seeding
  auth.ts                 # hashing, session tokens, middleware, secret loading
  jobs.ts                 # data-access (all queries scoped by userId)
  app.ts                  # createApp(db) -> Express app (no .listen) — testable
public-sample.json        # committed frozen demo jobs (the acting set)
```

**Why a `createApp(db)` factory:** tests construct an app over a `:memory:` DB and hit it
via `app.listen(0)` + global `fetch` — no test HTTP dependency (e.g. supertest) needed.

## 4. Data Model — SQLite

DB file: `data/jobviewer.db` (gitignored, lives on the persistent volume).

**users**
- `id` INTEGER PK AUTOINCREMENT
- `username` TEXT UNIQUE NOT NULL
- `password_hash` TEXT NULL   (demo user has no password)
- `role` TEXT NOT NULL CHECK(role IN ('owner','demo'))
- `created_at` TEXT NOT NULL

**jobs** — composite primary key `(user_id, id)`
- `user_id` INTEGER NOT NULL REFERENCES users(id)
- `id` TEXT NOT NULL            (existing sha1 content hash)
- `title, company, location, url, status, statusSummary, statusSummaryUpdatedAt,`
  `appliedDate, scrapedDate, notes, summary, posted`  (existing Job fields)
- PRIMARY KEY (`user_id`, `id`)

> This is the "table keyed only by item id → add user_id to the PK" fix called out in the
> brief. The sha1 `id` can collide across owner and demo (same job), so it must be
> composite.

**history**
- `user_id` INTEGER NOT NULL REFERENCES users(id)
- `date` TEXT NOT NULL
- `wins` TEXT (JSON), `basePoints`, `scoreMultiplier`, `totalPoints`
- PRIMARY KEY (`user_id`, `date`)

**scrape_info**
- `user_id` INTEGER PK REFERENCES users(id)
- `lastTriggerDate` TEXT NULL

### Migration (one-time, idempotent)
On startup, after seeding the owner: if the owner has **zero** jobs and `jobs.json`
exists, import its rows under the owner's `user_id`. Same for `history.json` and
`scrape_info.json`. Guarded so it never re-imports or clobbers existing DB data.

### Seeding (idempotent, non-destructive)
- **Owner** from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (defaults `me` / `0000`):
  - set username only if it is still the default placeholder,
  - set password only if none exists yet,
  - **always** re-assert `role='owner'`.
  - Never clobber an existing credential on redeploy.
- **Demo** user (`role='demo'`, no password): if the demo user has no jobs, seed the
  jobs from `public-sample.json` (the frozen acting set).

## 5. Auth Module (`src/server/auth.ts`)

Zero extra crypto dependencies — Node built-in `crypto`.

- `hashPassword(plain) -> "scrypt$<saltHex>$<hashHex>"`
- `verifyPassword(plain, stored) -> boolean` using `crypto.timingSafeEqual`
- `createSessionToken(userId, secret, ttlMs) -> token`
  - token = `base64url(userId) "." expiryEpochMs "." HMAC-SHA256(secret, "uid.expiry")`
- `verifySessionToken(token, secret) -> { userId } | null`
  - **Bug carried over from manga app:** before `Buffer.from(hmacHex,'hex')` / compare,
    reject any HMAC segment not matching `/^[0-9a-f]{64}$/`. Otherwise a tampered
    `"<token>x"` truncates silently and passes. Covered by a dedicated test.
  - reject expired (`expiry < Date.now()`).

**Session cookie** (`jv_session`):
- value = the signed token above
- flags: `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV==='production'`,
  `Path=/job-viewer`, `Max-Age` = 30 days.
- "remember me" is simply the long-lived cookie (no extra mechanism).

**Signing secret:** from `SESSION_SECRET` env, else auto-generated once
(`crypto.randomBytes(32).toString('hex')`) and persisted to `data/session.secret`
(gitignored) so logins survive restarts/redeploys.

**Webhook secret:** `WEBHOOK_SECRET` env, compared in constant time against the
`X-Webhook-Secret` header on `POST /api/receive-jobs`.

### Middleware
- `attachUser`: read `jv_session`, verify → set `req.user` / `req.userId` to the owner.
  On any failure, fall back to the **demo** user. Mounted before all routes.
- `requireOwner`: respond `403` unless `req.user.role === 'owner'`.

## 6. Route Protection Map

| Route | Access | Notes |
|---|---|---|
| `GET  /api/me` | public | `{authenticated, username, role, isDemo}` |
| `POST /api/login` | public | `{username,password}` → set cookie; reject `demo` role; generic 401 |
| `POST /api/logout` | public | clear cookie |
| `GET  /api/jobs` | any | scoped to `req.userId` (owner→real, anon→demo) |
| `GET  /api/history` | any | scoped to `req.userId` |
| `GET  /api/scrape-info` | any | scoped to `req.userId` |
| `POST /api/jobs` | requireOwner | |
| `PATCH /api/jobs/bulk-move` | requireOwner | |
| `PATCH /api/jobs/:id` | requireOwner | |
| `DELETE /api/jobs/status/:status` | requireOwner | |
| `POST /api/trigger-scrape` | requireOwner | n8n scraper |
| `POST /api/generate-cover-letter` | requireOwner | n8n AI + reads PII |
| `POST /api/receive-jobs` | shared-secret header | writes to owner's `user_id` |

`POST /api/receive-jobs` **fails closed**: if `WEBHOOK_SECRET` is unset on the server, or
the request's `X-Webhook-Secret` is missing/wrong, return `403` and write nothing.

`POST /api/login`: verify credentials, set cookie, return `{username, role}`. Reject the
demo role from logging in. Return a generic `401 "Invalid credentials"` with no field hints.

## 7. Public Interactive Sandbox — Contract

The server is strict: **every write is owner-only and returns 403 to the demo user.** The
"sandbox" is a frontend illusion:

- When not owner, the UI still lets the visitor drag cards and edit fields, but it
  **skips the persistence fetch** and updates local state only.
- A refresh re-fetches the demo sample from the server → the visitor's edits reset.
- No daily reset job, no scheduled refresh (YAGNI). The demo data is only ever changed by
  editing `public-sample.json` and redeploying.

This guarantees a visitor can never persist to the demo dataset (even with a crafted
request, they get 403) and can never reach n8n.

## 8. Frontend Changes

- On load, call `GET /api/me` (`credentials:'same-origin'`) to render header state.
- Add a top-right **SIGN IN** button and a **login modal** (username/password).
- Add a slim **"Public demo — sign in for live features"** banner shown when not owner.
- Track `isOwner` in state. When not owner:
  - hide the **trigger-scrape** button and the **AI cover letter** template button
    (local string templates still work),
  - route all mutations (drag-move, edit, add, delete) through local-state-only paths
    (skip the API call).
- When owner: show all controls plus a **LOGOUT** button.
- Auth fetches (`/login`, `/logout`, `/me`) send `credentials:'same-origin'` explicitly.

## 9. Config / Environment / Deployment

New env vars:

| Var | Purpose | Default |
|---|---|---|
| `ADMIN_USERNAME` | owner seed username | `me` |
| `ADMIN_PASSWORD` | owner seed password | `0000` |
| `SESSION_SECRET` | cookie signing secret | auto-generated to `data/session.secret` |
| `WEBHOOK_SECRET` | guards `receive-jobs` | (required for n8n delivery) |
| `N8N_SCRAPE_URL` | scraper webhook | replaces hardcoded `localhost:5678/...` |
| `N8N_COVER_LETTER_URL` | AI cover letter webhook | replaces hardcoded `localhost:5678/...` |

`.gitignore` additions: `data/`, `data/session.secret`, and `src/assets/identity.json`
(currently committed PII — stop tracking; history scrub deferred).

Persistence: `data/` (DB + session secret) survives `git reset --hard origin/main` on the
AWS PM2 deploy because it is gitignored, and maps to a Coolify persistent volume on the
Hetzner migration.

Static caching: Vite content-hashes the JS/CSS bundle, so Cloudflare's browser cache won't
serve a stale bundle after deploy; ensure `index.html` itself is not long-cached.

## 10. Testing (TDD)

Runner: Node built-in `node:test` executed via `tsx` (already a devDependency) — zero new
test deps. HTTP tests use `createApp(db)` over a `:memory:` SQLite DB, `app.listen(0)`, and
global `fetch`.

Coverage:
- hash round-trip + wrong-password rejection
- token valid / tampered / expired **+ the hex-guard case** (`"<token>x"` rejected)
- `attachUser`: valid cookie → owner; no cookie → demo; tampered cookie → demo
- `requireOwner`: 403 for demo/anon, passes for owner
- `POST /login`: success sets cookie; wrong password → 401; demo role → rejected
- `GET /me` reflects authenticated vs demo state
- **two-user isolation:** owner's jobs and demo's jobs do not collide
- owner-only endpoints: 403 anonymous, 200 owner (scrape, cover letter, mutations)
- `receive-jobs`: rejected without/with-wrong secret, accepted with correct secret

## 11. Side Fixes (in scope — they touch this work)

- Remove the **duplicate** `POST /api/generate-cover-letter` handler (`server.ts:291`);
  keep a single handler that reads the n8n URL from env.
- Move both n8n webhook URLs to env vars.
- Gitignore `identity.json` and keep a local/server copy off the repo going forward.

## 12. Out of Scope (YAGNI)

- Multi-owner / multi-tenant UI, registration, password reset/change UI.
- Server-side persistence of the demo's ephemeral edits.
- Scheduled refresh of the public sample.
- Rewriting git history to purge `identity.json` (deferred follow-up).
