import { Job } from '../types';
import { jobs } from '../state';
import { els, setStatus } from '../dom';
import { escapeHtml, groupJobs, defaultStatusSummaryFor } from '../utils';
import { patchJob } from '../api';
import { openModal, softDeleteJob, restoreJob } from './modals';
import { calculateAndRefreshScore } from './score';

export function renderBoard(): void {
    const grouped = groupJobs();

    // Sort "new" column newest-first by scrapedDate
    grouped.new.sort((a, b) => {
        const da = a.scrapedDate ? new Date(a.scrapedDate).getTime() : 0;
        const db = b.scrapedDate ? new Date(b.scrapedDate).getTime() : 0;
        return db - da;
    });

    if (els.newCount) els.newCount.textContent = String(grouped.new.length);
    if (els.inProgressCount) els.inProgressCount.textContent = String(grouped.in_progress.length);
    if (els.completedCount) els.completedCount.textContent = String(grouped.completed.length);

    if (els.newZone) els.newZone.innerHTML = grouped.new.map(j => renderCard(j)).join('');
    if (els.inProgressZone) els.inProgressZone.innerHTML = grouped.in_progress.map(j => renderCard(j)).join('');
    if (els.completedZone) els.completedZone.innerHTML = grouped.completed.map(j => renderCard(j)).join('');

    if (els.binList) {
        els.binList.innerHTML = grouped.deleted.map(j => renderCard(j, true)).join('');
        if (els.binEmpty) els.binEmpty.classList.toggle('hidden', grouped.deleted.length > 0);
    }

    wireCardHandlers(els.newZone);
    wireCardHandlers(els.inProgressZone);
    wireCardHandlers(els.completedZone);
    wireCardHandlers(els.binList);

    calculateAndRefreshScore();
}

export function renderCard(job: Job, isDeleted: boolean = false): string {
    const title = escapeHtml(job.title || 'No title');
    const company = escapeHtml(job.company || 'N/A');
    const location = escapeHtml(job.location || 'N/A');
    const statusSummary = escapeHtml(job.statusSummary || '');
    const id = escapeHtml(job.id);
    const status = escapeHtml(job.status || 'new');
    const hasUrl = Boolean(job.url);

    let dateStr = '';
    const dateObj = job.scrapedDate ? new Date(job.scrapedDate) : null;
    if (dateObj && !isNaN(dateObj.getTime())) {
        const d = String(dateObj.getDate()).padStart(2, '0');
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const y = String(dateObj.getFullYear()).slice(-2);
        dateStr = `Found ${d}/${m}/${y}`;
    } else if (job.posted) {
        dateStr = `Found ${job.posted}`;
    }

    const sLow = statusSummary.toLowerCase();
    const updatedAt = job.statusSummaryUpdatedAt ? new Date(job.statusSummaryUpdatedAt) : null;
    let dateStrFormatted = '';
    if (updatedAt) {
        const d = String(updatedAt.getDate()).padStart(2, '0');
        const m = String(updatedAt.getMonth() + 1).padStart(2, '0');
        const y = String(updatedAt.getFullYear()).slice(-2);
        dateStrFormatted = `${d}/${m}/${y}`;
    }

    let statusBadgeClasses = 'bg-blue-500 text-white border-black';
    if (status === 'completed') {
        if (sLow.includes('got the job')) {
            statusBadgeClasses = 'bg-emerald-500 text-white border-black animate-celebrate';
        } else if (sLow.includes('rejected') || sLow.includes('ghosted')) {
            statusBadgeClasses = 'bg-[#ff0040] text-white border-black';
        } else {
            statusBadgeClasses = 'bg-black text-white border-black';
        }
    } else if (status === 'in_progress') {
        statusBadgeClasses = 'bg-emerald-400 text-black border-black';
    } else {
        statusBadgeClasses = 'bg-white text-black border-black';
    }

    statusBadgeClasses += ' border-2 shadow-[2px_2px_0_#000]';

    return `
    <article class="card group relative p-4 transition-all duration-200 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md ${isDeleted ? 'opacity-70 grayscale-[0.5]' : ''}" 
             draggable="${!isDeleted}" data-job-id="${id}" data-status="${status}">
      
      <div class="flex justify-between items-start gap-4 mb-2">
        <div class="text-sm font-bold text-theme-primary group-hover:text-theme-accent transition-colors line-clamp-2 leading-tight">${title}</div>
        ${!isDeleted ? `
        <button type="button" data-action="delete" data-job-id="${id}" title="Move to Bin"
                class="text-theme-muted hover:text-rose-500 p-1 rounded transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
        ` : `
        <button type="button" data-action="restore" data-job-id="${id}" title="Restore Job"
                class="text-theme-muted hover:text-emerald-500 p-1 rounded transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.58m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>
        `}
      </div>

      <div class="flex flex-wrap gap-x-3 gap-y-1 mb-2">
        <span class="text-[11px] font-medium text-theme-secondary flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-7h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          ${company}
        </span>
        <span class="text-[11px] font-medium text-theme-secondary flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          ${location}
        </span>
      </div>

      ${dateStr ? `
      <div class="flex items-center gap-1.5 mb-3">
        <span class="text-[11px] font-bold text-theme-muted flex items-center gap-1.5">
          <svg class="w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          ${escapeHtml(dateStr)}
        </span>
      </div>
      ` : ''}

      <div class="flex items-center gap-2 mb-3">
        ${(statusSummary && status !== 'new') ? `
            <div class="flex items-center gap-2">
                <div class="status-badge inline-flex items-center px-2 py-0.5 rounded border ${statusBadgeClasses} text-[10px] font-bold uppercase tracking-wider">
                    ${statusSummary}
                </div>
                ${dateStrFormatted ? `<span class="text-[9px] font-bold text-theme-muted">${dateStrFormatted}</span>` : ''}
            </div>
` : ''}
      </div>

      <div class="flex items-center justify-between mt-auto gap-3 pt-3 border-t border-theme-border">
        <button type="button" data-action="expand" data-job-id="${id}" 
                class="details-btn inline-flex items-center justify-center rounded-md bg-theme-button hover:bg-theme-button-hover text-theme-primary text-[11px] font-bold px-3 py-1.5 transition-all border border-theme-border">
          Details
        </button>
        ${hasUrl ? `
          <a class="inline-flex items-center gap-1 text-[11px] font-bold text-theme-accent hover:underline transition-colors" 
             href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">
            Open Posting ↗
          </a>
        ` : '<span class="w-1"></span>'}
      </div>
    </article>
  `;
}

export function wireCardHandlers(container: HTMLElement | null): void {
    if (!container) return;
    for (const card of container.querySelectorAll('.card') as any) {
        const draggable = card.getAttribute('draggable');
        if (draggable !== 'false') card.addEventListener('dragstart', onDragStart);
    }

    for (const btn of container.querySelectorAll('button[data-action="expand"]') as any) {
        btn.addEventListener('click', () => openModal(btn.getAttribute('data-job-id')));
    }

    for (const btn of container.querySelectorAll('button[data-action="delete"]') as any) {
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            softDeleteJob(btn.getAttribute('data-job-id') || '');
        });
    }

    for (const btn of container.querySelectorAll('button[data-action="restore"]') as any) {
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            restoreJob(btn.getAttribute('data-job-id') || '');
        });
    }

    for (const card of container.querySelectorAll('.card') as any) {
        card.addEventListener('dblclick', () => openModal(card.getAttribute('data-job-id')));
    }
}

function onDragStart(e: DragEvent): void {
    const target = e.currentTarget as HTMLElement;
    const jobId = target.getAttribute('data-job-id');
    if (e.dataTransfer && jobId) {
        e.dataTransfer.setData('text/plain', jobId);
        e.dataTransfer.effectAllowed = 'move';
    }
}

export function wireDropzones(): void {
    const zones = [
        { el: els.newZone, status: 'new' as const },
        { el: els.inProgressZone, status: 'in_progress' as const },
        { el: els.completedZone, status: 'completed' as const }
    ];

    for (const z of zones) {
        if (!z.el) continue;

        z.el.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            z.el!.classList.add('drag-over');
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
        });

        z.el.addEventListener('dragleave', () => {
            z.el!.classList.remove('drag-over');
        });

        z.el.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            z.el!.classList.remove('drag-over');

            if (!e.dataTransfer) return;
            const jobId = e.dataTransfer.getData('text/plain');
            if (!jobId) return;

            const job = jobs.find(j => String(j.id) === String(jobId));
            if (!job) return;

            if (job.status === z.status) return;

            const prevStatus = job.status;

            if (prevStatus === 'new' && (z.status === 'in_progress' || z.status === 'completed')) {
                if (!job.appliedDate) job.appliedDate = new Date().toISOString();
            }

            job.status = z.status;
            job.statusSummary = defaultStatusSummaryFor(z.status);

            renderBoard();

            try {
                await patchJob(jobId, {
                    status: job.status,
                    statusSummary: job.statusSummary,
                    notes: job.notes,
                    appliedDate: job.appliedDate
                });
                setStatus('Saved');
            } catch (err) {
                console.error(err);
                job.status = prevStatus;
                renderBoard();
                setStatus('Failed to save move');
            }
        });
    }
}
