/**
 * Pure account logic: no DOM, and deliberately no `better-auth/client` import.
 * That module builds a client at load time, which would make this awkward to
 * import under `node --test` — and this is the half of the account surface where
 * a bug is silent, so it is the half that gets tests.
 */

/** Mirrors `minPasswordLength` on the server. Shown in forms, enforced there. */
export const MIN_PASSWORD_LENGTH = 12;
export const MIN_USERNAME_LENGTH = 3;

export type PasswordProblem =
    | null
    | 'missing-current'
    | 'too-short'
    | 'mismatch'
    | 'unchanged';

/**
 * The client-side gate on the change-password form. The server checks all of it
 * again; this exists so the ordinary mistakes cost no round trip. Length is
 * reported before mismatch because it is the more actionable of the two.
 */
export function validatePasswordChange(
    current: string,
    next: string,
    confirm: string,
): PasswordProblem {
    if (!current) return 'missing-current';
    if (next.length < MIN_PASSWORD_LENGTH) return 'too-short';
    if (next !== confirm) return 'mismatch';
    if (next === current) return 'unchanged';
    return null;
}

export function passwordProblemMessage(problem: PasswordProblem): string {
    switch (problem) {
        case 'missing-current':
            return 'Enter your current password.';
        case 'too-short':
            return `New passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        case 'mismatch':
            return 'The two new passwords do not match.';
        case 'unchanged':
            return 'The new password is the same as the current one.';
        default:
            return '';
    }
}

/**
 * A coarse "Chrome on Windows" for a session row. Deliberately coarse — this
 * labels a list entry, it is not analytics. Order matters in both ladders:
 * an Edge user-agent also carries Chrome and Safari, and an Android one also
 * carries Linux.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
    if (!userAgent) return 'Unknown device';
    const ua = userAgent;

    const browser =
        /\bEdgA?\//.test(ua) ? 'Edge'
        : /\bOPR\/|\bOpera\b/.test(ua) ? 'Opera'
        : /\bFirefox\//.test(ua) ? 'Firefox'
        : /\bChrome\//.test(ua) ? 'Chrome'
        : /\bSafari\//.test(ua) ? 'Safari'
        : null;

    const os =
        /\bWindows\b/.test(ua) ? 'Windows'
        : /\biPhone\b|\biPad\b/.test(ua) ? 'iOS'
        : /\bAndroid\b/.test(ua) ? 'Android'
        : /Mac OS X|\bMacintosh\b/.test(ua) ? 'macOS'
        : /\bLinux\b/.test(ua) ? 'Linux'
        : null;

    if (browser && os) return `${browser} on ${os}`;
    return browser ?? os ?? 'Unknown device';
}

const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * "3 Sep 2026". Hand-rolled rather than `Intl`, whose short month names for
 * en-GB have moved between ICU versions ("Sep" vs "Sept") and would make this
 * untestable by exact match. Read in UTC, matching `todayIso()` and the server's
 * own day boundary, so the label does not depend on the reader's timezone.
 */
export function formatDate(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The `YYYY-MM-DD` the scrape limit is counted in. */
export function todayIso(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * The scrape button's disabled rule, stated once so the button and the account
 * panel cannot disagree about it.
 */
export function scrapeUsedToday(
    lastTriggerDate: string | null | undefined,
    today: string,
): boolean {
    return !!lastTriggerDate && lastTriggerDate === today;
}

export interface AccountUser {
    username: string | null;
    email: string | null;
    createdAt: string | null;
    role: string | null;
    approvalStatus: string | null;
}

/**
 * Narrow Better Auth's loosely-typed session user down to what this UI shows, so
 * no component has to cast inline. `createdAt` arrives as a Date from the client
 * and as a string from anywhere else, so both are accepted.
 */
export function toAccountUser(raw: unknown): AccountUser {
    const u = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
    const iso = (v: unknown): string | null =>
        v instanceof Date ? v.toISOString() : str(v);

    return {
        username: str(u.username) ?? str(u.name),
        email: str(u.email),
        createdAt: iso(u.createdAt),
        role: str(u.role),
        approvalStatus: str(u.approvalStatus),
    };
}
