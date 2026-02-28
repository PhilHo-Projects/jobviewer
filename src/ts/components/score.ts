import { jobs } from '../state';
import { els } from '../dom';
import { getCurrentWeekRange } from '../utils';

export function calculateAndRefreshScore(): void {
    const range = getCurrentWeekRange();

    // Set 2am today as boundary for "today"
    const nowLocal = new Date();
    const boundary = new Date(nowLocal);
    boundary.setHours(2, 0, 0, 0);

    // If it's before 2am, "today" actually started yesterday at 2am
    if (nowLocal.getHours() < 2) {
        boundary.setDate(boundary.getDate() - 1);
    }

    let weeklyNew = 0;
    let weeklyInProgress = 0;
    let weeklyCompleted = 0;
    let todayNew = 0;
    let todayInProgress = 0;
    let todayCompleted = 0;

    const weekWins: Array<{ title: string; company: string }> = [];

    // The start of the current week from utils
    const [startStr] = range.split(' - ');
    const parts = startStr.split('/');
    const weekStartObj = new Date();
    weekStartObj.setMonth(parseInt(parts[0], 10) - 1);
    weekStartObj.setDate(parseInt(parts[1], 10));
    weekStartObj.setHours(2, 0, 0, 0);

    for (const j of jobs) {
        if (j.status === 'deleted') continue;

        let actionDateObj: Date | null = null;
        if (j.status === 'new') {
            actionDateObj = j.scrapedDate ? new Date(j.scrapedDate) : null;
        } else {
            actionDateObj = j.appliedDate ? new Date(j.appliedDate) : null;
        }

        if (!actionDateObj || isNaN(actionDateObj.getTime())) continue;

        const isThisWeek = actionDateObj >= weekStartObj;
        const isToday = actionDateObj >= boundary;

        if (isThisWeek) {
            if (j.status === 'new') weeklyNew++;
            else if (j.status === 'in_progress') weeklyInProgress++;
            else if (j.status === 'completed') weeklyCompleted++;

            if (j.status === 'in_progress' || j.status === 'completed') {
                weekWins.push({
                    title: j.title || 'Unknown',
                    company: j.company || 'Unknown'
                });
            }
        }

        if (isToday) {
            if (j.status === 'new') todayNew++;
            else if (j.status === 'in_progress') todayInProgress++;
            else if (j.status === 'completed') todayCompleted++;
        }
    }

    const weeklyPoints = weeklyInProgress + weeklyCompleted;
    updateScoreboardUI(weeklyPoints, weekWins);
}

export function updateScoreboardUI(points: number, wins: Array<{ title: string; company: string }>): void {
    const GOAL = 10;
    const boundedPoints = Math.min(points, GOAL);
    const pct = Math.floor((boundedPoints / GOAL) * 100);

    if (els.sprintPointsText) els.sprintPointsText.textContent = `${points} / ${GOAL}`;
    if (els.sprintProgressBar) els.sprintProgressBar.style.width = `${pct}%`;

    const isComplete = points >= GOAL;
    if (els.sprintProgressBar) {
        if (isComplete) {
            els.sprintProgressBar.classList.replace('bg-theme-accent', 'bg-emerald-400');
            els.sprintProgressBar.classList.add('animate-pulse');
        } else {
            els.sprintProgressBar.classList.replace('bg-emerald-400', 'bg-theme-accent');
            els.sprintProgressBar.classList.remove('animate-pulse');
        }
    }

    if (els.modalPointsText) els.modalPointsText.textContent = `${points} / ${GOAL} Goals`;
    if (els.modalProgressFill) els.modalProgressFill.style.width = `${pct}%`;

    if (els.currentWeekWins) {
        if (wins.length === 0) {
            els.currentWeekWins.innerHTML = `
                <div class="text-xs text-theme-muted italic">No goals completed this week yet. Keep pushing!</div>
            `;
        } else {
            els.currentWeekWins.innerHTML = wins.map((w, idx) => `
                <div class="flex items-center gap-3 bg-gray-50 p-2 border border-gray-200">
                    <span class="text-[10px] font-black w-4 text-theme-muted">${idx + 1}.</span>
                    <span class="text-xs font-bold text-theme-primary truncate">${w.title}</span>
                    <span class="text-[10px] bg-theme-accent text-black px-1 border border-black truncate max-w-[100px]">${w.company}</span>
                </div>
            `).join('');
        }
    }
}
