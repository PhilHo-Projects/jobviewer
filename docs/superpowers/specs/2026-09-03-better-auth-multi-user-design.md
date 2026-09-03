# Better Auth Migration + Multi-User Accounts — Design

**Date:** 2026-09-03
**Status:** Approved (pending spec review)
**App:** job-viewer (job tracker fed by an n8n/Apify scraper)
**Supersedes the auth portions of:** `2026-06-18-owner-auth-public-showcase-design.md`

## 1. Problem & Goals

The 2026-06-18 design shipped a hand-rolled owner/demo auth: scrypt password
hashing plus a stateless HMAC session cookie. The cryptography in it is sound —
`timingSafeEqual`, a correct scrypt round-trip, and a deliberate hex guard on the
HMAC segment. The problems are structural, not cryptographic:

1. **Sessions cannot be revoked.** The token is stateless, so logout only clears
   the cookie and a leaked cookie stays valid for its full 30 days. Changing the
   password does not invalidate anything.
2. **No rate limiting.** `POST /api/login` accepts unlimited attempts.
3. **A weak seeded credential reached production.** `ADMIN_PASSWORD` was left at
   its documented default in Coolify, and that default grants owner access to the
   live site today. Verified against production on 2026-09-03.
4. **`attachUser` falls back to the demo user on every failure**, so an expired
   session is indistinguishable from an anonymous visitor.
5. **`Access-Control-Allow-Origin: *` on every route**, alongside cookie auth. Not
   a direct session leak — browsers refuse credentialed wildcard requests — but
   the wrong default, and no Origin check exists on unsafe methods.
6. **No security headers**, no CSP, no HSTS, no helmet.
7. **Roles are a two-value SQLite CHECK constraint** (`owner`, `demo`), so there is
   no path to sharing the app with anyone.

Separately, the app must scale to a handful of trusted users (friends job-hunting),
and every auth surface across this server should converge on one pattern rather
than each app inventing its own.

Goals:

1. Replace all hand-rolled identity code with **Better Auth 1.7.1**, configured
   identically to CloudSound (`PersonalSoundCloud`), which is the reference
   implementation for this server.
2. **Multi-user**: open sign-up gated by owner approval, each member with their own
   independent board.
3. Keep the **public demo board** for anonymous portfolio visitors.
4. Close the security findings above as part of the same change.

Three findings discovered during this review are **explicitly not solved by this
design** and must be handled separately and sooner — see §12.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Auth library | **Better Auth 1.7.1**, configured as in CloudSound `src/server/auth.ts` |
| Stack | **Keep Express + better-sqlite3.** Do not port to Fastify + `node:sqlite`. Uniform auth, not uniform framework — see §13 |
| Account creation | **Open sign-up, owner approval.** Sign-up issues no session; the account is pending until approved |
| Email verification | **None.** Owner approval is the human check; no mail provider in this app |
| Per-user data | **Fully separate boards.** Each user owns their rows, statuses, notes and scrapes |
| Ingestion dedup | **Out of scope**, but the `scrape_runs` shape must not preclude it later |
| Demo experience | **Kept**, and demoted from an account to a **read-from-fixture** path |
| Identity cutover | **Full cutover.** Better Auth's `"user"` is the only identity table; old `users` is dropped |
| AI cover letters | **Owner-only this pass.** Members get the three static templates |
| Base path | **`/job-viewer` → `/`.** Forced by the `__Host-` cookie prefix |

## 3. Architecture

New and changed server modules, following the existing one-purpose-per-file layout:

```
server/
  migrations.ts   # NEW  versioned migration runner + the migration list
  auth.ts         # REPLACED  buildAuth() -> Better Auth instance
  owner.ts        # NEW  ensureOwner(): first-boot owner + legacy row backfill
  admin.ts        # NEW  owner-only approve/reject routes
  config.ts       # NEW  zod-validated environment
  fixture.ts      # NEW  the anonymous demo dataset, read once at boot
  app.ts          # CHANGED  middleware chain, route map, scoping
  repo.ts         # CHANGED  userId: number -> string throughout
  db.ts           # CHANGED  openDb() delegates schema work to migrations.ts
```

`createApp(db)` stays a factory returning an Express app without `.listen`, so
tests keep constructing it over a `:memory:` database. That harness is good and
survives unchanged.

## 4. Data Model

### 4.1 Migration runner

`server/db.ts` currently calls a single `initSchema` of `CREATE TABLE IF NOT
EXISTS` statements. Rebuilding tables needs versioning, so `server/migrations.ts`
adopts CloudSound's runner: an ordered array of `{ version, sql }`, each applied
inside its own transaction that also records its version, so a crash mid-upgrade
leaves the database at the last fully-applied version rather than half-migrated.

**Migration 1** — the current schema, written `IF NOT EXISTS`. Production already
has these tables but no `schema_migrations` row; this is the same situation
CloudSound's version 1 was written for.

**Migration 2** — Better Auth 1.7.1's own schema, copied verbatim from CloudSound's
migration 3 with the `tracks` statements removed: `"user"`, `"session"`,
`"account"`, `"verification"`, `"rateLimit"`, and their indexes.

> Do **not** regenerate this with `@better-auth/cli`. That package is deprecated
> and pinned at 1.4.21, and the schema it emits omits `account.issuer`, which makes
> sign-up fail at runtime with *"table account has no column named issuer."*
> CloudSound pins that column with a test; carry the test over.

The `"user"` table carries the four `additionalFields` columns as real columns:
`role`, `approvalStatus`, `approvedAt`, `approvedBy`.

**Migration 3** — the identity cutover:

- Create fresh `jobs`, `history` and `scrape_info` with
  `user_id TEXT NOT NULL REFERENCES "user"("id")`, keeping every other column and
  the existing composite primary keys.
- Move the owner's existing rows into FK-free holding tables `legacy_owner_jobs`,
  `legacy_owner_history`, `legacy_owner_scrape_info`.
- Discard the demo user's rows; the demo is a fixture from now on.
- `DROP TABLE users`.

### 4.2 Why holding tables

The carried-over rows cannot be inserted by a migration. Their new `user_id` is the
owner's Better Auth id, which does not exist until `ensureOwner` runs at boot —
and `ensureOwner` cannot run before migration 2 has created the tables it needs.
Inserting during migration 3 would therefore violate the foreign key.

Holding tables resolve the ordering without disabling foreign key enforcement or
introducing a sentinel value that fails `PRAGMA foreign_key_check`. This mirrors
CloudSound's precedent, where migration 3 could not populate `tracks.owner_id` and
deferred it to an idempotent boot step.

### 4.3 `scrape_runs` (new)

```
id          TEXT PRIMARY KEY      -- generated per trigger
user_id     TEXT NOT NULL REFERENCES "user"("id")
status      TEXT NOT NULL         -- 'pending' | 'delivered'
created_at  TEXT NOT NULL
consumed_at TEXT
```

Indexed on `(user_id, created_at)`. Backs both the delivery contract in §7 and the
daily caps.

Expiry is **computed, never stored**: a run is accepted only while
`status = 'pending'` and `created_at` is within `RUN_EXPIRY_MINUTES` (default 30 —
a scrape takes about 60 seconds, so this is generous). There is no third status and
no sweeper job to write one; a stale `pending` row is simply never accepted again,
and it still counts toward the daily caps, which is the correct behaviour since the
Apify run it paid for did happen.

## 5. Auth Module

`server/auth.ts` is replaced by a `buildAuth({ connection, config })` returning a
Better Auth instance, with the same options in the same order as CloudSound:

- `database`: the existing better-sqlite3 `Database` instance. better-sqlite3 is
  Better Auth's own documented default driver, so this is the well-trodden path.
- `secret: config.sessionSecret`, `baseURL: config.publicOrigin`, `trustedOrigins`.
- `emailAndPassword`: `enabled: true`, `autoSignIn: false`, `minPasswordLength: 12`,
  `requireEmailVerification: false`.
- `session.expiresIn`: 30 days.
- `user.additionalFields`: `role` (default `member`), `approvalStatus` (default
  `pending`), `approvedAt`, `approvedBy` — **all `input: false`**, so Better Auth
  strips them from any request body and a sign-up POST carrying `"role":"owner"`
  cannot escalate. Privilege escalation is closed by construction.
- `databaseHooks.session.create.before`: **the approval gate, and the only one.**
  Throws `FORBIDDEN` with code `ACCOUNT_PENDING` or `ACCOUNT_REJECTED`. Because it
  sits at session creation, the existence of a session proves the account is
  approved — no downstream route re-checks approval, and there is no
  half-authenticated state for an authorization bug to hide in.
- `rateLimit`: `storage: 'database'` so counters survive restarts; window 60 /
  max 100 by default, with `/sign-in/username` and `/sign-in/email` at 5 per 15
  minutes and `/sign-up/email` at 3 per hour.
- `advanced`: `useSecureCookies: false` with `secure` set explicitly, `sameSite:
  'strict'`, `path: '/'`, and the session cookie named `__Host-jv_session` in
  production, `jv_session` otherwise.

  > `useSecureCookies: true` would emit `__Secure-__Host-jv_session`, which browsers
  > read as a plain `__Secure-` cookie, silently losing the `__Host-` guarantee.
  > This is deliberate, not an oversight.

- `plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30 })]`.

### 5.1 Express integration

Two details that do not exist in CloudSound's Fastify version:

- Mount as `app.all('/api/auth/*', toNodeHandler(auth))` from `better-auth/node`,
  and it **must be registered before `express.json()`**, because Better Auth reads
  the raw request body itself. Today `express.json({ limit: '50mb' })` is the first
  middleware; that ordering inverts, and the limit drops to `1mb` with a larger
  dedicated limit only on `receive-jobs`.
- Session lookup is
  `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`.

### 5.2 Deleted code

`hashPassword`, `verifyPassword`, `createSessionToken`, `verifySessionToken`,
`loadOrCreateSecret`, `parseCookies`, `buildSessionCookie`, `buildClearCookie`,
`COOKIE_NAME`, and the `POST /api/login` and `POST /api/logout` handlers.

Most of `server/auth.test.ts` is deleted with them, including the HMAC hex-guard
test. This is correct and not a regression: the app stops owning that code, so it
stops testing it.

`requireWebhookSecret` survives unchanged — it was already correct.

### 5.3 Owner bootstrap

`server/owner.ts` exports `ensureOwner({ auth, connection, config })`, run once at
boot after migrations:

1. If a row with `role = 'owner'` exists, skip creation entirely. The `OWNER_*`
   variables are a bootstrap, never a standing back door that resets the password
   on every deploy. Recovery is a deliberate script run against the SQLite file.
2. Otherwise create the account through `auth.api.signUpEmail` so the credential
   hash format is identical to every other account's, then promote it with a direct
   `UPDATE` to `role = 'owner'`, `approvalStatus = 'approved'`. It cannot be
   promoted through the sign-up body, because those fields are `input: false` — which
   is exactly what stops anybody else doing it.
3. Idempotently drain the holding tables into the real tables under the owner's id,
   then empty them. No-ops on every subsequent boot.

Returns the owner's id.

## 6. Route Protection Map

Middleware order: Origin check on unsafe API methods → `attachSession` → per-route
guard.

The Origin check runs **before** session resolution, so a cross-origin caller does
not even cost a session lookup: any unsafe (`POST`/`PATCH`/`DELETE`) request under
`/api/` whose `Origin` header is not exactly `PUBLIC_ORIGIN` gets `403`.
`Access-Control-Allow-Origin: *` is removed. `helmet` is added.

`attachSession` replaces `attachUser` and sets `req.user` to the session user or
`null`. **The demo fallback is removed** — that is what makes an expired session
distinguishable from an anonymous visitor.

| Route | Access | Change |
|---|---|---|
| `/api/auth/*` | Better Auth | new — sign-up, sign-in, sign-out, get-session |
| `GET /api/me` | public | now also returns the owner's pending-approval count |
| `GET /api/jobs` | session → own rows; anon → fixture | scoping source changes |
| `GET /api/history` | session → own rows; anon → fixture | scoping source changes |
| `GET /api/scrape-info` | session → own rows; anon → fixture | scoping source changes |
| `POST /api/jobs` | `requireUser`, scoped to `req.user.id` | **was `requireOwner`** |
| `PATCH /api/jobs/bulk-move` | `requireUser`, scoped to self | **was `requireOwner`** |
| `PATCH /api/jobs/:id` | `requireUser`, scoped to self | **was `requireOwner`** |
| `DELETE /api/jobs/status/:status` | `requireUser`, scoped to self | **was `requireOwner`** |
| `POST /api/trigger-scrape` | `requireUser`, own scrape | **was `requireOwner`** |
| `POST /api/generate-cover-letter` | `requireOwner` | unchanged, deliberately |
| `GET /api/admin/users` | `requireOwner` | new |
| `POST /api/admin/users/:id/approve` | `requireOwner` | new |
| `POST /api/admin/users/:id/reject` | `requireOwner` | new |
| `POST /api/receive-jobs` | webhook secret + `runId` | contract changes, §7 |

`requireUser` (401 when there is no session) is new; nothing equivalent exists today.

Rejecting an account deletes its rows from `session`, so a rejected user's live
session dies immediately rather than lasting until its token expires. The owner
cannot be approved or rejected — attempting it returns `409`.

## 7. n8n Delivery Contract

Today `POST /api/trigger-scrape` issues a bare `GET` with no payload, and
`receive-jobs` writes everything to `getOwnerUser(db)`. Per-user scrapes require the
app — not n8n — to decide whose board a batch belongs to.

**Trigger.** `POST /api/trigger-scrape` inserts a `scrape_runs` row and `POST`s
`{ runId, queries }` to `N8N_SCRAPE_URL`.

**Delivery.** n8n echoes `runId` back with the batch. `receive-jobs` resolves it,
rejects it if unknown, already consumed, or past `RUN_EXPIRY_MINUTES` (§4.3), writes the
jobs under that run's `user_id`, and marks it consumed. Replay is impossible by
construction, and the run history is a side benefit the UI can surface as
"last run: N new jobs, 2h ago".

A stateful run row is preferred over a signed delivery token: it is revocable and
auditable, and re-introducing HMAC immediately after deleting it would be a poor
look — though the distinction is real, since a session must be revocable and a
short-lived single-purpose delivery token need not be.

**The scheduled workflow is unchanged.** When `receive-jobs` receives no `runId`, it
falls back to the owner exactly as today. The weekly schedule trigger has no user
context and should not grow one.

**Caps.** Separate per-user scrapes multiply Apify cost linearly: the weekly run
costs roughly $0.20 against a ~$5/month credit, so a handful of members on daily
scrapes would exhaust it. Keep the existing per-user 1/day limit and add a global
`SCRAPE_DAILY_LIMIT` counted from `scrape_runs`, with the UI reporting honestly when
it is spent. A visible cap is better than a surprise empty balance.

## 8. Frontend

Anonymous visitors read from `server/fixture.ts`, which loads `public-sample.json`
once at boot. No demo user row, no database read, and the `role === 'demo'`
rejection on the login path disappears with it.

The existing client-side sandbox stays: mutations update local state and skip the
network call, so a visitor's edits reset on refresh and can never persist. Its gate
flips from `isOwner` to `isAuthenticated`.

Auth calls move to `better-auth/client` with `usernameClient()` — the vanilla
client, not CloudSound's `better-auth/react`, since this frontend is plain
TypeScript. CloudSound's `authErrorMessage` map ports almost verbatim;
`ACCOUNT_PENDING` and `ACCOUNT_REJECTED` are the messages that matter.

New UI, all in the existing neo-brutalist style:

- a sign-up tab alongside sign-in in the existing modal,
- a "waiting for approval" state after sign-up,
- an owner-only admin panel listing pending accounts with approve/reject, and a
  pending-count badge in the header.

This is roughly half the total work and is the half most easily under-planned. It is
new components, not wiring.

## 9. Configuration & Environment

`server/config.ts` adopts CloudSound's zod-validated environment. The app validates
nothing today, which is why `SESSION_SECRET` being unset in production went
unnoticed and silently fell back to a generated file.

| Var | Status | Notes |
|---|---|---|
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | **removed** | replaced by `OWNER_*` |
| `BASE_PATH` | **removed** | app serves at `/` |
| `PUBLIC_ORIGIN` | new, required | `https://jobs.philippeho.dev`, no path |
| `OWNER_USERNAME` | new | default `owner` |
| `OWNER_EMAIL` | new, required | collected, never verified |
| `OWNER_PASSWORD` | new, required | min 12; used once, on first boot |
| `SESSION_SECRET` | now **required** | min 32; boot fails without it |
| `SCRAPE_DAILY_LIMIT` | new | global cap, §7 |
| `RUN_EXPIRY_MINUTES` | new | delivery window, default 30 (§4.3) |
| `WEBHOOK_SECRET` | kept | already 64 chars in production |
| `N8N_SCRAPE_URL`, `N8N_COVER_LETTER_URL` | kept | values rotated, §12 |
| `DATA_DIR`, `PORT`, `NODE_ENV` | kept | |

## 10. Deployment

Data is a bind mount: `/home/phil/projects/job-viewer-runtime` → `/app/data`. It is
persistent and survives redeploys.

> **The database has an uncheckpointed WAL** — 40KB of `.db` against 585KB of
> `-wal` at the time of writing. Copying `jobviewer.db` alone would silently lose
> weeks of writes. Back up with `sqlite3 … ".backup"`, or copy all three files.

Ordered cutover:

1. `sqlite3 /home/phil/projects/job-viewer-runtime/jobviewer.db ".backup /tmp/pre-auth.db"`.
2. Set the new environment in Coolify; deploy.
3. Confirm from the logs that migrations 1–3 applied, `ensureOwner` seeded the owner,
   and the legacy backfill moved the owner's rows exactly once.
4. Sign in with the new owner credentials; confirm the board still holds real data.
5. Update n8n: the new `receive-jobs` URL (`/api/receive-jobs` — the `/job-viewer`
   prefix is gone), the rotated webhook paths, and Header Auth on both webhook nodes.
6. Delete `.github/workflows/deploy.yml` and fix the stale local git remote.

Removing the base path also touches Vite's `base`, `API_BASE` in `src/ts/api.ts`,
and the static-serving block in `server/app.ts`. It additionally fixes
`https://jobs.philippeho.dev/` currently returning 404.

The runtime directory stays at `~/projects/job-viewer-runtime` rather than moving to
`~/app-data/jobviewer` alongside the newer apps. Moving a bind mount during a data
migration is risk without benefit; it is a separate job if wanted.

## 11. Testing

The existing harness survives: `createApp(db)` over a `:memory:` database,
`app.listen(0)`, global `fetch`, `node:test` run through `tsx`. Parity with
CloudSound's vitest is not worth a runner migration.

New coverage, written test-first, in this order:

- **Member isolation, first.** Member A cannot read, patch, bulk-move or delete
  member B's jobs, history or scrape info. This is where a multi-user bug actually
  costs something, so it is written before the code that satisfies it.
- The approval gate: pending sign-in yields no session, rejected yields no session
  *and* deletes existing ones, approved yields a session.
- `ensureOwner`: creates once, no-ops on a second boot, drains the holding tables
  exactly once.
- Migrations: version 1 is idempotent against a database that already has the
  tables, version 2 carries `account.issuer`, version 3 parks and drops correctly.
- `receive-jobs`: valid, already-consumed, expired and unknown `runId`, plus the
  no-`runId` owner fallback.
- Anonymous reads serve the fixture and never touch the database.
- Unsafe methods are rejected on a foreign `Origin` before any session lookup.
- Owner-versus-member on every `/api/admin/*` route, and the `409` when the owner is
  the target.

## 12. Urgent, and Not Solved Here

These were found during this review. They are live now and should be fixed before
this work lands, not as part of it.

1. **The seeded owner password reached production and grants owner access today.**
   Verified 2026-09-03. Rotate it in Coolify. Because `seedUsers` only writes a hash
   when none exists, the stored hash must also be cleared for a new value to take.
2. **Both production n8n webhook paths are published in this public repository's
   `.env.example`**, as real values rather than placeholders. Both are live and
   registered. n8n webhooks are unauthenticated by default, so anyone reading the
   repo can trigger the Apify scrape — bypassing the app's daily limit, which is
   enforced in Express and not in n8n — and the cover-letter LLM call. Rotate both
   paths, add Header Auth on the webhook nodes, and replace the values in
   `.env.example` with placeholders.
3. **`src/assets/identity.json` remains in this public repository's git history**,
   containing a real name, email address, phone number and city. It was untracked in
   `2683215` but never purged. The 2026-06-18 spec deferred this and it was never
   done.

## 13. Out of Scope (YAGNI)

- **Porting to Fastify + `node:sqlite`** to match CloudSound's stack exactly. The
  auth layer converges; the framework does not. Recorded here as a known, deliberate
  divergence so it does not become invisible.
- **Shared/deduplicated ingestion.** Separate boards and separate scrapes are the
  chosen model. `scrape_runs` must not preclude a later dedup layer, but no dedup is
  built now.
- **Per-user identity for AI cover letters.** Owner-only this pass.
- Password reset, email verification, OAuth providers, 2FA.
- Persisting the anonymous visitor's sandbox edits.
- Pagination, `ORDER BY` on `getJobs`, Express 5, and the other findings from the
  2026-09-03 review that are unrelated to auth.
