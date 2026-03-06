import { Job } from '../types';
import { jobs, activeJobId, setActiveJobId, setOnConfirmProceed } from '../state';
import { els, $, setStatus } from '../dom';
import { escapeHtml, formatDateForInput, todayIsoDate } from '../utils';
import { patchJob, createJob, generateCoverLetter } from '../api';
import { renderBoard } from './board';

// --- Job Modal Logic ---

export function openModal(jobId: string | null): void {
    let job: Job | undefined;
    if (jobId) {
        job = jobs.find(j => String(j.id) === String(jobId));
        if (!job) return;
    }

    setActiveJobId(jobId);

    if (els.modalTitle) {
        els.modalTitle.textContent = job ? (job.title || 'Job details') : 'Add New Job';
    }

    const status = job ? (job.status || 'new') : 'new';
    const statusSummary = job ? (job.statusSummary || '') : '';
    const notes = job ? (job.notes || '') : '';
    let applied = '';

    if (job && job.appliedDate) {
        applied = formatDateForInput(job.appliedDate);
    } else if (!job) {
        applied = todayIsoDate();
    }

    if (els.modalBody) {
        els.modalBody.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        ${!job ? `
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Title *</label>
          <input id="modal-input-title" type="text" class="input-field text-sm px-3 py-2.5 outline-none" placeholder="Software Engineer" required />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Company *</label>
          <input id="modal-input-company" type="text" class="input-field text-sm px-3 py-2.5 outline-none" placeholder="Acme Corp" required />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Location</label>
          <input id="modal-input-location" type="text" class="input-field text-sm px-3 py-2.5 outline-none" placeholder="Remote / NY" />
        </div>
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">URL</label>
          <input id="modal-input-url" type="url" class="input-field text-sm px-3 py-2.5 outline-none" placeholder="https://..." />
        </div>
        ` : `
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Company</label>
          <div class="input-field text-sm px-3 py-2.5 opacity-80">
            ${escapeHtml(job.company || 'N/A')}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Location</label>
          <div class="input-field text-sm px-3 py-2.5 opacity-80">
            ${escapeHtml(job.location || 'N/A')}
          </div>
        </div>
        `}
        
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Status</label>
          <select id="modal-status" class="input-field text-sm px-3 py-2.5 outline-none appearance-none cursor-pointer">
            <option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
            <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Status Summary</label>
          <select id="modal-statusSummary" class="input-field text-sm px-3 py-2.5 outline-none appearance-none cursor-pointer">
            ${renderStatusSummaryOptions(status, statusSummary)}
          </select>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Applied Date</label>
          <input id="modal-appliedDate" type="date" value="${escapeHtml(applied)}" 
                 class="input-field text-sm px-3 py-2.5 outline-none cursor-pointer" />
        </div>

        ${job ? `
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Job Summary</label>
          <div class="bg-theme-column border border-theme-border rounded-lg text-sm text-theme-secondary p-4 max-h-48 overflow-y-auto leading-relaxed italic opacity-80">
            ${escapeHtml(job.summary || 'No summary available.')}
          </div>
        </div>
        ` : ''}

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="input-field text-sm px-3 py-3 outline-none min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here...">${escapeHtml(notes)}</textarea>
        </div>
      </div>

      ${job ? `
      <div class="mt-8 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-theme-column border border-theme-border">
        <div class="flex items-center gap-4">
          ${job.url ? `<a class="inline-flex items-center gap-2 text-xs font-bold text-theme-accent hover:underline transition-colors" 
                          href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            Open Job Posting
          </a>` : ''}
        </div>
        <div class="text-[10px] font-bold text-theme-muted uppercase tracking-tighter">
          Scraped: ${escapeHtml(job.scrapedDate || 'Unknown')}
        </div>
      </div>
      ` : ''}
    `;
    }

    const statusEl = $('modal-status') as HTMLSelectElement | null;
    const summaryEl = $('modal-statusSummary') as HTMLSelectElement | null;
    const appliedEl = $('modal-appliedDate') as HTMLInputElement | null;

    if (statusEl && summaryEl) {
        statusEl.addEventListener('change', () => {
            const s = statusEl.value;
            summaryEl.innerHTML = renderStatusSummaryOptions(s, summaryEl.value);
        });
    }

    if (summaryEl && appliedEl) {
        summaryEl.addEventListener('change', () => {
            const v = (summaryEl.value || '').toLowerCase();
            if (v === 'applied' && !appliedEl.value) {
                appliedEl.value = todayIsoDate();
            }
        });
    }

    if (els.modalBackdrop) {
        els.modalBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.modalBackdrop!.classList.remove('opacity-0');
            const doc = els.modalBackdrop!.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

export function renderStatusSummaryOptions(status: string, currentValue: string): string {
    const presets: Record<string, string[]> = {
        new: ['New Job'],
        in_progress: [
            'Easy Applied', 'Applied by Email', 'Applied via Website',
            'Messaged Recruiter', 'Screening Call', 'First Interview',
            'Second Interview', 'Third Interview', 'Final Interview'
        ],
        completed: ['Rejected', 'Ghosted', 'Got the job!!']
    };

    const list = presets[status] || ['New job'];
    const normalizedCurrent = String(currentValue || '');
    const hasCurrent = normalizedCurrent && !list.some(x => String(x) === normalizedCurrent);

    const options = [];
    if (hasCurrent) {
        options.push(`<option value="${escapeHtml(normalizedCurrent)}" selected>${escapeHtml(normalizedCurrent)}</option>`);
    }

    for (const opt of list) {
        const selected = String(opt) === normalizedCurrent ? 'selected' : '';
        options.push(`<option value="${escapeHtml(opt)}" ${selected}>${escapeHtml(opt)}</option>`);
    }
    return options.join('');
}

export async function saveModal(): Promise<void> {
    const isNew = !activeJobId;
    const statusEl = $('modal-status') as HTMLSelectElement | null;
    const summaryEl = $('modal-statusSummary') as HTMLSelectElement | null;
    const notesEl = $('modal-notes') as HTMLTextAreaElement | null;
    const appliedEl = $('modal-appliedDate') as HTMLInputElement | null;
    const errorEl = els.modalError;

    if (!notesEl) return;
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    const titleEl = $('modal-input-title') as HTMLInputElement | null;
    const companyEl = $('modal-input-company') as HTMLInputElement | null;
    const locationEl = $('modal-input-location') as HTMLInputElement | null;
    const urlEl = $('modal-input-url') as HTMLInputElement | null;

    const status = statusEl ? (statusEl.value as any) : 'new';
    const statusSummary = summaryEl ? summaryEl.value : 'New Job';
    const notes = notesEl.value;
    const appliedDateValue = appliedEl ? appliedEl.value : '';

    let appliedDate: string | undefined = undefined;
    if (appliedDateValue) {
        const d = new Date(`${appliedDateValue}T00:00:00.000Z`);
        if (isNaN(d.getTime())) {
            if (errorEl) {
                errorEl.textContent = 'Invalid date';
                errorEl.classList.remove('hidden');
            }
            return;
        }
        appliedDate = d.toISOString();
    }

    const payload: Partial<Job> = { status, statusSummary, notes, appliedDate };

    if (isNew) {
        payload.title = titleEl ? titleEl.value : '';
        payload.company = companyEl ? companyEl.value : '';
        payload.location = locationEl ? locationEl.value : '';
        payload.url = urlEl ? urlEl.value : '';
        if (!payload.title || !payload.company) {
            if (errorEl) {
                errorEl.textContent = 'Title and Company are required';
                errorEl.classList.remove('hidden');
            }
            return;
        }
    }

    try {
        if (isNew) {
            const saved = await createJob(payload);
            jobs.unshift(saved);
        } else {
            const job = jobs.find(j => String(j.id) === String(activeJobId));
            if (!job) return;
            const prev = { ...job };
            Object.assign(job, payload);
            try {
                await patchJob(activeJobId!, payload);
            } catch (e) {
                Object.assign(job, prev);
                throw e;
            }
        }
        renderBoard();
        closeModal();
        setStatus('Saved');
    } catch (e: any) {
        console.error(e);
        if (errorEl) {
            errorEl.textContent = e.message || 'Failed to save';
            errorEl.classList.remove('hidden');
        }
        setStatus('Failed to save');
    }
}

export function closeModal(): void {
    setActiveJobId(null);
    if (els.modalBackdrop) {
        els.modalBackdrop.classList.add('opacity-0');
        const doc = els.modalBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');

        setTimeout(() => {
            if (els.modalBackdrop!.classList.contains('opacity-0')) {
                els.modalBackdrop!.classList.add('hidden');
            }
        }, 200);
    }
}

// --- Cover Letter Modal Logic ---

import templateEfficiencyRaw from '../../templates/efficiency.txt?raw';
import templateTwoRaw from '../../templates/two.txt?raw';
import templateThreeRaw from '../../templates/three.txt?raw';

export async function generateCoverLetterWithAI(): Promise<void> {
    if (!activeJobId || !els.coverLetterContent || !els.btnTemplateAi) return;
    const job = jobs.find(j => String(j.id) === String(activeJobId));
    if (!job) return;

    // Reset button styles
    [els.btnTemplateEfficiency, els.btnTemplateSecond, els.btnTemplateThird].forEach(btn => {
        if (!btn) return;
        btn.classList.remove('bg-theme-accent', 'text-black');
        btn.classList.add('bg-gray-200', 'text-black');
    });

    els.btnTemplateAi.classList.add('animate-pulse', 'opacity-80');
    els.btnTemplateAi.setAttribute('disabled', 'true');
    els.coverLetterContent.innerHTML = '<div class="text-theme-muted flex items-center gap-2"><svg class="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating with AI Magic... Please wait <br/><br/>(Triggering n8n webhook)</div>';

    try {
        const result = await generateCoverLetter(job);
        els.coverLetterContent.innerHTML = markdownToHtml(result.text || 'Received empty response from n8n.');
    } catch (err: any) {
        els.coverLetterContent.innerHTML = `<span class="text-rose-500 font-bold">Error generating cover letter: <br/><br/>${err.message}</span>`;
    } finally {
        els.btnTemplateAi.classList.remove('animate-pulse', 'opacity-80');
        els.btnTemplateAi.removeAttribute('disabled');
    }
}

export function setCoverLetterTemplate(type: string): void {
    if (!activeJobId || !els.coverLetterContent) return;
    const job = jobs.find(j => String(j.id) === String(activeJobId));
    if (!job) return;

    // Reset button styles
    [els.btnTemplateEfficiency, els.btnTemplateSecond, els.btnTemplateThird].forEach(btn => {
        if (!btn) return;
        btn.classList.remove('bg-theme-accent', 'text-black');
        btn.classList.add('bg-gray-200', 'text-black');
    });

    const title = escapeHtml(job.title || '[Job Title]');
    const company = escapeHtml(job.company || '[Company Name]');
    const highlightedTitle = `<span class="bg-yellow-300 text-black px-1 font-bold border-b-2 border-black">${title}</span>`;
    const highlightedCompany = `<span class="bg-yellow-300 text-black px-1 font-bold border-b-2 border-black">${company}</span>`;

    let templateHtml = '';

    if (type === 'efficiency') {
        if (els.btnTemplateEfficiency) {
            els.btnTemplateEfficiency.classList.add('bg-theme-accent', 'text-black');
            els.btnTemplateEfficiency.classList.remove('bg-gray-200', 'text-white');
        }
        templateHtml = templateEfficiencyRaw;
    } else if (type === 'two') {
        if (els.btnTemplateSecond) {
            els.btnTemplateSecond.classList.add('bg-theme-accent', 'text-black');
            els.btnTemplateSecond.classList.remove('bg-gray-200', 'text-white');
        }
        templateHtml = templateTwoRaw;
    } else if (type === 'three') {
        if (els.btnTemplateThird) {
            els.btnTemplateThird.classList.add('bg-theme-accent', 'text-black');
            els.btnTemplateThird.classList.remove('bg-gray-200', 'text-white');
        }
        templateHtml = templateThreeRaw;
    }

    templateHtml = templateHtml
        .replaceAll('{{title}}', highlightedTitle)
        .replaceAll('{{company}}', highlightedCompany);

    els.coverLetterContent.innerHTML = templateHtml;
}

export function openCoverLetterModal(jobId: string | null): void {
    if (!jobId) return;
    const job = jobs.find(j => String(j.id) === String(jobId));
    if (!job) return;

    setActiveJobId(jobId);

    const title = job.title || '[Job Title]';
    const company = job.company || '[Company Name]';

    if (els.coverLetterSubtitle) {
        els.coverLetterSubtitle.textContent = `Generating for ${company}: ${title}`;
    }

    setCoverLetterTemplate('efficiency');

    if (els.coverLetterBackdrop) {
        els.coverLetterBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.coverLetterBackdrop!.classList.remove('opacity-0');
            const doc = els.coverLetterBackdrop!.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

export function closeCoverLetterModal(): void {
    setActiveJobId(null);
    if (els.coverLetterBackdrop) {
        els.coverLetterBackdrop.classList.add('opacity-0');
        const doc = els.coverLetterBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');

        setTimeout(() => {
            if (els.coverLetterBackdrop!.classList.contains('opacity-0')) {
                els.coverLetterBackdrop!.classList.add('hidden');
            }
        }, 200);
    }
}

function markdownToHtml(text: string): string {
    // Escape any raw HTML first
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Bold: **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text* (single, not preceded/followed by *)
    html = html.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Bullet list items: lines starting with * or -
    html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
    // Wrap consecutive <li> blocks in <ul>
    html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Paragraph breaks (double newlines)
    html = html.replace(/\n\n/g, '</p><p>');
    // Remaining single newlines
    html = html.replace(/\n/g, '<br>');

    return `<p>${html}</p>`;
}

export function downloadCoverLetterPDF(): void {
    if (!els.coverLetterContent || !activeJobId) return;
    const job = jobs.find(j => String(j.id) === String(activeJobId));
    if (!job) return;

    const content = els.coverLetterContent.innerHTML;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Pop-up blocked! Please allow pop-ups for this site to use PDF print preview.');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Cover Letter – ${job.company || 'Cover Letter'}</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    font-family: Georgia, 'Times New Roman', serif;
                    font-size: 11pt;
                    line-height: 1.65;
                    color: #111;
                    padding: 1in;
                    max-width: 8.5in;
                    margin: 0 auto;
                }
                p { margin-bottom: 0.75em; }
                strong { font-weight: bold; }
                em { font-style: italic; }
                ul { margin: 0.5em 0 0.75em 1.5em; }
                li { margin-bottom: 0.35em; }
                @media print {
                    body { padding: 0; }
                    @page { margin: 0.75in; }
                }
            </style>
        </head>
        <body>${content}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 400);
}

// --- Bin Logic ---

export async function softDeleteJob(id: string): Promise<void> {
    const job = jobs.find(j => String(j.id) === String(id));
    if (!job) return;
    const prev = job.status;
    job.status = 'deleted';
    renderBoard();
    try {
        await patchJob(id, { status: 'deleted' });
        setStatus('Moved to bin');
    } catch (e) {
        job.status = prev;
        renderBoard();
        setStatus('Failed to delete');
    }
}

export async function restoreJob(id: string): Promise<void> {
    const job = jobs.find(j => String(j.id) === String(id));
    if (!job) return;
    const prev = job.status;
    job.status = 'new';
    renderBoard();
    try {
        await patchJob(id, { status: 'new' });
        setStatus('Restored');
    } catch (e) {
        job.status = prev;
        renderBoard();
        setStatus('Failed to restore');
    }
}

export function openBin(): void {
    if (els.binBackdrop) {
        els.binBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.binBackdrop!.classList.remove('opacity-0');
            const doc = els.binBackdrop!.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

export function closeBin(): void {
    if (els.binBackdrop) {
        els.binBackdrop.classList.add('opacity-0');
        const doc = els.binBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');

        setTimeout(() => {
            if (els.binBackdrop!.classList.contains('opacity-0')) {
                els.binBackdrop!.classList.add('hidden');
            }
        }, 200);
    }
}

// --- Scoreboard Modal ---

export function openScoreboard(): void {
    if (els.scoreboardBackdrop) {
        els.scoreboardBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.scoreboardBackdrop!.classList.remove('opacity-0');
            const doc = els.scoreboardBackdrop!.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

export function closeScoreboard(): void {
    if (els.scoreboardBackdrop) {
        els.scoreboardBackdrop.classList.add('opacity-0');
        const doc = els.scoreboardBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');

        setTimeout(() => {
            if (els.scoreboardBackdrop!.classList.contains('opacity-0')) {
                els.scoreboardBackdrop!.classList.add('hidden');
            }
        }, 200);
    }
}

// --- Confirm Modal ---

export function openConfirm(title: string, message: string, onProceed: () => void): void {
    if (els.confirmTitle) els.confirmTitle.textContent = title;
    if (els.confirmMessage) els.confirmMessage.textContent = message;

    setOnConfirmProceed(onProceed);

    if (els.confirmBackdrop) {
        els.confirmBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.confirmBackdrop!.classList.remove('opacity-0');
            const doc = els.confirmBackdrop!.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

export function closeConfirm(): void {
    setOnConfirmProceed(null);
    if (els.confirmBackdrop) {
        els.confirmBackdrop.classList.add('opacity-0');
        const doc = els.confirmBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');

        setTimeout(() => {
            if (els.confirmBackdrop!.classList.contains('opacity-0')) {
                els.confirmBackdrop!.classList.add('hidden');
            }
        }, 200);
    }
}
