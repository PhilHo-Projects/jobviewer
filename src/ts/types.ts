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
    appliedDate?: string;
    scrapedDate?: string;
    notes?: string;
    summary?: string;
    posted?: string; // Legacy relative dates
}

export interface GroupedJobs {
    new: Job[];
    in_progress: Job[];
    completed: Job[];
    deleted: Job[];
}

export interface HistoryEntry {
    date: string; // ISO date string without time
    wins: Array<{ title: string; company: string }>;
    basePoints: number;
    scoreMultiplier: number;
    totalPoints: number;
}
