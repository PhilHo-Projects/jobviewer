import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.js';
import { APIError, betterAuth } from 'better-auth';
import { username as usernamePlugin } from 'better-auth/plugins';
import type { AppConfig } from './config.js';

export function makeRequireWebhookSecret(expectedSecret: string) {
  return function requireWebhookSecret(req: Request, res: Response, next: NextFunction): void {
    const expected = expectedSecret;
    const provided = req.headers['x-webhook-secret'];
    if (!expected || typeof provided !== 'string') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    next();
  };
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type UserRole = 'member' | 'owner';

/** The shape `auth.api.getSession()` hands back, narrowed to what this app uses. */
export interface SessionUser {
    id: string;
    username: string;
    displayUsername: string | null;
    email: string;
    role: UserRole;
    approvalStatus: ApprovalStatus;
}

/**
 * Better Auth owns identity entirely; there is no second auth path.
 *
 * It is handed the app's own better-sqlite3 connection, so its tables live in the same
 * file as the job data. That is what lets `jobs.user_id` be a real foreign key, and it
 * means one backup covers both.
 */
export function buildAuth({ db, config }: { db: Db; config: AppConfig }) {
    const isProduction = config.environment === 'production';

    return betterAuth({
        database: db,
        secret: config.sessionSecret,
        baseURL: config.publicOrigin,
        trustedOrigins: [config.publicOrigin],

        emailAndPassword: {
            enabled: true,
            // Sign-up must never mint a session. Together with the gate below, this is
            // what guarantees a pending user never holds one at any point.
            autoSignIn: false,
            minPasswordLength: 12,
            // The address is collected but deliberately never verified — the owner's
            // approval is the human check, so there is no SMTP dependency in this app.
            requireEmailVerification: false,
        },

        session: { expiresIn: config.sessionMaxAgeSeconds },

        user: {
            additionalFields: {
                // `input: false` marks these server-owned: Better Auth strips them from
                // any request body, so a sign-up POST carrying `"role":"owner"` cannot
                // escalate. Closed by construction rather than by vigilance.
                role: { type: 'string', required: true, defaultValue: 'member', input: false },
                approvalStatus: {
                    type: 'string', required: true, defaultValue: 'pending', input: false,
                },
                approvedAt: { type: 'string', required: false, input: false },
                approvedBy: { type: 'string', required: false, input: false },
            },
        },

        databaseHooks: {
            session: {
                create: {
                    /**
                     * The approval gate, and the only one in the codebase.
                     *
                     * Because it sits at session creation, the existence of a session
                     * proves the user is approved — no downstream route re-checks, and
                     * there is no half-authenticated state for a bug to hide in.
                     */
                    before: async (session) => {
                        const row = db
                            .prepare('SELECT "approvalStatus" FROM "user" WHERE "id" = ?')
                            .get(session.userId) as { approvalStatus?: string } | undefined;

                        if (row?.approvalStatus === 'pending') {
                            throw new APIError('FORBIDDEN', {
                                code: 'ACCOUNT_PENDING',
                                message: 'This account is waiting to be approved.',
                            });
                        }
                        if (row?.approvalStatus !== 'approved') {
                            throw new APIError('FORBIDDEN', {
                                code: 'ACCOUNT_REJECTED',
                                message: 'This account cannot sign in.',
                            });
                        }
                        return { data: session };
                    },
                },
            },
        },

        rateLimit: {
            enabled: true,
            // Database storage, so counters survive a restart instead of resetting to
            // zero on every deploy the way an in-process limiter does.
            storage: 'database',
            window: 60,
            max: 100,
            customRules: {
                '/sign-in/username': { window: 15 * 60, max: 5 },
                '/sign-in/email': { window: 15 * 60, max: 5 },
                // Public sign-up is a spam vector the old single-password login never had.
                '/sign-up/email': { window: 60 * 60, max: 3 },
            },
        },

        advanced: {
            /**
             * Counterintuitive but deliberate: `useSecureCookies` controls only Better
             * Auth's automatic `__Secure-` name prefix, not the Secure attribute itself.
             * Leaving it false and setting `secure` explicitly below is the only way to
             * get a literal `__Host-` name — with it true the cookie is emitted as
             * `__Secure-__Host-jv_session`, which browsers read as a plain `__Secure-`
             * cookie, silently losing the subdomain-overwrite guarantee.
             */
            useSecureCookies: false,
            defaultCookieAttributes: {
                httpOnly: true,
                sameSite: 'strict',
                path: '/',
                secure: isProduction,
            },
            cookies: {
                // `__Host-` additionally requires Secure, Path=/ and no Domain — all
                // satisfied above. It is dropped outside production, where Secure is not set.
                session_token: { name: isProduction ? '__Host-jv_session' : 'jv_session' },
            },
        },

        plugins: [usernamePlugin({ minUsernameLength: 3, maxUsernameLength: 30 })],
    });
}

export type AppAuth = ReturnType<typeof buildAuth>;
