import fs from 'fs';
import type { Job } from '../shared/types.js';

/**
 * The anonymous demo dataset. Read once at boot and held in memory — the demo is a
 * fixture, not an account, so it never touches the database and a visitor can never
 * persist to it.
 */
export function loadFixture(samplePath: string): Job[] {
    try {
        if (!fs.existsSync(samplePath)) return [];
        const raw = fs.readFileSync(samplePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as Job[]) : [];
    } catch {
        return [];
    }
}

export const EMPTY_SCRAPE_INFO = { lastTriggerDate: null } as const;
