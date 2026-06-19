import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): string {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
    if (!stored || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    let salt: Buffer;
    let expected: Buffer;
    try {
        salt = Buffer.from(parts[1], 'hex');
        expected = Buffer.from(parts[2], 'hex');
    } catch {
        return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = crypto.scryptSync(plain, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSessionToken(userId: number, secret: string, ttlMs: number = SESSION_TTL_MS): string {
    const expiry = Date.now() + ttlMs;
    const uidB64 = Buffer.from(String(userId)).toString('base64url');
    const payload = `${uidB64}.${expiry}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): { userId: number } | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [uidB64, expiryStr, sig] = parts;

    // BUG FIX: reject anything not exactly 64 lowercase hex chars BEFORE Buffer.from(hex),
    // which would otherwise silently truncate a trailing junk char and let a tampered token pass.
    if (!/^[0-9a-f]{64}$/.test(sig)) return null;

    const payload = `${uidB64}.${expiryStr}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

    const userId = Number(Buffer.from(uidB64, 'base64url').toString('utf8'));
    if (!Number.isInteger(userId)) return null;
    return { userId };
}

export const COOKIE_NAME = 'jv_session';

export function loadOrCreateSecret(dataDir: string): string {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const secretPath = path.join(dataDir, 'session.secret');
    if (fs.existsSync(secretPath)) {
        const existing = fs.readFileSync(secretPath, 'utf8').trim();
        if (existing) return existing;
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretPath, secret, 'utf8');
    return secret;
}

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

function cookieFlags(basePath: string): string {
    const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    return ` HttpOnly; SameSite=Lax;${secure} Path=${basePath}`;
}

export function buildSessionCookie(token: string, basePath: string): string {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `${COOKIE_NAME}=${token};${cookieFlags(basePath)}; Max-Age=${maxAge}`;
}

export function buildClearCookie(basePath: string): string {
    return `${COOKIE_NAME}=;${cookieFlags(basePath)}; Max-Age=0`;
}
