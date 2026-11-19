import { API_BASE, tornAuth } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Activity Stats
// ════════════════════════════════════════════════════════════════════════

registerModule('activity-stats', {
name: 'Activity Stats',
version: '1.0',
description: 'Provides activity stats (xanax, activity hours, attacks, respect, etc.) on profile pages and faction member tables.',
pages: ['/profiles.php', '/factions.php'],
guide,
init() {
    const api_key = Storage.getSettings().apiKey;

    // ── Shared helpers ──

    async function fetchPersonalStats(id, time) {
        var stats = "xantaken,energydrinkused,timeplayed,refills,attackswon,respectforfaction,retals,traveltimes,statenhancersused,networth";
        var url = time
            ? `${API_BASE}/user/${id}/personalstats?stat=${stats}&timestamp=${time}`
            : `${API_BASE}/user/${id}/personalstats?stat=${stats}`;
        var resp = await fetch(url, { headers: tornAuth(api_key) });
        var json = await resp.json();
        var result = {};
        if (json.personalstats && Array.isArray(json.personalstats)) {
            json.personalstats.forEach(s => { result[s.name] = s.value; });
        }
        if (json.error) result._error = json.error.error || json.error_message || JSON.stringify(json.error);
        return result;
    }

    async function fetchMemberStats(id, timestamp, stats) {
        var url = timestamp
            ? `${API_BASE}/user/${id}/personalstats?stat=${stats}&timestamp=${timestamp}`
            : `${API_BASE}/user/${id}/personalstats?stat=${stats}`;
        try {
            var resp = await fetch(url, { headers: tornAuth(api_key) });
            var json = await resp.json();
            var result = {};
            if (json.personalstats && Array.isArray(json.personalstats)) {
                json.personalstats.forEach(s => { result[s.name] = s.value; });
            }
            return result;
        } catch (e) { return {}; }
    }

    async function concurrentLimit(tasks, limit, delayMs = 500) {
        const results = new Array(tasks.length);
        for (let i = 0; i < tasks.length; i += limit) {
            const batch = tasks.slice(i, i + limit);
            const batchResults = await Promise.all(batch.map((t, j) => t().then(r => ({ i: i + j, r }))));
            batchResults.forEach(({ i, r }) => { results[i] = r; });
            if (i + limit < tasks.length) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        return results;
    }

    const PERIODS = [
        { label: "3d", days: 3 },
        { label: "1w", days: 7 },
        { label: "2w", days: 14 },
        { label: "1mo", days: 30 },
        { label: "6mo", days: 183 },
        { label: "1yr", days: 365 },
    ];
    const DEFAULT_PERIOD = 3;

    function getFactionCacheKey(factionId, periodDays) {
        return `rs_faction_${factionId}_${periodDays}`;
    }
    function isCacheValid(cached) {
        if (!cached) return false;
        try {
            const data = JSON.parse(cached);
            return Date.now() - data.timestamp < 24 * 60 * 60 * 1000;
        } catch { return false; }
    }

    // Route
    if (window.location.href.includes('profiles.php')) {
        initProfileStats();
    } else if (window.location.href.includes('factions.php')) {
        initFactionStats();
    }

    // ══════════════════════════════════════════════════════════════════
    // PROFILE STATS
    // ══════════════════════════════════════════════════════════════════

    function initProfileStats() {
        if (!api_key) return;

        const id = new URLSearchParams(window.location.search).get('XID');
        if (!id) return;
        let currentPeriodIdx = DEFAULT_PERIOD;
        let collapsed = GM_getValue("rs_collapsed", false);

        const style = document.createElement("style");
        style.textContent = `
                #recruit-stats-panel {
                    margin-top: 10px;
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    border-radius: 4px;
                    overflow: hidden;
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    color: #ccc;
                }
                #recruit-stats-panel .rs-header {
                    background: linear-gradient(to bottom, #404040, #2e2e2e);
                    border-bottom: 1px solid #222;
                    padding: 0 10px;
                    font-weight: bold;
                    font-size: 13px;
                    color: #ddd;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    height: 34px;
                    box-sizing: border-box;
                    user-select: none;
                }
                #recruit-stats-panel .rs-header-left {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex: 1;
                }
                #recruit-stats-panel .rs-header-icon { font-size: 14px; flex-shrink: 0; }
                .rs-collapse-btn {
                    background: #1a3a1a;
                    border: 1px solid #2d5a2d;
                    border-radius: 3px;
                    color: #5cb85c;
                    cursor: pointer;
                    font-size: 14px;
                    width: 22px; height: 22px;
                    display: flex; align-items: center; justify-content: center;
                    padding: 0; line-height: 1;
                    transition: background 0.15s, color 0.15s, transform 0.2s ease;
                    flex-shrink: 0;
                }
                .rs-collapse-btn:hover { background: #1f451f; color: #6fcf6f; }
                .rs-collapse-btn.collapsed {
                    transform: rotate(-90deg);
                    background: #3a1a1a; border-color: #5a2d2d; color: #d9534f;
                }
                .rs-collapse-btn.collapsed:hover { background: #451f1f; color: #e06c6c; }
                #recruit-stats-panel .rs-controls { display: flex; align-items: center; gap: 3px; }
                .rs-period-group { display: flex; gap: 2px; align-items: center; }
                .rs-period-btn {
                    background: #333; border: 1px solid #555; border-radius: 3px;
                    color: #bbb; font-size: 10px; padding: 2px 7px; cursor: pointer;
                    font-family: Arial, sans-serif; transition: background 0.15s, color 0.15s; line-height: 1.6;
                }
                .rs-period-btn:hover { background: #3d3d3d; color: #ddd; }
                .rs-period-btn.active {
                    background: linear-gradient(to bottom, #5b9bd5, #3a7abf);
                    border-color: #2d6da3; color: #fff; font-weight: bold;
                }
                #recruit-stats-panel .rs-body {
                    overflow: hidden;
                    transition: max-height 0.25s ease, opacity 0.2s ease;
                    max-height: 600px; opacity: 1;
                }
                #recruit-stats-panel .rs-body.collapsed { max-height: 0; opacity: 0; }
                #recruit-stats-panel .rs-loading { padding: 14px 12px; color: #777; font-style: italic; text-align: center; }
                #recruit-stats-panel .rs-table { width: 100%; border-collapse: collapse; }
                #recruit-stats-panel .rs-table thead tr { background: #202020; border-bottom: 1px solid #2e2e2e; }
                #recruit-stats-panel .rs-table thead th {
                    padding: 4px 12px; font-size: 10px; font-weight: normal; color: #666;
                    text-align: right; text-transform: uppercase; letter-spacing: 0.5px;
                }
                #recruit-stats-panel .rs-table thead th:first-child { text-align: left; }
                #recruit-stats-panel .rs-table tbody tr { border-bottom: 1px solid #222; }
                #recruit-stats-panel .rs-table tbody tr:nth-child(odd)  { background: #1a1a1a; }
                #recruit-stats-panel .rs-table tbody tr:nth-child(even) { background: #1d1d1d; }
                #recruit-stats-panel .rs-table tbody tr:hover { background: #242424; }
                #recruit-stats-panel .rs-table td { padding: 5px 12px; }
                #recruit-stats-panel .rs-table td.rs-label  { color: #999; font-size: 11px; width: 30%; }
                #recruit-stats-panel .rs-table td.rs-amount { text-align: right; font-weight: bold; color: #ddd; width: 35%; }
                #recruit-stats-panel .rs-table td.rs-perday { text-align: right; color: #777; font-size: 11px; width: 35%; }
                #recruit-stats-panel .rs-table td.positive  { color: #5cb85c; }
                #recruit-stats-panel .rs-table td.negative  { color: #d9534f; }
                #recruit-stats-panel .rs-footer {
                    padding: 4px 8px 4px 12px; background: #161616; border-top: 1px solid #222;
                    color: #4a4a4a; font-size: 10px; display: flex; align-items: center; justify-content: space-between;
                }
                .rs-copy-btn {
                    background: #252525; border: 1px solid #383838; border-radius: 2px;
                    color: #777; cursor: pointer; font-size: 10px; font-family: Arial, sans-serif;
                    padding: 2px 8px; line-height: 1.6; transition: background 0.15s, color 0.15s; white-space: nowrap;
                }
                .rs-copy-btn:hover { background: #303030; color: #ccc; }
                .rs-copy-btn.copied { background: #1a3a1a; border-color: #2d5a2d; color: #5cb85c; }
            `;
        document.head.appendChild(style);

        var panel = document.createElement("div");
        panel.id = "recruit-stats-panel";
        panel.innerHTML = `
                <div class="rs-header" id="rs-header">
                    <div class="rs-header-left">
                        <span class="rs-header-icon">\u{1F4CA}</span>
                        Activity Stats
                    </div>
                    <div class="rs-controls" id="rs-controls">
                        <div class="rs-period-group">
                            ${PERIODS.map((p, i) =>
                            `<button class="rs-period-btn${i === DEFAULT_PERIOD ? ' active' : ''}" data-period="${i}">${p.label}</button>`
                        ).join('')}
                        </div>
                        <button class="rs-collapse-btn${collapsed ? ' collapsed' : ''}" id="rs-collapse-btn" title="Collapse">\u25BC</button>
                    </div>
                </div>
                <div class="rs-body${collapsed ? ' collapsed' : ''}" id="rs-body">
                    <div class="rs-loading">Loading stats...</div>
                </div>
            `;

        panel.querySelector("#rs-collapse-btn").addEventListener("click", () => {
            collapsed = !collapsed;
            GM_setValue("rs_collapsed", collapsed);
            panel.querySelector(".rs-body").classList.toggle("collapsed", collapsed);
            panel.querySelector("#rs-collapse-btn").classList.toggle("collapsed", collapsed);
        });

        panel.querySelector(".rs-period-group").addEventListener("click", e => {
            if (!e.target.classList.contains("rs-period-btn")) return;
            if (e.target.classList.contains("active")) return;
            const idx = parseInt(e.target.dataset.period);
            panel.querySelectorAll(".rs-period-btn").forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            currentPeriodIdx = idx;
            setLoading();
            loadStats(idx);
        });

        var interval = setInterval(() => {
            var wrapper = document.querySelector(".profile-wrapper");
            if (wrapper) {
                clearInterval(interval);
                // PDA cleanup: remove stale panel from previous page load
                wrapper.querySelector('#recruit-stats-panel')?.remove();
                wrapper.appendChild(panel);
                loadStats(DEFAULT_PERIOD);
            }
        }, 200);

        function setLoading() {
            panel.querySelector(".rs-body").innerHTML = `<div class="rs-loading">Loading stats...</div>`;
        }

        function loadStats(periodIdx) {
            if (!api_key) {
                panel.querySelector(".rs-body").innerHTML = '<div class="rs-loading" style="color:#d9534f">No API key configured. Set one in DSS Settings.</div>';
                return;
            }
            const { days } = PERIODS[periodIdx];
            const d = new Date();
            d.setSeconds(d.getSeconds() - days * 86400);
            const timestamp = ~~(d / 1000);

            Promise.all([
                fetchPersonalStats(id, timestamp),
                fetchPersonalStats(id)
            ]).then(([p0, p1]) => {
                if (periodIdx !== currentPeriodIdx) return;
                if (p0._error || p1._error) {
                    const errMsg = p0._error || p1._error;
                    panel.querySelector(".rs-body").innerHTML =
                        `<div class="rs-loading" style="color:#d9534f">API error: ${errMsg}</div>`;
                    return;
                }
                renderStats(p0, p1, days);
            }).catch(err => {
                console.error(err);
                panel.querySelector(".rs-body").innerHTML =
                    `<div class="rs-loading" style="color:#d9534f">Failed to load stats. Check API key in DSS Settings.</div>`;
            });
        }

        function renderStats(p0, p1, days) {
            const diff = (key) => (p1[key] || 0) - (p0[key] || 0);
            const perDay = (val) => (val / days).toFixed(2);

            const xanax = diff("xantaken");
            const cans = diff("energydrinkused");
            const activityTotal = (diff("timeplayed") / 3600).toFixed(2);
            const activity = (diff("timeplayed") / 3600 / days).toFixed(2);
            const refills = diff("refills");
            const attacks = diff("attackswon");
            const respect = diff("respectforfaction");
            const retals = diff("retals");
            const travel = diff("traveltimes");
            const se = diff("statenhancersused") || 0;
            const networthDiff = diff("networth");
            const nwNowStr = ((p1.networth || 0) / 1e9).toFixed(2) + "b";
            const nwDiffStr = (networthDiff / 1e9).toFixed(2) + "b";
            const nwClass = networthDiff >= 0 ? "positive" : "negative";
            const nwSign = networthDiff >= 0 ? "+" : "";

            const rows = [
                { label: "Activity", amount: activityTotal + " hrs", perday: activity + " hrs" },
                { label: "Xanax", amount: xanax, perday: perDay(xanax) },
                { label: "Refills", amount: refills, perday: perDay(refills) },
                { label: "Cans", amount: cans, perday: perDay(cans) },
                { label: "Attacks", amount: attacks, perday: perDay(attacks) },
                { label: "Respect", amount: respect, perday: perDay(respect) },
                { label: "Retals", amount: retals, perday: perDay(retals) },
                { label: "Travel", amount: travel, perday: perDay(travel) },
                { label: "SEs", amount: se, perday: perDay(se) },
            ];

            const tableRows = rows.map(r => `
                    <tr>
                        <td class="rs-label">${r.label}</td>
                        <td class="rs-amount">${r.amount}</td>
                        <td class="rs-perday">${r.perday !== null ? r.perday : "\u2014"}</td>
                    </tr>`
            ).join('');

            const networthRow = `
                    <tr>
                        <td class="rs-label">Networth</td>
                        <td class="rs-amount">${nwNowStr}</td>
                        <td class="rs-perday ${nwClass}">${nwSign}${nwDiffStr} period</td>
                    </tr>`;

            const bodyEl = panel.querySelector(".rs-body");
            bodyEl.innerHTML = `
                    <table class="rs-table">
                        <thead><tr><th>Stat</th><th>Amount</th><th>Per Day</th></tr></thead>
                        <tbody>${tableRows}${networthRow}</tbody>
                    </table>
                    <div class="rs-footer">
                        <span>Based on ~${days} day${days !== 1 ? 's' : ''} of data</span>
                        <button class="rs-copy-btn" id="rs-copy-btn">Export</button>
                    </div>
                `;

            bodyEl.querySelector("#rs-copy-btn").addEventListener("click", () => {
                const allRows = [
                    ...rows,
                    { label: "Networth", amount: nwNowStr, perday: `${nwSign}${nwDiffStr} period` }
                ];
                const period = PERIODS[currentPeriodIdx].label;
                const profileName = document.querySelector('h4#skip-to-content')?.textContent?.trim() || `#${id}`;
                const lines = allRows.map(r => {
                    const perday = r.perday != null ? String(r.perday) : "\u2014";
                    const amount = String(r.amount);
                    if (amount === "\u2014") return `${r.label}: ${perday}`;
                    return perday !== "\u2014"
                        ? `${r.label}: ${amount} (${perday}/day)`
                        : `${r.label}: ${amount}`;
                });
                const text = [`Activity Stats - ${profileName} (${period})`, ...lines].join("\n");
                navigator.clipboard.writeText(text).then(() => {
                    const btn = bodyEl.querySelector("#rs-copy-btn");
                    btn.textContent = "Copied to clipboard!";
                    btn.classList.add("copied");
                    setTimeout(() => { btn.textContent = "Export"; btn.classList.remove("copied"); }, 2000);
                });
            });
        }
    } // end initProfileStats

    // ══════════════════════════════════════════════════════════════════
    // FACTION STATS
    // ══════════════════════════════════════════════════════════════════

    function initFactionStats() {

        // Clean up stale faction cache entries
        function cleanupFactionCache() {
            const keys = GM_listValues();
            keys.forEach(key => {
                if (!key.startsWith('rs_faction_')) return;
                const raw = GM_getValue(key, null);
                if (!raw) return;
                try {
                    const data = JSON.parse(raw);
                    if (Date.now() - data.timestamp > 48 * 60 * 60 * 1000) {
                        GM_deleteValue(key);
                    }
                } catch {
                    GM_deleteValue(key); // malformed entry
                }
            });
        }
        cleanupFactionCache();



        if (!api_key) return;

        const FACTION_PERIODS = [
            { label: "3d", days: 3 },
            { label: "1w", days: 7 },
            { label: "2w", days: 14 },
            { label: "1mo", days: 30 },
        ];
        const FACTION_DEFAULT = 1;

        let factionPeriodIdx = GM_getValue("rs_faction_period", FACTION_DEFAULT);
        let factionId = null;
        let memberData = {};
        let sortCol = null;
        let sortDir = 1;

        const style = document.createElement("style");
        style.textContent = `
                #faction-stats-panel {
                    margin-bottom: 10px;
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    border-radius: 4px;
                    overflow: hidden;
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    color: #ccc;
                }
                #faction-stats-panel .fs-header {
                    background: linear-gradient(to bottom, #404040, #2e2e2e);
                    border-bottom: 1px solid #222;
                    padding: 0 10px; font-weight: bold; font-size: 13px; color: #ddd;
                    display: flex; align-items: center; gap: 8px; height: 34px;
                    box-sizing: border-box; user-select: none;
                }
                #faction-stats-panel .fs-title { flex: 1; display: flex; align-items: center; gap: 6px; }
                .fs-period-group { display: flex; gap: 2px; align-items: center; }
                .fs-period-btn {
                    background: #333; border: 1px solid #555; border-radius: 3px;
                    color: #bbb; font-size: 10px; padding: 2px 7px; cursor: pointer;
                    font-family: Arial, sans-serif; transition: background 0.15s, color 0.15s; line-height: 1.6;
                }
                .fs-period-btn:hover { background: #3d3d3d; color: #ddd; }
                .fs-period-btn.active {
                    background: linear-gradient(to bottom, #5b9bd5, #3a7abf);
                    border-color: #2d6da3; color: #fff; font-weight: bold;
                }
                #faction-stats-panel .fs-body { padding: 10px 12px; }
                #faction-stats-panel .fs-progress { color: #888; font-size: 11px; font-style: italic; }
                #faction-stats-panel .fs-progress-bar-wrap {
                    background: #2a2a2a; border-radius: 2px; height: 4px; margin-top: 6px; overflow: hidden;
                }
                #faction-stats-panel .fs-progress-bar {
                    background: linear-gradient(to right, #5b9bd5, #3a7abf);
                    height: 100%; width: 0%; transition: width 0.2s ease;
                }
                #faction-stats-panel .fs-cache-note { font-size: 10px; color: #555; margin-top: 6px; }
                #faction-stats-panel .fs-prompt { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
                .fs-load-btn {
                    background: linear-gradient(to bottom, #5b9bd5, #3a7abf);
                    border: 1px solid #2d6da3; border-radius: 3px; color: #fff; cursor: pointer;
                    font-size: 11px; font-family: Arial, sans-serif; padding: 4px 12px;
                    white-space: nowrap; transition: opacity 0.15s;
                }
                .fs-load-btn:hover { opacity: 0.85; }
                .fs-prompt-note { font-size: 10px; color: #555; }
                #faction-stats-panel .fs-legend { font-size: 10px; color: #555; margin-top: 4px; }
                #faction-stats-panel .fs-legend span { color: #5b9bd5; font-weight: bold; }
                #fs-refresh-btn { font-size: 13px; padding: 1px 6px; }
                div.tt-stats-estimate.fs-hidden { display: none !important; }
                .fs-col-header {
                    background: #202020 !important; color: #5b9bd5 !important;
                    font-size: 11px; font-weight: bold; cursor: pointer; white-space: nowrap;
                    padding: 4px 8px; text-align: right; border-left: 1px solid #2a2a2a;
                    user-select: none; width: 40px; min-width: 40px; max-width: 40px;
                    box-sizing: border-box; flex: 0 0 40px !important;
                }
                .fs-col-header:hover { color: #7ab5e0 !important; }
                .fs-col-header .fs-sort-arrow { margin-left: 2px; font-size: 9px; color: #555; }
                .fs-col-header .fs-sort-arrow.active { color: #5b9bd5; }
                .fs-cell {
                    text-align: right; font-size: 11px; color: #ccc; padding: 4px 6px;
                    border-left: 1px solid #1e1e1e; white-space: nowrap;
                    display: flex; align-items: center; justify-content: flex-end;
                    width: 40px; min-width: 40px; max-width: 40px;
                    box-sizing: border-box; flex: 0 0 40px !important;
                }
                .fs-cell.loading { color: #555; font-style: italic; }
                .fs-cell.error { color: #555; }
            `;
        document.head.appendChild(style);

        const interval = setInterval(() => {
            const memberTable = document.querySelector('ul.table-header');
            if (!memberTable) return;
            clearInterval(interval);
            // PDA cleanup: remove stale panel from previous page load
            document.getElementById('faction-stats-panel')?.remove();

            const urlParams = new URLSearchParams(window.location.search);
            factionId = urlParams.get('ID') || 'own';

            const panel = document.createElement('div');
            panel.id = 'faction-stats-panel';
            panel.innerHTML = `
                    <div class="fs-header">
                        <div class="fs-title">\u{1F4CA} Faction Activity Stats</div>
                        <div class="fs-period-group">
                            ${FACTION_PERIODS.map((p, i) =>
                            `<button class="fs-period-btn${i === factionPeriodIdx ? ' active' : ''}" data-period="${i}">${p.label}</button>`
                        ).join('')}
                        </div>
                        <button class="fs-period-btn" id="fs-refresh-btn" title="Pull fresh data">\u21BB</button>
                    </div>
                    <div class="fs-body" id="fs-body">
                        <div class="fs-prompt" id="fs-prompt">
                            <button class="fs-load-btn" id="fs-load-btn">Load Data</button>
                            <span class="fs-prompt-note">Fetches activity stats for all faction members</span>
                        </div>
                    </div>
                `;

            memberTable.parentElement.insertBefore(panel, memberTable);

            panel.querySelector('.fs-period-group').addEventListener('click', e => {
                if (!e.target.classList.contains('fs-period-btn')) return;
                if (e.target.id === 'fs-refresh-btn') {
                    const cacheKey = getFactionCacheKey(factionId, FACTION_PERIODS[factionPeriodIdx].days);
                    GM_setValue(cacheKey, null);
                    memberData = {};
                    loadFactionStats();
                    return;
                }
                if (e.target.classList.contains('active')) return;
                const idx = parseInt(e.target.dataset.period);
                panel.querySelectorAll('.fs-period-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                factionPeriodIdx = idx;
                GM_setValue('rs_faction_period', idx);
                memberData = {};
                const ck = getFactionCacheKey(factionId, FACTION_PERIODS[idx].days);
                if (isCacheValid(GM_getValue(ck, null))) {
                    loadFactionStats();
                } else {
                    panel.querySelector('.fs-body').innerHTML = `
                            <div class="fs-prompt">
                                <button class="fs-load-btn" id="fs-load-btn">Load Data</button>
                                <span class="fs-prompt-note">Fetches activity stats for all faction members</span>
                            </div>`;
                    panel.querySelector('#fs-load-btn').addEventListener('click', () => loadFactionStats());
                }
            });

            const tableObserver = new MutationObserver(() => {
                tableObserver.disconnect();
                try {
                    const newHeaderRow = document.querySelector('ul.table-header');
                    if (!newHeaderRow) return;
                    const rows = getMemberRows();
                    if (!rows.length) return;

                    injectHeaders(newHeaderRow, Object.keys(memberData).length > 0);
                    if (Object.keys(memberData).length > 0) {
                        rows.forEach(row => {
                            const id = getMemberId(row);
                            if (!id) return;
                            injectCells(row, id, true);
                            if (memberData[id]) {
                                updateCell(id, 'activity', memberData[id].activity.toFixed(1));
                                updateCell(id, 'xanax', memberData[id].xanax);
                            }
                        });
                    }
                } finally {
                    const tableContainer = document.querySelector('ul.table-header')?.parentElement;
                    if (tableContainer) {
                        tableObserver.observe(tableContainer, { childList: true, subtree: true });
                    }
                }
            });

            const tableContainer = document.querySelector('ul.table-header')?.parentElement;
            if (tableContainer) {
                tableObserver.observe(tableContainer, { childList: true, subtree: true });
            }

            injectHeaders(memberTable);

            panel.querySelector('#fs-refresh-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const cacheKey = getFactionCacheKey(factionId, FACTION_PERIODS[factionPeriodIdx].days);
                GM_setValue(cacheKey, null);
                memberData = {};
                loadFactionStats();
            });

            panel.querySelector('#fs-load-btn').addEventListener('click', () => loadFactionStats());

            const { days } = FACTION_PERIODS[factionPeriodIdx];
            const initialCacheKey = getFactionCacheKey(factionId, days);
            const initialCached = GM_getValue(initialCacheKey, null);
            if (isCacheValid(initialCached)) {
                loadFactionStats();
            } else if (initialCached) {
                // Stale cache — remove any injected headers/cells and show prompt
                const headerRow = document.querySelector('ul.table-header');
                if (headerRow) {
                    headerRow.querySelectorAll('.fs-col-header').forEach(h => h.remove());
                }
                getMemberRows().forEach(row => {
                    row.querySelectorAll('.fs-cell').forEach(c => c.remove());
                });
            }

            function injectHeaders(headerRow, visible = false) {
                headerRow = document.querySelector('ul.table-header') || headerRow;
                if (headerRow.querySelector('.fs-col-header')) {
                    headerRow.querySelectorAll('.fs-col-header').forEach(h => {
                        h.style.display = visible ? '' : 'none';
                    });
                    return;
                }
                const activityHeader = document.createElement('li');
                activityHeader.className = 'table-cell fs-col-header';
                activityHeader.dataset.col = 'activity';
                activityHeader.innerHTML = `A <span class="fs-sort-arrow" id="fs-sort-activity">\u25B2\u25BC</span>`;
                activityHeader.style.display = visible ? '' : 'none';

                const xanaxHeader = document.createElement('li');
                xanaxHeader.className = 'table-cell fs-col-header';
                xanaxHeader.dataset.col = 'xanax';
                xanaxHeader.innerHTML = `X <span class="fs-sort-arrow" id="fs-sort-xanax">\u25B2\u25BC</span>`;
                xanaxHeader.style.display = visible ? '' : 'none';

                headerRow.appendChild(activityHeader);
                headerRow.appendChild(xanaxHeader);

                [activityHeader, xanaxHeader].forEach(h => {
                    h.addEventListener('click', () => {
                        const col = h.dataset.col;
                        if (sortCol === col) { sortDir *= -1; }
                        else { sortCol = col; sortDir = -1; }
                        panel.querySelectorAll('.fs-sort-arrow').forEach(a => a.classList.remove('active'));
                        h.querySelector('.fs-sort-arrow').classList.add('active');
                        h.querySelector('.fs-sort-arrow').textContent = sortDir === -1 ? '\u25BC' : '\u25B2';
                        document.querySelectorAll('div.tt-stats-estimate').forEach(r => r.classList.add('fs-hidden'));
                        sortRows();
                    });
                });

                document.querySelectorAll('ul.table-header .table-cell:not(.fs-col-header)').forEach(h => {
                    h.addEventListener('click', () => clearSort());
                });
            }

            function getMemberRows() {
                return Array.from(document.querySelectorAll('li.table-row'))
                    .filter(r => r.querySelector('a[href*="profiles.php?XID="]'));
            }
            function getMemberId(row) {
                const link = row.querySelector('a[href*="profiles.php?XID="]');
                if (!link) return null;
                return link.href.split('XID=')[1].split('&')[0];
            }

            function injectCells(row, memberId, visible = false) {
                row.querySelectorAll('.fs-cell').forEach(c => c.remove());
                const activityCell = document.createElement('li');
                activityCell.className = 'table-cell fs-cell loading';
                activityCell.dataset.member = memberId;
                activityCell.dataset.type = 'activity';
                activityCell.textContent = '...';
                activityCell.style.display = visible ? '' : 'none';

                const xanaxCell = document.createElement('li');
                xanaxCell.className = 'table-cell fs-cell loading';
                xanaxCell.dataset.member = memberId;
                xanaxCell.dataset.type = 'xanax';
                xanaxCell.textContent = '...';
                xanaxCell.style.display = visible ? '' : 'none';

                row.appendChild(activityCell);
                row.appendChild(xanaxCell);
            }

            function updateCell(memberId, type, value) {
                const cell = document.querySelector(`.fs-cell[data-member="${memberId}"][data-type="${type}"]`);
                if (!cell) return;
                cell.classList.remove('loading', 'error');
                cell.style.display = '';
                cell.textContent = value !== null ? value : '\u2014';
            }

            function sortRows() {
                if (!sortCol) return;
                const container = document.querySelector('ul.table-body');
                if (!container) return;
                const allRows = getMemberRows();
                const memberRows = allRows.filter(r => getMemberId(r) && memberData[getMemberId(r)]);
                const otherRows = allRows.filter(r => !getMemberId(r) || !memberData[getMemberId(r)]);
                memberRows.sort((a, b) => {
                    const aId = getMemberId(a);
                    const bId = getMemberId(b);
                    const aVal = sortCol === 'activity' ? memberData[aId].activity : memberData[aId].xanax;
                    const bVal = sortCol === 'activity' ? memberData[bId].activity : memberData[bId].xanax;
                    return (aVal - bVal) * sortDir;
                });
                memberRows.forEach(r => container.appendChild(r));
                otherRows.forEach(r => container.appendChild(r));
            }

            function clearSort() {
                sortCol = null;
                document.querySelectorAll('div.tt-stats-estimate').forEach(r => r.classList.remove('fs-hidden'));
                panel.querySelectorAll('.fs-sort-arrow').forEach(a => {
                    a.classList.remove('active');
                    a.textContent = '\u25B2\u25BC';
                });
            }

            async function loadFactionStats() {
                const { days } = FACTION_PERIODS[factionPeriodIdx];
                const cacheKey = getFactionCacheKey(factionId, days);
                const cached = GM_getValue(cacheKey, null);

                const rows = getMemberRows();
                rows.forEach(row => {
                    const id = getMemberId(row);
                    if (id) injectCells(row, id);
                });

                if (isCacheValid(cached)) {
                    const data = JSON.parse(cached);
                    memberData = data.members;
                    const cacheAge = Math.round((Date.now() - data.timestamp) / 60000);
                    panel.querySelector('.fs-body').innerHTML = `
                            <div class="fs-cache-note">Loaded from cache (${cacheAge} min ago) \u2014 refreshes after 24 hrs</div>
                            <div class="fs-legend"><span>A</span> = Total activity (hrs) &nbsp;|&nbsp; <span>X</span> = Xanax taken</div>
                        `;
                    rows.forEach(row => {
                        const id = getMemberId(row);
                        if (!id || !memberData[id]) return;
                        updateCell(id, 'activity', memberData[id].activity.toFixed(1));
                        updateCell(id, 'xanax', memberData[id].xanax);
                    });
                    injectHeaders(memberTable, true);
                    document.querySelectorAll('.fs-cell').forEach(c => c.style.display = '');
                    return;
                }

                panel.querySelector('.fs-body').innerHTML = `
                        <div class="fs-progress" id="fs-progress">Loading 0 / 0 requests...</div>
                        <div class="fs-progress-bar-wrap"><div class="fs-progress-bar" id="fs-progress-bar"></div></div>
                    `;

                const memberIds = rows.map(getMemberId).filter(Boolean);
                const total = memberIds.length;
                let done = 0;

                const d = new Date();
                d.setSeconds(d.getSeconds() - days * 86400);
                const timestamp = ~~(d / 1000);

                const progressEl = panel.querySelector('#fs-progress');
                const progressBar = panel.querySelector('#fs-progress-bar');

                function updateProgress() {
                    done++;
                    const pct = Math.round((done / (total * 2)) * 100);
                    if (progressEl) progressEl.textContent = `Loading ${done} / ${total * 2} requests...`;
                    if (progressBar) progressBar.style.width = pct + '%';
                }

                const tasks = memberIds.flatMap(memberId => [
                    async () => {
                        const r = await fetchMemberStats(memberId, timestamp, 'timeplayed,xantaken');
                        updateProgress();
                        return { memberId, type: 'hist', data: r };
                    },
                    async () => {
                        const r = await fetchMemberStats(memberId, null, 'timeplayed,xantaken');
                        updateProgress();
                        return { memberId, type: 'curr', data: r };
                    }
                ]);

                const hist = {};
                const curr = {};

                const results = await concurrentLimit(tasks, 3, 2500);

                results.forEach(r => {
                    if (r.type === 'hist') hist[r.memberId] = r.data;
                    else curr[r.memberId] = r.data;
                });

                injectHeaders(memberTable, true);

                memberIds.forEach(memberId => {
                    const h = hist[memberId] || {};
                    const c = curr[memberId] || {};
                    const activitySecs = Math.max(0, (c.timeplayed || 0) - (h.timeplayed || 0));
                    const activityHrs = activitySecs / 3600;
                    const xanax = Math.max(0, (c.xantaken || 0) - (h.xantaken || 0));

                    memberData[memberId] = { activity: activityHrs, xanax };
                    updateCell(memberId, 'activity', activityHrs.toFixed(1));
                    updateCell(memberId, 'xanax', xanax);
                });

                GM_setValue(cacheKey, JSON.stringify({
                    timestamp: Date.now(),
                    members: memberData
                }));

                panel.querySelector('.fs-body').innerHTML = `
                        <div class="fs-cache-note">Loaded fresh data \u2014 refreshes after 24 hrs</div>
                        <div class="fs-legend"><span>A</span> = Total activity (hrs) &nbsp;|&nbsp; <span>X</span> = Xanax taken</div>
                    `;
            }
        }, 300);
    }
}
});
