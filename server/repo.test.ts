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
    assert.ok(ownerJobs[0].id);
    db.close();
});

test('upsertJobs merges existing rows without clobbering status/notes', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    const [created] = upsertJobs(db, owner.id, [{ id: 'j1', title: 'T', company: 'C', status: 'in_progress', notes: 'mine' }]);
    assert.equal(created.status, 'in_progress');
    upsertJobs(db, owner.id, [{ id: 'j1', title: 'T2', company: 'C', status: 'new', notes: '' }]);
    const after = getJobById(db, owner.id, 'j1')!;
    assert.equal(after.status, 'in_progress');
    assert.equal(after.notes, 'mine');
    assert.equal(after.title, 'T2');
    db.close();
});

test('upsertJobs does not resurrect notes the owner deliberately cleared', () => {
    const db = seededDb();
    const owner = getOwnerUser(db)!;
    upsertJobs(db, owner.id, [{ id: 'j1', title: 'T', company: 'C', notes: '' }]);
    // a re-delivered job that carries notes must NOT overwrite the owner's empty notes
    upsertJobs(db, owner.id, [{ id: 'j1', title: 'T', company: 'C', notes: 'from scraper' }]);
    assert.equal(getJobById(db, owner.id, 'j1')!.notes, '');
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
