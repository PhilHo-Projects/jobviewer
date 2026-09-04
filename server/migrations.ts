import type Database from 'better-sqlite3';

type Db = Database.Database;

export interface Migration {
    version: number;
    sql: string;
}

export const MIGRATIONS: Migration[] = [
    // Version 1 shipped before this runner existed, so production databases already
    // carry these tables with no schema_migrations row. IF NOT EXISTS is what lets
    // the runner adopt them instead of failing on the first boot after deploy.
    {
        version: 1,
        sql: `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT NOT NULL CHECK(role IN ('owner','demo')),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                user_id INTEGER NOT NULL,
                id TEXT NOT NULL,
                title TEXT, company TEXT, location TEXT, url TEXT,
                status TEXT, statusSummary TEXT, statusSummaryUpdatedAt TEXT,
                appliedDate TEXT, scrapedDate TEXT, notes TEXT, summary TEXT, posted TEXT,
                PRIMARY KEY (user_id, id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS history (
                user_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                wins TEXT, basePoints INTEGER, scoreMultiplier REAL, totalPoints INTEGER,
                PRIMARY KEY (user_id, date),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS scrape_info (
                user_id INTEGER PRIMARY KEY,
                lastTriggerDate TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `,
    },
    // Better Auth 1.7.1's own schema. Verified against `getMigrations()` output for
    // this app's exact option set — every table, column and index below matches what
    // the library generates, including `rateLimit`, which only appears when
    // `rateLimit.storage` is 'database'.
    //
    // Do NOT regenerate this with `@better-auth/cli`: that package is deprecated and
    // pinned at 1.4.21, and the schema it emits has no `account.issuer` column, which
    // makes sign-up fail at runtime with "table account has no column named issuer".
    //
    // Its identifiers are camelCase and double-quoted while ours are snake_case. Both
    // are correct — `user` is also a SQL reserved word, so it must stay quoted.
    {
        version: 2,
        sql: `
            CREATE TABLE "user" (
                "id" text NOT NULL PRIMARY KEY,
                "name" text NOT NULL,
                "email" text NOT NULL UNIQUE,
                "emailVerified" integer NOT NULL,
                "image" text,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL,
                "username" text UNIQUE,
                "displayUsername" text,
                "role" text NOT NULL,
                "approvalStatus" text NOT NULL,
                "approvedAt" text,
                "approvedBy" text
            );

            CREATE TABLE "session" (
                "id" text NOT NULL PRIMARY KEY,
                "expiresAt" date NOT NULL,
                "token" text NOT NULL UNIQUE,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL,
                "ipAddress" text,
                "userAgent" text,
                "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
            );

            CREATE TABLE "account" (
                "id" text NOT NULL PRIMARY KEY,
                "issuer" text NOT NULL,
                "accountId" text NOT NULL,
                "providerId" text NOT NULL,
                "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
                "accessToken" text,
                "refreshToken" text,
                "idToken" text,
                "accessTokenExpiresAt" date,
                "refreshTokenExpiresAt" date,
                "scope" text,
                "password" text,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL
            );

            CREATE TABLE "verification" (
                "id" text NOT NULL PRIMARY KEY,
                "identifier" text NOT NULL,
                "value" text NOT NULL,
                "expiresAt" date NOT NULL,
                "createdAt" date NOT NULL,
                "updatedAt" date NOT NULL
            );

            CREATE TABLE "rateLimit" (
                "id" text NOT NULL PRIMARY KEY,
                "key" text NOT NULL UNIQUE,
                "count" integer NOT NULL,
                "lastRequest" bigint NOT NULL
            );

            CREATE INDEX "session_userId_idx" ON "session" ("userId");
            CREATE INDEX "account_userId_idx" ON "account" ("userId");
            CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
            CREATE UNIQUE INDEX "account_issuer_accountId_uidx"
                ON "account" ("issuer", "accountId");
        `,
    },
    // The identity cutover. Better Auth's "user" becomes the only identity table.
    //
    // The carried-over rows cannot be inserted here: their new user_id is the owner's
    // Better Auth id, which does not exist until ensureOwner runs at boot, and that
    // cannot run before migration 2 created the tables it needs. So the rows are parked
    // in FK-free holding tables and drained by an idempotent boot step instead.
    {
        version: 3,
        sql: `
            CREATE TABLE legacy_owner_jobs AS
                SELECT * FROM jobs WHERE user_id IN (SELECT id FROM users WHERE role='owner');
            CREATE TABLE legacy_owner_history AS
                SELECT * FROM history WHERE user_id IN (SELECT id FROM users WHERE role='owner');
            CREATE TABLE legacy_owner_scrape_info AS
                SELECT * FROM scrape_info WHERE user_id IN (SELECT id FROM users WHERE role='owner');

            DROP TABLE jobs;
            DROP TABLE history;
            DROP TABLE scrape_info;
            DROP TABLE users;

            CREATE TABLE jobs (
                user_id TEXT NOT NULL REFERENCES "user"("id"),
                id TEXT NOT NULL,
                title TEXT, company TEXT, location TEXT, url TEXT,
                status TEXT, statusSummary TEXT, statusSummaryUpdatedAt TEXT,
                appliedDate TEXT, scrapedDate TEXT, notes TEXT, summary TEXT, posted TEXT,
                PRIMARY KEY (user_id, id)
            );
            CREATE TABLE history (
                user_id TEXT NOT NULL REFERENCES "user"("id"),
                date TEXT NOT NULL,
                wins TEXT, basePoints INTEGER, scoreMultiplier REAL, totalPoints INTEGER,
                PRIMARY KEY (user_id, date)
            );
            CREATE TABLE scrape_info (
                user_id TEXT PRIMARY KEY REFERENCES "user"("id"),
                lastTriggerDate TEXT
            );

            CREATE INDEX jobs_user_idx ON jobs(user_id);
        `,
    },
    // Per-user scrape delivery. The app, not n8n, decides whose board a batch lands on.
    {
        version: 4,
        sql: `
            CREATE TABLE scrape_runs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES "user"("id"),
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                consumed_at TEXT
            );
            CREATE INDEX scrape_runs_user_idx ON scrape_runs(user_id, created_at);
        `,
    },
];

export function appliedVersions(db: Db): number[] {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    return db
        .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
        .all()
        .map((r: any) => r.version as number);
}

/**
 * Apply every migration this database has not recorded yet. Each step runs in its own
 * transaction and records its version in that same transaction, so a crash mid-upgrade
 * leaves the database at the last fully applied version rather than half-migrated.
 */
export function migrate(db: Db): void {
    const done = new Set(appliedVersions(db));
    for (const migration of MIGRATIONS) {
        if (done.has(migration.version)) continue;
        const apply = db.transaction(() => {
            db.exec(migration.sql);
            db.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`)
                .run(migration.version, new Date().toISOString());
        });
        apply();
    }
}
