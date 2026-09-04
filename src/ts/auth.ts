import { createAuthClient } from 'better-auth/client';
import { usernameClient } from 'better-auth/client/plugins';

/**
 * The API and the SPA are served by the same Express instance, so no baseURL is
 * needed and the session cookie rides along automatically.
 */
export const authClient = createAuthClient({ plugins: [usernameClient()] });

/** Mirrors `minPasswordLength` on the server. Shown in the form, enforced there. */
export const MIN_PASSWORD_LENGTH = 12;
export const MIN_USERNAME_LENGTH = 3;

/** Turn Better Auth's error codes into something a person wants to read. */
export function authErrorMessage(code: string | undefined, fallback: string): string {
    switch (code) {
        case 'ACCOUNT_PENDING':
            return 'This account is still waiting to be approved.';
        case 'ACCOUNT_REJECTED':
            return 'This account cannot sign in.';
        case 'INVALID_USERNAME_OR_PASSWORD':
        case 'INVALID_EMAIL_OR_PASSWORD':
            return 'That username and password do not match.';
        case 'USERNAME_IS_ALREADY_TAKEN':
        case 'USERNAME_IS_ALREADY_IN_USE':
            return 'That username is taken.';
        case 'USER_ALREADY_EXISTS':
            return 'An account with that email already exists.';
        case 'PASSWORD_TOO_SHORT':
            return `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        case 'USERNAME_TOO_SHORT':
            return `Usernames must be at least ${MIN_USERNAME_LENGTH} characters.`;
        case 'TOO_MANY_REQUESTS':
            return 'Too many attempts. Wait a few minutes and try again.';
        default:
            return fallback;
    }
}
