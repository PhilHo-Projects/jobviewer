import { Job } from './types';
import { jobs, setJobs, setHistory } from './state';
import { setStatus, renderError } from './dom';
import { renderBoard } from './components/board';
import { calculateAndRefreshScore } from './components/score';

const API_BASE = '/job-viewer/api';

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
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Failed to create job');
    return await res.json();
}

export async function deleteDeletedJobs(): Promise<void> {
    const res = await fetch(`${API_BASE}/jobs/status/deleted`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear bin');
}
