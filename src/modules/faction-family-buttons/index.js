import { API_BASE, escHtml } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Faction Family Buttons
// ════════════════════════════════════════════════════════════════════════

registerModule('faction-family-buttons', {
name: 'Faction Family Buttons',
version: '1.0',
description: 'Quick-nav buttons for faction family, friends, revivers, and mercs on faction pages.',
pages: ['/factions.php'],
guide,

init() {

    const dssApiKey = Storage.getSettings().apiKey;

    // PDA cleanup: remove all stale DOM elements from previous page load
    document.querySelectorAll('#ffb-wrap, #ffb-nav-buttons').forEach(el => el.remove());

    // ─── Settings & State ─────────────────────────────────────────────
    function loadSettings() {
        try { return JSON.parse(GM_getValue('ffb-settings', '{}')); }
        catch (_) { return {}; }
    }
    function saveSettings(s) { GM_setValue('ffb-settings', JSON.stringify(s)); }

    function loadFactions() {
        try { return JSON.parse(GM_getValue('ffb-factions', '[]')); }
        catch (_) { return []; }
    }
    function saveFactions(f) { GM_setValue('ffb-factions', JSON.stringify(f)); }

    function loadCollapseState() {
        try { return JSON.parse(GM_getValue('ffb-collapse', '{}')); }
        catch (_) { return {}; }
    }
    function saveCollapseState(s) { GM_setValue('ffb-collapse', JSON.stringify(s)); }

    let settings = loadSettings();
    let factions = loadFactions();
    let collapseState = loadCollapseState();

    // Sync API key from unified manager
    if (dssApiKey && dssApiKey !== settings.apiKey) {
        settings.apiKey = dssApiKey;
        saveSettings(settings);
    }

    // ─── Page Detection ───────────────────────────────────────────────
    function shouldShowOnPage() {
        const url = new URL(window.location.href);
        if (url.pathname !== '/factions.php') return false;
        const step = url.searchParams.get('step');
        const type = url.searchParams.get('type');
        const hash = url.hash;

        if (!settings.apiKey) return true;

        if (step === 'your' && type === '1') {
            if (hash === '' || hash === '#/' || hash === '#') return true;
            if (hash === '#/war/chain' || hash === '#/war/rank') return true;
        }

        if (step === 'profile') {
            const profileId = url.searchParams.get('ID');
            if (factions.some(f => f.id === profileId && f.type === 'family')) return true;
            if (settings.showOnAllProfiles) {
                if (factions.some(f => f.id === profileId)) return true;
            }
        }

        return false;
    }

    // ─── Styles ───────────────────────────────────────────────────────
    GM_addStyle(`
            #ffb-wrap { width:100%; box-sizing:border-box; font-family:Arial,Helvetica,sans-serif; margin-bottom:5px; }
            #ffb-config { background:#1e2022; border:1px solid #333; border-radius:5px; margin-bottom:8px; overflow:visible; }
            #ffb-config-header { display:flex; align-items:center; justify-content:center; gap:6px; padding:5px 12px; cursor:pointer; user-select:none; border-bottom:1px solid transparent; transition:background .15s; border-radius:5px; }
            #ffb-config-header:hover { background:rgba(255,255,255,0.03); }
            #ffb-config.config-open #ffb-config-header { border-bottom-color:#333; border-radius:5px 5px 0 0; }
            .ffb-header-label { color:#888; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; }
            .ffb-header-arrow { color:#555; font-size:8px; transition:transform .2s; }
            .ffb-header-arrow.collapsed { transform:rotate(-90deg); }
            #ffb-config-body { overflow:visible; transition:max-height .3s ease,opacity .25s ease; }
            #ffb-config-body.ffb-expanded { max-height:2000px; opacity:1; }
            #ffb-config-body.ffb-collapsed { max-height:0; opacity:0; overflow:hidden; }
            .ffb-row { display:flex; align-items:center; gap:6px; padding:5px 10px; width:100%; box-sizing:border-box; }
            .ffb-row-break { width:calc(100% - 20px); height:1px; background:#333; margin:0 10px; }
            .ffb-label { color:#777; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap; }
            .ffb-btn { padding:2px 8px; border-radius:3px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:#bbb; font-size:11px; cursor:pointer; transition:background .15s,color .15s,border-color .15s; font-family:inherit; line-height:1.6; }
            .ffb-btn:hover { background:rgba(255,255,255,0.1); color:#fff; }
            .ffb-btn.active { background:rgba(80,180,80,0.25); border-color:rgba(80,180,80,0.6); color:#7ccc7c; }
            .ffb-btn.ffb-edit-active { background:rgba(200,160,80,0.2)!important; border-color:rgba(200,160,80,0.6)!important; color:#e8c96a!important; }
            .ffb-input { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:3px; color:#aaa; font-size:11px; font-family:inherit; padding:3px 6px; transition:border-color .15s,color .15s; }
            .ffb-input:focus { outline:none; border-color:rgba(74,144,226,0.6); color:#ccc; }
            .ffb-input::placeholder { color:#555; font-style:italic; }
            .ffb-faction-tag { padding:2px 8px; border-radius:3px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:#999; font-size:10px; font-family:inherit; line-height:1.5; display:inline-block; }
            .ffb-faction-tag[data-type="family"] { border-left:2px solid #4a7a2e; }
            .ffb-faction-tag[data-type="friend"] { border-left:2px solid #4a90e2; }
            .ffb-faction-tag[data-type="reviver"] { border-left:2px solid #c8a832; }
            .ffb-faction-tag[data-type="merc"] { border-left:2px solid #c44; }
            #ffb-search-wrap { position:relative; flex:1; min-width:0; }
            #ffb-search-input { width:100%; box-sizing:border-box; }
            #ffb-search-dropdown { position:absolute; top:100%; left:0; right:0; background:#2a2c2e; border:1px solid #444; border-radius:4px; max-height:220px; overflow-y:auto; z-index:99999; box-shadow:0 8px 24px rgba(0,0,0,0.5); margin-top:2px; display:none; }
            #ffb-search-dropdown.show { display:block; }
            .ffb-suggestion { padding:6px 10px; cursor:pointer; border-bottom:1px solid #333; color:#ccc; font-size:11px; display:flex; justify-content:space-between; align-items:center; transition:background .15s; }
            .ffb-suggestion:hover { background:rgba(74,144,226,0.15); }
            .ffb-suggestion:last-child { border-bottom:none; }
            .ffb-suggestion-name { font-weight:500; }
            .ffb-suggestion-id { color:#666; font-size:10px; }
            #ffb-edit-panel { width:100%; box-sizing:border-box; display:flex; flex-direction:column; gap:3px; background:rgba(0,0,0,0.2); border-top:1px solid #333; overflow:hidden; transition:max-height .3s ease,opacity .25s ease,padding .3s ease; }
            #ffb-edit-panel.ffb-panel-expanded { max-height:1200px; opacity:1; padding:6px 10px; }
            #ffb-edit-panel.ffb-panel-collapsed { max-height:0; opacity:0; padding:0 10px; border-top-color:transparent; }
            .ffb-edit-row { display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:3px; background:rgba(255,255,255,0.03); transition:background .1s; }
            .ffb-edit-row:hover { background:rgba(255,255,255,0.06); }
            .ffb-edit-row.ffb-edit-row-hidden { opacity:0.4; }
            .ffb-edit-move { background:none; border:1px solid rgba(255,255,255,0.1); border-radius:3px; cursor:pointer; font-size:10px; padding:1px 4px; line-height:1; color:#777; transition:all .15s; flex-shrink:0; }
            .ffb-edit-move:hover { background:rgba(255,255,255,0.08); color:#ccc; }
            .ffb-edit-move:disabled { opacity:0.2; cursor:default; pointer-events:none; }
            .ffb-edit-name { flex:1; min-width:0; }
            .ffb-edit-type { width:70px; flex-shrink:0; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:3px; color:#aaa; font-size:10px; padding:2px 4px; font-family:inherit; }
            .ffb-edit-type:focus { outline:none; border-color:rgba(74,144,226,0.5); }
            .ffb-edit-type option { background:#222; color:#ccc; }
            .ffb-edit-eye,.ffb-edit-del { background:none; border:none; cursor:pointer; font-size:14px; padding:0 2px; line-height:1; transition:opacity .15s; flex-shrink:0; }
            .ffb-edit-eye-on { color:#5cdb5c; opacity:0.8; }
            .ffb-edit-eye-on:hover { opacity:1; }
            .ffb-edit-eye-off { color:#555; opacity:0.5; }
            .ffb-edit-eye-off:hover { opacity:0.8; }
            .ffb-edit-del { color:#ef4444; opacity:0.6; }
            .ffb-edit-del:hover { opacity:1; }
            .ffb-button-section { background:#1e2022; border:1px solid #333; border-radius:5px; margin-bottom:6px; overflow:hidden; }
            .ffb-section-header { display:flex; align-items:center; justify-content:center; gap:6px; padding:4px 12px; cursor:pointer; user-select:none; transition:background .15s; border-bottom:1px solid transparent; }
            .ffb-section-header:hover { background:rgba(255,255,255,0.03); }
            .ffb-button-section.section-open .ffb-section-header { border-bottom-color:#333; }
            .ffb-section-label { font-size:10px; text-transform:uppercase; letter-spacing:0.1em; font-weight:600; }
            .ffb-section-label[data-type="family"] { color:#5a9a3e; }
            .ffb-section-label[data-type="friend"] { color:#4a90e2; }
            .ffb-section-label[data-type="reviver"] { color:#c8a832; }
            .ffb-section-label[data-type="merc"] { color:#c44; }
            .ffb-section-arrow { color:#555; font-size:8px; transition:transform .2s; }
            .ffb-section-arrow.collapsed { transform:rotate(-90deg); }
            .ffb-section-count { color:#555; font-size:9px; }
            .ffb-section-body { overflow:hidden; transition:max-height .25s ease,opacity .2s ease; }
            .ffb-section-body.ffb-expanded { max-height:500px; opacity:1; }
            .ffb-section-body.ffb-collapsed { max-height:0; opacity:0; }
            .ffb-button-grid { display:flex; flex-wrap:wrap; gap:6px; padding:8px 10px; }
            .ffb-nav-btn { color:#ddd; border-radius:4px; text-decoration:none; font-weight:600; cursor:pointer; transition:opacity .1s,filter .1s,background .15s; display:flex; align-items:center; justify-content:center; height:36px; font-size:12px; padding:0 14px; box-sizing:border-box; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border:1px solid transparent; }
            .ffb-nav-btn:hover { filter:brightness(1.2); }
            .ffb-nav-btn.ffb-current { opacity:0.5; pointer-events:none; }
            .ffb-nav-btn[data-type="family"] { background:linear-gradient(135deg,#2a4a1e 0%,#1a2e14 100%); border-color:#3a5a2e; }
            .ffb-nav-btn[data-type="friend"] { background:linear-gradient(135deg,#1e3a5a 0%,#142a3e 100%); border-color:#2a4a6a; }
            .ffb-nav-btn[data-type="reviver"] { background:linear-gradient(135deg,#4a3e1a 0%,#3a2e14 100%); border-color:#5a4e2a; }
            .ffb-nav-btn[data-type="merc"] { background:linear-gradient(135deg,#4a1e1e 0%,#3a1414 100%); border-color:#5a2a2a; }
            .ffb-bpr-wrap { display:flex; align-items:center; gap:4px; }
            .ffb-bpr-btn { width:20px; height:20px; border-radius:3px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:#888; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; font-family:inherit; }
            .ffb-bpr-btn:hover { background:rgba(255,255,255,0.1); color:#ccc; }
            .ffb-bpr-btn.active { background:rgba(80,180,80,0.25); border-color:rgba(80,180,80,0.6); color:#7ccc7c; }
            .ffb-toggle-wrap { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
            .ffb-toggle { width:28px; height:16px; border-radius:8px; background:#444; position:relative; transition:background .2s; flex-shrink:0; }
            .ffb-toggle.on { background:rgba(80,180,80,0.6); }
            .ffb-toggle::after { content:''; position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:#ccc; transition:transform .2s; }
            .ffb-toggle.on::after { transform:translateX(12px); }
        `);

    // ─── Search API ───────────────────────────────────────────────────
    let searchTimer = null;

    async function searchFactions(query) {
        if (!settings.apiKey || query.length < 3) return [];
        try {
            const url = new URL(`${API_BASE}/faction/search`);
            url.searchParams.set('name', query);
            url.searchParams.set('limit', '10');
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json', 'Authorization': 'ApiKey ' + settings.apiKey }
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data?.search || []).sort((a, b) => a.name.localeCompare(b.name));
        } catch (_) { return []; }
    }

    async function fetchMyFactionId() {
        if (!settings.apiKey) return;
        try {
            const res = await fetch(`${API_BASE}/faction/basic`, {
                method: 'GET',
                headers: { 'Accept': 'application/json', 'Authorization': 'ApiKey ' + settings.apiKey }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data?.basic?.id) {
                settings.myFactionId = data.basic.id.toString();
                saveSettings(settings);
            }
        } catch (_) { /* ignore */ }
    }

    // ─── Helpers ──────────────────────────────────────────────────────
    function getFactionLabel(f) { return f.displayName || f.name; }

    function getCurrentFactionId() {
        const url = new URL(window.location.href);
        if (url.searchParams.get('step') === 'profile') return url.searchParams.get('ID');
        return settings.myFactionId || null;
    }

    function refreshAfterEdit() {
        renderFactionTags(document.getElementById('ffb-tags-row'));
        injectButtons();
    }

    // ─── Config Panel ─────────────────────────────────────────────────
    let configVisible = GM_getValue('ffb-config-visible', false);
    let editMode = false;

    function buildConfigPanel() {
        const config = document.createElement('div');
        config.id = 'ffb-config';
        if (configVisible) config.classList.add('config-open');

        const header = document.createElement('div');
        header.id = 'ffb-config-header';
        header.innerHTML = `<span class="ffb-header-arrow ${configVisible ? '' : 'collapsed'}">\u25BC</span><span class="ffb-header-label">Faction Buttons</span>`;
        header.addEventListener('click', () => {
            configVisible = !configVisible;
            GM_setValue('ffb-config-visible', configVisible);
            body.classList.toggle('ffb-expanded', configVisible);
            body.classList.toggle('ffb-collapsed', !configVisible);
            config.classList.toggle('config-open', configVisible);
            header.querySelector('.ffb-header-arrow').classList.toggle('collapsed', !configVisible);
            if (!configVisible && editMode) {
                editMode = false;
                editBtn.classList.remove('ffb-edit-active');
                editBtn.textContent = '\u270E';
                const panel = document.getElementById('ffb-edit-panel');
                if (panel) {
                    panel.classList.remove('ffb-panel-expanded');
                    panel.classList.add('ffb-panel-collapsed');
                    panel.addEventListener('transitionend', () => panel.remove(), { once: true });
                    setTimeout(() => { if (panel.parentNode) panel.remove(); }, 400);
                }
            }
            const sr = document.getElementById('ffb-search-row');
            const tr = document.getElementById('ffb-tags-row');
            if (sr) sr.style.display = 'none';
            if (tr) tr.style.display = 'none';
        });
        config.appendChild(header);

        const body = document.createElement('div');
        body.id = 'ffb-config-body';
        body.className = configVisible ? 'ffb-expanded' : 'ffb-collapsed';

        // Top row: All Profiles toggle | Per Row
        const topRow = document.createElement('div');
        topRow.className = 'ffb-row';
        topRow.style.justifyContent = 'space-between';

        // Left: API status indicator
        const apiLeft = document.createElement('div');
        apiLeft.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const apiLabel = document.createElement('span');
        apiLabel.className = 'ffb-label';
        apiLabel.style.minWidth = '55px';
        apiLabel.textContent = 'API';
        const apiStatus = document.createElement('span');
        apiStatus.className = 'ffb-btn' + (settings.apiKey ? ' active' : '');
        apiStatus.textContent = settings.apiKey ? '\u2714' : '\u2716';
        apiStatus.title = settings.apiKey ? 'API key configured via DSS Settings' : 'No API key — configure in DSS Settings';
        apiStatus.style.cssText = 'font-size:11px;padding:1px 6px;cursor:default;';
        apiLeft.appendChild(apiLabel);
        apiLeft.appendChild(apiStatus);
        topRow.appendChild(apiLeft);

        // Center: All Profiles toggle
        const profileToggleWrap = document.createElement('div');
        profileToggleWrap.className = 'ffb-toggle-wrap';
        profileToggleWrap.title = 'Show buttons on all configured faction profile pages (not just family)';
        const profileToggleLabel = document.createElement('span');
        profileToggleLabel.className = 'ffb-label';
        profileToggleLabel.textContent = 'All Profiles';
        const profileToggle = document.createElement('div');
        profileToggle.className = 'ffb-toggle' + (settings.showOnAllProfiles ? ' on' : '');
        profileToggleWrap.appendChild(profileToggleLabel);
        profileToggleWrap.appendChild(profileToggle);
        profileToggleWrap.addEventListener('click', () => {
            settings.showOnAllProfiles = !settings.showOnAllProfiles;
            saveSettings(settings);
            profileToggle.classList.toggle('on', settings.showOnAllProfiles);
        });
        topRow.appendChild(profileToggleWrap);

        // Right: Per Row
        const bprRight = document.createElement('div');
        const isMobile = window.innerWidth <= 784;
        bprRight.style.cssText = 'display:' + (isMobile ? 'none' : 'flex') + ';align-items:center;gap:6px;';
        const bprLabel = document.createElement('span');
        bprLabel.className = 'ffb-label';
        bprLabel.textContent = 'Per Row';
        const bprWrap = document.createElement('div');
        bprWrap.className = 'ffb-bpr-wrap';
        [2, 3, 4, 5].forEach(n => {
            const btn = document.createElement('button');
            btn.className = 'ffb-bpr-btn' + ((settings.buttonsPerRow || 4) === n ? ' active' : '');
            btn.textContent = n;
            btn.addEventListener('click', () => {
                settings.buttonsPerRow = n;
                saveSettings(settings);
                bprWrap.querySelectorAll('.ffb-bpr-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                injectButtons();
            });
            bprWrap.appendChild(btn);
        });
        bprRight.appendChild(bprLabel);
        bprRight.appendChild(bprWrap);
        topRow.appendChild(bprRight);

        body.appendChild(topRow);
        body.appendChild(Object.assign(document.createElement('div'), { className: 'ffb-row-break' }));

        // Factions label + Edit button (always visible)
        const facRow = document.createElement('div');
        facRow.className = 'ffb-row';
        const facLabel = document.createElement('span');
        facLabel.className = 'ffb-label';
        facLabel.style.cssText = 'flex-shrink:0;min-width:55px;';
        facLabel.textContent = 'Factions';
        facRow.appendChild(facLabel);
        const editBtn = document.createElement('button');
        editBtn.className = 'ffb-btn';
        editBtn.textContent = '\u270E';
        editBtn.title = 'Edit factions';
        editBtn.style.flexShrink = '0';
        facRow.appendChild(editBtn);
        body.appendChild(facRow);

        // Search row (hidden until edit mode)
        const searchRow = document.createElement('div');
        searchRow.className = 'ffb-row';
        searchRow.id = 'ffb-search-row';
        searchRow.style.display = 'none';
        const searchWrap = document.createElement('div');
        searchWrap.id = 'ffb-search-wrap';
        const searchInput = document.createElement('input');
        searchInput.id = 'ffb-search-input';
        searchInput.className = 'ffb-input';
        searchInput.type = 'text';
        searchInput.placeholder = 'Search factions to add...';
        searchInput.style.width = '100%';
        searchInput.addEventListener('keydown', e => e.stopPropagation());
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const q = searchInput.value.trim();
            if (q.length < 3) { closeDropdown(); return; }
            searchTimer = setTimeout(async () => {
                const results = await searchFactions(q);
                renderDropdown(results);
            }, 300);
        });
        const dropdown = document.createElement('div');
        dropdown.id = 'ffb-search-dropdown';
        searchWrap.appendChild(searchInput);
        searchWrap.appendChild(dropdown);
        searchRow.appendChild(searchWrap);
        body.appendChild(searchRow);

        // Tags row (hidden until edit mode)
        const tagsRow = document.createElement('div');
        tagsRow.className = 'ffb-row';
        tagsRow.id = 'ffb-tags-row';
        tagsRow.style.cssText = 'flex-wrap:wrap;padding:2px 10px 5px 10px;gap:4px;display:none;';
        renderFactionTags(tagsRow);
        body.appendChild(tagsRow);

        config.appendChild(body);

        // Wire edit button
        editBtn.addEventListener('click', () => {
            editMode = !editMode;
            editBtn.classList.toggle('ffb-edit-active', editMode);
            editBtn.textContent = editMode ? '\u2714' : '\u270E';
            const sr = document.getElementById('ffb-search-row');
            const tr = document.getElementById('ffb-tags-row');
            if (sr) sr.style.display = editMode ? 'flex' : 'none';
            if (tr) tr.style.display = editMode ? 'flex' : 'none';

            let panel = document.getElementById('ffb-edit-panel');
            if (editMode) {
                if (!panel) {
                    panel = buildEditPanel();
                    config.appendChild(panel);
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            panel.classList.remove('ffb-panel-collapsed');
                            panel.classList.add('ffb-panel-expanded');
                        });
                    });
                }
            } else {
                if (panel) {
                    panel.classList.remove('ffb-panel-expanded');
                    panel.classList.add('ffb-panel-collapsed');
                    panel.addEventListener('transitionend', () => panel.remove(), { once: true });
                    setTimeout(() => { if (panel.parentNode) panel.remove(); }, 400);
                }
                refreshAfterEdit();
            }
        });

        return config;
    }

    function renderFactionTags(container) {
        if (!container) return;
        container.innerHTML = '';
        const visible = factions.filter(f => !f.hidden);
        if (visible.length === 0) {
            const hint = document.createElement('span');
            hint.className = 'ffb-label';
            hint.style.color = '#555';
            hint.textContent = 'No factions added. Use search to add.';
            container.appendChild(hint);
            return;
        }
        visible.forEach(f => {
            const tag = document.createElement('span');
            tag.className = 'ffb-faction-tag';
            tag.dataset.type = f.type || 'family';
            tag.textContent = getFactionLabel(f);
            tag.title = `${getFactionLabel(f)} [${f.id}] \u2014 ${f.type || 'family'}`;
            container.appendChild(tag);
        });
    }

    function renderDropdown(results) {
        const dropdown = document.getElementById('ffb-search-dropdown');
        if (!dropdown) return;
        if (results.length === 0) {
            dropdown.innerHTML = '<div class="ffb-suggestion" style="color:#666;cursor:default;">No results found</div>';
            dropdown.classList.add('show');
            return;
        }
        dropdown.innerHTML = results.map(r =>
            `<div class="ffb-suggestion" data-id="${r.id}" data-name="${escHtml(r.name)}">
                    <span class="ffb-suggestion-name">${escHtml(r.name)}</span>
                    <span class="ffb-suggestion-id">[${r.id}]</span>
                </div>`
        ).join('');
        dropdown.classList.add('show');
        dropdown.querySelectorAll('.ffb-suggestion[data-id]').forEach(el => {
            el.addEventListener('click', () => {
                addFaction(el.dataset.name, el.dataset.id);
                closeDropdown();
                document.getElementById('ffb-search-input').value = '';
            });
        });
    }

    function closeDropdown() {
        const d = document.getElementById('ffb-search-dropdown');
        if (d) d.classList.remove('show');
    }

    function addFaction(name, id) {
        if (factions.some(f => f.id === id)) return;
        factions.push({ name, id, displayName: name, type: 'family', hidden: false });
        saveFactions(factions);
        refreshAfterEdit();
        const panel = document.getElementById('ffb-edit-panel');
        if (panel) rebuildEditRows(panel);
    }

    // ─── Edit Panel ───────────────────────────────────────────────────
    function buildEditPanel() {
        const panel = document.createElement('div');
        panel.id = 'ffb-edit-panel';
        panel.className = 'ffb-panel-collapsed';
        rebuildEditRows(panel);
        return panel;
    }

    function rebuildEditRows(panel) {
        panel.innerHTML = '';
        const typeOrder = ['family', 'friend', 'reviver', 'merc'];
        const typeNames = { family: 'Family', friend: 'Friends', reviver: 'Revivers', merc: 'Mercs' };

        typeOrder.forEach(type => {
            const groupFactions = factions.filter(f => (f.type || 'family') === type);
            if (groupFactions.length === 0) return;

            const groupHeader = document.createElement('div');
            groupHeader.style.cssText = 'padding:4px 4px 2px;margin-top:4px;border-bottom:1px solid #333;';
            const groupLabel = document.createElement('span');
            groupLabel.className = 'ffb-section-label';
            groupLabel.dataset.type = type;
            groupLabel.textContent = `${typeNames[type]} (${groupFactions.length})`;
            groupHeader.appendChild(groupLabel);
            panel.appendChild(groupHeader);

            groupFactions.forEach(f => {
                const globalIdx = factions.indexOf(f);
                const groupIndices = groupFactions.map(gf => factions.indexOf(gf));
                const posInGroup = groupFactions.indexOf(f);

                const row = document.createElement('div');
                row.className = 'ffb-edit-row' + (f.hidden ? ' ffb-edit-row-hidden' : '');

                const upBtn = document.createElement('button');
                upBtn.className = 'ffb-edit-move'; upBtn.textContent = '\u25B2'; upBtn.disabled = posInGroup === 0;
                upBtn.addEventListener('click', () => {
                    const swapIdx = groupIndices[posInGroup - 1];
                    [factions[swapIdx], factions[globalIdx]] = [factions[globalIdx], factions[swapIdx]];
                    saveFactions(factions); rebuildEditRows(panel); refreshAfterEdit();
                });
                row.appendChild(upBtn);

                const downBtn = document.createElement('button');
                downBtn.className = 'ffb-edit-move'; downBtn.textContent = '\u25BC'; downBtn.disabled = posInGroup === groupFactions.length - 1;
                downBtn.addEventListener('click', () => {
                    const swapIdx = groupIndices[posInGroup + 1];
                    [factions[globalIdx], factions[swapIdx]] = [factions[swapIdx], factions[globalIdx]];
                    saveFactions(factions); rebuildEditRows(panel); refreshAfterEdit();
                });
                row.appendChild(downBtn);

                const nameInput = document.createElement('input');
                nameInput.className = 'ffb-input ffb-edit-name'; nameInput.type = 'text';
                nameInput.value = f.displayName || ''; nameInput.placeholder = f.name;
                nameInput.addEventListener('keydown', e => e.stopPropagation());
                nameInput.addEventListener('change', () => { f.displayName = nameInput.value.trim() || f.name; saveFactions(factions); refreshAfterEdit(); });
                nameInput.addEventListener('blur', () => nameInput.dispatchEvent(new Event('change')));
                row.appendChild(nameInput);

                const typeSelect = document.createElement('select');
                typeSelect.className = 'ffb-edit-type';
                ['family', 'friend', 'reviver', 'merc'].forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t; opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
                    if ((f.type || 'family') === t) opt.selected = true;
                    typeSelect.appendChild(opt);
                });
                typeSelect.addEventListener('change', () => { f.type = typeSelect.value; saveFactions(factions); rebuildEditRows(panel); refreshAfterEdit(); });
                row.appendChild(typeSelect);

                const eye = document.createElement('button');
                eye.className = 'ffb-edit-eye ' + (f.hidden ? 'ffb-edit-eye-off' : 'ffb-edit-eye-on');
                eye.textContent = f.hidden ? '\uD83D\uDEAB' : '\uD83D\uDC41'; eye.title = f.hidden ? 'Show' : 'Hide';
                eye.addEventListener('click', () => {
                    f.hidden = !f.hidden; saveFactions(factions);
                    eye.className = 'ffb-edit-eye ' + (f.hidden ? 'ffb-edit-eye-off' : 'ffb-edit-eye-on');
                    eye.textContent = f.hidden ? '\uD83D\uDEAB' : '\uD83D\uDC41'; eye.title = f.hidden ? 'Show' : 'Hide';
                    row.classList.toggle('ffb-edit-row-hidden', f.hidden); refreshAfterEdit();
                });
                row.appendChild(eye);

                const del = document.createElement('button');
                del.className = 'ffb-edit-del'; del.textContent = '\u2716'; del.title = 'Remove faction';
                del.addEventListener('click', () => { factions.splice(globalIdx, 1); saveFactions(factions); rebuildEditRows(panel); refreshAfterEdit(); });
                row.appendChild(del);

                panel.appendChild(row);
            });
        });

        if (factions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ffb-label';
            empty.style.cssText = 'padding:12px;text-align:center;color:#555;';
            empty.textContent = 'No factions added yet.';
            panel.appendChild(empty);
        }

        const resetRow = document.createElement('div');
        resetRow.style.cssText = 'display:flex;justify-content:flex-end;padding-top:4px;border-top:1px solid #333;margin-top:2px;';
        const resetBtn = document.createElement('button');
        resetBtn.className = 'ffb-btn';
        resetBtn.textContent = 'Reset All';
        resetBtn.title = 'Clear all factions and settings';
        resetBtn.style.cssText = 'font-size:10px;padding:2px 10px;color:#ef4444;border-color:rgba(239,68,68,0.3);';
        resetBtn.addEventListener('click', () => {
            if (!confirm('Reset all faction button settings?\n\nThis will remove all factions.')) return;
            factions = [];
            settings = { apiKey: dssApiKey, myFactionId: settings.myFactionId };
            collapseState = {};
            saveFactions(factions); saveSettings(settings); saveCollapseState(collapseState);
            GM_setValue('ffb-config-visible', false);
            const navBtns = document.getElementById('ffb-nav-buttons');
            if (navBtns) navBtns.remove();
            const wrap = document.getElementById('ffb-wrap');
            if (wrap) { wrap.innerHTML = ''; configVisible = false; editMode = false; wrap.appendChild(buildConfigPanel()); }
        });
        resetRow.appendChild(resetBtn);
        panel.appendChild(resetRow);
    }

    // ─── Button Injection ─────────────────────────────────────────────
    function injectButtons() {
        const existing = document.getElementById('ffb-nav-buttons');
        if (existing) existing.remove();
        const visibleFactions = factions.filter(f => !f.hidden);
        if (visibleFactions.length === 0) return;

        const groups = {};
        const typeOrder = ['family', 'friend', 'reviver', 'merc'];
        visibleFactions.forEach(f => { const t = f.type || 'family'; if (!groups[t]) groups[t] = []; groups[t].push(f); });

        const typeNames = { family: 'Family', friend: 'Friends', reviver: 'Revivers', merc: 'Mercs' };
        const currentFactionId = getCurrentFactionId();
        const isMobile = window.innerWidth <= 784;
        const cols = isMobile ? 2 : (settings.buttonsPerRow || 4);

        const wrapper = document.createElement('div');
        wrapper.id = 'ffb-nav-buttons';

        typeOrder.forEach(type => {
            const group = groups[type];
            if (!group || group.length === 0) return;
            const collapseKey = `section-${type}`;
            const isCollapsed = collapseState[collapseKey] === true;

            const section = document.createElement('div');
            section.className = 'ffb-button-section' + (isCollapsed ? '' : ' section-open');
            const sHeader = document.createElement('div');
            sHeader.className = 'ffb-section-header';
            sHeader.innerHTML = `<span class="ffb-section-arrow ${isCollapsed ? 'collapsed' : ''}">\u25BC</span><span class="ffb-section-label" data-type="${type}">${typeNames[type] || type}</span><span class="ffb-section-count">(${group.length})</span>`;
            const sBody = document.createElement('div');
            sBody.className = 'ffb-section-body ' + (isCollapsed ? 'ffb-collapsed' : 'ffb-expanded');

            sHeader.addEventListener('click', () => {
                const nowCollapsed = sBody.classList.contains('ffb-expanded');
                sBody.classList.toggle('ffb-expanded', !nowCollapsed);
                sBody.classList.toggle('ffb-collapsed', nowCollapsed);
                section.classList.toggle('section-open', !nowCollapsed);
                sHeader.querySelector('.ffb-section-arrow').classList.toggle('collapsed', nowCollapsed);
                collapseState[collapseKey] = nowCollapsed;
                saveCollapseState(collapseState);
            });

            const grid = document.createElement('div');
            grid.className = 'ffb-button-grid';
            group.forEach(f => {
                const a = document.createElement('a');
                const isOwn = f.id === settings.myFactionId;
                a.href = isOwn ? 'https://www.torn.com/factions.php?step=your&type=1' : `https://www.torn.com/factions.php?step=profile&ID=${f.id}`;
                a.className = 'ffb-nav-btn';
                a.dataset.type = f.type || 'family';
                a.style.flex = `0 0 calc(${100 / cols}% - ${(cols - 1) * 6 / cols}px)`;
                a.textContent = getFactionLabel(f);
                a.title = `${getFactionLabel(f)} [${f.id}]`;
                if (f.id === currentFactionId) a.classList.add('ffb-current');
                if (isOwn) a.addEventListener('click', (e) => { e.preventDefault(); window.location.href = 'https://www.torn.com/factions.php?step=your&type=1#'; });
                grid.appendChild(a);
            });

            sBody.appendChild(grid);
            section.appendChild(sHeader);
            section.appendChild(sBody);
            wrapper.appendChild(section);
        });

        const configEl = document.getElementById('ffb-config');
        if (configEl && configEl.parentNode) configEl.parentNode.insertBefore(wrapper, configEl.nextSibling);
    }

    // ─── Initialization ───────────────────────────────────────────────
    function findMountPoint() {
        return document.querySelector('hr.m-top10')
            || document.querySelector('.faction-info-wrap')
            || document.querySelector('.content-wrapper');
    }

    let mountPollTimer = null;

    function tryInjectFFB() {
        const dominated = shouldShowOnPage();
        const w = document.getElementById('ffb-wrap');
        const b = document.getElementById('ffb-nav-buttons');

        if (!dominated) {
            if (w) w.remove();
            if (b) b.remove();
            if (mountPollTimer) { clearInterval(mountPollTimer); mountPollTimer = null; }
            return;
        }

        if (w && w.querySelector('#ffb-config-header')) return;

        if (mountPollTimer) { clearInterval(mountPollTimer); mountPollTimer = null; }
        mountPollTimer = setInterval(() => {
            const mount = findMountPoint();
            const factionHeaderReady = document.querySelector('div.title-black.m-top10');
            if (mount && factionHeaderReady) {
                clearInterval(mountPollTimer);
                mountPollTimer = null;
                // Avoid duplicates: check if already injected
                if (document.getElementById('ffb-wrap')) return;
                const wrap = document.createElement('div');
                wrap.id = 'ffb-wrap';
                wrap.appendChild(buildConfigPanel());
                mount.insertAdjacentElement('beforebegin', wrap);
                if (factions.filter(f => !f.hidden).length > 0) injectButtons();
            }
        }, 150);
        setTimeout(() => { if (mountPollTimer) { clearInterval(mountPollTimer); mountPollTimer = null; } }, 10000);
    }

    // Fetch faction ID if needed
    if (settings.apiKey && !settings.myFactionId) fetchMyFactionId();

    // Initial injection
    tryInjectFFB();

    // SPA watcher
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            tryInjectFFB();
        }
    }, 500);

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#ffb-search-wrap')) closeDropdown();
    });
}
});
