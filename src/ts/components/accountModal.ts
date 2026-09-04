import { els } from '../dom';
import { authClient, authErrorMessage } from '../auth';
import { fetchScrapeInfo } from '../api';
import {
    toAccountUser, formatDate, scrapeUsedToday, todayIso,
    validatePasswordChange, passwordProblemMessage, deviceLabel,
} from '../account';
import { escapeHtml } from '../utils';

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
    await renderSessions();
}

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

export async function openAccountModal(): Promise<void> {
    clearPasswordMessages();
    els.accountBackdrop?.classList.remove('hidden');
    await Promise.all([renderIdentity(), renderScrape(), renderSessions()]);
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

    els.pwSubmit?.addEventListener('click', () => { void submitPasswordChange(); });
    for (const field of [els.pwCurrent, els.pwNew, els.pwConfirm]) {
        field?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') void submitPasswordChange();
        });
    }

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
}
