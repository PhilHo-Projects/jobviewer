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
