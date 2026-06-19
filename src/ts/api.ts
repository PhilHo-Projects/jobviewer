import { Job } from './types';
import { jobs, setJobs, setHistory, isOwner } from './state';
import { setStatus, renderError } from './dom';
import { renderBoard } from './components/board';
import { calculateAndRefreshScore } from './components/score';

const API_BASE = '/job-viewer/api';

export interface MeResponse {
    authenticated: boolean;
    username: string | null;
    role: string | null;
    isDemo: boolean;
}

export async function fetchMe(): Promise<MeResponse> {
    try {
        const res = await fetch(`${API_BASE}/me`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('me failed');
        return await res.json();
    } catch {
        return { authenticated: false, username: null, role: null, isDemo: true };
    }
}

export async function login(username: string, password: string): Promise<MeResponse> {
    const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Invalid credentials');
    return await res.json();
}

export async function logout(): Promise<void> {
    await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'same-origin' });
}

export async function fetchJobs(): Promise<void> {
    setStatus('Loading...');
    try {
        const res = await fetch(`${API_BASE}/jobs`);
        if (!res.ok) throw new Error('Failed to load jobs');
        const data = await res.json();
        setJobs(Array.isArray(data) ? data : []);
        renderBoard();
        calculateAndRefreshScore();
        setStatus(`Loaded ${jobs.length} job${jobs.length === 1 ? '' : 's'}`);
    } catch (e: any) {
        console.error(e);
        setStatus('Error loading jobs');
        renderError(e.message || String(e));
    }
}

export async function fetchHistory(): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/history`);
        if (!res.ok) throw new Error('Failed to load history');
        const data = await res.json();
        setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
        console.error('Failed to load history', e);
        setHistory([]);
    }
}

export async function patchJob(id: string, payload: Partial<Job>): Promise<Job> {
    if (!isOwner) {
        const idx = jobs.findIndex(j => String(j.id) === String(id));
        if (idx !== -1) {
            jobs[idx] = { ...jobs[idx], ...payload } as Job;
            return jobs[idx];
        }
        return { id, ...payload } as Job;
    }
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`PATCH failed (${res.status}): ${txt}`);
    }

    const updated: Job = await res.json();
    const idx = jobs.findIndex(j => String(j.id) === String(updated.id));
    if (idx !== -1) {
        jobs[idx] = updated;
    }
    return updated;
}

export async function createJob(payload: Partial<Job>): Promise<Job> {
    if (!isOwner) {
        return { id: `demo-${Date.now()}`, status: 'new', ...payload } as Job;
    }
    const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Failed to create job');
    return await res.json();
}

export async function deleteDeletedJobs(): Promise<void> {
    if (!isOwner) {
        setJobs(jobs.filter(j => j.status !== 'deleted'));
        return;
    }
    const res = await fetch(`${API_BASE}/jobs/status/deleted`, {
        method: 'DELETE',
        credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Failed to clear bin');
}

export async function fetchScrapeInfo(): Promise<{ lastTriggerDate: string | null }> {
    const res = await fetch(`${API_BASE}/scrape-info`);
    if (!res.ok) throw new Error('Failed to fetch scrape info');
    return await res.json();
}

export async function triggerScrape(): Promise<{ message: string; lastTriggerDate: string }> {
    if (!isOwner) throw new Error('Sign in to trigger a scrape');
    const res = await fetch(`${API_BASE}/trigger-scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Trigger failed' }));
        throw new Error(err.error || 'Failed to trigger scrape');
    }

    return await res.json();
}

export async function generateCoverLetter(job: any): Promise<{ text: string }> {
    if (!isOwner) throw new Error('Sign in to generate an AI cover letter');
    const res = await fetch(`${API_BASE}/generate-cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ job })
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        throw new Error(err.error || 'Failed to generate cover letter');
    }

    return await res.json();
}
