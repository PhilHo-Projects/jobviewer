// Re-export shared types so existing frontend imports don't break
export type { Job, JobStatus, HistoryEntry } from '../../shared/types';

export interface GroupedJobs {
    new: Job[];
    in_progress: Job[];
    completed: Job[];
    deleted: Job[];
}

// Need to import Job for GroupedJobs definition
import type { Job } from '../../shared/types';
