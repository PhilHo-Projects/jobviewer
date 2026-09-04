import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';
import { buildAuth } from './auth.js';
import { loadConfig } from './config.js';
import { ensureOwner } from './owner.js';

const TEST_ENV = {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://jobs.example.test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    OWNER_USERNAME: 'phil',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: 'owner-correct-horse',
    WEBHOOK_SECRET: 'wh-secret',
};

function fixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    const config = loadConfig(TEST_ENV);
    return { db, config, auth: buildAuth({ db, config }) };
}

test('ensureOwner creates an approved owner on first boot', async () => {
    const { db, auth, config } = fixture();
    try {
        const id = await ensureOwner({ auth, db, config });
        const row = db.prepare('SELECT "username","role","approvalStatus" FROM "user" WHERE "id"=?')
            .get(id) as { username: string; role: string; approvalStatus: string };
        assert.equal(row.username, 'phil');
        assert.equal(row.role, 'owner');
        assert.equal(row.approvalStatus, 'approved');
    } finally { db.close(); }
});

test('ensureOwner is a no-op on a second boot', async () => {
    const { db, auth, config } = fixture();
    try {
        const first = await ensureOwner({ auth, db, config });
        const second = await ensureOwner({ auth, db, config });
        assert.equal(first, second);
        assert.equal((db.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n, 1);
    } finally { db.close(); }
});

test('ensureOwner does not reset the password of an existing owner', async () => {
    const { db, auth, config } = fixture();
    try {
        await ensureOwner({ auth, db, config });
        const before = (db.prepare(`SELECT "password" FROM "account" LIMIT 1`).get() as { password: string }).password;
        await ensureOwner({ auth, db, config: { ...config, ownerPassword: 'a-different-password' } });
        const after = (db.prepare(`SELECT "password" FROM "account" LIMIT 1`).get() as { password: string }).password;
        assert.equal(before, after);
    } finally { db.close(); }
});

test('the seeded owner can sign in', async () => {
    const { db, auth, config } = fixture();
    try {
        await ensureOwner({ auth, db, config });
        const result = await auth.api.signInEmail({
            body: { email: 'owner@example.test', password: 'owner-correct-horse' },
        });
        assert.ok(result);
    } finally { db.close(); }
});
