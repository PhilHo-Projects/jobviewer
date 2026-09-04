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
    assert.equal(verifySessionToken(token + 'x', SECRET), null);
});

test('session token rejects structurally broken tokens', () => {
    assert.equal(verifySessionToken('', SECRET), null);
    assert.equal(verifySessionToken('a.b', SECRET), null);
    assert.equal(verifySessionToken('a.b.c.d', SECRET), null);
});

import { loadOrCreateSecret, parseCookies, buildSessionCookie, buildClearCookie, COOKIE_NAME } from './auth.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';
import { buildAuth } from './auth.js';
import { loadConfig } from './config.js';

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
