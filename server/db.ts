import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { migrate } from './migrations.js';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
}
