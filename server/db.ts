import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type Db = Database.Database;

export function initSchema(db: Db): void {
    db.exec(`
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
            title TEXT,
            company TEXT,
            location TEXT,
            url TEXT,
            status TEXT,
            statusSummary TEXT,
            statusSummaryUpdatedAt TEXT,
            appliedDate TEXT,
            scrapedDate TEXT,
            notes TEXT,
            summary TEXT,
            posted TEXT,
            PRIMARY KEY (user_id, id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS history (
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            wins TEXT,
            basePoints INTEGER,
            scoreMultiplier REAL,
            totalPoints INTEGER,
            PRIMARY KEY (user_id, date),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS scrape_info (
            user_id INTEGER PRIMARY KEY,
            lastTriggerDate TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);
}

export function openDb(dbPath: string): Db {
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    return db;
}
