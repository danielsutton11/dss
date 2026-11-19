import { IS_PDA } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import { UI } from '../../core/ui.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Med X Revive
// ════════════════════════════════════════════════════════════════════════

registerModule('medx-revive', {
name: 'Med X Revive',
version: '1.3.0',
description: 'Request a revive from Med X: a MEDX REVIVE ME button under your life bar and in the top page links (desktop) or a floating button (phone) while you are in hospital, plus a revive link on hospitalised players\' profiles.',
pages: ['https://www.torn.com/'],
guide,
init() {
    // Cloudflare challenge page: do nothing
    if (document.querySelector('.iAmUnderAttack, #cf-bubbles, iframe[src*="challenges.cloudflare"]')) return;

    // PDA cleanup: remove stale elements from a previous page load
    ['medx-btn', 'medx-bar-btn', 'medx-toast'].forEach(id => document.getElementById(id)?.remove());

    const API_URL = 'https://medx.fun/revive/request/';
    const LAYOUT_KEY = 'dss_medx_layout';
    const path = location.pathname;

    // ----- Phone button settings -----
    const PHONE_BOTTOM_OFFSET_PX = 56; // Distance from the bottom of the screen
    const SENT_STATE_MS = 10000;       // How long the button stays locked after a successful request
    const ERROR_STATE_MS = 4000;       // How long an error message stays on the button

    // ----- Button text -----
    const SELF_LABEL = 'MEDX REVIVE ME';       // You, while you're in hospital
    const OTHER_LABEL = 'MEDX Revive Player';  // A hospitalised player's profile
    const LINK_GREEN = '#61be3b';              // Header link colour (same green as NITE)
    const LINK_GREEN_HOVER = '#7fd65a';

    // Own class names (medx-*) so Midnight X's global .revive-icon / .revive-text styles can't recolour these
    const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20"><path fill="none" class="medx-icon" d="M18.737,9.691h-5.462c-0.279,0-0.527,0.174-0.619,0.437l-1.444,4.104L8.984,3.195c-0.059-0.29-0.307-0.506-0.603-0.523C8.09,2.657,7.814,2.838,7.721,3.12L5.568,9.668H1.244c-0.36,0-0.655,0.291-0.655,0.655c0,0.36,0.294,0.655,0.655,0.655h4.8c0.281,0,0.532-0.182,0.621-0.45l1.526-4.645l2.207,10.938c0.059,0.289,0.304,0.502,0.595,0.524c0.016,0,0.031,0,0.046,0c0.276,0,0.524-0.174,0.619-0.437L13.738,11h4.999c0.363,0,0.655-0.294,0.655-0.655C19.392,9.982,19.1,9.691,18.737,9.691z"/></svg>`;

    function el(tag, props = {}, children = []) {
        const e = document.createElement(tag);
        Object.assign(e, props);
        children.forEach(c => e.append(c));
        return e;
    }

    // ── Layout setting (DSS guide page) ──────────────────────────────
    UI.wireGuideField('dss-medx-layout', () => {
        const sel = document.getElementById('dss-medx-layout');
        if (!sel || sel.dataset.wired) return;
        sel.dataset.wired = '1';
        sel.value = GM_getValue(LAYOUT_KEY, 'auto');
        sel.addEventListener('change', () => {
            GM_setValue(LAYOUT_KEY, sel.value);
            const s = document.getElementById('dss-medx-layout-status');
            if (s) s.textContent = '\u2705 Saved \u2014 applies on your next page load';
        });
    });

    // ── Device detection ─────────────────────────────────────────────
    function detectPhone() {
        const override = GM_getValue(LAYOUT_KEY, 'auto');
        if (override === 'phone') return true;
        if (override === 'desktop') return false;

        if (IS_PDA) return true;
        if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
        if (/iPhone|iPod|Windows Phone|Android.*Mobile/i.test(navigator.userAgent)) return true;

        // Covers browsers that request desktop sites but still run on a small touch screen
        const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        return !!coarsePointer && Math.min(screen.width, screen.height) < 600;
    }

    const isPhone = detectPhone();

    // ── Styles ───────────────────────────────────────────────────────
    if (isPhone) {
        GM_addStyle(`
                #medx-btn.medx-fab {
                    position: fixed;
                    right: 16px;
                    bottom: calc(${PHONE_BOTTOM_OFFSET_PX}px + env(safe-area-inset-bottom, 0px));
                    z-index: 99999;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 2px;
                    width: 52px;
                    height: 52px;
                    padding: 0;
                    border: 0;
                    border-radius: 50%;
                    background: #c62828;
                    box-shadow: 0 3px 10px rgba(0, 0, 0, .45);
                    touch-action: manipulation;
                    -webkit-tap-highlight-color: transparent;
                }
                #medx-btn.medx-fab:active { transform: scale(.96); }
                #medx-btn.medx-fab svg { width: 22px; height: 22px; flex: none; }
                #medx-btn.medx-fab span { color: #fff; font: 700 9px/1 Arial, sans-serif; letter-spacing: .3px; }
                #medx-btn.medx-fab .medx-icon { fill: #fff !important; }
                #medx-btn.medx-fab[data-state="sending"] { background: #616161; }
                #medx-btn.medx-fab[data-state="sent"] { background: #2e7d32; }
                #medx-btn.medx-fab[data-state="error"] { background: #8e1b1b; }

                #medx-toast {
                    position: fixed;
                    left: 16px;
                    right: 16px;
                    bottom: calc(${PHONE_BOTTOM_OFFSET_PX + 64}px + env(safe-area-inset-bottom, 0px));
                    z-index: 100000;
                    padding: 12px 14px;
                    border-radius: 8px;
                    background: rgba(25, 25, 25, .95);
                    color: #fff;
                    font: 14px/1.35 Arial, sans-serif;
                    text-align: center;
                }
            `);
    } else {
        GM_addStyle(`
                /* Full-width button on its own line, directly under the life bar */
                #medx-bar-btn {
                    all: unset;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    box-sizing: border-box;
                    width: 100%;
                    height: 16px;
                    margin: 4px 0 6px;
                    border-radius: 8px;
                    background: #c62828;
                    color: #fff;
                    font: 700 9px/16px Arial, sans-serif;
                    letter-spacing: .3px;
                    white-space: nowrap;
                    cursor: pointer;
                }
                #medx-bar-btn:hover { background: #e53935; }
                #medx-bar-btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
                #medx-bar-btn svg { width: 10px; height: 10px; flex: none; }
                #medx-bar-btn .medx-icon { fill: #fff !important; }
                #medx-bar-btn[data-state="sending"] { background: #616161; cursor: default; }
                #medx-bar-btn[data-state="sent"] { background: #2e7d32; cursor: default; }
                #medx-bar-btn[data-state="error"] { background: #8e1b1b; cursor: default; }

                #medx-btn.custom-revive .medx-text { color: ${LINK_GREEN} !important; }
                #medx-btn.custom-revive .medx-icon { fill: ${LINK_GREEN} !important; }
                #medx-btn.custom-revive:hover .medx-text { color: ${LINK_GREEN_HOVER} !important; }
                #medx-btn.custom-revive:hover .medx-icon { fill: ${LINK_GREEN_HOVER} !important; }

                /* Short name next to the icon, only when Torn hides the link text (e.g. Torn PDA) */
                #medx-btn .medx-tag { display: none !important; }
                #medx-btn.medx-tagged { width: auto !important; overflow: visible !important; white-space: nowrap; }
                #medx-btn.medx-tagged .medx-tag {
                    display: inline-block !important;
                    margin-left: 3px;
                    vertical-align: middle;
                    font: 700 8px/1 Arial, sans-serif;
                    color: ${LINK_GREEN};
                    pointer-events: none;
                }
            `);
    }

    // ── Messages ─────────────────────────────────────────────────────
    let toastTimer;

    function showToast(message) {
        document.getElementById('medx-toast')?.remove();
        clearTimeout(toastTimer);
        const toast = el('div', { id: 'medx-toast', textContent: message });
        toast.setAttribute('role', 'status');
        document.body.append(toast);
        toastTimer = setTimeout(() => toast.remove(), 4000);
    }

    // Phone only: desktop shows the result on the button itself, no pop-ups
    function notify(message) {
        if (isPhone) showToast(message);
    }

    // ── Torn data ────────────────────────────────────────────────────
    function getSessionData() {
        const key = Object.keys(sessionStorage).find(k => /sidebarData\d+/.test(k));
        if (!key) return null;
        try {
            const data = JSON.parse(sessionStorage.getItem(key));
            return { userID: data.user.userID, userName: data.user.name, hospital: data.statusIcons?.icons?.hospital };
        } catch (_) {
            return null;
        }
    }

    function isProfileInHospital() {
        const desc = document.querySelector('.main-desc');
        return !!desc && desc.textContent.toLowerCase().includes('hospital');
    }

    function getProfilePlayerId() {
        const params = new URLSearchParams(location.search);
        return params.get('XID') || params.get('playerID') || params.get('playerId');
    }

    // ── Sending requests ─────────────────────────────────────────────
    function httpPost(url, body) {
        const headers = { 'Content-Type': 'application/json' };

        if (typeof GM !== 'undefined' && GM.xmlHttpRequest) {
            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'POST', url, headers, data: body, timeout: 15000,
                    onload: (r) => { if (!r) return; resolve(r); }, // PDA fires onload once with undefined before the real response
                    onerror: reject,
                    ontimeout: () => reject(new Error('timeout'))
                });
            });
        }
        if (typeof window.flutter_inappwebview !== 'undefined') {
            return window.flutter_inappwebview.callHandler('PDA_httpPost', url, headers, body);
        }
        return Promise.reject(new Error('No cross-site request method available'));
    }

    // Resolves to { ok, short, long }: short is shown on desktop buttons, long in the phone toast and tooltip
    async function submitRequest(playerId) {
        // Same key as every other DSS module; DSS has already validated it with Torn
        const apiKey = (Storage.getSettings().apiKey || '').trim();
        const session = getSessionData();

        const fail = (short, long) => { notify(long); return { ok: false, short, long }; };

        if (!apiKey) return fail('NO API KEY', 'No API key set. Add your Torn API key on the DSS Setup page.');
        if (!session) return fail('RELOAD THE PAGE', 'Could not read your Torn session. Reload the page and try again.');

        const payload = {
            vendor: 'MedX',
            tornid: parseInt(playerId, 10),
            username: session.userName,
            requestorid: parseInt(session.userID, 10),
            source: 'userscript',
            type: 'revive'
        };

        try {
            const res = await httpPost(API_URL + encodeURIComponent(apiKey), JSON.stringify(payload));
            const status = Number(res?.status) || 0;

            if (status === 200) {
                notify('Revive request sent to Med X');
                return { ok: true, short: 'REQUEST SENT', long: 'Revive request sent to Med X' };
            }
            console.warn('[DSS Med X] request failed:', status, res?.responseText);
            if (status === 400) return fail('BAD REQUEST', 'Bad request: missing Torn ID or invalid data');
            if (status === 401) return fail('API KEY REJECTED', 'Med X rejected your API key. Check it on the DSS Setup page.');
            if (status === 403) return fail('BANNED FROM MED X', 'Forbidden: you are banned from the Med X service');
            return fail(`FAILED (${status || '?'})`, `Request failed (status ${status || 'unknown'})`);
        } catch (err) {
            console.error('[DSS Med X] network error:', err);
            return fail('NETWORK ERROR', 'Request failed (network error). Try again.');
        }
    }

    // ── Desktop: Revive link in Torn's top page links (profiles) ─────
    function addDesktopButton(playerId, label) {
        const target = document.querySelector('#top-page-links-list');
        if (!target) return;

        const btn = el('a', {
            id: 'medx-btn',
            className: 'custom-revive t-clear h c-pointer m-icon line-h24 right last',
            href: '#medx-revive',
            innerHTML: `<span class="icon-wrap svg-icon-wrap"><span class="link-icon-svg">${icon}</span></span><span class="medx-text">${label}</span><span class="medx-tag">MEDX</span>`
        });
        btn.dataset.playerId = String(playerId);
        if (document.body.classList.contains('dark-mode')) btn.classList.add('custom-dark-mode');

        const text = btn.querySelector('.medx-text');
        let sending = false;
        let resetTimer;
        btn.addEventListener('click', async e => {
            e.preventDefault();
            if (sending) return;
            sending = true;
            clearTimeout(resetTimer);
            text.textContent = 'Sending\u2026';
            const result = await submitRequest(playerId);
            text.textContent = result.ok ? 'Request sent' : result.short;
            btn.title = result.long;
            resetTimer = setTimeout(() => {
                text.textContent = label;
                btn.title = '';
                sending = false;
            }, result.ok ? SENT_STATE_MS : ERROR_STATE_MS);
        });

        placeHeaderButton(btn, target);
    }

    // Inside Torn's link list (same as Midnight X), directly left of NITE when it's there.
    // Midnight X appends after the list's last item, so if Med X goes in first NITE still lands to its right.
    function placeHeaderButton(btn, list) {
        const nite = list.querySelector('#custom-btn');
        if (nite) {
            if (btn.nextElementSibling !== nite) nite.insertAdjacentElement('beforebegin', btn);
        } else if (btn.parentElement !== list) {
            list.appendChild(btn);
        }
    }

    // ── One press sends, then the button locks briefly ───────────────
    function addSendFlow(btn, playerId, text) {
        const label = el('span');
        btn.append(label);

        let resetTimer;

        function setState(state) {
            clearTimeout(resetTimer);
            btn.dataset.state = state;
            label.textContent = text[state] || '';
            btn.title = text.titles?.[state] || '';
        }

        const reset = () => setState('idle');

        btn.addEventListener('click', async e => {
            e.preventDefault();
            e.stopPropagation();

            if (btn.dataset.state !== 'idle') return;

            setState('sending');
            const result = await submitRequest(playerId);
            if (result.ok) {
                navigator.vibrate?.([30, 50, 30]);
                setState('sent');
                resetTimer = setTimeout(reset, SENT_STATE_MS);
            } else {
                // Show the reason on the button for a moment, then go back to idle
                btn.dataset.state = 'error';
                label.textContent = text.error ?? result.short;
                btn.title = result.long;
                resetTimer = setTimeout(reset, ERROR_STATE_MS);
            }
        });

        reset();
    }

    // ── Phone: large floating button ─────────────────────────────────
    function addPhoneButton(playerId) {
        const btn = el('button', { id: 'medx-btn', className: 'medx-fab', type: 'button', innerHTML: icon });
        btn.dataset.playerId = String(playerId);
        btn.setAttribute('aria-label', 'Request a Med X revive');
        addSendFlow(btn, playerId, {
            idle: 'MEDX',
            sending: 'MEDX',
            sent: 'SENT',
            error: 'MEDX', // the full reason is shown in the toast
            titles: { idle: 'Request a Med X revive', sending: 'Sending request', sent: 'Revive requested' }
        });
        document.body.append(btn);
    }

    // ── Desktop: full-width button on its own line, directly under the life bar ──
    function findLifeBar() {
        return document.querySelector('[class*="bar___"][class*="life___"][class*="barDesktop___"]');
    }

    function showLifeBarButton(playerId) {
        const bar = findLifeBar();
        let btn = document.getElementById('medx-bar-btn');

        if (!bar) {
            btn?.remove();
            return;
        }

        if (!btn) {
            btn = el('button', { id: 'medx-bar-btn', type: 'button', innerHTML: icon });
            btn.setAttribute('aria-label', 'Request a Med X revive');
            addSendFlow(btn, playerId, {
                idle: SELF_LABEL,
                sending: 'SENDING\u2026',
                sent: 'REQUEST SENT',
                titles: { idle: 'Request a Med X revive', sending: 'Sending request', sent: 'Revive requested' }
            });
        }

        // Torn can rebuild the sidebar, so put the button back right after the bar if it was moved or lost
        if (bar.nextElementSibling !== btn) bar.insertAdjacentElement('afterend', btn);
    }

    function removeLifeBarButton() {
        document.getElementById('medx-bar-btn')?.remove();
    }

    // Hospitalised profile: that player. Anywhere else: you, while you're in hospital.
    function getPhoneTarget(session) {
        if (path.includes('profiles.php') && isProfileInHospital()) {
            const profileId = getProfilePlayerId();
            if (profileId) return profileId;
        }
        return session?.hospital ? session.userID : null;
    }

    function updatePhoneButton(playerId) {
        const btn = document.getElementById('medx-btn');
        if (!playerId) return btn?.remove();
        if (btn && btn.dataset.playerId === String(playerId)) return;

        // Rebuild when the target changes, so a press can't go to the wrong player
        btn?.remove();
        addPhoneButton(playerId);
    }

    function showReviveButton(playerId, label) {
        const btn = document.getElementById('medx-btn');
        const list = document.querySelector('#top-page-links-list');
        if (btn && list && btn.dataset.playerId === String(playerId) && list.contains(btn)) {
            placeHeaderButton(btn, list); // keep it left of NITE if NITE appeared after us
            return;
        }
        // Rebuild when the target changes (so a press can't go to the wrong player) or Torn rebuilt the list
        btn?.remove();
        addDesktopButton(playerId, label);
    }

    // Torn hides the top link text on narrow screens (e.g. Torn PDA), leaving only the icon.
    // When that happens, show the short MEDX tag next to the icon so it can't be confused with NITE.
    function updateHeaderTag() {
        const btn = document.getElementById('medx-btn');
        const text = btn?.querySelector('.medx-text');
        if (!text) return;
        const cs = getComputedStyle(text);
        const hidden = cs.display === 'none' || cs.visibility === 'hidden' || text.getBoundingClientRect().width === 0;
        btn.classList.toggle('medx-tagged', hidden);
    }

    function removeReviveButton() {
        document.getElementById('medx-btn')?.remove();
    }

    // ── Loop ─────────────────────────────────────────────────────────
    function tick() {
        if (!document.body) return;

        const session = getSessionData();

        // Phone: floating button on every page. Desktop: life bar button on every page.
        if (isPhone) {
            updatePhoneButton(getPhoneTarget(session));
            return;
        }

        if (session?.hospital) showLifeBarButton(session.userID);
        else removeLifeBarButton();

        // Top page links on every page: a hospitalised profile's player, otherwise you while you're in hospital
        const target = getPhoneTarget(session);
        if (target) {
            showReviveButton(target, String(target) === String(session?.userID) ? SELF_LABEL : OTHER_LABEL);
            updateHeaderTag();
        }
        else removeReviveButton();
    }

    const timer = setInterval(tick, 300);
    window.addEventListener('beforeunload', () => clearInterval(timer));
}
});
