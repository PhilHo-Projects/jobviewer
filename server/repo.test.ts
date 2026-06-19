import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { seedUsers } from './db.js';
import { getUserById, getDemoUser, getOwnerUser, getUserByUsername } from './repo.js';
import { verifyPassword } from './auth.js';

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
    const owner = getOwnerUser(db)!;
    db.prepare(`UPDATE users SET password_hash=? WHERE id=?`)
        .run('scrypt$dead$beef', owner.id);
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    const after = getUserByUsername(db, 'me')!;
    assert.equal(after.password_hash, 'scrypt$dead$beef');
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM users WHERE role='owner'`).get().c, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM users WHERE role='demo'`).get().c, 1);
    db.close();
});

test('seedUsers updates username only while still the default placeholder', () => {
    const db = openDb(':memory:');
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    seedUsers(db, { adminUsername: 'phil', adminPassword: '0000' });
    assert.ok(getUserByUsername(db, 'phil'));
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
