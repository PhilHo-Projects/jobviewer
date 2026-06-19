# Owner Auth + Public Showcase Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single owner account, a demo identity for logged-out visitors, and make every n8n/PII/mutation action owner-only — while letting public visitors browse and locally play with a frozen job sample.

**Architecture:** Migrate the flat-JSON Express server to SQLite (`better-sqlite3`), refactored into small injectable modules behind a `createApp(db, opts)` factory so routes can be integration-tested over an in-memory DB. Auth is a stateless HMAC-signed HttpOnly cookie; password hashing uses Node's built-in `crypto.scrypt`. The public "interactive sandbox" is a frontend illusion: the server rejects every write from non-owners (403), and the frontend skips persistence calls when not signed in.

**Tech Stack:** Node 22, Express, TypeScript (ESM), better-sqlite3, Node built-in `crypto`, Vite + Tailwind frontend, `node:test` via `tsx` for tests.

---

## Spec reference

Design doc: `docs/superpowers/specs/2026-06-18-owner-auth-public-showcase-design.md`

## File Structure

Deviations from the spec, locked in here:
- Server modules live in a top-level **`server/`** dir (not `src/server/`) so Vite's `src/**` glob never picks them up.
- The spec's `jobs.ts` data-access file is named **`repo.ts`** because it also holds user/history/scrape-info queries.

```
server.ts                  # entry: open DB, seed, migrate, load secret, createApp().listen()
server/
  db.ts                    # openDb, schema, seedUsers, seedDemoJobs, migrateFromJson
  repo.ts                  # data access (users, jobs, history, scrape_info), all scoped by userId
  auth.ts                  # scrypt hashing, HMAC tokens (+hex guard), cookies, middleware
  app.ts                   # createApp(db, opts) -> Express app (no .listen)
  auth.test.ts             # pure-unit tests: hashing, tokens, cookies, secret
  repo.test.ts             # data-access + seeding + migration tests (:memory:)
  app.test.ts              # HTTP integration tests (:memory: + app.listen(0) + fetch)
public-sample.json         # committed frozen demo jobs (the 5 acting jobs)
shared/types.ts            # add User/Role/SessionUser types
src/ts/state.ts            # add isOwner / currentUser
src/ts/api.ts              # add fetchMe/login/logout; gate mutations when not owner
src/ts/dom.ts              # register new auth DOM elements
src/ts/main.ts             # wire sign-in/out, banner, applyAuthVisibility()
index.html                 # sign-in/out buttons, demo banner, login modal
.gitignore                 # data/, identity.json
.env.example               # document new env vars
ecosystem.config.cjs       # load data/app.env via --env-file-if-exists
```

---

## Task 1: Dependencies + test runner + tsconfig

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.server.json`
- Create: `server/sanity.test.ts`

- [ ] **Step 1: Install runtime + type dependencies**

Run:
```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```
Expected: both install with no errors; `better-sqlite3` appears under `dependencies`, `@types/better-sqlite3` under `devDependencies`.

- [ ] **Step 2: Add the test script to package.json**

In `package.json` `"scripts"`, add (Node 22 supports glob in `--test`; `tsx` strips types):
```json
"test": "node --import tsx --test \"server/**/*.test.ts\""
```

- [ ] **Step 3: Make tsconfig.server.json compile the new modules but exclude tests**

Replace the `include` block in `tsconfig.server.json` and add an `exclude`:
```json
    "include": [
        "server.ts",
        "server/**/*.ts",
        "shared/**/*.ts"
    ],
    "exclude": [
        "server/**/*.test.ts"
    ]
```

- [ ] **Step 4: Write a sanity test to prove the runner works**

Create `server/sanity.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner is wired up', () => {
    assert.equal(1 + 1, 2);
});
```

- [ ] **Step 5: Run the test**

Run: `npm test`
Expected: PASS — "test runner is wired up", 1 passing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.server.json server/sanity.test.ts
git commit -m "chore: add better-sqlite3 + node:test runner via tsx"
```

---

## Task 2: Shared auth types

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Add the role/user types**

Append to `shared/types.ts`:
```ts
export type Role = 'owner' | 'demo';

export interface SessionUser {
    id: number;
    username: string;
    role: Role;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add Role/SessionUser shared types"
```

---

## Task 3: Database schema + openDb

**Files:**
- Create: `server/db.ts`
- Create: `server/repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/repo.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';

test('openDb creates the expected tables', () => {
    const db = openDb(':memory:');
    const names = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all()
        .map((r: any) => r.name);
    assert.ok(names.includes('users'));
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('history'));
    assert.ok(names.includes('scrape_info'));
    db.close();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./db.js`.

- [ ] **Step 3: Implement db.ts schema + openDb**

Create `server/db.ts`:
```ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type Db = Database.Database;

export function initSchema(db: Db): void {
    db.exec(`
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
            title TEXT,
            company TEXT,
            location TEXT,
            url TEXT,
            status TEXT,
            statusSummary TEXT,
            statusSummaryUpdatedAt TEXT,
            appliedDate TEXT,
            scrapedDate TEXT,
            notes TEXT,
            summary TEXT,
            posted TEXT,
            PRIMARY KEY (user_id, id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS history (
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            wins TEXT,
            basePoints INTEGER,
            scoreMultiplier REAL,
            totalPoints INTEGER,
            PRIMARY KEY (user_id, date),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS scrape_info (
            user_id INTEGER PRIMARY KEY,
            lastTriggerDate TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);
}

export function openDb(dbPath: string): Db {
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    return db;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/repo.test.ts
git commit -m "feat: sqlite schema + openDb"
```

---

## Task 4: Password hashing

**Files:**
- Create: `server/auth.ts`
- Create: `server/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/auth.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './auth.js';

test('hashPassword round-trips and rejects wrong password', () => {
    const stored = hashPassword('hunter2');
    assert.match(stored, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.equal(verifyPassword('hunter2', stored), true);
    assert.equal(verifyPassword('wrong', stored), false);
});

test('verifyPassword rejects malformed stored values', () => {
    assert.equal(verifyPassword('x', ''), false);
    assert.equal(verifyPassword('x', 'not-a-hash'), false);
    assert.equal(verifyPassword('x', 'bcrypt$aa$bb'), false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./auth.js`.

- [ ] **Step 3: Implement hashing in auth.ts**

Create `server/auth.ts`:
```ts
import crypto from 'crypto';

const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): string {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
    if (!stored || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    let salt: Buffer;
    let expected: Buffer;
    try {
        salt = Buffer.from(parts[1], 'hex');
        expected = Buffer.from(parts[2], 'hex');
    } catch {
        return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = crypto.scryptSync(plain, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts server/auth.test.ts
git commit -m "feat: scrypt password hashing"
```

---

## Task 5: Session tokens (with the hex-guard bug fix)

**Files:**
- Modify: `server/auth.ts`
- Modify: `server/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/auth.test.ts`:
```ts
import { createSessionToken, verifySessionToken } from './auth.js';

const SECRET = 'test-secret';

test('session token round-trips', () => {
    const token = createSessionToken(7, SECRET, 60_000);
    const result = verifySessionToken(token, SECRET);
    assert.deepEqual(result, { userId: 7 });
});

test('session token rejects wrong secret', () => {
    const token = createSessionToken(7, SECRET, 60_000);
    assert.equal(verifySessionToken(token, 'other-secret'), null);
});

test('session token rejects expired token', () => {
    const token = createSessionToken(7, SECRET, -1);
    assert.equal(verifySessionToken(token, SECRET), null);
});

test('session token rejects tampered junk suffix (hex guard)', () => {
    const token = createSessionToken(7, SECRET, 60_000);
    // The classic bug: Buffer.from(hex) silently drops a trailing junk char,
    // so "<token>x" must be rejected by the /^[0-9a-f]{64}$/ guard.
    assert.equal(verifySessionToken(token + 'x', SECRET), null);
});

test('session token rejects structurally broken tokens', () => {
    assert.equal(verifySessionToken('', SECRET), null);
    assert.equal(verifySessionToken('a.b', SECRET), null);
    assert.equal(verifySessionToken('a.b.c.d', SECRET), null);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `createSessionToken` / `verifySessionToken` not exported.

- [ ] **Step 3: Implement tokens in auth.ts**

Append to `server/auth.ts`:
```ts
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSessionToken(userId: number, secret: string, ttlMs: number = SESSION_TTL_MS): string {
    const expiry = Date.now() + ttlMs;
    const uidB64 = Buffer.from(String(userId)).toString('base64url');
    const payload = `${uidB64}.${expiry}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): { userId: number } | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [uidB64, expiryStr, sig] = parts;

    // BUG FIX carried over from the manga app: reject anything that is not exactly
    // 64 lowercase hex chars BEFORE Buffer.from(hex), which would otherwise silently
    // truncate a trailing junk char and let a tampered token pass.
    if (!/^[0-9a-f]{64}$/.test(sig)) return null;

    const payload = `${uidB64}.${expiryStr}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

    const userId = Number(Buffer.from(uidB64, 'base64url').toString('utf8'));
    if (!Number.isInteger(userId)) return null;
    return { userId };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS (all auth token tests green).

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts server/auth.test.ts
git commit -m "feat: HMAC session tokens with hex-guard"
```

---

## Task 6: Secret loading + cookie helpers

**Files:**
- Modify: `server/auth.ts`
- Modify: `server/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/auth.test.ts`:
```ts
import { loadOrCreateSecret, parseCookies, buildSessionCookie, buildClearCookie, COOKIE_NAME } from './auth.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('loadOrCreateSecret prefers env var', () => {
    const prev = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'env-secret';
    try {
        assert.equal(loadOrCreateSecret(os.tmpdir()), 'env-secret');
    } finally {
        if (prev === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = prev;
    }
});

test('loadOrCreateSecret generates once and persists', () => {
    const prev = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-secret-'));
    try {
        const a = loadOrCreateSecret(dir);
        const b = loadOrCreateSecret(dir);
        assert.equal(a, b);
        assert.ok(a.length >= 32);
        assert.ok(fs.existsSync(path.join(dir, 'session.secret')));
    } finally {
        if (prev !== undefined) process.env.SESSION_SECRET = prev;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('parseCookies splits the header', () => {
    const cookies = parseCookies(`${COOKIE_NAME}=abc; other=def`);
    assert.equal(cookies[COOKIE_NAME], 'abc');
    assert.equal(cookies.other, 'def');
    assert.deepEqual(parseCookies(undefined), {});
});

test('buildSessionCookie sets the security flags', () => {
    const cookie = buildSessionCookie('tok', '/job-viewer');
    assert.match(cookie, new RegExp(`^${COOKIE_NAME}=tok;`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/job-viewer/);
    assert.match(cookie, /Max-Age=2592000/);
});

test('buildClearCookie expires the cookie', () => {
    assert.match(buildClearCookie('/job-viewer'), /Max-Age=0/);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `loadOrCreateSecret`/cookie helpers not exported.

- [ ] **Step 3: Implement secret + cookie helpers in auth.ts**

Add imports at the top of `server/auth.ts` (next to `import crypto`):
```ts
import fs from 'fs';
import path from 'path';
```

Append to `server/auth.ts`:
```ts
export const COOKIE_NAME = 'jv_session';

export function loadOrCreateSecret(dataDir: string): string {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const secretPath = path.join(dataDir, 'session.secret');
    if (fs.existsSync(secretPath)) {
        const existing = fs.readFileSync(secretPath, 'utf8').trim();
        if (existing) return existing;
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretPath, secret, 'utf8');
    return secret;
}

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

function cookieFlags(basePath: string): string {
    const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    return ` HttpOnly; SameSite=Lax;${secure} Path=${basePath}`;
}

export function buildSessionCookie(token: string, basePath: string): string {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `${COOKIE_NAME}=${token};${cookieFlags(basePath)}; Max-Age=${maxAge}`;
}

export function buildClearCookie(basePath: string): string {
    return `${COOKIE_NAME}=;${cookieFlags(basePath)}; Max-Age=0`;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts server/auth.test.ts
git commit -m "feat: session secret loading + cookie helpers"
```

---

## Task 7: User queries + seeding

**Files:**
- Create: `server/repo.ts` (users section)
- Modify: `server/db.ts` (seedUsers)
- Modify: `server/repo.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/repo.test.ts`:
```ts
import { seedUsers } from './db.js';
import { getUserById, getDemoUser, getOwnerUser, getUserByUsername } from './repo.js';
import { verifyPassword } from './auth.js';

test('seedUsers creates owner and demo with defaults', () => {
    const db = openDb(':memory:');
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    const owner = getOwnerUser(db)!;
    const demo = getDemoUser(db)!;
    assert.equal(owner.role, 'owner');
    assert.equal(owner.username, 'me');
    assert.equal(demo.role, 'demo');
    const ownerLogin = getUserByUsername(db, 'me')!;
    assert.equal(verifyPassword('0000', ownerLogin.password_hash!), true);
    db.close();
});

test('seedUsers is idempotent and non-destructive', () => {
    const db = openDb(':memory:');
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    // simulate the owner having changed their password since first seed
    const owner = getOwnerUser(db)!;
    db.prepare(`UPDATE users SET password_hash=? WHERE id=?`)
        .run('scrypt$dead$beef', owner.id);
    // re-seed (e.g. a redeploy) must NOT clobber the existing password
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    const after = getUserByUsername(db, 'me')!;
    assert.equal(after.password_hash, 'scrypt$dead$beef');
    // still exactly one owner and one demo
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM users WHERE role='owner'`).get().c, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM users WHERE role='demo'`).get().c, 1);
    db.close();
});

test('seedUsers updates username only while still the default placeholder', () => {
    const db = openDb(':memory:');
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    seedUsers(db, { adminUsername: 'phil', adminPassword: '0000' });
    assert.ok(getUserByUsername(db, 'phil'));
    // a later attempt to rename again must be ignored (no longer placeholder)
    seedUsers(db, { adminUsername: 'someone-else', adminPassword: '0000' });
    assert.equal(getUserByUsername(db, 'someone-else'), null);
    assert.ok(getUserByUsername(db, 'phil'));
    db.close();
});

test('getUserById returns null for unknown id', () => {
    const db = openDb(':memory:');
    assert.equal(getUserById(db, 999), null);
    db.close();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `seedUsers` / repo user functions missing.

- [ ] **Step 3: Implement repo.ts user queries**

Create `server/repo.ts`:
```ts
import type { Db } from './db.js';
import type { SessionUser } from '../shared/types.js';

interface UserRow {
    id: number;
    username: string;
    role: 'owner' | 'demo';
    password_hash: string | null;
}

export function getUserById(db: Db, id: number): SessionUser | null {
    const row = db.prepare(`SELECT id, username, role FROM users WHERE id=?`).get(id) as
        | SessionUser
        | undefined;
    return row ?? null;
}

export function getDemoUser(db: Db): SessionUser | null {
    const row = db.prepare(`SELECT id, username, role FROM users WHERE role='demo'`).get() as
        | SessionUser
        | undefined;
    return row ?? null;
}

export function getOwnerUser(db: Db): SessionUser | null {
    const row = db.prepare(`SELECT id, username, role FROM users WHERE role='owner'`).get() as
        | SessionUser
        | undefined;
    return row ?? null;
}

export function getUserByUsername(db: Db, username: string): UserRow | null {
    const row = db
        .prepare(`SELECT id, username, role, password_hash FROM users WHERE username=?`)
        .get(username) as UserRow | undefined;
    return row ?? null;
}
```

- [ ] **Step 4: Implement seedUsers in db.ts**

Add to the imports at the top of `server/db.ts`:
```ts
import { hashPassword } from './auth.js';
```

Append to `server/db.ts`:
```ts
export interface SeedOptions {
    adminUsername?: string;
    adminPassword?: string;
}

const DEFAULT_USERNAME = 'me';
const DEFAULT_PASSWORD = '0000';

export function seedUsers(db: Db, opts: SeedOptions = {}): void {
    const adminUsername = opts.adminUsername || process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
    const adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
    const now = new Date().toISOString();

    const owner = db.prepare(`SELECT * FROM users WHERE role='owner'`).get() as
        | { id: number; username: string; password_hash: string | null }
        | undefined;

    if (!owner) {
        db.prepare(
            `INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'owner', ?)`
        ).run(adminUsername, hashPassword(adminPassword), now);
    } else {
        // username: only change while still the default placeholder
        if (owner.username === DEFAULT_USERNAME && adminUsername !== DEFAULT_USERNAME) {
            db.prepare(`UPDATE users SET username=? WHERE id=?`).run(adminUsername, owner.id);
        }
        // password: only set if none exists yet (never clobber)
        if (!owner.password_hash) {
            db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(
                hashPassword(adminPassword),
                owner.id
            );
        }
        // role: always re-assert
        db.prepare(`UPDATE users SET role='owner' WHERE id=?`).run(owner.id);
    }

    const demo = db.prepare(`SELECT id FROM users WHERE role='demo'`).get();
    if (!demo) {
        db.prepare(
            `INSERT INTO users (username, password_hash, role, created_at) VALUES ('demo', NULL, 'demo', ?)`
        ).run(now);
    }
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `npm test`
Expected: PASS (seeding tests green).

- [ ] **Step 6: Commit**

```bash
git add server/repo.ts server/db.ts server/repo.test.ts
git commit -m "feat: user queries + idempotent owner/demo seeding"
```

---

## Task 8: Job data access scoped by user

**Files:**
- Modify: `server/repo.ts`
- Modify: `server/repo.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/repo.test.ts`:
```ts
import { upsertJobs, getJobs, getJobById, patchJob, bulkMove, deleteByStatus } from './repo.js';

function seededDb() {
    const db = openDb(':memory:');
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    return db;
}

test('upsertJobs assigns a stable id and getJobs is scoped per user', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    const demo = getDemoUser(db)!;

    upsertJobs(db, owner.id, [{ title: 'Owner Job', company: 'Acme' }]);
    upsertJobs(db, demo.id, [{ title: 'Demo Job', company: 'Globex' }]);

    const ownerJobs = getJobs(db, owner.id);
    const demoJobs = getJobs(db, demo.id);
    assert.equal(ownerJobs.length, 1);
    assert.equal(demoJobs.length, 1);
    assert.equal(ownerJobs[0].title, 'Owner Job');
    assert.equal(demoJobs[0].title, 'Demo Job');
    assert.ok(ownerJobs[0].id); // stable id generated
    db.close();
});

test('upsertJobs merges existing rows without clobbering status/notes', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    const [created] = upsertJobs(db, owner.id, [{ id: 'j1', title: 'T', company: 'C', status: 'in_progress', notes: 'mine' }]);
    assert.equal(created.status, 'in_progress');
    // an incoming scrape of the same id (default status) must not reset progress/notes
    upsertJobs(db, owner.id, [{ id: 'j1', title: 'T2', company: 'C', status: 'new', notes: '' }]);
    const after = getJobById(db, owner.id, 'j1')!;
    assert.equal(after.status, 'in_progress');
    assert.equal(after.notes, 'mine');
    assert.equal(after.title, 'T2'); // non-protected field still updates
    db.close();
});

test('patchJob updates only the given fields and is user-scoped', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    const demo = getDemoUser(db)!;
    upsertJobs(db, owner.id, [{ id: 'j1', title: 'T', company: 'C', status: 'new' }]);

    const updated = patchJob(db, owner.id, 'j1', { status: 'completed', statusSummary: 'Rejected' });
    assert.equal(updated!.status, 'completed');
    assert.equal(updated!.statusSummary, 'Rejected');

    // demo cannot see or patch the owner's job
    assert.equal(getJobById(db, demo.id, 'j1'), null);
    assert.equal(patchJob(db, demo.id, 'j1', { status: 'new' }), null);
    db.close();
});

test('bulkMove and deleteByStatus are user-scoped', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    upsertJobs(db, owner.id, [
        { id: 'a', title: 'A', company: 'C', status: 'new' },
        { id: 'b', title: 'B', company: 'C', status: 'new' },
        { id: 'c', title: 'C', company: 'C', status: 'deleted' },
    ]);
    assert.equal(bulkMove(db, owner.id, 'new', 'deleted'), 2);
    assert.equal(deleteByStatus(db, owner.id, 'deleted'), 3);
    assert.equal(getJobs(db, owner.id).length, 0);
    db.close();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — job functions not exported.

- [ ] **Step 3: Implement job data access in repo.ts**

Add to the top imports of `server/repo.ts`:
```ts
import crypto from 'crypto';
import type { Job } from '../shared/types.js';
```

Append to `server/repo.ts`:
```ts
const JOB_COLUMNS = [
    'id', 'title', 'company', 'location', 'url', 'status', 'statusSummary',
    'statusSummaryUpdatedAt', 'appliedDate', 'scrapedDate', 'notes', 'summary', 'posted',
] as const;

function createStableJobId(job: Partial<Job>): string {
    const basis = [job.url, job.title, job.company, job.location, job.posted]
        .filter(Boolean)
        .join('|');
    return crypto.createHash('sha1').update(basis || JSON.stringify(job)).digest('hex');
}

function normalizeIncomingJob(job: Partial<Job>): Job {
    const nowIso = new Date().toISOString();
    return {
        ...job,
        id: job.id || createStableJobId(job),
        title: job.title || '',
        company: job.company || '',
        status: job.status || 'new',
        statusSummary: job.statusSummary || 'New Job',
        statusSummaryUpdatedAt: job.statusSummaryUpdatedAt || nowIso,
        notes: typeof job.notes === 'string' ? job.notes : '',
        scrapedDate: job.scrapedDate || nowIso,
        appliedDate: job.appliedDate ?? null,
    };
}

function mergeJob(existing: Job, incoming: Job): Job {
    return {
        ...existing,
        ...incoming,
        status: existing.status || incoming.status || 'new',
        statusSummary: existing.statusSummary || incoming.statusSummary || 'New Job',
        notes: typeof existing.notes === 'string' && existing.notes !== ''
            ? existing.notes
            : (typeof incoming.notes === 'string' ? incoming.notes : ''),
        scrapedDate: existing.scrapedDate || incoming.scrapedDate,
        appliedDate: existing.appliedDate || incoming.appliedDate || null,
    };
}

function toRow(userId: number, job: Job): Record<string, unknown> {
    const row: Record<string, unknown> = { user_id: userId };
    for (const col of JOB_COLUMNS) {
        row[col] = (job as any)[col] ?? null;
    }
    return row;
}

function rowToJob(row: any): Job {
    const job: any = {};
    for (const col of JOB_COLUMNS) job[col] = row[col];
    return job as Job;
}

export function getJobs(db: Db, userId: number): Job[] {
    const rows = db.prepare(`SELECT * FROM jobs WHERE user_id=?`).all(userId);
    return rows.map(rowToJob);
}

export function getJobById(db: Db, userId: number, id: string): Job | null {
    const row = db.prepare(`SELECT * FROM jobs WHERE user_id=? AND id=?`).get(userId, id);
    return row ? rowToJob(row) : null;
}

export function upsertJobs(db: Db, userId: number, incoming: Partial<Job>[]): Job[] {
    const cols = JOB_COLUMNS.map((c) => c).join(', ');
    const placeholders = JOB_COLUMNS.map((c) => `@${c}`).join(', ');
    const insert = db.prepare(
        `INSERT INTO jobs (user_id, ${cols}) VALUES (@user_id, ${placeholders})`
    );
    const update = db.prepare(
        `UPDATE jobs SET ${JOB_COLUMNS.filter((c) => c !== 'id')
            .map((c) => `${c}=@${c}`)
            .join(', ')} WHERE user_id=@user_id AND id=@id`
    );
    const tx = db.transaction((rows: Partial<Job>[]) => {
        for (const raw of rows) {
            const j = normalizeIncomingJob(raw);
            const existing = getJobById(db, userId, j.id);
            const final = existing ? mergeJob(existing, j) : j;
            if (existing) update.run(toRow(userId, final));
            else insert.run(toRow(userId, final));
        }
    });
    tx(incoming);
    return getJobs(db, userId);
}

export function patchJob(
    db: Db,
    userId: number,
    id: string,
    patch: Partial<Job>
): Job | null {
    const existing = getJobById(db, userId, id);
    if (!existing) return null;
    const next: Job = { ...existing };
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.statusSummary !== undefined) {
        next.statusSummary = patch.statusSummary;
        next.statusSummaryUpdatedAt = new Date().toISOString();
    }
    if (patch.notes !== undefined) next.notes = patch.notes;
    if (patch.appliedDate !== undefined) next.appliedDate = patch.appliedDate;
    db.prepare(
        `UPDATE jobs SET ${JOB_COLUMNS.filter((c) => c !== 'id')
            .map((c) => `${c}=@${c}`)
            .join(', ')} WHERE user_id=@user_id AND id=@id`
    ).run(toRow(userId, next));
    return next;
}

export function bulkMove(db: Db, userId: number, from: string, to: string): number {
    const info = db
        .prepare(`UPDATE jobs SET status=? WHERE user_id=? AND status=?`)
        .run(to, userId, from);
    return info.changes;
}

export function deleteByStatus(db: Db, userId: number, status: string): number {
    const info = db
        .prepare(`DELETE FROM jobs WHERE user_id=? AND status=?`)
        .run(userId, status);
    return info.changes;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS (all job data-access tests green, including two-user isolation).

- [ ] **Step 5: Commit**

```bash
git add server/repo.ts server/repo.test.ts
git commit -m "feat: user-scoped job data access"
```

---

## Task 9: History + scrape_info data access

**Files:**
- Modify: `server/repo.ts`
- Modify: `server/repo.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/repo.test.ts`:
```ts
import { getHistory, getScrapeInfo, setScrapeInfo, insertHistory } from './repo.js';

test('history is user-scoped', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    const demo = getDemoUser(db)!;
    insertHistory(db, owner.id, {
        date: '2026-06-01', wins: [{ title: 'A', company: 'C' }],
        basePoints: 5, scoreMultiplier: 1, totalPoints: 5,
    });
    assert.equal(getHistory(db, owner.id).length, 1);
    assert.equal(getHistory(db, owner.id)[0].wins[0].title, 'A');
    assert.equal(getHistory(db, demo.id).length, 0);
    db.close();
});

test('scrape_info round-trips per user', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    assert.deepEqual(getScrapeInfo(db, owner.id), { lastTriggerDate: null });
    setScrapeInfo(db, owner.id, '2026-06-18');
    assert.deepEqual(getScrapeInfo(db, owner.id), { lastTriggerDate: '2026-06-18' });
    db.close();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — history/scrape functions missing.

- [ ] **Step 3: Implement history + scrape_info in repo.ts**

Add to the top imports of `server/repo.ts`:
```ts
import type { HistoryEntry } from '../shared/types.js';
```

Append to `server/repo.ts`:
```ts
export function getHistory(db: Db, userId: number): HistoryEntry[] {
    const rows = db
        .prepare(`SELECT date, wins, basePoints, scoreMultiplier, totalPoints FROM history WHERE user_id=? ORDER BY date DESC`)
        .all(userId) as any[];
    return rows.map((r) => ({
        date: r.date,
        wins: r.wins ? JSON.parse(r.wins) : [],
        basePoints: r.basePoints,
        scoreMultiplier: r.scoreMultiplier,
        totalPoints: r.totalPoints,
    }));
}

export function insertHistory(db: Db, userId: number, entry: HistoryEntry): void {
    db.prepare(
        `INSERT OR REPLACE INTO history (user_id, date, wins, basePoints, scoreMultiplier, totalPoints)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
        userId,
        entry.date,
        JSON.stringify(entry.wins ?? []),
        entry.basePoints,
        entry.scoreMultiplier,
        entry.totalPoints
    );
}

export function getScrapeInfo(db: Db, userId: number): { lastTriggerDate: string | null } {
    const row = db
        .prepare(`SELECT lastTriggerDate FROM scrape_info WHERE user_id=?`)
        .get(userId) as { lastTriggerDate: string | null } | undefined;
    return { lastTriggerDate: row ? row.lastTriggerDate : null };
}

export function setScrapeInfo(db: Db, userId: number, lastTriggerDate: string): void {
    db.prepare(
        `INSERT INTO scrape_info (user_id, lastTriggerDate) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET lastTriggerDate=excluded.lastTriggerDate`
    ).run(userId, lastTriggerDate);
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/repo.ts server/repo.test.ts
git commit -m "feat: user-scoped history + scrape_info access"
```

---

## Task 10: JSON → SQLite migration

**Files:**
- Modify: `server/db.ts`
- Modify: `server/repo.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/repo.test.ts`:
```ts
import { migrateFromJson } from './db.js';
import { getJobs as repoGetJobs } from './repo.js';

test('migrateFromJson imports legacy json into the owner once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-migrate-'));
    fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify([
        { id: 'm1', title: 'Migrated', company: 'Old', status: 'in_progress' },
    ]));
    fs.writeFileSync(path.join(dir, 'history.json'), JSON.stringify([
        { date: '2026-05-01', wins: [], basePoints: 1, scoreMultiplier: 1, totalPoints: 1 },
    ]));
    fs.writeFileSync(path.join(dir, 'scrape_info.json'), JSON.stringify({ lastTriggerDate: '2026-05-02' }));
    try {
        const db = openDb(':memory:');
        seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
        const owner = getOwnerUser(db)!;

        migrateFromJson(db, owner.id, dir);
        assert.equal(repoGetJobs(db, owner.id).length, 1);
        assert.equal(getHistory(db, owner.id).length, 1);
        assert.equal(getScrapeInfo(db, owner.id).lastTriggerDate, '2026-05-02');

        // second run must NOT duplicate (owner already has jobs)
        migrateFromJson(db, owner.id, dir);
        assert.equal(repoGetJobs(db, owner.id).length, 1);
        db.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `migrateFromJson` missing.

- [ ] **Step 3: Implement migrateFromJson in db.ts**

Add to the imports at the top of `server/db.ts`:
```ts
import { upsertJobs, insertHistory, setScrapeInfo, getJobs } from './repo.js';
import type { Job, HistoryEntry } from '../shared/types.js';
```

Append to `server/db.ts`:
```ts
function readJsonFile<T>(filePath: string, fallback: T): T {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/** One-time, idempotent import of the legacy flat-JSON files into the owner's rows. */
export function migrateFromJson(db: Db, ownerId: number, cwd: string): void {
    if (getJobs(db, ownerId).length > 0) return; // already migrated / has data

    const jobs = readJsonFile<Job[]>(path.join(cwd, 'jobs.json'), []);
    if (Array.isArray(jobs) && jobs.length > 0) {
        upsertJobs(db, ownerId, jobs);
    }

    const history = readJsonFile<HistoryEntry[]>(path.join(cwd, 'history.json'), []);
    if (Array.isArray(history)) {
        for (const entry of history) insertHistory(db, ownerId, entry);
    }

    const scrape = readJsonFile<{ lastTriggerDate: string | null }>(
        path.join(cwd, 'scrape_info.json'),
        { lastTriggerDate: null }
    );
    if (scrape && scrape.lastTriggerDate) setScrapeInfo(db, ownerId, scrape.lastTriggerDate);
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/repo.test.ts
git commit -m "feat: one-time JSON->SQLite migration for the owner"
```

---

## Task 11: Middleware + app factory + /me + login/logout

**Files:**
- Modify: `server/auth.ts` (middleware + webhook guard)
- Create: `server/app.ts`
- Create: `server/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/app.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { openDb } from './db.js';
import { seedUsers } from './db.js';
import { createApp } from './app.js';

async function startApp() {
    const db = openDb(':memory:');
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    const app = createApp(db, { secret: 'test-secret', dataDir: '.' });
    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/job-viewer/api`;
    return { db, server, base, close: () => { server.close(); db.close(); } };
}

function cookieFrom(res: Response): string {
    const raw = res.headers.get('set-cookie') || '';
    return raw.split(';')[0]; // "jv_session=...."
}

test('GET /me is demo when anonymous', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/me`);
        const body = await res.json();
        assert.equal(body.authenticated, false);
        assert.equal(body.isDemo, true);
    } finally { ctx.close(); }
});

test('login succeeds and /me reflects the owner', async () => {
    const ctx = await startApp();
    try {
        const login = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'me', password: '0000' }),
        });
        assert.equal(login.status, 200);
        const cookie = cookieFrom(login);
        assert.match(cookie, /^jv_session=/);

        const me = await fetch(`${ctx.base}/me`, { headers: { Cookie: cookie } });
        const body = await me.json();
        assert.equal(body.authenticated, true);
        assert.equal(body.role, 'owner');
        assert.equal(body.username, 'me');
    } finally { ctx.close(); }
});

test('login fails with a generic 401 on wrong password', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'me', password: 'nope' }),
        });
        assert.equal(res.status, 401);
        const body = await res.json();
        assert.equal(body.error, 'Invalid credentials');
    } finally { ctx.close(); }
});

test('login rejects the demo role', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'demo', password: '' }),
        });
        assert.equal(res.status, 401);
    } finally { ctx.close(); }
});

test('logout clears the cookie', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/logout`, { method: 'POST' });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('set-cookie') || '', /Max-Age=0/);
    } finally { ctx.close(); }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./app.js`.

- [ ] **Step 3: Implement middleware in auth.ts**

Add to the top imports of `server/auth.ts`:
```ts
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.js';
import type { SessionUser } from '../shared/types.js';
import { getUserById, getDemoUser } from './repo.js';
```

Append to `server/auth.ts`:
```ts
export interface AuthedRequest extends Request {
    user?: SessionUser | null;
    userId?: number | null;
}

export function attachUser(db: Db, secret: string) {
    return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
        let user: SessionUser | null = null;
        const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
        if (token) {
            const verified = verifySessionToken(token, secret);
            if (verified) {
                const u = getUserById(db, verified.userId);
                if (u && u.role === 'owner') user = u;
            }
        }
        if (!user) user = getDemoUser(db);
        req.user = user;
        req.userId = user ? user.id : null;
        next();
    };
}

export function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
    if (!req.user || req.user.role !== 'owner') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    next();
}

export function requireWebhookSecret(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.WEBHOOK_SECRET;
    const provided = req.headers['x-webhook-secret'];
    if (!expected || typeof provided !== 'string') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    next();
}
```

- [ ] **Step 4: Implement app.ts with the factory + auth routes**

Create `server/app.ts`:
```ts
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import type { Db } from './db.js';
import {
    attachUser,
    createSessionToken,
    verifyPassword,
    buildSessionCookie,
    buildClearCookie,
    type AuthedRequest,
} from './auth.js';
import { getUserByUsername } from './repo.js';

export interface AppOptions {
    secret: string;
    dataDir: string;
}

const BASE_PATH = '/job-viewer';

export function createApp(db: Db, opts: AppOptions): Express {
    const app = express();
    app.use(express.json({ limit: '50mb' }));

    app.use((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
        if (_req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });

    // Static frontend (production build) + SPA fallback.
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
        app.use(BASE_PATH, express.static(distPath));
        app.get(`${BASE_PATH}/*`, (req: Request, res: Response, next: NextFunction) => {
            if (req.path.startsWith(`${BASE_PATH}/api`)) return next();
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.use(attachUser(db, opts.secret));

    // --- Auth routes ---
    app.get(`${BASE_PATH}/api/me`, (req: AuthedRequest, res: Response) => {
        const user = req.user;
        res.json({
            authenticated: user?.role === 'owner',
            username: user?.username ?? null,
            role: user?.role ?? null,
            isDemo: user?.role === 'demo',
        });
    });

    app.post(`${BASE_PATH}/api/login`, (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = getUserByUsername(db, username);
        if (!user || user.role === 'demo' || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = createSessionToken(user.id, opts.secret);
        res.setHeader('Set-Cookie', buildSessionCookie(token, BASE_PATH));
        res.json({ username: user.username, role: user.role });
    });

    app.post(`${BASE_PATH}/api/logout`, (_req: Request, res: Response) => {
        res.setHeader('Set-Cookie', buildClearCookie(BASE_PATH));
        res.json({ ok: true });
    });

    return app;
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `npm test`
Expected: PASS (all /me + login/logout tests green).

- [ ] **Step 6: Commit**

```bash
git add server/auth.ts server/app.ts server/app.test.ts
git commit -m "feat: app factory + attachUser + /me + login/logout"
```

---

## Task 12: Scoped read routes

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/app.test.ts`:
```ts
import { getOwnerUser, getDemoUser, upsertJobs } from './repo.js';

test('GET /jobs returns demo jobs for anon and owner jobs for owner', async () => {
    const ctx = await startApp();
    try {
        const owner = getOwnerUser(ctx.db)!;
        const demo = getDemoUser(ctx.db)!;
        upsertJobs(ctx.db, owner.id, [{ id: 'o1', title: 'Owner Secret', company: 'Real' }]);
        upsertJobs(ctx.db, demo.id, [{ id: 'd1', title: 'Demo Sample', company: 'Fake' }]);

        const anon = await (await fetch(`${ctx.base}/jobs`)).json();
        assert.equal(anon.length, 1);
        assert.equal(anon[0].title, 'Demo Sample');

        const login = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'me', password: '0000' }),
        });
        const cookie = cookieFrom(login);
        const mine = await (await fetch(`${ctx.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.equal(mine.length, 1);
        assert.equal(mine[0].title, 'Owner Secret');
    } finally { ctx.close(); }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `GET /jobs` 404 (route not defined).

- [ ] **Step 3: Implement read routes in app.ts**

Add to the imports in `server/app.ts`:
```ts
import { getJobs, getHistory, getScrapeInfo } from './repo.js';
```

Insert these routes in `createApp` after the `/logout` route, before `return app;`:
```ts
    // --- Scoped read routes (owner sees real data, anon sees demo) ---
    app.get(`${BASE_PATH}/api/jobs`, (req: AuthedRequest, res: Response) => {
        res.json(getJobs(db, req.userId!));
    });

    app.get(`${BASE_PATH}/api/history`, (req: AuthedRequest, res: Response) => {
        res.json(getHistory(db, req.userId!));
    });

    app.get(`${BASE_PATH}/api/scrape-info`, (req: AuthedRequest, res: Response) => {
        res.json(getScrapeInfo(db, req.userId!));
    });
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/app.test.ts
git commit -m "feat: scoped read routes for jobs/history/scrape-info"
```

---

## Task 13: Owner-only write routes

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/app.test.ts`:
```ts
async function ownerCookie(ctx: Awaited<ReturnType<typeof startApp>>): Promise<string> {
    const login = await fetch(`${ctx.base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'me', password: '0000' }),
    });
    return cookieFrom(login);
}

test('write routes are 403 for anon and work for owner', async () => {
    const ctx = await startApp();
    try {
        // anonymous create -> 403
        const anonCreate = await fetch(`${ctx.base}/jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'X', company: 'Y' }),
        });
        assert.equal(anonCreate.status, 403);

        const cookie = await ownerCookie(ctx);
        const create = await fetch(`${ctx.base}/jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ title: 'X', company: 'Y' }),
        });
        assert.equal(create.status, 201);
        const saved = await create.json();
        assert.ok(saved.id);

        const patch = await fetch(`${ctx.base}/jobs/${saved.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ status: 'completed' }),
        });
        assert.equal(patch.status, 200);
        assert.equal((await patch.json()).status, 'completed');

        // anon PATCH -> 403
        const anonPatch = await fetch(`${ctx.base}/jobs/${saved.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'new' }),
        });
        assert.equal(anonPatch.status, 403);
    } finally { ctx.close(); }
});

test('receive-jobs path is registered but bulk routes need owner', async () => {
    const ctx = await startApp();
    try {
        const anonBulk = await fetch(`${ctx.base}/jobs/bulk-move`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'new', to: 'deleted' }),
        });
        assert.equal(anonBulk.status, 403);
        const anonDelete = await fetch(`${ctx.base}/jobs/status/deleted`, { method: 'DELETE' });
        assert.equal(anonDelete.status, 403);
    } finally { ctx.close(); }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — write routes 404/no requireOwner.

- [ ] **Step 3: Implement write routes in app.ts**

Add to the imports in `server/app.ts`:
```ts
import { requireOwner } from './auth.js';
import { upsertJobs, getJobById, patchJob, bulkMove, deleteByStatus } from './repo.js';
import type { Job } from '../shared/types.js';
```
(If `getJobs`/`getHistory`/`getScrapeInfo` are already imported from `./repo.js`, merge these names into that single import line — do not duplicate the import.)

Insert these routes in `createApp` after the read routes, before `return app;`:
```ts
    // --- Owner-only write routes ---
    app.post(`${BASE_PATH}/api/jobs`, requireOwner, (req: AuthedRequest, res: Response) => {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ error: 'Payload must be a job object' });
        }
        const existed = !!(payload.id && getJobById(db, req.userId!, payload.id));
        const all = upsertJobs(db, req.userId!, [payload as Partial<Job>]);
        // find the just-written row (id may have been generated)
        const saved = existed
            ? getJobById(db, req.userId!, payload.id)
            : all[all.length - 1];
        return res.status(existed ? 200 : 201).json(saved);
    });

    app.patch(`${BASE_PATH}/api/jobs/bulk-move`, requireOwner, (req: AuthedRequest, res: Response) => {
        const { from, to } = req.body || {};
        if (!from || !to) {
            return res.status(400).json({ error: 'Source (from) and target (to) statuses are required' });
        }
        const moved = bulkMove(db, req.userId!, from, to);
        res.json({ moved, from, to });
    });

    app.patch(`${BASE_PATH}/api/jobs/:id`, requireOwner, (req: AuthedRequest, res: Response) => {
        const updated = patchJob(db, req.userId!, req.params.id, req.body || {});
        if (!updated) return res.status(404).json({ message: 'Job not found' });
        res.json(updated);
    });

    app.delete(`${BASE_PATH}/api/jobs/status/:status`, requireOwner, (req: AuthedRequest, res: Response) => {
        const deleted = deleteByStatus(db, req.userId!, req.params.status);
        res.json({ deleted, remaining: getJobs(db, req.userId!).length });
    });
```

Note: `bulk-move` must be registered before `/jobs/:id` (it is, above) so `:id` doesn't capture `bulk-move`.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/app.test.ts
git commit -m "feat: owner-only job write routes"
```

---

## Task 14: Owner-only n8n routes (scrape + cover letter)

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/app.test.ts`:
```ts
import express from 'express';

async function startStub() {
    const stub = express();
    stub.use(express.json());
    stub.all('*', (_req, res) => {
        res.json({ text: 'STUB COVER LETTER' });
    });
    const server = stub.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/hook`, close: () => server.close() };
}

test('trigger-scrape is owner-only and honours the daily limit', async () => {
    const ctx = await startApp();
    const stub = await startStub();
    const prev = process.env.N8N_SCRAPE_URL;
    process.env.N8N_SCRAPE_URL = stub.url;
    try {
        const anon = await fetch(`${ctx.base}/trigger-scrape`, { method: 'POST' });
        assert.equal(anon.status, 403);

        const cookie = await ownerCookie(ctx);
        const first = await fetch(`${ctx.base}/trigger-scrape`, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(first.status, 200);
        const second = await fetch(`${ctx.base}/trigger-scrape`, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(second.status, 429);
    } finally {
        if (prev === undefined) delete process.env.N8N_SCRAPE_URL; else process.env.N8N_SCRAPE_URL = prev;
        stub.close(); ctx.close();
    }
});

test('generate-cover-letter is owner-only', async () => {
    const ctx = await startApp();
    const stub = await startStub();
    const prev = process.env.N8N_COVER_LETTER_URL;
    process.env.N8N_COVER_LETTER_URL = stub.url;
    try {
        const anon = await fetch(`${ctx.base}/generate-cover-letter`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job: { title: 'T' } }),
        });
        assert.equal(anon.status, 403);

        const cookie = await ownerCookie(ctx);
        const ok = await fetch(`${ctx.base}/generate-cover-letter`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ job: { title: 'T' } }),
        });
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).text, 'STUB COVER LETTER');
    } finally {
        if (prev === undefined) delete process.env.N8N_COVER_LETTER_URL; else process.env.N8N_COVER_LETTER_URL = prev;
        stub.close(); ctx.close();
    }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — n8n routes not defined.

- [ ] **Step 3: Implement the n8n routes in app.ts**

Add to the imports in `server/app.ts` (merge into the existing `./repo.js` import line):
```ts
import { getScrapeInfo, setScrapeInfo } from './repo.js';
```

Add this helper near the top of `server/app.ts` (after the `BASE_PATH` constant):
```ts
function loadIdentity(dataDir: string): unknown {
    const candidates = [
        process.env.IDENTITY_PATH,
        path.join(dataDir, 'identity.json'),
        path.join(process.cwd(), 'src', 'assets', 'identity.json'),
    ].filter(Boolean) as string[];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch {
            /* try next */
        }
    }
    return {};
}
```

Insert these routes in `createApp` after the write routes, before `return app;`:
```ts
    // --- Owner-only n8n integrations ---
    app.post(`${BASE_PATH}/api/trigger-scrape`, requireOwner, async (req: AuthedRequest, res: Response) => {
        const webhookUrl = process.env.N8N_SCRAPE_URL;
        if (!webhookUrl) return res.status(500).json({ error: 'N8N_SCRAPE_URL is not configured' });

        const info = getScrapeInfo(db, req.userId!);
        const today = new Date().toISOString().split('T')[0];
        if (info.lastTriggerDate === today) {
            return res.status(429).json({ error: 'Scrape already triggered today. Limit: 1 per day.' });
        }
        try {
            const response = await fetch(webhookUrl, { method: 'GET' });
            if (!response.ok) throw new Error(`n8n responded with status: ${response.status}`);
            setScrapeInfo(db, req.userId!, today);
            res.json({ message: 'Scrape triggered successfully', lastTriggerDate: today });
        } catch (err: any) {
            console.error('Failed to trigger n8n:', err);
            res.status(500).json({ error: `Failed to trigger n8n: ${err.message}` });
        }
    });

    app.post(`${BASE_PATH}/api/generate-cover-letter`, requireOwner, async (req: Request, res: Response) => {
        const webhookUrl = process.env.N8N_COVER_LETTER_URL;
        if (!webhookUrl) return res.status(500).json({ error: 'N8N_COVER_LETTER_URL is not configured' });
        try {
            const { job } = req.body || {};
            const identity = loadIdentity(opts.dataDir);
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job, identity }),
            });
            if (!response.ok) throw new Error(`n8n responded with status: ${response.status}`);

            const rawText = await response.text();
            let result: any;
            try {
                result = JSON.parse(rawText);
            } catch {
                throw new Error(`n8n returned invalid JSON. Raw: "${rawText.slice(0, 200)}"`);
            }
            const text = Array.isArray(result)
                ? (result[0]?.text ?? JSON.stringify(result[0]))
                : (result?.text ?? JSON.stringify(result));
            res.json({ text });
        } catch (err: any) {
            console.error('Failed to generate cover letter via n8n:', err);
            res.status(500).json({ error: `Failed to generate cover letter: ${err.message}` });
        }
    });
```

> This is also where the **duplicate** `generate-cover-letter` handler from the old
> `server.ts` is eliminated — there is now exactly one handler, env-driven.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/app.test.ts
git commit -m "feat: owner-only n8n scrape + cover-letter routes (env URLs, dedup)"
```

---

## Task 15: Inbound webhook route (shared secret)

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/app.test.ts`:
```ts
test('receive-jobs requires the webhook secret and writes to the owner', async () => {
    const ctx = await startApp();
    const prev = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 's3cr3t';
    try {
        const noSecret = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ title: 'Hook Job', company: 'C' }]),
        });
        assert.equal(noSecret.status, 403);

        const wrong = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'nope' },
            body: JSON.stringify([{ title: 'Hook Job', company: 'C' }]),
        });
        assert.equal(wrong.status, 403);

        const ok = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 's3cr3t' },
            body: JSON.stringify([{ title: 'Hook Job', company: 'C' }]),
        });
        assert.equal(ok.status, 201);

        // appears in the owner's jobs, NOT the demo's
        const cookie = await ownerCookie(ctx);
        const owner = await (await fetch(`${ctx.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.ok(owner.some((j: any) => j.title === 'Hook Job'));
        const anon = await (await fetch(`${ctx.base}/jobs`)).json();
        assert.ok(!anon.some((j: any) => j.title === 'Hook Job'));
    } finally {
        if (prev === undefined) delete process.env.WEBHOOK_SECRET; else process.env.WEBHOOK_SECRET = prev;
        ctx.close();
    }
});

test('receive-jobs fails closed when WEBHOOK_SECRET is unset', async () => {
    const ctx = await startApp();
    const prev = process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET;
    try {
        const res = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'anything' },
            body: JSON.stringify([{ title: 'X', company: 'C' }]),
        });
        assert.equal(res.status, 403);
    } finally {
        if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
        ctx.close();
    }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — receive-jobs route missing.

- [ ] **Step 3: Implement the route in app.ts**

Add to the imports in `server/app.ts` (merge into existing import lines):
```ts
import { requireWebhookSecret } from './auth.js';
import { getOwnerUser } from './repo.js';
```

Insert this route in `createApp` after the n8n routes, before `return app;`:
```ts
    // --- Inbound delivery from n8n (server-to-server, shared secret) ---
    app.post(`${BASE_PATH}/api/receive-jobs`, requireWebhookSecret, (req: Request, res: Response) => {
        const payload = req.body;
        if (!Array.isArray(payload)) {
            return res.status(400).json({ error: 'Payload must be an array of jobs' });
        }
        const owner = getOwnerUser(db);
        if (!owner) return res.status(500).json({ error: 'No owner configured' });
        const incoming = payload.filter(Boolean);
        const before = getJobs(db, owner.id).length;
        upsertJobs(db, owner.id, incoming);
        const after = getJobs(db, owner.id).length;
        return res.status(201).json({
            message: 'Jobs received successfully',
            received: incoming.length, before, after,
        });
    });
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS — full backend suite green.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/app.test.ts
git commit -m "feat: secret-guarded receive-jobs webhook"
```

---

## Task 16: Public sample fixture + demo job seeding

**Files:**
- Create: `public-sample.json`
- Modify: `server/db.ts`
- Modify: `server/repo.test.ts`

- [ ] **Step 1: Create the committed sample fixture**

Create `public-sample.json` (the frozen acting jobs, with `appliedDate` nulled so it's clearly demo data):
```json
[
  {
    "id": "demo-acting-1",
    "url": "https://hollywood.example/lead-role-space-ninja",
    "title": "Lead Role: Space Ninja",
    "company": "Paramount-ish Pictures",
    "location": "Mars Colony (Set A)",
    "posted": "Just now",
    "status": "new",
    "statusSummary": "New Job",
    "notes": "Sample data for the public demo. Sign in to see real searches.",
    "scrapedDate": "2026-06-01T11:53:00.000Z",
    "appliedDate": null
  },
  {
    "id": "demo-acting-2",
    "url": "https://hollywood.example/background-extra-zombie",
    "title": "Background Extra: Zombie #402",
    "company": "Undead Productions",
    "location": "Atlanta, GA",
    "posted": "2 hours ago",
    "status": "in_progress",
    "statusSummary": "Easy Applied",
    "notes": "Sample data for the public demo.",
    "scrapedDate": "2026-06-01T14:30:00.000Z",
    "appliedDate": null
  },
  {
    "id": "demo-acting-3",
    "url": "https://hollywood.example/stunt-double-detective",
    "title": "Stunt Double: Grumpy Detective",
    "company": "Noir Films LLC",
    "location": "Detroit, MI",
    "posted": "1 day ago",
    "status": "completed",
    "statusSummary": "Rejected",
    "notes": "Sample data for the public demo.",
    "scrapedDate": "2026-05-30T10:00:00.000Z",
    "appliedDate": null
  },
  {
    "id": "demo-acting-4",
    "url": "https://hollywood.example/lead-vampire-musical",
    "title": "Lead Vampire (Tenor)",
    "company": "Broadway on Blood",
    "location": "New York, NY",
    "posted": "5 minutes ago",
    "status": "new",
    "statusSummary": "New Job",
    "notes": "Sample data for the public demo.",
    "scrapedDate": "2026-06-01T11:45:00.000Z",
    "appliedDate": null
  }
]
```

- [ ] **Step 2: Write the failing test**

Append to `server/repo.test.ts`:
```ts
import { seedDemoJobs } from './db.js';

test('seedDemoJobs loads the fixture once for the demo user', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-sample-'));
    const samplePath = path.join(dir, 'public-sample.json');
    fs.writeFileSync(samplePath, JSON.stringify([
        { id: 's1', title: 'Sample', company: 'Demo', status: 'new' },
    ]));
    try {
        const db = openDb(':memory:');
        seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
        const demo = getDemoUser(db)!;
        seedDemoJobs(db, samplePath);
        assert.equal(repoGetJobs(db, demo.id).length, 1);
        // idempotent: re-running does not duplicate
        seedDemoJobs(db, samplePath);
        assert.equal(repoGetJobs(db, demo.id).length, 1);
        db.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `seedDemoJobs` missing.

- [ ] **Step 4: Implement seedDemoJobs in db.ts**

Add to the imports at the top of `server/db.ts` (merge with the existing `./repo.js` import):
```ts
import { getDemoUser } from './repo.js';
```

Append to `server/db.ts`:
```ts
/** Seed the demo user's frozen sample jobs from public-sample.json (idempotent). */
export function seedDemoJobs(db: Db, samplePath: string): void {
    const demo = getDemoUser(db);
    if (!demo) return;
    if (getJobs(db, demo.id).length > 0) return; // already seeded
    const sample = readJsonFile<Job[]>(samplePath, []);
    if (Array.isArray(sample) && sample.length > 0) {
        upsertJobs(db, demo.id, sample);
    }
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public-sample.json server/db.ts server/repo.test.ts
git commit -m "feat: frozen public sample + demo job seeding"
```

---

## Task 17: Rewrite server.ts entry point

**Files:**
- Rewrite: `server.ts`

- [ ] **Step 1: Replace server.ts with the new entry**

Replace the entire contents of `server.ts` with:
```ts
import path from 'path';
import { openDb, seedUsers, seedDemoJobs, migrateFromJson } from './server/db.js';
import { loadOrCreateSecret } from './server/auth.js';
import { getOwnerUser } from './server/repo.js';
import { createApp } from './server/app.js';

const PORT = Number(process.env.PORT) || 3004;
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'jobviewer.db');
const SAMPLE_PATH = path.join(process.cwd(), 'public-sample.json');

const db = openDb(DB_PATH);
seedUsers(db);
seedDemoJobs(db, SAMPLE_PATH);

const owner = getOwnerUser(db);
if (owner) migrateFromJson(db, owner.id, process.cwd());

const secret = loadOrCreateSecret(DATA_DIR);
const app = createApp(db, { secret, dataDir: DATA_DIR });

app.listen(PORT, () => {
    console.log(`Job Viewer running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}/job-viewer`);
});
```

- [ ] **Step 2: Type-check the whole server build**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Build and smoke-start the server**

Run:
```bash
npm run build:server
node --env-file-if-exists=./data/app.env dist-server/server.js &
sleep 2
curl -s http://localhost:3004/job-viewer/api/me
curl -s http://localhost:3004/job-viewer/api/jobs
kill %1
```
Expected: `/me` returns `{"authenticated":false,...,"isDemo":true}`; `/jobs` returns the 4 demo acting jobs.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: SQLite-backed server entry (seed + migrate + factory)"
```

---

## Task 18: gitignore + untrack identity.json

**Files:**
- Modify: `.gitignore`
- Untrack: `src/assets/identity.json`

- [ ] **Step 1: Update .gitignore**

Replace the contents of `.gitignore` with:
```gitignore
node_modules/
.env
*.log
.DS_Store

jobs.json
history.json
scrape_info.json
data/
src/assets/identity.json
dist/
dist-server/
```

- [ ] **Step 2: Stop tracking the PII file (keep the local copy)**

Run:
```bash
git rm --cached src/assets/identity.json
```
Expected: `rm 'src/assets/identity.json'` — the working-tree file remains on disk.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore data dir + untrack identity.json (PII)"
```

> **Server ops note (not a code step):** before the first deploy of this change, copy the
> existing identity file into the persistent data dir so cover-letter generation keeps
> working after `git reset --hard` removes the now-untracked repo copy:
> `mkdir -p ~/projects/job-viewer/data && cp ~/projects/job-viewer/src/assets/identity.json ~/projects/job-viewer/data/identity.json`

---

## Task 19: Frontend — auth state + API gating

**Files:**
- Modify: `src/ts/state.ts`
- Modify: `src/ts/api.ts`

> Frontend has no DOM test harness (adding jsdom is out of scope). These tasks are
> verified manually in Task 22.

- [ ] **Step 1: Add auth state**

Append to `src/ts/state.ts`:
```ts
export let isOwner = false;
export function setIsOwner(v: boolean) {
    isOwner = v;
}

export let currentUser: { username: string | null; role: string | null } = {
    username: null,
    role: null,
};
export function setCurrentUser(u: { username: string | null; role: string | null }) {
    currentUser = u;
}
```

- [ ] **Step 2: Add auth API calls and gate mutations in api.ts**

In `src/ts/api.ts`, update the imports line:
```ts
import { jobs, setJobs, setHistory, isOwner } from './state';
```

Add these new functions to `src/ts/api.ts`:
```ts
export interface MeResponse {
    authenticated: boolean;
    username: string | null;
    role: string | null;
    isDemo: boolean;
}

export async function fetchMe(): Promise<MeResponse> {
    try {
        const res = await fetch(`${API_BASE}/me`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('me failed');
        return await res.json();
    } catch {
        return { authenticated: false, username: null, role: null, isDemo: true };
    }
}

export async function login(username: string, password: string): Promise<MeResponse> {
    const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Invalid credentials');
    return await res.json();
}

export async function logout(): Promise<void> {
    await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'same-origin' });
}
```

In `src/ts/api.ts`, gate the mutating functions. Replace the body of `patchJob` so it short-circuits in demo mode:
```ts
export async function patchJob(id: string, payload: Partial<Job>): Promise<Job> {
    if (!isOwner) {
        // Demo sandbox: update local state only, never persist.
        const idx = jobs.findIndex(j => String(j.id) === String(id));
        if (idx !== -1) {
            jobs[idx] = { ...jobs[idx], ...payload } as Job;
            return jobs[idx];
        }
        return { id, ...payload } as Job;
    }
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`PATCH failed (${res.status}): ${txt}`);
    }

    const updated: Job = await res.json();
    const idx = jobs.findIndex(j => String(j.id) === String(updated.id));
    if (idx !== -1) {
        jobs[idx] = updated;
    }
    return updated;
}
```

Replace the body of `createJob`:
```ts
export async function createJob(payload: Partial<Job>): Promise<Job> {
    if (!isOwner) {
        return { id: `demo-${Date.now()}`, status: 'new', ...payload } as Job;
    }
    const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Failed to create job');
    return await res.json();
}
```

Replace the body of `deleteDeletedJobs`:
```ts
export async function deleteDeletedJobs(): Promise<void> {
    if (!isOwner) {
        setJobs(jobs.filter(j => j.status !== 'deleted'));
        return;
    }
    const res = await fetch(`${API_BASE}/jobs/status/deleted`, {
        method: 'DELETE',
        credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Failed to clear bin');
}
```

Add a guard at the very top of `triggerScrape`:
```ts
export async function triggerScrape(): Promise<{ message: string; lastTriggerDate: string }> {
    if (!isOwner) throw new Error('Sign in to trigger a scrape');
    const res = await fetch(`${API_BASE}/trigger-scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Trigger failed' }));
        throw new Error(err.error || 'Failed to trigger scrape');
    }

    return await res.json();
}
```

Add a guard at the very top of `generateCoverLetter`:
```ts
export async function generateCoverLetter(job: any): Promise<{ text: string }> {
    if (!isOwner) throw new Error('Sign in to generate an AI cover letter');
    const res = await fetch(`${API_BASE}/generate-cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ job })
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        throw new Error(err.error || 'Failed to generate cover letter');
    }

    return await res.json();
}
```

- [ ] **Step 3: Type-check the frontend**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ts/state.ts src/ts/api.ts
git commit -m "feat(ui): auth state + demo-mode API gating"
```

---

## Task 20: Frontend — HTML (sign-in/out, banner, login modal) + dom.ts

**Files:**
- Modify: `index.html`
- Modify: `src/ts/dom.ts`

- [ ] **Step 1: Add sign-in/out buttons to the header**

In `index.html`, inside the right-hand button cluster `<div class="flex items-center gap-2">`, immediately after the `<div id="statusText" ...></div>` line (index.html:41), insert:
```html
                    <button id="sign-in" type="button" title="Sign In"
                        class="btn-accent inline-flex items-center justify-center text-xs font-black uppercase tracking-widest px-3 py-2 border-2 border-black shadow-[2px_2px_0_#000] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                        Sign In
                    </button>
                    <button id="log-out" type="button" title="Log Out"
                        class="btn-icon hidden inline-flex items-center justify-center text-xs font-black uppercase tracking-widest px-3 py-2 border-2 transition-all active:scale-95">
                        Log Out
                    </button>
```

- [ ] **Step 2: Add the demo banner**

In `index.html`, immediately after the closing `</header>` (index.html:78) and before `<main ...>`, insert:
```html
    <div id="demo-banner"
        class="hidden bg-yellow-300 border-b-2 border-black text-black text-[11px] md:text-xs font-bold text-center py-1.5 px-4">
        Public demo — changes won't be saved.
        <button id="banner-sign-in" type="button" class="underline font-black ml-1">Sign in</button>
        for live features.
    </div>
```

- [ ] **Step 3: Add the login modal**

In `index.html`, immediately before the closing `<script type="module" src="/src/ts/main.ts"></script>` (index.html:389), insert:
```html
    <!-- Login Modal -->
    <div id="login-backdrop"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[300] p-4 hidden opacity-0 transition-opacity duration-200"
        role="dialog" aria-modal="true" aria-label="Sign In">
        <div class="modal-container w-full max-w-sm flex flex-col scale-95 transition-transform duration-200 overflow-hidden"
            role="document">
            <header class="modal-header flex items-center justify-between p-4 border-b sticky top-0 z-10">
                <h2 class="text-lg font-black text-theme-primary uppercase tracking-widest">Owner Sign In</h2>
                <button id="login-close" type="button"
                    class="text-theme-secondary hover:text-theme-primary transition-colors p-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </header>
            <div class="p-6 space-y-4">
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Username</label>
                    <input id="login-username" type="text" autocomplete="username"
                        class="input-field text-sm px-3 py-2.5 outline-none" />
                </div>
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Password</label>
                    <input id="login-password" type="password" autocomplete="current-password"
                        class="input-field text-sm px-3 py-2.5 outline-none" />
                </div>
                <div id="login-error" class="hidden text-xs font-bold text-rose-500"></div>
                <button id="login-submit" type="button"
                    class="btn-accent w-full bg-emerald-400 text-black border-2 border-black shadow-[4px_4px_0_#000] text-sm font-black px-4 py-2.5 uppercase tracking-widest transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                    Sign In
                </button>
            </div>
        </div>
    </div>

```

- [ ] **Step 4: Register the new elements in dom.ts**

In `src/ts/dom.ts`, add these keys to the `els` object (after `scrapeBtn: null`):
```ts
    signInBtn: null,
    logOutBtn: null,
    demoBanner: null,
    bannerSignIn: null,
    loginBackdrop: null,
    loginClose: null,
    loginUsername: null,
    loginPassword: null,
    loginError: null,
    loginSubmit: null
```
(Remember to add a comma after `scrapeBtn: null` so the object stays valid.)

- [ ] **Step 5: Type-check + build the frontend**

Run: `npm run build`
Expected: Vite build succeeds, `tsc -p tsconfig.server.json` succeeds, no errors.

- [ ] **Step 6: Commit**

```bash
git add index.html src/ts/dom.ts
git commit -m "feat(ui): sign-in/out controls, demo banner, login modal"
```

---

## Task 21: Frontend — wiring + auth visibility

**Files:**
- Modify: `src/ts/main.ts`

- [ ] **Step 1: Update imports**

In `src/ts/main.ts`, update the api and state imports:
```ts
import { jobs, onConfirmProceed, setJobs, activeJobId, setIsOwner, setCurrentUser } from './state';
```
```ts
import { fetchJobs, fetchHistory, patchJob, deleteDeletedJobs, fetchScrapeInfo, triggerScrape, fetchMe, login, logout } from './api';
```

- [ ] **Step 2: Bind the new DOM elements**

In `src/ts/main.ts`, inside `init()` after `els.scrapeBtn = $('trigger-scrape');` (around main.ts:29), add:
```ts
    els.signInBtn = $('sign-in');
    els.logOutBtn = $('log-out');
    els.demoBanner = $('demo-banner');
    els.bannerSignIn = $('banner-sign-in');
    els.loginBackdrop = $('login-backdrop');
    els.loginClose = $('login-close');
    els.loginUsername = $('login-username');
    els.loginPassword = $('login-password');
    els.loginError = $('login-error');
    els.loginSubmit = $('login-submit');
```

- [ ] **Step 3: Add the auth helpers + wiring inside init()**

In `src/ts/main.ts`, add this wiring near the other listener wiring (before `wireDropzones();` at main.ts:194):
```ts
    // Auth wiring
    const openLogin = () => {
        if (els.loginError) { els.loginError.textContent = ''; els.loginError.classList.add('hidden'); }
        if (els.loginBackdrop) {
            els.loginBackdrop.classList.remove('hidden');
            requestAnimationFrame(() => {
                els.loginBackdrop!.classList.remove('opacity-0');
                const doc = els.loginBackdrop!.querySelector('[role="document"]');
                if (doc) doc.classList.remove('scale-95');
            });
        }
        (els.loginUsername as HTMLInputElement | null)?.focus();
    };
    const closeLogin = () => {
        if (els.loginBackdrop) {
            els.loginBackdrop.classList.add('opacity-0');
            const doc = els.loginBackdrop.querySelector('[role="document"]');
            if (doc) doc.classList.add('scale-95');
            setTimeout(() => {
                if (els.loginBackdrop!.classList.contains('opacity-0')) els.loginBackdrop!.classList.add('hidden');
            }, 200);
        }
    };

    if (els.signInBtn) els.signInBtn.addEventListener('click', openLogin);
    if (els.bannerSignIn) els.bannerSignIn.addEventListener('click', openLogin);
    if (els.loginClose) els.loginClose.addEventListener('click', closeLogin);
    if (els.loginBackdrop) els.loginBackdrop.addEventListener('click', (e) => {
        if (e.target === els.loginBackdrop) closeLogin();
    });

    const submitLogin = async () => {
        const username = (els.loginUsername as HTMLInputElement | null)?.value || '';
        const password = (els.loginPassword as HTMLInputElement | null)?.value || '';
        try {
            await login(username, password);
            await refreshAuth();
            await Promise.all([fetchJobs(), fetchHistory(), updateScrapeButtonStatus()]);
            closeLogin();
            setStatus('Signed in');
        } catch {
            if (els.loginError) {
                els.loginError.textContent = 'Invalid credentials';
                els.loginError.classList.remove('hidden');
            }
        }
    };
    if (els.loginSubmit) els.loginSubmit.addEventListener('click', submitLogin);
    if (els.loginPassword) els.loginPassword.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') submitLogin();
    });

    if (els.logOutBtn) els.logOutBtn.addEventListener('click', async () => {
        await logout();
        await refreshAuth();
        await Promise.all([fetchJobs(), fetchHistory()]);
        setStatus('Signed out');
    });
```

- [ ] **Step 4: Add refreshAuth + applyAuthVisibility module functions**

In `src/ts/main.ts`, add these functions at module scope (next to `updateScrapeButtonStatus`):
```ts
async function refreshAuth(): Promise<void> {
    const me = await fetchMe();
    setIsOwner(me.authenticated);
    setCurrentUser({ username: me.username, role: me.role });
    applyAuthVisibility(me.authenticated);
}

function applyAuthVisibility(owner: boolean): void {
    const show = (el: HTMLElement | null, visible: boolean) => {
        if (el) el.classList.toggle('hidden', !visible);
    };
    show(els.signInBtn, !owner);
    show(els.logOutBtn, owner);
    show(els.demoBanner, !owner);
    show(els.scrapeBtn, owner);          // n8n scraper is owner-only
    show(els.btnTemplateAi, owner);      // AI cover letter (n8n + PII) is owner-only
}
```

- [ ] **Step 5: Call refreshAuth before the initial data fetch**

In `src/ts/main.ts`, replace the final line of `init()` (main.ts:197):
```ts
    await refreshAuth();
    await Promise.all([fetchJobs(), fetchHistory(), updateScrapeButtonStatus()]);
```

- [ ] **Step 6: Type-check + build**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/ts/main.ts
git commit -m "feat(ui): wire sign-in/out + owner-only control visibility"
```

---

## Task 22: Env config, deploy docs, full verification

**Files:**
- Create: `.env.example`
- Modify: `ecosystem.config.cjs`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Document env vars**

Create `.env.example`:
```bash
# Owner seed (only applied on first run / while username is still the default "me")
ADMIN_USERNAME=me
ADMIN_PASSWORD=0000

# Optional: explicit cookie signing secret. If unset, one is generated to data/session.secret
# SESSION_SECRET=

# Required for n8n to deliver scraped jobs to POST /api/receive-jobs
WEBHOOK_SECRET=change-me

# n8n webhook URLs (replace the old hardcoded localhost:5678 values)
N8N_SCRAPE_URL=http://localhost:5678/webhook/91d4ac64-60fd-4749-9774-342688ff638c
N8N_COVER_LETTER_URL=http://localhost:5678/webhook/82cb94bc-6484-4fb9-bf9d-d521c667f9f6

# Optional override for the cover-letter identity file (defaults to data/identity.json)
# IDENTITY_PATH=
```

- [ ] **Step 2: Make PM2 load the persistent env file**

Replace the contents of `ecosystem.config.cjs` with:
```js
module.exports = {
    apps: [{
        name: 'job-viewer',
        script: './dist-server/server.js',
        node_args: '--env-file-if-exists=./data/app.env',
        env_production: {
            NODE_ENV: 'production',
            PORT: 3004
        }
    }]
};
```

- [ ] **Step 3: Note the env step in the deploy workflow**

In `.github/workflows/deploy.yml`, after the `npm run build` line (deploy.yml:24), add a comment line documenting the required server-side secrets file (the workflow itself does not create it):
```yaml
          # Secrets live in ./data/app.env on the server (gitignored, persistent):
          # ADMIN_USERNAME, ADMIN_PASSWORD, WEBHOOK_SECRET, N8N_SCRAPE_URL, N8N_COVER_LETTER_URL
```

- [ ] **Step 4: Run the full backend test suite**

Run: `npm test`
Expected: PASS — every test from Tasks 3–16 green, 0 failing.

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: Vite build + server tsc both succeed.

- [ ] **Step 6: Manual smoke test (use the `run` skill or manual dev server)**

Run `npm run dev` (or build + `node --env-file-if-exists=./data/app.env dist-server/server.js`) and verify in a browser at `http://localhost:3004/job-viewer`:
- Logged out: the demo banner shows; the 4 acting jobs render; the **scrape** ⚡ button and **AI Magic** button are hidden; dragging a card between columns works visually but a refresh resets it.
- Click **Sign In**, enter `me` / `0000`: banner disappears, **Log Out** + **scrape** + **AI Magic** appear, and your real jobs load.
- Click **Log Out**: returns to the demo view.

Expected: all behaviors as described.

- [ ] **Step 7: Commit**

```bash
git add .env.example ecosystem.config.cjs .github/workflows/deploy.yml
git commit -m "chore: env example, PM2 env-file, deploy notes"
```

---

## Final self-review checklist (run before declaring done)

- [ ] `npm test` — all backend tests pass.
- [ ] `npm run build` — clean.
- [ ] `git grep -n "localhost:5678" -- server.ts server/` returns nothing (URLs are env-driven).
- [ ] Only ONE `generate-cover-letter` handler exists (`git grep -c "generate-cover-letter" server/app.ts` → small, single route).
- [ ] `identity.json` is untracked (`git ls-files src/assets/identity.json` is empty) and still present on disk.
- [ ] Anonymous `GET /api/jobs` never returns owner data; owner-only routes return 403 when anonymous.
