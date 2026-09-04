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
