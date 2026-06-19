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
