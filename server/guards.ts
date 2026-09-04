import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from './auth.js';

export interface AuthedRequest extends Request {
    user?: SessionUser | null;
}

export function requireUser(req: AuthedRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    next();
}

export function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
    if (req.user?.role !== 'owner') {
        res.status(403).json({ error: 'Owner access required' });
        return;
    }
    next();
}
