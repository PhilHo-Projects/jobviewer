import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MIN_PASSWORD_LENGTH,
    validatePasswordChange,
    passwordProblemMessage,
    deviceLabel,
    formatDate,
    scrapeUsedToday,
    toAccountUser,
} from './account.ts';

const GOOD = 'correct-horse-battery';

test('validatePasswordChange accepts a well-formed change', () => {
    assert.equal(validatePasswordChange('old-password-1', GOOD, GOOD), null);
});

test('validatePasswordChange requires the current password', () => {
    assert.equal(validatePasswordChange('', GOOD, GOOD), 'missing-current');
});

test('validatePasswordChange rejects a new password under the minimum', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    assert.equal(validatePasswordChange('old-password-1', short, short), 'too-short');
});

test('validatePasswordChange rejects a mismatched confirmation', () => {
    assert.equal(validatePasswordChange('old-password-1', GOOD, GOOD + 'x'), 'mismatch');
});

test('validatePasswordChange rejects a new password equal to the current one', () => {
    assert.equal(validatePasswordChange(GOOD, GOOD, GOOD), 'unchanged');
});

test('validatePasswordChange reports length before mismatch', () => {
    // Length is the more actionable message when both are wrong.
    assert.equal(validatePasswordChange('old-password-1', 'short', 'different'), 'too-short');
});

test('passwordProblemMessage is empty only when there is no problem', () => {
    assert.equal(passwordProblemMessage(null), '');
    for (const p of ['missing-current', 'too-short', 'mismatch', 'unchanged'] as const) {
        assert.ok(passwordProblemMessage(p).length > 0, `no message for ${p}`);
    }
});

test('deviceLabel names browser and OS', () => {
    const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    assert.equal(deviceLabel(chromeWin), 'Chrome on Windows');
});

test('deviceLabel prefers Edge over the Chrome and Safari tokens it also carries', () => {
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
    assert.equal(deviceLabel(edge), 'Edge on Windows');
});

test('deviceLabel prefers Android over the Linux token it also carries', () => {
    const android = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
    assert.equal(deviceLabel(android), 'Chrome on Android');
});

test('deviceLabel identifies Safari on macOS', () => {
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    assert.equal(deviceLabel(safari), 'Safari on macOS');
});

test('deviceLabel falls back rather than throwing', () => {
    assert.equal(deviceLabel(null), 'Unknown device');
    assert.equal(deviceLabel(''), 'Unknown device');
    assert.equal(deviceLabel('curl/8.0'), 'Unknown device');
});

test('formatDate renders a short human date', () => {
    // Read in UTC, so this holds on any machine's clock — including CI's.
    assert.equal(formatDate('2026-09-03T12:00:00Z'), '3 Sep 2026');
    assert.equal(formatDate('2026-01-31T23:59:00Z'), '31 Jan 2026');
});

test('formatDate accepts a Date, because the auth client hands back Dates', () => {
    assert.equal(formatDate(new Date('2026-09-03T12:00:00Z')), '3 Sep 2026');
});

test('formatDate returns a dash for missing or unparseable input', () => {
    assert.equal(formatDate(null), '—');
    assert.equal(formatDate(undefined), '—');
    assert.equal(formatDate('not a date'), '—');
});

test('scrapeUsedToday matches the scrape button rule', () => {
    assert.equal(scrapeUsedToday('2026-09-04', '2026-09-04'), true);
    assert.equal(scrapeUsedToday('2026-09-03', '2026-09-04'), false);
    assert.equal(scrapeUsedToday(null, '2026-09-04'), false);
    assert.equal(scrapeUsedToday(undefined, '2026-09-04'), false);
});

test('toAccountUser keeps the fields the panel shows', () => {
    const user = toAccountUser({
        username: 'phil',
        name: 'Phil',
        email: 'phil@example.com',
        createdAt: '2026-09-03T12:00:00Z',
        role: 'owner',
        approvalStatus: 'approved',
    });
    assert.deepEqual(user, {
        username: 'phil',
        email: 'phil@example.com',
        createdAt: '2026-09-03T12:00:00Z',
        role: 'owner',
        approvalStatus: 'approved',
    });
});

test('toAccountUser falls back to name and normalises a Date createdAt', () => {
    const user = toAccountUser({ name: 'Phil', createdAt: new Date('2026-09-03T12:00:00Z') });
    assert.equal(user.username, 'Phil');
    assert.equal(user.createdAt, '2026-09-03T12:00:00.000Z');
});

test('toAccountUser survives null, undefined and junk', () => {
    for (const raw of [null, undefined, 42, 'nope']) {
        const user = toAccountUser(raw);
        assert.deepEqual(user, {
            username: null, email: null, createdAt: null, role: null, approvalStatus: null,
        });
    }
});
