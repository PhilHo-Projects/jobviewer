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

  return `
    <article class="card" draggable="true" data-job-id="${id}" data-status="${status}">
      <div class="title">${title}</div>
      <div class="meta">
        <span class="pill">${company}</span>
        <span class="pill">${location}</span>
      </div>
      <div class="summary">${statusSummary || ' '}</div>
      <div class="card-actions">
        <button type="button" data-action="expand" data-job-id="${id}">Details</button>
        ${hasUrl ? `<a class="link" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Open ↗</a>` : '<span></span>'}
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
    <div class="grid">
      <div class="field">
        <label>Company</label>
        <input type="text" value="${escapeHtml(job.company || '')}" disabled />
      </div>
      <div class="field">
        <label>Location</label>
        <input type="text" value="${escapeHtml(job.location || '')}" disabled />
      </div>
      <div class="field">
        <label>Status</label>
        <select id="modal-status">
          <option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
          <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
      </div>
      <div class="field">
        <label>Status summary</label>
        <select id="modal-statusSummary">
          ${renderStatusSummaryOptions(status, statusSummary)}
        </select>
        <div class="note">Tip: choose a preset, then adjust notes below.</div>
      </div>

      <div class="field">
        <label>Applied date (optional)</label>
        <input id="modal-appliedDate" type="date" value="${escapeHtml(applied)}" />
        <div class="note">Auto-filled if you mark as “Applied”.</div>
      </div>

      <div class="field" style="grid-column: 1 / -1;">
        <label>Summary</label>
        <textarea disabled>${escapeHtml(job.summary || '')}</textarea>
      </div>

      <div class="field" style="grid-column: 1 / -1;">
        <label>Notes</label>
        <textarea id="modal-notes">${escapeHtml(notes)}</textarea>
      </div>
    </div>

    <div style="margin-top: 10px; display:flex; gap:12px; align-items:center; justify-content:space-between;">
      <div>
        ${job.url ? `<a class="link" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Open job posting ↗</a>` : ''}
      </div>
      <div class="note">Scraped: ${escapeHtml(job.scrapedDate || '')}</div>
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

  els.modalBackdrop.classList.add('open');
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
  els.modalBackdrop.classList.remove('open');
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
