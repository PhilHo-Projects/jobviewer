import { Job } from '../types';
import { jobs, activeJobId, setActiveJobId, setOnConfirmProceed } from '../state';
import { els, $, setStatus } from '../dom';
import { escapeHtml, formatDateForInput, todayIsoDate } from '../utils';
import { patchJob, createJob } from '../api';
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
import { jsPDF } from 'jspdf';
import templateEfficiencyRaw from '../../templates/efficiency.txt?raw';
import templateTwoRaw from '../../templates/two.txt?raw';
import templateThreeRaw from '../../templates/three.txt?raw';

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

export function downloadCoverLetterPDF(): void {
    if (!els.coverLetterContent || !activeJobId) return;

    const job = jobs.find(j => String(j.id) === String(activeJobId));
    if (!job) return;

    const company = (job.company || 'Company').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `Cover_Letter_Philippe_Ho_${company}.pdf`;

    const htmlContent = els.coverLetterContent.innerHTML;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let rawText = '';
    let node;
    const listItems: string[] = [];
    let processingList = false;

    while (node = walker.nextNode()) {
        if (node.nodeType === 3) {
            let text = (node.textContent || '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
            if (processingList && text.trim()) {
                listItems.push(text);
            } else {
                rawText += text;
            }
        } else if (node.nodeType === 1) {
            const elName = node.nodeName.toLowerCase();
            if (elName === 'br') {
                rawText += '\n';
            } else if (elName === 'div' && rawText.length > 0) {
                if (!rawText.endsWith('\n')) rawText += '\n';
            } else if (elName === 'li') {
                processingList = true;
            } else if (elName === 'ul' || elName === 'ol') {
                if (!rawText.endsWith('\n\n')) rawText += '\n';
            }
        }

        // Handle end of list item
        if (node.nodeType === 1 && node.nodeName.toLowerCase() === 'li') {
            // We enter this node above, its children (text) are processed, then we don't easily know when it ends in a single pass without extra tracking.
            // However, simple parsing: if we encounter an element that implies end, we reset.
        }
    }

    // Simplistic text extraction fallback if tree walker approach drops bullets
    const simpleText = tempDiv.innerText.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'in',
        format: 'letter'
    });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);

    const margin = 1;
    let y = margin;
    const maxWidth = 8.5 - (margin * 2);
    const lineHeight = 0.25;

    const lines = pdf.splitTextToSize(simpleText, maxWidth);

    for (let i = 0; i < lines.length; i++) {
        if (y > 11 - margin) {
            pdf.addPage();
            y = margin;
        }
        pdf.text(lines[i], margin, y);
        y += lineHeight;
    }

    pdf.save(filename);
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
