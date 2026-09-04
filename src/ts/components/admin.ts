import { els } from '../dom';
import { escapeHtml } from '../utils';
import { pendingCount, setPendingCount } from '../state';

interface AdminUser {
    id: string;
    username: string;
    email: string;
    createdAt: string;
    approvalStatus: 'pending' | 'approved' | 'rejected';
    role: 'member' | 'owner';
    jobCount: number;
}

async function fetchUsers(): Promise<AdminUser[]> {
    const res = await fetch('/api/admin/users?status=all', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Failed to load accounts');
    return (await res.json()).users;
}

async function setStatus(id: string, action: 'approve' | 'reject'): Promise<void> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`Failed to ${action} the account`);
}

function badgeClasses(status: AdminUser['approvalStatus']): string {
    if (status === 'approved') return 'bg-emerald-400 text-black';
    if (status === 'rejected') return 'bg-[#ff0040] text-white';
    return 'bg-white text-black';
}

function renderRow(u: AdminUser): string {
    // The owner has no controls: they cannot approve or reject themselves, and the
    // server returns 409 if they try — so the buttons simply are not offered.
    const controls = u.role === 'owner'
        ? '<span class="text-[10px] font-black uppercase tracking-widest text-theme-muted">Owner</span>'
        : `
        <button type="button" data-action="approve" data-id="${escapeHtml(u.id)}"
                class="px-2 py-1 text-[10px] font-black uppercase tracking-widest bg-emerald-400 text-black border-2 border-black shadow-[2px_2px_0_#000] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
            Approve
        </button>
        <button type="button" data-action="reject" data-id="${escapeHtml(u.id)}"
                class="px-2 py-1 text-[10px] font-black uppercase tracking-widest bg-[#ff0040] text-white border-2 border-black shadow-[2px_2px_0_#000] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
            Reject
        </button>`;

    return `
    <div class="border-2 border-black shadow-[2px_2px_0_#000] p-3 flex justify-between items-center gap-3 bg-theme-surface">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-black text-theme-primary truncate">${escapeHtml(u.username)}</span>
          <span class="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border-2 border-black ${badgeClasses(u.approvalStatus)}">
            ${escapeHtml(u.approvalStatus)}
          </span>
        </div>
        <div class="text-[11px] text-theme-muted truncate">
          ${escapeHtml(u.email)} · ${u.jobCount} job${u.jobCount === 1 ? '' : 's'}
        </div>
      </div>
      <div class="flex gap-2 shrink-0">${controls}</div>
    </div>`;
}

export async function openAdminPanel(): Promise<void> {
    if (!els.adminBackdrop || !els.adminList) return;
    els.adminBackdrop.classList.remove('hidden');
    els.adminList.innerHTML = '<div class="text-sm text-theme-muted">Loading…</div>';

    let users: AdminUser[];
    try {
        users = await fetchUsers();
    } catch {
        els.adminList.innerHTML = '<div class="text-sm font-bold text-rose-500">Failed to load accounts.</div>';
        return;
    }

    els.adminEmpty?.classList.toggle('hidden', users.length > 0);
    els.adminList.innerHTML = users.map(renderRow).join('');

    els.adminList.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.disabled = true;
            try {
                await setStatus(el.dataset.id!, el.dataset.action as 'approve' | 'reject');
                await openAdminPanel();
                await refreshPendingBadge();
            } catch {
                el.disabled = false;
            }
        });
    });
}

export function closeAdminPanel(): void {
    els.adminBackdrop?.classList.add('hidden');
}

export async function refreshPendingBadge(): Promise<void> {
    try {
        const me = await (await fetch('/api/me', { credentials: 'same-origin' })).json();
        setPendingCount(me.pendingCount ?? 0);
    } catch {
        setPendingCount(0);
    }
    if (!els.adminBadge) return;
    els.adminBadge.textContent = String(pendingCount);
    els.adminBadge.classList.toggle('hidden', pendingCount === 0);
}
