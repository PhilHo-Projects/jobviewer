import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import type { Db } from './db.js';
import type { AppAuth, SessionUser } from './auth.js';
import { makeRequireWebhookSecret } from './auth.js';
import type { AppConfig } from './config.js';
import { requireUser, requireOwner, type AuthedRequest } from './guards.js';
import {
    getJobs, getHistory, getScrapeInfo, setScrapeInfo, getOwnerId,
    upsertJobs, getJobById, patchJob, bulkMove, deleteByStatus, createStableJobId,
} from './repo.js';
import type { Job } from '../shared/types.js';

export interface AppOptions {
    auth: AppAuth;
    config: AppConfig;
}

function loadIdentity(dataDir: string): unknown {
    const candidates = [
        process.env.IDENTITY_PATH,
        path.join(dataDir, 'identity.json'),
        path.join(process.cwd(), 'src', 'assets', 'identity.json'),
    ].filter(Boolean) as string[];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch {
            /* try next */
        }
    }
    return {};
}

export function createApp(db: Db, opts: AppOptions): Express {
    const app = express();
    const requireWebhookSecret = makeRequireWebhookSecret(opts.config.webhookSecret);

    app.use(helmet());

    // Better Auth reads the raw request body, so its handler must be registered before
    // any body parser. Express 4 wildcard syntax: '*', not Express 5's '*splat'.
    app.all('/api/auth/*', toNodeHandler(opts.auth));

    // Before the global body parser: this route needs a larger limit than everything
    // else, and a route-local parser mounted after the global one would never see the
    // body. It authenticates with WEBHOOK_SECRET rather than a session, so it does not
    // need the session middleware and is safe this early in the chain.
    app.post(
        '/api/receive-jobs',
        express.json({ limit: '20mb' }),
        requireWebhookSecret,
        (req: Request, res: Response) => {
            const payload = req.body;
            if (!Array.isArray(payload)) {
                return res.status(400).json({ error: 'Payload must be an array of jobs' });
            }
            const ownerId = getOwnerId(db);
            if (!ownerId) return res.status(500).json({ error: 'No owner configured' });
            const incoming = payload.filter(Boolean);
            const before = getJobs(db, ownerId).length;
            upsertJobs(db, ownerId, incoming);
            const after = getJobs(db, ownerId).length;
            return res.status(201).json({
                message: 'Jobs received successfully',
                received: incoming.length, before, after,
            });
        },
    );

    // Checked before the session is resolved, so a cross-origin caller gets nothing —
    // not even the cost of a session lookup. Sits after `receive-jobs` deliberately:
    // that route is server-to-server, sends no Origin, and is authenticated by
    // WEBHOOK_SECRET instead, so ordering exempts it without a path special-case.
    app.use((req: Request, res: Response, next: NextFunction) => {
        const isApi = req.path.startsWith('/api');
        const isUnsafe = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE';
        if (isApi && isUnsafe && req.headers.origin !== opts.config.publicOrigin) {
            res.status(403).json({ error: 'Request origin is not allowed' });
            return;
        }
        next();
    });

    app.use(express.json({ limit: '1mb' }));

    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (req: Request, res: Response, next: NextFunction) => {
            if (req.path.startsWith('/api')) return next();
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    // `req.user` is the session user or null. There is deliberately no demo fallback —
    // that is what makes an expired session distinguishable from an anonymous visitor.
    app.use(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
        const session = await opts.auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });
        req.user = (session?.user as SessionUser | undefined) ?? null;
        next();
    });

    app.get('/api/me', (req: AuthedRequest, res: Response) => {
        const user = req.user;
        res.json({
            authenticated: !!user,
            username: user?.username ?? null,
            role: user?.role ?? null,
            isDemo: !user,
        });
    });

    // --- Per-user write routes, scoped to the caller ---
    app.post('/api/jobs', requireUser, (req: AuthedRequest, res: Response) => {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ error: 'Payload must be a job object' });
        }
        // Resolve the id the same way upsertJobs will, so we can return the exact
        // saved row rather than relying on positional lookup.
        const id = payload.id || createStableJobId(payload as Partial<Job>);
        const existed = !!getJobById(db, req.user!.id, id);
        upsertJobs(db, req.user!.id, [payload as Partial<Job>]);
        const saved = getJobById(db, req.user!.id, id);
        return res.status(existed ? 200 : 201).json(saved);
    });

    app.patch('/api/jobs/bulk-move', requireUser, (req: AuthedRequest, res: Response) => {
        const { from, to } = req.body || {};
        if (!from || !to) {
            return res.status(400).json({ error: 'Source (from) and target (to) statuses are required' });
        }
        const moved = bulkMove(db, req.user!.id, from, to);
        res.json({ moved, from, to });
    });

    app.patch('/api/jobs/:id', requireUser, (req: AuthedRequest, res: Response) => {
        const updated = patchJob(db, req.user!.id, String(req.params.id), req.body || {});
        if (!updated) return res.status(404).json({ message: 'Job not found' });
        res.json(updated);
    });

    app.delete('/api/jobs/status/:status', requireUser, (req: AuthedRequest, res: Response) => {
        const deleted = deleteByStatus(db, req.user!.id, String(req.params.status));
        res.json({ deleted, remaining: getJobs(db, req.user!.id).length });
    });

    // --- Scoped read routes (the anonymous fixture path arrives in Task 9) ---
    app.get('/api/jobs', (req: AuthedRequest, res: Response) => {
        if (!req.user) return res.json([]);
        res.json(getJobs(db, req.user.id));
    });

    app.get('/api/history', (req: AuthedRequest, res: Response) => {
        if (!req.user) return res.json([]);
        res.json(getHistory(db, req.user.id));
    });

    app.get('/api/scrape-info', (req: AuthedRequest, res: Response) => {
        if (!req.user) return res.json({ lastTriggerDate: null });
        res.json(getScrapeInfo(db, req.user.id));
    });

    // --- n8n integrations ---
    app.post('/api/trigger-scrape', requireUser, async (req: AuthedRequest, res: Response) => {
        const webhookUrl = opts.config.n8nScrapeUrl;
        if (!webhookUrl) return res.status(500).json({ error: 'N8N_SCRAPE_URL is not configured' });

        const info = getScrapeInfo(db, req.user!.id);
        const today = new Date().toISOString().split('T')[0];
        if (info.lastTriggerDate === today) {
            return res.status(429).json({ error: 'Scrape already triggered today. Limit: 1 per day.' });
        }
        try {
            const response = await fetch(webhookUrl, { method: 'GET' });
            if (!response.ok) throw new Error(`n8n responded with status: ${response.status}`);
            setScrapeInfo(db, req.user!.id, today);
            res.json({ message: 'Scrape triggered successfully', lastTriggerDate: today });
        } catch (err: any) {
            console.error('Failed to trigger n8n:', err);
            res.status(500).json({ error: `Failed to trigger n8n: ${err.message}` });
        }
    });

    // Owner-only: reads the owner's own identity.json. Members get static templates.
    app.post('/api/generate-cover-letter', requireOwner, async (req: Request, res: Response) => {
        const webhookUrl = opts.config.n8nCoverLetterUrl;
        if (!webhookUrl) return res.status(500).json({ error: 'N8N_COVER_LETTER_URL is not configured' });
        try {
            const { job } = req.body || {};
            const identity = loadIdentity(opts.config.dataDir);
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job, identity }),
            });
            if (!response.ok) throw new Error(`n8n responded with status: ${response.status}`);

            const rawText = await response.text();
            let result: any;
            try {
                result = JSON.parse(rawText);
            } catch {
                throw new Error(`n8n returned invalid JSON. Raw: "${rawText.slice(0, 200)}"`);
            }
            const text = Array.isArray(result)
                ? (result[0]?.text ?? JSON.stringify(result[0]))
                : (result?.text ?? JSON.stringify(result));
            res.json({ text });
        } catch (err: any) {
            console.error('Failed to generate cover letter via n8n:', err);
            res.status(500).json({ error: `Failed to generate cover letter: ${err.message}` });
        }
    });

    return app;
}
