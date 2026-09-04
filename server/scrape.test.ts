import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from './db.js';
import { createRun, claimRun, countRunsToday, countUserRunsToday } from './scrape.js';
import { startApp, signUpMember, approve, signIn } from './testing.js';

function fixture(): Db {
    const db = openDb(':memory:');
    db.prepare(
        `INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt",
            "username","displayUsername","role","approvalStatus")
         VALUES ('u1','alice','a@example.test',0,'2026-01-01','2026-01-01','alice','alice','member','approved')`,
    ).run();
    return db;
}

function age(db: Db, runId: string, minutes: number): void {
    const when = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    db.prepare('UPDATE scrape_runs SET created_at=? WHERE id=?').run(when, runId);
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
    age(db, runId, 60);
    assert.equal(claimRun(db, runId, 30), null);
    db.close();
});

test('an expired run still counts toward the caps', () => {
    const db = fixture();
    const runId = createRun(db, 'u1');
    age(db, runId, 5);
    claimRun(db, runId, 30);
    // Same calendar day, so it still counts — the Apify run it paid for did happen.
    assert.equal(countRunsToday(db), 1);
    assert.equal(countUserRunsToday(db, 'u1'), 1);
    db.close();
});

test("receive-jobs routes a batch to the run's owner", async () => {
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

        // The owner's board is untouched.
        const ownerJobs = h.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE user_id=?')
            .get(h.ownerId) as { n: number };
        assert.equal(ownerJobs.n, 0);
    } finally { h.close(); }
});

test('a consumed run is rejected on redelivery', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const runId = createRun(h.db, id);
        const body = JSON.stringify({ runId, jobs: [{ title: 'For Alice', company: 'ACME' }] });
        const headers = { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wh-secret' };

        assert.equal((await fetch(`${h.base}/receive-jobs`, { method: 'POST', headers, body })).status, 201);
        assert.equal((await fetch(`${h.base}/receive-jobs`, { method: 'POST', headers, body })).status, 409);
    } finally { h.close(); }
});

test('an unknown runId is rejected', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wh-secret' },
            body: JSON.stringify({ runId: 'not-a-run', jobs: [] }),
        });
        assert.equal(res.status, 409);
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
        const rows = h.db.prepare('SELECT user_id FROM jobs').all() as { user_id: string }[];
        assert.equal(rows[0].user_id, h.ownerId);
    } finally { h.close(); }
});

test('the per-user daily limit blocks a second trigger', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await signIn(h, 'alice');
        createRun(h.db, id); // stand in for an earlier trigger today

        const res = await fetch(`${h.base}/trigger-scrape`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 429);
        assert.match((await res.json()).error, /already triggered today/i);
    } finally { h.close(); }
});

test('the global daily budget blocks everyone once spent', async () => {
    const h = await startApp();
    try {
        const alice = await signUpMember(h, 'alice');
        approve(h, alice);
        // Default SCRAPE_DAILY_LIMIT is 5; spend it on other users' runs.
        for (let i = 0; i < 5; i++) createRun(h.db, h.ownerId);

        const cookie = await signIn(h, 'alice');
        const res = await fetch(`${h.base}/trigger-scrape`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 429);
        assert.match((await res.json()).error, /budget/i);
    } finally { h.close(); }
});
