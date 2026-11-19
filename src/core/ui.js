import { validateApiKey } from './api.js';
import { DSS_VERSION, IS_PDA, escHtml } from './constants.js';
import { Loader } from './loader.js';
import { MODULES, factionAllowed } from './registry.js';
import { Storage } from './storage.js';

// ════════════════════════════════════════════════════════════════════════
// UI — SETTINGS PAGE
// ════════════════════════════════════════════════════════════════════════

const MODULE_ICONS = {
    'faction-family-buttons': '👨‍👩‍👧‍👦',
    'attack-enhancer': '⚔️',
    'crime-prioritiser': '🎯',
    'oc-reminder': '🔫',
    'chain-monitor': '⛓️',
    'custom-background': '🖼️',
    'cash-monitor': '💰',
    'item-price-sorter': '📊',
    'faction-money': '💵',
    'midnight-revive': '⛑️',
    'medx-revive': '🚑',
    'armoury-notes': '🪖',
    'activity-stats': '📈',
    'hospital-revive-filter': '🩺',
    'honor-names': '🔤',
    'tyronic-war': '🛡️'

};
const MODULE_CATEGORIES = {
    'Combat & War':    ['tyronic-war', 'attack-enhancer', 'chain-monitor', 'midnight-revive','medx-revive', 'hospital-revive-filter'],
    'Faction':         ['crime-prioritiser','faction-family-buttons','activity-stats', 'faction-money', 'armoury-notes'],
    'Quality of Life': ['cash-monitor', 'item-price-sorter', 'honor-names', 'custom-background'],
};
const MODGROUPS_KEY = 'dss_modgroups_collapsed';
const moduleCategoryOf = (id) =>
Object.keys(MODULE_CATEGORIES).find(c => MODULE_CATEGORIES[c].includes(id)) || 'Other';
const UI = {
    render() {
        const cw = document.querySelector('.content-wrapper[role="main"]');
        if (!cw) return;

        // Hide Torn's own content rather than deleting it (React owns it)
        const hideChild = (child) => {
            if (child.nodeType !== 1 || child.id === 'dss-page-host') return;
            if (child.dataset.dssPrevDisplay === undefined) {
                child.dataset.dssPrevDisplay = child.style.display || '';
            }
            child.style.display = 'none';
        };
        Array.from(cw.children).forEach(hideChild);

        // Catch anything injected later (TornTools City Items, late React mounts)
        if (!this._hostObserver) {
            this._hostObserver = new MutationObserver(muts => {
                muts.forEach(m => m.addedNodes.forEach(hideChild));
            });
            this._hostObserver.observe(cw, { childList: true });
        }

        let host = document.getElementById('dss-page-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'dss-page-host';
            cw.appendChild(host);
        }

        const settings = Storage.getSettings();
        const defaultTab = settings.privacyAgreed ? 'setup' : 'privacy';

        host.innerHTML = `
            <div class="dss-page">
                <div class="content-title m-bottom10">
                    <h4 class="left">Dsuttz - Script Manager</h4>
                    <span class="dss-ver">v${DSS_VERSION}</span>
                    <div class="clear"></div>
                    <hr class="page-head-delimiter">
                </div>
                <div class="content m-top10">
                   <div class="dss-layout">
                       <div class="dss-sidebar dss-desktop-only" id="dss-sidebar">
                         ${this.renderSidebar(settings, defaultTab)}
                       </div>
                       <div class="dss-mobile-only" id="dss-sidebar-mobile">
                          ${this.renderMobileSidebar(settings, defaultTab)}
                       </div>
                       <div class="dss-main" id="dss-main">
                          ${this.renderPanels(settings, defaultTab)}
                       </div>
                   </div>
                   <div class="dss-footer">
                      <p>Created by <a href="/profiles.php?XID=1561637" class="t-blue">Dsuttz [1561637]</a></p>
                   </div>
                </div>
            </div>`;

        this.injectStyles();
        this.attachListeners();
    },

    clear() {
        if (this._hostObserver) { this._hostObserver.disconnect(); this._hostObserver = null; }
        const host = document.getElementById('dss-page-host');
        if (host) host.remove();
        document.querySelectorAll('[data-dss-prev-display]').forEach(el => {
            el.style.display = el.dataset.dssPrevDisplay;
            delete el.dataset.dssPrevDisplay;
        });
    },

    // ── Sidebar ──
    renderSidebar(settings, activeTab) {
        const valid = settings.apiKeyValid;
        const privacy = settings.privacyAgreed;

        let html = `
            <div class="dss-sb-section">
                 <div class="dss-sb-title">Configuration</div>
                      <button class="dss-sb-item ${activeTab === 'privacy' ? 'active' : ''}" data-tab="privacy">🛡️ Data Privacy</button>
                      ${privacy ? `<button class="dss-sb-item ${activeTab === 'setup' ? 'active' : ''}" data-tab="setup">⚙️ Setup</button>` : ''}
                     ${valid ? `<button class="dss-sb-item ${activeTab === 'modules' ? 'active' : ''}" data-tab="modules">📦 All Modules</button>` : ''}
                 </div>`;

        if (valid) {
            html += `
                 <div class="dss-sb-section">
                 <div class="dss-sb-title">Modules</div>
                     ${this.renderModuleSidebarItems()}
                 </div>`;
        }

        return html;
    },

    renderMobileSidebar(settings, activeTab) {
        const valid = settings.apiKeyValid;
        const privacy = settings.privacyAgreed;

        let options = `<option value="privacy" ${activeTab === 'privacy' ? 'selected' : ''}>🛡️ Data Privacy</option>`;
        if (privacy) {
            options += `<option value="setup" ${activeTab === 'setup' ? 'selected' : ''}>⚙️ Setup</option>`;
        }
        if (valid) {
            options += `<option value="modules" ${activeTab === 'modules' ? 'selected' : ''}>📦 All Modules</option>`;
            options += `<option disabled>── Modules ──</option>`;
            const states = Storage.getModuleStates();
            Object.values(MODULES).forEach(m => {
                if (m.hidden) return;
                if (!factionAllowed(m)) return;
                if (!states[m.id]?.enabled) return;
                const icon = MODULE_ICONS[m.id] || '📄';
                options += `<option value="mod-${m.id}">${icon} ${m.name}</option>`;
            });
        }

        return `<select id="dss-mobile-nav" class="dss-mobile-nav">${options}</select>`;
    },

    renderModuleSidebarItems() {
        const states = Storage.getModuleStates();
        return Object.values(MODULES).map(m => {
            if (m.hidden) return '';
            if (!factionAllowed(m)) return '';
            if (!states[m.id]?.enabled) return '';
            const icon = MODULE_ICONS[m.id] || '📄';
            return `<button class="dss-sb-item" data-tab="mod-${m.id}">${icon} ${m.name}</button>`;
        }).join('');
    },

    // ── Panels ──
    renderPanels(settings, defaultTab) {
        const valid = settings.apiKeyValid;
        const privacy = settings.privacyAgreed;

        let html = `<div class="dss-panel ${defaultTab === 'privacy' ? 'active' : ''}" data-panel="privacy">${this.renderPrivacy(privacy)}</div>`;

        if (privacy) {
            html += `<div class="dss-panel ${defaultTab === 'setup' ? 'active' : ''}" data-panel="setup">${this.renderSetup(settings)}</div>`;
        }

        if (valid) {
            html += `<div class="dss-panel" data-panel="modules">${this.renderModules()}</div>`;
            html += this.renderModulePanels();
        }

        return html;
    },

    // ── Privacy Panel ──
    renderPrivacy(agreed) {
        return `
            <div class="title main-title title-black top-round"><h6>Data Privacy & Storage</h6></div>
            <div class="cont-gray bottom-round">
                <div class="dss-inner">
                    <p class="dss-desc">We are committed to protecting your privacy. Below is a detailed breakdown of how your data is handled.</p>
                    <div class="dss-privacy-grid">
                        <div class="dss-pcard">
                            <div class="dss-pcard-h">Data Storage</div>
                            <div class="dss-pcard-b">
                                <p class="dss-pq">Will the data be stored for any purpose?</p>
                                <div class="dss-pa">All modules store data locally, except Armoury Notes (notes are stored on the DSS notes server — see module guide)</div>
                            </div>
                        </div>
                        <div class="dss-pcard">
                        <div class="dss-pcard-h">Data Sharing</div>
                        <div class="dss-pcard-b">
                           <p class="dss-pq">Who can access the data besides the end user?</p>
                           <div class="dss-pa">Nobody for most modules. OC Prioritiser (tornprobability.com), Armoury Notes (DSS notes server), Midnight X Revive and Med X Revive (revive services) share limited data — see each module guide.</div>
                           </div>
                       </div>
                    <div class="dss-pcard">
                        <div class="dss-pcard-h">Purpose of Use</div>
                            <div class="dss-pcard-b">
                                <p class="dss-pq">What is the stored data being used for?</p>
                                <div class="dss-pa">Public community tools</div>
                            </div>
                        </div>
                        <div class="dss-pcard">
                            <div class="dss-pcard-h">Key Storage & Sharing</div>
                            <div class="dss-pcard-b">
                                <p class="dss-pq">Will the API key be stored securely and who can access it?</p>
                                <div class="dss-pa">Stored locally. If Armoury Notes is enabled, it is sent to the DSS notes server to verify your identity and faction. If Med X Revive is enabled, it is sent to medx.fun to verify your identity as the requestor with each revive request</div>
                            </div>
                        </div>
                        <div class="dss-pcard">
                            <div class="dss-pcard-h">Key Access Level</div>
                            <div class="dss-pcard-b">
                                <p class="dss-pq">What key access level or specific selections are required?</p>
                                <div class="dss-pa">Limited for all modules, public for a subset</div>
                            </div>
                        </div>
                    </div>
                    <div class="dss-agree-box">
                        <label class="dss-agree-label">
                            <input type="checkbox" id="dss-privacy-agree" ${agreed ? 'checked' : ''}>
                            <span>I agree to the terms of data usage set out above</span>
                        </label>
                    </div>
                    <div class="dss-note">
                        All data is stored locally in your browser using Tampermonkey's storage. Your API key never leaves your device except for direct calls to Torn's official API and, if Armoury Notes is enabled, to the DSS notes server for access checks, and if Med X Revive is enabled, to medx.fun when you request a revive..
                    </div>
                </div>
            </div>`;
    },

    // ── Setup Panel ──
    renderSetup(settings) {
        const valid = settings.apiKeyValid;
        return `
            <div class="title main-title title-black top-round"><h6>API Key Configuration</h6></div>
            <div class="cont-gray bottom-round">
                <div class="dss-inner">
                    ${valid ? `
                         <div class="dss-status dss-status-ok">
                            <div class="dss-status-icon">✓</div>
                            <div>
                                <strong>API Key Validated</strong>
                                <p>Key Type: ${settings.apiKeyType || 'Unknown'} — ${
                                (settings.apiKeyType === 'Public Only' || settings.apiKeyType === 'Minimal Access')
                                ? 'Some modules require Limited Access'
                                : 'All modules available'
                            }</p>
                            </div>
                        </div>
                    ` : `
                        <div class="dss-status dss-status-warn">
                            <div class="dss-status-icon">!</div>
                            <div>
                                <strong>API Key Required</strong>
                                <p>Enter your API key below to enable modules.</p>
                            </div>
                        </div>
                    `}

                    <div class="dss-form-row">
                        <label class="dss-label">Torn API Key:</label>
                        <div class="dss-input-row">
                          <input type="text" id="dss-api-key" class="dss-input dss-key-hidden"
                          value="" placeholder="Enter your 16-character API key"
                          autocomplete="off">
                            <button id="dss-key-toggle" class="dss-btn-icon" title="Show/Hide">👁</button>
                        </div>
                        <span id="dss-key-msg" class="dss-help"></span>
                    </div>

                    ${valid ? `
                    <div class="dss-form-actions">
                        <button id="dss-clear-key" class="torn-btn">Clear API Key</button>
                        <button id="dss-reset-all" class="torn-btn">Full Reset</button>
                    </div>
                    ` : `
                    <div class="dss-instructions">
                        <div class="dss-instr-title">API Key Setup</div>
                        <div class="dss-step"><span class="dss-step-n">1</span><div><strong>Navigate to API Settings</strong><p>Go to <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" class="t-blue">Torn Settings → API Key</a></p></div></div>
                        <div class="dss-step"><span class="dss-step-n">2</span><div><strong>Get/Create Key</strong><p>Copy an existing key or generate a new one (Limited Access provides access to all modules)</p></div></div>
                        <div class="dss-step"><span class="dss-step-n">3</span><div><strong>Paste Above</strong><p>Paste your 16-character key in the field above — it validates automatically</p></div></div>
                    </div>
                    `}

                    <div class="dss-donate-box">
                        <div class="dss-donate-title">☕ Support Dsuttz</div>
                        <p>These scripts are free to use. If you find them helpful, consider sending a donation to <a href="/profiles.php?XID=1561637" class="t-blue">Dsuttz [1561637]</a>.</p>
                    </div>
                </div>
            </div>`;
    },

    // ── All Modules Panel ──
    renderModules() {
        const states = Storage.getModuleStates();
        const available = Object.values(MODULES).filter(m => !(IS_PDA && m.pdaHidden) && !m.hidden && factionAllowed(m));
        const collapsed = Storage._get(MODGROUPS_KEY, {});
        const enabledCount = available.filter(m => states[m.id]?.enabled).length;

        const groups = {};
        available.forEach(m => {
            const cat = moduleCategoryOf(m.id);
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(m);
        });
        Object.keys(groups).forEach(cat => {
            const list = MODULE_CATEGORIES[cat] || [];
            groups[cat].sort((a, b) => list.indexOf(a.id) - list.indexOf(b.id));
        });
        const order = [...Object.keys(MODULE_CATEGORIES), 'Other'].filter(c => groups[c]);

        const row = (m) => {
            const enabled = !!states[m.id]?.enabled;
            const icon = MODULE_ICONS[m.id] || '📄';
            const search = escHtml(`${m.name} ${m.description} ${moduleCategoryOf(m.id)}`.toLowerCase());
            return `
                <div class="dss-mod-row" data-search="${search}">
                    <span class="dss-mod-icon">${icon}</span>
                    <div class="dss-mod-info">
                        <div class="dss-mod-top">
                            <span class="dss-mod-name">${m.name}</span>
                            <span class="dss-mod-ver">v${m.version}</span>
                        </div>
                        <div class="dss-mod-desc" title="Click to expand">${m.description}</div>
                    </div>
                    <label class="dss-switch">
                        <input type="checkbox" class="dss-mod-toggle" data-mod="${m.id}" ${enabled ? 'checked' : ''}>
                        <span class="dss-switch-s"></span>
                    </label>
                </div>`;
        };

        const sections = order.map(cat => {
            const mods = groups[cat];
            const on = mods.filter(m => states[m.id]?.enabled).length;
            return `
                <div class="dss-mod-group${collapsed[cat] ? ' collapsed' : ''}" data-cat="${escHtml(cat)}">
                    <button type="button" class="dss-mod-group-h">
                        <span class="dss-mod-group-arrow">\u25BC</span>
                        <span class="dss-mod-group-name">${escHtml(cat)}</span>
                        <span class="dss-mod-group-count">${on}/${mods.length} on</span>
                    </button>
                    <div class="dss-mod-group-body">${mods.map(row).join('')}</div>
                </div>`;
        }).join('');

        return `
            <div class="title main-title title-black top-round"><h6>Available Scripts (${available.length}) \u00B7 <span id="dss-mod-enabled-count">${enabledCount}</span> enabled</h6></div>
            <div class="cont-gray bottom-round">
                <div class="dss-inner">
                    <div class="dss-mod-tools">
                        <input type="search" id="dss-mod-search" class="dss-input" placeholder="Search modules..." autocomplete="off">
                        <div class="dss-mod-filter">
                            <button type="button" class="dss-mod-filter-btn active" data-f="all">All</button>
                            <button type="button" class="dss-mod-filter-btn" data-f="on">Enabled</button>
                            <button type="button" class="dss-mod-filter-btn" data-f="off">Disabled</button>
                        </div>
                    </div>
                    <p class="dss-desc" style="margin:0 0 10px;">Changes take effect on next page load. Click a description to expand it.</p>
                    <div class="dss-mod-list">${sections || '<p class="dss-desc">No modules registered yet.</p>'}</div>
                    <p class="dss-desc dss-mod-none" style="display:none;text-align:center;">No modules match.</p>
                </div>
            </div>`;
    },

    // ── Individual Module Panels (how-to guides) ──
    renderModulePanels() {
        const states = Storage.getModuleStates();
        return Object.values(MODULES).map(m => {
            const state = states[m.id] || { enabled: false };
            const guide = m.guide || '<p>No guide available yet for this module.</p>';
            return `
                <div class="dss-panel" data-panel="mod-${m.id}">
                    <div class="title main-title title-black top-round">
                        <h6>${m.name}</h6>
                        <span class="dss-ver-tag">v${m.version}</span>
                    </div>
                    <div class="cont-gray bottom-round">
                        <div class="dss-inner">
                            <div class="dss-mod-header-row">
                                <span class="dss-badge ${state.enabled ? 'on' : 'off'}">${state.enabled ? 'Enabled' : 'Disabled'}</span>
                            </div>
                            <div class="dss-guide">${guide}</div>
                        </div>
                    </div>
                </div>`;
        }).join('');
    },

    // ── Event Listeners ──
    attachListeners() {
        // Privacy checkbox
        document.getElementById('dss-privacy-agree')?.addEventListener('change', (e) => {
            const s = Storage.getSettings();
            s.privacyAgreed = e.target.checked;
            if (!e.target.checked) {
                s.apiKey = '';
                s.apiKeyValid = false;
            }
            Storage.setSettings(s);
            this.render();
        });

        // API key input — auto-validate
        let keyTimer;
        const keyInput = document.getElementById('dss-api-key');
        if (keyInput) keyInput.value = Storage.getSettings().apiKey || '';
        const keyMsg = document.getElementById('dss-key-msg');
        keyInput?.addEventListener('input', () => {
            clearTimeout(keyTimer);
            const key = keyInput.value.trim();
            if (!key) { keyMsg.textContent = ''; keyMsg.className = 'dss-help'; return; }
            if (key.length !== 16) {
                keyMsg.textContent = 'API key must be exactly 16 characters';
                keyMsg.className = 'dss-help dss-err';
                return;
            }
            keyMsg.textContent = 'Validating...';
            keyMsg.className = 'dss-help dss-val';
            keyTimer = setTimeout(async () => {
                const result = await validateApiKey(key);
                if (result.valid) {
                    const s = Storage.getSettings();
                    s.apiKey = key;
                    s.apiKeyValid = true;
                    s.apiKeyType = result.keyType;
                    if (result.factionId) s.myFactionId = result.factionId;
                    Storage.setSettings(s);
                    keyMsg.textContent = `✓ Validated — ${result.keyType}`;
                    keyMsg.className = 'dss-help dss-ok';
                    setTimeout(() => this.render(), 800);
                } else {
                    keyMsg.textContent = 'Invalid API key';
                    keyMsg.className = 'dss-help dss-err';
                }
            }, 800);
        });
        keyInput?.addEventListener('keydown', e => e.stopPropagation());

        // Key visibility toggle
        document.getElementById('dss-key-toggle')?.addEventListener('click', () => {
            keyInput?.classList.toggle('dss-key-hidden');
        });

        // Clear key
        document.getElementById('dss-clear-key')?.addEventListener('click', () => {
            if (!confirm('Clear your API key? This will disable all modules.')) return;
            const s = Storage.getSettings();
            s.apiKey = '';
            s.apiKeyValid = false;
            s.myFactionId = '';
            Storage.setSettings(s);
            // Disable all modules
            const states = Storage.getModuleStates();
            for (const id of Object.keys(states)) { states[id].enabled = false; }
            Storage.setModuleStates(states);
            this.render();
            setTimeout(() => document.querySelector('[data-tab="setup"]')?.click(), 50);
        });

        // Full reset
        document.getElementById('dss-reset-all')?.addEventListener('click', () => {
            if (!confirm('WARNING: This will reset EVERYTHING — API key, all module settings, all data. Are you sure?')) return;
            Storage.setSettings({ apiKey: '', apiKeyValid: false, myFactionId: '', privacyAgreed: false });
            Storage.setModuleStates({});
            this.render();
        });

        // Sidebar tab switching
        this.attachSidebarTabListeners();

        // Module toggles
        document.querySelectorAll('.dss-mod-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const id = e.target.dataset.mod;
                const state = Storage.getModuleState(id);
                state.enabled = e.target.checked;
                Storage.setModuleState(id, state);
                if (e.target.checked) Loader.runAll();
                // Rebuild sidebar to show/hide module links
                const sidebar = document.getElementById('dss-sidebar');
                if (sidebar) {
                    const settings = Storage.getSettings();
                    sidebar.innerHTML = this.renderSidebar(settings, 'modules');
                    // Re-attach sidebar listeners
                    this.attachSidebarTabListeners();
                    // Keep modules tab active
                    document.querySelector('[data-tab="modules"]')?.classList.add('active');

                    // Rebuild mobile nav
                    const mobileNav = document.getElementById('dss-sidebar-mobile');
                    if (mobileNav) {
                        mobileNav.innerHTML = this.renderMobileSidebar(Storage.getSettings(), 'modules');
                        document.getElementById('dss-mobile-nav')?.addEventListener('change', (e) => {
                            const tab = e.target.value;
                            document.querySelectorAll('.dss-panel').forEach(p => p.classList.remove('active'));
                            const panel = document.querySelector(`[data-panel="${tab}"]`);
                            if (panel) panel.classList.add('active');
                            document.querySelectorAll('.dss-sb-item').forEach(b => b.classList.remove('active'));
                            document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
                        });
                    }
                }

                // Update badge on module panel
                const modPanel = document.querySelector(`[data-panel="mod-${id}"]`);
                if (modPanel) {
                    const badge = modPanel.querySelector('.dss-badge');
                    if (badge) {
                        badge.className = `dss-badge ${e.target.checked ? 'on' : 'off'}`;
                        badge.textContent = e.target.checked ? 'Enabled' : 'Disabled';
                    }
                }
            });
        });

        this.attachModuleListFilters();

        // Mobile nav dropdown
        document.getElementById('dss-mobile-nav')?.addEventListener('change', (e) => {
            const tab = e.target.value;
            document.querySelectorAll('.dss-panel').forEach(p => p.classList.remove('active'));
            const panel = document.querySelector(`[data-panel="${tab}"]`);
            if (panel) panel.classList.add('active');
            // Keep desktop sidebar in sync
            document.querySelectorAll('.dss-sb-item').forEach(b => b.classList.remove('active'));
            document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
        });

        // Expand module description on tap (mobile)
        document.querySelectorAll('.dss-mod-desc').forEach(desc => {
            desc.addEventListener('click', () => {
                desc.classList.toggle('expanded');
            });
        });
    },

    attachSidebarTabListeners() {
        document.querySelectorAll('.dss-sb-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dss-sb-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.dss-panel').forEach(p => p.classList.remove('active'));
                const panel = document.querySelector(`[data-panel="${btn.dataset.tab}"]`);
                if (panel) panel.classList.add('active');
            });
        });
    },

            attachModuleListFilters() {
        const search = document.getElementById('dss-mod-search');
        if (!search) return;
        let filter = 'all';

        const apply = () => {
            const q = search.value.trim().toLowerCase();
            let anyVisible = false, totalOn = 0;
            document.querySelectorAll('.dss-mod-group').forEach(g => {
                let visible = 0, on = 0, total = 0;
                g.querySelectorAll('.dss-mod-row').forEach(r => {
                    const enabled = !!r.querySelector('.dss-mod-toggle')?.checked;
                    total++; if (enabled) on++;
                    const ok = (!q || (r.dataset.search || '').includes(q))
                        && (filter === 'all' || (filter === 'on') === enabled);
                    r.style.display = ok ? '' : 'none';
                    if (ok) visible++;
                });
                totalOn += on;
                g.style.display = visible ? '' : 'none';
                // While searching/filtering, show matches even in collapsed groups
                g.classList.toggle('searching', !!q || filter !== 'all');
                const c = g.querySelector('.dss-mod-group-count');
                if (c) c.textContent = `${on}/${total} on`;
                if (visible) anyVisible = true;
            });
            const none = document.querySelector('.dss-mod-none');
            if (none) none.style.display = anyVisible ? 'none' : '';
            const cnt = document.getElementById('dss-mod-enabled-count');
            if (cnt) cnt.textContent = totalOn;
        };

        search.addEventListener('input', apply);
        search.addEventListener('keydown', e => e.stopPropagation());

        document.querySelectorAll('.dss-mod-filter-btn').forEach(b => {
            b.addEventListener('click', () => {
                filter = b.dataset.f;
                document.querySelectorAll('.dss-mod-filter-btn').forEach(x => x.classList.toggle('active', x === b));
                apply();
            });
        });

        document.querySelectorAll('.dss-mod-group-h').forEach(h => {
            h.addEventListener('click', () => {
                const g = h.closest('.dss-mod-group');
                g.classList.toggle('collapsed');
                const col = Storage._get(MODGROUPS_KEY, {});
                col[g.dataset.cat] = g.classList.contains('collapsed');
                Storage._set(MODGROUPS_KEY, col);
            });
        });

        // Keep group counts / "Enabled" filter in sync when a switch is flipped
        document.querySelectorAll('.dss-mod-toggle').forEach(t => t.addEventListener('change', apply));
    },


    wireGuideField(elementId, onReady) {
        const wire = () => {
            const el = document.getElementById(elementId);
            if (!el) return false;
            onReady();
            return true;
        };

        if (wire()) return;

        const watcher = setInterval(() => {
            if (wire()) clearInterval(watcher);
        }, 500);

        window.addEventListener('hashchange', () => {
            setTimeout(() => wire(), 200);
        });

        setTimeout(() => clearInterval(watcher), 30000);
    },

    // ── Styles ──
    injectStyles() {
        if (document.getElementById('dss-styles')) return;
        const s = document.createElement('style');
        s.id = 'dss-styles';
        s.textContent = `
            /* Layout */
            .dss-page { max-width:1400px; margin:0 auto; animation:dss-fade .3s ease; }
            @keyframes dss-fade { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
            .dss-ver { display:inline-block; background:var(--default-bg-panel-color,#333); color:var(--default-color,#ddd); padding:3px 10px; border-radius:10px; font-size:11px; font-weight:600; margin-left:10px; vertical-align:middle; }
            .dss-ver-tag { float:right; background:var(--default-bg-panel-color,#333); color:var(--default-color,#999); padding:2px 8px; border-radius:8px; font-size:11px; }
            .dss-layout { display:flex; gap:20px; align-items:flex-start; }
            .dss-footer { text-align:center; padding:20px; color:var(--default-color,#777); font-size:12px; margin-top:20px; }

            /* Sidebar */
            .dss-sidebar { width:170px; flex-shrink:0; background:var(--default-bg-panel-color,rgba(0,0,0,.15)); border:1px solid var(--default-bg-panel-color,#383838); border-radius:5px; padding:10px; }
            .dss-sb-section { margin-bottom:15px; }
            .dss-sb-section:last-child { margin-bottom:0; }
            .dss-sb-title { font-size:11px; font-weight:bold; color:var(--default-color,#999); text-transform:uppercase; letter-spacing:.5px; padding:8px 8px 4px; }
            .dss-sb-item { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border:none; background:none; color:var(--default-color,#ddd); font-size:12px; text-align:left; cursor:pointer; border-radius:4px; transition:all .15s; font-family:inherit; }
            .dss-sb-item:hover { background:rgba(255,255,255,.08); color:var(--link-color,#60a5fa); }
            .dss-sb-item.active { background:rgba(96,165,250,.15); color:var(--link-color,#60a5fa); }

            /* Main content */
            .dss-main { flex:1; min-width:0; }
            .dss-panel { display:none; }
            .dss-panel.active { display:block; animation:dss-fade .25s ease; }
            .dss-inner { padding:20px; }
            .dss-desc { color:var(--default-color,#999); font-size:12px; margin-bottom:16px; }
            .dss-hr { border:none; border-top:1px solid var(--default-bg-panel-color,#444); margin:20px 0; }

            /* Privacy grid */
            .dss-privacy-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin:16px 0; }
            .dss-pcard { background:rgba(96,165,250,.05); border:1px solid rgba(96,165,250,.2); border-radius:4px; overflow:hidden; }
            .dss-pcard-h { background:rgba(96,165,250,.15); color:var(--link-color,#60a5fa); padding:8px 10px; font-size:12px; font-weight:bold; border-bottom:1px solid rgba(96,165,250,.2); }
            .dss-pcard-b { padding:10px; }
            .dss-pq { font-size:11px; color:var(--default-color,#999); margin:0 0 6px; line-height:1.3; }
            .dss-pa { font-size:12px; color:#4caf50; font-weight:600; }
            .dss-agree-box { margin:16px 0; padding:12px; background:rgba(96,165,250,.05); border:1px solid rgba(96,165,250,.2); border-radius:4px; }
            .dss-agree-label { display:flex; align-items:center; gap:10px; cursor:pointer; font-size:13px; color:var(--default-color,#ddd); }
            .dss-agree-label input { width:18px; height:18px; cursor:pointer; }
            .dss-note { font-size:11px; color:var(--default-color,#888); margin-top:12px; padding-top:12px; border-top:1px solid rgba(96,165,250,.1); line-height:1.5; }

            /* Setup */
            .dss-status { display:flex; align-items:center; gap:16px; padding:16px; border-radius:4px; margin-bottom:20px; border-left:4px solid; }
            .dss-status-ok { background:rgba(76,175,80,.1); border-left-color:#4caf50; }
            .dss-status-warn { background:rgba(255,152,0,.1); border-left-color:#ff9800; }
            .dss-status-icon { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:bold; flex-shrink:0; }
            .dss-status-ok .dss-status-icon { background:#4caf50; color:#fff; }
            .dss-status-warn .dss-status-icon { background:#ff9800; color:#fff; }
            .dss-status strong { display:block; font-size:14px; color:var(--default-color,#ddd); margin-bottom:4px; }
            .dss-status p { margin:0; font-size:12px; color:var(--default-color,#999); }
            .dss-form-row { margin-bottom:18px; }
            .dss-label { display:block; font-size:13px; font-weight:bold; color:var(--default-color,#ddd); margin-bottom:6px; }
            .dss-input-row { display:flex; gap:8px; }
            .dss-input { width:100%; padding:10px 12px; border:1px solid var(--default-bg-panel-color,#555); border-radius:4px; background:var(--default-bg-panel-color,#2a2a2a); color:var(--default-color,#ddd); font-size:13px; font-family:'Courier New',monospace; transition:all .2s; }
            .dss-input:focus { outline:none; border-color:var(--link-color,#60a5fa); box-shadow:0 0 0 2px rgba(96,165,250,.1); }
            .dss-key-hidden { -webkit-text-security:disc; text-security:disc; }
            .dss-btn-icon { padding:10px; border:1px solid var(--default-bg-panel-color,#555); border-radius:4px; background:var(--default-bg-panel-color,#2a2a2a); color:var(--default-color,#999); cursor:pointer; transition:all .15s; display:flex; align-items:center; justify-content:center; font-size:14px; }
            .dss-btn-icon:hover { background:var(--default-bg-panel-color,#333); color:var(--link-color,#60a5fa); }
            .dss-help { display:block; font-size:11px; color:var(--default-color,#999); margin-top:4px; }
            .dss-help.dss-val { color:var(--link-color,#60a5fa); }
            .dss-help.dss-ok { color:#4caf50; }
            .dss-help.dss-err { color:#f44336; }
            .dss-form-actions { margin-top:20px; display:flex; gap:10px; }
            .dss-instructions { background:rgba(96,165,250,.05); border:1px solid rgba(96,165,250,.2); border-radius:4px; padding:16px; margin:16px 0; }
            .dss-instr-title { font-size:14px; font-weight:bold; color:var(--link-color,#60a5fa); margin-bottom:12px; }
            .dss-step { display:flex; gap:12px; margin-bottom:12px; }
            .dss-step:last-child { margin-bottom:0; }
            .dss-step-n { width:24px; height:24px; min-width:24px; border-radius:50%; background:var(--link-color,#60a5fa); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px; flex-shrink:0; }
            .dss-step strong { display:block; font-size:12px; color:var(--default-color,#ddd); margin-bottom:2px; }
            .dss-step p { margin:0; font-size:11px; color:var(--default-color,#999); line-height:1.4; }
            .dss-donate-box { margin-top:20px; padding:16px; background:rgba(76,175,80,.06); border:1px solid rgba(76,175,80,.2); border-radius:4px; }
            .dss-donate-title { font-size:14px; font-weight:bold; color:#4caf50; margin-bottom:8px; }
            .dss-donate-box p { font-size:12px; color:var(--default-color,#999); margin:0; line-height:1.5; }

            /* Modules list */
            .dss-mod-list { display:flex; flex-direction:column; }
            .dss-mod-row { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.06); gap:12px; }
            .dss-mod-row:last-child { border-bottom:none; }
            .dss-mod-info { flex:1; min-width:0; }
            .dss-mod-top { display:flex; align-items:center; gap:8px; margin-bottom:2px; }
            .dss-mod-ver { font-size:10px; color:var(--default-color,#888); background:var(--default-bg-panel-color,#333); padding:1px 6px; border-radius:8px; }
            .dss-mod-desc { font-size:11px; color:var(--default-color,#777); line-height:1.4; }
            .dss-mod-name { font-size:13px; font-weight:600; color:var(--link-color,#60a5fa); }

            .dss-mod-header-row { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:16px; }
            .dss-badge { display:inline-block; padding:3px 8px; border-radius:10px; font-size:11px; font-weight:600; }
            .dss-badge.on { background:rgba(76,175,80,.2); color:#4caf50; }
            .dss-badge.off { background:rgba(158,158,158,.2); color:#999; }
            .dss-mod-meta { background:var(--default-bg-panel-color,rgba(255,255,255,.02)); border-radius:4px; padding:12px; margin-top:16px; }
            .dss-mod-meta strong { display:block; font-size:12px; color:var(--default-color,#ddd); margin-bottom:8px; }
            .dss-mod-meta ul { margin:8px 0 0 20px; padding:0; }
            .dss-mod-meta li { margin:4px 0; font-size:11px; color:var(--default-color,#999); }

                        .dss-mod-desc { font-size:11px; color:var(--default-color,#777); line-height:1.4; cursor:pointer;
                            display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
            .dss-mod-desc.expanded { display:block; -webkit-line-clamp:unset; overflow:visible; }
            .dss-mod-icon { font-size:15px; width:22px; text-align:center; flex-shrink:0; }

            .dss-mod-tools { display:flex; gap:10px; align-items:center; margin-bottom:10px; flex-wrap:wrap; }
            .dss-mod-tools .dss-input { flex:1 1 200px; font-family:inherit; padding:8px 10px; }
            .dss-mod-filter { display:flex; gap:4px; }
            .dss-mod-filter-btn { padding:6px 10px; border:1px solid rgba(255,255,255,.12); border-radius:4px; background:rgba(255,255,255,.04);
                                  color:var(--default-color,#aaa); font-size:11px; cursor:pointer; font-family:inherit; }
            .dss-mod-filter-btn:hover { background:rgba(255,255,255,.08); }
            .dss-mod-filter-btn.active { background:rgba(96,165,250,.15); border-color:rgba(96,165,250,.45); color:var(--link-color,#60a5fa); }

            .dss-mod-group { border:1px solid rgba(255,255,255,.06); border-radius:6px; margin-bottom:8px; overflow:hidden; }
            .dss-mod-group-h { display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border:none; cursor:pointer;
                               background:rgba(96,165,250,.06); color:var(--link-color,#60a5fa); font-family:inherit;
                               font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; text-align:left; }
            .dss-mod-group-h:hover { background:rgba(96,165,250,.1); }
            .dss-mod-group-arrow { font-size:8px; transition:transform .2s; }
            .dss-mod-group-name { flex:1; }
            .dss-mod-group-count { color:var(--default-color,#888); font-weight:400; text-transform:none; letter-spacing:0; }
            .dss-mod-group-body { padding:0 12px; }
            .dss-mod-group.collapsed:not(.searching) .dss-mod-group-body { display:none; }
            .dss-mod-group.collapsed:not(.searching) .dss-mod-group-arrow { transform:rotate(-90deg); }
            .dss-mod-group .dss-mod-row { padding:8px 0; }


            /* Guide sections */
            .dss-guide { font-size:12px; color:var(--default-color,#bbb); line-height:1.6; display:flex; flex-direction:column; gap:12px; }
            .dss-guide-card { background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06); border-radius:6px; overflow:hidden; }
            .dss-guide-card-header { padding:10px 14px; background:rgba(96,165,250,.06); border-bottom:1px solid rgba(255,255,255,.06); font-size:11px; font-weight:600; color:var(--link-color,#60a5fa); text-transform:uppercase; letter-spacing:.04em; }
            .dss-guide-card-body { padding:12px 14px; font-size:12px; color:var(--default-color,#999); line-height:1.6; }
            .dss-guide-card-body strong { color:var(--default-color,#ccc); }
            .dss-guide-card-body p { margin:0 0 8px; }
            .dss-guide-card-body p:last-child { margin-bottom:0; }

            /* Toggle switch */
            .dss-switch { position:relative; display:inline-block; width:40px; height:22px; flex-shrink:0; }
            .dss-switch input { opacity:0; width:0; height:0; }
            .dss-switch-s { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:#2a2a2a; transition:.25s; border-radius:22px; border:2px solid #555; }
            .dss-switch-s:before { position:absolute; content:""; height:14px; width:14px; left:2px; bottom:2px; background:#999; transition:.25s; border-radius:50%; }
            .dss-switch input:checked+.dss-switch-s { background:#4caf50; border-color:#4caf50; }
            .dss-switch input:checked+.dss-switch-s:before { transform:translateX(18px); background:#fff; }

            .dss-mobile-only { display: none; }

            @media (max-width: 784px) {
                        .dss-desktop-only { display: none; }
                        .dss-mobile-only { display: block; margin: 0 0 10px 0; padding: 0; width: 100%; box-sizing: border-box; }
                        .dss-layout { flex-direction: column; gap: 0; width: 100%; }
                        .dss-mobile-nav { width: 100%; box-sizing: border-box; }
                        .dss-mobile-nav {
                                    width: 100%;
                                    box-sizing: border-box;
                                    padding: 10px 12px;
                                    border: 1px solid var(--default-bg-panel-color, #555);
                                    border-radius: 5px;
                                    background: var(--default-bg-panel-color, #2a2a2a);
                                    color: var(--default-color, #ddd);
                                    font-size: 13px;
                                    font-family: inherit;
                                    cursor: pointer;
                                    -webkit-appearance: none;
                                    appearance: none;
                                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
                                    background-repeat: no-repeat;
                                    background-position: right 12px center;
                        }
                        .dss-mobile-nav:focus { outline: none; border-color: var(--link-color, #60a5fa); }
                        .dss-inner { padding: 14px; }
                        .dss-privacy-grid { grid-template-columns: 1fr; }
                        .dss-status { flex-direction: column; text-align: center; gap: 10px; }
                        .dss-form-actions { flex-direction: column; }
                        .dss-mod-row { flex-direction: row; align-items: center; gap: 10px; padding: 8px 0; }
                        .dss-mod-info { min-width: 0; flex: 1; }
                        .dss-mod-top { flex-wrap: wrap; }
                        .dss-mod-desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                        .dss-mod-desc.expanded { white-space: normal; overflow: visible; }
                        .dss-mod-header-row { flex-direction: column; gap: 10px; }
                        .dss-main { width: 100%; box-sizing: border-box; }
            }

            `;
        document.head.appendChild(s);
    }
};
export { MODULE_ICONS, MODULE_CATEGORIES, MODGROUPS_KEY, moduleCategoryOf, UI };
