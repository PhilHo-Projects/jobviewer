import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3004;
const BASE_PATH = '/job-viewer';

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// Serve static files from 'dist' directory in production
// In development, Vite handles the frontend and proxies API requests here.
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(BASE_PATH, express.static(distPath));
  // Support client-side routing by serving index.html for unknown routes under BASE_PATH
  app.get(`${BASE_PATH}/*`, (req, res, next) => {
    if (req.path.startsWith(`${BASE_PATH}/api`)) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Fallback for when 'dist' doesn't exist (e.g., during initial setup or dev without build)
  app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));
}

// Store latest job data in memory
let latestJobs = [];

const JOBS_FILE_PATH = path.join(__dirname, 'jobs.json');

function loadJobsFromDisk() {
  try {
    if (!fs.existsSync(JOBS_FILE_PATH)) return [];
    const raw = fs.readFileSync(JOBS_FILE_PATH, 'utf8');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load jobs from disk:', err);
    return [];
  }
}

function saveJobsToDisk(jobs) {
  try {
    fs.writeFileSync(JOBS_FILE_PATH, JSON.stringify(jobs, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save jobs to disk:', err);
  }
}

function createStableJobId(job) {
  const basis = [job.url, job.title, job.company, job.location, job.posted].filter(Boolean).join('|');
  const hash = crypto.createHash('sha1').update(basis || JSON.stringify(job)).digest('hex');
  return hash;
}

function normalizeIncomingJob(job) {
  const nowIso = new Date().toISOString();
  const normalized = { ...job };
  normalized.id = normalized.id || createStableJobId(normalized);
  normalized.status = normalized.status || 'new';
  normalized.statusSummary = normalized.statusSummary || 'New Job';
  normalized.statusSummaryUpdatedAt = normalized.statusSummaryUpdatedAt || nowIso;
  normalized.notes = typeof normalized.notes === 'string' ? normalized.notes : '';
  normalized.scrapedDate = normalized.scrapedDate || nowIso;
  normalized.appliedDate = normalized.appliedDate || null;
  return normalized;
}

function upsertJobs(incomingJobs) {
  const nextJobs = Array.isArray(latestJobs) ? [...latestJobs] : [];
  const idxById = new Map(nextJobs.map((j, idx) => [String(j.id), idx]));

  for (const rawJob of incomingJobs) {
    const j = normalizeIncomingJob(rawJob);
    const key = String(j.id);
    const existingIdx = idxById.get(key);

    if (existingIdx === undefined) {
      nextJobs.push(j);
      idxById.set(key, nextJobs.length - 1);
      continue;
    }

    const existing = nextJobs[existingIdx] || {};
    nextJobs[existingIdx] = {
      ...existing,
      ...j,
      status: existing.status || j.status || 'new',
      statusSummary: existing.statusSummary || j.statusSummary || 'New Job',
      notes: typeof existing.notes === 'string' ? existing.notes : (typeof j.notes === 'string' ? j.notes : ''),
      scrapedDate: existing.scrapedDate || j.scrapedDate,
      appliedDate: existing.appliedDate || j.appliedDate || null
    };
  }

  latestJobs = nextJobs;
  saveJobsToDisk(latestJobs);
  return latestJobs;
}

latestJobs = loadJobsFromDisk();

// Endpoint for n8n to POST pruned job data
app.post(`${BASE_PATH}/api/receive-jobs`, (req, res) => {
  const jobsPayload = req.body;
  if (!Array.isArray(jobsPayload)) {
    return res.status(400).json({ error: 'Payload must be an array of jobs' });
  }

  const incoming = jobsPayload.filter(Boolean);
  const beforeCount = Array.isArray(latestJobs) ? latestJobs.length : 0;
  upsertJobs(incoming);
  const afterCount = Array.isArray(latestJobs) ? latestJobs.length : 0;

  return res.status(201).json({
    message: 'Jobs received successfully',
    received: incoming.length,
    before: beforeCount,
    after: afterCount
  });
});

app.post(`${BASE_PATH}/api/jobs`, (req, res) => {
  const jobPayload = req.body;
  if (!jobPayload || typeof jobPayload !== 'object' || Array.isArray(jobPayload)) {
    return res.status(400).json({ error: 'Payload must be a job object' });
  }

  const normalized = normalizeIncomingJob(jobPayload);
  const existed = (latestJobs || []).some(j => String(j.id) === String(normalized.id));
  upsertJobs([normalized]);

  const saved = (latestJobs || []).find(j => String(j.id) === String(normalized.id)) || normalized;
  return res.status(existed ? 200 : 201).json(saved);
});

// Endpoint for frontend to GET latest jobs
app.get(`${BASE_PATH}/api/jobs`, (req, res) => {
  res.json(Array.isArray(latestJobs) ? latestJobs : []);
});

app.patch(`${BASE_PATH}/api/jobs/:id`, (req, res) => {
  const { id } = req.params;
  const idx = (latestJobs || []).findIndex(j => String(j.id) === String(id));
  if (idx === -1) {
    return res.status(404).json({ message: 'Job not found' });
  }

  const { status, statusSummary, notes, appliedDate } = req.body || {};

  const next = { ...latestJobs[idx] };
  if (status !== undefined) next.status = status;
  if (statusSummary !== undefined) {
    next.statusSummary = statusSummary;
    next.statusSummaryUpdatedAt = new Date().toISOString();
  }
  if (notes !== undefined) next.notes = notes;
  if (appliedDate !== undefined) next.appliedDate = appliedDate;

  latestJobs[idx] = next;
  saveJobsToDisk(latestJobs);
  res.json(next);
});

app.delete(`${BASE_PATH}/api/jobs/status/:status`, (req, res) => {
  const { status } = req.params;
  const beforeCount = (latestJobs || []).length;
  latestJobs = (latestJobs || []).filter(j => j.status !== status);
  const afterCount = (latestJobs || []).length;
  saveJobsToDisk(latestJobs);
  res.json({ deleted: beforeCount - afterCount, remaining: afterCount });
});

app.listen(PORT, () => {
  console.log(`Job Viewer running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}${BASE_PATH}`);
});
