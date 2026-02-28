export type JobStatus = 'new' | 'in_progress' | 'completed' | 'deleted';

export interface Job {
    id: string;
    title: string;
    company: string;
    location?: string;
    url?: string;
    status: JobStatus;
    statusSummary?: string;
    statusSummaryUpdatedAt?: string;
    appliedDate?: string | null;
    scrapedDate?: string;
    notes?: string;
    summary?: string;
    posted?: string;
}

export interface HistoryEntry {
    date: string;
    wins: Array<{ title: string; company: string }>;
    basePoints: number;
    scoreMultiplier: number;
    totalPoints: number;
}
