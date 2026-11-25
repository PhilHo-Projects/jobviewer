import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate, appliedVersions, MIGRATIONS } from './migrations.js';

function tableNames(db: Database.Database): string[] {
    return db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all()
        .map((r: any) => r.name);
}

test("migration 1's own SQL creates the pre-cutover schema", () => {
    // Run version 1 in isolation. A full `migrate()` would carry straight on through
    // the cutover in version 3, which drops `users` again.
    const db = new Database(':memory:');
    db.exec(MIGRATIONS[0].sql);
    const names = tableNames(db);
    assert.ok(names.includes('users'));
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('history'));
    assert.ok(names.includes('scrape_info'));
    db.close();
});

test('migrate leaves a fresh database at the post-cutover schema', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = tableNames(db);
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('history'));
    assert.ok(names.includes('scrape_info'));
    assert.ok(!names.includes('users'), 'the hand-rolled identity table is dropped');
    // Derived, not hardcoded, so adding a migration does not break this test.
    assert.deepEqual(appliedVersions(db), MIGRATIONS.map((m) => m.version));
    db.close();
});

test('the cutover retypes jobs.user_id to TEXT', () => {
    const db = new Database(':memory:');
    migrate(db);
    const userIdCol = db.prepare(`PRAGMA table_info("jobs")`).all()
        .find((r: any) => r.name === 'user_id') as { type: string };
    assert.equal(userIdCol.type, 'TEXT');
    db.close();
});

test('migrate is idempotent across repeated runs', () => {
    const db = new Database(':memory:');
    migrate(db);
    const first = appliedVersions(db);
    migrate(db);
    assert.deepEqual(appliedVersions(db), first);
    db.close();
});

test('migrate records version 1 against a database that already has the tables', () => {
    // Production's exact situation: the tables exist, schema_migrations does not.
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL CHECK(role IN ('owner','demo')),
            created_at TEXT NOT NULL
        );
    `);
    migrate(db);
    assert.ok(appliedVersions(db).includes(1));
    db.close();
});

function columnNames(db: Database.Database, table: string): string[] {
    return db.prepare(`PRAGMA table_info("${table}")`).all().map((r: any) => r.name);
}

test('migration 2 creates the Better Auth tables', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = tableNames(db);
    for (const t of ['user', 'session', 'account', 'verification', 'rateLimit']) {
        assert.ok(names.includes(t), `missing table ${t}`);
    }
    assert.ok(appliedVersions(db).includes(2));
    db.close();
});

test('migration 5 drops account.issuer, which Better Auth 1.7.3+ never writes', () => {
    const db = new Database(':memory:');
    migrate(db);
    assert.ok(!columnNames(db, 'account').includes('issuer'));
    const indexes = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'account'`)
        .all()
        .map((r: any) => r.name);
    assert.ok(!indexes.includes('account_issuer_accountId_uidx'));
    db.close();
});

test('migration 5 keeps existing users and accounts', () => {
    // Production's shape before this release: migrated to version 4, issuer present.
    const db = new Database(':memory:');
    for (const m of MIGRATIONS.filter((m) => m.version <= 4)) {
        db.exec(m.sql);
    }
    db.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO schema_migrations VALUES (1, 'x'), (2, 'x'), (3, 'x'), (4, 'x');
        INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "approvalStatus")
            VALUES ('user-1', 'Phil', 'phil@example.test', 1, '2026-09-04', '2026-09-04', 'owner', 'approved');
        INSERT INTO "account" ("id", "issuer", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
            VALUES ('account-1', 'local:credential', 'user-1', 'credential', 'user-1', 'hash', '2026-09-04', '2026-09-04');
    `);
    migrate(db);
    assert.ok(appliedVersions(db).includes(5));
    assert.ok(!columnNames(db, 'account').includes('issuer'));
    assert.deepEqual(
        { ...(db.prepare(`SELECT "providerId", "password" FROM "account" WHERE "id" = ?`).get('account-1') as object) },
        { providerId: 'credential', password: 'hash' },
    );
    assert.equal((db.prepare(`SELECT count(*) AS n FROM "user"`).get() as { n: number }).n, 1);
    db.close();
});

test('the user table carries the server-owned approval fields', () => {
    const db = new Database(':memory:');
    migrate(db);
    const cols = columnNames(db, 'user');
    for (const c of ['role', 'approvalStatus', 'approvedAt', 'approvedBy']) {
        assert.ok(cols.includes(c), `missing user column ${c}`);
    }
    db.close();
});
