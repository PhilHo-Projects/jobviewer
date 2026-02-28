import { jobs } from './state';
import { GroupedJobs } from './types';

export function escapeHtml(value: any): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function formatDateForInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function todayIsoDate(): string {
    const d = new Date();
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function groupJobs(): GroupedJobs {
    const grouped: GroupedJobs = { new: [], in_progress: [], completed: [], deleted: [] };
    for (const j of jobs) {
        const status = j.status || 'new';
        if (status === 'deleted') grouped.deleted.push(j);
        else if (status === 'in_progress') grouped.in_progress.push(j);
        else if (status === 'completed') grouped.completed.push(j);
        else grouped.new.push(j);
    }
    return grouped;
}

export function getLastReset(): Date {
    const now = new Date();
    const d = new Date(now);
    d.setHours(2, 0, 0, 0); // Always reset at 2:00 AM
    if (now.getDay() === 0 && now.getHours() >= 2) {
        // Today is Sunday post-reset
        return d;
    }
    // Rewind to previous Sunday
    d.setDate(d.getDate() - d.getDay());
    return d;
}

export function getNextResetForHistory(): string {
    const now = new Date();
    const d = new Date(now);
    d.setHours(2, 0, 0, 0);
    if (now.getDay() === 0 && now.getHours() < 2) {
        return d.toISOString();
    }
    // Fast forward to next Sunday at 2am
    d.setDate(now.getDate() + (7 - now.getDay()));
    return d.toISOString();
}

export function getCurrentWeekRange(): string {
    const start = getLastReset();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    function fmt(d: Date) {
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return `${fmt(start)} - ${fmt(end)}`;
}

export function defaultStatusSummaryFor(status: string): string {
    if (status === 'in_progress') return 'Easy Applied';
    if (status === 'completed') return 'Rejected';
    return 'New Job';
}
