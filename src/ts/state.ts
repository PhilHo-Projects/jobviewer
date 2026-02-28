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
