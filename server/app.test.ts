import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signUpMember, approve, signIn, OWNER_PASSWORD } from './testing.js';

test('GET /me reports anonymous when there is no session', async () => {
    const h = await startApp();
    try {
        const body = await (await fetch(`${h.base}/me`)).json();
        assert.equal(body.authenticated, false);
        assert.equal(body.isDemo, true);
        assert.equal(body.username, null);
    } finally { h.close(); }
});

test('GET /me reflects the signed-in owner', async () => {
    const h = await startApp();
    try {
        const cookie = await signIn(h, 'phil', OWNER_PASSWORD);
        const body = await (await fetch(`${h.base}/me`, { headers: { Cookie: cookie } })).json();
        assert.equal(body.authenticated, true);
        assert.equal(body.role, 'owner');
        assert.equal(body.username, 'phil');
        assert.equal(body.isDemo, false);
    } finally { h.close(); }
});

test('GET /me reflects a signed-in member', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await signIn(h, 'alice');
        const body = await (await fetch(`${h.base}/me`, { headers: { Cookie: cookie } })).json();
        assert.equal(body.authenticated, true);
        assert.equal(body.role, 'member');
    } finally { h.close(); }
});

test('a tampered cookie resolves to anonymous, not to a user', async () => {
    const h = await startApp();
    try {
        const cookie = await signIn(h, 'phil', OWNER_PASSWORD);
        const body = await (await fetch(`${h.base}/me`, { headers: { Cookie: `${cookie}x` } })).json();
        assert.equal(body.authenticated, false);
    } finally { h.close(); }
});

test('POST /jobs returns the exact created row even when other jobs exist', async () => {
    const h = await startApp();
    try {
        const cookie = await signIn(h, 'phil', OWNER_PASSWORD);
        const post = (body: unknown) => fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: h.origin },
            body: JSON.stringify(body),
        });

        await post({ title: 'Filler One', company: 'ACME' });
        await post({ title: 'Filler Two', company: 'ACME' });
        const res = await post({ title: 'The Real One', company: 'Umbrella' });

        assert.equal(res.status, 201);
        const saved = await res.json();
        assert.equal(saved.title, 'The Real One');
        assert.equal(saved.company, 'Umbrella');
    } finally { h.close(); }
});

test('re-posting the same job returns 200 rather than creating a duplicate', async () => {
    const h = await startApp();
    try {
        const cookie = await signIn(h, 'phil', OWNER_PASSWORD);
        const body = { title: 'Dev', company: 'ACME', url: 'https://x.test/1' };
        const headers = { 'Content-Type': 'application/json', Cookie: cookie, Origin: h.origin };

        const first = await fetch(`${h.base}/jobs`, { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal(first.status, 201);
        const second = await fetch(`${h.base}/jobs`, { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal(second.status, 200);

        const jobs = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.equal(jobs.length, 1);
    } finally { h.close(); }
});

test('write routes are 401 for anonymous callers', async () => {
    const h = await startApp();
    try {
        const headers = { 'Content-Type': 'application/json', Origin: h.origin };
        const calls = [
            fetch(`${h.base}/jobs`, { method: 'POST', headers, body: '{}' }),
            fetch(`${h.base}/jobs/bulk-move`, { method: 'PATCH', headers, body: '{"from":"new","to":"completed"}' }),
            fetch(`${h.base}/jobs/abc`, { method: 'PATCH', headers, body: '{}' }),
            fetch(`${h.base}/jobs/status/deleted`, { method: 'DELETE', headers }),
        ];
        for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
    } finally { h.close(); }
});

test('trigger-scrape requires a session and reports missing configuration', async () => {
    const h = await startApp();
    try {
        const anon = await fetch(`${h.base}/trigger-scrape`, {
            method: 'POST', headers: { Origin: h.origin },
        });
        assert.equal(anon.status, 401);

        const cookie = await signIn(h, 'phil', OWNER_PASSWORD);
        // N8N_SCRAPE_URL is unset in the harness, so this exercises the config guard.
        const res = await fetch(`${h.base}/trigger-scrape`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 500);
        assert.match((await res.json()).error, /N8N_SCRAPE_URL/);
    } finally { h.close(); }
});

test('generate-cover-letter is owner-only', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const member = await signIn(h, 'alice');

        const anon = await fetch(`${h.base}/generate-cover-letter`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: h.origin }, body: '{}',
        });
        assert.equal(anon.status, 403);

        const asMember = await fetch(`${h.base}/generate-cover-letter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: member, Origin: h.origin },
            body: '{}',
        });
        assert.equal(asMember.status, 403, 'members get templates, not the AI path');
    } finally { h.close(); }
});

test('receive-jobs requires the webhook secret and writes to the owner', async () => {
    const h = await startApp();
    try {
        const payload = JSON.stringify([{ title: 'From n8n', company: 'ACME' }]);

        const noSecret = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
        });
        assert.equal(noSecret.status, 403);

        const wrongSecret = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'nope' },
            body: payload,
        });
        assert.equal(wrongSecret.status, 403);

        const ok = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wh-secret' },
            body: payload,
        });
        assert.equal(ok.status, 201);

        const cookie = await signIn(h, 'phil', OWNER_PASSWORD);
        const jobs = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].title, 'From n8n');
    } finally { h.close(); }
});

test('receive-jobs rejects a non-array payload', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wh-secret' },
            body: JSON.stringify({ not: 'an array' }),
        });
        assert.equal(res.status, 400);
    } finally { h.close(); }
});
