import { API_BASE, tornAuth } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import { UI } from '../../core/ui.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// ATTACK ENHANCER
// ════════════════════════════════════════════════════════════════════════

registerModule('attack-enhancer', {
name: 'Attack Enhancer',
version: '1.2',
description: 'Attack page enhancer: Custom button positioning, execute % alert, mobile HUD (temp effects, attackers), current hospital time. Profile Page: Allows clicking attack when in hospital. Faction War page: Adds online status overview.',
pages: ['/loader.php', '/loader2.php', '/page.php?sid=attack', '/factions.php', '/profiles.php', '/city.php'],
guide,

init() {

     'use strict';

    // ── Hospital timers toggle ───────────────────────────────────────
    // GM storage (not localStorage) so the setting saved on the settings
    // page (city.php) is the same one the war page (factions.php) reads.
    const HT_ENABLED_KEY = 'dss_ae_hosp_timers';
    const htEnabled = () => GM_getValue(HT_ENABLED_KEY, true) !== false;

    UI.wireGuideField('dss-ae-hosp-timers', () => {
        const cb = document.getElementById('dss-ae-hosp-timers');
        if (!cb || cb.dataset.wired) return;
        cb.dataset.wired = '1';
        cb.checked = htEnabled();
        cb.addEventListener('change', () => {
            GM_setValue(HT_ENABLED_KEY, cb.checked);
            const s = document.getElementById('dss-ae-hosp-timers-status');
            if (s) s.textContent = cb.checked ? '\u2705 Hospital timers on' : '\u2705 Hospital timers off';
        });
    });


// ═════════════════════════════════════════════════════════════════════════
// HASH-RESILIENT SELECTOR HELPERS
// Torn uses CSS-modules with rotating hashes (e.g. className___Abc1D).
// Instead of hardcoding the hash we match the stable prefix.
// ═════════════════════════════════════════════════════════════════════════

/** Build a CSS attribute selector for a Torn CSS-module class. */
const cls = (base) => `[class*="${base}___"]`;

/** querySelector shorthand using a Torn class base name. */
const qc = (base, root = document) => root.querySelector(cls(base));

/** querySelectorAll shorthand. */
const qca = (base, root = document) => [...root.querySelectorAll(cls(base))];

// ═════════════════════════════════════════════════════════════════════════
// PAGE DETECTION
// ═════════════════════════════════════════════════════════════════════════

const url = window.location.href;
const isAttackPage = /loader2?\.php\?sid=(attack|getInAttack)/.test(url)
                   || /page\.php\?sid=attack/.test(url);
const isFactionPage = url.includes('factions.php');
const isMobile = () => window.innerWidth < 700;

// ═════════════════════════════════════════════════════════════════════════
// FOCUS GATING
// Per Torn rules: scripts must only read data / generate alerts when
// the page tab is actively focused.
// ═════════════════════════════════════════════════════════════════════════

    let isTabFocused = document.hasFocus();
    const setFocus = (v) => { isTabFocused = v; };
    window.addEventListener('focus', () => setFocus(true));
    window.addEventListener('blur', () => setFocus(false));
    document.addEventListener('visibilitychange', () => {
        setFocus(document.visibilityState === 'visible' && document.hasFocus());
    });

// ═════════════════════════════════════════════════════════════════════════
// WARLINE — ONLINE COUNTER  (faction war page only)
// ═════════════════════════════════════════════════════════════════════════

if (isFactionPage) {
    const STATUS_WRAP_ID = 'tc-online-status-wrap';
    const STATUS_BAR_ID = 'tc-online-status-bar';

    const isOnWarPage = () =>
    new URLSearchParams(window.location.search).get('step') === 'your' &&
          window.location.hash.includes('/war/');

    let warStatusVisible = localStorage.getItem('tc-war-status-visible') !== 'false';

    // Mobilisation alert config
    let mobThreshold = Number(localStorage.getItem('tc-mob-threshold')) || 40;
    let mobAlertEnabled = localStorage.getItem('tc-mob-alert-enabled') !== 'false';
    let mobAlertDismissed = false;
    let mobCooldownUntil = 0;
    let mobCooldownMins = Number(localStorage.getItem('tc-mob-cooldown-mins')) || 10;
    const getMobCooldownMs = () => mobCooldownMins * 60 * 1000;

    // Focus teardown: dismiss the mobilisation alert if the tab loses focus,
    // so it can't draw attention from an unfocused window.
    window.addEventListener('blur', closeMobAlert);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !document.hasFocus()) closeMobAlert();
    });

    // Inject styles for the war status bar + mobilisation alert
    GM_addStyle(`
            #tc-online-status-wrap {
                width: 100%;
                box-sizing: border-box;
                font-family: Arial, Helvetica, sans-serif;
                background: linear-gradient(180deg, rgba(30,32,34,0.95) 0%, rgba(24,26,28,0.95) 100%);
                border-bottom: 1px solid rgba(255,255,255,0.05);
                border-top: 1px solid rgba(255,255,255,0.03);
            }
            #tc-status-header {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 4px 12px;
                cursor: pointer;
                user-select: none;
                border-bottom: 1px solid rgba(255,255,255,0.04);
                transition: background 0.15s;
            }
            #tc-status-header:hover {
                background: rgba(255,255,255,0.03);
            }
            #tc-status-header-label {
                color: #888;
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                font-weight: 600;
            }
            #tc-status-header-arrow {
                color: #555;
                font-size: 8px;
                transition: transform 0.2s;
            }
            #tc-status-header-arrow.collapsed {
                transform: rotate(-90deg);
            }

            /* Alert config section */
            #tc-mob-config-row {
                border-top: 1px solid rgba(255,255,255,0.04);
                overflow: hidden;
                transition: max-height 0.25s ease, opacity 0.2s ease, padding 0.25s ease;
            }
            #tc-mob-config-row.tc-expanded {
                max-height: 80px;
                opacity: 1;
            }
            #tc-mob-config-row.tc-collapsed {
                max-height: 0;
                opacity: 0;
            }
            .tc-mob-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 5px 12px;
                width: 100%;
                box-sizing: border-box;
            }
            .tc-mob-prefix {
                display: flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
            }
            .tc-mob-settings {
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 8px;
                flex: 1;
                flex-wrap: wrap;
            }
            .tc-mob-settings-row {
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
            }
            .tc-mob-group {
                display: flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
            }
            .tc-mob-vdivider {
                display: block;
                width: 1px;
                height: 14px;
                background: rgba(255,255,255,0.15);
                flex-shrink: 0;
                margin: 0 2px;
            }
            .tc-mob-config-label {
                color: #666;
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.06em;
                font-weight: 600;
            }
            #tc-mob-toggle {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                border-radius: 3px;
                border: 1px solid rgba(255,255,255,0.12);
                background: rgba(255,255,255,0.04);
                cursor: pointer;
                font-size: 10px;
                font-family: inherit;
                color: #777;
                transition: all 0.15s;
                line-height: 1.4;
            }
            #tc-mob-toggle:hover {
                background: rgba(255,255,255,0.08);
                color: #aaa;
            }
            #tc-mob-toggle.active {
                background: rgba(239,68,68,0.15);
                border-color: rgba(239,68,68,0.4);
                color: #ef4444;
            }
            #tc-mob-input, .tc-mob-cd-input {
                width: 36px;
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 3px;
                color: #aaa;
                font-size: 11px;
                font-family: inherit;
                padding: 2px 4px;
                text-align: center;
                transition: border-color 0.15s, color 0.15s;
            }
            #tc-mob-input:focus, .tc-mob-cd-input:focus {
                outline: none;
                border-color: rgba(239,68,68,0.5);
                color: #ef4444;
            }
            .tc-mob-pct-label {
                color: #555;
                font-size: 10px;
            }

            #tc-online-status-bar {
                display: flex;
                width: 100%;
                box-sizing: border-box;
                overflow: hidden;
                transition: max-height 0.25s ease, opacity 0.2s ease, padding 0.25s ease;
            }
            #tc-online-status-bar.tc-expanded {
                max-height: 40px;
                opacity: 1;
            }
            #tc-online-status-bar.tc-collapsed {
                max-height: 0;
                opacity: 0;
                padding-top: 0;
                padding-bottom: 0;
            }
            #tc-online-status-wrap #tc-online-status-bar .tc-status-side {
                flex: 1 1 0 !important;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 5px 12px;
                position: relative;
            }
            .tc-status-side:first-child {
                border-right: 1px solid rgba(255,255,255,0.06);
            }
            .tc-sort-btn {
                position: absolute;
                right: 8px;
                top: 50%;
                transform: translateY(-50%);
                padding: 1px 6px;
                border-radius: 3px;
                border: 1px solid rgba(255,255,255,0.1);
                background: rgba(255,255,255,0.04);
                color: #666;
                font-size: 9px;
                font-family: inherit;
                cursor: pointer;
                transition: all 0.15s;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                white-space: nowrap;
                line-height: 1.4;
            }
            .tc-sort-btn:hover {
                background: rgba(255,255,255,0.08);
                color: #aaa;
            }
            .tc-sort-btn.tc-sort-active {
                background: rgba(80,180,80,0.2);
                border-color: rgba(80,180,80,0.5);
                color: #7ccc7c;
            }
            .tc-stat {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-size: 11px;
                line-height: 1;
            }
            .tc-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                display: inline-block;
                flex-shrink: 0;
            }
            .tc-dot-on   { background: #5cdb5c; box-shadow: 0 0 4px rgba(92,219,92,0.4); }
            .tc-dot-idle { background: #e8c84a; box-shadow: 0 0 4px rgba(232,200,74,0.3); }
            .tc-dot-off  { background: #555; }
            .tc-stat-num {
                font-weight: 700;
                font-size: 12px;
            }
            .tc-stat-num-on   { color: #5cdb5c; }
            .tc-stat-num-idle { color: #e8c84a; }
            .tc-stat-num-off  { color: #666; }
            .tc-stat-sep {
                color: rgba(255,255,255,0.12);
                font-size: 10px;
                margin: 0 5px;
            }

            /* ── Mobile fixes for status bar ── */
            @media (max-width: 699px) {
                .tc-stat-sep { margin: 0 2px; }
                .tc-stat-num { font-size: 11px; }
                .tc-stat { gap: 2px; font-size: 10px; }

                /* Stack sort button below the counts */
                .tc-status-side {
                    flex-direction: column;
                    gap: 3px;
                    padding: 4px 8px;
                }
                .tc-sort-btn {
                    position: static;
                    transform: none;
                    font-size: 9px;
                    padding: 1px 8px;
                    width: auto;
                    align-self: center;
                }

                /* Mob config: two-column on mobile.
                   Left = label, right = column: [toggle+threshold] / [cooldown] */
                #tc-mob-config-row.tc-expanded { max-height: 60px; }

                .tc-mob-row {
                    padding: 5px 10px;
                    gap: 8px;
                    align-items: center;
                }

                .tc-mob-settings {
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 4px;
                    flex-wrap: nowrap;
                }

                /* Hide dividers inside settings rows on mobile */
                .tc-mob-settings-row .tc-mob-vdivider-inner { display: none; }

                .tc-mob-settings-row { gap: 6px; }

                #tc-mob-toggle { font-size: 9px; padding: 2px 7px; }
                #tc-mob-input, .tc-mob-cd-input { width: 34px; font-size: 10px; padding: 2px 3px; }
                .tc-mob-pct-label { font-size: 9px; }
                .tc-mob-config-label { font-size: 9px; }
            }

            /* ── Mobilisation dialog ── */
            @keyframes tc-mob-slide-in {
                from { transform: translateX(-100%) scale(0.95); opacity: 0; }
                to   { transform: translateX(0) scale(1); opacity: 1; }
            }
            @keyframes tc-mob-pulse-border {
                0%, 100% { border-color: rgba(239,68,68,0.7); box-shadow: 0 8px 40px rgba(239,68,68,0.25), 0 0 60px rgba(239,68,68,0.1); }
                50%      { border-color: rgba(239,68,68,1);   box-shadow: 0 8px 40px rgba(239,68,68,0.45), 0 0 80px rgba(239,68,68,0.2); }
            }
            #tc-mob-dialog {
                position: fixed;
                bottom: 20px;
                left: 20px;
                z-index: 999999;
                animation: tc-mob-slide-in 0.35s ease-out;
            }
            #tc-mob-dialog .tc-mob-content {
                background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
                border: 2px solid rgba(239,68,68,0.7);
                border-radius: 12px;
                padding: 20px 24px;
                width: 320px;
                animation: tc-mob-pulse-border 2s ease-in-out infinite;
                position: relative;
            }
            #tc-mob-dialog .tc-mob-close {
                position: absolute;
                top: 8px; right: 8px;
                background: rgba(239,68,68,0.15);
                border: 1px solid rgba(239,68,68,0.3);
                color: #ef4444;
                width: 24px; height: 24px;
                border-radius: 50%;
                font-size: 16px; line-height: 1;
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                padding: 0;
                transition: all 0.2s;
            }
            #tc-mob-dialog .tc-mob-close:hover {
                background: rgba(239,68,68,0.35);
                transform: rotate(90deg);
            }
            #tc-mob-dialog .tc-mob-icon {
                font-size: 28px;
                text-align: center;
                margin-bottom: 8px;
            }
            #tc-mob-dialog .tc-mob-title {
                color: #ef4444;
                font-size: 16px;
                font-weight: 700;
                text-align: center;
                margin: 0 0 6px 0;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            #tc-mob-dialog .tc-mob-desc {
                color: #d1d5db;
                font-size: 13px;
                text-align: center;
                margin: 0 0 12px 0;
                line-height: 1.4;
            }
            #tc-mob-dialog .tc-mob-stat {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 8px 12px;
                background: rgba(239,68,68,0.08);
                border: 1px solid rgba(239,68,68,0.15);
                border-radius: 8px;
                margin-bottom: 14px;
            }
            #tc-mob-dialog .tc-mob-stat-pct {
                font-size: 22px;
                font-weight: 800;
                color: #ef4444;
            }
            #tc-mob-dialog .tc-mob-stat-label {
                font-size: 11px;
                color: #9ca3af;
                text-align: left;
                line-height: 1.3;
            }
            #tc-mob-dialog .tc-mob-btn {
                display: block;
                width: 100%;
                padding: 9px 16px;
                border: none;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                text-align: center;
                transition: all 0.2s;
                background: linear-gradient(135deg, #374151 0%, #1f2937 100%);
                color: #d1d5db;
            }
            #tc-mob-dialog .tc-mob-btn:hover {
                background: linear-gradient(135deg, #4b5563 0%, #374151 100%);
                transform: translateY(-1px);
            }
        `);

    function formatCountHTML(counts) {
        let html = '';
        html += `<span class="tc-stat"><span class="tc-dot tc-dot-on"></span><span class="tc-stat-num tc-stat-num-on">${counts.online}</span></span>`;
        if (counts.idle) {
            html += `<span class="tc-stat-sep">/</span>`;
            html += `<span class="tc-stat"><span class="tc-dot tc-dot-idle"></span><span class="tc-stat-num tc-stat-num-idle">${counts.idle}</span></span>`;
        }
        if (counts.offline) {
            html += `<span class="tc-stat-sep">/</span>`;
            html += `<span class="tc-stat"><span class="tc-dot tc-dot-off"></span><span class="tc-stat-num tc-stat-num-off">${counts.offline}</span></span>`;
        }
        return html;
    }

    function findTabMenuForSide(side) {
        for (const tm of document.querySelectorAll('.tab-menu-cont')) {
            if ((' ' + tm.className + ' ').includes(' ' + side + ' ')) return tm;
        }
        return null;
    }

    function countStatusesInContainer(container) {
        if (!container) return { online: 0, idle: 0, offline: 0 };
        let online = 0, idle = 0, offline = 0;
        container.querySelectorAll('[class*="userStatusWrap___"][aria-label]').forEach(el => {
            const label = (el.getAttribute('aria-label') || '').toLowerCase();
            if (label.endsWith('is online')) online++;
            else if (label.endsWith('is idle')) idle++;
            else if (label.endsWith('is offline')) offline++;
        });
        return { online, idle, offline };
    }

    // ── Mobilisation alert ───────────────────────────────────────────────
    function showMobAlert(pct, counts) {
        if (!isTabFocused) return; // Focus gate: don't show alerts on unfocused tabs
        if (document.getElementById('tc-mob-dialog')) return;
        const dialog = document.createElement('div');
        dialog.id = 'tc-mob-dialog';
        dialog.innerHTML = `
                <div class="tc-mob-content">
                    <button class="tc-mob-close">\u00D7</button>
                    <div class="tc-mob-icon">\u26A0\uFE0F</div>
                    <div class="tc-mob-title">Enemy Mobilising</div>
                    <div class="tc-mob-desc">Possible push incoming!<br>Enemy online presence has exceeded your alert threshold.</div>
                    <div class="tc-mob-stat">
                        <span class="tc-mob-stat-pct">${pct}%</span>
                        <span class="tc-mob-stat-label">online<br>(${counts.online} of ${counts.online + counts.idle + counts.offline})</span>
                    </div>
                    <button class="tc-mob-btn">Dismiss</button>
                </div>`;
        document.body.appendChild(dialog);

        const dismiss = () => {
            dialog.remove();
            mobAlertDismissed = true;
            mobCooldownUntil = Date.now() + getMobCooldownMs();
        };
        dialog.querySelector('.tc-mob-close').addEventListener('click', dismiss);
        dialog.querySelector('.tc-mob-btn').addEventListener('click', dismiss);
    }

    function closeMobAlert() {
        const d = document.getElementById('tc-mob-dialog');
        if (d) d.remove();
    }

    function checkMobilisation(leftCounts) {
        if (!mobAlertEnabled) { closeMobAlert(); return; }
        const total = leftCounts.online + leftCounts.idle + leftCounts.offline;
        if (total === 0) return;
        const pct = Math.round((leftCounts.online / total) * 100);

        if (pct >= mobThreshold) {
            // Only show if not on cooldown
            if (!mobAlertDismissed || Date.now() > mobCooldownUntil) {
                mobAlertDismissed = false;
                showMobAlert(pct, leftCounts);
            }
            // Update live stats if dialog is open
            const statPct = document.querySelector('#tc-mob-dialog .tc-mob-stat-pct');
            const statLabel = document.querySelector('#tc-mob-dialog .tc-mob-stat-label');
            if (statPct) statPct.textContent = pct + '%';
            if (statLabel) statLabel.innerHTML = `online<br>(${leftCounts.online} of ${total})`;
        } else {
            closeMobAlert();
            // Only reset if the cooldown has already expired
            if (Date.now() > mobCooldownUntil) {
                mobAlertDismissed = false;
            }
        }
    }

    // ── Toggle / UI ──────────────────────────────────────────────────────
    function toggleStatusBar() {
        warStatusVisible = !warStatusVisible;
        localStorage.setItem('tc-war-status-visible', warStatusVisible);
        const bar = document.getElementById(STATUS_BAR_ID);
        const arrow = document.getElementById('tc-status-header-arrow');
        const configRow = document.getElementById('tc-mob-config-row');
        const cls = warStatusVisible ? 'tc-expanded' : 'tc-collapsed';
        if (bar) bar.className = cls;
        if (configRow) configRow.className = cls;
        if (arrow) arrow.classList.toggle('collapsed', !warStatusVisible);
    }

    // ── Member list sorting ──────────────────────────────────────────────
    const sortState = {
        left:  localStorage.getItem('tc-sort-left') === 'true',
        right: localStorage.getItem('tc-sort-right') === 'true',
    };
    // Store original order so we can revert
    const originalOrder = { left: null, right: null };

            // Status-header sort (per side), persisted like the online Sort button
    const statusSort = {
        left:  localStorage.getItem('tc-status-sort-left') === 'true',
        right: localStorage.getItem('tc-status-sort-right') === 'true',
    };

    // 0 = Okay, 1 = Hospital, 2 = anything else (reads Torn's text, not our timer)
    function statusRank(row) {
        const t = statusTextOf(htStatusCell(row)).toLowerCase();
        if (t === 'okay') return 0;
        if (t.includes('hospital')) return 1;
        return 2;
    }

    function statusCompare(a, b) {
        const ra = statusRank(a), rb = statusRank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 1) {
            const au = hospUntil.get(htRowId(a) || '') || Infinity;
            const bu = hospUntil.get(htRowId(b) || '') || Infinity;
            return au - bu;
        }
        return 0; // stable sort keeps Torn's order within Okay / other
    }

    function onlineCompare(a, b) {
        const aOnline = getOnlinePriority(getRowOnlineState(a));
        const bOnline = getOnlinePriority(getRowOnlineState(b));
        if (aOnline !== bOnline) return aOnline - bOnline;
        const aStatus = getStatusPriority(statusTextOf(htStatusCell(a)));
        const bStatus = getStatusPriority(statusTextOf(htStatusCell(b)));
        if (aStatus !== bStatus) return aStatus - bStatus;
        if (aStatus === 3) {
            const au = hospUntil.get(htRowId(a) || '') || Infinity;
            const bu = hospUntil.get(htRowId(b) || '') || Infinity;
            return au - bu;
        }
        return 0;
    }

    function statusHeaderFor(side) {
        return findTabMenuForSide(side)?.querySelector('.white-grad .status') || null;
    }

    function markStatusHeaders() {
        ['left', 'right'].forEach(side => {
            statusHeaderFor(side)?.classList.toggle('dss-status-sorted', !!statusSort[side]);
        });
    }

    function syncSortBtn(side) {
        const btn = document.querySelector(`#tc-status-${side} .tc-sort-btn`);
        if (!btn) return;
        btn.classList.toggle('tc-sort-active', !!sortState[side]);
        btn.textContent = sortState[side] ? '\u2714 Sorted' : 'Sort';
    }

    // Capture on document runs before React's root listener; stopping it here
    // means Torn's own status sort never fires and ours takes over.
    document.addEventListener('click', (e) => {
        if (!isOnWarPage()) return;
        const hdr = e.target.closest('.tab-menu-cont .white-grad .status');
        if (!hdr) return;
        const tm = hdr.closest('.tab-menu-cont');
        const side = tm.classList.contains('left') ? 'left'
                   : tm.classList.contains('right') ? 'right' : null;
        if (!side) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        statusSort[side] = !statusSort[side];
        localStorage.setItem(`tc-status-sort-${side}`, statusSort[side]);
        // One sort mode per side: header sort switches the online Sort button off
        if (statusSort[side] && sortState[side]) {
            sortState[side] = false;
            localStorage.setItem(`tc-sort-${side}`, false);
            syncSortBtn(side);
        }
        markStatusHeaders();
        sortMemberList(side);
    }, true);

    GM_addStyle(`
            .white-grad .status.dss-status-sorted { color: #7ccc7c !important; }
            .white-grad .status.dss-status-sorted [class*="sortIcon"] { display: none !important; }
            .white-grad .status.dss-status-sorted::after { content: ' \u25B2'; font-size: 9px; }
        `);


    function getRowOnlineState(row) {
        const el = row.querySelector('[class*="userStatusWrap___"][aria-label]');
        const label = (el?.getAttribute('aria-label') || '').toLowerCase();
        if (label.endsWith('is online')) return 'online';
        if (label.endsWith('is idle')) return 'idle';
        if (label.endsWith('is offline')) return 'offline';
        return '';
    }

    function getOnlinePriority(alt) {
        if (alt === 'online') return 0;
        if (alt === 'idle') return 1;
        return 2;
    }

    function getStatusPriority(text) {
        const t = (text || '').toLowerCase().trim();
        if (t === 'okay') return 0;
        if (t === 'abroad') return 1;
        if (t.includes('traveling') || t.includes('travelling')) return 2;
        if (t === 'hospital') return 3;
        if (t === 'jail') return 4;
        if (t === 'federal') return 5;
        return 6;
    }

    function sortMemberList(side) {
        const menu = findTabMenuForSide(side);
        if (!menu) return;
        const ul = menu.querySelector('ul.members-list');
        if (!ul) return;

        const lis = [...ul.children];
        if (lis.length === 0) return;

        // Re-capture baseline if Torn changed the member count
        if (!originalOrder[side] || originalOrder[side].length !== lis.length) {
            originalOrder[side] = lis.map(li => li);
        }

        const compare = statusSort[side] ? statusCompare
                      : sortState[side]  ? onlineCompare
                      : null;

        if (compare) {
            lis.sort(compare);
            // Only touch the DOM if the order actually changed
            if (lis.some((li, i) => ul.children[i] !== li)) lis.forEach(li => ul.appendChild(li));
        } else if (originalOrder[side]) {
            originalOrder[side].forEach(li => ul.appendChild(li));
        }
    }


    function toggleSort(side, btn) {
        sortState[side] = !sortState[side];
        localStorage.setItem(`tc-sort-${side}`, sortState[side]);
        if (sortState[side] && statusSort[side]) {
            statusSort[side] = false;
            localStorage.setItem(`tc-status-sort-${side}`, false);
            markStatusHeaders();
        }

        btn.classList.toggle('tc-sort-active', sortState[side]);
        btn.textContent = sortState[side] ? '\u2714 Sorted' : 'Sort';
        sortMemberList(side);
    }

    // Re-apply sort when the DOM updates (Torn may re-render lists)
    function reapplySort() {
        ['left', 'right'].forEach(side => {
            if (sortState[side] || statusSort[side]) sortMemberList(side);
        });
        markStatusHeaders(); // React re-renders the header row
    }


    function createStatusBar() {
        if (document.getElementById(STATUS_WRAP_ID)) return;
        if (!isOnWarPage()) return;
        const factionNames = document.querySelector('.faction-names');
        if (!factionNames) return;

        // Outer wrapper
        const wrap = document.createElement('div');
        wrap.id = STATUS_WRAP_ID;

        // Clickable header
        const header = document.createElement('div');
        header.id = 'tc-status-header';
        header.innerHTML = `<span id="tc-status-header-arrow" class="${warStatusVisible ? '' : 'collapsed'}">\u25BC</span><span id="tc-status-header-label">Online Status</span>`;
        header.addEventListener('click', toggleStatusBar);
        wrap.appendChild(header);

        // Counts row
        const bar = document.createElement('div');
        bar.id = STATUS_BAR_ID;
        bar.className = warStatusVisible ? 'tc-expanded' : 'tc-collapsed';

        const leftDiv = document.createElement('div');
        leftDiv.id = 'tc-status-left';
        leftDiv.className = 'tc-status-side';
        const leftCounts = document.createElement('span');
        leftCounts.id = 'tc-counts-left';
        leftDiv.appendChild(leftCounts);
        const leftSortBtn = document.createElement('button');
        leftSortBtn.className = 'tc-sort-btn' + (sortState.left ? ' tc-sort-active' : '');
        leftSortBtn.textContent = sortState.left ? '\u2714 Sorted' : 'Sort';
        leftSortBtn.title = 'Sort by online + okay status';
        leftSortBtn.addEventListener('click', () => toggleSort('left', leftSortBtn));
        leftDiv.appendChild(leftSortBtn);

        const rightDiv = document.createElement('div');
        rightDiv.id = 'tc-status-right';
        rightDiv.className = 'tc-status-side';
        const rightCounts = document.createElement('span');
        rightCounts.id = 'tc-counts-right';
        rightDiv.appendChild(rightCounts);
        const rightSortBtn = document.createElement('button');
        rightSortBtn.className = 'tc-sort-btn' + (sortState.right ? ' tc-sort-active' : '');
        rightSortBtn.textContent = sortState.right ? '\u2714 Sorted' : 'Sort';
        rightSortBtn.title = 'Sort by online + okay status';
        rightSortBtn.addEventListener('click', () => toggleSort('right', rightSortBtn));
        rightDiv.appendChild(rightSortBtn);

        bar.appendChild(leftDiv);
        bar.appendChild(rightDiv);
        wrap.appendChild(bar);

        // Alert config section (below counts, also collapsible)
        const configWrap = document.createElement('div');
        configWrap.id = 'tc-mob-config-row';
        configWrap.className = warStatusVisible ? 'tc-expanded' : 'tc-collapsed';

        const mobRow1 = document.createElement('div');
        mobRow1.className = 'tc-mob-row';

        // Label
        const mobLabel = document.createElement('span');
        mobLabel.className = 'tc-mob-config-label';
        mobLabel.textContent = 'Mobilisation Alert';
        mobRow1.appendChild(mobLabel);

        // Divider
        mobRow1.appendChild(Object.assign(document.createElement('div'), { className: 'tc-mob-vdivider' }));

        // Settings container.
        const mobSettings = document.createElement('div');
        mobSettings.className = 'tc-mob-settings';
        mobSettings.style.setProperty('flex', '1', 'important');

        // Row 1: toggle + threshold
        const settingsRow1 = document.createElement('div');
        settingsRow1.className = 'tc-mob-settings-row';

        // On/Off toggle — lives inside settingsRow1
        const mobToggle = document.createElement('button');
        mobToggle.id = 'tc-mob-toggle';
        mobToggle.className = mobAlertEnabled ? 'active' : '';
        mobToggle.innerHTML = mobAlertEnabled
            ? '\u25CF<span style="margin-left:2px">On</span>'
            : '\u25CB<span style="margin-left:2px">Off</span>';
        mobToggle.title = 'Toggle mobilisation alert';
        mobToggle.addEventListener('click', () => {
            mobAlertEnabled = !mobAlertEnabled;
            localStorage.setItem('tc-mob-alert-enabled', mobAlertEnabled);
            mobToggle.className = mobAlertEnabled ? 'active' : '';
            mobToggle.innerHTML = mobAlertEnabled
                ? '\u25CF<span style="margin-left:2px">On</span>'
                : '\u25CB<span style="margin-left:2px">Off</span>';
            if (!mobAlertEnabled) closeMobAlert();
        });
        settingsRow1.appendChild(mobToggle);

        // Divider between toggle and threshold (hidden on mobile)
        settingsRow1.appendChild(Object.assign(document.createElement('div'), { className: 'tc-mob-vdivider tc-mob-vdivider-inner' }));

        // Threshold group
        const threshGroup = document.createElement('div');
        threshGroup.className = 'tc-mob-group';
        threshGroup.innerHTML = '<span class="tc-mob-config-label">Threshold</span>';
        const mobInput = document.createElement('input');
        mobInput.id = 'tc-mob-input';
        mobInput.type = 'number';
        mobInput.min = '1';
        mobInput.max = '100';
        mobInput.value = mobThreshold;
        mobInput.title = 'Enemy online % threshold for mobilisation alert';
        mobInput.addEventListener('change', () => {
            const v = Math.min(100, Math.max(1, Number(mobInput.value)));
            mobInput.value = v;
            mobThreshold = v;
            localStorage.setItem('tc-mob-threshold', v);
        });
        mobInput.addEventListener('keydown', e => e.stopPropagation());
        threshGroup.appendChild(mobInput);
        threshGroup.appendChild(Object.assign(document.createElement('span'), { className: 'tc-mob-pct-label', textContent: '%' }));
        settingsRow1.appendChild(threshGroup);
        mobSettings.appendChild(settingsRow1);

        // Row 2 wrapper (cooldown — sits beside threshold on desktop, below on mobile)
        const settingsRow2 = document.createElement('div');
        settingsRow2.className = 'tc-mob-settings-row';

        // Divider between threshold and cooldown (desktop only)
        settingsRow2.appendChild(Object.assign(document.createElement('div'), { className: 'tc-mob-vdivider tc-mob-vdivider-inner' }));

        // Cooldown group
        const cdGroup = document.createElement('div');
        cdGroup.className = 'tc-mob-group';
        cdGroup.innerHTML = '<span class="tc-mob-config-label">Cooldown</span>';
        const cdInput = document.createElement('input');
        cdInput.id = 'tc-mob-cd-input';
        cdInput.className = 'tc-mob-cd-input';
        cdInput.type = 'number';
        cdInput.min = '1';
        cdInput.max = '120';
        cdInput.value = mobCooldownMins;
        cdInput.title = 'Minutes before the alert can trigger again after dismissing';
        cdInput.addEventListener('change', () => {
            const v = Math.min(120, Math.max(1, Number(cdInput.value)));
            cdInput.value = v;
            mobCooldownMins = v;
            localStorage.setItem('tc-mob-cooldown-mins', v);
        });
        cdInput.addEventListener('keydown', e => e.stopPropagation());
        cdGroup.appendChild(cdInput);
        cdGroup.appendChild(Object.assign(document.createElement('span'), { className: 'tc-mob-pct-label', textContent: 'min' }));
        settingsRow2.appendChild(cdGroup);
        mobSettings.appendChild(settingsRow2);

        mobRow1.appendChild(mobSettings);
        configWrap.appendChild(mobRow1);
        wrap.appendChild(configWrap);

        factionNames.parentNode.insertBefore(wrap, factionNames.nextSibling);
    }

    const lastCounts = { left: null, right: null };

    function updateStatusBar() {
        if (!isTabFocused || !isOnWarPage()) return;
        createStatusBar();
        let leftCounts = null;
        ['left', 'right'].forEach(side => {
            const menu = findTabMenuForSide(side);
            const list = menu ? (menu.querySelector('ul.members-list') || menu) : null;
            const counts = countStatusesInContainer(list);
            if (side === 'left') leftCounts = counts;
            // Update the counts span, not the whole side div (which also contains the sort button)
            const el = document.getElementById(side === 'left' ? 'tc-counts-left' : 'tc-counts-right');
            if (!el) return;
            const prev = lastCounts[side];
            if (prev && prev.online === counts.online && prev.idle === counts.idle && prev.offline === counts.offline) return;
            el.innerHTML = formatCountHTML(counts);
            el.parentElement.title = `${counts.online} online, ${counts.idle} idle, ${counts.offline} offline`;
            lastCounts[side] = { ...counts };
        });
        // Check mobilisation after counts are updated
        if (leftCounts) checkMobilisation(leftCounts);
        // Re-apply sort if active (Torn may re-render lists)
        reapplySort();
    }

            // ── Hospital timers ──────────────────────────────────────────────────
    const HT_REFRESH_MS = 30000;   // normal refresh while anyone is in hospital
    const HT_MIN_GAP_MS = 10000;   // floor for early refreshes
    const hospUntil = new Map();   // playerId (string) -> hospital release (unix s)
    let htFactionIds = null;       // [factionId, ...] for this war
    let htLastFetch = 0;
    let htFetching = false;

    GM_addStyle(`
            div.status.dss-ht-on { font-size: 0 !important; }
            div.status.dss-ht-on > .dss-ht {
               font-size: 10.5px; font-weight: 600; color: #f44336;
               font-variant-numeric: tabular-nums; letter-spacing: 0.3px;
            }
            div.status.dss-ht-on > .dss-ht.dss-ht-soon { color: #4caf50; }
            @media (max-width: 699px) {
                div.status.dss-ht-on > .dss-ht { font-size: 9.5px; }
            }
        `);

    function htStatusCell(row) {
        return row.querySelector('div.status[class*="status___"]') || row.querySelector('div.status');
    }

    function htRowId(row) {
        const m = (row.querySelector('a[href*="XID="]')?.getAttribute('href') || '').match(/XID=(\d+)/);
        return m ? m[1] : null;
    }

    // Torn's text only — skips our timer span so sorting / detection stay correct.
    function statusTextOf(cell) {
        if (!cell) return '';
        let t = '';
        cell.childNodes.forEach(n => {
            if (n.nodeType === 1 && n.classList.contains('dss-ht')) return;
            t += n.textContent;
        });
        return t.trim();
    }

    function htFormat(secs) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
    }

    async function htResolveFactions(key) {
        if (htFactionIds) return htFactionIds;
        const ids = new Set();
        // 1) The current war from the API (gives both sides in one call)
        try {
            const res = await fetch(`${API_BASE}/faction/wars`, { headers: tornAuth(key) });
            const data = await res.json();
            const wars = data?.wars || {};
            ['ranked', 'raids', 'territory'].forEach(k => {
                const w = wars[k];
                const list = Array.isArray(w) ? w : (w ? [w] : []);
                list.forEach(x => (x?.factions || []).forEach(f => { if (f?.id) ids.add(String(f.id)); }));
            });
        } catch (_) { /* fall through to DOM */ }
        // 2) Fallback: faction links on the page + our own faction
        if (!ids.size) {
            document.querySelectorAll('a[href*="factions.php?step=profile"][href*="ID="]').forEach(a => {
                const m = (a.getAttribute('href') || '').match(/[?&]ID=(\d+)/);
                if (m) ids.add(m[1]);
            });
            const own = Storage.getSettings().myFactionId;
            if (own) ids.add(String(own));
        }
        if (ids.size) htFactionIds = [...ids];   // don't cache a failure
        return htFactionIds;
    }

    async function htRefresh(early) {
        if (!htEnabled()) return;
        if (!isTabFocused || !isOnWarPage()) return;
        const key = Storage.getSettings().apiKey;
        if (!key || htFetching) return;
        const now = Date.now();
        if (now - htLastFetch < (early ? HT_MIN_GAP_MS : HT_REFRESH_MS)) return;
        htFetching = true;
        htLastFetch = now;
        try {
            const ids = await htResolveFactions(key);
            if (!ids) return;
            for (const fid of ids) {
                try {
                    const res = await fetch(`${API_BASE}/faction/${fid}/members`, { headers: tornAuth(key) });
                    const data = await res.json();
                    if (data?.error) continue;
                    const list = Array.isArray(data?.members)
                        ? data.members
                        : Object.entries(data?.members || {}).map(([id, m]) => ({ id: Number(id), ...m }));
                    list.forEach(m => {
                        const st = m?.status;
                        if (st?.state === 'Hospital' && st.until) hospUntil.set(String(m.id), st.until);
                        else hospUntil.delete(String(m.id));
                    });
                } catch (_) { /* skip this side, try again next refresh */ }
            }
        } finally {
            htFetching = false;
        }
        htRender();
    }

    function htClear(cell) {
        cell.querySelector(':scope > .dss-ht')?.remove();
        cell.classList.remove('dss-ht-on');
    }

    function htRender() {
        if (!htEnabled()) {
            document.querySelectorAll('div.status.dss-ht-on').forEach(htClear);
            return;
        }
        if (!isTabFocused || !isOnWarPage()) return;
        const nowS = Date.now() / 1000;
        let anyHosp = false, needEarly = false;

        document.querySelectorAll('li.your, li.enemy').forEach(row => {
            const cell = htStatusCell(row);
            if (!cell) return;

            // Torn changed the status (revived, left, etc.) -> drop our timer
            if (!/hospital/i.test(statusTextOf(cell))) { htClear(cell); return; }
            anyHosp = true;

            const id = htRowId(row);
            const until = id ? hospUntil.get(id) : null;
            if (!until) { htClear(cell); needEarly = true; return; }   // newly hospitalised

            const rem = Math.max(0, Math.floor(until - nowS));
            if (rem === 0) needEarly = true;   // Torn still says Hospital -> maybe re-hospitalised

            let span = cell.querySelector(':scope > .dss-ht');
            if (!span) {
                span = document.createElement('span');
                span.className = 'dss-ht';
                cell.appendChild(span);
            }
            cell.classList.add('dss-ht-on');
            const txt = htFormat(rem);
            if (span.textContent !== txt) span.textContent = txt;
            span.classList.toggle('dss-ht-soon', rem <= 300);
        });

        if (needEarly) htRefresh(true);
        else if (anyHosp) htRefresh(false);
    }

    setInterval(htRender, 1000);
    window.addEventListener('hashchange', () => { htFactionIds = null; });

    // Fast starter until the bar exists (max ~40s), then one cheap poller
    let warStarter = null;
    function startWarStarter() {
        if (warStarter) clearInterval(warStarter);
        let tries = 0;
        warStarter = setInterval(() => {
            updateStatusBar();
            if (document.getElementById(STATUS_WRAP_ID) || ++tries > 80) {
                clearInterval(warStarter);
                warStarter = null;
            }
        }, 500);
    }
    startWarStarter();
    setInterval(updateStatusBar, 1500);
    window.addEventListener('hashchange', () => {
        if (isOnWarPage()) startWarStarter();
        else closeMobAlert();
    });
}

// ═════════════════════════════════════════════════════════════════════════
// ATTACK ENHANCER  (attack pages only)
// ═════════════════════════════════════════════════════════════════════════

if (!isAttackPage && !url.includes('profiles.php')) return; // Exit early if not on attack or profile page

// userID needed by both attack enhancer and APHT
const params = new URLSearchParams(window.location.search);
const userID = params.get('user2ID');

if (isAttackPage) {

    // ── Persisted settings ───────────────────────────────────────────────────
    let settingsVisible = localStorage.getItem('tae-settings-visible') !== 'false';
    let slot = Number(localStorage.getItem('torn-attack-slot')) || 1;
    let attackType = localStorage.getItem('torn-attack-type') !== null
    ? Number(localStorage.getItem('torn-attack-type')) : 1;
    let healthThreshold = localStorage.getItem('torn-health-threshold') !== null
    ? Number(localStorage.getItem('torn-health-threshold')) : 20;
    let executeEnabled = localStorage.getItem('torn-execute-enabled') === 'true';
    let slotEnabled = localStorage.getItem('torn-slot-enabled') !== 'false';

    const typeTextMap = { 1: 'leave', 2: 'mug', 3: 'hospitalize', 4: 'arrest' };

    // ── Slot element  ────────────────────────────────────────
    const SLOT_BASES = { 1: 'weapon_main', 2: 'weapon_second', 3: 'weapon_melee', 4: 'weapon_temp' };
    const getSlotElement = () => {
        const byId = document.getElementById(SLOT_BASES[slot]);
        if (byId) return byId;
        const cells = qca('weaponCell') || qca('weapon');
        return cells.length >= slot ? cells[slot - 1] : null;
    };

    if (userID) {
        const getNameFromPage = () => {
            const els = qca('userName');
            const el = els.length >= 2 ? els[1] : els[0];
            return el ? el.textContent.trim() : null;
        };
        const titleEl = document.querySelector('title');
        if (titleEl) {
            const fixTab = (node, name) => {
                node.textContent = name;
            };
            const applyTabName = () => {
                const name = getNameFromPage() || userID;
                fixTab(titleEl, name);
                const obs = new MutationObserver(mutations => {
                    mutations.forEach(m => { fixTab(m.target, name); obs.disconnect(); });
                });
                obs.observe(titleEl, { childList: true });
            };
            if (qc('userName')) {
                applyTabName();
            } else {
                const poll = setInterval(() => {
                    if (qc('userName')) { clearInterval(poll); applyTabName(); }
                }, 200);
                setTimeout(() => { clearInterval(poll); applyTabName(); }, 5000);
            }
        }
    }

    // ── Execute highlight ────────────────────────────────────────────────────
    const checkHealthPercent = () => {
        if (!isTabFocused) return; // Focus gate
        if (!executeEnabled) return;
        const bars = qca('progress');
        if (bars.length < 2) return;
        const secondaryEl = document.getElementById('weapon_second');
        if (!secondaryEl) return;
        // The progress bar has an aria-label like "Progress: 42.5%"
        const match = bars[1].getAttribute('aria-label')?.match(/Progress:\s*([\d.]+)%/);
        if (!match) return;
        const pct = parseFloat(match[1]);
        if (pct <= healthThreshold) {
            secondaryEl.style.backgroundColor = 'red';
            secondaryEl.style.border = '3px solid darkred';
            secondaryEl.style.boxShadow = '0 0 20px red';
        } else {
            secondaryEl.style.backgroundColor = '';
            secondaryEl.style.border = '';
            secondaryEl.style.boxShadow = '';
        }
    };

    let healthTimer = null;
    const startHealthWatch = () => { if (!healthTimer) healthTimer = setInterval(checkHealthPercent, 500); };
    const stopHealthWatch = () => { if (healthTimer) { clearInterval(healthTimer); healthTimer = null; } };
    if (executeEnabled) startHealthWatch();

    // ── Button positioning (hash-resilient) ──────────────────────────────────
    const getDialogButtons = () => qc('dialogButtons');

    function applyMobileBtnStyles(slotWidth) {
        if (!isMobile()) return;
        const container = getDialogButtons();
        if (!container) return;
        container.querySelectorAll('button').forEach(b => {
            b.style.setProperty('font-size','10px','important');
            b.style.setProperty('padding','2px 6px','important');
            b.style.setProperty('line-height','1.3','important');
            b.style.setProperty('min-height','0', 'important');
            b.style.setProperty('height', 'auto','important');
            b.style.setProperty('width', 'auto','important');
            b.style.setProperty('max-width', slotWidth + 'px', 'important');
        });
    }

    function resetDialogButtons() {
        const btn = getDialogButtons();
        if (!btn) return;
        btn.style.position = '';
        btn.style.top = ''; btn.style.bottom = '';
        btn.style.left = ''; btn.style.right = '';
        btn.style.width = ''; btn.style.maxWidth = '';
        btn.querySelectorAll('button').forEach(b => b.removeAttribute('style'));
    }

    function positionDialogButtons() {
        if (!slotEnabled) { resetDialogButtons(); return; }
        const btn = getDialogButtons();
        if (!btn) return;
        const posParent = btn.offsetParent;
        if (!posParent) return;
        const slotEl = getSlotElement();
        if (!slotEl) return;

        const slotRect = slotEl.getBoundingClientRect();
        const parentRect = posParent.getBoundingClientRect();

        applyMobileBtnStyles(slotRect.width);

        const btnH = btn.offsetHeight || 30;
        const slotMidY = slotRect.top + slotRect.height / 2;
        const topPx = Math.max(4, slotMidY - parentRect.top - btnH / 2);

        btn.style.position = 'absolute';
        btn.style.top = topPx + 'px';
        btn.style.bottom = 'auto';
        btn.style.right = 'auto';
        btn.style.width = 'auto';
        btn.style.maxWidth = isMobile() ? slotRect.width + 'px' : '200px';

        const slotMidX = slotRect.left + slotRect.width / 2;
        const parentLeft = parentRect.left;
        requestAnimationFrame(() => {
            const actualBtnW = btn.offsetWidth || (isMobile() ? slotRect.width : 120);
            btn.style.left = (slotMidX - parentLeft - actualBtnW / 2) + 'px';
        });
    }
    window.addEventListener('resize', positionDialogButtons);

    // ── Button visibility ────────────────────────────────────────────────────
    const applyButtonVisibility = () => {
        const container = getDialogButtons();
        if (!container) return;
        const buttons = [...container.querySelectorAll('button')];
        if (buttons.length <= 1) return;
        if (!slotEnabled || attackType === 0) {
            buttons.forEach(b => b.style.display = '');
        } else {
            const target = typeTextMap[attackType];
            const found = buttons.find(b => b.textContent.trim().toLowerCase() === target);
            buttons.forEach(b => {
                b.style.display = (!found || b.textContent.trim().toLowerCase() === target) ? '' : 'none';
            });
        }
        positionDialogButtons();
    };

    // ═════════════════════════════════════════════════════════════════════════
    // MOBILE HUD — DATA LAYER
    // ═════════════════════════════════════════════════════════════════════════

    const HUD_STORAGE_KEY = 'tm_tempEffectsUserID';
    const HUD_SLOT_MAP = { 1: 'Primary', 2: 'Secondary', 3: 'Melee', 5: 'Temp' };

    const DANGER_BONUSES = {
        parry:     { color: '#ff5252', label: 'PARRY' },
        bloodlust: { color: '#ff9800', label: 'BLOOD' },
    };

    let MY_USER_ID = parseInt(localStorage.getItem(HUD_STORAGE_KEY)) || null;
    let attackersInLoader = 0;
    let defenderWeapons = null;
    let lastEffects = [];

    // ── Deep find helper ─────────────────────────────────────────────────────
    function deepFind(obj, keyName) {
        if (!obj || typeof obj !== 'object') return undefined;
        if (keyName in obj) return obj[keyName];
        for (const key in obj) {
            const found = deepFind(obj[key], keyName);
            if (found !== undefined) return found;
        }
        return undefined;
    }

    const findCurrentTemporaryEffects = obj => deepFind(obj, 'currentTemporaryEffects');
    const findAttackerUser = obj => deepFind(obj, 'attackerUser');
    const findCurrentDefends = obj => deepFind(obj, 'currentDefends');

    // ── Weapon extraction ────────────────────────────────────────────────────
    function extractDefenderWeapons(data) {
        const defenderItems = deepFind(data, 'defenderItems');
        if (!defenderItems || typeof defenderItems !== 'object') return null;
        const result = {};
        for (const [s, label] of Object.entries(HUD_SLOT_MAP)) {
            const entry = defenderItems[s]?.item?.[0];
            if (!entry) continue;
            if (label === 'Temp') { result[label] = { name: entry.name }; continue; }
            const bonuses = entry.currentBonuses
            ? Object.values(entry.currentBonuses).map(b => ({ icon: b.icon, value: b.value }))
            : [];
            result[label] = { name: entry.name, bonuses };
        }
        return Object.keys(result).length ? result : null;
    }

    // ── Data processing ──────────────────────────────────────────────────────
    function processResponse(data) {
        if (!isTabFocused) return; // Focus gate
        if (!data || typeof data !== 'object') return;
        if (data.DB && typeof data.DB === 'object') data = data.DB;

        if (!MY_USER_ID) {
            const attackerUser = findAttackerUser(data);
            if (attackerUser?.userID) {
                MY_USER_ID = attackerUser.userID;
                localStorage.setItem(HUD_STORAGE_KEY, MY_USER_ID);
            }
        }

        const attackerUser = findAttackerUser(data);
        if (attackerUser?.userID && attackerUser.userID !== MY_USER_ID) {
            defenderWeapons = null;
        }

        const defends = findCurrentDefends(data);
        if (Array.isArray(defends)) {
            attackersInLoader = new Set(defends.map(d => d.attackerID).filter(Boolean)).size;
        }

        if (!defenderWeapons) {
            const extracted = extractDefenderWeapons(data);
            if (extracted) defenderWeapons = extracted;
        }

        if (!MY_USER_ID) return;

        const effectsObj = findCurrentTemporaryEffects(data);
        if (effectsObj !== undefined) {
            lastEffects = effectsObj?.[MY_USER_ID] || [];
        }
        updateHUDRow();
    }

    // ── Fight data interception (mobile only) ────────────────────────────────
    // Hooks install once per page; they always forward to the most recent
    // module instance, so a PDA re-inject doesn't stack wrappers or go deaf.
    const uw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    uw.__dssAttackHandler = processResponse;

    if (isMobile() && !uw.__dssAttackHooks) {
        uw.__dssAttackHooks = true;
        const handle = (d) => { try { uw.__dssAttackHandler && uw.__dssAttackHandler(d); } catch (_) { /* ignore */ } };
        const ATTACK_URL_PATTERNS = ['sid=attack', 'sid=getInAttack', 'step=fight'];

        // WebSocket hook
        const _OrigWS = uw.WebSocket;
        uw.WebSocket = function (...args) {
            const ws = new _OrigWS(...args);
            ws.addEventListener('message', e => {
                try { handle(JSON.parse(e.data)); } catch (_) { /* ignore */ }
            });
            return ws;
        };
        uw.WebSocket.prototype = _OrigWS.prototype;
           try { Object.setPrototypeOf(uw.WebSocket, _OrigWS); } catch (_) { /* keep WebSocket.OPEN / CLOSED etc. where allowed */ }

        // fetch hook
        const _origFetch = uw.fetch;
        uw.fetch = async function (...args) {
            const res = await _origFetch(...args);
            const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            if (ATTACK_URL_PATTERNS.some(p => reqUrl.includes(p))) {
                try { res.clone().json().then(handle).catch(() => {}); } catch (_) { /* ignore */ }
            }
            return res;
        };

        // XHR hook
        const _origOpen = uw.XMLHttpRequest.prototype.open;
        uw.XMLHttpRequest.prototype.open = function (...args) {
            const reqUrl = args[1] || '';
            if (ATTACK_URL_PATTERNS.some(p => reqUrl.includes(p))) {
                this.addEventListener('load', () => {
                    try { handle(JSON.parse(this.responseText)); } catch (_) { /* ignore */ }
                });
            }
            return _origOpen.apply(this, args);
        };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MOBILE HUD — RENDER LAYER
    // ═════════════════════════════════════════════════════════════════════════

    function renderWeaponLine(label, weapon) {
        if (!weapon?.name) return '';
        let bonusText = '';
        let dangerTags = '';
        if (Array.isArray(weapon.bonuses) && weapon.bonuses.length) {
            bonusText = weapon.bonuses.map(b => {
                if (DANGER_BONUSES[b.icon]) {
                    const d = DANGER_BONUSES[b.icon];
                    dangerTags += `<span class="tae-danger" style="color:${d.color}">${d.label}</span>`;
                }
                return `${b.value}% ${b.icon}`;
            }).join(' ');
        }
        return `<span class="tae-weapon-line">
            <b>${label[0]}:</b> ${weapon.name}
            ${bonusText ? '<span class="tae-weapon-bonuses"> • ' + bonusText + '</span>' : ''}
            ${dangerTags}
        </span>`;
    }

    function renderEffect(effect) {
        const VISION_EFFECTS = ['Smoked', 'Blinded'];
        const DOT_EFFECTS = ['Eviscerated', 'Bleeding', 'Burning'];
        const isVision = VISION_EFFECTS.includes(effect.title);
        const isDOT = DOT_EFFECTS.includes(effect.title);
        const stackText = effect.isStackable ? ` ${effect.stackCount}/${effect.stackCountMax}` : '';
        let elCls = 'tae-effect';
        if (isVision) elCls += ' tae-effect-critical';
        if (isDOT) elCls += ' tae-effect-dot';
        const label = isVision ? effect.title.toUpperCase() : effect.title;
        return `<span class="${elCls}">${label} (${effect.timeLeft}s)${stackText}</span>`;
    }

    // ── Update in-bar row (diff-only updates) ────────────────────────────────
    let _lastAttackersRendered = -1;
    let _lastLoadoutRendered = null;
    let _lastEffectsRendered = null;

    function updateHUDRow() {
        if (!isMobile()) return;
        const row = document.getElementById('tae-hud-row');
        if (!row) return;

        // Attackers
        const badge = document.getElementById('tae-hud-attackers');
        if (badge && attackersInLoader !== _lastAttackersRendered) {
            badge.textContent = attackersInLoader;
            _lastAttackersRendered = attackersInLoader;
        }

        // Loadout
        const loadout = document.getElementById('tae-hud-loadout');
        if (loadout) {
            const loadoutKey = defenderWeapons ? JSON.stringify(defenderWeapons) : null;
            if (loadoutKey !== _lastLoadoutRendered) {
                loadout.innerHTML = defenderWeapons
                    ? [
                    renderWeaponLine('Primary', defenderWeapons.Primary),
                    renderWeaponLine('Secondary', defenderWeapons.Secondary),
                    renderWeaponLine('Melee', defenderWeapons.Melee),
                    renderWeaponLine('Temp', defenderWeapons.Temp),
                ].join('')
                : '<span class="tae-label">\u2014</span>';
                _lastLoadoutRendered = loadoutKey;
            }
        }

        // Effects
        const effects = document.getElementById('tae-hud-effects');
        if (effects) {
            const effectsKey = JSON.stringify(lastEffects);
            if (effectsKey !== _lastEffectsRendered) {
                effects.innerHTML = (!lastEffects || lastEffects.length === 0)
                    ? '<span class="tae-label">None</span>'
                : lastEffects.map(renderEffect).join('');
                _lastEffectsRendered = effectsKey;
            }
        }
    }

    // ── Build HUD row ────────────────────────────────────────────────────────
    function buildHUDRow() {
        const sep = Object.assign(document.createElement('div'), { className: 'tae-row-break' });

        // Row A: Attackers | Enemy Loadout
        const rowA = document.createElement('div');
        rowA.id = 'tae-hud-row';
        rowA.className = 'tae-row tae-hud-row';

        const atkPrefix = document.createElement('div');
        atkPrefix.className = 'tae-row-prefix';
        atkPrefix.innerHTML = '<span class="tae-label">Attackers</span>';
        const loaderBadge = document.createElement('span');
        loaderBadge.id = 'tae-hud-attackers';
        loaderBadge.className = 'tae-btn';
        Object.assign(loaderBadge.style, { minWidth: '14px', textAlign: 'center' });
        loaderBadge.textContent = '0';
        atkPrefix.appendChild(loaderBadge);
        rowA.appendChild(atkPrefix);

        rowA.appendChild(Object.assign(document.createElement('div'), { className: 'tae-vdivider' }));

        const loadoutGroup = document.createElement('div');
        loadoutGroup.className = 'tae-group tae-group-col';
        loadoutGroup.innerHTML = `
            <span class="tae-label">Enemy Loadout</span>
            <div id="tae-hud-loadout" class="tae-hud-list"><span class="tae-label">\u2014</span></div>`;
        rowA.appendChild(loadoutGroup);

        // Row B: Effects
        const sepB = Object.assign(document.createElement('div'), { className: 'tae-row-break' });
        const rowB = document.createElement('div');
        rowB.className = 'tae-row';

        const fxPrefix = document.createElement('div');
        fxPrefix.className = 'tae-row-prefix';
        fxPrefix.innerHTML = '<span class="tae-label">Effects</span>';
        rowB.appendChild(fxPrefix);

        rowB.appendChild(Object.assign(document.createElement('div'), { className: 'tae-vdivider' }));

        const fxList = document.createElement('div');
        fxList.id = 'tae-hud-effects';
        fxList.className = 'tae-hud-list tae-hud-effects-list';
        fxList.innerHTML = '<span class="tae-label">None</span>';
        rowB.appendChild(fxList);

        return [sep, rowA, sepB, rowB];
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STYLES
    // ═════════════════════════════════════════════════════════════════════════

    GM_addStyle(`
        /* Hide Torn's default attack title */
        [class^='titleContainer'] h4[class^='title'] { display: none; }
        [class*="modelWrap___"]    { max-width: 100%; }
        [class*="playerWindow___"] { overflow: visible !important; }

        [class*="dialogButtons___"] {
            z-index: 1000;
            position: absolute;
            display: flex;
            flex-direction: column;
            gap: 4px;
            align-items: stretch;
        }
        [class*="dialogButtons___"] button {
            white-space: nowrap;
            font-size: 12px !important;
            padding: 5px 14px !important;
            line-height: 1.4 !important;
            min-width: 0 !important;
        }
        @media (max-width: 699px) {
            [class*="dialogButtons___"] button {
                font-size: 10px !important;
                padding: 2px 6px !important;
                line-height: 1.2 !important;
                border-radius: 3px !important;
            }
        }

        /* ── TAE wrapper ── */
        #tae-wrap {
            display: flex; flex-direction: column;
            align-items: stretch; width: 100%; box-sizing: border-box;
        }
        #tae-hud-wrap {
            display: flex; flex-direction: column;
            background: rgba(0,0,0,0.45);
            border-bottom: 1px solid rgba(255,255,255,0.07);
            font-size: 11px; font-family: inherit; color: #aaa;
            width: 100%; box-sizing: border-box;
        }
        #tae-hud-wrap .tae-row {
            display: flex; align-items: center; gap: 6px;
            padding: 4px 10px; width: 100%; box-sizing: border-box;
        }
        #tae-hud-wrap .tae-row-break,
        #tae-settings .tae-row-break {
            width: 100%; height: 1px;
            background: rgba(255,255,255,0.08); margin: 0;
        }

        /* ── Toggle header (matches Online Status style) ── */
        #tae-toggle-wrap {
            display: flex; align-items: center; justify-content: center;
            gap: 6px; padding: 4px 12px;
            background: rgba(0,0,0,0.55);
            border-bottom: 1px solid rgba(255,255,255,0.04);
            cursor: pointer; user-select: none;
            transition: background 0.15s;
        }
        #tae-toggle-wrap:hover { background: rgba(0,0,0,0.65); }
        #tae-toggle-label {
            color: #888; font-size: 10px; font-family: inherit;
            text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;
        }
        #tae-toggle-arrow {
            color: #555; font-size: 8px;
            transition: transform 0.2s;
        }
        #tae-toggle-arrow.collapsed {
            transform: rotate(-90deg);
        }

        /* ── Settings bar (smooth expand/collapse) ── */
        #tae-settings {
            display: flex; align-items: stretch; flex-direction: column;
            gap: 0; padding: 0; background: rgba(0,0,0,0.45);
            border-bottom: 1px solid rgba(255,255,255,0.07);
            font-size: 11px; font-family: inherit; color: #aaa;
            flex: 1; box-sizing: border-box; min-width: 0;
            overflow: hidden;
            transition: max-height 0.3s ease, opacity 0.25s ease;
        }
        #tae-settings.tae-expanded {
            max-height: 500px;
            opacity: 1;
        }
        #tae-settings.tae-collapsed {
            max-height: 0;
            opacity: 0;
            border-bottom-color: transparent;
        }
        #tae-settings .tae-row {
            display: flex; align-items: center; gap: 6px;
            padding: 4px 10px; width: 100%; box-sizing: border-box;
        }
        #tae-settings .tae-row:first-child { padding-top: 5px; }
        #tae-settings .tae-row:last-child  { padding-bottom: 5px; }

        #tae-settings .tae-row-prefix,
        #tae-hud-wrap .tae-row-prefix {
            display: flex; align-items: center; gap: 4px;
            flex-shrink: 0; width: 130px;
        }
        #tae-settings .tae-row-groups {
            display: flex; align-items: center; gap: 6px;
            flex-wrap: wrap; flex: 1;
        }
        #tae-settings .tae-group, #tae-hud-wrap .tae-group     { display: flex; align-items: center; gap: 4px; }
        #tae-settings .tae-group-col, #tae-hud-wrap .tae-group-col { align-items: flex-start; flex-direction: column; gap: 2px; }

        #tae-settings .tae-label,
        #tae-hud-wrap .tae-label {
            color: #777; font-size: 10px; text-transform: uppercase;
            letter-spacing: 0.05em; white-space: nowrap;
        }
        #tae-settings .tae-row > .tae-label:first-child,
        #tae-settings .tae-row-prefix .tae-label:first-child,
        #tae-hud-wrap .tae-row > .tae-label:first-child,
        #tae-hud-wrap .tae-row-prefix .tae-label:first-child {
            min-width: 72px; display: inline-block;
        }

        #tae-settings .tae-btn,
        #tae-hud-wrap .tae-btn {
            padding: 2px 8px; border-radius: 3px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.05); color: #bbb;
            font-size: 11px; cursor: pointer;
            transition: background .15s, color .15s, border-color .15s;
            font-family: inherit; line-height: 1.6;
        }
        #tae-settings .tae-btn:hover,
        #tae-hud-wrap .tae-btn:hover        { background: rgba(255,255,255,0.1); color: #fff; }
        #tae-settings .tae-btn.active,
        #tae-hud-wrap .tae-btn.active       { background: rgba(80,180,80,0.25); border-color: rgba(80,180,80,0.6); color: #7ccc7c; }
        #tae-settings .tae-btn.active-green,
        #tae-hud-wrap .tae-btn.active-green { background: rgba(80,180,80,0.25); border-color: rgba(80,180,80,0.6); color: #7ccc7c; }

        #tae-settings .tae-divider, #tae-settings .tae-vdivider,
        #tae-hud-wrap .tae-divider, #tae-hud-wrap .tae-vdivider {
            display: block; width: 1px; height: 16px;
            background: rgba(255,255,255,0.15); flex-shrink: 0; margin: 0 2px;
        }

        #tae-settings .tae-threshold-input {
            width: 40px; background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.12); border-radius: 3px;
            color: #bbb; font-size: 11px; font-family: inherit;
            padding: 2px 5px; text-align: center;
        }
        #tae-settings .tae-threshold-input:focus {
            outline: none; border-color: rgba(200,160,80,0.6); color: #e8c96a;
        }

        /* ── HUD rows ── */
        #tae-hud-wrap .tae-hud-row { align-items: flex-start; flex-wrap: nowrap; }
        #tae-hud-wrap .tae-hud-row .tae-group-col { flex: 1; min-width: 0; }
        #tae-hud-wrap .tae-badge {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
            background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
            color: #ddd; font-size: 11px; font-weight: bold; line-height: 1;
        }
        #tae-hud-wrap .tae-hud-list { display: flex; flex-direction: column; gap: 2px; }
        #tae-hud-wrap .tae-hud-effects-list { flex-direction: row; flex-wrap: wrap; }
        #tae-hud-wrap .tae-weapon-line {
            font-size: 11px; line-height: 1.3; white-space: nowrap; color: #ccc;
        }
        #tae-hud-wrap .tae-weapon-bonuses { color: #999; font-size: 10px; }
        #tae-hud-wrap .tae-danger         { font-weight: bold; margin-left: 3px; font-size: 10px; }

        #tae-hud-wrap .tae-effect {
            display: inline-block; padding: 1px 4px; border-radius: 3px;
            background: rgba(0,0,0,0.4); border: 1px solid transparent;
            font-size: 11px; color: #ccc; line-height: 1.3;
        }
        #tae-hud-wrap .tae-effect-critical {
            background: rgba(160,0,0,0.85); border-color: #ff4d4d;
            color: #fff; font-weight: bold;
        }
        #tae-hud-wrap .tae-effect-dot {
            background: rgba(140,60,0,0.85); border-color: #ff9800;
            color: #ffd580; font-weight: bold;
        }

        @media (max-width: 699px) {
            #tae-settings                { overflow: hidden; }
            #tae-settings .tae-row       { padding: 3px 6px; gap: 4px; align-items: center; }
            #tae-settings .tae-btn,
            #tae-hud-wrap .tae-btn       { padding: 1px 5px; font-size: 10px; }
            #tae-settings .tae-label,
            #tae-hud-wrap .tae-label     { font-size: 9px; }
            #tae-settings .tae-divider,
            #tae-hud-wrap .tae-divider   { display: flex; }
            #tae-settings .tae-vdivider,
            #tae-hud-wrap .tae-vdivider  { display: flex; margin: 0 6px; }
            #tae-settings .tae-row-prefix,
            #tae-hud-wrap .tae-row-prefix { flex-shrink: 0; width: 90px; }
            #tae-settings .tae-row-prefix .tae-label:first-child,
            #tae-hud-wrap .tae-row-prefix .tae-label:first-child { min-width: 62px; }
            #tae-settings .tae-row-groups {
                flex: 1; display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start;
            }
            #tae-settings .tae-row-groups .tae-group { align-items: center; }
            #tae-hud-wrap .tae-weapon-line { font-size: 10px; }
            #tae-hud-wrap .tae-effect      { font-size: 10px; }
        }
    `);

    // ═════════════════════════════════════════════════════════════════════════
    // DOM BUILDERS
    // ═════════════════════════════════════════════════════════════════════════

    const buildToggle = () => {
        const wrap = document.createElement('div');
        wrap.id = 'tae-toggle-wrap';
        wrap.innerHTML = `<span id="tae-toggle-arrow" class="${settingsVisible ? '' : 'collapsed'}">\u25BC</span><span id="tae-toggle-label">Attack Enhancer</span>`;
        wrap.addEventListener('click', () => {
            settingsVisible = !settingsVisible;
            localStorage.setItem('tae-settings-visible', settingsVisible);
            const arrow = document.getElementById('tae-toggle-arrow');
            if (arrow) arrow.classList.toggle('collapsed', !settingsVisible);
            const bar = document.getElementById('tae-settings');
            if (bar) {
                bar.classList.toggle('tae-expanded', settingsVisible);
                bar.classList.toggle('tae-collapsed', !settingsVisible);
            }
        });
        return wrap;
    };

    const buildSettingsBar = () => {
        const bar = document.createElement('div');
        bar.id = 'tae-settings';
        bar.className = settingsVisible ? 'tae-expanded' : 'tae-collapsed';

        const makeGroup = (label, options, currentVal, storageKey) => {
            const g = document.createElement('div');
            g.className = 'tae-group';
            g.dataset.storageKey = storageKey;
            g.appendChild(Object.assign(document.createElement('span'), { className: 'tae-label', textContent: label }));
            options.forEach(({ label: l, val }) => {
                const b = document.createElement('button');
                b.className = 'tae-btn' + (val === currentVal ? ' active' : '');
                b.textContent = l;
                b.addEventListener('click', () => { localStorage.setItem(storageKey, val); location.reload(); });
                g.appendChild(b);
            });
            return g;
        };

        const makeRow = () => Object.assign(document.createElement('div'), { className: 'tae-row' });

        // ── Row 1: Fight settings ────────────────────────────────────────────
        const row1 = makeRow();
        const sfPrefix = document.createElement('div');
        sfPrefix.className = 'tae-row-prefix';
        sfPrefix.appendChild(Object.assign(document.createElement('span'), { className: 'tae-label', textContent: 'Fight' }));
        const slotOnOffBtn = document.createElement('button');
        slotOnOffBtn.className = 'tae-btn' + (slotEnabled ? ' active-green' : '');
        slotOnOffBtn.textContent = slotEnabled ? 'On' : 'Off';
        slotOnOffBtn.addEventListener('click', () => {
            slotEnabled = !slotEnabled;
            localStorage.setItem('torn-slot-enabled', slotEnabled);
            slotOnOffBtn.textContent = slotEnabled ? 'On' : 'Off';
            slotOnOffBtn.className = 'tae-btn' + (slotEnabled ? ' active-green' : '');
            if (slotEnabled) {
                slot = 1; attackType = 0;
                localStorage.setItem('torn-attack-slot', slot);
                localStorage.setItem('torn-attack-type', attackType);
            } else {
                slot = 0; attackType = -1;
                resetDialogButtons();
            }
            document.querySelectorAll('#tae-settings .tae-group .tae-btn').forEach(b => {
                const txt = b.textContent.trim().toLowerCase();
                const slotMatch = { primary: 1, secondary: 2, melee: 3, temp: 4 };
                const typeMatch = { all: 0, leave: 1, mug: 2, hosp: 3, arrest: 4 };
                let isActive = false;
                if (slotMatch[txt] !== undefined) isActive = slotEnabled && slotMatch[txt] === slot;
                if (typeMatch[txt] !== undefined) isActive = slotEnabled && typeMatch[txt] === attackType;
                b.classList.toggle('active', isActive);
            });
            applyButtonVisibility();
        });
        sfPrefix.appendChild(slotOnOffBtn);
        row1.appendChild(sfPrefix);
        row1.appendChild(Object.assign(document.createElement('div'), { className: 'tae-vdivider' }));
        const sfGroups = document.createElement('div');
        sfGroups.className = 'tae-row-groups';
        sfGroups.appendChild(makeGroup('Slot', [
            { label: 'Primary', val: 1 }, { label: 'Secondary', val: 2 }, { label: 'Melee', val: 3 }, { label: 'Temp', val: 4 },
        ], slot, 'torn-attack-slot'));
        sfGroups.appendChild(makeGroup('Type', [
            { label: 'All', val: 0 }, { label: 'Leave', val: 1 }, { label: 'Mug', val: 2 },
            { label: 'Hosp', val: 3 }, { label: 'Arrest', val: 4 },
        ], attackType, 'torn-attack-type'));
        row1.appendChild(sfGroups);
        bar.appendChild(row1);

        bar.appendChild(Object.assign(document.createElement('div'), { className: 'tae-row-break' }));

        // ── Row 2: Execute ───────────────────────────────────────────────────
        const row2 = makeRow();
        const exPrefix = document.createElement('div');
        exPrefix.className = 'tae-row-prefix';
        exPrefix.appendChild(Object.assign(document.createElement('span'), { className: 'tae-label', textContent: 'Execute' }));
        const exBtn = document.createElement('button');
        exBtn.className = 'tae-btn' + (executeEnabled ? ' active-green' : '');
        exBtn.textContent = executeEnabled ? 'On' : 'Off';
        exBtn.addEventListener('click', () => {
            executeEnabled = !executeEnabled;
            localStorage.setItem('torn-execute-enabled', executeEnabled);
            exBtn.textContent = executeEnabled ? 'On' : 'Off';
            exBtn.className = 'tae-btn' + (executeEnabled ? ' active-green' : '');
            if (executeEnabled) startHealthWatch();
            if (!executeEnabled) {
                stopHealthWatch();
                const secondaryEl = document.getElementById('weapon_second');
                if (secondaryEl) {
                    secondaryEl.style.backgroundColor = '';
                    secondaryEl.style.border = '';
                    secondaryEl.style.boxShadow = '';
                }
            }
        });
        exPrefix.appendChild(exBtn);
        row2.appendChild(exPrefix);
        row2.appendChild(Object.assign(document.createElement('div'), { className: 'tae-vdivider' }));
        const exGroups = document.createElement('div');
        exGroups.className = 'tae-row-groups';
        exGroups.style.flexWrap = 'nowrap';
        exGroups.style.alignItems = 'center';
        exGroups.appendChild(Object.assign(document.createElement('span'), { className: 'tae-label', textContent: '%' }));
        const exAlignSpacer = document.createElement('span');
        exAlignSpacer.style.cssText = 'display:inline-block;min-width:14px;visibility:hidden;flex-shrink:0;';
        exGroups.appendChild(exAlignSpacer);
        const threshInput = Object.assign(document.createElement('input'), {
            type: 'number', min: '1', max: '100', value: healthThreshold, className: 'tae-threshold-input',
        });
        threshInput.addEventListener('change', () => {
            const v = Math.min(100, Math.max(1, Number(threshInput.value)));
            threshInput.value = v; healthThreshold = v;
            localStorage.setItem('torn-health-threshold', v);
        });
        exGroups.appendChild(threshInput);
        row2.appendChild(exGroups);
        bar.appendChild(row2);

        return bar;
    };

    const buildWrapper = () => {
        const wrap = document.createElement('div');
        wrap.id = 'tae-wrap';

        wrap.appendChild(buildToggle());
        wrap.appendChild(buildSettingsBar());

        if (isMobile()) {
            const [hudSep, rowA, sepB, rowB] = buildHUDRow();
            const hudWrap = document.createElement('div');
            hudWrap.id = 'tae-hud-wrap';
            hudWrap.appendChild(hudSep);
            hudWrap.appendChild(rowA);
            hudWrap.appendChild(sepB);
            hudWrap.appendChild(rowB);
            wrap.appendChild(hudWrap);
        }

        return wrap;
    };

    // ═════════════════════════════════════════════════════════════════════════
    // INJECTION
    // ═════════════════════════════════════════════════════════════════════════

    const tryInject = () => {
        // Hash-resilient: find playersModelWrap by attribute selector
        const container = qc('playersModelWrap');
        if (!container) return false;
        if (container.querySelector('#tae-wrap')) return true;
        container.insertBefore(buildWrapper(), container.firstChild);
        requestAnimationFrame(() => {
            positionDialogButtons();
            applyButtonVisibility();
        });
        return true;
    };

    let reposTimer = null;
    new MutationObserver(() => {
        if (!isTabFocused) return; // Focus gate
        applyButtonVisibility();
        clearTimeout(reposTimer);
        reposTimer = setTimeout(positionDialogButtons, 150);
        tryInject();
    }).observe(document.body, { childList: true, subtree: true });

    const initPoll = setInterval(() => { if (tryInject()) clearInterval(initPoll); }, 200);
    setTimeout(() => clearInterval(initPoll), 10000);

}


// ═════════════════════════════════════════════════════════════════════════
// ATTACK PAGE HOSPITAL TIMER
// ═════════════════════════════════════════════════════════════════════════

if (isAttackPage && userID) {
    const aphtApiKey = Storage.getSettings().apiKey;

    if (aphtApiKey) {
        let aphtOutAt = 0;
        let aphtWasInHosp = false;
        let aphtClockTimer = null;
        let aphtPollTimer = null;

        // Styles
        GM_addStyle(`
                #apht-time-wrap {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    position: absolute;
                    top: 50%;
                    right: 10px;
                    transform: translateY(-50%);
                }
                #apht-time-left {
                    font-size: 18px;
                    font-weight: bold;
                    color: inherit;
                    font-family: monospace;
                    letter-spacing: 1px;
                }
                #apht-reload-btn {
                    height: 24px;
                    line-height: 22px;
                    font-family: "Fjalla One", Arial, serif;
                    font-size: 12px;
                    font-weight: normal;
                    text-align: center;
                    text-transform: uppercase;
                    border-radius: 5px;
                    padding: 0 10px;
                    cursor: pointer;
                    color: var(--btn-color, #555);
                    text-shadow: var(--btn-text-shadow, 0 1px 0 rgba(255,255,255,0.25));
                    background: var(--btn-background, linear-gradient(180deg, #DEDEDE 0%, #F7F7F7 25%, #CFCFCF 60%, #E7E7E7 78%, #D9D9D9 100%));
                    border: var(--btn-border, 1px solid #aaa);
                    display: inline-block;
                    vertical-align: middle;
                    transition: filter 0.15s;
                }
                #apht-reload-btn:hover { filter: brightness(1.5); }
                #apht-reload-btn:active { filter: brightness(0.8); }

                @keyframes apht-flash-green {
                    from { color: #00ee00; }
                    to   { color: inherit; }
                }
                #apht-time-left.apht-flash-green {
                    animation: apht-flash-green 0.4s linear infinite alternate;
                }
            `);

        function aphtGetSecsLeft() {
            return aphtOutAt - (Date.now() / 1000);
        }

        function aphtFormatTime(totalSecs) {
            const h = Math.floor(totalSecs / 3600);
            const m = Math.floor((totalSecs % 3600) / 60);
            const s = Math.floor(totalSecs % 60);
            return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
        }

        function aphtUpdateClock() {
            if (!isTabFocused) return;

            const diff = aphtGetSecsLeft();
            const timeEl = document.getElementById('apht-time-left');
            const reloadBtn = document.getElementById('apht-reload-btn');

            if (diff <= 0) {
                if (timeEl) { timeEl.textContent = '00:00:00'; timeEl.classList.remove('apht-flash-green'); }
                if (aphtClockTimer) { clearInterval(aphtClockTimer); aphtClockTimer = null; }
                if (aphtPollTimer) { clearInterval(aphtPollTimer); aphtPollTimer = null; }
                return;
            }

            if (timeEl) {
                timeEl.textContent = aphtFormatTime(diff);
                timeEl.classList.toggle('apht-flash-green', diff <= 10);
            }
        }

        function aphtBuildUI() {
            if (document.getElementById('apht-time-wrap')) return;

            const titleContainer = document.querySelector("[class^='titleContainer_']");
            if (!titleContainer) return false;

            titleContainer.style.position = 'relative';

            const wrap = document.createElement('div');
            wrap.id = 'apht-time-wrap';

            const timeSpan = document.createElement('span');
            timeSpan.id = 'apht-time-left';
            timeSpan.textContent = '--:--:--';
            wrap.appendChild(timeSpan);

            const reloadBtn = document.createElement('input');
            reloadBtn.id = 'apht-reload-btn';
            reloadBtn.type = 'button';
            reloadBtn.value = 'Reload';
            reloadBtn.addEventListener('click', () => location.reload());
            wrap.appendChild(reloadBtn);

            titleContainer.appendChild(wrap);
            return true;
        }

        function aphtRemoveUI() {
            const wrap = document.getElementById('apht-time-wrap');
            if (wrap) wrap.remove();
        }

        async function aphtPoll() {
            if (!isTabFocused) return;

            try {
                const ts = Math.floor(Date.now() / 1000);
                const res = await fetch(`${API_BASE}/user?id=${userID}&timestamp=${ts}`, {
                    headers: { 'Accept': 'application/json', 'Authorization': 'ApiKey ' + aphtApiKey }
                });
                if (!res.ok) return;
                const data = await res.json();
                if (data?.error) {
                    const code = data.error.code;
                    // Transient: keep key, skip this cycle, let the 2s interval back off.
                    const TRANSIENT = [5, 8, 9, 17, 24];
                    if (!TRANSIENT.includes(code)) {
                        // Everything else (bad/paused/jailed/inactive key, level too low,
                        // daily limit, or any structural error) won't fix itself on retry.
                        // Stop APHT only — don't touch shared apiKeyValid.
                        if (aphtPollTimer) { clearInterval(aphtPollTimer); aphtPollTimer = null; }
                        if (aphtClockTimer) { clearInterval(aphtClockTimer); aphtClockTimer = null; }
                        console.warn('[DSS APHT] Stopping polls — API error code', code);
                    }
                    return;
                }

                const status = data?.profile?.status;

                if (!status || status.state !== 'Hospital') {
                    // Not in hospital
                    aphtRemoveUI();
                    if (aphtClockTimer) { clearInterval(aphtClockTimer); aphtClockTimer = null; }
                    if (aphtWasInHosp) {
                        // Was in hospital, now out
                        if (aphtBuildUI()) {
                            const timeEl = document.getElementById('apht-time-left');
                            if (timeEl) { timeEl.textContent = 'Target out of Hospital!'; timeEl.style.color = '#ef4444'; }
                        }
                        if (aphtPollTimer) { clearInterval(aphtPollTimer); aphtPollTimer = null; }
                    }
                    aphtWasInHosp = false;
                    return;
                }

                // In hospital
                aphtOutAt = status.until;
                aphtWasInHosp = true;

                if (aphtBuildUI() || document.getElementById('apht-time-wrap')) {
                    aphtUpdateClock();
                    if (!aphtClockTimer) {
                        aphtClockTimer = setInterval(aphtUpdateClock, 1000);
                    }
                }
            } catch (_) { /* network error, retry on next poll */ }
        }

        // Start polling after a short delay to let the page load
        setTimeout(() => {
            aphtPoll();
            aphtPollTimer = setInterval(aphtPoll, 2000);
        }, 250);
    }
}

// ═════════════════════════════════════════════════════════════════════════
// ATTACK BUTTON OVERRIDE (profile pages only)
// ═════════════════════════════════════════════════════════════════════════

const isProfilePage = url.includes('profiles.php');

if (isProfilePage) {
    const aboApiKey = Storage.getSettings().apiKey;
    const aboXID = new URLSearchParams(window.location.search).get('XID');

    if (aboApiKey && aboXID) {
        GM_addStyle(`
                @keyframes abo-hospital-glow {
                    from { box-shadow: 0 0 5px #007bff, 0 0 10px #007bff; }
                    to   { box-shadow: 0 0 10px #007bff, 0 0 20px #007bff, 0 0 30px #007bff; }
                }
                .abo-enabled-btn {
                    opacity: 1 !important;
                    pointer-events: auto !important;
                    cursor: pointer !important;
                    box-shadow: 0 0 10px #007bff, 0 0 20px #007bff;
                    border: 2px solid #007bff !important;
                    animation: abo-hospital-glow 2s ease-in-out infinite alternate;
                    position: relative;
                }
            `);

        async function aboCheckStatus() {
            try {
                const res = await fetch(`${API_BASE}/user?id=${aboXID}`, {
                    headers: { 'Accept': 'application/json', 'Authorization': 'ApiKey ' + aboApiKey }
                });
                if (!res.ok) return;
                const data = await res.json();
                if (data?.error) return;

                if (data?.profile?.status?.state === 'Hospital') {
                    aboEnableAttackButton();
                }
            } catch (_) { /* ignore */ }
        }

        function aboEnableAttackButton(attempts = 0) {
            // Try multiple selectors to find the attack button
            let btn = document.getElementById(`button0-profile-${aboXID}`)
                   || document.querySelector("[id^='button0-profile-']")
                   || document.querySelector("input[value='Attack']")
                   || document.querySelector("a[class*='profileButton'][href*='attack']");

            // Also check for link-style buttons
            if (!btn) {
                const allBtns = document.querySelectorAll("[class*='profileButton'], [class*='profile-button']");
                for (const b of allBtns) {
                    if (b.textContent.trim().toLowerCase().includes('attack') ||
                        b.querySelector("input[value='Attack']")) {
                        btn = b;
                        break;
                    }
                }
            }

            if (!btn) {
                if (attempts < 10) {
                    setTimeout(() => aboEnableAttackButton(attempts + 1), 300);
                }
                return;
            }

            // Enable the button
            btn.removeAttribute('disabled');
            btn.disabled = false;
            btn.classList.remove('disabled');
            btn.classList.add('abo-enabled-btn');

            btn.setAttribute('title', 'Bypass — Click to Attack');

            // Ensure click navigates to attack page
            const existingHref = btn.getAttribute('data-href') || btn.getAttribute('href');
            const attackUrl = existingHref || `/loader.php?sid=attack&user2ID=${aboXID}`;

            btn.addEventListener('click', function aboClick(e) {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = attackUrl.startsWith('http') ? attackUrl : 'https://www.torn.com' + attackUrl;
            }, { once: true });
        }

        // Only check when tab is focused
        if (isTabFocused) {
            aboCheckStatus();
        } else {
            const aboVisHandler = () => {
                if (document.visibilityState === 'visible') {
                    document.removeEventListener('visibilitychange', aboVisHandler);
                    aboCheckStatus();
                }
            };
            document.addEventListener('visibilitychange', aboVisHandler);
        }
    }
}

}
});
