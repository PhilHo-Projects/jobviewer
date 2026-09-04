import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { buildAuth, type AppAuth } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { ensureOwner } from './owner.js';
import { createApp } from './app.js';
import { openDb, type Db } from './db.js';

export const OWNER_PASSWORD = 'owner-correct-horse';
export const MEMBER_PASSWORD = 'correct-horse-battery';

export interface Harness {
    db: Db;
    auth: AppAuth;
    config: AppConfig;
    base: string;
    origin: string;
    ownerId: string;
    close(): void;
}

/**
 * Reserve a port before building the app.
 *
 * Better Auth validates requests against `baseURL`, and the Origin check is an exact
 * string compare against `publicOrigin` — so both must be known before `createApp`,
 * which rules out the usual `listen(0)`-then-read-the-port order.
 */
async function reservePort(): Promise<number> {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
}

export async function startApp(): Promise<Harness> {
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;

    // openDb applies the pragmas and runs every migration, exactly as boot does.
    const db = openDb(':memory:');

    const config = loadConfig({
        NODE_ENV: 'test',
        PUBLIC_ORIGIN: origin,
        SESSION_SECRET: '0123456789abcdef0123456789abcdef',
        OWNER_USERNAME: 'phil',
        OWNER_EMAIL: 'owner@example.test',
        OWNER_PASSWORD,
        WEBHOOK_SECRET: 'wh-secret',
        DATA_DIR: '.',
    });

    const auth = buildAuth({ db, config });
    const ownerId = await ensureOwner({ auth, db, config });

    const app = createApp(db, { auth, config });
    const server = app.listen(port, '127.0.0.1');
    await once(server, 'listening');

    return {
        db, auth, config, ownerId, origin,
        base: `${origin}/api`,
        close: () => { server.close(); db.close(); },
    };
}

/** Sign up a member through the real API. Returns the new user's id. */
export async function signUpMember(h: Harness, username: string): Promise<string> {
    const res = await fetch(`${h.origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: h.origin },
        body: JSON.stringify({
            email: `${username}@example.test`,
            name: username,
            password: MEMBER_PASSWORD,
            username,
        }),
    });
    if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const row = h.db.prepare('SELECT "id" FROM "user" WHERE "username"=?')
        .get(username) as { id: string };
    return row.id;
}

/** Approve an account directly, for suites that are not testing the admin routes. */
export function approve(h: Harness, userId: string): void {
    h.db.prepare(`UPDATE "user" SET "approvalStatus"='approved' WHERE "id"=?`).run(userId);
}

/** Sign in and return a Cookie header value. */
export async function signIn(
    h: Harness, username: string, password: string = MEMBER_PASSWORD,
): Promise<string> {
    const res = await fetch(`${h.origin}/api/auth/sign-in/username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: h.origin },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    const raw = res.headers.get('set-cookie') || '';
    return raw.split(';')[0];
}
