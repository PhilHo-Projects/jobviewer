import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import type { Db } from './db.js';
import {
    attachUser,
    createSessionToken,
    verifyPassword,
    buildSessionCookie,
    buildClearCookie,
    requireOwner,
    requireWebhookSecret,
    type AuthedRequest,
} from './auth.js';
import { getUserByUsername, getJobs, getHistory, getScrapeInfo, setScrapeInfo, getOwnerUser, upsertJobs, getJobById, patchJob, bulkMove, deleteByStatus, createStableJobId } from './repo.js';
import type { Job } from '../shared/types.js';

export interface AppOptions {
    secret: string;
    dataDir: string;
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
    app.use(express.json({ limit: '50mb' }));

    app.use((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
        if (_req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });

    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (req: Request, res: Response, next: NextFunction) => {
            if (req.path.startsWith('/api')) return next();
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.use(attachUser(db, opts.secret));

    // --- Auth routes ---
    app.get('/api/me', (req: AuthedRequest, res: Response) => {
        const user = req.user;
        res.json({
            authenticated: user?.role === 'owner',
            username: user?.username ?? null,
            role: user?.role ?? null,
            isDemo: user?.role === 'demo',
        });
    });

    app.post('/api/login', (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = getUserByUsername(db, username);
        if (!user || user.role === 'demo' || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = createSessionToken(user.id, opts.secret);
        res.setHeader('Set-Cookie', buildSessionCookie(token, '/'));
        res.json({ username: user.username, role: user.role });
    });

    app.post('/api/logout', (_req: Request, res: Response) => {
        res.setHeader('Set-Cookie', buildClearCookie('/'));
        res.json({ ok: true });
    });

    // --- Owner-only write routes ---
    app.post('/api/jobs', requireOwner, (req: AuthedRequest, res: Response) => {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ error: 'Payload must be a job object' });
        }
        // Resolve the id the same way upsertJobs will, so we can return the exact
        // saved row (getJobs has no ORDER BY, so positional lookup is unreliable).
        const id = payload.id || createStableJobId(payload as Partial<Job>);
        const existed = !!getJobById(db, req.userId!, id);
        upsertJobs(db, req.userId!, [payload as Partial<Job>]);
        const saved = getJobById(db, req.userId!, id);
        return res.status(existed ? 200 : 201).json(saved);
    });

    app.patch('/api/jobs/bulk-move', requireOwner, (req: AuthedRequest, res: Response) => {
        const { from, to } = req.body || {};
        if (!from || !to) {
            return res.status(400).json({ error: 'Source (from) and target (to) statuses are required' });
        }
        const moved = bulkMove(db, req.userId!, from, to);
        res.json({ moved, from, to });
    });

    app.patch('/api/jobs/:id', requireOwner, (req: AuthedRequest, res: Response) => {
        const updated = patchJob(db, req.userId!, String(req.params.id), req.body || {});
        if (!updated) return res.status(404).json({ message: 'Job not found' });
        res.json(updated);
    });

    app.delete('/api/jobs/status/:status', requireOwner, (req: AuthedRequest, res: Response) => {
        const deleted = deleteByStatus(db, req.userId!, String(req.params.status));
        res.json({ deleted, remaining: getJobs(db, req.userId!).length });
    });

    // --- Scoped read routes (owner sees real data, anon sees demo) ---
    app.get('/api/jobs', (req: AuthedRequest, res: Response) => {
        res.json(getJobs(db, req.userId!));
    });

    app.get('/api/history', (req: AuthedRequest, res: Response) => {
        res.json(getHistory(db, req.userId!));
    });

    app.get('/api/scrape-info', (req: AuthedRequest, res: Response) => {
        res.json(getScrapeInfo(db, req.userId!));
    });

    // --- Owner-only n8n integrations ---
    app.post('/api/trigger-scrape', requireOwner, async (req: AuthedRequest, res: Response) => {
        const webhookUrl = process.env.N8N_SCRAPE_URL;
        if (!webhookUrl) return res.status(500).json({ error: 'N8N_SCRAPE_URL is not configured' });

        const info = getScrapeInfo(db, req.userId!);
        const today = new Date().toISOString().split('T')[0];
        if (info.lastTriggerDate === today) {
            return res.status(429).json({ error: 'Scrape already triggered today. Limit: 1 per day.' });
        }
        try {
            const response = await fetch(webhookUrl, { method: 'GET' });
            if (!response.ok) throw new Error(`n8n responded with status: ${response.status}`);
            setScrapeInfo(db, req.userId!, today);
            res.json({ message: 'Scrape triggered successfully', lastTriggerDate: today });
        } catch (err: any) {
            console.error('Failed to trigger n8n:', err);
            res.status(500).json({ error: `Failed to trigger n8n: ${err.message}` });
        }
    });

    app.post('/api/generate-cover-letter', requireOwner, async (req: Request, res: Response) => {
        const webhookUrl = process.env.N8N_COVER_LETTER_URL;
        if (!webhookUrl) return res.status(500).json({ error: 'N8N_COVER_LETTER_URL is not configured' });
        try {
            const { job } = req.body || {};
            const identity = loadIdentity(opts.dataDir);
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

    // --- Inbound delivery from n8n (server-to-server, shared secret) ---
    app.post('/api/receive-jobs', requireWebhookSecret, (req: Request, res: Response) => {
        const payload = req.body;
        if (!Array.isArray(payload)) {
            return res.status(400).json({ error: 'Payload must be an array of jobs' });
        }
        const owner = getOwnerUser(db);
        if (!owner) return res.status(500).json({ error: 'No owner configured' });
        const incoming = payload.filter(Boolean);
        const before = getJobs(db, owner.id).length;
        upsertJobs(db, owner.id, incoming);
        const after = getJobs(db, owner.id).length;
        return res.status(201).json({
            message: 'Jobs received successfully',
            received: incoming.length, before, after,
        });
    });

    return app;
}
