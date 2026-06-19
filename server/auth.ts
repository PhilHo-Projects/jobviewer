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
