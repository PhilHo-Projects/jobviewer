import crypto from 'crypto';
import type { Db } from './db.js';
import type { Job, SessionUser } from '../shared/types.js';

interface UserRow {
    id: number;
    username: string;
    role: 'owner' | 'demo';
    password_hash: string | null;
}

export function getUserById(db: Db, id: number): SessionUser | null {
    const row = db.prepare(`SELECT id, username, role FROM users WHERE id=?`).get(id) as
        | SessionUser
        | undefined;
    return row ?? null;
}

export function getDemoUser(db: Db): SessionUser | null {
    const row = db.prepare(`SELECT id, username, role FROM users WHERE role='demo'`).get() as
        | SessionUser
        | undefined;
    return row ?? null;
}

export function getOwnerUser(db: Db): SessionUser | null {
    const row = db.prepare(`SELECT id, username, role FROM users WHERE role='owner'`).get() as
        | SessionUser
        | undefined;
    return row ?? null;
}

export function getUserByUsername(db: Db, username: string): UserRow | null {
    const row = db
        .prepare(`SELECT id, username, role, password_hash FROM users WHERE username=?`)
        .get(username) as UserRow | undefined;
    return row ?? null;
}

const JOB_COLUMNS = [
    'id', 'title', 'company', 'location', 'url', 'status', 'statusSummary',
    'statusSummaryUpdatedAt', 'appliedDate', 'scrapedDate', 'notes', 'summary', 'posted',
] as const;

function createStableJobId(job: Partial<Job>): string {
    const basis = [job.url, job.title, job.company, job.location, job.posted]
        .filter(Boolean)
        .join('|');
    return crypto.createHash('sha1').update(basis || JSON.stringify(job)).digest('hex');
}

function normalizeIncomingJob(job: Partial<Job>): Job {
    const nowIso = new Date().toISOString();
    return {
        ...job,
        id: job.id || createStableJobId(job),
        title: job.title || '',
        company: job.company || '',
        status: job.status || 'new',
        statusSummary: job.statusSummary || 'New Job',
        statusSummaryUpdatedAt: job.statusSummaryUpdatedAt || nowIso,
        notes: typeof job.notes === 'string' ? job.notes : '',
        scrapedDate: job.scrapedDate || nowIso,
        appliedDate: job.appliedDate ?? null,
    };
}

function mergeJob(existing: Job, incoming: Job): Job {
    return {
        ...existing,
        ...incoming,
        status: existing.status || incoming.status || 'new',
        statusSummary: existing.statusSummary || incoming.statusSummary || 'New Job',
        notes: typeof existing.notes === 'string' && existing.notes !== ''
            ? existing.notes
            : (typeof incoming.notes === 'string' ? incoming.notes : ''),
        scrapedDate: existing.scrapedDate || incoming.scrapedDate,
        appliedDate: existing.appliedDate || incoming.appliedDate || null,
    };
}

function toRow(userId: number, job: Job): Record<string, unknown> {
    const row: Record<string, unknown> = { user_id: userId };
    for (const col of JOB_COLUMNS) {
        row[col] = (job as any)[col] ?? null;
    }
    return row;
}

function rowToJob(row: any): Job {
    const job: any = {};
    for (const col of JOB_COLUMNS) job[col] = row[col];
    return job as Job;
}

export function getJobs(db: Db, userId: number): Job[] {
    const rows = db.prepare(`SELECT * FROM jobs WHERE user_id=?`).all(userId);
    return rows.map(rowToJob);
}

export function getJobById(db: Db, userId: number, id: string): Job | null {
    const row = db.prepare(`SELECT * FROM jobs WHERE user_id=? AND id=?`).get(userId, id);
    return row ? rowToJob(row) : null;
}

export function upsertJobs(db: Db, userId: number, incoming: Partial<Job>[]): Job[] {
    const cols = JOB_COLUMNS.map((c) => c).join(', ');
    const placeholders = JOB_COLUMNS.map((c) => `@${c}`).join(', ');
    const insert = db.prepare(
        `INSERT INTO jobs (user_id, ${cols}) VALUES (@user_id, ${placeholders})`
    );
    const update = db.prepare(
        `UPDATE jobs SET ${JOB_COLUMNS.filter((c) => c !== 'id')
            .map((c) => `${c}=@${c}`)
            .join(', ')} WHERE user_id=@user_id AND id=@id`
    );
    const tx = db.transaction((rows: Partial<Job>[]) => {
        for (const raw of rows) {
            const j = normalizeIncomingJob(raw);
            const existing = getJobById(db, userId, j.id);
            const final = existing ? mergeJob(existing, j) : j;
            if (existing) update.run(toRow(userId, final));
            else insert.run(toRow(userId, final));
        }
    });
    tx(incoming);
    return getJobs(db, userId);
}

export function patchJob(
    db: Db,
    userId: number,
    id: string,
    patch: Partial<Job>
): Job | null {
    const existing = getJobById(db, userId, id);
    if (!existing) return null;
    const next: Job = { ...existing };
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.statusSummary !== undefined) {
        next.statusSummary = patch.statusSummary;
        next.statusSummaryUpdatedAt = new Date().toISOString();
    }
    if (patch.notes !== undefined) next.notes = patch.notes;
    if (patch.appliedDate !== undefined) next.appliedDate = patch.appliedDate;
    db.prepare(
        `UPDATE jobs SET ${JOB_COLUMNS.filter((c) => c !== 'id')
            .map((c) => `${c}=@${c}`)
            .join(', ')} WHERE user_id=@user_id AND id=@id`
    ).run(toRow(userId, next));
    return next;
}

export function bulkMove(db: Db, userId: number, from: string, to: string): number {
    const info = db
        .prepare(`UPDATE jobs SET status=? WHERE user_id=? AND status=?`)
        .run(to, userId, from);
    return info.changes;
}

export function deleteByStatus(db: Db, userId: number, status: string): number {
    const info = db
        .prepare(`DELETE FROM jobs WHERE user_id=? AND status=?`)
        .run(userId, status);
    return info.changes;
}
