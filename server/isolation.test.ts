import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signUpMember, approve, signIn } from './testing.js';

test("a member cannot read another member's jobs", async () => {
    const h = await startApp();
    try {
        const aliceId = await signUpMember(h, 'alice');
        const bobId = await signUpMember(h, 'bob');
        approve(h, aliceId);
        approve(h, bobId);
        const alice = await signIn(h, 'alice');
        const bob = await signIn(h, 'bob');

        await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: h.origin },
            body: JSON.stringify({ title: 'Alice Only', company: 'ACME' }),
        });

        const seen = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: bob } })).json();
        assert.equal(seen.length, 0);
    } finally { h.close(); }
});

test("a member cannot patch another member's job", async () => {
    const h = await startApp();
    try {
        const aliceId = await signUpMember(h, 'alice');
        const bobId = await signUpMember(h, 'bob');
        approve(h, aliceId);
        approve(h, bobId);
        const alice = await signIn(h, 'alice');
        const bob = await signIn(h, 'bob');

        const created = await (await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: h.origin },
            body: JSON.stringify({ title: 'Alice Only', company: 'ACME' }),
        })).json();

        const res = await fetch(`${h.base}/jobs/${created.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: bob, Origin: h.origin },
            body: JSON.stringify({ notes: 'hijacked' }),
        });
        assert.equal(res.status, 404);

        const still = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: alice } })).json();
        assert.equal(still[0].notes, '');
    } finally { h.close(); }
});

test("a member cannot delete another member's jobs by status", async () => {
    const h = await startApp();
    try {
        const aliceId = await signUpMember(h, 'alice');
        const bobId = await signUpMember(h, 'bob');
        approve(h, aliceId);
        approve(h, bobId);
        const alice = await signIn(h, 'alice');
        const bob = await signIn(h, 'bob');

        await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: h.origin },
            body: JSON.stringify({ title: 'Alice Only', company: 'ACME', status: 'deleted' }),
        });

        const res = await fetch(`${h.base}/jobs/status/deleted`, {
            method: 'DELETE',
            headers: { Cookie: bob, Origin: h.origin },
        });
        const body = await res.json();
        assert.equal(body.deleted, 0);

        const still = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: alice } })).json();
        assert.equal(still.length, 1);
    } finally { h.close(); }
});

test("a member cannot bulk-move another member's jobs", async () => {
    const h = await startApp();
    try {
        const aliceId = await signUpMember(h, 'alice');
        const bobId = await signUpMember(h, 'bob');
        approve(h, aliceId);
        approve(h, bobId);
        const alice = await signIn(h, 'alice');
        const bob = await signIn(h, 'bob');

        await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: h.origin },
            body: JSON.stringify({ title: 'Alice Only', company: 'ACME', status: 'new' }),
        });

        const res = await fetch(`${h.base}/jobs/bulk-move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: bob, Origin: h.origin },
            body: JSON.stringify({ from: 'new', to: 'completed' }),
        });
        assert.equal((await res.json()).moved, 0);

        const still = await (await fetch(`${h.base}/jobs`, { headers: { Cookie: alice } })).json();
        assert.equal(still[0].status, 'new');
    } finally { h.close(); }
});

test('an anonymous visitor gets 401 on writes', async () => {
    const h = await startApp();
    try {
        const res = await fetch(`${h.base}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: h.origin },
            body: JSON.stringify({ title: 'Nope', company: 'ACME' }),
        });
        assert.equal(res.status, 401);
    } finally { h.close(); }
});
