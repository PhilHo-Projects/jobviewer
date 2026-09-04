# Account Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every signed-in user a header identity chip, a dropdown menu, and an Account modal holding identity, daily scrape budget, change-password and active sessions.

**Architecture:** Frontend-only. Pure logic (validation, formatting, user-agent labels) lives in `src/ts/account.ts` with unit tests; DOM behaviour lives in two new components under `src/ts/components/`; markup skeletons go in `index.html` beside every other modal, with dynamic rows rendered from TypeScript exactly as `admin.ts` already does. Every auth call is a built-in Better Auth route already mounted at `/api/auth/*`.

**Tech Stack:** Vanilla TypeScript, Vite 5, Tailwind 3, `better-auth/client` 1.7.1 with `usernameClient()`, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-04-account-surface-design.md`

## Global Constraints

- **No server changes.** Nothing under `server/` is edited by this plan. If a task appears to need one, stop and raise it.
- **Exactly two roles:** `owner` and `member`. Do not introduce a third, and do not add role editing.
- **Design system, not a second one:** 2px black borders, `shadow-[2px_2px_0_#000]` (4px on the menu and primary buttons), square corners, `uppercase tracking-widest` labels at `text-[10px]`/`text-xs`, `emerald-400` for accent and affirmative, `#ff0040` for destructive.
- **One theme only** — `:root`, no `[data-theme]` variants. Use the existing `.text-theme-*` / `.bg-theme-*` utilities rather than hardcoding hex, except for the `#ff0040` and `emerald-400` accents named above.
- **Defined theme utilities are:** `.text-theme-primary`, `.text-theme-secondary`, `.text-theme-muted`, `.text-theme-accent`, `.bg-theme-body`, `.bg-theme-header`, `.bg-theme-column`, `.bg-theme-card`, `.bg-theme-input`, `.bg-theme-accent`, `.bg-theme-button`, `.border-theme-border`, `.border-theme-column`. **`bg-theme-surface` does not exist** — never use it.
- **Minimum password length is 12**, mirroring `minPasswordLength` on the server.
- **Never put `hidden` and `flex` on the same element.** Both are display utilities and which wins depends on Tailwind's output order. Use a block element with an inner flex `<span>`, or toggle both classes together as `authModal.ts` does.
- **Verification after every task:** `npm test && npm run build`. The 79 existing server tests must stay green.

---

### Task 1: Pure account logic, and a verification gate that can see it

The frontend is typechecked by nothing today and tested by nothing. This task fixes both, then uses them — every later task depends on `npm run build` actually catching a frontend type error.

**Files:**
- Create: `src/ts/account.ts`
- Create: `src/ts/account.test.ts`
- Modify: `package.json` (the `test` and `build` scripts)
- Modify: `src/ts/auth.ts` (re-export the two constants that move)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MIN_PASSWORD_LENGTH: number` (12), `MIN_USERNAME_LENGTH: number` (3)
  - `type PasswordProblem = null | 'missing-current' | 'too-short' | 'mismatch' | 'unchanged'`
  - `validatePasswordChange(current: string, next: string, confirm: string): PasswordProblem`
  - `passwordProblemMessage(problem: PasswordProblem): string`
  - `deviceLabel(userAgent: string | null | undefined): string`
  - `formatDate(value: string | Date | null | undefined): string`
  - `todayIso(): string`
  - `scrapeUsedToday(lastTriggerDate: string | null | undefined, today: string): boolean`
  - `interface AccountUser { username: string | null; email: string | null; createdAt: string | null; role: string | null; approvalStatus: string | null }`
  - `toAccountUser(raw: unknown): AccountUser`

> Two deliberate deviations from spec §8, both to survive contact with the library: `formatDate` accepts `Date` as well as `string`, because the Better Auth client parses timestamps into `Date` objects; and `toAccountUser` is added so the components never cast a loosely-typed session user inline.

- [ ] **Step 1: Make `npm test` and `npm run build` cover `src/`**

In `package.json`, replace the `test` and `build` scripts:

```json
    "build": "tsc -p tsconfig.json --noEmit && vite build && tsc -p tsconfig.server.json",
    "test": "node --import tsx --test \"server/**/*.test.ts\" \"src/**/*.test.ts\"",
```

Two explicit glob patterns rather than a brace expansion — Node's test runner glob support for `{a,b}` is not worth depending on. Typecheck runs first so the build fails fast.

- [ ] **Step 2: Confirm the new gates pass on the current tree**

Run: `npm test && npm run build`
Expected: PASS. 79 tests pass (no `src/**` tests exist yet, which is fine — the pattern simply matches nothing), and the new `tsc -p tsconfig.json --noEmit` exits clean. If the typecheck fails here, stop: that is a pre-existing problem, not one this task introduced.

- [ ] **Step 3: Write the failing test**

Create `src/ts/account.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the module `./account.ts` does not exist yet, so the run errors on resolution.

- [ ] **Step 5: Write the implementation**

Create `src/ts/account.ts`:

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 79 server tests plus the new `src/ts/account.test.ts` tests.

- [ ] **Step 7: Move the two constants off `auth.ts` so there is one definition**

`src/ts/auth.ts` currently defines `MIN_PASSWORD_LENGTH` and `MIN_USERNAME_LENGTH`. `account.ts` now owns them. Delete both `export const` lines from `auth.ts` and import-and-re-export instead, so `authModal.ts` — which imports them from `'../auth'` — keeps working untouched.

Replace lines 10–12 of `src/ts/auth.ts`:

```ts
/** Mirrors `minPasswordLength` on the server. Shown in the form, enforced there. */
export const MIN_PASSWORD_LENGTH = 12;
export const MIN_USERNAME_LENGTH = 3;
```

with:

```ts
// Defined in `account.ts`, which holds no `better-auth` import and so can be
// unit-tested; re-exported here because every existing caller imports them from
// this module.
import { MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH } from './account';
export { MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH };
```

Put the `import` line at the top of the file with the other imports, and the `export` line where the constants used to be.

- [ ] **Step 8: Verify**

Run: `npm test && npm run build`
Expected: PASS both. The typecheck proves the re-export satisfies `authModal.ts`.

- [ ] **Step 9: Commit**

```bash
git add package.json src/ts/account.ts src/ts/account.test.ts src/ts/auth.ts
git commit -m "feat(account): pure account logic, and gates that can see the frontend"
```

---

### Task 2: Group the four board tools into one shell

**Files:**
- Modify: `src/input.css` (after the `.btn-accent:hover` rule, before the Inputs section)
- Modify: `index.html:60-94` (the `add-job`, `view-bin`, `trigger-scrape` and `refresh` buttons)

**Interfaces:**
- Consumes: nothing.
- Produces: the `.btn-grouped` class, used by any button placed inside a bordered group.

- [ ] **Step 1: Add the `.btn-grouped` rule**

In `src/input.css`, immediately after the `.btn-accent:hover` block, add:

```css
    /* A button inside a bordered group: the shell owns the border and the shadow.
       The hover translate is dropped too — a button that jumps inside a fixed
       shell reads as broken rather than tactile. `!important` because `.btn-icon`
       and `.btn-accent` set these from CSS variables at equal specificity. */
    .btn-grouped {
        border-width: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
    }

    .btn-grouped:hover {
        transform: none !important;
        box-shadow: none !important;
    }
```

- [ ] **Step 2: Wrap the four board buttons**

In `index.html`, the four buttons `#add-job` (line 60), `#view-bin` (67), `#trigger-scrape` (75) and `#refresh` (85) are currently siblings. Wrap all four — and only those four — in a group container, and add `btn-grouped` to each button's class list while leaving every other class alone.

Open the wrapper immediately before `<button id="add-job"`:

```html
                    <div class="flex items-stretch border-2 border-black shadow-[2px_2px_0_#000] divide-x-2 divide-black">
```

and close it immediately after the `</button>` that ends `#refresh`:

```html
                    </div>
```

Then edit the four `class="..."` attributes:

- `#add-job`: `class="btn-accent inline-flex …"` becomes `class="btn-accent btn-grouped inline-flex …"`
- `#view-bin`: `class="btn-icon inline-flex …"` becomes `class="btn-icon btn-grouped inline-flex …"`
- `#trigger-scrape`: `class="btn-icon inline-flex …"` becomes `class="btn-icon btn-grouped inline-flex …"`
- `#refresh`: `class="btn-icon inline-flex …"` becomes `class="btn-icon btn-grouped inline-flex …"`

- [ ] **Step 3: Verify**

Run: `npm test && npm run build`
Expected: PASS both.

Then run `npm run dev` and confirm in the browser: the four icons sit in a single bordered box with hairline dividers between them; hovering changes a button's background without moving it; the box has one `2px` shadow rather than four; all four buttons still work; the disabled scrape button still dims.

- [ ] **Step 4: Commit**

```bash
git add index.html src/input.css
git commit -m "feat(ui): group the board tools into one bordered shell"
```

---

### Task 3: Identity chip, dropdown menu, and the Account modal shell

The largest task, because the chip, the menu and the modal shell are not independently useful: the menu exists to open things, and the chip exists to open the menu. It ends with every entry point working and an empty-but-correct modal for Tasks 4–6 to fill.

**Files:**
- Modify: `index.html:42-59` (replace `#log-out` and `#view-admin`), and the end of the file (add the account modal before `<script type="module">`)
- Modify: `src/ts/dom.ts`
- Create: `src/ts/components/accountMenu.ts`
- Create: `src/ts/components/accountModal.ts`
- Modify: `src/ts/components/admin.ts` (`refreshPendingBadge`, and the dead class)
- Modify: `src/ts/main.ts`

**Interfaces:**
- Consumes: `currentUser` from `src/ts/state.ts` (shape `{ username: string | null; role: string | null }`).
- Produces:
  - From `accountMenu.ts`: `renderAccountChip(): void`, `openAccountMenu(): void`, `closeAccountMenu(focusChip?: boolean): void`, `wireAccountMenu(): void`
  - From `accountModal.ts`: `openAccountModal(): void`, `closeAccountModal(): void`, `wireAccountModal(): void`

- [ ] **Step 1: Replace the Log Out and Accounts buttons with the chip and menu**

In `index.html`, delete the whole `#log-out` button (lines 46–49) and the whole `#view-admin` button including its nested `#admin-badge` span (lines 50–59). Leave `#sign-in` (line 42) exactly as it is. In their place insert:

```html
                    <div id="account-wrap" class="hidden relative">
                        <button id="account-chip" type="button" title="Account" aria-haspopup="menu"
                            aria-expanded="false"
                            class="btn-icon relative inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest px-3 py-2 transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                            <span id="account-chip-initial" class="sm:hidden"></span>
                            <span id="account-chip-name" class="hidden sm:inline max-w-[10ch] truncate"></span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                    d="M19 9l-7 7-7-7" />
                            </svg>
                            <span id="account-chip-badge"
                                class="hidden absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-black bg-[#ff0040] text-white border-2 border-black rounded-full"></span>
                        </button>

                        <div id="account-menu" role="menu" aria-label="Account"
                            class="hidden absolute right-0 top-full mt-2 w-56 bg-theme-card border-2 border-black shadow-[4px_4px_0_#000] z-[200]">
                            <div class="p-3 border-b-2 border-black">
                                <div class="text-[10px] font-black uppercase tracking-widest text-theme-muted">Signed in
                                    as</div>
                                <div class="flex items-center justify-between gap-2 mt-1">
                                    <span id="account-menu-username"
                                        class="text-sm font-black text-theme-primary truncate"></span>
                                    <span id="account-menu-role"
                                        class="shrink-0 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border-2 border-black"></span>
                                </div>
                            </div>
                            <button id="menu-account" type="button" role="menuitem"
                                class="block w-full text-left px-3 py-2.5 text-xs font-black uppercase tracking-widest text-theme-primary hover:bg-theme-button transition-colors">
                                Account…
                            </button>
                            <button id="menu-admin" type="button" role="menuitem"
                                class="hidden w-full text-left px-3 py-2.5 text-xs font-black uppercase tracking-widest text-theme-primary hover:bg-theme-button transition-colors">
                                <span class="flex items-center justify-between gap-2">
                                    <span>Accounts…</span>
                                    <span id="menu-admin-badge"
                                        class="hidden min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[10px] font-black bg-[#ff0040] text-white border-2 border-black rounded-full"></span>
                                </span>
                            </button>
                            <button id="menu-logout" type="button" role="menuitem"
                                class="block w-full text-left px-3 py-2.5 text-xs font-black uppercase tracking-widest text-[#ff0040] border-t-2 border-black hover:bg-theme-button transition-colors">
                                Log Out
                            </button>
                        </div>
                    </div>
```

`#menu-admin` is a block button wrapping an inner flex `<span>` on purpose: it is the element whose `hidden` gets toggled, so it must not also carry `flex`.

- [ ] **Step 2: Add the Account modal shell**

In `index.html`, immediately after the closing `</div>` of `#admin-backdrop` and before `<script type="module" src="/src/ts/main.ts"></script>`, insert:

```html
    <div id="account-backdrop"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[300] p-4 hidden"
        role="dialog" aria-modal="true" aria-label="Account">
        <div class="modal-container w-full max-w-md flex flex-col max-h-[85vh] overflow-hidden" role="document">
            <header class="modal-header flex items-center justify-between p-4 border-b sticky top-0 z-10">
                <h2 class="text-lg font-black text-theme-primary uppercase tracking-widest">Account</h2>
                <button id="account-close" type="button"
                    class="text-theme-secondary hover:text-theme-primary transition-colors p-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </header>
            <div class="overflow-y-auto divide-y-2 divide-black">
                <!-- Task 4 inserts the identity and daily-scrape sections here -->
                <!-- Task 5 inserts the change-password section here -->
                <!-- Task 6 inserts the active-sessions section here -->
            </div>
        </div>
    </div>
```

- [ ] **Step 3: Update the element registry**

In `src/ts/dom.ts`, delete these three entries — the elements no longer exist:

```ts
    logOutBtn: null,
    adminBtn: null,
    adminBadge: null,
```

(`adminBtn` and `adminBadge` sit next to `adminBackdrop`; `logOutBtn` sits after `signInBtn`. Keep `adminBackdrop`, `adminClose`, `adminList` and `adminEmpty` — the Accounts panel itself is unchanged.)

Then add, after the `adminEmpty: null` entry:

```ts
    accountWrap: null,
    accountChip: null,
    accountChipName: null,
    accountChipInitial: null,
    accountChipBadge: null,
    accountMenu: null,
    accountMenuUsername: null,
    accountMenuRole: null,
    menuAccount: null,
    menuAdmin: null,
    menuAdminBadge: null,
    menuLogout: null,
    accountBackdrop: null,
    accountClose: null,
```

- [ ] **Step 4: Write the menu component**

Create `src/ts/components/accountMenu.ts`:

```ts
import { els } from '../dom';
import { currentUser } from '../state';

let open = false;

/** The menu items that are currently visible; `Accounts…` is owner-only. */
function items(): HTMLElement[] {
    return [els.menuAccount, els.menuAdmin, els.menuLogout]
        .filter((el): el is HTMLElement => !!el && !el.classList.contains('hidden'));
}

export function openAccountMenu(): void {
    if (!els.accountMenu) return;
    els.accountMenu.classList.remove('hidden');
    els.accountChip?.setAttribute('aria-expanded', 'true');
    open = true;
    items()[0]?.focus();
}

export function closeAccountMenu(focusChip = false): void {
    if (!open || !els.accountMenu) return;
    els.accountMenu.classList.add('hidden');
    els.accountChip?.setAttribute('aria-expanded', 'false');
    open = false;
    if (focusChip) els.accountChip?.focus();
}

/** Paints the chip and the menu header from whatever `refreshAuth` last resolved. */
export function renderAccountChip(): void {
    const name = currentUser.username ?? '';
    if (els.accountChipName) els.accountChipName.textContent = name;
    if (els.accountChipInitial) els.accountChipInitial.textContent = name.charAt(0).toUpperCase();
    if (els.accountMenuUsername) els.accountMenuUsername.textContent = name;

    const role = els.accountMenuRole;
    if (role) {
        const owner = currentUser.role === 'owner';
        role.textContent = owner ? 'Owner' : 'Member';
        role.classList.toggle('bg-emerald-400', owner);
        role.classList.toggle('text-black', owner);
        role.classList.toggle('bg-white', !owner);
    }
}

/**
 * Behaviour intrinsic to the menu: opening, dismissal and keyboard movement. What
 * each item *does* is wired in `main.ts` alongside every other button, so this
 * module does not need to know about the modal or the admin panel.
 */
export function wireAccountMenu(): void {
    els.accountChip?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (open) closeAccountMenu(); else openAccountMenu();
    });

    // Any item activation dismisses the menu, whatever else that item also does.
    els.accountMenu?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[role="menuitem"]')) closeAccountMenu();
    });

    document.addEventListener('click', (e) => {
        if (!open) return;
        if (els.accountWrap?.contains(e.target as Node)) return;
        closeAccountMenu();
    });

    els.accountMenu?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = (at + step + list.length) % list.length;
        list[next]?.focus();
    });
}
```

- [ ] **Step 5: Write the modal shell component**

Create `src/ts/components/accountModal.ts`:

```ts
import { els } from '../dom';

export function openAccountModal(): void {
    els.accountBackdrop?.classList.remove('hidden');
}

export function closeAccountModal(): void {
    els.accountBackdrop?.classList.add('hidden');
}

/** Wires the panel's own controls. Called once, from `main.ts`. */
export function wireAccountModal(): void {
    els.accountClose?.addEventListener('click', closeAccountModal);
    els.accountBackdrop?.addEventListener('click', (e) => {
        if (e.target === els.accountBackdrop) closeAccountModal();
    });
}
```

- [ ] **Step 6: Point the pending badge at both of its new homes**

In `src/ts/components/admin.ts`, replace the whole `refreshPendingBadge` function with:

```ts
export async function refreshPendingBadge(): Promise<void> {
    try {
        const me = await (await fetch('/api/me', { credentials: 'same-origin' })).json();
        setPendingCount(me.pendingCount ?? 0);
    } catch {
        setPendingCount(0);
    }
    // Two badges from one read: the header chip and the menu row.
    const text = String(pendingCount);
    for (const badge of [els.accountChipBadge, els.menuAdminBadge]) {
        if (!badge) continue;
        badge.textContent = text;
        badge.classList.toggle('hidden', pendingCount === 0);
    }
}
```

In the same file, `renderRow` styles every account row with `bg-theme-surface`, which is defined nowhere and does nothing. Change that one class to `bg-theme-card`:

```ts
    <div class="border-2 border-black shadow-[2px_2px_0_#000] p-3 flex justify-between items-center gap-3 bg-theme-card">
```

- [ ] **Step 7: Wire it all up in `main.ts`**

In `src/ts/main.ts`:

a. Add the imports next to the existing component imports:

```ts
import { renderAccountChip, wireAccountMenu, closeAccountMenu } from './components/accountMenu';
import { openAccountModal, closeAccountModal, wireAccountModal } from './components/accountModal';
```

b. In the DOM-reference block, delete these three lines:

```ts
    els.logOutBtn = $('log-out');
    els.adminBtn = $('view-admin');
    els.adminBadge = $('admin-badge');
```

and add, next to the other admin references:

```ts
    els.accountWrap = $('account-wrap');
    els.accountChip = $('account-chip');
    els.accountChipName = $('account-chip-name');
    els.accountChipInitial = $('account-chip-initial');
    els.accountChipBadge = $('account-chip-badge');
    els.accountMenu = $('account-menu');
    els.accountMenuUsername = $('account-menu-username');
    els.accountMenuRole = $('account-menu-role');
    els.menuAccount = $('menu-account');
    els.menuAdmin = $('menu-admin');
    els.menuAdminBadge = $('menu-admin-badge');
    els.menuLogout = $('menu-logout');
    els.accountBackdrop = $('account-backdrop');
    els.accountClose = $('account-close');
```

c. Replace the log-out listener (the `if (els.logOutBtn) els.logOutBtn.addEventListener(...)` block) with the same handler on the menu item:

```ts
    if (els.menuLogout) els.menuLogout.addEventListener('click', async () => {
        await authClient.signOut();
        await refreshAuth();
        await Promise.all([fetchJobs(), fetchHistory()]);
        setStatus('Signed out');
    });
```

d. Replace the admin-button listener line:

```ts
    if (els.adminBtn) els.adminBtn.addEventListener('click', openAdminPanel);
```

with:

```ts
    if (els.menuAdmin) els.menuAdmin.addEventListener('click', openAdminPanel);
    if (els.menuAccount) els.menuAccount.addEventListener('click', openAccountModal);
```

e. Next to the existing `wireAuthTabs();` call, add:

```ts
    wireAccountMenu();
    wireAccountModal();
```

f. In the global Escape handler, add two closers to the existing list:

```ts
            closeAccountMenu(true);
            closeAccountModal();
```

g. In `refreshAuth`, paint the chip after the state is set — insert `renderAccountChip();` immediately after the `setCurrentUser(...)` line and before `applyAuthVisibility(...)`.

h. Replace the two removed elements in `applyAuthVisibility`:

```ts
    show(els.signInBtn, !authenticated);
    show(els.accountWrap, authenticated);
    show(els.demoBanner, !authenticated);
    show(els.scrapeBtn, authenticated);  // members scrape onto their own board
    show(els.menuAdmin, owner);          // approving accounts is owner-only
    show(els.btnTemplateAi, owner);      // AI cover letter reads the owner's identity.json
```

and add, as the last line of the function, so signing out never leaves an orphaned menu on screen:

```ts
    if (!authenticated) closeAccountMenu();
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run build`
Expected: PASS both. The typecheck is the real gate here — it catches any `els.*` name that does not match `dom.ts`.

Then `npm run dev`, and check as the **owner**:
- the chip shows the username, and the red pending badge if any accounts are pending;
- clicking it opens the menu with the username, an `OWNER` badge, `Account…`, `Accounts…` with its count, and `Log Out`;
- ArrowDown/ArrowUp move between the three items, Escape closes it and returns focus to the chip, and a click anywhere outside closes it;
- `Accounts…` opens the existing panel and approving still works, with both badges updating afterwards;
- `Account…` opens an empty Account modal that closes by its ✕, by a backdrop click, and by Escape;
- `Log Out` signs out; the chip disappears and Sign In returns.

Then sign in as a **member** and confirm the menu shows a `MEMBER` badge and no `Accounts…` row at all.

- [ ] **Step 9: Commit**

```bash
git add index.html src/ts/dom.ts src/ts/main.ts src/ts/components/accountMenu.ts src/ts/components/accountModal.ts src/ts/components/admin.ts
git commit -m "feat(account): identity chip, dropdown menu and account modal shell"
```

---

### Task 4: Identity and daily-scrape sections

**Files:**
- Modify: `index.html` (inside the Account modal's scrolling `<div>`, replacing the Task 4 comment)
- Modify: `src/ts/dom.ts`
- Modify: `src/ts/components/accountModal.ts`
- Modify: `src/ts/main.ts` (`updateScrapeButtonStatus` uses the shared rule)

**Interfaces:**
- Consumes: `toAccountUser`, `formatDate`, `scrapeUsedToday`, `todayIso` from `src/ts/account.ts`; `openAccountModal`/`closeAccountModal`/`wireAccountModal` from Task 3; `fetchScrapeInfo` from `src/ts/api.ts` (returns `{ lastTriggerDate: string | null }`).
- Produces: `openAccountModal()` becomes `async` and renders on open. `main.ts` awaits it.

- [ ] **Step 1: Add the two sections to the modal**

In `index.html`, replace the line `<!-- Task 4 inserts the identity and daily-scrape sections here -->` with:

```html
                <section class="p-4 space-y-2">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span id="account-username" class="text-base font-black text-theme-primary truncate"></span>
                        <span id="account-role"
                            class="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border-2 border-black"></span>
                        <span id="account-approval"
                            class="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border-2 border-black"></span>
                    </div>
                    <div id="account-email" class="text-[11px] text-theme-muted truncate"></div>
                    <div class="text-[11px] text-theme-muted">Member since <span id="account-since">—</span></div>
                </section>

                <section class="p-4 space-y-1">
                    <div class="text-[10px] font-black uppercase tracking-widest text-theme-muted">Daily scrape</div>
                    <div id="account-scrape-status" class="text-sm font-black uppercase tracking-widest"></div>
                    <div id="account-scrape-last" class="text-[11px] text-theme-muted"></div>
                </section>
```

- [ ] **Step 2: Register the new elements**

In `src/ts/dom.ts`, add after `accountClose: null,`:

```ts
    accountUsername: null,
    accountRole: null,
    accountApproval: null,
    accountEmail: null,
    accountSince: null,
    accountScrapeStatus: null,
    accountScrapeLast: null,
```

In `src/ts/main.ts`, add after `els.accountClose = $('account-close');`:

```ts
    els.accountUsername = $('account-username');
    els.accountRole = $('account-role');
    els.accountApproval = $('account-approval');
    els.accountEmail = $('account-email');
    els.accountSince = $('account-since');
    els.accountScrapeStatus = $('account-scrape-status');
    els.accountScrapeLast = $('account-scrape-last');
```

- [ ] **Step 3: Render both sections when the modal opens**

Rewrite `src/ts/components/accountModal.ts` as:

```ts
import { els } from '../dom';
import { authClient } from '../auth';
import { fetchScrapeInfo } from '../api';
import { toAccountUser, formatDate, scrapeUsedToday, todayIso } from '../account';

/**
 * Read fresh from the session on every open rather than caching a second copy of
 * the user beside `state.ts`. This runs on an infrequent, deliberate action.
 */
async function renderIdentity(): Promise<void> {
    const { data } = await authClient.getSession();
    const user = toAccountUser(data?.user);

    if (els.accountUsername) els.accountUsername.textContent = user.username ?? '—';
    if (els.accountEmail) els.accountEmail.textContent = user.email ?? 'No email on file';
    if (els.accountSince) els.accountSince.textContent = formatDate(user.createdAt);

    const role = els.accountRole;
    if (role) {
        const owner = user.role === 'owner';
        role.textContent = owner ? 'Owner' : 'Member';
        role.classList.toggle('bg-emerald-400', owner);
        role.classList.toggle('text-black', owner);
        role.classList.toggle('bg-white', !owner);
    }

    const approval = els.accountApproval;
    if (approval) {
        const status = user.approvalStatus ?? 'approved';
        approval.textContent = status;
        approval.classList.toggle('bg-emerald-400', status === 'approved');
        approval.classList.toggle('text-black', status === 'approved');
        approval.classList.toggle('bg-white', status !== 'approved');
    }
}

/**
 * Reads the same endpoint the scrape button reads, through the same rule, so the
 * panel cannot tell you the scrape is available while the button says otherwise.
 */
async function renderScrape(): Promise<void> {
    let last: string | null = null;
    try {
        last = (await fetchScrapeInfo()).lastTriggerDate;
    } catch {
        last = null;
    }

    const used = scrapeUsedToday(last, todayIso());
    if (els.accountScrapeStatus) {
        els.accountScrapeStatus.textContent = used ? 'Used today' : 'Available';
        els.accountScrapeStatus.classList.toggle('text-[#ff0040]', used);
        els.accountScrapeStatus.classList.toggle('text-emerald-600', !used);
    }
    if (els.accountScrapeLast) {
        els.accountScrapeLast.textContent = last
            ? `Last run ${formatDate(last)} · one scrape per day`
            : 'No scrape run yet · one scrape per day';
    }
}

export async function openAccountModal(): Promise<void> {
    els.accountBackdrop?.classList.remove('hidden');
    await Promise.all([renderIdentity(), renderScrape()]);
}

export function closeAccountModal(): void {
    els.accountBackdrop?.classList.add('hidden');
}

/** Wires the panel's own controls. Called once, from `main.ts`. */
export function wireAccountModal(): void {
    els.accountClose?.addEventListener('click', closeAccountModal);
    els.accountBackdrop?.addEventListener('click', (e) => {
        if (e.target === els.accountBackdrop) closeAccountModal();
    });
}
```

- [ ] **Step 4: Use the shared scrape rule in the header button too**

In `src/ts/main.ts`, add `scrapeUsedToday` and `todayIso` to the imports:

```ts
import { scrapeUsedToday, todayIso } from './account';
```

and rewrite the body of `updateScrapeButtonStatus` so the rule lives in one place:

```ts
async function updateScrapeButtonStatus() {
    try {
        const info = await fetchScrapeInfo();
        if (els.scrapeBtn) {
            const btn = els.scrapeBtn as HTMLButtonElement;
            const used = scrapeUsedToday(info.lastTriggerDate, todayIso());
            btn.disabled = used;
            btn.title = used ? 'Scrape already triggered today' : 'Trigger Scrape (Max 1/day)';
        }
    } catch (e) {
        console.error("Failed to update scrape button status", e);
    }
}
```

`openAccountModal` is now `async`, so the menu wiring must not drop its promise. Change the `menu-account` listener added in Task 3 to:

```ts
    if (els.menuAccount) els.menuAccount.addEventListener('click', () => { void openAccountModal(); });
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run build`
Expected: PASS both.

Then `npm run dev`, open `Account…` and confirm: the username, role badge and `approved` badge render; the email is the one you signed up with; "Member since" shows a real date and not a dash; the scrape line says `Available` in green or `Used today` in red, and agrees with whether the header's ⚡ button is greyed out. Trigger a scrape, reopen the panel, and confirm both flipped together.

- [ ] **Step 6: Commit**

```bash
git add index.html src/ts/dom.ts src/ts/main.ts src/ts/components/accountModal.ts
git commit -m "feat(account): identity and daily-scrape sections"
```

---

### Task 5: Change password

**Files:**
- Modify: `index.html` (replacing the Task 5 comment)
- Modify: `src/ts/dom.ts`
- Modify: `src/ts/auth.ts` (one error code)
- Modify: `src/ts/components/accountModal.ts`
- Modify: `src/ts/main.ts` (element references)

**Interfaces:**
- Consumes: `validatePasswordChange`, `passwordProblemMessage` from `src/ts/account.ts`; `authErrorMessage` from `src/ts/auth.ts`.
- Produces: nothing new for later tasks, but Task 6 adds one line to the success path of `submitPasswordChange`.

- [ ] **Step 1: Add the section**

In `index.html`, replace `<!-- Task 5 inserts the change-password section here -->` with:

```html
                <section class="p-4 space-y-3">
                    <div class="text-[10px] font-black uppercase tracking-widest text-theme-muted">Change password</div>
                    <div class="flex flex-col gap-1.5">
                        <label for="pw-current"
                            class="text-xs font-bold text-theme-muted uppercase tracking-widest">Current password</label>
                        <input id="pw-current" type="password" autocomplete="current-password"
                            class="input-field text-sm px-3 py-2.5 outline-none w-full" />
                    </div>
                    <div class="flex flex-col gap-1.5">
                        <label for="pw-new" class="text-xs font-bold text-theme-muted uppercase tracking-widest">New
                            password</label>
                        <input id="pw-new" type="password" autocomplete="new-password"
                            class="input-field text-sm px-3 py-2.5 outline-none w-full" />
                        <p class="text-[10px] text-theme-muted">At least 12 characters.</p>
                    </div>
                    <div class="flex flex-col gap-1.5">
                        <label for="pw-confirm"
                            class="text-xs font-bold text-theme-muted uppercase tracking-widest">Confirm new
                            password</label>
                        <input id="pw-confirm" type="password" autocomplete="new-password"
                            class="input-field text-sm px-3 py-2.5 outline-none w-full" />
                    </div>
                    <label
                        class="flex items-center gap-2 text-[11px] font-bold text-theme-muted uppercase tracking-widest">
                        <input id="pw-revoke-others" type="checkbox" checked
                            class="w-4 h-4 border-2 border-black accent-emerald-400" />
                        Sign out other devices
                    </label>
                    <div id="pw-error" class="hidden text-xs font-bold text-rose-500"></div>
                    <div id="pw-success" class="hidden text-xs font-bold text-emerald-600"></div>
                    <button id="pw-submit" type="button"
                        class="btn-accent w-full bg-emerald-400 text-black border-2 border-black shadow-[4px_4px_0_#000] text-sm font-black px-4 py-2.5 uppercase tracking-widest transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                        Change Password
                    </button>
                </section>
```

The checkbox ships `checked`: a password change is usually a reaction to something, so the safe option is the default rather than an opt-in.

- [ ] **Step 2: Register the elements**

In `src/ts/dom.ts`, add after `accountScrapeLast: null,`:

```ts
    pwCurrent: null,
    pwNew: null,
    pwConfirm: null,
    pwRevokeOthers: null,
    pwSubmit: null,
    pwError: null,
    pwSuccess: null,
```

In `src/ts/main.ts`, add after `els.accountScrapeLast = $('account-scrape-last');`:

```ts
    els.pwCurrent = $('pw-current');
    els.pwNew = $('pw-new');
    els.pwConfirm = $('pw-confirm');
    els.pwRevokeOthers = $('pw-revoke-others');
    els.pwSubmit = $('pw-submit');
    els.pwError = $('pw-error');
    els.pwSuccess = $('pw-success');
```

- [ ] **Step 3: Teach `authErrorMessage` the change-password failure**

In `src/ts/auth.ts`, add a case to the `switch` in `authErrorMessage`, immediately after the `INVALID_EMAIL_OR_PASSWORD` case:

```ts
        case 'INVALID_PASSWORD':
            return 'That current password is not right.';
```

- [ ] **Step 4: Implement the form**

In `src/ts/components/accountModal.ts`, extend the imports:

```ts
import { authClient, authErrorMessage } from '../auth';
import {
    toAccountUser, formatDate, scrapeUsedToday, todayIso,
    validatePasswordChange, passwordProblemMessage,
} from '../account';
```

Add these functions above `openAccountModal`:

```ts
function showPasswordMessage(el: HTMLElement | null, text: string): void {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
}

function clearPasswordMessages(): void {
    els.pwError?.classList.add('hidden');
    els.pwSuccess?.classList.add('hidden');
}

async function submitPasswordChange(): Promise<void> {
    clearPasswordMessages();

    const current = (els.pwCurrent as HTMLInputElement | null)?.value ?? '';
    const next = (els.pwNew as HTMLInputElement | null)?.value ?? '';
    const confirm = (els.pwConfirm as HTMLInputElement | null)?.value ?? '';
    const revokeOtherSessions = !!(els.pwRevokeOthers as HTMLInputElement | null)?.checked;

    // The server checks all of this again; this just saves the round trip.
    const problem = validatePasswordChange(current, next, confirm);
    if (problem) {
        showPasswordMessage(els.pwError, passwordProblemMessage(problem));
        return;
    }

    const btn = els.pwSubmit as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions,
    });
    if (btn) btn.disabled = false;

    if (error) {
        showPasswordMessage(els.pwError, authErrorMessage(error.code, 'Could not change the password.'));
        return;
    }

    for (const field of [els.pwCurrent, els.pwNew, els.pwConfirm]) {
        if (field) (field as HTMLInputElement).value = '';
    }
    showPasswordMessage(
        els.pwSuccess,
        revokeOtherSessions ? 'Password changed. Other devices were signed out.' : 'Password changed.',
    );
}
```

Then extend `wireAccountModal` with the submit handler and Enter support:

```ts
export function wireAccountModal(): void {
    els.accountClose?.addEventListener('click', closeAccountModal);
    els.accountBackdrop?.addEventListener('click', (e) => {
        if (e.target === els.accountBackdrop) closeAccountModal();
    });

    els.pwSubmit?.addEventListener('click', () => { void submitPasswordChange(); });
    for (const field of [els.pwCurrent, els.pwNew, els.pwConfirm]) {
        field?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') void submitPasswordChange();
        });
    }
}
```

Finally, clear any stale message when the panel is reopened — add `clearPasswordMessages();` as the first line of `openAccountModal`.

- [ ] **Step 5: Verify**

Run: `npm test && npm run build`
Expected: PASS both.

Then `npm run dev` and work through each failure in turn, confirming the message and that no request is sent for the first four:
- empty current password → "Enter your current password."
- an eleven-character new password → the minimum-length message
- mismatched confirmation → "The two new passwords do not match."
- new identical to current → "The new password is the same as the current one."
- a wrong current password with a valid new one → "That current password is not right." (this one does hit the server)
- a correct change → fields clear and the success line appears

Then sign in again with the new password to confirm the change actually took, and change it back.

- [ ] **Step 6: Commit**

```bash
git add index.html src/ts/dom.ts src/ts/auth.ts src/ts/main.ts src/ts/components/accountModal.ts
git commit -m "feat(account): change-password form"
```

---

### Task 6: Active sessions

**Files:**
- Modify: `index.html` (replacing the Task 6 comment)
- Modify: `src/ts/dom.ts`
- Modify: `src/ts/components/accountModal.ts`
- Modify: `src/ts/main.ts` (element references)

**Interfaces:**
- Consumes: `deviceLabel`, `formatDate` from `src/ts/account.ts`; `escapeHtml` from `src/ts/utils.ts`; `authClient` from `src/ts/auth.ts`.
- Produces: nothing for later tasks — this is the last one.

- [ ] **Step 1: Add the section**

In `index.html`, replace `<!-- Task 6 inserts the active-sessions section here -->` with:

```html
                <section class="p-4 space-y-3">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-[10px] font-black uppercase tracking-widest text-theme-muted">Active sessions
                        </div>
                        <button id="sessions-revoke-others" type="button"
                            class="shrink-0 px-2 py-1 text-[10px] font-black uppercase tracking-widest bg-[#ff0040] text-white border-2 border-black shadow-[2px_2px_0_#000] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                            Sign out everywhere else
                        </button>
                    </div>
                    <div id="sessions-list" class="space-y-2"></div>
                </section>
```

- [ ] **Step 2: Register the elements**

In `src/ts/dom.ts`, add after `pwSuccess: null,`:

```ts
    sessionsList: null,
    sessionsRevokeOthers: null,
```

In `src/ts/main.ts`, add after `els.pwSuccess = $('pw-success');`:

```ts
    els.sessionsList = $('sessions-list');
    els.sessionsRevokeOthers = $('sessions-revoke-others');
```

- [ ] **Step 3: Implement the list**

In `src/ts/components/accountModal.ts`, extend the imports with `deviceLabel` and `escapeHtml`:

```ts
import {
    toAccountUser, formatDate, scrapeUsedToday, todayIso,
    validatePasswordChange, passwordProblemMessage, deviceLabel,
} from '../account';
import { escapeHtml } from '../utils';
```

Add above `openAccountModal`:

```ts
interface SessionRow {
    token: string;
    expiresAt: string | Date | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}

/**
 * The current session gets no revoke button: signing yourself out is Log Out's
 * job, not a list row's. If the client turns out not to expose the current
 * token, `currentToken` is null and every row simply gets a button.
 */
function sessionRowHtml(s: SessionRow, isCurrent: boolean): string {
    const control = isCurrent
        ? '<span class="text-[10px] font-black uppercase tracking-widest text-theme-muted">This device</span>'
        : `<button type="button" data-token="${escapeHtml(s.token)}"
                class="px-2 py-1 text-[10px] font-black uppercase tracking-widest bg-[#ff0040] text-white border-2 border-black shadow-[2px_2px_0_#000] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
            Revoke
        </button>`;

    return `
    <div class="border-2 border-black shadow-[2px_2px_0_#000] p-3 flex justify-between items-center gap-3 bg-theme-card">
      <div class="min-w-0">
        <div class="text-sm font-black text-theme-primary truncate">${escapeHtml(deviceLabel(s.userAgent))}</div>
        <div class="text-[11px] text-theme-muted truncate">
          ${escapeHtml(s.ipAddress || 'No IP recorded')} · expires ${escapeHtml(formatDate(s.expiresAt))}
        </div>
      </div>
      <div class="shrink-0">${control}</div>
    </div>`;
}

async function renderSessions(): Promise<void> {
    const list = els.sessionsList;
    if (!list) return;
    list.innerHTML = '<div class="text-sm text-theme-muted">Loading…</div>';

    const [sessions, session] = await Promise.all([
        authClient.listSessions(),
        authClient.getSession(),
    ]);

    if (sessions.error || !sessions.data) {
        list.innerHTML = '<div class="text-sm font-bold text-rose-500">Failed to load sessions.</div>';
        return;
    }

    const currentToken = (session.data?.session as { token?: string } | undefined)?.token ?? null;
    const rows = sessions.data as unknown as SessionRow[];
    list.innerHTML = rows
        .map((s) => sessionRowHtml(s, !!currentToken && s.token === currentToken))
        .join('');

    // Only this device is left, so there is nothing to sign out of.
    els.sessionsRevokeOthers?.classList.toggle('hidden', rows.length <= 1);
}
```

- [ ] **Step 4: Wire the revoke actions**

In `wireAccountModal`, add before the closing brace:

```ts
    // Delegated, so re-rendering the list never stacks duplicate handlers.
    els.sessionsList?.addEventListener('click', async (e) => {
        const btn = (e.target as HTMLElement).closest('button[data-token]') as HTMLButtonElement | null;
        if (!btn) return;
        btn.disabled = true;
        const { error } = await authClient.revokeSession({ token: btn.dataset.token ?? '' });
        if (error) {
            btn.disabled = false;
            return;
        }
        await renderSessions();
    });

    els.sessionsRevokeOthers?.addEventListener('click', async () => {
        const btn = els.sessionsRevokeOthers as HTMLButtonElement;
        btn.disabled = true;
        await authClient.revokeOtherSessions();
        btn.disabled = false;
        await renderSessions();
    });
```

- [ ] **Step 5: Render sessions on open, and after a password change**

In `openAccountModal`, add `renderSessions()` to the parallel render:

```ts
    await Promise.all([renderIdentity(), renderScrape(), renderSessions()]);
```

In `submitPasswordChange`, add one line at the very end — the list has just changed underneath if the checkbox was left on:

```ts
    await renderSessions();
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS both.

Then, with two browsers signed in as the same account:
- both sessions appear, each with a device label, an IP and an expiry date;
- the one you are looking at is tagged `THIS DEVICE` and has no Revoke button;
- clicking Revoke on the other row removes it, and refreshing that other browser shows it signed out;
- with only one session left, the "Sign out everywhere else" button is hidden;
- sign in again from the second browser, change the password with the checkbox left checked, and confirm the second session disappears from the list without a manual refresh;
- repeat with the checkbox unchecked and confirm it survives.

- [ ] **Step 7: Commit**

```bash
git add index.html src/ts/dom.ts src/ts/main.ts src/ts/components/accountModal.ts
git commit -m "feat(account): active sessions with per-session revoke"
```

---

## Final verification

- [ ] `npm test && npm run build` passes from a clean checkout of the branch.
- [ ] Signed out: no chip, Sign In visible, yellow demo banner visible, board read-only.
- [ ] Member: chip with no badge, menu with a `MEMBER` badge and no `Accounts…` row, all four Account sections working.
- [ ] Owner: pending badge on both the chip and the menu row, `Accounts…` still approves and rejects, badges update afterwards.
- [ ] The header shows the chip plus one bordered group of four board tools, and nothing else was lost in the move.
- [ ] `grep -rn "bg-theme-surface" src/` returns nothing.
