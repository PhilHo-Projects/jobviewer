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
