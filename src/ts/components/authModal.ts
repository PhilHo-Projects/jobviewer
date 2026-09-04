import { els } from '../dom';
import { authClient, authErrorMessage, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH } from '../auth';

type Mode = 'signin' | 'signup';

function showError(message: string): void {
    if (!els.loginError) return;
    els.loginError.textContent = message;
    els.loginError.classList.remove('hidden');
}

function clearError(): void {
    els.loginError?.classList.add('hidden');
}

/**
 * Sign-up deliberately issues no session, so there is nothing to redirect to. The
 * account sits pending until the owner approves it, and this panel says so in the
 * same words Better Auth's ACCOUNT_PENDING error uses on a later sign-in attempt.
 */
function showPendingState(): void {
    clearError();
    els.authForm?.classList.add('hidden');
    els.authTabs?.classList.add('hidden');
    els.authPending?.classList.remove('hidden');
    if (els.authTitle) els.authTitle.textContent = 'Pending';
}

function setMode(mode: Mode): void {
    clearError();
    const signup = mode === 'signup';
    els.loginEmailRow?.classList.toggle('hidden', !signup);
    els.loginEmailRow?.classList.toggle('flex', signup);
    els.loginPasswordHint?.classList.toggle('hidden', !signup);
    if (els.loginSubmit) {
        els.loginSubmit.textContent = signup ? 'Sign Up' : 'Sign In';
        els.loginSubmit.setAttribute('data-mode', mode);
    }
    if (els.authTitle) els.authTitle.textContent = signup ? 'Create Account' : 'Sign In';
    (els.loginPassword as HTMLInputElement | null)?.setAttribute(
        'autocomplete', signup ? 'new-password' : 'current-password',
    );
    // The active tab carries the accent; the inactive one stays plain.
    els.tabSignin?.classList.toggle('bg-emerald-400', !signup);
    els.tabSignin?.classList.toggle('text-black', !signup);
    els.tabSignup?.classList.toggle('bg-emerald-400', signup);
    els.tabSignup?.classList.toggle('text-black', signup);
}

export function openAuthModal(mode: Mode = 'signin'): void {
    els.authPending?.classList.add('hidden');
    els.authForm?.classList.remove('hidden');
    els.authTabs?.classList.remove('hidden');
    setMode(mode);

    // The backdrop ships with `opacity-0` and its panel with `scale-95`, so dropping
    // `hidden` alone would show an invisible modal. Unhide first, then release the
    // transition on the next frame so it actually animates.
    const backdrop = els.loginBackdrop;
    if (backdrop) {
        backdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            backdrop.classList.remove('opacity-0');
            backdrop.querySelector('[role="document"]')?.classList.remove('scale-95');
        });
    }
    (els.loginUsername as HTMLInputElement | null)?.focus();
}

export function closeAuthModal(): void {
    const backdrop = els.loginBackdrop;
    if (backdrop) {
        backdrop.classList.add('opacity-0');
        backdrop.querySelector('[role="document"]')?.classList.add('scale-95');
        setTimeout(() => {
            if (backdrop.classList.contains('opacity-0')) backdrop.classList.add('hidden');
        }, 200);
    }
    clearError();
    for (const field of [els.loginUsername, els.loginPassword, els.loginEmail]) {
        if (field) (field as HTMLInputElement).value = '';
    }
}

/** Returns true when a sign-in succeeded, so the caller can refresh its state. */
export async function submitAuth(): Promise<boolean> {
    clearError();
    const mode = (els.loginSubmit?.getAttribute('data-mode') ?? 'signin') as Mode;
    const username = ((els.loginUsername as HTMLInputElement | null)?.value ?? '').trim();
    const password = (els.loginPassword as HTMLInputElement | null)?.value ?? '';
    const email = ((els.loginEmail as HTMLInputElement | null)?.value ?? '').trim();

    if (username.length < MIN_USERNAME_LENGTH) {
        showError(`Usernames must be at least ${MIN_USERNAME_LENGTH} characters.`);
        return false;
    }

    if (mode === 'signin') {
        const { error } = await authClient.signIn.username({ username, password });
        if (error) {
            showError(authErrorMessage(error.code, 'Could not sign in.'));
            return false;
        }
        return true;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        showError(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return false;
    }
    if (!email) {
        showError('An email address is required.');
        return false;
    }

    const { error } = await authClient.signUp.email({ email, name: username, password, username });
    if (error) {
        showError(authErrorMessage(error.code, 'Could not create the account.'));
        return false;
    }
    showPendingState();
    return false;
}

export function wireAuthTabs(): void {
    els.tabSignin?.addEventListener('click', () => setMode('signin'));
    els.tabSignup?.addEventListener('click', () => setMode('signup'));
}
