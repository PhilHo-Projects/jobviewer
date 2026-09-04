import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signUpMember, approve, signIn, OWNER_PASSWORD, type Harness } from './testing.js';

const ownerCookie = (h: Harness) => signIn(h, 'phil', OWNER_PASSWORD);

test('the owner sees pending accounts', async () => {
    const h = await startApp();
    try {
        await signUpMember(h, 'alice');
        const cookie = await ownerCookie(h);
        const body = await (await fetch(`${h.base}/admin/users`, { headers: { Cookie: cookie } })).json();
        assert.equal(body.users.length, 1);
        assert.equal(body.users[0].username, 'alice');
        assert.equal(body.users[0].approvalStatus, 'pending');
    } finally { h.close(); }
});

test('status=all includes the owner and approved members', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await ownerCookie(h);
        const body = await (await fetch(`${h.base}/admin/users?status=all`, { headers: { Cookie: cookie } })).json();
        assert.equal(body.users.length, 2);
    } finally { h.close(); }
});

test('a member cannot reach the admin routes', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const cookie = await signIn(h, 'alice');
        const res = await fetch(`${h.base}/admin/users`, { headers: { Cookie: cookie } });
        assert.equal(res.status, 403);
    } finally { h.close(); }
});

test('an anonymous caller cannot reach the admin routes', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/admin/users`);
        assert.equal(res.status, 403);
    } finally { h.close(); }
});

test('approving lets the member sign in', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        const cookie = await ownerCookie(h);
        const res = await fetch(`${h.base}/admin/users/${id}/approve`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 200);
        assert.ok(await signIn(h, 'alice'));
    } finally { h.close(); }
});

test('rejecting kills the live session', async () => {
    const h = await startApp();
    try {
        const id = await signUpMember(h, 'alice');
        approve(h, id);
        const alice = await signIn(h, 'alice');
        const before = await (await fetch(`${h.base}/me`, { headers: { Cookie: alice } })).json();
        assert.equal(before.authenticated, true);

        const cookie = await ownerCookie(h);
        await fetch(`${h.base}/admin/users/${id}/reject`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });

        const after = await (await fetch(`${h.base}/me`, { headers: { Cookie: alice } })).json();
        assert.equal(after.authenticated, false, 'revocation is the point of server-side sessions');
    } finally { h.close(); }
});

test('the owner cannot be rejected', async () => {
    const h = await startApp();
    try {
        const cookie = await ownerCookie(h);
        const res = await fetch(`${h.base}/admin/users/${h.ownerId}/reject`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 409);
    } finally { h.close(); }
});

test('an unknown user id is a 404', async () => {
    const h = await startApp();
    try {
        const cookie = await ownerCookie(h);
        const res = await fetch(`${h.base}/admin/users/nope/approve`, {
            method: 'POST', headers: { Cookie: cookie, Origin: h.origin },
        });
        assert.equal(res.status, 404);
    } finally { h.close(); }
});

test('/api/me carries the pending count for the owner only', async () => {
    const h = await startApp();
    try {
        await signUpMember(h, 'alice');
        const cookie = await ownerCookie(h);
        const me = await (await fetch(`${h.base}/me`, { headers: { Cookie: cookie } })).json();
        assert.equal(me.pendingCount, 1);

        const anon = await (await fetch(`${h.base}/me`)).json();
        assert.equal(anon.pendingCount, 0);
    } finally { h.close(); }
});
