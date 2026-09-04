# Account Surface — Design

**Date:** 2026-09-04
**Status:** Approved, not yet implemented
**App:** job-viewer
**Builds on:** `2026-09-03-better-auth-multi-user-design.md`

## 1. Problem & Goals

The Better Auth migration landed the server side in full: approval-gated sign-up,
per-user boards, revocable sessions, an owner approval panel. The account *interface*
did not keep pace. A signed-in user today sees a bare **Log Out** button and nothing
else — no name, no email, no way to change a password, no view of their own account.

Four concrete gaps:

1. **No account or profile UI at all.** Nothing tells you who you are signed in as.
2. **No change-password UI**, although `POST /api/auth/change-password` works today.
   This is missing frontend, not missing backend.
3. **Members cannot see their own account state** — approval, role, scrape budget.
4. **The header carries seven controls with no grouping.**

Goals: give every signed-in user one place that answers "who am I, and what can I
change", un-crowd the header while doing it, and stay inside the existing
neo-brutalist vocabulary rather than inventing a second one.

**Non-goal:** touching the server. §7 records the verification that none is needed.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Entry point | **Identity chip in the header** replacing the Log Out and Accounts buttons |
| Navigation | **Chip → dropdown menu → Account modal.** Log Out stays one click, in the menu |
| Owner's Accounts panel | **Unchanged**, moved from a header button to a menu item |
| Modal layout | **One scrolling modal, four ruled sections.** No tabs |
| Modal contents | Identity, daily scrape, change password, active sessions |
| Header grouping | The four board actions become **one bordered shell with dividers** |
| Server changes | **None.** Every call is a built-in Better Auth route |
| Roles | Still exactly **owner** and **member**. No new role, no role editing |
| Password reset | **Still none.** No email provider in this app, by design |

## 3. Architecture

Three new frontend modules, following the existing one-purpose-per-file layout:

```
src/ts/
  account.ts                 # NEW  pure logic: validation, labels, formatting. No DOM
  account.test.ts            # NEW  unit tests for the above
  components/
    accountMenu.ts           # NEW  the chip and its dropdown
    accountModal.ts          # NEW  the modal: identity, scrape, password, sessions
    admin.ts                 # CHANGED  two badges instead of one; dead class fixed
  auth.ts                    # CHANGED  one new error code
  dom.ts                     # CHANGED  element registry
  main.ts                    # CHANGED  wiring and auth visibility
index.html                   # CHANGED  header restructured, account modal added
src/input.css                # CHANGED  .btn-grouped
package.json                 # CHANGED  build typechecks src; tests include src
```

Markup skeletons live in `index.html`, matching every other modal in this app (login,
admin, bin, scoreboard, confirm, cover letter). Dynamic rows render from TypeScript,
matching `admin.ts`. The alternative — building all markup in TS — was rejected for
breaking that split, and a single combined `account.ts` component was rejected for
mixing four concerns in ~350 lines with nothing testable.

Splitting the pure logic into `src/ts/account.ts` is what makes any of this testable:
the frontend has no DOM harness and is not going to grow one for this change.

## 4. Header

`#log-out` and `#view-admin` are removed. `#account-wrap` takes their place, hidden
when signed out, where `#sign-in` shows instead.

```
[status]  [ PHIL v ]  |  +-----+-----+------+---------+
                         | add | bin | zap  | refresh |
                         +-----+-----+------+---------+
```

**The chip** (`#account-chip`) is `btn-icon`-styled: username, chevron, and the
owner's pending-count badge — the same red `#ff0040` circle that sits on the admin
button today, moved rather than reinvented. Below the `sm` breakpoint it shows the
first initial only; at `sm` and up the username, truncated at roughly ten characters.
It carries `aria-haspopup="menu"` and an `aria-expanded` that tracks the menu.

**The board tools** — add, bin, scrape, refresh — move inside one wrapper with
`border-2 border-black shadow-[2px_2px_0_#000] divide-x-2 divide-black`, so four
loose objects read as one. Each child needs a new `.btn-grouped` rule in `input.css`
zeroing its own `border-width` and `box-shadow`: `.btn-icon` and `.btn-accent` set
both from CSS variables, and Tailwind utilities will not win against that.

Grouped buttons keep their hover background change and **lose the hover translate**.
A button that jumps inside a fixed shell looks broken rather than tactile.

Element ids: `account-wrap`, `account-chip`, `account-chip-name`,
`account-chip-initial`, `account-chip-badge`.

## 5. The Menu

Absolutely positioned under the chip, `w-56`, `border-2 border-black
shadow-[4px_4px_0_#000]`, square corners, `role="menu"`.

```
SIGNED IN AS
phil                [OWNER]
---------------------------
Account...
Accounts...            (3)     <- owner only
---------------------------
Log Out                        <- #ff0040
```

The role badge is emerald for the owner, plain bordered white for a member. The
Accounts row and its count are hidden for members, exactly as the header button is
today.

Behaviour: closes on outside click, on Escape (returning focus to the chip), and on
any item activation. ArrowUp/ArrowDown move between items; opening focuses the first.
The global Escape handler in `main.ts` gains `closeAccountMenu()` and
`closeAccountModal()` alongside the existing closers.

`refreshPendingBadge()` in `admin.ts` currently writes a single badge (`els.adminBadge`).
It changes to write two — the chip badge and the menu row's count — from the same
`/api/me` read. No second request.

Element ids: `account-menu`, `account-menu-username`, `account-menu-role`,
`menu-account`, `menu-admin`, `menu-admin-badge`, `menu-logout`.

## 6. The Account Modal

`#account-backdrop`, `max-w-md`, `max-h-[85vh]`, `overflow-y-auto`, in the shape of
the existing admin modal. Four sections separated by 2px rules. Tabs were considered
and rejected: the content is short enough that tabs would hide things for no gain.

### 6.1 Identity

Username large, role badge, approval badge, email, and "Member since 3 Sep 2026".
Read from `authClient.getSession()` **when the modal opens**, so it is always fresh
and no second copy of the session lands in `state.ts`.

Ids: `account-username`, `account-role`, `account-approval`, `account-email`,
`account-since`.

### 6.2 Daily scrape

"Used today" in red or "Available" in emerald, plus the last-run date, from the
existing `GET /api/scrape-info` → `{ lastTriggerDate }`. This is the same source
that already drives the scrape button's disabled state, so the panel and the button
cannot disagree. It exists so a member can find out **why** the lightning button is
grey, which today is unanswerable from the UI.

The shared `SCRAPE_DAILY_LIMIT` remaining is deliberately **not** shown. It is not on
the wire, and putting it there is the one item in this design that would require a
server change. Out of scope; recorded in §13 so the omission stays visible.

Ids: `account-scrape-status`, `account-scrape-last`.

### 6.3 Change password

Current, new, confirm, plus a **"Sign out other devices" checkbox checked by
default**. A password change is usually a reaction to something, so the safe option
is the default rather than an opt-in.

Calls `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })`.

Validation runs client-side first through `validatePasswordChange()` (§8) and covers:
current password empty, new password shorter than `MIN_PASSWORD_LENGTH`, confirm not
matching, new identical to current. Server errors map through the existing
`authErrorMessage`, which gains `INVALID_PASSWORD` → "That current password is not
right."

On success: clear all three fields, show a persistent success line, and re-render the
sessions list, which has just changed underneath if the checkbox was left on.

Ids: `pw-current`, `pw-new`, `pw-confirm`, `pw-revoke-others`, `pw-submit`,
`pw-error`, `pw-success`.

### 6.4 Active sessions

Rows from `authClient.listSessions()`: device label, created, expires, IP address.

The row whose token matches the one from `getSession()` is tagged `THIS DEVICE` and
**gets no revoke button** — signing yourself out is Log Out's job, not a list row's.
If the current session's token turns out not to be exposed to the client, the tag is
omitted and every row simply gets a revoke button; this is confirmed on first run
rather than assumed.

Every other row gets a `#ff0040` **Revoke** calling `authClient.revokeSession({ token })`,
and a **Sign out everywhere else** button calls `authClient.revokeOtherSessions()`.
Both re-render the list on success.

This section is the visible payoff of the migration's headline change. Sessions became
revocable on the server in the previous pass; until this panel exists, nobody can
revoke one.

Ids: `sessions-list`, `sessions-revoke-others`.

## 7. Client API Surface

Every endpoint below was verified present in `node_modules/better-auth@1.7.1` before
this design was written. **No server change is required by any of it.**

| Call | Route | Body |
|---|---|---|
| `authClient.getSession()` | `/api/auth/get-session` | — |
| `authClient.changePassword(...)` | `/api/auth/change-password` | `{ newPassword, currentPassword, revokeOtherSessions? }` |
| `authClient.listSessions()` | `/api/auth/list-sessions` | — |
| `authClient.revokeSession(...)` | `/api/auth/revoke-session` | `{ token }` |
| `authClient.revokeOtherSessions()` | `/api/auth/revoke-other-sessions` | — |

`role`, `approvalStatus`, `approvedAt` and `approvedBy` are declared in `server/auth.ts`
as `additionalFields` with `input: false` — server-owned on the way **in**. They carry
no `returned: false`, so they are present in the session payload on the way **out**,
which is what lets the identity block render without a new endpoint.

## 8. Pure Logic

`src/ts/account.ts` holds every decision that can be wrong independently of the DOM,
and imports neither the DOM nor `better-auth/client` — the latter builds a client at
module load, which would make the module awkward to import under `node --test`.

```ts
type PasswordProblem =
  | null                // valid
  | 'missing-current'
  | 'too-short'
  | 'mismatch'
  | 'unchanged';

validatePasswordChange(current: string, next: string, confirm: string): PasswordProblem
deviceLabel(userAgent: string | null | undefined): string   // "Chrome on Windows", else "Unknown device"
formatDate(iso: string | null | undefined): string          // "3 Sep 2026", else "—"
scrapeUsedToday(lastTriggerDate: string | null, today: string): boolean
```

## 9. State

`state.ts` is unchanged apart from what already exists. `currentUser` keeps its
`{ username, role }` shape for the chip; the modal reads the full record from
`getSession()` on open. Two sources of truth for one session would be worse than one
extra request on an infrequent action.

`applyAuthVisibility()` in `main.ts` swaps its two removed elements for the new ones:
`els.logOutBtn` → `els.accountWrap`, `els.adminBtn` → `els.menuAdmin`. The
`btnTemplateAi` and `scrapeBtn` rules are untouched.

## 10. Styling

The design system in `index.html` and `src/input.css` is followed, not extended:
2px black borders, `shadow-[2px_2px_0_#000]` (4px on the menu and primary buttons),
square corners, `uppercase tracking-widest` labels at `text-[10px]`/`text-xs`,
`emerald-400` for accent and affirmative state, `#ff0040` for destructive.

There is exactly one theme — `:root` only, no `[data-theme]` variants — so the
`--bg-*` and `--text-*` variables are used through the existing `.text-theme-*` and
`.bg-theme-*` utilities rather than by hardcoding hex values.

One new rule: `.btn-grouped`, described in §4.

## 11. Testing & Verification

`npm test` runs `server/**/*.test.ts`. There is no frontend harness and this change
does not build one, which means the existing 79 tests stay green **by construction**
and therefore prove nothing about this work. Two changes make the verification real:

1. **`npm run build` typechecks `src/`.** Today it is `vite build && tsc -p
   tsconfig.server.json`; `tsconfig.json` covers `src/**` and is run by nothing, so
   a type error in this entirely-frontend change would ship silently. The build
   becomes:

   ```
   tsc -p tsconfig.json --noEmit && vite build && tsc -p tsconfig.server.json
   ```

   Typecheck first, so it fails fast. `tsc -p tsconfig.json --noEmit` was run against
   the tree before this design was written and exits clean, so this gate is added to
   a passing baseline rather than becoming a cleanup task.

2. **Tests include `src/`.** The script becomes
   `node --import tsx --test "server/**/*.test.ts" "src/**/*.test.ts"` — two explicit
   patterns rather than a brace expansion, whose support in Node's runner is not
   worth depending on. `src/ts/account.test.ts` covers every branch of
   `validatePasswordChange`, plus `deviceLabel`, `formatDate` and `scrapeUsedToday`.
   These are additive; the 79 existing tests keep passing.

Written test-first, in the order: `validatePasswordChange`, then the formatters, then
the components that consume them.

Manual verification, both roles, after the automated gates pass:

- Owner: chip shows the pending badge, menu shows Accounts with its count, the
  Accounts panel still approves and rejects, and both badges update afterwards.
- Member: no Accounts row anywhere, scrape section explains a grey lightning button.
- Change password with a wrong current password, a short new one, a mismatched
  confirm, and a correct set; confirm other sessions actually disappear from the list.
- Revoke a session from a second browser and confirm that browser is signed out.
- Signed out: chip hidden, Sign In shown, demo banner unchanged.

## 12. Fixes Carried in Passing

`src/ts/components/admin.ts` renders every account row with `bg-theme-surface`. That
class is defined **nowhere** — not in `input.css`, and `tailwind.config.js` has an
empty `extend`. It is a silent no-op and the rows inherit the modal's white. Since
new session rows want the same treatment done correctly, this becomes `bg-theme-card`,
which exists.

## 13. Out of Scope (YAGNI)

- **Showing the shared daily scrape budget.** Needs a server change; see §6.2.
- Avatars and display names.
- Account deletion, and changing your own email or username.
- Any owner ability to edit members beyond the existing approve and reject.
- Password reset and email verification. No mail provider, by design.
- A frontend DOM test harness. The pure logic is extracted and tested instead.
- Any new role. `getOwnerId()` in `server/repo.ts` assumes a single owner.
