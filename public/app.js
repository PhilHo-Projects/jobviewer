const API_BASE = '/job-viewer/api';

let jobs = [];
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
  modalBody: null
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
  els.statusText.textContent = text;
}

async function fetchJobs() {
  setStatus('Loading...');
  try {
    const res = await fetch(`${API_BASE}/jobs`);
    if (!res.ok) throw new Error('Failed to load jobs');
    const data = await res.json();
    jobs = Array.isArray(data) ? data : [];
    renderBoard();
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
  const grouped = { new: [], in_progress: [], completed: [] };
  for (const j of jobs) {
    const status = j.status || 'new';
    if (status === 'in_progress') grouped.in_progress.push(j);
    else if (status === 'completed') grouped.completed.push(j);
    else grouped.new.push(j);
  }
  return grouped;
}

function renderBoard() {
  const grouped = groupJobs();

  els.newCount.textContent = grouped.new.length;
  els.inProgressCount.textContent = grouped.in_progress.length;
  els.completedCount.textContent = grouped.completed.length;

  els.newZone.innerHTML = grouped.new.map(renderCard).join('');
  els.inProgressZone.innerHTML = grouped.in_progress.map(renderCard).join('');
  els.completedZone.innerHTML = grouped.completed.map(renderCard).join('');

  wireCardHandlers(els.newZone);
  wireCardHandlers(els.inProgressZone);
  wireCardHandlers(els.completedZone);
}

function renderCard(job) {
  const title = escapeHtml(job.title || 'No title');
  const company = escapeHtml(job.company || 'N/A');
  const location = escapeHtml(job.location || 'N/A');
  const statusSummary = escapeHtml(job.statusSummary || '');
  const id = escapeHtml(job.id);
  const status = escapeHtml(job.status || 'new');
  const hasUrl = Boolean(job.url);

  // Status mapping for conditional classes
  const sLow = statusSummary.toLowerCase();
  let statusBadgeClasses = 'bg-blue-500/10 text-blue-400 border-blue-500/20'; // Default for new/in_progress

  if (status === 'completed') {
    if (sLow.includes('interview')) {
      statusBadgeClasses = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    } else if (sLow.includes('rejected') || sLow.includes('denied') || sLow.includes('ghosted')) {
      statusBadgeClasses = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    } else {
      statusBadgeClasses = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  }

  return `
    <article class="card group relative bg-slate-900 hover:bg-slate-800/80 border border-slate-800 rounded-xl p-4 transition-all duration-200 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md" 
             draggable="true" data-job-id="${id}" data-status="${status}">
      
      <div class="flex justify-between items-start gap-4 mb-2">
        <div class="text-sm font-bold text-slate-100 group-hover:text-blue-400 transition-colors line-clamp-2 leading-tight">${title}</div>
      </div>

      <div class="flex flex-wrap gap-x-3 gap-y-1 mb-3">
        <span class="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-7h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          ${company}
        </span>
        <span class="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          ${location}
        </span>
      </div>

      ${statusSummary ? `
        <div class="inline-flex items-center px-2 py-0.5 rounded border ${statusBadgeClasses} text-[10px] font-bold uppercase tracking-wider mb-4">
          ${statusSummary}
        </div>
      ` : ''}

      <div class="flex items-center justify-between mt-auto gap-3 pt-3 border-t border-slate-800/50">
        <button type="button" data-action="expand" data-job-id="${id}" 
                class="inline-flex items-center justify-center rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-bold px-3 py-1.5 transition-colors">
          Details
        </button>
        ${hasUrl ? `
          <a class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors" 
             href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">
            Open Posting ↗
          </a>
        ` : '<span class="w-1"></span>'}
      </div>
    </article>
  `;
}

function wireCardHandlers(container) {
  for (const card of container.querySelectorAll('.card')) {
    card.addEventListener('dragstart', onDragStart);
  }

  for (const btn of container.querySelectorAll('button[data-action="expand"]')) {
    btn.addEventListener('click', () => openModal(btn.getAttribute('data-job-id')));
  }

  for (const card of container.querySelectorAll('.card')) {
    card.addEventListener('dblclick', () => openModal(card.getAttribute('data-job-id')));
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
      job.status = z.status;

      if (!job.statusSummary) job.statusSummary = defaultStatusSummaryFor(z.status);

      if (z.status === 'completed' && (job.statusSummary || '').toLowerCase() === 'applied' && !job.appliedDate) {
        job.appliedDate = new Date().toISOString();
      }

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
  if (status === 'in_progress') return 'In progress';
  if (status === 'completed') return 'Completed';
  return 'New job';
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

  els.modalTitle.textContent = job.title || 'Job details';

  const status = job.status || 'new';
  const statusSummary = job.statusSummary || '';
  const notes = job.notes || '';
  const applied = job.appliedDate ? formatDateForInput(job.appliedDate) : '';

  els.modalBody.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Company</label>
        <div class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-300 px-3 py-2.5 opacity-60">
          ${escapeHtml(job.company || 'N/A')}
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Location</label>
        <div class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-300 px-3 py-2.5 opacity-60">
          ${escapeHtml(job.location || 'N/A')}
        </div>
      </div>
      
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Status</label>
        <select id="modal-status" class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all appearance-none cursor-pointer">
          <option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
          <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Status Summary</label>
        <select id="modal-statusSummary" class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all appearance-none cursor-pointer">
          ${renderStatusSummaryOptions(status, statusSummary)}
        </select>
      </div>

      <div class="flex flex-col gap-1.5 md:col-span-2">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Applied Date</label>
        <input id="modal-appliedDate" type="date" value="${escapeHtml(applied)}" 
               class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all cursor-pointer invert-[0.8] brightness-[0.8]" />
      </div>

      <div class="flex flex-col gap-1.5 md:col-span-2">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Job Summary</label>
        <div class="bg-slate-950/50 border border-slate-800/50 rounded-lg text-sm text-slate-400 p-4 max-h-48 overflow-y-auto leading-relaxed italic">
          ${escapeHtml(job.summary || 'No summary available.')}
        </div>
      </div>

      <div class="flex flex-col gap-1.5 md:col-span-2">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Notes</label>
        <textarea id="modal-notes" class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-3 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all min-h-[120px] resize-none" 
                  placeholder="Add your thoughts here...">${escapeHtml(notes)}</textarea>
      </div>
    </div>

    <div class="mt-8 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/50 border border-slate-800/50">
      <div class="flex items-center gap-4">
        ${job.url ? `<a class="inline-flex items-center gap-2 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors" 
                        href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          Open Job Posting
        </a>` : ''}
      </div>
      <div class="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
        Scraped: ${escapeHtml(job.scrapedDate || 'Unknown')}
      </div>
    </div>
  `;

  const statusEl = $('modal-status');
  const summaryEl = $('modal-statusSummary');
  const appliedEl = $('modal-appliedDate');

  statusEl.addEventListener('change', () => {
    const s = statusEl.value;
    summaryEl.innerHTML = renderStatusSummaryOptions(s, summaryEl.value);
  });

  summaryEl.addEventListener('change', () => {
    const v = (summaryEl.value || '').toLowerCase();
    if (v === 'applied' && !appliedEl.value) {
      appliedEl.value = todayIsoDate();
    }
  });

  els.modalBackdrop.classList.remove('hidden');
  // Need a small timeout for the transition to trigger
  requestAnimationFrame(() => {
    els.modalBackdrop.classList.remove('opacity-0');
    els.modalBackdrop.querySelector('[role="document"]').classList.remove('scale-95');
  });
}

function renderStatusSummaryOptions(status, currentValue) {
  const presets = {
    new: ['New job'],
    in_progress: ['Researching company', 'Drafting email', 'Sent email', 'Preparing CV', 'In progress'],
    completed: ['Applied', 'Interview scheduled', 'Rejected', 'Ghosted/Ignored', 'Completed']
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
  if (!activeJobId) return;
  const job = jobs.find(j => String(j.id) === String(activeJobId));
  if (!job) return;

  const status = $('modal-status').value;
  const statusSummary = $('modal-statusSummary').value;
  const notes = $('modal-notes').value;
  const appliedDateValue = $('modal-appliedDate').value;
  const appliedDate = appliedDateValue ? new Date(`${appliedDateValue}T00:00:00.000Z`).toISOString() : null;

  const prev = { ...job };
  job.status = status;
  job.statusSummary = statusSummary;
  job.notes = notes;
  job.appliedDate = appliedDate;

  renderBoard();

  try {
    await patchJob(activeJobId, { status, statusSummary, notes, appliedDate });
    closeModal();
    setStatus('Saved');
  } catch (e) {
    console.error(e);
    const idx = jobs.findIndex(j => String(j.id) === String(activeJobId));
    if (idx !== -1) jobs[idx] = prev;
    renderBoard();
    setStatus('Failed to save');
  }
}

function closeModal() {
  activeJobId = null;
  els.modalBackdrop.classList.add('opacity-0');
  els.modalBackdrop.querySelector('[role="document"]').classList.add('scale-95');

  // Wait for animation to finish before hiding
  setTimeout(() => {
    if (els.modalBackdrop.classList.contains('opacity-0')) {
      els.modalBackdrop.classList.add('hidden');
    }
  }, 200);
}

function wireModal() {
  els.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === els.modalBackdrop) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modalBackdrop.classList.contains('open')) closeModal();
  });

  $('modal-close').addEventListener('click', closeModal);
  $('modal-save').addEventListener('click', saveModal);
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

  els.refreshBtn.addEventListener('click', fetchJobs);

  wireDropzones();
  wireModal();

  fetchJobs();
}

document.addEventListener('DOMContentLoaded', init);
