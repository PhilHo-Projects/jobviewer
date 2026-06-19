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
