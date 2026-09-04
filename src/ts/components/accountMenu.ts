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
