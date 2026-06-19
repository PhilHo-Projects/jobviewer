import type { Db } from './db.js';
import type { SessionUser } from '../shared/types.js';

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
