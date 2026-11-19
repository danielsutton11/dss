import { registerModule } from '../../core/registry.js';
import { UI } from '../../core/ui.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Chain Timeout
// ════════════════════════════════════════════════════════════════════════

registerModule('chain-monitor', {
name: 'Chain Monitor',
version: '1.2',
description: 'Monitor faction chain timeout with visual alerts. Shows green/orange/red pulsing on the chain bar and a random target dialog when critical.',
pages: ['https://www.torn.com/'],
guide,
init() {
    const GREEN_KEY = 'dss_chain_green';
    // PDA cleanup: remove stale elements from previous page load
    document.getElementById('chain-target-dialog')?.remove();
    const ORANGE_KEY = 'dss_chain_orange';
    const RED_KEY = 'dss_chain_red';

    const DEFAULT_GREEN = 105;
    const DEFAULT_ORANGE = 85;
    const DEFAULT_RED = 60;

    const GREEN_THRESHOLD = parseInt(GM_getValue(GREEN_KEY, String(DEFAULT_GREEN)), 10) || DEFAULT_GREEN;
    const ORANGE_THRESHOLD = parseInt(GM_getValue(ORANGE_KEY, String(DEFAULT_ORANGE)), 10) || DEFAULT_ORANGE;
    const RED_THRESHOLD = parseInt(GM_getValue(RED_KEY, String(DEFAULT_RED)), 10) || DEFAULT_RED;

    const CHECK_INTERVAL = 1000;
    const MIN_CHAIN_COUNT = 10;
    const minID = 3800000;
    const maxID = 3900000;

    let checkTimer = null;
    let currentAlertLevel = null;


    let targetDialogOpen = false;

    // ═════════════════════════════════════════════════════════════════════════
    // FOCUS GATING
    // Per Torn rules: scripts must only read data / generate alerts when
    // the page tab is actively focused.
    // ═════════════════════════════════════════════════════════════════════════

    let isTabFocused = document.hasFocus();
    window.addEventListener('focus', () => { isTabFocused = true; });
    window.addEventListener('blur', () => {
        isTabFocused = false;
        closeTargetDialog();
    });
    document.addEventListener('visibilitychange', () => {
        isTabFocused = document.visibilityState === 'visible' && document.hasFocus();
        if (!isTabFocused) closeTargetDialog();
    });

    // ── DOM selectors ────────────────────────────────────────────────
    // Torn moved sidebar CSS modules from camelCase (chainBar___) to
    // kebab-case (chain-bar___). Match both so either build works.
    const SEL = {
        chainBar: '[class*="chain-bar___"], [class*="chainBar___"]',
        value:    '[class*="bar-value___"], [class*="barValue___"]',
        timeLeft: '[class*="bar-timeleft___"], [class*="barTimeLeft___"]',
    };
    const getChainBar = () => document.querySelector(SEL.chainBar);

    // ── Guide page controls ──────────────────────────────────────────
    function wireGuideControls() {
        const greenInput = document.getElementById('dss-chain-green');
        const orangeInput = document.getElementById('dss-chain-orange');
        const redInput = document.getElementById('dss-chain-red');
        const saveBtn = document.getElementById('dss-chain-thresholds-save');
        const resetBtn = document.getElementById('dss-chain-thresholds-reset');
        const status = document.getElementById('dss-chain-thresholds-status');
        if (!greenInput || !saveBtn) return;

        greenInput.value = GM_getValue(GREEN_KEY, String(DEFAULT_GREEN));
        orangeInput.value = GM_getValue(ORANGE_KEY, String(DEFAULT_ORANGE));
        redInput.value = GM_getValue(RED_KEY, String(DEFAULT_RED));

        [greenInput, orangeInput, redInput].forEach(inp => {
            inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') saveBtn.click(); });
        });

        saveBtn.addEventListener('click', () => {
            const g = parseInt(greenInput.value, 10);
            const o = parseInt(orangeInput.value, 10);
            const r = parseInt(redInput.value, 10);

            if (!g || !o || !r || g < 10 || o < 10 || r < 10) {
                if (status) { status.textContent = '\u26A0 All values must be at least 10 seconds'; status.style.color = '#ef4444'; }
                return;
            }
            if (!(g > o && o > r)) {
                if (status) { status.textContent = '\u26A0 Green must be > Orange > Red'; status.style.color = '#ef4444'; }
                return;
            }

            GM_setValue(GREEN_KEY, String(g));
            GM_setValue(ORANGE_KEY, String(o));
            GM_setValue(RED_KEY, String(r));
            if (status) { status.textContent = '\u2705 Saved \u2014 reload any page to apply new thresholds'; status.style.color = '#4caf50'; }
        });

        resetBtn.addEventListener('click', () => {
            GM_setValue(GREEN_KEY, String(DEFAULT_GREEN));
            GM_setValue(ORANGE_KEY, String(DEFAULT_ORANGE));
            GM_setValue(RED_KEY, String(DEFAULT_RED));
            greenInput.value = DEFAULT_GREEN;
            orangeInput.value = DEFAULT_ORANGE;
            redInput.value = DEFAULT_RED;
            if (status) { status.textContent = '\u2705 Reset to defaults \u2014 reload to apply'; status.style.color = '#4caf50'; }
        });
    }

    UI.wireGuideField('dss-chain-green', wireGuideControls);

    // ── Monitoring ───────────────────────────────────────────────────
    addStyles();

    // Poll unconditionally; updateVisuals bails early if there's no bar.
    // Avoids the old 30s observer cutoff missing late-rendered sidebars.
    updateVisuals();
    checkTimer = setInterval(updateVisuals, CHECK_INTERVAL);

    function parseTimeString(timeString) {
        if (!timeString || timeString.trim() === '') return null;
        const parts = timeString.split(':');
        if (parts.length !== 2) return null;
        const minutes = parseInt(parts[0], 10);
        const seconds = parseInt(parts[1], 10);
        if (isNaN(minutes) || isNaN(seconds)) return null;
        return (minutes * 60) + seconds;
    }

    function getCurrentChainCount() {
        const el = getChainBar()?.querySelector(SEL.value);
        if (!el) return null;
        // Strip thousands separators / spaces: "1,234 / 2,500" -> "1234/2500"
        const match = el.textContent.replace(/[,\s]/g, '').match(/^(\d+)\//);
        return match ? parseInt(match[1], 10) : null;
    }

    function getChainTimeRemaining() {
        const el = getChainBar()?.querySelector(SEL.timeLeft);
        return el ? parseTimeString(el.textContent.trim()) : null;
    }

    function updateVisuals() {
        if (!isTabFocused) return;
        const chainBar = getChainBar();
        if (!chainBar) return;

        const chainCount = getCurrentChainCount();
        const timeRemaining = getChainTimeRemaining();

        if (chainCount === null || chainCount < MIN_CHAIN_COUNT) {
            if (currentAlertLevel !== null) clearAlerts(chainBar);
            return;
        }

        if (timeRemaining === null || timeRemaining <= 0) {
            if (currentAlertLevel !== null) clearAlerts(chainBar);
            return;
        }

        let targetAlertLevel = null;
        if (timeRemaining <= RED_THRESHOLD) {
            targetAlertLevel = 'red';
        } else if (timeRemaining <= ORANGE_THRESHOLD) {
            targetAlertLevel = 'orange';
        } else if (timeRemaining <= GREEN_THRESHOLD) {
            targetAlertLevel = 'green';
        } else {
            targetAlertLevel = 'none';
        }

        if (!isValidTransition(currentAlertLevel, targetAlertLevel)) return;

        if (currentAlertLevel !== targetAlertLevel) {
            currentAlertLevel = targetAlertLevel;
            applyAlertLevel(chainBar, targetAlertLevel);
        }
    }

    function isValidTransition(current, target) {
        if (current === target) return true;
        if (target === 'none') return true;
        if (current === null || current === 'none') return true;
        if (current === 'green' && (target === 'orange' || target === 'red')) return true;
        if (current === 'orange' && target === 'red') return true;
        return false;
    }

    function clearAlerts(chainBar) {
        chainBar.classList.remove('chain-alert-green', 'chain-alert-orange', 'chain-alert-red');
        closeTargetDialog();
        currentAlertLevel = null;
    }

    function applyAlertLevel(chainBar, level) {
        chainBar.classList.remove('chain-alert-green', 'chain-alert-orange', 'chain-alert-red');
        if (level === 'red') { chainBar.classList.add('chain-alert-red'); showTargetDialog(); }
        else if (level === 'orange') { chainBar.classList.add('chain-alert-orange'); closeTargetDialog(); }
        else if (level === 'green') { chainBar.classList.add('chain-alert-green'); closeTargetDialog(); }
        else { closeTargetDialog(); }
    }

    function getRandomNumber(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function getDialogBottom() {
        const mobDialog = document.getElementById('tc-mob-dialog');
        if (mobDialog) {
            const rect = mobDialog.getBoundingClientRect();
            return 20 + rect.height + 12;
        }
        return 20;
    }

    function showTargetDialog() {
        if (targetDialogOpen && document.getElementById('chain-target-dialog')) {
            const dialog = document.getElementById('chain-target-dialog');
            if (dialog) dialog.style.bottom = getDialogBottom() + 'px';
            return;
        }
        targetDialogOpen = true;
        const randID = getRandomNumber(minID, maxID);
        const attackLink = `https://www.torn.com/page.php?sid=attack&user2ID=${randID}`;
        const profileLink = `https://www.torn.com/profiles.php?XID=${randID}`;

        const dialog = document.createElement('div');
        dialog.id = 'chain-target-dialog';
        dialog.style.bottom = getDialogBottom() + 'px';
        dialog.innerHTML = `
                <div class="dialog-content">
                    <button class="dialog-close">\u00D7</button>
                    <h3>\u23F0 Chain Timeout!</h3>
                    <p>Quick attack random target?</p>
                    <a href="${profileLink}" target="_blank" rel="noopener noreferrer" class="profile-link user name" data-user="${randID}">${randID}</a>
                    <div class="dialog-buttons">
                        <a href="${attackLink}" target="_blank" class="btn-attack">Attack</a>
                        <button class="btn-new-target">New Target</button>
                    </div>
                </div>
            `;
        document.body.appendChild(dialog);

        const profileLinkElement = dialog.querySelector('.profile-link');
        profileLinkElement.addEventListener('mousedown', () => {
            setTimeout(() => { profileLinkElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true })); }, 500);
        });

        dialog.querySelector('.btn-new-target').addEventListener('click', updateTargetDialog);
        dialog.querySelector('.dialog-close').addEventListener('click', closeTargetDialog);
        dialog.querySelector('.btn-attack').addEventListener('click', () => setTimeout(closeTargetDialog, 500));
        repositionInjectedStats();
    }

    function repositionInjectedStats() {
        const check = () => {
            const profileLink = document.querySelector('#chain-target-dialog .profile-link');
            if (!profileLink) return;
            profileLink.querySelectorAll('div').forEach(div => {
                if (div.style.left !== '10px') { div.style.setProperty('left', '10px', 'important'); div.style.setProperty('right', 'auto', 'important'); }
            });
        };
        [50, 100, 200, 500].forEach(ms => setTimeout(check, ms));
    }

    function updateTargetDialog() { closeTargetDialog(); setTimeout(() => showTargetDialog(), 50); }

    function closeTargetDialog() {
        const dialog = document.getElementById('chain-target-dialog');
        if (dialog) dialog.remove();
        targetDialogOpen = false;
    }

    function addStyles() {
        GM_addStyle(`
                @keyframes chain-pulse-green {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7), 0 0 15px rgba(34,197,94,0.4), inset 0 0 10px rgba(34,197,94,0.2); }
                    50% { box-shadow: 0 0 0 8px rgba(34,197,94,0), 0 0 25px rgba(34,197,94,0.6), inset 0 0 15px rgba(34,197,94,0.3); }
                }
                .chain-alert-green { animation: chain-pulse-green 2s ease-in-out infinite !important; border: 2px solid rgb(34,197,94) !important; border-radius: 8px !important; }

                @keyframes chain-pulse-orange {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.7), 0 0 20px rgba(249,115,22,0.5), inset 0 0 12px rgba(249,115,22,0.25); }
                    50% { box-shadow: 0 0 0 10px rgba(249,115,22,0), 0 0 35px rgba(249,115,22,0.7), inset 0 0 18px rgba(249,115,22,0.35); }
                }
                .chain-alert-orange { animation: chain-pulse-orange 1.5s ease-in-out infinite !important; border: 2px solid rgb(249,115,22) !important; border-radius: 8px !important; }

                @keyframes chain-flash-red {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.8), 0 0 25px rgba(239,68,68,0.6), inset 0 0 15px rgba(239,68,68,0.3); background-color: rgba(239,68,68,0.05); }
                    50% { box-shadow: 0 0 0 12px rgba(239,68,68,0), 0 0 45px rgba(239,68,68,0.9), inset 0 0 25px rgba(239,68,68,0.4); background-color: rgba(239,68,68,0.15); }
                }
                .chain-alert-red { animation: chain-flash-red 0.8s ease-in-out infinite !important; border: 3px solid rgb(239,68,68) !important; border-radius: 8px !important; }

                #chain-target-dialog { position: fixed; left: 20px; z-index: 999999; }
                #chain-target-dialog .dialog-content {
                    background: linear-gradient(135deg, #1f2937 0%, #111827 100%); border: 2px solid rgb(239,68,68);
                    border-radius: 12px; padding: 20px; width: 280px; max-width: calc(100vw - 40px); box-sizing: border-box;
                    box-shadow: 0 20px 60px rgba(239,68,68,0.4), 0 0 100px rgba(239,68,68,0.2), 0 10px 40px rgba(0,0,0,0.5);
                    position: relative; animation: chain-dialog-slide-in 0.3s ease-out;
                }
                @keyframes chain-dialog-slide-in { from { transform: translateX(-400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
                #chain-target-dialog .dialog-close {
                    position: absolute; top: 8px; right: 8px; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.4);
                    color: rgb(239,68,68); width: 28px; height: 28px; border-radius: 50%; font-size: 20px; line-height: 1;
                    cursor: pointer; transition: all 0.2s ease; padding: 0; display: flex; align-items: center; justify-content: center;
                }
                #chain-target-dialog .dialog-close:hover { background: rgba(239,68,68,0.4); transform: rotate(90deg); }
                #chain-target-dialog h3 { margin: 0 0 12px 0; color: rgb(239,68,68); font-size: 20px; font-weight: 600; text-align: center; padding-right: 20px; }
                #chain-target-dialog p { margin: 8px 0; color: #e5e7eb; font-size: 15px; text-align: center; }
                #chain-target-dialog .profile-link {
                    display: block; font-family: 'Courier New', monospace; font-size: 17px; font-weight: bold; color: #fbbf24;
                    text-decoration: none; margin: 8px auto 16px auto; padding: 7px 12px;
                    border-radius: 6px; background: transparent; text-align: center;
                }
                #chain-target-dialog .profile-link > div,
                #chain-target-dialog .profile-link div[class*="Div"],
                #chain-target-dialog .profile-link div[class*="Stats"],
                #chain-target-dialog .profile-link div[style*="position: absolute"] { left: 10px !important; right: auto !important; margin-left: 0 !important; }
                #chain-target-dialog .dialog-content > a.profile-link { display: block; width: fit-content; margin-left: auto; margin-right: auto; }
                #chain-target-dialog .profile-link:hover { color: #fcd34d; text-decoration: underline; }
                #chain-target-dialog .dialog-buttons { display: flex; gap: 10px; margin-top: 20px; }
                #chain-target-dialog .btn-attack,
                #chain-target-dialog .btn-new-target {
                    flex: 1; padding: 10px 8px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
                    cursor: pointer; transition: all 0.2s ease; text-decoration: none; text-align: center; display: inline-block;
                }
                #chain-target-dialog .btn-attack { background: linear-gradient(135deg, rgb(239,68,68) 0%, rgb(220,38,38) 100%); color: white; }
                #chain-target-dialog .btn-attack:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(239,68,68,0.4); }
                #chain-target-dialog .btn-new-target { background: linear-gradient(135deg, #4b5563 0%, #374151 100%); color: white; }
                #chain-target-dialog .btn-new-target:hover { background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%); transform: translateY(-2px); }
            `);
    }

    window.addEventListener('beforeunload', () => { if (checkTimer) clearInterval(checkTimer); });
}
});
