import './input.css';
import { jsPDF } from 'jspdf';
import templateEfficiencyRaw from './templates/efficiency.txt?raw';
import templateTwoRaw from './templates/two.txt?raw';
import templateThreeRaw from './templates/three.txt?raw';

const API_BASE = '/job-viewer/api';

let jobs = [];
let history = [];
let activeJobId = null;

const els = {
    refreshBtn: null,
    statusText: null,
    newCount: null,
    inProgressCount: null,
    completedCount: null,
    newZone: null,
    inProgressZone: null,
    completedZone: null,
    modalBackdrop: null,
    modalTitle: null,
    modalBody: null,
    modalError: null,
    binBackdrop: null,
    binList: null,
    binEmpty: null,
    addBtn: null,
    binBtn: null,
    scoreboardBtn: null,
    scoreboardBackdrop: null,
    sprintPointsText: null,
    sprintProgressBar: null,
    modalPointsText: null,
    modalProgressFill: null,
    currentWeekWins: null,
    confirmBackdrop: null,
    confirmTitle: null,
    confirmMessage: null,
    coverLetterBackdrop: null,
    coverLetterClose: null,
    coverLetterContent: null,
    coverLetterDownload: null,
    coverLetterSubtitle: null,
    modalCoverLetter: null,
    btnTemplateEfficiency: null,
    btnTemplateSecond: null,
    btnTemplateThird: null
};



function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function formatDateForInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function todayIsoDate() {
    const d = new Date();
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text;
}

async function fetchJobs() {
    setStatus('Loading...');
    try {
        const res = await fetch(`${API_BASE}/jobs`);
        if (!res.ok) throw new Error('Failed to load jobs');
        const data = await res.json();
        jobs = Array.isArray(data) ? data : [];
        renderBoard();
        calculateAndRefreshScore();
        setStatus(`Loaded ${jobs.length} job${jobs.length === 1 ? '' : 's'}`);
    } catch (e) {
        console.error(e);
        setStatus('Error loading jobs');
        renderError(e.message || String(e));
    }
}

function renderError(message) {
    els.newZone.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
    els.inProgressZone.innerHTML = '';
    els.completedZone.innerHTML = '';
}

function groupJobs() {
    const grouped = { new: [], in_progress: [], completed: [], deleted: [] };
    for (const j of jobs) {
        const status = j.status || 'new';
        if (status === 'deleted') grouped.deleted.push(j);
        else if (status === 'in_progress') grouped.in_progress.push(j);
        else if (status === 'completed') grouped.completed.push(j);
        else grouped.new.push(j);
    }
    return grouped;
}

function renderBoard() {
    const grouped = groupJobs();

    // Sort "new" column newest-first by scrapedDate
    grouped.new.sort((a, b) => {
        const da = a.scrapedDate ? new Date(a.scrapedDate).getTime() : 0;
        const db = b.scrapedDate ? new Date(b.scrapedDate).getTime() : 0;
        return db - da;
    });

    if (els.newCount) els.newCount.textContent = grouped.new.length;
    if (els.inProgressCount) els.inProgressCount.textContent = grouped.in_progress.length;
    if (els.completedCount) els.completedCount.textContent = grouped.completed.length;

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

function renderCard(job, isDeleted = false) {
    const title = escapeHtml(job.title || 'No title');
    const company = escapeHtml(job.company || 'N/A');
    const location = escapeHtml(job.location || 'N/A');
    const statusSummary = escapeHtml(job.statusSummary || '');
    const id = escapeHtml(job.id);
    const status = escapeHtml(job.status || 'new');
    const hasUrl = Boolean(job.url);

    // Use absolute date from scrapedDate instead of relative 'posted' strings
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

    let statusBadgeClasses = 'bg-blue-500 text-white border-black'; // Default fallback
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
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
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

function wireCardHandlers(container) {
    if (!container) return;
    for (const card of container.querySelectorAll('.card')) {
        const draggable = card.getAttribute('draggable');
        if (draggable !== 'false') card.addEventListener('dragstart', onDragStart);
    }

    for (const btn of container.querySelectorAll('button[data-action="expand"]')) {
        btn.addEventListener('click', () => openModal(btn.getAttribute('data-job-id')));
    }

    for (const btn of container.querySelectorAll('button[data-action="delete"]')) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            softDeleteJob(btn.getAttribute('data-job-id'));
        });
    }

    for (const btn of container.querySelectorAll('button[data-action="restore"]')) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            restoreJob(btn.getAttribute('data-job-id'));
        });
    }

    for (const card of container.querySelectorAll('.card')) {
        card.addEventListener('dblclick', () => openModal(card.getAttribute('data-job-id')));
    }
}

async function clearBin() {
    if (!confirm('Are you sure you want to empty the recycle bin? This cannot be undone.')) return;
    try {
        const res = await fetch(`${API_BASE}/jobs/status/deleted`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to clear bin');
        jobs = jobs.filter(j => j.status !== 'deleted');
        renderBoard();
        setStatus('Bin cleared');
    } catch (e) {
        console.error(e);
        setStatus('Failed to clear bin');
    }
}

async function softDeleteJob(id) {
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

async function restoreJob(id) {
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

function onDragStart(e) {
    const jobId = e.currentTarget.getAttribute('data-job-id');
    e.dataTransfer.setData('text/plain', jobId);
    e.dataTransfer.effectAllowed = 'move';
}

function wireDropzones() {
    const zones = [
        { el: els.newZone, status: 'new' },
        { el: els.inProgressZone, status: 'in_progress' },
        { el: els.completedZone, status: 'completed' }
    ];

    for (const z of zones) {
        if (!z.el) continue;
        z.el.addEventListener('dragover', (e) => {
            e.preventDefault();
            z.el.classList.add('drag-over');
            e.dataTransfer.dropEffect = 'move';
        });

        z.el.addEventListener('dragleave', () => {
            z.el.classList.remove('drag-over');
        });

        z.el.addEventListener('drop', async (e) => {
            e.preventDefault();
            z.el.classList.remove('drag-over');
            const jobId = e.dataTransfer.getData('text/plain');
            if (!jobId) return;

            const job = jobs.find(j => String(j.id) === String(jobId));
            if (!job) return;

            if (job.status === z.status) return;

            const prevStatus = job.status;

            // If moving out of 'new' for the first time this week, or changing tracked status
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

function defaultStatusSummaryFor(status) {
    if (status === 'in_progress') return 'Easy Applied';
    if (status === 'completed') return 'Rejected';
    return 'New Job';
}

async function patchJob(id, payload) {
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`PATCH failed (${res.status}): ${txt}`);
    }

    const updated = await res.json();
    const idx = jobs.findIndex(j => String(j.id) === String(updated.id));
    if (idx !== -1) jobs[idx] = updated;
    return updated;
}

function openModal(jobId) {
    const job = jobs.find(j => String(j.id) === String(jobId));
    if (!job) return;

    activeJobId = jobId;

    if (els.modalTitle) els.modalTitle.textContent = job.title || 'Job details';

    const status = job.status || 'new';
    const statusSummary = job.statusSummary || '';
    const notes = job.notes || '';
    const applied = job.appliedDate ? formatDateForInput(job.appliedDate) : '';

    if (els.modalBody) {
        els.modalBody.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
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

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Job Summary</label>
          <div class="bg-theme-column border border-theme-border rounded-lg text-sm text-theme-secondary p-4 max-h-48 overflow-y-auto leading-relaxed italic opacity-80">
            ${escapeHtml(job.summary || 'No summary available.')}
          </div>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="input-field text-sm px-3 py-3 outline-none min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here...">${escapeHtml(notes)}</textarea>
        </div>
      </div>

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
    `;
    }

    const statusEl = $('modal-status');
    const summaryEl = $('modal-statusSummary');
    const appliedEl = $('modal-appliedDate');

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
            els.modalBackdrop.classList.remove('opacity-0');
            const doc = els.modalBackdrop.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

function renderStatusSummaryOptions(status, currentValue) {
    const presets = {
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

async function saveModal() {
    const isNew = !activeJobId;
    const statusEl = $('modal-status');
    const summaryEl = $('modal-statusSummary');
    const notesEl = $('modal-notes');
    const appliedEl = $('modal-appliedDate');
    const errorEl = els.modalError;

    if (!notesEl) return;
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    const titleEl = $('modal-input-title');
    const companyEl = $('modal-input-company');
    const locationEl = $('modal-input-location');
    const urlEl = $('modal-input-url');

    const status = statusEl ? statusEl.value : 'new';
    const statusSummary = summaryEl ? summaryEl.value : defaultStatusSummaryFor(status);
    const notes = notesEl.value;
    const appliedDateValue = appliedEl ? appliedEl.value : '';

    let appliedDate = null;
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

    const payload = { status, statusSummary, notes, appliedDate };

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
            const res = await fetch(`${API_BASE}/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Failed to create job');
            const saved = await res.json();
            jobs.unshift(saved);
        } else {
            const job = jobs.find(j => String(j.id) === String(activeJobId));
            const prev = { ...job };
            Object.assign(job, payload);
            try {
                await patchJob(activeJobId, payload);
            } catch (e) {
                Object.assign(job, prev);
                throw e;
            }
        }
        renderBoard();
        closeModal();
        setStatus('Saved');
    } catch (e) {
        console.error(e);
        if (errorEl) {
            errorEl.textContent = e.message || 'Failed to save';
            errorEl.classList.remove('hidden');
        }
        setStatus('Failed to save');
    }
}

function closeModal() {
    activeJobId = null;
    if (els.modalBackdrop) {
        els.modalBackdrop.classList.add('opacity-0');
        const doc = els.modalBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');

        setTimeout(() => {
            if (els.modalBackdrop.classList.contains('opacity-0')) {
                els.modalBackdrop.classList.add('hidden');
            }
        }, 200);
    }
}

function wireModal() {
    if (els.modalBackdrop) {
        els.modalBackdrop.addEventListener('click', (e) => {
            if (e.target === els.modalBackdrop) closeModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    const closeBtn = $('modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const saveBtn = $('modal-save');
    if (saveBtn) saveBtn.addEventListener('click', saveModal);

    const clClose = $('cover-letter-close');
    if (clClose) clClose.addEventListener('click', closeCoverLetterModal);

    const clDownload = $('cover-letter-download');
    if (clDownload) clDownload.addEventListener('click', downloadCoverLetterPDF);

    els.modalCoverLetter = $('modal-cover-letter');
    if (els.modalCoverLetter) els.modalCoverLetter.addEventListener('click', () => {
        if (activeJobId) {
            openCoverLetterModal(activeJobId);
        }
    });

    els.btnTemplateEfficiency = $('btn-template-efficiency');
    els.btnTemplateSecond = $('btn-template-second');
    els.btnTemplateThird = $('btn-template-third');

    if (els.btnTemplateEfficiency) els.btnTemplateEfficiency.addEventListener('click', () => setCoverLetterTemplate('efficiency'));
    if (els.btnTemplateSecond) els.btnTemplateSecond.addEventListener('click', () => setCoverLetterTemplate('two'));
    if (els.btnTemplateThird) els.btnTemplateThird.addEventListener('click', () => setCoverLetterTemplate('three'));

    els.coverLetterBackdrop = $('cover-letter-backdrop');
    els.coverLetterContent = $('cover-letter-content');
    els.coverLetterSubtitle = $('cover-letter-subtitle');
}

function setCoverLetterTemplate(type) {
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

function openCoverLetterModal(jobId) {
    const job = jobs.find(j => String(j.id) === String(jobId));
    if (!job) return;

    activeJobId = jobId;

    const title = job.title || '[Job Title]';
    const company = job.company || '[Company Name]';

    if (els.coverLetterSubtitle) {
        els.coverLetterSubtitle.textContent = `Generating for ${company}: ${title}`;
    }

    setCoverLetterTemplate('efficiency');

    if (els.coverLetterBackdrop) {
        els.coverLetterBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.coverLetterBackdrop.classList.remove('opacity-0');
            const doc = els.coverLetterBackdrop.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

function closeCoverLetterModal() {
    activeJobId = null;
    if (els.coverLetterBackdrop) {
        els.coverLetterBackdrop.classList.add('opacity-0');
        const doc = els.coverLetterBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');

        setTimeout(() => {
            if (els.coverLetterBackdrop.classList.contains('opacity-0')) {
                els.coverLetterBackdrop.classList.add('hidden');
            }
        }, 200);
    }
}

function downloadCoverLetterPDF() {
    if (!els.coverLetterContent) return;

    // Use innerText to get clean text without HTML span tags for the highlight!
    const text = els.coverLetterContent.innerText;
    if (!text || text.trim() === '') {
        alert("The cover letter is empty!");
        return;
    }

    const job = jobs.find(j => String(j.id) === String(activeJobId));
    const company = job ? (job.company || 'Company') : 'Company';

    try {
        const doc = new jsPDF();
        const margin = 25.4; // 1-inch margins
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        const maxLineWidth = pageWidth - margin * 2;
        const lineHeight = 6.5;

        // Use standard professional sans-serif font (closest base PDF font to Calibri)
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);

        const splitText = doc.splitTextToSize(text, maxLineWidth);

        let y = margin;
        for (let i = 0; i < splitText.length; i++) {
            if (y > pageHeight - margin) {
                doc.addPage();
                y = margin;
            }

            const line = splitText[i];

            if (line === "philippeho.popnux.com") {
                const fontSize = doc.internal.getFontSize();
                const scale = doc.internal.scaleFactor;
                doc.setTextColor(0, 102, 204); // subtle blue
                doc.text(line, margin, y);
                doc.link(margin, y - fontSize + 3, doc.getStringUnitWidth(line) * fontSize / scale, fontSize, { url: "https://philippeho.popnux.com" });
                doc.setTextColor(0, 0, 0); // reset
            } else if (line === "linkedin.com/in/philippe-ho-03") {
                const fontSize = doc.internal.getFontSize();
                const scale = doc.internal.scaleFactor;
                doc.setTextColor(0, 102, 204); // subtle blue
                doc.text(line, margin, y);
                doc.link(margin, y - fontSize + 3, doc.getStringUnitWidth(line) * fontSize / scale, fontSize, { url: "https://www.linkedin.com/in/philippe-ho-03" });
                doc.setTextColor(0, 0, 0); // reset  
            } else if (line.startsWith("Subject:")) {
                // Bold the subject line
                doc.setFont("helvetica", "bold");
                doc.text(line, margin, y);
                doc.setFont("helvetica", "normal");
            } else if (line === "Philippe Ho" && i > splitText.length - 5) {
                // Bold the name at the bottom
                doc.setFont("helvetica", "bold");
                doc.text(line, margin, y);
                doc.setFont("helvetica", "normal");
            } else {
                // Normal text
                doc.text(line, margin, y);
            }

            y += lineHeight;
        }

        const safeCompany = company.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        doc.save(`Philippe_Ho_Cover_Letter_${safeCompany}.pdf`);
    } catch (e) {
        console.error("PDF generation failed", e);
        alert("Failed to export PDF: " + e.message);
    }
}

function openAddModal() {
    activeJobId = null;
    if (els.modalTitle) els.modalTitle.textContent = 'Add New Job';
    if (els.modalError) {
        els.modalError.textContent = '';
        els.modalError.classList.add('hidden');
    }

    if (els.modalBody) {
        els.modalBody.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Job Title *</label>
          <input id="modal-input-title" type="text" placeholder="Software Engineer"
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Company *</label>
          <input id="modal-input-company" type="text" placeholder="Google"
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Location</label>
          <input id="modal-input-location" type="text" placeholder="Remote / New York"
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Link</label>
          <input id="modal-input-url" type="url" placeholder="https://..."
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="input-field text-sm px-3 py-3 outline-none min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here..."></textarea>
        </div>
      </div>
    `;
    }

    if (els.modalBackdrop) {
        els.modalBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.modalBackdrop.classList.remove('opacity-0');
            const doc = els.modalBackdrop.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

function openBin() {
    if (els.binBackdrop) {
        els.binBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.binBackdrop.classList.remove('opacity-0');
            const doc = els.binBackdrop.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

function closeBin() {
    if (els.binBackdrop) {
        els.binBackdrop.classList.add('opacity-0');
        const doc = els.binBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');
        setTimeout(() => {
            if (els.binBackdrop.classList.contains('opacity-0')) {
                els.binBackdrop.classList.add('hidden');
            }
        }, 200);
    }
}

function getLastReset() {
    const next = getNextResetForHistory();
    const last = new Date(next);
    last.setDate(next.getDate() - 7);
    return last;
}

function getNextResetForHistory() {
    const now = new Date();
    const nextReset = new Date(now);
    const day = now.getDay();
    const daysUntilMonday = (day === 0) ? 1 : (8 - day);
    nextReset.setDate(now.getDate() + daysUntilMonday);
    nextReset.setHours(5, 0, 0, 0);

    if (day === 1 && now.getHours() < 5) {
        nextReset.setDate(now.getDate());
    } else if (day === 1 && now.getHours() >= 5) {
        nextReset.setDate(now.getDate() + 7);
    }
    return nextReset;
}

function getCurrentWeekRange() {
    const last = getLastReset();
    const next = getNextResetForHistory();

    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(last)} - ${fmt(new Date(next.getTime() - 1))}`;
}

function updateScoreboardUI(points, wins) {
    const goal = 10;
    const isGoalMet = points >= goal;
    const progressPercent = Math.min((points / goal) * 100, 100);

    // Update Week Title
    const weekTitleEl = $('current-week-title');
    if (weekTitleEl) {
        weekTitleEl.textContent = `Current Week (${getCurrentWeekRange()})`;
    }

    const color = isGoalMet ? 'var(--color-emerald-400, #34d399)' : 'var(--color-theme-accent, #facc15)';

    // Update Top Gamification Bar
    if (els.sprintPointsText) {
        els.sprintPointsText.textContent = `${points} / ${goal}`;
        if (isGoalMet) {
            els.sprintPointsText.classList.replace('text-theme-primary', 'text-emerald-600');
        } else {
            els.sprintPointsText.classList.replace('text-emerald-600', 'text-theme-primary');
        }
    }

    if (els.sprintProgressBar) {
        els.sprintProgressBar.style.width = `${progressPercent}%`;
        els.sprintProgressBar.style.backgroundColor = color;
    }

    // Update Modal Progress Bar
    if (els.modalProgressFill) {
        els.modalProgressFill.style.width = `${progressPercent}%`;
        els.modalProgressFill.style.backgroundColor = color;
    }
    if (els.modalPointsText) {
        els.modalPointsText.textContent = isGoalMet ? `GOAL MET: ${points} Points` : `${points} / ${goal} Goals`;
        if (isGoalMet) els.modalPointsText.style.backgroundColor = color;
    }

    // Inject the "Wins"
    if (els.currentWeekWins) {
        if (wins.length === 0) {
            els.currentWeekWins.innerHTML = `<div class="text-[10px] text-theme-muted italic">No momentum yet this week... get to applying!</div>`;
        } else {
            els.currentWeekWins.innerHTML = wins.map(w => {
                const s = w.status === 'completed' ? 'Closure Reached!' : 'Application Sent';
                return `<div class="text-xs font-bold font-mono text-black border-l-2 border-theme-accent pl-2">+1 ${escapeHtml(w.company)}: ${escapeHtml(w.title)} <span class="text-[9px] text-theme-muted opacity-80 uppercase ml-1">(${s})</span></div>`;
            }).join('');
        }
    }
}

function calculateAndRefreshScore() {
    const lastReset = getLastReset();

    // Reframe what a "win" is for points: 
    // +1 if it moved this week to in_progress (grind)
    // +1 if it moved this week to completed (closure)
    const wins = jobs.filter(j => {
        if (j.status !== 'in_progress' && j.status !== 'completed') return false;

        // When was it updated to this goal? Either statusSummaryUpdatedAt (reliable) or appliedDate (fallback) or scrapedDate
        const timeVal = j.statusSummaryUpdatedAt || j.appliedDate || j.scrapedDate;
        if (!timeVal) return false;

        const d = new Date(timeVal);
        return d >= lastReset;
    });

    const points = wins.length;
    updateScoreboardUI(points, wins);
}

async function fetchHistory() {
    try {
        const res = await fetch(`${API_BASE}/history`);
        if (!res.ok) throw new Error('Failed to load history');
        history = await res.json();
        renderHistory();
    } catch (e) {
        console.error('History fetch error:', e);
    }
}

function renderHistory() {
    const container = $('scoreboard-history');
    if (!container) return;

    if (history.length === 0) {
        container.innerHTML = `
            <div class="text-[10px] font-bold text-theme-muted uppercase tracking-widest text-center py-4 border-2 border-dashed border-black/5 rounded-lg">
                No history yet. Complete your first week!
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <h4 class="text-[10px] font-black uppercase tracking-widest text-theme-muted mb-4">Past Quests</h4>
        <div class="space-y-4">
            ${history.map(h => `
                <div class="history-item border-l-2 border-theme-border pl-4 py-1">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-[11px] font-black uppercase text-theme-secondary">${escapeHtml(h.weekRange)}</span>
                        <span class="text-[10px] font-bold text-theme-accent">${Math.round(h.percent)}%</span>
                    </div>
                    <div class="relative w-full h-1.5 bg-black/5 rounded-full overflow-hidden mb-2">
                        <div class="absolute h-full bg-theme-accent opacity-50" style="width: ${Math.min(h.percent, 100)}%"></div>
                    </div>
                    ${h.jobTitles && h.jobTitles.length > 0 ? `
                        <details class="group">
                            <summary class="text-[9px] font-bold text-theme-muted cursor-pointer hover:text-theme-primary list-none flex items-center gap-1 uppercase tracking-tighter">
                                <svg class="w-2 h-2 transition-transform group-open:rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M6 6L14 10L6 14V6Z"/></svg>
                                View ${h.jobTitles.length} Job Titles
                            </summary>
                            <ul class="mt-2 space-y-1 pl-3 border-l border-theme-border/50">
                                ${h.jobTitles.map(t => `<li class="text-[10px] font-medium text-theme-secondary truncate">• ${escapeHtml(t)}</li>`).join('')}
                            </ul>
                        </details>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function openScoreboard() {
    fetchHistory(); // Refresh history when opening
    if (els.scoreboardBackdrop) {
        els.scoreboardBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.scoreboardBackdrop.classList.remove('opacity-0');
            const doc = els.scoreboardBackdrop.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

function closeScoreboard() {
    if (els.scoreboardBackdrop) {
        els.scoreboardBackdrop.classList.add('opacity-0');
        const doc = els.scoreboardBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');
        setTimeout(() => {
            if (els.scoreboardBackdrop.classList.contains('opacity-0')) {
                els.scoreboardBackdrop.classList.add('hidden');
            }
        }, 200);
    }
}

let onConfirmProceed = null;

function openConfirm(title, message, onProceed) {
    if (els.confirmTitle) els.confirmTitle.textContent = title;
    if (els.confirmMessage) els.confirmMessage.textContent = message;
    onConfirmProceed = onProceed;

    if (els.confirmBackdrop) {
        els.confirmBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => {
            els.confirmBackdrop.classList.remove('opacity-0');
            const doc = els.confirmBackdrop.querySelector('[role="document"]');
            if (doc) doc.classList.remove('scale-95');
        });
    }
}

function closeConfirm() {
    onConfirmProceed = null;
    if (els.confirmBackdrop) {
        els.confirmBackdrop.classList.add('opacity-0');
        const doc = els.confirmBackdrop.querySelector('[role="document"]');
        if (doc) doc.classList.add('scale-95');
        setTimeout(() => {
            if (els.confirmBackdrop.classList.contains('opacity-0')) {
                els.confirmBackdrop.classList.add('hidden');
            }
        }, 200);
    }
}

async function executeBulkMove(from, to) {
    setStatus(`Moving all ${from} jobs to ${to}...`);
    try {
        const res = await fetch(`${API_BASE}/jobs/bulk-move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to })
        });
        if (!res.ok) throw new Error('Bulk move failed');
        const data = await res.json();

        // Update local jobs array
        jobs = jobs.map(j => {
            if (j.status === from) {
                return { ...j, status: to };
            }
            return j;
        });

        renderBoard();
        setStatus(`Moved ${data.moved} jobs to bin`);
        closeConfirm();
    } catch (e) {
        console.error(e);
        setStatus('Failed to move jobs');
    }
}

function init() {


    els.refreshBtn = $('refresh');
    els.statusText = $('statusText');
    els.newCount = $('count-new');
    els.inProgressCount = $('count-inprogress');
    els.completedCount = $('count-completed');
    els.newZone = $('zone-new');
    els.inProgressZone = $('zone-inprogress');
    els.completedZone = $('zone-completed');
    els.modalBackdrop = $('modal-backdrop');
    els.modalTitle = $('modal-title');
    els.modalBody = $('modal-body');
    els.modalError = $('modal-error');
    els.binBackdrop = $('bin-backdrop');
    els.binList = $('bin-list');
    els.binEmpty = $('bin-empty');
    els.addBtn = $('add-job');
    els.binBtn = $('view-bin');
    els.scoreboardBtn = $('view-scoreboard');
    els.scoreboardBackdrop = $('scoreboard-backdrop');
    els.sprintPointsText = $('sprint-points-text');
    els.sprintProgressBar = $('sprint-progress-bar');
    els.modalPointsText = $('modal-points-text');
    els.modalProgressFill = $('modal-progress-fill');
    els.currentWeekWins = $('current-week-wins');
    els.confirmBackdrop = $('confirm-backdrop');
    els.confirmTitle = $('confirm-title');
    els.confirmMessage = $('confirm-message');
    els.confirmProceed = $('confirm-proceed');
    els.confirmCancel = $('confirm-cancel');

    if (els.refreshBtn) els.refreshBtn.addEventListener('click', fetchJobs);
    if (els.addBtn) els.addBtn.addEventListener('click', openAddModal);
    if (els.binBtn) els.binBtn.addEventListener('click', openBin);
    if (els.scoreboardBtn) els.scoreboardBtn.addEventListener('click', openScoreboard);

    if (els.newCount) {
        els.newCount.addEventListener('click', () => {
            const count = parseInt(els.newCount.textContent);
            if (count > 0) {
                openConfirm(
                    'Dumping New Jobs?',
                    `Are you sure you want to move all ${count} NEW jobs into the recycling bin?`,
                    () => executeBulkMove('new', 'deleted')
                );
            }
        });
    }

    if (els.confirmCancel) els.confirmCancel.addEventListener('click', closeConfirm);
    if (els.confirmProceed) {
        els.confirmProceed.addEventListener('click', () => {
            if (onConfirmProceed) onConfirmProceed();
        });
    }
    if (els.confirmBackdrop) {
        els.confirmBackdrop.addEventListener('click', (e) => {
            if (e.target === els.confirmBackdrop) closeConfirm();
        });
    }

    const binClose = $('bin-close');
    if (binClose) binClose.addEventListener('click', closeBin);

    const scoreClose = $('scoreboard-close');
    if (scoreClose) scoreClose.addEventListener('click', closeScoreboard);

    const binClear = $('bin-clear');
    if (binClear) binClear.addEventListener('click', clearBin);

    if (els.binBackdrop) {
        els.binBackdrop.addEventListener('click', (e) => {
            if (e.target === els.binBackdrop) closeBin();
        });
    }

    if (els.scoreboardBackdrop) {
        els.scoreboardBackdrop.addEventListener('click', (e) => {
            if (e.target === els.scoreboardBackdrop) closeScoreboard();
        });
    }

    wireDropzones();
    wireModal();

    // Init UI with calculated progress
    calculateAndRefreshScore();

    fetchJobs();
}

document.addEventListener('DOMContentLoaded', init);
