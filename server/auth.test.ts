import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';
import { buildAuth } from './auth.js';
import { loadConfig } from './config.js';

const TEST_ENV = {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://jobs.example.test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: 'owner-correct-horse',
    WEBHOOK_SECRET: 'wh-secret',
};

function authFixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    const config = loadConfig(TEST_ENV);
    return { db, config, auth: buildAuth({ db, config }) };
}

async function signUp(auth: ReturnType<typeof buildAuth>, username: string) {
    await auth.api.signUpEmail({
        body: {
            email: `${username}@example.test`,
            name: username,
            password: 'correct-horse-battery',
            username,
        },
    });
}

test('sign-up creates a pending member and issues no session', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        const row = db.prepare('SELECT "role","approvalStatus" FROM "user" WHERE "username"=?')
            .get('alice') as { role: string; approvalStatus: string };
        assert.equal(row.role, 'member');
        assert.equal(row.approvalStatus, 'pending');
        assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "session"').get() as { n: number }).n, 0);
    } finally { db.close(); }
});

test('a pending account cannot sign in', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        await assert.rejects(
            auth.api.signInEmail({
                body: { email: 'alice@example.test', password: 'correct-horse-battery' },
            }),
        );
    } finally { db.close(); }
});

test('an approved account can sign in', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        db.prepare(`UPDATE "user" SET "approvalStatus"='approved' WHERE "username"=?`).run('alice');
        const result = await auth.api.signInEmail({
            body: { email: 'alice@example.test', password: 'correct-horse-battery' },
        });
        assert.ok(result);
        assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "session"').get() as { n: number }).n, 1);
    } finally { db.close(); }
});

test('a rejected account cannot sign in', async () => {
    const { db, auth } = authFixture();
    try {
        await signUp(auth, 'alice');
        db.prepare(`UPDATE "user" SET "approvalStatus"='rejected' WHERE "username"=?`).run('alice');
        await assert.rejects(
            auth.api.signInEmail({
                body: { email: 'alice@example.test', password: 'correct-horse-battery' },
            }),
        );
    } finally { db.close(); }
});

test('a sign-up body cannot set its own role', async () => {
    const { db, auth } = authFixture();
    try {
        await auth.api.signUpEmail({
            body: {
                email: 'mallory@example.test',
                name: 'mallory',
                password: 'correct-horse-battery',
                username: 'mallory',
                role: 'owner',
                approvalStatus: 'approved',
            } as any,
        });
        const row = db.prepare('SELECT "role","approvalStatus" FROM "user" WHERE "username"=?')
            .get('mallory') as { role: string; approvalStatus: string };
        assert.equal(row.role, 'member');
        assert.equal(row.approvalStatus, 'pending');
    } finally { db.close(); }
});
