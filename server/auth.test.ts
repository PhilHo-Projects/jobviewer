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
