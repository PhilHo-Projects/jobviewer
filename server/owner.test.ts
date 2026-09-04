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

test('ensureOwner drains the legacy holding tables exactly once', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // Simulate a pre-cutover database: v1 tables with an owner and one job.
    const { MIGRATIONS } = await import('./migrations.js');
    db.exec(MIGRATIONS[0].sql);
    db.prepare(`INSERT INTO users (username,password_hash,role,created_at)
                VALUES ('phil','x','owner','2026-01-01')`).run();
    db.prepare(`INSERT INTO jobs (user_id,id,title,company,status,notes)
                VALUES (1,'j1','Old Job','ACME','new','keep me')`).run();
    db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO schema_migrations VALUES (1, '2026-01-01')`).run();
    migrate(db);

    const config = loadConfig(TEST_ENV);
    const auth = buildAuth({ db, config });
    const ownerId = await ensureOwner({ auth, db, config });

    const rows = db.prepare('SELECT user_id, id, notes FROM jobs').all() as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, ownerId);
    assert.equal(rows[0].notes, 'keep me');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM legacy_owner_jobs').get() as { n: number }).n, 0);

    // The hand-rolled identity table is gone; Better Auth's "user" is the only one left.
    const legacyUsers = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`)
        .get();
    assert.equal(legacyUsers, undefined);

    await ensureOwner({ auth, db, config });
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n, 1);
    db.close();
});
