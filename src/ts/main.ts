import '../input.css';
import { jobs, onConfirmProceed, setJobs, activeJobId } from './state';
import { els, $, setStatus } from './dom';
import { fetchJobs, fetchHistory, patchJob, deleteDeletedJobs } from './api';
import { groupJobs } from './utils';
import { renderBoard, wireDropzones } from './components/board';
import { openModal, saveModal, closeModal, openScoreboard, closeScoreboard, openBin, closeBin, openConfirm, closeConfirm, openCoverLetterModal, closeCoverLetterModal, setCoverLetterTemplate, downloadCoverLetterPDF } from './components/modals';


async function init(): Promise<void> {
    // 1. Initialize DOM references
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

    // Cover Letter DOM
    els.coverLetterBackdrop = $('cover-letter-backdrop');
    els.coverLetterClose = $('cover-letter-close');
    els.coverLetterContent = $('cover-letter-content');
    els.coverLetterDownload = $('cover-letter-download');
    els.coverLetterSubtitle = $('cover-letter-subtitle');
    els.modalCoverLetter = $('modal-cover-letter');
    els.btnTemplateEfficiency = $('btn-template-efficiency');
    els.btnTemplateSecond = $('btn-template-second');
    els.btnTemplateThird = $('btn-template-third');

    // 2. Wire Global Listeners
    if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => {
        fetchJobs();
        fetchHistory();
    });
    if (els.addBtn) els.addBtn.addEventListener('click', () => openModal(null));
    if (els.binBtn) els.binBtn.addEventListener('click', openBin);
    if (els.scoreboardBtn) els.scoreboardBtn.addEventListener('click', openScoreboard);

    // Modal Wiring
    if (els.modalBackdrop) els.modalBackdrop.addEventListener('click', (e) => {
        if (e.target === els.modalBackdrop) closeModal();
    });
    const closeBtn = $('modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    const saveBtn = $('modal-save');
    if (saveBtn) saveBtn.addEventListener('click', saveModal);

    // Bin Wiring
    const binCloseBtn = $('bin-close');
    if (binCloseBtn) binCloseBtn.addEventListener('click', closeBin);
    if (els.binBackdrop) els.binBackdrop.addEventListener('click', (e) => {
        if (e.target === els.binBackdrop) closeBin();
    });
    const binClearBtn = $('bin-clear');
    if (binClearBtn) binClearBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to empty the recycle bin? This cannot be undone.')) return;
        try {
            await deleteDeletedJobs();
            setJobs(jobs.filter(j => j.status !== 'deleted'));
            renderBoard();
            setStatus('Bin cleared');
        } catch (e) {
            console.error(e);
            setStatus('Failed to clear bin');
        }
    });

    // Scoreboard Wiring
    const scoreboardCloseBtn = $('scoreboard-close');
    if (scoreboardCloseBtn) scoreboardCloseBtn.addEventListener('click', closeScoreboard);
    if (els.scoreboardBackdrop) els.scoreboardBackdrop.addEventListener('click', (e) => {
        if (e.target === els.scoreboardBackdrop) closeScoreboard();
    });

    // Confirm Dialog Wiring
    const confirmCancel = $('confirm-cancel');
    if (confirmCancel) confirmCancel.addEventListener('click', closeConfirm);
    const confirmProceed = $('confirm-proceed');
    if (confirmProceed) confirmProceed.addEventListener('click', () => {
        if (onConfirmProceed) onConfirmProceed();
        closeConfirm();
    });

    // Cover Letter Modal Wiring
    if (els.modalCoverLetter) {
        els.modalCoverLetter.addEventListener('click', () => {
            const jobId = activeJobId;
            if (jobId) {
                closeModal();
                openCoverLetterModal(jobId);
            }
        });
    }
    if (els.coverLetterClose) els.coverLetterClose.addEventListener('click', closeCoverLetterModal);
    if (els.coverLetterBackdrop) els.coverLetterBackdrop.addEventListener('click', (e) => {
        if (e.target === els.coverLetterBackdrop) closeCoverLetterModal();
    });
    if (els.coverLetterDownload) els.coverLetterDownload.addEventListener('click', downloadCoverLetterPDF);
    if (els.btnTemplateEfficiency) els.btnTemplateEfficiency.addEventListener('click', () => setCoverLetterTemplate('efficiency'));
    if (els.btnTemplateSecond) els.btnTemplateSecond.addEventListener('click', () => setCoverLetterTemplate('two'));
    if (els.btnTemplateThird) els.btnTemplateThird.addEventListener('click', () => setCoverLetterTemplate('three'));

    // Escape Key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeBin();
            closeScoreboard();
            closeConfirm();
            closeCoverLetterModal();
        }
    });

    // Bulk Actions (Move New -> Bin)
    if (els.newCount) {
        els.newCount.addEventListener('click', () => {
            const grouped = groupJobs();
            if (grouped.new.length === 0) return;
            openConfirm(
                'Clear New Jobs?',
                `This will move all ${grouped.new.length} "New" jobs to the recycle bin.`,
                () => executeBulkMove('new', 'deleted')
            );
        });
    }

    wireDropzones();

    // 3. Initial Data Fetch
    await Promise.all([fetchJobs(), fetchHistory()]);
}

async function executeBulkMove(fromStatus: string, toStatus: string): Promise<void> {
    const toUpdate = jobs.filter(j => j.status === fromStatus);
    if (toUpdate.length === 0) return;

    setStatus(`Moving ${toUpdate.length} jobs...`);

    // Optimistically update UI
    for (const j of toUpdate) j.status = toStatus as any;
    renderBoard();

    // Persist in background (could be slow, so we do it one by one)
    let errCount = 0;
    for (const j of toUpdate) {
        try {
            await patchJob(j.id, { status: toStatus as any });
        } catch (e) {
            errCount++;
            j.status = fromStatus as any; // Revert on fail
        }
    }

    renderBoard();
    if (errCount > 0) {
        setStatus(`Failed to move ${errCount} jobs`);
    } else {
        setStatus(`Moved ${toUpdate.length} jobs`);
    }
}

document.addEventListener('DOMContentLoaded', init);
