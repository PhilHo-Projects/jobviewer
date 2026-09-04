import crypto from 'crypto';
import type { Db } from './db.js';

export function createRun(db: Db, userId: string): string {
    const id = crypto.randomUUID();
    db.prepare(
        `INSERT INTO scrape_runs (id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)`,
    ).run(id, userId, new Date().toISOString());
    return id;
}

/**
 * Resolve a delivery. Returns the owning user's id and marks the run delivered, or
 * null when the run is unknown, already consumed, or past its window.
 *
 * Expiry is computed, never stored: there is no third status and no sweeper job. A
 * stale pending row is simply never accepted again, and it still counts toward the
 * daily caps — correct, because the Apify run it paid for did happen.
 */
export function claimRun(db: Db, runId: string, expiryMinutes: number): string | null {
    const row = db
        .prepare(`SELECT user_id, status, created_at FROM scrape_runs WHERE id = ?`)
        .get(runId) as { user_id: string; status: string; created_at: string } | undefined;

    if (!row || row.status !== 'pending') return null;

    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > expiryMinutes * 60 * 1000) return null;

    db.prepare(`UPDATE scrape_runs SET status='delivered', consumed_at=? WHERE id=?`)
        .run(new Date().toISOString(), runId);
    return row.user_id;
}

function today(): string {
    return new Date().toISOString().split('T')[0];
}

export function countRunsToday(db: Db): number {
    return (db
        .prepare(`SELECT COUNT(*) AS n FROM scrape_runs WHERE substr(created_at,1,10) = ?`)
        .get(today()) as { n: number }).n;
}

export function countUserRunsToday(db: Db, userId: string): number {
    return (db
        .prepare(
            `SELECT COUNT(*) AS n FROM scrape_runs
             WHERE user_id = ? AND substr(created_at,1,10) = ?`,
        )
        .get(userId, today()) as { n: number }).n;
}
