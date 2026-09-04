import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signUpMember, approve, signIn } from './testing.js';

test('an unsafe request from a foreign origin is rejected', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await signIn(h, 'alice');
        const res = await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://evil.example',
            },
            body: JSON.stringify({ title: 'Nope', company: 'ACME' }),
        });
        assert.equal(res.status, 403);
    } finally { h.close(); }
});

test('a foreign origin cannot delete either', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await signIn(h, 'alice');
        const res = await fetch(`${h.base}/jobs/status/deleted`, {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://evil.example' },
        });
        assert.equal(res.status, 403);
    } finally { h.close(); }
});

test('a safe request from a foreign origin is allowed', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/me`, { headers: { Origin: 'https://evil.example' } });
        assert.equal(res.status, 200);
    } finally { h.close(); }
});

test('the wildcard CORS header is gone', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/me`);
        assert.equal(res.headers.get('access-control-allow-origin'), null);
    } finally { h.close(); }
});

test('security headers are present', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/me`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.ok(res.headers.get('content-security-policy'));
    } finally { h.close(); }
});

test('receive-jobs is exempt: it is server-to-server and sends no Origin', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/receive-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wh-secret' },
            body: JSON.stringify([{ title: 'From n8n', company: 'ACME' }]),
        });
        assert.equal(res.status, 201);
    } finally { h.close(); }
});
