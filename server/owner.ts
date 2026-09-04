import type { Db } from './db.js';
import type { AppAuth } from './auth.js';
import type { AppConfig } from './config.js';

interface EnsureOwnerOptions {
    auth: AppAuth;
    db: Db;
    config: AppConfig;
    log?: (message: string) => void;
}

/**
 * Create the owner account on first boot.
 *
 * The configured password is used exactly once. If an owner row already exists the
 * `OWNER_*` variables are ignored entirely — this is a bootstrap, never a standing back
 * door that silently resets the owner's password on every deploy. Recovery, if ever
 * needed, is a deliberate script run against the SQLite file over SSH.
 *
 * Returns the owner's user id.
 */
export async function ensureOwner({
    auth, db, config, log,
}: EnsureOwnerOptions): Promise<string> {
    const existing = db
        .prepare(`SELECT "id" FROM "user" WHERE "role" = 'owner' LIMIT 1`)
        .get() as { id?: string } | undefined;

    if (existing?.id) {
        // Still drain: the holding tables may have been created by migration 3 on a
        // boot where the owner already existed.
        drainLegacyRows(db, existing.id, log);
        return existing.id;
    }

    // Created through Better Auth's own sign-up API so the credential hash format is
    // identical to every other account's, rather than a second thing to keep in step.
    await auth.api.signUpEmail({
        body: {
            email: config.ownerEmail,
            name: config.ownerUsername,
            password: config.ownerPassword,
            username: config.ownerUsername,
        },
    });

    const created = db
        .prepare('SELECT "id" FROM "user" WHERE "username" = ?')
        .get(config.ownerUsername) as { id: string };

    // `role` and `approvalStatus` are `input: false`, so they cannot be set through the
    // sign-up body — deliberately, since that is what stops anyone else setting them.
    // The owner is promoted here instead.
    db.prepare(
        `UPDATE "user" SET "role" = 'owner', "approvalStatus" = 'approved', "approvedAt" = ?
         WHERE "id" = ?`,
    ).run(new Date().toISOString(), created.id);

    log?.(`seeded owner account "${config.ownerUsername}"`);
    drainLegacyRows(db, created.id, log);
    return created.id;
}

/**
 * Idempotent backfill of the rows parked by migration 3. No-ops once the holding
 * tables are empty, which is every boot after the first.
 */
function drainLegacyRows(db: Db, ownerId: string, log?: (m: string) => void): void {
    const has = (table: string): boolean =>
        !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);

    const move = db.transaction(() => {
        let moved = 0;
        if (has('legacy_owner_jobs')) {
            moved += db.prepare(
                `INSERT OR IGNORE INTO jobs
                 SELECT ?, id, title, company, location, url, status, statusSummary,
                        statusSummaryUpdatedAt, appliedDate, scrapedDate, notes, summary, posted
                 FROM legacy_owner_jobs`,
            ).run(ownerId).changes;
            db.prepare('DELETE FROM legacy_owner_jobs').run();
        }
        if (has('legacy_owner_history')) {
            db.prepare(
                `INSERT OR IGNORE INTO history
                 SELECT ?, date, wins, basePoints, scoreMultiplier, totalPoints
                 FROM legacy_owner_history`,
            ).run(ownerId);
            db.prepare('DELETE FROM legacy_owner_history').run();
        }
        if (has('legacy_owner_scrape_info')) {
            db.prepare(
                `INSERT OR IGNORE INTO scrape_info
                 SELECT ?, lastTriggerDate FROM legacy_owner_scrape_info`,
            ).run(ownerId);
            db.prepare('DELETE FROM legacy_owner_scrape_info').run();
        }
        return moved;
    });

    const moved = move();
    if (moved > 0) log?.(`adopted ${moved} legacy job row(s)`);
}
