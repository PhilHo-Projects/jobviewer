export const els: Record<string, HTMLElement | null> = {
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
    btnTemplateThird: null,
    btnTemplateAi: null,
    scrapeBtn: null,
    signInBtn: null,
    demoBanner: null,
    bannerSignIn: null,
    loginBackdrop: null,
    loginClose: null,
    loginUsername: null,
    loginPassword: null,
    loginError: null,
    loginSubmit: null,
    loginEmail: null,
    loginEmailRow: null,
    loginPasswordHint: null,
    authTitle: null,
    authTabs: null,
    authForm: null,
    authPending: null,
    tabSignin: null,
    tabSignup: null,
    adminBackdrop: null,
    adminClose: null,
    adminList: null,
    adminEmpty: null,
    accountWrap: null,
    accountChip: null,
    accountChipName: null,
    accountChipInitial: null,
    accountChipBadge: null,
    accountMenu: null,
    accountMenuUsername: null,
    accountMenuRole: null,
    menuAccount: null,
    menuAdmin: null,
    menuAdminBadge: null,
    menuLogout: null,
    accountBackdrop: null,
    accountClose: null,
    accountUsername: null,
    accountRole: null,
    accountApproval: null,
    accountEmail: null,
    accountSince: null,
    accountScrapeStatus: null,
    accountScrapeLast: null,
    pwCurrent: null,
    pwNew: null,
    pwConfirm: null,
    pwRevokeOthers: null,
    pwSubmit: null,
    pwError: null,
    pwSuccess: null
};

export function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

export function setStatus(text: string): void {
    if (els.statusText) els.statusText.textContent = text;
}

export function renderError(message: string): void {
    if (els.newZone) els.newZone.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
    if (els.inProgressZone) els.inProgressZone.innerHTML = '';
    if (els.completedZone) els.completedZone.innerHTML = '';
}

// Re-export escapeHtml because renderError needs it, to avoid weird circular deps
function escapeHtml(value: any): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
