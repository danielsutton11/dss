import { IS_PDA, tornAuth } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import guide from './guide.html?raw';

 // ════════════════════════════════════════════════════════════════════════
// OC Join Reminder
// ════════════════════════════════════════════════════════════════════════

registerModule('oc-reminder', {
name: 'OC Join Reminder',
version: '1.2',
hidden: true,
controlledBy: 'crime-prioritiser',
description: 'Reminds you to join an organised crime when you are not currently in one. Checks the Torn API sparingly and lets you dismiss the nudge for a couple of minutes.',
pages: ['https://www.torn.com/'],
guide,
init() {
    const API_URL = 'https://api.torn.com/v2/user/organizedcrime';
    const FACTION_API_URL = 'https://api.torn.com/v2/user/faction';
    const CRIMES_URL = 'https://www.torn.com/factions.php?step=your&type=1#/tab=crimes';

    // GM-backed so state is shared across every open tab (avoids each tab
    // firing its own API call on every page load).
    const STATE_KEY = 'dss_oc_state';           // 'in' | 'out' | 'ineligible' | null
    const NEXT_KEY = 'dss_oc_nextCheck';        // ms: don't call the API before this
    const CHECKED_KEY = 'dss_oc_checkedAt';     // ms: when STATE_KEY was last confirmed by the API
    const DISMISS_KEY = 'dss_oc_dismissedUntil';// ms: prompt suppressed until this
    const POSITION_KEY = 'dss_oc_position';          // cached faction position ('' = no faction)
    const POSITION_NEXT_KEY = 'dss_oc_positionNext'; // ms: don't re-fetch position before this

    // ── Timing knobs ─────────────────────────────────────────────────
    const DISMISS_MS = 2 * 60 * 1000;    // hardcoded 2-minute dismiss
    const MIN_API_GAP = 60 * 1000;       // hard floor between any two API calls
    const NUDGE_RECHECK_MS = 3 * 60 * 1000; // while not in a crime, background re-verify this often
    const IN_CRIME_POLL_MS = 5 * 60 * 1000; // once the crime is ready, poll for execution
    const INELIGIBLE_RECHECK_MS = 60 * 60 * 1000; // recruits / factionless: re-check hourly
    const TICK_MS = 20 * 1000;           // how often we evaluate the cache (cheap)

    // Lowercase faction positions that can't join an OC.
    const INELIGIBLE_POSITIONS = ['recruit'];

    // Crime statuses that mean the crime is finished — you're no longer "in" it.
    const INACTIVE_STATUSES = ['expired', 'failure', 'successful'];

    let checkTimer = null;

    const getNum = (key) => parseInt(GM_getValue(key, '0'), 10) || 0;

    // Force a fresh API check the next time evaluate() runs (e.g. after
    // the user heads off to join a crime).
    function invalidate() {
        GM_setValue(NEXT_KEY, '0');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FOCUS GATING (per Torn rules: only read data / alert on a focused tab)
    // ═════════════════════════════════════════════════════════════════════════
    let isTabFocused = document.hasFocus();
    window.addEventListener('focus', () => { isTabFocused = true; evaluate(); });
    window.addEventListener('blur', () => { isTabFocused = false; closePrompt(); });
    document.addEventListener('visibilitychange', () => {
        isTabFocused = document.visibilityState === 'visible' && document.hasFocus();
        if (!isTabFocused) closePrompt(); else evaluate();
    });

    // Don't nag while they're already on the crimes page trying to join.
    function onCrimesPage() {
        return (location.pathname.includes('/factions.php') && location.hash.includes('tab=crimes'))
            || location.pathname.includes('/organizedcrimes.php');
    }

    // ── Decide whether to call the API, or just act on the cache ──────
    function evaluate() {
        if (!isTabFocused) return;

        // On the crimes page they're likely joining — hide the prompt and
        // make sure we re-check as soon as they leave.
        if (onCrimesPage()) { closePrompt(); invalidate(); return; }

        const apiKey = Storage.getSettings().apiKey;
        if (!apiKey) { closePrompt(); return; }

        const now = Date.now();
        if (now < getNum(DISMISS_KEY)) { closePrompt(); return; } // dismissed

        const state = GM_getValue(STATE_KEY, null);
        const lockHeld = now < getNum(NEXT_KEY);
        const stale = now - getNum(CHECKED_KEY) > MIN_API_GAP;

        // 'in' / 'ineligible' are safe to trust from cache. A stale 'out' is
        // not — they may have joined since — so never nag from one.
        if (lockHeld && !(state === 'out' && stale)) { reflectState(state); return; }

        // Stale 'out' but another call is in flight / too recent: stay quiet
        // rather than risk a false nag; the next tick will catch up.
        if (lockHeld) { closePrompt(); return; }

        check(apiKey);
    }

    // ── Show/hide the prompt from a cached state, no API call ─────────
    // Only 'out' shows the prompt; 'in' and 'ineligible' both suppress it.
    function reflectState(state) {
        const now = Date.now();
        if (state === 'out' && now >= getNum(DISMISS_KEY) && !onCrimesPage()) showPrompt();
        else closePrompt();
    }

    // ── Faction position (cached, refreshed at most hourly) ───────────
    // Returns the lowercase position ('' if factionless), or null if it
    // couldn't be determined (API error with nothing cached).
    async function getPosition(apiKey) {
        const now = Date.now();
        const cached = GM_getValue(POSITION_KEY, null);
        if (cached !== null && now < getNum(POSITION_NEXT_KEY)) return cached;

        try {
            const res = await fetch(FACTION_API_URL, { headers: tornAuth(apiKey) });
            const data = await res.json();
            if (data?.error) {
                console.warn('[DSS OC Reminder] faction API error', data.error);
                return cached; // fall back to last known (may be null)
            }
            const fac = data?.faction;
            const position = fac?.id ? (fac.position || '').trim().toLowerCase() : '';
            GM_setValue(POSITION_KEY, position);
            GM_setValue(POSITION_NEXT_KEY, String(now + INELIGIBLE_RECHECK_MS));
            return position;
        } catch (e) {
            console.warn('[DSS OC Reminder] faction fetch failed', e);
            return cached;
        }
    }

    const isIneligible = (position) =>
        position === '' || INELIGIBLE_POSITIONS.includes(position);

    // ── The API check, rate-limited via NEXT_KEY ──────────────────────
    async function check(apiKey) {
        // Provisional lock BEFORE the call: any other tab (or this tab's next
        // tick) that arrives during the request sees a future nextCheck and
        // skips, so we never fire duplicate concurrent calls.
        GM_setValue(NEXT_KEY, String(Date.now() + MIN_API_GAP));

        // Recruits (and factionless users) can't join an OC — don't nag them.
        // A null position (API failure, no cache) falls through to the normal
        // check, so a blip risks a false nag rather than silently disabling.
        const position = await getPosition(apiKey);
        if (position !== null && isIneligible(position)) {
            GM_setValue(STATE_KEY, 'ineligible');
            GM_setValue(CHECKED_KEY, String(Date.now()));
            GM_setValue(NEXT_KEY, String(Date.now() + INELIGIBLE_RECHECK_MS));
            reflectState('ineligible'); // closes any open prompt
            return;
        }

        try {
            const res = await fetch(API_URL, { headers: tornAuth(apiKey) });
            const data = await res.json();
            if (data?.error) {
                console.warn('[DSS OC Reminder] API error', data.error);
                closePrompt(); // don't keep nagging on unverified state
                return; // lock stands → retry after MIN_API_GAP
            }

            const oc = data?.organizedCrime;
            const status = (oc?.status || '').toLowerCase();
            // In a crime = a crime is present, not yet executed, and not
            // already finished (an Expired crime has executed_at === null too).
            const inCrime = !!(oc && oc.executed_at == null && !INACTIVE_STATUSES.includes(status));

            const now = Date.now();
            GM_setValue(STATE_KEY, inCrime ? 'in' : 'out');
            GM_setValue(CHECKED_KEY, String(now));

            // Schedule the next allowed call.
            let next;
            if (inCrime) {
                // A crime can't execute before ready_at, so there's no point
                // checking until then — huge API saving while planning.
                const readyMs = oc.ready_at ? oc.ready_at * 1000 : 0;
                next = readyMs > now ? readyMs : now + IN_CRIME_POLL_MS;
            } else {
                next = now + NUDGE_RECHECK_MS;
            }
            GM_setValue(NEXT_KEY, String(Math.max(next, now + MIN_API_GAP)));

            reflectState(inCrime ? 'in' : 'out');
        } catch (e) {
            console.warn('[DSS OC Reminder] fetch failed', e);
            closePrompt();
            // lock stands → retry after MIN_API_GAP
        }
    }

    // ── Prompt UI ────────────────────────────────────────────────────
    function showPrompt() {
        if (document.getElementById('oc-reminder-dialog')) return;

        const dialog = document.createElement('div');
        dialog.id = 'oc-reminder-dialog';
        dialog.innerHTML = `
                <div class="dialog-content">
                    <button class="dialog-close">\u00D7</button>
                    <h3>\uD83D\uDD2B Not in a Crime</h3>
                    <p>You're not currently in an organised crime.</p>
                    <div class="dialog-buttons">
                        <a href="${CRIMES_URL}" class="btn-join">Join a Crime</a>
                        <button class="btn-dismiss">Dismiss</button>
                    </div>
                </div>
            `;
        document.body.appendChild(dialog);

        // Clicking Join navigates in this tab; start the dismiss window so it
        // doesn't immediately re-nag, and invalidate the cache so the next
        // check after joining sees the new state.
        dialog.querySelector('.btn-join').addEventListener('click', () => {
            GM_setValue(DISMISS_KEY, String(Date.now() + DISMISS_MS));
            invalidate();
        });
        dialog.querySelector('.btn-dismiss').addEventListener('click', dismiss);
        dialog.querySelector('.dialog-close').addEventListener('click', dismiss);
    }

    function closePrompt() {
        const dialog = document.getElementById('oc-reminder-dialog');
        if (dialog) dialog.remove();
    }

    function dismiss() {
        GM_setValue(DISMISS_KEY, String(Date.now() + DISMISS_MS));
        closePrompt();
    }

    // ── Styles ───────────────────────────────────────────────────────
    GM_addStyle(`
            #oc-reminder-dialog { position: fixed; z-index: 999999; }
            #oc-reminder-dialog .dialog-content {
                background: linear-gradient(135deg, #1e3a5a 0%, #0f2137 100%);
                border: 2px solid rgb(96, 165, 250); border-radius: 12px; padding: 22px;
                width: 320px; max-width: calc(100vw - 40px); box-sizing: border-box;
                box-shadow: 0 20px 60px rgba(96,165,250,0.35), 0 0 100px rgba(96,165,250,0.18), 0 10px 40px rgba(0,0,0,0.5);
                position: relative; animation: oc-reminder-slide-in 0.35s ease-out;
            }
            @keyframes oc-reminder-slide-in {
                from { transform: translateX(-400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            #oc-reminder-dialog .dialog-close {
                position: absolute; top: 8px; right: 8px;
                background: rgba(96,165,250,0.2); border: 1px solid rgba(96,165,250,0.4);
                color: rgb(147,197,253); width: 28px; height: 28px; border-radius: 50%;
                font-size: 20px; line-height: 1; cursor: pointer; transition: all 0.2s ease;
                padding: 0; display: flex; align-items: center; justify-content: center;
            }
            #oc-reminder-dialog .dialog-close:hover { background: rgba(96,165,250,0.4); transform: rotate(90deg); }
            #oc-reminder-dialog h3 {
                margin: 0 0 10px 0; color: rgb(147,197,253); font-size: 18px; font-weight: 600;
                text-align: center; padding-right: 20px;
            }
            #oc-reminder-dialog p { margin: 8px 0 4px; color: #dbeafe; font-size: 14px; text-align: center; }
            #oc-reminder-dialog .dialog-buttons { display: flex; gap: 8px; margin-top: 16px; }
            #oc-reminder-dialog .btn-join,
            #oc-reminder-dialog .btn-dismiss {
                flex: 1; padding: 10px 8px; border: none; border-radius: 8px;
                font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;
                text-align: center; text-decoration: none; display: inline-block; box-sizing: border-box;
            }
            #oc-reminder-dialog .btn-join {
                background: linear-gradient(135deg, rgb(96,165,250) 0%, rgb(37,99,235) 100%); color: white;
            }
            #oc-reminder-dialog .btn-join:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(96,165,250,0.4); }
            #oc-reminder-dialog .btn-dismiss {
                background: rgba(255,255,255,0.06); color: #dbeafe; border: 1px solid rgba(255,255,255,0.15);
            }
            #oc-reminder-dialog .btn-dismiss:hover { background: rgba(255,255,255,0.14); }
        `);

    // Position: bottom-centre on PDA, top-left on desktop (matches cash monitor).
    if (IS_PDA) {
        GM_addStyle('#oc-reminder-dialog { bottom: 20px; left: 50%; transform: translateX(-50%); }');
    } else {
        GM_addStyle('#oc-reminder-dialog { top: 20px; left: 20px; }');
    }

    // ── Start ────────────────────────────────────────────────────────
    evaluate();
    checkTimer = setInterval(evaluate, TICK_MS);

    window.addEventListener('beforeunload', () => {
        if (checkTimer) clearInterval(checkTimer);
    });
}
});
