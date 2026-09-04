import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from './db.js';
import {
    getOwnerId, getJobs, getJobById, upsertJobs, patchJob, bulkMove, deleteByStatus,
    getHistory, insertHistory, getScrapeInfo, setScrapeInfo, createStableJobId,
} from './repo.js';

/**
 * Insert a bare user row. For suites exercising job data rather than auth, where a job
 * needs an owner but going through sign-up would only add noise.
 */
function seedUserRow(db: Db, username: string, role: 'member' | 'owner' = 'member'): string {
    const id = `u-${username}`;
    db.prepare(
        `INSERT OR IGNORE INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt",
            "username","displayUsername","role","approvalStatus")
         VALUES (?,?,?,0,?,?,?,?,?,'approved')`,
    ).run(id, username, `${username}@example.test`, '2026-01-01', '2026-01-01', username, username, role);
    return id;
}

test('openDb creates the expected tables', () => {
    const db = openDb(':memory:');
    const names = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all()
        .map((r: any) => r.name);
    assert.ok(names.includes('user'), 'better-auth identity table');
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('history'));
    assert.ok(names.includes('scrape_info'));
    assert.ok(!names.includes('users'), 'the hand-rolled identity table is gone');
    db.close();
});

test('getOwnerId finds the owner and ignores members', () => {
    const db = openDb(':memory:');
    seedUserRow(db, 'alice');
    assert.equal(getOwnerId(db), null);
    const ownerId = seedUserRow(db, 'phil', 'owner');
    assert.equal(getOwnerId(db), ownerId);
    db.close();
});

test('createStableJobId is stable for the same content', () => {
    const job = { url: 'https://x.test/1', title: 'Dev', company: 'ACME' };
    assert.equal(createStableJobId(job), createStableJobId({ ...job }));
});

test('jobs are scoped per user and do not collide on a shared id', () => {
    const db = openDb(':memory:');
    const alice = seedUserRow(db, 'alice');
    const bob = seedUserRow(db, 'bob');

    // Identical content, so both users get the same sha1 id — the composite primary
    // key is what keeps them apart.
    const job = { url: 'https://x.test/1', title: 'Dev', company: 'ACME' };
    upsertJobs(db, alice, [{ ...job, notes: 'alice note' }]);
    upsertJobs(db, bob, [{ ...job, notes: 'bob note' }]);

    assert.equal(getJobs(db, alice).length, 1);
    assert.equal(getJobs(db, bob).length, 1);
    assert.equal(getJobs(db, alice)[0].notes, 'alice note');
    assert.equal(getJobs(db, bob)[0].notes, 'bob note');
    db.close();
});

test('upsert preserves owner notes on re-delivery', () => {
    const db = openDb(':memory:');
    const alice = seedUserRow(db, 'alice');
    const job = { url: 'https://x.test/1', title: 'Dev', company: 'ACME' };
    upsertJobs(db, alice, [job]);
    const id = createStableJobId(job);
    patchJob(db, alice, id, { notes: 'my thoughts' });

    // n8n re-delivers the same job; the note must survive.
    upsertJobs(db, alice, [job]);
    assert.equal(getJobById(db, alice, id)!.notes, 'my thoughts');
    db.close();
});

test('patchJob returns null for a job the user does not own', () => {
    const db = openDb(':memory:');
    const alice = seedUserRow(db, 'alice');
    const bob = seedUserRow(db, 'bob');
    upsertJobs(db, alice, [{ title: 'Dev', company: 'ACME' }]);
    const id = getJobs(db, alice)[0].id;
    assert.equal(patchJob(db, bob, id, { notes: 'nope' }), null);
    db.close();
});

test('bulkMove and deleteByStatus only touch the calling user', () => {
    const db = openDb(':memory:');
    const alice = seedUserRow(db, 'alice');
    const bob = seedUserRow(db, 'bob');
    upsertJobs(db, alice, [{ title: 'A', company: 'ACME', status: 'new' }]);
    upsertJobs(db, bob, [{ title: 'B', company: 'ACME', status: 'new' }]);

    assert.equal(bulkMove(db, alice, 'new', 'completed'), 1);
    assert.equal(getJobs(db, bob)[0].status, 'new');

    upsertJobs(db, alice, [{ title: 'C', company: 'ACME', status: 'deleted' }]);
    assert.equal(deleteByStatus(db, alice, 'deleted'), 1);
    assert.equal(getJobs(db, bob).length, 1);
    db.close();
});

test('getJobs orders newest scrape first', () => {
    const db = openDb(':memory:');
    const alice = seedUserRow(db, 'alice');
    upsertJobs(db, alice, [
        { title: 'Old', company: 'ACME', scrapedDate: '2026-01-01T00:00:00.000Z' },
        { title: 'New', company: 'ACME', scrapedDate: '2026-06-01T00:00:00.000Z' },
    ]);
    assert.equal(getJobs(db, alice)[0].title, 'New');
    db.close();
});

test('history and scrape info are scoped per user', () => {
    const db = openDb(':memory:');
    const alice = seedUserRow(db, 'alice');
    const bob = seedUserRow(db, 'bob');

    insertHistory(db, alice, {
        date: '2026-01-01', wins: [{ title: 'Dev', company: 'ACME' }],
        basePoints: 10, scoreMultiplier: 1.5, totalPoints: 15,
    });
    assert.equal(getHistory(db, alice).length, 1);
    assert.equal(getHistory(db, alice)[0].wins[0].company, 'ACME');
    assert.equal(getHistory(db, bob).length, 0);

    setScrapeInfo(db, alice, '2026-02-02');
    assert.equal(getScrapeInfo(db, alice).lastTriggerDate, '2026-02-02');
    assert.equal(getScrapeInfo(db, bob).lastTriggerDate, null);
    db.close();
});
