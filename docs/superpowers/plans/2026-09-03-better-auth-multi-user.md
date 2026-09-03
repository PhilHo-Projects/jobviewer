# Better Auth Migration + Multi-User Accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace job-viewer's hand-rolled scrypt/HMAC owner-demo auth with Better Auth 1.7.1, and add approval-gated member accounts where each member owns an independent job board.

**Architecture:** Better Auth's `"user"` table becomes the only identity store; the hand-rolled `users` table is dropped and `jobs`/`history`/`scrape_info` are rebuilt onto `TEXT` user ids. A versioned migration runner handles the cutover, and an idempotent boot step (`ensureOwner`) creates the owner and drains the carried-over rows, because the owner's id does not exist until after migrations run. Anonymous visitors read a static fixture instead of a database-backed demo account.

**Tech Stack:** Node 24, Express 4, better-sqlite3, Better Auth 1.7.1, zod 4, helmet, TypeScript, Vite, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-03-better-auth-multi-user-design.md`

## Global Constraints

- **`better-auth` pinned to exactly `1.7.1`** — not `^1.7.1`. The migration SQL in Task 4 is that version's schema output, and it is what CloudSound resolves to.
- **Never regenerate the Better Auth schema with `@better-auth/cli`.** It is deprecated, pinned at 1.4.21, and omits `account.issuer`, which makes sign-up fail at runtime with *"table account has no column named issuer."*
- **Express 4 wildcard syntax:** `app.all('/api/auth/*', ...)`. Express 5's `*splat` form is wrong here; Express 5 is out of scope.
- **`toNodeHandler` must be registered before `express.json()`.** Better Auth reads the raw request body; a body parser ahead of it consumes the stream.
- Minimum password length **12**; minimum username length **3**, maximum **30**.
- Session lifetime **30 days**.
- Full test suite: `npm test` (`node --import tsx --test "server/**/*.test.ts"`).
- Single test file: `node --import tsx --test server/<file>.test.ts`.
- Single test by name: `node --import tsx --test --test-name-pattern "<name>" server/<file>.test.ts`.
- **Every task ends with `npm test` green and `npm run build` clean.** Task 7 is the one atomic cutover; it is large by necessity and must not be split.
- Commit after every task. Branch is `auth/better-auth-multi-user`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/config.ts` | NEW — zod-validated environment, the single source of runtime config |
| `server/migrations.ts` | NEW — versioned migration runner and the ordered migration list |
| `server/auth.ts` | REPLACED — `buildAuth()` returning the Better Auth instance; keeps `requireWebhookSecret` |
| `server/owner.ts` | NEW — `ensureOwner()`: first-boot owner creation plus the legacy-row backfill |
| `server/admin.ts` | NEW — owner-only approve/reject/list routes |
| `server/fixture.ts` | NEW — the anonymous demo dataset, read once at boot |
| `server/scrape.ts` | NEW — `scrape_runs` lifecycle and the daily caps |
| `server/guards.ts` | NEW — `AuthedRequest`, `requireUser`, `requireOwner`. Separate from `app.ts` so `admin.ts` can import the guards without a cycle |
| `server/app.ts` | CHANGED — middleware chain, route map, per-user scoping |
| `server/repo.ts` | CHANGED — `userId: number` becomes `userId: string` throughout |
| `server/db.ts` | CHANGED — `openDb()` delegates all schema work to `migrations.ts` |
| `server/testing.ts` | NEW — shared test harness (free port, config, sign-up/sign-in helpers) |
| `src/ts/auth.ts` | NEW — Better Auth vanilla client and the error-code message map |
| `src/ts/components/authModal.ts` | NEW — sign-in/sign-up modal and the pending state |
| `src/ts/components/admin.ts` | NEW — owner-only pending-accounts panel |

---

## Task 1: Move the app off `/job-viewer` to `/`

The `__Host-` cookie prefix requires `Path=/`, and mounting Better Auth under a prefix would mean carrying a `basePath` through every later task. Doing this first removes that from every subsequent task. It also fixes `https://jobs.philippeho.dev/` currently returning 404.

**Files:**
- Modify: `server/app.ts:24` (the `BASE_PATH` constant and every template literal using it)
- Modify: `vite.config.js:5-13`
- Modify: `src/ts/api.ts:7`
- Modify: `Dockerfile` (drop the `BASE_PATH` env)
- Test: `server/app.test.ts` (harness base URL)

**Interfaces:**
- Consumes: nothing.
- Produces: every API route is served at `/api/*`; static assets at `/`.

- [ ] **Step 1: Update the test harness to the new base**

In `server/app.test.ts`, change the harness base URL:

```ts
const base = `http://127.0.0.1:${port}/api`;
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm test`
Expected: FAIL — many 404s, because routes are still mounted under `/job-viewer`.

- [ ] **Step 3: Remove the base path from the server**

In `server/app.ts`, delete the `BASE_PATH` constant and rewrite every route to a plain literal. The static block becomes:

```ts
const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
    });
}
```

Every `${BASE_PATH}/api/...` becomes `/api/...`. The cookie helpers' `basePath` argument becomes `'/'`.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm test`
Expected: PASS — all existing tests green.

- [ ] **Step 5: Update the client and build config**

`src/ts/api.ts`:

```ts
const API_BASE = '/api';
```

`vite.config.js`:

```js
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/',
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3004',
                changeOrigin: true,
            },
        },
    },
});
```

In `Dockerfile`, delete the `BASE_PATH=/job-viewer` line from the `ENV` block.

- [ ] **Step 6: Verify the build is clean**

Run: `npm run build`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add server/app.ts server/app.test.ts src/ts/api.ts vite.config.js Dockerfile
git commit -m "refactor: serve the app at / instead of /job-viewer"
```

---

## Task 2: Dependencies, module resolution, and zod-validated config

`tsconfig.server.json` currently sets `moduleResolution: "node"`, which predates package `exports` maps. Better Auth's subpath imports (`better-auth/node`, `better-auth/plugins`) will not resolve under it — TypeScript reports *"Cannot find module 'better-auth/node'"*. This must be fixed before any Better Auth import exists.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.server.json`
- Create: `server/config.ts`
- Test: `server/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(env: NodeJS.ProcessEnv): AppConfig`, where

```ts
export interface AppConfig {
    environment: 'development' | 'test' | 'production';
    publicOrigin: string;
    sessionSecret: string;
    sessionMaxAgeSeconds: number;
    ownerUsername: string;
    ownerEmail: string;
    ownerPassword: string;
    dataDir: string;
    port: number;
    webhookSecret: string;
    n8nScrapeUrl: string | undefined;
    n8nCoverLetterUrl: string | undefined;
    scrapeDailyLimit: number;
    runExpiryMinutes: number;
}
```

- [ ] **Step 1: Install dependencies**

```bash
npm install better-auth@1.7.1 zod@^4.4.3 helmet@^8.3.0
```

Verify the pin is exact, not a range:

```bash
node -e "console.log(require('./package.json').dependencies['better-auth'])"
```
Expected: `1.7.1`

- [ ] **Step 2: Fix module resolution**

In `tsconfig.server.json`, change `"moduleResolution": "node"` to:

```json
"moduleResolution": "bundler",
```

- [ ] **Step 3: Write the failing test**

Create `server/config.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const valid = {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://jobs.example.test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: 'owner-correct-horse',
    WEBHOOK_SECRET: 'wh-secret',
};

test('loadConfig accepts a valid environment', () => {
    const config = loadConfig(valid);
    assert.equal(config.publicOrigin, 'https://jobs.example.test');
    assert.equal(config.ownerUsername, 'owner');
    assert.equal(config.sessionMaxAgeSeconds, 30 * 24 * 60 * 60);
    assert.equal(config.scrapeDailyLimit, 5);
    assert.equal(config.runExpiryMinutes, 30);
});

test('loadConfig rejects a short session secret', () => {
    assert.throws(() => loadConfig({ ...valid, SESSION_SECRET: 'too-short' }));
});

test('loadConfig rejects an owner password under 12 characters', () => {
    assert.throws(() => loadConfig({ ...valid, OWNER_PASSWORD: 'short' }));
});

test('loadConfig rejects a PUBLIC_ORIGIN carrying a path', () => {
    assert.throws(() => loadConfig({ ...valid, PUBLIC_ORIGIN: 'https://jobs.example.test/app' }));
});

test('loadConfig rejects a missing session secret', () => {
    const { SESSION_SECRET: _drop, ...withoutSecret } = valid;
    assert.throws(() => loadConfig(withoutSecret));
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --import tsx --test server/config.test.ts`
Expected: FAIL — `Cannot find module './config.js'`.

- [ ] **Step 5: Write the implementation**

Create `server/config.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PUBLIC_ORIGIN: z.url().refine((value) => new URL(value).pathname === '/', {
        message: 'PUBLIC_ORIGIN must not contain a path',
    }),
    SESSION_SECRET: z.string().min(32),
    OWNER_USERNAME: z.string().min(3).max(30).default('owner'),
    OWNER_EMAIL: z.email(),
    /**
     * Bootstrap only: used once, on the first boot that finds no owner row, and
     * ignored for ever after. The 12-character floor matches the sign-up minimum —
     * the owner must not be the weakest account on the site.
     */
    OWNER_PASSWORD: z.string().min(12),
    DATA_DIR: z.string().min(1).default('./data'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_004),
    WEBHOOK_SECRET: z.string().min(1),
    N8N_SCRAPE_URL: z.string().url().optional(),
    N8N_COVER_LETTER_URL: z.string().url().optional(),
    /** Global ceiling on Apify-backed scrapes per calendar day, across all users. */
    SCRAPE_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
    /** How long a pending scrape run stays eligible for delivery. */
    RUN_EXPIRY_MINUTES: z.coerce.number().int().positive().default(30),
});

export interface AppConfig {
    environment: 'development' | 'test' | 'production';
    publicOrigin: string;
    sessionSecret: string;
    sessionMaxAgeSeconds: number;
    ownerUsername: string;
    ownerEmail: string;
    ownerPassword: string;
    dataDir: string;
    port: number;
    webhookSecret: string;
    n8nScrapeUrl: string | undefined;
    n8nCoverLetterUrl: string | undefined;
    scrapeDailyLimit: number;
    runExpiryMinutes: number;
}

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
    const parsed = schema.parse(environment);
    return {
        environment: parsed.NODE_ENV,
        publicOrigin: parsed.PUBLIC_ORIGIN.replace(/\/$/, ''),
        sessionSecret: parsed.SESSION_SECRET,
        sessionMaxAgeSeconds: 30 * 24 * 60 * 60,
        ownerUsername: parsed.OWNER_USERNAME,
        ownerEmail: parsed.OWNER_EMAIL,
        ownerPassword: parsed.OWNER_PASSWORD,
        dataDir: parsed.DATA_DIR.replace(/[\\/]$/, ''),
        port: parsed.PORT,
        webhookSecret: parsed.WEBHOOK_SECRET,
        n8nScrapeUrl: parsed.N8N_SCRAPE_URL,
        n8nCoverLetterUrl: parsed.N8N_COVER_LETTER_URL,
        scrapeDailyLimit: parsed.SCRAPE_DAILY_LIMIT,
        runExpiryMinutes: parsed.RUN_EXPIRY_MINUTES,
    };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --import tsx --test server/config.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Verify the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.server.json server/config.ts server/config.test.ts
git commit -m "feat: zod-validated config; pin better-auth 1.7.1; fix module resolution"
```

---

## Task 3: Migration runner and migration 1

**Files:**
- Create: `server/migrations.ts`
- Modify: `server/db.ts` (`openDb` delegates to the runner; `initSchema` is removed)
- Test: `server/migrations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface Migration { version: number; sql: string }`
  - `export const MIGRATIONS: Migration[]`
  - `export function migrate(db: Db): void` — applies every unapplied migration, each in its own transaction that also records its version.
  - `export function appliedVersions(db: Db): number[]`

- [ ] **Step 1: Write the failing test**

Create `server/migrations.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate, appliedVersions } from './migrations.js';

function tableNames(db: Database.Database): string[] {
    return db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all()
        .map((r: any) => r.name);
}

test('migrate creates the version 1 schema on a fresh database', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = tableNames(db);
    assert.ok(names.includes('users'));
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('history'));
    assert.ok(names.includes('scrape_info'));
    assert.ok(appliedVersions(db).includes(1));
    db.close();
});

test('migrate is idempotent across repeated runs', () => {
    const db = new Database(':memory:');
    migrate(db);
    const first = appliedVersions(db);
    migrate(db);
    assert.deepEqual(appliedVersions(db), first);
    db.close();
});

test('migrate records version 1 against a database that already has the tables', () => {
    // Production's exact situation: the tables exist, schema_migrations does not.
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL CHECK(role IN ('owner','demo')),
            created_at TEXT NOT NULL
        );
    `);
    migrate(db);
    assert.ok(appliedVersions(db).includes(1));
    db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test server/migrations.test.ts`
Expected: FAIL — `Cannot find module './migrations.js'`.

- [ ] **Step 3: Write the runner and migration 1**

Create `server/migrations.ts`:

```ts
import type Database from 'better-sqlite3';

type Db = Database.Database;

export interface Migration {
    version: number;
    sql: string;
}

export const MIGRATIONS: Migration[] = [
    // Version 1 shipped before this runner existed, so production databases already
    // carry these tables with no schema_migrations row. IF NOT EXISTS is what lets
    // the runner adopt them instead of failing on the first boot after deploy.
    {
        version: 1,
        sql: `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT NOT NULL CHECK(role IN ('owner','demo')),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                user_id INTEGER NOT NULL,
                id TEXT NOT NULL,
                title TEXT, company TEXT, location TEXT, url TEXT,
                status TEXT, statusSummary TEXT, statusSummaryUpdatedAt TEXT,
                appliedDate TEXT, scrapedDate TEXT, notes TEXT, summary TEXT, posted TEXT,
                PRIMARY KEY (user_id, id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS history (
                user_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                wins TEXT, basePoints INTEGER, scoreMultiplier REAL, totalPoints INTEGER,
                PRIMARY KEY (user_id, date),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS scrape_info (
                user_id INTEGER PRIMARY KEY,
                lastTriggerDate TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `,
    },
];

export function appliedVersions(db: Db): number[] {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    return db
        .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
        .all()
        .map((r: any) => r.version as number);
}

/**
 * Apply every migration this database has not recorded yet. Each step runs in its own
 * transaction and records its version in that same transaction, so a crash mid-upgrade
 * leaves the database at the last fully applied version rather than half-migrated.
 */
export function migrate(db: Db): void {
    const done = new Set(appliedVersions(db));
    for (const migration of MIGRATIONS) {
        if (done.has(migration.version)) continue;
        const apply = db.transaction(() => {
            db.exec(migration.sql);
            db.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`)
                .run(migration.version, new Date().toISOString());
        });
        apply();
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test server/migrations.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Point `openDb` at the runner**

In `server/db.ts`, delete `initSchema` entirely and replace its call:

```ts
import { migrate } from './migrations.js';

export function openDb(dbPath: string): Db {
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
}
```

- [ ] **Step 6: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0. `repo.test.ts`'s "openDb creates the expected tables" still passes, because migration 1 creates the same tables.

- [ ] **Step 7: Commit**

```bash
git add server/migrations.ts server/migrations.test.ts server/db.ts
git commit -m "feat: versioned migration runner, adopting the existing schema as v1"
```

---

## Task 4: Migration 2 — the Better Auth schema

**Files:**
- Modify: `server/migrations.ts` (append version 2)
- Test: `server/migrations.test.ts` (append)

**Interfaces:**
- Consumes: `MIGRATIONS`, `migrate`, `appliedVersions` from Task 3.
- Produces: tables `"user"`, `"session"`, `"account"`, `"verification"`, `"rateLimit"`. `"user"` carries `role`, `approvalStatus`, `approvedAt`, `approvedBy`.

- [ ] **Step 1: Write the failing test**

Append to `server/migrations.test.ts`:

```ts
function columnNames(db: Database.Database, table: string): string[] {
    return db.prepare(`PRAGMA table_info("${table}")`).all().map((r: any) => r.name);
}

test('migration 2 creates the Better Auth tables', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = tableNames(db);
    for (const t of ['user', 'session', 'account', 'verification', 'rateLimit']) {
        assert.ok(names.includes(t), `missing table ${t}`);
    }
    assert.ok(appliedVersions(db).includes(2));
    db.close();
});

test('the account table has an issuer column', () => {
    // The deprecated @better-auth/cli omits this column, and without it sign-up fails
    // at runtime under better-auth 1.7.1 with "table account has no column named
    // issuer". Pinned so a future regeneration cannot quietly drop it.
    const db = new Database(':memory:');
    migrate(db);
    assert.ok(columnNames(db, 'account').includes('issuer'));
    db.close();
});

test('the user table carries the server-owned approval fields', () => {
    const db = new Database(':memory:');
    migrate(db);
    const cols = columnNames(db, 'user');
    for (const c of ['role', 'approvalStatus', 'approvedAt', 'approvedBy']) {
        assert.ok(cols.includes(c), `missing user column ${c}`);
    }
    db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test server/migrations.test.ts`
Expected: FAIL — `missing table user`.

- [ ] **Step 3: Append migration 2**

Add to the `MIGRATIONS` array in `server/migrations.ts`, after version 1:

```ts
    // Better Auth 1.7.1's own schema, taken verbatim from its `getMigrations()` output.
    //
    // Do NOT regenerate this with `@better-auth/cli`: that package is deprecated and
    // pinned at 1.4.21, and the schema it emits has no `account.issuer` column, which
    // makes sign-up fail at runtime with "table account has no column named issuer".
    //
    // Its identifiers are camelCase and double-quoted while ours are snake_case. Both
    // are correct — `user` is also a SQL reserved word, so it must stay quoted.
    {
        version: 2,
        sql: `
            CREATE TABLE "user" (
                "id" text NOT NULL PRIMARY KEY,
                "name" text NOT NULL,
                "email" text NOT NULL UNIQUE,
                "emailVerified" integer NOT NULL,
                "image" text,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL,
                "username" text UNIQUE,
                "displayUsername" text,
                "role" text NOT NULL,
                "approvalStatus" text NOT NULL,
                "approvedAt" text,
                "approvedBy" text
            );

            CREATE TABLE "session" (
                "id" text NOT NULL PRIMARY KEY,
                "expiresAt" date NOT NULL,
                "token" text NOT NULL UNIQUE,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL,
                "ipAddress" text,
                "userAgent" text,
                "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
            );

            CREATE TABLE "account" (
                "id" text NOT NULL PRIMARY KEY,
                "issuer" text NOT NULL,
                "accountId" text NOT NULL,
                "providerId" text NOT NULL,
                "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
                "accessToken" text,
                "refreshToken" text,
                "idToken" text,
                "accessTokenExpiresAt" date,
                "refreshTokenExpiresAt" date,
                "scope" text,
                "password" text,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL
            );

            CREATE TABLE "verification" (
                "id" text NOT NULL PRIMARY KEY,
                "identifier" text NOT NULL,
                "value" text NOT NULL,
                "expiresAt" date NOT NULL,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL
            );

            CREATE TABLE "rateLimit" (
                "id" text NOT NULL PRIMARY KEY,
                "key" text NOT NULL UNIQUE,
                "count" integer NOT NULL,
                "lastRequest" bigint NOT NULL
            );

            CREATE INDEX "session_userId_idx" ON "session" ("userId");
            CREATE INDEX "account_userId_idx" ON "account" ("userId");
            CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
            CREATE UNIQUE INDEX "account_issuer_accountId_uidx"
                ON "account" ("issuer", "accountId");
        `,
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test server/migrations.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/migrations.ts server/migrations.test.ts
git commit -m "feat: better-auth 1.7.1 schema as migration 2"
```

---

## Task 5: `buildAuth` and the approval gate

The gate is tested through `auth.api.*` directly, with no Express involved. That isolation is deliberate: it proves the gate holds at session creation, independent of any route.

**Files:**
- Modify: `server/auth.ts` (add `buildAuth`; leave the existing exports in place for now — Task 7 deletes them)
- Test: `server/auth.test.ts` (append; existing tests stay green)

**Interfaces:**
- Consumes: `AppConfig` (Task 2), migrations 1–2 (Tasks 3–4).
- Produces:
  - `export function buildAuth(opts: { db: Db; config: AppConfig }): AppAuth`
  - `export type AppAuth = ReturnType<typeof buildAuth>`
  - `export type UserRole = 'member' | 'owner'`
  - `export type ApprovalStatus = 'pending' | 'approved' | 'rejected'`
  - `export interface SessionUser { id: string; username: string; displayUsername: string | null; email: string; role: UserRole; approvalStatus: ApprovalStatus }`

- [ ] **Step 1: Write the failing test**

Append to `server/auth.test.ts`:

```ts
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';
import { buildAuth } from './auth.js';
import { loadConfig } from './config.js';

const TEST_ENV = {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://jobs.example.test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: 'owner-correct-horse',
    WEBHOOK_SECRET: 'wh-secret',
};

function authFixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    const config = loadConfig(TEST_ENV);
    return { db, config, auth: buildAuth({ db, config }) };
}

async function signUp(auth: ReturnType<typeof buildAuth>, username: string) {
    await auth.api.signUpEmail({
        body: {
            email: `${username}@example.test`,
            name: username,
            password: 'correct-horse-battery',
            username,
        },
    });
}

test('sign-up creates a pending member and issues no session', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        const row = db.prepare('SELECT "role","approvalStatus" FROM "user" WHERE "username"=?')
            .get('alice') as { role: string; approvalStatus: string };
        assert.equal(row.role, 'member');
        assert.equal(row.approvalStatus, 'pending');
        assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "session"').get() as { n: number }).n, 0);
    } finally { db.close(); }
});

test('a pending account cannot sign in', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        await assert.rejects(
            auth.api.signInEmail({
                body: { email: 'alice@example.test', password: 'correct-horse-battery' },
            }),
        );
    } finally { db.close(); }
});

test('an approved account can sign in', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        db.prepare(`UPDATE "user" SET "approvalStatus"='approved' WHERE "username"=?`).run('alice');
        const result = await auth.api.signInEmail({
            body: { email: 'alice@example.test', password: 'correct-horse-battery' },
        });
        assert.ok(result);
        assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "session"').get() as { n: number }).n, 1);
    } finally { db.close(); }
});

test('a rejected account cannot sign in', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        db.prepare(`UPDATE "user" SET "approvalStatus"='rejected' WHERE "username"=?`).run('alice');
        await assert.rejects(
            auth.api.signInEmail({
                body: { email: 'alice@example.test', password: 'correct-horse-battery' },
            }),
        );
    } finally { db.close(); }
});

test('a sign-up body cannot set its own role', async () => {
    const { db, auth } = authFixture();
    try {
        await auth.api.signUpEmail({
            body: {
                email: 'mallory@example.test',
                name: 'mallory',
                password: 'correct-horse-battery',
                username: 'mallory',
                role: 'owner',
                approvalStatus: 'approved',
            } as any,
        });
        const row = db.prepare('SELECT "role","approvalStatus" FROM "user" WHERE "username"=?')
            .get('mallory') as { role: string; approvalStatus: string };
        assert.equal(row.role, 'member');
        assert.equal(row.approvalStatus, 'pending');
    } finally { db.close(); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test server/auth.test.ts`
Expected: FAIL — `buildAuth is not exported`.

- [ ] **Step 3: Add `buildAuth`**

Append to `server/auth.ts`:

```ts
import { APIError, betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import type { AppConfig } from './config.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type UserRole = 'member' | 'owner';

/** The shape `auth.api.getSession()` hands back, narrowed to what this app uses. */
export interface SessionUser {
    id: string;
    username: string;
    displayUsername: string | null;
    email: string;
    role: UserRole;
    approvalStatus: ApprovalStatus;
}

/**
 * Better Auth owns identity entirely; there is no second auth path.
 *
 * It is handed the app's own better-sqlite3 connection, so its tables live in the same
 * file as the job data. That is what lets `jobs.user_id` be a real foreign key, and it
 * means one backup covers both.
 */
export function buildAuth({ db, config }: { db: Db; config: AppConfig }) {
    const isProduction = config.environment === 'production';

    return betterAuth({
        database: db,
        secret: config.sessionSecret,
        baseURL: config.publicOrigin,
        trustedOrigins: [config.publicOrigin],

        emailAndPassword: {
            enabled: true,
            // Sign-up must never mint a session. Together with the gate below, this is
            // what guarantees a pending user never holds one at any point.
            autoSignIn: false,
            minPasswordLength: 12,
            // The address is collected but deliberately never verified — the owner's
            // approval is the human check, so there is no SMTP dependency in this app.
            requireEmailVerification: false,
        },

        session: { expiresIn: config.sessionMaxAgeSeconds },

        user: {
            additionalFields: {
                // `input: false` marks these server-owned: Better Auth strips them from
                // any request body, so a sign-up POST carrying `"role":"owner"` cannot
                // escalate. Closed by construction rather than by vigilance.
                role: { type: 'string', required: true, defaultValue: 'member', input: false },
                approvalStatus: {
                    type: 'string', required: true, defaultValue: 'pending', input: false,
                },
                approvedAt: { type: 'string', required: false, input: false },
                approvedBy: { type: 'string', required: false, input: false },
            },
        },

        databaseHooks: {
            session: {
                create: {
                    /**
                     * The approval gate, and the only one in the codebase.
                     *
                     * Because it sits at session creation, the existence of a session
                     * proves the user is approved — no downstream route re-checks, and
                     * there is no half-authenticated state for a bug to hide in.
                     */
                    before: async (session) => {
                        const row = db
                            .prepare('SELECT "approvalStatus" FROM "user" WHERE "id" = ?')
                            .get(session.userId) as { approvalStatus?: string } | undefined;

                        if (row?.approvalStatus === 'pending') {
                            throw new APIError('FORBIDDEN', {
                                code: 'ACCOUNT_PENDING',
                                message: 'This account is waiting to be approved.',
                            });
                        }
                        if (row?.approvalStatus !== 'approved') {
                            throw new APIError('FORBIDDEN', {
                                code: 'ACCOUNT_REJECTED',
                                message: 'This account cannot sign in.',
                            });
                        }
                        return { data: session };
                    },
                },
            },
        },

        rateLimit: {
            enabled: true,
            // Database storage, so counters survive a restart instead of resetting to
            // zero on every deploy the way an in-process limiter does.
            storage: 'database',
            window: 60,
            max: 100,
            customRules: {
                '/sign-in/username': { window: 15 * 60, max: 5 },
                '/sign-in/email': { window: 15 * 60, max: 5 },
                // Public sign-up is a spam vector the old single-password login never had.
                '/sign-up/email': { window: 60 * 60, max: 3 },
            },
        },

        advanced: {
            /**
             * Counterintuitive but deliberate: `useSecureCookies` controls only Better
             * Auth's automatic `__Secure-` name prefix, not the Secure attribute itself.
             * Leaving it false and setting `secure` explicitly below is the only way to
             * get a literal `__Host-` name — with it true the cookie is emitted as
             * `__Secure-__Host-jv_session`, which browsers read as a plain `__Secure-`
             * cookie, silently losing the subdomain-overwrite guarantee.
             */
            useSecureCookies: false,
            defaultCookieAttributes: {
                httpOnly: true,
                sameSite: 'strict',
                path: '/',
                secure: isProduction,
            },
            cookies: {
                // `__Host-` additionally requires Secure, Path=/ and no Domain — all
                // satisfied above. It is dropped outside production, where Secure is not set.
                session_token: { name: isProduction ? '__Host-jv_session' : 'jv_session' },
            },
        },

        plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30 })],
    });
}

export type AppAuth = ReturnType<typeof buildAuth>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test server/auth.test.ts`
Expected: PASS — the 5 new tests plus the existing hand-rolled-crypto tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/auth.ts server/auth.test.ts
git commit -m "feat: better-auth instance with the approval gate at session creation"
```

---

## Task 6: `ensureOwner` — first-boot owner creation

The legacy-row backfill is **not** in this task; it lands in Task 7 alongside the holding tables it drains. This task creates the owner and proves the bootstrap is one-shot.

**Files:**
- Create: `server/owner.ts`
- Test: `server/owner.test.ts`

**Interfaces:**
- Consumes: `buildAuth`, `AppAuth` (Task 5); `AppConfig` (Task 2).
- Produces: `export async function ensureOwner(opts: { auth: AppAuth; db: Db; config: AppConfig; log?: (m: string) => void }): Promise<string>` — returns the owner's user id.

- [ ] **Step 1: Write the failing test**

Create `server/owner.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';
import { buildAuth } from './auth.js';
import { loadConfig } from './config.js';
import { ensureOwner } from './owner.js';

const TEST_ENV = {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://jobs.example.test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    OWNER_USERNAME: 'phil',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: 'owner-correct-horse',
    WEBHOOK_SECRET: 'wh-secret',
};

function fixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    const config = loadConfig(TEST_ENV);
    return { db, config, auth: buildAuth({ db, config }) };
}

test('ensureOwner creates an approved owner on first boot', async () => {
    const { db, auth, config } = fixture();
    try {
        const id = await ensureOwner({ auth, db, config });
        const row = db.prepare('SELECT "username","role","approvalStatus" FROM "user" WHERE "id"=?')
            .get(id) as { username: string; role: string; approvalStatus: string };
        assert.equal(row.username, 'phil');
        assert.equal(row.role, 'owner');
        assert.equal(row.approvalStatus, 'approved');
    } finally { db.close(); }
});

test('ensureOwner is a no-op on a second boot', async () => {
    const { db, auth, config } = fixture();
    try {
        const first = await ensureOwner({ auth, db, config });
        const second = await ensureOwner({ auth, db, config });
        assert.equal(first, second);
        assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n, 1);
    } finally { db.close(); }
});

test('ensureOwner does not reset the password of an existing owner', async () => {
    const { db, auth, config } = fixture();
    try {
        await ensureOwner({ auth, db, config });
        const before = (db.prepare(`SELECT "password" FROM "account" LIMIT 1`).get() as { password: string }).password;
        await ensureOwner({ auth, db, config: { ...config, ownerPassword: 'a-different-password' } });
        const after = (db.prepare(`SELECT "password" FROM "account" LIMIT 1`).get() as { password: string }).password;
        assert.equal(before, after);
    } finally { db.close(); }
});

test('the seeded owner can sign in', async () => {
    const { db, auth, config } = fixture();
    try {
        await ensureOwner({ auth, db, config });
        const result = await auth.api.signInEmail({
            body: { email: 'owner@example.test', password: 'owner-correct-horse' },
        });
        assert.ok(result);
    } finally { db.close(); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test server/owner.test.ts`
Expected: FAIL — `Cannot find module './owner.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/owner.ts`:

```ts
import type Database from 'better-sqlite3';
import type { AppAuth } from './auth.js';
import type { AppConfig } from './config.js';

type Db = Database.Database;

interface EnsureOwnerOptions {
    auth: AppAuth;
    db: Db;
    config: AppConfig;
    log?: (message: string) => void;
}

/**
 * Create the owner account on first boot.
 *
 * The configured password is used exactly once. If an owner row already exists the
 * `OWNER_*` variables are ignored entirely — this is a bootstrap, never a standing back
 * door that silently resets the owner's password on every deploy. Recovery, if ever
 * needed, is a deliberate script run against the SQLite file over SSH.
 *
 * Returns the owner's user id.
 */
export async function ensureOwner({
    auth, db, config, log,
}: EnsureOwnerOptions): Promise<string> {
    const existing = db
        .prepare(`SELECT "id" FROM "user" WHERE "role" = 'owner' LIMIT 1`)
        .get() as { id?: string } | undefined;

    if (existing?.id) return existing.id;

    // Created through Better Auth's own sign-up API so the credential hash format is
    // identical to every other account's, rather than a second thing to keep in step.
    await auth.api.signUpEmail({
        body: {
            email: config.ownerEmail,
            name: config.ownerUsername,
            password: config.ownerPassword,
            username: config.ownerUsername,
        },
    });

    const created = db
        .prepare('SELECT "id" FROM "user" WHERE "username" = ?')
        .get(config.ownerUsername) as { id: string };

    // `role` and `approvalStatus` are `input: false`, so they cannot be set through the
    // sign-up body — deliberately, since that is what stops anyone else setting them.
    // The owner is promoted here instead.
    db.prepare(
        `UPDATE "user" SET "role" = 'owner', "approvalStatus" = 'approved', "approvedAt" = ?
         WHERE "id" = ?`,
    ).run(new Date().toISOString(), created.id);

    log?.(`seeded owner account "${config.ownerUsername}"`);
    return created.id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test server/owner.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/owner.ts server/owner.test.ts
git commit -m "feat: first-boot owner bootstrap via better-auth sign-up"
```

---

## Task 7: The identity cutover (atomic — do not split)

This is the one task that cannot be broken up. Migration 3 drops `users`, which `repo.ts`, `db.ts` and `app.ts` all depend on, so the schema change, the id-type change, the route rewiring and the test-harness rewrite land together or the tree does not compile.

**Files:**
- Modify: `server/migrations.ts` (append version 3)
- Modify: `server/owner.ts` (add the backfill)
- Modify: `server/repo.ts` (`userId: number` → `string`; delete the legacy user helpers)
- Modify: `server/db.ts` (delete `seedUsers`, `seedDemoJobs`, `migrateFromJson`)
- Modify: `server/app.ts` (mount Better Auth; `attachSession`; per-user scoping)
- Create: `server/guards.ts` (`AuthedRequest`, `requireUser`, `requireOwner`)
- Modify: `server/auth.ts` (delete the hand-rolled crypto and cookie helpers)
- Modify: `server.ts` (boot sequence)
- Create: `server/testing.ts`
- Rewrite: `server/app.test.ts`, `server/repo.test.ts`
- Modify: `server/auth.test.ts` (delete the hand-rolled-crypto tests)

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces:
  - `server/testing.ts`: `export async function startApp(): Promise<Harness>` where
    `Harness = { db: Db; auth: AppAuth; config: AppConfig; base: string; origin: string; ownerId: string; close(): void }`,
    plus `export async function signUpMember(h: Harness, username: string): Promise<string>`,
    `export function approve(h: Harness, userId: string): void`,
    `export async function signIn(h: Harness, username: string, password?: string): Promise<string>` (returns a Cookie header value).
  - `server/app.ts`: `createApp(db, { auth, config })`.
  - `server/guards.ts`: `AuthedRequest`, `requireUser`, `requireOwner` — imported by `app.ts` and `admin.ts` alike, which is what keeps those two from forming an import cycle.
  - `repo.ts`: every exported function takes `userId: string`.

- [ ] **Step 1: Write the failing isolation test**

This is the test that matters most, so it is written first. Create `server/isolation.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signUpMember, approve, signIn } from './testing.js';

test('a member cannot read another member\'s jobs', async () => {
    const h = await startApp();
    try {
        const aliceId = await signUpMember(h, 'alice');
        const bobId = await signUpMember(h, 'bob');
        approve(h, aliceId);
        approve(h, bobId);
        const alice = await signIn(h, 'alice');
        const bob = await signIn(h, 'bob');

        await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: h.origin },
            body: JSON.stringify({ title: 'Alice Only', company: 'ACME' }),
        });

        const seen = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: bob } })).json();
        assert.equal(seen.length, 0);
    } finally { h.close(); }
});

test('a member cannot patch another member\'s job', async () => {
    const h = await startApp();
    try {
        const aliceId = await signUpMember(h, 'alice');
        const bobId = await signUpMember(h, 'bob');
        approve(h, aliceId);
        approve(h, bobId);
        const alice = await signIn(h, 'alice');
        const bob = await signIn(h, 'bob');

        const created = await (await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: h.origin },
            body: JSON.stringify({ title: 'Alice Only', company: 'ACME' }),
        })).json();

        const res = await fetch(`${h.base}/jobs/${created.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: bob, Origin: h.origin },
            body: JSON.stringify({ notes: 'hijacked' }),
        });
        assert.equal(res.status, 404);

        const still = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: alice } })).json();
        assert.equal(still[0].notes, '');
    } finally { h.close(); }
});

test('a member cannot delete another member\'s jobs by status', async () => {
    const h = await startApp();
    try {
        const aliceId = await signUpMember(h, 'alice');
        const bobId = await signUpMember(h, 'bob');
        approve(h, aliceId);
        approve(h, bobId);
        const alice = await signIn(h, 'alice');
        const bob = await signIn(h, 'bob');

        await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: h.origin },
            body: JSON.stringify({ title: 'Alice Only', company: 'ACME', status: 'deleted' }),
        });

        const res = await fetch(`${h.base}/jobs/status/deleted`, {
            method: 'DELETE',
            headers: { Cookie: bob, Origin: h.origin },
        });
        const body = await res.json();
        assert.equal(body.deleted, 0);

        const still = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: alice } })).json();
        assert.equal(still.length, 1);
    } finally { h.close(); }
});

test('an anonymous visitor gets 401 on writes', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: h.origin },
            body: JSON.stringify({ title: 'Nope', company: 'ACME' }),
        });
        assert.equal(res.status, 401);
    } finally { h.close(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test server/isolation.test.ts`
Expected: FAIL — `Cannot find module './testing.js'`.

- [ ] **Step 3: Append migration 3**

Add to `MIGRATIONS` in `server/migrations.ts`:

```ts
    // The identity cutover. Better Auth's "user" becomes the only identity table.
    //
    // The carried-over rows cannot be inserted here: their new user_id is the owner's
    // Better Auth id, which does not exist until ensureOwner runs at boot, and that
    // cannot run before migration 2 created the tables it needs. So the rows are parked
    // in FK-free holding tables and drained by an idempotent boot step instead.
    {
        version: 3,
        sql: `
            CREATE TABLE legacy_owner_jobs AS
                SELECT * FROM jobs WHERE user_id IN (SELECT id FROM users WHERE role='owner');
            CREATE TABLE legacy_owner_history AS
                SELECT * FROM history WHERE user_id IN (SELECT id FROM users WHERE role='owner');
            CREATE TABLE legacy_owner_scrape_info AS
                SELECT * FROM scrape_info WHERE user_id IN (SELECT id FROM users WHERE role='owner');

            DROP TABLE jobs;
            DROP TABLE history;
            DROP TABLE scrape_info;
            DROP TABLE users;

            CREATE TABLE jobs (
                user_id TEXT NOT NULL REFERENCES "user"("id"),
                id TEXT NOT NULL,
                title TEXT, company TEXT, location TEXT, url TEXT,
                status TEXT, statusSummary TEXT, statusSummaryUpdatedAt TEXT,
                appliedDate TEXT, scrapedDate TEXT, notes TEXT, summary TEXT, posted TEXT,
                PRIMARY KEY (user_id, id)
            );
            CREATE TABLE history (
                user_id TEXT NOT NULL REFERENCES "user"("id"),
                date TEXT NOT NULL,
                wins TEXT, basePoints INTEGER, scoreMultiplier REAL, totalPoints INTEGER,
                PRIMARY KEY (user_id, date)
            );
            CREATE TABLE scrape_info (
                user_id TEXT PRIMARY KEY REFERENCES "user"("id"),
                lastTriggerDate TEXT
            );

            CREATE INDEX jobs_user_idx ON jobs(user_id);
        `,
    },
```

- [ ] **Step 4: Add the backfill to `ensureOwner`**

Append to `server/owner.ts`, inside `ensureOwner`, immediately before `return created.id;` — and also reachable on the early-return path. Restructure the tail of the function to:

```ts
    const ownerId = existing?.id ?? created!.id;
    drainLegacyRows(db, ownerId, log);
    return ownerId;
```

with, at module scope:

```ts
/**
 * Idempotent backfill of the rows parked by migration 3. No-ops once the holding
 * tables are empty, which is every boot after the first.
 */
function drainLegacyRows(db: Db, ownerId: string, log?: (m: string) => void): void {
    const has = (table: string): boolean =>
        !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);

    const move = db.transaction(() => {
        let moved = 0;
        if (has('legacy_owner_jobs')) {
            moved += db.prepare(
                `INSERT OR IGNORE INTO jobs
                 SELECT ?, id, title, company, location, url, status, statusSummary,
                        statusSummaryUpdatedAt, appliedDate, scrapedDate, notes, summary, posted
                 FROM legacy_owner_jobs`,
            ).run(ownerId).changes;
            db.prepare('DELETE FROM legacy_owner_jobs').run();
        }
        if (has('legacy_owner_history')) {
            db.prepare(
                `INSERT OR IGNORE INTO history
                 SELECT ?, date, wins, basePoints, scoreMultiplier, totalPoints
                 FROM legacy_owner_history`,
            ).run(ownerId);
            db.prepare('DELETE FROM legacy_owner_history').run();
        }
        if (has('legacy_owner_scrape_info')) {
            db.prepare(
                `INSERT OR IGNORE INTO scrape_info
                 SELECT ?, lastTriggerDate FROM legacy_owner_scrape_info`,
            ).run(ownerId);
            db.prepare('DELETE FROM legacy_owner_scrape_info').run();
        }
        return moved;
    });

    const moved = move();
    if (moved > 0) log?.(`adopted ${moved} legacy job row(s)`);
}
```

Restructure the early return so the drain always runs: replace `if (existing?.id) return existing.id;` with a branch that skips only the creation.

- [ ] **Step 5: Add the backfill test**

Append to `server/owner.test.ts`:

```ts
test('ensureOwner drains the legacy holding tables exactly once', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // Simulate a pre-cutover database: v1 tables with an owner and one job.
    const { MIGRATIONS, migrate: run } = await import('./migrations.js');
    db.exec(MIGRATIONS[0].sql);
    db.prepare(`INSERT INTO users (username,password_hash,role,created_at)
                VALUES ('phil','x','owner','2026-01-01')`).run();
    db.prepare(`INSERT INTO jobs (user_id,id,title,company,status,notes)
                VALUES (1,'j1','Old Job','ACME','new','keep me')`).run();
    db.prepare(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`).run();
    db.prepare(`INSERT INTO schema_migrations VALUES (1, '2026-01-01')`).run();
    run(db);

    const config = loadConfig(TEST_ENV);
    const auth = buildAuth({ db, config });
    const ownerId = await ensureOwner({ auth, db, config });

    const rows = db.prepare('SELECT user_id, id, notes FROM jobs').all() as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, ownerId);
    assert.equal(rows[0].notes, 'keep me');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM legacy_owner_jobs').get() as { n: number }).n, 0);

    // The hand-rolled identity table is gone; Better Auth's "user" is the only one left.
    const legacyUsers = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`)
        .get();
    assert.equal(legacyUsers, undefined);

    await ensureOwner({ auth, db, config });
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n, 1);
    db.close();
});
```

- [ ] **Step 6: Convert `repo.ts` to string user ids**

In `server/repo.ts`: change every `userId: number` parameter to `userId: string`. Delete `getUserById`, `getDemoUser`, `getOwnerUser`, `getUserByUsername` and the `UserRow` interface — identity queries now go through Better Auth. Keep `createStableJobId`, `normalizeIncomingJob`, `mergeJob`, `toRow`, `rowToJob` and every job/history/scrape function unchanged apart from the id type.

Add an owner lookup used by the webhook fallback:

```ts
export function getOwnerId(db: Db): string | null {
    const row = db.prepare(`SELECT "id" FROM "user" WHERE "role"='owner' LIMIT 1`).get() as
        | { id: string } | undefined;
    return row?.id ?? null;
}
```

Add the missing ordering while the file is open — `getJobs` has never had one:

```ts
export function getJobs(db: Db, userId: string): Job[] {
    const rows = db
        .prepare(`SELECT * FROM jobs WHERE user_id=? ORDER BY scrapedDate DESC, id`)
        .all(userId);
    return rows.map(rowToJob);
}
```

- [ ] **Step 7: Strip `db.ts` of the legacy seeding**

Delete `seedUsers`, `seedDemoJobs`, `migrateFromJson`, `readJsonFile`, `SeedOptions`, `DEFAULT_USERNAME` and `DEFAULT_PASSWORD`. `server/db.ts` keeps only `openDb` and the `Db` type export.

- [ ] **Step 8: Strip `auth.ts` of the hand-rolled crypto**

Delete `hashPassword`, `verifyPassword`, `SCRAPE_KEYLEN`/`SCRYPT_KEYLEN`, `SESSION_TTL_MS`, `createSessionToken`, `verifySessionToken`, `COOKIE_NAME`, `loadOrCreateSecret`, `parseCookies`, `cookieFlags`, `buildSessionCookie`, `buildClearCookie`, `attachUser` and `requireOwner`'s old form. Keep `requireWebhookSecret` unchanged and the new `buildAuth`.

Delete the corresponding tests from `server/auth.test.ts`, leaving only the five approval-gate tests from Task 5.

- [ ] **Step 9: Write the test harness**

Create `server/testing.ts`:

```ts
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { buildAuth, type AppAuth } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { ensureOwner } from './owner.js';
import { createApp } from './app.js';
import { openDb, type Db } from './db.js';

export const OWNER_PASSWORD = 'owner-correct-horse';
export const MEMBER_PASSWORD = 'correct-horse-battery';

export interface Harness {
    db: Db;
    auth: AppAuth;
    config: AppConfig;
    base: string;
    origin: string;
    ownerId: string;
    close(): void;
}

/**
 * Reserve a port before building the app.
 *
 * Better Auth validates requests against `baseURL`, and the Origin check is an exact
 * string compare against `publicOrigin` — so both must be known before `createApp`,
 * which rules out the usual `listen(0)`-then-read-the-port order.
 */
async function reservePort(): Promise<number> {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
}

export async function startApp(): Promise<Harness> {
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;

    // openDb applies the pragmas and runs every migration, exactly as boot does.
    const db = openDb(':memory:');

    const config = loadConfig({
        NODE_ENV: 'test',
        PUBLIC_ORIGIN: origin,
        SESSION_SECRET: '0123456789abcdef0123456789abcdef',
        OWNER_USERNAME: 'phil',
        OWNER_EMAIL: 'owner@example.test',
        OWNER_PASSWORD,
        WEBHOOK_SECRET: 'wh-secret',
        DATA_DIR: '.',
    });

    const auth = buildAuth({ db, config });
    const ownerId = await ensureOwner({ auth, db, config });

    const app = createApp(db, { auth, config });
    const server = app.listen(port, '127.0.0.1');
    await once(server, 'listening');

    return {
        db, auth, config, ownerId, origin,
        base: `${origin}/api`,
        close: () => { server.close(); db.close(); },
    };
}

/** Sign up a member through the real API. Returns the new user's id. */
export async function signUpMember(h: Harness, username: string): Promise<string> {
    const res = await fetch(`${h.origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: h.origin },
        body: JSON.stringify({
            email: `${username}@example.test`,
            name: username,
            password: MEMBER_PASSWORD,
            username,
        }),
    });
    if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const row = h.db.prepare('SELECT "id" FROM "user" WHERE "username"=?')
        .get(username) as { id: string };
    return row.id;
}

/** Approve an account directly, for suites that are not testing the admin routes. */
export function approve(h: Harness, userId: string): void {
    h.db.prepare(`UPDATE "user" SET "approvalStatus"='approved' WHERE "id"=?`).run(userId);
}

/** Sign in and return a Cookie header value. */
export async function signIn(
    h: Harness, username: string, password: string = MEMBER_PASSWORD,
): Promise<string> {
    const res = await fetch(`${h.origin}/api/auth/sign-in/username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: h.origin },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    const raw = res.headers.get('set-cookie') || '';
    return raw.split(';')[0];
}
```

- [ ] **Step 10: Rewire `app.ts`**

Rewrite `createApp` to the new signature and middleware order:

```ts
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import type { AppAuth } from './auth.js';
import type { AppConfig } from './config.js';
import { getOwnerId } from './repo.js';
import { requireUser, requireOwner, type AuthedRequest } from './guards.js';

export interface AppOptions {
    auth: AppAuth;
    config: AppConfig;
}

export function createApp(db: Db, opts: AppOptions): Express {
    const app = express();

    // Better Auth reads the raw request body, so its handler must be registered
    // before any body parser. Express 4 wildcard syntax: '*', not '*splat'.
    app.all('/api/auth/*', toNodeHandler(opts.auth));

    app.use(express.json({ limit: '1mb' }));

    app.use(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
        const session = await opts.auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });
        req.user = (session?.user as SessionUser | undefined) ?? null;
        next();
    });

    // ... routes ...
    return app;
}
```

Create `server/guards.ts` in the same step. The guards live in their own module so
`admin.ts` (Task 10) can import them without an `app.ts` ↔ `admin.ts` import cycle:

```ts
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from './auth.js';

export interface AuthedRequest extends Request {
    user?: SessionUser | null;
}

export function requireUser(req: AuthedRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    next();
}

export function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
    if (req.user?.role !== 'owner') {
        res.status(403).json({ error: 'Owner access required' });
        return;
    }
    next();
}
```

`app.ts` imports `AuthedRequest`, `requireUser` and `requireOwner` from `./guards.js`
and re-exports nothing.

Delete the `POST /api/login` and `POST /api/logout` handlers. Change every write route from `requireOwner` to `requireUser` and every `req.userId!` to `req.user!.id`. `POST /api/generate-cover-letter` keeps `requireOwner`. `receive-jobs` uses `getOwnerId(db)`; the per-run routing arrives in Task 11.

`GET /api/me` becomes:

```ts
app.get('/api/me', (req: AuthedRequest, res: Response) => {
    const user = req.user;
    res.json({
        authenticated: !!user,
        username: user?.username ?? null,
        role: user?.role ?? null,
        isDemo: !user,
    });
});
```

The `express.json({ limit: '50mb' })` line is gone; add a route-local parser on `receive-jobs` only:

```ts
app.post('/api/receive-jobs', express.json({ limit: '20mb' }), requireWebhookSecret, /* ... */);
```

- [ ] **Step 11: Update `server.ts`**

```ts
import path from 'path';
import { openDb } from './server/db.js';
import { loadConfig } from './server/config.js';
import { buildAuth } from './server/auth.js';
import { ensureOwner } from './server/owner.js';
import { createApp } from './server/app.js';

const config = loadConfig(process.env);
const db = openDb(path.join(config.dataDir, 'jobviewer.db'));
const auth = buildAuth({ db, config });
const ownerId = await ensureOwner({ auth, db, config, log: (m) => console.log(m) });
console.log(`owner id: ${ownerId}`);

const app = createApp(db, { auth, config });
app.listen(config.port, () => {
    console.log(`Job Viewer running on port ${config.port}`);
});
```

- [ ] **Step 12: Rewrite `app.test.ts` and `repo.test.ts` onto the harness**

Replace the local `startApp`/`cookieFrom` helpers in `server/app.test.ts` with imports from `./testing.js`, and drop the login/logout tests (those endpoints no longer exist — Better Auth owns them, and Task 5 covers the gate). Keep and adapt: `/me` anonymous, `/me` signed-in, per-user job reads, `POST /jobs` returning the exact created row, `trigger-scrape` daily limit, `generate-cover-letter` owner-only, and both `receive-jobs` secret tests.

In `server/repo.test.ts`, delete the `seedUsers` and `verifyPassword` imports and the user-helper tests. Seed users with the harness's `signUpMember` + `approve`, or with a direct insert for repo-only suites:

```ts
function seedUserRow(db: Db, username: string): string {
    const id = `u-${username}`;
    db.prepare(
        `INSERT OR IGNORE INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt",
            "username","displayUsername","role","approvalStatus")
         VALUES (?,?,?,0,?,?,?,?,'member','approved')`,
    ).run(id, username, `${username}@example.test`, '2026-01-01', '2026-01-01', username, username);
    return id;
}
```

Update the "openDb creates the expected tables" test to assert on `"user"` rather than `users`.

- [ ] **Step 13: Run the isolation test**

Run: `node --import tsx --test server/isolation.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 14: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 15: Commit**

```bash
git add server/ server.ts
git commit -m "feat!: cut identity over to better-auth with per-user string ids"
```

---

## Task 8: Origin check and security headers

**Files:**
- Modify: `server/app.ts`
- Test: `server/security.test.ts`

**Interfaces:**
- Consumes: `createApp` (Task 7), the harness (Task 7).
- Produces: unsafe `/api/` requests with a foreign `Origin` get 403 before any session lookup.

- [ ] **Step 1: Write the failing test**

Create `server/security.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signUpMember, approve, signIn } from './testing.js';

test('an unsafe request from a foreign origin is rejected', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await signIn(h, 'alice');
        const res = await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://evil.example',
            },
            body: JSON.stringify({ title: 'Nope', company: 'ACME' }),
        });
        assert.equal(res.status, 403);
    } finally { h.close(); }
});

test('a safe request from a foreign origin is allowed', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/me`, { headers: { Origin: 'https://evil.example' } });
        assert.equal(res.status, 200);
    } finally { h.close(); }
});

test('the wildcard CORS header is gone', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/me`);
        assert.equal(res.headers.get('access-control-allow-origin'), null);
    } finally { h.close(); }
});

test('security headers are present', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/me`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    } finally { h.close(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test server/security.test.ts`
Expected: FAIL — the foreign-origin POST returns 201.

- [ ] **Step 3: Implement**

In `server/app.ts`, delete the CORS block entirely and insert, immediately after the Better Auth mount:

```ts
import helmet from 'helmet';

app.use(helmet());

// Checked before the session is resolved, so a cross-origin caller gets nothing —
// not even the cost of a session lookup.
app.use((req: Request, res: Response, next: NextFunction) => {
    const isApi = req.path.startsWith('/api');
    const isUnsafe = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE';
    if (isApi && isUnsafe && req.headers.origin !== opts.config.publicOrigin) {
        res.status(403).json({ error: 'Request origin is not allowed' });
        return;
    }
    next();
});
```

Note that `receive-jobs` is server-to-server and sends no `Origin`, so it must be exempted — add `&& req.path !== '/api/receive-jobs'` to the condition, since that route is authenticated by `WEBHOOK_SECRET` instead.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test server/security.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/app.ts server/security.test.ts
git commit -m "feat: exact-origin check on unsafe routes, helmet, no wildcard CORS"
```

---

## Task 9: The anonymous demo fixture

**Files:**
- Create: `server/fixture.ts`
- Modify: `server/app.ts` (the three read routes)
- Test: `server/fixture.test.ts`

**Interfaces:**
- Consumes: `createApp` (Task 7).
- Produces: `export function loadFixture(samplePath: string): Job[]` and `export const EMPTY_SCRAPE_INFO`.

- [ ] **Step 1: Write the failing test**

Create `server/fixture.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './testing.js';

test('an anonymous visitor is served the fixture', async () => {
    const h = await startApp();
    try {
        const jobs = await (await fetch(`${h.base}/jobs`)).json();
        assert.ok(Array.isArray(jobs));
        assert.ok(jobs.length > 0, 'fixture should not be empty');
    } finally { h.close(); }
});

test('the fixture is not stored in the database', async () => {
    const h = await startApp();
    try {
        await fetch(`${h.base}/jobs`);
        const n = (h.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
        assert.equal(n, 0);
    } finally { h.close(); }
});

test('anonymous history and scrape-info are safe defaults', async () => {
    const h = await startApp();
    try {
        assert.deepEqual(await (await fetch(`${h.base}/history`)).json(), []);
        assert.deepEqual(
            await (await fetch(`${h.base}/scrape-info`)).json(),
            { lastTriggerDate: null },
        );
    } finally { h.close(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test server/fixture.test.ts`
Expected: FAIL — anonymous `/jobs` currently 500s or returns `[]`.

- [ ] **Step 3: Implement**

Create `server/fixture.ts`:

```ts
import fs from 'fs';
import type { Job } from '../shared/types.js';

/**
 * The anonymous demo dataset. Read once at boot and held in memory — the demo is a
 * fixture, not an account, so it never touches the database and a visitor can never
 * persist to it.
 */
export function loadFixture(samplePath: string): Job[] {
    try {
        if (!fs.existsSync(samplePath)) return [];
        const raw = fs.readFileSync(samplePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as Job[]) : [];
    } catch {
        return [];
    }
}

export const EMPTY_SCRAPE_INFO = { lastTriggerDate: null } as const;
```

In `server/app.ts`, load it once in `createApp` and branch the three read routes:

```ts
const fixture = loadFixture(path.join(process.cwd(), 'public-sample.json'));

app.get('/api/jobs', (req: AuthedRequest, res: Response) => {
    if (!req.user) return res.json(fixture);
    res.json(getJobs(db, req.user.id));
});

app.get('/api/history', (req: AuthedRequest, res: Response) => {
    if (!req.user) return res.json([]);
    res.json(getHistory(db, req.user.id));
});

app.get('/api/scrape-info', (req: AuthedRequest, res: Response) => {
    if (!req.user) return res.json(EMPTY_SCRAPE_INFO);
    res.json(getScrapeInfo(db, req.user.id));
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test server/fixture.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/fixture.ts server/fixture.test.ts server/app.ts
git commit -m "feat: serve anonymous visitors a fixture instead of a demo account"
```

---

## Task 10: Owner-only admin routes

**Files:**
- Create: `server/admin.ts`
- Modify: `server/app.ts` (register the routes; add the pending count to `/api/me`)
- Test: `server/admin.test.ts`

**Interfaces:**
- Consumes: `requireOwner`, `AuthedRequest` from `server/guards.js` (Task 7); the harness (Task 7).
- Produces: `export function registerAdminRoutes(app: Express, db: Db): void`, serving
  `GET /api/admin/users?status=pending|all`, `POST /api/admin/users/:id/approve`,
  `POST /api/admin/users/:id/reject`.

- [ ] **Step 1: Write the failing test**

Create `server/admin.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signUpMember, approve, signIn, OWNER_PASSWORD } from './testing.js';

async function ownerCookie(h: Awaited<ReturnType<typeof startApp>>) {
    return signIn(h, 'phil', OWNER_PASSWORD);
}

test('the owner sees pending accounts', async () => {
    const h = await startApp();
    try {
        await signUpMember(h, 'alice');
        const cookie = await ownerCookie(h);
        const body = await (await fetch(`${h.base}/admin/users`, { headers: { Cookie: cookie } })).json();
        assert.equal(body.users.length, 1);
        assert.equal(body.users[0].username, 'alice');
    } finally { h.close(); }
});

test('a member cannot reach the admin routes', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await signIn(h, 'alice');
        const res = await fetch(`${h.base}/admin/users`, { headers: { Cookie: cookie } });
        assert.equal(res.status, 403);
    } finally { h.close(); }
});

test('approving lets the member sign in', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        const cookie = await ownerCookie(h);
        const res = await fetch(`${h.base}/admin/users/${id}/approve`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 200);
        assert.ok(await signIn(h, 'alice'));
    } finally { h.close(); }
});

test('rejecting kills the live session', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const alice = await signIn(h, 'alice');
        assert.equal((await (await fetch(`${h.base}/me`, { headers: { Cookie: alice } })).json()).authenticated, true);

        const cookie = await ownerCookie(h);
        await fetch(`${h.base}/admin/users/${id}/reject`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });

        const after = await (await fetch(`${h.base}/me`, { headers: { Cookie: alice } })).json();
        assert.equal(after.authenticated, false);
    } finally { h.close(); }
});

test('the owner cannot be rejected', async () => {
    const h = await startApp();
    try {
        const cookie = await ownerCookie(h);
        const res = await fetch(`${h.base}/admin/users/${h.ownerId}/reject`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 409);
    } finally { h.close(); }
});

test('/api/me carries the pending count for the owner', async () => {
    const h = await startApp();
    try {
        await signUpMember(h, 'alice');
        const cookie = await ownerCookie(h);
        const me = await (await fetch(`${h.base}/me`, { headers: { Cookie: cookie } })).json();
        assert.equal(me.pendingCount, 1);
    } finally { h.close(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test server/admin.test.ts`
Expected: FAIL — 404 on `/api/admin/users`.

- [ ] **Step 3: Implement**

Create `server/admin.ts`:

```ts
import type { Express, Response } from 'express';
import type { Db } from './db.js';
import { requireOwner, type AuthedRequest } from './guards.js';

/**
 * Owner-only. The `requireOwner` guard already turns members and anonymous callers
 * away, so these handlers only have to do the work.
 */
export function registerAdminRoutes(app: Express, db: Db): void {
    app.get('/api/admin/users', requireOwner, (req: AuthedRequest, res: Response) => {
        const status = req.query.status === 'all' ? 'all' : 'pending';
        // An explicit column list, never SELECT *: the user table holds fields with no
        // business on the wire, so a column added later must be opted in deliberately.
        const users = db.prepare(
            `SELECT u."id", u."username", u."displayUsername", u."email", u."createdAt",
                    u."approvalStatus", u."role", u."approvedAt",
                    (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u."id") AS jobCount
             FROM "user" u
             ${status === 'pending' ? `WHERE u."approvalStatus" = 'pending'` : ''}
             ORDER BY CASE u."approvalStatus" WHEN 'pending' THEN 0 ELSE 1 END,
                      u."createdAt" DESC`,
        ).all();
        res.json({ users });
    });

    const setStatus = (next: 'approved' | 'rejected') =>
        (req: AuthedRequest, res: Response): void => {
            const id = String(req.params.id);
            const target = db.prepare('SELECT "id","role" FROM "user" WHERE "id" = ?')
                .get(id) as { id: string; role: string } | undefined;
            if (!target) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            // The owner cannot lock themselves out of their own admin panel.
            if (target.role === 'owner') {
                res.status(409).json({ error: 'The owner cannot be changed' });
                return;
            }

            db.prepare(
                `UPDATE "user" SET "approvalStatus" = ?, "approvedAt" = ?, "approvedBy" = ?
                 WHERE "id" = ?`,
            ).run(next, new Date().toISOString(), req.user?.id ?? null, id);

            // Revocation is the whole point of server-side sessions: a rejected user's
            // live session dies now rather than lasting until its token expires.
            if (next === 'rejected') {
                db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(id);
            }

            res.json({ id, approvalStatus: next });
        };

    app.post('/api/admin/users/:id/approve', requireOwner, setStatus('approved'));
    app.post('/api/admin/users/:id/reject', requireOwner, setStatus('rejected'));
}
```

In `server/app.ts`, call `registerAdminRoutes(app, db)` and extend `/api/me`:

```ts
const pendingCount = user?.role === 'owner'
    ? (db.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE "approvalStatus"='pending'`)
        .get() as { n: number }).n
    : 0;
res.json({ /* ...existing fields..., */ pendingCount });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test server/admin.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/admin.ts server/admin.test.ts server/app.ts
git commit -m "feat: owner-only account approval routes with session revocation"
```

---

## Task 11: `scrape_runs` and the per-user n8n delivery contract

**Files:**
- Modify: `server/migrations.ts` (append version 4)
- Create: `server/scrape.ts`
- Modify: `server/app.ts` (`trigger-scrape`, `receive-jobs`)
- Test: `server/scrape.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 2), `getOwnerId` (Task 7).
- Produces:
  - `export function createRun(db: Db, userId: string): string` — returns the run id.
  - `export function claimRun(db: Db, runId: string, expiryMinutes: number): string | null` — returns the run's `user_id` and marks it delivered, or `null` when unknown, consumed or expired.
  - `export function countRunsToday(db: Db): number`
  - `export function countUserRunsToday(db: Db, userId: string): number`

- [ ] **Step 1: Write the failing test**

Create `server/scrape.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';
import { createRun, claimRun, countRunsToday, countUserRunsToday } from './scrape.js';

function fixture() {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare(
        `INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt",
            "username","displayUsername","role","approvalStatus")
         VALUES ('u1','alice','a@example.test',0,'2026-01-01','2026-01-01','alice','alice','member','approved')`,
    ).run();
    return db;
}

test('a run can be claimed exactly once', () => {
    const db = fixture();
    const runId = createRun(db, 'u1');
    assert.equal(claimRun(db, runId, 30), 'u1');
    assert.equal(claimRun(db, runId, 30), null, 'second claim must fail');
    db.close();
});

test('an unknown run is not claimable', () => {
    const db = fixture();
    assert.equal(claimRun(db, 'nope', 30), null);
    db.close();
});

test('an expired run is not claimable', () => {
    const db = fixture();
    const runId = createRun(db, 'u1');
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE scrape_runs SET created_at=? WHERE id=?').run(old, runId);
    assert.equal(claimRun(db, runId, 30), null);
    db.close();
});

test('an expired run still counts toward the caps', () => {
    const db = fixture();
    const runId = createRun(db, 'u1');
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE scrape_runs SET created_at=? WHERE id=?').run(old, runId);
    claimRun(db, runId, 30);
    // Same calendar day, so it still counts — the Apify run it paid for did happen.
    assert.equal(countRunsToday(db), 1);
    assert.equal(countUserRunsToday(db, 'u1'), 1);
    db.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test server/scrape.test.ts`
Expected: FAIL — `Cannot find module './scrape.js'`.

- [ ] **Step 3: Append migration 4**

```ts
    {
        version: 4,
        sql: `
            CREATE TABLE scrape_runs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES "user"("id"),
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                consumed_at TEXT
            );
            CREATE INDEX scrape_runs_user_idx ON scrape_runs(user_id, created_at);
        `,
    },
```

- [ ] **Step 4: Write `server/scrape.ts`**

```ts
import crypto from 'crypto';
import type { Db } from './db.js';

export function createRun(db: Db, userId: string): string {
    const id = crypto.randomUUID();
    db.prepare(
        `INSERT INTO scrape_runs (id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)`,
    ).run(id, userId, new Date().toISOString());
    return id;
}

/**
 * Resolve a delivery. Returns the owning user's id and marks the run delivered, or
 * null when the run is unknown, already consumed, or past its window.
 *
 * Expiry is computed, never stored: there is no third status and no sweeper job. A
 * stale pending row is simply never accepted again, and it still counts toward the
 * daily caps — correct, because the Apify run it paid for did happen.
 */
export function claimRun(db: Db, runId: string, expiryMinutes: number): string | null {
    const row = db
        .prepare(`SELECT user_id, status, created_at FROM scrape_runs WHERE id = ?`)
        .get(runId) as { user_id: string; status: string; created_at: string } | undefined;

    if (!row || row.status !== 'pending') return null;

    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > expiryMinutes * 60 * 1000) return null;

    db.prepare(`UPDATE scrape_runs SET status='delivered', consumed_at=? WHERE id=?`)
        .run(new Date().toISOString(), runId);
    return row.user_id;
}

function today(): string {
    return new Date().toISOString().split('T')[0];
}

export function countRunsToday(db: Db): number {
    return (db
        .prepare(`SELECT COUNT(*) AS n FROM scrape_runs WHERE substr(created_at,1,10) = ?`)
        .get(today()) as { n: number }).n;
}

export function countUserRunsToday(db: Db, userId: string): number {
    return (db
        .prepare(
            `SELECT COUNT(*) AS n FROM scrape_runs
             WHERE user_id = ? AND substr(created_at,1,10) = ?`,
        )
        .get(userId, today()) as { n: number }).n;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test server/scrape.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Wire the routes**

`POST /api/trigger-scrape` becomes:

```ts
app.post('/api/trigger-scrape', requireUser, async (req: AuthedRequest, res: Response) => {
    const url = opts.config.n8nScrapeUrl;
    if (!url) return res.status(500).json({ error: 'N8N_SCRAPE_URL is not configured' });

    if (countUserRunsToday(db, req.user!.id) >= 1) {
        return res.status(429).json({ error: 'Scrape already triggered today. Limit: 1 per day.' });
    }
    if (countRunsToday(db) >= opts.config.scrapeDailyLimit) {
        return res.status(429).json({
            error: 'The shared daily scrape budget is spent. Try again tomorrow.',
        });
    }

    const runId = createRun(db, req.user!.id);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
        });
        if (!response.ok) throw new Error(`n8n responded with status: ${response.status}`);
        const day = new Date().toISOString().split('T')[0];
        setScrapeInfo(db, req.user!.id, day);
        res.json({ message: 'Scrape triggered successfully', lastTriggerDate: day, runId });
    } catch (err: any) {
        console.error('Failed to trigger n8n:', err);
        res.status(500).json({ error: `Failed to trigger n8n: ${err.message}` });
    }
});
```

`POST /api/receive-jobs` resolves the target:

```ts
const { runId, jobs: incomingJobs } = Array.isArray(req.body)
    ? { runId: undefined, jobs: req.body }
    : (req.body ?? {});

// No runId means the weekly scheduled workflow, which has no user context and
// delivers to the owner exactly as it always has.
const targetId = runId
    ? claimRun(db, String(runId), opts.config.runExpiryMinutes)
    : getOwnerId(db);

if (!targetId) return res.status(409).json({ error: 'Unknown, consumed or expired run' });
if (!Array.isArray(incomingJobs)) {
    return res.status(400).json({ error: 'Payload must be an array of jobs' });
}
upsertJobs(db, targetId, incomingJobs.filter(Boolean));
```

- [ ] **Step 7: Add the route-level tests**

Append to `server/scrape.test.ts`, using the harness:

```ts
import { startApp, signUpMember, approve, signIn } from './testing.js';

test('receive-jobs routes a batch to the run\'s owner', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const runId = createRun(h.db, id);

        const res = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wh-secret' },
            body: JSON.stringify({ runId, jobs: [{ title: 'For Alice', company: 'ACME' }] }),
        });
        assert.equal(res.status, 201);

        const cookie = await signIn(h, 'alice');
        const jobs = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].title, 'For Alice');
    } finally { h.close(); }
});

test('receive-jobs without a runId still delivers to the owner', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wh-secret' },
            body: JSON.stringify([{ title: 'Scheduled', company: 'ACME' }]),
        });
        assert.equal(res.status, 201);
        const rows = h.db.prepare('SELECT user_id FROM jobs').all() as any[];
        assert.equal(rows[0].user_id, h.ownerId);
    } finally { h.close(); }
});
```

- [ ] **Step 8: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add server/migrations.ts server/scrape.ts server/scrape.test.ts server/app.ts
git commit -m "feat: per-user scrape runs with replay-proof delivery and daily caps"
```

---

## Task 12: Frontend — auth client, sign-in and sign-up

**Files:**
- Create: `src/ts/auth.ts`
- Create: `src/ts/components/authModal.ts`
- Modify: `src/ts/api.ts` (drop `login`/`logout`; `isOwner` → `isAuthenticated`)
- Modify: `src/ts/state.ts`
- Modify: `src/ts/main.ts` (wiring)
- Modify: `index.html` (sign-up tab markup)

**Interfaces:**
- Consumes: `/api/auth/*` (Task 7), `/api/me` (Task 10).
- Produces: `authClient`, `authErrorMessage(code, fallback)`, `openAuthModal(mode)`, `closeAuthModal()`.

- [ ] **Step 1: Create the auth client**

`src/ts/auth.ts`:

```ts
import { createAuthClient } from 'better-auth/client';
import { usernameClient } from 'better-auth/client/plugins';

/**
 * The API and the SPA are served by the same Express instance, so no baseURL is
 * needed and the session cookie rides along automatically.
 */
export const authClient = createAuthClient({ plugins: [usernameClient()] });

/** Mirrors `minPasswordLength` on the server. Shown in the form, enforced there. */
export const MIN_PASSWORD_LENGTH = 12;
export const MIN_USERNAME_LENGTH = 3;

/** Turn Better Auth's error codes into something a person wants to read. */
export function authErrorMessage(code: string | undefined, fallback: string): string {
    switch (code) {
        case 'ACCOUNT_PENDING':
            return 'This account is still waiting to be approved.';
        case 'ACCOUNT_REJECTED':
            return 'This account cannot sign in.';
        case 'INVALID_USERNAME_OR_PASSWORD':
            return 'That username and password do not match.';
        case 'USERNAME_IS_ALREADY_TAKEN':
        case 'USERNAME_IS_ALREADY_IN_USE':
            return 'That username is taken.';
        case 'USER_ALREADY_EXISTS':
            return 'An account with that email already exists.';
        case 'PASSWORD_TOO_SHORT':
            return `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        case 'USERNAME_TOO_SHORT':
            return `Usernames must be at least ${MIN_USERNAME_LENGTH} characters.`;
        case 'TOO_MANY_REQUESTS':
            return 'Too many attempts. Wait a few minutes and try again.';
        default:
            return fallback;
    }
}
```

- [ ] **Step 2: Rename the ownership gate in state**

In `src/ts/state.ts`, replace `isOwner`/`setIsOwner` with:

```ts
export let isAuthenticated = false;
export function setIsAuthenticated(v: boolean) {
    isAuthenticated = v;
}

export let isOwner = false;
export function setIsOwner(v: boolean) {
    isOwner = v;
}

export let pendingCount = 0;
export function setPendingCount(n: number) {
    pendingCount = n;
}
```

Both flags are needed now: `isAuthenticated` gates persistence (members write), `isOwner` gates the admin panel and the AI cover-letter button.

- [ ] **Step 3: Switch `api.ts` to the new gate**

In `src/ts/api.ts`, delete `login` and `logout` (Better Auth owns those endpoints now), and change every `if (!isOwner)` sandbox branch in `patchJob`, `createJob` and `deleteDeletedJobs` to `if (!isAuthenticated)`. `triggerScrape` guards on `isAuthenticated`; `generateCoverLetter` keeps guarding on `isOwner`.

Extend `MeResponse`:

```ts
export interface MeResponse {
    authenticated: boolean;
    username: string | null;
    role: string | null;
    isDemo: boolean;
    pendingCount: number;
}
```

- [ ] **Step 4: Build the modal**

Create `src/ts/components/authModal.ts`:

```ts
import { els } from '../dom';
import { authClient, authErrorMessage, MIN_PASSWORD_LENGTH } from '../auth';

type Mode = 'signin' | 'signup';

function showError(message: string): void {
    if (!els.loginError) return;
    els.loginError.textContent = message;
    els.loginError.classList.remove('hidden');
}

function clearError(): void {
    els.loginError?.classList.add('hidden');
}

/**
 * Sign-up deliberately issues no session, so there is nothing to redirect to. The
 * account sits pending until the owner approves it, and this panel says so in the
 * same words Better Auth's ACCOUNT_PENDING error uses on a later sign-in attempt.
 */
function showPendingState(): void {
    els.authForm?.classList.add('hidden');
    els.authTabs?.classList.add('hidden');
    els.authPending?.classList.remove('hidden');
}

export function openAuthModal(mode: Mode = 'signin'): void {
    clearError();
    els.authPending?.classList.add('hidden');
    els.authForm?.classList.remove('hidden');
    els.authTabs?.classList.remove('hidden');
    // Sign-up needs an email; sign-in does not.
    els.loginEmailRow?.classList.toggle('hidden', mode !== 'signup');
    els.loginSubmit && (els.loginSubmit.textContent = mode === 'signup' ? 'SIGN UP' : 'SIGN IN');
    els.loginSubmit?.setAttribute('data-mode', mode);
    els.loginBackdrop?.classList.remove('hidden');
    els.loginUsername?.focus();
}

export function closeAuthModal(): void {
    els.loginBackdrop?.classList.add('hidden');
}

export async function submitAuth(): Promise<void> {
    clearError();
    const mode = (els.loginSubmit?.getAttribute('data-mode') ?? 'signin') as Mode;
    const username = (els.loginUsername as HTMLInputElement)?.value.trim() ?? '';
    const password = (els.loginPassword as HTMLInputElement)?.value ?? '';
    const email = (els.loginEmail as HTMLInputElement)?.value.trim() ?? '';

    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
        showError(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
    }

    if (mode === 'signin') {
        const { error } = await authClient.signIn.username({ username, password });
        if (error) {
            showError(authErrorMessage(error.code, 'Could not sign in.'));
            return;
        }
        window.location.reload();
        return;
    }

    const { error } = await authClient.signUp.email({ email, name: username, password, username });
    if (error) {
        showError(authErrorMessage(error.code, 'Could not create the account.'));
        return;
    }
    showPendingState();
}
```

Add `authForm`, `authTabs`, `authPending`, `loginEmail` and `loginEmailRow` to `els` in
`src/ts/dom.ts` alongside the existing login handles.

- [ ] **Step 5: Update `index.html`**

Inside the existing `#login-backdrop` modal, replace its body with the markup below.
The classes are the ones `#login-backdrop` already uses, so the new controls match the
existing neo-brutalist treatment rather than inventing a second style.

```html
<div id="auth-tabs" class="flex gap-2 mb-4">
  <button type="button" id="tab-signin"
          class="flex-1 px-3 py-2 text-xs font-bold border-2 border-black shadow-[2px_2px_0_#000] bg-white">SIGN IN</button>
  <button type="button" id="tab-signup"
          class="flex-1 px-3 py-2 text-xs font-bold border-2 border-black shadow-[2px_2px_0_#000] bg-white">SIGN UP</button>
</div>

<div id="auth-form" class="flex flex-col gap-3">
  <div id="login-email-row" class="hidden flex-col gap-1">
    <label for="login-email" class="text-[11px] font-bold uppercase">Email</label>
    <input id="login-email" type="email" autocomplete="email"
           class="px-3 py-2 border-2 border-black shadow-[2px_2px_0_#000]">
  </div>
  <div class="flex flex-col gap-1">
    <label for="login-username" class="text-[11px] font-bold uppercase">Username</label>
    <input id="login-username" type="text" autocomplete="username"
           class="px-3 py-2 border-2 border-black shadow-[2px_2px_0_#000]">
  </div>
  <div class="flex flex-col gap-1">
    <label for="login-password" class="text-[11px] font-bold uppercase">Password</label>
    <input id="login-password" type="password" autocomplete="current-password"
           class="px-3 py-2 border-2 border-black shadow-[2px_2px_0_#000]">
  </div>
  <div id="login-error" class="hidden text-xs font-bold text-rose-500"></div>
  <button type="button" id="login-submit" data-mode="signin"
          class="px-3 py-2 text-sm font-bold bg-emerald-400 border-2 border-black shadow-[2px_2px_0_#000]">SIGN IN</button>
</div>

<div id="auth-pending" class="hidden text-sm">
  <div class="font-bold mb-2">Account created.</div>
  <p class="text-theme-muted">
    It is waiting to be approved. You will not be able to sign in until that happens.
  </p>
</div>
```

- [ ] **Step 6: Wire it in `main.ts`**

Replace the `login`/`logout` imports with `authClient` and the modal functions. `init()` reads `/api/me` and sets all three state flags. Sign-out becomes:

```ts
await authClient.signOut();
window.location.reload();
```

- [ ] **Step 7: Verify by hand**

Run: `npm run dev`

Check, in order: anonymous load shows the fixture board and a demo banner; sign-up succeeds and shows the pending state; signing in as that account fails with "waiting to be approved"; signing in as the owner works and the board shows real data.

- [ ] **Step 8: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/ts index.html
git commit -m "feat(ui): better-auth client with sign-in, sign-up and pending state"
```

---

## Task 13: Frontend — the owner's admin panel

**Files:**
- Create: `src/ts/components/admin.ts`
- Modify: `index.html`, `src/ts/main.ts`, `src/ts/dom.ts`

**Interfaces:**
- Consumes: `/api/admin/*` (Task 10), `pendingCount` (Task 12).
- Produces: `openAdminPanel()`, `closeAdminPanel()`, `refreshPendingBadge()`.

- [ ] **Step 1: Add the markup**

In `index.html`, add an owner-only header button `#view-admin` carrying a `#admin-badge` span, and an `#admin-backdrop` modal with an `#admin-list` container. Match the existing modal markup and classes.

- [ ] **Step 2: Implement the panel**

Create `src/ts/components/admin.ts`:

```ts
import { els } from '../dom';
import { escapeHtml } from '../utils';
import { pendingCount, setPendingCount } from '../state';

interface AdminUser {
    id: string;
    username: string;
    email: string;
    createdAt: string;
    approvalStatus: string;
    jobCount: number;
}

async function fetchUsers(status: 'pending' | 'all'): Promise<AdminUser[]> {
    const res = await fetch(`/api/admin/users?status=${status}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Failed to load accounts');
    return (await res.json()).users;
}

async function setStatus(id: string, action: 'approve' | 'reject'): Promise<void> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`Failed to ${action} the account`);
}

export async function openAdminPanel(): Promise<void> {
    if (!els.adminBackdrop || !els.adminList) return;
    els.adminBackdrop.classList.remove('hidden');
    const users = await fetchUsers('all');
    els.adminList.innerHTML = users.map((u) => `
        <div class="border-2 border-black shadow-[2px_2px_0_#000] p-3 flex justify-between items-center gap-3">
          <div>
            <div class="font-bold text-sm">${escapeHtml(u.username)}</div>
            <div class="text-[11px] text-theme-muted">${escapeHtml(u.email)} · ${escapeHtml(u.approvalStatus)} · ${u.jobCount} jobs</div>
          </div>
          <div class="flex gap-2">
            <button data-action="approve" data-id="${escapeHtml(u.id)}"
                    class="px-2 py-1 text-xs font-bold bg-emerald-400 border-2 border-black">APPROVE</button>
            <button data-action="reject" data-id="${escapeHtml(u.id)}"
                    class="px-2 py-1 text-xs font-bold bg-[#ff0040] text-white border-2 border-black">REJECT</button>
          </div>
        </div>
    `).join('');

    els.adminList.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const el = e.currentTarget as HTMLButtonElement;
            await setStatus(el.dataset.id!, el.dataset.action as 'approve' | 'reject');
            await openAdminPanel();
            await refreshPendingBadge();
        });
    });
}

export function closeAdminPanel(): void {
    els.adminBackdrop?.classList.add('hidden');
}

export async function refreshPendingBadge(): Promise<void> {
    const me = await (await fetch('/api/me', { credentials: 'same-origin' })).json();
    setPendingCount(me.pendingCount ?? 0);
    if (!els.adminBadge) return;
    els.adminBadge.textContent = String(pendingCount);
    els.adminBadge.classList.toggle('hidden', pendingCount === 0);
}
```

- [ ] **Step 3: Register the DOM handles**

Add `adminBackdrop`, `adminList`, `adminBadge`, `adminBtn` to `els` in `src/ts/dom.ts`, and assign them in `main.ts`'s `init()` alongside the existing handles.

- [ ] **Step 4: Show the button to the owner only**

In `main.ts`, after `/api/me` resolves, toggle `#view-admin` on `isOwner` exactly as `#trigger-scrape` is toggled today, and call `refreshPendingBadge()`.

- [ ] **Step 5: Verify by hand**

Run: `npm run dev`

Sign in as the owner, confirm the badge shows the pending count, approve an account, confirm the badge drops and that account can now sign in.

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/ts index.html
git commit -m "feat(ui): owner admin panel with pending-account badge"
```

---

## Task 14: Deployment preparation

**Files:**
- Modify: `.env.example`
- Modify: `Dockerfile`
- Delete: `.github/workflows/deploy.yml`
- Delete: `legacy/`
- Modify: `README.md`

**Interfaces:**
- Consumes: `loadConfig` (Task 2).
- Produces: a deployable image and an accurate `.env.example`.

- [ ] **Step 1: Rewrite `.env.example` with placeholders only**

The current file ships the real production webhook paths. Replace the whole file:

```dotenv
# Public origin, no trailing path. Better Auth validates against this and the
# unsafe-method Origin check is an exact string compare on it.
PUBLIC_ORIGIN=https://jobs.example.test

# At least 32 random characters. The server refuses to boot without it.
SESSION_SECRET=

# Owner bootstrap. Used once, on the first boot that finds no owner row, and
# ignored on every boot afterwards. Changing OWNER_PASSWORD later resets nothing.
OWNER_USERNAME=owner
OWNER_EMAIL=
OWNER_PASSWORD=

# Guards POST /api/receive-jobs.
WEBHOOK_SECRET=

# n8n webhook URLs. Never commit real values — these are the only thing
# authenticating those endpoints.
N8N_SCRAPE_URL=
N8N_COVER_LETTER_URL=

# Scrape budget. Per-user is fixed at 1/day; this is the shared ceiling.
SCRAPE_DAILY_LIMIT=5
RUN_EXPIRY_MINUTES=30

DATA_DIR=./data
PORT=3004
```

- [ ] **Step 2: Delete the stale deploy workflow and legacy code**

```bash
git rm .github/workflows/deploy.yml
git rm -r legacy
```

The workflow PM2-deploys to `~/projects/job-viewer` on every push to main. Coolify is the real deployment and releases are manual, so this either does nothing or resurrects a zombie process serving stale code.

- [ ] **Step 3: Verify the image builds**

```bash
docker build -t job-viewer:auth-test .
```
Expected: exit 0.

- [ ] **Step 4: Verify the config gate holds**

```bash
docker run --rm job-viewer:auth-test
```
Expected: non-zero exit with a zod error naming the missing required variables. This is the intended behavior — the app must refuse to start without `SESSION_SECRET`, `PUBLIC_ORIGIN`, `OWNER_EMAIL`, `OWNER_PASSWORD` and `WEBHOOK_SECRET`.

- [ ] **Step 5: Document the cutover in the README**

Add an "Accounts" section covering: the owner is bootstrapped once from `OWNER_*` and never reset; anyone may sign up but sits pending until the owner approves at the admin panel; email is collected and never verified; members get their own board and their own scrape budget; AI cover letters are owner-only.

Add a "Deployment" section carrying the ordered cutover from spec §10, including the `sqlite3 … ".backup"` warning about the uncheckpointed WAL.

- [ ] **Step 6: Run the whole suite and the build one final time**

Run: `npm test && npm run build`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: placeholder env example, drop stale PM2 workflow and legacy code"
```

---

## Post-Implementation: Production Cutover

Not code. Run these against the live server after the branch merges, in this order.

- [ ] Back up: `sqlite3 /home/phil/projects/job-viewer-runtime/jobviewer.db ".backup /tmp/pre-auth.db"` — **not** a `cp` of the `.db` alone; the WAL is uncheckpointed.
- [ ] Set the new Coolify environment (§9 of the spec). Remove `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `BASE_PATH`.
- [ ] Deploy. Confirm from logs: migrations 1–4 applied, owner seeded, legacy rows adopted exactly once.
- [ ] Sign in as the owner; confirm the board holds the real data.
- [ ] Rotate both n8n webhook path UUIDs and add Header Auth credentials to both webhook nodes.
- [ ] Update the n8n HTTP Request node's target to `https://jobs.philippeho.dev/api/receive-jobs` and have the scrape workflow echo `runId`.
- [ ] Fix the duplicate Apify node: the "Software Dev" node currently sends the QA node's input verbatim (`"title": "QA tester quality assurance"`), so one of the three weekly runs is a paid duplicate.
- [ ] Pin the two preview Gemini models in the cover-letter workflow to GA equivalents.
- [ ] Confirm `https://jobs.philippeho.dev/` serves the app rather than 404.
