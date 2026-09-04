import '../input.css';
import { jobs, onConfirmProceed, setJobs, activeJobId, setIsAuthenticated, setIsOwner, setCurrentUser } from './state';
import { els, $, setStatus } from './dom';
import { fetchJobs, fetchHistory, patchJob, deleteDeletedJobs, fetchScrapeInfo, triggerScrape, fetchMe } from './api';
import { authClient } from './auth';
import { openAuthModal, closeAuthModal, submitAuth, wireAuthTabs } from './components/authModal';
import { openAdminPanel, closeAdminPanel, refreshPendingBadge } from './components/admin';
import { renderAccountChip, wireAccountMenu, closeAccountMenu } from './components/accountMenu';
import { openAccountModal, closeAccountModal, wireAccountModal } from './components/accountModal';
import { groupJobs } from './utils';
import { renderBoard, wireDropzones } from './components/board';
import { openModal, saveModal, closeModal, openScoreboard, closeScoreboard, openBin, closeBin, openConfirm, closeConfirm, openCoverLetterModal, closeCoverLetterModal, setCoverLetterTemplate, downloadCoverLetterPDF, generateCoverLetterWithAI } from './components/modals';


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
    els.scrapeBtn = $('trigger-scrape');
    els.signInBtn = $('sign-in');
    els.demoBanner = $('demo-banner');
    els.bannerSignIn = $('banner-sign-in');
    els.loginBackdrop = $('login-backdrop');
    els.loginClose = $('login-close');
    els.loginUsername = $('login-username');
    els.loginPassword = $('login-password');
    els.loginError = $('login-error');
    els.loginSubmit = $('login-submit');
    els.loginEmail = $('login-email');
    els.loginEmailRow = $('login-email-row');
    els.loginPasswordHint = $('login-password-hint');
    els.authTitle = $('auth-title');
    els.authTabs = $('auth-tabs');
    els.authForm = $('auth-form');
    els.authPending = $('auth-pending');
    els.tabSignin = $('tab-signin');
    els.tabSignup = $('tab-signup');
    els.adminBackdrop = $('admin-backdrop');
    els.adminClose = $('admin-close');
    els.adminList = $('admin-list');
    els.adminEmpty = $('admin-empty');
    els.accountWrap = $('account-wrap');
    els.accountChip = $('account-chip');
    els.accountChipName = $('account-chip-name');
    els.accountChipInitial = $('account-chip-initial');
    els.accountChipBadge = $('account-chip-badge');
    els.accountMenu = $('account-menu');
    els.accountMenuUsername = $('account-menu-username');
    els.accountMenuRole = $('account-menu-role');
    els.menuAccount = $('menu-account');
    els.menuAdmin = $('menu-admin');
    els.menuAdminBadge = $('menu-admin-badge');
    els.menuLogout = $('menu-logout');
    els.accountBackdrop = $('account-backdrop');
    els.accountClose = $('account-close');
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
    els.btnTemplateAi = $('btn-template-ai');

    // 2. Wire Global Listeners
    if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => {
        fetchJobs();
        fetchHistory();
    });
    if (els.addBtn) els.addBtn.addEventListener('click', () => openModal(null));
    if (els.binBtn) els.binBtn.addEventListener('click', openBin);
    if (els.scrapeBtn) els.scrapeBtn.addEventListener('click', async () => {
        if (!confirm("Trigger a manual LinkedIn scrape (limit 1/day)? This will run your n8n workflow on the server.\n\nNote: The process typically takes about 1 minute.")) return;

        const btn = els.scrapeBtn as HTMLButtonElement;
        btn.disabled = true;

        // Add a pulsing visual indicator to the button
        btn.classList.add('animate-pulse');

        setStatus('Triggering scrape...');
        try {
            await triggerScrape();

            // Start polling and timer logic
            const initialCount = jobs.length;
            let elapsed = 0;

            const timer = setInterval(async () => {
                elapsed += 5;
                setStatus(`Scraping in progress... ${elapsed}s (typically ~60s)`);
                await fetchJobs();

                // If count increases, or 2 minutes pass, stop polling
                if (jobs.length > initialCount) {
                    clearInterval(timer);
                    setStatus(`Scrape complete! Found ${jobs.length - initialCount} new jobs.`);
                    btn.classList.remove('animate-pulse');
                    await updateScrapeButtonStatus();
                } else if (elapsed >= 120) {
                    clearInterval(timer);
                    setStatus('Scrape finished (no new jobs found or timed out after 2m).');
                    btn.classList.remove('animate-pulse');
                    await updateScrapeButtonStatus();
                }
            }, 5000);

        } catch (e: any) {
            console.error(e);
            setStatus(`Scrape failed: ${e.message}`);
            btn.classList.remove('animate-pulse');
            btn.disabled = false;
        }
    });
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
    if (els.btnTemplateAi) els.btnTemplateAi.addEventListener('click', generateCoverLetterWithAI);

    // Escape Key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeBin();
            closeScoreboard();
            closeConfirm();
            closeCoverLetterModal();
            closeAccountMenu(true);
            closeAccountModal();
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

    // Auth wiring
    if (els.signInBtn) els.signInBtn.addEventListener('click', () => openAuthModal('signin'));
    if (els.bannerSignIn) els.bannerSignIn.addEventListener('click', () => openAuthModal('signin'));
    if (els.loginClose) els.loginClose.addEventListener('click', closeAuthModal);
    if (els.loginBackdrop) els.loginBackdrop.addEventListener('click', (e) => {
        if (e.target === els.loginBackdrop) closeAuthModal();
    });
    wireAuthTabs();
    wireAccountMenu();
    wireAccountModal();

    const onAuthSubmit = async () => {
        const signedIn = await submitAuth();
        if (!signedIn) return; // sign-up shows the pending panel and stays open
        await refreshAuth();
        await Promise.all([fetchJobs(), fetchHistory(), updateScrapeButtonStatus()]);
        closeAuthModal();
        setStatus('Signed in');
    };
    if (els.loginSubmit) els.loginSubmit.addEventListener('click', onAuthSubmit);
    for (const field of [els.loginUsername, els.loginPassword, els.loginEmail]) {
        if (field) field.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') onAuthSubmit();
        });
    }

    if (els.menuLogout) els.menuLogout.addEventListener('click', async () => {
        await authClient.signOut();
        await refreshAuth();
        await Promise.all([fetchJobs(), fetchHistory()]);
        setStatus('Signed out');
    });

    if (els.menuAdmin) els.menuAdmin.addEventListener('click', openAdminPanel);
    if (els.menuAccount) els.menuAccount.addEventListener('click', openAccountModal);
    if (els.adminClose) els.adminClose.addEventListener('click', closeAdminPanel);
    if (els.adminBackdrop) els.adminBackdrop.addEventListener('click', (e) => {
        if (e.target === els.adminBackdrop) closeAdminPanel();
    });

    wireDropzones();

    // 3. Initial Data Fetch
    await refreshAuth();
    await Promise.all([fetchJobs(), fetchHistory(), updateScrapeButtonStatus()]);
}

async function refreshAuth(): Promise<void> {
    const me = await fetchMe();
    const owner = me.role === 'owner';
    setIsAuthenticated(me.authenticated);
    setIsOwner(owner);
    setCurrentUser({ username: me.username, role: me.role });
    renderAccountChip();
    applyAuthVisibility(me.authenticated, owner);
    if (owner) await refreshPendingBadge();
}

function applyAuthVisibility(authenticated: boolean, owner: boolean): void {
    const show = (el: HTMLElement | null, visible: boolean) => {
        if (el) el.classList.toggle('hidden', !visible);
    };
    show(els.signInBtn, !authenticated);
    show(els.accountWrap, authenticated);
    show(els.demoBanner, !authenticated);
    show(els.scrapeBtn, authenticated);  // members scrape onto their own board
    show(els.menuAdmin, owner);          // approving accounts is owner-only
    show(els.btnTemplateAi, owner);      // AI cover letter reads the owner's identity.json
    if (!authenticated) closeAccountMenu();
}

async function updateScrapeButtonStatus() {
    try {
        const info = await fetchScrapeInfo();
        const today = new Date().toISOString().split('T')[0];
        if (els.scrapeBtn) {
            const btn = els.scrapeBtn as HTMLButtonElement;
            if (info.lastTriggerDate === today) {
                btn.disabled = true;
                btn.title = "Scrape already triggered today";
            } else {
                btn.disabled = false;
                btn.title = "Trigger Scrape (Max 1/day)";
            }
        }
    } catch (e) {
        console.error("Failed to update scrape button status", e);
    }
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
