import { z } from 'zod';

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PUBLIC_ORIGIN: z.url().refine((value) => new URL(value).pathname === '/', {
        message: 'PUBLIC_ORIGIN must not contain a path',
    }),
    SESSION_SECRET: z.string().min(32),
    OWNER_USERNAME: z.string().min(3).max(30).default('owner'),
    OWNER_EMAIL: z.email(),
    /**
     * Bootstrap only: used once, on the first boot that finds no owner row, and
     * ignored for ever after. The 12-character floor matches the sign-up minimum —
     * the owner must not be the weakest account on the site.
     */
    OWNER_PASSWORD: z.string().min(12),
    DATA_DIR: z.string().min(1).default('./data'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_004),
    WEBHOOK_SECRET: z.string().min(1),
    N8N_SCRAPE_URL: z.string().url().optional(),
    N8N_COVER_LETTER_URL: z.string().url().optional(),
    /** Global ceiling on Apify-backed scrapes per calendar day, across all users. */
    SCRAPE_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
    /** How long a pending scrape run stays eligible for delivery. */
    RUN_EXPIRY_MINUTES: z.coerce.number().int().positive().default(30),
});

export interface AppConfig {
    environment: 'development' | 'test' | 'production';
    publicOrigin: string;
    sessionSecret: string;
    sessionMaxAgeSeconds: number;
    ownerUsername: string;
    ownerEmail: string;
    ownerPassword: string;
    dataDir: string;
    port: number;
    webhookSecret: string;
    n8nScrapeUrl: string | undefined;
    n8nCoverLetterUrl: string | undefined;
    scrapeDailyLimit: number;
    runExpiryMinutes: number;
}

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
    const parsed = schema.parse(environment);
    return {
        environment: parsed.NODE_ENV,
        publicOrigin: parsed.PUBLIC_ORIGIN.replace(/\/$/, ''),
        sessionSecret: parsed.SESSION_SECRET,
        sessionMaxAgeSeconds: 30 * 24 * 60 * 60,
        ownerUsername: parsed.OWNER_USERNAME,
        ownerEmail: parsed.OWNER_EMAIL,
        ownerPassword: parsed.OWNER_PASSWORD,
        dataDir: parsed.DATA_DIR.replace(/[\\/]$/, ''),
        port: parsed.PORT,
        webhookSecret: parsed.WEBHOOK_SECRET,
        n8nScrapeUrl: parsed.N8N_SCRAPE_URL,
        n8nCoverLetterUrl: parsed.N8N_COVER_LETTER_URL,
        scrapeDailyLimit: parsed.SCRAPE_DAILY_LIMIT,
        runExpiryMinutes: parsed.RUN_EXPIRY_MINUTES,
    };
}
