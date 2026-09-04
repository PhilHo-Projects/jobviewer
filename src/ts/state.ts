import { Job, HistoryEntry } from './types';

export let jobs: Job[] = [];
export let history: HistoryEntry[] = [];
export let activeJobId: string | null = null;
export let onConfirmProceed: (() => void) | null = null;

export function setJobs(newJobs: Job[]) {
    jobs = newJobs;
}

export function setHistory(newHistory: HistoryEntry[]) {
    history = newHistory;
}

export function setActiveJobId(id: string | null) {
    activeJobId = id;
}

export function setOnConfirmProceed(cb: (() => void) | null) {
    onConfirmProceed = cb;
}

export function getJobById(id: string): Job | undefined {
    return jobs.find(j => String(j.id) === String(id));
}

/**
 * Two flags, not one. `isAuthenticated` gates persistence — any signed-in member
 * writes to their own board. `isOwner` gates the admin panel and the AI cover letter,
 * which reads the owner's own identity.json.
 */
export let isAuthenticated = false;
export function setIsAuthenticated(v: boolean) {
    isAuthenticated = v;
}

export let isOwner = false;
export function setIsOwner(v: boolean) {
    isOwner = v;
}

export let pendingCount = 0;
export function setPendingCount(n: number) {
    pendingCount = n;
}

export let currentUser: { username: string | null; role: string | null } = {
    username: null,
    role: null,
};
export function setCurrentUser(u: { username: string | null; role: string | null }) {
    currentUser = u;
}
