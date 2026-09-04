import type { Express, Response } from 'express';
import type { Db } from './db.js';
import { requireOwner, type AuthedRequest } from './guards.js';

/**
 * Owner-only. The `requireOwner` guard already turns members and anonymous callers
 * away, so these handlers only have to do the work.
 */
export function registerAdminRoutes(app: Express, db: Db): void {
    app.get('/api/admin/users', requireOwner, (req: AuthedRequest, res: Response) => {
        const status = req.query.status === 'all' ? 'all' : 'pending';
        // An explicit column list, never SELECT *: the user table holds fields with no
        // business on the wire, so a column added later must be opted in deliberately.
        const users = db.prepare(
            `SELECT u."id", u."username", u."displayUsername", u."email", u."createdAt",
                    u."approvalStatus", u."role", u."approvedAt",
                    (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u."id") AS jobCount
             FROM "user" u
             ${status === 'pending' ? `WHERE u."approvalStatus" = 'pending'` : ''}
             ORDER BY CASE u."approvalStatus" WHEN 'pending' THEN 0 ELSE 1 END,
                      u."createdAt" DESC`,
        ).all();
        res.json({ users });
    });

    const setStatus = (next: 'approved' | 'rejected') =>
        (req: AuthedRequest, res: Response): void => {
            const id = String(req.params.id);
            const target = db.prepare('SELECT "id","role" FROM "user" WHERE "id" = ?')
                .get(id) as { id: string; role: string } | undefined;
            if (!target) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            // The owner cannot lock themselves out of their own admin panel.
            if (target.role === 'owner') {
                res.status(409).json({ error: 'The owner cannot be changed' });
                return;
            }

            db.prepare(
                `UPDATE "user" SET "approvalStatus" = ?, "approvedAt" = ?, "approvedBy" = ?
                 WHERE "id" = ?`,
            ).run(next, new Date().toISOString(), req.user?.id ?? null, id);

            // Revocation is the whole point of server-side sessions: a rejected user's
            // live session dies now rather than lasting until its token expires.
            if (next === 'rejected') {
                db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(id);
            }

            res.json({ id, approvalStatus: next });
        };

    app.post('/api/admin/users/:id/approve', requireOwner, setStatus('approved'));
    app.post('/api/admin/users/:id/reject', requireOwner, setStatus('rejected'));
}

/** Pending accounts awaiting the owner's decision. Zero for everyone but the owner. */
export function pendingCount(db: Db): number {
    return (db
        .prepare(`SELECT COUNT(*) AS n FROM "user" WHERE "approvalStatus"='pending'`)
        .get() as { n: number }).n;
}
