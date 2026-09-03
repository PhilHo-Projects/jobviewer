import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { hashPassword } from './auth.js';
import { migrate } from './migrations.js';
import { upsertJobs, insertHistory, setScrapeInfo, getJobs, getDemoUser } from './repo.js';
import type { Job, HistoryEntry } from '../shared/types.js';

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

export interface SeedOptions {
    adminUsername?: string;
    adminPassword?: string;
}

const DEFAULT_USERNAME = 'me';
const DEFAULT_PASSWORD = '0000';

export function seedUsers(db: Db, opts: SeedOptions = {}): void {
    const adminUsername = opts.adminUsername || process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
    const adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
    const now = new Date().toISOString();

    const owner = db.prepare(`SELECT * FROM users WHERE role='owner'`).get() as
        | { id: number; username: string; password_hash: string | null }
        | undefined;

    if (!owner) {
        db.prepare(
            `INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'owner', ?)`
        ).run(adminUsername, hashPassword(adminPassword), now);
    } else {
        if (owner.username === DEFAULT_USERNAME && adminUsername !== DEFAULT_USERNAME) {
            db.prepare(`UPDATE users SET username=? WHERE id=?`).run(adminUsername, owner.id);
        }
        if (!owner.password_hash) {
            db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(
                hashPassword(adminPassword),
                owner.id
            );
        }
        db.prepare(`UPDATE users SET role='owner' WHERE id=?`).run(owner.id);
    }

    const demo = db.prepare(`SELECT id FROM users WHERE role='demo'`).get();
    if (!demo) {
        db.prepare(
            `INSERT INTO users (username, password_hash, role, created_at) VALUES ('demo', NULL, 'demo', ?)`
        ).run(now);
    }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/** One-time, idempotent import of the legacy flat-JSON files into the owner's rows. */
export function migrateFromJson(db: Db, ownerId: number, cwd: string): void {
    if (getJobs(db, ownerId).length > 0) return; // already migrated / has data

    const jobs = readJsonFile<Job[]>(path.join(cwd, 'jobs.json'), []);
    if (Array.isArray(jobs) && jobs.length > 0) {
        upsertJobs(db, ownerId, jobs);
    }

    const history = readJsonFile<HistoryEntry[]>(path.join(cwd, 'history.json'), []);
    if (Array.isArray(history)) {
        // Skip legacy/malformed rows that predate the current HistoryEntry shape
        // (older history.json files used weekRange/percent and have no `date`).
        for (const entry of history) {
            if (entry && typeof (entry as any).date === 'string' && (entry as any).date) {
                insertHistory(db, ownerId, entry);
            }
        }
    }

    const scrape = readJsonFile<{ lastTriggerDate: string | null }>(
        path.join(cwd, 'scrape_info.json'),
        { lastTriggerDate: null }
    );
    if (scrape && scrape.lastTriggerDate) setScrapeInfo(db, ownerId, scrape.lastTriggerDate);
}

/** Seed the demo user's frozen sample jobs from public-sample.json (idempotent). */
export function seedDemoJobs(db: Db, samplePath: string): void {
    const demo = getDemoUser(db);
    if (!demo) return;
    if (getJobs(db, demo.id).length > 0) return; // already seeded
    const sample = readJsonFile<Job[]>(samplePath, []);
    if (Array.isArray(sample) && sample.length > 0) {
        upsertJobs(db, demo.id, sample);
    }
}
