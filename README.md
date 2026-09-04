# Job Viewer

A job board fed by an n8n + Apify scraper, with an AI cover-letter generator. Neo-brutalist
UI, Express + SQLite backend, deployed on Coolify.

## Architecture

- Vanilla TypeScript frontend built with Vite.
- Express 4 + TypeScript API on Node 24.
- `better-sqlite3` in WAL mode on a persistent volume.
- Better Auth 1.7.1 owns identity entirely; there is no second auth path.
- Jobs are delivered by an n8n workflow over a shared-secret webhook.

## Accounts

The board is public to look at and needs an account to use.

- The **owner** account is created on the first boot that finds no owner row, from
  `OWNER_USERNAME` (default `owner`), `OWNER_EMAIL` and `OWNER_PASSWORD`. Those variables
  are ignored on every boot afterwards — changing `OWNER_PASSWORD` later does **not** reset
  anything, by design. Recovery means editing the SQLite file directly.
- Anyone else signs up with a username, email and password. **Sign-up issues no session**:
  the account sits pending until the owner approves it, and signing in before then is
  refused with a clear message rather than a fake wrong-password error.
- Email addresses are collected but never verified — the owner's approval is the human
  check, so there is no mail provider anywhere in this app.
- Approved members get their own independent board: their own jobs, statuses, notes and
  scrape budget. Nobody can read or write anyone else's rows.
- **AI cover letters are owner-only**, because they read the owner's `identity.json`.
  Members get the three static templates.
- Logged-out visitors see a frozen sample board from `public-sample.json`. It is a
  fixture, not an account — it never touches the database, and edits reset on refresh.

## Scrape budget

Each user may trigger one scrape per day, and `SCRAPE_DAILY_LIMIT` caps the total across
all users, because separate per-user scrapes multiply Apify cost linearly.

`POST /api/trigger-scrape` records a `scrape_runs` row and sends its `runId` to n8n, which
echoes it back with the batch. `POST /api/receive-jobs` resolves the run, rejects it if
unknown, already consumed or expired, and writes to that run's user. **The app decides
whose board a batch lands on, never n8n.** A bare array with no `runId` still delivers to
the owner, so the weekly scheduled workflow is unchanged.

## Local development

Requires Node 24.

```bash
npm install
cp .env.example .env   # fill in SESSION_SECRET, OWNER_EMAIL, OWNER_PASSWORD, WEBHOOK_SECRET
npm run dev
```

Verification:

```bash
npm test
npm run build
```

## Deployment

Coolify **service** (not an application) at UUID `l4eas83izr96sj3q9hmdgln9`.

- Domain: `https://jobs.philippeho.dev`
- Container port: `3004`
- Persistent bind mount: `/home/phil/projects/job-viewer-runtime` → `/app/data`
- Release policy: manual; no deployment webhook.
- Exactly one replica — SQLite is single-instance.

Environment variables are listed in `.env.example`. All of `PUBLIC_ORIGIN`,
`SESSION_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD` and `WEBHOOK_SECRET` are required; the
app refuses to start without them, by design.

### Backing up before a migration

> The database runs in WAL mode and the WAL is not always checkpointed. Copying
> `jobviewer.db` alone can silently lose recent writes. Use `VACUUM INTO`, which
> checkpoints as it copies:

```bash
docker exec <container> node -e "new (require('better-sqlite3'))('/app/data/jobviewer.db').exec(\"VACUUM INTO '/app/data/backup.db'\")"
```

## Security notes

- No hand-rolled crypto. Better Auth owns password hashing and sessions.
- Sessions are server-side rows, so rejecting an account kills its live session
  immediately rather than waiting for a token to expire.
- `role` and `approvalStatus` are `input: false`, so a sign-up body carrying
  `"role":"owner"` cannot escalate — privilege escalation is closed by construction.
- The approval gate lives at session creation, so the existence of a session proves the
  account is approved and no downstream route re-checks it.
- Session cookie is `__Host-` prefixed in production, `HttpOnly`, `SameSite=Strict`.
- Unsafe API requests require an exact `Origin` match; there is no wildcard CORS.
- Sign-in is limited to 5 attempts per 15 minutes and sign-up to 3 per hour, counted in
  the database so the limits survive a restart.
