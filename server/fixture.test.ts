import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signIn, OWNER_PASSWORD } from './testing.js';

test('an anonymous visitor is served the fixture', async () => {
    const h = await startApp();
    try {
        const jobs = await (await fetch(`${h.base}/jobs`)).json();
        assert.ok(Array.isArray(jobs));
        assert.ok(jobs.length > 0, 'fixture should not be empty');
    } finally { h.close(); }
});

test('the fixture is never written to the database', async () => {
    const h = await startApp();
    try {
        await fetch(`${h.base}/jobs`);
        const n = (h.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
        assert.equal(n, 0);
    } finally { h.close(); }
});

test('the owner sees their own empty board, not the fixture', async () => {
    const h = await startApp();
    try {
        const cookie = await signIn(h, 'phil', OWNER_PASSWORD);
        const jobs = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.equal(jobs.length, 0);
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
