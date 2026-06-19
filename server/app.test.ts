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
