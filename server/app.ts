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
    type AuthedRequest,
} from './auth.js';
import { getUserByUsername, getJobs, getHistory, getScrapeInfo, upsertJobs, getJobById, patchJob, bulkMove, deleteByStatus } from './repo.js';
import type { Job } from '../shared/types.js';

export interface AppOptions {
    secret: string;
    dataDir: string;
}

const BASE_PATH = '/job-viewer';

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
        app.use(BASE_PATH, express.static(distPath));
        app.get(`${BASE_PATH}/*`, (req: Request, res: Response, next: NextFunction) => {
            if (req.path.startsWith(`${BASE_PATH}/api`)) return next();
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.use(attachUser(db, opts.secret));

    // --- Auth routes ---
    app.get(`${BASE_PATH}/api/me`, (req: AuthedRequest, res: Response) => {
        const user = req.user;
        res.json({
            authenticated: user?.role === 'owner',
            username: user?.username ?? null,
            role: user?.role ?? null,
            isDemo: user?.role === 'demo',
        });
    });

    app.post(`${BASE_PATH}/api/login`, (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = getUserByUsername(db, username);
        if (!user || user.role === 'demo' || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = createSessionToken(user.id, opts.secret);
        res.setHeader('Set-Cookie', buildSessionCookie(token, BASE_PATH));
        res.json({ username: user.username, role: user.role });
    });

    app.post(`${BASE_PATH}/api/logout`, (_req: Request, res: Response) => {
        res.setHeader('Set-Cookie', buildClearCookie(BASE_PATH));
        res.json({ ok: true });
    });

    // --- Owner-only write routes ---
    app.post(`${BASE_PATH}/api/jobs`, requireOwner, (req: AuthedRequest, res: Response) => {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ error: 'Payload must be a job object' });
        }
        const existed = !!(payload.id && getJobById(db, req.userId!, payload.id));
        const all = upsertJobs(db, req.userId!, [payload as Partial<Job>]);
        const saved = existed
            ? getJobById(db, req.userId!, payload.id)
            : all[all.length - 1];
        return res.status(existed ? 200 : 201).json(saved);
    });

    app.patch(`${BASE_PATH}/api/jobs/bulk-move`, requireOwner, (req: AuthedRequest, res: Response) => {
        const { from, to } = req.body || {};
        if (!from || !to) {
            return res.status(400).json({ error: 'Source (from) and target (to) statuses are required' });
        }
        const moved = bulkMove(db, req.userId!, from, to);
        res.json({ moved, from, to });
    });

    app.patch(`${BASE_PATH}/api/jobs/:id`, requireOwner, (req: AuthedRequest, res: Response) => {
        const updated = patchJob(db, req.userId!, req.params.id, req.body || {});
        if (!updated) return res.status(404).json({ message: 'Job not found' });
        res.json(updated);
    });

    app.delete(`${BASE_PATH}/api/jobs/status/:status`, requireOwner, (req: AuthedRequest, res: Response) => {
        const deleted = deleteByStatus(db, req.userId!, req.params.status);
        res.json({ deleted, remaining: getJobs(db, req.userId!).length });
    });

    // --- Scoped read routes (owner sees real data, anon sees demo) ---
    app.get(`${BASE_PATH}/api/jobs`, (req: AuthedRequest, res: Response) => {
        res.json(getJobs(db, req.userId!));
    });

    app.get(`${BASE_PATH}/api/history`, (req: AuthedRequest, res: Response) => {
        res.json(getHistory(db, req.userId!));
    });

    app.get(`${BASE_PATH}/api/scrape-info`, (req: AuthedRequest, res: Response) => {
        res.json(getScrapeInfo(db, req.userId!));
    });

    return app;
}
