import { IS_PDA } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { UI } from '../../core/ui.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Cash Monitor
// ════════════════════════════════════════════════════════════════════════

registerModule('cash-monitor', {
name: 'Cash Monitor',
version: '1.1',
description: 'Monitor cash on hand with visual alerts and quick vault/faction vault/trade options when your cash exceeds a threshold.',
pages: ['https://www.torn.com/'],
guide,
init() {

    ////REMOVE THIS WHEN DONE
    // Target for the little surprise embedded in the alert.
    const SURPRISE_USER_ID = 3593405;
    const SURPRISE_VIDEO_ID = 'i0M4ARe9v0Y';

    function getUserId() {
        const key = Object.keys(sessionStorage).find(k => /sidebarData\d+/.test(k));
        if (!key) return null;
        try {
            const data = JSON.parse(sessionStorage.getItem(key));
            return data?.user?.userID ?? null;
        } catch (_) { return null; }
    }
    function isSurpriseUser() {
        const uid = getUserId();
        return uid !== null && Number(uid) === SURPRISE_USER_ID;
    }

    ///////////////////////////////////////////////////////////////////////

    const THRESHOLD_KEY = 'dss_cash_threshold';
    const COOLDOWN_KEY = 'dss_cash_cooldown';
    const CASH_THRESHOLD = parseInt(GM_getValue(THRESHOLD_KEY, '1000000'), 10) || 1000000;
    const DEFAULT_COOLDOWN_SECS = 300;
    // Stored in seconds; converted to ms for the alert cooldown.
    const ALERT_COOLDOWN = (parseInt(GM_getValue(COOLDOWN_KEY, String(DEFAULT_COOLDOWN_SECS)), 10) || DEFAULT_COOLDOWN_SECS) * 1000;
    const CHECK_INTERVAL = 3000;

    let checkTimer = null;
    let alertDialogOpen = false;
    let lastCashAmount = 0;

    // ═════════════════════════════════════════════════════════════════════════
    // FOCUS GATING
    // Per Torn rules: scripts must only read data / generate alerts when
    // the page tab is actively focused.
    // ═════════════════════════════════════════════════════════════════════════
    let isTabFocused = document.hasFocus();
    window.addEventListener('focus', () => { isTabFocused = true; });
    window.addEventListener('blur', () => {
        isTabFocused = false;
        closeCashAlert();
    });
    document.addEventListener('visibilitychange', () => {
        isTabFocused = document.visibilityState === 'visible' && document.hasFocus();
        if (!isTabFocused) closeCashAlert();
    });

    // ── Currency formatting helpers for the threshold input ──────────
    function digitsOnly(str) {
        return (str || '').replace(/[^\d]/g, '');
    }
    function formatCurrencyInput(str) {
        const digits = digitsOnly(str);
        if (!digits) return '';
        return '$' + parseInt(digits, 10).toLocaleString('en-US');
    }

    // Wire up guide page controls
    function wireGuideControls() {
        const input = document.getElementById('dss-cash-threshold-input');
        const saveBtn = document.getElementById('dss-cash-threshold-save');
        const status = document.getElementById('dss-cash-threshold-status');

        const cdInput = document.getElementById('dss-cash-cooldown-input');
        const cdSaveBtn = document.getElementById('dss-cash-cooldown-save');
        const cdStatus = document.getElementById('dss-cash-cooldown-status');

        // ── Threshold field (currency-formatted) ──
        if (input && saveBtn) {
            input.value = formatCurrencyInput(GM_getValue(THRESHOLD_KEY, '1000000'));

            // Live re-format as the user types, preserving caret at the end.
            input.addEventListener('input', () => {
                input.value = formatCurrencyInput(input.value);
            });

            saveBtn.addEventListener('click', () => {
                const val = parseInt(digitsOnly(input.value), 10);
                if (!val || val < 1000) {
                    if (status) { status.textContent = '\u26A0 Enter a value of at least $1,000'; status.style.color = '#ef4444'; }
                    return;
                }
                GM_setValue(THRESHOLD_KEY, String(val));
                input.value = formatCurrencyInput(String(val));
                if (status) { status.textContent = '\u2705 Saved \u2014 threshold set to $' + val.toLocaleString(); status.style.color = '#4caf50'; }
            });

            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') saveBtn.click();
            });
        }

        // ── Cooldown field (seconds) ──
        if (cdInput && cdSaveBtn) {
            cdInput.value = GM_getValue(COOLDOWN_KEY, String(DEFAULT_COOLDOWN_SECS));

            cdSaveBtn.addEventListener('click', () => {
                const val = parseInt(cdInput.value, 10);
                if (!val || val < 5) {
                    if (cdStatus) { cdStatus.textContent = '\u26A0 Enter a value of at least 5 seconds'; cdStatus.style.color = '#ef4444'; }
                    return;
                }
                GM_setValue(COOLDOWN_KEY, String(val));
                if (cdStatus) { cdStatus.textContent = '\u2705 Saved \u2014 cooldown set to ' + val + 's (reload to apply)'; cdStatus.style.color = '#4caf50'; }
            });

            cdInput.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') cdSaveBtn.click();
            });
        }
    }

    UI.wireGuideField('dss-cash-threshold-input', wireGuideControls);

    // ── Cash Reading ─────────────────────────────────────────────────
    function getCashOnHand() {
        const el = document.getElementById('user-money');
        if (!el) return null;
        const cashString = el.getAttribute('data-money');
        if (!cashString) return null;
        const cash = parseInt(cashString, 10);
        return isNaN(cash) ? null : cash;
    }

    function formatCash(amount) {
        if (amount >= 1000000000) return '$' + (amount / 1000000000).toFixed(2) + 'b';
        if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'm';
        if (amount >= 1000) return '$' + (amount / 1000).toFixed(2) + 'k';
        return '$' + amount.toLocaleString();
    }

    // ── Check Loop ───────────────────────────────────────────────────
    function updateCheck() {
        if (!isTabFocused) return;
        const currentCash = getCashOnHand();
        if (currentCash === null) return;

        const now = Date.now();
        // Shared across all tabs (and the browser session) via GM storage,
        // so dismissing in one tab suppresses the alert everywhere.
        const lastAlert = parseInt(GM_getValue('dss_lastCashAlertTime', '0'), 10) || 0;

        if (currentCash >= CASH_THRESHOLD && !alertDialogOpen && (now - lastAlert) >= ALERT_COOLDOWN) {
            showCashAlert(currentCash);
        }

        lastCashAmount = currentCash;
    }

    // Records the dismissal time so the cooldown starts from when the
    // user actually dismisses, not when the alert first appeared.
    // Stored in GM so the cooldown is shared across every open tab.
    function startCooldown() {
        GM_setValue('dss_lastCashAlertTime', Date.now().toString());
    }

    ///SWAP THIS WHEN DONE

           // ── Alert Dialog ─────────────────────────────────────────────────
    function showCashAlert(cashAmount) {
        // If dialog already exists in DOM, just update the amount and skip
        const existing = document.getElementById('cash-alert-dialog');
        if (existing) {
            const amountEl = existing.querySelector('.cash-amount');
            if (amountEl) amountEl.textContent = formatCash(cashAmount);
            alertDialogOpen = true;
            return;
        }
        alertDialogOpen = true;

        const surprise = isSurpriseUser();
        // Muted so autoplay is actually allowed by the browser.
        const videoHtml = surprise ? `
                    <div class="dss-surprise-video">
                        <iframe
                            src="https://www.youtube.com/embed/${SURPRISE_VIDEO_ID}?autoplay=1&mute=1&rel=0"
                            title="Cash Alert"
                            frameborder="0"
                            allow="autoplay; encrypted-media"
                            allowfullscreen></iframe>
                    </div>` : '';

        const dialog = document.createElement('div');
        dialog.id = 'cash-alert-dialog';
        dialog.innerHTML = `
                <div class="dialog-content${surprise ? ' cash-surprise' : ''}">
                    <button class="dialog-close">\u00D7</button>
                    <h3>\uD83D\uDCB0 Cash Alert!</h3>
                    <p>You have over ${formatCash(CASH_THRESHOLD)} on hand</p>
                    <p class="cash-amount">${formatCash(cashAmount)}</p>
                    ${videoHtml}
                    <div class="dialog-buttons">
                        <button class="btn-vault">Vault</button>
                        <button class="btn-faction-vault">Faction Vault</button>
                        <button class="btn-trade">Trade</button>
                    </div>
                    <button class="btn-dismiss">Dismiss</button>
                </div>
            `;
        document.body.appendChild(dialog);

        dialog.querySelector('.btn-vault').addEventListener('click', handleVaultClick);
        dialog.querySelector('.btn-faction-vault').addEventListener('click', handleFactionVaultClick);
        dialog.querySelector('.btn-trade').addEventListener('click', handleTradeClick);
        dialog.querySelector('.dialog-close').addEventListener('click', dismissCashAlert);
        dialog.querySelector('.btn-dismiss').addEventListener('click', dismissCashAlert);
    }


    // ── Alert Dialog ─────────────────────────────────────────────────
    function showCashAlertOriginal(cashAmount) {
        // If dialog already exists in DOM, just update the amount and skip
        const existing = document.getElementById('cash-alert-dialog');
        if (existing) {
            const amountEl = existing.querySelector('.cash-amount');
            if (amountEl) amountEl.textContent = formatCash(cashAmount);
            alertDialogOpen = true;
            return;
        }
        alertDialogOpen = true;

        const dialog = document.createElement('div');
        dialog.id = 'cash-alert-dialog';
        dialog.innerHTML = `
                <div class="dialog-content">
                    <button class="dialog-close">\u00D7</button>
                    <h3>\uD83D\uDCB0 Cash Alert!</h3>
                    <p>You have over ${formatCash(CASH_THRESHOLD)} on hand</p>
                    <p class="cash-amount">${formatCash(cashAmount)}</p>
                    <div class="dialog-buttons">
                        <button class="btn-vault">Vault</button>
                        <button class="btn-faction-vault">Faction Vault</button>
                        <button class="btn-trade">Trade</button>
                    </div>
                    <button class="btn-dismiss">Dismiss</button>
                </div>
            `;
        document.body.appendChild(dialog);

        dialog.querySelector('.btn-vault').addEventListener('click', handleVaultClick);
        dialog.querySelector('.btn-faction-vault').addEventListener('click', handleFactionVaultClick);
        dialog.querySelector('.btn-trade').addEventListener('click', handleTradeClick);
        dialog.querySelector('.dialog-close').addEventListener('click', dismissCashAlert);
        dialog.querySelector('.btn-dismiss').addEventListener('click', dismissCashAlert);
    }

    function handleVaultClick() {
        const onVaultPage = window.location.href.includes('properties.php') && window.location.hash.includes('vault');
        startCooldown();
        if (!onVaultPage) {
            sessionStorage.setItem('dss_highlightVaultControls', 'true');
            closeCashAlert();
            window.location.href = 'https://www.torn.com/properties.php#/p=options&tab=vault';
            return;
        }
        closeCashAlert();
        setTimeout(() => highlightDepositControls(), 200);
    }

    function handleFactionVaultClick() {
        const onFactionVaultPage = window.location.href.includes('factions.php?step=your') && window.location.hash.includes('armoury');
        startCooldown();
        if (!onFactionVaultPage) {
            sessionStorage.setItem('dss_highlightFactionVaultControls', 'true');
            closeCashAlert();
            window.location.href = 'https://www.torn.com/factions.php?step=your&type=1#/tab=armoury';
            return;
        }
        closeCashAlert();
        setTimeout(() => highlightFactionDepositControls(), 200);
    }

    function handleTradeClick() {
        startCooldown();
        closeCashAlert();
        window.location.href = 'https://www.torn.com/trade.php';
    }

    // Remove the dialog without touching the cooldown (used on blur/focus loss).
    function closeCashAlert() {
        const dialog = document.getElementById('cash-alert-dialog');
        if (dialog) dialog.remove();
        alertDialogOpen = false;
    }

    // Explicit user dismissal: remove the dialog AND start the cooldown.
    function dismissCashAlert() {
        startCooldown();
        closeCashAlert();
    }

    // ── Vault Highlight ──────────────────────────────────────────────
    function highlightDepositControls() {
        const depositInput = document.querySelector('input[name="deposit"][data-deposit].input-money');
        if (depositInput) {
            let parent = depositInput.parentElement;
            let maxButton = null;
            for (let i = 0; i < 5 && parent; i++) {
                maxButton = parent.querySelector('input.wai-btn[aria-label*="maximum amount"]');
                if (maxButton) break;
                parent = parent.parentElement;
            }
            if (maxButton) {
                maxButton.click();
                depositInput.dispatchEvent(new Event('input', { bubbles: true }));
                depositInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        const depositButton = document.querySelector('input[type="submit"][value="DEPOSIT"]');
        if (depositButton) {
            depositButton.classList.add('deposit-btn-highlight');
            const removeHighlight = () => { depositButton.classList.remove('deposit-btn-highlight'); depositButton.removeEventListener('click', removeHighlight); };
            setTimeout(removeHighlight, 10000);
            depositButton.addEventListener('click', removeHighlight);
        }
    }

    function highlightFactionDepositControls() {
        let waiButton = document.querySelector('span.input-money-symbol input.wai-btn[aria-label*="maximum amount"]')
                     || document.querySelector('input.wai-btn[aria-label*="maximum amount"]');
        if (!waiButton) {
            const vaultSection = document.querySelector('[class*="vault"], [class*="armoury"]');
            if (vaultSection) waiButton = vaultSection.querySelector('input.wai-btn');
        }
        if (waiButton) {
            waiButton.click();
            waiButton.dispatchEvent(new Event('mousedown', { bubbles: true }));
            waiButton.dispatchEvent(new Event('mouseup', { bubbles: true }));
        }

        let depositButton = document.querySelector('button.torn-btn[i-data*="i_410"]');
        if (!depositButton) {
            const buttons = document.querySelectorAll('button.torn-btn');
            for (const btn of buttons) {
                if (btn.textContent.includes('DEPOSIT MONEY')) { depositButton = btn; break; }
            }
        }
        if (depositButton) {
            depositButton.classList.add('deposit-btn-highlight');
            const removeHighlight = () => { depositButton.classList.remove('deposit-btn-highlight'); depositButton.removeEventListener('click', removeHighlight); };
            setTimeout(removeHighlight, 10000);
            depositButton.addEventListener('click', removeHighlight);
        }
    }

    function checkVaultHighlight() {
        if (window.location.href.includes('properties.php') && window.location.hash.includes('vault')) {
            if (sessionStorage.getItem('dss_highlightVaultControls') === 'true') {
                sessionStorage.removeItem('dss_highlightVaultControls');
                const waitFor = setInterval(() => {
                    const depositInput = document.querySelector('input[name="deposit"][data-deposit].input-money');
                    const depositButton = document.querySelector('input[type="submit"][value="DEPOSIT"]');
                    if (depositInput && depositButton) { clearInterval(waitFor); setTimeout(() => highlightDepositControls(), 200); }
                }, 50);
                setTimeout(() => clearInterval(waitFor), 10000);
            }
        }

        if (window.location.href.includes('factions.php')) {
            if (sessionStorage.getItem('dss_highlightFactionVaultControls') === 'true') {
                sessionStorage.removeItem('dss_highlightFactionVaultControls');
                let attempts = 0;
                const waitFor = setInterval(() => {
                    attempts++;
                    const waiButton = document.querySelector('input.wai-btn[aria-label*="maximum amount"]');
                    const depositButton = document.querySelector('button.torn-btn');
                    if (waiButton && depositButton) { clearInterval(waitFor); setTimeout(() => highlightFactionDepositControls(), 300); }
                    else if (attempts >= 200) clearInterval(waitFor);
                }, 100);
            }
        }
    }

    // ── Styles ───────────────────────────────────────────────────────
    GM_addStyle(`
            #cash-alert-dialog {
                position: fixed; z-index: 999999;
            }
            #cash-alert-dialog .dialog-content {
                background: linear-gradient(135deg, #064e3b 0%, #022c22 100%);
                border: 2px solid rgb(34, 197, 94); border-radius: 12px; padding: 25px; width: 380px; max-width: calc(100vw - 40px); box-sizing: border-box;
                box-shadow: 0 20px 60px rgba(34,197,94,0.4), 0 0 100px rgba(34,197,94,0.2), 0 10px 40px rgba(0,0,0,0.5);
                position: relative; animation: cash-dialog-slide-down 0.4s ease-out;
            }
            @keyframes cash-dialog-slide-down {
                from { transform: translateY(-400px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            #cash-alert-dialog .dialog-close {
                position: absolute; top: 8px; right: 8px;
                background: rgba(34,197,94,0.2); border: 1px solid rgba(34,197,94,0.4);
                color: rgb(34,197,94); width: 28px; height: 28px; border-radius: 50%;
                font-size: 20px; line-height: 1; cursor: pointer; transition: all 0.2s ease;
                padding: 0; display: flex; align-items: center; justify-content: center;
            }
            #cash-alert-dialog .dialog-close:hover { background: rgba(34,197,94,0.4); transform: rotate(90deg); }
            #cash-alert-dialog h3 {
                margin: 0 0 12px 0; color: rgb(34,197,94); font-size: 20px; font-weight: 600;
                text-align: center; padding-right: 20px;
            }
            #cash-alert-dialog p { margin: 8px 0; color: #d1fae5; font-size: 15px; text-align: center; }
            #cash-alert-dialog .cash-amount {
                font-size: 24px; font-weight: bold; color: #6ee7b7;
                font-family: 'Courier New', monospace; margin: 12px 0 16px 0;
            }
            #cash-alert-dialog .dialog-buttons { display: flex; gap: 8px; margin-top: 20px; }
            #cash-alert-dialog .btn-vault,
            #cash-alert-dialog .btn-faction-vault,
            #cash-alert-dialog .btn-trade {
                flex: 1; padding: 10px 8px; border: none; border-radius: 8px;
                font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;
                text-align: center; white-space: nowrap;
            }
            #cash-alert-dialog .btn-vault {
                background: linear-gradient(135deg, rgb(34,197,94) 0%, rgb(21,128,61) 100%); color: white;
            }
            #cash-alert-dialog .btn-vault:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(34,197,94,0.4); }
            #cash-alert-dialog .btn-faction-vault {
                background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white;
            }
            #cash-alert-dialog .btn-faction-vault:hover { background: linear-gradient(135deg, #10b981 0%, #059669 100%); transform: translateY(-2px); }
            #cash-alert-dialog .btn-trade {
                background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); color: white;
            }
            #cash-alert-dialog .btn-trade:hover { background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); transform: translateY(-2px); }
            #cash-alert-dialog .btn-dismiss {
                width: 100%; margin-top: 10px; padding: 8px; border: 1px solid rgba(255,255,255,0.15);
                border-radius: 8px; background: rgba(255,255,255,0.05); color: #d1fae5;
                font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;
            }
            #cash-alert-dialog .btn-dismiss:hover { background: rgba(255,255,255,0.12); }
            .deposit-btn-highlight {
                animation: deposit-btn-glow 1.5s ease-in-out infinite !important;
                border: 2px solid rgb(34,197,94) !important;
            }
            @keyframes deposit-btn-glow {
                0%, 100% { box-shadow: 0 0 5px rgba(34,197,94,0.5), 0 0 10px rgba(34,197,94,0.4), 0 0 15px rgba(34,197,94,0.3), inset 0 0 10px rgba(34,197,94,0.2); }
                50% { box-shadow: 0 0 10px rgba(34,197,94,0.8), 0 0 20px rgba(34,197,94,0.6), 0 0 30px rgba(34,197,94,0.4), inset 0 0 15px rgba(34,197,94,0.3); }
            }


            /* REMOVE THIS AFTER DONE */

           /* Surprise variant: soft ~0.6Hz pulse (opacity + glow only, no strobe) */
            #cash-alert-dialog .dialog-content.cash-surprise {
                width: 420px;
                animation: cash-surprise-pulse 1.6s ease-in-out infinite;
            }
            @keyframes cash-surprise-pulse {
                0%, 100% {
                    box-shadow: 0 20px 60px rgba(34,197,94,0.25), 0 10px 40px rgba(0,0,0,0.5);
                    opacity: 0.94;
                }
                50% {
                    box-shadow: 0 20px 70px rgba(34,197,94,0.6), 0 0 90px rgba(34,197,94,0.35), 0 10px 40px rgba(0,0,0,0.5);
                    opacity: 1;
                }
            }
            #cash-alert-dialog .dss-surprise-video {
                position: relative; width: 100%; padding-bottom: 56.25%; /* 16:9 */
                margin: 4px 0 4px; border-radius: 8px; overflow: hidden; background: #000;
            }
            #cash-alert-dialog .dss-surprise-video iframe {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;
            }


        `);

    // Position: bottom on PDA, top on desktop
    if (IS_PDA) {
        GM_addStyle('#cash-alert-dialog { bottom: 20px; left: 50%; transform: translateX(-50%); }');
    } else {
        GM_addStyle('#cash-alert-dialog { top: 20px; left: 20px; }');
    }

    // ── Start ────────────────────────────────────────────────────────
    checkVaultHighlight();
    updateCheck();
    checkTimer = setInterval(updateCheck, CHECK_INTERVAL);

    window.addEventListener('beforeunload', () => {
        if (checkTimer) clearInterval(checkTimer);
    });
}
});
