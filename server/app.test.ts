import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { openDb } from './db.js';
import { seedUsers } from './db.js';
import { createApp } from './app.js';

async function startApp() {
    const db = openDb(':memory:');
    seedUsers(db, { adminUsername: 'me', adminPassword: '0000' });
    const app = createApp(db, { secret: 'test-secret', dataDir: '.' });
    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/job-viewer/api`;
    return { db, server, base, close: () => { server.close(); db.close(); } };
}

function cookieFrom(res: Response): string {
    const raw = res.headers.get('set-cookie') || '';
    return raw.split(';')[0]; // "jv_session=...."
}

test('GET /me is demo when anonymous', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/me`);
        const body = await res.json();
        assert.equal(body.authenticated, false);
        assert.equal(body.isDemo, true);
    } finally { ctx.close(); }
});

test('login succeeds and /me reflects the owner', async () => {
    const ctx = await startApp();
    try {
        const login = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'me', password: '0000' }),
        });
        assert.equal(login.status, 200);
        const cookie = cookieFrom(login);
        assert.match(cookie, /^jv_session=/);

        const me = await fetch(`${ctx.base}/me`, { headers: { Cookie: cookie } });
        const body = await me.json();
        assert.equal(body.authenticated, true);
        assert.equal(body.role, 'owner');
        assert.equal(body.username, 'me');
    } finally { ctx.close(); }
});

test('login fails with a generic 401 on wrong password', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'me', password: 'nope' }),
        });
        assert.equal(res.status, 401);
        const body = await res.json();
        assert.equal(body.error, 'Invalid credentials');
    } finally { ctx.close(); }
});

test('login rejects the demo role', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'demo', password: '' }),
        });
        assert.equal(res.status, 401);
    } finally { ctx.close(); }
});

test('logout clears the cookie', async () => {
    const ctx = await startApp();
    try {
        const res = await fetch(`${ctx.base}/logout`, { method: 'POST' });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('set-cookie') || '', /Max-Age=0/);
    } finally { ctx.close(); }
});

import { getOwnerUser, getDemoUser, upsertJobs } from './repo.js';

test('GET /jobs returns demo jobs for anon and owner jobs for owner', async () => {
    const ctx = await startApp();
    try {
        const owner = getOwnerUser(ctx.db)!;
        const demo = getDemoUser(ctx.db)!;
        upsertJobs(ctx.db, owner.id, [{ id: 'o1', title: 'Owner Secret', company: 'Real' }]);
        upsertJobs(ctx.db, demo.id, [{ id: 'd1', title: 'Demo Sample', company: 'Fake' }]);

        const anon = await (await fetch(`${ctx.base}/jobs`)).json();
        assert.equal(anon.length, 1);
        assert.equal(anon[0].title, 'Demo Sample');

        const login = await fetch(`${ctx.base}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'me', password: '0000' }),
        });
        const cookie = cookieFrom(login);
        const mine = await (await fetch(`${ctx.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.equal(mine.length, 1);
        assert.equal(mine[0].title, 'Owner Secret');
    } finally { ctx.close(); }
});

async function ownerCookie(ctx: Awaited<ReturnType<typeof startApp>>): Promise<string> {
    const login = await fetch(`${ctx.base}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'me', password: '0000' }),
    });
    return cookieFrom(login);
}

test('write routes are 403 for anon and work for owner', async () => {
    const ctx = await startApp();
    try {
        const anonCreate = await fetch(`${ctx.base}/jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'X', company: 'Y' }),
        });
        assert.equal(anonCreate.status, 403);

        const cookie = await ownerCookie(ctx);
        const create = await fetch(`${ctx.base}/jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ title: 'X', company: 'Y' }),
        });
        assert.equal(create.status, 201);
        const saved = await create.json();
        assert.ok(saved.id);

        const patch = await fetch(`${ctx.base}/jobs/${saved.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ status: 'completed' }),
        });
        assert.equal(patch.status, 200);
        assert.equal((await patch.json()).status, 'completed');

        const anonPatch = await fetch(`${ctx.base}/jobs/${saved.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'new' }),
        });
        assert.equal(anonPatch.status, 403);
    } finally { ctx.close(); }
});

test('receive-jobs path is registered but bulk routes need owner', async () => {
    const ctx = await startApp();
    try {
        const anonBulk = await fetch(`${ctx.base}/jobs/bulk-move`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'new', to: 'deleted' }),
        });
        assert.equal(anonBulk.status, 403);
        const anonDelete = await fetch(`${ctx.base}/jobs/status/deleted`, { method: 'DELETE' });
        assert.equal(anonDelete.status, 403);
    } finally { ctx.close(); }
});

import express from 'express';

async function startStub() {
    const stub = express();
    stub.use(express.json());
    stub.all('*', (_req, res) => {
        res.json({ text: 'STUB COVER LETTER' });
    });
    const server = stub.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/hook`, close: () => server.close() };
}

test('trigger-scrape is owner-only and honours the daily limit', async () => {
    const ctx = await startApp();
    const stub = await startStub();
    const prev = process.env.N8N_SCRAPE_URL;
    process.env.N8N_SCRAPE_URL = stub.url;
    try {
        const anon = await fetch(`${ctx.base}/trigger-scrape`, { method: 'POST' });
        assert.equal(anon.status, 403);

        const cookie = await ownerCookie(ctx);
        const first = await fetch(`${ctx.base}/trigger-scrape`, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(first.status, 200);
        const second = await fetch(`${ctx.base}/trigger-scrape`, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(second.status, 429);
    } finally {
        if (prev === undefined) delete process.env.N8N_SCRAPE_URL; else process.env.N8N_SCRAPE_URL = prev;
        stub.close(); ctx.close();
    }
});

test('generate-cover-letter is owner-only', async () => {
    const ctx = await startApp();
    const stub = await startStub();
    const prev = process.env.N8N_COVER_LETTER_URL;
    process.env.N8N_COVER_LETTER_URL = stub.url;
    try {
        const anon = await fetch(`${ctx.base}/generate-cover-letter`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job: { title: 'T' } }),
        });
        assert.equal(anon.status, 403);

        const cookie = await ownerCookie(ctx);
        const ok = await fetch(`${ctx.base}/generate-cover-letter`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ job: { title: 'T' } }),
        });
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).text, 'STUB COVER LETTER');
    } finally {
        if (prev === undefined) delete process.env.N8N_COVER_LETTER_URL; else process.env.N8N_COVER_LETTER_URL = prev;
        stub.close(); ctx.close();
    }
});

test('receive-jobs requires the webhook secret and writes to the owner', async () => {
    const ctx = await startApp();
    const prev = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 's3cr3t';
    try {
        const noSecret = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ title: 'Hook Job', company: 'C' }]),
        });
        assert.equal(noSecret.status, 403);

        const wrong = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'nope' },
            body: JSON.stringify([{ title: 'Hook Job', company: 'C' }]),
        });
        assert.equal(wrong.status, 403);

        const ok = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 's3cr3t' },
            body: JSON.stringify([{ title: 'Hook Job', company: 'C' }]),
        });
        assert.equal(ok.status, 201);

        const cookie = await ownerCookie(ctx);
        const owner = await (await fetch(`${ctx.base}/jobs`, { headers: { Cookie: cookie } })).json();
        assert.ok(owner.some((j: any) => j.title === 'Hook Job'));
        const anon = await (await fetch(`${ctx.base}/jobs`)).json();
        assert.ok(!anon.some((j: any) => j.title === 'Hook Job'));
    } finally {
        if (prev === undefined) delete process.env.WEBHOOK_SECRET; else process.env.WEBHOOK_SECRET = prev;
        ctx.close();
    }
});

test('receive-jobs fails closed when WEBHOOK_SECRET is unset', async () => {
    const ctx = await startApp();
    const prev = process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET;
    try {
        const res = await fetch(`${ctx.base}/receive-jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'anything' },
            body: JSON.stringify([{ title: 'X', company: 'C' }]),
        });
        assert.equal(res.status, 403);
    } finally {
        if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
        ctx.close();
    }
});
