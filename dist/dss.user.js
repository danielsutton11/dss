// ==UserScript==
// @name         DSS: Unified Script Manager
// @namespace    http://tampermonkey.net/
// @version      0.7.92
// @description  Unified manager for DSS (Dsuttz Scripts) modules
// @author       Dsuttz [1561637]
// @match        https://www.torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      tornprobability.com
// @connect      api.torn.com
// @connect      iwmpklkqwlniguyeaygv.supabase.co
// @connect      api.no1irishstig.co.uk
// @connect      tornarmourynotesmanager-production.up.railway.app
// @connect      medx.fun
// @run-at       document-start
// @downloadURL  https://update.greasyfork.org/scripts/578862/DSS%3A%20Unified%20Script%20Manager.user.js
// @updateURL    https://update.greasyfork.org/scripts/578862/DSS%3A%20Unified%20Script%20Manager.meta.js
// ==/UserScript==

(function() {

'use strict';
// src/core/constants.js
	var DSS_VERSION = "0.7.92";
	var SETTINGS_KEY = "dss_settings";
	var MODULES_KEY = "dss_modules";
	var API_BASE = "https://api.torn.com/v2";
	var tornAuth = (key) => ({
		"Accept": "application/json",
		"Authorization": "ApiKey " + key
	});
	var escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[c]);
	var IS_PDA = navigator.userAgent.includes("com.manuito.tornpda") || /TornPDA/i.test(navigator.userAgent) || typeof window.flutter_inappwebview !== "undefined" || typeof window.PDA_httpGet === "function";

// src/core/api.js
	async function validateApiKey(key) {
		if (!key || key.length !== 16) return { valid: false };
		try {
			const res = await fetch(`${API_BASE}/key/info`, {
				method: "GET",
				headers: {
					"Accept": "application/json",
					"Authorization": "ApiKey " + key
				}
			});
			if (!res.ok) return { valid: false };
			const data = await res.json();
			if (data?.error) return { valid: false };
			const access = data?.info?.access || {};
			const user = data?.info?.user || {};
			return {
				valid: true,
				keyType: access.type || "Unknown",
				accessLevel: access.level,
				playerId: user.id,
				factionId: user.faction_id?.toString() || null
			};
		} catch (_) {
			return { valid: false };
		}
	}

// src/core/storage.js
	var Storage = {
		_get(key, fallback) {
			try {
				const v = GM_getValue(key);
				return v !== undefined ? JSON.parse(v) : fallback;
			} catch (_) {
				return fallback;
			}
		},
		_set(key, val) {
			try {
				GM_setValue(key, JSON.stringify(val));
			} catch (_) {}
		},
		getSettings() {
			return this._get(SETTINGS_KEY, {
				apiKey: "",
				apiKeyValid: false,
				myFactionId: "",
				privacyAgreed: false
			});
		},
		setSettings(s) {
			this._set(SETTINGS_KEY, s);
		},
		getModuleStates() {
			return this._get(MODULES_KEY, {});
		},
		setModuleStates(s) {
			this._set(MODULES_KEY, s);
		},
		getModuleState(id) {
			const all = this.getModuleStates();
			return all[id] || {
				enabled: false,
				settings: {}
			};
		},
		setModuleState(id, state) {
			const all = this.getModuleStates();
			all[id] = state;
			this.setModuleStates(all);
		}
	};

// src/core/registry.js
	var MODULES = {};
	/**
	* Register a module.
	* @param {string} id        - Unique module ID
	* @param {object} config    - { name, description, version, pages:[], guide:'', init:Function }
	*   pages  — URL substrings this module should run on
	*   guide  — HTML string shown on the module's settings page
	*   init   — function() called when the module is enabled & page matches
	*/
	function registerModule(id, config) {
		MODULES[id] = {
			id,
			...config
		};
	}
	/** True if the module has no faction restriction, or the user's faction is on its list. */
	function factionAllowed(mod) {
		if (!Array.isArray(mod.factions) || !mod.factions.length) return true;
		const fid = String(Storage.getSettings().myFactionId || "");
		return !!fid && mod.factions.map(String).includes(fid);
	}

// src/core/loader.js
	var Loader = {
		loaded: {},
		shouldRun(mod) {
			if (!factionAllowed(mod)) return false;
			const gateId = mod.controlledBy || mod.id;
			const state = Storage.getModuleState(gateId);
			if (!state.enabled) return false;
			const url = window.location.href;
			if (Array.isArray(mod.excludePages) && mod.excludePages.some((p) => url.includes(p))) return false;
			return mod.pages.some((p) => url.includes(p));
		},
		runAll() {
			for (const mod of Object.values(MODULES)) {
				if (this.loaded[mod.id]) continue;
				if (!this.shouldRun(mod)) continue;
				try {
					mod.init();
					this.loaded[mod.id] = true;
				} catch (e) {
					console.error(`[DSS] ✗ ${mod.id}:`, e);
				}
			}
		}
	};

// src/core/ui.js
	var MODULE_ICONS = {
		"faction-family-buttons": "👨‍👩‍👧‍👦",
		"attack-enhancer": "⚔️",
		"crime-prioritiser": "🎯",
		"oc-reminder": "🔫",
		"chain-monitor": "⛓️",
		"custom-background": "🖼️",
		"cash-monitor": "💰",
		"item-price-sorter": "📊",
		"faction-money": "💵",
		"midnight-revive": "⛑️",
		"medx-revive": "🚑",
		"armoury-notes": "🪖",
		"activity-stats": "📈",
		"hospital-revive-filter": "🩺",
		"honor-names": "🔤",
		"tyronic-war": "🛡️"
	};
	var MODULE_CATEGORIES = {
		"Combat & War": [
			"tyronic-war",
			"attack-enhancer",
			"chain-monitor",
			"midnight-revive",
			"medx-revive",
			"hospital-revive-filter"
		],
		"Faction": [
			"crime-prioritiser",
			"faction-family-buttons",
			"activity-stats",
			"faction-money",
			"armoury-notes"
		],
		"Quality of Life": [
			"cash-monitor",
			"item-price-sorter",
			"honor-names",
			"custom-background"
		]
	};
	var MODGROUPS_KEY = "dss_modgroups_collapsed";
	var moduleCategoryOf = (id) => Object.keys(MODULE_CATEGORIES).find((c) => MODULE_CATEGORIES[c].includes(id)) || "Other";
	var UI = {
		render() {
			const cw = document.querySelector(".content-wrapper[role=\"main\"]");
			if (!cw) return;
			const hideChild = (child) => {
				if (child.nodeType !== 1 || child.id === "dss-page-host") return;
				if (child.dataset.dssPrevDisplay === undefined) {
					child.dataset.dssPrevDisplay = child.style.display || "";
				}
				child.style.display = "none";
			};
			Array.from(cw.children).forEach(hideChild);
			if (!this._hostObserver) {
				this._hostObserver = new MutationObserver((muts) => {
					muts.forEach((m) => m.addedNodes.forEach(hideChild));
				});
				this._hostObserver.observe(cw, { childList: true });
			}
			let host = document.getElementById("dss-page-host");
			if (!host) {
				host = document.createElement("div");
				host.id = "dss-page-host";
				cw.appendChild(host);
			}
			const settings = Storage.getSettings();
			const defaultTab = settings.privacyAgreed ? "setup" : "privacy";
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
			if (this._hostObserver) {
				this._hostObserver.disconnect();
				this._hostObserver = null;
			}
			const host = document.getElementById("dss-page-host");
			if (host) host.remove();
			document.querySelectorAll("[data-dss-prev-display]").forEach((el) => {
				el.style.display = el.dataset.dssPrevDisplay;
				delete el.dataset.dssPrevDisplay;
			});
		},
		renderSidebar(settings, activeTab) {
			const valid = settings.apiKeyValid;
			const privacy = settings.privacyAgreed;
			let html = `
            <div class="dss-sb-section">
                 <div class="dss-sb-title">Configuration</div>
                      <button class="dss-sb-item ${activeTab === "privacy" ? "active" : ""}" data-tab="privacy">🛡️ Data Privacy</button>
                      ${privacy ? `<button class="dss-sb-item ${activeTab === "setup" ? "active" : ""}" data-tab="setup">⚙️ Setup</button>` : ""}
                     ${valid ? `<button class="dss-sb-item ${activeTab === "modules" ? "active" : ""}" data-tab="modules">📦 All Modules</button>` : ""}
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
			let options = `<option value="privacy" ${activeTab === "privacy" ? "selected" : ""}>🛡️ Data Privacy</option>`;
			if (privacy) {
				options += `<option value="setup" ${activeTab === "setup" ? "selected" : ""}>⚙️ Setup</option>`;
			}
			if (valid) {
				options += `<option value="modules" ${activeTab === "modules" ? "selected" : ""}>📦 All Modules</option>`;
				options += `<option disabled>── Modules ──</option>`;
				const states = Storage.getModuleStates();
				Object.values(MODULES).forEach((m) => {
					if (m.hidden) return;
					if (!factionAllowed(m)) return;
					if (!states[m.id]?.enabled) return;
					const icon = MODULE_ICONS[m.id] || "📄";
					options += `<option value="mod-${m.id}">${icon} ${m.name}</option>`;
				});
			}
			return `<select id="dss-mobile-nav" class="dss-mobile-nav">${options}</select>`;
		},
		renderModuleSidebarItems() {
			const states = Storage.getModuleStates();
			return Object.values(MODULES).map((m) => {
				if (m.hidden) return "";
				if (!factionAllowed(m)) return "";
				if (!states[m.id]?.enabled) return "";
				const icon = MODULE_ICONS[m.id] || "📄";
				return `<button class="dss-sb-item" data-tab="mod-${m.id}">${icon} ${m.name}</button>`;
			}).join("");
		},
		renderPanels(settings, defaultTab) {
			const valid = settings.apiKeyValid;
			const privacy = settings.privacyAgreed;
			let html = `<div class="dss-panel ${defaultTab === "privacy" ? "active" : ""}" data-panel="privacy">${this.renderPrivacy(privacy)}</div>`;
			if (privacy) {
				html += `<div class="dss-panel ${defaultTab === "setup" ? "active" : ""}" data-panel="setup">${this.renderSetup(settings)}</div>`;
			}
			if (valid) {
				html += `<div class="dss-panel" data-panel="modules">${this.renderModules()}</div>`;
				html += this.renderModulePanels();
			}
			return html;
		},
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
                            <input type="checkbox" id="dss-privacy-agree" ${agreed ? "checked" : ""}>
                            <span>I agree to the terms of data usage set out above</span>
                        </label>
                    </div>
                    <div class="dss-note">
                        All data is stored locally in your browser using Tampermonkey's storage. Your API key never leaves your device except for direct calls to Torn's official API and, if Armoury Notes is enabled, to the DSS notes server for access checks, and if Med X Revive is enabled, to medx.fun when you request a revive..
                    </div>
                </div>
            </div>`;
		},
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
                                <p>Key Type: ${settings.apiKeyType || "Unknown"} — ${settings.apiKeyType === "Public Only" || settings.apiKeyType === "Minimal Access" ? "Some modules require Limited Access" : "All modules available"}</p>
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
		renderModules() {
			const states = Storage.getModuleStates();
			const available = Object.values(MODULES).filter((m) => !(IS_PDA && m.pdaHidden) && !m.hidden && factionAllowed(m));
			const collapsed = Storage._get(MODGROUPS_KEY, {});
			const enabledCount = available.filter((m) => states[m.id]?.enabled).length;
			const groups = {};
			available.forEach((m) => {
				const cat = moduleCategoryOf(m.id);
				if (!groups[cat]) groups[cat] = [];
				groups[cat].push(m);
			});
			Object.keys(groups).forEach((cat) => {
				const list = MODULE_CATEGORIES[cat] || [];
				groups[cat].sort((a, b) => list.indexOf(a.id) - list.indexOf(b.id));
			});
			const order = [...Object.keys(MODULE_CATEGORIES), "Other"].filter((c) => groups[c]);
			const row = (m) => {
				const enabled = !!states[m.id]?.enabled;
				const icon = MODULE_ICONS[m.id] || "📄";
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
                        <input type="checkbox" class="dss-mod-toggle" data-mod="${m.id}" ${enabled ? "checked" : ""}>
                        <span class="dss-switch-s"></span>
                    </label>
                </div>`;
			};
			const sections = order.map((cat) => {
				const mods = groups[cat];
				const on = mods.filter((m) => states[m.id]?.enabled).length;
				return `
                <div class="dss-mod-group${collapsed[cat] ? " collapsed" : ""}" data-cat="${escHtml(cat)}">
                    <button type="button" class="dss-mod-group-h">
                        <span class="dss-mod-group-arrow">\u25BC</span>
                        <span class="dss-mod-group-name">${escHtml(cat)}</span>
                        <span class="dss-mod-group-count">${on}/${mods.length} on</span>
                    </button>
                    <div class="dss-mod-group-body">${mods.map(row).join("")}</div>
                </div>`;
			}).join("");
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
                    <div class="dss-mod-list">${sections || "<p class=\"dss-desc\">No modules registered yet.</p>"}</div>
                    <p class="dss-desc dss-mod-none" style="display:none;text-align:center;">No modules match.</p>
                </div>
            </div>`;
		},
		renderModulePanels() {
			const states = Storage.getModuleStates();
			return Object.values(MODULES).map((m) => {
				const state = states[m.id] || { enabled: false };
				const guide = m.guide || "<p>No guide available yet for this module.</p>";
				return `
                <div class="dss-panel" data-panel="mod-${m.id}">
                    <div class="title main-title title-black top-round">
                        <h6>${m.name}</h6>
                        <span class="dss-ver-tag">v${m.version}</span>
                    </div>
                    <div class="cont-gray bottom-round">
                        <div class="dss-inner">
                            <div class="dss-mod-header-row">
                                <span class="dss-badge ${state.enabled ? "on" : "off"}">${state.enabled ? "Enabled" : "Disabled"}</span>
                            </div>
                            <div class="dss-guide">${guide}</div>
                        </div>
                    </div>
                </div>`;
			}).join("");
		},
		attachListeners() {
			document.getElementById("dss-privacy-agree")?.addEventListener("change", (e) => {
				const s = Storage.getSettings();
				s.privacyAgreed = e.target.checked;
				if (!e.target.checked) {
					s.apiKey = "";
					s.apiKeyValid = false;
				}
				Storage.setSettings(s);
				this.render();
			});
			let keyTimer;
			const keyInput = document.getElementById("dss-api-key");
			if (keyInput) keyInput.value = Storage.getSettings().apiKey || "";
			const keyMsg = document.getElementById("dss-key-msg");
			keyInput?.addEventListener("input", () => {
				clearTimeout(keyTimer);
				const key = keyInput.value.trim();
				if (!key) {
					keyMsg.textContent = "";
					keyMsg.className = "dss-help";
					return;
				}
				if (key.length !== 16) {
					keyMsg.textContent = "API key must be exactly 16 characters";
					keyMsg.className = "dss-help dss-err";
					return;
				}
				keyMsg.textContent = "Validating...";
				keyMsg.className = "dss-help dss-val";
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
						keyMsg.className = "dss-help dss-ok";
						setTimeout(() => this.render(), 800);
					} else {
						keyMsg.textContent = "Invalid API key";
						keyMsg.className = "dss-help dss-err";
					}
				}, 800);
			});
			keyInput?.addEventListener("keydown", (e) => e.stopPropagation());
			document.getElementById("dss-key-toggle")?.addEventListener("click", () => {
				keyInput?.classList.toggle("dss-key-hidden");
			});
			document.getElementById("dss-clear-key")?.addEventListener("click", () => {
				if (!confirm("Clear your API key? This will disable all modules.")) return;
				const s = Storage.getSettings();
				s.apiKey = "";
				s.apiKeyValid = false;
				s.myFactionId = "";
				Storage.setSettings(s);
				const states = Storage.getModuleStates();
				for (const id of Object.keys(states)) {
					states[id].enabled = false;
				}
				Storage.setModuleStates(states);
				this.render();
				setTimeout(() => document.querySelector("[data-tab=\"setup\"]")?.click(), 50);
			});
			document.getElementById("dss-reset-all")?.addEventListener("click", () => {
				if (!confirm("WARNING: This will reset EVERYTHING — API key, all module settings, all data. Are you sure?")) return;
				Storage.setSettings({
					apiKey: "",
					apiKeyValid: false,
					myFactionId: "",
					privacyAgreed: false
				});
				Storage.setModuleStates({});
				this.render();
			});
			this.attachSidebarTabListeners();
			document.querySelectorAll(".dss-mod-toggle").forEach((toggle) => {
				toggle.addEventListener("change", (e) => {
					const id = e.target.dataset.mod;
					const state = Storage.getModuleState(id);
					state.enabled = e.target.checked;
					Storage.setModuleState(id, state);
					if (e.target.checked) Loader.runAll();
					const sidebar = document.getElementById("dss-sidebar");
					if (sidebar) {
						const settings = Storage.getSettings();
						sidebar.innerHTML = this.renderSidebar(settings, "modules");
						this.attachSidebarTabListeners();
						document.querySelector("[data-tab=\"modules\"]")?.classList.add("active");
						const mobileNav = document.getElementById("dss-sidebar-mobile");
						if (mobileNav) {
							mobileNav.innerHTML = this.renderMobileSidebar(Storage.getSettings(), "modules");
							document.getElementById("dss-mobile-nav")?.addEventListener("change", (e) => {
								const tab = e.target.value;
								document.querySelectorAll(".dss-panel").forEach((p) => p.classList.remove("active"));
								const panel = document.querySelector(`[data-panel="${tab}"]`);
								if (panel) panel.classList.add("active");
								document.querySelectorAll(".dss-sb-item").forEach((b) => b.classList.remove("active"));
								document.querySelector(`[data-tab="${tab}"]`)?.classList.add("active");
							});
						}
					}
					const modPanel = document.querySelector(`[data-panel="mod-${id}"]`);
					if (modPanel) {
						const badge = modPanel.querySelector(".dss-badge");
						if (badge) {
							badge.className = `dss-badge ${e.target.checked ? "on" : "off"}`;
							badge.textContent = e.target.checked ? "Enabled" : "Disabled";
						}
					}
				});
			});
			this.attachModuleListFilters();
			document.getElementById("dss-mobile-nav")?.addEventListener("change", (e) => {
				const tab = e.target.value;
				document.querySelectorAll(".dss-panel").forEach((p) => p.classList.remove("active"));
				const panel = document.querySelector(`[data-panel="${tab}"]`);
				if (panel) panel.classList.add("active");
				document.querySelectorAll(".dss-sb-item").forEach((b) => b.classList.remove("active"));
				document.querySelector(`[data-tab="${tab}"]`)?.classList.add("active");
			});
			document.querySelectorAll(".dss-mod-desc").forEach((desc) => {
				desc.addEventListener("click", () => {
					desc.classList.toggle("expanded");
				});
			});
		},
		attachSidebarTabListeners() {
			document.querySelectorAll(".dss-sb-item").forEach((btn) => {
				btn.addEventListener("click", () => {
					document.querySelectorAll(".dss-sb-item").forEach((b) => b.classList.remove("active"));
					btn.classList.add("active");
					document.querySelectorAll(".dss-panel").forEach((p) => p.classList.remove("active"));
					const panel = document.querySelector(`[data-panel="${btn.dataset.tab}"]`);
					if (panel) panel.classList.add("active");
				});
			});
		},
		attachModuleListFilters() {
			const search = document.getElementById("dss-mod-search");
			if (!search) return;
			let filter = "all";
			const apply = () => {
				const q = search.value.trim().toLowerCase();
				let anyVisible = false, totalOn = 0;
				document.querySelectorAll(".dss-mod-group").forEach((g) => {
					let visible = 0, on = 0, total = 0;
					g.querySelectorAll(".dss-mod-row").forEach((r) => {
						const enabled = !!r.querySelector(".dss-mod-toggle")?.checked;
						total++;
						if (enabled) on++;
						const ok = (!q || (r.dataset.search || "").includes(q)) && (filter === "all" || filter === "on" === enabled);
						r.style.display = ok ? "" : "none";
						if (ok) visible++;
					});
					totalOn += on;
					g.style.display = visible ? "" : "none";
					g.classList.toggle("searching", !!q || filter !== "all");
					const c = g.querySelector(".dss-mod-group-count");
					if (c) c.textContent = `${on}/${total} on`;
					if (visible) anyVisible = true;
				});
				const none = document.querySelector(".dss-mod-none");
				if (none) none.style.display = anyVisible ? "none" : "";
				const cnt = document.getElementById("dss-mod-enabled-count");
				if (cnt) cnt.textContent = totalOn;
			};
			search.addEventListener("input", apply);
			search.addEventListener("keydown", (e) => e.stopPropagation());
			document.querySelectorAll(".dss-mod-filter-btn").forEach((b) => {
				b.addEventListener("click", () => {
					filter = b.dataset.f;
					document.querySelectorAll(".dss-mod-filter-btn").forEach((x) => x.classList.toggle("active", x === b));
					apply();
				});
			});
			document.querySelectorAll(".dss-mod-group-h").forEach((h) => {
				h.addEventListener("click", () => {
					const g = h.closest(".dss-mod-group");
					g.classList.toggle("collapsed");
					const col = Storage._get(MODGROUPS_KEY, {});
					col[g.dataset.cat] = g.classList.contains("collapsed");
					Storage._set(MODGROUPS_KEY, col);
				});
			});
			document.querySelectorAll(".dss-mod-toggle").forEach((t) => t.addEventListener("change", apply));
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
			window.addEventListener("hashchange", () => {
				setTimeout(() => wire(), 200);
			});
			setTimeout(() => clearInterval(watcher), 3e4);
		},
		injectStyles() {
			if (document.getElementById("dss-styles")) return;
			const s = document.createElement("style");
			s.id = "dss-styles";
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

// src/core/sidebar.js
	function addSidebarButton() {
		let desktopAdded = false;
		let mobileAdded = false;
		const observer = new MutationObserver((_, obs) => {
			if (!desktopAdded) {
				if (document.getElementById("nav-dss-scripts")) {
					desktopAdded = true;
				} else {
					const anyNavItem = document.querySelector("div[class*=\"area-desktop\"]");
					if (anyNavItem) {
						const navContainer = anyNavItem.parentNode;
						if (navContainer && navContainer.querySelectorAll("div[class*=\"area-desktop\"]").length >= 3) {
							const areaClass = anyNavItem.className.replace(/\bactive\S*/g, "").trim();
							const dssNav = document.createElement("div");
							dssNav.className = areaClass;
							dssNav.id = "nav-dss-scripts";
							const innerRow = anyNavItem.querySelector("[class*=\"area-row\"]");
							const innerLink = anyNavItem.querySelector("a[class*=\"desktopLink\"]");
							const iconWrap = anyNavItem.querySelector("[class*=\"svgIconWrap\"]");
							const iconSpan = anyNavItem.querySelector("[class*=\"defaultIcon\"]");
							const linkName = anyNavItem.querySelector("[class*=\"linkName\"]");
							dssNav.innerHTML = `
                            <div class="${innerRow?.className || ""}">
                                <a href="#/dss/settings" class="${innerLink?.className || ""} dss-manager-link">
                                    <span class="${iconWrap?.className || ""}">
                                        <span class="${iconSpan?.className || ""}" style="font-size:13px;display:flex;align-items:center;justify-content:center;margin-left:-5px;">🔧</span>
                                    </span>
                                    <span class="${linkName?.className || ""}" style="margin-left:-1px">Dsuttz Scripts</span>
                                </a>
                            </div>
                        `;
							GM_addStyle(`
                            #nav-dss-scripts { border-left: 3px solid #667eea; }
                            #nav-dss-scripts.dss-active,
                            #nav-dss-scripts.dss-active > div,
                            #nav-dss-scripts.dss-active a { background: rgba(102,126,234,0.15) !important; }
                        `);
							navContainer.appendChild(dssNav);
							dssNav.querySelector("a").addEventListener("click", dssNavClick);
							if (window.location.hash.startsWith("#/dss/")) {
								dssNav.style.background = "rgba(102,126,234,0.08)";
							}
							desktopAdded = true;
							setActiveNav();
						}
					}
				}
			}
			if (!mobileAdded) {
				if (document.getElementById("nav-dss-scripts-mobile")) {
					mobileAdded = true;
				} else {
					const anyMobileSlide = document.querySelector(".swiper-slide [class*=\"area-mobile\"]");
					if (anyMobileSlide) {
						const swiperWrapper = anyMobileSlide.closest(".swiper-wrapper");
						if (swiperWrapper && swiperWrapper.querySelectorAll("[class*=\"area-mobile\"]").length >= 3) {
							const slideClass = anyMobileSlide.closest(".swiper-slide")?.className?.replace(/swiper-slide-(active|prev|next)/g, "").trim() || "";
							const mobileAreaClass = anyMobileSlide.className;
							const innerRow = anyMobileSlide.querySelector("[class*=\"area-row\"]");
							const innerLink = anyMobileSlide.querySelector("a[class*=\"sidebarMobileLink\"]");
							const iconWrap = anyMobileSlide.querySelector("[class*=\"svgIconWrap\"]");
							const iconSpan = anyMobileSlide.querySelector("[class*=\"defaultIcon\"]");
							const dssSlide = document.createElement("div");
							dssSlide.className = slideClass;
							dssSlide.style.width = anyMobileSlide.closest(".swiper-slide")?.style.width || "";
							dssSlide.innerHTML = `
                            <div id="nav-dss-scripts-mobile" class="${mobileAreaClass}">
                                <div class="${innerRow?.className || ""}">
                                    <a href="#/dss/settings" class="${innerLink?.className || ""} dss-manager-link">
                                        <span class="${iconWrap?.className || ""}">
                                            <span class="${iconSpan?.className || ""}" style="font-size:13px;display:flex;align-items:center;justify-content:center;">🔧</span>
                                        </span>
                                        <span>DSS</span>
                                    </a>
                                </div>
                            </div>
                        `;
							GM_addStyle("#nav-dss-scripts-mobile { border-bottom: 3px solid #667eea; }");
							swiperWrapper.appendChild(dssSlide);
							dssSlide.querySelector("a").addEventListener("click", dssNavClick);
							mobileAdded = true;
						}
					}
				}
			}
			if (desktopAdded && mobileAdded) obs.disconnect();
		});
		function dssNavClick(e) {
			e.preventDefault();
			if (!window.location.pathname.includes("/city.php")) {
				window.location.href = "https://www.torn.com/city.php#/dss/settings";
				return;
			}
			if (window.location.hash !== "#/dss/settings") {
				window.location.hash = "#/dss/settings";
			}
			setTimeout(() => UI.render(), 50);
			setActiveNav();
		}
		function injectFlyoutNav() {
			const panel = document.getElementById("fly-out-panel");
			if (!panel) return;
			if (panel.querySelector("#nav-dss-scripts-flyout")) return;
			const areas = panel.querySelector("[class*=\"areasMobile___\"]") || panel.querySelector("[class*=\"areas___\"]");
			if (!areas) return;
			const sample = areas.querySelector("[class*=\"area-mobile___\"]");
			if (!sample) return;
			const sampleRow = sample.querySelector("[class*=\"areaRow___\"]");
			const sampleLink = sample.querySelector("a[class*=\"mobileLink___\"]");
			const iconWrap = sample.querySelector("[class*=\"svgIconWrap___\"]");
			const iconSpan = sample.querySelector("[class*=\"defaultIcon___\"]");
			const nameSpan = sample.querySelector("[class*=\"linkName___\"]");
			if (!sampleLink) return;
			const outerClass = sample.className.replace(/\bactive\S*/g, "").replace(/\battention\S*/g, "").trim();
			const entry = document.createElement("div");
			entry.id = "nav-dss-scripts-flyout";
			entry.className = outerClass;
			entry.innerHTML = `
        <div class="${sampleRow?.className || ""}">
            <a href="#/dss/settings" class="${sampleLink.className} dss-manager-link">
                <span class="${iconWrap?.className || ""}">
                    <span class="${iconSpan?.className || ""}"
                          style="display:flex;align-items:center;justify-content:center;font-size:13px;">🔧</span>
                </span>
                <span class="${nameSpan?.className || ""}">Dsuttz Scripts</span>
            </a>
        </div>`;
			GM_addStyle("#nav-dss-scripts-flyout { border-left: 3px solid #667eea; }");
			areas.appendChild(entry);
			entry.querySelector("a").addEventListener("click", dssNavClick);
		}
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		setTimeout(() => observer.disconnect(), 15e3);
		let flyoutPanel = null;
		let flyoutObs = null;
		function watchFlyout() {
			const panel = document.getElementById("fly-out-panel");
			if (panel !== flyoutPanel) {
				if (flyoutObs) {
					flyoutObs.disconnect();
					flyoutObs = null;
				}
				flyoutPanel = panel;
				if (panel) {
					flyoutObs = new MutationObserver(() => {
						if (!panel.querySelector("#nav-dss-scripts-flyout")) injectFlyoutNav();
					});
					flyoutObs.observe(panel, {
						childList: true,
						subtree: true
					});
				}
			}
			injectFlyoutNav();
		}
		watchFlyout();
		setInterval(watchFlyout, 5e3);
	}
	function setActiveNav() {
		const dss = document.getElementById("nav-dss-scripts");
		if (!dss) return;
		const isOnDSS = window.location.hash.startsWith("#/dss/");
		dss.classList.toggle("dss-active", isOnDSS);
		if (isOnDSS) {
			const strip = () => {
				const cityNav = document.getElementById("nav-city");
				if (cityNav) {
					[...cityNav.classList].forEach((c) => {
						if (c.includes("active")) cityNav.classList.remove(c);
					});
					cityNav.querySelectorAll("*").forEach((child) => {
						[...child.classList].forEach((c) => {
							if (c.includes("active")) child.classList.remove(c);
						});
					});
				}
			};
			strip();
			setTimeout(strip, 200);
			setTimeout(strip, 500);
		}
	}

// src/core/init.js
	function init() {
		addSidebarButton();
		if (window.location.hash.startsWith("#/dss/")) {
			if (!window.location.pathname.includes("/city.php")) {
				window.location.href = "https://www.torn.com/city.php" + window.location.hash;
			} else {
				setTimeout(() => {
					UI.render();
					setActiveNav();
				}, 100);
			}
		}
		window.addEventListener("hashchange", () => {
			if (window.location.hash.startsWith("#/dss/")) {
				if (!window.location.pathname.includes("/city.php")) {
					window.location.href = "https://www.torn.com/city.php" + window.location.hash;
					return;
				}
				setTimeout(() => {
					UI.render();
					setActiveNav();
				}, 100);
			} else {
				UI.clear();
				setActiveNav();
			}
		});
		const s = Storage.getSettings();
		const lastFactionCheck = Number(GM_getValue("dss_faction_checked", 0));
		if (s.apiKeyValid && s.apiKey && Date.now() - lastFactionCheck > 864e5) {
			validateApiKey(s.apiKey).then((r) => {
				if (!r.valid) return;
				const cur = Storage.getSettings();
				cur.myFactionId = r.factionId || "";
				Storage.setSettings(cur);
				GM_setValue("dss_faction_checked", Date.now());
			});
		}
		Loader.runAll();
	}

// src/modules/tyronic-war/guide.html?raw
	var guide_default$15 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">What it does</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Replaces the ranked war member list on the faction war page with <strong>Tyronic</strong> war data, drawn natively in Torn: dibs and assists, live hospital/jail timers, stat estimates, travel landing times, activity, roll call and the merc list.</p>\n                <p>Statuses update instantly from Torn's own page data; if Tyronic falls behind, the panel switches to a light Torn API fallback on its own.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Setup</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Uses the API key from your DSS settings. To use a different key, open the panel's <strong>⚙</strong> settings on the war page.</p>\n                <p>Your faction must be on Tyronic. Refresh rate, warnings, presence and columns are all set from the panel's <strong>⚙</strong> menu.</p>\n                <p>If you had the standalone <em>Torn War -&gt; Tyronic Native Panel</em> script installed, disable it - only one panel runs at a time.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Tips</div>\n            <div class=\"dss-guide-card-body\">\n                <p><strong>Torn list</strong> swaps back to Torn's own list at any time. The strip under the score header shows our faction's finished attacks as they land.</p>\n            </div>\n        </div>\n    ";

// src/modules/tyronic-war/index.js
	registerModule("tyronic-war", {
		name: "Tyronic War Panel",
		version: "3.52.3",
		factions: ["9357"],
		description: "Replaces the ranked war member list with Tyronic war data: dibs, assists, live hospital timers, stat estimates, travel, activity, roll call and an attack ticker.",
		pages: ["torn.com/factions.php"],
		excludePages: ["step=profile"],
		guide: guide_default$15,
		init() {
			const DSS_GM = (() => {
				const gm = {
					getValue: typeof GM_getValue === "function" ? GM_getValue : null,
					setValue: typeof GM_setValue === "function" ? GM_setValue : null,
					addStyle: typeof GM_addStyle === "function" ? GM_addStyle : null,
					menu: typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : null,
					xhr: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null,
					pdaGet: typeof PDA_httpGet === "function" ? PDA_httpGet : null,
					pdaPost: typeof PDA_httpPost === "function" ? PDA_httpPost : null
				};
				const LS = "dss-ty:";
				const isPDA = !!(gm.pdaPost || gm.pdaGet);
				const env = isPDA ? "Torn PDA (native)" : gm.xhr ? "userscript manager" : "none";
				return {
					env,
					getValue: (k, d) => {
						let v;
						if (gm.getValue) v = gm.getValue("tyr_" + k, d);
						else {
							try {
								const raw = localStorage.getItem(LS + k);
								v = raw == null ? d : JSON.parse(raw);
							} catch (_) {
								v = d;
							}
						}
						if (k === "tornKey" && !v) {
							try {
								const s = Storage.getSettings();
								if (s && s.apiKey) return s.apiKey;
							} catch (_) {}
						}
						return v;
					},
					setValue: gm.setValue ? ((k, v) => gm.setValue("tyr_" + k, v)) : ((k, v) => {
						try {
							localStorage.setItem(LS + k, JSON.stringify(v));
						} catch (_) {}
					}),
					addStyle: gm.addStyle || ((css) => {
						const el = document.createElement("style");
						el.textContent = css;
						(document.head || document.documentElement).appendChild(el);
						return el;
					}),
					registerMenuCommand: gm.menu || (() => {}),
					xmlhttpRequest: !isPDA && gm.xhr || ((o) => {
						const done = (r) => {
							let text = r && (r.responseText != null ? r.responseText : r.body != null ? r.body : r.data);
							if (text != null && typeof text !== "string") {
								try {
									text = JSON.stringify(text);
								} catch (_) {
									text = String(text);
								}
							}
							const status = Number(r && (r.status != null ? r.status : r.statusCode)) || 0;
							if (!status) return o.onerror && o.onerror();
							o.onload && o.onload({
								status,
								responseText: text || ""
							});
						};
						const fail = () => o.onerror && o.onerror();
						let data = o.data || "";
						if (typeof data !== "string") data = JSON.stringify(data);
						try {
							if (gm.pdaPost && o.method === "POST") return Promise.resolve(gm.pdaPost(o.url, o.headers || {}, data)).then(done, fail);
							if (gm.pdaGet && (o.method || "GET") === "GET") return Promise.resolve(gm.pdaGet(o.url, o.headers || {})).then(done, fail);
						} catch (e) {
							fail(e);
							return;
						}
						setTimeout(() => o.onerror && o.onerror(new Error("no cross-origin transport")), 0);
					})
				};
			})();
			(function() {
				"use strict";
				if (document.documentElement.dataset.dssTyronic) return;
				document.documentElement.dataset.dssTyronic = "dss";
				const GM_getValue = DSS_GM.getValue, GM_setValue = DSS_GM.setValue, GM_addStyle = DSS_GM.addStyle, GM_registerMenuCommand = DSS_GM.registerMenuCommand, GM_xmlhttpRequest = DSS_GM.xmlhttpRequest;
				const SB = "https://iwmpklkqwlniguyeaygv.supabase.co";
				const PUB_KEY = "sb_publishable_HhDjKMdmr14Xjc6yqgXOkw_E7EJT4uK";
				const SCHEMA = "tyapi";
				const MIN_POLL_S = 3;
				const pollMs = () => Math.max(MIN_POLL_S, Number(GM_getValue("pollSec", MIN_POLL_S)) || MIN_POLL_S) * 1e3;
				const BOX_ID = "dss-ty";
				const HIDE = "dss-ty-hidden";
				let state = null, lastFetch = 0, lastAsked = 0, busyAt = 0, error = null, busy = false, showOriginal = !!GM_getValue("showOriginal", false), pending = null;
				let view = GM_getValue("view", "enemy");
				let filter = GM_getValue("filter", "all");
				let stFilter = GM_getValue("stFilter", "all");
				let revFilter = GM_getValue("revFilter", "all") === "yes" ? "yes" : "all";
				let ctryFilter = new Set(GM_getValue("ctryFilter", []) || []);
				let sortKey = "status";
				let sortDir = 1;
				let search = "";
				let failStreak = 0;
				let lastScrollLeft = 0, lastScrollTop = 0, lastViewKey = "";
				GM_registerMenuCommand("Tyronic panel settings", () => openSettings(true));
				function openSettings(force) {
					const box = document.getElementById(BOX_ID);
					if (!box) return;
					const cfg = box.querySelector(".cfg");
					const open = force === true ? true : force === false ? false : cfg.hidden;
					cfg.hidden = !open;
					box.querySelector("[data-a=key]").classList.toggle("on", open);
					if (open) {
						cfg.querySelector("#dss-poll").value = pollMs() / 1e3;
						cfg.querySelector("#dss-rev").value = revPerMin();
						cfg.querySelector("#dss-revevery").value = revEvery();
						cfg.querySelector("#dss-dibwarn").value = dibWarnSec();
						cfg.querySelectorAll(".seg[data-g=pres] button").forEach((b) => b.classList.toggle("on", b.dataset.v === presMode()));
						const inp = cfg.querySelector(".keyin");
						inp.value = GM_getValue("tornKey", "");
						inp.classList.add("masked");
						cfg.querySelector(".cfg-status").textContent = GM_getValue("tornKey", "") ? "" : "Paste the Torn API key you use on tyronic.io.";
						cfg.querySelector(".cfg-status").className = "cfg-status";
						setTimeout(() => inp.focus(), 0);
					}
				}
				async function saveKey(key) {
					const box = document.getElementById(BOX_ID);
					const st = box.querySelector(".cfg-status");
					key = (key || "").trim();
					if (!/^[A-Za-z0-9]{16}$/.test(key)) {
						st.textContent = "That doesn’t look like a Torn API key (16 letters/numbers).";
						st.className = "cfg-status err";
						return;
					}
					st.textContent = "Checking with Tyronic…";
					st.className = "cfg-status";
					const prevKey = GM_getValue("tornKey", ""), prevSession = GM_getValue("session", null);
					GM_setValue("tornKey", key);
					GM_setValue("session", null);
					try {
						await newToken();
						error = null;
						const me = state && state.user && (memberName(state.user.user_id) || `#${state.user.user_id}`);
						st.textContent = `Connected${me ? " as " + me : ""}.`;
						st.className = "cfg-status ok";
						revStop = null;
						revPauseUntil = 0;
						render();
						setTimeout(() => openSettings(false), 1200);
						refresh(true);
					} catch (e) {
						GM_setValue("tornKey", prevKey);
						GM_setValue("session", prevSession);
						st.textContent = `Tyronic rejected that key \u2014 ${e.message}`;
						st.className = "cfg-status err";
					}
				}
				function memberName(id) {
					for (const f of [state && state.home_faction, state && state.away_faction]) for (const m of f && f.members || []) if (m.player_id === id) return m.name;
					return null;
				}
				const SERIAL = DSS_GM.env === "Torn PDA (native)";
				const ATK_TARGET = SERIAL ? "_self" : "_blank";
				const reqQueue = [];
				let reqActive = false;
				function req(method, url, headers, body, priority) {
					if (!SERIAL) return reqOnce(method, url, headers, body);
					return new Promise((resolve, reject) => {
						const job = { run: () => reqOnce(method, url, headers, body).then(resolve, reject) };
						if (priority) reqQueue.unshift(job);
						else reqQueue.push(job);
						reqPump();
					});
				}
				function reqPump() {
					if (reqActive || !reqQueue.length) return;
					reqActive = true;
					reqQueue.shift().run().then(() => {
						reqActive = false;
						reqPump();
					});
				}
				const REQ_TIMEOUT = 2e4;
				function reqOnce(method, url, headers, body) {
					return new Promise((res, rej) => {
						let done = false;
						const resolve = (v) => {
							if (!done) {
								done = true;
								clearTimeout(dog);
								res(v);
							}
						};
						const reject = (e) => {
							if (!done) {
								done = true;
								clearTimeout(dog);
								rej(e);
							}
						};
						const dog = setTimeout(() => reject(Object.assign(new Error("Request timed out"), {
							network: true,
							watchdog: true
						})), REQ_TIMEOUT + 5e3);
						GM_xmlhttpRequest({
							method,
							url,
							headers,
							data: body !== undefined ? JSON.stringify(body) : undefined,
							timeout: REQ_TIMEOUT,
							onabort: () => reject(Object.assign(new Error("Request aborted"), { network: true })),
							onload: (r) => {
								let json = null;
								try {
									json = JSON.parse(r.responseText);
								} catch (_) {}
								if (r.status >= 200 && r.status < 300) return resolve(json);
								const msg = json && (json.message || json.error || json.msg);
								const hint = json && (json.hint || json.details);
								reject(Object.assign(new Error(`HTTP ${r.status}${msg ? ": " + msg : ""}${hint ? " — " + hint : ""}`), {
									status: r.status,
									code: json && json.code,
									hint,
									body: json || r.responseText
								}));
							},
							onerror: () => reject(Object.assign(new Error(DSS_GM.env === "none" ? "No way to reach Tyronic from this page — install via Tampermonkey/Violentmonkey (with GM_xmlhttpRequest granted) or Torn PDA" : "Network error"), { network: true })),
							ontimeout: () => reject(Object.assign(new Error("Request timed out"), { network: true }))
						});
					});
				}
				let tokenInFlight = null;
				function getToken(force) {
					const s = GM_getValue("session", null);
					if (!force && s && Date.parse(s.expires_at) - Date.now() > 12e4) return Promise.resolve(s.token);
					if (!tokenInFlight) tokenInFlight = newToken().finally(() => {
						tokenInFlight = null;
					});
					return tokenInFlight;
				}
				async function newToken() {
					const key = GM_getValue("tornKey", "");
					if (!key) throw Object.assign(new Error("No Torn API key set"), { needKey: true });
					const res = await req("POST", `${SB}/functions/v1/register-session`, {
						"Content-Type": "application/json",
						apikey: PUB_KEY,
						Authorization: `Bearer ${PUB_KEY}`
					}, { torn_api_key: key });
					if (!res || !res.token) throw new Error("register-session returned no token");
					GM_setValue("session", {
						token: res.token,
						expires_at: res.expires_at
					});
					if (res.state) {
						state = res.state;
						lastFetch = lastAsked = Date.now();
						liveOnTyronic(true);
					}
					return res.token;
				}
				async function pg(method, path, body, retried, priority) {
					const token = await getToken(false);
					try {
						return await req(method, `${SB}/rest/v1/${path}`, {
							"Content-Type": "application/json",
							"Content-Profile": SCHEMA,
							"Accept-Profile": SCHEMA,
							Prefer: "return=representation",
							apikey: PUB_KEY,
							Authorization: `Bearer ${token}`
						}, body, priority);
					} catch (e) {
						if (!retried && (e.status === 401 || e.status === 403 && /jwt/i.test(e.message))) {
							await getToken(true);
							return pg(method, path, body, true, priority);
						}
						throw e;
					}
				}
				const ACTIONS = {
					setdib: 1,
					removedib: 1,
					assistdib: 1,
					updaterollcall: 1,
					updateconfig: 1
				};
				async function rpc(name, args) {
					const out = await pg("POST", `rpc/${name}`, args || {}, false, !!ACTIONS[name]);
					if (ACTIONS[name] && out && typeof out === "object" && !Array.isArray(out) && out.code != null && !(+out.code >= 200 && +out.code < 300)) throw Object.assign(new Error(out.status || out.message || `Tyronic refused (code ${out.code})`), { tyronic: out });
					return out;
				}
				let refreshAgain = false;
				async function refresh(force) {
					if (!GM_getValue("tornKey", "")) {
						error = Object.assign(new Error("No Torn API key set"), { needKey: true });
						render();
						const cfg = document.querySelector(`#${BOX_ID} .cfg`);
						if (cfg && cfg.hidden && !refresh.askedKey) {
							refresh.askedKey = true;
							openSettings(true);
						}
						return;
					}
					refresh.askedKey = false;
					if (busy) {
						if (force) refreshAgain = true;
						return;
					}
					if (!force && document.hidden || !document.getElementById(BOX_ID)) return;
					busy = true;
					busyAt = Date.now();
					tick();
					const asked = busyAt;
					try {
						try {
							state = await rpc("getstate", {});
						} catch (e) {
							if (!e.network) throw e;
							await new Promise((r) => setTimeout(r, 700));
							state = await rpc("getstate", {});
						}
						lastFetch = Date.now();
						lastAsked = asked;
						error = null;
						failStreak = 0;
						liveOnTyronic(true);
					} catch (e) {
						failStreak++;
						if (failStreak >= 2 || !state) error = e;
						liveOnTyronic(false);
					} finally {
						busy = false;
						render();
						if (refreshAgain) {
							refreshAgain = false;
							refresh(true);
						}
					}
				}
				const api = {
					setDib: (foe, assist = false) => rpc("setdib", { _dib: {
						faction_id: state.user.faction_id,
						player_id: state.user.user_id,
						foe_id: foe,
						sticky: false,
						assist: !!assist
					} }),
					removeDib: (d) => rpc("removedib", { _dibid: d.dib_id }),
					assistDib: (d, ids, extra) => rpc("assistdib", { _dib: Object.assign({}, d, { assist_player_ids: ids }, extra || {}) })
				};
				function setAssistRequest(d, on) {
					return api.assistDib(d, [], { assist_enabled: on });
				}
				const dibsByFoe = () => {
					const out = {};
					for (const d of state.dibs || []) if (d && d.foe_id != null) out[d.foe_id] = d;
					return out;
				};
				const OPT_MS = 15e3;
				let optimistic = null;
				function optOverlay() {
					if (!optimistic || !state) return;
					if (optimistic.confirmed(state)) {
						if (pending === optimistic.key) pending = null;
						optimistic = null;
						return;
					}
					if (Date.now() > optimistic.until) {
						if (pending === optimistic.key) pending = null;
						optimistic = null;
						return;
					}
					optimistic.apply(state);
				}
				const myDibOn = (st, foe, me) => (st.dibs || []).some((x) => x && x.foe_id === foe && x.player_id === me);
				function optFor(kind, foeId, d, me) {
					const key = `${kind}:${foeId}`, until = Date.now() + OPT_MS;
					if (kind === "dib" && !d) return {
						key,
						until,
						apply: (st) => {
							if (!myDibOn(st, foeId, me)) st.dibs = [...st.dibs || [], {
								dib_id: -1,
								foe_id: foeId,
								player_id: me,
								assist_player_ids: [],
								assist_enabled: false,
								dib_window_resolved: true,
								created_at: new Date().toISOString(),
								optimistic: true
							}];
						},
						confirmed: (st) => (st.dibs || []).some((x) => x && x.foe_id === foeId && x.player_id === me && !x.optimistic)
					};
					if (kind === "dib" && d && d.player_id === me) return {
						key,
						until,
						apply: (st) => {
							st.dibs = (st.dibs || []).filter((x) => !(x && x.foe_id === foeId && x.player_id === me));
						},
						confirmed: (st) => !myDibOn(st, foeId, me)
					};
					if (kind === "assist" && d) {
						const joining = !(d.assist_player_ids || []).includes(me);
						const has = (st) => {
							const x = (st.dibs || []).find((y) => y && y.dib_id === d.dib_id);
							return !!x && (x.assist_player_ids || []).includes(me);
						};
						return {
							key,
							until,
							apply: (st) => {
								const x = (st.dibs || []).find((y) => y && y.dib_id === d.dib_id);
								if (!x) return;
								const cur = x.assist_player_ids || [];
								x.assist_player_ids = joining ? cur.includes(me) ? cur : [...cur, me] : cur.filter((y) => y !== me);
							},
							confirmed: (st) => has(st) === joining || !(st.dibs || []).some((y) => y && y.dib_id === d.dib_id)
						};
					}
					if (kind === "request" && d && d.player_id === me) {
						const on = !d.assist_enabled;
						return {
							key,
							until,
							apply: (st) => {
								const x = (st.dibs || []).find((y) => y && y.dib_id === d.dib_id);
								if (x) {
									x.assist_enabled = on;
									x.assist_player_ids = [];
								}
							},
							confirmed: (st) => {
								const x = (st.dibs || []).find((y) => y && y.dib_id === d.dib_id);
								return !x || !!x.assist_enabled === on;
							}
						};
					}
					return null;
				}
				let actionBusy = false;
				async function doAction(kind, foeId) {
					const me = state.user.user_id;
					const live0 = dibsByFoe()[foeId];
					const d = live0 && Object.assign({}, live0, { assist_player_ids: [...live0.assist_player_ids || []] });
					if (d && d.optimistic) {
						toast("Still saving your dib…", "warn", 2e3);
						return;
					}
					if (actionBusy) return;
					pending = `${kind}:${foeId}`;
					const opt = !(d && d.dib_window_resolved === false) ? optFor(kind, foeId, d, me) : null;
					const before = {
						st: state,
						dibs: state.dibs && state.dibs.map((x) => x && Object.assign({}, x, x.assist_player_ids ? { assist_player_ids: [...x.assist_player_ids] } : {}))
					};
					if (opt) {
						const mineCount = (state.dibs || []).filter((x) => x && x.player_id === me).length;
						const max = state.factionconfig && state.factionconfig.num_dibs || 1;
						if (!(kind === "dib" && !d && mineCount >= max)) {
							optimistic = opt;
							opt.apply(state);
						}
					}
					render();
					actionBusy = true;
					let failed = false;
					try {
						if (kind === "dib") {
							if (d && d.dib_window_resolved === false) {
								await api.setDib(foeId, false);
								toast(`Joined dib window on ${nameOf(foeId)}`, "ok");
							} else if (d && d.player_id === me) {
								await api.removeDib(d);
								toast("Dib removed", "ok");
							} else if (d) toast(`Already dibbed by ${nameOf(d.player_id)}`, "warn");
							else {
								const mineCount = (state.dibs || []).filter((x) => x && x.player_id === me && !x.optimistic).length;
								const max = state.factionconfig && state.factionconfig.num_dibs || 1;
								if (mineCount >= max) toast(`You already have ${mineCount}/${max} dib${max > 1 ? "s" : ""} \u2014 undib first`, "warn");
								else {
									await api.setDib(foeId, false);
									toast(`Dibbed ${nameOf(foeId)}`, "ok");
								}
							}
						} else if (kind === "request" && d && d.player_id === me) {
							const on = !d.assist_enabled;
							await setAssistRequest(d, on);
							toast(on ? `Assist requested on ${nameOf(foeId)}` : "Assist request cancelled", "ok");
						} else if (kind === "assist" && d) {
							const cur = d.assist_player_ids || [];
							const joining = !cur.includes(me);
							await api.assistDib(d, joining ? [...cur, me] : cur.filter((x) => x !== me));
							toast(joining ? `Assisting ${nameOf(d.player_id)} on ${nameOf(foeId)}` : "Stopped assisting", "ok");
						}
					} catch (e) {
						failed = true;
						toast(`${{
							dib: "Dib",
							assist: "Assist",
							request: "Assist request"
						}[kind]} failed \u2014 ${e.message}`, "err", 1e4);
					} finally {
						if (optimistic === opt && opt) {
							if (failed) optimistic = null;
							else optimistic.until = Math.min(optimistic.until, Date.now() + 5e3);
						}
						if (failed && opt && state === before.st) state.dibs = before.dibs;
						actionBusy = false;
						if (pending === `${kind}:${foeId}`) pending = null;
						render();
						refresh(true);
					}
				}
				const ROLLCALL_RPC = "updaterollcall";
				function rollIdx() {
					const out = {}, war = state && state.wardata && state.wardata.war_id;
					for (const r of state && state.rollcall || []) if (r && (war == null || r.war_id === war)) out[r.player_id] = r;
					return out;
				}
				const rollOn = () => !!(state && state.factionconfig && state.factionconfig.rollcall_enabled);
				const ynm = (v) => v === true ? "Yes" : v === false ? "No" : "Maybe";
				const ynmCls = (v) => v === true ? "y" : v === false ? "n" : "m";
				const hourTxt = (h) => h == null ? "Don’t know" : `${String(h).padStart(2, "0")}:00 TCT`;
				function rollTip(r) {
					if (!r) return "No roll call";
					const lines = ["Roll call", `Online at start: ${ynm(r.start_online)}`];
					if (r.start_online !== true) {
						lines.push(`Self-hosp: ${r.start_hosped == null ? "—" : ynm(r.start_hosped)}`, `Online at: ${hourTxt(r.hour_online)}`);
					}
					lines.push(`Chain-watch abroad: ${ynm(r.chain_watch)}`);
					if (r.note) lines.push(`Note: ${r.note}`);
					return lines.join("\n");
				}
				const rollRank = (r) => !r ? 9 : r.start_online === true ? 0 : r.start_online == null ? 1 : 2;
				const ACT_DAYS = [
					"Mon",
					"Tue",
					"Wed",
					"Thu",
					"Fri",
					"Sat",
					"Sun"
				];
				const ACT_C = {
					ours: "#3b8fe8",
					enemy: "#e5484d"
				};
				let actDay = null;
				const tctDow = (t = Date.now()) => new Date(t).getUTCDay() || 7;
				function actSeries(day) {
					const { ours, enemy } = sides(), oursHome = state.home_faction === ours;
					const pick = (arr) => {
						const out = Array(24).fill(null);
						for (const a of arr || []) if (a && a.d === day && a.h >= 0 && a.h < 24) out[a.h] = +a.v;
						return out;
					};
					return [{
						key: "ours",
						name: ours.info && ours.info.name || "Us",
						n: (ours.members || []).length,
						v: pick(oursHome ? state.home_activity : state.away_activity)
					}, {
						key: "enemy",
						name: enemy.info && enemy.info.name || "Them",
						n: (enemy.members || []).length,
						v: pick(oursHome ? state.away_activity : state.home_activity)
					}];
				}
				function actOpen() {
					const m = document.querySelector(`#${BOX_ID} .acm`);
					if (!m) return;
					actDay = null;
					m.hidden = false;
					fitOverlays();
					actPaint();
				}
				function actClose() {
					const m = document.querySelector(`#${BOX_ID} .acm`);
					if (m) m.hidden = true;
				}
				function actPaint() {
					const m = document.querySelector(`#${BOX_ID} .acm`);
					if (!m || m.hidden || !state) return;
					const today = tctDow(), day = actDay || today;
					m.querySelector(".acm-days").innerHTML = ACT_DAYS.map((n, i) => `<button type="button" data-d="${i + 1}" class="${i + 1 === day ? "on" : ""}">${n}${i + 1 === today ? "<i></i>" : ""}</button>`).join("");
					const S = actSeries(day), all = S.flatMap((x) => x.v).filter((v) => v != null);
					const plot = m.querySelector(".acm-plot");
					if (!all.length) {
						plot.innerHTML = "<div class=\"muted acm-none\">No activity history from Tyronic yet.</div>";
						m.querySelector(".acm-sum").textContent = "";
						return;
					}
					const W = Math.round(Math.max(320, Math.min(640, plot.clientWidth || 600))), H = W < 480 ? 190 : 210, L = 28, R = 90, T = 10, B = 24, pw = W - L - R, ph = H - T - B;
					const step = all.length && Math.max(...all) > 40 ? 20 : 10, top = Math.max(step, Math.ceil(Math.max(...all) / step) * step);
					const x = (h) => L + h / 23 * pw, y = (v) => T + ph - v / top * ph;
					let g = "";
					for (let v = 0; v <= top; v += step) g += `<line class="gl" x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
					for (let h = 0; h < 24; h += W < 480 ? 6 : 3) g += `<text class="ax" x="${x(h)}" y="${H - 6}" text-anchor="middle">${String(h).padStart(2, "0")}</text>`;
					const wd = state.wardata || {}, ws = Date.parse(wd.warstart);
					if (isFinite(ws) && tctDow(ws) === day) {
						const wh = new Date(ws).getUTCHours() + new Date(ws).getUTCMinutes() / 60;
						g += `<line class="mk" x1="${x(wh)}" x2="${x(wh)}" y1="${T}" y2="${T + ph}"/><text class="mkt" x="${x(wh) + 4}" y="${T + 9}">war start</text>`;
					}
					if (day === today) {
						const nh = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
						g += `<line class="now" x1="${x(nh)}" x2="${x(nh)}" y1="${T}" y2="${T + ph}"/><text class="mkt" x="${x(nh) + 4}" y="${T + ph - 4}">now</text>`;
					}
					const ends = S.map((sr) => {
						const last = sr.v.reduce((a, v, h) => v != null ? h : a, -1);
						return last < 0 ? null : {
							sr,
							h: last,
							yy: y(sr.v[last])
						};
					}).filter(Boolean);
					if (ends.length === 2 && Math.abs(ends[0].yy - ends[1].yy) < 14) {
						const [a, b2] = ends[0].yy < ends[1].yy ? ends : [ends[1], ends[0]];
						const mid = (a.yy + b2.yy) / 2;
						a.yy = mid - 7;
						b2.yy = mid + 7;
					}
					for (const sr of S) {
						const pts = sr.v.map((v, h) => v == null ? null : `${x(h).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(" ");
						if (pts) g += `<polyline class="ln" points="${pts}" stroke="${ACT_C[sr.key]}"/>`;
					}
					for (const e of ends) g += `<text class="dl" x="${x(e.h) + 6}" y="${e.yy + 4}"><tspan fill="${ACT_C[e.sr.key]}">\u25cf</tspan> ${esc(e.sr.name.length > 12 ? e.sr.name.slice(0, 11) + "…" : e.sr.name)}</text>`;
					g += `<g class="hov" visibility="hidden"><line class="xh" y1="${T}" y2="${T + ph}"/>${S.map((sr) => `<circle r="4" data-k="${sr.key}" fill="${ACT_C[sr.key]}"/>`).join("")}</g>`;
					g += `<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`;
					plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Average active members by hour on ${ACT_DAYS[day - 1]}: ` + S.map((sr) => `${sr.name} peak ${Math.round(Math.max(...sr.v.filter((v) => v != null)))}`).join(", "))}">${g}</svg><div class="acm-tip" hidden></div>`;
					m.querySelector(".acm-leg").innerHTML = S.map((sr) => `<span><i style="background:${ACT_C[sr.key]}"></i>${esc(sr.name)} <span class="muted">(${sr.n})</span></span>`).join("");
					const peak = (sr) => {
						let bh = -1, bv = -1;
						sr.v.forEach((v, h) => {
							if (v != null && v > bv) {
								bv = v;
								bh = h;
							}
						});
						return bh < 0 ? "" : `${esc(sr.name)} peaks ${String(bh).padStart(2, "0")}:00 (${Math.round(bv)})`;
					};
					m.querySelector(".acm-sum").innerHTML = S.map(peak).filter(Boolean).join(" · ");
					const svgEl = plot.querySelector("svg"), hov = svgEl.querySelector(".hov"), tip = plot.querySelector(".acm-tip");
					const move = (ev) => {
						const r = svgEl.getBoundingClientRect(), pt = ev.touches ? ev.touches[0] : ev;
						const h = Math.max(0, Math.min(23, Math.round(((pt.clientX - r.left) / r.width * W - L) / pw * 23)));
						hov.setAttribute("visibility", "visible");
						hov.querySelector(".xh").setAttribute("x1", x(h));
						hov.querySelector(".xh").setAttribute("x2", x(h));
						for (const c of hov.querySelectorAll("circle")) {
							const sr = S.find((z) => z.key === c.dataset.k), v = sr.v[h];
							c.setAttribute("visibility", v == null ? "hidden" : "visible");
							if (v != null) {
								c.setAttribute("cx", x(h));
								c.setAttribute("cy", y(v));
							}
						}
						tip.innerHTML = `<b>${ACT_DAYS[day - 1]} ${String(h).padStart(2, "0")}:00 TCT</b>` + S.map((sr) => `<div><i style="background:${ACT_C[sr.key]}"></i>${esc(sr.name)}<span class="num">${sr.v[h] == null ? "—" : Math.round(sr.v[h])}</span></div>`).join("");
						tip.hidden = false;
						const px = x(h) / W * r.width, tw = tip.offsetWidth;
						tip.style.left = `${Math.max(0, Math.min(r.width - tw, px + (px > r.width / 2 ? -tw - 12 : 12)))}px`;
					};
					const leave = () => {
						hov.setAttribute("visibility", "hidden");
						tip.hidden = true;
					};
					const hit = svgEl.querySelector(".hit");
					hit.addEventListener("mousemove", move);
					hit.addEventListener("mouseleave", leave);
					hit.addEventListener("touchstart", move, { passive: true });
					hit.addEventListener("touchmove", move, { passive: true });
				}
				const RS_COLS = {
					y: "var(--ok)",
					m: "var(--warn)",
					n: "var(--red)",
					x: "#3d4048"
				};
				const RS_TXT = {
					y: "Yes",
					m: "Maybe",
					n: "No",
					x: "No answer"
				};
				let rsPick = null;
				let rsNotesOpen = false;
				function rsOpen() {
					const m = document.querySelector(`#${BOX_ID} .rsm`);
					if (!m) return;
					rsPick = {
						q: "start",
						v: "x"
					};
					rsNotesOpen = false;
					m.hidden = false;
					fitOverlays();
					rsPaint();
				}
				function rsClose() {
					const m = document.querySelector(`#${BOX_ID} .rsm`);
					if (m) m.hidden = true;
				}
				function rsData() {
					const { ours } = sides(), rolls = rollIdx(), members = [...ours.members || []].sort((a, b) => a.name.localeCompare(b.name));
					const later = members.filter((m) => rolls[m.player_id] && rolls[m.player_id].start_online !== true);
					const key = (v) => v === true ? "y" : v === false ? "n" : "m";
					const Q = {
						start: {
							label: "Online at start",
							who: members,
							val: (m) => rolls[m.player_id] ? key(rolls[m.player_id].start_online) : "x",
							order: [
								"y",
								"m",
								"n",
								"x"
							]
						},
						hosp: {
							label: "Self-hosp before start",
							who: later,
							val: (m) => {
								const r = rolls[m.player_id];
								return r.start_hosped == null ? "x" : r.start_hosped ? "y" : "n";
							},
							order: [
								"y",
								"n",
								"x"
							],
							note: "of those not sure to be on at start"
						},
						watch: {
							label: "Chain-watch abroad",
							who: members.filter((m) => rolls[m.player_id]),
							val: (m) => key(rolls[m.player_id].chain_watch),
							order: [
								"y",
								"m",
								"n"
							]
						}
					};
					for (const k in Q) {
						const q = Q[k];
						q.groups = {};
						for (const v of q.order) q.groups[v] = [];
						for (const m of q.who) (q.groups[q.val(m)] = q.groups[q.val(m)] || []).push(m);
					}
					return {
						members,
						rolls,
						later,
						Q
					};
				}
				function rsPaint() {
					const box = document.getElementById(BOX_ID), m = box && box.querySelector(".rsm");
					if (!m || m.hidden || !state) return;
					const { members, rolls, later, Q } = rsData();
					const answered = members.filter((x) => rolls[x.player_id]).length;
					m.querySelector(".rsm-top").innerHTML = `<b class="num">${answered}</b><span class="muted">/${members.length} answered</span>`;
					m.querySelector(".rsm-qs").innerHTML = Object.entries(Q).map(([k, q]) => {
						const tot = q.who.length || 1;
						const seg = q.order.filter((v) => q.groups[v].length).map((v) => `<button type="button" class="rs-seg ${rsPick && rsPick.q === k && rsPick.v === v ? "on" : ""}" data-rq="${k}" data-rv="${v}" style="flex:${q.groups[v].length};background:${RS_COLS[v]}" title="${RS_TXT[v]}: ${q.groups[v].length}"></button>`).join("");
						const leg = q.order.filter((v) => q.groups[v].length || rsPick && rsPick.q === k && rsPick.v === v).map((v) => `<button type="button" class="rs-key ${rsPick && rsPick.q === k && rsPick.v === v ? "on" : ""}" data-rq="${k}" data-rv="${v}"><i style="background:${RS_COLS[v]}"></i>${RS_TXT[v]} <b class="num">${q.groups[v].length}</b><span class="muted num">${Math.round(q.groups[v].length / tot * 100)}%</span></button>`).join("");
						return `<div class="rs-q"><div class="rs-qh">${q.label}${q.note ? ` <span class="muted">(${q.who.length} ${q.note})</span>` : ""}</div>
        ${q.who.length ? `<div class="rs-bar">${seg}</div>` : "<div class=\"muted rs-empty\">Nobody yet</div>"}<div class="rs-keys">${leg}</div></div>`;
					}).join("");
					const pick = rsPick && Q[rsPick.q], names = pick ? pick.groups[rsPick.v] || [] : [];
					m.querySelector(".rsm-names").innerHTML = !pick ? "" : `<div class="rs-nh"><span><i style="background:${RS_COLS[rsPick.v]}"></i>${pick.label}: <b>${RS_TXT[rsPick.v]}</b> <span class="muted">(${names.length})</span></span>
        ${names.length ? "<button type=\"button\" class=\"ghost\" data-a=\"rscopy\">Copy names</button>" : ""}</div>
      <div class="rs-groups">${names.length ? rsBands(names).map((bd) => `<div class="rs-band"><div class="rs-bh">${bd.label} <span class="muted">(${bd.list.length})</span></div><div class="rs-chips">` + bd.list.map(({ m: x, v }) => {
						const r = rolls[x.player_id];
						const extra = rsPick.q === "start" && r && r.start_online !== true && r.hour_online != null ? ` <span class="muted num">${String(r.hour_online).padStart(2, "0")}h</span>` : "";
						return `<a class="rs-chip" href="https://www.torn.com/profiles.php?XID=${x.player_id}" target="_blank"><span class="dot ${esc(x.active_status)}"></span>${esc(x.name)}${v ? ` <span class="muted num">${fmtBS(v)}</span>` : ""}${extra}</a>`;
					}).join("") + "</div></div>").join("") : "<span class=\"muted\">Nobody</span>"}</div>`;
					const hrs = Array(24).fill(0);
					let unknown = 0;
					for (const x of later) {
						const h = rolls[x.player_id].hour_online;
						if (h == null || h < 0 || h > 23) unknown++;
						else hrs[h]++;
					}
					const hp = m.querySelector(".rsm-hours"), max = Math.max(1, ...hrs);
					if (!later.length) hp.innerHTML = "";
					else if (!hrs.some(Boolean)) hp.innerHTML = `<div class="rs-qh">When the rest come online <span class="muted">(nobody gave an hour \u00b7 ${unknown} don\u2019t know)</span></div>`;
					else {
						const W = Math.round(Math.max(300, Math.min(640, hp.clientWidth || 600))), H = 120, L = 6, R = 6, T = 14, B = 18, pw = W - L - R, ph = H - T - B, bw = pw / 24;
						const ws = Date.parse((state.wardata || {}).warstart), wh = isFinite(ws) ? new Date(ws).getUTCHours() : -1;
						let g = `<line class="gl" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/>`;
						hrs.forEach((n, h) => {
							const x = L + h * bw, bh = n / max * ph;
							if (n) g += `<rect class="hb" x="${(x + 1).toFixed(1)}" y="${(T + ph - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2"><title>${String(h).padStart(2, "0")}:00 TCT: ${n}</title></rect><text class="hn" x="${(x + bw / 2).toFixed(1)}" y="${(T + ph - bh - 3).toFixed(1)}" text-anchor="middle">${n}</text>`;
							if (h % (W < 480 ? 6 : 3) === 0) g += `<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${String(h).padStart(2, "0")}</text>`;
						});
						if (wh >= 0) g += `<line class="mk" x1="${(L + wh * bw).toFixed(1)}" x2="${(L + wh * bw).toFixed(1)}" y1="${T - 6}" y2="${T + ph}"/><text class="mkt" x="${(L + wh * bw + 3).toFixed(1)}" y="${T - 2}">war start</text>`;
						hp.innerHTML = `<div class="rs-qh">When the rest come online <span class="muted">(TCT${unknown ? ` \u00b7 ${unknown} don\u2019t know` : ""})</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours players will come online">${g}</svg>`;
					}
					const notes = members.filter((x) => rolls[x.player_id] && rolls[x.player_id].note);
					const nb = m.querySelector(".rsm-notes");
					nb.innerHTML = !notes.length ? "" : `<details${rsNotesOpen ? " open" : ""}><summary class="rs-qh">Notes <span class="muted">(${notes.length})</span></summary>` + notes.map((x) => `<div class="rs-note"><b>${esc(x.name)}</b> ${esc(rolls[x.player_id].note)}</div>`).join("") + "</details>";
					const det = nb.querySelector("details");
					if (det) det.addEventListener("toggle", () => {
						rsNotesOpen = det.open;
					});
				}
				const RS_BANDS = [
					[5e10, "50B+"],
					[2e10, "20B – 50B"],
					[1e10, "10B – 20B"],
					[5e9, "5B – 10B"],
					[1e9, "1B – 5B"],
					[0, "Under 1B"]
				];
				function rsBands(list) {
					const sIdx = statsIndex(), out = RS_BANDS.map(([min, label]) => ({
						min,
						label,
						list: []
					})), none = {
						label: "No estimate",
						list: []
					};
					for (const m of list) {
						const v = bestEst(sIdx[m.player_id] || {}).v;
						if (!v) {
							none.list.push({
								m,
								v: 0
							});
							continue;
						}
						out.find((b) => v >= b.min).list.push({
							m,
							v
						});
					}
					for (const b of out) b.list.sort((a, c) => c.v - a.v);
					return [...out, none].filter((b) => b.list.length);
				}
				async function rsCopy(btn) {
					const { Q } = rsData(), names = rsPick && Q[rsPick.q] ? Q[rsPick.q].groups[rsPick.v] || [] : [];
					const txt = rsBands(names).map((b) => `${b.label}: ${b.list.map((x) => x.m.name).join(", ")}`).join("\n");
					let ok = false;
					try {
						await navigator.clipboard.writeText(txt);
						ok = true;
					} catch (_) {
						try {
							const ta = document.createElement("textarea");
							ta.value = txt;
							document.body.appendChild(ta);
							ta.select();
							ok = document.execCommand("copy");
							ta.remove();
						} catch (__) {
							ok = false;
						}
					}
					btn.textContent = ok ? `\u2713 Copied ${names.length}` : "Copy blocked";
					setTimeout(() => {
						if (btn.isConnected) btn.textContent = "Copy names";
					}, 2e3);
				}
				const TRAV_ORDER = [
					"mexico",
					"cayman islands",
					"canada",
					"hawaii",
					"united kingdom",
					"argentina",
					"switzerland",
					"japan",
					"china",
					"uae",
					"south africa"
				];
				const TRAV_IC = {
					out: "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2 22h20\"/><path d=\"M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z\"/></svg>",
					back: "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2 22h20\"/><path d=\"M3.77 10.77 2 9l2-4.5 1.1.55c.55.28.9.84.9 1.45s.35 1.17.9 1.45L8 8.5l3-6 1.05.53a2 2 0 0 1 1.09 1.52l.72 5.4a2 2 0 0 0 1.09 1.52l4.4 2.2c.42.22.78.55 1.01.96l.6 1.03c.49.88-.06 1.98-1.06 2.1l-1.18.15c-.47.06-.95-.02-1.37-.24L4.29 11.15a2 2 0 0 1-.52-.38Z\"/></svg>",
					abroad: "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/></svg>"
				};
				let travSort = GM_getValue("travSort", "flight");
				let travEmpty = false;
				const travDir = {
					ours: null,
					enemy: null
				};
				const travCtry = new Set();
				function travOpen() {
					const m = document.querySelector(`#${BOX_ID} .trm`);
					if (!m) return;
					m.hidden = false;
					fitOverlays();
					travPaint();
				}
				function travClose() {
					const m = document.querySelector(`#${BOX_ID} .trm`);
					if (m) m.hidden = true;
					popHide();
				}
				function travInfo(m, sIdx, mine) {
					const st = statusInfo(m);
					if (st.rank !== 3 || !st.where) return null;
					const p = travelPlan(m), now = Date.now(), est = bestEst(sIdx[m.player_id] || {}).v;
					const dir = m.status_state === "Abroad" ? "abroad" : m.travel_destination === "Torn" ? "back" : "out";
					let sortT = Infinity, when = "", cls = "", tip = "";
					const win = (lo, hi) => p.exact ? `${hm(hi)}` : `${hm(lo)}\u2013${hm(hi)}`;
					if (dir === "abroad") {
						sortT = 9e15 - (p && p.known ? p.hi : 0);
						when = `<span class="muted">${p && p.known ? "there " + (now - p.hi >= 864e5 ? `${Math.floor((now - p.hi) / 864e5)}d ${Math.floor((now - p.hi) % 864e5 / 36e5)}h` : relMin(now - p.hi)) : "abroad"}</span>`;
						tip = `In ${st.where}` + (p && p.known ? `\nLanded ${win(p.lo, p.hi)} TCT` : "");
					} else if (!p || !p.known) {
						sortT = 8e15;
						when = "<span class=\"muted\">?</span>";
						tip = `${dir === "back" ? "Returning to Torn from" : "Flying to"} ${st.where}\nDeparture time unknown`;
					} else {
						const next = p.rows.find((r) => now <= r.hi);
						tip = `${dir === "back" ? "Returning to Torn from" : "Flying to"} ${st.where}${p.ticket ? ` (${p.ticket})` : ""}\nLeft ${win(p.lo, p.hi)} TCT\n` + p.rows.map((r) => `${r.t}: ${win(r.lo, r.hi)}${now > r.hi ? p.ticket ? " (due)" : " (ruled out)" : ""}`).join("\n");
						if (!next) {
							sortT = 7e15;
							when = "<span class=\"muted\">due</span>";
						} else if (now >= next.lo) {
							sortT = now;
							when = "<span class=\"tv-now\">landing</span>";
							cls = "soon";
						} else {
							sortT = next.lo;
							when = `<span class="muted">in </span><span class="num" data-until="${next.lo}">${clock(next.lo - now)}</span>`;
							if (next.lo - now < 5 * 6e4) cls = "soon";
						}
					}
					return {
						m,
						dir,
						key: flagKey(st.where),
						where: st.where,
						est,
						estCls: strengthClass(est, mine),
						sortT,
						when,
						cls,
						tip
					};
				}
				function travPaint() {
					const box = document.getElementById(BOX_ID), el = box && box.querySelector(".trm");
					if (!el || el.hidden || !state) return;
					const { ours, enemy } = sides(), sIdx = statsIndex(), mine = bestEst(sIdx[state.user.user_id] || {}).v;
					const sideRows = (f) => (f.members || []).map((m) => travInfo(m, sIdx, mine)).filter(Boolean);
					const S = [{
						k: "ours",
						f: ours,
						all: sideRows(ours)
					}, {
						k: "enemy",
						f: enemy,
						all: sideRows(enemy)
					}];
					S.forEach((x) => {
						x.list = travDir[x.k] ? x.all.filter((t) => t.dir === travDir[x.k]) : x.all;
					});
					const keys = new Set(TRAV_ORDER);
					S.forEach((x) => x.list.forEach((t) => keys.add(t.key)));
					let rows = [...keys].map((k) => ({
						k,
						name: (S.flatMap((x) => x.list).find((t) => t.key === k) || {}).where || k.replace(/\b\w/g, (c) => c.toUpperCase()),
						cells: S.map((x) => x.list.filter((t) => t.key === k).sort((a, b) => a.sortT - b.sortT || a.m.name.localeCompare(b.m.name)))
					}));
					rows.forEach((r) => {
						r.name = r.k === "uae" ? "UAE" : r.name.replace(/\b\w/g, (c) => c.toUpperCase());
						r.n = r.cells[0].length + r.cells[1].length;
					});
					if (travSort === "az") rows.sort((a, b) => a.name.localeCompare(b.name));
					else rows.sort((a, b) => (TRAV_ORDER.indexOf(a.k) + 1 || 99) - (TRAV_ORDER.indexOf(b.k) + 1 || 99));
					for (const k of [...travCtry]) if (!rows.some((r) => r.k === k && r.n)) travCtry.delete(k);
					if (travCtry.size) rows = rows.filter((r) => travCtry.has(r.k));
					const empty = rows.filter((r) => !r.n), filtered = !!(travDir.ours || travDir.enemy);
					if (!travEmpty || travCtry.size) rows = rows.filter((r) => r.n);
					const cnt = (list) => ({
						out: list.filter((t) => t.dir === "out").length,
						back: list.filter((t) => t.dir === "back").length,
						abroad: list.filter((t) => t.dir === "abroad").length
					});
					const DIR_TXT = {
						out: "flying out",
						back: "returning to Torn",
						abroad: "abroad"
					};
					const head = (x) => {
						const c = cnt(x.all), on = travDir[x.k];
						const b = (d) => `<button type="button" class="tv-f ${on === d ? "on" : ""}" data-tdir="${d}" data-side="${x.k}" title="${on === d ? "Show everyone" : `Only ${DIR_TXT[d]}`}">${TRAV_IC[d]}${c[d]}</button>`;
						return `<div class="tv-fh ${x.k}"><b>${esc(x.f.info && x.f.info.name || (x.k === "ours" ? "Us" : "Them"))}</b><span class="tv-cnt">${b("out")}${b("back")}${b("abroad")}</span></div>`;
					};
					const line = (t) => `<div class="tv-p ${t.cls}" data-pop="${t.m.player_id}" aria-label="${esc(t.tip.replace(/\n/g, " · "))}"><span class="tv-ic ${t.dir}">${TRAV_IC[t.dir]}</span>` + `<a class="tv-n" href="https://www.torn.com/profiles.php?XID=${t.m.player_id}" target="_blank"><span class="dot ${esc(t.m.active_status)}"></span>${esc(t.m.name)}</a>` + `<span class="tv-s num ${t.est ? t.estCls : "none"}">${t.est ? fmtBS(t.est) : "—"}</span><span class="tv-t">${t.when}</span></div>`;
					const cell = (list, k) => list.length ? `<div class="tv-c ${k}">${list.map(line).join("")}</div>` : "<div class=\"tv-c none\"></div>";
					const html = `<div class="tv-grid">
        <div class="tv-corner">${travCtry.size ? "<button type=\"button\" class=\"tv-all\" data-tctry=\"\" title=\"Show all countries\">✕ All countries</button>" : ""}</div>${S.map(head).join("")}
        ${rows.map((r) => `<div class="tv-ct ${r.n ? "" : "mt"}" ${r.n ? `data-tctry="${esc(r.k)}" title="${travCtry.has(r.k) ? "Show all countries" : `Only ${esc(r.name)}`}"` : ""}>${flag(r.name)}<span>${esc(r.name)}</span></div>${r.cells.map((c, i) => cell(c, S[i].k)).join("")}`).join("")}
      </div>
      ${!rows.length ? `<div class="muted tv-none">${filtered ? "Nobody matches the filter." : "Nobody is travelling right now."}</div>` : ""}
      ${!travEmpty && !travCtry.size && empty.length && rows.length ? `<div class="muted tv-empty">${filtered ? "No matches in" : "Nobody in or flying to"}: ${empty.map((r) => esc(r.name)).join(", ")}</div>` : ""}`;
					el.querySelectorAll(".trm-sort button").forEach((b) => b.classList.toggle("on", b.dataset.v === travSort));
					el.querySelector("[data-a=travempty]").classList.toggle("on", travEmpty);
					const body = el.querySelector(".trm-body");
					if (!sameHtml(body, html)) {
						body.innerHTML = html;
						stripTitles(body);
					}
				}
				const FS_STRAT = [
					["None", "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m5.6 5.6 12.8 12.8\"/>"],
					["Turtle", "<path d=\"M3 15c0-4.4 4-8 9-8s9 3.6 9 8\"/><path d=\"M3 15h18\"/><path d=\"M7 15v3M17 15v3M21 13h1.5\"/><path d=\"M9 8.5 10.5 12h3L15 8.5\"/>"],
					["Attack", "<path d=\"M14.5 17.5 3 6V3h3l11.5 11.5\"/><path d=\"m13 19 6-6M16 16l4 4M19 21l2-2\"/><path d=\"M14.5 6.5 18 3h3v3l-3.5 3.5\"/><path d=\"m5 14 4 4M7 17l-3 3M3 19l2 2\"/>"],
					["Custom", "<path d=\"M4 6h16M4 12h16M4 18h10\"/>"]
				];
				const FS_NUM = {
					dibs_time: [
						60,
						1800,
						60,
						(v) => `${Math.round(v / 60)}m`
					],
					num_dibs: [
						1,
						10,
						1,
						(v) => v
					],
					num_assists: [
						0,
						10,
						1,
						(v) => v
					]
				};
				let fsSaving = false;
				const fsCanEdit = () => !!(state && state.user && String(state.user.access_name || "").toUpperCase() !== "MEMBER" && state.user.access_name);
				function stratPill() {
					const c = state && state.factionconfig || {}, st = Number(c.strategy) || 0;
					if (!st || !FS_STRAT[st]) return "";
					const name = st === 3 ? c.strategy_custom_title || "Custom" : FS_STRAT[st][0];
					const tip = `Faction strategy: ${name}` + (st === 3 && c.strategy_custom ? `\n${c.strategy_custom}` : "");
					return `<${fsCanEdit() ? "button type=\"button\" data-a=\"fsopen\"" : "div"} class="pill strat s${st}" title="${esc(tip)}">${svg(FS_STRAT[st][1])}<span>${esc(name)}</span></${fsCanEdit() ? "button" : "div"}>`;
				}
				function fsOpen() {
					const m = document.querySelector(`#${BOX_ID} .fsm`);
					if (!m || !fsCanEdit()) return;
					m.hidden = false;
					fitOverlays();
					fsPaint();
				}
				function fsClose() {
					const m = document.querySelector(`#${BOX_ID} .fsm`);
					if (m) m.hidden = true;
				}
				async function fsSave(change) {
					if (fsSaving || !state || !state.factionconfig || !fsCanEdit()) return;
					const before = state.factionconfig, next = Object.assign({}, before, change);
					state.factionconfig = next;
					fsSaving = true;
					fsPaint();
					render();
					try {
						await rpc("updateconfig", { _config: next });
						toast("Faction settings saved", "ok", 2e3);
					} catch (e) {
						if (state && state.factionconfig === next) state.factionconfig = before;
						toast(`Couldn\u2019t save \u2014 ${e.message}`, "err", 8e3);
					} finally {
						fsSaving = false;
						fsPaint();
						render();
						refresh(true);
					}
				}
				function fsPaint() {
					const m = document.querySelector(`#${BOX_ID} .fsm`);
					if (m && !m.hidden && !fsCanEdit()) {
						m.hidden = true;
						return;
					}
					if (!m || m.hidden || !state) return;
					const c = state.factionconfig || {}, edit = fsCanEdit(), dis = fsSaving ? " disabled" : "";
					const on = (k, v) => edit ? `<button type="button" class="fs-sw ${v ? "on" : ""}" data-fs="${k}" aria-pressed="${!!v}" title="${v ? "Turn off" : "Turn on"}"${dis}><i></i></button>` : `<span class="fs-sw ${v ? "on" : ""}" role="img" aria-label="${v ? "On" : "Off"}"><i></i></span>`;
					const num = (k, v) => {
						const [min, max, step, fmt] = FS_NUM[k], pct = (v - min) / (max - min) * 100;
						return edit ? `<span class="fs-val"><button type="button" class="ghost fs-st" data-fsn="${k}" data-d="-${step}" title="Less"${v <= min ? " disabled" : dis}>\u2212</button><b class="num">${esc(fmt(v))}</b><button type="button" class="ghost fs-st" data-fsn="${k}" data-d="${step}" title="More"${v >= max ? " disabled" : dis}>+</button></span>` : `<span class="fs-val"><b class="num">${esc(fmt(v))}</b><span class="fs-bar"><i style="width:${Math.max(4, Math.min(100, pct))}%"></i></span></span>`;
					};
					const row = (icon, label, ctl) => `<div class="fs-row"><span class="fs-l">${icon}<span>${label}</span></span>${ctl}</div>`;
					const st = Number(c.strategy) || 0;
					const strat = `<span class="fs-strat">${FS_STRAT.map(([n, d], i) => edit ? `<button type="button" class="fs-si ${i === st ? "on" : ""}" data-fss="${i}" title="${n}"${dis}>${svg(d)}</button>` : `<span class="fs-si ${i === st ? "on" : ""}" title="${n}">${svg(d)}</span>`).join("")}</span>`;
					const custom = st !== 3 ? "" : edit ? `<div class="fs-custom"><input type="text" class="fs-ct" maxlength="40" placeholder="Strategy title" value="${esc(c.strategy_custom_title || "")}">
          <textarea class="fs-cx" maxlength="500" rows="3" placeholder="What should members do?">${esc(c.strategy_custom || "")}</textarea>
          <button type="button" class="btn-save" data-a="fscustom"${dis}>Save strategy</button></div>` : c.strategy_custom_title || c.strategy_custom ? `<div class="fs-custom">${c.strategy_custom_title ? `<b>${esc(c.strategy_custom_title)}</b>` : ""}${c.strategy_custom ? `<div>${esc(c.strategy_custom)}</div>` : ""}</div>` : "";
					const v = (k, d) => c[k] == null ? d : Number(c[k]);
					const html = row(ICON.roll, "Roll call", on("rollcall_enabled", c.rollcall_enabled)) + row(ICON.dib, "Calling dibs", on("dibs_enabled", c.dibs_enabled !== false)) + row(svg("<path d=\"M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22\"/><path d=\"m18 2 4 4-4 4\"/><path d=\"M2 6h1.9c1.5 0 2.9.9 3.6 2.2\"/><path d=\"M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8\"/><path d=\"m18 14 4 4-4 4\"/>"), "Dib window", on("dib_window_enabled", c.dib_window_enabled)) + row(ICON.clock, "Dibs time limit", num("dibs_time", v("dibs_time", 300))) + row(svg("<path d=\"M18 7V4H6l6 8-6 8h12v-3\"/>"), "Dibs / assists per member", num("num_dibs", v("num_dibs", 1))) + row(svg("<path d=\"M18 7V4H6l6 8-6 8h12v-3\"/>"), "Assists per dib", num("num_assists", v("num_assists", 1))) + row(ICON.assist, "Auto request assists", on("auto_request_assists", c.auto_request_assists)) + row(svg("<circle cx=\"6\" cy=\"19\" r=\"3\"/><path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\"/><circle cx=\"18\" cy=\"5\" r=\"3\"/>"), `Faction strategy <span class="muted">\u00b7 ${FS_STRAT[st] ? FS_STRAT[st][0] : st}</span>`, strat) + custom + (c.updated_at ? `<div class="fs-upd muted">Last changed ${esc(sdateShort(Date.parse(c.updated_at)))} ${hm(Date.parse(c.updated_at))} TCT</div>` : "");
					const body = m.querySelector(".fsm-body");
					const typing = body.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
					if (body.dssLast !== html && !typing) {
						body.innerHTML = html;
						body.dssLast = html;
						stripTitles(body);
					}
				}
				function crWars() {
					const sub = state && state.subscription;
					if (!sub) return null;
					if (sub.estimated_wars_remaining != null) return Number(sub.estimated_wars_remaining);
					const n = Number(sub.member_count) || 0;
					return n ? Math.floor((Number(sub.member_credits_remaining) || 0) / n) : null;
				}
				function crOpen() {
					const m = document.querySelector(`#${BOX_ID} .crm`);
					if (!m || !fsCanEdit()) return;
					m.hidden = false;
					fitOverlays();
					crPaint();
				}
				function crClose() {
					const m = document.querySelector(`#${BOX_ID} .crm`);
					if (m) m.hidden = true;
				}
				function crPaint() {
					const m = document.querySelector(`#${BOX_ID} .crm`);
					if (m && !m.hidden && !fsCanEdit()) {
						m.hidden = true;
						return;
					}
					if (!m || m.hidden || !state) return;
					const sub = state.subscription || {}, fac = (sides().ours || {}).info || {};
					const credits = Math.round(Number(sub.member_credits_remaining) || 0), members = Number(sub.member_count) || 0;
					const wars = crWars() || 0;
					const rate = Number(sub.credit_rate) || 2, low = wars <= 2;
					const html = `<div class="cr-box ${wars <= 1 ? "crit" : low ? "low" : ""}"><b class="num">${num(credits)}</b> war credits left for ${esc(fac.name || "your faction")}
        <div>Covers about <b class="num">${wars}</b> war${wars === 1 ? "" : "s"} with ${members} members${low ? " — time to top up" : ""}</div></div>
      <p>Pay by sending Xanax to <a href="https://www.torn.com/profiles.php?XID=3317544" target="_blank" rel="noopener">Fjord [3317544]</a>.</p>
      <ul><li>1 credit covers 1 member for 1 war</li><li>1 Xanax = ${rate} credits</li><li>5% volume discount for every 100 Xanax, up to 25%</li><li>Credits update automatically within an hour</li></ul>
      ${members ? `<div class="cr-calc muted">One war for ${members} members \u2248 <b class="num">${Math.ceil(members / rate)}</b> Xanax (before discount)</div>` : ""}`;
					const body = m.querySelector(".crm-body");
					if (body.dssLast !== html) {
						body.innerHTML = html;
						body.dssLast = html;
					}
				}
				const MERC_DEFAULT = {
					start: ["n", "m"],
					hosp: ["n", "x"],
					idle: 0,
					skipHosp: true
				};
				let merc = Object.assign({}, MERC_DEFAULT, GM_getValue("mercF", {}) || {});
				function mercRows() {
					if (!state) return [];
					const { ours } = sides(), rolls = rollIdx(), now = Date.now();
					return (ours.members || []).filter((m) => {
						const r = rolls[m.player_id];
						const sk = r ? ynmCls(r.start_online) : "x";
						if (merc.start.length && !merc.start.includes(sk)) return false;
						const hk = !r || r.start_hosped == null ? "x" : r.start_hosped ? "y" : "n";
						if (merc.hosp.length && !merc.hosp.includes(hk)) return false;
						if (merc.idle && now - Date.parse(m.active_stamp) < merc.idle * 36e5) return false;
						if (merc.skipHosp && m.status_state === "Hospital") return false;
						return true;
					}).sort((a, b) => a.name.localeCompare(b.name));
				}
				const attackUrl = (id) => `https://www.torn.com/page.php?sid=attack&user2ID=${id}`;
				function mercPaint() {
					const m = document.querySelector(`#${BOX_ID} .mcm`);
					if (!m || m.hidden) return;
					m.querySelectorAll(".mq").forEach((seg) => seg.querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", merc[seg.dataset.q].includes(btn.dataset.v))));
					m.querySelector(".mcm-idle").value = String(merc.idle);
					m.querySelector(".mcm-skip").checked = !!merc.skipHosp;
					const rows = mercRows();
					m.querySelector(".mcm-out").value = rows.map((x) => `${x.name} - ${attackUrl(x.player_id)}`).join("\n");
					m.querySelector(".mcm-n").textContent = `${rows.length} player${rows.length === 1 ? "" : "s"}`;
					m.querySelector("[data-a=merccopy]").disabled = !rows.length;
				}
				function mercSave() {
					GM_setValue("mercF", merc);
					mercPaint();
				}
				function mercOpen() {
					const m = document.querySelector(`#${BOX_ID} .mcm`);
					if (!m) return;
					m.hidden = false;
					fitOverlays();
					mercPaint();
				}
				function mercClose() {
					const m = document.querySelector(`#${BOX_ID} .mcm`);
					if (m) m.hidden = true;
				}
				function mercPick(q, v) {
					const cur = merc[q], i = cur.indexOf(v);
					merc[q] = i >= 0 ? cur.filter((x) => x !== v) : [...cur, v];
					mercSave();
				}
				async function mercCopy() {
					const ta = document.querySelector(`#${BOX_ID} .mcm-out`);
					let ok = false;
					try {
						await navigator.clipboard.writeText(ta.value);
						ok = true;
					} catch (_) {
						try {
							ta.focus();
							ta.select();
							ok = document.execCommand("copy");
						} catch (__) {
							ok = false;
						}
					}
					const card = ta.closest(".rcm-card"), btn = card.querySelector("[data-a=merccopy]");
					const n = ta.value ? ta.value.split("\n").length : 0;
					let pop = card.querySelector(".mcm-pop");
					if (!pop) {
						pop = document.createElement("div");
						pop.className = "mcm-pop";
						card.appendChild(pop);
					}
					pop.className = `mcm-pop ${ok ? "ok" : "warn"}`;
					pop.innerHTML = ok ? `${ICON.ok}<span>Copied ${n} player${n === 1 ? "" : "s"}</span>` : "<span>Copy blocked — select the text and copy it</span>";
					void pop.offsetWidth;
					pop.classList.add("show");
					btn.textContent = ok ? "✓ Copied" : "Copy list";
					btn.classList.toggle("done", ok);
					clearTimeout(mercCopy.t);
					mercCopy.t = setTimeout(() => {
						pop.classList.remove("show");
						btn.textContent = "Copy list";
						btn.classList.remove("done");
					}, 2200);
				}
				let rollDraft = null;
				const toV = (v) => v === "y" ? true : v === "n" ? false : null;
				const fromV = (v) => v === true ? "y" : v === false ? "n" : "m";
				function rollPaint() {
					const box = document.getElementById(BOX_ID), m = box && box.querySelector(".rcm.rollm");
					if (!m || !rollDraft) return;
					m.querySelectorAll(".rq").forEach((seg) => {
						const cur = rollDraft[seg.dataset.q];
						seg.querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", cur !== undefined && fromV(cur) === btn.dataset.v));
					});
					m.querySelector(".rcm-later").hidden = rollDraft.start_online === true || rollDraft.start_online === undefined;
				}
				function rollOpen() {
					const box = document.getElementById(BOX_ID), m = box && box.querySelector(".rcm.rollm");
					if (!m || !state) return;
					const cur = rollIdx()[state.user.user_id];
					rollDraft = cur ? {
						start_online: cur.start_online,
						chain_watch: cur.chain_watch,
						start_hosped: cur.start_hosped == null ? undefined : cur.start_hosped
					} : {
						start_online: undefined,
						chain_watch: undefined,
						start_hosped: undefined
					};
					m.querySelector(".rcm-hour").value = cur && cur.hour_online != null ? String(cur.hour_online) : "";
					m.querySelector(".rcm-note").value = cur && cur.note || "";
					m.querySelector(".rcm-err").textContent = "";
					rollPaint();
					m.hidden = false;
					fitOverlays();
				}
				function rollClose() {
					const m = document.querySelector(`#${BOX_ID} .rcm.rollm`);
					if (m) m.hidden = true;
					rollDraft = null;
				}
				function rollPick(q, v) {
					if (!rollDraft) return;
					rollDraft[q] = toV(v);
					rollPaint();
				}
				async function rollSubmit() {
					const m = document.querySelector(`#${BOX_ID} .rcm.rollm`), err = m.querySelector(".rcm-err"), go = m.querySelector(".rcm-go");
					const d = rollDraft;
					if (!d || d.start_online === undefined || d.chain_watch === undefined) {
						err.textContent = "Answer both questions first.";
						return;
					}
					const later = d.start_online !== true;
					if (later && d.start_hosped === undefined) {
						err.textContent = "Say whether you’ll self-hosp.";
						return;
					}
					const hv = m.querySelector(".rcm-hour").value;
					const row = {
						start_online: d.start_online,
						chain_watch: d.chain_watch,
						start_hosped: later ? d.start_hosped : null,
						hour_online: later && hv !== "" ? +hv : null,
						note: m.querySelector(".rcm-note").value.trim().slice(0, 60) || null
					};
					go.disabled = true;
					err.textContent = "";
					try {
						await rpc(ROLLCALL_RPC, { _data: row });
						rollClose();
						toast("Roll call saved", "ok");
						refresh(true);
					} catch (e) {
						err.textContent = `Couldn\u2019t save: ${e.message}`;
					} finally {
						go.disabled = false;
					}
				}
				const REV_EVERY_MIN = 5, REV_EVERY_MAX = 60, REV_EVERY_DEFAULT = 10;
				const revEvery = () => Math.min(REV_EVERY_MAX, Math.max(REV_EVERY_MIN, Math.round(Number(GM_getValue("revEveryMin", REV_EVERY_DEFAULT)) || REV_EVERY_DEFAULT)));
				const revTtl = () => revEvery() * 60 * 1e3;
				const WARN_MAX = 300, WARN_DEFAULT = 30;
				const dibWarnSec = () => {
					const v = Number(GM_getValue("dibWarnSec", WARN_DEFAULT));
					return isFinite(v) ? Math.min(WARN_MAX, Math.max(0, Math.round(v))) : WARN_DEFAULT;
				};
				const dibWarnMs = () => dibWarnSec() * 1e3;
				const REV_KEEP = 7 * 24 * 3600 * 1e3;
				const REV_DEFAULT = 30, REV_MAX = 90;
				const revPerMin = () => Math.min(REV_MAX, Math.max(5, Math.round(Number(GM_getValue("revPerMin", REV_DEFAULT)) || REV_DEFAULT)));
				let revCache = (() => {
					const c = GM_getValue("revCache", null), out = {}, now = Date.now();
					if (c && typeof c === "object") {
						for (const id in c) if (c[id] && now - c[id].t < REV_KEEP) out[id] = c[id];
					}
					return out;
				})();
				let revWanted = [];
				let revStamps = [];
				let revInFlight = null;
				let revTimer = null, revRunning = false, revPauseUntil = 0, revStop = null, revSaveTimer = null;
				function revSave() {
					if (!revSaveTimer) revSaveTimer = setTimeout(() => {
						revSaveTimer = null;
						GM_setValue("revCache", revCache);
					}, 3e3);
				}
				function revPlan(shown, cur, other) {
					const ids = [], seen = new Set();
					const add = (id) => {
						if (id != null && !seen.has(id)) {
							seen.add(id);
							ids.push(id);
						}
					};
					shown.filter((m) => m.status_state === "Hospital").forEach((m) => add(m.player_id));
					shown.forEach((m) => add(m.player_id));
					(cur || []).forEach((m) => add(m.player_id));
					(other || []).forEach((m) => add(m.player_id));
					revWanted = ids;
					revKick();
				}
				function revNextId(now) {
					const ttl = revTtl();
					for (const id of revWanted) {
						const e = revCache[id];
						if (!e || now - e.t > ttl) return id;
					}
					return null;
				}
				function revLater(ms) {
					clearTimeout(revTimer);
					revTimer = setTimeout(revPump, Math.max(0, ms));
				}
				function revKick() {
					if (!revRunning) revLater(0);
				}
				function revOnApiError(err) {
					const code = err && err.code, msg = err && err.error || "Torn API error";
					if ([
						2,
						10,
						13,
						16,
						18
					].includes(code)) {
						revStop = msg;
						return;
					}
					revPauseUntil = Date.now() + (code === 5 ? 6e4 : code === 8 ? 6e5 : 6e4);
				}
				async function revPump() {
					revTimer = null;
					if (revRunning) return;
					const key = GM_getValue("tornKey", "");
					if (!key || revStop || document.hidden || !document.getElementById(BOX_ID)) return;
					const now = Date.now();
					if (now < revPauseUntil) return revLater(revPauseUntil - now);
					const per = revPerMin();
					revStamps = revStamps.filter((t) => now - t < 6e4);
					if (revStamps.length >= per) return revLater(6e4 - (now - revStamps[0]) + 50);
					const gap = 6e4 / per, last = revStamps[revStamps.length - 1] || 0;
					if (now - last < gap) return revLater(gap - (now - last));
					const id = revNextId(now);
					if (id == null) return revLater(3e4);
					revRunning = true;
					revStamps.push(now);
					revInFlight = id;
					revPatch(id);
					let changed = false;
					try {
						const res = await req("GET", `https://api.torn.com/v2/user/${id}/profile?striptags=true&comment=dss-ty`, {
							accept: "application/json",
							Authorization: `ApiKey ${key}`
						});
						if (res && res.error) {
							if (res.error.code === 6 || res.error.code === 7) {
								revKeep(id);
								changed = true;
							} else revOnApiError(res.error);
						} else if (res && res.profile && typeof res.profile.revivable === "boolean") {
							revCache[id] = {
								v: res.profile.revivable,
								t: Date.now()
							};
							changed = true;
						} else {
							revKeep(id);
							changed = true;
						}
					} catch (e) {
						revPauseUntil = Date.now() + (e.network ? 15e3 : 6e4);
					} finally {
						revRunning = false;
						revInFlight = null;
					}
					if (changed) revSave();
					revPatch(id);
					revLater(0);
				}
				function revKeep(id) {
					const prev = revCache[id];
					revCache[id] = {
						v: prev && typeof prev.v === "boolean" ? prev.v : null,
						t: Date.now()
					};
				}
				function revValue(id) {
					const e = revCache[id];
					if (e && typeof e.v === "boolean") return {
						v: e.v,
						t: e.t,
						src: "api"
					};
					const m = memberIdx[id];
					if (m && typeof m.revivable === "boolean") return {
						v: m.revivable,
						t: Date.parse(m.profile_updated_at),
						src: "tyronic"
					};
					return null;
				}
				function revInfo(id) {
					const r = revValue(id);
					if (!r) {
						if (revInFlight === id) return {
							cls: "none rev-busy",
							html: ICON.spin,
							tip: "Checking…"
						};
						return {
							cls: "none rev-wait",
							html: ICON.clock,
							tip: revStop ? `Checks stopped\n${revStop}` : "Queued"
						};
					}
					const at = !isFinite(r.t) ? "?" : Date.now() - r.t < 864e5 ? `${hm(r.t)} TCT` : sdateShort(r.t);
					const when = r.src === "api" ? `\nChecked ${at}` : `\nTyronic data from ${at}`;
					return r.v ? {
						cls: "rev-y",
						html: ICON.revive,
						tip: "Revivable" + when
					} : {
						cls: "rev-n",
						html: ICON.revive,
						tip: "Not revivable" + when
					};
				}
				const revTd = (id) => {
					const r = revInfo(id);
					return `<td class="c num c-rev ${r.cls}" data-rev="${id}" title="${esc(r.tip)}">${r.html}</td>`;
				};
				function revPatch(id) {
					const box = document.getElementById(BOX_ID);
					const td = box && box.querySelector(`td[data-rev="${id}"]`);
					if (!td) return;
					const r = revInfo(id);
					td.className = `c num c-rev ${r.cls}`;
					td.innerHTML = r.html;
					td.setAttribute("aria-label", r.tip.replace(/\n/g, " · "));
					if (!noHover()) {
						td.dataset.tt = r.tip;
						ttRefresh();
					}
				}
				const LIVE_FAST_MS = 5e3;
				const LIVE_OURS_MS = 3e4;
				const LIVE_PROBE_MS = 12e4;
				const LIVE_RECOVER_MS = 3e4;
				const LIVE_GRACE_MS = 6e4;
				let liveCand = 0;
				let liveOn = false, liveHealthySince = 0, liveTimer = null, liveBusy = false, liveWhy = "";
				let rawSnap = null;
				const live = {};
				const liveSeen = {};
				const stKey = (st, desc) => `${st}|${String(desc || "").trim()}`;
				function snapRaw() {
					if (!state) return;
					const now = Date.now(), snap = {
						t: now,
						m: {}
					};
					for (const f of [state.home_faction, state.away_faction]) for (const m of f && f.members || []) snap.m[m.player_id] = {
						state: m.status_state,
						until: Date.parse(m.status_until)
					};
					rawSnap = snap;
				}
				const LIVE_OVERDUE_MS = 12e4, LIVE_STALE_N = 3;
				function liveHealth() {
					const now = Date.now(), name = (id) => memberIdx[id] && memberIdx[id].name || memberName(+id) || `#${id}`;
					const overdue = [], diff = [];
					let cand = 0;
					if (rawSnap) {
						for (const id in rawSnap.m) {
							const r = rawSnap.m[id];
							if ((r.state === "Hospital" || r.state === "Jail") && isFinite(r.until) && r.until > 0 && r.until < now - LIVE_OVERDUE_MS) overdue.push(id);
						}
						let compared = false;
						for (const fid in live) {
							const L = live[fid];
							if (now - L.t > 6e4 || Math.abs(L.t - rawSnap.t) > 2e4) continue;
							compared = true;
							for (const id in L.rows) {
								const r = rawSnap.m[id];
								if (!r || r.state === L.rows[id].status.state) continue;
								cand++;
								const seen = liveSeen[id];
								if (seen && rawSnap.t - seen.stT >= LIVE_GRACE_MS) diff.push(id);
							}
						}
						if (compared) liveCand = cand;
						for (const id in tornSeen) {
							const d = tornSeen[id], r = rawSnap.m[id];
							if (!r || !tornValid(d) || diff.includes(id) || rawSnap.t - d.t < LIVE_GRACE_MS) continue;
							const rs = HJ(r.state) && isFinite(r.until) && r.until > 0 && r.until <= rawSnap.t ? "Okay" : r.state;
							if (d.st === "Clear" ? HJ(rs) : rs !== d.st) diff.push(id);
						}
					}
					const failing = failStreak >= 2;
					const stale = failing || overdue.length >= LIVE_STALE_N || diff.length >= LIVE_STALE_N;
					const list = (ids) => ids.slice(0, 6).map(name).join(", ") + (ids.length > 6 ? ` +${ids.length - 6}` : "");
					const why = failing ? "Tyronic isn’t responding" : overdue.length >= LIVE_STALE_N ? `${overdue.length} hospital timers stuck 2m+\n${list(overdue)}` : diff.length >= LIVE_STALE_N ? `${diff.length} statuses out of date 60s+\n${list(diff)}` : "";
					return {
						stale,
						healthy: !failing && overdue.length === 0 && diff.length <= 1,
						why
					};
				}
				function liveDecide() {
					const h = liveHealth(), now = Date.now();
					if (h.stale) {
						liveHealthySince = 0;
						if (!liveOn) {
							liveOn = true;
							liveKick(0);
						}
						liveWhy = h.why;
					} else if (liveOn) {
						if (!h.healthy) liveHealthySince = 0;
						else if (!liveHealthySince) liveHealthySince = now;
						else if (now - liveHealthySince >= LIVE_RECOVER_MS) {
							liveOn = false;
							liveWhy = "";
							liveHealthySince = 0;
						}
					}
				}
				function liveApplyRow(m, row) {
					const st = row.status || {}, la = row.last_action || {};
					const desc = plain(st.description), key = stKey(st.state, desc);
					m.status_state = st.state;
					m.status_color = st.color;
					m.status_description = desc;
					m.status_details = plain(st.details);
					m.status_until = st.until ? new Date(st.until * 1e3).toISOString() : "1970-01-01T00:00:00+00:00";
					m.until_unknown = false;
					if (la.status) m.active_status = la.status;
					if (la.timestamp) m.active_stamp = new Date(la.timestamp * 1e3).toISOString();
					if (typeof row.is_revivable === "boolean") m.revivable = row.is_revivable;
					if (st.state === "Traveling" || st.state === "Abroad") {
						const to = desc.match(/^Traveling from .+ to (.+)$/), at = desc.match(/^In (.+)$/);
						const dest = to ? to[1] : at ? at[1] : m.travel_destination;
						const seen = liveSeen[m.player_id];
						if (seen && seen.change && seen.key === key) {
							m.travel_departure_stamp = new Date(seen.change.hi).toISOString();
							m.travel_departure_error = Math.round((seen.change.hi - seen.change.lo) / 1e3);
						} else if (m.travel_destination !== dest) {
							m.travel_departure_stamp = null;
							m.travel_departure_error = null;
						}
						m.travel_destination = dest;
					}
				}
				function liveOverlay() {
					if (!state) return;
					const now = Date.now();
					if (!liveOn) tornApply();
					for (const f of [state.home_faction, state.away_faction]) {
						const L = f && f.info && live[f.info.faction_id];
						if (!L || now - L.t > 12e4) continue;
						for (const m of f.members || []) {
							const row = L.rows[m.player_id];
							if (!row) continue;
							if (liveOn || m.until_unknown && row.status && row.status.state === m.status_state && row.status.until * 1e3 > now) liveApplyRow(m, row);
						}
					}
					tornApply();
					onlineApply();
				}
				const LIVE_TIMER_MS = 1e4;
				const liveNeed = {};
				const tornSeen = {};
				const tornChanged = [];
				let domLastScan = 0, wsLastMsg = 0;
				const domLive = () => Date.now() - domLastScan < 5e3;
				const wsLive = () => Date.now() - wsLastMsg < 9e4;
				const tornLive = () => domLive() || wsLive();
				const tornValid = (d) => !!d && (d.src === "ws" ? wsLive() : domLive());
				const HJ = (st) => st === "Hospital" || st === "Jail";
				function tornNote(id, st, src, x) {
					const now = Date.now(), prev = tornSeen[id];
					const same = prev && prev.st === st;
					tornSeen[id] = {
						st,
						src,
						at: now,
						t: same ? prev.t : now,
						from: same ? prev.from : prev && prev.st,
						until: x && x.until || null,
						reason: x && x.reason || ""
					};
					if (!same) tornChanged.push(id);
				}
				const DOM_STATES = {
					okay: "Okay",
					hospital: "Hospital",
					jail: "Jail",
					traveling: "Traveling",
					abroad: "Abroad"
				};
				function domScan() {
					if (wsLive() && Date.now() - domLastScan < 3e3) return;
					const wrap = findWrap();
					if (!wrap) return;
					let found = 0;
					for (const li of wrap.querySelectorAll("li")) {
						const a = li.querySelector("a[href*=\"XID=\"]"), sd = li.querySelector("[class*=\"status___\"]");
						if (!a || !sd) continue;
						const id = +((a.getAttribute("href") || "").match(/XID=(\d+)/) || [])[1];
						if (!id) continue;
						let st = null;
						for (const c of sd.classList) if (DOM_STATES[c]) {
							st = DOM_STATES[c];
							break;
						}
						if (!st) st = DOM_STATES[sd.textContent.trim().toLowerCase()] || null;
						if (!st) continue;
						found++;
						const prev = tornSeen[id];
						if (prev && prev.st === st) continue;
						if (prev && prev.st === "Clear" && !HJ(st)) continue;
						if (prev && prev.src === "ws" && wsLive() && Date.now() - prev.at < 3e3) continue;
						tornNote(id, st, "dom");
					}
					if (found) domLastScan = Date.now();
				}
				const domScore = {};
				function domScores() {
					const wrap = findWrap();
					if (!wrap) return false;
					let changed = false;
					for (const li of wrap.querySelectorAll("li")) {
						const a = li.querySelector("a[href*=\"XID=\"]"), pt = li.querySelector("[class*=\"points___\"]");
						if (!a || !pt) continue;
						const id = +((a.getAttribute("href") || "").match(/XID=(\d+)/) || [])[1];
						const v = parseFloat(pt.textContent.replace(/[^\d.]/g, ""));
						if (!id || !isFinite(v)) continue;
						if (domScore[id] !== v) {
							domScore[id] = v;
							changed = true;
						}
					}
					return changed;
				}
				const PAGE = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
				function wsOnMessage(ev) {
					try {
						wsLastMsg = Date.now();
						const raw = ev && ev.data;
						if (typeof raw !== "string") return;
						const icons = raw.indexOf("updateIcons") >= 0, fin = raw.indexOf("attackFinish") >= 0;
						if (!icons && !fin) return;
						for (const line of raw.split("\n")) {
							if (line.indexOf("updateIcons") < 0 && line.indexOf("attackFinish") < 0) continue;
							let j;
							try {
								j = JSON.parse(line);
							} catch (_) {
								continue;
							}
							if (fin) atkFinish(j);
							if (icons) wsPush(j);
						}
					} catch (_) {}
				}
				(function wsHook() {
					try {
						const WS = PAGE.WebSocket, proto = WS && WS.prototype, orig = proto && proto.send;
						if (!orig || orig.dssHooked) return;
						const exp = typeof exportFunction === "function";
						const listener = exp ? exportFunction(wsOnMessage, PAGE) : wsOnMessage;
						const hooked = new WeakSet();
						const send = function() {
							try {
								if (!hooked.has(this) && /centrifugo\.torn\.com/.test(String(this.url))) {
									hooked.add(this);
									this.addEventListener("message", listener);
								}
							} catch (_) {}
							return orig.apply(this, arguments);
						};
						if (exp) exportFunction(send, proto, { defineAs: "send" });
						else proto.send = send;
						try {
							proto.send.dssHooked = true;
						} catch (_) {}
					} catch (_) {}
				})();
				const ATK_STALE_MS = 2e4;
				let atkNow = {}, atkT = 0;
				let atkUsers = {};
				const FEED_MAX = 15, FEED_KEEP_MS = 36e5, FEED_MATCH_MS = 2e4;
				let atkFeed = (GM_getValue("atkFeed", []) || []).filter((a) => a && Date.now() - a.t < FEED_KEEP_MS);
				const hospSeen = [];
				function feedSave() {
					try {
						GM_setValue("atkFeed", atkFeed);
					} catch (_) {}
				}
				const byName = (reason, id) => {
					const n = String(memberIdx[id] ? memberIdx[id].name : "").toLowerCase();
					return !!n && String(reason || "").toLowerCase().indexOf(` by ${n}`) >= 0;
				};
				function feedMatch() {
					const now = Date.now();
					for (let i = hospSeen.length - 1; i >= 0; i--) if (now - hospSeen[i].t > FEED_MATCH_MS) hospSeen.splice(i, 1);
					let hit = false;
					for (const a of atkFeed) {
						if (a.def || now - a.seen > FEED_MATCH_MS) continue;
						const i = hospSeen.findIndex((h) => byName(h.reason, a.by));
						if (i >= 0) {
							a.def = hospSeen[i].id;
							a.how = (hospSeen[i].reason.match(/^\s*(\w+)/) || [])[1] || "";
							hospSeen.splice(i, 1);
							hit = true;
						}
					}
					return hit;
				}
				function feedHosp(id, reason) {
					if (!reason || !/\bby\b/i.test(reason)) return;
					hospSeen.push({
						id,
						reason,
						t: Date.now()
					});
					if (feedMatch()) {
						feedSave();
						atkBar();
					}
				}
				function atkSet(next) {
					atkNow = next;
					atkT = Date.now();
					atkBar();
				}
				const ONLINE_FRESH_MS = 3e4;
				let onlineNow = {}, onlineT = 0;
				const ONLINE_MAP = {
					online: "Online",
					idle: "Idle",
					offline: "Offline"
				};
				function onlineData(rwm) {
					const next = {};
					for (const id in rwm) {
						const st = rwm[id] && rwm[id].onlineStatus && ONLINE_MAP[String(rwm[id].onlineStatus.status).toLowerCase()];
						if (st) next[id] = st;
					}
					if (!Object.keys(next).length) return;
					onlineNow = next;
					onlineT = Date.now();
					if (onlineApply() && document.getElementById(BOX_ID)) render();
				}
				function onlineApply() {
					if (!state || !onlineT || Date.now() - onlineT > ONLINE_FRESH_MS) return false;
					let changed = false;
					const now = Date.now();
					for (const f of [state.home_faction, state.away_faction]) for (const m of f && f.members || []) {
						const st = onlineNow[m.player_id];
						if (!st) continue;
						if (m.active_status !== st) {
							m.active_status = st;
							changed = true;
						}
						if (st === "Online" && !(now - Date.parse(m.active_stamp) < 3e5)) {
							m.active_stamp = new Date(now).toISOString();
							changed = true;
						}
					}
					return changed;
				}
				function atkBar() {
					const box = document.getElementById(BOX_ID), bar = box && box.querySelector(".atkbar");
					if (!bar) return;
					const fresh = atkT && Date.now() - atkT < ATK_STALE_MS;
					const myF = state && state.home_faction && state.home_faction.info && state.home_faction.info.faction_id;
					const nm = (id) => {
						const u = atkUsers[id];
						return esc(u && u.playername || nameOf(id));
					};
					const me = state && state.user && state.user.user_id;
					const items = [];
					for (const a of atkFeed.slice(0, FEED_MAX).reverse()) {
						if (Date.now() - a.t > FEED_KEEP_MS) continue;
						const ours = !a.fac || !myF || +a.fac === +myF, gain = +a.respect > 0;
						const cls = !ours ? "inc" : gain ? "win" : "loss";
						const who = +a.by === +me ? "You" : nm(a.by);
						const verb = a.def ? esc((a.how || "hit").toLowerCase()) : gain ? "hit" : "no respect";
						items.push(`<span class="ak ${cls} ${a.rw ? "" : "nrw"}" data-k="f${a.id}"><b>${who}</b><i>${verb}</i>${a.def ? `<b>${nm(a.def)}</b>` : ""}${gain ? `<em>+${(+a.respect).toFixed(2)}</em>` : ""}</span>`);
					}
					if (fresh) for (const d in atkNow) {
						const a = atkNow[d];
						items.push(`<span class="ak live ${a.mine ? "mine" : ""}" data-k="l${d}">${ICON.attack}<b>${a.mine ? "You" : esc(a.name)}</b><i>\u2192</i><b>${nm(d)}</b>${a.others ? `<em>+${a.others}</em>` : ""}</span>`);
					}
					const html = items.join("");
					const tr = bar.querySelector(".atk-track");
					if (!bar.dssWired) {
						bar.dssWired = true;
						const touched = () => {
							bar.dssUser = Date.now();
						};
						for (const ev of [
							"wheel",
							"touchstart",
							"touchmove",
							"pointerdown",
							"keydown"
						]) bar.addEventListener(ev, touched, { passive: true });
						bar.addEventListener("scroll", () => {
							if (Date.now() - (bar.dssUser || 0) < 1500) bar.dssBack = bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 30;
						}, { passive: true });
					}
					const toEnd = (force) => {
						const x = bar.scrollWidth - bar.clientWidth;
						if (Math.abs(bar.scrollLeft - x) > 1 && (force || !(tr.getAnimations && tr.getAnimations().length))) bar.scrollLeft = x;
					};
					if (bar.dssLast === html) {
						if (!bar.dssBack && !bar.hidden) toEnd();
						return;
					}
					bar.dssLast = html;
					const wasHidden = bar.hidden;
					bar.hidden = !html;
					const atEnd = !bar.dssBack;
					const before = {};
					if (!wasHidden && atEnd) for (const el of tr.children) before[el.dataset.k] = el.getBoundingClientRect().left;
					try {
						if (tr.getAnimations) tr.getAnimations().forEach((an) => an.cancel());
					} catch (_) {}
					tr.innerHTML = html;
					if (!html) return;
					if (atEnd) toEnd(true);
					if (wasHidden || !atEnd || window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
					let shift = 0;
					for (let i = tr.children.length - 1; i >= 0; i--) {
						const el = tr.children[i];
						if (el.dataset.k in before) {
							shift = before[el.dataset.k] - el.getBoundingClientRect().left;
							break;
						}
					}
					if (shift > 0 && tr.animate) tr.animate([{ transform: `translateX(${shift}px)` }, { transform: "translateX(0)" }], {
						duration: 450,
						easing: "cubic-bezier(.2,.8,.2,1)"
					});
				}
				function atkData(text) {
					let j;
					try {
						j = JSON.parse(text);
					} catch (_) {
						return;
					}
					if (j && j.rankedWarMembers && typeof j.rankedWarMembers === "object") onlineData(j.rankedWarMembers);
					const wd = j && j.warDesc;
					if (!wd || !Array.isArray(wd.currentAttacks)) return;
					const users = wd.users || {}, next = {};
					atkUsers = users;
					for (const a of wd.currentAttacks) {
						if (!a || !a.defenderID || !a.attackerID) continue;
						const u = users[a.attackerID];
						next[a.defenderID] = {
							by: +a.attackerID,
							name: u && u.playername || nameOf(a.attackerID),
							others: Math.max(0, +a.attackersAmount || 0),
							mine: !!(state && state.user && +a.attackerID === +state.user.user_id)
						};
					}
					atkSet(next);
				}
				function atkFinish(j) {
					const p = j && j.push;
					if (!p || !/^faction-war-boxes-\d+$/.test(p.channel || "")) return;
					const msg = p.pub && p.pub.data && p.pub.data.message;
					const acts = msg && msg.namespaces && msg.namespaces.warBoxes && msg.namespaces.warBoxes.actions;
					const f = acts && acts.attackFinish, by = f && f.attacker && +f.attacker.userId;
					if (!by) return;
					if (f.attackId && !atkFeed.some((a) => a.id === f.attackId)) {
						const now = Date.now();
						atkFeed.unshift({
							id: f.attackId,
							by,
							fac: f.attacker.factionId || null,
							respect: +f.respect || 0,
							rw: !!f.isRankedWar,
							t: f.currentTime ? f.currentTime * 1e3 : now,
							seen: now,
							def: null
						});
						atkFeed = atkFeed.slice(0, FEED_MAX);
						feedMatch();
						feedSave();
					}
					const gone = Object.keys(atkNow).filter((k) => atkNow[k].by === by);
					if (!gone.length) {
						atkBar();
						return;
					}
					gone.forEach((k) => delete atkNow[k]);
					atkBar();
				}
				(function fetchHook() {
					try {
						const orig = PAGE.fetch;
						if (typeof orig !== "function" || orig.dssHooked) return;
						const exp = typeof exportFunction === "function";
						const onText = exp ? exportFunction((t) => {
							try {
								atkData(String(t));
							} catch (_) {}
						}, PAGE) : (t) => {
							try {
								atkData(String(t));
							} catch (_) {}
						};
						const onRes = (res) => {
							try {
								if (PAGE.Response.prototype.dssHooked && res.url) return;
								res.clone().text().then(onText);
							} catch (_) {}
						};
						const onResP = exp ? exportFunction(onRes, PAGE) : onRes;
						const wrap = function(input) {
							const p = orig.apply(this || PAGE, arguments);
							try {
								const url = String(input && input.url || input || "");
								if (url.indexOf("faction_wars.php") >= 0 && url.indexOf("step=getwardata") >= 0) p.then(onResP);
							} catch (_) {}
							return p;
						};
						if (exp) exportFunction(wrap, PAGE, { defineAs: "fetch" });
						else PAGE.fetch = wrap;
						try {
							PAGE.fetch.dssHooked = true;
						} catch (_) {}
					} catch (_) {}
				})();
				(function responseHook() {
					try {
						const R = PAGE.Response, proto = R && R.prototype;
						if (!proto || proto.dssHooked) return;
						const exp = typeof exportFunction === "function";
						const isWar = (r) => {
							try {
								const u = String(r.url || "");
								return u.indexOf("faction_wars.php") >= 0 && u.indexOf("step=getwardata") >= 0;
							} catch (_) {
								return false;
							}
						};
						const seen = exp ? exportFunction((v) => {
							try {
								atkData(typeof v === "string" ? v : PAGE.JSON.stringify(v));
							} catch (_) {}
						}, PAGE) : (v) => {
							try {
								atkData(typeof v === "string" ? v : JSON.stringify(v));
							} catch (_) {}
						};
						for (const name of ["text", "json"]) {
							const orig = proto[name];
							if (typeof orig !== "function") continue;
							const wrap = function() {
								const p = orig.apply(this, arguments);
								try {
									if (isWar(this)) p.then(seen);
								} catch (_) {}
								return p;
							};
							if (exp) exportFunction(wrap, proto, { defineAs: name });
							else proto[name] = wrap;
						}
						try {
							proto.dssHooked = true;
						} catch (_) {}
					} catch (_) {}
				})();
				function wsPush(j) {
					const p = j && j.push;
					if (!p || !/^faction-users-\d+$/.test(p.channel || "")) return;
					const msg = p.pub && p.pub.data && p.pub.data.message;
					const acts = msg && msg.namespaces && msg.namespaces.users && msg.namespaces.users.actions;
					const u = acts && acts.updateIcons;
					if (!u || !u.userId || typeof u.icons !== "string") return;
					const ic = iconState(u.icons);
					tornNote(+u.userId, ...ic);
					if (ic[0] === "Hospital" && ic[2]) feedHosp(+u.userId, ic[2].reason);
					wsSoon();
				}
				function iconState(html) {
					const doc = new DOMParser().parseFromString(html, "text/html");
					for (const li of doc.querySelectorAll("li[title]")) {
						const t = li.getAttribute("title") || "";
						const m = t.match(/^\s*<b>\s*(Hospital|Jail|Traveling|Abroad)\s*<\/b>/i);
						if (!m) continue;
						const st = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
						const secs = +(t.match(/data-time=['"]?(\d+)/) || [])[1];
						const reason = plain(t.replace(/^[\s\S]*?<\/b>/i, "").replace(/<span[^>]*timer[\s\S]*$/i, "").replace(/<br\s*\/?>/gi, " "));
						return [
							st,
							"ws",
							{
								until: secs > 0 ? Date.now() + secs * 1e3 : null,
								reason
							}
						];
					}
					return [
						"Clear",
						"ws",
						null
					];
				}
				let wsTimer = null;
				function wsSoon() {
					if (!wsTimer) wsTimer = setTimeout(() => {
						wsTimer = null;
						tornTick();
					}, 150);
				}
				function tornApply() {
					if (!state) return [];
					const now = Date.now(), done = [];
					for (const f of [state.home_faction, state.away_faction]) for (const m of f && f.members || []) {
						const d = tornSeen[m.player_id];
						if (!tornValid(d)) continue;
						const until = Date.parse(m.status_until), timed = isFinite(until) && until > now;
						if (d.st === "Okay" || d.st === "Clear") {
							if (d.st === "Clear" && now - d.at > 12e4) continue;
							if (!HJ(m.status_state) || !timed && !m.until_unknown) continue;
							Object.assign(m, {
								status_state: "Okay",
								status_color: "green",
								status_description: "Okay",
								status_details: "",
								status_until: "1970-01-01T00:00:00+00:00",
								until_unknown: false
							});
							done.push(m.player_id);
						} else if (HJ(d.st)) {
							const base = {
								status_state: d.st,
								status_color: "red",
								status_description: d.st === "Jail" ? "In jail" : "In hospital"
							};
							if (d.until) {
								if (d.until <= now) continue;
								if (m.status_state === d.st && timed && Math.abs(until - d.until) < 5e3) continue;
								Object.assign(m, base, {
									status_details: d.reason || (m.status_state === d.st ? m.status_details : ""),
									status_until: new Date(d.until).toISOString(),
									until_unknown: false
								});
								done.push(m.player_id);
							} else if (m.status_state !== d.st || !(timed || m.until_unknown)) {
								Object.assign(m, base, {
									status_details: "",
									status_until: null,
									until_unknown: true
								});
								const L = f.info && live[f.info.faction_id], row = L && L.rows[m.player_id];
								if (f.info && !(row && row.status && row.status.state === d.st && row.status.until * 1e3 > now)) liveNeed[f.info.faction_id] = true;
								done.push(m.player_id);
							}
						}
					}
					return done;
				}
				function tornTick() {
					if (!state) return;
					domScan();
					const changed = tornChanged.splice(0);
					const applied = tornApply();
					let hit = false;
					for (const id of changed) {
						const d = tornSeen[id];
						if (d.st !== "Hospital") continue;
						const before = d.from || d.src === "ws" && rawSnap && rawSnap.m[id] && rawSnap.m[id].state;
						if (before && before !== "Hospital") {
							hit = true;
							dibClearFor(id, d.t);
						}
					}
					if (changed.length) liveDecide();
					if (!applied.length && !hit) return;
					liveKick(0);
					render();
				}
				function liveOnTyronic(ok) {
					if (ok) {
						snapRaw();
						rememberWar();
					}
					liveDecide();
					liveOverlay();
					dibHideCleared();
					optOverlay();
					liveKick();
				}
				async function liveFetch(fid) {
					const key = GM_getValue("tornKey", "");
					if (!key || !fid) return false;
					revStamps.push(Date.now());
					const res = await req("GET", `https://api.torn.com/v2/faction/${fid}/members?striptags=true&comment=dss-ty`, {
						accept: "application/json",
						Authorization: `ApiKey ${key}`
					});
					if (!res || res.error || !Array.isArray(res.members)) {
						if (res && res.error) revOnApiError(res.error);
						return false;
					}
					const t = Date.now(), prevT = live[fid] ? live[fid].t : 0, rows = {}, hit = [];
					for (const r of res.members) {
						rows[r.id] = r;
						planeNote(r, t);
						const now = r.status && r.status.state;
						const k = stKey(now, plain(r.status && r.status.description));
						const seen = liveSeen[r.id];
						const before = seen ? seen.key.split("|")[0] : rawSnap && rawSnap.m[r.id] && rawSnap.m[r.id].state;
						if (now === "Hospital" && before === "Okay") hit.push(r.id);
						const stT = seen && seen.st === now ? seen.stT : t;
						if (!seen) liveSeen[r.id] = {
							key: k,
							t,
							st: now,
							stT
						};
						else if (seen.key !== k) liveSeen[r.id] = {
							key: k,
							t,
							change: prevT ? {
								lo: prevT,
								hi: t
							} : null,
							st: now,
							stT
						};
						else {
							seen.st = now;
							seen.stT = stT;
						}
					}
					live[fid] = {
						t,
						rows
					};
					planeSave();
					return {
						hit,
						t
					};
				}
				const PLANE_TICKET = {
					private_jet: "Private",
					light_aircraft: "Airstrip",
					airliner: "Standard"
				};
				const PLANE_READ_MS = 3e4;
				const planeSeen = GM_getValue("planeSeen", {}) || {};
				const planeTried = {};
				let planeDirty = false;
				function planeNote(r, t) {
					const st = r.status || {};
					if (st.state !== "Traveling") return;
					const desc = plain(st.description);
					if (st.plane_image_type) {
						const type = PLANE_TICKET[st.plane_image_type] || "Business";
						const old = planeSeen[r.id];
						if (!old || old.desc !== desc || old.type !== type) {
							planeSeen[r.id] = {
								desc,
								type,
								t
							};
							planeDirty = true;
						}
					} else planeTried[r.id] = desc;
				}
				function planeSave() {
					if (!planeDirty) return;
					planeDirty = false;
					const now = Date.now();
					for (const id in planeSeen) if (now - planeSeen[id].t > 6 * 36e5) delete planeSeen[id];
					GM_setValue("planeSeen", planeSeen);
				}
				function planeOf(m) {
					if (!m || m.status_state !== "Traveling") return null;
					const p = planeSeen[m.player_id], desc = plain(m.status_description);
					if (!p || p.desc !== desc) return null;
					const dep = Date.parse(m.travel_departure_stamp), err = Math.max(0, Number(m.travel_departure_error) || 0) * 1e3;
					if (isFinite(dep) && dep > 0) {
						if (p.t < dep - err - 12e4) return null;
						if (p.t > dep + 5.5 * 36e5) return null;
					} else if (Date.now() - p.t > 5.5 * 36e5) return null;
					return p.type;
				}
				function planeNeeded(f) {
					return (f && f.members || []).some((m) => m.status_state === "Traveling" && !planeOf(m) && planeTried[m.player_id] !== plain(m.status_description));
				}
				const dibCleared = {};
				function dibClearFor(foeId, t) {
					if (!state || !state.dibs) return;
					const me = state.user && state.user.user_id;
					for (const d of state.dibs) {
						if (!d || d.optimistic || d.foe_id !== foeId || dibCleared[d.dib_id] || !(Date.parse(d.created_at) < t)) continue;
						dibCleared[d.dib_id] = {
							foe: foeId,
							t
						};
						if (d.player_id !== me) continue;
						api.removeDib(d).catch(() => {});
					}
					dibHideCleared();
					render();
				}
				function dibHideCleared() {
					if (!state || !Array.isArray(state.dibs)) return;
					const now = Date.now();
					for (const id in dibCleared) {
						if (now - dibCleared[id].t > 15 * 6e4) {
							delete dibCleared[id];
							continue;
						}
						if (lastFetch - dibCleared[id].t > 6e4 && state.dibs.some((d) => d && String(d.dib_id) === id)) delete dibCleared[id];
					}
					state.dibs = state.dibs.filter((d) => !d || !dibCleared[d.dib_id]);
				}
				let liveLastProbe = 0;
				let liveAgain = false;
				function liveKick(ms) {
					if (liveBusy) {
						if (ms === 0) liveAgain = true;
						return;
					}
					if (ms === 0 || !liveTimer) {
						clearTimeout(liveTimer);
						liveTimer = setTimeout(livePump, ms || 0);
					}
				}
				function key2plane(ours, enemy, now) {
					for (const f of [enemy, ours]) {
						const fid = f && f.info && f.info.faction_id;
						if (fid && (!live[fid] || now - live[fid].t >= PLANE_READ_MS) && planeNeeded(f)) return fid;
					}
					return null;
				}
				async function livePump() {
					liveTimer = null;
					if (liveBusy) return;
					let wait = liveOn ? 1e3 : 5e3;
					try {
						if (Date.now() < revPauseUntil) return;
						if (!state || document.hidden || !document.getElementById(BOX_ID) || !GM_getValue("tornKey", "") || revStop) return;
						const { ours, enemy } = sides(), now = Date.now();
						const eid = enemy && enemy.info && enemy.info.faction_id, oid = ours && ours.info && ours.info.faction_id;
						const eL = live[eid], oL = live[oid];
						let target = null;
						if (liveOn) {
							if (!oL || now - oL.t >= LIVE_OURS_MS) target = oid;
							else if (!eL || now - eL.t >= LIVE_FAST_MS) target = eid;
						} else {
							if (!tornLive()) tornTick();
							const need = [eid, oid].find((fid) => liveNeed[fid] && (!live[fid] || now - live[fid].t >= LIVE_TIMER_MS));
							if (need) target = need;
							else if (key2plane(ours, enemy, now)) target = key2plane(ours, enemy, now);
							else if (!tornLive() && now - liveLastProbe >= (liveCand ? LIVE_GRACE_MS + 5e3 : LIVE_PROBE_MS)) target = eid;
						}
						if (!target) return;
						liveBusy = true;
						if (!liveOn && !liveNeed[target]) liveLastProbe = now;
						delete liveNeed[target];
						const got = await liveFetch(target);
						if (got) {
							liveDecide();
							if (liveOn) for (const id of got.hit) dibClearFor(id, got.t);
							liveOverlay();
							render();
						}
					} catch (_) {
						wait = 15e3;
					} finally {
						liveBusy = false;
						if (!liveTimer) liveTimer = setTimeout(livePump, liveAgain ? 0 : wait);
						liveAgain = false;
					}
				}
				const PRES_SNAP_MS = 6e4;
				const presMode = () => {
					const m = GM_getValue("presMode", SERIAL ? "off" : "snap");
					return SERIAL && m === "live" ? "snap" : m;
				};
				const presOff = () => presMode() === "off";
				let presRef = 0, presJoinRef = null, presTopic = null, presHb = null, presRetry = 0, presTimer = null;
				let presLive = false, presGen = 0, lpToken = null, lpJwt = null, presStarted = false, presSnapGot = false;
				const presence = {};
				let presKnown = false;
				function presChanged() {
					const box = document.getElementById(BOX_ID), el = box && box.querySelector(".pres-c");
					if (!el) return;
					const ids = Object.keys(presence), total = state && sides().ours ? (sides().ours.members || []).length : 0;
					if (presKnown && state && state.user && !presence[state.user.user_id]) ids.push(String(state.user.user_id));
					el.hidden = !presKnown || presOff();
					const txt = `${ids.length}/${total}`;
					const n = el.querySelector(".num");
					if (n && n.textContent !== txt) n.textContent = txt;
					const names = ids.map((id) => memberIdx[id] && memberIdx[id].name || `#${id}`).sort((a, b) => a.localeCompare(b));
					const tip = `${ids.length} on Tyronic now\n` + names.join(", ");
					el.setAttribute("aria-label", tip.replace(/\n/g, " · "));
					if (!noHover()) el.dataset.tt = tip;
				}
				function lpReqOnce(method, token, body) {
					return new Promise((res) => {
						let done = false;
						const resolve = (v) => {
							if (!done) {
								done = true;
								clearTimeout(dog);
								res(v);
							}
						};
						const dog = setTimeout(() => resolve({
							http: 0,
							j: null
						}), SERIAL ? 8e3 : 55e3);
						GM_xmlhttpRequest({
							method,
							url: `${SB}/realtime/v1/longpoll?apikey=${encodeURIComponent(lpJwt)}&vsn=2.0.0` + (token ? `&token=${encodeURIComponent(token)}` : ""),
							headers: Object.assign({
								apikey: PUB_KEY,
								Authorization: `Bearer ${lpJwt}`
							}, body ? { "Content-Type": "application/json" } : {}),
							data: body,
							timeout: 45e3,
							onload: (r) => {
								let j = null;
								try {
									j = JSON.parse(r.responseText);
								} catch (_) {}
								resolve({
									http: r.status,
									j
								});
							},
							onerror: () => resolve({
								http: -1,
								j: null
							}),
							onabort: () => resolve({
								http: -1,
								j: null
							}),
							ontimeout: () => resolve({
								http: 0,
								j: null
							})
						});
					});
				}
				function lpReq(method, token, body) {
					if (!SERIAL) return lpReqOnce(method, token, body);
					return new Promise((resolve) => {
						reqQueue.push({ run: () => lpReqOnce(method, token, body).then(resolve) });
						reqPump();
					});
				}
				function presSend(topic, event, payload, joinRef) {
					if (!lpToken) return;
					lpReq("POST", lpToken, JSON.stringify([
						joinRef === undefined ? presJoinRef : joinRef,
						String(++presRef),
						topic,
						event,
						payload
					]));
				}
				function presHandle(m) {
					if (m.topic !== presTopic) return;
					const p = m.payload || {};
					if (m.event === "phx_reply" && m.ref === presJoinRef) {
						if (p.status !== "ok") {
							presStop();
							presSchedule();
							return;
						}
						presRetry = 0;
						presLive = true;
						if (presMode() === "live") presSend(presTopic, "presence", {
							type: "presence",
							event: "track",
							payload: {
								player_id: state.user.user_id,
								joined: new Date().toISOString()
							}
						});
					} else if (m.event === "phx_error" || m.event === "phx_close") {
						presStop();
						presSchedule();
					} else if (m.event === "presence_state") {
						for (const k in presence) delete presence[k];
						for (const k in p) presence[k] = true;
						presKnown = true;
						presSnapGot = true;
						presChanged();
					} else if (m.event === "presence_diff") {
						for (const k in p.joins || {}) presence[k] = true;
						for (const k in p.leaves || {}) delete presence[k];
						presKnown = true;
						presChanged();
					}
				}
				function presStop() {
					presGen++;
					presLive = false;
					clearInterval(presHb);
					presHb = null;
					lpToken = null;
					presJoinRef = null;
				}
				function presSchedule(ms) {
					clearTimeout(presTimer);
					if (ms == null) ms = Math.min(6e4, 3e3 * Math.pow(2, presRetry++));
					presTimer = setTimeout(() => {
						presTimer = null;
						presConnect();
					}, ms);
				}
				async function lpRun() {
					const gen = presGen, snap = presMode() === "snap", t0 = Date.now();
					try {
						let r = await lpReq("GET");
						if (gen !== presGen) return;
						if (!r.j || !r.j.token) throw new Error("no session");
						lpToken = r.j.token;
						presJoinRef = String(++presRef);
						await lpReq("POST", lpToken, JSON.stringify([
							presJoinRef,
							presJoinRef,
							presTopic,
							"phx_join",
							{
								config: {
									broadcast: {
										ack: false,
										self: false
									},
									presence: {
										key: String(state.user.user_id),
										enabled: true
									},
									postgres_changes: [],
									private: true
								},
								access_token: lpJwt
							}
						]));
						if (gen !== presGen) return;
						if (!snap) presHb = setInterval(() => {
							presSend("phoenix", "heartbeat", {}, null);
							getToken(false).then((t) => {
								if (gen === presGen && t && t !== lpJwt) {
									lpJwt = t;
									presSend(presTopic, "access_token", { access_token: t });
								}
							}).catch(() => {});
						}, 3e4);
						while (gen === presGen) {
							if (snap && (presSnapGot || Date.now() - t0 > 15e3)) {
								presSnapGot = false;
								presStop();
								presSchedule(PRES_SNAP_MS);
								return;
							}
							if (document.hidden) {
								presStop();
								presSchedule(PRES_SNAP_MS);
								return;
							}
							r = await lpReq("GET", lpToken);
							if (gen !== presGen) return;
							if (!r.j) {
								if (r.http === 0) continue;
								throw new Error(`http ${r.http}`);
							}
							if (r.j.token) lpToken = r.j.token;
							if (r.j.status === 200) {
								for (const raw of r.j.messages || []) {
									let a = raw;
									if (typeof a === "string") {
										try {
											a = JSON.parse(a);
										} catch (_) {
											continue;
										}
									}
									if (Array.isArray(a)) presHandle({
										join_ref: a[0],
										ref: a[1],
										topic: a[2],
										event: a[3],
										payload: a[4]
									});
									else if (a && a.topic) presHandle(a);
								}
							} else if (r.j.status !== 204) throw new Error(`status ${r.j.status}`);
						}
					} catch (_) {
						if (gen === presGen) {
							presStop();
							presSchedule();
						}
					}
				}
				async function presConnect() {
					if (presOff() || presLive || lpToken) return;
					if (document.hidden || !document.getElementById(BOX_ID)) return presSchedule(PRES_SNAP_MS);
					if (!state || !state.user || !state.factionconfig || state.factionconfig.chat_enabled === false) return presSchedule();
					try {
						lpJwt = await getToken(false);
					} catch (_) {
						return presSchedule();
					}
					presTopic = `realtime:channel:${state.user.faction_id}`;
					lpRun();
				}
				const WP = {
					ONLINE: 1,
					IDLE: .6,
					OFFLINE: .15,
					RECENT_S: 900,
					PCT: .9,
					CAP: [4, 12],
					ACT: [.6, 1.4],
					ONLINE_RATIO: [1, 5],
					STABLE_BASE: .7,
					SW_EXP: .5,
					SW_POW: .55,
					WS: [.01, .99],
					LEAD: [-1, 1],
					ODDS_MAX: 5,
					ODDS_K: 2.5,
					W_LO: .25,
					W_HI: .85,
					W_POW: 1.5
				};
				const U = {
					clamp: (t, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), t)),
					sum: (a) => a.reduce((x, y) => x + y, 0),
					avg: (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0,
					percentile: (t, p) => {
						if (!t.length) return 0;
						const r = [...t].sort((a, b) => a - b), x = p * (r.length - 1), n = Math.floor(x), c = Math.ceil(x);
						return r[n] + (r[c] - r[n]) * (x - n);
					}
				};
				function winModel(ours, enemy) {
					const sIdx = statsIndex();
					const strength = (mid) => {
						const s = sIdx[mid] || {};
						for (const p of [
							"SPY",
							"BSP",
							"FFSCOUTER",
							"TORNSTATS",
							"YATA"
						]) if (s[p] && s[p].total) return s[p].total;
						return 0;
					};
					const powers = (members) => members.map((m) => ({
						mid: m.player_id,
						power: Math.log10(Math.max(1, strength(m.player_id)))
					}));
					const H = powers(ours.members || []), A = powers(enemy.members || []);
					const cap = U.clamp(Math.sqrt(U.percentile(H.map((x) => x.power), WP.PCT) * U.percentile(A.map((x) => x.power), WP.PCT)), ...WP.CAP);
					[...H, ...A].forEach((x) => {
						x.power_cap = cap * Math.tanh(x.power / cap);
					});
					const oursIsHome = state.home_faction === ours;
					const act = (arr) => {
						const v = (arr || []).map((a) => a.v);
						const o = {
							min: Math.max(1, Math.min(...v, Infinity)),
							max: Math.max(1, ...v),
							hour: Math.max(1, U.avg(v))
						};
						const now = new Date(), hit = (arr || []).find((a) => a.d === now.getUTCDay() && a.h === now.getUTCHours());
						if (hit) o.hour = Math.max(1, hit.v);
						return o;
					};
					const actOurs = act(oursIsHome ? state.home_activity : state.away_activity);
					const actEnemy = act(oursIsHome ? state.away_activity : state.home_activity);
					const nowS = Date.now() / 1e3;
					const statusMap = (members) => Object.fromEntries(members.map((m) => {
						let w = WP.OFFLINE;
						const stamp = Date.parse(m.active_stamp) / 1e3 || 0;
						if (m.active_status === "Idle" || nowS - stamp < WP.RECENT_S) w = WP.IDLE;
						if (m.active_status === "Online") w = WP.ONLINE;
						return [m.player_id, w];
					}));
					const target = state.wardata && state.wardata.scoretarget || 1;
					const side = (st, pw, ac, score) => {
						const c = {
							warscore: score,
							wartargetscore: target
						};
						c.score_power_faction = U.sum(pw.map((a) => a.power_cap * st[a.mid]));
						c.activity_ratio = U.clamp(Object.values(st).filter((x) => x === WP.ONLINE).length / ac.hour, ...WP.ACT);
						c.score_power_faction_activity = c.score_power_faction * c.activity_ratio;
						c.faction_stability = U.clamp(ac.hour / ac.max, 0, 1);
						c.stable = c.score_power_faction_activity * (WP.STABLE_BASE + (1 - WP.STABLE_BASE) * c.faction_stability);
						c.online_power = U.sum(pw.map((a) => st[a.mid] === WP.ONLINE ? a.power_cap : 0));
						return c;
					};
					const s = side(statusMap(ours.members || []), H, actOurs, (ours.warstats || {}).score || 0);
					const t = side(statusMap(enemy.members || []), A, actEnemy, (enemy.warstats || {}).score || 0);
					const swarm = (r) => Math.pow(r * Math.pow(2, WP.SW_EXP * (r - 1)), WP.SW_POW);
					for (const [a, b] of [[s, t], [t, s]]) a.swarm = swarm(U.clamp(a.online_power / Math.max(1e-9, b.online_power), ...WP.ONLINE_RATIO));
					s.score = s.stable * s.swarm;
					t.score = t.stable * t.swarm;
					for (const [a, b] of [[s, t], [t, s]]) {
						a.warstrength = U.clamp(a.score / (a.score + b.score), ...WP.WS);
						a.odds_ws = Math.log(a.warstrength / (1 - a.warstrength));
						a.lead = U.clamp((a.warscore - b.warscore) / a.wartargetscore, ...WP.LEAD);
						a.odds_score = WP.ODDS_MAX * Math.tanh(WP.ODDS_K * a.lead);
						a.weight = WP.W_HI - (WP.W_HI - WP.W_LO) * Math.pow(U.clamp(Math.abs(a.lead), 0, 1), WP.W_POW);
						a.winprob = 1 / (1 + Math.exp(-(a.weight * a.odds_ws + (1 - a.weight) * a.odds_score)));
					}
					return isFinite(s.winprob) && isFinite(s.warstrength) ? {
						ours: s,
						enemy: t
					} : null;
				}
				const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					"\"": "&quot;",
					"'": "&#39;"
				})[c]);
				const num = (n) => Number(n || 0).toLocaleString("en-GB");
				function fmtBS(n) {
					if (n == null || !n) return "—";
					for (const [v, s] of [
						[0xe8d4a51000, "T"],
						[1e9, "B"],
						[1e6, "M"],
						[1e3, "K"]
					]) {
						if (n >= v) {
							const x = n / v;
							return +x.toFixed(x >= 100 ? 0 : 1) + s;
						}
					}
					return String(n);
				}
				function clock(ms) {
					if (!isFinite(ms)) return "";
					ms = Math.max(0, ms);
					const t = Math.floor(ms / 1e3), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
					return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
				}
				const tct = () => new Date().toISOString().slice(11, 19);
				const sdateShort = (t) => {
					const d = new Date(t);
					return `${d.getUTCDate()} ${[
						"Jan",
						"Feb",
						"Mar",
						"Apr",
						"May",
						"Jun",
						"Jul",
						"Aug",
						"Sep",
						"Oct",
						"Nov",
						"Dec"
					][d.getUTCMonth()]}`;
				};
				function ago(ts) {
					const d = (Date.now() - Date.parse(ts)) / 1e3;
					if (!isFinite(d)) return "?";
					if (d < 60) return "now";
					if (d < 3600) return `${Math.floor(d / 60)}m`;
					if (d < 86400) return `${Math.floor(d / 3600)}h`;
					return `${Math.floor(d / 86400)}d`;
				}
				let memberIdx = {};
				const nameOf = (id) => memberIdx[id] && memberIdx[id].name || `#${id}`;
				function statsIndex() {
					const idx = {};
					for (const b of state.battlestats || []) (idx[b.player_id] = idx[b.player_id] || {})[b.bsprovider] = b;
					return idx;
				}
				function strengthClass(total, mine) {
					if (!total || !mine) return "";
					const r = total / mine;
					return r < .75 ? "st-easy" : r < 1.5 ? "st-even" : r < 3.5 ? "st-hard" : "st-nope";
				}
				const star = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => {
					const a = (-90 + i * 36) * Math.PI / 180, rr = i % 2 ? r * .4 : r;
					return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
				}).join(" ");
				const UNION = "<rect width=\"30\" height=\"20\" fill=\"#012169\"/><path d=\"M0 0L30 20M30 0L0 20\" stroke=\"#fff\" stroke-width=\"4\"/>" + "<path d=\"M0 0L30 20M30 0L0 20\" stroke=\"#C8102E\" stroke-width=\"1.5\"/><path d=\"M15 0V20M0 10H30\" stroke=\"#fff\" stroke-width=\"6\"/>" + "<path d=\"M15 0V20M0 10H30\" stroke=\"#C8102E\" stroke-width=\"3.5\"/>";
				const FLAG_SVG = {
					"mexico": "<rect width=\"10\" height=\"20\" fill=\"#006847\"/><rect x=\"10\" width=\"10\" height=\"20\" fill=\"#fff\"/><rect x=\"20\" width=\"10\" height=\"20\" fill=\"#CE1126\"/><circle cx=\"15\" cy=\"10\" r=\"2.6\" fill=\"#8C5B2B\"/>",
					"cayman islands": `<rect width="30" height="20" fill="#012169"/><g transform="scale(.5)">${UNION}</g><circle cx="22" cy="10.5" r="4" fill="#fff"/><path d="M19.5 12h5l-2.5 3z" fill="#C8102E"/><rect x="20" y="8" width="4" height="2.5" fill="#3a7ac2"/>`,
					"canada": `<rect width="30" height="20" fill="#fff"/><rect width="7.5" height="20" fill="#D52B1E"/><rect x="22.5" width="7.5" height="20" fill="#D52B1E"/><polygon points="${star(15, 9.6, 5.6)}" fill="#D52B1E"/><rect x="14.4" y="12" width="1.2" height="4.5" fill="#D52B1E"/>`,
					"hawaii": `${[
						0,
						1,
						2,
						3,
						4,
						5,
						6,
						7
					].map((i) => `<rect y="${i * 2.5}" width="30" height="2.5" fill="${[
						"#fff",
						"#C8102E",
						"#012169"
					][i % 3]}"/>`).join("")}<g transform="scale(.5)">${UNION}</g>`,
					"united kingdom": UNION,
					"argentina": "<rect width=\"30\" height=\"20\" fill=\"#74ACDF\"/><rect y=\"6.67\" width=\"30\" height=\"6.67\" fill=\"#fff\"/><circle cx=\"15\" cy=\"10\" r=\"2.3\" fill=\"#F6B40E\"/>",
					"switzerland": "<rect width=\"30\" height=\"20\" fill=\"#DA291C\"/><rect x=\"13\" y=\"4\" width=\"4\" height=\"12\" fill=\"#fff\"/><rect x=\"9\" y=\"8\" width=\"12\" height=\"4\" fill=\"#fff\"/>",
					"japan": "<rect width=\"30\" height=\"20\" fill=\"#fff\"/><circle cx=\"15\" cy=\"10\" r=\"6\" fill=\"#BC002D\"/>",
					"china": `<rect width="30" height="20" fill="#DE2910"/><polygon points="${star(5.5, 5, 3)}" fill="#FFDE00"/>${[
						[10, 2],
						[12, 4],
						[12, 7],
						[10, 9]
					].map(([x, y]) => `<polygon points="${star(x, y, 1)}" fill="#FFDE00"/>`).join("")}`,
					"uae": "<rect width=\"30\" height=\"20\" fill=\"#fff\"/><rect width=\"30\" height=\"6.67\" fill=\"#00732F\"/><rect y=\"13.33\" width=\"30\" height=\"6.67\" fill=\"#000\"/><rect width=\"8\" height=\"20\" fill=\"#FF0000\"/>",
					"south africa": "<rect width=\"30\" height=\"10\" fill=\"#E03C31\"/><rect y=\"10\" width=\"30\" height=\"10\" fill=\"#001489\"/>" + "<path d=\"M0 0L12 10H30M0 20L12 10\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\"/><path d=\"M0 0L12 10H30M0 20L12 10\" stroke=\"#007749\" stroke-width=\"3.6\" fill=\"none\"/>" + "<polygon points=\"0,3.4 8.2,10 0,16.6\" fill=\"#FFB81C\"/><polygon points=\"0,5.4 5.8,10 0,14.6\" fill=\"#000\"/>"
				};
				const FLAG_ALIAS = {
					"uk": "united kingdom",
					"cayman": "cayman islands",
					"united arab emirates": "uae",
					"dubai": "uae"
				};
				const FLAG_CROP = {
					"china": 0,
					"hawaii": 0,
					"uae": 0,
					"south africa": 0,
					"cayman islands": 7
				};
				const flagKey = (name) => {
					const k0 = String(name || "").trim().toLowerCase();
					return FLAG_ALIAS[k0] || k0;
				};
				function flag(name) {
					const k = flagKey(name);
					const svgInner = FLAG_SVG[k];
					const x = FLAG_CROP[k] != null ? FLAG_CROP[k] : 5;
					return svgInner ? `<svg class="flag" viewBox="${x} 0 20 20" width="14" height="14" aria-hidden="true">${svgInner}</svg>` : `<span class="flag-txt">${esc(name || "?")}</span>`;
				}
				const PLANE = `<svg class="pl" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;
				const ARROW = "<svg class=\"ar\" viewBox=\"0 0 24 24\" width=\"11\" height=\"11\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 12h15M13 6l6 6-6 6\"/></svg>";
				const PIN = "<svg class=\"pl\" viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/></svg>";
				const TORN = "<img class=\"flag torn\" src=\"/favicon.ico\" width=\"14\" height=\"14\" alt=\"Torn\">";
				const FLIGHT_MIN = {
					"mexico": [
						8,
						13,
						18,
						26
					],
					"cayman islands": [
						11,
						18,
						25,
						35
					],
					"canada": [
						12,
						20,
						29,
						41
					],
					"hawaii": [
						40,
						67,
						94,
						134
					],
					"united kingdom": [
						48,
						80,
						111,
						159
					],
					"argentina": [
						50,
						83,
						117,
						167
					],
					"switzerland": [
						53,
						88,
						123,
						175
					],
					"japan": [
						68,
						113,
						158,
						225
					],
					"china": [
						72,
						121,
						169,
						242
					],
					"uae": [
						81,
						135,
						190,
						271
					],
					"south africa": [
						89,
						149,
						208,
						297
					]
				};
				const TICKETS = [
					"Business",
					"Private",
					"Airstrip",
					"Standard"
				];
				const hm = (ms) => new Date(ms).toISOString().slice(11, 16);
				function travelPlan(m) {
					const st = statusInfo(m);
					if (st.rank !== 3 || !st.where) return null;
					const abroad = m.status_state === "Abroad", back = m.travel_destination === "Torn";
					const dep = Date.parse(m.travel_departure_stamp), known = isFinite(dep);
					const err = Math.max(0, Number(m.travel_departure_error) || 0) * 1e3;
					const mins = FLIGHT_MIN[flagKey(st.where)], ticket = planeOf(m);
					const all = !abroad && known && mins ? TICKETS.map((t, i) => ({
						t,
						lo: dep - err + mins[i] * 6e4,
						hi: dep + mins[i] * 6e4
					})) : [];
					return {
						abroad,
						back,
						country: st.where,
						known,
						lo: dep - err,
						hi: dep,
						exact: err <= 6e4,
						ticket,
						rows: ticket ? all.filter((r) => r.t === ticket) : all
					};
				}
				const relMin = (ms) => {
					const n = Math.max(1, Math.round(ms / 6e4));
					return n < 60 ? `${n}m` : `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, "0")}m`;
				};
				function popHtml(id) {
					const m = memberIdx[id], p = m && travelPlan(m);
					if (!p) return "";
					const now = Date.now();
					const win = (lo, hi) => p.exact ? hm(hi) : `${hm(lo)}\u2013${hm(hi)}`;
					const title = p.abroad ? `In ${p.country}` : p.back ? `Returning from ${p.country}` : `Flying to ${p.country}`;
					const route = p.abroad ? `${PIN}${flag(p.country)}` : p.back ? `${flag(p.country)}${ARROW}${TORN}` : `${TORN}${ARROW}${flag(p.country)}`;
					const sub = (!p.known ? "Departure time unknown" : `${p.abroad ? "Landed" : "Left"} ${win(p.lo, p.hi)} TCT`) + (p.ticket ? ` \u00b7 <span class="pop-tk">${p.ticket}</span>` : "");
					let marked = false;
					const rows = p.rows.map((r) => {
						let cls, when;
						if (now > r.hi) {
							cls = p.ticket ? "now" : "gone";
							when = p.ticket ? "due" : "ruled out";
						} else if (now >= r.lo) {
							cls = "now";
							when = "landing now";
						} else {
							cls = "soon";
							when = `in ${relMin(r.lo - now)}`;
						}
						if (cls !== "gone" && !marked) {
							cls += " first";
							marked = true;
						}
						return `<tr class="${cls}"><td>${r.t}</td><td class="num">${win(r.lo, r.hi)}</td><td class="num r">${when}</td></tr>`;
					}).join("");
					return `<div class="pop-h"><span class="pop-route">${route}</span><b>${esc(title)}</b></div>
      <div class="pop-sub">${sub}</div>
      ${rows ? `<table class="pop-t"><tbody>${rows}</tbody></table>` : ""}`;
				}
				let popId = null, popCell = null;
				function popShow(td) {
					popId = td.dataset.pop;
					popCell = td;
					popRefresh();
				}
				function popHide() {
					popId = null;
					popCell = null;
					const el = document.querySelector(`#${BOX_ID} .pop`);
					if (el) el.hidden = true;
				}
				function popRefresh() {
					const box = document.getElementById(BOX_ID);
					if (!box || popId == null) return;
					const el = box.querySelector(".pop");
					if (!popCell || !box.contains(popCell)) popCell = box.querySelector(`.rcm:not([hidden]) [data-pop="${popId}"]`) || box.querySelector(`td[data-pop="${popId}"]`);
					const html = popCell ? popHtml(popId) : "";
					if (!html) return popHide();
					const cr = popCell.getBoundingClientRect(), vw = document.documentElement.clientWidth;
					const tw = box.querySelector(".tw"), twr = tw && tw.getBoundingClientRect();
					if (twr && tw.contains(popCell) && (cr.bottom < twr.top || cr.top > twr.bottom)) {
						el.hidden = true;
						return;
					}
					if (el.dssLast !== html) {
						el.innerHTML = html;
						el.dssLast = html;
					}
					el.hidden = false;
					const pw = el.offsetWidth, ph = el.offsetHeight;
					const left = Math.max(8, Math.min(cr.left + cr.width / 2 - pw / 2, vw - pw - 8));
					let top = cr.top - ph - 6;
					if (top < 4) top = cr.bottom + 6;
					placeFixed(el, left, top);
				}
				const isSelfHosp = (d) => !!d && !/\bby\b/i.test(d);
				const HOSP_SHORT = [
					[/ipecac|emesis/i, "Ipecac"],
					[/transfusion/i, "Blood bag"],
					[/overdos/i, "Overdose"],
					[/crash/i, "Car crash"],
					[/food poisoning/i, "Food poisoning"],
					[/explo/i, "Explosion"],
					[/burn/i, "Burns"],
					[/fell|fall/i, "Fall"]
				];
				const plain = (h) => String(h || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
				function hospLabel(d) {
					d = plain(d);
					if (!d) return "In hospital";
					const by = d.match(/\b(mugged|hospitali[sz]ed|attacked|beaten up|shot|lost to)\b.*?\bby\s+(.+)$/i);
					if (by) return /^someone$/i.test(by[2].trim()) ? "Attacked" : `${/mugged/i.test(by[1]) ? "Mugged" : "Attacked"} by ${by[2].trim()}`;
					if (/\bby\b/i.test(d)) return d.length > 34 ? d.slice(0, 33) + "…" : d;
					const hit = HOSP_SHORT.find(([re]) => re.test(d));
					return `Self-hosp \u00b7 ${hit ? hit[1] : d.length > 28 ? d.slice(0, 27) + "…" : d}`;
				}
				const DEMONYM = {
					"mexican": "mexico",
					"caymanian": "cayman islands",
					"canadian": "canada",
					"hawaiian": "hawaii",
					"british": "united kingdom",
					"argentinian": "argentina",
					"argentine": "argentina",
					"swiss": "switzerland",
					"japanese": "japan",
					"chinese": "china",
					"emirati": "uae",
					"south african": "south africa"
				};
				const hospAbroad = {};
				function abroadOf(m) {
					const id = m.player_id;
					if (m.status_state === "Abroad") {
						delete hospAbroad[id];
						return m.travel_destination || "?";
					}
					if (m.status_state !== "Hospital") {
						delete hospAbroad[id];
						return null;
					}
					const desc = plain(m.status_description);
					const hit = desc.match(/^In an? (.+?) hospital\b/i);
					if (hit) return hospAbroad[id] = DEMONYM[hit[1].toLowerCase()] || hit[1];
					if (desc === "In hospital") return hospAbroad[id] || null;
					delete hospAbroad[id];
					return null;
				}
				function abroadFlag(m) {
					const where = abroadOf(m);
					if (!where) return "";
					const NICE = {
						"uae": "the UAE",
						"united kingdom": "the UK",
						"cayman islands": "the Cayman Islands"
					};
					const name = where === "?" ? "another country" : NICE[flagKey(where)] || where.replace(/\b\w/g, (c) => c.toUpperCase());
					const tip = m.status_state === "Hospital" ? `In hospital in ${name}` : `Abroad in ${name}`;
					return `<span class="abf" title="${esc(tip)}">${FLAG_SVG[flagKey(where)] ? flag(where) : PIN}</span>`;
				}
				function statusInfo(m) {
					switch (m.status_state) {
						case "Okay": return {
							rank: 1,
							cls: "ok",
							text: "OK"
						};
						case "Hospital":
						case "Jail": {
							if (m.until_unknown) return {
								rank: 2,
								cls: "hosp",
								text: m.status_state === "Jail" ? "Jail" : "Hosp",
								until: Date.now() + 864e5,
								unknown: true,
								detail: m.status_state === "Jail" ? "Just jailed" : "Just hospitalised"
							};
							const until = Date.parse(m.status_until);
							if (isFinite(until) && until > 0 && until <= Date.now()) return {
								rank: 1,
								cls: "ok",
								text: "OK",
								out: true,
								detail: m.status_state === "Jail" ? "Out of jail" : "Out of hospital"
							};
							if (m.status_state === "Jail") return {
								rank: 2,
								cls: "hosp",
								text: "Jail",
								until
							};
							const self = isSelfHosp(plain(m.status_details));
							return {
								rank: 2,
								cls: "hosp",
								text: "Hosp",
								until,
								self,
								detail: hospLabel(m.status_details)
							};
						}
						case "Traveling": {
							const back = m.travel_destination === "Torn";
							const where = back ? plain(m.status_description).replace(/^Traveling from (.*) to Torn$/, "$1") : m.travel_destination;
							return {
								rank: 3,
								cls: "trav",
								text: back ? `\u2708 ${where} \u2192 Torn` : `\u2708 \u2192 ${where}`,
								icon: back ? `${PLANE}${flag(where)}${ARROW}${TORN}` : `${PLANE}${TORN}${ARROW}${flag(where)}`,
								detail: back ? `Returning to Torn from ${where}` : `Travelling to ${where}`,
								where,
								fkey: back ? "torn" : flagKey(where)
							};
						}
						case "Abroad": return {
							rank: 3,
							cls: "trav",
							text: `In ${m.travel_destination || "abroad"}`,
							icon: `${PIN}${flag(m.travel_destination)}`,
							detail: `Abroad in ${m.travel_destination || "another country"}`,
							where: m.travel_destination || "",
							fkey: flagKey(m.travel_destination)
						};
						default: return {
							rank: 4,
							cls: "muted",
							text: plain(m.status_description) || m.status_state || "?"
						};
					}
				}
				function sides() {
					const my = state.user && state.user.faction_id;
					const h = state.home_faction, a = state.away_faction;
					return h && h.info && h.info.faction_id === my ? {
						ours: h,
						enemy: a
					} : {
						ours: a,
						enemy: h
					};
				}
				function counts(members) {
					const c = {
						Online: 0,
						Idle: 0,
						Offline: 0
					};
					for (const m of members || []) c[m.active_status] = (c[m.active_status] || 0) + 1;
					return c;
				}
				const bsOf = (s, p) => s && s[p] && s[p].total || null;
				function buildOf(s) {
					const spy = s && s.SPY;
					const SPY_BUILD_MAX_AGE = 180 * 864e5;
					if (spy && spy.total && Date.now() - (Date.parse(spy.statsdate) || 0) <= SPY_BUILD_MAX_AGE) {
						const v = {
							Str: +spy.strength || 0,
							Def: +spy.defense || 0,
							Spd: +spy.speed || 0,
							Dex: +spy.dexterity || 0
						};
						const sum = v.Str + v.Def + v.Spd + v.Dex;
						if (sum > 0 && Math.abs(sum - spy.total) <= spy.total * .05) {
							const sh = {};
							for (const k in v) sh[k] = v[k] / sum;
							const keys = Object.keys(sh).sort((a, b) => sh[b] - sh[a]);
							let label;
							if (sh.Str + sh.Spd >= .65 && sh.Def < .15 && sh.Dex < .15) label = "Glass cannon";
							else if (sh.Def > .3 && sh.Dex > .3) label = "Def/Dex";
							else if (sh.Def > .3 && keys[0] === "Def") label = "Def";
							else if (sh.Dex > .3 && keys[0] === "Dex") label = "Dex";
							else if (Math.min(...Object.values(v)) > 0 && sh[keys[0]] / sh[keys[3]] <= 1.5) label = "Balanced";
							else label = `${keys[0]}-heavy`;
							return {
								label,
								src: "spy"
							};
						}
					}
					const y = s && s.YATA && s.YATA.build_type;
					return y ? {
						label: y,
						src: "YATA guess"
					} : null;
				}
				function bestEst(s) {
					s = s || {};
					const spy = s.SPY && s.SPY.total ? s.SPY : null;
					const others = [
						"FFSCOUTER",
						"BSP",
						"YATA"
					].map((p) => s[p]).filter((b) => b && b.total);
					const date = (b) => Date.parse(b.statsdate) || 0;
					if (spy && (!others.length || date(spy) >= Math.max(...others.map(date)))) return {
						v: spy.total,
						kind: "SPY",
						used: [spy]
					};
					if (!others.length) return {
						v: null,
						kind: null,
						used: []
					};
					return {
						v: Math.round(others.reduce((a, b) => a + b.total, 0) / others.length),
						kind: others.length > 1 ? "AVG" : others[0].bsprovider,
						used: others
					};
				}
				function tyStatusKey(m) {
					if (!m || m.status_state === "Fallen") return [
						99,
						0,
						""
					];
					if (m.status_color === "green") return [
						1,
						0,
						""
					];
					if (m.status_color === "red") {
						if (m.until_unknown) return [
							2,
							Infinity,
							""
						];
						const u = Date.parse(m.status_until) || 0;
						return u > 0 && u <= Date.now() ? [
							1,
							0,
							""
						] : [
							2,
							u,
							""
						];
					}
					if (m.status_color === "blue") return [
						String(m.status_description || "").includes("Returning") ? 3 : 4,
						0,
						String(m.travel_destination || "").toLowerCase()
					];
					return [
						98,
						0,
						""
					];
				}
				const num0 = (v) => v == null ? Infinity : v;
				const revRank = (id) => {
					const r = revValue(id);
					return !r ? 2 : r.v ? 0 : 1;
				};
				function sortRows(rows) {
					const cmp = {
						smart: (a, b) => a.st.rank - b.st.rank || (a.st.rank === 2 ? a.st.until - b.st.until : 0) || num0(a.est) - num0(b.est),
						name: (a, b) => a.m.name.localeCompare(b.m.name),
						status: (a, b) => {
							const ka = tyStatusKey(a.m), kb = tyStatusKey(b.m);
							return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
						},
						est: (a, b) => num0(a.est) - num0(b.est),
						score: (a, b) => b.score - a.score,
						bsp: (a, b) => num0(a.bsp) - num0(b.bsp),
						ffs: (a, b) => num0(a.ffs) - num0(b.ffs),
						yata: (a, b) => num0(a.yata) - num0(b.yata),
						level: (a, b) => a.m.level - b.m.level,
						last: (a, b) => Date.parse(b.m.active_stamp) - Date.parse(a.m.active_stamp),
						dib: (a, b) => (b.dib ? 1 : 0) - (a.dib ? 1 : 0),
						rev: (a, b) => revRank(a.m.player_id) - revRank(b.m.player_id),
						roll: (a, b) => rollRank(a.roll) - rollRank(b.roll)
					}[sortKey] || (() => 0);
					return rows.sort((a, b) => cmp(a, b) * sortDir || a.m.player_id - b.m.player_id);
				}
				const svg = (inner) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
				const ICON = {
					dib: svg("<circle cx=\"12\" cy=\"12\" r=\"7\"/><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"6\"/><line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"22\"/><line x1=\"2\" y1=\"12\" x2=\"6\" y2=\"12\"/><line x1=\"18\" y1=\"12\" x2=\"22\" y2=\"12\"/>"),
					assist: svg("<path d=\"m11 17 2 2a1 1 0 1 0 3-3\"/><path d=\"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4\"/><path d=\"m21 3 1 11h-2\"/><path d=\"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3\"/><path d=\"M3 4h8\"/>"),
					attack: svg("<polyline points=\"14.5 17.5 3 6 3 3 6 3 17.5 14.5\"/><line x1=\"13\" y1=\"19\" x2=\"19\" y2=\"13\"/><line x1=\"16\" y1=\"16\" x2=\"20\" y2=\"20\"/><line x1=\"19\" y1=\"21\" x2=\"21\" y2=\"19\"/><polyline points=\"14.5 6.5 18 3 21 3 21 6 17.5 9.5\"/><line x1=\"5\" y1=\"14\" x2=\"9\" y2=\"18\"/><line x1=\"7\" y1=\"17\" x2=\"4\" y2=\"20\"/><line x1=\"3\" y1=\"19\" x2=\"5\" y2=\"21\"/>"),
					spin: svg("<path d=\"M21 12a9 9 0 1 1-6.2-8.56\"/>"),
					ok: svg("<path d=\"M20 6 9 17l-5-5\"/>"),
					hosp: svg("<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4\"/><path d=\"M12 8v8M8 12h8\"/>"),
					selfhosp: svg("<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/><path d=\"M12 8v4\"/><path d=\"M12 16h.01\"/>"),
					jail: svg("<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"3\"/><path d=\"M8 3v18M12 3v18M16 3v18\"/>"),
					power: svg("<path d=\"M12 2v10\"/><path d=\"M18.4 6.6a9 9 0 1 1-12.77.04\"/>"),
					globe: svg("<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"/><path d=\"M2 12h20\"/>"),
					note: svg("<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/>"),
					fist: "<svg viewBox=\"0 0 24 24\" width=\"15\" height=\"15\" fill=\"currentColor\" aria-hidden=\"true\"><rect x=\"6.5\" y=\"2.5\" width=\"2.6\" height=\"6\" rx=\"1.3\"/><rect x=\"9.6\" y=\"2\" width=\"2.6\" height=\"6.5\" rx=\"1.3\"/><rect x=\"12.7\" y=\"2.3\" width=\"2.6\" height=\"6.2\" rx=\"1.3\"/><rect x=\"15.8\" y=\"3\" width=\"2.4\" height=\"5.5\" rx=\"1.2\"/><path d=\"M6.5 8h11.7v4.2a3 3 0 0 1-1 2.2l-.7.6V22H8.2v-7c-1-.6-1.7-1.6-1.7-2.8z\"/><rect x=\"4.2\" y=\"7.2\" width=\"7.8\" height=\"2.6\" rx=\"1.3\" transform=\"rotate(-8 8 8.5)\"/><path d=\"M9 11.5h4\" stroke=\"#0f1012\" stroke-width=\".9\" stroke-linecap=\"round\"/></svg>",
					coins: svg("<circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M18.09 10.37A6 6 0 1 1 10.34 18\"/><path d=\"M7 6h1v4\"/><path d=\"m16.71 13.88.7.71-2.82 2.82\"/>"),
					roll: svg("<rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\"/><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/><path d=\"m9 14 2 2 4-4\"/>"),
					bolt: svg("<path d=\"M13 2 3 14h9l-1 8 10-12h-9l1-8z\"/>"),
					users: svg("<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/>"),
					clock: svg("<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>"),
					revive: svg("<path d=\"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z\"/><path d=\"M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27\"/>")
				};
				const B = `#${BOX_ID}`;
				GM_addStyle(`
    [class*="factionWarInfo___"][data-dss-graph="show"] { display: block !important; visibility: visible !important; height: auto !important; max-height: none !important; overflow: visible !important; opacity: 1 !important; }
    [class*="factionWarInfo___"][data-dss-graph="hide"] { display: none !important; }
    @property --score { syntax: '<percentage>'; inherits: true; initial-value: 50%; }
    .${HIDE} { display: none !important; }
    ${B} {
      --bg: #0f1012; --panel: #16171a; --row: #17181b; --row2: #131417; --line: #2a2c31;
      --txt: #e6e7ea; --mut: #8b9099; --acc: #e5484d; --red: #f0616d; --ok: #3ddc84; --warn: #f5a524; --yel: #e2c35b; --blue: #4ea3ff;
      clear: both; margin: 10px 0; background: var(--bg); color: var(--txt); border: 1px solid var(--line); border-radius: 8px;
      font: 12.5px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; overflow: hidden;
      position: relative;
    }
    ${B} * { box-sizing: border-box; }
    ${B} a, ${B} a:visited, ${B} a:hover { color: inherit; text-decoration: none; }
    ${B} .num { font-variant-numeric: tabular-nums; }
    ${B} button { font: inherit; cursor: pointer; }

    /* ---- header ---- */
    ${B} .hd { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 16px 12px 12px; background: linear-gradient(180deg,#18191d,#111215); }
    ${B} .fac { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; min-width: 0; }
    ${B} .fac.right { text-align: right; }
    ${B} .fac-top { display: flex; align-items: center; gap: 8px; }
    ${B} .fac.right .fac-top { flex-direction: row-reverse; }
    ${B} .fac-tag { width: 26px; height: 26px; border-radius: 4px; object-fit: contain; background: #0003; flex: none; }
    ${B} .fac-name { font-size: 14px; font-weight: 600; color: var(--txt) !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .fac-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8px; gap: 8px; }
    ${B} .fac.right .fac-row { flex-direction: row-reverse; }
    ${B} .fac-score { font-size: 22px; font-weight: 700; line-height: 1; color: var(--txt); }
    ${B} .fac-sub { color: var(--mut); font-size: 11px; margin-top: 3px; }
    ${B} .pres { display: flex; gap: 8px; color: var(--txt); white-space: nowrap; }
    ${B} .pres i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; vertical-align: 1px; }
    ${B} .chain { margin-top: 6px; color: var(--mut); font-size: 11px; display: flex; justify-content: space-between; align-items: center; }
    ${B} .fac.right .chain, ${B} .fac.right .bar { transform: scaleX(-1); }
    ${B} .fac.right .chain > * { transform: scaleX(-1); }
    ${B} .ctimer { padding: 1px 8px; border: 1px solid var(--line); border-radius: 99px; color: var(--txt); }
    ${B} .ctimer.warn { color: var(--warn); border-color: #7a5a14; } ${B} .ctimer.crit { color: var(--red); border-color: var(--acc); }
    ${B} .ctimer.cd { color: var(--blue); }
    ${B} .chain b { color: var(--txt); }
    ${B} .mid { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 110px; }
    ${B} .lead { width: 104px; height: 104px; border-radius: 50%; border: 2px solid var(--line); background: var(--panel); display: flex; flex-direction: column; align-items: center; justify-content: center; }
    ${B} .lead b { font-size: 24px; line-height: 1; }
    ${B} .lead span { color: var(--txt); margin-top: 4px; }
    ${B} .lead.win b { color: var(--ok); } ${B} .lead.lose b { color: var(--red); }
    ${B} .bar { width: 100%; height: 5px; border-radius: 3px; background: #2a2c31; margin-top: 8px; overflow: hidden; }
    ${B} .bar > div { height: 100%; background: var(--red); }
    ${B} .fac.ours .bar > div { background: var(--ok); }
    ${B} .pill.tct { margin-top: 4px; color: var(--mut); }
    ${B} .fsbtn[hidden] { display: none; } ${B} .fsbtn svg { display: block; width: 15px; height: 15px; }
    ${B} .pill.strat { margin-top: 4px; display: inline-flex; align-items: center; gap: 5px; max-width: 160px; color: var(--txt); background: #f5a52414; border-color: #7a5a14; font: inherit; font-size: 11px; }
    ${B} .pill.strat span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .pill.strat svg { width: 13px; height: 13px; flex: none; color: var(--warn); }
    ${B} button.pill.strat { cursor: pointer; } ${B} button.pill.strat:hover { border-color: var(--warn); }
    ${B} .wi { --score: 50%; --winprob: 50%; position: absolute; top: 0; left: 0; right: 0; height: 12px; z-index: 7; cursor: help; }
    ${B} .wi[hidden] { display: none; }
    ${B} .wi::before { content: ""; position: absolute; top: 2px; left: var(--winprob); transform: translateX(-50%); transition: left 2s ease;
      height: 5px; width: 48px; background: linear-gradient(to bottom, transparent, #e0b33a 2px); border-radius: 0 0 6px 6px; }
    ${B} .ws { width: 100%; height: 3px; transition: --score 2s ease;
      background: linear-gradient(to right, rgb(61 220 132 / .8) calc(var(--score) - 3%), rgb(240 97 109 / .8) calc(var(--score) + 3%)); }
    ${B} .wtip { display: none; position: absolute; top: 12px; left: var(--winprob); transform: translateX(-50%); white-space: nowrap;
      background: #1b1c20; border: 1px solid #34363c; border-left: 3px solid #5fb3e6; border-radius: 8px; padding: 8px 12px; line-height: 1.6;
      font-size: 12px; color: var(--txt); box-shadow: 0 8px 24px #000a; z-index: 8; }
    ${B} .wi:hover .wtip, ${B} .wi.open .wtip { display: block; }
    ${B} .wtip { left: clamp(120px, var(--winprob), calc(100% - 120px)) !important; }
    ${B} .wtip b.gold { color: #e0b33a; } ${B} .wtip b.g { color: var(--ok); } ${B} .wtip b.r { color: var(--red); }
    ${B} .pill { margin-top: 8px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 99px; color: var(--blue); font-size: 11px; }

    /* ---- toolbar ---- */
    ${B} .atkbar { position: relative; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; border-top: 1px solid var(--line); background: #0f1013; padding: 5px 0; font-size: 11.5px;
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 32px); mask-image: linear-gradient(90deg, transparent, #000 32px); }
    ${B} .atkbar::-webkit-scrollbar { display: none; }
    ${B} .atkbar[hidden] { display: none; }
    ${B} .atk-track { display: flex; justify-content: flex-end; gap: 8px; width: max-content; min-width: 100%; box-sizing: border-box; padding: 0 12px; }
    ${B} .ak { flex: none; }
    ${B} .ak { display: inline-flex; align-items: center; gap: 5px; padding: 1px 9px; border-radius: 999px; white-space: nowrap; line-height: 18px;
      border: 1px solid #2a2c33; background: #17181c; color: var(--mut); }
    ${B} .ak b { color: var(--txt); font-weight: 600; }
    ${B} .ak i { font-style: normal; }
    ${B} .ak em { font-style: normal; font-weight: 600; }
    ${B} .ak svg { width: 11px; height: 11px; flex: none; }
    ${B} .ak.live { color: #ffb4b9; background: #f0616d1f; border-color: #f0616d66; }
    ${B} .ak.live em { color: #fff; }
    ${B} .ak.live.mine { color: #9ff0c0; background: #3ddc841f; border-color: #3ddc8466; }
    ${B} .ak.win em { color: var(--ok); }
    ${B} .ak.loss i { color: var(--warn); }
    ${B} .ak.inc { border-color: #f0616d44; } ${B} .ak.inc i { color: var(--red); }
    ${B} .ak.nrw { opacity: .6; }
    ${B} .tb { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--panel); }
    ${B} .tb-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    ${B} .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    ${B} .seg button { background: transparent; color: var(--mut); border: 0; padding: 4px 10px; }
    ${B} .seg button + button { border-left: 1px solid var(--line); }
    ${B} .seg button.on { background: #2a2c31; color: var(--txt); }
    ${B} .tb input[type=search] { background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 4px 8px; width: 200px; font: inherit; }
    ${B} .tb .sp { flex: 1; }
    ${B} .ghost { background: transparent; border: 1px solid var(--line); color: var(--mut) !important; border-radius: 6px; padding: 4px 8px; }
    ${B} .ghost:hover { color: var(--txt) !important; border-color: #444; }
    ${B} .age { color: var(--mut); font-size: 11px; display: inline-block; min-width: 58px; text-align: right; white-space: nowrap; position: relative; padding-left: 10px; font-variant-numeric: tabular-nums; }
    ${B} .age::before { content: ""; position: absolute; left: 0; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%; background: var(--blue); opacity: 0; transition: opacity .2s; }
    ${B} .age.busy::before { opacity: 1; animation: dss-pulse .8s ease-in-out infinite; }
    ${B} .ghost.on { color: var(--txt) !important; border-color: #555; background: #2a2c31; }
    ${B} .revtog { display: inline-flex; align-items: center; padding: 3px 8px; }
    ${B} .tb .ctry[hidden] { display: none; }
    ${B} .tb .ctry { gap: 5px; }
    ${B} .cbtn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 5px; border-radius: 999px; }
    ${B} .cbtn .flag { display: block; flex: none; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff40; }
    ${B} .cbtn .flag-txt { font-size: 11px; }
    ${B} .cbtn img.flag { display: block; width: 16px; height: 16px; border-radius: 50%; }
    ${B} .cbtn.on { color: var(--txt) !important; border-color: var(--blue); background: #4ea3ff1f; }
    ${B} .cbtn.clr { padding: 3px 8px; }
    ${B} .revtog.on { color: var(--ok) !important; border-color: #2f6b45; background: #3ddc8414; }
    ${B} .cfg { padding: 10px 12px; background: #131417; border-bottom: 1px solid var(--line); }
    /* pre-war / roll call bar */
    /* Torn list mode: the table-only controls (tabs, filters, country picker, search) would do nothing - hide them */
    ${B}.orig .seg[data-g=view], ${B}.orig .tb-filters, ${B}.orig .tb .ctry, ${B}.orig .tb input[type=search] { display: none !important; }
    ${B} .wbar { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--line); background: #15161a; }
    ${B} .wbar.pre { background: linear-gradient(90deg, #4ea3ff14, transparent 70%); }
    ${B} .wbar .wb-i { display: inline-flex; color: var(--blue); }
    ${B} .wbar .sp { flex: 1; }
    ${B} .rbtn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    ${B} .wbar > * { flex-shrink: 0; white-space: nowrap; }
    ${B} .wbar > .sp { flex-shrink: 1; }
    ${B} .pres-c { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; background: #3ddc8414; border: 1px solid #3ddc8433; }
    ${B} .pres-c[hidden] { display: none; }
    ${B} .pres-c svg { width: 14px; height: 14px; color: var(--ok); }
    ${B} .pres-c .num { color: var(--txt); font-weight: 600; }
    ${B} .rbtn.todo { color: var(--warn) !important; border-color: #7a5a14; animation: dss-pulse 1.8s ease-in-out infinite; }
    /* roll call column */
    ${B} .rc { display: inline-flex; align-items: center; gap: 5px; vertical-align: middle; }
    ${B} .rc-i { display: inline-flex; } ${B} .rc-i svg { width: 14px; height: 14px; }
    ${B} .rc-i.y { color: var(--ok); } ${B} .rc-i.n { color: var(--red); } ${B} .rc-i.m { color: var(--warn); } ${B} .rc-i.note { color: var(--mut); }
    ${B} .rc-h { color: var(--txt); font-size: 11px; }
    ${B} table td.c-roll.none { color: #555a63; }
    /* roll call form */
    /* pop-up forms float over the whole page (so they work in Torn list mode, and open where you're looking) */
    ${B} .rcm { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 99990; display: flex; align-items: flex-start; justify-content: center; padding: 16px 0; background: #000b; overflow-y: auto; }
    ${B} .rcm-card { max-height: calc(100vh - 32px); overflow-y: auto; margin: auto 0; }   /* centred; top-aligned if taller than the screen */
    ${B} .rcm[hidden] { display: none; }
    ${B} .rcm-card { width: min(360px, calc(100% - 24px)); padding: 14px 16px; border-radius: 10px; background: #17181c; border: 1px solid #33363d; box-shadow: 0 14px 40px #000c; }
    ${B} .rcm-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    ${B} .rcm-hd b { font-size: 13px; letter-spacing: .3px; text-transform: uppercase; }
    ${B} .rcm-q { margin: 10px 0 5px; color: var(--txt); font-weight: 500; }
    ${B} .rcm .seg { display: flex; } ${B} .rcm .seg button { flex: 1; padding: 6px 0; }
    ${B} .rcm .seg button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .rcm-later[hidden] { display: none; }
    ${B} .rcm-hour, ${B} .rcm-note { width: 100%; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 6px 8px; font: inherit; }
    ${B} .rcm-err { min-height: 16px; margin-top: 8px; color: #ff8a8d; font-size: 11.5px; }
    ${B} .rcm-go { width: 100%; margin-top: 4px; padding: 8px 0; }
    ${B} .mcm .rcm-card { position: relative; width: min(440px, calc(100% - 24px)); }
    ${B} .acm .rcm-card { width: min(640px, calc(100% - 24px)); }
    ${B} .crm .rcm-card { width: min(460px, calc(100% - 24px)); }
    ${B} .cr-box { margin: 10px 0 14px; padding: 12px 14px; border-radius: 10px; border: 1px solid #2f6b45; background: #3ddc840d; text-align: center; line-height: 1.6; }
    ${B} .cr-box > b { font-size: 18px; } ${B} .cr-box div { color: var(--mut); }
    ${B} .cr-box.low { border-color: #7a5a14; background: #f5a5240f; } ${B} .cr-box.low div { color: #ffd27a; }
    ${B} .cr-box.crit { border-color: var(--acc); background: #e5484d14; } ${B} .cr-box.crit div { color: #ff8a8d; }
    ${B} .fsbtn.cr-warn { color: var(--warn) !important; border-color: #7a5a14; animation: dss-crw 1.4s ease-in-out infinite; }
    ${B} .fsbtn.cr-crit { color: #ff6b70 !important; border-color: var(--acc); animation: dss-crc 1s ease-in-out infinite; }
    @keyframes dss-crw { 50% { background: #f5a52433; box-shadow: 0 0 0 3px #f5a52426; } }
    @keyframes dss-crc { 50% { background: #e5484d40; box-shadow: 0 0 0 3px #e5484d33; } }
    ${B} .crm p { margin: 0 0 6px; } ${B} .crm a { color: var(--blue) !important; text-decoration: underline !important; }
    ${B} .crm ul { margin: 0 0 8px 18px; padding: 0; color: var(--txt); line-height: 1.6; }
    ${B} .cr-calc { font-size: 12px; padding-top: 8px; border-top: 1px solid #ffffff0d; }
    ${B} .fsm .rcm-card { width: min(440px, calc(100% - 24px)); }
    ${B} button.fs-sw { padding: 0; cursor: pointer; } ${B} button.fs-sw:disabled, ${B} button.fs-si:disabled { opacity: .5; cursor: default; }
    ${B} .fs-st { padding: 2px 9px; min-width: 28px; } ${B} button.fs-si { background: none; cursor: pointer; } ${B} button.fs-si:hover { color: var(--txt); }
    ${B} .fs-custom input, ${B} .fs-custom textarea { width: 100%; margin: 0 0 6px; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 6px 8px; font: inherit; resize: vertical; }
    ${B} .fs-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 2px; border-top: 1px solid #ffffff0d; }
    ${B} .fs-l { display: inline-flex; align-items: center; gap: 8px; color: var(--txt); } ${B} .fs-l svg { width: 15px; height: 15px; color: var(--mut); flex: none; }
    ${B} .fs-sw { position: relative; width: 34px; height: 19px; border-radius: 999px; background: #2a2c31; border: 1px solid #3a3d44; flex: none; }
    ${B} .fs-sw i { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #6b707a; transition: left .15s; }
    ${B} .fs-sw.on { background: #4ea3ff33; border-color: #4ea3ff88; } ${B} .fs-sw.on i { left: 17px; background: var(--blue); }
    ${B} .fs-val { display: inline-flex; align-items: center; gap: 10px; } ${B} .fs-val b { min-width: 28px; text-align: right; }
    ${B} .fs-bar { width: 110px; height: 4px; border-radius: 2px; background: #2a2c31; overflow: hidden; } ${B} .fs-bar i { display: block; height: 100%; background: var(--blue); }
    ${B} .fs-strat { display: inline-flex; gap: 4px; }
    ${B} .fs-si { display: inline-flex; padding: 4px; border-radius: 6px; color: #5b606a; border: 1px solid transparent; } ${B} .fs-si svg { width: 16px; height: 16px; }
    ${B} .fs-si.on { color: var(--txt); border-color: var(--blue); background: #4ea3ff1f; }
    ${B} .fs-custom { margin: 2px 0 6px; padding: 8px 10px; border-radius: 8px; background: #0f1012; border: 1px solid var(--line); font-size: 12px; } ${B} .fs-custom div { color: var(--mut); white-space: pre-wrap; margin-top: 3px; }
    ${B} .fs-upd { margin-top: 8px; font-size: 11px; text-align: right; }
    ${B} .trm .rcm-card { width: min(780px, calc(100% - 24px)); max-height: calc(100vh - 40px); display: flex; flex-direction: column; }
    ${B} .trm .rcm-hd { gap: 8px; flex-wrap: wrap; } ${B} .trm-ctl { display: flex; gap: 6px; margin-left: auto; }
    ${B} .trm-sort { display: inline-flex; } ${B} .trm .trm-sort button { flex: none; padding: 4px 10px; white-space: nowrap; } ${B} .trm-sort button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .trm [data-a=travempty].on { color: var(--txt); border-color: var(--blue); }
    ${B} .trm-body { overflow: auto; margin-top: 6px; }
    ${B} .tv-grid { display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1fr); gap: 6px 8px; align-items: start; }
    ${B} .tv-corner { grid-column: 1; }
    ${B} .tv-fh { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 2px 6px; border-bottom: 2px solid; font-size: 12px; }
    ${B} .tv-fh.ours { border-color: #3b8fe8; } ${B} .tv-fh.enemy { border-color: #e5484d; }
    ${B} .tv-fh b { text-transform: uppercase; letter-spacing: .4px; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .tv-cnt { display: inline-flex; gap: 3px; color: var(--mut); }
    ${B} .tv-f { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 999px; background: none; border: 1px solid transparent; color: var(--mut); font: inherit; cursor: pointer; }
    ${B} .tv-f:hover { border-color: var(--line); color: var(--txt); }
    ${B} .tv-all { padding: 3px 9px; border-radius: 999px; background: #4ea3ff1f; border: 1px solid var(--blue); color: var(--txt); font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
    ${B} .tv-ct[data-tctry] { cursor: pointer; } ${B} .tv-ct[data-tctry]:hover span { text-decoration: underline; }
    ${B} .tv-f.on { border-color: var(--blue); background: #4ea3ff1f; color: var(--txt); }
    ${B} .tv-cnt svg { width: 12px; height: 12px; }
    ${B} .tv-ct { display: flex; align-items: center; gap: 7px; min-height: 30px; font-weight: 600; font-size: 11.5px; white-space: nowrap; text-transform: uppercase; letter-spacing: .3px; }
    ${B} .tv-ct.mt { color: var(--mut); font-weight: 500; min-height: 18px; }
    ${B} .tv-ct .flag { width: 16px; height: 16px; border-radius: 50%; flex: none; box-shadow: 0 0 0 1px #ffffff40; }
    ${B} .tv-c { border-radius: 8px; padding: 3px 0; background: #1b1d22; border: 1px solid #2c2f36; border-left: 3px solid; }
    ${B} .tv-c.ours { border-left-color: #3b8fe8; } ${B} .tv-c.enemy { border-left-color: #e5484d; }
    ${B} .tv-c.none { background: none; border: 0; padding: 0; }
    ${B} .tv-p { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 76px; align-items: center; gap: 6px; padding: 3px 9px 3px 7px; }
    ${B} .tv-p.soon { background: #f5a52414; }
    ${B} .tv-ic { display: flex; } ${B} .tv-ic.out { color: var(--blue); } ${B} .tv-ic.back { color: var(--warn); } ${B} .tv-ic.abroad { color: var(--mut); }
    ${B} .tv-n { color: var(--txt) !important; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .tv-n:hover { text-decoration: underline; }
    ${B} .tv-s { font-size: 12px; } ${B} .tv-s.none { color: var(--mut); }
    ${B} .tv-s.st-easy { color: var(--ok); } ${B} .tv-s.st-even { color: var(--yel); } ${B} .tv-s.st-hard { color: var(--warn); } ${B} .tv-s.st-nope { color: var(--red); }
    ${B} .tv-t { text-align: right; font-size: 12px; color: var(--txt); white-space: nowrap; } ${B} .tv-now { color: var(--ok); font-weight: 600; }
    ${B} .tv-p.soon .tv-t { color: var(--warn); font-weight: 600; }
    ${B} .tv-none, ${B} .tv-empty { margin-top: 10px; font-size: 12px; } ${B} .tv-none { text-align: center; padding: 24px 0; }
    /* phones: country as a heading, each faction's card below it */
    ${B}.w560 .tv-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 5px 6px; }
    ${B}.w560 .tv-fh { flex-wrap: wrap; row-gap: 2px; } ${B}.w560 .tv-f { padding: 1px 4px; }
    ${B}.w560 .tv-corner { display: none; } ${B}.w560 .tv-corner:not(:empty) { display: block; grid-column: 1 / -1; order: -1; }
    ${B}.w560 .tv-ct { grid-column: 1 / -1; min-height: 0; margin-top: 4px; }
    ${B}.w560 .tv-ct.mt { margin-top: 0; }
    ${B}.w560 .tv-p { grid-template-columns: 14px minmax(0, 1fr) auto; row-gap: 0; padding: 3px 6px; font-size: 12px; }
    ${B}.w560 .tv-p .tv-t { grid-column: 2 / -1; text-align: left; font-size: 11px; }
    ${B}.w560 .tv-cnt { gap: 5px; }
    ${B} .rsm .rcm-card { width: min(640px, calc(100% - 24px)); max-height: calc(100vh - 40px); overflow: auto; }
    ${B} .rsm .rcm-hd { gap: 10px; } ${B} .rsm-top { margin-left: auto; font-size: 12px; } ${B} .rsm-top b { font-size: 15px; }
    ${B} .rs-q { margin-top: 12px; }
    ${B} .rs-qh { color: var(--txt); font-weight: 500; margin-bottom: 6px; }
    ${B} .rs-bar { display: flex; gap: 2px; height: 12px; border-radius: 4px; overflow: hidden; }
    ${B} .rs-seg { border: 0; padding: 0; min-width: 4px; cursor: pointer; opacity: .85; }
    ${B} .rs-seg:hover, ${B} .rs-seg.on { opacity: 1; box-shadow: inset 0 0 0 2px #ffffffaa; }
    ${B} .rs-keys { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 6px; }
    ${B} .rs-key { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; background: transparent; border: 1px solid transparent; color: var(--mut); cursor: pointer; font-size: 12px; }
    ${B} .rs-key b { color: var(--txt); }
    ${B} .rs-key:hover { border-color: var(--line); } ${B} .rs-key.on { border-color: var(--blue); background: #4ea3ff1a; color: var(--txt); }
    ${B} .rs-key i, ${B} .rs-nh i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex: none; }
    ${B} .rs-empty { font-size: 12px; }
    ${B} .rsm-names { margin-top: 14px; padding: 10px; border-radius: 8px; background: #0f1012; border: 1px solid var(--line); }
    ${B} .rsm-names:empty { display: none; }
    ${B} .rs-nh { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    ${B} .rs-nh > span { display: inline-flex; align-items: center; gap: 6px; }
    ${B} .rs-groups { max-height: 260px; overflow: auto; }
    ${B} .rs-band + .rs-band { margin-top: 8px; }
    ${B} .rs-bh { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--mut); margin-bottom: 4px; }
    ${B} .rs-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    ${B} .rs-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: #1d1f24; border: 1px solid var(--line); color: var(--txt) !important; text-decoration: none; font-size: 12px; }
    ${B} .rs-chip:hover { border-color: var(--blue); }
    ${B} .rsm-hours { margin-top: 14px; } ${B} .rsm-hours:empty { display: none; }
    ${B} .rsm-hours svg { display: block; width: 100%; height: auto; overflow: visible; }
    ${B} .rsm-hours .hb { fill: var(--blue); } ${B} .rsm-hours .hn { fill: var(--txt); font-size: 10px; }
    ${B} .rsm-hours .ax { fill: var(--mut); font-size: 10px; } ${B} .rsm-hours .gl { stroke: #ffffff1f; }
    ${B} .rsm-hours .mk { stroke: var(--warn); stroke-dasharray: 3 3; } ${B} .rsm-hours .mkt { fill: var(--mut); font-size: 9.5px; }
    ${B} .rsm-notes { margin-top: 14px; } ${B} .rsm-notes:empty { display: none; }
    ${B} .rsm-notes summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; margin-bottom: 0; }
    ${B} .rsm-notes summary::-webkit-details-marker { display: none; }
    ${B} .rsm-notes summary::before { content: '\u25b8'; color: var(--mut); font-size: 11px; transition: transform .15s; }
    ${B} .rsm-notes details[open] summary::before { transform: rotate(90deg); }
    ${B} .rsm-notes details[open] summary { margin-bottom: 6px; }
    ${B} .rs-note { padding: 5px 0; border-top: 1px solid #ffffff0d; font-size: 12px; color: var(--mut); } ${B} .rs-note b { color: var(--txt); margin-right: 6px; }
    ${B} .rb-c { font-size: 12px; }
    ${B} .acm-sub { font-size: 11.5px; margin-bottom: 8px; }
    ${B} .acm-days { display: flex; margin-bottom: 8px; } ${B} .acm-days button { flex: 1; padding: 5px 0; position: relative; }
    ${B} .acm-days button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .acm-days i { position: absolute; left: 50%; bottom: 1px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--mut); }
    ${B} .acm-plot { position: relative; }
    ${B} .acm-plot svg { display: block; width: 100%; height: auto; overflow: visible; }
    ${B} .acm-plot .gl { stroke: #ffffff12; stroke-width: 1; }
    ${B} .acm-plot .ax { fill: var(--mut); font-size: 10px; font-variant-numeric: tabular-nums; }
    ${B} .acm-plot .ln { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    ${B} .acm-plot .dl { fill: var(--txt); font-size: 11px; }
    ${B} .acm-plot .mk { stroke: var(--warn); stroke-width: 1; stroke-dasharray: 3 3; }
    ${B} .acm-plot .now { stroke: #ffffff55; stroke-width: 1; stroke-dasharray: 2 3; }
    ${B} .acm-plot .mkt { fill: var(--mut); font-size: 9.5px; }
    ${B} .acm-plot .xh { stroke: #ffffff40; stroke-width: 1; }
    ${B} .acm-plot .hov circle { stroke: #17181c; stroke-width: 2; }
    ${B} .acm-plot .hit { fill: transparent; cursor: crosshair; }
    ${B} .acm-tip { position: absolute; top: 4px; padding: 6px 9px; border-radius: 6px; background: #0f1012f2; border: 1px solid var(--line); pointer-events: none; font-size: 11.5px; min-width: 140px; }
    ${B} .acm-tip[hidden] { display: none; }
    ${B} .acm-tip b { display: block; margin-bottom: 3px; }
    ${B} .acm-tip div { display: flex; align-items: center; gap: 6px; color: var(--mut); } ${B} .acm-tip .num { margin-left: auto; color: var(--txt); font-weight: 600; }
    ${B} .acm-tip i, ${B} .acm-leg i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
    ${B} .acm-leg { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; font-size: 12px; }
    ${B} .acm-leg span { display: inline-flex; align-items: center; gap: 6px; }
    ${B} .acm-sum { margin-top: 6px; font-size: 11.5px; }
    ${B} .acm-none { padding: 30px 0; text-align: center; }
    ${B} .mcm-pop { position: absolute; left: 50%; bottom: 58px; transform: translate(-50%, 8px); display: flex; align-items: center; gap: 7px;
      padding: 8px 14px; border-radius: 999px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none;
      transition: opacity .18s, transform .18s; box-shadow: 0 8px 24px #000b; }
    ${B} .mcm-pop.show { opacity: 1; transform: translate(-50%, 0); }
    ${B} .mcm-pop.ok { background: #143323; border: 1px solid var(--ok); color: #9ff0c0; }
    ${B} .mcm-pop.warn { background: #3a2a0c; border: 1px solid var(--warn); color: #ffd27a; }
    ${B} .mcm-pop svg { width: 15px; height: 15px; }
    ${B} .rcm-go.done { background: var(--ok); color: #0c2416; }
    ${B} .mcm .seg button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .mcm-idle { width: 100%; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 6px 8px; font: inherit; }
    ${B} .mcm-chk { display: flex; align-items: center; gap: 7px; margin: 10px 0 0; color: var(--txt); cursor: pointer; }
    ${B} .mcm-hd2 { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 5px; }
    ${B} .mcm-out { width: 100%; height: 170px; resize: vertical; background: var(--bg); border: 1px solid var(--line); color: var(--txt);
      border-radius: 6px; padding: 7px 8px; font: 11.5px/1.5 ui-monospace, Consolas, monospace; white-space: pre; }
    ${B} .cfg[hidden] { display: none; }
    ${B} .cfg label { display: block; color: var(--txt); margin-bottom: 6px; font-weight: 500; }
    ${B} .cfg label small { color: var(--mut); font-weight: 400; }
    ${B} .cfg-row { display: flex; gap: 6px; flex-wrap: wrap; }
    ${B} .cfg-poll { margin-top: 10px; align-items: center; gap: 8px; }
    ${B} .cfg-poll label { display: inline-block; margin: 0; width: 160px; flex: none; }   /* fixed label column -> inputs line up */
    ${B} .cfg .cfg-poll input { flex: none; width: 64px; min-width: 0; text-align: center; }
    ${B} .cfg [class$=-saved] { color: var(--ok); font-size: 11.5px; }
    ${B} .cfg input { flex: 1; min-width: 180px; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 5px 8px; font: 12px ui-monospace, Consolas, monospace; letter-spacing: .5px; }
    ${B} .cfg input:focus { outline: none; border-color: var(--blue); }
    ${B} .keyin.masked { -webkit-text-security: disc; text-security: disc; }
    @supports not (-webkit-text-security: disc) {
      ${B} .keyin.masked:not(:placeholder-shown) { color: transparent; text-shadow: 0 0 7px rgb(230 231 234 / .75); }
    }
    ${B} .btn-save { background: var(--blue); color: #08111d; border: 0; border-radius: 6px; padding: 5px 14px; font-weight: 600; }
    ${B} .cfg-status { margin-top: 6px; min-height: 15px; color: var(--mut); font-size: 11.5px; }
    ${B} .cfg-status.ok { color: var(--ok); } ${B} .cfg-status.err { color: #ff8a8d; }
    /* desktop: settings as two columns of rows - name + hint on the left, the control on the right */
    ${B}:not(.w560) .cfg { padding: 12px 14px 6px; }
    ${B}:not(.w560) .cfg-status:empty { min-height: 0; margin: 0; }
    ${B}:not(.w560) .cfg-set { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; margin-top: 8px; align-items: start; }
    ${B}.w760:not(.w560) .cfg-set { grid-template-columns: 1fr; }
    ${B}:not(.w560) .cfg-poll { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "l c" "h s"; align-items: center;
      column-gap: 14px; row-gap: 2px; margin: 0; padding: 9px 0; border-top: 1px solid #ffffff0f; }
    ${B}:not(.w560) .cfg-poll label { grid-area: l; width: auto; }
    ${B}:not(.w560) .cfg-poll > input, ${B}:not(.w560) .cfg-poll > .seg { grid-area: c; justify-self: end; }
    ${B}:not(.w560) .cfg .cfg-poll input { width: 70px; padding: 5px 6px; }
    ${B}:not(.w560) .cfg-poll > .muted { grid-area: h; font-size: 11px; line-height: 1.35; }
    ${B}:not(.w560) .cfg-poll > .muted small { font-size: inherit; }
    ${B}:not(.w560) .cfg-poll > [class$=-saved] { grid-area: s; justify-self: end; font-size: 11px; }
    ${B}:not(.w560) .cfg-poll > [class$=-saved]:empty { display: none; }
    ${B}:not(.w560) .cfg-poll .seg button { padding: 4px 10px; }
    ${B} .age.bad { color: var(--red); }

    /* ---- table ---- */
    ${B} .tw { max-height: 70vh; overflow: auto; scrollbar-gutter: stable; }
    ${B} table { width: 100%; border-collapse: collapse; font: inherit; font-size: 11.5px; color: var(--txt); }
    ${B} table th { position: sticky; top: 0; z-index: 1; background: #1a1b1f; color: var(--mut); font-weight: 500; text-align: left; padding: 6px 5px; border-bottom: 1px solid var(--acc); white-space: nowrap; cursor: pointer; user-select: none; }
    ${B} table th.on { color: var(--blue); }
    ${B} table th .sa { display: inline-block; font-size: 10px; line-height: 1; margin: 0 3px; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; vertical-align: 1px; }
    ${B} table th.r, ${B} table td.r { text-align: right; }
    ${B} table th.c, ${B} table td.c { text-align: center; }
    ${B} table th:last-child, ${B} table td:last-child { padding-right: 16px; }
    ${B} a.pname { display: inline-block; max-width: 120px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
    ${B} .dibber > :first-child { max-width: 90px; }
    ${B} table td { padding: 4px 5px; border-bottom: 1px solid #1f2024; white-space: nowrap; color: var(--txt); }
    ${B} tbody tr { background: var(--row2); }
    ${B} tbody tr:nth-child(even) { background: var(--row); }
    ${B} tbody tr:hover { background: #202227; }
    ${B} tr.taken td:not(.keep) { opacity: .6; }
    /* your own row (Ours tab): blue tint + accent bar, solid colour so the sticky name cell matches */
    ${B} tbody tr.me { background: #16223a; }
    ${B} tbody tr.me:hover { background: #1b2944; }
    ${B} tbody tr.me > td:first-child { box-shadow: inset 3px 0 0 var(--blue); }
    ${B} tr.me .pname { color: #d6e7ff; font-weight: 600; }
    ${B} tr.unavail td:not(.keep) { opacity: .6; }
    ${B} .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
    ${B} .abf { display: inline-block; margin-left: 5px; vertical-align: -2px; line-height: 0; }
    ${B} .abf .flag { display: block; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff40; overflow: hidden; }
    ${B} .abf .pl { display: block; color: var(--blue); }
    ${B} .Online { background: var(--ok); } ${B} .Idle { background: var(--warn); } ${B} .Offline { background: #5b606a; }
    ${B} a.pname { color: var(--txt) !important; font-weight: 500; }
    ${B} a.pname:hover { color: #fff !important; text-decoration: underline; }
    ${B} table td.ok { color: var(--ok); } ${B} table td .hosp { color: var(--red); } ${B} table td .trav { color: var(--blue); }
    ${B} table td.muted, ${B} .muted { color: var(--mut); }
    ${B} table td.st-easy { color: var(--ok); } ${B} table td.st-even { color: var(--yel); }
    ${B} table td.st-hard { color: var(--warn); } ${B} table td.st-nope { color: var(--red); }
    ${B} table td.none { color: #555a63; }
    ${B} table td.c-rev svg { width: 14px; height: 14px; vertical-align: middle; }
    ${B} table td.rev-wait svg { opacity: .35; } ${B} table td.rev-busy { color: var(--blue); }
    ${B} table td.rev-busy svg { animation: dss-spin .8s linear infinite; }
    ${B} table td.rev-y { color: var(--ok); } ${B} table td.rev-n { color: #5b606a; } ${B} table td.rev-n svg { opacity: .45; }
    ${B} th.c-rev .rev-h { display: inline-flex; vertical-align: -3px; } ${B} th.c-rev .rev-h svg { width: 14px; height: 14px; }
    ${B} .dibber { display: inline-flex; gap: 6px; align-items: center; padding-left: 7px; border-left: 2px solid var(--red); }
    ${B} tr.mine .dibber { border-color: var(--warn); }
    ${B} .dibber .as { color: var(--mut); font-size: 11px; }

    /* ---- action icons ---- */
    ${B} .acts { display: inline-flex; gap: 2px; vertical-align: middle; }
    ${B} .ic { display: inline-flex; align-items: center; justify-content: center; width: 23px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: #cfd2d8 !important; padding: 0; }
    ${B} .ic:hover { background: #2a2c31; color: #fff !important; }
    ${B} .ic.on { color: var(--warn) !important; }
    ${B} .ic.taken { color: var(--red) !important; }
    ${B} .ic[disabled] { opacity: .35; cursor: not-allowed; background: transparent; }
    ${B} .ic.atk:hover { color: var(--red) !important; }
    ${B} .ic.off { opacity: .35; }
    ${B} .ic.ask { color: var(--ok) !important; animation: dss-pulse 1.4s ease-in-out infinite; }
    @keyframes dss-pulse { 50% { opacity: .35; } }
    ${B} .dibber .help { display: inline-flex; color: var(--warn); }
    ${B} .dibber .help svg { width: 13px; height: 13px; }
    ${B} .ic.busy svg { animation: dss-spin .8s linear infinite; }
    @keyframes dss-spin { to { transform: rotate(360deg); } }

    ${B} .msg { padding: 18px 12px; color: var(--mut); }
    ${B} .err { color: #ff8a8d; }
    /* travel card */
    ${B} .pop { position: fixed; z-index: 99995; min-width: 240px; padding: 10px 12px; border-radius: 8px; pointer-events: none;
      background: #1c1d22; border: 1px solid #33363d; box-shadow: 0 10px 28px #000b; font-size: 12px; color: var(--txt); }
    ${B} .pop[hidden] { display: none; }
    ${B} .tt { position: fixed; z-index: 99995; max-width: min(320px, calc(100vw - 12px)); width: max-content; padding: 6px 9px; border-radius: 6px; pointer-events: none;
      background: #1c1d22; border: 1px solid #33363d; box-shadow: 0 6px 18px #000a; font-size: 11.5px; line-height: 1.4; white-space: nowrap; }
    ${B} .tt b { white-space: normal; }
    ${B} .tt[hidden] { display: none; }
    ${B} .tt b { display: block; color: var(--txt); font-weight: 600; }
    ${B} .tt div { color: var(--mut); white-space: normal; overflow-wrap: anywhere; }
    ${B} .tt div.hl { display: flex; align-items: baseline; gap: 6px; margin: 3px 0 4px; padding: 3px 7px; border-radius: 5px;
      background: #4ea3ff1a; border: 1px solid #4ea3ff33; }
    ${B} .tt .hl .k { color: var(--mut); font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
    ${B} .tt .hl .v { color: var(--blue); font-weight: 600; }
    ${B} .tt .hl .s { color: var(--mut); font-size: 10.5px; margin-left: auto; padding-left: 8px; }
    ${B} .pop-h { display: flex; align-items: center; gap: 9px; }
    ${B} .pop-route { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 999px; background: #4ea3ff14; border: 1px solid #4ea3ff2e; }
    ${B} .pop-route .pl { display: block; color: var(--blue); } ${B} .pop-route .ar { display: block; color: var(--mut); }
    ${B} .pop-route .flag { display: block; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff40; }
    ${B} .pop-sub { color: var(--mut); font-size: 11px; margin: 4px 0 8px; }
    ${B} .pop-tk { color: var(--txt); font-weight: 600; }
    ${B} .pop table.pop-t { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    ${B} .pop table.pop-t td { padding: 4px 6px 4px 0; border: 0; border-top: 1px solid #26282e; background: transparent; color: var(--txt); }
    ${B} .pop table.pop-t td:last-child { padding-right: 0; }
    ${B} .pop table.pop-t tr { background: transparent; }
    ${B} .pop table.pop-t td:nth-child(2) { padding-left: 10px; }
    ${B} .pop table.pop-t td:nth-child(3) { padding-left: 14px; color: var(--mut); }
    ${B} .pop tr.gone td { color: #555a63; } ${B} .pop tr.gone td:nth-child(2) { text-decoration: line-through; }
    ${B} .pop tr.gone td:nth-child(3) { color: #555a63; }
    ${B} .pop tr.first td { color: var(--blue); font-weight: 600; } ${B} .pop tr.first td:nth-child(3) { color: var(--blue); }
    ${B} .pop tr.now td, ${B} .pop tr.now td:nth-child(3) { color: var(--ok); font-weight: 600; }
    ${B} .toast { position: fixed; left: 0; top: 0; z-index: 99996; max-width: 75%; padding: 8px 12px; border-radius: 6px; white-space: pre-line; background: #26282e; border: 1px solid var(--line); box-shadow: 0 6px 20px #0008; color: var(--txt); }
    ${B} .toast.ok { border-color: #2f6b45; } ${B} .toast.warn { border-color: #7a5a14; } ${B} .toast.err { border-color: var(--acc); color: #ffb3b5; }

    /* phone "all columns" mode: every column, sideways scroll, player + actions pinned */
    ${B}.w560.mcols-all .c-score, ${B}.w560.mcols-all .c-bsp, ${B}.w560.mcols-all .c-ffs, ${B}.w560.mcols-all .c-yata,
    ${B}.w560.mcols-all .c-lvl, ${B}.w560.mcols-all .c-last, ${B}.w560.mcols-all .c-rev, ${B}.w560.mcols-all .c-roll { display: table-cell !important; }
    ${B}.w560.mcols-all .m-meta { display: none !important; }
    /* Compact on any width: just the combined Stats figure, no per-provider columns */
    ${B}:not(.mcols-all) .c-bsp, ${B}:not(.mcols-all) .c-ffs, ${B}:not(.mcols-all) .c-yata { display: none; }
    ${B}.w560.mcols-all table td, ${B}.w560.mcols-all table th { padding: 6px 7px; }
    ${B}.w560.mcols-all .c-name { position: sticky; left: 0; z-index: 2; background: inherit; }
    ${B}.w560.mcols-all th.c-name { z-index: 3; background: #1a1b1f; }
    ${B}.w560.mcols-all .c-act { position: sticky; left: var(--namew, 120px); z-index: 2; background: inherit; }
    ${B}.w560.mcols-all .tw.scrolled .c-act { box-shadow: 6px 0 6px -4px #0009; }
    ${B}.w560.mcols-all th.c-act { z-index: 3; background: #1a1b1f; }
    ${B}.w560.mcols-all tbody td { background: inherit; }
    ${B}.w560.mcols-all .swipe-hint { display: block; }
    ${B} .swipe-hint { display: none; text-align: right; color: var(--mut); font-size: 10.5px; padding: 3px 8px 0; }

    /* hospital / jail chip: [icon] countdown, same shape as the travel chip */
    ${B} .hchip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 6px; border-radius: 999px;
      background: #f0616d17; border: 1px solid #f0616d38; vertical-align: middle; line-height: 1.2; }
    ${B} .hchip svg { display: block; flex: none; width: 13px; height: 13px; }
    ${B} .hchip .num { min-width: 34px; }
    ${B} .dwarn { display: inline-flex; align-items: center; gap: 7px; margin-left: 10px; padding: 4px 11px; border-radius: 999px; min-width: 0;
      background: #f5a52422; border: 1px solid var(--warn); color: #ffd27a !important; font-weight: 500; white-space: nowrap;
      animation: dss-pulse 1.2s ease-in-out infinite; }
    ${B} .dwarn[hidden] { display: none; }
    ${B} .dwarn svg { width: 14px; height: 14px; flex: none; }
    ${B} .dwarn i { font-style: normal; font-size: .82em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .85; }
    ${B} .dwarn b { color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
    ${B} .dwarn.out { background: #3ddc8422; border-color: var(--ok); color: #9ff0c0 !important; }
    ${B} .dwarn:hover { animation: none; filter: brightness(1.2); }
    ${B}.w560 .dwarn { order: -1; flex: 1 1 100%; justify-content: center; margin: 0 0 4px; }
    /* desktop: centred in the top toolbar row and bigger */
    ${B} .tb-row:first-child { position: relative; }
    ${B}:not(.w760) .dwarn { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); margin: 0;
      gap: 9px; padding: 7px 20px; font-size: 14.5px; max-width: min(46%, calc(100% - 480px));   /* never over the buttons either side */ box-shadow: 0 0 18px #f5a52433; }
    ${B}:not(.w760) .dwarn.out { box-shadow: 0 0 18px #3ddc8433; }
    ${B}:not(.w760) .dwarn svg { width: 18px; height: 18px; }
    ${B} .lvb { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px;
      color: var(--warn); background: #f5a5241a; border: 1px solid #f5a52455; }
    ${B} .lvb[hidden] { display: none; }
    ${B} .lvb { padding: 3px 6px; } ${B} .lvb > span { display: none; }   /* Torn API badge: just the bolt (hover for why) */
    ${B} .lvb svg { width: 12px; height: 12px; }
    ${B} .hchip.soon { color: var(--warn); border-color: var(--warn); background: #f5a52426; animation: dss-pulse 1s ease-in-out infinite; }
    ${B} .hchip .selfic { display: inline-flex; color: var(--warn); margin-left: -1px; }
    ${B} .hchip.self { border-color: #f5a52455; }
    ${B} .hchip.okchip { color: var(--ok); background: #3ddc8414; border-color: #3ddc8433; }
    ${B} .hchip.okchip svg { stroke-width: 2.6; }
    /* travel chip: [plane] [from] -> [to], all icons round and the same size */
    ${B} .trv { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 6px; border-radius: 999px;
      background: #4ea3ff14; border: 1px solid #4ea3ff2e; vertical-align: middle; line-height: 0; }
    ${B} .trv .pl { display: block; flex: none; color: var(--blue); margin-right: 1px; }
    ${B} .trv .ar { display: block; flex: none; color: var(--mut); }
    ${B} .trv .flag { display: block; flex: none; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff40; overflow: hidden; }
    ${B} .trv .flag-txt { line-height: 1.2; }
    ${B} .flag-txt { font-size: 10.5px; }
    ${B} td.c-st[data-tip] { cursor: help; }
    @media (hover: none) { ${B} td.c-st[data-tip] { cursor: pointer; -webkit-tap-highlight-color: transparent; } }

    /* mobile-only bits are hidden on desktop */
    ${B} .m-dib, ${B} .m-meta { display: none; }
    ${B} .prov { color: var(--mut); font-size: 9px; margin-left: 2px; }
    ${B} .m-dib { font-size: 10.5px; color: var(--red); margin: 1px 0 0 13px; }
    ${B} .m-dib.mine { color: var(--warn); }
    ${B} .m-dib .help svg { width: 11px; height: 11px; vertical-align: -1px; color: var(--warn); }
    ${B} .m-meta { font-size: 10px; margin: 1px 0 0 13px; }

    /* ---- narrow widths (mobile / PDA) ---- */
      ${B}.w760 .c-ffs, ${B}.w760 .c-yata, ${B}.w760 .c-last { display: none; }
      ${B}.w760 table td, ${B}.w760 table th { padding: 5px 5px; }
      ${B}.w760 .hd { grid-template-columns: 1fr 1fr; }
      ${B}.w760 .mid { grid-column: 1 / -1; order: -1; flex-direction: row; gap: 10px; }
      ${B}.w760 .lead { width: auto; height: auto; border-radius: 8px; padding: 6px 14px; flex-direction: row; gap: 8px; }
      ${B}.w760 .pill { margin-top: 0; }
      ${B}.w760 .fac-row { flex-direction: column !important; align-items: flex-start; }
      ${B}.w760 .fac.right .fac-row { align-items: flex-end; }
      /* header */
      ${B}.w560 .hd { padding: 14px 8px 8px; gap: 8px; }
      ${B}.w560 .fac { padding: 8px; }
      ${B}.w560 .fac-name { font-size: 12.5px; }
      ${B}.w560 .fac-tag { width: 20px; height: 20px; }
      ${B}.w560 .fac-score { font-size: 18px; }
      ${B}.w560 .fac-row { margin-top: 5px; gap: 4px; }
      ${B}.w560 .pres { gap: 6px; font-size: 11px; }
      ${B}.w560 .mid { flex-wrap: wrap; gap: 6px; }
      ${B}.w560 .lead b { font-size: 20px; }
      /* toolbar: tabs on one line, search + icon buttons on the next */
      ${B}.w560 .tb { padding: 8px 8px 10px; gap: 9px; }
      ${B}.w560 .tb .seg button { padding: 5px 9px; }
      ${B}.w460 .tb .seg button { padding: 5px 7px; font-size: 12px; }
      ${B}.w460 .tb .ghost { padding: 5px 7px; }
      ${B}.w560 .tb input[type=search] { flex: 1 1 0; min-width: 0; width: auto; padding: 6px 8px; }
      ${B}.w560 .tb .sp { display: none; }
      ${B}.w560 .tb .lbl { display: none; }
      /* phones: search gets the whole row, the page buttons share the row underneath */
      ${B}.w560 .tb-search input[type=search] { flex: 1 1 100%; }
      ${B}.w560 .tb-search { row-gap: 9px; }
      ${B}.w560 .tb-search .ghost { flex: 1 1 auto; white-space: nowrap; text-align: center; }
      ${B}.w560 .ghost { padding: 5px 9px; }
      /* top row on phones: tabs, status, then the icon buttons - keep it on one line */
      ${B}.w560 .tb-row:first-child { flex-wrap: wrap; }   /* only the attack warning wraps: it takes a row of its own */
      ${B}.w560 .tb-row:first-child .ghost { padding: 5px 8px; flex: none; }
      ${B}.w560 .age { font-size: 11px; white-space: nowrap; }
      ${B}.w400 .tb-row:first-child .seg button { padding: 5px 8px; }
      ${B}.w400 .tb-row:first-child .ghost { padding: 5px 6px; }
      ${B}.w560 .tb-row:first-child .seg { flex: none; }
      ${B}.w340 .tb-row:first-child .age { display: none; }   /* very narrow: the refresh button still spins while updating */
      ${B}.w560 .age { margin-left: auto; }
      /* table: name(+dibber, lvl, last) | actions | status | best stats */
      ${B}.w560 .c-score, ${B}.w560 .c-bsp, ${B}.w560 .c-ffs, ${B}.w560 .c-yata, ${B}.w560 .c-lvl, ${B}.w560 .c-last, ${B}.w560 .c-dib, ${B}.w560 .c-rev, ${B}.w560 .c-roll { display: none; }
      ${B}.w560 .c-est { display: table-cell; }
      ${B}.w560 .m-dib, ${B}.w560 .m-meta { display: block; }
      ${B}.w560 table { font-size: 12px; }
      ${B}.w560 table td { padding: 6px 5px; vertical-align: middle; }
      ${B}.w560 a.pname { max-width: 118px; }
      ${B}.w560 .ic { width: 32px; height: 30px; }
      ${B}.w560 .ic svg { width: 17px; height: 17px; }
      ${B}.w560 .tw { max-height: 65vh; -webkit-overflow-scrolling: touch; }
      ${B}.w560 .cfg-row { gap: 5px; }
      ${B}.w560 .cfg input { min-width: 0; flex: 1 1 100%; }
      /* settings: label left, control right, hint underneath */
      ${B}.w560 .cfg-poll { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 10px; row-gap: 3px;
        margin-top: 0; padding: 9px 0; border-top: 1px solid #ffffff0d; }
      ${B}.w560 .cfg-status + .cfg-poll { border-top: 0; }
      ${B}.w560 .cfg-poll label { width: auto; }
      ${B}.w560 .cfg .cfg-poll input { width: 72px; flex: none; padding: 6px 4px; }
      ${B}.w560 .cfg-poll > .muted, ${B}.w560 .cfg-poll > [class$=-saved] { grid-column: 1 / -1; font-size: 11px; line-height: 1.35; }
      ${B}.w560 .cfg-poll > [class$=-saved]:empty { display: none; }
      ${B}.w560 .cfg-poll > .muted small { font-size: inherit; }
      ${B}.w560 .cfg-status:empty { min-height: 4px; }
      ${B}.w560 .cfg-poll .seg button { padding: 5px 9px; }
      /* war bar: one tidy line - count pill, answers, buttons */
      ${B}.w560 .wbar { flex-wrap: wrap; gap: 6px; padding: 6px 8px; }
      /* phones: keep the bar on one line - "answered" goes (the count stays), very narrow ones lose the button words */
      ${B}.w560 .rb-c .rb-l { display: none; }
      ${B}.w340 .wbar .rbtn span { display: none; }
      ${B}.w560 .pres-c > .muted { display: none; }
      ${B}.w560 .pres-c { padding: 3px 8px; }
      ${B}.w560 .rb-c { font-size: 11.5px; }
      ${B}.w560 .rbtn { padding: 5px 9px; gap: 5px; }
      ${B}.w560 .toast { width: calc(100vw - 16px); max-width: none; }
      ${B}.w400 .fac-name { font-size: 11.5px; }
      ${B}.w400 .fac-score { font-size: 16px; }
      ${B}.w400 .fac-sub { display: none; }
      ${B}.w400 .ic { width: 27px; }
      ${B}.w400 .ic svg { width: 16px; height: 16px; }
      ${B}.w400 a.pname { max-width: 92px; }
      ${B}.w400 table td { padding: 6px 3px; }
      ${B}.w400 .c-name { padding-left: 6px !important; }
  `);
				const findWrap = () => document.querySelector(".faction-war[class*=\"membersWrap___\"]") || document.querySelector("[class*=\"membersWrap___\"]") || document.querySelector("#faction_war_list_id .faction-war") || document.querySelector(".desc-wrap .faction-war");
				function fixedOrigin(el) {
					const l = el.style.left, t = el.style.top;
					el.style.left = "0px";
					el.style.top = "0px";
					const r = el.getBoundingClientRect();
					el.style.left = l;
					el.style.top = t;
					return {
						x: r.left,
						y: r.top
					};
				}
				function placeFixed(el, x, y) {
					const o = fixedOrigin(el);
					el.style.left = `${Math.round(x - o.x)}px`;
					el.style.top = `${Math.round(y - o.y)}px`;
				}
				function fitOverlays() {
					for (const m of document.querySelectorAll(`#${BOX_ID} .rcm:not([hidden])`)) placeFixed(m, 0, 0);
					const t = document.querySelector(`#${BOX_ID} .toast`);
					if (t) placeFixed(t, document.documentElement.clientWidth - t.offsetWidth - (t.offsetWidth > 300 ? 8 : 16), window.innerHeight - t.offsetHeight - (box560() ? 72 : 16));
				}
				const box560 = () => {
					const b = document.getElementById(BOX_ID);
					return !!b && b.classList.contains("w560");
				};
				window.addEventListener("scroll", () => {
					fitOverlays();
					popRefresh();
					if (noHover()) ttHide();
				}, { passive: true });
				window.addEventListener("resize", fitOverlays, { passive: true });
				function toast(text, kind, ms) {
					const box = document.getElementById(BOX_ID);
					if (!box) return;
					const oldToast = box.querySelector(".toast");
					if (oldToast) oldToast.remove();
					const t = document.createElement("div");
					t.className = `toast ${kind || ""}`;
					t.textContent = text;
					box.appendChild(t);
					fitOverlays();
					setTimeout(() => t.remove(), ms || 3500);
				}
				function toggleGraph() {
					const info = document.querySelector("[class*=\"factionWarInfo___\"]");
					const g = document.querySelector("[class*=\"graphIcon___\"]");
					if (!info && !g) return toast("Couldn’t find Torn’s war graph on this page", "warn");
					const shown = () => info && info.dataset.dssGraph !== "hide" && (info.dataset.dssGraph === "show" || ![...info.classList].some((c) => c.startsWith("hiddenGraph___")));
					const before = shown();
					if (info && info.dataset.dssGraph) {
						info.dataset.dssGraph = before ? "hide" : "show";
						return reveal(info, !before);
					}
					if (g) {
						const wasHidden = g.classList.contains(HIDE);
						g.classList.remove(HIDE);
						for (const el of [g, ...g.querySelectorAll("*")]) {
							try {
								el.click();
							} catch (_) {}
							if (shown() !== before) break;
						}
						if (wasHidden) g.classList.add(HIDE);
					}
					setTimeout(() => {
						if (!info) return;
						if (shown() === before) {
							info.dataset.dssGraph = before ? "hide" : "show";
						}
						reveal(info, shown());
					}, 200);
				}
				function reveal(info, on) {
					if (on) setTimeout(() => info.scrollIntoView({
						block: "start",
						behavior: "smooth"
					}), 50);
				}
				const HOVER_MQ = window.matchMedia ? window.matchMedia("(hover: none)") : null;
				const noHover = () => SERIAL || !!(HOVER_MQ && HOVER_MQ.matches);
				function stripTitles(root) {
					if (!root) return;
					root.querySelectorAll("[title]").forEach((el) => {
						const t = el.getAttribute("title");
						el.removeAttribute("title");
						if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", t.replace(/\n!?/g, " · ").replace(/\|/g, " "));
						if (!noHover()) el.dataset.tt = t;
					});
				}
				let ttEl = null, mouseX = -1, mouseY = -1;
				function ttShow(el) {
					const box = document.getElementById(BOX_ID), tip = box && box.querySelector(".tt");
					if (!tip || !el || !el.dataset.tt) return ttHide();
					ttEl = el;
					const [head, ...rest] = el.dataset.tt.split("\n");
					const line = (l) => {
						if (l[0] !== "!") return `<div>${esc(l)}</div>`;
						const [k, v, src] = l.slice(1).split("|");
						return `<div class="hl"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>${src ? `<span class="s">${esc(src)}</span>` : ""}</div>`;
					};
					const html = `<b>${esc(head)}</b>${rest.map(line).join("")}`;
					if (tip.innerHTML !== html) tip.innerHTML = html;
					tip.hidden = false;
					const cr = el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
					const w = tip.offsetWidth, h = tip.offsetHeight;
					const left = Math.max(6, Math.min(cr.left + cr.width / 2 - w / 2, vw - w - 6));
					let top = cr.top - h - 6;
					if (top < 4) top = cr.bottom + 6;
					placeFixed(tip, left, top);
				}
				function ttHide() {
					ttEl = null;
					const tip = document.querySelector(`#${BOX_ID} .tt`);
					if (tip) tip.hidden = true;
				}
				function ttRefresh() {
					if (!ttEl || noHover()) return;
					if (document.contains(ttEl)) return ttShow(ttEl);
					const under = mouseX >= 0 && document.elementFromPoint(mouseX, mouseY);
					const el = under && under.closest("[data-tt]");
					if (el && document.getElementById(BOX_ID).contains(el)) ttShow(el);
					else ttHide();
				}
				function fixSticky() {
					const box = document.getElementById(BOX_ID);
					const tw = box && box.querySelector(".tw");
					if (!tw) return;
					const measure = () => {
						tw.style.removeProperty("--namew");
						const act = tw.querySelector("th.c-act"), name = tw.querySelector("th.c-name");
						if (act && name) tw.style.setProperty("--namew", act.getBoundingClientRect().left - name.getBoundingClientRect().left + "px");
					};
					measure();
					setTimeout(measure, 0);
				}
				function applyMobileCols() {
					const box = document.getElementById(BOX_ID);
					if (!box) return;
					const mode = GM_getValue("mobileCols", "compact");
					box.classList.toggle("mcols-all", mode === "all");
					box.querySelectorAll(".seg[data-g=mcols] button").forEach((b) => b.classList.toggle("on", b.dataset.v === mode));
				}
				function buildBox() {
					const box = document.createElement("div");
					box.id = BOX_ID;
					box.innerHTML = `
      <div class="wi" hidden><div class="ws"></div><div class="wtip"></div></div>
      <div class="hd"></div>
      <div class="atkbar" hidden><div class="atk-track"></div></div>
      <div class="tb">
        <div class="tb-row">
          <div class="seg" data-g="view">
            <button data-v="enemy">Enemy</button><button data-v="ours">Ours</button>
          </div>
          <span class="lvb" hidden>${ICON.bolt}<span>Torn API</span></span>
          <a class="dwarn" hidden target="_blank" rel="noopener"></a>
          <span class="sp"></span>
          <span class="age num"></span>
          <button class="ghost" data-a="refresh" title="Refresh">\u21bb</button>
          <button class="ghost fsbtn" data-a="cropen" title="War credits" hidden>${ICON.coins}</button>
          <button class="ghost fsbtn" data-a="fsopen" title="Faction settings" hidden>${ICON.fist}</button>
          <button class="ghost" data-a="key" title="Settings">\u2699</button>
        </div>
        <div class="tb-row tb-filters">
          <div class="seg" data-g="filter">
            <button data-v="all">All</button><button data-v="available">Available</button><button data-v="online">Online</button>
          </div>
          <button class="ghost revtog" data-a="revtog" title="Revivable only">${ICON.revive}</button>
          <div class="seg" data-g="stfilter">
            <button data-v="all">Any</button><button data-v="okay">Okay</button><button data-v="hosp">Hosp</button><button data-v="travel">Travel</button>
          </div>
        </div>
        <div class="tb-row ctry" hidden></div>
        <div class="tb-row tb-search">
          <input type="search" placeholder="Search name\u2026">
          <span class="sp"></span>
          <button class="ghost" data-a="travel" title="Travellers">${TRAV_IC.out}<span class="lbl"> Travel</span></button>
          <button class="ghost" data-a="activity" title="Activity by hour">${ICON.users}<span class="lbl"> Activity</span></button>
          <button class="ghost" data-a="graph" title="War graph">\ud83d\udcc8<span class="lbl"> Graph</span></button>
          <button class="ghost" data-a="orig" title="Swap list"><span class="lbl-orig">Torn list</span></button>
          <a class="ghost" href="https://tyronic.io/war" target="_blank" rel="noopener" title="Open Tyronic">\u2197</a>
        </div>
      </div>
      <div class="cfg" hidden>
        <label>Torn API key <small>(the one you use on tyronic.io \u2014 stored only in Tampermonkey)</small></label>
        <div class="cfg-row">
          <input type="text" class="keyin masked" name="dss-ty-token" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"
                 data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" placeholder="16-character API key">
          <button type="button" class="ghost" data-a="eye" title="Show key">\ud83d\udc41</button>
          <button type="button" class="btn-save" data-a="savekey">Save</button>
          <button type="button" class="ghost" data-a="clearkey" title="Delete key">Remove</button>
          <button type="button" class="ghost" data-a="key">Close</button>
        </div>
        <div class="cfg-status"></div>
        <div class="cfg-set">
        <div class="cfg-row cfg-poll">
          <label>Columns</label>
          <div class="seg" data-g="mcols"><button type="button" data-v="all">All columns</button><button type="button" data-v="compact">Compact</button></div>
          <span class="muted"><small>Compact shows one combined Stats column</small></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-poll">Refresh every</label>
          <input id="dss-poll" type="number" min="${MIN_POLL_S}" max="300" step="1" inputmode="numeric">
          <span class="muted">seconds <small>(minimum ${MIN_POLL_S})</small></span>
          <span class="poll-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-rev">Revive checks</label>
          <input id="dss-rev" type="number" min="5" max="${REV_MAX}" step="1" inputmode="numeric">
          <span class="muted">calls / minute <small>(Torn allows 100/min across all your keys)</small></span>
          <span class="rev-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-revevery">Re-check revives every</label>
          <input id="dss-revevery" type="number" min="${REV_EVERY_MIN}" max="${REV_EVERY_MAX}" step="1" inputmode="numeric">
          <span class="muted">minutes <small>(minimum ${REV_EVERY_MIN})</small></span>
          <span class="revevery-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-dibwarn">Dib hosp warning</label>
          <input id="dss-dibwarn" type="number" min="0" max="${WARN_MAX}" step="5" inputmode="numeric">
          <span class="muted">seconds before they\u2019re out <small>(0 = off)</small></span>
          <span class="dibwarn-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label>Tyronic user count</label>
          <div class="seg" data-g="pres"><button type="button" data-v="snap">Every minute</button><button type="button" data-v="live">Live</button><button type="button" data-v="off">Off</button></div>
          <span class="muted"><small>Live counts you for others but keeps a connection open \u2014 use Every minute if clicks are slow</small></span>
        </div>
        </div>
      </div>
      <div class="wbw"></div>
      <div class="bd"></div>
      <div class="pop" hidden></div>
      <div class="tt" hidden></div>
      <div class="rcm crm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Tyronic war credits</b><button type="button" class="ghost" data-a="crclose" title="Close">\u2715</button></div>
          <div class="crm-body"></div>
        </div>
      </div>
      <div class="rcm fsm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Faction settings</b><button type="button" class="ghost" data-a="fsclose" title="Close">\u2715</button></div>
          <div class="fsm-body"></div>
        </div>
      </div>
      <div class="rcm trm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Travellers</b>
            <span class="trm-ctl"><span class="seg trm-sort"><button type="button" data-v="flight" title="Countries by flight time">Flight time</button><button type="button" data-v="az" title="Countries A to Z">A\u2013Z</button></span>
            <button type="button" class="ghost" data-a="travempty" title="Show countries nobody is in">Empty</button></span>
            <button type="button" class="ghost" data-a="travclose" title="Close">\u2715</button></div>
          <div class="trm-body"></div>
        </div>
      </div>
      <div class="rcm rsm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Roll call summary</b><span class="rsm-top"></span><button type="button" class="ghost" data-a="rsclose" title="Close">\u2715</button></div>
          <div class="rsm-qs"></div>
          <div class="rsm-names"></div>
          <div class="rsm-hours"></div>
          <div class="rsm-notes"></div>
        </div>
      </div>
      <div class="rcm acm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Activity by hour</b><button type="button" class="ghost" data-a="actclose" title="Close">\u2715</button></div>
          <div class="acm-sub muted">Average active members, from Tyronic's history</div>
          <div class="seg acm-days"></div>
          <div class="acm-plot"></div>
          <div class="acm-leg"></div>
          <div class="acm-sum muted"></div>
        </div>
      </div>
      <div class="rcm mcm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Merc list</b><button type="button" class="ghost" data-a="mercclose" title="Close">\u2715</button></div>
          <div class="rcm-q">Online at start <span class="muted">(any if none picked)</span></div>
          <div class="seg mq" data-q="start"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="m">Maybe</button><button type="button" data-v="x">No answer</button></div>
          <div class="rcm-q">Self-hosp</div>
          <div class="seg mq" data-q="hosp"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="x">No answer</button></div>
          <div class="rcm-q">Last active</div>
          <select class="mcm-idle">
            <option value="0">Any time</option><option value="0.25">15m+ ago</option><option value="1">1h+ ago</option><option value="3">3h+ ago</option>
            <option value="6">6h+ ago</option><option value="12">12h+ ago</option><option value="24">1d+ ago</option>
          </select>
          <label class="mcm-chk"><input type="checkbox" class="mcm-skip"> Skip players already in hospital</label>
          <div class="mcm-hd2"><span class="mcm-n muted"></span><button type="button" class="ghost" data-a="mercreset" title="Reset filters">Reset</button></div>
          <textarea class="mcm-out" readonly spellcheck="false"></textarea>
          <button type="button" class="btn-save rcm-go" data-a="merccopy">Copy list</button>
        </div>
      </div>
      <div class="rcm rollm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>War roll call</b><button type="button" class="ghost" data-a="rollclose" title="Close">\u2715</button></div>
          <div class="rcm-q">Online at start?</div>
          <div class="seg rq" data-q="start_online"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="m">Maybe</button></div>
          <div class="rcm-later">
            <div class="rcm-q">Self-hosp before start?</div>
            <div class="seg rq" data-q="start_hosped"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button></div>
            <div class="rcm-q">Online from (TCT)</div>
            <select class="rcm-hour"><option value="">Don\u2019t know</option>${Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`).join("")}</select>
          </div>
          <div class="rcm-q">Chain-watch abroad?</div>
          <div class="seg rq" data-q="chain_watch"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="m">Maybe</button></div>
          <div class="rcm-q">Note <span class="muted">(optional)</span></div>
          <input type="text" class="rcm-note" maxlength="60" placeholder="Max 60 characters" autocomplete="off">
          <div class="rcm-err"></div>
          <button type="button" class="btn-save rcm-go" data-a="rollsubmit">Submit</button>
        </div>
      </div>`;
					box.addEventListener("mousemove", (e) => {
						mouseX = e.clientX;
						mouseY = e.clientY;
					}, { passive: true });
					box.addEventListener("mouseleave", () => {
						if (!noHover()) ttHide();
					});
					box.addEventListener("mouseover", (e) => {
						if (noHover()) return;
						const t = e.target.closest("[data-tt]");
						if (t && t !== ttEl) ttShow(t);
						else if (!t && ttEl) ttHide();
						const td = e.target.closest("[data-pop]");
						if (td && td.dataset.pop !== popId) popShow(td);
					});
					box.addEventListener("mouseout", (e) => {
						if (noHover()) return;
						const td = e.target.closest("[data-pop]");
						if (td && !td.contains(e.relatedTarget)) popHide();
					});
					box.addEventListener("click", (e) => {
						if (noHover()) {
							const pt = e.target.closest("[data-pop]");
							if (pt && pt.dataset.pop !== popId) popShow(pt);
							else popHide();
							const stCell = e.target.closest("td.c-st[data-tip]");
							if (stCell && stCell !== ttEl) {
								stCell.dataset.tt = stCell.dataset.tip;
								ttShow(stCell);
							} else if (ttEl) ttHide();
						}
						const wiEl = e.target.closest(".wi");
						box.querySelector(".wi").classList.toggle("open", !!wiEl && !box.querySelector(".wi").classList.contains("open"));
						if (e.target.classList && e.target.classList.contains("crm")) {
							crClose();
							return;
						}
						if (e.target.classList && e.target.classList.contains("fsm")) {
							fsClose();
							return;
						}
						if (e.target.classList && e.target.classList.contains("trm")) {
							travClose();
							return;
						}
						if (e.target.classList && e.target.classList.contains("rsm")) {
							rsClose();
							return;
						}
						if (e.target.classList && e.target.classList.contains("acm")) {
							actClose();
							return;
						}
						if (e.target.classList && e.target.classList.contains("mcm")) {
							mercClose();
							return;
						}
						if (e.target.classList && e.target.classList.contains("rcm")) {
							rollClose();
							return;
						}
						const b = e.target.closest("button, th[data-sort], .tv-ct[data-tctry]");
						if (!b || !box.contains(b)) return;
						const seg = b.parentElement && b.parentElement.dataset.g;
						if (seg === "view") {
							view = b.dataset.v;
							GM_setValue("view", view);
							render();
						} else if (seg === "mcols") {
							GM_setValue("mobileCols", b.dataset.v);
							applyMobileCols();
						} else if (seg === "pres") {
							GM_setValue("presMode", b.dataset.v);
							b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
							presStop();
							clearTimeout(presTimer);
							presTimer = null;
							if (presOff()) {
								presKnown = false;
								for (const k in presence) delete presence[k];
								presChanged();
							} else {
								presStarted = true;
								presConnect();
							}
						} else if (seg === "filter") {
							filter = b.dataset.v;
							GM_setValue("filter", filter);
							render();
						} else if (seg === "stfilter") {
							stFilter = b.dataset.v;
							GM_setValue("stFilter", stFilter);
							render();
						} else if (b.dataset.ctry != null) {
							const k = b.dataset.ctry;
							if (k === "") ctryFilter.clear();
							else if (ctryFilter.has(k)) ctryFilter.delete(k);
							else ctryFilter.add(k);
							GM_setValue("ctryFilter", [...ctryFilter]);
							render();
						} else if (b.dataset.a === "revtog") {
							revFilter = revFilter === "yes" ? "all" : "yes";
							GM_setValue("revFilter", revFilter);
							render();
						} else if (b.dataset.a === "refresh") refresh(true);
						else if (b.dataset.a === "key") openSettings();
						else if (b.dataset.a === "eye") box.querySelector(".cfg .keyin").classList.toggle("masked");
						else if (b.dataset.a === "savekey") saveKey(box.querySelector(".cfg .keyin").value);
						else if (b.dataset.a === "clearkey") {
							GM_setValue("tornKey", "");
							GM_setValue("session", null);
							box.querySelector(".cfg .keyin").value = "";
							const st = box.querySelector(".cfg-status");
							st.textContent = "Key removed.";
							st.className = "cfg-status";
						} else if (b.dataset.a === "rollcall") rollOpen();
						else if (b.dataset.a === "rssum") rsOpen();
						else if (b.dataset.a === "rsclose") rsClose();
						else if (b.dataset.a === "rscopy") rsCopy(b);
						else if (b.dataset.rq) {
							rsPick = {
								q: b.dataset.rq,
								v: b.dataset.rv
							};
							rsPaint();
						} else if (b.dataset.a === "merc") mercOpen();
						else if (b.dataset.a === "activity") actOpen();
						else if (b.dataset.a === "travel") travOpen();
						else if (b.dataset.a === "fsopen") fsOpen();
						else if (b.dataset.a === "cropen") crOpen();
						else if (b.dataset.a === "crclose") crClose();
						else if (b.dataset.a === "fsclose") fsClose();
						else if (b.dataset.fs) {
							const c = state.factionconfig || {}, k = b.dataset.fs;
							fsSave({ [k]: k === "dibs_enabled" ? c[k] === false : !c[k] });
						} else if (b.dataset.fsn) {
							const k = b.dataset.fsn, [min, max] = FS_NUM[k], c = state.factionconfig || {}, cur = c[k] == null ? {
								dibs_time: 300,
								num_dibs: 1,
								num_assists: 1
							}[k] : Number(c[k]);
							fsSave({ [k]: Math.max(min, Math.min(max, cur + Number(b.dataset.d))) });
						} else if (b.dataset.fss != null) {
							const n = +b.dataset.fss;
							if (n !== (Number((state.factionconfig || {}).strategy) || 0)) fsSave({ strategy: n });
						} else if (b.dataset.a === "fscustom") {
							const card = b.closest(".fs-custom");
							fsSave({
								strategy: 3,
								strategy_custom_title: card.querySelector(".fs-ct").value.trim() || null,
								strategy_custom: card.querySelector(".fs-cx").value.trim() || null
							});
						} else if (b.dataset.a === "travclose") travClose();
						else if (b.dataset.a === "travempty") {
							travEmpty = !travEmpty;
							travPaint();
						} else if (b.dataset.tctry != null) {
							const k = b.dataset.tctry, was = travCtry.has(k);
							travCtry.clear();
							if (k && !was) travCtry.add(k);
							ttHide();
							travPaint();
						} else if (b.dataset.tdir) {
							const k = b.dataset.side;
							travDir[k] = travDir[k] === b.dataset.tdir ? null : b.dataset.tdir;
							ttHide();
							travPaint();
						} else if (b.parentElement && b.parentElement.classList.contains("trm-sort")) {
							travSort = b.dataset.v;
							GM_setValue("travSort", travSort);
							travPaint();
						} else if (b.dataset.a === "actclose") actClose();
						else if (b.dataset.d && b.parentElement && b.parentElement.classList.contains("acm-days")) {
							actDay = +b.dataset.d;
							actPaint();
						} else if (b.dataset.a === "mercclose") mercClose();
						else if (b.dataset.a === "merccopy") mercCopy();
						else if (b.dataset.a === "mercreset") {
							merc = Object.assign({}, MERC_DEFAULT);
							mercSave();
						} else if (b.parentElement && b.parentElement.classList.contains("mq")) mercPick(b.parentElement.dataset.q, b.dataset.v);
						else if (b.dataset.a === "rollclose") rollClose();
						else if (b.dataset.a === "rollsubmit") rollSubmit();
						else if (b.parentElement && b.parentElement.classList.contains("rq")) {
							rollPick(b.parentElement.dataset.q, b.dataset.v);
						} else if (b.dataset.a === "graph") toggleGraph();
						else if (b.dataset.a === "orig") {
							showOriginal = !showOriginal;
							GM_setValue("showOriginal", showOriginal);
							apply();
							box.scrollIntoView({
								block: "start",
								behavior: "smooth"
							});
						} else if (b.dataset.act) doAction(b.dataset.act, +b.dataset.id);
						else if (b.dataset.sort) {
							const k = b.dataset.sort;
							sortDir = sortKey === k ? -sortDir : 1;
							sortKey = k;
							render();
						}
					});
					const pollInp = box.querySelector("#dss-poll");
					pollInp.addEventListener("change", () => {
						const v = Math.min(300, Math.max(MIN_POLL_S, Math.round(Number(pollInp.value) || MIN_POLL_S)));
						pollInp.value = v;
						GM_setValue("pollSec", v);
						schedulePoll();
						const sv = box.querySelector(".poll-saved");
						sv.textContent = `Saved \u2014 every ${v}s`;
						setTimeout(() => {
							sv.textContent = "";
						}, 2e3);
					});
					box.querySelector(".trm-body").addEventListener("scroll", () => {
						popRefresh();
						ttHide();
					}, { passive: true });
					box.querySelector(".mcm-idle").addEventListener("change", (e) => {
						merc.idle = Number(e.target.value) || 0;
						mercSave();
					});
					box.querySelector(".mcm-skip").addEventListener("change", (e) => {
						merc.skipHosp = e.target.checked;
						mercSave();
					});
					box.querySelector(".mcm-out").addEventListener("focus", (e) => e.target.select());
					box.querySelector(".cfg .keyin").addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							saveKey(e.target.value);
						}
					});
					const revInp = box.querySelector("#dss-rev");
					revInp.addEventListener("change", () => {
						const v = Math.min(REV_MAX, Math.max(5, Math.round(Number(revInp.value) || REV_DEFAULT)));
						revInp.value = v;
						GM_setValue("revPerMin", v);
						revKick();
						const sv = box.querySelector(".rev-saved");
						sv.textContent = `Saved \u2014 ${v}/min`;
						setTimeout(() => {
							sv.textContent = "";
						}, 2e3);
					});
					const warnInp = box.querySelector("#dss-dibwarn");
					warnInp.addEventListener("change", () => {
						const raw = Number(warnInp.value);
						const v = Math.min(WARN_MAX, Math.max(0, Math.round(isFinite(raw) ? raw : WARN_DEFAULT)));
						warnInp.value = v;
						GM_setValue("dibWarnSec", v);
						const sv = box.querySelector(".dibwarn-saved");
						sv.textContent = v ? `Saved \u2014 ${v}s` : "Saved — off";
						setTimeout(() => {
							sv.textContent = "";
						}, 2e3);
					});
					const revEvInp = box.querySelector("#dss-revevery");
					revEvInp.addEventListener("change", () => {
						const v = Math.min(REV_EVERY_MAX, Math.max(REV_EVERY_MIN, Math.round(Number(revEvInp.value) || REV_EVERY_DEFAULT)));
						revEvInp.value = v;
						GM_setValue("revEveryMin", v);
						revKick();
						const sv = box.querySelector(".revevery-saved");
						sv.textContent = `Saved \u2014 every ${v} min`;
						setTimeout(() => {
							sv.textContent = "";
						}, 2e3);
					});
					applyMobileCols();
					stripTitles(box);
					box.querySelector("input[type=search]").addEventListener("input", (e) => {
						search = e.target.value.trim().toLowerCase();
						render();
					});
					const sizeClasses = () => {
						applyMobileCols();
						setTimeout(fixSticky, 0);
						const w = box.clientWidth;
						for (const bp of [
							760,
							560,
							460,
							400,
							340
						]) box.classList.toggle("w" + bp, w > 0 && w <= bp);
					};
					if (typeof ResizeObserver === "function") new ResizeObserver(sizeClasses).observe(box);
					else window.addEventListener("resize", sizeClasses);
					setTimeout(sizeClasses, 0);
					return box;
				}
				function facCard(f, side, cls) {
					const ws = f.warstats || {};
					const c = counts(f.members);
					const avg = ws.score_log_count ? (ws.score_log_sum / ws.score_log_count).toFixed(2) : "—";
					const cur = ws.chaincurrent || 0, max = Math.max(1, ws.chainmax || 10);
					const pct = Math.min(100, cur / max * 100);
					const chainEnd = Date.parse(ws.chainend);
					const chainLive = ws.chaincurrent > 0 && chainEnd > Date.now();
					return `
      <div class="fac ${side} ${cls}">
        <div class="fac-top">
          <img class="fac-tag" src="https://factiontags.torn.com/${esc(f.info.pfpurl)}" alt="">
          <a class="fac-name" href="https://www.torn.com/factions.php?step=profile&ID=${f.info.faction_id}" target="_blank" title="${esc(f.info.name)}">${esc(f.info.name)}</a>
        </div>
        <div class="fac-row">
          <div>
            <div class="fac-score num">${num(ws.score)}</div>
            <div class="fac-sub num">${avg} avg/hit</div>
          </div>
          <div class="pres num">
            <span title="Online"><i class="Online"></i>${c.Online}</span>
            <span title="Idle"><i class="Idle"></i>${c.Idle}</span>
            <span title="Offline"><i class="Offline"></i>${c.Offline}</span>
          </div>
        </div>
        <div class="bar" title="Chain ${num(cur)} / ${num(max)}"><div style="width:${pct}%"></div></div>
        <div class="chain num">
          <span><b>${num(cur)}</b></span>
          ${ws.chaincooldown > 0 ? `<span class="ctimer cd" title="Cooldown">cooldown <span data-until="${(lastFetch || Date.now()) + ws.chaincooldown * 1e3}">${clock(ws.chaincooldown * 1e3)}</span></span>` : chainLive ? `<span class="ctimer" data-chainend="${chainEnd}" title="Chain timeout"><span data-until="${chainEnd}">${clock(chainEnd - Date.now())}</span></span>` : `<span class="ctimer muted">00:00</span>`}
          <span>${num(max)}</span>
        </div>
      </div>`;
				}
				function render() {
					const box = document.getElementById(BOX_ID);
					if (!box) return;
					box.querySelectorAll(".seg[data-g=view] button").forEach((b) => b.classList.toggle("on", b.dataset.v === view));
					box.querySelectorAll(".seg[data-g=filter] button").forEach((b) => b.classList.toggle("on", b.dataset.v === filter));
					box.querySelectorAll(".seg[data-g=stfilter] button").forEach((b) => b.classList.toggle("on", b.dataset.v === stFilter));
					box.querySelector("[data-a=revtog]").classList.toggle("on", revFilter === "yes");
					box.querySelector("[data-a=orig] .lbl-orig").textContent = showOriginal ? "Tyronic view" : "Torn list";
					const hd = box.querySelector(".hd"), bd = box.querySelector(".bd");
					if (!state) {
						hd.innerHTML = "";
						bd.innerHTML = error ? `<div class="msg err">${error.needKey ? "No Torn API key set yet — add it in the settings above." : "Could not load Tyronic data: " + esc(error.message)}</div>` : "<div class=\"msg\">Loading Tyronic war data…</div>";
						return;
					}
					const { ours, enemy } = sides();
					if (!ours || !enemy || !ours.info || !enemy.info) {
						hd.innerHTML = "";
						bd.innerHTML = "<div class=\"msg\">Tyronic has no ranked war data for your faction right now.</div>";
						bd.dssHtml = hd.dssHtml = null;
						return;
					}
					memberIdx = {};
					for (const m of [...ours.members || [], ...enemy.members || []]) memberIdx[m.player_id] = m;
					const oS = (ours.warstats || {}).score || 0, eS = (enemy.warstats || {}).score || 0, lead = oS - eS;
					const wd = state.wardata || {};
					const start = Date.parse(wd.warstart);
					let wm = null;
					try {
						wm = winModel(ours, enemy);
					} catch (_) {
						wm = null;
					}
					const wi = box.querySelector(".wi");
					if (wm) {
						const pct = (x, lo, hi) => U.clamp(x * 100, lo, hi);
						wi.hidden = false;
						wi.style.setProperty("--score", `${pct(wm.ours.warstrength, 0, 100)}%`);
						wi.style.setProperty("--winprob", `${pct(wm.ours.winprob, 3, 97)}%`);
						wi.querySelector(".wtip").innerHTML = `
        <div><span>Win probability:</span> <b class="gold">${pct(wm.ours.winprob, 0, 100).toFixed(2)}%</b></div>
        <div><span>Your current strength:</span> <b class="g">${pct(wm.ours.warstrength, 0, 100).toFixed(1)}%</b></div>
        <div><span>Enemy current strength:</span> <b class="r">${pct(wm.enemy.warstrength, 0, 100).toFixed(1)}%</b></div>`;
					} else wi.hidden = true;
					const hdHtml = `
      ${facCard(ours, "left", "ours")}
      <div class="mid">
        <div class="lead ${lead >= 0 ? "win" : "lose"}"><b class="num">${lead >= 0 ? "+" : ""}${num(lead)}</b><span class="num">${num(wd.scoretarget)}</span></div>
        ${isFinite(start) ? `<div class="pill num" title="War time">\u23f1 <span data-since="${start}">${clock(Date.now() - start)}</span></div>` : ""}
        <div class="pill tct num" title="Torn time">TCT <span data-tct>${tct()}</span></div>
        ${stratPill()}
      </div>
      ${facCard(enemy, "right", "enemy")}`;
					if (sameHtml(hd, hdHtml)) {} else {
						hd.innerHTML = hdHtml;
						stripTitles(hd);
						hd.querySelectorAll("img.fac-tag").forEach((img) => img.addEventListener("error", () => {
							img.style.visibility = "hidden";
						}, { once: true }));
					}
					const isEnemy = view === "enemy";
					const rolls = rollIdx(), showRoll = !isEnemy && rollOn();
					const fac = isEnemy ? enemy : ours;
					const sIdx = statsIndex();
					const me = state.user.user_id;
					const mine = bestEst(sIdx[me]).v;
					const dibs = dibsByFoe();
					const cfg = state.factionconfig || {};
					const dibsOn = cfg.dibs_enabled !== false;
					const maxAssist = cfg.num_assists == null ? 1 : cfg.num_assists;
					const maxDibs = cfg.num_dibs || 1;
					const dibsTime = cfg.dibs_time || 300;
					const autoAssist = !!cfg.auto_request_assists;
					const allDibs = Object.values(dibs);
					const myDibCount = allDibs.filter((x) => x.dib_window_resolved === false ? (x.entrant_player_ids || []).includes(me) : x.player_id === me).length;
					const myAssistCount = allDibs.filter((x) => (x.assist_player_ids || []).includes(me)).length;
					const warscore = Object.assign({}, (ours.warstats || {}).warscore || {}, (enemy.warstats || {}).warscore || {});
					let rows = (fac.members || []).map((m) => {
						const s = sIdx[m.player_id] || {};
						const bsp = bsOf(s, "BSP"), ffs = bsOf(s, "FFSCOUTER"), yata = bsOf(s, "YATA");
						const be = bestEst(s);
						const score = Math.round((domScore[m.player_id] != null ? domScore[m.player_id] : Number(warscore[m.player_id]) || 0) * 100) / 100;
						return {
							m,
							s,
							st: statusInfo(m),
							bsp,
							ffs,
							yata,
							est: be.v,
							be,
							score,
							roll: rolls[m.player_id],
							dib: isEnemy ? dibs[m.player_id] : null
						};
					});
					if (search) rows = rows.filter((r) => r.m.name.toLowerCase().includes(search));
					if (filter === "available") rows = rows.filter((r) => r.st.rank === 1 || r.st.rank === 2 && r.st.until - Date.now() < 6e4);
					if (filter === "online") rows = rows.filter((r) => r.m.active_status !== "Offline");
					const ST_RANK = {
						okay: 1,
						hosp: 2,
						travel: 3
					};
					if (stFilter !== "all") rows = rows.filter((r) => r.st.rank === ST_RANK[stFilter]);
					const ctryRow = box.querySelector(".tb .ctry");
					if (stFilter === "travel") {
						const seen = {};
						for (const m of fac.members || []) {
							const st = statusInfo(m);
							if (st.rank !== 3 || !st.fkey) continue;
							const k = st.fkey;
							(seen[k] = seen[k] || {
								name: k === "torn" ? "Torn" : st.where,
								n: 0
							}).n++;
						}
						for (const k of ctryFilter) if (!seen[k]) seen[k] = {
							name: k.replace(/\b\w/g, (c) => c.toUpperCase()),
							n: 0
						};
						const order = ["torn", ...Object.keys(FLAG_SVG)];
						const keys = Object.keys(seen).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
						ctryRow.innerHTML = keys.length ? keys.map((k) => `<button class="ghost cbtn ${ctryFilter.has(k) ? "on" : ""}" data-ctry="${esc(k)}" title="${esc(k === "torn" ? "Flying to Torn" : seen[k].name)}">${k === "torn" ? TORN : flag(seen[k].name)}<span class="num">${seen[k].n}</span></button>`).join("") + (ctryFilter.size ? `<button class="ghost cbtn clr" data-ctry="" title="All countries">\u2715</button>` : "") : "<span class=\"muted\">Nobody is travelling.</span>";
						ctryRow.hidden = false;
						if (ctryFilter.size) rows = rows.filter((r) => ctryFilter.has(r.st.fkey));
					} else ctryRow.hidden = true;
					const revCandidates = rows.map((r) => r.m);
					const revPending = revFilter === "all" ? 0 : revCandidates.filter((m) => !revValue(m.player_id)).length;
					if (revFilter !== "all") rows = rows.filter((r) => {
						const v = revValue(r.m.player_id);
						return !!v && v.v === true;
					});
					rows = sortRows(rows);
					const th = (k, label, cls = "") => {
						const on = sortKey === k;
						const arrow = on ? `<span class="sa">${sortDir === 1 ? "↓" : "↑"}\ufe0e</span>` : "";
						const right = /(^|\s)r(\s|$)/.test(cls);
						return `<th data-sort="${k}" class="${cls} ${on ? "on" : ""}">${right ? arrow + label : label + arrow}</th>`;
					};
					const MON = [
						"Jan",
						"Feb",
						"Mar",
						"Apr",
						"May",
						"Jun",
						"Jul",
						"Aug",
						"Sep",
						"Oct",
						"Nov",
						"Dec"
					];
					const sdate = (iso) => {
						const d = new Date(iso), y = d.getUTCFullYear();
						if (!isFinite(d)) return "?";
						return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${y !== new Date().getUTCFullYear() ? ` \u2019${String(y).slice(2)}` : ""}`;
					};
					const bsCell = (v, b, cls) => {
						const tip = b ? sdate(b.statsdate) : "No estimate";
						return `<td class="r num ${cls} ${v ? strengthClass(v, mine) : "none"}" title="${esc(tip)}">${fmtBS(v)}</td>`;
					};
					const NAMES = {
						SPY: "Spy",
						FFSCOUTER: "FFS",
						BSP: "BSP",
						YATA: "YATA"
					};
					const estCell = (r) => {
						const be = r.be, all = [
							"SPY",
							"FFSCOUTER",
							"BSP",
							"YATA"
						].map((p) => r.s[p]).filter((b) => b && b.total).sort((x, y) => (Date.parse(y.statsdate) || 0) - (Date.parse(x.statsdate) || 0));
						const head = !be.v ? "No estimate" : be.kind === "SPY" ? "Spy" : be.kind === "AVG" ? "Average" : NAMES[be.kind];
						const bt = buildOf(r.s);
						let tip = head + (bt ? `\n!Build|${bt.label}|${bt.src}` : "") + (all.length ? "\n" : "") + all.map((b) => `${NAMES[b.bsprovider]} ${fmtBS(b.total)} \u00b7 ${sdate(b.statsdate)}${be.used.includes(b) ? "" : " (old)"}`).join("\n");
						const spy = r.s.SPY;
						if (be.kind === "SPY" && spy.strength != null) tip += `\nSTR ${fmtBS(spy.strength)}  DEF ${fmtBS(spy.defense)}  SPD ${fmtBS(spy.speed)}  DEX ${fmtBS(spy.dexterity)}`;
						const tag = be.kind === "SPY" ? "<small class=\"prov\">S</small>" : "";
						return `<td class="r num c-est ${be.v ? strengthClass(be.v, mine) : "none"}" title="${esc(tip)}">${fmtBS(be.v)}${tag}</td>`;
					};
					const rollTd = (rc) => {
						if (!rc) return `<td class="c c-roll none" title="No roll call">\u2014</td>`;
						const hour = rc.start_online !== true && rc.hour_online != null ? `<span class="rc-h num">${String(rc.hour_online).padStart(2, "0")}h</span>` : "";
						const sh = rc.start_online !== true && rc.start_hosped === true ? `<span class="rc-i y">${ICON.hosp}</span>` : "";
						return `<td class="c c-roll" title="${esc(rollTip(rc))}"><span class="rc">` + `<span class="rc-i ${ynmCls(rc.start_online)}">${ICON.power}</span>` + `<span class="rc-i ${ynmCls(rc.chain_watch)}">${ICON.globe}</span>${sh}${hour}` + (rc.note ? `<span class="rc-i note">${ICON.note}</span>` : "") + `</span></td>`;
					};
					const COLS = isEnemy ? [
						"stats",
						"status",
						"score",
						"lvl",
						"last",
						"rev"
					] : [
						"status",
						"rev",
						"roll",
						"score",
						"stats",
						"lvl",
						"last"
					];
					const rowList = rows.map((r) => {
						const m = r.m, st = r.st, d = r.dib;
						const myDib = d && d.player_id === me;
						const assists = d && d.assist_player_ids || [];
						const iAssist = assists.includes(me);
						const busyDib = pending === `dib:${m.player_id}`, busyAs = pending === `assist:${m.player_id}`, busyReq = pending === `request:${m.player_id}`;
						const wantsHelp = d && d.assist_enabled;
						const statusCell = st.rank === 2 ? `<td class="keep c-st" data-tip="${esc(st.detail || st.text)}" title="${esc(st.detail || st.text)}"><span class="hosp hchip ${st.self ? "self" : ""}">${st.text === "Jail" ? ICON.jail : ICON.hosp}${st.unknown ? "<span class=\"num\">new</span>" : `<span class="num" data-until="${st.until}">${clock(st.until - Date.now())}</span>`}${st.self ? `<span class="selfic">${ICON.selfhosp}</span>` : ""}</span></td>` : st.rank === 1 ? `<td class="keep ok c-st"${st.out ? ` title="${esc(st.detail)}"` : ""}><span class="hchip okchip">${ICON.ok}<span>${esc(st.text)}</span></span></td>` : st.icon ? `<td class="keep c-st" data-pop="${m.player_id}" aria-label="${esc(st.detail)}"><span class="${st.cls} trv">${st.icon}</span></td>` : `<td class="keep c-st"><span class="${st.cls}">${esc(st.text)}</span></td>`;
						const trCls = [
							m.player_id === me ? "me" : "",
							myDib ? "mine" : "",
							iAssist && !myDib ? "assisting" : "",
							d && !myDib && !iAssist ? "taken" : "",
							st.rank > 1 ? "unavail" : ""
						].join(" ");
						const nowMs = Date.now();
						const inWindow = d && d.dib_window_resolved === false;
						const hospLong = m.status_color === "red" && m.status_until && Date.parse(m.status_until) > nowMs + dibsTime * 1e3;
						let dibState, dibTip;
						if (inWindow) {
							const entered = (d.entrant_player_ids || []).includes(me);
							dibState = entered ? "on" : myDibCount >= maxDibs ? "off" : "free";
							const winEnd = `ends ${new Date(Date.parse(d.dib_window_expires_at) || nowMs).toISOString().slice(11, 19)} TCT`;
							dibTip = entered ? `In dib window \u00b7 ${winEnd}` : myDibCount >= maxDibs ? `Max ${maxDibs} dibs` : `Join dib window \u00b7 ${winEnd}`;
						} else if (d) {
							dibState = myDib ? "on" : "taken";
							dibTip = myDib ? "Undib" : `Dibbed by ${nameOf(d.player_id)}`;
						} else if (myDibCount >= maxDibs) {
							dibState = "off";
							dibTip = `Max ${maxDibs} dib${maxDibs > 1 ? "s" : ""}`;
						} else if (hospLong) {
							dibState = "off";
							dibTip = `Dibs open at ${Math.floor(dibsTime / 60)}m left`;
						} else {
							dibState = "free";
							dibTip = "Dib";
						}
						const dibDisabled = dibState === "taken" || dibState === "off" || inWindow && dibState === "on";
						let asState = null, asTip = "", asAct = "assist";
						const helpList = assists.length ? `\nWith ${assists.map(nameOf).join(", ")}` : "";
						if (d && !inWindow && maxAssist > 0) {
							if (!d.assist_enabled && !autoAssist) {
								if (myDib) {
									asState = "idle";
									asTip = "Request assist";
									asAct = "request";
								}
							} else if (myDib) {
								if (autoAssist) {
									asState = "fixed";
									asTip = "Auto-assist on" + helpList;
								} else {
									asState = "on";
									asTip = "Cancel assist request" + helpList;
									asAct = "request";
								}
							} else if (iAssist) {
								asState = "on";
								asTip = "Stop assisting" + helpList;
							} else if (assists.length >= maxAssist) {
								asState = "full";
								asTip = "Assists full" + helpList;
							} else if (myAssistCount >= maxDibs) {
								asState = "full";
								asTip = `Max ${maxDibs} assists`;
							} else {
								asState = "ask";
								asTip = `Assist ${nameOf(d.player_id)}` + helpList;
							}
						}
						const busyAsAny = busyAs || busyReq;
						const acts = !isEnemy ? "" : `<td class="keep c-act"><span class="acts">
        ${dibsOn ? `<button class="ic ${dibState === "on" ? "on" : dibState === "taken" ? "taken" : ""} ${busyDib ? "busy" : ""}" data-act="dib" data-id="${m.player_id}" title="${esc(dibTip)}" ${dibDisabled ? "disabled" : ""}>${busyDib ? ICON.spin : ICON.dib}</button>` : ""}
        ${dibsOn && asState ? `<button class="ic ${asState === "on" || asState === "fixed" ? "on" : asState === "ask" ? "ask" : ""} ${busyAsAny ? "busy" : ""}" data-act="${asAct}" data-id="${m.player_id}" title="${esc(asTip)}" ${asState === "full" || asState === "fixed" ? "disabled" : ""}>${busyAsAny ? ICON.spin : ICON.assist}</button>` : ""}
        <a class="ic atk ${st.rank > 1 ? "off" : ""}" href="https://www.torn.com/page.php?sid=attack&user2ID=${m.player_id}" target="${ATK_TARGET}" title="Attack">${ICON.attack}</a>
      </span></td>`;
						return [m.player_id, `<tr class="${trCls}" data-pid="${m.player_id}">
        <td class="keep c-name"><span class="dot ${esc(m.active_status)}" title="${esc(m.active_status)}"></span><a class="pname" href="https://www.torn.com/profiles.php?XID=${m.player_id}" target="_blank">${esc(m.name)}</a>${abroadFlag(m)}${d && isEnemy ? `<div class="m-dib ${myDib ? "mine" : ""}">${esc(nameOf(d.player_id))}${wantsHelp ? ` <span class="help">${ICON.assist}</span>` : ""}${assists.length ? ` +${assists.length}` : ""}</div>` : ""}<div class="m-meta muted">Lvl ${m.level} \u00b7 <span data-ago="${Date.parse(m.active_stamp) || ""}">${ago(m.active_stamp)}</span></div></td>
        ${acts}
        ${isEnemy && dibsOn ? `<td class="keep c-dib">${d ? `<span class="dibber">${esc(nameOf(d.player_id))}${wantsHelp ? ` <span class="help" title="Assist requested">${ICON.assist}</span>` : ""}${assists.length ? ` <span class="as" title="${esc(assists.map(nameOf).join(", "))}">+${assists.length}</span>` : ""}</span>` : ""}</td>` : ""}
        ${COLS.map((k) => ({
							stats: () => estCell(r) + bsCell(r.bsp, r.s.BSP, "c-bsp") + bsCell(r.ffs, r.s.FFSCOUTER, "c-ffs") + bsCell(r.yata, r.s.YATA, "c-yata"),
							status: () => statusCell,
							score: () => `<td class="r num c-score ${r.score ? "" : "muted"}" title="War score">${num(r.score)}</td>`,
							lvl: () => `<td class="r num c-lvl">${m.level}</td>`,
							last: () => `<td class="r num c-last muted"><span data-ago="${Date.parse(m.active_stamp) || ""}">${ago(m.active_stamp)}</span></td>`,
							rev: () => revTd(m.player_id),
							roll: () => showRoll ? rollTd(r.roll) : ""
						})[k]()).join("")}
      </tr>`];
					});
					const body = rowList.map((x) => x[1]).join("");
					const wstart = Date.parse(wd.warstart), preWar = isFinite(wstart) && wstart > Date.now();
					box.querySelectorAll(".fsbtn").forEach((fb) => {
						if (fb.hidden === fsCanEdit()) fb.hidden = !fsCanEdit();
					});
					const cb = box.querySelector("[data-a=cropen]"), cw = crWars();
					if (cb) {
						const lvl = cw == null ? "" : cw <= 1 ? "crit" : cw <= 2 ? "warn" : "";
						if ((cb.dataset.lvl || "") !== lvl) {
							cb.dataset.lvl = lvl;
							cb.classList.toggle("cr-warn", lvl === "warn");
							cb.classList.toggle("cr-crit", lvl === "crit");
							cb.title = lvl ? `War credits: ${cw <= 0 ? "none left" : `${cw} war${cw === 1 ? "" : "s"} left`}` : "War credits";
							stripTitles(cb.parentElement);
						}
					}
					const gb = box.querySelector("[data-a=graph]"), noGraph = !(isFinite(wstart) && wstart <= Date.now());
					if (gb && gb.style.display === "none" !== noGraph) gb.style.display = noGraph ? "none" : "";
					const myRoll = rolls[me];
					const rollCount = Object.keys(rolls).filter((id) => (ours.members || []).some((x) => String(x.player_id) === id)).length;
					const showBar = preWar || rollOn() || !presOff();
					const banner = !showBar ? "" : `<div class="wbar ${preWar ? "pre" : ""}">
        ${preWar ? `<span class="wb-i">${ICON.clock}</span><span><b>War starts in <span class="num" data-until="${wstart}">${clock(wstart - Date.now())}</span></b>
          <span class="muted">${wstart - Date.now() > 4 * 36e5 ? " · data is slower until 4h before" : " · live"}</span></span>` : ""}
        <span class="pres-c" ${presKnown ? "" : "hidden"}>${ICON.users}<span class="num"></span><span class="muted"></span></span>
        ${rollOn() ? `<span class="sp"></span><button class="ghost rb-c" data-a="rssum" title="Roll call summary">${rollCount}/${(ours.members || []).length}<span class="rb-l"> answered</span></button>
          <button class="ghost rbtn ${myRoll ? "" : "todo"}" data-a="rollcall" title="${myRoll ? "Update your roll call" : "You haven’t answered yet"}">${ICON.roll}<span>${myRoll ? "Roll call" : "Answer roll call"}</span></button>
          <button class="ghost rbtn" data-a="merc" title="Build a merc list">${ICON.attack}<span>Merc list</span></button>` : ""}
      </div>`;
					const wbw = box.querySelector(".wbw");
					if (!sameHtml(wbw, banner || " ")) {
						wbw.innerHTML = banner;
						stripTitles(wbw);
					}
					const bdHtml = `
      ${error ? `<div class="msg err" style="padding:6px 12px">Last refresh failed: ${esc(error.message)}</div>` : ""}
      <div class="swipe-hint">swipe for more columns \u2192</div>
      <div class="tw"><table>
        <thead><tr>
          ${th("name", `Players (${(fac.members || []).length})`, "c-name")}
          ${isEnemy ? th("smart", "", "c c-act") : ""}
          ${isEnemy && dibsOn ? th("dib", "Dibber", "c-dib") : ""}
          ${COLS.map((k) => ({
						stats: () => th("est", "<span title=\"Newest spy, else average\">Stats</span>", "r c-est") + th("bsp", "BSP", "r c-bsp") + th("ffs", "FFS", "r c-ffs") + th("yata", "YATA", "r c-yata"),
						status: () => th("status", "Status", "c-st"),
						score: () => th("score", "Score", "r c-score"),
						lvl: () => th("level", "Lvl", "r c-lvl"),
						last: () => th("last", "Last", "r c-last"),
						rev: () => th("rev", `<span class="rev-h" title="Revivable">${ICON.revive}</span>`, "c c-rev"),
						roll: () => showRoll ? th("roll", "Roll call", "c c-roll") : ""
					})[k]()).join("")}
        </tr></thead>
        <tbody>${rowList.length ? "<!--ROWS-->" : `<tr><td colspan="12" class="msg">No players match.${revFilter !== "all" && revPending ? ` Still checking revive status for ${revPending} player${revPending > 1 ? "s" : ""}\u2026` : ""}</td></tr>`}</tbody>
      </table></div>`;
					const tbodyOld = bd.querySelector("tbody");
					const rebuilt = !sameHtml(bd, bdHtml) || !tbodyOld || rowList.length && !tbodyOld.querySelector("tr[data-pid]");
					if (rebuilt) {
						bd.innerHTML = bdHtml.replace("<!--ROWS-->", body);
						const tb = bd.querySelector("tbody");
						if (tb && rowList.length) [...tb.children].forEach((tr, i) => {
							if (rowList[i]) tr.dssKey = tickKey(rowList[i][1]);
						});
					} else if (rowList.length && patchRows(tbodyOld, rowList)) {
						fixSticky();
					}
					revPlan(revCandidates, fac.members, (isEnemy ? ours : enemy).members);
					mercPaint();
					travPaint();
					fsPaint();
					crPaint();
					presChanged();
					if (!presStarted && !presOff()) {
						presStarted = true;
						presConnect();
					}
					if (rebuilt) {
						const tw = bd.querySelector(".tw");
						stripTitles(box);
						fixSticky();
						const viewKey = view + "|" + filter + "|" + stFilter + "|" + [...ctryFilter].join(",") + "|" + revFilter + "|" + sortKey + "|" + sortDir + "|" + search;
						if (viewKey !== lastViewKey) {
							lastScrollTop = 0;
							lastViewKey = viewKey;
						}
						tw.scrollTop = lastScrollTop;
						tw.scrollLeft = lastScrollLeft;
						tw.classList.toggle("scrolled", tw.scrollLeft > 0);
						tw.addEventListener("scroll", () => {
							lastScrollLeft = tw.scrollLeft;
							lastScrollTop = tw.scrollTop;
							tw.classList.toggle("scrolled", tw.scrollLeft > 0);
							popRefresh();
							ttHide();
						}, { passive: true });
					}
					popRefresh();
					ttRefresh();
					tick();
				}
				const tickKey = (html) => html.replace(/(data-(?:until|since|ago)="[^"]*"[^>]*>)[^<]*/g, "$1").replace(/(data-tct[^>]*>)[^<]*/g, "$1");
				function patchRows(tbody, rowList) {
					const old = {};
					for (const tr of [...tbody.children]) {
						if (tr.dataset.pid) old[tr.dataset.pid] = tr;
						else tr.remove();
					}
					const tmp = document.createElement("tbody");
					let made = 0;
					rowList.forEach(([pid, html], i) => {
						const key = tickKey(html);
						let tr = old[pid];
						if (!tr || tr.dssKey !== key) {
							tmp.innerHTML = html;
							const fresh = tmp.firstElementChild;
							stripTitles(fresh);
							fresh.dssKey = key;
							if (tr) tr.replaceWith(fresh);
							tr = fresh;
							made++;
						}
						delete old[pid];
						if (tbody.children[i] !== tr) tbody.insertBefore(tr, tbody.children[i] || null);
					});
					for (const pid in old) old[pid].remove();
					return made;
				}
				function sameHtml(el, html) {
					const key = tickKey(html);
					if (el.dssHtml === key && el.firstElementChild) return true;
					el.dssHtml = key;
					return false;
				}
				function dibAlert(now) {
					const el = document.querySelector(`#${BOX_ID} .dwarn`);
					if (!el) return;
					let best = null;
					if (state && state.user && dibWarnMs() > 0) {
						const me = state.user.user_id;
						for (const d of state.dibs || []) {
							if (!d || d.dib_window_resolved === false) continue;
							const assist = d.player_id !== me;
							if (assist && !(d.assist_player_ids || []).includes(me)) continue;
							const m = memberIdx[d.foe_id];
							if (!m) continue;
							let left;
							if (m.status_state === "Okay") left = 0;
							else if (m.status_state === "Hospital") left = Math.max(0, Date.parse(m.status_until) - now);
							else continue;
							if (left <= dibWarnMs() && (!best || left < best.left || left === best.left && best.assist && !assist)) best = {
								m,
								left,
								assist
							};
						}
					}
					if (!best) {
						if (!el.hidden) el.hidden = true;
						return;
					}
					const out = best.left <= 0;
					const html = `${best.assist ? ICON.assist : ICON.attack}${best.assist ? "<i>Assist</i>" : ""}<b>${esc(best.m.name)}</b><span>${out ? "available" : `out in <span class="num">${clock(best.left)}</span>`}</span>`;
					if (el.dssLast !== html) {
						el.innerHTML = html;
						el.dssLast = html;
					}
					el.href = `https://www.torn.com/page.php?sid=attack&user2ID=${best.m.player_id}`;
					if (el.target !== ATK_TARGET) el.target = ATK_TARGET;
					el.classList.toggle("out", out);
					el.classList.toggle("asst", !!best.assist);
					el.hidden = false;
				}
				function tick() {
					const box = document.getElementById(BOX_ID);
					if (!box) return;
					const now = Date.now();
					box.querySelectorAll("[data-until]").forEach((el) => {
						const t = clock(+el.dataset.until - now);
						if (el.textContent !== t) el.textContent = t;
					});
					box.querySelectorAll("tr.mine .hchip, tr.assisting .hchip").forEach((ch) => {
						const u = ch.querySelector("[data-until]"), left = u ? +u.dataset.until - now : Infinity;
						ch.classList.toggle("soon", left > 0 && left <= dibWarnMs());
					});
					dibAlert(now);
					if (now - (tick.lastScore || 0) > 3e3) {
						tick.lastScore = now;
						if (domScores()) render();
					}
					atkBar();
					if (atkT && now - atkT > ATK_STALE_MS && Object.keys(atkNow).length) {
						atkNow = {};
						atkBar();
					}
					fitOverlays();
					tornTick();
					if (now - (tick.lastFlip || 0) > 900 && [...box.querySelectorAll(".hchip [data-until]")].some((el) => +el.dataset.until <= now)) {
						tick.lastFlip = now;
						render();
					}
					if (now - (tick.lastAgo || 0) > 15e3) {
						tick.lastAgo = now;
						box.querySelectorAll("[data-ago]").forEach((el) => {
							const v = +el.dataset.ago, t = v ? ago(new Date(v).toISOString()) : "?";
							if (el.textContent !== t) el.textContent = t;
						});
					}
					box.querySelectorAll("[data-since]").forEach((el) => {
						const t = clock(now - +el.dataset.since);
						if (el.textContent !== t) el.textContent = t;
					});
					box.querySelectorAll("[data-tct]").forEach((el) => {
						const t = tct();
						if (el.textContent !== t) el.textContent = t;
					});
					box.querySelectorAll("[data-chainend]").forEach((el) => {
						const left = (+el.dataset.chainend - now) / 1e3;
						el.classList.toggle("crit", left < 60);
						el.classList.toggle("warn", left >= 60 && left < 150);
					});
					const lvb = box.querySelector(".lvb");
					if (lvb) {
						if (lvb.hidden === liveOn) lvb.hidden = !liveOn;
						const tip = `Live statuses from Torn\n${liveWhy || "Tyronic data looks stale"}`;
						if (liveOn && !noHover() && lvb.dataset.tt !== tip) lvb.dataset.tt = tip;
					}
					const age = box.querySelector(".age");
					if (age) {
						const since = lastAsked || lastFetch;
						let secs = since ? Math.max(0, Math.floor((now - since) / 1e3)) : null;
						if (secs != null && busy && now - busyAt < 15e3) secs = Math.min(secs, Math.round(pollMs() / 1e3));
						const label = secs == null ? "" : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
						if (age.textContent !== label) age.textContent = label;
						age.classList.toggle("busy", busy);
						const at = busy ? "Updating…" : "Last update";
						if (!noHover() && age.dataset.tt !== at) age.dataset.tt = at;
						age.classList.toggle("bad", !!error || secs != null && secs > 60);
					}
					if (popId != null) popRefresh();
				}
				function apply() {
					let wrap = findWrap();
					if (!wrap) return;
					const tooBig = (el) => el.contains(document.getElementById(BOX_ID)) || !!el.querySelector("[class*=\"rankBox___\"], [class*=\"warListItem___\"], .faction-tabs, #factions");
					if (tooBig(wrap)) {
						wrap.classList.remove(HIDE);
						if (!apply.warned) {
							apply.warned = true;
							console.warn("[Tyronic panel] war list match is a page container - not hiding it", wrap.className);
						}
						return;
					}
					document.querySelectorAll(`.${HIDE}`).forEach((el) => {
						if (el !== wrap && !el.closest(`#${BOX_ID}`) && tooBig(el)) el.classList.remove(HIDE);
					});
					wrap.classList.toggle(HIDE, !showOriginal);
					const graphBtn = document.querySelector("[class*=\"graphIcon___\"]");
					if (graphBtn) graphBtn.classList.toggle(HIDE, !showOriginal);
					const ttFilter = document.getElementById("rankedWarFilter");
					if (ttFilter) ttFilter.classList.toggle(HIDE, !showOriginal);
					let box = document.getElementById(BOX_ID);
					if (!box) {
						box = buildBox();
						wrap.before(box);
						render();
						refresh(true);
					} else if (box.nextElementSibling !== wrap) {
						wrap.before(box);
					}
					box.querySelector(".hd").classList.toggle(HIDE, showOriginal);
					box.querySelector(".bd").classList.toggle(HIDE, showOriginal);
					box.classList.toggle("orig", showOriginal);
					const lbl = box.querySelector("[data-a=orig] .lbl-orig"), want = showOriginal ? "Tyronic view" : "Torn list";
					if (lbl.textContent !== want) lbl.textContent = want;
				}
				const AUTO_EXPAND_PAUSE = 300;
				const WAR_TRUST_MS = 12e4;
				let autoExpandDone = false;
				const toMs = (v) => {
					if (v == null || v === "") return 0;
					if (typeof v === "number" || /^\d+$/.test(String(v))) {
						const n = +v;
						return n > 0xe8d4a51000 ? n : n * 1e3;
					}
					const t = Date.parse(v);
					return isFinite(t) && t > 0 ? t : 0;
				};
				function saveWar(id, start, end, extra) {
					id = String(id);
					const prev = GM_getValue("warInfo", null), same = prev && prev.id === id;
					GM_setValue("warInfo", Object.assign({
						id,
						start: start || null,
						end: end || null,
						t: Date.now()
					}, same && prev.ended ? { ended: true } : {}, extra || {}));
				}
				function rememberWar() {
					const wd = state && state.wardata;
					if (wd && wd.war_id) saveWar(wd.war_id, wd.warstart, wd.warend);
				}
				function warPhase(w) {
					if (w.ended) return "ended";
					const now = Date.now(), s = toMs(w.start), e = toMs(w.end);
					if (e && e <= now) return "ended";
					if (!s || s > now) return "pending";
					return "live";
				}
				async function tornWarOver(warId) {
					const key = GM_getValue("tornKey", "");
					if (!key) return null;
					revStamps.push(Date.now());
					try {
						const res = await req("GET", "https://api.torn.com/v2/faction/wars?comment=dss-ty", {
							accept: "application/json",
							Authorization: `ApiKey ${key}`
						});
						if (!res || res.error || !res.wars) return null;
						const rw = res.wars.ranked;
						if (!rw) return true;
						if (rw.war_id != null && String(rw.war_id) !== String(warId)) return true;
						const end = toMs(rw.end);
						return !!rw.winner || end > 0 && end <= Date.now();
					} catch (_) {
						return null;
					}
				}
				function autoExpand() {
					if (autoExpandDone) return;
					if (findWrap()) {
						autoExpandDone = true;
						return;
					}
					const rb = document.querySelector("[class*=\"rankBox___\"][data-warid]");
					const li = rb && (rb.closest("li[class*=\"warListItem___\"]") || rb.closest("li"));
					if (!li) return;
					autoExpandDone = true;
					const warId = String(rb.dataset.warid), seen = Date.now();
					const click = () => setTimeout(() => {
						if (!findWrap()) li.click();
					}, Math.max(0, seen + AUTO_EXPAND_PAUSE - Date.now()));
					const known = GM_getValue("warInfo", null), mine = known && known.id === warId;
					if (mine) {
						const ph = warPhase(known);
						if (ph === "ended") return;
						if (ph === "pending" && toMs(known.start)) return;
					}
					if (!GM_getValue("tornKey", "")) return;
					(async () => {
						let live = mine && warPhase(known) === "live" && Date.now() - (known.t || 0) < WAR_TRUST_MS;
						if (!live) {
							const st = await rpc("getstate", {});
							if (!state) {
								state = st;
								lastFetch = lastAsked = Date.now();
							}
							const wd = st && st.wardata;
							if (!wd || String(wd.war_id) !== warId) return;
							saveWar(warId, wd.warstart, wd.warend);
							live = warPhase(GM_getValue("warInfo", {})) === "live";
						}
						if (!live) return;
						const over = await tornWarOver(warId);
						if (over === true) {
							saveWar(warId, known && known.start, known && known.end, { ended: true });
							return;
						}
						click();
					})().catch(() => {});
				}
				const safeApply = () => {
					try {
						autoExpand();
					} catch (_) {}
					try {
						apply();
					} catch (e) {
						console.error("[Tyronic panel] could not attach to the war page", e);
					}
				};
				let pollTimer = null;
				function schedulePoll() {
					clearTimeout(pollTimer);
					pollTimer = setTimeout(() => {
						refresh(false);
						schedulePoll();
					}, pollMs());
				}
				function start() {
					if (!document.body) return setTimeout(start, 50);
					let queued = false;
					new MutationObserver((muts) => {
						if (queued) return;
						const box = document.getElementById(BOX_ID);
						if (box && muts.every((m) => box.contains(m.target))) return;
						queued = true;
						setTimeout(() => {
							queued = false;
							safeApply();
						}, 50);
					}).observe(document.body, {
						childList: true,
						subtree: true
					});
					setInterval(tick, 1e3);
					setInterval(safeApply, 2e3);
					schedulePoll();
					setTimeout(() => liveKick(0), 8e3);
					let lastBack = 0;
					const onBack = () => {
						if (document.hidden || Date.now() - lastBack < 5e3) return;
						lastBack = Date.now();
						refresh(false);
						liveLastProbe = 0;
						liveKick(0);
						if (!presTimer && !presLive && !lpToken && presStarted) presConnect();
					};
					document.addEventListener("visibilitychange", onBack);
					window.addEventListener("focus", onBack);
					safeApply();
				}
				if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
				else start();
			})();
		}
	});

// src/modules/attack-enhancer/guide.html?raw
	var guide_default$14 = "\n    <div class=\"dss-guide-card\">\n        <div class=\"dss-guide-card-header\">War Page - Online Visibility</div>\n        <div class=\"dss-guide-card-body\">\n            <p>On faction war pages, a collapsible <strong>Online Status</strong> bar appears showing online/idle/offline counts for both sides. Click <strong>Sort</strong> to reorder members by online status.</p>\n            <p>Configure the <strong>Mobilisation Alert</strong> to get a warning when enemy online % exceeds your threshold.</p>\n        </div>\n    </div>\n    <div class=\"dss-guide-card\">\n        <div class=\"dss-guide-card-header\">Attack Page - Button Positioning</div>\n        <div class=\"dss-guide-card-body\">\n            <p>Toggle <strong>Fight</strong> on/off to reposition attack buttons over your chosen weapon slot (Primary/Secondary/Melee). Select a <strong>Type</strong> to show only that button (Leave/Mug/Hosp/Arrest) or All.</p>\n        </div>\n    </div>\n    <div class=\"dss-guide-card\">\n        <div class=\"dss-guide-card-header\">Attack Page - Execute Alert</div>\n        <div class=\"dss-guide-card-body\">\n            <p>Toggle <strong>Execute</strong> on and set a <strong>%</strong> threshold. When the target's health drops below that percentage, the Secondary weapon slot highlights red as a visual cue to finish the fight.</p>\n        </div>\n    </div>\n    <div class=\"dss-guide-card\">\n        <div class=\"dss-guide-card-header\">Mobile HUD</div>\n        <div class=\"dss-guide-card-body\">\n            <p>On mobile attack pages, an extra HUD row shows the number of <strong>Attackers</strong> in the loader, the enemy's <strong>Loadout</strong> with weapon bonuses highlighted (Parry and Bloodlust flagged as dangers), and active <strong>Effects</strong> on you.</p>\n            <p>Vision effects like <strong>Smoked</strong> and <strong>Blinded</strong> are highlighted in red. DOT effects like <strong>Bleeding</strong> and <strong>Burning</strong> appear in orange.</p>\n        </div>\n    </div>\n    <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Attack Page - Hospital Timer</div>\n            <div class=\"dss-guide-card-body\">\n            <p>When your target is in hospital, a <strong>countdown timer</strong> appears in the attack page header showing their remaining hospital time. A <strong>Reload</strong> button appears alongside it.</p>\n                  <p>At <strong>10 seconds</strong> remaining, the timer flashes green. If the target leaves hospital early, the timer changes to <strong>Target out of Hospital!</strong></p>\n              </div>\n          </div>\n          <div class=\"dss-guide-card\">\n              <div class=\"dss-guide-card-header\">Profile Page - Attack Button Override</div>\n              <div class=\"dss-guide-card-body\">\n                  <p>When viewing the profile of a player who is in hospital, the greyed-out <strong>Attack</strong> button is re-enabled with a blue glow (hover tooltip: <strong>\"Bypass — Click to Attack\"</strong>) so you can click through to the attack page anyway.</p>\n              </div>\n          </div>\n       <div class=\"dss-guide-card\">\n        <div class=\"dss-guide-card-header\">War Page - Hospital Timers</div>\n        <div class=\"dss-guide-card-body\">\n            <p>On faction war pages, <strong>Hospital</strong> in the status column is replaced with a live countdown (red, turning <strong>green</strong> in the last 5 minutes). Revives and status changes are picked up automatically.</p>\n            <p>Uses two or three API calls per refresh (not one per player), only while the tab is focused and someone is in hospital. <strong>Sort</strong> still works and orders hospitalised players by who gets out first.</p>\n        </div>\n    </div>\n        <div class=\"dss-guide-card\">\n        <div class=\"dss-guide-card-header\">War Page - Hospital Timers</div>\n        <div class=\"dss-guide-card-body\">\n            <p>On faction war pages, <strong>Hospital</strong> in the status column is replaced with a live countdown (red, turning <strong>green</strong> in the last 5 minutes). Revives and status changes are picked up automatically.</p>\n            <p>Uses two or three API calls per refresh (not one per player), only while the tab is focused and someone is in hospital. <strong>Sort</strong> still works and orders hospitalised players by who gets out first.</p>\n            <label style=\"display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px;\">\n                <input type=\"checkbox\" id=\"dss-ae-hosp-timers\">\n                <span>Enable hospital timers <span style=\"color:#777;\">(turn off if you use CAT)</span></span>\n            </label>\n            <div id=\"dss-ae-hosp-timers-status\" style=\"font-size:11px;color:#4caf50;min-height:14px;margin-top:4px;\"></div>\n        </div>\n    </div>\n\n\n    ";

// src/modules/attack-enhancer/index.js
	registerModule("attack-enhancer", {
		name: "Attack Enhancer",
		version: "1.2",
		description: "Attack page enhancer: Custom button positioning, execute % alert, mobile HUD (temp effects, attackers), current hospital time. Profile Page: Allows clicking attack when in hospital. Faction War page: Adds online status overview.",
		pages: [
			"/loader.php",
			"/loader2.php",
			"/page.php?sid=attack",
			"/factions.php",
			"/profiles.php",
			"/city.php"
		],
		guide: guide_default$14,
		init() {
			"use strict";
			const HT_ENABLED_KEY = "dss_ae_hosp_timers";
			const htEnabled = () => GM_getValue(HT_ENABLED_KEY, true) !== false;
			UI.wireGuideField("dss-ae-hosp-timers", () => {
				const cb = document.getElementById("dss-ae-hosp-timers");
				if (!cb || cb.dataset.wired) return;
				cb.dataset.wired = "1";
				cb.checked = htEnabled();
				cb.addEventListener("change", () => {
					GM_setValue(HT_ENABLED_KEY, cb.checked);
					const s = document.getElementById("dss-ae-hosp-timers-status");
					if (s) s.textContent = cb.checked ? "✅ Hospital timers on" : "✅ Hospital timers off";
				});
			});
			/** Build a CSS attribute selector for a Torn CSS-module class. */
			const cls = (base) => `[class*="${base}___"]`;
			/** querySelector shorthand using a Torn class base name. */
			const qc = (base, root = document) => root.querySelector(cls(base));
			/** querySelectorAll shorthand. */
			const qca = (base, root = document) => [...root.querySelectorAll(cls(base))];
			const url = window.location.href;
			const isAttackPage = /loader2?\.php\?sid=(attack|getInAttack)/.test(url) || /page\.php\?sid=attack/.test(url);
			const isFactionPage = url.includes("factions.php");
			const isMobile = () => window.innerWidth < 700;
			let isTabFocused = document.hasFocus();
			const setFocus = (v) => {
				isTabFocused = v;
			};
			window.addEventListener("focus", () => setFocus(true));
			window.addEventListener("blur", () => setFocus(false));
			document.addEventListener("visibilitychange", () => {
				setFocus(document.visibilityState === "visible" && document.hasFocus());
			});
			if (isFactionPage) {
				const STATUS_WRAP_ID = "tc-online-status-wrap";
				const STATUS_BAR_ID = "tc-online-status-bar";
				const isOnWarPage = () => new URLSearchParams(window.location.search).get("step") === "your" && window.location.hash.includes("/war/");
				let warStatusVisible = localStorage.getItem("tc-war-status-visible") !== "false";
				let mobThreshold = Number(localStorage.getItem("tc-mob-threshold")) || 40;
				let mobAlertEnabled = localStorage.getItem("tc-mob-alert-enabled") !== "false";
				let mobAlertDismissed = false;
				let mobCooldownUntil = 0;
				let mobCooldownMins = Number(localStorage.getItem("tc-mob-cooldown-mins")) || 10;
				const getMobCooldownMs = () => mobCooldownMins * 60 * 1e3;
				window.addEventListener("blur", closeMobAlert);
				document.addEventListener("visibilitychange", () => {
					if (document.visibilityState !== "visible" || !document.hasFocus()) closeMobAlert();
				});
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
					let html = "";
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
					for (const tm of document.querySelectorAll(".tab-menu-cont")) {
						if ((" " + tm.className + " ").includes(" " + side + " ")) return tm;
					}
					return null;
				}
				function countStatusesInContainer(container) {
					if (!container) return {
						online: 0,
						idle: 0,
						offline: 0
					};
					let online = 0, idle = 0, offline = 0;
					container.querySelectorAll("[class*=\"userStatusWrap___\"][aria-label]").forEach((el) => {
						const label = (el.getAttribute("aria-label") || "").toLowerCase();
						if (label.endsWith("is online")) online++;
						else if (label.endsWith("is idle")) idle++;
						else if (label.endsWith("is offline")) offline++;
					});
					return {
						online,
						idle,
						offline
					};
				}
				function showMobAlert(pct, counts) {
					if (!isTabFocused) return;
					if (document.getElementById("tc-mob-dialog")) return;
					const dialog = document.createElement("div");
					dialog.id = "tc-mob-dialog";
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
					dialog.querySelector(".tc-mob-close").addEventListener("click", dismiss);
					dialog.querySelector(".tc-mob-btn").addEventListener("click", dismiss);
				}
				function closeMobAlert() {
					const d = document.getElementById("tc-mob-dialog");
					if (d) d.remove();
				}
				function checkMobilisation(leftCounts) {
					if (!mobAlertEnabled) {
						closeMobAlert();
						return;
					}
					const total = leftCounts.online + leftCounts.idle + leftCounts.offline;
					if (total === 0) return;
					const pct = Math.round(leftCounts.online / total * 100);
					if (pct >= mobThreshold) {
						if (!mobAlertDismissed || Date.now() > mobCooldownUntil) {
							mobAlertDismissed = false;
							showMobAlert(pct, leftCounts);
						}
						const statPct = document.querySelector("#tc-mob-dialog .tc-mob-stat-pct");
						const statLabel = document.querySelector("#tc-mob-dialog .tc-mob-stat-label");
						if (statPct) statPct.textContent = pct + "%";
						if (statLabel) statLabel.innerHTML = `online<br>(${leftCounts.online} of ${total})`;
					} else {
						closeMobAlert();
						if (Date.now() > mobCooldownUntil) {
							mobAlertDismissed = false;
						}
					}
				}
				function toggleStatusBar() {
					warStatusVisible = !warStatusVisible;
					localStorage.setItem("tc-war-status-visible", warStatusVisible);
					const bar = document.getElementById(STATUS_BAR_ID);
					const arrow = document.getElementById("tc-status-header-arrow");
					const configRow = document.getElementById("tc-mob-config-row");
					const cls = warStatusVisible ? "tc-expanded" : "tc-collapsed";
					if (bar) bar.className = cls;
					if (configRow) configRow.className = cls;
					if (arrow) arrow.classList.toggle("collapsed", !warStatusVisible);
				}
				const sortState = {
					left: localStorage.getItem("tc-sort-left") === "true",
					right: localStorage.getItem("tc-sort-right") === "true"
				};
				const originalOrder = {
					left: null,
					right: null
				};
				const statusSort = {
					left: localStorage.getItem("tc-status-sort-left") === "true",
					right: localStorage.getItem("tc-status-sort-right") === "true"
				};
				function statusRank(row) {
					const t = statusTextOf(htStatusCell(row)).toLowerCase();
					if (t === "okay") return 0;
					if (t.includes("hospital")) return 1;
					return 2;
				}
				function statusCompare(a, b) {
					const ra = statusRank(a), rb = statusRank(b);
					if (ra !== rb) return ra - rb;
					if (ra === 1) {
						const au = hospUntil.get(htRowId(a) || "") || Infinity;
						const bu = hospUntil.get(htRowId(b) || "") || Infinity;
						return au - bu;
					}
					return 0;
				}
				function onlineCompare(a, b) {
					const aOnline = getOnlinePriority(getRowOnlineState(a));
					const bOnline = getOnlinePriority(getRowOnlineState(b));
					if (aOnline !== bOnline) return aOnline - bOnline;
					const aStatus = getStatusPriority(statusTextOf(htStatusCell(a)));
					const bStatus = getStatusPriority(statusTextOf(htStatusCell(b)));
					if (aStatus !== bStatus) return aStatus - bStatus;
					if (aStatus === 3) {
						const au = hospUntil.get(htRowId(a) || "") || Infinity;
						const bu = hospUntil.get(htRowId(b) || "") || Infinity;
						return au - bu;
					}
					return 0;
				}
				function statusHeaderFor(side) {
					return findTabMenuForSide(side)?.querySelector(".white-grad .status") || null;
				}
				function markStatusHeaders() {
					["left", "right"].forEach((side) => {
						statusHeaderFor(side)?.classList.toggle("dss-status-sorted", !!statusSort[side]);
					});
				}
				function syncSortBtn(side) {
					const btn = document.querySelector(`#tc-status-${side} .tc-sort-btn`);
					if (!btn) return;
					btn.classList.toggle("tc-sort-active", !!sortState[side]);
					btn.textContent = sortState[side] ? "✔ Sorted" : "Sort";
				}
				document.addEventListener("click", (e) => {
					if (!isOnWarPage()) return;
					const hdr = e.target.closest(".tab-menu-cont .white-grad .status");
					if (!hdr) return;
					const tm = hdr.closest(".tab-menu-cont");
					const side = tm.classList.contains("left") ? "left" : tm.classList.contains("right") ? "right" : null;
					if (!side) return;
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();
					statusSort[side] = !statusSort[side];
					localStorage.setItem(`tc-status-sort-${side}`, statusSort[side]);
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
					const el = row.querySelector("[class*=\"userStatusWrap___\"][aria-label]");
					const label = (el?.getAttribute("aria-label") || "").toLowerCase();
					if (label.endsWith("is online")) return "online";
					if (label.endsWith("is idle")) return "idle";
					if (label.endsWith("is offline")) return "offline";
					return "";
				}
				function getOnlinePriority(alt) {
					if (alt === "online") return 0;
					if (alt === "idle") return 1;
					return 2;
				}
				function getStatusPriority(text) {
					const t = (text || "").toLowerCase().trim();
					if (t === "okay") return 0;
					if (t === "abroad") return 1;
					if (t.includes("traveling") || t.includes("travelling")) return 2;
					if (t === "hospital") return 3;
					if (t === "jail") return 4;
					if (t === "federal") return 5;
					return 6;
				}
				function sortMemberList(side) {
					const menu = findTabMenuForSide(side);
					if (!menu) return;
					const ul = menu.querySelector("ul.members-list");
					if (!ul) return;
					const lis = [...ul.children];
					if (lis.length === 0) return;
					if (!originalOrder[side] || originalOrder[side].length !== lis.length) {
						originalOrder[side] = lis.map((li) => li);
					}
					const compare = statusSort[side] ? statusCompare : sortState[side] ? onlineCompare : null;
					if (compare) {
						lis.sort(compare);
						if (lis.some((li, i) => ul.children[i] !== li)) lis.forEach((li) => ul.appendChild(li));
					} else if (originalOrder[side]) {
						originalOrder[side].forEach((li) => ul.appendChild(li));
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
					btn.classList.toggle("tc-sort-active", sortState[side]);
					btn.textContent = sortState[side] ? "✔ Sorted" : "Sort";
					sortMemberList(side);
				}
				function reapplySort() {
					["left", "right"].forEach((side) => {
						if (sortState[side] || statusSort[side]) sortMemberList(side);
					});
					markStatusHeaders();
				}
				function createStatusBar() {
					if (document.getElementById(STATUS_WRAP_ID)) return;
					if (!isOnWarPage()) return;
					const factionNames = document.querySelector(".faction-names");
					if (!factionNames) return;
					const wrap = document.createElement("div");
					wrap.id = STATUS_WRAP_ID;
					const header = document.createElement("div");
					header.id = "tc-status-header";
					header.innerHTML = `<span id="tc-status-header-arrow" class="${warStatusVisible ? "" : "collapsed"}">\u25BC</span><span id="tc-status-header-label">Online Status</span>`;
					header.addEventListener("click", toggleStatusBar);
					wrap.appendChild(header);
					const bar = document.createElement("div");
					bar.id = STATUS_BAR_ID;
					bar.className = warStatusVisible ? "tc-expanded" : "tc-collapsed";
					const leftDiv = document.createElement("div");
					leftDiv.id = "tc-status-left";
					leftDiv.className = "tc-status-side";
					const leftCounts = document.createElement("span");
					leftCounts.id = "tc-counts-left";
					leftDiv.appendChild(leftCounts);
					const leftSortBtn = document.createElement("button");
					leftSortBtn.className = "tc-sort-btn" + (sortState.left ? " tc-sort-active" : "");
					leftSortBtn.textContent = sortState.left ? "✔ Sorted" : "Sort";
					leftSortBtn.title = "Sort by online + okay status";
					leftSortBtn.addEventListener("click", () => toggleSort("left", leftSortBtn));
					leftDiv.appendChild(leftSortBtn);
					const rightDiv = document.createElement("div");
					rightDiv.id = "tc-status-right";
					rightDiv.className = "tc-status-side";
					const rightCounts = document.createElement("span");
					rightCounts.id = "tc-counts-right";
					rightDiv.appendChild(rightCounts);
					const rightSortBtn = document.createElement("button");
					rightSortBtn.className = "tc-sort-btn" + (sortState.right ? " tc-sort-active" : "");
					rightSortBtn.textContent = sortState.right ? "✔ Sorted" : "Sort";
					rightSortBtn.title = "Sort by online + okay status";
					rightSortBtn.addEventListener("click", () => toggleSort("right", rightSortBtn));
					rightDiv.appendChild(rightSortBtn);
					bar.appendChild(leftDiv);
					bar.appendChild(rightDiv);
					wrap.appendChild(bar);
					const configWrap = document.createElement("div");
					configWrap.id = "tc-mob-config-row";
					configWrap.className = warStatusVisible ? "tc-expanded" : "tc-collapsed";
					const mobRow1 = document.createElement("div");
					mobRow1.className = "tc-mob-row";
					const mobLabel = document.createElement("span");
					mobLabel.className = "tc-mob-config-label";
					mobLabel.textContent = "Mobilisation Alert";
					mobRow1.appendChild(mobLabel);
					mobRow1.appendChild(Object.assign(document.createElement("div"), { className: "tc-mob-vdivider" }));
					const mobSettings = document.createElement("div");
					mobSettings.className = "tc-mob-settings";
					mobSettings.style.setProperty("flex", "1", "important");
					const settingsRow1 = document.createElement("div");
					settingsRow1.className = "tc-mob-settings-row";
					const mobToggle = document.createElement("button");
					mobToggle.id = "tc-mob-toggle";
					mobToggle.className = mobAlertEnabled ? "active" : "";
					mobToggle.innerHTML = mobAlertEnabled ? "●<span style=\"margin-left:2px\">On</span>" : "○<span style=\"margin-left:2px\">Off</span>";
					mobToggle.title = "Toggle mobilisation alert";
					mobToggle.addEventListener("click", () => {
						mobAlertEnabled = !mobAlertEnabled;
						localStorage.setItem("tc-mob-alert-enabled", mobAlertEnabled);
						mobToggle.className = mobAlertEnabled ? "active" : "";
						mobToggle.innerHTML = mobAlertEnabled ? "●<span style=\"margin-left:2px\">On</span>" : "○<span style=\"margin-left:2px\">Off</span>";
						if (!mobAlertEnabled) closeMobAlert();
					});
					settingsRow1.appendChild(mobToggle);
					settingsRow1.appendChild(Object.assign(document.createElement("div"), { className: "tc-mob-vdivider tc-mob-vdivider-inner" }));
					const threshGroup = document.createElement("div");
					threshGroup.className = "tc-mob-group";
					threshGroup.innerHTML = "<span class=\"tc-mob-config-label\">Threshold</span>";
					const mobInput = document.createElement("input");
					mobInput.id = "tc-mob-input";
					mobInput.type = "number";
					mobInput.min = "1";
					mobInput.max = "100";
					mobInput.value = mobThreshold;
					mobInput.title = "Enemy online % threshold for mobilisation alert";
					mobInput.addEventListener("change", () => {
						const v = Math.min(100, Math.max(1, Number(mobInput.value)));
						mobInput.value = v;
						mobThreshold = v;
						localStorage.setItem("tc-mob-threshold", v);
					});
					mobInput.addEventListener("keydown", (e) => e.stopPropagation());
					threshGroup.appendChild(mobInput);
					threshGroup.appendChild(Object.assign(document.createElement("span"), {
						className: "tc-mob-pct-label",
						textContent: "%"
					}));
					settingsRow1.appendChild(threshGroup);
					mobSettings.appendChild(settingsRow1);
					const settingsRow2 = document.createElement("div");
					settingsRow2.className = "tc-mob-settings-row";
					settingsRow2.appendChild(Object.assign(document.createElement("div"), { className: "tc-mob-vdivider tc-mob-vdivider-inner" }));
					const cdGroup = document.createElement("div");
					cdGroup.className = "tc-mob-group";
					cdGroup.innerHTML = "<span class=\"tc-mob-config-label\">Cooldown</span>";
					const cdInput = document.createElement("input");
					cdInput.id = "tc-mob-cd-input";
					cdInput.className = "tc-mob-cd-input";
					cdInput.type = "number";
					cdInput.min = "1";
					cdInput.max = "120";
					cdInput.value = mobCooldownMins;
					cdInput.title = "Minutes before the alert can trigger again after dismissing";
					cdInput.addEventListener("change", () => {
						const v = Math.min(120, Math.max(1, Number(cdInput.value)));
						cdInput.value = v;
						mobCooldownMins = v;
						localStorage.setItem("tc-mob-cooldown-mins", v);
					});
					cdInput.addEventListener("keydown", (e) => e.stopPropagation());
					cdGroup.appendChild(cdInput);
					cdGroup.appendChild(Object.assign(document.createElement("span"), {
						className: "tc-mob-pct-label",
						textContent: "min"
					}));
					settingsRow2.appendChild(cdGroup);
					mobSettings.appendChild(settingsRow2);
					mobRow1.appendChild(mobSettings);
					configWrap.appendChild(mobRow1);
					wrap.appendChild(configWrap);
					factionNames.parentNode.insertBefore(wrap, factionNames.nextSibling);
				}
				const lastCounts = {
					left: null,
					right: null
				};
				function updateStatusBar() {
					if (!isTabFocused || !isOnWarPage()) return;
					createStatusBar();
					let leftCounts = null;
					["left", "right"].forEach((side) => {
						const menu = findTabMenuForSide(side);
						const list = menu ? menu.querySelector("ul.members-list") || menu : null;
						const counts = countStatusesInContainer(list);
						if (side === "left") leftCounts = counts;
						const el = document.getElementById(side === "left" ? "tc-counts-left" : "tc-counts-right");
						if (!el) return;
						const prev = lastCounts[side];
						if (prev && prev.online === counts.online && prev.idle === counts.idle && prev.offline === counts.offline) return;
						el.innerHTML = formatCountHTML(counts);
						el.parentElement.title = `${counts.online} online, ${counts.idle} idle, ${counts.offline} offline`;
						lastCounts[side] = { ...counts };
					});
					if (leftCounts) checkMobilisation(leftCounts);
					reapplySort();
				}
				const HT_REFRESH_MS = 3e4;
				const HT_MIN_GAP_MS = 1e4;
				const hospUntil = new Map();
				let htFactionIds = null;
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
					return row.querySelector("div.status[class*=\"status___\"]") || row.querySelector("div.status");
				}
				function htRowId(row) {
					const m = (row.querySelector("a[href*=\"XID=\"]")?.getAttribute("href") || "").match(/XID=(\d+)/);
					return m ? m[1] : null;
				}
				function statusTextOf(cell) {
					if (!cell) return "";
					let t = "";
					cell.childNodes.forEach((n) => {
						if (n.nodeType === 1 && n.classList.contains("dss-ht")) return;
						t += n.textContent;
					});
					return t.trim();
				}
				function htFormat(secs) {
					const h = Math.floor(secs / 3600);
					const m = Math.floor(secs % 3600 / 60);
					const s = Math.floor(secs % 60);
					return [
						h,
						m,
						s
					].map((v) => String(v).padStart(2, "0")).join(":");
				}
				async function htResolveFactions(key) {
					if (htFactionIds) return htFactionIds;
					const ids = new Set();
					try {
						const res = await fetch(`${API_BASE}/faction/wars`, { headers: tornAuth(key) });
						const data = await res.json();
						const wars = data?.wars || {};
						[
							"ranked",
							"raids",
							"territory"
						].forEach((k) => {
							const w = wars[k];
							const list = Array.isArray(w) ? w : w ? [w] : [];
							list.forEach((x) => (x?.factions || []).forEach((f) => {
								if (f?.id) ids.add(String(f.id));
							}));
						});
					} catch (_) {}
					if (!ids.size) {
						document.querySelectorAll("a[href*=\"factions.php?step=profile\"][href*=\"ID=\"]").forEach((a) => {
							const m = (a.getAttribute("href") || "").match(/[?&]ID=(\d+)/);
							if (m) ids.add(m[1]);
						});
						const own = Storage.getSettings().myFactionId;
						if (own) ids.add(String(own));
					}
					if (ids.size) htFactionIds = [...ids];
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
								const list = Array.isArray(data?.members) ? data.members : Object.entries(data?.members || {}).map(([id, m]) => ({
									id: Number(id),
									...m
								}));
								list.forEach((m) => {
									const st = m?.status;
									if (st?.state === "Hospital" && st.until) hospUntil.set(String(m.id), st.until);
									else hospUntil.delete(String(m.id));
								});
							} catch (_) {}
						}
					} finally {
						htFetching = false;
					}
					htRender();
				}
				function htClear(cell) {
					cell.querySelector(":scope > .dss-ht")?.remove();
					cell.classList.remove("dss-ht-on");
				}
				function htRender() {
					if (!htEnabled()) {
						document.querySelectorAll("div.status.dss-ht-on").forEach(htClear);
						return;
					}
					if (!isTabFocused || !isOnWarPage()) return;
					const nowS = Date.now() / 1e3;
					let anyHosp = false, needEarly = false;
					document.querySelectorAll("li.your, li.enemy").forEach((row) => {
						const cell = htStatusCell(row);
						if (!cell) return;
						if (!/hospital/i.test(statusTextOf(cell))) {
							htClear(cell);
							return;
						}
						anyHosp = true;
						const id = htRowId(row);
						const until = id ? hospUntil.get(id) : null;
						if (!until) {
							htClear(cell);
							needEarly = true;
							return;
						}
						const rem = Math.max(0, Math.floor(until - nowS));
						if (rem === 0) needEarly = true;
						let span = cell.querySelector(":scope > .dss-ht");
						if (!span) {
							span = document.createElement("span");
							span.className = "dss-ht";
							cell.appendChild(span);
						}
						cell.classList.add("dss-ht-on");
						const txt = htFormat(rem);
						if (span.textContent !== txt) span.textContent = txt;
						span.classList.toggle("dss-ht-soon", rem <= 300);
					});
					if (needEarly) htRefresh(true);
					else if (anyHosp) htRefresh(false);
				}
				setInterval(htRender, 1e3);
				window.addEventListener("hashchange", () => {
					htFactionIds = null;
				});
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
				window.addEventListener("hashchange", () => {
					if (isOnWarPage()) startWarStarter();
					else closeMobAlert();
				});
			}
			if (!isAttackPage && !url.includes("profiles.php")) return;
			const params = new URLSearchParams(window.location.search);
			const userID = params.get("user2ID");
			if (isAttackPage) {
				let settingsVisible = localStorage.getItem("tae-settings-visible") !== "false";
				let slot = Number(localStorage.getItem("torn-attack-slot")) || 1;
				let attackType = localStorage.getItem("torn-attack-type") !== null ? Number(localStorage.getItem("torn-attack-type")) : 1;
				let healthThreshold = localStorage.getItem("torn-health-threshold") !== null ? Number(localStorage.getItem("torn-health-threshold")) : 20;
				let executeEnabled = localStorage.getItem("torn-execute-enabled") === "true";
				let slotEnabled = localStorage.getItem("torn-slot-enabled") !== "false";
				const typeTextMap = {
					1: "leave",
					2: "mug",
					3: "hospitalize",
					4: "arrest"
				};
				const SLOT_BASES = {
					1: "weapon_main",
					2: "weapon_second",
					3: "weapon_melee",
					4: "weapon_temp"
				};
				const getSlotElement = () => {
					const byId = document.getElementById(SLOT_BASES[slot]);
					if (byId) return byId;
					const cells = qca("weaponCell") || qca("weapon");
					return cells.length >= slot ? cells[slot - 1] : null;
				};
				if (userID) {
					const getNameFromPage = () => {
						const els = qca("userName");
						const el = els.length >= 2 ? els[1] : els[0];
						return el ? el.textContent.trim() : null;
					};
					const titleEl = document.querySelector("title");
					if (titleEl) {
						const fixTab = (node, name) => {
							node.textContent = name;
						};
						const applyTabName = () => {
							const name = getNameFromPage() || userID;
							fixTab(titleEl, name);
							const obs = new MutationObserver((mutations) => {
								mutations.forEach((m) => {
									fixTab(m.target, name);
									obs.disconnect();
								});
							});
							obs.observe(titleEl, { childList: true });
						};
						if (qc("userName")) {
							applyTabName();
						} else {
							const poll = setInterval(() => {
								if (qc("userName")) {
									clearInterval(poll);
									applyTabName();
								}
							}, 200);
							setTimeout(() => {
								clearInterval(poll);
								applyTabName();
							}, 5e3);
						}
					}
				}
				const checkHealthPercent = () => {
					if (!isTabFocused) return;
					if (!executeEnabled) return;
					const bars = qca("progress");
					if (bars.length < 2) return;
					const secondaryEl = document.getElementById("weapon_second");
					if (!secondaryEl) return;
					const match = bars[1].getAttribute("aria-label")?.match(/Progress:\s*([\d.]+)%/);
					if (!match) return;
					const pct = parseFloat(match[1]);
					if (pct <= healthThreshold) {
						secondaryEl.style.backgroundColor = "red";
						secondaryEl.style.border = "3px solid darkred";
						secondaryEl.style.boxShadow = "0 0 20px red";
					} else {
						secondaryEl.style.backgroundColor = "";
						secondaryEl.style.border = "";
						secondaryEl.style.boxShadow = "";
					}
				};
				let healthTimer = null;
				const startHealthWatch = () => {
					if (!healthTimer) healthTimer = setInterval(checkHealthPercent, 500);
				};
				const stopHealthWatch = () => {
					if (healthTimer) {
						clearInterval(healthTimer);
						healthTimer = null;
					}
				};
				if (executeEnabled) startHealthWatch();
				const getDialogButtons = () => qc("dialogButtons");
				function applyMobileBtnStyles(slotWidth) {
					if (!isMobile()) return;
					const container = getDialogButtons();
					if (!container) return;
					container.querySelectorAll("button").forEach((b) => {
						b.style.setProperty("font-size", "10px", "important");
						b.style.setProperty("padding", "2px 6px", "important");
						b.style.setProperty("line-height", "1.3", "important");
						b.style.setProperty("min-height", "0", "important");
						b.style.setProperty("height", "auto", "important");
						b.style.setProperty("width", "auto", "important");
						b.style.setProperty("max-width", slotWidth + "px", "important");
					});
				}
				function resetDialogButtons() {
					const btn = getDialogButtons();
					if (!btn) return;
					btn.style.position = "";
					btn.style.top = "";
					btn.style.bottom = "";
					btn.style.left = "";
					btn.style.right = "";
					btn.style.width = "";
					btn.style.maxWidth = "";
					btn.querySelectorAll("button").forEach((b) => b.removeAttribute("style"));
				}
				function positionDialogButtons() {
					if (!slotEnabled) {
						resetDialogButtons();
						return;
					}
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
					btn.style.position = "absolute";
					btn.style.top = topPx + "px";
					btn.style.bottom = "auto";
					btn.style.right = "auto";
					btn.style.width = "auto";
					btn.style.maxWidth = isMobile() ? slotRect.width + "px" : "200px";
					const slotMidX = slotRect.left + slotRect.width / 2;
					const parentLeft = parentRect.left;
					requestAnimationFrame(() => {
						const actualBtnW = btn.offsetWidth || (isMobile() ? slotRect.width : 120);
						btn.style.left = slotMidX - parentLeft - actualBtnW / 2 + "px";
					});
				}
				window.addEventListener("resize", positionDialogButtons);
				const applyButtonVisibility = () => {
					const container = getDialogButtons();
					if (!container) return;
					const buttons = [...container.querySelectorAll("button")];
					if (buttons.length <= 1) return;
					if (!slotEnabled || attackType === 0) {
						buttons.forEach((b) => b.style.display = "");
					} else {
						const target = typeTextMap[attackType];
						const found = buttons.find((b) => b.textContent.trim().toLowerCase() === target);
						buttons.forEach((b) => {
							b.style.display = !found || b.textContent.trim().toLowerCase() === target ? "" : "none";
						});
					}
					positionDialogButtons();
				};
				const HUD_STORAGE_KEY = "tm_tempEffectsUserID";
				const HUD_SLOT_MAP = {
					1: "Primary",
					2: "Secondary",
					3: "Melee",
					5: "Temp"
				};
				const DANGER_BONUSES = {
					parry: {
						color: "#ff5252",
						label: "PARRY"
					},
					bloodlust: {
						color: "#ff9800",
						label: "BLOOD"
					}
				};
				let MY_USER_ID = parseInt(localStorage.getItem(HUD_STORAGE_KEY)) || null;
				let attackersInLoader = 0;
				let defenderWeapons = null;
				let lastEffects = [];
				function deepFind(obj, keyName) {
					if (!obj || typeof obj !== "object") return undefined;
					if (keyName in obj) return obj[keyName];
					for (const key in obj) {
						const found = deepFind(obj[key], keyName);
						if (found !== undefined) return found;
					}
					return undefined;
				}
				const findCurrentTemporaryEffects = (obj) => deepFind(obj, "currentTemporaryEffects");
				const findAttackerUser = (obj) => deepFind(obj, "attackerUser");
				const findCurrentDefends = (obj) => deepFind(obj, "currentDefends");
				function extractDefenderWeapons(data) {
					const defenderItems = deepFind(data, "defenderItems");
					if (!defenderItems || typeof defenderItems !== "object") return null;
					const result = {};
					for (const [s, label] of Object.entries(HUD_SLOT_MAP)) {
						const entry = defenderItems[s]?.item?.[0];
						if (!entry) continue;
						if (label === "Temp") {
							result[label] = { name: entry.name };
							continue;
						}
						const bonuses = entry.currentBonuses ? Object.values(entry.currentBonuses).map((b) => ({
							icon: b.icon,
							value: b.value
						})) : [];
						result[label] = {
							name: entry.name,
							bonuses
						};
					}
					return Object.keys(result).length ? result : null;
				}
				function processResponse(data) {
					if (!isTabFocused) return;
					if (!data || typeof data !== "object") return;
					if (data.DB && typeof data.DB === "object") data = data.DB;
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
						attackersInLoader = new Set(defends.map((d) => d.attackerID).filter(Boolean)).size;
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
				const uw = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
				uw.__dssAttackHandler = processResponse;
				if (isMobile() && !uw.__dssAttackHooks) {
					uw.__dssAttackHooks = true;
					const handle = (d) => {
						try {
							uw.__dssAttackHandler && uw.__dssAttackHandler(d);
						} catch (_) {}
					};
					const ATTACK_URL_PATTERNS = [
						"sid=attack",
						"sid=getInAttack",
						"step=fight"
					];
					const _OrigWS = uw.WebSocket;
					uw.WebSocket = function(...args) {
						const ws = new _OrigWS(...args);
						ws.addEventListener("message", (e) => {
							try {
								handle(JSON.parse(e.data));
							} catch (_) {}
						});
						return ws;
					};
					uw.WebSocket.prototype = _OrigWS.prototype;
					try {
						Object.setPrototypeOf(uw.WebSocket, _OrigWS);
					} catch (_) {}
					const _origFetch = uw.fetch;
					uw.fetch = async function(...args) {
						const res = await _origFetch(...args);
						const reqUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
						if (ATTACK_URL_PATTERNS.some((p) => reqUrl.includes(p))) {
							try {
								res.clone().json().then(handle).catch(() => {});
							} catch (_) {}
						}
						return res;
					};
					const _origOpen = uw.XMLHttpRequest.prototype.open;
					uw.XMLHttpRequest.prototype.open = function(...args) {
						const reqUrl = args[1] || "";
						if (ATTACK_URL_PATTERNS.some((p) => reqUrl.includes(p))) {
							this.addEventListener("load", () => {
								try {
									handle(JSON.parse(this.responseText));
								} catch (_) {}
							});
						}
						return _origOpen.apply(this, args);
					};
				}
				function renderWeaponLine(label, weapon) {
					if (!weapon?.name) return "";
					let bonusText = "";
					let dangerTags = "";
					if (Array.isArray(weapon.bonuses) && weapon.bonuses.length) {
						bonusText = weapon.bonuses.map((b) => {
							if (DANGER_BONUSES[b.icon]) {
								const d = DANGER_BONUSES[b.icon];
								dangerTags += `<span class="tae-danger" style="color:${d.color}">${d.label}</span>`;
							}
							return `${b.value}% ${b.icon}`;
						}).join(" ");
					}
					return `<span class="tae-weapon-line">
            <b>${label[0]}:</b> ${weapon.name}
            ${bonusText ? "<span class=\"tae-weapon-bonuses\"> • " + bonusText + "</span>" : ""}
            ${dangerTags}
        </span>`;
				}
				function renderEffect(effect) {
					const VISION_EFFECTS = ["Smoked", "Blinded"];
					const DOT_EFFECTS = [
						"Eviscerated",
						"Bleeding",
						"Burning"
					];
					const isVision = VISION_EFFECTS.includes(effect.title);
					const isDOT = DOT_EFFECTS.includes(effect.title);
					const stackText = effect.isStackable ? ` ${effect.stackCount}/${effect.stackCountMax}` : "";
					let elCls = "tae-effect";
					if (isVision) elCls += " tae-effect-critical";
					if (isDOT) elCls += " tae-effect-dot";
					const label = isVision ? effect.title.toUpperCase() : effect.title;
					return `<span class="${elCls}">${label} (${effect.timeLeft}s)${stackText}</span>`;
				}
				let _lastAttackersRendered = -1;
				let _lastLoadoutRendered = null;
				let _lastEffectsRendered = null;
				function updateHUDRow() {
					if (!isMobile()) return;
					const row = document.getElementById("tae-hud-row");
					if (!row) return;
					const badge = document.getElementById("tae-hud-attackers");
					if (badge && attackersInLoader !== _lastAttackersRendered) {
						badge.textContent = attackersInLoader;
						_lastAttackersRendered = attackersInLoader;
					}
					const loadout = document.getElementById("tae-hud-loadout");
					if (loadout) {
						const loadoutKey = defenderWeapons ? JSON.stringify(defenderWeapons) : null;
						if (loadoutKey !== _lastLoadoutRendered) {
							loadout.innerHTML = defenderWeapons ? [
								renderWeaponLine("Primary", defenderWeapons.Primary),
								renderWeaponLine("Secondary", defenderWeapons.Secondary),
								renderWeaponLine("Melee", defenderWeapons.Melee),
								renderWeaponLine("Temp", defenderWeapons.Temp)
							].join("") : "<span class=\"tae-label\">—</span>";
							_lastLoadoutRendered = loadoutKey;
						}
					}
					const effects = document.getElementById("tae-hud-effects");
					if (effects) {
						const effectsKey = JSON.stringify(lastEffects);
						if (effectsKey !== _lastEffectsRendered) {
							effects.innerHTML = !lastEffects || lastEffects.length === 0 ? "<span class=\"tae-label\">None</span>" : lastEffects.map(renderEffect).join("");
							_lastEffectsRendered = effectsKey;
						}
					}
				}
				function buildHUDRow() {
					const sep = Object.assign(document.createElement("div"), { className: "tae-row-break" });
					const rowA = document.createElement("div");
					rowA.id = "tae-hud-row";
					rowA.className = "tae-row tae-hud-row";
					const atkPrefix = document.createElement("div");
					atkPrefix.className = "tae-row-prefix";
					atkPrefix.innerHTML = "<span class=\"tae-label\">Attackers</span>";
					const loaderBadge = document.createElement("span");
					loaderBadge.id = "tae-hud-attackers";
					loaderBadge.className = "tae-btn";
					Object.assign(loaderBadge.style, {
						minWidth: "14px",
						textAlign: "center"
					});
					loaderBadge.textContent = "0";
					atkPrefix.appendChild(loaderBadge);
					rowA.appendChild(atkPrefix);
					rowA.appendChild(Object.assign(document.createElement("div"), { className: "tae-vdivider" }));
					const loadoutGroup = document.createElement("div");
					loadoutGroup.className = "tae-group tae-group-col";
					loadoutGroup.innerHTML = `
            <span class="tae-label">Enemy Loadout</span>
            <div id="tae-hud-loadout" class="tae-hud-list"><span class="tae-label">\u2014</span></div>`;
					rowA.appendChild(loadoutGroup);
					const sepB = Object.assign(document.createElement("div"), { className: "tae-row-break" });
					const rowB = document.createElement("div");
					rowB.className = "tae-row";
					const fxPrefix = document.createElement("div");
					fxPrefix.className = "tae-row-prefix";
					fxPrefix.innerHTML = "<span class=\"tae-label\">Effects</span>";
					rowB.appendChild(fxPrefix);
					rowB.appendChild(Object.assign(document.createElement("div"), { className: "tae-vdivider" }));
					const fxList = document.createElement("div");
					fxList.id = "tae-hud-effects";
					fxList.className = "tae-hud-list tae-hud-effects-list";
					fxList.innerHTML = "<span class=\"tae-label\">None</span>";
					rowB.appendChild(fxList);
					return [
						sep,
						rowA,
						sepB,
						rowB
					];
				}
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
				const buildToggle = () => {
					const wrap = document.createElement("div");
					wrap.id = "tae-toggle-wrap";
					wrap.innerHTML = `<span id="tae-toggle-arrow" class="${settingsVisible ? "" : "collapsed"}">\u25BC</span><span id="tae-toggle-label">Attack Enhancer</span>`;
					wrap.addEventListener("click", () => {
						settingsVisible = !settingsVisible;
						localStorage.setItem("tae-settings-visible", settingsVisible);
						const arrow = document.getElementById("tae-toggle-arrow");
						if (arrow) arrow.classList.toggle("collapsed", !settingsVisible);
						const bar = document.getElementById("tae-settings");
						if (bar) {
							bar.classList.toggle("tae-expanded", settingsVisible);
							bar.classList.toggle("tae-collapsed", !settingsVisible);
						}
					});
					return wrap;
				};
				const buildSettingsBar = () => {
					const bar = document.createElement("div");
					bar.id = "tae-settings";
					bar.className = settingsVisible ? "tae-expanded" : "tae-collapsed";
					const makeGroup = (label, options, currentVal, storageKey) => {
						const g = document.createElement("div");
						g.className = "tae-group";
						g.dataset.storageKey = storageKey;
						g.appendChild(Object.assign(document.createElement("span"), {
							className: "tae-label",
							textContent: label
						}));
						options.forEach(({ label: l, val }) => {
							const b = document.createElement("button");
							b.className = "tae-btn" + (val === currentVal ? " active" : "");
							b.textContent = l;
							b.addEventListener("click", () => {
								localStorage.setItem(storageKey, val);
								location.reload();
							});
							g.appendChild(b);
						});
						return g;
					};
					const makeRow = () => Object.assign(document.createElement("div"), { className: "tae-row" });
					const row1 = makeRow();
					const sfPrefix = document.createElement("div");
					sfPrefix.className = "tae-row-prefix";
					sfPrefix.appendChild(Object.assign(document.createElement("span"), {
						className: "tae-label",
						textContent: "Fight"
					}));
					const slotOnOffBtn = document.createElement("button");
					slotOnOffBtn.className = "tae-btn" + (slotEnabled ? " active-green" : "");
					slotOnOffBtn.textContent = slotEnabled ? "On" : "Off";
					slotOnOffBtn.addEventListener("click", () => {
						slotEnabled = !slotEnabled;
						localStorage.setItem("torn-slot-enabled", slotEnabled);
						slotOnOffBtn.textContent = slotEnabled ? "On" : "Off";
						slotOnOffBtn.className = "tae-btn" + (slotEnabled ? " active-green" : "");
						if (slotEnabled) {
							slot = 1;
							attackType = 0;
							localStorage.setItem("torn-attack-slot", slot);
							localStorage.setItem("torn-attack-type", attackType);
						} else {
							slot = 0;
							attackType = -1;
							resetDialogButtons();
						}
						document.querySelectorAll("#tae-settings .tae-group .tae-btn").forEach((b) => {
							const txt = b.textContent.trim().toLowerCase();
							const slotMatch = {
								primary: 1,
								secondary: 2,
								melee: 3,
								temp: 4
							};
							const typeMatch = {
								all: 0,
								leave: 1,
								mug: 2,
								hosp: 3,
								arrest: 4
							};
							let isActive = false;
							if (slotMatch[txt] !== undefined) isActive = slotEnabled && slotMatch[txt] === slot;
							if (typeMatch[txt] !== undefined) isActive = slotEnabled && typeMatch[txt] === attackType;
							b.classList.toggle("active", isActive);
						});
						applyButtonVisibility();
					});
					sfPrefix.appendChild(slotOnOffBtn);
					row1.appendChild(sfPrefix);
					row1.appendChild(Object.assign(document.createElement("div"), { className: "tae-vdivider" }));
					const sfGroups = document.createElement("div");
					sfGroups.className = "tae-row-groups";
					sfGroups.appendChild(makeGroup("Slot", [
						{
							label: "Primary",
							val: 1
						},
						{
							label: "Secondary",
							val: 2
						},
						{
							label: "Melee",
							val: 3
						},
						{
							label: "Temp",
							val: 4
						}
					], slot, "torn-attack-slot"));
					sfGroups.appendChild(makeGroup("Type", [
						{
							label: "All",
							val: 0
						},
						{
							label: "Leave",
							val: 1
						},
						{
							label: "Mug",
							val: 2
						},
						{
							label: "Hosp",
							val: 3
						},
						{
							label: "Arrest",
							val: 4
						}
					], attackType, "torn-attack-type"));
					row1.appendChild(sfGroups);
					bar.appendChild(row1);
					bar.appendChild(Object.assign(document.createElement("div"), { className: "tae-row-break" }));
					const row2 = makeRow();
					const exPrefix = document.createElement("div");
					exPrefix.className = "tae-row-prefix";
					exPrefix.appendChild(Object.assign(document.createElement("span"), {
						className: "tae-label",
						textContent: "Execute"
					}));
					const exBtn = document.createElement("button");
					exBtn.className = "tae-btn" + (executeEnabled ? " active-green" : "");
					exBtn.textContent = executeEnabled ? "On" : "Off";
					exBtn.addEventListener("click", () => {
						executeEnabled = !executeEnabled;
						localStorage.setItem("torn-execute-enabled", executeEnabled);
						exBtn.textContent = executeEnabled ? "On" : "Off";
						exBtn.className = "tae-btn" + (executeEnabled ? " active-green" : "");
						if (executeEnabled) startHealthWatch();
						if (!executeEnabled) {
							stopHealthWatch();
							const secondaryEl = document.getElementById("weapon_second");
							if (secondaryEl) {
								secondaryEl.style.backgroundColor = "";
								secondaryEl.style.border = "";
								secondaryEl.style.boxShadow = "";
							}
						}
					});
					exPrefix.appendChild(exBtn);
					row2.appendChild(exPrefix);
					row2.appendChild(Object.assign(document.createElement("div"), { className: "tae-vdivider" }));
					const exGroups = document.createElement("div");
					exGroups.className = "tae-row-groups";
					exGroups.style.flexWrap = "nowrap";
					exGroups.style.alignItems = "center";
					exGroups.appendChild(Object.assign(document.createElement("span"), {
						className: "tae-label",
						textContent: "%"
					}));
					const exAlignSpacer = document.createElement("span");
					exAlignSpacer.style.cssText = "display:inline-block;min-width:14px;visibility:hidden;flex-shrink:0;";
					exGroups.appendChild(exAlignSpacer);
					const threshInput = Object.assign(document.createElement("input"), {
						type: "number",
						min: "1",
						max: "100",
						value: healthThreshold,
						className: "tae-threshold-input"
					});
					threshInput.addEventListener("change", () => {
						const v = Math.min(100, Math.max(1, Number(threshInput.value)));
						threshInput.value = v;
						healthThreshold = v;
						localStorage.setItem("torn-health-threshold", v);
					});
					exGroups.appendChild(threshInput);
					row2.appendChild(exGroups);
					bar.appendChild(row2);
					return bar;
				};
				const buildWrapper = () => {
					const wrap = document.createElement("div");
					wrap.id = "tae-wrap";
					wrap.appendChild(buildToggle());
					wrap.appendChild(buildSettingsBar());
					if (isMobile()) {
						const [hudSep, rowA, sepB, rowB] = buildHUDRow();
						const hudWrap = document.createElement("div");
						hudWrap.id = "tae-hud-wrap";
						hudWrap.appendChild(hudSep);
						hudWrap.appendChild(rowA);
						hudWrap.appendChild(sepB);
						hudWrap.appendChild(rowB);
						wrap.appendChild(hudWrap);
					}
					return wrap;
				};
				const tryInject = () => {
					const container = qc("playersModelWrap");
					if (!container) return false;
					if (container.querySelector("#tae-wrap")) return true;
					container.insertBefore(buildWrapper(), container.firstChild);
					requestAnimationFrame(() => {
						positionDialogButtons();
						applyButtonVisibility();
					});
					return true;
				};
				let reposTimer = null;
				new MutationObserver(() => {
					if (!isTabFocused) return;
					applyButtonVisibility();
					clearTimeout(reposTimer);
					reposTimer = setTimeout(positionDialogButtons, 150);
					tryInject();
				}).observe(document.body, {
					childList: true,
					subtree: true
				});
				const initPoll = setInterval(() => {
					if (tryInject()) clearInterval(initPoll);
				}, 200);
				setTimeout(() => clearInterval(initPoll), 1e4);
			}
			if (isAttackPage && userID) {
				const aphtApiKey = Storage.getSettings().apiKey;
				if (aphtApiKey) {
					let aphtOutAt = 0;
					let aphtWasInHosp = false;
					let aphtClockTimer = null;
					let aphtPollTimer = null;
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
						return aphtOutAt - Date.now() / 1e3;
					}
					function aphtFormatTime(totalSecs) {
						const h = Math.floor(totalSecs / 3600);
						const m = Math.floor(totalSecs % 3600 / 60);
						const s = Math.floor(totalSecs % 60);
						return [
							h,
							m,
							s
						].map((v) => String(v).padStart(2, "0")).join(":");
					}
					function aphtUpdateClock() {
						if (!isTabFocused) return;
						const diff = aphtGetSecsLeft();
						const timeEl = document.getElementById("apht-time-left");
						const reloadBtn = document.getElementById("apht-reload-btn");
						if (diff <= 0) {
							if (timeEl) {
								timeEl.textContent = "00:00:00";
								timeEl.classList.remove("apht-flash-green");
							}
							if (aphtClockTimer) {
								clearInterval(aphtClockTimer);
								aphtClockTimer = null;
							}
							if (aphtPollTimer) {
								clearInterval(aphtPollTimer);
								aphtPollTimer = null;
							}
							return;
						}
						if (timeEl) {
							timeEl.textContent = aphtFormatTime(diff);
							timeEl.classList.toggle("apht-flash-green", diff <= 10);
						}
					}
					function aphtBuildUI() {
						if (document.getElementById("apht-time-wrap")) return;
						const titleContainer = document.querySelector("[class^='titleContainer_']");
						if (!titleContainer) return false;
						titleContainer.style.position = "relative";
						const wrap = document.createElement("div");
						wrap.id = "apht-time-wrap";
						const timeSpan = document.createElement("span");
						timeSpan.id = "apht-time-left";
						timeSpan.textContent = "--:--:--";
						wrap.appendChild(timeSpan);
						const reloadBtn = document.createElement("input");
						reloadBtn.id = "apht-reload-btn";
						reloadBtn.type = "button";
						reloadBtn.value = "Reload";
						reloadBtn.addEventListener("click", () => location.reload());
						wrap.appendChild(reloadBtn);
						titleContainer.appendChild(wrap);
						return true;
					}
					function aphtRemoveUI() {
						const wrap = document.getElementById("apht-time-wrap");
						if (wrap) wrap.remove();
					}
					async function aphtPoll() {
						if (!isTabFocused) return;
						try {
							const ts = Math.floor(Date.now() / 1e3);
							const res = await fetch(`${API_BASE}/user?id=${userID}&timestamp=${ts}`, { headers: {
								"Accept": "application/json",
								"Authorization": "ApiKey " + aphtApiKey
							} });
							if (!res.ok) return;
							const data = await res.json();
							if (data?.error) {
								const code = data.error.code;
								const TRANSIENT = [
									5,
									8,
									9,
									17,
									24
								];
								if (!TRANSIENT.includes(code)) {
									if (aphtPollTimer) {
										clearInterval(aphtPollTimer);
										aphtPollTimer = null;
									}
									if (aphtClockTimer) {
										clearInterval(aphtClockTimer);
										aphtClockTimer = null;
									}
									console.warn("[DSS APHT] Stopping polls — API error code", code);
								}
								return;
							}
							const status = data?.profile?.status;
							if (!status || status.state !== "Hospital") {
								aphtRemoveUI();
								if (aphtClockTimer) {
									clearInterval(aphtClockTimer);
									aphtClockTimer = null;
								}
								if (aphtWasInHosp) {
									if (aphtBuildUI()) {
										const timeEl = document.getElementById("apht-time-left");
										if (timeEl) {
											timeEl.textContent = "Target out of Hospital!";
											timeEl.style.color = "#ef4444";
										}
									}
									if (aphtPollTimer) {
										clearInterval(aphtPollTimer);
										aphtPollTimer = null;
									}
								}
								aphtWasInHosp = false;
								return;
							}
							aphtOutAt = status.until;
							aphtWasInHosp = true;
							if (aphtBuildUI() || document.getElementById("apht-time-wrap")) {
								aphtUpdateClock();
								if (!aphtClockTimer) {
									aphtClockTimer = setInterval(aphtUpdateClock, 1e3);
								}
							}
						} catch (_) {}
					}
					setTimeout(() => {
						aphtPoll();
						aphtPollTimer = setInterval(aphtPoll, 2e3);
					}, 250);
				}
			}
			const isProfilePage = url.includes("profiles.php");
			if (isProfilePage) {
				const aboApiKey = Storage.getSettings().apiKey;
				const aboXID = new URLSearchParams(window.location.search).get("XID");
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
							const res = await fetch(`${API_BASE}/user?id=${aboXID}`, { headers: {
								"Accept": "application/json",
								"Authorization": "ApiKey " + aboApiKey
							} });
							if (!res.ok) return;
							const data = await res.json();
							if (data?.error) return;
							if (data?.profile?.status?.state === "Hospital") {
								aboEnableAttackButton();
							}
						} catch (_) {}
					}
					function aboEnableAttackButton(attempts = 0) {
						let btn = document.getElementById(`button0-profile-${aboXID}`) || document.querySelector("[id^='button0-profile-']") || document.querySelector("input[value='Attack']") || document.querySelector("a[class*='profileButton'][href*='attack']");
						if (!btn) {
							const allBtns = document.querySelectorAll("[class*='profileButton'], [class*='profile-button']");
							for (const b of allBtns) {
								if (b.textContent.trim().toLowerCase().includes("attack") || b.querySelector("input[value='Attack']")) {
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
						btn.removeAttribute("disabled");
						btn.disabled = false;
						btn.classList.remove("disabled");
						btn.classList.add("abo-enabled-btn");
						btn.setAttribute("title", "Bypass — Click to Attack");
						const existingHref = btn.getAttribute("data-href") || btn.getAttribute("href");
						const attackUrl = existingHref || `/loader.php?sid=attack&user2ID=${aboXID}`;
						btn.addEventListener("click", function aboClick(e) {
							e.preventDefault();
							e.stopPropagation();
							window.location.href = attackUrl.startsWith("http") ? attackUrl : "https://www.torn.com" + attackUrl;
						}, { once: true });
					}
					if (isTabFocused) {
						aboCheckStatus();
					} else {
						const aboVisHandler = () => {
							if (document.visibilityState === "visible") {
								document.removeEventListener("visibilitychange", aboVisHandler);
								aboCheckStatus();
							}
						};
						document.addEventListener("visibilitychange", aboVisHandler);
					}
				}
			}
		}
	});

// src/modules/chain-monitor/guide.html?raw
	var guide_default$13 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Alert Thresholds (seconds remaining)</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Configure when each alert level triggers. Values are in <strong>seconds</strong> of chain time remaining.</p>\n                <div style=\"display:flex;flex-direction:column;gap:8px;margin-top:10px;\">\n                    <div style=\"display:flex;align-items:center;gap:8px;\">\n                        <span style=\"color:#22c55e;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:60px;\">Green</span>\n                        <input type=\"number\" id=\"dss-chain-green\" min=\"10\" max=\"300\" step=\"5\" placeholder=\"105\"\n                            style=\"width:80px;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(34,197,94,0.3);border-radius:4px;color:#ccc;font-size:12px;font-family:monospace;outline:none;text-align:center;\" />\n                        <span style=\"color:#666;font-size:11px;\">seconds</span>\n                    </div>\n                    <div style=\"display:flex;align-items:center;gap:8px;\">\n                        <span style=\"color:#f97316;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:60px;\">Orange</span>\n                        <input type=\"number\" id=\"dss-chain-orange\" min=\"10\" max=\"300\" step=\"5\" placeholder=\"85\"\n                            style=\"width:80px;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(249,115,22,0.3);border-radius:4px;color:#ccc;font-size:12px;font-family:monospace;outline:none;text-align:center;\" />\n                        <span style=\"color:#666;font-size:11px;\">seconds</span>\n                    </div>\n                    <div style=\"display:flex;align-items:center;gap:8px;\">\n                        <span style=\"color:#ef4444;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:60px;\">Red</span>\n                        <input type=\"number\" id=\"dss-chain-red\" min=\"10\" max=\"300\" step=\"5\" placeholder=\"60\"\n                            style=\"width:80px;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(239,68,68,0.3);border-radius:4px;color:#ccc;font-size:12px;font-family:monospace;outline:none;text-align:center;\" />\n                        <span style=\"color:#666;font-size:11px;\">seconds (triggers target dialog)</span>\n                    </div>\n                    <div style=\"display:flex;gap:8px;margin-top:4px;\">\n                        <button id=\"dss-chain-thresholds-save\" style=\"padding:6px 16px;background:rgba(76,175,80,0.2);border:1px solid rgba(76,175,80,0.4);border-radius:4px;color:#4caf50;font-size:12px;font-weight:600;cursor:pointer;\">Save</button>\n                        <button id=\"dss-chain-thresholds-reset\" style=\"padding:6px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#999;font-size:12px;cursor:pointer;\">Reset to Defaults</button>\n                    </div>\n                    <div id=\"dss-chain-thresholds-status\" style=\"font-size:11px;min-height:16px;\"></div>\n                </div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Chain Bar Alerts</div>\n            <div class=\"dss-guide-card-body\">\n                <p>The chain bar pulses with colour-coded alerts as time runs down. Alerts only activate when the chain count is <strong>10 or higher</strong>.</p>\n                <p><strong style=\"color:#22c55e;\">Green</strong> — gentle pulse. <strong style=\"color:#f97316;\">Orange</strong> — faster pulse. <strong style=\"color:#ef4444;\">Red</strong> — rapid flash with target dialog.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Random Target Dialog</div>\n            <div class=\"dss-guide-card-body\">\n                <p>When the timer hits red, a dialog appears in the bottom-left with a random target ID. Click <strong>Attack</strong> to open the attack page, or <strong>New Target</strong> to roll a different ID.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Always Active</div>\n            <div class=\"dss-guide-card-body\">\n                <p>This module runs on every Torn page since the chain bar is always visible. Alerts and the target dialog only show while the tab is focused.</p>\n            </div>\n        </div>\n    ";

// src/modules/chain-monitor/index.js
	registerModule("chain-monitor", {
		name: "Chain Monitor",
		version: "1.2",
		description: "Monitor faction chain timeout with visual alerts. Shows green/orange/red pulsing on the chain bar and a random target dialog when critical.",
		pages: ["https://www.torn.com/"],
		guide: guide_default$13,
		init() {
			const GREEN_KEY = "dss_chain_green";
			document.getElementById("chain-target-dialog")?.remove();
			const ORANGE_KEY = "dss_chain_orange";
			const RED_KEY = "dss_chain_red";
			const DEFAULT_GREEN = 105;
			const DEFAULT_ORANGE = 85;
			const DEFAULT_RED = 60;
			const GREEN_THRESHOLD = parseInt(GM_getValue(GREEN_KEY, String(DEFAULT_GREEN)), 10) || DEFAULT_GREEN;
			const ORANGE_THRESHOLD = parseInt(GM_getValue(ORANGE_KEY, String(DEFAULT_ORANGE)), 10) || DEFAULT_ORANGE;
			const RED_THRESHOLD = parseInt(GM_getValue(RED_KEY, String(DEFAULT_RED)), 10) || DEFAULT_RED;
			const CHECK_INTERVAL = 1e3;
			const MIN_CHAIN_COUNT = 10;
			const minID = 38e5;
			const maxID = 39e5;
			let checkTimer = null;
			let currentAlertLevel = null;
			let targetDialogOpen = false;
			let isTabFocused = document.hasFocus();
			window.addEventListener("focus", () => {
				isTabFocused = true;
			});
			window.addEventListener("blur", () => {
				isTabFocused = false;
				closeTargetDialog();
			});
			document.addEventListener("visibilitychange", () => {
				isTabFocused = document.visibilityState === "visible" && document.hasFocus();
				if (!isTabFocused) closeTargetDialog();
			});
			const SEL = {
				chainBar: "[class*=\"chain-bar___\"], [class*=\"chainBar___\"]",
				value: "[class*=\"bar-value___\"], [class*=\"barValue___\"]",
				timeLeft: "[class*=\"bar-timeleft___\"], [class*=\"barTimeLeft___\"]"
			};
			const getChainBar = () => document.querySelector(SEL.chainBar);
			function wireGuideControls() {
				const greenInput = document.getElementById("dss-chain-green");
				const orangeInput = document.getElementById("dss-chain-orange");
				const redInput = document.getElementById("dss-chain-red");
				const saveBtn = document.getElementById("dss-chain-thresholds-save");
				const resetBtn = document.getElementById("dss-chain-thresholds-reset");
				const status = document.getElementById("dss-chain-thresholds-status");
				if (!greenInput || !saveBtn) return;
				greenInput.value = GM_getValue(GREEN_KEY, String(DEFAULT_GREEN));
				orangeInput.value = GM_getValue(ORANGE_KEY, String(DEFAULT_ORANGE));
				redInput.value = GM_getValue(RED_KEY, String(DEFAULT_RED));
				[
					greenInput,
					orangeInput,
					redInput
				].forEach((inp) => {
					inp.addEventListener("keydown", (e) => {
						e.stopPropagation();
						if (e.key === "Enter") saveBtn.click();
					});
				});
				saveBtn.addEventListener("click", () => {
					const g = parseInt(greenInput.value, 10);
					const o = parseInt(orangeInput.value, 10);
					const r = parseInt(redInput.value, 10);
					if (!g || !o || !r || g < 10 || o < 10 || r < 10) {
						if (status) {
							status.textContent = "⚠ All values must be at least 10 seconds";
							status.style.color = "#ef4444";
						}
						return;
					}
					if (!(g > o && o > r)) {
						if (status) {
							status.textContent = "⚠ Green must be > Orange > Red";
							status.style.color = "#ef4444";
						}
						return;
					}
					GM_setValue(GREEN_KEY, String(g));
					GM_setValue(ORANGE_KEY, String(o));
					GM_setValue(RED_KEY, String(r));
					if (status) {
						status.textContent = "✅ Saved — reload any page to apply new thresholds";
						status.style.color = "#4caf50";
					}
				});
				resetBtn.addEventListener("click", () => {
					GM_setValue(GREEN_KEY, String(DEFAULT_GREEN));
					GM_setValue(ORANGE_KEY, String(DEFAULT_ORANGE));
					GM_setValue(RED_KEY, String(DEFAULT_RED));
					greenInput.value = DEFAULT_GREEN;
					orangeInput.value = DEFAULT_ORANGE;
					redInput.value = DEFAULT_RED;
					if (status) {
						status.textContent = "✅ Reset to defaults — reload to apply";
						status.style.color = "#4caf50";
					}
				});
			}
			UI.wireGuideField("dss-chain-green", wireGuideControls);
			addStyles();
			updateVisuals();
			checkTimer = setInterval(updateVisuals, CHECK_INTERVAL);
			function parseTimeString(timeString) {
				if (!timeString || timeString.trim() === "") return null;
				const parts = timeString.split(":");
				if (parts.length !== 2) return null;
				const minutes = parseInt(parts[0], 10);
				const seconds = parseInt(parts[1], 10);
				if (isNaN(minutes) || isNaN(seconds)) return null;
				return minutes * 60 + seconds;
			}
			function getCurrentChainCount() {
				const el = getChainBar()?.querySelector(SEL.value);
				if (!el) return null;
				const match = el.textContent.replace(/[,\s]/g, "").match(/^(\d+)\//);
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
					targetAlertLevel = "red";
				} else if (timeRemaining <= ORANGE_THRESHOLD) {
					targetAlertLevel = "orange";
				} else if (timeRemaining <= GREEN_THRESHOLD) {
					targetAlertLevel = "green";
				} else {
					targetAlertLevel = "none";
				}
				if (!isValidTransition(currentAlertLevel, targetAlertLevel)) return;
				if (currentAlertLevel !== targetAlertLevel) {
					currentAlertLevel = targetAlertLevel;
					applyAlertLevel(chainBar, targetAlertLevel);
				}
			}
			function isValidTransition(current, target) {
				if (current === target) return true;
				if (target === "none") return true;
				if (current === null || current === "none") return true;
				if (current === "green" && (target === "orange" || target === "red")) return true;
				if (current === "orange" && target === "red") return true;
				return false;
			}
			function clearAlerts(chainBar) {
				chainBar.classList.remove("chain-alert-green", "chain-alert-orange", "chain-alert-red");
				closeTargetDialog();
				currentAlertLevel = null;
			}
			function applyAlertLevel(chainBar, level) {
				chainBar.classList.remove("chain-alert-green", "chain-alert-orange", "chain-alert-red");
				if (level === "red") {
					chainBar.classList.add("chain-alert-red");
					showTargetDialog();
				} else if (level === "orange") {
					chainBar.classList.add("chain-alert-orange");
					closeTargetDialog();
				} else if (level === "green") {
					chainBar.classList.add("chain-alert-green");
					closeTargetDialog();
				} else {
					closeTargetDialog();
				}
			}
			function getRandomNumber(min, max) {
				return Math.floor(Math.random() * (max - min + 1)) + min;
			}
			function getDialogBottom() {
				const mobDialog = document.getElementById("tc-mob-dialog");
				if (mobDialog) {
					const rect = mobDialog.getBoundingClientRect();
					return 20 + rect.height + 12;
				}
				return 20;
			}
			function showTargetDialog() {
				if (targetDialogOpen && document.getElementById("chain-target-dialog")) {
					const dialog = document.getElementById("chain-target-dialog");
					if (dialog) dialog.style.bottom = getDialogBottom() + "px";
					return;
				}
				targetDialogOpen = true;
				const randID = getRandomNumber(minID, maxID);
				const attackLink = `https://www.torn.com/page.php?sid=attack&user2ID=${randID}`;
				const profileLink = `https://www.torn.com/profiles.php?XID=${randID}`;
				const dialog = document.createElement("div");
				dialog.id = "chain-target-dialog";
				dialog.style.bottom = getDialogBottom() + "px";
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
				const profileLinkElement = dialog.querySelector(".profile-link");
				profileLinkElement.addEventListener("mousedown", () => {
					setTimeout(() => {
						profileLinkElement.dispatchEvent(new MouseEvent("mouseover", {
							bubbles: true,
							cancelable: true
						}));
					}, 500);
				});
				dialog.querySelector(".btn-new-target").addEventListener("click", updateTargetDialog);
				dialog.querySelector(".dialog-close").addEventListener("click", closeTargetDialog);
				dialog.querySelector(".btn-attack").addEventListener("click", () => setTimeout(closeTargetDialog, 500));
				repositionInjectedStats();
			}
			function repositionInjectedStats() {
				const check = () => {
					const profileLink = document.querySelector("#chain-target-dialog .profile-link");
					if (!profileLink) return;
					profileLink.querySelectorAll("div").forEach((div) => {
						if (div.style.left !== "10px") {
							div.style.setProperty("left", "10px", "important");
							div.style.setProperty("right", "auto", "important");
						}
					});
				};
				[
					50,
					100,
					200,
					500
				].forEach((ms) => setTimeout(check, ms));
			}
			function updateTargetDialog() {
				closeTargetDialog();
				setTimeout(() => showTargetDialog(), 50);
			}
			function closeTargetDialog() {
				const dialog = document.getElementById("chain-target-dialog");
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
			window.addEventListener("beforeunload", () => {
				if (checkTimer) clearInterval(checkTimer);
			});
		}
	});

// src/core/request.js
	function getTransport() {
		if (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function") return GM.xmlHttpRequest.bind(GM);
		if (typeof GM_xmlhttpRequest === "function") return GM_xmlhttpRequest;
		return null;
	}
	/** True if a userscript-manager request function is available. */
	function hasGmRequest() {
		return getTransport() !== null;
	}
	function gmRequest(opts) {
		const transport = getTransport();
		if (!transport) {
			setTimeout(() => opts.onerror && opts.onerror(new Error("No GM request function available")), 0);
			return;
		}
		const onload = opts.onload;
		return transport({
			...opts,
			onload: (response) => {
				if (!response) return;
				if (onload) onload(response);
			}
		});
	}

// src/modules/midnight-revive/guide.html?raw
	var guide_default$12 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">What It Does</div>\n            <div class=\"dss-guide-card-body\">\n                <p>When you are in hospital, a green <strong>NITE Revive Me</strong> button is added to the top page links. Clicking it sends a revive request to <strong>Midnight X</strong>.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Payment</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On a successful standard request you'll be asked to pay your reviver <strong>2 Xanax or $1.8m</strong>. Contract requests are handled without the payment prompt.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Third-Party Data Sharing</div>\n            <div class=\"dss-guide-card-body\">\n                <p>This module sends your <strong>Torn ID</strong> and <strong>username</strong> (read from the sidebar session data) to <strong>api.no1irishstig.co.uk</strong>, the Midnight X revive service, so a reviver can be dispatched. Your API key is never sent. If you disable this module, no data is sent.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Notes</div>\n            <div class=\"dss-guide-card-body\">\n                <p>The button only appears while you're in hospital and is removed automatically when you leave. It runs on every Torn page since hospital status can change anywhere.</p>\n            </div>\n        </div>\n    ";

// src/modules/midnight-revive/index.js
	registerModule("midnight-revive", {
		name: "Midnight X Revive",
		version: "1.2.5",
		description: "Adds a \"NITE Revive Me\" button to the hospital status links to request a revive from Midnight X.",
		pages: ["https://www.torn.com/"],
		guide: guide_default$12,
		init() {
			const OWNER = "Midnight X";
			const SOURCE = "DSS Midnight X Module";
			const BUTTON_LABEL = "NITE Revive Me";
			const COLOUR = "#61be3b";
			const API_URL = "https://api.no1irishstig.co.uk/request";
			const VERSION = "1.2.5";
			document.getElementById("custom-btn")?.remove();
			const icon = `
<svg xmlns="http://www.w3.org/2000/svg"
 width="15" height="15" viewBox="0 0 20 20">
  <path fill="none" class="revive-icon"
  d="M18.737,9.691h-5.462c-0.279,0-0.527,0.174-0.619,0.437l-1.444,4.104L8.984,3.195c-0.059-0.29-0.307-0.506-0.603-0.523C8.09,2.657,7.814,2.838,7.721,3.12L5.568,9.668H1.244c-0.36,0-0.655,0.291-0.655,0.655c0,0.36,0.294,0.655,0.655,0.655h4.8c0.281,0,0.532-0.182,0.621-0.45l1.526-4.645l2.207,10.938c0.059,0.289,0.304,0.502,0.595,0.524c0.016,0,0.031,0,0.046,0c0.276,0,0.524-0.174,0.619-0.437L13.738,11h4.999c0.363,0,0.655-0.294,0.655-0.655C19.392,9.982,19.1,9.691,18.737,9.691z"/>
</svg>`;
			GM_addStyle(`
            .revive-text { color: ${COLOUR}; }
            .revive-icon { fill: ${COLOUR} !important; }
            #custom-btn .nite-tag { display: none !important; }
            #custom-btn.nite-tagged { width: auto !important; overflow: visible !important; white-space: nowrap; }
            #custom-btn.nite-tagged .nite-tag {
                display: inline-block !important; margin-left: 3px; vertical-align: middle;
                font: 700 8px/1 Arial, sans-serif; color: ${COLOUR}; pointer-events: none;
            }
        `);
			let btn = null;
			function getSessionData() {
				const sidebarKey = Object.keys(sessionStorage).find((k) => /sidebarData\d+/.test(k));
				if (!sidebarKey) return {
					userID: null,
					userName: null,
					hospital: false
				};
				let data;
				try {
					data = JSON.parse(sessionStorage.getItem(sidebarKey));
				} catch (_) {
					return {
						userID: null,
						userName: null,
						hospital: false
					};
				}
				return {
					userID: data?.user?.userID,
					userName: data?.user?.name,
					hospital: data?.statusIcons?.icons?.hospital
				};
			}
			function inCloudflareChallenge() {
				return document.getElementsByClassName("iAmUnderAttack").length > 0;
			}
			function getButton() {
				btn = document.createElement("a");
				if (document.body.classList.contains("dark-mode")) {
					btn.classList.add("custom-dark-mode");
				}
				btn.id = "custom-btn";
				btn.className = "custom-revive t-clear h c-pointer m-icon line-h24 right last";
				btn.innerHTML = `
                <span class="icon-wrap svg-icon-wrap">
                    <span class="link-icon-svg">${icon}</span>
                </span>
                <span class="revive-text">${BUTTON_LABEL}</span>
                <span class="nite-tag">NITE</span>
            `;
				btn.href = "#custom-revive";
				btn.addEventListener("click", submitRequest);
				btn.addEventListener("mouseenter", () => {
					const text = document.getElementsByClassName("revive-text")[0];
					const svg = document.getElementsByClassName("revive-icon")[0];
					if (text) text.style.color = COLOUR;
					if (svg) svg.setAttribute("style", `fill: ${COLOUR} !important`);
				});
				btn.addEventListener("mouseleave", () => {
					const text = document.getElementsByClassName("revive-text")[0];
					const svg = document.getElementsByClassName("revive-icon")[0];
					if (text) text.style.color = null;
					if (svg) svg.removeAttribute("style");
				});
				return btn;
			}
			function checkButton() {
				if (inCloudflareChallenge()) return;
				const { hospital } = getSessionData();
				const exists = document.getElementById("custom-btn");
				if (!hospital) {
					if (btn) btn.remove();
					return;
				}
				if (exists) {
					const text = exists.querySelector(".revive-text");
					if (text) {
						const cs = getComputedStyle(text);
						const hidden = cs.display === "none" || cs.visibility === "hidden" || text.getBoundingClientRect().width === 0;
						exists.classList.toggle("nite-tagged", hidden);
					}
					return;
				}
				const location = document.getElementById("top-page-links-list");
				if (location != null) {
					const issues = document.getElementsByClassName("tt-revive");
					if (issues.length !== 0) issues[0].remove();
					const last = location.children[location.children.length - 1];
					if (last) last.insertAdjacentElement("afterend", getButton());
				}
			}
			function handleResponse(response) {
				if (btn) {
					btn.removeAttribute("disabled");
					btn.removeAttribute("aria-pressed");
				}
				if (response?.status && response.status !== 200) {
					const responseText = (response.responseText || "").replace(/^"|"$/g, "");
					alert(`Error Code: ${response.status}\nMessage: ${responseText}` || `An unknown error has occurred - Please report this to ${OWNER} leadership.`);
					return;
				}
				let contract = false;
				try {
					contract = !!JSON.parse(response.responseText).contract;
				} catch (_) {}
				if (contract) {
					alert(`Contract request has been sent to ${OWNER}. Thank you!`);
				} else {
					alert(`Request has been sent to ${OWNER}. Please pay your reviver 2 Xanax or $1.8m. Thank you!`);
				}
			}
			function submitRequest(e) {
				e?.preventDefault();
				const sessionData = getSessionData();
				if (!sessionData.hospital) {
					alert("You are not in the hospital.");
					return;
				}
				if (btn) {
					btn.setAttribute("disabled", true);
					btn.setAttribute("aria-pressed", true);
				}
				gmRequest({
					method: "POST",
					url: API_URL,
					headers: { "Content-Type": "application/json" },
					data: JSON.stringify({
						tornid: parseInt(sessionData.userID),
						username: "" + sessionData.userName,
						vendor: OWNER,
						source: `${SOURCE} ${VERSION}`,
						type: "revive"
					}),
					onload: handleResponse
				});
			}
			const checkTimer = setInterval(checkButton, 500);
			window.addEventListener("beforeunload", () => clearInterval(checkTimer));
		}
	});

// src/modules/hospital-revive-filter/guide.html?raw
	var guide_default$11 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">What It Does</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On the <strong>Hospital View</strong> page, adds a filter bar above the list to show only the players you want to revive.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Filters</div>\n            <div class=\"dss-guide-card-body\">\n                <p>• <strong>Revivable Only</strong> — hides players whose revive button is unavailable.</p>\n                <p>• <strong>Online / Idle / Offline</strong> — show or hide by activity status.</p>\n                <p>• <strong>Time slider</strong> — set a max hospital time remaining (0–100h).</p>\n                <p>• <strong>Level slider</strong> — set a max player level (0–100).</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Pagination</div>\n            <div class=\"dss-guide-card-body\">\n                <p>All filters re-apply automatically when the list updates via pagination.</p>\n            </div>\n        </div>\n    ";

// src/modules/hospital-revive-filter/index.js
	registerModule("hospital-revive-filter", {
		name: "Hospital Revive Filter",
		version: "1.0",
		description: "Filters hospital rows by revivable status, online status, time remaining, and level.",
		pages: ["/hospitalview.php"],
		guide: guide_default$11,
		init() {
			const MODULE_ID = "hospital-revive-filter";
			const state = {
				revivableOnly: true,
				statusFilters: {
					Online: true,
					Idle: true,
					Offline: true
				},
				maxTime: 100,
				maxLevel: 100
			};
			function getRowStatus(li) {
				const anchor = li.querySelector("ul#iconTray a[aria-label]");
				return anchor ? anchor.getAttribute("aria-label") : null;
			}
			function getRowTime(li) {
				const full = li.querySelector("span.time") ? li.querySelector("span.time").textContent : "";
				const hMatch = full.match(/(\d+)h/);
				const mMatch = full.match(/(\d+)m/);
				const hours = (hMatch ? parseInt(hMatch[1]) : 0) + (mMatch ? parseInt(mMatch[1]) / 60 : 0);
				return hours;
			}
			function getRowLevel(li) {
				const levelEl = li.querySelector("span.level");
				if (!levelEl) return null;
				const match = levelEl.textContent.match(/\d+/);
				return match ? parseInt(match[0]) : null;
			}
			function applyFilters() {
				const rows = document.querySelectorAll("ul.user-info-list-wrap.revive li");
				rows.forEach((li) => {
					const reviveLink = li.querySelector("a.revive");
					if (!reviveLink) return;
					if (state.revivableOnly && reviveLink.classList.contains("reviveNotAvailable")) {
						li.style.display = "none";
						return;
					}
					const status = getRowStatus(li);
					if (status && !state.statusFilters[status]) {
						li.style.display = "none";
						return;
					}
					const time = getRowTime(li);
					if (time !== null && time > state.maxTime) {
						li.style.display = "none";
						return;
					}
					const level = getRowLevel(li);
					if (level !== null && level > state.maxLevel) {
						li.style.display = "none";
						return;
					}
					li.style.display = "";
				});
			}
			function addControlBar(tries = 0) {
				const titleBar = document.querySelector(".users-list-title.revive");
				if (!titleBar) {
					if (tries < 100) setTimeout(() => addControlBar(tries + 1), 300);
					return;
				}
				if (document.getElementById(`${MODULE_ID}-bar`)) return;
				const style = document.createElement("style");
				style.textContent = `
                #${MODULE_ID}-bar {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 6px 10px;
                    padding: 6px 10px;
                    margin-bottom: 2px;
                    background: rgba(0,0,0,0.35);
                    border-radius: 4px 4px 0 0;
                    font-size: 11px;
                    box-sizing: border-box;
                    width: 100%;
                }
                @media (min-width: 768px) {
                    #${MODULE_ID}-bar {
                        flex-wrap: nowrap;
                        gap: 10px;
                        padding: 6px 14px;
                    }
                }
                #${MODULE_ID}-bar .hrf-section {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                #${MODULE_ID}-bar .hrf-label {
                    color: #888;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                }
                #${MODULE_ID}-bar .hrf-divider {
                    width: 1px;
                    height: 20px;
                    background: #333;
                    flex-shrink: 0;
                }
                .hrf-toggle-btn {
                    padding: 3px 10px;
                    font-size: 11px;
                    cursor: pointer;
                    border-radius: 3px;
                    border: 1px solid #3a3;
                    background: rgba(0,180,0,0.15);
                    color: #7d7;
                    white-space: nowrap;
                    transition: background 0.2s, color 0.2s, border-color 0.2s;
                }
                .hrf-toggle-btn.off {
                    border-color: #a33;
                    background: rgba(180,0,0,0.15);
                    color: #d77;
                }
                .hrf-status-label {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    cursor: pointer;
                    font-size: 11px;
                    user-select: none;
                }
                .hrf-status-label input { margin: 0; cursor: pointer; }
                .hrf-slider-wrap {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .hrf-slider {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 80px;
                    height: 4px;
                    border-radius: 2px;
                    background: #333;
                    outline: none;
                    cursor: pointer;
                }
                @media (min-width: 768px) {
                    .hrf-slider {
                        width: 110px;
                    }
                }
                .hrf-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 13px;
                    height: 13px;
                    border-radius: 50%;
                    background: #5a5;
                    cursor: pointer;
                    border: 1px solid #3a3;
                }
                .hrf-slider::-moz-range-thumb {
                    width: 13px;
                    height: 13px;
                    border-radius: 50%;
                    background: #5a5;
                    cursor: pointer;
                    border: 1px solid #3a3;
                }
                .hrf-slider-val {
                    color: #7d7;
                    font-size: 11px;
                    min-width: 24px;
                    text-align: left;
                }
            `;
				document.head.appendChild(style);
				const bar = document.createElement("div");
				bar.id = `${MODULE_ID}-bar`;
				const revSection = document.createElement("div");
				revSection.className = "hrf-section";
				const revBtn = document.createElement("button");
				revBtn.className = "hrf-toggle-btn";
				revBtn.textContent = "Revivable Only: ON";
				revBtn.addEventListener("click", () => {
					state.revivableOnly = !state.revivableOnly;
					revBtn.textContent = `Revivable Only: ${state.revivableOnly ? "ON" : "OFF"}`;
					revBtn.classList.toggle("off", !state.revivableOnly);
					applyFilters();
				});
				revSection.appendChild(revBtn);
				const div1 = document.createElement("div");
				div1.className = "hrf-divider";
				const statusSection = document.createElement("div");
				statusSection.className = "hrf-section";
				const statusLbl = document.createElement("span");
				statusLbl.className = "hrf-label";
				statusLbl.textContent = "Status:";
				statusSection.appendChild(statusLbl);
				const statusColors = {
					Online: "#7d7",
					Idle: "#da7",
					Offline: "#aaa"
				};
				[
					"Online",
					"Idle",
					"Offline"
				].forEach((status) => {
					const lbl = document.createElement("label");
					lbl.className = "hrf-status-label";
					lbl.style.color = statusColors[status];
					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.checked = true;
					cb.addEventListener("change", () => {
						state.statusFilters[status] = cb.checked;
						applyFilters();
					});
					lbl.appendChild(cb);
					lbl.appendChild(document.createTextNode(status));
					statusSection.appendChild(lbl);
				});
				const div2 = document.createElement("div");
				div2.className = "hrf-divider";
				const timeSection = document.createElement("div");
				timeSection.className = "hrf-section";
				const timeLbl = document.createElement("span");
				timeLbl.className = "hrf-label";
				timeLbl.textContent = "Max Time:";
				timeSection.appendChild(timeLbl);
				const timeWrap = document.createElement("div");
				timeWrap.className = "hrf-slider-wrap";
				const timeSlider = document.createElement("input");
				timeSlider.type = "range";
				timeSlider.className = "hrf-slider";
				timeSlider.min = 0;
				timeSlider.max = 100;
				timeSlider.value = 100;
				const timeVal = document.createElement("span");
				timeVal.className = "hrf-slider-val";
				timeVal.textContent = "100h";
				timeSlider.addEventListener("input", () => {
					state.maxTime = parseInt(timeSlider.value);
					timeVal.textContent = `${state.maxTime}h`;
					applyFilters();
				});
				timeWrap.appendChild(timeSlider);
				timeWrap.appendChild(timeVal);
				timeSection.appendChild(timeWrap);
				const div3 = document.createElement("div");
				div3.className = "hrf-divider";
				const levelSection = document.createElement("div");
				levelSection.className = "hrf-section";
				const levelLbl = document.createElement("span");
				levelLbl.className = "hrf-label";
				levelLbl.textContent = "Max Level:";
				levelSection.appendChild(levelLbl);
				const levelWrap = document.createElement("div");
				levelWrap.className = "hrf-slider-wrap";
				const levelSlider = document.createElement("input");
				levelSlider.type = "range";
				levelSlider.className = "hrf-slider";
				levelSlider.min = 0;
				levelSlider.max = 100;
				levelSlider.value = 100;
				const levelVal = document.createElement("span");
				levelVal.className = "hrf-slider-val";
				levelVal.textContent = "100";
				levelSlider.addEventListener("input", () => {
					state.maxLevel = parseInt(levelSlider.value);
					levelVal.textContent = `${state.maxLevel}`;
					applyFilters();
				});
				levelWrap.appendChild(levelSlider);
				levelWrap.appendChild(levelVal);
				levelSection.appendChild(levelWrap);
				const slidersRow = document.createElement("div");
				slidersRow.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: nowrap;
            `;
				slidersRow.appendChild(timeSection);
				slidersRow.appendChild(div3);
				slidersRow.appendChild(levelSection);
				bar.appendChild(revSection);
				bar.appendChild(div1);
				bar.appendChild(statusSection);
				bar.appendChild(div2);
				bar.appendChild(slidersRow);
				titleBar.parentElement.insertBefore(bar, titleBar);
			}
			function waitForList(tries = 0) {
				const list = document.querySelector("ul.user-info-list-wrap.revive");
				if (!list) {
					if (tries < 60) setTimeout(() => waitForList(tries + 1), 500);
					return;
				}
				applyFilters();
				addControlBar();
				const observer = new MutationObserver(() => {
					applyFilters();
					addControlBar();
				});
				observer.observe(list, {
					childList: true,
					subtree: false
				});
			}
			waitForList();
		}
	});

// src/modules/crime-prioritiser/guide.html?raw
	var guide_default$10 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">What It Does</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On the faction <strong>Organized Crimes</strong> page, this module:</p>\n                <p>• Sorts crime role slots by <strong>weight priority</strong> (highest weight first) so you can quickly see which roles matter most.</p>\n                <p>• Adds a <strong>weight label</strong> above each role slot showing the role's contribution percentage.</p>\n                <p>• Colour-codes each slot's left border from <strong>green</strong> (highest weight) to <strong>red</strong> (lowest weight).</p>\n                <p>• Calculates and displays the overall <strong>success chance</strong> for each crime based on the filled slots' CPR values.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Recruiting Panel Ordering</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On the <strong>Recruiting</strong> panel, crimes are reordered by <strong>pause priority</strong>:</p>\n                <p>• <strong>Paused</strong> crimes go to the top (fewest empty slots first) with a red outline.</p>\n                <p>• Crimes that will <strong>pause within 24h</strong> come next, soonest first.</p>\n                <p>• Crimes still <strong>recruiting</strong> (no countdown yet) follow, fewest empty slots first.</p>\n                <p>• Crimes that pause <strong>more than 24h</strong> out go last, soonest first.</p>\n                <p>Each crime gets a label such as <em>Priority #1 - Paused</em>, <em>Priority #2 - 5h 12m</em> or <em>Priority #3 - Recruiting</em>. Pause time is the execution countdown minus 24h for each empty slot.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">OC Join Reminder (all pages)</div>\n            <div class=\"dss-guide-card-body\">\n                <p>While this module is enabled, a reminder also runs on <strong>every</strong> Torn page. Whenever you're not currently in an organised crime, a blue prompt appears with a button that takes you straight to your faction's crimes page to join one. Dismissing it (the × or Dismiss button) hides it for 2 minutes, after which it returns if you still haven't joined.</p>\n                <p>It's tied to this module — there's no separate switch. It uses the API key from the DSS Setup page and is deliberately sparing with it: the result is cached and shared across all your open tabs, and while you're already in a crime it barely checks at all, waiting until the crime is due to be ready before looking again.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Completed Crimes</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On the <strong>Completed</strong> tab, each crime shows a <strong>Completed: date time</strong> badge to the left of its success box, read from the Torn API's <em>executed_at</em> value.</p>\n                <p>A <strong>date filter</strong> above the list lets you show only crimes completed within a <strong>From</strong>–<strong>To</strong> date range. Both bounds are inclusive of the whole day.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Join Button Restrictions</div>\n            <div class=\"dss-guide-card-body\">\n                <p>For <strong>Family X</strong> members, join buttons are <strong>disabled</strong> when your CPR is below the minimum required for that role.</p>\n                <p>Hover (or tap on mobile) a disabled button to see the required CPR. This prevents members from joining roles they aren't ready for.</p>\n                <p>For all other factions, role sorting and weight labels still work but join buttons are never restricted.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Low CPR Highlighting</div>\n            <div class=\"dss-guide-card-body\">\n                <p>When enabled, members on the <strong>Recruiting</strong> and <strong>Planning</strong> tabs whose CPR is below the minimum set for their role get a <strong>red outline</strong> and a <em>CPR x / min y</em> strip at the bottom of their slot.</p>\n                <p>Open slots, unpaid roles and the Completed tab are ignored. Applies to the same factions as the join button restrictions.</p>\n                <label style=\"display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;\">\n                    <input type=\"checkbox\" id=\"dss-oc-lowcpr-toggle\" style=\"cursor:pointer;\" />\n                    <span>Highlight members below minimum CPR</span>\n                </label>\n                <div id=\"dss-oc-lowcpr-status\" style=\"margin-top:6px;font-size:11px;min-height:16px;\"></div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Success Chance Display</div>\n            <div class=\"dss-guide-card-body\">\n                <p>A colour-coded <strong>Success: XX%</strong> badge appears on each crime panel, calculated from the CPR values of all filled slots using the <em>tornprobability.com</em> API.</p>\n                <p>Colours range from green (90%+) through yellow/orange to red (&lt;40%).</p>\n            </div>\n        </div>\n            <div class=\"dss-guide-card\">\n        <div class=\"dss-guide-card-header\">Third-Party Data Sharing</div>\n        <div class=\"dss-guide-card-body\">\n            <p>To calculate success chances, this module sends crime <strong>role names</strong> and <strong>CPR success-chance values</strong> (read from the page) to <a href=\"https://tornprobability.com\" target=\"_blank\" style=\"color:var(--link-color,#60a5fa);\">tornprobability.com</a>. Your <strong>API key is never sent</strong> to this service — only the numeric values needed for the calculation.</p>\n            <p>This data is shared with the tornprobability service owners under <a href=\"https://www.torn.com/forums.php#/p=threads&f=67&t=16449041&b=0&a=0\" target=\"_blank\" style=\"color:var(--link-color,#60a5fa);\">their terms of service</a>. If you disable this module, no data is sent.</p>\n        </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Keyboard Shortcut</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Press <strong>Ctrl+Shift+P</strong> to force a re-process of all visible crimes (useful if the page updated and sorting didn't trigger).</p>\n            </div>\n        </div>\n    ";

// src/modules/crime-prioritiser/index.js
	registerModule("crime-prioritiser", {
		name: "Faction OC Prioritiser",
		version: "1.5",
		description: "Reorder crime roles by weight priority, show weight tooltips with CPR requirements, display overall success chance, show completion dates on completed crimes, filter completed crimes by date, restrict join buttons for specific factions, optionally highlight members below a role's minimum CPR, and reorder the Recruiting panel by pause priority (paused first, then soonest-to-pause).",
		pages: [
			"/factions.php",
			"/organizedcrimes.php",
			"/city.php"
		],
		guide: guide_default$10,
		init() {
			const LOWCPR_KEY = "dss_oc_lowcpr_highlight";
			const lowCprEnabled = GM_getValue(LOWCPR_KEY, "0") === "1";
			function wireLowCprToggle() {
				const cb = document.getElementById("dss-oc-lowcpr-toggle");
				if (!cb || cb.dataset.wired) return;
				cb.dataset.wired = "1";
				cb.checked = GM_getValue(LOWCPR_KEY, "0") === "1";
				const status = document.getElementById("dss-oc-lowcpr-status");
				cb.addEventListener("change", () => {
					GM_setValue(LOWCPR_KEY, cb.checked ? "1" : "0");
					if (status) {
						status.textContent = (cb.checked ? "✅ Enabled" : "Disabled") + " — reload the crimes page to apply";
						status.style.color = cb.checked ? "#4caf50" : "#999";
					}
				});
			}
			if (!/\/(factions|organizedcrimes)\.php/.test(window.location.pathname)) {
				setInterval(wireLowCprToggle, 1e3);
				return;
			}
			const DEBUG = false;
			const cls = (p) => `:is([class^="${p}___"], [class*=" ${p}___"])`;
			const S = {
				scenario: cls("scenario"),
				wrapper: cls("wrapper"),
				panelTitle: cls("panelTitle"),
				contentLayer: cls("contentLayer"),
				successChance: cls("successChance"),
				joinButton: cls("joinButton"),
				tabName: cls("tabName"),
				title: cls("title"),
				panelBody: cls("panelBody"),
				chainLink: cls("chainLink")
			};
			function getSlots(root) {
				if (!root || !root.querySelectorAll) return [];
				const out = [];
				root.querySelectorAll(S.successChance).forEach((sc) => {
					let n = sc.parentElement;
					while (n && n !== root) {
						if (n.matches(S.wrapper) && n.querySelector(S.title)) {
							if (!out.includes(n)) out.push(n);
							break;
						}
						n = n.parentElement;
					}
				});
				return out;
			}
			const API_WEIGHTS_URL = "https://tornprobability.com:3000/api/GetRoleWeights";
			const API_BASE_URL = "https://tornprobability.com:3000";
			const RESTRICTED_FACTION_IDS = [
				"9528",
				"29107",
				"9357",
				"18560"
			];
			const UNPAID_FACTION_ID = "9357";
			function useBannerDate() {
				return IS_PDA || window.innerWidth <= 768;
			}
			let weightData = {};
			let scenarioData = {};
			let weightDataLoaded = false;
			let currentFactionId = null;
			function log(...args) {
				if (DEBUG) console.log("[DSS Crime Prioritiser]", ...args);
			}
			function logError(...args) {
				console.error("[DSS Crime Prioritiser]", ...args);
			}
			const csvData = `crime_name,role_name,min_cpr
                        First Aid and Abet,Decoy,68
                        First Aid and Abet,Picklock,68
                        First Aid and Abet,Pickpocket,68
                        Mob Mentality,Looter #1,68
                        Mob Mentality,Looter #2,68
                        Mob Mentality,Looter #3,68
                        Mob Mentality,Looter #4,68
                        Pet Project,Kidnapper,68
                        Pet Project,Muscle,68
                        Pet Project,Picklock,68
                        Best of the Lot,Car Thief,68
                        Best of the Lot,Imitator,68
                        Best of the Lot,Muscle,68
                        Best of the Lot,Picklock,68
                        Cash Me If You Can,Lookout,68
                        Cash Me If You Can,Thief #1,68
                        Cash Me If You Can,Thief #2,68
                        Thou Shalt Not Steal,Picklock,68
                        Thou Shalt Not Steal,Pickpocket,68
                        Thou Shalt Not Steal,Thief,68
                        Gaslight The Way,Imitator #1,68
                        Gaslight The Way,Imitator #2,68
                        Gaslight The Way,Imitator #3,68
                        Gaslight The Way,Looter #1,68
                        Gaslight The Way,Looter #2,68
                        Gaslight The Way,Looter #3,68
                        Market Forces,Arsonist,68
                        Market Forces,Enforcer,68
                        Market Forces,Lookout,68
                        Market Forces,Muscle,68
                        Market Forces,Negotiator,68
                        Smoke And Wing Mirrors,Car Thief,68
                        Smoke And Wing Mirrors,Hustler #1,68
                        Smoke And Wing Mirrors,Hustler #2,68
                        Smoke And Wing Mirrors,Imitator,68
                        Plucking the Lotus Petal,Hustler,68
                        Plucking the Lotus Petal,Muscle,68
                        Plucking the Lotus Petal,Robber #1,68
                        Plucking the Lotus Petal,Robber #2,68
                        Snow Blind,Hustler,68
                        Snow Blind,Imitator,68
                        Snow Blind,Muscle #1,68
                        Snow Blind,Muscle #2,68
                        Stage Fright,Enforcer,70
                        Stage Fright,Lookout,67
                        Stage Fright,Muscle #1,70
                        Stage Fright,Muscle #2,60
                        Stage Fright,Muscle #3,67
                        Stage Fright,Sniper,70
                        Counter Offer,Engineer,70
                        Counter Offer,Hacker,70
                        Counter Offer,Looter,70
                        Counter Offer,Picklock,70
                        Counter Offer,Robber,70
                        Guardian Ángels,Enforcer,70
                        Guardian Ángels,Engineer,70
                        Guardian Ángels,Hustler,70
                        Honey Trap,Enforcer,60
                        Honey Trap,Muscle #1,70
                        Honey Trap,Muscle #2,70
                        No Reserve,Car Thief,68
                        No Reserve,Engineer,68
                        No Reserve,Techie,68
                        Bidding War,Bomber #1,60
                        Bidding War,Bomber #2,65
                        Bidding War,Driver,65
                        Bidding War,Robber #1,60
                        Bidding War,Robber #2,65
                        Bidding War,Robber #3,70
                        Dish It Out,Assassin,70
                        Dish It Out,Engineer,67
                        Dish It Out,Muscle,70
                        Dish It Out,Saboteur #1,67
                        Dish It Out,Saboteur #2,67
                        Leave No Trace,Imitator,70
                        Leave No Trace,Negotiator,67
                        Leave No Trace,Techie,67
                        Sneaky Git Grab,Hacker,68
                        Sneaky Git Grab,Imitator,68
                        Sneaky Git Grab,Pickpocket,72
                        Sneaky Git Grab,Techie,68
                        Cleared for Takeoff,Interrogator,70
                        Cleared for Takeoff,Imitator,70
                        Cleared for Takeoff,Assassin,66
                        Cleared for Takeoff,Pickpocket,66
                        Cleared for Takeoff,Techie,66
                        Cleared for Takeoff,Lookout,66
                        Blast From The Past,Bomber,70
                        Blast From The Past,Engineer,70
                        Blast From The Past,Hacker,66
                        Blast From The Past,Muscle,73
                        Blast From The Past,Picklock #1,66
                        Blast From The Past,Picklock #2,UNPAID
                        Window of Opportunity,Engineer,65
                        Window of Opportunity,Looter #1,65
                        Window of Opportunity,Looter #2,77
                        Window of Opportunity,Muscle #1,77
                        Window of Opportunity,Muscle #2,65
                        Break The Bank,Muscle #1,64
                        Break The Bank,Muscle #2,63
                        Break The Bank,Muscle #3,68
                        Break The Bank,Robber,64
                        Break The Bank,Thief #1,UNPAID
                        Break The Bank,Thief #2,68
                        Clinical Precision,Assassin,66
                        Clinical Precision,Cat Burglar,68
                        Clinical Precision,Cleaner,68
                        Clinical Precision,Imitator,72
                        Lock Stock,Smuggler,68
                        Lock Stock,Assassin,72
                        Lock Stock,Muscle #1,68
                        Lock Stock,Muscle #2,68
                        Lock Stock,Hacker,68
                        Manifest Cruelty,Hacker,100
                        Manifest Cruelty,Interrogator,100
                        Manifest Cruelty,Reviver,100
                        Manifest Cruelty,Cat Burglar,100
                        Ship Happens,Spy,70
                        Ship Happens,Engineer,65
                        Ship Happens,Hustler,65
                        Ship Happens,Assassin,65
                        Ship Happens,Interrogator,70
                        Stacking The Deck,Cat Burglar,68
                        Stacking The Deck,Driver,UNPAID
                        Stacking The Deck,Hacker,68
                        Stacking The Deck,Imitator,70
                        Ace In The Hole,Driver,61
                        Ace In The Hole,Hacker,67
                        Ace In The Hole,Imitator,69
                        Ace In The Hole,Muscle #1,67
                        Ace In The Hole,Muscle #2,67
                        Hostile Takeover,Kidnapper,67
                        Hostile Takeover,Engineer,67
                        Hostile Takeover,Cat Burglar,67
                        Hostile Takeover,Muscle,69
                        Hostile Takeover,Hacker,67
                        Hostile Takeover,Negotiator,69
                        Gone Fission,Bomber,100
                        Gone Fission,Engineer,100
                        Gone Fission,Hijacker,100
                        Gone Fission,Imitator,100
                        Gone Fission,Pickpocket,100
                        Crane Reaction,Bomber,100
                        Crane Reaction,Engineer,100
                        Crane Reaction,Lookout,100
                        Crane Reaction,Muscle #1,100
                        Crane Reaction,Muscle #2,100
                        Crane Reaction,Sniper,100`;
			const crimePriorities = {};
			function parseCSV() {
				const lines = csvData.trim().split("\n");
				for (let i = 1; i < lines.length; i++) {
					const parts = lines[i].split(",");
					if (parts.length < 3) continue;
					const crimeName = parts[0].trim();
					const roleName = parts[1].trim();
					const minCpr = parts[2].trim().toUpperCase();
					if (!crimePriorities[crimeName]) {
						crimePriorities[crimeName] = {};
					}
					const isUnpaid = minCpr === "UNPAID";
					crimePriorities[crimeName][roleName] = {
						minCpr: minCpr === "OPEN" || isUnpaid ? null : parseInt(minCpr),
						unpaid: isUnpaid
					};
				}
			}
			function normalize(str) {
				return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
			}
			function normalizeRoleName(name) {
				return name.replace(/\s*#\d+$/, "").trim();
			}
			function normalizeRoleForAPI(roleName) {
				let normalized = roleName.replace(/\s*#(\d+)$/, (match, num) => num);
				return normalize(normalized);
			}
			function getRolePriority(crimeName, roleName) {
				if (crimePriorities[crimeName]) {
					return findRoleInCrime(crimePriorities[crimeName], roleName);
				}
				const lowerCrimeName = crimeName.toLowerCase();
				for (const crime in crimePriorities) {
					if (crime.toLowerCase() === lowerCrimeName) {
						return findRoleInCrime(crimePriorities[crime], roleName);
					}
				}
				return null;
			}
			function findRoleInCrime(crimeData, roleName) {
				if (crimeData[roleName]) return crimeData[roleName];
				const normalizedRole = normalizeRoleName(roleName);
				for (const role in crimeData) {
					if (normalizeRoleName(role) === normalizedRole) {
						return crimeData[role];
					}
				}
				return null;
			}
			function getPriorityColor(normalizedPriority) {
				if (normalizedPriority <= .5) {
					const t = normalizedPriority * 2;
					const r = 139 + (255 - 139) * t;
					const g = 0 + (165 - 0) * t;
					const b = 0;
					return `rgb(${Math.round(r)}, ${Math.round(g)}, ${b})`;
				} else {
					const t = (normalizedPriority - .5) * 2;
					const r = 255 + (144 - 255) * t;
					const g = 165 + (238 - 165) * t;
					const b = 0 + (144 - 0) * t;
					return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
				}
			}
			function detectFactionId() {
				const hashMatch = window.location.hash.match(/factionID=(\d+)/i);
				if (hashMatch) {
					currentFactionId = hashMatch[1];
					log("Faction ID from URL hash:", currentFactionId);
					return;
				}
				try {
					const factionEl = document.querySelector("[class*=\"faction-info\"], [class*=\"factionName\"]");
					if (factionEl) {
						const fiberKey = Object.keys(factionEl).find((k) => k.startsWith("__reactFiber$"));
						if (fiberKey) {
							const fiber = factionEl[fiberKey];
							let node = fiber;
							for (let i = 0; i < 20 && node; i++) {
								if (node.memoizedProps?.factionId) {
									currentFactionId = String(node.memoizedProps.factionId);
									log("Faction ID from React fiber:", currentFactionId);
									return;
								}
								node = node.return;
							}
						}
					}
				} catch (e) {}
				const factionLink = document.querySelector("a[href*=\"factions.php?step=profile&ID=\"]");
				if (factionLink) {
					const linkMatch = factionLink.href.match(/ID=(\d+)/);
					if (linkMatch) {
						currentFactionId = linkMatch[1];
						log("Faction ID from sidebar link:", currentFactionId);
						return;
					}
				}
				const scripts = document.querySelectorAll("script:not([src])");
				for (const script of scripts) {
					const match = script.textContent.match(/factionID["\s:=]+(\d+)/);
					if (match) {
						currentFactionId = match[1];
						log("Faction ID from inline script:", currentFactionId);
						return;
					}
				}
				log("Could not detect faction ID from DOM");
			}
			function isRestrictedFaction() {
				return currentFactionId && RESTRICTED_FACTION_IDS.includes(currentFactionId);
			}
			function showUnpaidMarkers() {
				return currentFactionId === UNPAID_FACTION_ID;
			}
			async function detectFactionIdFromAPI() {
				if (currentFactionId) return;
				const apiKey = Storage.getSettings().apiKey;
				if (!apiKey) {
					log("No API key available for faction ID lookup");
					return;
				}
				try {
					const response = await fetch(`${API_BASE}/user/faction`, { headers: tornAuth(apiKey) });
					const data = await response.json();
					if (data?.error) {
						logError("Faction ID API error:", data.error);
						return;
					}
					if (data?.faction?.id != null) {
						currentFactionId = String(data.faction.id);
						log("Faction ID from API:", currentFactionId);
					} else {
						log("No faction.id in API response", data);
					}
				} catch (e) {
					logError("Failed to fetch faction ID from API:", e);
				}
			}
			function addTooltipStyles() {
				const style = document.createElement("style");
				style.textContent = `
            .crime-priority-tooltip {
                position: relative;
                cursor: not-allowed;
            }
            .join-button-disabled {
                opacity: 0.5;
                cursor: not-allowed !important;
            }
            .role-priority-label {
                font-size: 11px;
                font-weight: bold;
                color: #666;
                margin-bottom: 4px;
                padding: 2px 6px;
                background: rgba(0, 0, 0, 0.05);
                border-radius: 3px;
                display: block;
                text-align: center;
            }
            /* When another script (e.g. TornTools) highlights the slot green,
               the pale chip washes out — float a darker chip with light text
               over the green so the weight stays legible. */
            .role-priority-label.role-label-on-green {
                color: #f0f0f0;
                background: rgba(0, 0, 0, 0.4);
            }
            /* UNPAID marker: an in-flow strip at the bottom of the slot. It only
               adds height below the existing content, so the label/role rows
               above stay aligned across the row, and it's always contained. */
            .role-unpaid-tag {
                display: block;
                margin: 4px 4px 0;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: bold;
                letter-spacing: 0.3px;
                line-height: 14px;
                text-align: center;
                color: #ff5c5c;
                background: rgba(0, 0, 0, 0.55);
                border: 1px solid rgba(244, 67, 54, 0.6);
                white-space: nowrap;
            }
                        /* Low CPR: member in a role below the CSV minimum. Outline is inset
               so it isn't clipped by the roles row; bg isn't !important so it
               doesn't stomp other scripts' highlights. */
            .role-lowcpr-slot {
                outline: 2px solid #f44336 !important;
                outline-offset: -2px;
                background-color: rgba(244, 67, 54, 0.12);
            }
            .role-lowcpr-tag {
                display: block;
                margin: 4px 4px 0;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: bold;
                line-height: 14px;
                text-align: center;
                color: #ff5c5c;
                background: rgba(0, 0, 0, 0.55);
                border: 1px solid rgba(244, 67, 54, 0.6);
                white-space: nowrap;
            }
            [class^="panelBody___"], [class*=" panelBody___"] {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .oc-success-display {
                display: inline-block;
                padding: 4px 10px;
                border-left-width: 3px;
                border-left-style: solid;
                border-radius: 4px;
                font-weight: bold;
                font-size: 12px;
                white-space: nowrap;
                margin-right: auto;
            }
            @media (max-width: 768px) {
                .oc-success-display {
                    font-size: 11px;
                    padding: 3px 8px;
                }
            }
            /* Recruiting-panel pause-priority badge */
            .oc-priority-display {
                display: inline-block;
                padding: 4px 10px;
                border-left: 3px solid;
                border-radius: 4px;
                font-weight: bold;
                font-size: 12px;
                white-space: nowrap;
                margin-right: 8px;
            }
            @media (max-width: 768px) {
                .oc-priority-display {
                    font-size: 11px;
                    padding: 3px 8px;
                }
            }
            /* Paused crime: red ring on the panel + roles (real boxes, unlike
               layout-only wrappers which may render no outline). */
            .oc-paused-block {
                box-shadow: 0 0 0 2px #f44336 !important;
                border-radius: 6px;
            }
            /* Priority badge overlaid on the crime banner (PDA / narrow), matching
               where the completed-date badge sits on the Completed page. Colours
               stay inline; this only handles positioning. */
            .oc-priority-host { position: relative; }
            .oc-priority-display--banner {
                position: absolute;
                top: 8px;
                left: 8px;
                z-index: 5;
                margin: 0 !important;
                white-space: nowrap;
                text-align: left;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            }
            .oc-completed-display {
                display: inline-block;
                padding: 4px 10px;
                border-left: 3px solid #60a5fa;
                border-radius: 4px;
                font-weight: bold;
                font-size: 12px;
                white-space: nowrap;
                background: rgba(96, 165, 250, 0.1);
                color: #60a5fa;
                margin-right: 6px;
            }
            @media (max-width: 768px) {
                .oc-completed-display {
                    font-size: 11px;
                    padding: 3px 8px;
                    display: block;
                    width: 100%;
                    flex-basis: 100%;
                    box-sizing: border-box;
                    white-space: nowrap;
                    text-align: center;
                    margin: 0 0 4px 0;
                    order: -1;
                }
                .dss-oc-header-row {
                    flex-wrap: wrap;
                }
            }
            .dss-date-filter-bar {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 10px;
                padding: 8px 12px;
                margin-bottom: 8px;
                background: var(--tt-panel-color, #2e2e2e);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 6px;
                font-size: 12px;
                color: var(--tt-primary-text-color, #ddd);
            }
            .dss-date-filter-bar .dss-df-label { font-weight: bold; }
            .dss-date-filter-bar label { display: inline-flex; align-items: center; gap: 4px; }
            .dss-date-filter-bar input[type="date"] {
                background: #1a1a1a; color: #eee; border: 1px solid #555;
                border-radius: 4px; padding: 3px 6px; font-size: 12px; color-scheme: dark;
            }
            .dss-date-filter-bar button {
                background: #444; color: #eee; border: 1px solid #666;
                border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px;
            }
            .dss-date-filter-bar button:hover { background: #555; }
            .dss-date-filter-bar .dss-df-count { margin-left: auto; opacity: 0.8; }
            @media (max-width: 768px) {
                .dss-date-filter-bar {
                    flex-direction: column;
                    align-items: stretch;
                }
                .dss-date-filter-bar label {
                    display: grid;
                    grid-template-columns: 42px 1fr;
                    align-items: center;
                    gap: 4px;
                    justify-items: start;
                }
                .dss-date-filter-bar input[type="date"] {
                    width: 100%;
                    margin-left: 0;
                }
                .dss-date-filter-bar .dss-df-count {
                    margin-left: 0;
                }
            }
            /* Completion date shown inside the big success banner (PDA / narrow) */
            .oc-completed-display--banner {
                position: absolute;
                top: 8px;
                left: 8px;
                z-index: 5;
                display: inline-block;
                width: auto;
                flex-basis: auto;
                order: 0;
                margin: 0;
                white-space: nowrap;
                text-align: left;
                background: rgba(0, 0, 0, 0.6);
                color: #fff;
                border-left: 3px solid #60a5fa;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            }
            #dss-tooltip {
                position: fixed;
                background: #000;
                color: #fff;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                white-space: nowrap;
                pointer-events: none;
                z-index: 2147483647;
                box-shadow: 0 2px 6px rgba(0,0,0,0.4);
                left: -9999px;
                top: -9999px;
            }
            `;
				document.head.appendChild(style);
				const tooltip = document.createElement("div");
				tooltip.id = "dss-tooltip";
				document.body.appendChild(tooltip);
				document.addEventListener("mouseover", (e) => {
					const target = e.target.closest(".crime-priority-tooltip");
					if (target) {
						const text = target.getAttribute("data-priority");
						if (text) {
							tooltip.textContent = text;
							tooltip.style.display = "block";
						}
					}
				});
				document.addEventListener("mousemove", (e) => {
					if (tooltip.style.display === "block") {
						const tooltipWidth = tooltip.offsetWidth;
						const tooltipHeight = tooltip.offsetHeight;
						const viewportWidth = window.innerWidth;
						const viewportHeight = window.innerHeight;
						let left = e.clientX + 12;
						let top = e.clientY + 12;
						if (left + tooltipWidth > viewportWidth - 8) left = e.clientX - tooltipWidth - 12;
						if (top + tooltipHeight > viewportHeight - 8) top = e.clientY - tooltipHeight - 12;
						left = Math.max(8, left);
						top = Math.max(8, top);
						tooltip.style.left = left + "px";
						tooltip.style.top = top + "px";
					}
				});
				document.addEventListener("mouseout", (e) => {
					const target = e.target.closest(".crime-priority-tooltip");
					if (target) tooltip.style.display = "none";
				});
				document.addEventListener("touchstart", (e) => {
					const target = e.target.closest(".crime-priority-tooltip");
					if (target) {
						const text = target.getAttribute("data-priority");
						if (text) {
							const touch = e.touches[0];
							const touchX = touch.clientX;
							const touchY = touch.clientY;
							const viewportWidth = window.innerWidth;
							tooltip.textContent = text;
							requestAnimationFrame(() => {
								requestAnimationFrame(() => {
									const tw = tooltip.offsetWidth;
									const th = tooltip.offsetHeight;
									let left = touchX - tw / 2;
									let top = touchY - th - 16;
									if (left + tw > viewportWidth - 8) left = viewportWidth - tw - 8;
									left = Math.max(8, left);
									if (top < 8) top = touchY + 16;
									tooltip.style.left = left + "px";
									tooltip.style.top = top + "px";
								});
							});
							e.stopPropagation();
						}
					} else {
						tooltip.style.left = "-9999px";
						tooltip.style.top = "-9999px";
					}
				}, { passive: false });
				document.addEventListener("touchmove", () => {
					tooltip.style.left = "-9999px";
					tooltip.style.top = "-9999px";
				}, { passive: true });
			}
			function getRoleCPR(roleSlot) {
				const cprElement = roleSlot.querySelector(`${S.successChance}`);
				return cprElement ? parseInt(cprElement.textContent.trim()) : null;
			}
			function checkRequirements(priorityInfo, userCpr) {
				if (priorityInfo.minCpr !== null) {
					if (userCpr === null) return {
						allowed: true,
						reason: null
					};
					if (userCpr < priorityInfo.minCpr) {
						return {
							allowed: false,
							reason: `CPR Too Low (Req: ${priorityInfo.minCpr})`
						};
					}
				}
				return {
					allowed: true,
					reason: null
				};
			}
			function isGreenBg(colorStr) {
				const m = (colorStr || "").match(/rgba?\(([^)]+)\)/);
				if (!m) return false;
				const p = m[1].split(",").map((s) => parseFloat(s.trim()));
				const r = p[0], g = p[1], b = p[2], a = p.length > 3 ? p[3] : 1;
				if (!a) return false;
				return g > 60 && g > r + 25 && g > b + 25;
			}
			function slotHasGreenHighlight(slot) {
				let node = slot;
				for (let i = 0; i < 3 && node; i++) {
					if (isGreenBg(getComputedStyle(node).backgroundColor)) return true;
					node = node.parentElement;
				}
				return false;
			}
			function addPriorityLabel(roleSlot, weight, onGreen) {
				const existingLabel = roleSlot.querySelector(".role-priority-label");
				if (existingLabel) existingLabel.remove();
				const label = document.createElement("div");
				label.className = "role-priority-label" + (onGreen ? " role-label-on-green" : "");
				label.textContent = `Weight: ${weight.toFixed(1)}%`;
				roleSlot.insertBefore(label, roleSlot.firstChild);
			}
			function setUnpaidTag(roleSlot, unpaid) {
				let tag = roleSlot.querySelector(".role-unpaid-tag");
				if (!unpaid) {
					if (tag) tag.remove();
					return;
				}
				if (!tag) {
					tag = document.createElement("div");
					tag.className = "role-unpaid-tag";
					tag.textContent = "UNPAID";
				}
				if (roleSlot.lastElementChild !== tag) roleSlot.appendChild(tag);
			}
			function setLowCprTag(roleSlot, info) {
				let tag = roleSlot.querySelector(".role-lowcpr-tag");
				if (!info) {
					if (tag) tag.remove();
					roleSlot.classList.remove("role-lowcpr-slot");
					return;
				}
				roleSlot.classList.add("role-lowcpr-slot");
				if (!tag) {
					tag = document.createElement("div");
					tag.className = "role-lowcpr-tag";
				}
				const text = `CPR ${info.cpr} / min ${info.min}`;
				if (tag.textContent !== text) tag.textContent = text;
				if (roleSlot.lastElementChild !== tag) roleSlot.appendChild(tag);
			}
			function getRoleWeight(ocNameRaw, roleNameRaw) {
				const ocKey = normalize(ocNameRaw);
				const roleKey = normalizeRoleForAPI(roleNameRaw);
				let ocWeights = weightData[ocKey];
				if (!ocWeights) {
					for (const [key, weights] of Object.entries(weightData)) {
						if (key === ocKey || key.includes(ocKey) || ocKey.includes(key)) {
							ocWeights = weights;
							break;
						}
					}
				}
				if (!ocWeights) return null;
				const weight = ocWeights[roleKey];
				return weight != null ? weight : null;
			}
			async function callOCAPI(endpoint, data = null, timeout = 1e4) {
				return new Promise((resolve, reject) => {
					const timeoutId = setTimeout(() => reject(new Error("Timeout")), timeout);
					gmRequest({
						method: data ? "POST" : "GET",
						url: `${API_BASE_URL}/${endpoint}`,
						headers: data ? { "Content-Type": "application/json" } : {},
						data: data ? JSON.stringify(data) : null,
						onload: (response) => {
							clearTimeout(timeoutId);
							try {
								const text = response?.responseText || response?.response || (typeof response === "string" ? response : "");
								const result = JSON.parse(text);
								if (response.status >= 200 && response.status < 300) {
									resolve(result);
								} else {
									reject(new Error(result.error || "API error"));
								}
							} catch (err) {
								reject(err);
							}
						},
						onerror: (err) => {
							clearTimeout(timeoutId);
							reject(new Error(err?.statusText || err?.message || "XHR failed"));
						}
					});
				});
			}
			async function fetchScenarioData() {
				try {
					const [supportedScenarios, roleMappings] = await Promise.all([callOCAPI("api/GetSupportedScenarios"), callOCAPI("api/GetRoleNames")]);
					scenarioData = supportedScenarios.reduce((acc, scenario) => {
						const roles = roleMappings[scenario.name];
						if (roles) {
							acc[scenario.name] = {
								paramCount: scenario.parameters,
								paramOrder: Object.keys(roles).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, scenario.parameters)
							};
						}
						return acc;
					}, {});
					log("Loaded scenario data");
				} catch (error) {
					logError("Failed to initialize scenario data:", error);
				}
			}
			let successChanceTimeoutLogged = false;
			async function processOCSuccessChance(element) {
				try {
					const ocName = element.querySelector(`${S.panelTitle}`)?.textContent?.trim();
					const scenario = scenarioData[ocName];
					if (!scenario) return;
					let rolesWrapper = null;
					const isCompletedContainer = element.hasAttribute("data-oc-id");
					if (isCompletedContainer) {
						const internalRoles = getSlots(element);
						if (internalRoles.length > 0) rolesWrapper = element;
					} else {
						const nextSibling = element.nextElementSibling;
						if (nextSibling) {
							const siblingRoles = getSlots(nextSibling);
							if (siblingRoles.length > 0) rolesWrapper = nextSibling;
						}
					}
					if (!rolesWrapper) return;
					const slots = getSlots(rolesWrapper);
					const parameters = scenario.paramOrder.map((slotKey) => {
						const slot = slots.find((s) => {
							const fiberKey = Object.keys(s).find((k) => k.startsWith("__reactFiber$"));
							const fiberNode = s[fiberKey];
							return fiberNode?.return?.key === `slot-${slotKey}`;
						});
						const chanceText = slot?.querySelector(`${S.successChance}`)?.textContent;
						return chanceText ? parseFloat(chanceText.replace("%", "")) : 0;
					});
					if (parameters.length !== scenario.paramCount) return;
					const result = await callOCAPI("api/CalculateSuccess", {
						scenario: ocName,
						parameters
					});
					if (result?.successChance) {
						injectSuccessChance(element, result.successChance);
					}
				} catch (error) {
					if (error.message === "Timeout" && !successChanceTimeoutLogged) {
						logError("OC success chance API timing out - silencing further timeout errors");
						successChanceTimeoutLogged = true;
					} else if (error.message !== "Timeout") {
						logError("OC success chance processing failed:", error);
					}
				}
			}
			function injectSuccessChance(element, chance) {
				const chainLinkButton = element.querySelector(`${S.chainLink}`);
				if (!chainLinkButton) return;
				const existingDisplay = element.querySelector(".oc-success-display");
				if (existingDisplay) existingDisplay.remove();
				const display = document.createElement("div");
				display.className = "oc-success-display";
				const percentage = Math.floor(chance * 100);
				display.textContent = `Success: ${percentage}%`;
				let bgColor, borderColor, textColor;
				if (percentage >= 90) {
					bgColor = "rgba(76, 175, 80, 0.1)";
					borderColor = "#4caf50";
					textColor = "#4caf50";
				} else if (percentage >= 75) {
					bgColor = "rgba(139, 195, 74, 0.1)";
					borderColor = "#8bc34a";
					textColor = "#8bc34a";
				} else if (percentage >= 60) {
					bgColor = "rgba(255, 193, 7, 0.1)";
					borderColor = "#ffc107";
					textColor = "#ffc107";
				} else if (percentage >= 40) {
					bgColor = "rgba(255, 152, 0, 0.1)";
					borderColor = "#ff9800";
					textColor = "#ff9800";
				} else {
					bgColor = "rgba(244, 67, 54, 0.1)";
					borderColor = "#f44336";
					textColor = "#f44336";
				}
				display.style.background = bgColor;
				display.style.borderLeftColor = borderColor;
				display.style.color = textColor;
				chainLinkButton.parentNode.insertBefore(display, chainLinkButton);
			}
			const HOUR = 3600;
			const SLOT_HOURS = 24;
			const RECRUITING_PRIORITY_PAUSE_WINDOW_HOURS = 24;
			function isOnRecruitingTab() {
				if (!window.location.hash.includes("tab=crimes") && !window.location.pathname.includes("organizedcrimes")) return false;
				let recruitingActive = false, anyActive = false;
				document.querySelectorAll(`${S.tabName}`).forEach((btn) => {
					const text = (btn.textContent || "").trim().toLowerCase();
					const parent = btn.parentElement;
					const pc = parent?.className || "";
					const active = pc.includes("active") || parent?.getAttribute("aria-selected") === "true" || parent?.classList.contains("ui-state-active");
					if (active) anyActive = true;
					if (active && text.includes("recruit")) recruitingActive = true;
					if (active && text.includes("completed")) recruitingActive = false;
				});
				if (recruitingActive) return true;
				if (anyActive) return false;
				const cl = document.querySelector(`${S.contentLayer}`);
				const hasScenario = cl && cl.querySelector(`${S.scenario}`);
				const hasCompleted = document.querySelector(`${S.wrapper}[data-oc-id]`);
				const hasOpenSlot = cl && cl.querySelector(`${S.joinButton}, [class*="waitingJoin___"], [class*="joinContainer___"]`);
				return !!(hasScenario && hasOpenSlot && !hasCompleted);
			}
			function isCrimePaused(scenario) {
				const region = scenario.querySelector("[class*=\"phase___\"]") || scenario.firstElementChild || scenario;
				for (const el of region.querySelectorAll("[aria-label]")) {
					if (/^\s*paused\s*$/i.test(el.getAttribute("aria-label") || "")) return true;
				}
				for (const el of scenario.querySelectorAll("span,div")) {
					const t = (el.textContent || "").trim();
					if (t.length <= 12 && /^paused$/i.test(t)) return true;
				}
				return false;
			}
			function isEmptySlot(slot) {
				return !!slot.querySelector("[class*=\"joinContainer___\"], [class*=\"joinButton___\"]") || /waitingjoin/i.test(slot.className);
			}
			function parseAriaDuration(label) {
				let s = 0;
				const d = label.match(/(\d+)\s*day/i);
				if (d) s += +d[1] * 86400;
				const h = label.match(/(\d+)\s*hour/i);
				if (h) s += +h[1] * 3600;
				const m = label.match(/(\d+)\s*minute/i);
				if (m) s += +m[1] * 60;
				const x = label.match(/(\d+)\s*second/i);
				if (x) s += +x[1];
				return s;
			}
			function parseColonTime(txt) {
				const parts = txt.trim().split(":").map(Number);
				if (parts.some(isNaN)) return null;
				const r = parts.reverse();
				return (r[0] || 0) + (r[1] || 0) * 60 + (r[2] || 0) * 3600 + (r[3] || 0) * 86400;
			}
			function getRemainingSeconds(scenario) {
				const region = scenario.querySelector("[class*=\"phase___\"]") || scenario;
				const labelled = Array.from(region.querySelectorAll("[aria-label]")).find((el) => /\d+\s*(day|hour|minute|second)/i.test(el.getAttribute("aria-label") || ""));
				if (labelled) {
					const s = parseAriaDuration(labelled.getAttribute("aria-label"));
					if (s > 0) return s;
				}
				const span = Array.from(region.querySelectorAll("span")).find((el) => /^\d{1,2}(:\d{2}){2,3}$/.test((el.textContent || "").trim()));
				if (span) {
					const s = parseColonTime(span.textContent);
					if (s != null) return s;
				}
				return null;
			}
			function humanizeDuration(secs) {
				if (secs <= 0) return "imminent";
				const d = Math.floor(secs / 86400), h = Math.floor(secs % 86400 / 3600), m = Math.floor(secs % 3600 / 60);
				if (d > 0) return `${d}d ${h}h`;
				if (h > 0) return `${h}h ${m}m`;
				return `${m}m`;
			}
			function getCrimeUnit(scenario) {
				const nodes = [scenario];
				let n = scenario.nextElementSibling;
				while (n && !n.matches(S.scenario)) {
					nodes.push(n);
					n = n.nextElementSibling;
				}
				return nodes;
			}
			function computeCrimeInfo(scenario) {
				const unit = getCrimeUnit(scenario);
				const roles = unit.find((n) => getSlots(n).length > 0) || null;
				const slots = roles ? getSlots(roles) : [];
				const total = slots.length;
				let empty = 0;
				slots.forEach((s) => {
					if (isEmptySlot(s)) empty++;
				});
				const paused = isCrimePaused(scenario);
				const remaining = getRemainingSeconds(scenario);
				const timeToPause = remaining == null ? null : remaining - empty * SLOT_HOURS * HOUR;
				return {
					scenario,
					roles,
					total,
					empty,
					filled: total - empty,
					paused,
					remaining,
					timeToPause
				};
			}
			function recruitingTier(item) {
				const t = item.timeToPause;
				if (t == null || !isFinite(t)) return 1;
				if (t < RECRUITING_PRIORITY_PAUSE_WINDOW_HOURS * HOUR) return 0;
				return 2;
			}
			function crimeSortCmp(a, b) {
				if (a.paused !== b.paused) return a.paused ? -1 : 1;
				if (a.paused && b.paused) {
					if (a.empty !== b.empty) return a.empty - b.empty;
					return (a.remaining ?? Infinity) - (b.remaining ?? Infinity);
				}
				const ta = recruitingTier(a), tb = recruitingTier(b);
				if (ta !== tb) return ta - tb;
				if (ta === 1) {
					if (a.empty !== b.empty) return a.empty - b.empty;
					return (a.remaining ?? Infinity) - (b.remaining ?? Infinity);
				}
				if (a.timeToPause !== b.timeToPause) return a.timeToPause - b.timeToPause;
				if (a.empty !== b.empty) return a.empty - b.empty;
				return (a.remaining ?? Infinity) - (b.remaining ?? Infinity);
			}
			function injectPriorityLabel(item, rank) {
				const container = item.scenario;
				let badge = container.querySelector(".oc-priority-display");
				if (!badge) {
					badge = document.createElement("div");
					badge.className = "oc-priority-display";
				}
				let text, bg, border, color;
				if (item.paused) {
					text = `Priority #${rank} - Paused`;
					bg = "rgba(244,67,54,0.15)";
					border = "#f44336";
					color = "#ff6b6b";
				} else {
					const t = item.timeToPause;
					const when = t == null || !isFinite(t) ? "Recruiting" : humanizeDuration(t);
					text = `Priority #${rank} - ${when}`;
					if (t == null || !isFinite(t)) {
						bg = "rgba(96,165,250,0.12)";
						border = "#60a5fa";
						color = "#60a5fa";
					} else if (t < 12 * HOUR) {
						bg = "rgba(255,152,0,0.15)";
						border = "#ff9800";
						color = "#ff9800";
					} else if (t < 24 * HOUR) {
						bg = "rgba(255,193,7,0.12)";
						border = "#ffc107";
						color = "#ffc107";
					} else if (t < 48 * HOUR) {
						bg = "rgba(139,195,74,0.12)";
						border = "#8bc34a";
						color = "#8bc34a";
					} else {
						bg = "rgba(76,175,80,0.12)";
						border = "#4caf50";
						color = "#4caf50";
					}
				}
				if (badge.textContent !== text) badge.textContent = text;
				badge.style.background = bg;
				badge.style.borderLeftColor = border;
				badge.style.color = color;
				if (useBannerDate()) {
					badge.classList.add("oc-priority-display--banner");
					badge.style.background = "rgba(0,0,0,0.6)";
					const banner = container.querySelector("[class*=\"phase___\"]");
					const host = banner || container;
					host.classList.add("oc-priority-host");
					if (badge.parentNode !== host) host.appendChild(badge);
					return;
				}
				badge.classList.remove("oc-priority-display--banner");
				container.querySelectorAll(".oc-priority-host").forEach((el) => {
					el.classList.remove("oc-priority-host");
					if (el.style.position === "relative") el.style.position = "";
				});
				const panelBody = container.querySelector(`${S.panelBody}`) || container.querySelector("[class*=\"panelBody___\"]");
				if (!panelBody) return;
				if (badge.parentNode !== panelBody || panelBody.firstChild !== badge) {
					panelBody.insertBefore(badge, panelBody.firstChild);
				}
			}
			function findListContainer(scenarios) {
				const total = scenarios.length;
				let node = scenarios[0].parentNode;
				while (node) {
					if (node.querySelectorAll && node.querySelectorAll(`${S.scenario}`).length >= total) return node;
					node = node.parentNode;
				}
				return scenarios[0].parentNode;
			}
			function blockOf(scenario, container) {
				let n = scenario;
				while (n && n.parentNode && n.parentNode !== container) n = n.parentNode;
				return n && n.parentNode === container ? n : null;
			}
			function blockUnit(block) {
				const nodes = [block];
				let n = block.nextElementSibling;
				while (n && !(n.matches && (n.matches(S.scenario) || n.querySelector(S.scenario)))) {
					nodes.push(n);
					n = n.nextElementSibling;
				}
				return nodes;
			}
			let reorderInFlight = false;
			function reorderAndLabel() {
				if (reorderInFlight || !isOnRecruitingTab()) return;
				const scenarios = Array.from(document.querySelectorAll(`${S.contentLayer} ${S.scenario}`));
				if (!scenarios.length) return;
				const all = scenarios.map(computeCrimeInfo).filter((it) => it.roles);
				const items = [];
				all.forEach((it) => {
					if (it.empty > 0) {
						items.push(it);
						return;
					}
					it.scenario.classList.remove("oc-paused-block");
					if (it.roles) it.roles.classList.remove("oc-paused-block");
				});
				if (!items.length) return;
				items.sort(crimeSortCmp);
				items.forEach((it, i) => injectPriorityLabel(it, i + 1));
				const container = findListContainer(scenarios);
				const desired = [];
				const seen = new Set();
				items.forEach((it) => {
					const block = blockOf(it.scenario, container);
					if (!block || seen.has(block)) return;
					seen.add(block);
					it.scenario.classList.toggle("oc-paused-block", !!it.paused);
					if (it.roles) it.roles.classList.toggle("oc-paused-block", !!it.paused);
					blockUnit(block).forEach((n) => {
						if (n.parentNode === container) desired.push(n);
					});
				});
				if (desired.length < 2) return;
				const set = new Set(desired);
				const domOrder = Array.from(container.children).filter((c) => set.has(c));
				const already = domOrder.length === desired.length && domOrder.every((n, i) => n === desired[i]);
				if (already) return;
				reorderInFlight = true;
				try {
					const endAnchor = domOrder[domOrder.length - 1].nextSibling;
					desired.forEach((n) => container.insertBefore(n, endAnchor));
				} finally {
					setTimeout(() => {
						reorderInFlight = false;
					}, 0);
				}
			}
			let reorderTimeout = null;
			function debouncedReorder() {
				if (reorderTimeout) clearTimeout(reorderTimeout);
				reorderTimeout = setTimeout(() => {
					try {
						reorderAndLabel();
					} catch (e) {}
				}, 150);
			}
			const PAGE_LIMIT = 100;
			const executedAtMap = {};
			let nextOffset = 0;
			let morePages = true;
			let pageFetchInFlight = false;
			const dateFilterState = {
				fromRaw: "",
				toRaw: "",
				from: null,
				to: null
			};
			async function fetchCompletedPage() {
				if (!morePages || pageFetchInFlight) return false;
				const apiKey = Storage.getSettings().apiKey;
				if (!apiKey) {
					log("No API key for completed crimes fetch");
					return false;
				}
				pageFetchInFlight = true;
				try {
					const url = `${API_BASE}/faction/crimes?cat=completed` + `&limit=${PAGE_LIMIT}&offset=${nextOffset}&sort=DESC`;
					const res = await fetch(url, { headers: tornAuth(apiKey) });
					const data = await res.json();
					if (data?.error) {
						logError("Torn API error:", data.error);
						morePages = false;
						return false;
					}
					const crimes = data?.crimes || [];
					for (const c of crimes) {
						if (c && c.id != null && c.executed_at != null) {
							executedAtMap[String(c.id)] = c.executed_at;
						}
					}
					const hasNext = !!data?._metadata?.links?.next;
					morePages = hasNext && crimes.length > 0;
					nextOffset += PAGE_LIMIT;
					log(`Fetched completed page: +${crimes.length} crimes (offset now ${nextOffset}, more: ${morePages})`);
					return true;
				} catch (e) {
					logError("Failed to fetch completed crimes page:", e);
					return false;
				} finally {
					pageFetchInFlight = false;
				}
			}
			let ensureInFlight = false;
			async function ensureDatesForVisible() {
				if (ensureInFlight) return;
				ensureInFlight = true;
				try {
					let guard = 0;
					while (guard++ < 50) {
						const ids = Array.from(document.querySelectorAll(`${S.wrapper}[data-oc-id]`)).map((el) => el.getAttribute("data-oc-id")).filter(Boolean);
						const missing = ids.filter((id) => executedAtMap[id] === undefined);
						if (missing.length === 0) break;
						if (!morePages) break;
						const fetched = await fetchCompletedPage();
						if (!fetched) break;
						renderCompletedDates();
					}
					renderCompletedDates();
					applyDateFilter();
				} finally {
					ensureInFlight = false;
				}
			}
			function formatDateTime(unixSeconds) {
				const d = new Date(unixSeconds * 1e3);
				return d.toLocaleString("en-GB", {
					day: "2-digit",
					month: "short",
					year: "numeric",
					hour: "2-digit",
					minute: "2-digit"
				});
			}
			function injectCompletedDate(container, executedAt) {
				let display = container.querySelector(".oc-completed-display");
				if (!display) {
					display = document.createElement("div");
					display.className = "oc-completed-display";
				}
				display.textContent = `Completed: ${formatDateTime(executedAt)}`;
				if (useBannerDate()) {
					display.classList.add("oc-completed-display--banner");
					if (getComputedStyle(container).position === "static") {
						container.style.position = "relative";
					}
					const banner = container.querySelector("[class*=\"phase___\"]") || container;
					const host = banner === container ? container : banner.parentNode || container;
					if (display.parentNode !== host) {
						host.appendChild(display);
					}
					return;
				}
				display.classList.remove("oc-completed-display--banner");
				const chainLinkButton = container.querySelector(`${S.chainLink}`);
				if (!chainLinkButton) return;
				const parent = chainLinkButton.parentNode;
				parent.classList.add("dss-oc-header-row");
				const successBox = parent.querySelector(".oc-success-display");
				const ref = successBox || chainLinkButton;
				if (display.parentNode !== parent || display.nextSibling !== ref) {
					parent.insertBefore(display, ref);
				}
			}
			function renderCompletedDates() {
				document.querySelectorAll(`${S.wrapper}[data-oc-id]`).forEach((container) => {
					const id = container.getAttribute("data-oc-id");
					const executedAt = executedAtMap[id];
					if (executedAt != null) {
						container.dataset.executedAt = String(executedAt);
						injectCompletedDate(container, executedAt);
					}
				});
			}
			function applyDateFilterToContainer(container) {
				const { from, to } = dateFilterState;
				if (from === null && to === null) {
					container.style.display = "";
					return;
				}
				const executedAt = container.dataset.executedAt ? parseInt(container.dataset.executedAt) : null;
				if (executedAt === null || isNaN(executedAt)) {
					container.style.display = "";
					return;
				}
				let visible = true;
				if (from !== null && executedAt < from) visible = false;
				if (to !== null && executedAt > to) visible = false;
				container.style.display = visible ? "" : "none";
			}
			function applyDateFilter() {
				const containers = document.querySelectorAll(`${S.wrapper}[data-oc-id]`);
				let shown = 0;
				containers.forEach((c) => {
					applyDateFilterToContainer(c);
					if (c.style.display !== "none") shown++;
				});
				const countEl = document.querySelector("#dss-date-filter-bar .dss-df-count");
				if (countEl) {
					countEl.textContent = dateFilterState.from !== null || dateFilterState.to !== null ? `Showing ${shown} of ${containers.length}` : "";
				}
			}
			function getCompletedListParent() {
				const firstCompleted = document.querySelector(`${S.wrapper}[data-oc-id]`);
				if (firstCompleted && firstCompleted.parentNode) return firstCompleted.parentNode;
				return document.querySelector(`${S.contentLayer}`);
			}
			function ensureDateFilterBar(show) {
				let bar = document.getElementById("dss-date-filter-bar");
				if (!show) {
					if (bar) bar.style.display = "none";
					return;
				}
				if (!bar) {
					bar = document.createElement("div");
					bar.id = "dss-date-filter-bar";
					bar.className = "dss-date-filter-bar";
					bar.innerHTML = `
                    <span class="dss-df-label">Filter by completion date</span>
                    <label>From <input type="date" id="dss-df-from"></label>
                    <label>To <input type="date" id="dss-df-to"></label>
                    <button type="button" id="dss-df-clear">Clear</button>
                    <span class="dss-df-count"></span>`;
					const fromInput = bar.querySelector("#dss-df-from");
					const toInput = bar.querySelector("#dss-df-to");
					const onChange = () => {
						dateFilterState.fromRaw = fromInput.value;
						dateFilterState.toRaw = toInput.value;
						dateFilterState.from = fromInput.value ? Math.floor(new Date(fromInput.value + "T00:00:00").getTime() / 1e3) : null;
						dateFilterState.to = toInput.value ? Math.floor(new Date(toInput.value + "T23:59:59").getTime() / 1e3) : null;
						ensureDatesForVisible();
						applyDateFilter();
					};
					fromInput.addEventListener("change", onChange);
					toInput.addEventListener("change", onChange);
					bar.querySelector("#dss-df-clear").addEventListener("click", () => {
						fromInput.value = "";
						toInput.value = "";
						Object.assign(dateFilterState, {
							fromRaw: "",
							toRaw: "",
							from: null,
							to: null
						});
						applyDateFilter();
					});
				}
				bar.querySelector("#dss-df-from").value = dateFilterState.fromRaw;
				bar.querySelector("#dss-df-to").value = dateFilterState.toRaw;
				const parent = getCompletedListParent();
				if (parent && (bar.parentNode !== parent || parent.firstChild !== bar)) {
					parent.insertBefore(bar, parent.firstChild);
				}
				bar.style.display = "";
				applyDateFilter();
			}
			let isProcessing = false;
			function processCrimes(retryCount = 0) {
				if (isProcessing) return;
				isProcessing = true;
				try {
					if (!window.location.hash.includes("tab=crimes") && !window.location.pathname.includes("organizedcrimes")) {
						return;
					}
					if (!weightDataLoaded) {
						log("Weight data not loaded yet, skipping processing...");
						return;
					}
					const restrictJoinButtons = isRestrictedFaction();
					const markUnpaid = showUnpaidMarkers();
					const highlightLowCpr = lowCprEnabled && isRestrictedFaction();
					let isOnCompletedTab = false;
					const urlHash = window.location.hash;
					if (urlHash.includes("completed")) {
						isOnCompletedTab = true;
					}
					if (!isOnCompletedTab) {
						const tabButtons = document.querySelectorAll(`${S.tabName}`);
						tabButtons.forEach((btn) => {
							const text = btn.textContent?.trim();
							const parent = btn.parentElement;
							const parentClasses = parent?.className || "";
							const isActive = parentClasses.includes("active") || parent?.getAttribute("aria-selected") === "true" || parent?.classList.contains("ui-state-active");
							if (text === "Completed" && isActive) {
								isOnCompletedTab = true;
							}
						});
					}
					if (!isOnCompletedTab) {
						const hasVisibleDataOcId = Array.from(document.querySelectorAll(`${S.wrapper}[data-oc-id]`)).some((el) => el.offsetParent !== null);
						const hasVisibleScenario = Array.from(document.querySelectorAll(`${S.scenario}`)).some((el) => el.offsetParent !== null);
						if (hasVisibleDataOcId && !hasVisibleScenario) {
							isOnCompletedTab = true;
						}
					}
					const crimeContainers = document.querySelectorAll(`${S.contentLayer} ${S.scenario}, ${S.wrapper}[data-oc-id]`);
					if (crimeContainers.length === 0 && retryCount < 5) {
						setTimeout(() => processCrimes(retryCount + 1), 300);
						return;
					}
					log(`Processing ${crimeContainers.length} crime containers (completed tab: ${isOnCompletedTab}, restricted: ${restrictJoinButtons})`);
					crimeContainers.forEach((container) => {
						const crimeNameElement = container.querySelector(`${S.panelTitle}`);
						if (!crimeNameElement) return;
						const crimeName = crimeNameElement.textContent.trim();
						if (!container.querySelector(".oc-success-display")) {
							processOCSuccessChance(container);
						}
						let rolesWrapper = null;
						const isCompletedContainer = container.hasAttribute("data-oc-id");
						if (isOnCompletedTab && !isCompletedContainer) return;
						if (!isOnCompletedTab && isCompletedContainer) return;
						if (isCompletedContainer) {
							const internalRoles = getSlots(container);
							if (internalRoles.length > 0) rolesWrapper = container;
						}
						if (!rolesWrapper && container.matches(S.scenario)) {
							const nextSibling = container.nextElementSibling;
							if (nextSibling) {
								const siblingRoles = getSlots(nextSibling);
								if (siblingRoles.length > 0) rolesWrapper = nextSibling;
							}
						}
						if (!rolesWrapper) return;
						const roleSlots = getSlots(rolesWrapper);
						const roleData = roleSlots.map((slot) => {
							const titleElement = slot.querySelector(`${S.title}`);
							if (!titleElement) return null;
							const roleName = titleElement.textContent.trim();
							const priorityInfo = getRolePriority(crimeName, roleName);
							const userCpr = getRoleCPR(slot);
							let weight = getRoleWeight(crimeName, roleName);
							if (weight !== null && Math.abs(weight) < .01) weight = 0;
							return {
								element: slot,
								roleName,
								weight: weight || 0,
								priorityInfo,
								userCpr
							};
						}).filter((item) => item !== null);
						if (!isCompletedContainer) {
							roleData.sort((a, b) => b.weight - a.weight);
						}
						const maxWeight = Math.max(...roleData.map((r) => r.weight));
						const allWeights = roleData.map((r) => Math.max(0, r.weight)).filter((w) => w !== null);
						const minWeight = Math.min(...allWeights);
						roleData.forEach((r) => {
							r.lowCpr = highlightLowCpr && !isCompletedContainer && !isEmptySlot(r.element) && r.priorityInfo && r.priorityInfo.minCpr !== null && r.userCpr !== null && r.userCpr < r.priorityInfo.minCpr;
						});
						const crimeHasUnpaid = markUnpaid && !isCompletedContainer && roleData.some((r) => !!r.priorityInfo?.unpaid);
						const crimeHasTag = crimeHasUnpaid || roleData.some((r) => r.lowCpr);
						roleData.forEach((item, index) => {
							if (!isCompletedContainer) {
								item.element.style.order = index;
							} else {
								item.element.style.order = "";
							}
							item.element.style.alignSelf = crimeHasTag ? "flex-start" : "";
							if (item.element.style.borderLeftStyle === "dashed") {
								item.element.style.borderLeftStyle = "solid";
							}
							const isUnpaidSlot = markUnpaid && !isCompletedContainer && !!item.priorityInfo?.unpaid;
							const onGreen = slotHasGreenHighlight(item.element);
							if (item.weight !== null) {
								addPriorityLabel(item.element, Math.max(0, item.weight), onGreen);
							}
							setUnpaidTag(item.element, isUnpaidSlot);
							setLowCprTag(item.element, item.lowCpr ? {
								cpr: item.userCpr,
								min: item.priorityInfo.minCpr
							} : null);
							if (restrictJoinButtons) {
								const joinButton = item.element.querySelector(`${S.joinButton}, button[type="button"].torn-btn`);
								if (joinButton && item.priorityInfo) {
									const requirementCheck = checkRequirements(item.priorityInfo, item.userCpr);
									if (!requirementCheck.allowed) {
										joinButton.classList.add("join-button-disabled");
										joinButton.setAttribute("disabled", "true");
										joinButton.classList.add("crime-priority-tooltip");
										joinButton.setAttribute("data-priority", requirementCheck.reason);
									} else {
										joinButton.classList.remove("join-button-disabled");
										joinButton.removeAttribute("disabled");
										joinButton.classList.remove("crime-priority-tooltip");
										joinButton.removeAttribute("data-priority");
									}
								}
							}
							if (item.weight !== null && maxWeight > minWeight) {
								const effectiveWeight = Math.max(0, item.weight);
								let normalizedWeight = (effectiveWeight - minWeight) / (maxWeight - minWeight);
								normalizedWeight = Math.max(0, Math.min(1, normalizedWeight));
								const color = getPriorityColor(1 - normalizedWeight);
								item.element.style.borderLeft = `4px solid ${color}`;
							}
						});
					});
					if (isOnCompletedTab) {
						ensureDatesForVisible();
					}
					ensureDateFilterBar(isOnCompletedTab);
					if (!isOnCompletedTab) reorderAndLabel();
				} finally {
					isProcessing = false;
				}
			}
			let processTimeout = null;
			function debouncedProcess() {
				if (processTimeout) clearTimeout(processTimeout);
				processTimeout = setTimeout(() => processCrimes(), 100);
			}
			function fetchWeightData() {
				return new Promise((resolve, reject) => {
					gmRequest({
						method: "GET",
						url: API_WEIGHTS_URL,
						onload: (response) => {
							try {
								const text = response?.responseText || response?.response || (typeof response === "string" ? response : "");
								const data = JSON.parse(text);
								weightData = {};
								for (const [ocName, roles] of Object.entries(data)) {
									const ocKey = normalize(ocName);
									weightData[ocKey] = {};
									for (const [roleName, value] of Object.entries(roles)) {
										weightData[ocKey][normalize(roleName)] = value;
									}
								}
								weightDataLoaded = true;
								resolve();
							} catch (err) {
								logError("Failed to parse weight API response:", err);
								reject(err);
							}
						},
						onerror: (err) => {
							logError("Weight API request failed:", err);
							reject(err);
						}
					});
				});
			}
			async function start() {
				parseCSV();
				addTooltipStyles();
				detectFactionId();
				await fetchScenarioData();
				await fetchWeightData();
				await detectFactionIdFromAPI();
				log(`Faction ID: ${currentFactionId}, Restricted: ${isRestrictedFaction()}, Unpaid markers: ${showUnpaidMarkers()}`);
				if (document.readyState === "loading") {
					document.addEventListener("DOMContentLoaded", processCrimes);
				} else {
					processCrimes();
				}
				document.addEventListener("click", (e) => {
					const target = e.target.closest(`${S.tabName}, .crimeNav___abc123`);
					if (target) {
						const textContent = target.textContent || "";
						if (textContent.includes("CRIMES") || textContent.includes("Recruiting") || textContent.includes("Planning") || textContent.includes("Completed")) {
							document.querySelectorAll(`${S.wrapper}.oc-processed, ${S.scenario}.oc-processed`).forEach((el) => {
								el.classList.remove("oc-processed");
							});
							setTimeout(processCrimes, 500);
						}
					}
				}, true);
				window.addEventListener("click", (e) => {
					if (!isRestrictedFaction()) return;
					const btn = e.target.closest?.(`${S.joinButton}, button[type="button"].torn-btn`);
					if (!btn) return;
					let slot = btn.parentElement;
					while (slot && !(slot.matches(S.wrapper) && slot.querySelector(S.title) && slot.querySelector(S.successChance))) {
						slot = slot.parentElement;
					}
					if (!slot) return;
					let crimeName = null;
					for (let n = slot; n && n !== document.body; n = n.parentElement) {
						const prev = n.previousElementSibling;
						const titleHost = prev && prev.matches(S.scenario) ? prev : n.matches(`${S.wrapper}[data-oc-id]`) ? n : null;
						if (titleHost) {
							crimeName = titleHost.querySelector(S.panelTitle)?.textContent.trim() || null;
							break;
						}
					}
					if (!crimeName) return;
					const roleName = slot.querySelector(S.title).textContent.trim();
					const priorityInfo = getRolePriority(crimeName, roleName);
					if (!priorityInfo) return;
					const check = checkRequirements(priorityInfo, getRoleCPR(slot));
					if (check.allowed) return;
					e.preventDefault();
					e.stopImmediatePropagation();
					btn.classList.add("join-button-disabled", "crime-priority-tooltip");
					btn.setAttribute("disabled", "true");
					btn.setAttribute("data-priority", check.reason);
					log(`Blocked join: ${crimeName} / ${roleName} — ${check.reason}`);
				}, true);
				window.addEventListener("hashchange", () => {
					document.querySelectorAll(`${S.wrapper}.oc-processed, ${S.scenario}.oc-processed`).forEach((el) => {
						el.classList.remove("oc-processed");
					});
					setTimeout(processCrimes, 500);
				});
				let lastProcessedContent = "";
				const obsCallback = () => {
					const crimeContainers = document.querySelectorAll(`${S.contentLayer} ${S.scenario}, ${S.wrapper}[data-oc-id]`);
					if (crimeContainers.length > 0) {
						const currentContent = Array.from(crimeContainers).map((c) => {
							const title = c.querySelector(`${S.panelTitle}`);
							return title ? title.textContent : "";
						}).sort().join("|");
						if (currentContent && currentContent !== lastProcessedContent) {
							lastProcessedContent = currentContent;
							debouncedProcess();
						}
						debouncedReorder();
					}
				};
				const obs = new MutationObserver(obsCallback);
				obs.observe(document.body, {
					childList: true,
					subtree: true
				});
				document.addEventListener("keydown", (e) => {
					if (e.ctrlKey && e.shiftKey && e.key === "P") {
						processCrimes();
					}
				});
				setInterval(() => {
					try {
						reorderAndLabel();
					} catch (e) {}
				}, 3e4);
				console.log("[DSS Crime Prioritiser] Initialized successfully");
			}
			start();
		}
	});

// src/modules/oc-reminder/guide.html?raw
	var guide_default$9 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">What It Does</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Checks whether you are currently in an organised crime. If you're not, a blue reminder appears with a button that takes you straight to your faction's crimes page so you can join one.</p>\n                <p>The reminder is <strong>not shown to Recruits</strong> (or players without a faction), since they can't join a crime yet. Your faction position is re-checked hourly, so the reminder starts automatically after you're promoted.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Dismiss</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Dismissing the reminder (the × or Dismiss button) hides it for 2 minutes. After that, if you still haven't joined a crime, it reappears.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">API Usage</div>\n            <div class=\"dss-guide-card-body\">\n                <p>This module uses the API key configured in the DSS Setup page. To keep API usage low, the result is cached and shared across all your open tabs — while you're in a crime it barely checks at all (it waits until the crime is due to be ready). Before showing the reminder it always confirms you're still not in a crime, so it won't nag you right after you've joined. Your faction position is looked up at most once an hour.</p>\n            </div>\n        </div>\n    ";

// src/modules/oc-reminder/index.js
	registerModule("oc-reminder", {
		name: "OC Join Reminder",
		version: "1.2",
		hidden: true,
		controlledBy: "crime-prioritiser",
		description: "Reminds you to join an organised crime when you are not currently in one. Checks the Torn API sparingly and lets you dismiss the nudge for a couple of minutes.",
		pages: ["https://www.torn.com/"],
		guide: guide_default$9,
		init() {
			const API_URL = "https://api.torn.com/v2/user/organizedcrime";
			const FACTION_API_URL = "https://api.torn.com/v2/user/faction";
			const CRIMES_URL = "https://www.torn.com/factions.php?step=your&type=1#/tab=crimes";
			const STATE_KEY = "dss_oc_state";
			const NEXT_KEY = "dss_oc_nextCheck";
			const CHECKED_KEY = "dss_oc_checkedAt";
			const DISMISS_KEY = "dss_oc_dismissedUntil";
			const POSITION_KEY = "dss_oc_position";
			const POSITION_NEXT_KEY = "dss_oc_positionNext";
			const DISMISS_MS = 2 * 60 * 1e3;
			const MIN_API_GAP = 60 * 1e3;
			const NUDGE_RECHECK_MS = 3 * 60 * 1e3;
			const IN_CRIME_POLL_MS = 5 * 60 * 1e3;
			const INELIGIBLE_RECHECK_MS = 60 * 60 * 1e3;
			const TICK_MS = 20 * 1e3;
			const INELIGIBLE_POSITIONS = ["recruit"];
			const INACTIVE_STATUSES = [
				"expired",
				"failure",
				"successful"
			];
			let checkTimer = null;
			const getNum = (key) => parseInt(GM_getValue(key, "0"), 10) || 0;
			function invalidate() {
				GM_setValue(NEXT_KEY, "0");
			}
			let isTabFocused = document.hasFocus();
			window.addEventListener("focus", () => {
				isTabFocused = true;
				evaluate();
			});
			window.addEventListener("blur", () => {
				isTabFocused = false;
				closePrompt();
			});
			document.addEventListener("visibilitychange", () => {
				isTabFocused = document.visibilityState === "visible" && document.hasFocus();
				if (!isTabFocused) closePrompt();
				else evaluate();
			});
			function onCrimesPage() {
				return location.pathname.includes("/factions.php") && location.hash.includes("tab=crimes") || location.pathname.includes("/organizedcrimes.php");
			}
			function evaluate() {
				if (!isTabFocused) return;
				if (onCrimesPage()) {
					closePrompt();
					invalidate();
					return;
				}
				const apiKey = Storage.getSettings().apiKey;
				if (!apiKey) {
					closePrompt();
					return;
				}
				const now = Date.now();
				if (now < getNum(DISMISS_KEY)) {
					closePrompt();
					return;
				}
				const state = GM_getValue(STATE_KEY, null);
				const lockHeld = now < getNum(NEXT_KEY);
				const stale = now - getNum(CHECKED_KEY) > MIN_API_GAP;
				if (lockHeld && !(state === "out" && stale)) {
					reflectState(state);
					return;
				}
				if (lockHeld) {
					closePrompt();
					return;
				}
				check(apiKey);
			}
			function reflectState(state) {
				const now = Date.now();
				if (state === "out" && now >= getNum(DISMISS_KEY) && !onCrimesPage()) showPrompt();
				else closePrompt();
			}
			async function getPosition(apiKey) {
				const now = Date.now();
				const cached = GM_getValue(POSITION_KEY, null);
				if (cached !== null && now < getNum(POSITION_NEXT_KEY)) return cached;
				try {
					const res = await fetch(FACTION_API_URL, { headers: tornAuth(apiKey) });
					const data = await res.json();
					if (data?.error) {
						console.warn("[DSS OC Reminder] faction API error", data.error);
						return cached;
					}
					const fac = data?.faction;
					const position = fac?.id ? (fac.position || "").trim().toLowerCase() : "";
					GM_setValue(POSITION_KEY, position);
					GM_setValue(POSITION_NEXT_KEY, String(now + INELIGIBLE_RECHECK_MS));
					return position;
				} catch (e) {
					console.warn("[DSS OC Reminder] faction fetch failed", e);
					return cached;
				}
			}
			const isIneligible = (position) => position === "" || INELIGIBLE_POSITIONS.includes(position);
			async function check(apiKey) {
				GM_setValue(NEXT_KEY, String(Date.now() + MIN_API_GAP));
				const position = await getPosition(apiKey);
				if (position !== null && isIneligible(position)) {
					GM_setValue(STATE_KEY, "ineligible");
					GM_setValue(CHECKED_KEY, String(Date.now()));
					GM_setValue(NEXT_KEY, String(Date.now() + INELIGIBLE_RECHECK_MS));
					reflectState("ineligible");
					return;
				}
				try {
					const res = await fetch(API_URL, { headers: tornAuth(apiKey) });
					const data = await res.json();
					if (data?.error) {
						console.warn("[DSS OC Reminder] API error", data.error);
						closePrompt();
						return;
					}
					const oc = data?.organizedCrime;
					const status = (oc?.status || "").toLowerCase();
					const inCrime = !!(oc && oc.executed_at == null && !INACTIVE_STATUSES.includes(status));
					const now = Date.now();
					GM_setValue(STATE_KEY, inCrime ? "in" : "out");
					GM_setValue(CHECKED_KEY, String(now));
					let next;
					if (inCrime) {
						const readyMs = oc.ready_at ? oc.ready_at * 1e3 : 0;
						next = readyMs > now ? readyMs : now + IN_CRIME_POLL_MS;
					} else {
						next = now + NUDGE_RECHECK_MS;
					}
					GM_setValue(NEXT_KEY, String(Math.max(next, now + MIN_API_GAP)));
					reflectState(inCrime ? "in" : "out");
				} catch (e) {
					console.warn("[DSS OC Reminder] fetch failed", e);
					closePrompt();
				}
			}
			function showPrompt() {
				if (document.getElementById("oc-reminder-dialog")) return;
				const dialog = document.createElement("div");
				dialog.id = "oc-reminder-dialog";
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
				dialog.querySelector(".btn-join").addEventListener("click", () => {
					GM_setValue(DISMISS_KEY, String(Date.now() + DISMISS_MS));
					invalidate();
				});
				dialog.querySelector(".btn-dismiss").addEventListener("click", dismiss);
				dialog.querySelector(".dialog-close").addEventListener("click", dismiss);
			}
			function closePrompt() {
				const dialog = document.getElementById("oc-reminder-dialog");
				if (dialog) dialog.remove();
			}
			function dismiss() {
				GM_setValue(DISMISS_KEY, String(Date.now() + DISMISS_MS));
				closePrompt();
			}
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
			if (IS_PDA) {
				GM_addStyle("#oc-reminder-dialog { bottom: 20px; left: 50%; transform: translateX(-50%); }");
			} else {
				GM_addStyle("#oc-reminder-dialog { top: 20px; left: 20px; }");
			}
			evaluate();
			checkTimer = setInterval(evaluate, TICK_MS);
			window.addEventListener("beforeunload", () => {
				if (checkTimer) clearInterval(checkTimer);
			});
		}
	});

// src/modules/faction-family-buttons/guide.html?raw
	var guide_default$8 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Faction Buttons</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On your faction page, a collapsible <strong>Faction Buttons</strong> panel appears above the faction content. Add factions via the search bar, assign them types (Family, Friend, Reviver, Merc), and click the coloured buttons to navigate directly to their pages.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Editing Factions</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Click the <strong>✎</strong> edit button to open the search bar and edit panel. Search for factions by name, reorder within groups using ▲/▼, change types, toggle visibility, or delete entries. Changes apply instantly.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Settings</div>\n            <div class=\"dss-guide-card-body\">\n                <p><strong>Per Row</strong> — choose how many buttons per row (2–5). Hidden on mobile where it defaults to 2.</p>\n                <p><strong>All Profiles</strong> — when enabled, shows buttons on all configured faction profile pages, not just family type.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">API Key</div>\n            <div class=\"dss-guide-card-body\">\n                <p>This module uses the API key configured in the DSS Setup page for faction search and faction ID detection.</p>\n            </div>\n        </div>\n    ";

// src/modules/faction-family-buttons/index.js
	registerModule("faction-family-buttons", {
		name: "Faction Family Buttons",
		version: "1.0",
		description: "Quick-nav buttons for faction family, friends, revivers, and mercs on faction pages.",
		pages: ["/factions.php"],
		guide: guide_default$8,
		init() {
			const dssApiKey = Storage.getSettings().apiKey;
			document.querySelectorAll("#ffb-wrap, #ffb-nav-buttons").forEach((el) => el.remove());
			function loadSettings() {
				try {
					return JSON.parse(GM_getValue("ffb-settings", "{}"));
				} catch (_) {
					return {};
				}
			}
			function saveSettings(s) {
				GM_setValue("ffb-settings", JSON.stringify(s));
			}
			function loadFactions() {
				try {
					return JSON.parse(GM_getValue("ffb-factions", "[]"));
				} catch (_) {
					return [];
				}
			}
			function saveFactions(f) {
				GM_setValue("ffb-factions", JSON.stringify(f));
			}
			function loadCollapseState() {
				try {
					return JSON.parse(GM_getValue("ffb-collapse", "{}"));
				} catch (_) {
					return {};
				}
			}
			function saveCollapseState(s) {
				GM_setValue("ffb-collapse", JSON.stringify(s));
			}
			let settings = loadSettings();
			let factions = loadFactions();
			let collapseState = loadCollapseState();
			if (dssApiKey && dssApiKey !== settings.apiKey) {
				settings.apiKey = dssApiKey;
				saveSettings(settings);
			}
			function shouldShowOnPage() {
				const url = new URL(window.location.href);
				if (url.pathname !== "/factions.php") return false;
				const step = url.searchParams.get("step");
				const type = url.searchParams.get("type");
				const hash = url.hash;
				if (!settings.apiKey) return true;
				if (step === "your" && type === "1") {
					if (hash === "" || hash === "#/" || hash === "#") return true;
					if (hash === "#/war/chain" || hash === "#/war/rank") return true;
				}
				if (step === "profile") {
					const profileId = url.searchParams.get("ID");
					if (factions.some((f) => f.id === profileId && f.type === "family")) return true;
					if (settings.showOnAllProfiles) {
						if (factions.some((f) => f.id === profileId)) return true;
					}
				}
				return false;
			}
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
			let searchTimer = null;
			async function searchFactions(query) {
				if (!settings.apiKey || query.length < 3) return [];
				try {
					const url = new URL(`${API_BASE}/faction/search`);
					url.searchParams.set("name", query);
					url.searchParams.set("limit", "10");
					const res = await fetch(url, {
						method: "GET",
						headers: {
							"Accept": "application/json",
							"Authorization": "ApiKey " + settings.apiKey
						}
					});
					if (!res.ok) return [];
					const data = await res.json();
					return (data?.search || []).sort((a, b) => a.name.localeCompare(b.name));
				} catch (_) {
					return [];
				}
			}
			async function fetchMyFactionId() {
				if (!settings.apiKey) return;
				try {
					const res = await fetch(`${API_BASE}/faction/basic`, {
						method: "GET",
						headers: {
							"Accept": "application/json",
							"Authorization": "ApiKey " + settings.apiKey
						}
					});
					if (!res.ok) return;
					const data = await res.json();
					if (data?.basic?.id) {
						settings.myFactionId = data.basic.id.toString();
						saveSettings(settings);
					}
				} catch (_) {}
			}
			function getFactionLabel(f) {
				return f.displayName || f.name;
			}
			function getCurrentFactionId() {
				const url = new URL(window.location.href);
				if (url.searchParams.get("step") === "profile") return url.searchParams.get("ID");
				return settings.myFactionId || null;
			}
			function refreshAfterEdit() {
				renderFactionTags(document.getElementById("ffb-tags-row"));
				injectButtons();
			}
			let configVisible = GM_getValue("ffb-config-visible", false);
			let editMode = false;
			function buildConfigPanel() {
				const config = document.createElement("div");
				config.id = "ffb-config";
				if (configVisible) config.classList.add("config-open");
				const header = document.createElement("div");
				header.id = "ffb-config-header";
				header.innerHTML = `<span class="ffb-header-arrow ${configVisible ? "" : "collapsed"}">\u25BC</span><span class="ffb-header-label">Faction Buttons</span>`;
				header.addEventListener("click", () => {
					configVisible = !configVisible;
					GM_setValue("ffb-config-visible", configVisible);
					body.classList.toggle("ffb-expanded", configVisible);
					body.classList.toggle("ffb-collapsed", !configVisible);
					config.classList.toggle("config-open", configVisible);
					header.querySelector(".ffb-header-arrow").classList.toggle("collapsed", !configVisible);
					if (!configVisible && editMode) {
						editMode = false;
						editBtn.classList.remove("ffb-edit-active");
						editBtn.textContent = "✎";
						const panel = document.getElementById("ffb-edit-panel");
						if (panel) {
							panel.classList.remove("ffb-panel-expanded");
							panel.classList.add("ffb-panel-collapsed");
							panel.addEventListener("transitionend", () => panel.remove(), { once: true });
							setTimeout(() => {
								if (panel.parentNode) panel.remove();
							}, 400);
						}
					}
					const sr = document.getElementById("ffb-search-row");
					const tr = document.getElementById("ffb-tags-row");
					if (sr) sr.style.display = "none";
					if (tr) tr.style.display = "none";
				});
				config.appendChild(header);
				const body = document.createElement("div");
				body.id = "ffb-config-body";
				body.className = configVisible ? "ffb-expanded" : "ffb-collapsed";
				const topRow = document.createElement("div");
				topRow.className = "ffb-row";
				topRow.style.justifyContent = "space-between";
				const apiLeft = document.createElement("div");
				apiLeft.style.cssText = "display:flex;align-items:center;gap:6px;";
				const apiLabel = document.createElement("span");
				apiLabel.className = "ffb-label";
				apiLabel.style.minWidth = "55px";
				apiLabel.textContent = "API";
				const apiStatus = document.createElement("span");
				apiStatus.className = "ffb-btn" + (settings.apiKey ? " active" : "");
				apiStatus.textContent = settings.apiKey ? "✔" : "✖";
				apiStatus.title = settings.apiKey ? "API key configured via DSS Settings" : "No API key — configure in DSS Settings";
				apiStatus.style.cssText = "font-size:11px;padding:1px 6px;cursor:default;";
				apiLeft.appendChild(apiLabel);
				apiLeft.appendChild(apiStatus);
				topRow.appendChild(apiLeft);
				const profileToggleWrap = document.createElement("div");
				profileToggleWrap.className = "ffb-toggle-wrap";
				profileToggleWrap.title = "Show buttons on all configured faction profile pages (not just family)";
				const profileToggleLabel = document.createElement("span");
				profileToggleLabel.className = "ffb-label";
				profileToggleLabel.textContent = "All Profiles";
				const profileToggle = document.createElement("div");
				profileToggle.className = "ffb-toggle" + (settings.showOnAllProfiles ? " on" : "");
				profileToggleWrap.appendChild(profileToggleLabel);
				profileToggleWrap.appendChild(profileToggle);
				profileToggleWrap.addEventListener("click", () => {
					settings.showOnAllProfiles = !settings.showOnAllProfiles;
					saveSettings(settings);
					profileToggle.classList.toggle("on", settings.showOnAllProfiles);
				});
				topRow.appendChild(profileToggleWrap);
				const bprRight = document.createElement("div");
				const isMobile = window.innerWidth <= 784;
				bprRight.style.cssText = "display:" + (isMobile ? "none" : "flex") + ";align-items:center;gap:6px;";
				const bprLabel = document.createElement("span");
				bprLabel.className = "ffb-label";
				bprLabel.textContent = "Per Row";
				const bprWrap = document.createElement("div");
				bprWrap.className = "ffb-bpr-wrap";
				[
					2,
					3,
					4,
					5
				].forEach((n) => {
					const btn = document.createElement("button");
					btn.className = "ffb-bpr-btn" + ((settings.buttonsPerRow || 4) === n ? " active" : "");
					btn.textContent = n;
					btn.addEventListener("click", () => {
						settings.buttonsPerRow = n;
						saveSettings(settings);
						bprWrap.querySelectorAll(".ffb-bpr-btn").forEach((b) => b.classList.remove("active"));
						btn.classList.add("active");
						injectButtons();
					});
					bprWrap.appendChild(btn);
				});
				bprRight.appendChild(bprLabel);
				bprRight.appendChild(bprWrap);
				topRow.appendChild(bprRight);
				body.appendChild(topRow);
				body.appendChild(Object.assign(document.createElement("div"), { className: "ffb-row-break" }));
				const facRow = document.createElement("div");
				facRow.className = "ffb-row";
				const facLabel = document.createElement("span");
				facLabel.className = "ffb-label";
				facLabel.style.cssText = "flex-shrink:0;min-width:55px;";
				facLabel.textContent = "Factions";
				facRow.appendChild(facLabel);
				const editBtn = document.createElement("button");
				editBtn.className = "ffb-btn";
				editBtn.textContent = "✎";
				editBtn.title = "Edit factions";
				editBtn.style.flexShrink = "0";
				facRow.appendChild(editBtn);
				body.appendChild(facRow);
				const searchRow = document.createElement("div");
				searchRow.className = "ffb-row";
				searchRow.id = "ffb-search-row";
				searchRow.style.display = "none";
				const searchWrap = document.createElement("div");
				searchWrap.id = "ffb-search-wrap";
				const searchInput = document.createElement("input");
				searchInput.id = "ffb-search-input";
				searchInput.className = "ffb-input";
				searchInput.type = "text";
				searchInput.placeholder = "Search factions to add...";
				searchInput.style.width = "100%";
				searchInput.addEventListener("keydown", (e) => e.stopPropagation());
				searchInput.addEventListener("input", () => {
					clearTimeout(searchTimer);
					const q = searchInput.value.trim();
					if (q.length < 3) {
						closeDropdown();
						return;
					}
					searchTimer = setTimeout(async () => {
						const results = await searchFactions(q);
						renderDropdown(results);
					}, 300);
				});
				const dropdown = document.createElement("div");
				dropdown.id = "ffb-search-dropdown";
				searchWrap.appendChild(searchInput);
				searchWrap.appendChild(dropdown);
				searchRow.appendChild(searchWrap);
				body.appendChild(searchRow);
				const tagsRow = document.createElement("div");
				tagsRow.className = "ffb-row";
				tagsRow.id = "ffb-tags-row";
				tagsRow.style.cssText = "flex-wrap:wrap;padding:2px 10px 5px 10px;gap:4px;display:none;";
				renderFactionTags(tagsRow);
				body.appendChild(tagsRow);
				config.appendChild(body);
				editBtn.addEventListener("click", () => {
					editMode = !editMode;
					editBtn.classList.toggle("ffb-edit-active", editMode);
					editBtn.textContent = editMode ? "✔" : "✎";
					const sr = document.getElementById("ffb-search-row");
					const tr = document.getElementById("ffb-tags-row");
					if (sr) sr.style.display = editMode ? "flex" : "none";
					if (tr) tr.style.display = editMode ? "flex" : "none";
					let panel = document.getElementById("ffb-edit-panel");
					if (editMode) {
						if (!panel) {
							panel = buildEditPanel();
							config.appendChild(panel);
							requestAnimationFrame(() => {
								requestAnimationFrame(() => {
									panel.classList.remove("ffb-panel-collapsed");
									panel.classList.add("ffb-panel-expanded");
								});
							});
						}
					} else {
						if (panel) {
							panel.classList.remove("ffb-panel-expanded");
							panel.classList.add("ffb-panel-collapsed");
							panel.addEventListener("transitionend", () => panel.remove(), { once: true });
							setTimeout(() => {
								if (panel.parentNode) panel.remove();
							}, 400);
						}
						refreshAfterEdit();
					}
				});
				return config;
			}
			function renderFactionTags(container) {
				if (!container) return;
				container.innerHTML = "";
				const visible = factions.filter((f) => !f.hidden);
				if (visible.length === 0) {
					const hint = document.createElement("span");
					hint.className = "ffb-label";
					hint.style.color = "#555";
					hint.textContent = "No factions added. Use search to add.";
					container.appendChild(hint);
					return;
				}
				visible.forEach((f) => {
					const tag = document.createElement("span");
					tag.className = "ffb-faction-tag";
					tag.dataset.type = f.type || "family";
					tag.textContent = getFactionLabel(f);
					tag.title = `${getFactionLabel(f)} [${f.id}] \u2014 ${f.type || "family"}`;
					container.appendChild(tag);
				});
			}
			function renderDropdown(results) {
				const dropdown = document.getElementById("ffb-search-dropdown");
				if (!dropdown) return;
				if (results.length === 0) {
					dropdown.innerHTML = "<div class=\"ffb-suggestion\" style=\"color:#666;cursor:default;\">No results found</div>";
					dropdown.classList.add("show");
					return;
				}
				dropdown.innerHTML = results.map((r) => `<div class="ffb-suggestion" data-id="${r.id}" data-name="${escHtml(r.name)}">
                    <span class="ffb-suggestion-name">${escHtml(r.name)}</span>
                    <span class="ffb-suggestion-id">[${r.id}]</span>
                </div>`).join("");
				dropdown.classList.add("show");
				dropdown.querySelectorAll(".ffb-suggestion[data-id]").forEach((el) => {
					el.addEventListener("click", () => {
						addFaction(el.dataset.name, el.dataset.id);
						closeDropdown();
						document.getElementById("ffb-search-input").value = "";
					});
				});
			}
			function closeDropdown() {
				const d = document.getElementById("ffb-search-dropdown");
				if (d) d.classList.remove("show");
			}
			function addFaction(name, id) {
				if (factions.some((f) => f.id === id)) return;
				factions.push({
					name,
					id,
					displayName: name,
					type: "family",
					hidden: false
				});
				saveFactions(factions);
				refreshAfterEdit();
				const panel = document.getElementById("ffb-edit-panel");
				if (panel) rebuildEditRows(panel);
			}
			function buildEditPanel() {
				const panel = document.createElement("div");
				panel.id = "ffb-edit-panel";
				panel.className = "ffb-panel-collapsed";
				rebuildEditRows(panel);
				return panel;
			}
			function rebuildEditRows(panel) {
				panel.innerHTML = "";
				const typeOrder = [
					"family",
					"friend",
					"reviver",
					"merc"
				];
				const typeNames = {
					family: "Family",
					friend: "Friends",
					reviver: "Revivers",
					merc: "Mercs"
				};
				typeOrder.forEach((type) => {
					const groupFactions = factions.filter((f) => (f.type || "family") === type);
					if (groupFactions.length === 0) return;
					const groupHeader = document.createElement("div");
					groupHeader.style.cssText = "padding:4px 4px 2px;margin-top:4px;border-bottom:1px solid #333;";
					const groupLabel = document.createElement("span");
					groupLabel.className = "ffb-section-label";
					groupLabel.dataset.type = type;
					groupLabel.textContent = `${typeNames[type]} (${groupFactions.length})`;
					groupHeader.appendChild(groupLabel);
					panel.appendChild(groupHeader);
					groupFactions.forEach((f) => {
						const globalIdx = factions.indexOf(f);
						const groupIndices = groupFactions.map((gf) => factions.indexOf(gf));
						const posInGroup = groupFactions.indexOf(f);
						const row = document.createElement("div");
						row.className = "ffb-edit-row" + (f.hidden ? " ffb-edit-row-hidden" : "");
						const upBtn = document.createElement("button");
						upBtn.className = "ffb-edit-move";
						upBtn.textContent = "▲";
						upBtn.disabled = posInGroup === 0;
						upBtn.addEventListener("click", () => {
							const swapIdx = groupIndices[posInGroup - 1];
							[factions[swapIdx], factions[globalIdx]] = [factions[globalIdx], factions[swapIdx]];
							saveFactions(factions);
							rebuildEditRows(panel);
							refreshAfterEdit();
						});
						row.appendChild(upBtn);
						const downBtn = document.createElement("button");
						downBtn.className = "ffb-edit-move";
						downBtn.textContent = "▼";
						downBtn.disabled = posInGroup === groupFactions.length - 1;
						downBtn.addEventListener("click", () => {
							const swapIdx = groupIndices[posInGroup + 1];
							[factions[globalIdx], factions[swapIdx]] = [factions[swapIdx], factions[globalIdx]];
							saveFactions(factions);
							rebuildEditRows(panel);
							refreshAfterEdit();
						});
						row.appendChild(downBtn);
						const nameInput = document.createElement("input");
						nameInput.className = "ffb-input ffb-edit-name";
						nameInput.type = "text";
						nameInput.value = f.displayName || "";
						nameInput.placeholder = f.name;
						nameInput.addEventListener("keydown", (e) => e.stopPropagation());
						nameInput.addEventListener("change", () => {
							f.displayName = nameInput.value.trim() || f.name;
							saveFactions(factions);
							refreshAfterEdit();
						});
						nameInput.addEventListener("blur", () => nameInput.dispatchEvent(new Event("change")));
						row.appendChild(nameInput);
						const typeSelect = document.createElement("select");
						typeSelect.className = "ffb-edit-type";
						[
							"family",
							"friend",
							"reviver",
							"merc"
						].forEach((t) => {
							const opt = document.createElement("option");
							opt.value = t;
							opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
							if ((f.type || "family") === t) opt.selected = true;
							typeSelect.appendChild(opt);
						});
						typeSelect.addEventListener("change", () => {
							f.type = typeSelect.value;
							saveFactions(factions);
							rebuildEditRows(panel);
							refreshAfterEdit();
						});
						row.appendChild(typeSelect);
						const eye = document.createElement("button");
						eye.className = "ffb-edit-eye " + (f.hidden ? "ffb-edit-eye-off" : "ffb-edit-eye-on");
						eye.textContent = f.hidden ? "🚫" : "👁";
						eye.title = f.hidden ? "Show" : "Hide";
						eye.addEventListener("click", () => {
							f.hidden = !f.hidden;
							saveFactions(factions);
							eye.className = "ffb-edit-eye " + (f.hidden ? "ffb-edit-eye-off" : "ffb-edit-eye-on");
							eye.textContent = f.hidden ? "🚫" : "👁";
							eye.title = f.hidden ? "Show" : "Hide";
							row.classList.toggle("ffb-edit-row-hidden", f.hidden);
							refreshAfterEdit();
						});
						row.appendChild(eye);
						const del = document.createElement("button");
						del.className = "ffb-edit-del";
						del.textContent = "✖";
						del.title = "Remove faction";
						del.addEventListener("click", () => {
							factions.splice(globalIdx, 1);
							saveFactions(factions);
							rebuildEditRows(panel);
							refreshAfterEdit();
						});
						row.appendChild(del);
						panel.appendChild(row);
					});
				});
				if (factions.length === 0) {
					const empty = document.createElement("div");
					empty.className = "ffb-label";
					empty.style.cssText = "padding:12px;text-align:center;color:#555;";
					empty.textContent = "No factions added yet.";
					panel.appendChild(empty);
				}
				const resetRow = document.createElement("div");
				resetRow.style.cssText = "display:flex;justify-content:flex-end;padding-top:4px;border-top:1px solid #333;margin-top:2px;";
				const resetBtn = document.createElement("button");
				resetBtn.className = "ffb-btn";
				resetBtn.textContent = "Reset All";
				resetBtn.title = "Clear all factions and settings";
				resetBtn.style.cssText = "font-size:10px;padding:2px 10px;color:#ef4444;border-color:rgba(239,68,68,0.3);";
				resetBtn.addEventListener("click", () => {
					if (!confirm("Reset all faction button settings?\n\nThis will remove all factions.")) return;
					factions = [];
					settings = {
						apiKey: dssApiKey,
						myFactionId: settings.myFactionId
					};
					collapseState = {};
					saveFactions(factions);
					saveSettings(settings);
					saveCollapseState(collapseState);
					GM_setValue("ffb-config-visible", false);
					const navBtns = document.getElementById("ffb-nav-buttons");
					if (navBtns) navBtns.remove();
					const wrap = document.getElementById("ffb-wrap");
					if (wrap) {
						wrap.innerHTML = "";
						configVisible = false;
						editMode = false;
						wrap.appendChild(buildConfigPanel());
					}
				});
				resetRow.appendChild(resetBtn);
				panel.appendChild(resetRow);
			}
			function injectButtons() {
				const existing = document.getElementById("ffb-nav-buttons");
				if (existing) existing.remove();
				const visibleFactions = factions.filter((f) => !f.hidden);
				if (visibleFactions.length === 0) return;
				const groups = {};
				const typeOrder = [
					"family",
					"friend",
					"reviver",
					"merc"
				];
				visibleFactions.forEach((f) => {
					const t = f.type || "family";
					if (!groups[t]) groups[t] = [];
					groups[t].push(f);
				});
				const typeNames = {
					family: "Family",
					friend: "Friends",
					reviver: "Revivers",
					merc: "Mercs"
				};
				const currentFactionId = getCurrentFactionId();
				const isMobile = window.innerWidth <= 784;
				const cols = isMobile ? 2 : settings.buttonsPerRow || 4;
				const wrapper = document.createElement("div");
				wrapper.id = "ffb-nav-buttons";
				typeOrder.forEach((type) => {
					const group = groups[type];
					if (!group || group.length === 0) return;
					const collapseKey = `section-${type}`;
					const isCollapsed = collapseState[collapseKey] === true;
					const section = document.createElement("div");
					section.className = "ffb-button-section" + (isCollapsed ? "" : " section-open");
					const sHeader = document.createElement("div");
					sHeader.className = "ffb-section-header";
					sHeader.innerHTML = `<span class="ffb-section-arrow ${isCollapsed ? "collapsed" : ""}">\u25BC</span><span class="ffb-section-label" data-type="${type}">${typeNames[type] || type}</span><span class="ffb-section-count">(${group.length})</span>`;
					const sBody = document.createElement("div");
					sBody.className = "ffb-section-body " + (isCollapsed ? "ffb-collapsed" : "ffb-expanded");
					sHeader.addEventListener("click", () => {
						const nowCollapsed = sBody.classList.contains("ffb-expanded");
						sBody.classList.toggle("ffb-expanded", !nowCollapsed);
						sBody.classList.toggle("ffb-collapsed", nowCollapsed);
						section.classList.toggle("section-open", !nowCollapsed);
						sHeader.querySelector(".ffb-section-arrow").classList.toggle("collapsed", nowCollapsed);
						collapseState[collapseKey] = nowCollapsed;
						saveCollapseState(collapseState);
					});
					const grid = document.createElement("div");
					grid.className = "ffb-button-grid";
					group.forEach((f) => {
						const a = document.createElement("a");
						const isOwn = f.id === settings.myFactionId;
						a.href = isOwn ? "https://www.torn.com/factions.php?step=your&type=1" : `https://www.torn.com/factions.php?step=profile&ID=${f.id}`;
						a.className = "ffb-nav-btn";
						a.dataset.type = f.type || "family";
						a.style.flex = `0 0 calc(${100 / cols}% - ${(cols - 1) * 6 / cols}px)`;
						a.textContent = getFactionLabel(f);
						a.title = `${getFactionLabel(f)} [${f.id}]`;
						if (f.id === currentFactionId) a.classList.add("ffb-current");
						if (isOwn) a.addEventListener("click", (e) => {
							e.preventDefault();
							window.location.href = "https://www.torn.com/factions.php?step=your&type=1#";
						});
						grid.appendChild(a);
					});
					sBody.appendChild(grid);
					section.appendChild(sHeader);
					section.appendChild(sBody);
					wrapper.appendChild(section);
				});
				const configEl = document.getElementById("ffb-config");
				if (configEl && configEl.parentNode) configEl.parentNode.insertBefore(wrapper, configEl.nextSibling);
			}
			function findMountPoint() {
				return document.querySelector("hr.m-top10") || document.querySelector(".faction-info-wrap") || document.querySelector(".content-wrapper");
			}
			let mountPollTimer = null;
			function tryInjectFFB() {
				const dominated = shouldShowOnPage();
				const w = document.getElementById("ffb-wrap");
				const b = document.getElementById("ffb-nav-buttons");
				if (!dominated) {
					if (w) w.remove();
					if (b) b.remove();
					if (mountPollTimer) {
						clearInterval(mountPollTimer);
						mountPollTimer = null;
					}
					return;
				}
				if (w && w.querySelector("#ffb-config-header")) return;
				if (mountPollTimer) {
					clearInterval(mountPollTimer);
					mountPollTimer = null;
				}
				mountPollTimer = setInterval(() => {
					const mount = findMountPoint();
					const factionHeaderReady = document.querySelector("div.title-black.m-top10");
					if (mount && factionHeaderReady) {
						clearInterval(mountPollTimer);
						mountPollTimer = null;
						if (document.getElementById("ffb-wrap")) return;
						const wrap = document.createElement("div");
						wrap.id = "ffb-wrap";
						wrap.appendChild(buildConfigPanel());
						mount.insertAdjacentElement("beforebegin", wrap);
						if (factions.filter((f) => !f.hidden).length > 0) injectButtons();
					}
				}, 150);
				setTimeout(() => {
					if (mountPollTimer) {
						clearInterval(mountPollTimer);
						mountPollTimer = null;
					}
				}, 1e4);
			}
			if (settings.apiKey && !settings.myFactionId) fetchMyFactionId();
			tryInjectFFB();
			let lastUrl = window.location.href;
			setInterval(() => {
				if (window.location.href !== lastUrl) {
					lastUrl = window.location.href;
					tryInjectFFB();
				}
			}, 500);
			document.addEventListener("click", (e) => {
				if (!e.target.closest("#ffb-search-wrap")) closeDropdown();
			});
		}
	});

// src/modules/activity-stats/guide.html?raw
	var guide_default$7 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Profile Page - Activity Panel</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Visit any player's profile to see an <strong>Activity Stats</strong> panel at the bottom. Select a time period (3d, 1w, 2w, 1mo, 6mo, 1yr) to view stats like <strong>Xanax</strong>, <strong>Activity hours</strong>, <strong>Attacks won</strong>, <strong>Respect</strong>, <strong>Retals</strong>, <strong>Travel</strong>, <strong>SEs</strong>, and <strong>Networth</strong> change.</p>\n                <p>Click <strong>Export</strong> to copy a text summary to your clipboard for easy sharing.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Faction Page - Member Stats Table</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On faction pages, two extra columns (<strong>A</strong> = activity hours, <strong>X</strong> = xanax taken) are injected into the member table. Select a period and click <strong>Load Data</strong> to fetch stats for all members.</p>\n                <p>Results are cached for 24 hours. Click the <strong>↻</strong> button to force a fresh pull. Click column headers to sort.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">API Key</div>\n            <div class=\"dss-guide-card-body\">\n                <p>This module uses the API key configured in the DSS Setup page. A <strong>Public</strong> key is sufficient for profile stats, but <strong>Limited Access</strong> is recommended for faction member stats.</p>\n            </div>\n        </div>\n    ";

// src/modules/activity-stats/index.js
	registerModule("activity-stats", {
		name: "Activity Stats",
		version: "1.0",
		description: "Provides activity stats (xanax, activity hours, attacks, respect, etc.) on profile pages and faction member tables.",
		pages: ["/profiles.php", "/factions.php"],
		guide: guide_default$7,
		init() {
			const api_key = Storage.getSettings().apiKey;
			async function fetchPersonalStats(id, time) {
				var stats = "xantaken,energydrinkused,timeplayed,refills,attackswon,respectforfaction,retals,traveltimes,statenhancersused,networth";
				var url = time ? `${API_BASE}/user/${id}/personalstats?stat=${stats}&timestamp=${time}` : `${API_BASE}/user/${id}/personalstats?stat=${stats}`;
				var resp = await fetch(url, { headers: tornAuth(api_key) });
				var json = await resp.json();
				var result = {};
				if (json.personalstats && Array.isArray(json.personalstats)) {
					json.personalstats.forEach((s) => {
						result[s.name] = s.value;
					});
				}
				if (json.error) result._error = json.error.error || json.error_message || JSON.stringify(json.error);
				return result;
			}
			async function fetchMemberStats(id, timestamp, stats) {
				var url = timestamp ? `${API_BASE}/user/${id}/personalstats?stat=${stats}&timestamp=${timestamp}` : `${API_BASE}/user/${id}/personalstats?stat=${stats}`;
				try {
					var resp = await fetch(url, { headers: tornAuth(api_key) });
					var json = await resp.json();
					var result = {};
					if (json.personalstats && Array.isArray(json.personalstats)) {
						json.personalstats.forEach((s) => {
							result[s.name] = s.value;
						});
					}
					return result;
				} catch (e) {
					return {};
				}
			}
			async function concurrentLimit(tasks, limit, delayMs = 500) {
				const results = new Array(tasks.length);
				for (let i = 0; i < tasks.length; i += limit) {
					const batch = tasks.slice(i, i + limit);
					const batchResults = await Promise.all(batch.map((t, j) => t().then((r) => ({
						i: i + j,
						r
					}))));
					batchResults.forEach(({ i, r }) => {
						results[i] = r;
					});
					if (i + limit < tasks.length) {
						await new Promise((resolve) => setTimeout(resolve, delayMs));
					}
				}
				return results;
			}
			const PERIODS = [
				{
					label: "3d",
					days: 3
				},
				{
					label: "1w",
					days: 7
				},
				{
					label: "2w",
					days: 14
				},
				{
					label: "1mo",
					days: 30
				},
				{
					label: "6mo",
					days: 183
				},
				{
					label: "1yr",
					days: 365
				}
			];
			const DEFAULT_PERIOD = 3;
			function getFactionCacheKey(factionId, periodDays) {
				return `rs_faction_${factionId}_${periodDays}`;
			}
			function isCacheValid(cached) {
				if (!cached) return false;
				try {
					const data = JSON.parse(cached);
					return Date.now() - data.timestamp < 24 * 60 * 60 * 1e3;
				} catch {
					return false;
				}
			}
			if (window.location.href.includes("profiles.php")) {
				initProfileStats();
			} else if (window.location.href.includes("factions.php")) {
				initFactionStats();
			}
			function initProfileStats() {
				if (!api_key) return;
				const id = new URLSearchParams(window.location.search).get("XID");
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
                            ${PERIODS.map((p, i) => `<button class="rs-period-btn${i === DEFAULT_PERIOD ? " active" : ""}" data-period="${i}">${p.label}</button>`).join("")}
                        </div>
                        <button class="rs-collapse-btn${collapsed ? " collapsed" : ""}" id="rs-collapse-btn" title="Collapse">\u25BC</button>
                    </div>
                </div>
                <div class="rs-body${collapsed ? " collapsed" : ""}" id="rs-body">
                    <div class="rs-loading">Loading stats...</div>
                </div>
            `;
				panel.querySelector("#rs-collapse-btn").addEventListener("click", () => {
					collapsed = !collapsed;
					GM_setValue("rs_collapsed", collapsed);
					panel.querySelector(".rs-body").classList.toggle("collapsed", collapsed);
					panel.querySelector("#rs-collapse-btn").classList.toggle("collapsed", collapsed);
				});
				panel.querySelector(".rs-period-group").addEventListener("click", (e) => {
					if (!e.target.classList.contains("rs-period-btn")) return;
					if (e.target.classList.contains("active")) return;
					const idx = parseInt(e.target.dataset.period);
					panel.querySelectorAll(".rs-period-btn").forEach((b) => b.classList.remove("active"));
					e.target.classList.add("active");
					currentPeriodIdx = idx;
					setLoading();
					loadStats(idx);
				});
				var interval = setInterval(() => {
					var wrapper = document.querySelector(".profile-wrapper");
					if (wrapper) {
						clearInterval(interval);
						wrapper.querySelector("#recruit-stats-panel")?.remove();
						wrapper.appendChild(panel);
						loadStats(DEFAULT_PERIOD);
					}
				}, 200);
				function setLoading() {
					panel.querySelector(".rs-body").innerHTML = `<div class="rs-loading">Loading stats...</div>`;
				}
				function loadStats(periodIdx) {
					if (!api_key) {
						panel.querySelector(".rs-body").innerHTML = "<div class=\"rs-loading\" style=\"color:#d9534f\">No API key configured. Set one in DSS Settings.</div>";
						return;
					}
					const { days } = PERIODS[periodIdx];
					const d = new Date();
					d.setSeconds(d.getSeconds() - days * 86400);
					const timestamp = ~~(d / 1e3);
					Promise.all([fetchPersonalStats(id, timestamp), fetchPersonalStats(id)]).then(([p0, p1]) => {
						if (periodIdx !== currentPeriodIdx) return;
						if (p0._error || p1._error) {
							const errMsg = p0._error || p1._error;
							panel.querySelector(".rs-body").innerHTML = `<div class="rs-loading" style="color:#d9534f">API error: ${errMsg}</div>`;
							return;
						}
						renderStats(p0, p1, days);
					}).catch((err) => {
						console.error(err);
						panel.querySelector(".rs-body").innerHTML = `<div class="rs-loading" style="color:#d9534f">Failed to load stats. Check API key in DSS Settings.</div>`;
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
						{
							label: "Activity",
							amount: activityTotal + " hrs",
							perday: activity + " hrs"
						},
						{
							label: "Xanax",
							amount: xanax,
							perday: perDay(xanax)
						},
						{
							label: "Refills",
							amount: refills,
							perday: perDay(refills)
						},
						{
							label: "Cans",
							amount: cans,
							perday: perDay(cans)
						},
						{
							label: "Attacks",
							amount: attacks,
							perday: perDay(attacks)
						},
						{
							label: "Respect",
							amount: respect,
							perday: perDay(respect)
						},
						{
							label: "Retals",
							amount: retals,
							perday: perDay(retals)
						},
						{
							label: "Travel",
							amount: travel,
							perday: perDay(travel)
						},
						{
							label: "SEs",
							amount: se,
							perday: perDay(se)
						}
					];
					const tableRows = rows.map((r) => `
                    <tr>
                        <td class="rs-label">${r.label}</td>
                        <td class="rs-amount">${r.amount}</td>
                        <td class="rs-perday">${r.perday !== null ? r.perday : "—"}</td>
                    </tr>`).join("");
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
                        <span>Based on ~${days} day${days !== 1 ? "s" : ""} of data</span>
                        <button class="rs-copy-btn" id="rs-copy-btn">Export</button>
                    </div>
                `;
					bodyEl.querySelector("#rs-copy-btn").addEventListener("click", () => {
						const allRows = [...rows, {
							label: "Networth",
							amount: nwNowStr,
							perday: `${nwSign}${nwDiffStr} period`
						}];
						const period = PERIODS[currentPeriodIdx].label;
						const profileName = document.querySelector("h4#skip-to-content")?.textContent?.trim() || `#${id}`;
						const lines = allRows.map((r) => {
							const perday = r.perday != null ? String(r.perday) : "—";
							const amount = String(r.amount);
							if (amount === "—") return `${r.label}: ${perday}`;
							return perday !== "—" ? `${r.label}: ${amount} (${perday}/day)` : `${r.label}: ${amount}`;
						});
						const text = [`Activity Stats - ${profileName} (${period})`, ...lines].join("\n");
						navigator.clipboard.writeText(text).then(() => {
							const btn = bodyEl.querySelector("#rs-copy-btn");
							btn.textContent = "Copied to clipboard!";
							btn.classList.add("copied");
							setTimeout(() => {
								btn.textContent = "Export";
								btn.classList.remove("copied");
							}, 2e3);
						});
					});
				}
			}
			function initFactionStats() {
				function cleanupFactionCache() {
					const keys = GM_listValues();
					keys.forEach((key) => {
						if (!key.startsWith("rs_faction_")) return;
						const raw = GM_getValue(key, null);
						if (!raw) return;
						try {
							const data = JSON.parse(raw);
							if (Date.now() - data.timestamp > 48 * 60 * 60 * 1e3) {
								GM_deleteValue(key);
							}
						} catch {
							GM_deleteValue(key);
						}
					});
				}
				cleanupFactionCache();
				if (!api_key) return;
				const FACTION_PERIODS = [
					{
						label: "3d",
						days: 3
					},
					{
						label: "1w",
						days: 7
					},
					{
						label: "2w",
						days: 14
					},
					{
						label: "1mo",
						days: 30
					}
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
					const memberTable = document.querySelector("ul.table-header");
					if (!memberTable) return;
					clearInterval(interval);
					document.getElementById("faction-stats-panel")?.remove();
					const urlParams = new URLSearchParams(window.location.search);
					factionId = urlParams.get("ID") || "own";
					const panel = document.createElement("div");
					panel.id = "faction-stats-panel";
					panel.innerHTML = `
                    <div class="fs-header">
                        <div class="fs-title">\u{1F4CA} Faction Activity Stats</div>
                        <div class="fs-period-group">
                            ${FACTION_PERIODS.map((p, i) => `<button class="fs-period-btn${i === factionPeriodIdx ? " active" : ""}" data-period="${i}">${p.label}</button>`).join("")}
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
					panel.querySelector(".fs-period-group").addEventListener("click", (e) => {
						if (!e.target.classList.contains("fs-period-btn")) return;
						if (e.target.id === "fs-refresh-btn") {
							const cacheKey = getFactionCacheKey(factionId, FACTION_PERIODS[factionPeriodIdx].days);
							GM_setValue(cacheKey, null);
							memberData = {};
							loadFactionStats();
							return;
						}
						if (e.target.classList.contains("active")) return;
						const idx = parseInt(e.target.dataset.period);
						panel.querySelectorAll(".fs-period-btn").forEach((b) => b.classList.remove("active"));
						e.target.classList.add("active");
						factionPeriodIdx = idx;
						GM_setValue("rs_faction_period", idx);
						memberData = {};
						const ck = getFactionCacheKey(factionId, FACTION_PERIODS[idx].days);
						if (isCacheValid(GM_getValue(ck, null))) {
							loadFactionStats();
						} else {
							panel.querySelector(".fs-body").innerHTML = `
                            <div class="fs-prompt">
                                <button class="fs-load-btn" id="fs-load-btn">Load Data</button>
                                <span class="fs-prompt-note">Fetches activity stats for all faction members</span>
                            </div>`;
							panel.querySelector("#fs-load-btn").addEventListener("click", () => loadFactionStats());
						}
					});
					const tableObserver = new MutationObserver(() => {
						tableObserver.disconnect();
						try {
							const newHeaderRow = document.querySelector("ul.table-header");
							if (!newHeaderRow) return;
							const rows = getMemberRows();
							if (!rows.length) return;
							injectHeaders(newHeaderRow, Object.keys(memberData).length > 0);
							if (Object.keys(memberData).length > 0) {
								rows.forEach((row) => {
									const id = getMemberId(row);
									if (!id) return;
									injectCells(row, id, true);
									if (memberData[id]) {
										updateCell(id, "activity", memberData[id].activity.toFixed(1));
										updateCell(id, "xanax", memberData[id].xanax);
									}
								});
							}
						} finally {
							const tableContainer = document.querySelector("ul.table-header")?.parentElement;
							if (tableContainer) {
								tableObserver.observe(tableContainer, {
									childList: true,
									subtree: true
								});
							}
						}
					});
					const tableContainer = document.querySelector("ul.table-header")?.parentElement;
					if (tableContainer) {
						tableObserver.observe(tableContainer, {
							childList: true,
							subtree: true
						});
					}
					injectHeaders(memberTable);
					panel.querySelector("#fs-refresh-btn").addEventListener("click", (e) => {
						e.stopPropagation();
						const cacheKey = getFactionCacheKey(factionId, FACTION_PERIODS[factionPeriodIdx].days);
						GM_setValue(cacheKey, null);
						memberData = {};
						loadFactionStats();
					});
					panel.querySelector("#fs-load-btn").addEventListener("click", () => loadFactionStats());
					const { days } = FACTION_PERIODS[factionPeriodIdx];
					const initialCacheKey = getFactionCacheKey(factionId, days);
					const initialCached = GM_getValue(initialCacheKey, null);
					if (isCacheValid(initialCached)) {
						loadFactionStats();
					} else if (initialCached) {
						const headerRow = document.querySelector("ul.table-header");
						if (headerRow) {
							headerRow.querySelectorAll(".fs-col-header").forEach((h) => h.remove());
						}
						getMemberRows().forEach((row) => {
							row.querySelectorAll(".fs-cell").forEach((c) => c.remove());
						});
					}
					function injectHeaders(headerRow, visible = false) {
						headerRow = document.querySelector("ul.table-header") || headerRow;
						if (headerRow.querySelector(".fs-col-header")) {
							headerRow.querySelectorAll(".fs-col-header").forEach((h) => {
								h.style.display = visible ? "" : "none";
							});
							return;
						}
						const activityHeader = document.createElement("li");
						activityHeader.className = "table-cell fs-col-header";
						activityHeader.dataset.col = "activity";
						activityHeader.innerHTML = `A <span class="fs-sort-arrow" id="fs-sort-activity">\u25B2\u25BC</span>`;
						activityHeader.style.display = visible ? "" : "none";
						const xanaxHeader = document.createElement("li");
						xanaxHeader.className = "table-cell fs-col-header";
						xanaxHeader.dataset.col = "xanax";
						xanaxHeader.innerHTML = `X <span class="fs-sort-arrow" id="fs-sort-xanax">\u25B2\u25BC</span>`;
						xanaxHeader.style.display = visible ? "" : "none";
						headerRow.appendChild(activityHeader);
						headerRow.appendChild(xanaxHeader);
						[activityHeader, xanaxHeader].forEach((h) => {
							h.addEventListener("click", () => {
								const col = h.dataset.col;
								if (sortCol === col) {
									sortDir *= -1;
								} else {
									sortCol = col;
									sortDir = -1;
								}
								panel.querySelectorAll(".fs-sort-arrow").forEach((a) => a.classList.remove("active"));
								h.querySelector(".fs-sort-arrow").classList.add("active");
								h.querySelector(".fs-sort-arrow").textContent = sortDir === -1 ? "▼" : "▲";
								document.querySelectorAll("div.tt-stats-estimate").forEach((r) => r.classList.add("fs-hidden"));
								sortRows();
							});
						});
						document.querySelectorAll("ul.table-header .table-cell:not(.fs-col-header)").forEach((h) => {
							h.addEventListener("click", () => clearSort());
						});
					}
					function getMemberRows() {
						return Array.from(document.querySelectorAll("li.table-row")).filter((r) => r.querySelector("a[href*=\"profiles.php?XID=\"]"));
					}
					function getMemberId(row) {
						const link = row.querySelector("a[href*=\"profiles.php?XID=\"]");
						if (!link) return null;
						return link.href.split("XID=")[1].split("&")[0];
					}
					function injectCells(row, memberId, visible = false) {
						row.querySelectorAll(".fs-cell").forEach((c) => c.remove());
						const activityCell = document.createElement("li");
						activityCell.className = "table-cell fs-cell loading";
						activityCell.dataset.member = memberId;
						activityCell.dataset.type = "activity";
						activityCell.textContent = "...";
						activityCell.style.display = visible ? "" : "none";
						const xanaxCell = document.createElement("li");
						xanaxCell.className = "table-cell fs-cell loading";
						xanaxCell.dataset.member = memberId;
						xanaxCell.dataset.type = "xanax";
						xanaxCell.textContent = "...";
						xanaxCell.style.display = visible ? "" : "none";
						row.appendChild(activityCell);
						row.appendChild(xanaxCell);
					}
					function updateCell(memberId, type, value) {
						const cell = document.querySelector(`.fs-cell[data-member="${memberId}"][data-type="${type}"]`);
						if (!cell) return;
						cell.classList.remove("loading", "error");
						cell.style.display = "";
						cell.textContent = value !== null ? value : "—";
					}
					function sortRows() {
						if (!sortCol) return;
						const container = document.querySelector("ul.table-body");
						if (!container) return;
						const allRows = getMemberRows();
						const memberRows = allRows.filter((r) => getMemberId(r) && memberData[getMemberId(r)]);
						const otherRows = allRows.filter((r) => !getMemberId(r) || !memberData[getMemberId(r)]);
						memberRows.sort((a, b) => {
							const aId = getMemberId(a);
							const bId = getMemberId(b);
							const aVal = sortCol === "activity" ? memberData[aId].activity : memberData[aId].xanax;
							const bVal = sortCol === "activity" ? memberData[bId].activity : memberData[bId].xanax;
							return (aVal - bVal) * sortDir;
						});
						memberRows.forEach((r) => container.appendChild(r));
						otherRows.forEach((r) => container.appendChild(r));
					}
					function clearSort() {
						sortCol = null;
						document.querySelectorAll("div.tt-stats-estimate").forEach((r) => r.classList.remove("fs-hidden"));
						panel.querySelectorAll(".fs-sort-arrow").forEach((a) => {
							a.classList.remove("active");
							a.textContent = "▲▼";
						});
					}
					async function loadFactionStats() {
						const { days } = FACTION_PERIODS[factionPeriodIdx];
						const cacheKey = getFactionCacheKey(factionId, days);
						const cached = GM_getValue(cacheKey, null);
						const rows = getMemberRows();
						rows.forEach((row) => {
							const id = getMemberId(row);
							if (id) injectCells(row, id);
						});
						if (isCacheValid(cached)) {
							const data = JSON.parse(cached);
							memberData = data.members;
							const cacheAge = Math.round((Date.now() - data.timestamp) / 6e4);
							panel.querySelector(".fs-body").innerHTML = `
                            <div class="fs-cache-note">Loaded from cache (${cacheAge} min ago) \u2014 refreshes after 24 hrs</div>
                            <div class="fs-legend"><span>A</span> = Total activity (hrs) &nbsp;|&nbsp; <span>X</span> = Xanax taken</div>
                        `;
							rows.forEach((row) => {
								const id = getMemberId(row);
								if (!id || !memberData[id]) return;
								updateCell(id, "activity", memberData[id].activity.toFixed(1));
								updateCell(id, "xanax", memberData[id].xanax);
							});
							injectHeaders(memberTable, true);
							document.querySelectorAll(".fs-cell").forEach((c) => c.style.display = "");
							return;
						}
						panel.querySelector(".fs-body").innerHTML = `
                        <div class="fs-progress" id="fs-progress">Loading 0 / 0 requests...</div>
                        <div class="fs-progress-bar-wrap"><div class="fs-progress-bar" id="fs-progress-bar"></div></div>
                    `;
						const memberIds = rows.map(getMemberId).filter(Boolean);
						const total = memberIds.length;
						let done = 0;
						const d = new Date();
						d.setSeconds(d.getSeconds() - days * 86400);
						const timestamp = ~~(d / 1e3);
						const progressEl = panel.querySelector("#fs-progress");
						const progressBar = panel.querySelector("#fs-progress-bar");
						function updateProgress() {
							done++;
							const pct = Math.round(done / (total * 2) * 100);
							if (progressEl) progressEl.textContent = `Loading ${done} / ${total * 2} requests...`;
							if (progressBar) progressBar.style.width = pct + "%";
						}
						const tasks = memberIds.flatMap((memberId) => [async () => {
							const r = await fetchMemberStats(memberId, timestamp, "timeplayed,xantaken");
							updateProgress();
							return {
								memberId,
								type: "hist",
								data: r
							};
						}, async () => {
							const r = await fetchMemberStats(memberId, null, "timeplayed,xantaken");
							updateProgress();
							return {
								memberId,
								type: "curr",
								data: r
							};
						}]);
						const hist = {};
						const curr = {};
						const results = await concurrentLimit(tasks, 3, 2500);
						results.forEach((r) => {
							if (r.type === "hist") hist[r.memberId] = r.data;
							else curr[r.memberId] = r.data;
						});
						injectHeaders(memberTable, true);
						memberIds.forEach((memberId) => {
							const h = hist[memberId] || {};
							const c = curr[memberId] || {};
							const activitySecs = Math.max(0, (c.timeplayed || 0) - (h.timeplayed || 0));
							const activityHrs = activitySecs / 3600;
							const xanax = Math.max(0, (c.xantaken || 0) - (h.xantaken || 0));
							memberData[memberId] = {
								activity: activityHrs,
								xanax
							};
							updateCell(memberId, "activity", activityHrs.toFixed(1));
							updateCell(memberId, "xanax", xanax);
						});
						GM_setValue(cacheKey, JSON.stringify({
							timestamp: Date.now(),
							members: memberData
						}));
						panel.querySelector(".fs-body").innerHTML = `
                        <div class="fs-cache-note">Loaded fresh data \u2014 refreshes after 24 hrs</div>
                        <div class="fs-legend"><span>A</span> = Total activity (hrs) &nbsp;|&nbsp; <span>X</span> = Xanax taken</div>
                    `;
					}
				}, 300);
			}
		}
	});

// src/modules/faction-money/guide.html?raw
	var guide_default$6 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Payment Processing</div>\n            <div class=\"dss-guide-card-body\">\n                <p>On the faction <strong>Controls</strong> tab, a <strong>Process Faction Payments</strong> button appears. Click it to open an input modal where you can enter payment instructions.</p>\n                <p>Payments are processed one at a time — click <strong>Process Next Payment</strong> for each entry. Results show in a live table with previous balance, change, and new balance.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Input Methods</div>\n            <div class=\"dss-guide-card-body\">\n                <p><strong>Manual Entry</strong> — paste a JSON array: <code>[[userID, amount], [userID, amount]]</code></p>\n                <p><strong>Upload File</strong> — drag and drop or browse for a .txt/.csv file with <code>userID,amount</code> per line.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Undo Payments</div>\n            <div class=\"dss-guide-card-body\">\n                <p>After processing, click <strong>Undo Next Payment</strong> to reverse each payment one at a time. Each click undoes the most recent payment that hasn't been reversed yet.</p>\n            </div>\n        </div>\n    ";

// src/modules/faction-money/index.js
	registerModule("faction-money", {
		name: "Faction War Pay",
		version: "1.1",
		description: "Assists with processing faction member money balance adjustments via the controls tab.",
		pages: ["/factions.php"],
		guide: guide_default$6,
		init() {
			let isInitialized = false;
			let container = null;
			let resultsPanel = null;
			let resultsTable = null;
			let nextPaymentButton = null;
			let undoButton = null;
			let paymentInstructions = [];
			let paymentHistory = [];
			let isUndoing = false;
			let isProcessing = false;
			let paymentButton = null;
			const paymentMessage = "PROCESS FACTION PAYMENTS";
			const nextPaymentMessage = "PROCESS NEXT PAYMENT";
			function shouldShowButton() {
				return window.location.href.includes("tab=controls");
			}
			function formatCurrency(amount) {
				const isNegative = amount < 0;
				const absAmount = Math.abs(amount);
				const formatted = "$" + absAmount.toLocaleString("en-US");
				return isNegative ? "-" + formatted : formatted;
			}
			function createResultsPanel() {
				resultsPanel = document.createElement("div");
				resultsPanel.style.cssText = "display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:800px;max-height:80vh;padding:15px;background-color:#1a1a1a;border-radius:8px;border:2px solid #333;box-shadow:0 4px 20px rgba(0,0,0,0.5);z-index:10000;box-sizing:border-box;overflow-y:auto;";
				const resultsHeader = document.createElement("div");
				resultsHeader.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid #333;flex-wrap:wrap;gap:8px;";
				const resultsTitle = document.createElement("h3");
				resultsTitle.textContent = "Payment Results";
				resultsTitle.style.cssText = "margin:0;font-size:16px;font-weight:bold;color:#fff;";
				const buttonGroup = document.createElement("div");
				buttonGroup.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
				nextPaymentButton = document.createElement("button");
				nextPaymentButton.className = "torn-btn";
				nextPaymentButton.textContent = "Process Next Payment";
				nextPaymentButton.style.cssText = "padding:8px 10px;font-size:11px;display:flex;align-items:center;white-space:nowrap;";
				nextPaymentButton.addEventListener("click", async () => {
					if (paymentInstructions.length > 0 && !isProcessing) {
						isProcessing = true;
						nextPaymentButton.disabled = true;
						try {
							await processOneInstruction();
						} finally {
							isProcessing = false;
							updateModalButtons();
						}
					}
				});
				undoButton = document.createElement("button");
				undoButton.className = "torn-btn";
				undoButton.textContent = "Undo Next Payment";
				undoButton.disabled = true;
				undoButton.style.cssText = "padding:8px 10px;font-size:11px;display:flex;align-items:center;white-space:nowrap;";
				undoButton.addEventListener("click", async () => {
					if (paymentHistory.length > 0 && !isProcessing && !isUndoing) {
						isUndoing = true;
						undoButton.disabled = true;
						try {
							await undoOnePayment();
						} finally {
							isUndoing = false;
							updateModalButtons();
						}
					}
				});
				const closeButton = document.createElement("button");
				closeButton.className = "torn-btn";
				closeButton.textContent = "Close";
				closeButton.style.cssText = "padding:8px 10px;font-size:11px;display:flex;align-items:center;white-space:nowrap;";
				closeButton.addEventListener("click", () => {
					resultsPanel.style.display = "none";
					const backdrop = document.getElementById("faction-payment-backdrop");
					if (backdrop) backdrop.remove();
					paymentInstructions = [];
					paymentHistory = [];
					isProcessing = false;
					isUndoing = false;
					paymentButton.textContent = paymentMessage;
					paymentButton.disabled = false;
					updateUndoButton();
				});
				buttonGroup.appendChild(nextPaymentButton);
				buttonGroup.appendChild(undoButton);
				buttonGroup.appendChild(closeButton);
				resultsHeader.appendChild(resultsTitle);
				resultsHeader.appendChild(buttonGroup);
				resultsPanel.appendChild(resultsHeader);
				const tableWrapper = document.createElement("div");
				tableWrapper.style.cssText = "max-height:calc(80vh - 100px);overflow-y:auto;overflow-x:auto;";
				resultsTable = document.createElement("table");
				resultsTable.style.cssText = "width:100%;border-collapse:collapse;font-size:11px;color:#ccc;";
				resultsTable.innerHTML = `
                <thead>
                    <tr style="background-color:#2a2a2a;position:sticky;top:0;">
                        <th style="padding:6px 4px;text-align:center;width:36px;border-bottom:2px solid #333;font-size:10px;">Status</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">Player</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">Previous</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">Change</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">New</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;
				tableWrapper.appendChild(resultsTable);
				resultsPanel.appendChild(tableWrapper);
				document.body.appendChild(resultsPanel);
			}
			function showResultsPanel() {
				let backdrop = document.getElementById("faction-payment-backdrop");
				if (!backdrop) {
					backdrop = document.createElement("div");
					backdrop.id = "faction-payment-backdrop";
					backdrop.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.7);z-index:9999;";
					document.body.appendChild(backdrop);
				}
				resultsPanel.style.display = "block";
				updateModalButtons();
			}
			function addResultRow(playerName, playerId, previousBalance, change, newBalance, isError, errorMsg) {
				showResultsPanel();
				const tbody = resultsTable.querySelector("tbody");
				const row = document.createElement("tr");
				row.style.cssText = "border-bottom:1px solid #2a2a2a;transition:background-color 0.2s;";
				row.addEventListener("mouseenter", () => {
					row.style.backgroundColor = "#2a2a2a";
				});
				row.addEventListener("mouseleave", () => {
					row.style.backgroundColor = "transparent";
				});
				const iconCell = document.createElement("td");
				iconCell.style.cssText = "padding:6px 4px;text-align:center;font-size:14px;";
				iconCell.innerHTML = isError ? "❌" : "✅";
				const nameCell = document.createElement("td");
				nameCell.style.cssText = "padding:6px 4px;color:#fff;text-align:center;font-size:11px;word-break:break-all;";
				nameCell.textContent = playerName || `ID: ${playerId}`;
				const prevCell = document.createElement("td");
				prevCell.style.cssText = "padding:6px 4px;text-align:center;font-family:monospace;color:#aaa;font-size:10px;";
				prevCell.textContent = formatCurrency(previousBalance);
				const changeCell = document.createElement("td");
				const changeColor = isError ? "#ff4444" : change >= 0 ? "#4CAF50" : "#ff4444";
				changeCell.style.cssText = `padding:6px 4px;text-align:center;font-family:monospace;color:${changeColor};font-weight:bold;font-size:10px;`;
				changeCell.textContent = (change >= 0 ? "+" : "") + formatCurrency(change);
				const newCell = document.createElement("td");
				newCell.style.cssText = "padding:6px 4px;text-align:center;font-family:monospace;color:#fff;font-weight:bold;font-size:10px;";
				newCell.textContent = formatCurrency(newBalance);
				row.appendChild(iconCell);
				row.appendChild(nameCell);
				row.appendChild(prevCell);
				row.appendChild(changeCell);
				row.appendChild(newCell);
				tbody.appendChild(row);
				if (errorMsg) {
					const errorRow = document.createElement("tr");
					errorRow.style.cssText = "background-color:rgba(255,68,68,0.1);";
					const errorCell = document.createElement("td");
					errorCell.colSpan = 5;
					errorCell.style.cssText = "padding:8px 10px;font-size:12px;color:#ff4444;border-bottom:1px solid #2a2a2a;";
					errorCell.innerHTML = `\u26A0\uFE0F ${errorMsg}`;
					errorRow.appendChild(errorCell);
					tbody.appendChild(errorRow);
				}
			}
			function updateUndoButton() {
				if (paymentHistory.length > 0 && !isProcessing && !isUndoing) {
					undoButton.disabled = false;
					undoButton.textContent = `Undo Next Payment (${paymentHistory.length} to undo)`;
				} else if (isUndoing) {
					undoButton.disabled = true;
					undoButton.textContent = "Undoing...";
				} else {
					undoButton.disabled = true;
					undoButton.textContent = "Undo Next Payment";
				}
			}
			function updateModalButtons() {
				if (isProcessing) {
					nextPaymentButton.disabled = true;
					nextPaymentButton.textContent = "Processing...";
				} else if (paymentInstructions.length > 0) {
					nextPaymentButton.disabled = false;
					nextPaymentButton.textContent = `Process Next Payment (${paymentInstructions.length} remaining)`;
				} else {
					nextPaymentButton.disabled = true;
					nextPaymentButton.textContent = "No More Payments";
				}
				updateUndoButton();
			}
			function updateButtonText() {
				if (paymentInstructions.length === 0) {
					paymentButton.textContent = paymentMessage;
					paymentButton.disabled = isUndoing;
				} else {
					paymentButton.textContent = `${nextPaymentMessage} (${paymentInstructions.length} remaining)`;
				}
			}
			async function processOneInstruction() {
				const getAction = typeof unsafeWindow !== "undefined" && unsafeWindow.getAction || window.getAction;
				if (typeof getAction !== "function") {
					addResultRow(null, null, 0, 0, 0, true, "Torn's internal API (getAction) not found — this feature may need updating");
					updateButtonText();
					updateModalButtons();
					return;
				}
				const instruction = paymentInstructions.shift();
				const player_id = instruction[0];
				const amount = instruction[1];
				let existing_money_str = null;
				let player_name = null;
				document.querySelectorAll("[class*=\"listItem___\"]").forEach(function(item) {
					const userLink = item.querySelector("a[href*='/profiles.php?XID=']");
					if (!userLink) return;
					const href = userLink.getAttribute("href");
					const match = href.match(/XID=(\d+)/);
					if (!(match && match[1] === String(player_id))) return;
					const balanceWrap = item.querySelector("[class*=\"editBalanceWrap___\"][class*=\"canEdit___\"]");
					if (!balanceWrap) return;
					const clone = balanceWrap.cloneNode(true);
					clone.querySelectorAll("input, button, .hidden, [class*=\"hidden\"]").forEach((el) => el.remove());
					const displayed = clone.textContent.trim();
					if (!displayed.includes("$")) return;
					const hiddenInput = balanceWrap.querySelector("input[type=\"hidden\"]");
					existing_money_str = hiddenInput && hiddenInput.value.trim() !== "" ? hiddenInput.value : displayed;
					const honorText = item.querySelector(".honor-text");
					if (honorText) {
						const chars = honorText.querySelectorAll("[data-char]");
						player_name = chars.length > 0 ? Array.from(chars).map((c) => c.getAttribute("data-char")).join("") : honorText.textContent.trim();
					}
				});
				const cleaned = (existing_money_str || "").replace(/[^\d-]/g, "");
				const existing_money = parseInt(cleaned, 10);
				if (!Number.isFinite(existing_money)) {
					addResultRow(player_name, player_id, 0, 0, 0, true, `Failed to read balance (got "${existing_money_str}")`);
					updateButtonText();
					updateModalButtons();
					return;
				}
				const final_money = existing_money + amount;
				if (!Number.isFinite(final_money)) {
					addResultRow(player_name, player_id, existing_money, amount, 0, true, "Computed balance is not a valid number");
					updateButtonText();
					updateModalButtons();
					return;
				}
				try {
					const response = await new Promise((resolve, reject) => {
						getAction({
							type: "post",
							action: "page.php?sid=factionsEditMoneyBalance",
							data: {
								depositor: player_id,
								balance: final_money
							},
							success: (str) => resolve(str),
							error: (error) => reject(error)
						});
					});
					let msg;
					if (typeof response === "string") {
						try {
							msg = JSON.parse(response);
						} catch (e) {
							addResultRow(player_name, player_id, existing_money, amount, final_money, true, "Error parsing server response: " + e.message);
							updateButtonText();
							updateModalButtons();
							return;
						}
					} else {
						msg = response;
					}
					if (msg.success === true || msg.depositor && typeof msg.balance === "number") {
						paymentHistory.push({
							playerName: player_name,
							playerId: player_id,
							amount,
							previousBalance: existing_money,
							newBalance: final_money
						});
						addResultRow(player_name, player_id, existing_money, amount, final_money, false);
					} else if (msg.error) {
						addResultRow(player_name, player_id, existing_money, amount, final_money, true, "API Error: " + msg.error);
					} else {
						paymentHistory.push({
							playerName: player_name,
							playerId: player_id,
							amount,
							previousBalance: existing_money,
							newBalance: final_money
						});
						addResultRow(player_name, player_id, existing_money, amount, final_money, false);
					}
				} catch (e) {
					addResultRow(player_name, player_id, existing_money, amount, final_money, true, "Network error: " + e.message);
				}
				updateButtonText();
				updateModalButtons();
			}
			async function undoOnePayment() {
				const getAction = typeof unsafeWindow !== "undefined" && unsafeWindow.getAction || window.getAction;
				if (paymentHistory.length === 0) return;
				if (typeof getAction !== "function") {
					addResultRow(null, null, 0, 0, 0, true, "Torn's internal API (getAction) not found — this feature may need updating");
					updateButtonText();
					updateModalButtons();
					return;
				}
				const lastPayment = paymentHistory.pop();
				const tbody = resultsTable.querySelector("tbody");
				if (!tbody.querySelector(".undo-header-row")) {
					const headerRow = document.createElement("tr");
					headerRow.className = "undo-header-row";
					headerRow.style.cssText = "background-color:#2a2a2a;";
					const headerCell = document.createElement("td");
					headerCell.colSpan = 5;
					headerCell.style.cssText = "padding:12px 10px;font-size:14px;color:#fff;font-weight:bold;text-align:center;border-top:2px solid #444;border-bottom:2px solid #444;";
					headerCell.textContent = "⟲ Payment Corrections";
					headerRow.appendChild(headerCell);
					tbody.appendChild(headerRow);
				}
				try {
					const response = await new Promise((resolve, reject) => {
						getAction({
							type: "post",
							action: "page.php?sid=factionsEditMoneyBalance",
							data: {
								depositor: lastPayment.playerId,
								balance: lastPayment.previousBalance
							},
							success: (str) => resolve(str),
							error: (error) => reject(error)
						});
					});
					let msg;
					if (typeof response === "string") {
						try {
							msg = JSON.parse(response);
						} catch (e) {
							msg = { success: response.includes("success") || response.includes("Success") };
						}
					} else {
						msg = response;
					}
					if (msg.success === true || msg.depositor && typeof msg.balance === "number") {
						addResultRow(lastPayment.playerName, lastPayment.playerId, lastPayment.newBalance, -lastPayment.amount, lastPayment.previousBalance, false);
					} else {
						addResultRow(lastPayment.playerName, lastPayment.playerId, lastPayment.newBalance, -lastPayment.amount, lastPayment.previousBalance, true, "Failed to undo payment");
						paymentHistory.push(lastPayment);
					}
				} catch (e) {
					addResultRow(lastPayment.playerName, lastPayment.playerId, lastPayment.newBalance, -lastPayment.amount, lastPayment.previousBalance, true, "Network error undoing payment: " + e.message);
					paymentHistory.push(lastPayment);
				}
				updateButtonText();
				updateModalButtons();
			}
			async function processPaymentClick() {
				if (paymentButton.textContent === paymentMessage) {
					showInputModal();
				} else {
					if (!isProcessing) {
						isProcessing = true;
						paymentButton.disabled = true;
						try {
							await processOneInstruction();
						} finally {
							isProcessing = false;
							updateButtonText();
						}
					}
				}
			}
			function showInputModal() {
				const inputModal = document.createElement("div");
				inputModal.style.cssText = "display:block;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:600px;padding:0;background:#1a1a1a;border-radius:5px;border:1px solid #2a2a2a;box-shadow:0 10px 40px rgba(0,0,0,0.6);z-index:10000;";
				const inputHeader = document.createElement("div");
				inputHeader.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:15px 20px;background:#222;border-bottom:1px solid #2a2a2a;border-radius:5px 5px 0 0;";
				const inputTitle = document.createElement("h3");
				inputTitle.textContent = "Enter Payment Instructions";
				inputTitle.style.cssText = "margin:0;font-size:16px;font-weight:bold;color:#fff;";
				inputHeader.appendChild(inputTitle);
				inputModal.appendChild(inputHeader);
				const tabContainer = document.createElement("div");
				tabContainer.style.cssText = "display:flex;gap:0;border-bottom:1px solid #2a2a2a;background-color:#1a1a1a;";
				const textTab = document.createElement("button");
				textTab.className = "torn-btn";
				textTab.textContent = "Manual Entry";
				textTab.style.cssText = "padding:12px 20px;font-size:12px;flex:1;border-radius:0;border-bottom:2px solid transparent;background-color:transparent;display:flex;align-items:center;justify-content:center;text-transform:uppercase;font-weight:normal;letter-spacing:0.5px;color:#999;";
				const fileTab = document.createElement("button");
				fileTab.className = "torn-btn";
				fileTab.textContent = "Upload File";
				fileTab.style.cssText = "padding:12px 20px;font-size:12px;flex:1;border-radius:0;border-bottom:2px solid transparent;background-color:transparent;display:flex;align-items:center;justify-content:center;text-transform:uppercase;font-weight:normal;letter-spacing:0.5px;color:#999;";
				tabContainer.appendChild(textTab);
				tabContainer.appendChild(fileTab);
				inputModal.appendChild(tabContainer);
				createTextInputSection(inputModal, textTab, fileTab);
				createFileInputSection(inputModal, textTab, fileTab);
				textTab.style.borderBottom = "2px solid #7ac231";
				textTab.style.backgroundColor = "rgba(122,194,49,0.1)";
				textTab.style.color = "#fff";
				const backdrop = document.createElement("div");
				backdrop.id = "faction-input-backdrop";
				backdrop.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.85);z-index:9999;";
				document.body.appendChild(backdrop);
				document.body.appendChild(inputModal);
			}
			function createTextInputSection(inputModal, textTab, fileTab) {
				const textSection = document.createElement("div");
				textSection.setAttribute("data-section", "text");
				textSection.style.cssText = "display:block;padding:20px;";
				const instructionText = document.createElement("p");
				instructionText.style.cssText = "color:#888;font-size:12px;margin:0 0 10px 0;";
				instructionText.textContent = "Format: [[userID, amount], [userID, amount], ...]";
				const textarea = document.createElement("textarea");
				textarea.style.cssText = "width:100%;height:150px;padding:10px;background-color:#0f0f0f;border:1px solid #2a2a2a;border-radius:3px;color:#ccc;font-family:\"Courier New\",monospace;font-size:12px;resize:vertical;margin-bottom:15px;box-sizing:border-box;";
				textarea.placeholder = "[[1561637, 1000], [2795521, 500]]";
				const textErrorMsg = document.createElement("div");
				textErrorMsg.style.cssText = "display:none;padding:10px;margin-bottom:15px;background-color:rgba(255,68,68,0.1);border:1px solid #ff4444;border-radius:3px;color:#ff4444;font-size:12px;";
				const submitTextButton = document.createElement("button");
				submitTextButton.className = "torn-btn ctaButton___waMIZ";
				submitTextButton.textContent = "Process Payments";
				submitTextButton.style.cssText = "width:100%;padding:10px;font-size:14px;display:flex;align-items:center;justify-content:center;";
				submitTextButton.disabled = true;
				const textCancelButton = document.createElement("button");
				textCancelButton.className = "torn-btn";
				textCancelButton.textContent = "Cancel";
				textCancelButton.style.cssText = "padding:10px 15px;font-size:14px;display:flex;align-items:center;justify-content:center;";
				textCancelButton.addEventListener("click", () => {
					inputModal.remove();
					const bd = document.getElementById("faction-input-backdrop");
					if (bd) bd.remove();
				});
				const textButtonGroup = document.createElement("div");
				textButtonGroup.style.cssText = "display:flex;gap:10px;";
				textButtonGroup.appendChild(submitTextButton);
				textButtonGroup.appendChild(textCancelButton);
				textarea.addEventListener("input", () => {
					submitTextButton.disabled = textarea.value.trim().length === 0;
				});
				submitTextButton.addEventListener("click", () => {
					const userInput = textarea.value.trim();
					textErrorMsg.style.display = "none";
					if (!userInput) {
						textErrorMsg.textContent = "⚠️ Please enter payment instructions";
						textErrorMsg.style.display = "block";
						return;
					}
					try {
						const instructions = JSON.parse(userInput);
						if (!Array.isArray(instructions)) throw new Error("Input must be an array");
						if (instructions.length < 1) {
							textErrorMsg.textContent = "⚠️ No payments to make";
							textErrorMsg.style.display = "block";
							return;
						}
						for (let i = 0; i < instructions.length; i++) {
							const inst = instructions[i];
							if (!Array.isArray(inst) || inst.length !== 2) throw new Error(`Invalid instruction at index ${i}`);
							if (typeof inst[0] !== "number" || typeof inst[1] !== "number") throw new Error(`Invalid types at index ${i}`);
						}
						inputModal.remove();
						const bd = document.getElementById("faction-input-backdrop");
						if (bd) bd.remove();
						const tbody = resultsTable.querySelector("tbody");
						if (tbody) tbody.innerHTML = "";
						paymentHistory = [];
						isProcessing = false;
						isUndoing = false;
						paymentInstructions = instructions;
						paymentButton.disabled = false;
						updateButtonText();
						showResultsPanel();
					} catch (e) {
						textErrorMsg.textContent = `\u26A0\uFE0F Parse error: ${e.message}`;
						textErrorMsg.style.display = "block";
					}
				});
				textTab.addEventListener("click", () => {
					textSection.style.display = "block";
					const fs = inputModal.querySelector("[data-section=\"file\"]");
					if (fs) fs.style.display = "none";
					textTab.style.borderBottom = "2px solid #7ac231";
					textTab.style.backgroundColor = "rgba(122,194,49,0.1)";
					textTab.style.color = "#fff";
					fileTab.style.borderBottom = "2px solid transparent";
					fileTab.style.backgroundColor = "transparent";
					fileTab.style.color = "#999";
				});
				textSection.appendChild(instructionText);
				textSection.appendChild(textarea);
				textSection.appendChild(textErrorMsg);
				textSection.appendChild(textButtonGroup);
				inputModal.appendChild(textSection);
			}
			function createFileInputSection(inputModal, textTab, fileTab) {
				const fileSection = document.createElement("div");
				fileSection.setAttribute("data-section", "file");
				fileSection.style.cssText = "display:none;padding:20px;";
				const fileInstructionText = document.createElement("p");
				fileInstructionText.style.cssText = "color:#888;font-size:12px;margin:0 0 10px 0;";
				fileInstructionText.innerHTML = "Upload a .txt or .csv file with format:<br><br><strong>userID,amount</strong> (one per line)";
				const dropZone = document.createElement("div");
				dropZone.style.cssText = "width:100%;padding:40px;margin-bottom:15px;background-color:#0f0f0f;border:2px dashed #333;border-radius:3px;text-align:center;cursor:pointer;transition:all 0.3s ease;box-sizing:border-box;";
				const dropZoneText = document.createElement("div");
				dropZoneText.style.cssText = "color:#888;font-size:14px;";
				dropZoneText.innerHTML = "<div style=\"font-size:48px;margin-bottom:10px;\">📁</div><div style=\"margin-bottom:5px;\">Drag & drop your file here</div><div style=\"font-size:12px;color:#666;\">or click to browse</div>";
				dropZone.appendChild(dropZoneText);
				const fileInput = document.createElement("input");
				fileInput.type = "file";
				fileInput.accept = ".txt,.csv";
				fileInput.style.cssText = "display:none;";
				dropZone.addEventListener("click", () => fileInput.click());
				dropZone.addEventListener("dragover", (e) => {
					e.preventDefault();
					dropZone.style.borderColor = "#7ac231";
					dropZone.style.backgroundColor = "rgba(122,194,49,0.1)";
				});
				dropZone.addEventListener("dragleave", (e) => {
					e.preventDefault();
					dropZone.style.borderColor = "#333";
					dropZone.style.backgroundColor = "#0f0f0f";
				});
				dropZone.addEventListener("drop", (e) => {
					e.preventDefault();
					dropZone.style.borderColor = "#333";
					dropZone.style.backgroundColor = "#0f0f0f";
					if (e.dataTransfer.files.length > 0) {
						fileInput.files = e.dataTransfer.files;
						fileInput.dispatchEvent(new Event("change", { bubbles: true }));
					}
				});
				const filePreview = document.createElement("div");
				filePreview.style.cssText = "max-height:120px;overflow-y:auto;padding:10px;background-color:#0f0f0f;border:1px solid #2a2a2a;border-radius:3px;margin-bottom:15px;font-family:\"Courier New\",monospace;font-size:12px;color:#888;display:none;";
				const submitFileButton = document.createElement("button");
				submitFileButton.className = "torn-btn ctaButton___waMIZ";
				submitFileButton.textContent = "Process Payments";
				submitFileButton.style.cssText = "width:100%;padding:10px;font-size:14px;display:flex;align-items:center;justify-content:center;";
				submitFileButton.disabled = true;
				const fileCancelButton = document.createElement("button");
				fileCancelButton.className = "torn-btn";
				fileCancelButton.textContent = "Cancel";
				fileCancelButton.style.cssText = "padding:10px 15px;font-size:14px;display:flex;align-items:center;justify-content:center;";
				fileCancelButton.addEventListener("click", () => {
					inputModal.remove();
					const bd = document.getElementById("faction-input-backdrop");
					if (bd) bd.remove();
				});
				const fileButtonGroup = document.createElement("div");
				fileButtonGroup.style.cssText = "display:flex;gap:10px;";
				fileButtonGroup.appendChild(submitFileButton);
				fileButtonGroup.appendChild(fileCancelButton);
				let parsedInstructions = [];
				fileInput.addEventListener("change", (e) => {
					const file = e.target.files[0];
					if (!file) return;
					dropZoneText.innerHTML = `<div style="font-size:48px;margin-bottom:10px;">\uD83D\uDCC4</div><div style="margin-bottom:5px;color:#7ac231;font-weight:bold;">${file.name}</div><div style="font-size:12px;color:#666;">Click to choose a different file</div>`;
					const reader = new FileReader();
					reader.onload = (event) => {
						try {
							const lines = event.target.result.split("\n").filter((line) => line.trim());
							parsedInstructions = [];
							let previewHTML = "";
							for (let i = 0; i < lines.length; i++) {
								const line = lines[i].trim();
								if (!line) continue;
								const parts = line.split(",").map((p) => p.trim());
								if (parts.length !== 2) throw new Error(`Invalid format on line ${i + 1}`);
								const userId = parseInt(parts[0]);
								const amount = parseInt(parts[1]);
								if (isNaN(userId) || isNaN(amount)) throw new Error(`Invalid numbers on line ${i + 1}`);
								parsedInstructions.push([userId, amount]);
								previewHTML += `<div>[${userId}, ${amount}]</div>`;
							}
							filePreview.innerHTML = `<strong>Parsed ${parsedInstructions.length} payments:</strong><br><br>${previewHTML}`;
							filePreview.style.display = "block";
							filePreview.style.cssText = "max-height:120px;overflow-y:auto;padding:10px;background-color:#0f0f0f;border:1px solid #2a2a2a;border-radius:3px;margin-bottom:15px;font-family:\"Courier New\",monospace;font-size:12px;color:#888;display:block;";
							submitFileButton.disabled = false;
						} catch (error) {
							filePreview.innerHTML = `\u26A0\uFE0F ${error.message}`;
							filePreview.style.cssText = "display:block;padding:10px;margin-bottom:15px;background-color:rgba(255,68,68,0.1);border:1px solid #ff4444;border-radius:3px;color:#ff4444;font-size:12px;";
							submitFileButton.disabled = true;
							parsedInstructions = [];
						}
					};
					reader.readAsText(file);
				});
				submitFileButton.addEventListener("click", () => {
					if (parsedInstructions.length < 1) {
						alert("No valid payments to process");
						return;
					}
					inputModal.remove();
					const bd = document.getElementById("faction-input-backdrop");
					if (bd) bd.remove();
					const tbody = resultsTable.querySelector("tbody");
					if (tbody) tbody.innerHTML = "";
					paymentHistory = [];
					isProcessing = false;
					isUndoing = false;
					paymentInstructions = parsedInstructions;
					paymentButton.disabled = false;
					updateButtonText();
					showResultsPanel();
				});
				fileTab.addEventListener("click", () => {
					const ts = inputModal.querySelector("[data-section=\"text\"]");
					if (ts) ts.style.display = "none";
					fileSection.style.display = "block";
					fileTab.style.borderBottom = "2px solid #7ac231";
					fileTab.style.backgroundColor = "rgba(122,194,49,0.1)";
					fileTab.style.color = "#fff";
					textTab.style.borderBottom = "2px solid transparent";
					textTab.style.backgroundColor = "transparent";
					textTab.style.color = "#999";
				});
				fileSection.appendChild(fileInstructionText);
				fileSection.appendChild(dropZone);
				fileSection.appendChild(fileInput);
				fileSection.appendChild(filePreview);
				fileSection.appendChild(fileButtonGroup);
				inputModal.appendChild(fileSection);
			}
			function initializeButton() {
				if (isInitialized || !shouldShowButton()) return;
				document.querySelectorAll(".faction-payment-container").forEach((el) => el.remove());
				paymentButton = document.createElement("button");
				paymentButton.type = "button";
				paymentButton.className = "torn-btn ctaButton___waMIZ silver";
				paymentButton.textContent = paymentMessage;
				paymentButton.style.cssText = "margin-top:10px;width:100%;";
				paymentButton.addEventListener("click", async () => {
					await processPaymentClick();
				});
				container = document.createElement("div");
				container.className = "faction-payment-container";
				container.style.cssText = "width:100%;display:flex;flex-direction:column;";
				container.appendChild(paymentButton);
				createResultsPanel();
				const controlsRadioGroup = document.querySelector("[class*=\"controls___\"]");
				if (controlsRadioGroup && controlsRadioGroup.parentElement) {
					controlsRadioGroup.parentElement.appendChild(container);
					isInitialized = true;
				}
			}
			function removeButton() {
				if (container && container.parentNode) {
					container.parentNode.removeChild(container);
					isInitialized = false;
					container = null;
				}
				if (resultsPanel && resultsPanel.parentNode) {
					resultsPanel.parentNode.removeChild(resultsPanel);
					resultsPanel = null;
					resultsTable = null;
					nextPaymentButton = null;
					undoButton = null;
				}
				const backdrop = document.getElementById("faction-payment-backdrop");
				if (backdrop) backdrop.remove();
				const inputBackdrop = document.getElementById("faction-input-backdrop");
				if (inputBackdrop) inputBackdrop.remove();
				paymentInstructions = [];
				paymentHistory = [];
			}
			function checkAndToggleButton() {
				if (shouldShowButton() && !isInitialized) initializeButton();
				else if (!shouldShowButton() && isInitialized) removeButton();
			}
			function waitForElement() {
				const controlsElement = document.querySelector("[class*=\"controls___\"]");
				if (controlsElement) {
					checkAndToggleButton();
					let lastUrl = location.href;
					new MutationObserver(() => {
						const url = location.href;
						if (url !== lastUrl) {
							lastUrl = url;
							checkAndToggleButton();
						}
					}).observe(document, {
						subtree: true,
						childList: true
					});
				} else {
					setTimeout(waitForElement, 100);
				}
			}
			waitForElement();
		}
	});

// src/modules/armoury-notes/guide.html?raw
	var guide_default$5 = "\n        <details class=\"an-guide-card\">\n            <summary class=\"an-cfg-summary\">What It Does</summary>\n            <div class=\"an-cfg-body\">\n                <p>Adds shared notes to your faction's armoury items - a note, owner, category and colour per item. Everyone in your faction sees the same notes, because they are stored centrally rather than on your device.</p>\n                <p>Notes show on the <strong>Armoury</strong>, <strong>Inventory</strong> and <strong>Trade</strong> pages as a badge next to the item name; hover (or tap on mobile) the name to read the note. If your faction is part of a <strong>family</strong>, you also see items owned by other family factions, marked as loaned in.</p>\n            </div>\n        </details>\n        <details class=\"an-guide-card\">\n            <summary class=\"an-cfg-summary\">Adding &amp; Editing Notes (Writers)</summary>\n            <div class=\"an-cfg-body\">\n                <p>Council and Leadership see a <strong>pencil</strong> button beside each item - click it to set the note, owner and category. Read-only members see the badges and notes but no button.</p>\n                <p><strong>Owner</strong> - search a player by name and the picker fills in their ID. For <strong>Member Owned</strong> items you can toggle between searching your current faction members or all of Torn. <strong>Faction Owned</strong> items are set to your faction automatically.</p>\n            </div>\n        </details>\n        <details class=\"an-guide-card\">\n            <summary class=\"an-cfg-summary\">Categories &amp; Colours</summary>\n            <div class=\"an-cfg-body\">\n                <p>Three categories - <strong>Faction Owned</strong>, <strong>Member Owned</strong> and <strong>Loaned From</strong> - colour-code each item. Picking a category sets its colour automatically; leave it as <strong>None</strong> to choose a custom colour instead.</p>\n                <p>Colours are shared across your whole faction and can be changed by Leadership in the settings below.</p>\n            </div>\n        </details>\n        <details class=\"an-guide-card\">\n            <summary class=\"an-cfg-summary\">Loaned-In &amp; Family Sharing</summary>\n            <div class=\"an-cfg-body\">\n                <p>If your faction is in a family, an item belonging to another family faction shows a loaned-in badge with that faction's name and a <strong>⇠</strong> marker, in the loaned-in colour.</p>\n                <p>These are <strong>read-only</strong>: the button becomes an <strong>eye</strong> - open it to see the true owner and note. The item should be returned to that faction after use.</p>\n            </div>\n        </details>\n        <details class=\"an-guide-card\">\n            <summary class=\"an-cfg-summary\">Retrieve &amp; Give (Writers)</summary>\n            <div class=\"an-cfg-body\">\n                <p>On the <strong>Armoury</strong> tab, <strong>Retrieve items</strong> and <strong>Give items</strong> stage bulk actions one click at a time. Retrieve recalls loaned-out items; Give hands available items to a chosen member.</p>\n                <p>Both let you filter by mode (loaned-in, member owned, everything), item and owner, and skip individual items. Give also takes a quantity and a recipient. The buttons only appear when Torn shows the matching action, so they respect your faction permissions.</p>\n            </div>\n        </details>\n        <details class=\"an-guide-card\">\n            <summary class=\"an-cfg-summary\">Migrating Your Notes</summary>\n            <div class=\"an-cfg-body\">\n                <p>Moved factions? <strong>Migrate Notes</strong> (on the Armoury tab) requests moving every note you own from other family factions into your current one. A leader of the origin faction approves it; the notes are then copied in and the originals released.</p>\n                <p>You will be able to edit them once your new faction's leadership grants you write access. <strong>Leaders</strong> see a flashing <strong>Approve migrations</strong> button when there are requests to move notes out of their faction.</p>\n            </div>\n        </details>\n        <details class=\"an-cfg-details\">\n        <summary class=\"an-cfg-summary\">Configuration &amp; Settings</summary>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Account &amp; Access</div>\n            <div class=\"dss-guide-card-body\">\n                <p id=\"an-access-summary\" style=\"white-space:pre-line;\">Loading access...</p>\n<div style=\"display:flex;gap:8px;align-items:center;margin:16px 0;flex-wrap:wrap;\">\n    <span style=\"color:#777;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;min-width:90px;\">Armoury key</span>\n    <input type=\"text\" id=\"an-armoury-key\" class=\"an-key-hidden\" placeholder=\"Selects which faction's notes DB you use\"\n        style=\"flex:1;min-width:200px;padding:8px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#ccc;font-size:12px;font-family:monospace;outline:none;\" autocomplete=\"off\" />\n    <button id=\"an-armoury-key-toggle\" title=\"Show/hide\" style=\"padding:8px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#ccc;font-size:12px;cursor:pointer;\">👁</button>\n    <button id=\"an-armoury-key-save\" style=\"padding:8px 16px;background:rgba(76,175,80,0.2);border:1px solid rgba(76,175,80,0.4);border-radius:4px;color:#4caf50;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;\">Save</button>\n    <button id=\"an-access-refresh\" style=\"padding:8px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#ccc;font-size:12px;cursor:pointer;white-space:nowrap;\">Refresh Access</button>\n</div>\n                <p style=\"font-size:11px;color:#777;margin-top:6px;\">Not the same as your Torn API key (which comes from the DSS Setup page). This selects which faction's shared notes you connect to — get it from whoever set up your faction's Armoury Notes.</p>\n                <div id=\"an-key-status\" style=\"font-size:11px;min-height:16px;margin-top:4px;\"></div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Show notes on these pages</div>\n            <div class=\"dss-guide-card-body\">\n                <div class=\"an-page-toggle\" style=\"display:flex;align-items:center;gap:8px;margin-bottom:6px;\"><input type=\"checkbox\" id=\"an-page-armoury\"><label for=\"an-page-armoury\">Faction Armoury</label></div>\n                <div class=\"an-page-toggle\" style=\"display:flex;align-items:center;gap:8px;margin-bottom:6px;\"><input type=\"checkbox\" id=\"an-page-inventory\"><label for=\"an-page-inventory\">Inventory (Items page)</label></div>\n                <div class=\"an-page-toggle\" style=\"display:flex;align-items:center;gap:8px;\"><input type=\"checkbox\" id=\"an-page-trade\"><label for=\"an-page-trade\">Trade window</label></div>\n                <p style=\"font-size:11px;color:#777;margin-top:8px;\">Applies next time you load that page.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\" id=\"an-categories-card\" style=\"display:none;\">\n            <div class=\"dss-guide-card-header\">Category colours (Leadership)</div>\n            <div class=\"dss-guide-card-body\">\n                <p style=\"font-size:11px;color:#777;margin-bottom:8px;\">These colours are shared by everyone in your faction. Clearing a colour reverts it to the default.</p>\n                <div id=\"an-categories-list\"></div>\n                <div id=\"an-categories-status\" style=\"font-size:11px;min-height:16px;margin-top:4px;\"></div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\" id=\"an-leadership-card\" style=\"display:none;\">\n            <div class=\"dss-guide-card-header\">Manage Access (Leadership)</div>\n            <div class=\"dss-guide-card-body\">\n                <p style=\"font-size:11px;color:#777;margin-bottom:8px;\">Add or remove Leadership and Council members. Changes apply for everyone.</p>\n                <button id=\"an-open-council\" style=\"padding:8px 16px;background:rgba(96,165,250,0.15);border:1px solid rgba(96,165,250,0.4);border-radius:4px;color:#60a5fa;font-size:12px;font-weight:600;cursor:pointer;\">Open Access Manager</button>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\" id=\"an-danger-card\" style=\"display:none;\">\n            <div class=\"dss-guide-card-header\">Danger zone</div>\n            <div class=\"dss-guide-card-body\">\n                <div class=\"an-page-toggle\" style=\"display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;\">\n                    <input type=\"checkbox\" id=\"an-deletion-mode\" style=\"margin-top:2px;\">\n                    <label for=\"an-deletion-mode\" style=\"color:#ff8a80;\">Deletion mode — note buttons delete instead of edit, on every page, until turned off.</label>\n                </div>\n                <button id=\"an-clear-cache\" style=\"padding:8px 16px;background:rgba(220,70,70,0.18);border:1px solid rgba(220,70,70,0.4);border-radius:4px;color:#ff8a80;font-size:12px;cursor:pointer;\">Clear Notes Cache</button>\n                <div id=\"an-danger-status\" style=\"font-size:11px;min-height:16px;margin-top:6px;\"></div>\n            </div>\n        </div>\n        </details>\n    ";

// src/modules/armoury-notes/index.js
	registerModule("armoury-notes", {
		name: "Armoury Notes",
		version: "1.1",
		pages: ["https://www.torn.com/"],
		description: "Shared faction item notes with owner, category and colour tags. Edit access authenticated via your Torn API key; everyone else is read-only.",
		guide: guide_default$5,
		init() {
			"use strict";
			const SERVER_BASE = "https://tornarmourynotesmanager-production.up.railway.app";
			const TORN_V2 = "https://api.torn.com/v2";
			const DEBUG = false;
			const log = (...a) => DEBUG && console.log("[ArmouryNotes]", ...a);
			const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768 || "ontouchstart" in window;
			const ARMOURY_KEY_STORE = "an-armoury-key";
			const DELETION_MODE_KEY = "an-deletion-mode";
			const PAGE_ENABLE_KEY = "an-enabled-pages-v1";
			const CACHE_KEY = "an-cache-v1";
			const ACCESS_CACHE_KEY = "an-access-cache-v1";
			const CACHE_TTL_MS = 30 * 1e3;
			const ACCESS_CACHE_TTL_MS = 5 * 60 * 1e3;
			const getArmouryKey = () => (GM_getValue(ARMOURY_KEY_STORE, "") || "").trim();
			const setArmouryKey = (k) => GM_setValue(ARMOURY_KEY_STORE, (k || "").trim());
			const getTornKey = () => (Storage.getSettings().apiKey || "").trim();
			let ARMOURY_KEY = getArmouryKey();
			let TORN_API_KEY = getTornKey();
			const PAGE_FOR_PATH = {
				"/item.php": "inventory",
				"/factions.php": "armoury",
				"/trade.php": "trade"
			};
			const DEFAULT_ENABLED_PAGES = {
				armoury: true,
				inventory: true,
				trade: true
			};
			function getEnabledPages() {
				let stored = null;
				try {
					stored = GM_getValue(PAGE_ENABLE_KEY, null);
				} catch (e) {
					log("getEnabledPages", e);
				}
				return {
					...DEFAULT_ENABLED_PAGES,
					...stored && typeof stored === "object" ? stored : {}
				};
			}
			const setEnabledPages = (p) => {
				try {
					GM_setValue(PAGE_ENABLE_KEY, p);
				} catch (e) {
					log("setEnabledPages", e);
				}
			};
			let deletionMode = !!GM_getValue(DELETION_MODE_KEY, false);
			function setDeletionMode(v) {
				deletionMode = !!v;
				try {
					GM_setValue(DELETION_MODE_KEY, deletionMode);
				} catch (e) {
					log("deletion persist", e);
				}
				renderDeletionBanner();
				document.querySelectorAll(".an-note-btn").forEach(setNoteButtonMode);
			}
			let USER_ROLE = "readonly";
			let USER_CAN_WRITE = false;
			let TORN_USER_ID = null;
			let TORN_USER_NAME = null;
			let ACCESS_SOURCE = "live";
			let CATEGORIES = [];
			const catById = (id) => CATEGORIES.find((c) => c.id === id) || null;
			let MY_FACTION_ID = (Storage.getSettings().myFactionId || "").toString() || null;
			let MY_FACTION_NAME = null;
			const IS_PDA_LOCAL = IS_PDA;
			function sleep(ms) {
				return new Promise((r) => setTimeout(r, ms));
			}
			function serverRequest(method, path, body) {
				return new Promise((resolve, reject) => {
					if (!hasGmRequest()) {
						reject(new Error("No GM_xmlhttpRequest available"));
						return;
					}
					gmRequest({
						method,
						url: SERVER_BASE + path,
						headers: {
							"Content-Type": "application/json",
							"X-API-Key": ARMOURY_KEY,
							"X-Torn-API-Key": TORN_API_KEY || ""
						},
						data: body != null ? JSON.stringify(body) : undefined,
						timeout: 12e3,
						onload: (r) => resolve({
							status: Number(r.status || 0),
							text: r.responseText || ""
						}),
						onerror: () => reject(new Error("network error")),
						ontimeout: () => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" }))
					});
				});
			}
			async function req(method, path, body) {
				const MAX = 3;
				let res;
				for (let attempt = 1; attempt <= MAX; attempt++) {
					try {
						res = await serverRequest(method, path, body);
						break;
					} catch (e) {
						if (attempt === MAX) throw e;
						await sleep(300 * attempt);
					}
				}
				let data;
				try {
					data = res.text ? JSON.parse(res.text) : {};
				} catch {
					throw Object.assign(new Error(`Non-JSON from server (HTTP ${res.status})`), { status: res.status });
				}
				if (res.status >= 200 && res.status < 300) return data;
				throw Object.assign(new Error(data?.error || data?.message || `HTTP ${res.status}`), {
					status: res.status,
					serverResponse: data
				});
			}
			async function tornApi(path) {
				const key = TORN_API_KEY;
				if (!key) throw new Error("No Torn API key");
				const res = await fetch(`${TORN_V2}${path}`, { headers: {
					"Accept": "application/json",
					"Authorization": "ApiKey " + key
				} });
				const data = await res.json().catch(() => ({}));
				if (data?.error) throw new Error(data.error.error || "Torn API error");
				return data;
			}
			injectBaseStyles();
			let toastTimer = null;
			function toast(msg, type = "info") {
				let el = document.getElementById("an-toast");
				if (!el) {
					el = document.createElement("div");
					el.id = "an-toast";
					document.body.appendChild(el);
				}
				el.textContent = msg;
				el.className = "an-toast an-toast-" + type + " an-show";
				clearTimeout(toastTimer);
				toastTimer = setTimeout(() => {
					el.classList.remove("an-show");
				}, 3200);
			}
			function confirmDialog(message, { danger = false, okLabel = "Confirm" } = {}) {
				return new Promise((resolve) => {
					const overlay = document.createElement("div");
					overlay.className = "an-modal-overlay";
					const panel = document.createElement("div");
					panel.className = "an-modal-panel an-confirm";
					panel.innerHTML = `<div class="an-confirm-msg"></div>
                    <div class="an-modal-footer">
                        <button class="an-btn an-btn-cancel">Cancel</button>
                        <button class="an-btn ${danger ? "an-btn-danger" : "an-btn-primary"} an-btn-ok">${okLabel}</button>
                    </div>`;
					panel.querySelector(".an-confirm-msg").textContent = message;
					const done = (v) => {
						overlay.remove();
						document.removeEventListener("keydown", onKey, true);
						resolve(v);
					};
					const onKey = (e) => {
						if (e.key === "Escape") {
							e.stopPropagation();
							done(false);
						}
					};
					panel.querySelector(".an-btn-cancel").addEventListener("click", () => done(false));
					panel.querySelector(".an-btn-ok").addEventListener("click", () => done(true));
					overlay.addEventListener("mousedown", (e) => {
						if (e.target === overlay) done(false);
					});
					overlay.appendChild(panel);
					document.body.appendChild(overlay);
					document.addEventListener("keydown", onKey, true);
				});
			}
			const readAccessCache = () => {
				try {
					const c = GM_getValue(ACCESS_CACHE_KEY, null);
					return c && c.d ? c : null;
				} catch {
					return null;
				}
			};
			const writeAccessCache = (d) => {
				try {
					GM_setValue(ACCESS_CACHE_KEY, {
						d,
						t: Date.now()
					});
				} catch (e) {
					log("acc cache", e);
				}
			};
			async function fetchAccessLive() {
				if (!ARMOURY_KEY) return {
					ok: false,
					invalidKey: true
				};
				for (let attempt = 1; attempt <= 3; attempt++) {
					try {
						const res = await serverRequest("GET", "/api/access-check");
						const data = res.text ? JSON.parse(res.text) : {};
						if (res.status >= 200 && res.status < 300) return {
							ok: true,
							...data
						};
						if (res.status === 401) return {
							ok: false,
							invalidKey: true
						};
						return { ok: false };
					} catch (e) {
						if (attempt === 3) return { ok: false };
						await sleep(300 * attempt);
					}
				}
				return { ok: false };
			}
			async function getAccessRole() {
				const cached = readAccessCache();
				if (cached && Date.now() - cached.t < ACCESS_CACHE_TTL_MS) {
					ACCESS_SOURCE = "cache";
					return cached.d;
				}
				const result = await fetchAccessLive();
				if (result.ok) {
					ACCESS_SOURCE = "live";
					const d = {
						role: result.role || "readonly",
						canWrite: !!result.canWrite,
						userId: result.userId || null,
						name: result.name || null
					};
					writeAccessCache(d);
					return d;
				}
				if (result.invalidKey) {
					ACCESS_SOURCE = "invalid-key";
					return {
						role: "readonly",
						canWrite: false,
						userId: null,
						name: null
					};
				}
				ACCESS_SOURCE = "error";
				if (cached) return cached.d;
				return {
					role: "readonly",
					canWrite: false,
					userId: null,
					name: null
				};
			}
			async function forceRefreshAccess() {
				try {
					GM_deleteValue(ACCESS_CACHE_KEY);
				} catch (e) {
					log("acc clear", e);
				}
				const before = {
					role: USER_ROLE,
					canWrite: USER_CAN_WRITE
				};
				const fresh = await getAccessRole();
				USER_ROLE = fresh.role;
				USER_CAN_WRITE = !!fresh.canWrite;
				TORN_USER_ID = fresh.userId;
				TORN_USER_NAME = fresh.name;
				if (fresh.role !== before.role || !!fresh.canWrite !== before.canWrite) {
					toast("Access level changed — reloading...", "info");
					setTimeout(() => location.reload(), 900);
				} else {
					toast(`Access level unchanged (${fresh.role}).`, "info");
				}
			}
			async function loadCategories() {
				try {
					CATEGORIES = await req("GET", "/api/categories");
				} catch (e) {
					log("loadCategories", e);
					CATEGORIES = [];
				}
			}
			async function resolveFactionIdentity() {
				try {
					const data = await tornApi("/faction/basic");
					if (data?.basic?.id) MY_FACTION_ID = String(data.basic.id);
					if (data?.basic?.name) MY_FACTION_NAME = data.basic.name;
				} catch (e) {
					log("faction basic", e);
				}
			}
			let ownerSearchTimer = null;
			async function searchUsers(query) {
				if (!query || query.length < 3) return [];
				try {
					const data = await tornApi(`/user/search?name=${encodeURIComponent(query)}`);
					return (data?.search || []).map((u) => ({
						id: u.id,
						name: u.name,
						factionId: u.faction_id || null,
						online: u.online || null
					}));
				} catch (e) {
					log("user search", e);
					return [];
				}
			}
			async function fetchFactionMembers() {
				try {
					const data = await tornApi("/faction/members");
					const raw = Array.isArray(data?.members) ? data.members : data?.members && typeof data.members === "object" ? Object.entries(data.members).map(([id, m]) => ({
						id: Number(id),
						...m
					})) : [];
					return raw.map((m) => ({
						id: Number(m.id),
						name: m.name,
						position: m.position || ""
					})).filter((m) => m.id && m.name);
				} catch (e) {
					log("faction members", e);
					return null;
				}
			}
			let NOTE_ROSTER = null;
			let noteRosterTried = false;
			async function getNoteRoster() {
				if (NOTE_ROSTER || noteRosterTried) return NOTE_ROSTER;
				noteRosterTried = true;
				NOTE_ROSTER = await fetchFactionMembers();
				return NOTE_ROSTER;
			}
			function normalizeName(s) {
				return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
			}
			function findIdentifiers(el) {
				const root = el.closest ? el.closest("li") || el : el;
				const ds = root?.dataset || {};
				let aid = ds.armoryid || ds.armoury || ds.armouryid || null;
				let iid = ds.itemid || null;
				if ((!aid || !iid) && root && root.querySelector) {
					const found = root.querySelector("[data-armoryid],[data-armoury],[data-armouryid],[data-itemid]");
					if (found) {
						const d2 = found.dataset || {};
						aid = aid || d2.armoryid || d2.armoury || d2.armouryid || null;
						iid = iid || d2.itemid || null;
					}
				}
				if (!aid && root.getAttribute) {
					const rid = root.getAttribute("data-reactid");
					if (rid) {
						const m = rid.match(/\$(\d+)(?:\.[^.]+)?$/);
						if (m) aid = m[1];
					}
				}
				if (!aid && root.querySelector) {
					const cb = root.querySelector("input[type=\"checkbox\"][id*=\"-\"]");
					const id = cb && cb.id;
					if (id) {
						const m2 = id.match(/-(\d+)$/);
						if (m2) aid = m2[1];
					}
				}
				if ((!aid || !iid) && root.querySelector) {
					const link = root.querySelector("a[href*=\"armoryID=\"], a[href*=\"itemID=\"]");
					if (link) {
						const href = link.getAttribute("href") || "";
						const mA = href.match(/armoryID=(\d+)/);
						const mI = href.match(/itemID=(\d+)/);
						if (mA && !aid) aid = mA[1];
						if (mI && !iid) iid = mI[1];
					}
				}
				return {
					aid,
					iid
				};
			}
			function keyFromIds(name, ids) {
				if (ids?.aid) return `armouryid:${ids.aid}`;
				if (ids?.iid) return `itemid:${ids.iid}`;
				return `name:${normalizeName(name)}`;
			}
			let CACHE = {};
			try {
				const raw = GM_getValue(CACHE_KEY);
				if (raw && typeof raw === "object") CACHE = raw;
			} catch (e) {
				log("cache load", e);
			}
			let persistTimer = null;
			function persistCacheSoon() {
				clearTimeout(persistTimer);
				persistTimer = setTimeout(() => {
					try {
						GM_setValue(CACHE_KEY, CACHE);
					} catch (e) {
						log("cache save", e);
					}
				}, 250);
			}
			const inflight = new Map();
			const getCached = (k) => CACHE[k] ? CACHE[k].d : {};
			const isFresh = (k) => {
				const e = CACHE[k];
				return e ? Date.now() - e.t < CACHE_TTL_MS : false;
			};
			function setCached(k, d) {
				CACHE[k] = {
					d: d || {},
					t: Date.now()
				};
				persistCacheSoon();
				return CACHE[k].d;
			}
			async function fetchRemote(key) {
				if (inflight.has(key)) return inflight.get(key);
				const p = (async () => {
					try {
						const d = await req("GET", `/api/torn-notes/${encodeURIComponent(key)}`);
						return setCached(key, d || {});
					} catch (e) {
						log("fetchRemote", key, e);
						return getCached(key);
					} finally {
						inflight.delete(key);
					}
				})();
				inflight.set(key, p);
				return p;
			}
			async function ensureFresh(key, { force = false } = {}) {
				if (!force && isFresh(key)) return getCached(key);
				return await fetchRemote(key);
			}
			async function saveData(key, data) {
				const d = setCached(key, data || {});
				try {
					applyDataToUI(key, d);
				} catch (e) {
					log("applyDataToUI", e);
				}
				try {
					await req("PUT", `/api/torn-notes/${encodeURIComponent(key)}`, data);
					return true;
				} catch (e) {
					console.error("[ArmouryNotes] PUT failed", key, e);
					toast("Failed to save note — see console.", "error");
					return false;
				}
			}
			async function delData(key) {
				const prev = getCached(key);
				setCached(key, {});
				try {
					applyDataToUI(key, {});
				} catch (e) {
					log("applyDataToUI del", e);
				}
				try {
					await req("DELETE", `/api/torn-notes/${encodeURIComponent(key)}`);
					return true;
				} catch (e) {
					log("DELETE failed", key, e);
					setCached(key, prev);
					try {
						applyDataToUI(key, prev);
					} catch {}
					toast("Failed to delete note — see console.", "error");
					return false;
				}
			}
			const UI_INDEX = new Map();
			function registerUI(key, refs) {
				let s = UI_INDEX.get(key);
				if (!s) {
					s = new Set();
					UI_INDEX.set(key, s);
				}
				s.add(refs);
			}
			function applyDataToUI(key, d) {
				const set = UI_INDEX.get(key);
				if (!set) return;
				const inherited = !!(d && d.inherited);
				for (const refs of Array.from(set)) {
					const { li, badge, tooltipEl, btn } = refs;
					if (!li.isConnected || !badge) {
						set.delete(refs);
						continue;
					}
					if (btn) setNoteButtonInherited(btn, inherited);
					const anchor = tooltipEl || li;
					let tip = d.note || "";
					if (inherited && d.sourceFaction) tip = `Loaned in from ${d.sourceFaction}` + (tip ? ` — ${tip}` : "");
					if (tip) anchor.setAttribute("data-note-tooltip", tip);
					else anchor.removeAttribute("data-note-tooltip");
					let colourVal;
					if (inherited) {
						const li = catById("loaned_from");
						colourVal = (li ? li.colour : d.colour || "").trim();
					} else {
						const cat = d.category ? catById(d.category) : null;
						colourVal = (cat ? cat.colour : d.colour || "").trim();
					}
					applyBadgeColour(badge, colourVal);
					const isLoaned = inherited || d.category === "loaned_from";
					badge.classList.toggle("an-loaned", isLoaned);
					badge.classList.toggle("an-inherited", inherited);
					const labelTxt = inherited ? d.sourceFaction || "another faction" : d.owner || "";
					const txt = isLoaned && labelTxt ? `⇠ ${labelTxt}` : labelTxt;
					if (badge.textContent !== txt) badge.textContent = txt;
					if (d.ownerId) badge.dataset.ownerId = String(d.ownerId);
					else delete badge.dataset.ownerId;
					const show = !!labelTxt || !!colourVal;
					const want = show ? "inline-block" : "none";
					if (badge.style.display !== want) badge.style.display = want;
				}
			}
			function repaintAllBadges() {
				for (const key of UI_INDEX.keys()) applyDataToUI(key, getCached(key));
			}
			const STALE_KEYS = new Set();
			let refreshTimer = null;
			const CONCURRENCY = IS_PDA_LOCAL ? 2 : 8;
			const BATCH_CHUNK_SIZE = 150;
			function scheduleRefresh() {
				if (refreshTimer) return;
				refreshTimer = setTimeout(() => {
					refreshTimer = null;
					refreshPass().catch((e) => log("refreshPass", e));
				}, 60);
			}
			async function limitParallel(n, arr, worker) {
				let i = 0;
				const workers = new Array(Math.min(n, arr.length)).fill(0).map(async () => {
					while (true) {
						const idx = i++;
						if (idx >= arr.length) break;
						try {
							await worker(arr[idx], idx);
						} catch (e) {
							log("worker", e);
						}
					}
				});
				await Promise.all(workers);
			}
			async function fetchRemoteBatch(keys) {
				const uniq = Array.from(new Set(keys));
				if (!uniq.length) return {};
				const results = {};
				const toFetch = [];
				const piggyback = [];
				for (const k of uniq) {
					const ex = inflight.get(k);
					if (ex) piggyback.push(ex.then(() => {
						results[k] = getCached(k);
					}));
					else toFetch.push(k);
				}
				const chunks = [];
				for (let i = 0; i < toFetch.length; i += BATCH_CHUNK_SIZE) chunks.push(toFetch.slice(i, i + BATCH_CHUNK_SIZE));
				await limitParallel(CONCURRENCY, chunks, async (chunk) => {
					const p = (async () => {
						try {
							const data = await req("POST", "/api/torn-notes/batch-get", { keys: chunk });
							for (const k of chunk) setCached(k, data[k] || {});
						} catch (e) {
							log("batch-get", chunk, e);
						} finally {
							for (const k of chunk) inflight.delete(k);
						}
					})();
					for (const k of chunk) inflight.set(k, p);
					await p;
					for (const k of chunk) results[k] = getCached(k);
				});
				await Promise.all(piggyback);
				return results;
			}
			async function refreshKeys(keys) {
				const uniq = Array.from(new Set(keys));
				if (!uniq.length) return;
				const results = await fetchRemoteBatch(uniq);
				for (const k of uniq) applyDataToUI(k, results[k] !== undefined ? results[k] : getCached(k));
			}
			async function refreshPass() {
				const keys = Array.from(STALE_KEYS);
				STALE_KEYS.clear();
				if (!keys.length) return;
				await refreshKeys(keys);
			}
			function makeNoteIconSvg() {
				const NS = "http://www.w3.org/2000/svg";
				const svg = document.createElementNS(NS, "svg");
				svg.setAttribute("viewBox", "0 0 24 24");
				svg.setAttribute("width", "13");
				svg.setAttribute("height", "13");
				svg.setAttribute("aria-hidden", "true");
				svg.style.display = "block";
				const path = document.createElementNS(NS, "path");
				path.setAttribute("fill", "currentColor");
				path.setAttribute("d", "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z");
				svg.appendChild(path);
				return svg;
			}
			function makeBinIconSvg() {
				const NS = "http://www.w3.org/2000/svg";
				const svg = document.createElementNS(NS, "svg");
				svg.setAttribute("viewBox", "0 0 24 24");
				svg.setAttribute("width", "13");
				svg.setAttribute("height", "13");
				svg.setAttribute("aria-hidden", "true");
				svg.style.display = "block";
				const path = document.createElementNS(NS, "path");
				path.setAttribute("fill", "currentColor");
				path.setAttribute("d", "M6 7h12l-1 14H7L6 7Zm3-3h6l1 2h4v2H2V6h4l1-2Z");
				svg.appendChild(path);
				return svg;
			}
			function makeEyeIconSvg() {
				const NS = "http://www.w3.org/2000/svg";
				const svg = document.createElementNS(NS, "svg");
				svg.setAttribute("viewBox", "0 0 24 24");
				svg.setAttribute("width", "13");
				svg.setAttribute("height", "13");
				svg.setAttribute("aria-hidden", "true");
				svg.style.display = "block";
				const p1 = document.createElementNS(NS, "path");
				p1.setAttribute("fill", "currentColor");
				p1.setAttribute("d", "M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z");
				const p2 = document.createElementNS(NS, "circle");
				p2.setAttribute("fill", "currentColor");
				p2.setAttribute("cx", "12");
				p2.setAttribute("cy", "12");
				p2.setAttribute("r", "2");
				svg.appendChild(p1);
				svg.appendChild(p2);
				return svg;
			}
			function makeNoteButton() {
				const b = document.createElement("button");
				b.className = "an-note-btn";
				setNoteButtonMode(b);
				return b;
			}
			function setNoteButtonMode(b) {
				b.textContent = "";
				b.appendChild(deletionMode ? makeBinIconSvg() : makeNoteIconSvg());
				b.title = deletionMode ? "Delete this note" : "Add/edit note, owner, category";
				b.classList.toggle("an-note-btn-del", deletionMode);
				b.classList.remove("an-note-btn-view");
			}
			function setNoteButtonInherited(b, inherited) {
				if (!b) return;
				if (inherited) {
					b.textContent = "";
					b.appendChild(makeEyeIconSvg());
					b.title = "View note (loaned in from another faction, read-only)";
					b.classList.remove("an-note-btn-del");
					b.classList.add("an-note-btn-view");
				} else {
					setNoteButtonMode(b);
				}
			}
			function makeOwnerBadge() {
				const el = document.createElement("span");
				el.className = "an-owner-badge";
				el.style.display = "none";
				return el;
			}
			function applyBadgeColour(badge, colour) {
				if (!badge) return;
				const val = (colour || "").trim();
				if (val) {
					badge.dataset.colour = val;
					badge.style.borderColor = val;
					badge.style.boxShadow = `0 0 0 2px ${val}`;
				} else {
					delete badge.dataset.colour;
					badge.style.borderColor = "";
					badge.style.boxShadow = "";
				}
			}
			const tooltip = document.createElement("div");
			tooltip.className = "an-tooltip";
			document.body.appendChild(tooltip);
			let tooltipTimeout = null, raf = null;
			function showTooltip(el, x, y) {
				const txt = el.getAttribute("data-note-tooltip");
				if (!txt) return;
				tooltip.textContent = txt;
				tooltip.style.opacity = "1";
				tooltip.style.transform = "translate3d(0,0,0) scale(1)";
				positionTooltip(x, y);
				if (isMobile) tooltipTimeout = setTimeout(hideTooltip, 2500);
			}
			function hideTooltip() {
				tooltip.style.opacity = "0";
				tooltip.style.transform = "translate3d(0,2px,0) scale(0.98)";
				clearTimeout(tooltipTimeout);
			}
			function positionTooltip(x, y) {
				const pad = 16, vw = innerWidth, vh = innerHeight, rect = tooltip.getBoundingClientRect();
				let left = x + pad, top = y + pad;
				if (left + rect.width > vw - pad) left = vw - rect.width - pad;
				if (top + rect.height > vh - pad) top = vh - rect.height - pad;
				tooltip.style.left = left + "px";
				tooltip.style.top = top + "px";
			}
			if (isMobile) {
				document.body.addEventListener("touchstart", (e) => {
					const t = e.target.closest("[data-note-tooltip]");
					if (t) {
						const tc = e.touches[0];
						showTooltip(t, tc.clientX, tc.clientY);
					} else hideTooltip();
				});
			} else {
				document.body.addEventListener("mousemove", (e) => {
					if (raf) cancelAnimationFrame(raf);
					raf = requestAnimationFrame(() => {
						const t = e.target.closest("[data-note-tooltip]");
						if (!t) return hideTooltip();
						showTooltip(t, e.clientX, e.clientY);
					});
				});
			}
			const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
			let noteModalEl = null, noteModalKey = null, noteModalApplyRemote = null;
			function closeNoteModal() {
				if (noteModalEl) {
					noteModalEl.remove();
					noteModalEl = null;
				}
				noteModalKey = null;
				noteModalApplyRemote = null;
				document.removeEventListener("keydown", onNoteModalKeydown, true);
			}
			function onNoteModalKeydown(e) {
				if (e.key === "Escape") {
					e.stopPropagation();
					closeNoteModal();
				}
			}
			function applyRemoteToOpenNoteModal(key, data) {
				if (noteModalKey === key && noteModalApplyRemote) noteModalApplyRemote(data);
			}
			function openNoteModal(key, label, cur, { onSave, onDelete, readOnly = false } = {}) {
				closeNoteModal();
				noteModalKey = key;
				const overlay = document.createElement("div");
				overlay.className = "an-modal-overlay";
				const panel = document.createElement("div");
				panel.className = "an-modal-panel";
				panel.innerHTML = `
                <div class="an-modal-title"></div>
                <div class="an-field">
                    <label class="an-label">Note</label>
                    <textarea class="an-textarea" id="an-f-note"></textarea>
                </div>
                <div class="an-field">
                    <label class="an-label">Category</label>
                    <select class="an-input" id="an-f-category">
                        <option value="">None</option>
                    </select>
                </div>
                <div class="an-field" id="an-owner-field">
                    <label class="an-label">Owner</label>
                    <div class="an-owner-wrap">
                        <input type="text" class="an-input" id="an-f-owner" placeholder="Search player name..." autocomplete="off">
                        <div class="an-owner-dropdown" id="an-owner-dd"></div>
                    </div>
                    <label class="an-owner-scope" id="an-owner-scope" style="display:none;">
                        <input type="checkbox" id="an-f-scope" checked>
                        <span>Current faction members only</span>
                    </label>
                    <div class="an-owner-hint" id="an-owner-hint"></div>
                </div>
                <div class="an-field" id="an-colour-field">
                    <label class="an-label">Colour tag</label>
                    <div class="an-colour-row">
                        <input type="color" id="an-f-colour-pick">
                        <input type="text" class="an-input" id="an-f-colour-text" placeholder="#ff8800 (blank = none)">
                    </div>
                </div>
                <div class="an-modal-footer">
                    <span class="an-status" id="an-f-status"></span>
                    <button class="an-btn an-btn-danger" id="an-f-delete">Delete</button>
                    <button class="an-btn" id="an-f-cancel">Cancel</button>
                    <button class="an-btn an-btn-primary" id="an-f-save">Save</button>
                </div>`;
				panel.querySelector(".an-modal-title").textContent = readOnly ? `Note — ${label}` : `Edit note — ${label}`;
				const noteInput = panel.querySelector("#an-f-note");
				const catSelect = panel.querySelector("#an-f-category");
				const ownerField = panel.querySelector("#an-owner-field");
				const ownerInput = panel.querySelector("#an-f-owner");
				const ownerDd = panel.querySelector("#an-owner-dd");
				const ownerHint = panel.querySelector("#an-owner-hint");
				const scopeWrap = panel.querySelector("#an-owner-scope");
				const scopeCb = panel.querySelector("#an-f-scope");
				const colourField = panel.querySelector("#an-colour-field");
				const colourPick = panel.querySelector("#an-f-colour-pick");
				const colourText = panel.querySelector("#an-f-colour-text");
				const statusEl = panel.querySelector("#an-f-status");
				const deleteBtn = panel.querySelector("#an-f-delete");
				const cancelBtn = panel.querySelector("#an-f-cancel");
				const saveBtn = panel.querySelector("#an-f-save");
				CATEGORIES.forEach((c) => {
					const o = document.createElement("option");
					o.value = c.id;
					o.textContent = c.label;
					catSelect.appendChild(o);
				});
				let ownerSel = {
					id: cur.ownerId || null,
					name: cur.owner || ""
				};
				noteInput.value = cur.note || "";
				catSelect.value = cur.category || "";
				ownerInput.value = cur.owner || "";
				colourText.value = cur.category ? "" : cur.colour || "";
				colourPick.value = HEX.test(colourText.value) ? colourText.value : "#ffffff";
				if (readOnly) {
					const src = cur.sourceFaction || "another faction";
					const banner = document.createElement("div");
					banner.className = "an-readonly-banner";
					banner.textContent = `Loaned in from ${src} — read-only. Owned by ${cur.owner || "unknown"}.`;
					panel.insertBefore(banner, panel.children[1]);
					[
						noteInput,
						catSelect,
						ownerInput,
						colourPick,
						colourText,
						scopeCb
					].forEach((el) => {
						if (el) el.disabled = true;
					});
					deleteBtn.style.display = "none";
					saveBtn.style.display = "none";
					cancelBtn.textContent = "Close";
					cancelBtn.addEventListener("click", closeNoteModal);
					let downRO = false;
					overlay.addEventListener("mousedown", (e) => {
						downRO = e.target === overlay;
					});
					overlay.addEventListener("click", (e) => {
						if (e.target === overlay && downRO) closeNoteModal();
						downRO = false;
					});
					overlay.appendChild(panel);
					document.body.appendChild(overlay);
					noteModalEl = overlay;
					document.addEventListener("keydown", onNoteModalKeydown, true);
					return;
				}
				function refreshCategoryDependentUI() {
					const cat = catSelect.value;
					colourField.style.display = cat ? "none" : "";
					if (cat === "faction_owned") {
						ownerField.style.display = "none";
						ownerSel = {
							id: null,
							name: MY_FACTION_NAME || MY_FACTION_ID || "Faction"
						};
					} else {
						ownerField.style.display = "";
						if (ownerInput.value === (MY_FACTION_NAME || MY_FACTION_ID)) {}
					}
					if (cat === "member_owned") {
						if (scopeWrap.style.display === "none") scopeCb.checked = true;
						scopeWrap.style.display = "";
					} else {
						scopeWrap.style.display = "none";
					}
					updateOwnerHint();
				}
				function updateOwnerHint() {
					const cat = catSelect.value;
					ownerHint.textContent = "";
					ownerHint.classList.remove("an-owner-hint-warn");
					const typed = (ownerInput.value || "").trim();
					if (cat !== "faction_owned" && typed && !ownerSel.id) {
						ownerHint.textContent = "Not a selected player yet — pick one from the list.";
						ownerHint.classList.add("an-owner-hint-warn");
						return;
					}
					if (!ownerSel.id || !MY_FACTION_ID) return;
					const inMyFaction = String(ownerSel.factionId || "") === String(MY_FACTION_ID);
					if (cat === "loaned_from" && inMyFaction) ownerHint.textContent = "Heads up: this player is in your faction — did you mean Member Owned?";
					else if (cat === "member_owned" && ownerSel.factionId && !inMyFaction) ownerHint.textContent = "Heads up: this player isn't in your faction - did you mean Loaned From?";
				}
				catSelect.addEventListener("change", () => {
					markDirty();
					refreshCategoryDependentUI();
				});
				function openOwnerDd() {
					const r = ownerInput.getBoundingClientRect();
					const up = r.bottom > window.innerHeight * .55;
					ownerDd.classList.toggle("an-drop-up", up);
					ownerDd.classList.toggle("an-drop-down", !up);
					ownerDd.classList.add("show");
				}
				function closeOwnerDd() {
					ownerDd.classList.remove("show");
					ownerDd.innerHTML = "";
				}
				async function searchOwners(q) {
					const factionScope = catSelect.value === "member_owned" && scopeCb.checked;
					if (factionScope) {
						const roster = await getNoteRoster();
						if (roster) {
							const ql = q.toLowerCase();
							return roster.filter((m) => (m.name || "").toLowerCase().includes(ql)).slice(0, 25).map((m) => ({
								id: m.id,
								name: m.name,
								factionId: MY_FACTION_ID,
								online: null
							}));
						}
					}
					return await searchUsers(q);
				}
				ownerInput.addEventListener("keydown", (e) => e.stopPropagation());
				function runOwnerSearch() {
					const q = ownerInput.value.trim();
					if (q.length < 3) {
						closeOwnerDd();
						return;
					}
					clearTimeout(ownerSearchTimer);
					ownerSearchTimer = setTimeout(async () => {
						const results = await searchOwners(q);
						if (!results.length) {
							ownerDd.innerHTML = "<div class=\"an-owner-item an-owner-empty\">No players found</div>";
							openOwnerDd();
							return;
						}
						ownerDd.innerHTML = results.map((r) => `<div class="an-owner-item" data-id="${r.id}" data-name="${escHtml(r.name)}" data-fac="${r.factionId || ""}">
                            <span class="an-owner-name">${escHtml(r.name)}</span>
                            <span class="an-owner-id">[${r.id}]${r.online === "Online" ? " •" : ""}</span>
                        </div>`).join("");
						openOwnerDd();
						ownerDd.querySelectorAll(".an-owner-item[data-id]").forEach((el) => {
							el.addEventListener("click", () => {
								ownerSel = {
									id: parseInt(el.dataset.id, 10),
									name: el.dataset.name,
									factionId: el.dataset.fac || null
								};
								ownerInput.value = el.dataset.name;
								closeOwnerDd();
								updateOwnerHint();
							});
						});
					}, 300);
				}
				ownerInput.addEventListener("input", () => {
					markDirty();
					ownerSel = {
						id: null,
						name: ownerInput.value.trim()
					};
					updateOwnerHint();
					runOwnerSearch();
				});
				scopeCb.addEventListener("change", () => {
					markDirty();
					runOwnerSearch();
				});
				document.addEventListener("click", (e) => {
					if (!e.target.closest("#an-owner-field")) closeOwnerDd();
				});
				colourPick.addEventListener("input", () => {
					markDirty();
					colourText.value = colourPick.value;
				});
				colourText.addEventListener("input", markDirty);
				let dirty = false;
				function markDirty() {
					dirty = true;
				}
				noteInput.addEventListener("input", markDirty);
				noteModalApplyRemote = (data) => {
					if (dirty) return;
					noteInput.value = data.note || "";
					catSelect.value = data.category || "";
					ownerInput.value = data.owner || "";
					ownerSel = {
						id: data.ownerId || null,
						name: data.owner || ""
					};
					colourText.value = data.category ? "" : data.colour || "";
					colourPick.value = HEX.test(colourText.value) ? colourText.value : "#ffffff";
					refreshCategoryDependentUI();
				};
				refreshCategoryDependentUI();
				let busy = false;
				function setBusy(b, label) {
					busy = b;
					saveBtn.disabled = b;
					deleteBtn.disabled = b;
					cancelBtn.disabled = b;
					statusEl.textContent = b ? label : "";
				}
				cancelBtn.addEventListener("click", closeNoteModal);
				deleteBtn.addEventListener("click", async () => {
					if (busy) return;
					const ok = await confirmDialog(`Delete the saved note for ${label}?`, {
						danger: true,
						okLabel: "Delete"
					});
					if (!ok) return;
					setBusy(true, "Deleting...");
					await onDelete();
					closeNoteModal();
				});
				saveBtn.addEventListener("click", async () => {
					if (busy) return;
					const category = catSelect.value || null;
					if (category !== "faction_owned") {
						const typed = (ownerInput.value || "").trim();
						if (typed && !ownerSel.id) {
							statusEl.textContent = "Pick a player from the list, or clear the owner field.";
							statusEl.style.color = "#ef4444";
							ownerInput.focus();
							return;
						}
					}
					setBusy(true, "Saving...");
					let owner = "", ownerId = null;
					if (category === "faction_owned") {
						owner = MY_FACTION_NAME || MY_FACTION_ID || "Faction";
						ownerId = null;
					} else {
						owner = (ownerInput.value || "").trim();
						ownerId = ownerSel.id || null;
					}
					const d = {
						note: noteInput.value.trim(),
						category,
						owner,
						ownerId,
						colour: category ? "" : colourText.value.trim()
					};
					const okSaved = await onSave(d);
					if (okSaved === false) {
						setBusy(false, "");
						return;
					}
					closeNoteModal();
				});
				let downOnBackdrop = false;
				overlay.addEventListener("mousedown", (e) => {
					downOnBackdrop = e.target === overlay;
				});
				overlay.addEventListener("click", (e) => {
					if (e.target === overlay && downOnBackdrop && !busy) closeNoteModal();
					downOnBackdrop = false;
				});
				overlay.appendChild(panel);
				document.body.appendChild(overlay);
				noteModalEl = overlay;
				document.addEventListener("keydown", onNoteModalKeydown, true);
				noteInput.focus();
			}
			async function handleClick(key, el, badge, label) {
				const cur = getCached(key);
				if (cur && cur.inherited) {
					openNoteModal(key, label, cur, { readOnly: true });
					return;
				}
				if (deletionMode) {
					const ok = await confirmDialog(`Delete the saved note for ${label}?`, {
						danger: true,
						okLabel: "Delete"
					});
					if (ok) await delData(key);
					return;
				}
				openNoteModal(key, label, cur, {
					onSave: async (d) => await saveData(key, d),
					onDelete: async () => await delData(key)
				});
				try {
					const fresh = await ensureFresh(key, { force: true });
					applyRemoteToOpenNoteModal(key, fresh);
				} catch (e) {
					log("bg refresh", e);
				}
			}
			const BTN_CTX = new WeakMap();
			function processOne(li, labelFn, opts = {}) {
				const { requireArmouryId = false } = opts;
				if (!li || li.classList.contains("an-enhanced")) return;
				if (li.matches?.("[data-action], [data-role=\"action\"]")) return;
				if (li.closest?.(".actions, .actions-wrap, .item-action, .action-wrap")) return;
				const ids = findIdentifiers(li);
				if (location.pathname === "/trade.php" && !ids.aid && !ids.iid) return;
				if (requireArmouryId && !ids.aid && !ids.iid) return;
				const nameEl = li.querySelector("[class*=\"item-name\"]") || li.querySelector(".name") || li.querySelector("[data-test*=\"item-name\"]") || li.querySelector(".t-overflow, .desc___VJSNQ span b") || li.querySelector("b, strong, span");
				if (!nameEl) return;
				let name = "";
				if (nameEl.childNodes && nameEl.childNodes.length) {
					for (const node of nameEl.childNodes) {
						if (node.nodeType === 3) {
							const t = node.textContent.trim();
							if (t) {
								name = t;
								break;
							}
						}
					}
				}
				if (!name) {
					let raw = nameEl.textContent || "";
					nameEl.querySelectorAll(".tt-item-value, .bonus-tooltip, .networth-info-icon").forEach((el) => {
						raw = raw.replace(el.textContent || "", "");
					});
					raw = raw.replace(/\$[\d,]+/g, "");
					name = raw.trim();
				}
				if (!name) return;
				const key = keyFromIds(name, ids);
				let controls = null;
				for (let i = 0; i < nameEl.children.length; i++) {
					const c = nameEl.children[i];
					if (c.classList && c.classList.contains("an-controls")) {
						controls = c;
						break;
					}
				}
				let btn = controls?.querySelector?.(".an-note-btn") || null;
				let badge = controls?.querySelector?.(".an-owner-badge") || null;
				if (!controls) controls = document.createElement("span");
				controls.className = "an-controls";
				if (!badge) badge = makeOwnerBadge();
				if (!btn && USER_CAN_WRITE && ids.aid) btn = makeNoteButton();
				controls.textContent = "";
				if (USER_CAN_WRITE && btn) controls.append(badge, btn);
				else controls.append(badge);
				let textWrap = null;
				for (let i = 0; i < nameEl.children.length; i++) {
					const c = nameEl.children[i];
					if (c.classList && c.classList.contains("an-name-text")) {
						textWrap = c;
						break;
					}
				}
				if (!textWrap) {
					textWrap = document.createElement("span");
					textWrap.className = "an-name-text";
					while (nameEl.firstChild) textWrap.appendChild(nameEl.firstChild);
					nameEl.appendChild(textWrap);
				}
				const tag = (nameEl.tagName || "").toUpperCase();
				const inlineLikely = [
					"SPAN",
					"B",
					"STRONG",
					"I",
					"EM",
					"A",
					"SMALL",
					"LABEL"
				].includes(tag);
				nameEl.classList.add("an-name");
				nameEl.classList.add(inlineLikely ? "an-inline" : "an-block");
				nameEl.appendChild(controls);
				if (USER_CAN_WRITE && btn) BTN_CTX.set(btn, {
					key,
					el: li,
					badge,
					label: labelFn(name)
				});
				li.classList.add("an-enhanced");
				registerUI(key, {
					li,
					badge,
					tooltipEl: nameEl,
					btn: USER_CAN_WRITE ? btn : null
				});
				applyDataToUI(key, getCached(key));
				if (!isFresh(key)) {
					STALE_KEYS.add(key);
					scheduleRefresh();
				}
			}
			function processInRoot(root, selector, labelFn, opts = {}) {
				if (!root || !root.querySelectorAll) return;
				if (root.matches && root.matches(selector)) processOne(root, labelFn, opts);
				const nodes = root.querySelectorAll(selector);
				for (let i = 0; i < nodes.length; i++) processOne(nodes[i], labelFn, opts);
			}
			function initAll(root = document) {
				processInRoot(root, "li[data-item]", (n) => `"${n}" (Inventory)`, { requireArmouryId: true });
				processInRoot(root, "ul.item-list > li, ul[class*=\"items-list\"] > li[class*=\"item\"]", (n) => `"${n}" (Armoury)`, { requireArmouryId: true });
				processInRoot(root, "li.clearfix[data-group=\"child\"], .item___jLJcf", (n) => `"${n}" (Trade add)`);
				if (location.pathname === "/trade.php") {
					processInRoot(root, ".trade-cont .user.left ul.desc > li, li.clearfix[data-reactid]", (n) => `"${n}" (Trade left)`, { requireArmouryId: true });
				}
			}
			document.addEventListener("click", (e) => {
				const btn = e.target.closest(".an-note-btn");
				if (!btn) return;
				e.preventDefault();
				e.stopPropagation();
				if (!USER_CAN_WRITE) return;
				const ctx = BTN_CTX.get(btn);
				if (!ctx) return;
				handleClick(ctx.key, ctx.el, ctx.badge, ctx.label);
			}, true);
			function renderDeletionBanner() {
				let banner = document.getElementById("an-deletion-banner");
				if (!deletionMode) {
					if (banner) banner.remove();
					return;
				}
				if (banner) return;
				banner = document.createElement("button");
				banner.id = "an-deletion-banner";
				banner.type = "button";
				banner.textContent = "Armoury Notes: Deletion mode is ON — tap to turn off";
				banner.addEventListener("click", () => setDeletionMode(false));
				document.body.appendChild(banner);
			}
			let councilModalEl = null;
			let councilFactionMembers = [];
			let councilMembersError = false;
			function closeCouncilModal() {
				if (councilModalEl) {
					councilModalEl.remove();
					councilModalEl = null;
				}
				document.removeEventListener("keydown", onCouncilKeydown, true);
			}
			function onCouncilKeydown(e) {
				if (e.key === "Escape") {
					e.stopPropagation();
					closeCouncilModal();
				}
			}
			async function openCouncilManager() {
				const members = await fetchFactionMembers();
				councilMembersError = members === null;
				councilFactionMembers = members || [];
				let lists;
				try {
					lists = await req("GET", "/api/council");
				} catch (e) {
					toast("Could not load access lists (needs Leadership + valid Torn key).", "error");
					return;
				}
				renderCouncilModal(lists);
			}
			async function refreshCouncilModal() {
				try {
					renderCouncilModal(await req("GET", "/api/council"));
				} catch (e) {
					log("refreshCouncil", e);
				}
			}
			async function councilAction(listName, action, rawId) {
				const id = parseInt(String(rawId).replace(/\D/g, ""), 10);
				if (!id) {
					toast("Pick a valid faction member.", "error");
					return;
				}
				try {
					await req("POST", `/api/${listName}/${action}`, { userId: id });
					await refreshCouncilModal();
				} catch (e) {
					toast(`Could not ${action} ${id}: ${e?.serverResponse?.error || e?.message || "failed"}`, "error");
				}
			}
			function buildMemberAddRow(title, listName, excludeIds) {
				const addRow = document.createElement("div");
				addRow.className = "an-council-add";
				const wrap = document.createElement("div");
				wrap.className = "an-owner-wrap";
				wrap.style.flex = "1 1 auto";
				wrap.style.minWidth = "0";
				const input = document.createElement("input");
				input.type = "text";
				input.className = "an-input";
				input.autocomplete = "off";
				input.placeholder = councilMembersError ? "Couldn't load members - reopen to retry" : "Search member to add";
				if (councilMembersError) input.disabled = true;
				const dd = document.createElement("div");
				dd.className = "an-owner-dropdown";
				wrap.append(input, dd);
				function openDd() {
					const r = input.getBoundingClientRect();
					const up = r.bottom > window.innerHeight * .55;
					dd.classList.toggle("an-drop-up", up);
					dd.classList.toggle("an-drop-down", !up);
					dd.classList.add("show");
				}
				function closeDd() {
					dd.classList.remove("show");
					dd.innerHTML = "";
				}
				input.addEventListener("keydown", (e) => e.stopPropagation());
				input.addEventListener("input", () => {
					const q = input.value.trim().toLowerCase();
					if (!q) {
						closeDd();
						return;
					}
					const matches = councilFactionMembers.filter((m) => !excludeIds.has(m.id) && m.name.toLowerCase().includes(q)).slice(0, 25);
					if (!matches.length) {
						dd.innerHTML = "<div class=\"an-owner-item an-owner-empty\">No matching members</div>";
						openDd();
						return;
					}
					dd.innerHTML = matches.map((m) => `<div class="an-owner-item" data-id="${m.id}" data-name="${escHtml(m.name)}">
                        <span class="an-owner-name">${escHtml(m.name)}</span>
                        <span class="an-owner-id">[${m.id}]</span>
                    </div>`).join("");
					openDd();
					dd.querySelectorAll(".an-owner-item[data-id]").forEach((el) => {
						el.addEventListener("click", () => {
							closeDd();
							input.value = "";
							councilAction(listName, "add", el.dataset.id);
						});
					});
				});
				document.addEventListener("click", (e) => {
					if (!wrap.contains(e.target)) closeDd();
				});
				addRow.appendChild(wrap);
				return addRow;
			}
			function buildListSection(title, listName, members) {
				const wrap = document.createElement("div");
				wrap.className = "an-council-section";
				const h = document.createElement("div");
				h.className = "an-council-section-title";
				h.textContent = `${title} (${members.length})`;
				wrap.appendChild(h);
				const list = document.createElement("div");
				list.className = "an-council-list";
				if (!members.length) {
					const e = document.createElement("div");
					e.className = "an-council-empty";
					e.textContent = "— none —";
					list.appendChild(e);
				}
				const rosterById = new Map((councilFactionMembers || []).map((fm) => [Number(fm.id), fm.name]));
				for (const m of members) {
					let name = m.name && m.name.trim() ? m.name.trim() : rosterById.get(Number(m.id)) || "";
					const pending = !name;
					if (!name) name = "Unknown";
					const row = document.createElement("div");
					row.className = "an-council-row";
					const label = document.createElement("span");
					label.className = "an-council-name";
					const suffix = m.id === TORN_USER_ID ? "  (you)" : pending ? "  (pending)" : "";
					label.textContent = `${name} — ${m.id}${suffix}`;
					row.appendChild(label);
					const rm = document.createElement("button");
					rm.className = "an-btn an-btn-danger an-council-btn";
					rm.textContent = "Remove";
					rm.addEventListener("click", async () => {
						if (await confirmDialog(`Remove ${name} (${m.id}) from ${title}?`, {
							danger: true,
							okLabel: "Remove"
						})) councilAction(listName, "remove", m.id);
					});
					row.appendChild(rm);
					list.appendChild(row);
				}
				wrap.appendChild(list);
				const excludeIds = new Set(members.map((m) => Number(m.id)));
				wrap.appendChild(buildMemberAddRow(title, listName, excludeIds));
				return wrap;
			}
			function renderCouncilModal(lists) {
				closeCouncilModal();
				const overlay = document.createElement("div");
				overlay.className = "an-modal-overlay";
				let down = false;
				overlay.addEventListener("mousedown", (e) => {
					down = e.target === overlay;
				});
				overlay.addEventListener("click", (e) => {
					if (e.target === overlay && down) closeCouncilModal();
					down = false;
				});
				const panel = document.createElement("div");
				panel.className = "an-modal-panel an-council-panel";
				const title = document.createElement("div");
				title.className = "an-modal-title";
				title.textContent = "Manage Access";
				panel.appendChild(title);
				const sub = document.createElement("div");
				sub.className = "an-council-sub";
				sub.textContent = "Changes apply for everyone.";
				panel.appendChild(sub);
				if (councilMembersError) {
					const warn = document.createElement("div");
					warn.className = "an-council-sub";
					warn.style.color = "#ff8a80";
					warn.textContent = "Couldn't load the faction roster - add pickers are disabled. Close and reopen to retry.";
					panel.appendChild(warn);
				}
				panel.appendChild(buildListSection("Leadership", "leadership", lists.leadership || []));
				panel.appendChild(buildListSection("Council", "council", lists.council || []));
				const footer = document.createElement("div");
				footer.className = "an-modal-footer";
				const close = document.createElement("button");
				close.className = "an-btn";
				close.textContent = "Close";
				close.addEventListener("click", closeCouncilModal);
				footer.appendChild(close);
				panel.appendChild(footer);
				overlay.appendChild(panel);
				document.body.appendChild(overlay);
				councilModalEl = overlay;
				document.addEventListener("keydown", onCouncilKeydown, true);
			}
			function buildAccessSummary() {
				const id = TORN_USER_ID ? `#${TORN_USER_ID}` : "unknown";
				const name = TORN_USER_NAME || "unknown";
				const serverState = {
					live: "reachable (checked this session)",
					cache: "reachable (recent cached result)",
					"invalid-key": "REJECTED — Armoury key missing or wrong",
					error: "UNREACHABLE — showing last known/default access"
				}[ACCESS_SOURCE] || ACCESS_SOURCE;
				return `${name} (${id})\nRole: ${USER_ROLE}  •  Write access: ${USER_CAN_WRITE ? "yes" : "no"}\n` + `Armoury key: ${getArmouryKey() ? "set" : "not set"}  •  Torn API key: ${getTornKey() ? "set (DSS)" : "not set"}\nServer: ${serverState}`;
			}
			function renderCategoryEditor() {
				const list = document.getElementById("an-categories-list");
				if (!list) return;
				list.innerHTML = "";
				CATEGORIES.forEach((c) => {
					const row = document.createElement("div");
					row.className = "an-cat-row";
					row.innerHTML = `<span class="an-cat-label">${escHtml(c.label)}</span>
                    <input type="color" class="an-cat-pick" value="${HEX.test(c.colour) ? c.colour : "#ffffff"}">
                    <input type="text" class="an-input an-cat-text" data-cat="${escHtml(c.id)}" data-orig="${escHtml(c.colour || "")}" value="${escHtml(c.colour || "")}" placeholder="#hex (blank = default)">`;
					const pick = row.querySelector(".an-cat-pick");
					const text = row.querySelector(".an-cat-text");
					pick.addEventListener("input", () => {
						text.value = pick.value;
					});
					text.addEventListener("keydown", (e) => e.stopPropagation());
					list.appendChild(row);
				});
				const saveWrap = document.createElement("div");
				saveWrap.className = "an-cat-saveall";
				const saveBtn = document.createElement("button");
				saveBtn.className = "an-btn an-btn-primary";
				saveBtn.textContent = "Save colours";
				saveWrap.appendChild(saveBtn);
				list.appendChild(saveWrap);
				saveBtn.addEventListener("click", async () => {
					const statusEl = document.getElementById("an-categories-status");
					const rows = Array.from(list.querySelectorAll(".an-cat-text"));
					const changed = rows.filter((t) => t.value.trim() !== (t.dataset.orig || ""));
					if (!changed.length) {
						if (statusEl) {
							statusEl.textContent = "No changes to save.";
							statusEl.style.color = "#999";
						}
						return;
					}
					saveBtn.disabled = true;
					if (statusEl) {
						statusEl.textContent = "Saving...";
						statusEl.style.color = "#999";
					}
					let ok = 0, failMsg = "";
					for (const t of changed) {
						try {
							const updated = await req("PUT", `/api/categories/${encodeURIComponent(t.dataset.cat)}`, { colour: t.value.trim() });
							const idx = CATEGORIES.findIndex((x) => x.id === t.dataset.cat);
							if (idx >= 0 && updated) CATEGORIES[idx] = updated;
							ok++;
						} catch (e) {
							failMsg = e?.message || "Save failed";
						}
					}
					renderCategoryEditor();
					repaintAllBadges();
					const s2 = document.getElementById("an-categories-status");
					if (s2) {
						if (failMsg) {
							s2.textContent = `Saved ${ok}, but one or more failed: ${failMsg}`;
							s2.style.color = "#ef4444";
						} else {
							s2.textContent = `Saved ${ok} colour${ok === 1 ? "" : "s"}.`;
							s2.style.color = "#4caf50";
						}
					}
				});
			}
			function wireSettingsGuide() {
				const summary = document.getElementById("an-access-summary");
				if (summary) summary.textContent = buildAccessSummary();
				const keyInput = document.getElementById("an-armoury-key");
				const keySave = document.getElementById("an-armoury-key-save");
				const keyStatus = document.getElementById("an-key-status");
				if (keyInput) keyInput.value = getArmouryKey();
				keyInput?.addEventListener("keydown", (e) => e.stopPropagation());
				keySave?.addEventListener("click", () => {
					setArmouryKey(keyInput.value);
					try {
						GM_deleteValue(ACCESS_CACHE_KEY);
					} catch (e) {
						log("acc clear on save", e);
					}
					if (keyStatus) {
						keyStatus.textContent = keyInput.value.trim() ? "Armoury key saved. Reloading..." : "Armoury key cleared. Reloading...";
						keyStatus.style.color = "#4caf50";
					}
					setTimeout(() => location.reload(), 700);
				});
				document.getElementById("an-access-refresh")?.addEventListener("click", (e) => {
					e.target.disabled = true;
					forceRefreshAccess().finally(() => {
						e.target.disabled = false;
						const s = document.getElementById("an-access-summary");
						if (s) s.textContent = buildAccessSummary();
					});
				});
				const pages = getEnabledPages();
				[
					["an-page-armoury", "armoury"],
					["an-page-inventory", "inventory"],
					["an-page-trade", "trade"]
				].forEach(([elId, k]) => {
					const cb = document.getElementById(elId);
					if (!cb) return;
					cb.checked = pages[k] !== false;
					cb.addEventListener("change", () => {
						const cur = getEnabledPages();
						cur[k] = cb.checked;
						setEnabledPages(cur);
					});
				});
				if (USER_ROLE === "leadership") {
					const catCard = document.getElementById("an-categories-card");
					if (catCard) {
						catCard.style.display = "";
						renderCategoryEditor();
					}
					const leadCard = document.getElementById("an-leadership-card");
					if (leadCard) leadCard.style.display = "";
					document.getElementById("an-open-council")?.addEventListener("click", openCouncilManager);
				}
				if (USER_CAN_WRITE) {
					const danger = document.getElementById("an-danger-card");
					if (danger) danger.style.display = "";
					const delCb = document.getElementById("an-deletion-mode");
					if (delCb) {
						delCb.checked = deletionMode;
						delCb.addEventListener("change", () => setDeletionMode(delCb.checked));
					}
					document.getElementById("an-clear-cache")?.addEventListener("click", async () => {
						const ok = await confirmDialog("Clear the local notes cache? Notes are safe on the server — this just forces a fresh pull.", { okLabel: "Clear cache" });
						if (!ok) return;
						CACHE = {};
						try {
							GM_setValue(CACHE_KEY, {});
						} catch (e) {
							log("clear cache", e);
						}
						const s = document.getElementById("an-danger-status");
						if (s) {
							s.textContent = "Notes cache cleared.";
							s.style.color = "#4caf50";
						}
					});
				}
				document.getElementById("an-armoury-key-toggle")?.addEventListener("click", () => {
					keyInput?.classList.toggle("an-key-hidden");
				});
			}
			function injectBaseStyles() {
				if (document.getElementById("an-styles")) return;
				const s = document.createElement("style");
				s.id = "an-styles";
				s.textContent = `
            .an-name{ position:relative; overflow:visible; max-width:100%; }
            .an-name.an-inline{ display:inline-flex; }
            .an-name.an-block{ display:flex; }
            .an-name .an-name-text{ display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 auto; min-width:0; }
            .an-note-btn{ background:none; border:none; padding:0; margin:0 2px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; opacity:0.8; line-height:1; color:inherit; position:relative; z-index:1001; pointer-events:auto !important; }
            .an-note-btn svg{ width:100%; height:100%; display:block; }
            .an-note-btn:hover{ opacity:1; }
            .an-controls{ display:inline-flex; align-items:center; gap:4px; z-index:1000; pointer-events:auto; margin-left:6px; flex:0 0 auto; }
            .an-controls .an-owner-badge{ display:inline-block; padding:0 5px; font-size:10px; line-height:1; border-radius:6px; background:rgba(255,255,255,0.1); white-space:nowrap; max-width:90px; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; border:1px solid rgba(255,255,255,0.25); box-shadow:none; transition:box-shadow .2s ease, border-color .2s ease; }
            .an-controls .an-owner-badge.an-loaned{ font-style:italic; }
            .an-key-hidden{ -webkit-text-security:disc; text-security:disc; }
            .an-note-btn-del{ color:#ff6b6b !important; }
            .an-note-btn-view{ color:#8fb7ff !important; }
            .an-readonly-banner{ background:rgba(96,165,250,0.12); border:1px solid rgba(96,165,250,0.35); color:#bcd4ff; border-radius:6px; padding:8px 10px; font-size:12px; margin-bottom:12px; }
            .an-trade-filter{ display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#ccc; cursor:pointer; vertical-align:middle; user-select:none; float:right; font-weight:normal; text-transform:none; }
            .an-trade-filter input{ cursor:pointer; margin:0; }
            div.title-black > .an-trade-filter{ margin-left:14px; }
            .an-trade-filter-bar{ padding:6px 12px; background:rgba(0,0,0,0.25); border-bottom:1px solid rgba(255,255,255,0.08); }
            .an-trade-filter-bar .an-trade-filter{ float:none; }
            .an-trade-filter.an-trade-filter-inline{ float:none; margin-left:14px; }
            @media (max-width: 784px){
                .an-trade-filter.an-trade-filter-inline{ display:flex; width:100%; margin:8px 0 0 0; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); }
                div.title-black > .an-trade-filter{ float:none; display:flex; width:100%; margin:6px 0 0 0; }
                /* Fix 1: keep enhanced armoury/inventory rows from overflowing on small screens */
                .an-controls{ margin-left:4px; gap:3px; }
                .an-controls .an-owner-badge{ max-width:68px; font-size:9px; padding:0 4px; }
                .name-wrap > .name.an-name .custom-bonus-badge{ max-width:84px !important; }
                .an-name .an-name-text{ min-width:0; }
            }

            /* Settings: collapsible configuration section */
            .an-cfg-details{ margin:0; }
            .an-guide-card{ margin:0 0 8px 0; }
            .an-cfg-body{ padding:2px 4px 6px; font-size:12px; color:#bbb; line-height:1.5; }
            .an-cfg-body p{ margin:0 0 8px; }
            .an-cfg-body p:last-child{ margin-bottom:0; }
            .an-cfg-summary{ cursor:pointer; list-style:none; padding:10px 14px; margin-top:4px; border:1px solid rgba(255,255,255,0.08); border-radius:6px; background:rgba(96,165,250,0.06); color:var(--link-color,#60a5fa); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; user-select:none; display:flex; align-items:center; gap:8px; }
            .an-cfg-summary::-webkit-details-marker{ display:none; }
            .an-cfg-summary::before{ content:'\u25B8'; font-size:10px; transition:transform .15s ease; }
            .an-cfg-details[open] > .an-cfg-summary::before{ transform:rotate(90deg); }
            .an-cfg-details[open] > .an-cfg-summary{ margin-bottom:12px; }

            /* Compatibility with RW Bonus name plugin (kept from original) */
            .name-wrap > .name.an-name { display:inline-flex !important; align-items:center !important; width:auto !important; min-width:0 !important; max-width:100% !important; box-sizing:border-box !important; overflow:visible !important; white-space:nowrap !important; vertical-align:middle !important; position:relative !important; z-index:9999 !important; }
            .name-wrap > .name.an-name > .an-name-text { display:flex !important; align-items:center !important; flex:1 1 auto !important; min-width:0 !important; max-width:none !important; overflow:hidden !important; white-space:nowrap !important; }
            .name-wrap { position:relative !important; z-index:9998 !important; overflow:visible !important; }
            .name-wrap > .name.an-name > .an-controls { display:inline-flex !important; align-items:center !important; flex:0 0 auto !important; margin-left:6px !important; position:relative !important; z-index:10000 !important; pointer-events:auto !important; }
            .name-wrap > .name.an-name .an-note-btn { width:18px !important; height:18px !important; z-index:10001 !important; pointer-events:auto !important; cursor:pointer !important; }

            /* Tooltip */
            .an-tooltip{ position:fixed; max-width:${isMobile ? "90vw" : "360px"}; padding:${isMobile ? "12px 16px" : "8px 10px"}; border-radius:8px; font-size:${isMobile ? "14px" : "12px"}; line-height:1.4; z-index:999999; opacity:0; transform:translate3d(0,2px,0) scale(0.98); transition:opacity .18s ease, transform .18s ease; white-space:pre-wrap; word-break:break-word; background:rgba(16,16,16,0.92); color:#f0f0f0; box-shadow:0 8px 24px rgba(0,0,0,0.35); }

            /* Modals (note / confirm / council) */
            .an-modal-overlay{ position:fixed; inset:0; z-index:1000000; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px; }
            .an-modal-panel{ background:#1b1b1b; color:#f0f0f0; border:1px solid rgba(255,255,255,0.15); border-radius:10px; width:100%; max-width:440px; max-height:85vh; overflow:visible; padding:16px 18px; box-shadow:0 12px 40px rgba(0,0,0,0.5); font-size:13px; line-height:1.4; }
            .an-modal-title{ font-size:15px; font-weight:600; margin-bottom:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-field{ margin-bottom:12px; }
            .an-label{ display:block; font-size:11px; opacity:0.7; margin-bottom:4px; }
            .an-input, .an-textarea{ width:100%; box-sizing:border-box; background:#111; color:#f0f0f0; border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:7px 9px; font-size:13px; font-family:inherit; }
            .an-textarea{ resize:vertical; min-height:60px; }
            .an-owner-wrap{ position:relative; }
            .an-owner-dropdown{ position:absolute; left:0; right:0; background:#2a2c2e; border:1px solid #444; border-radius:6px; max-height:180px; overflow-y:auto; z-index:15; box-shadow:0 8px 24px rgba(0,0,0,0.5); display:none; }
            .an-owner-dropdown.show{ display:block; }
            .an-owner-dropdown.an-drop-down{ top:100%; margin-top:2px; }
            .an-owner-dropdown.an-drop-up{ bottom:100%; margin-bottom:2px; }
            .an-owner-item{ padding:6px 10px; cursor:pointer; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center; }
            .an-owner-item:last-child{ border-bottom:none; }
            .an-owner-item:hover{ background:rgba(96,165,250,0.15); }
            .an-owner-empty{ color:#777; cursor:default; }
            .an-owner-id{ color:#777; font-size:11px; }
            .an-owner-hint{ font-size:11px; color:#e8c96a; margin-top:4px; min-height:14px; }
            .an-owner-hint.an-owner-hint-warn{ color:#ef8a8a; }
            .an-owner-scope{ display:flex; align-items:center; gap:6px; font-size:11px; color:#ccc; margin-top:6px; cursor:pointer; user-select:none; }
            .an-owner-scope input{ cursor:pointer; margin:0; }
            .an-colour-row{ display:flex; align-items:center; gap:8px; }
            .an-colour-row .an-input{ flex:1 1 auto; min-width:0; }
            .an-colour-row input[type="color"]{ width:34px; height:30px; flex:0 0 auto; padding:0; border:1px solid rgba(255,255,255,0.2); border-radius:6px; background:#111; cursor:pointer; }
            .an-modal-footer{ display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:4px; flex-wrap:wrap; }
            .an-status{ font-size:11px; opacity:0.85; flex:1 0 100%; order:-1; margin:0 0 6px; min-width:0; }
            .an-status:empty{ display:none; margin:0; }
            .an-confirm-msg{ font-size:14px; margin-bottom:14px; }
            .an-btn{ background:rgba(255,255,255,0.12); color:#f0f0f0; cursor:pointer; border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:6px 14px; font-size:12px; }
            .an-btn:hover{ background:rgba(255,255,255,0.2); }
            .an-btn:disabled{ opacity:0.5; cursor:default; }
            .an-btn-primary{ background:rgba(90,160,255,0.28); border-color:rgba(90,160,255,0.5); }
            .an-btn-primary:hover{ background:rgba(90,160,255,0.4); }
            .an-btn-danger{ background:rgba(220,70,70,0.18); border-color:rgba(220,70,70,0.4); }
            .an-btn-danger:hover{ background:rgba(220,70,70,0.32); }

            /* Council */
            .an-council-panel{ max-width:460px; }
            .an-council-sub{ font-size:11px; opacity:0.7; margin-bottom:12px; }
            .an-council-section{ margin-bottom:14px; }
            .an-council-section-title{ font-weight:600; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:4px; }
            .an-council-list{ display:flex; flex-direction:column; gap:4px; margin-bottom:8px; }
            .an-council-empty{ opacity:0.5; font-style:italic; }
            .an-council-row{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:3px 0; }
            .an-council-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-council-add{ display:flex; gap:6px; margin-top:4px; }
            .an-council-btn{ padding:5px 10px; }

            /* Settings guide category editor */
            .an-cat-row{ display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
            .an-cat-label{ min-width:110px; font-size:12px; }
            .an-cat-pick{ width:34px; height:28px; padding:0; border:1px solid rgba(255,255,255,0.2); border-radius:5px; background:#111; cursor:pointer; }
            .an-cat-text{ flex:1 1 120px; min-width:0; }
            .an-cat-saveall{ margin-top:10px; }

            /* Toast + deletion banner */
            .an-toast{ position:fixed; bottom:18px; left:50%; transform:translateX(-50%) translateY(10px); z-index:1000001; background:#222; color:#f0f0f0; border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:10px 16px; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.4); opacity:0; pointer-events:none; transition:opacity .2s ease, transform .2s ease; max-width:calc(100vw - 32px); }
            .an-toast.an-show{ opacity:1; transform:translateX(-50%) translateY(0); }
            .an-toast-error{ border-color:rgba(220,70,70,0.6); }
            .an-toast-info{ border-color:rgba(90,160,255,0.5); }
            #an-deletion-banner{ position:fixed; bottom:14px; left:14px; z-index:999999; background:#c0392b; color:#fff; border:none; border-radius:8px; padding:8px 14px; font-size:12px; font-weight:600; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,0.4); max-width:calc(100vw - 28px); }

            /* Staged retrieval */
            .an-retrieve-bar{ margin:10px 0; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
            .an-mig-pulse{ animation:an-mig-flash 1.1s ease-in-out infinite; border-color:rgba(255,170,60,0.7) !important; color:#ffc27a !important; }
            @keyframes an-mig-flash{ 0%,100%{ box-shadow:0 0 0 0 rgba(255,170,60,0.5); } 50%{ box-shadow:0 0 0 4px rgba(255,170,60,0.05); } }
            .an-retrieve-btn{ vertical-align:middle; }
            .an-retrieve-btn-float{ position:fixed; right:16px; bottom:16px; z-index:999998; box-shadow:0 6px 18px rgba(0,0,0,0.4); }
            .an-retr-panel{ max-width:560px; }
            .an-retr-controls{ display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
            .an-retr-controls > select, .an-retr-controls > .an-owner-wrap{ min-width:0; max-width:100%; }
            .an-retr-controls .an-retr-item{ flex:1 1 160px; }
            .an-retr-controls .an-give-mode, .an-retr-controls .an-retr-mode{ flex:0 1 auto; max-width:100%; }
            .an-retr-list{ max-height:48vh; overflow-y:auto; border:1px solid rgba(255,255,255,0.12); border-radius:8px; margin-bottom:12px; }
            .an-retr-empty{ padding:14px; opacity:0.6; font-style:italic; text-align:center; }
            .an-retr-row{ display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.06); }
            .an-retr-row:last-child{ border-bottom:none; }
            .an-retr-row.an-retr-skipped{ opacity:0.45; }
            .an-retr-icon{ width:18px; text-align:center; flex:0 0 auto; }
            .an-retr-name{ flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
            .an-retr-main{ flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:1px; }
            .an-retr-main .an-retr-name{ display:block; }
            .an-retr-note{ display:block; font-size:11px; color:#9fb6d6; opacity:0.9; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-retr-meta{ flex:0 0 auto; font-size:11px; opacity:0.7; white-space:nowrap; }
            .an-retr-msg{ flex:0 0 auto; font-size:11px; opacity:0.8; min-width:0; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-retr-row.an-retr-done .an-retr-msg{ color:#8bc34a; }
            .an-retr-skip{ flex:0 0 auto; padding:3px 10px; }
            .an-give-qty{ flex:0 0 auto; width:56px; padding:4px 6px; text-align:center; }
            @media (max-width: 784px){
                .an-retr-row{ flex-wrap:nowrap; gap:6px; padding:6px 8px; }
                .an-retr-name{ flex:1 1 auto; min-width:0; }
                .an-retr-meta{ flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
                .an-retr-msg{ display:none; }
                .an-retr-skip{ padding:3px 8px; }
            }
            `;
				document.head.appendChild(s);
			}
			const RETR_ACTOR = () => `${TORN_USER_NAME || ""} [${TORN_USER_ID || ""}]`.trim();
			function itemNoteText(armouryId) {
				const d = getCached(`armouryid:${armouryId}`);
				return d && d.note ? d.note : "";
			}
			function itemNoteOwner(armouryId) {
				const d = getCached(`armouryid:${armouryId}`);
				if (!d) return "";
				if (d.inherited) return d.sourceFaction || "another faction";
				return d.owner || "";
			}
			function itemLoanedIn(armouryId) {
				const d = getCached(`armouryid:${armouryId}`);
				return !!(d && (d.inherited || d.category === "loaned_from"));
			}
			function isVisibleRow(el) {
				if (!el) return false;
				if (el.offsetParent !== null) return true;
				let n = el;
				while (n && n !== document.body) {
					const cs = n.getAttribute && n.getAttribute("aria-hidden") === "true";
					if (cs) return false;
					if (n.style && n.style.display === "none") return false;
					n = n.parentElement;
				}
				return true;
			}
			function visibleRetrieveLinks() {
				return Array.from(document.querySelectorAll("a[data-role=\"retrieve\"]")).filter((a) => isVisibleRow(a.closest("li") || a));
			}
			function snapshotRetrievables() {
				const out = [];
				visibleRetrieveLinks().forEach((a) => {
					const idHost = a.closest("[data-armoryid]") || a.closest("li")?.querySelector("[data-armoryid]") || null;
					const li = a.closest("li") || idHost?.closest("li");
					if (!li) return;
					const holder = idHost || li.querySelector("[data-armoryid]");
					const armouryId = holder?.getAttribute("data-armoryid") || null;
					const itemId = holder?.getAttribute("data-itemid") || null;
					if (!armouryId || !itemId) return;
					const nameEl = li.querySelector(".name, [class*=\"item-name\"], b, strong");
					let itemName = "", qty = 1;
					const qtyEl = nameEl ? nameEl.querySelector(".qty") : null;
					if (nameEl) {
						if (qtyEl) qty = parseInt((qtyEl.textContent || "").replace(/[^\d]/g, ""), 10) || 1;
						const clone = nameEl.cloneNode(true);
						clone.querySelectorAll(".an-controls, .an-owner-badge, .an-note-btn, .qty").forEach((n) => n.remove());
						itemName = (clone.textContent || "").trim();
					}
					const qm = itemName.match(/^(.*?)\s+x(\d+)$/i);
					if (qm) {
						itemName = qm[1].trim();
						if (!qtyEl) qty = parseInt(qm[2], 10) || 1;
					}
					const typeEl = li.querySelector(".type");
					const type = (typeEl?.textContent || "").trim();
					const loanedCell = li.querySelector(".loaned");
					let loanedTo = "", loanedToId = null;
					if (loanedCell) {
						const link = loanedCell.querySelector("a[href*=\"XID=\"], a[href*=\"profiles.php\"]");
						loanedTo = ((link || loanedCell).textContent || "").replace(/^\s*Loaned:\s*/i, "").trim();
						const m = (link?.getAttribute("href") || "").match(/XID=(\d+)/);
						if (m) loanedToId = parseInt(m[1], 10);
					}
					out.push({
						armouryId,
						itemId,
						itemName: itemName || `Item ${itemId}`,
						type,
						loanedTo,
						loanedToId,
						qty
					});
				});
				return out;
			}
			function retrieveOne(item) {
				return new Promise((resolve, reject) => {
					const getAction = typeof unsafeWindow !== "undefined" && unsafeWindow.getAction || typeof window !== "undefined" && window.getAction || null;
					if (typeof getAction !== "function") {
						reject(new Error("Torn's getAction not found on this page"));
						return;
					}
					if (!item.loanedToId) {
						reject(new Error("No loaned-to player found for this item"));
						return;
					}
					const holder = `${item.loanedTo || "Player"} [${item.loanedToId}]`;
					getAction({
						type: "post",
						action: "factions.php",
						data: {
							ajax: "true",
							step: "armouryActionItem",
							role: "retrieve",
							item: item.armouryId,
							itemID: item.itemId,
							type: item.type,
							user: holder
						},
						success: (str) => {
							try {
								resolve(typeof str === "string" ? JSON.parse(str) : str);
							} catch {
								resolve({ raw: str });
							}
						},
						error: (err) => reject(err instanceof Error ? err : new Error(String(err?.error || err?.message || "request failed")))
					});
				});
			}
			function markRowRetrieved(armouryId) {
				try {
					const holder = document.querySelector(`[data-armoryid="${armouryId}"]`);
					const li = holder?.closest("li");
					if (!li) return;
					li.querySelectorAll("a[data-role=\"retrieve\"]").forEach((a) => a.remove());
					const loanedCell = li.querySelector(".loaned");
					if (loanedCell) {
						loanedCell.textContent = "Available";
						loanedCell.classList.add("an-retrieved");
					}
				} catch (e) {
					log("markRowRetrieved", e);
				}
			}
			let retrModalEl = null;
			let retrDidAct = false;
			let retrPaging = false;
			function closeRetrModal() {
				if (retrModalEl) {
					retrModalEl.remove();
					retrModalEl = null;
				}
				document.removeEventListener("keydown", onRetrKeydown, true);
			}
			function closeRetrAndReload() {
				const acted = retrDidAct;
				closeRetrModal();
				if (acted) location.reload();
			}
			function onRetrKeydown(e) {
				if (e.key === "Escape") {
					e.stopPropagation();
					closeRetrAndReload();
				}
			}
			function retrNextPageLink() {
				const wrap = document.querySelector(".pagination-wrap");
				if (!wrap) return null;
				const active = wrap.querySelector("a.page-number.active");
				const cur = active ? parseInt(active.getAttribute("page") || "0", 10) : 0;
				if (!cur) return null;
				const links = Array.from(wrap.querySelectorAll("a.page-number[page]"));
				return links.find((a) => parseInt(a.getAttribute("page"), 10) === cur + 1 && !a.classList.contains("active")) || null;
			}
			function waitFor(pred, timeout = 4e3, interval = 120) {
				return new Promise((resolve) => {
					const t0 = Date.now();
					const tick = () => {
						let ok = false;
						try {
							ok = !!pred();
						} catch {
							ok = false;
						}
						if (ok) return resolve(true);
						if (Date.now() - t0 >= timeout) return resolve(false);
						setTimeout(tick, interval);
					};
					tick();
				});
			}
			async function retrGoNextPage() {
				const link = retrNextPageLink();
				if (!link) return;
				const targetPage = parseInt(link.getAttribute("page"), 10);
				retrPaging = true;
				closeRetrModal();
				link.click();
				await waitFor(() => {
					const a = document.querySelector(".pagination-wrap a.page-number.active");
					return a && parseInt(a.getAttribute("page") || "0", 10) === targetPage && visibleRetrieveLinks().length >= 0;
				});
				await sleep(200);
				openRetrievalModal();
			}
			function openRetrievalModal() {
				const all = snapshotRetrievables();
				if (!all.length) {
					toast("Nothing retrievable on this tab.", "info");
					retrPaging = false;
					return;
				}
				if (!retrPaging) retrDidAct = false;
				retrPaging = false;
				closeRetrModal();
				const overlay = document.createElement("div");
				overlay.className = "an-modal-overlay an-retr-overlay";
				const panel = document.createElement("div");
				panel.className = "an-modal-panel an-retr-panel";
				panel.innerHTML = `
        <div class="an-modal-title">Retrieve loaned items — this tab</div>
        <div class="an-retr-controls">
            <label class="an-label" style="margin:0;">Mode</label>
            <select class="an-input an-retr-mode" style="width:auto;flex:0 0 auto;">
                <option value="loaned_out">Loaned to member</option>
                <option value="loaned_in">Loaned-in (from notes)</option>
            </select>
            <label class="an-label an-retr-person-label" style="margin:0;">Loaned to</label>
            <select class="an-input an-retr-person" style="width:auto;flex:1 1 auto;min-width:0;"></select>
        </div>
        <div class="an-retr-controls">
            <label class="an-label" style="margin:0;">Item</label>
            <select class="an-input an-retr-item" style="flex:1 1 auto;min-width:0;"></select>
        </div>
        <div class="an-retr-controls">
            <label class="an-label" style="margin:0;">Owner</label>
            <select class="an-input an-retr-owner" style="flex:1 1 auto;min-width:0;"></select>
        </div>
        <div class="an-retr-list"></div>
        <div class="an-modal-footer">
            <span class="an-status an-retr-status"></span>
            <button class="an-btn an-retr-close">Close</button>
            <button class="an-btn an-retr-nextpage" style="display:none;">Next Page</button>
            <button class="an-btn an-btn-primary an-retr-next">Retrieve Next</button>
        </div>`;
				const modeSel = panel.querySelector(".an-retr-mode");
				const personSel = panel.querySelector(".an-retr-person");
				const personLabel = panel.querySelector(".an-retr-person-label");
				const itemSel = panel.querySelector(".an-retr-item");
				const ownerSel = panel.querySelector(".an-retr-owner");
				const listEl = panel.querySelector(".an-retr-list");
				const statusEl = panel.querySelector(".an-retr-status");
				const closeBtn = panel.querySelector(".an-retr-close");
				const nextPageBtn = panel.querySelector(".an-retr-nextpage");
				const nextBtn = panel.querySelector(".an-retr-next");
				const loanedInOf = (i) => {
					const d = getCached(`armouryid:${i.armouryId}`);
					return d && (d.inherited || d.category === "loaned_from");
				};
				const byName = (a, b) => (a.itemName || "").localeCompare(b.itemName || "") || (b.qty || 1) - (a.qty || 1) || a.armouryId - b.armouryId;
				const qtyLabel = (i) => i.qty > 1 ? ` x${i.qty}` : "";
				function baseSet() {
					let set = modeSel.value === "loaned_in" ? all.filter(loanedInOf) : all.slice();
					if (modeSel.value === "loaned_out") {
						const who = personSel.value;
						if (who && who !== "__all__") set = set.filter((i) => i.loanedTo === who);
					}
					return set;
				}
				function currentSet() {
					let set = baseSet();
					const chosen = itemSel.value;
					if (chosen && chosen !== "__all__") set = set.filter((i) => i.itemName === chosen);
					const owner = ownerSel.value;
					if (owner && owner !== "__all__") set = set.filter((i) => itemNoteOwner(i.armouryId) === owner);
					return set.slice().sort(byName);
				}
				function rebuildItemOptions() {
					const set = baseSet();
					const counts = {}, units = {};
					set.forEach((i) => {
						counts[i.itemName] = (counts[i.itemName] || 0) + 1;
						units[i.itemName] = (units[i.itemName] || 0) + (i.qty || 1);
					});
					const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
					const prev = itemSel.value;
					const label = (n) => units[n] > counts[n] ? `${n} (${counts[n]} · ${units[n].toLocaleString()} total)` : `${n} (${counts[n]})`;
					itemSel.innerHTML = `<option value="__all__">All items (${set.length})</option>` + names.map((n) => `<option value="${escHtml(n)}">${escHtml(label(n))}</option>`).join("");
					if (prev && Array.from(itemSel.options).some((o) => o.value === prev)) itemSel.value = prev;
				}
				function rebuildOwnerOptions() {
					const set = baseSet();
					const counts = {};
					set.forEach((i) => {
						const o = itemNoteOwner(i.armouryId);
						if (o) counts[o] = (counts[o] || 0) + 1;
					});
					const owners = Object.keys(counts).sort((a, b) => a.localeCompare(b));
					const prev = ownerSel.value;
					ownerSel.innerHTML = `<option value="__all__">All owners (${set.length})</option>` + owners.map((o) => `<option value="${escHtml(o)}">${escHtml(o)} (${counts[o]})</option>`).join("");
					if (prev && Array.from(ownerSel.options).some((x) => x.value === prev)) ownerSel.value = prev;
				}
				function rebuildPersonOptions() {
					const set = currentSet();
					const holders = Array.from(new Set(set.map((i) => i.loanedTo).filter(Boolean))).sort((a, b) => a.localeCompare(b));
					const showPerson = modeSel.value === "loaned_out";
					personSel.style.display = showPerson ? "" : "none";
					personLabel.style.display = showPerson ? "" : "none";
					personSel.innerHTML = `<option value="__all__">Everyone (${set.length})</option>` + holders.map((h) => `<option value="${escHtml(h)}">${escHtml(h)} (${set.filter((i) => i.loanedTo === h).length})</option>`).join("");
				}
				let queue = [];
				let running = false;
				let busy = false;
				function buildQueue() {
					const items = currentSet();
					queue = items.map((i) => ({
						item: i,
						skip: false,
						done: false,
						ok: null,
						msg: ""
					}));
					renderList();
					updateFooter();
				}
				function renderList() {
					if (!queue.length) {
						listEl.innerHTML = "<div class=\"an-retr-empty\">No items for this selection.</div>";
						return;
					}
					listEl.innerHTML = "";
					queue.forEach((q) => {
						const row = document.createElement("div");
						row.className = "an-retr-row" + (q.skip ? " an-retr-skipped" : "") + (q.done ? " an-retr-done" : "");
						row.dataset.armouryId = q.item.armouryId;
						const icon = q.done ? q.ok ? "✅" : "❌" : q.skip ? "⊘" : "•";
						const note = itemNoteText(q.item.armouryId);
						row.innerHTML = `
                <span class="an-retr-icon">${icon}</span>
                <div class="an-retr-main">
                    <span class="an-retr-name" title="${escHtml(q.item.itemName + qtyLabel(q.item))}">${escHtml(q.item.itemName)}${q.item.qty > 1 ? ` <span style="opacity:.7;font-weight:normal;">x${q.item.qty}</span>` : ""}</span>
                    ${note ? `<span class="an-retr-note" title="${escHtml(note)}">${escHtml(note)}</span>` : ""}
                </div>
                <span class="an-retr-meta">${escHtml(q.item.type || "")}${q.item.loanedTo ? " · " + escHtml(q.item.loanedTo) : ""}</span>
                <span class="an-retr-msg">${escHtml(q.msg || "")}</span>`;
						const skipBtn = document.createElement("button");
						skipBtn.className = "an-btn an-retr-skip";
						skipBtn.textContent = q.skip ? "Unskip" : "Skip";
						skipBtn.disabled = q.done || busy;
						skipBtn.addEventListener("click", () => {
							q.skip = !q.skip;
							renderList();
							updateFooter();
						});
						row.appendChild(skipBtn);
						listEl.appendChild(row);
					});
				}
				function nextPending() {
					return queue.find((q) => !q.done && !q.skip);
				}
				function updateFooter() {
					const remaining = queue.filter((q) => !q.done && !q.skip).length;
					if (busy) {
						nextBtn.disabled = true;
						nextBtn.textContent = "Retrieving...";
					} else if (remaining > 0) {
						nextBtn.disabled = false;
						nextBtn.textContent = `Retrieve Next (${remaining} left)`;
					} else {
						nextBtn.disabled = true;
						nextBtn.textContent = "Nothing to retrieve";
					}
					const started = queue.some((q) => q.done);
					personSel.disabled = busy || started;
					modeSel.disabled = busy || started;
					itemSel.disabled = busy || started;
					ownerSel.disabled = busy || started;
					if (nextPageBtn) nextPageBtn.disabled = busy;
				}
				personSel.addEventListener("change", () => {
					if (queue.some((q) => q.done)) return;
					rebuildItemOptions();
					rebuildOwnerOptions();
					buildQueue();
				});
				modeSel.addEventListener("change", () => {
					if (queue.some((q) => q.done)) return;
					rebuildPersonOptions();
					rebuildItemOptions();
					rebuildOwnerOptions();
					buildQueue();
				});
				itemSel.addEventListener("change", () => {
					if (queue.some((q) => q.done)) return;
					rebuildOwnerOptions();
					buildQueue();
				});
				ownerSel.addEventListener("change", () => {
					if (!queue.some((q) => q.done)) buildQueue();
				});
				nextBtn.addEventListener("click", async () => {
					if (busy) return;
					const q = nextPending();
					if (!q) return;
					busy = true;
					running = true;
					updateFooter();
					renderList();
					statusEl.textContent = `Retrieving ${q.item.itemName}${qtyLabel(q.item)}...`;
					try {
						const res = await retrieveOne(q.item);
						const ok = res && (res.success === true || !res.error && !res.errorMessage);
						q.done = true;
						q.ok = !!ok;
						q.msg = ok ? "Retrieved" : res?.error || res?.errorMessage || "Failed";
						if (ok) {
							markRowRetrieved(q.item.armouryId);
							retrDidAct = true;
						}
					} catch (e) {
						q.done = true;
						q.ok = false;
						q.msg = e?.message || "Failed";
					} finally {
						busy = false;
						statusEl.textContent = "";
						renderList();
						updateFooter();
					}
				});
				closeBtn.addEventListener("click", closeRetrAndReload);
				if (retrNextPageLink()) {
					nextPageBtn.style.display = "";
					nextPageBtn.addEventListener("click", () => {
						if (!busy) retrGoNextPage();
					});
				}
				overlay.addEventListener("mousedown", (e) => {
					if (e.target === overlay) e.stopPropagation();
				});
				overlay.addEventListener("click", (e) => {
					if (e.target === overlay) e.stopPropagation();
				});
				overlay.appendChild(panel);
				document.body.appendChild(overlay);
				retrModalEl = overlay;
				document.addEventListener("keydown", onRetrKeydown, true);
				rebuildPersonOptions();
				rebuildItemOptions();
				rebuildOwnerOptions();
				buildQueue();
			}
			function ensureActionBar() {
				let bar = document.getElementById("an-action-bar");
				if (bar) return bar;
				const anchor = document.querySelector(".armoury-msg");
				if (!anchor || !anchor.parentElement) return null;
				bar = document.createElement("div");
				bar.id = "an-action-bar";
				bar.className = "an-retrieve-bar";
				anchor.insertAdjacentElement("afterend", bar);
				return bar;
			}
			function removeActionBarIfEmpty() {
				const bar = document.getElementById("an-action-bar");
				if (bar && bar.children.length === 0) bar.remove();
			}
			function ensureRetrievalButton() {
				if (location.pathname !== "/factions.php") return;
				const onArmoury = /tab=armoury/i.test(location.hash || "");
				const hasRetrievables = visibleRetrieveLinks().length > 0;
				let btn = document.getElementById("an-retrieve-btn");
				if (!onArmoury || !hasRetrievables) {
					if (btn) {
						btn.remove();
						removeActionBarIfEmpty();
					}
					return;
				}
				if (btn) return;
				const bar = ensureActionBar();
				btn = document.createElement("button");
				btn.id = "an-retrieve-btn";
				btn.className = "an-btn an-retrieve-btn";
				btn.textContent = "Retrieve items";
				btn.addEventListener("click", openRetrievalModal);
				if (bar) {
					bar.insertBefore(btn, bar.firstChild);
					return;
				}
				btn.classList.add("an-retrieve-btn-float");
				document.body.appendChild(btn);
			}
			function visibleGiveLinks() {
				return Array.from(document.querySelectorAll("a[data-role=\"give\"]")).filter((a) => isVisibleRow(a.closest("li") || a));
			}
			function snapshotGivables() {
				const out = [];
				visibleGiveLinks().forEach((a) => {
					const idHost = a.closest("[data-armoryid]") || a.closest("li")?.querySelector("[data-armoryid]") || null;
					const li = a.closest("li") || idHost?.closest("li");
					if (!li) return;
					const holder = idHost || li.querySelector("[data-armoryid]");
					const armouryId = holder?.getAttribute("data-armoryid") || null;
					const itemId = holder?.getAttribute("data-itemid") || null;
					if (!armouryId || !itemId) return;
					const nameEl = li.querySelector(".name, [class*=\"item-name\"], b, strong");
					let itemName = "";
					if (nameEl) {
						const clone = nameEl.cloneNode(true);
						clone.querySelectorAll(".an-controls, .an-owner-badge, .an-note-btn, .qty").forEach((n) => n.remove());
						itemName = (clone.textContent || "").trim();
					}
					const type = (li.querySelector(".type")?.textContent || "").trim();
					const qtyEl = li.querySelector(".name .qty, .an-name-text .qty, .qty");
					const avail = qtyEl ? parseInt((qtyEl.textContent || "").replace(/[^\d]/g, ""), 10) || 1 : 1;
					out.push({
						armouryId,
						itemId,
						itemName: itemName || `Item ${itemId}`,
						type,
						avail
					});
				});
				return out;
			}
			function giveOne(item, recipient, quantity) {
				return new Promise((resolve, reject) => {
					const getAction = typeof unsafeWindow !== "undefined" && unsafeWindow.getAction || typeof window !== "undefined" && window.getAction || null;
					if (typeof getAction !== "function") {
						reject(new Error("Torn's getAction not found on this page"));
						return;
					}
					getAction({
						type: "post",
						action: "factions.php",
						data: {
							ajax: "true",
							step: "armouryActionItem",
							role: "give",
							item: item.armouryId,
							itemID: item.itemId,
							type: item.type,
							user: recipient,
							quantity: String(quantity)
						},
						success: (str) => {
							try {
								resolve(typeof str === "string" ? JSON.parse(str) : str);
							} catch {
								resolve({ raw: str });
							}
						},
						error: (err) => reject(err instanceof Error ? err : new Error(String(err?.error || err?.message || "request failed")))
					});
				});
			}
			function markRowGiven(armouryId) {
				try {
					const holder = document.querySelector(`[data-armoryid="${armouryId}"]`);
					const li = holder?.closest("li");
					if (!li) return;
					li.querySelectorAll("a[data-role=\"give\"], a[data-role=\"loan\"]").forEach((a) => a.remove());
				} catch (e) {
					log("markRowGiven", e);
				}
			}
			let giveModalEl = null;
			let giveDidAct = false;
			let givePaging = false;
			let giveRecipientMemo = null;
			let giveMembers = [];
			let giveMembersError = false;
			function closeGiveModal() {
				if (giveModalEl) {
					giveModalEl.remove();
					giveModalEl = null;
				}
				document.removeEventListener("keydown", onGiveKeydown, true);
			}
			function closeGiveAndReload() {
				const acted = giveDidAct;
				closeGiveModal();
				if (acted) location.reload();
			}
			function onGiveKeydown(e) {
				if (e.key === "Escape") {
					e.stopPropagation();
					closeGiveAndReload();
				}
			}
			async function giveGoNextPage() {
				const link = retrNextPageLink();
				if (!link) return;
				const targetPage = parseInt(link.getAttribute("page"), 10);
				givePaging = true;
				closeGiveModal();
				link.click();
				await waitFor(() => {
					const a = document.querySelector(".pagination-wrap a.page-number.active");
					return a && parseInt(a.getAttribute("page") || "0", 10) === targetPage;
				});
				await sleep(200);
				openGiveModal();
			}
			async function openGiveModal() {
				const all = snapshotGivables();
				if (!all.length) {
					toast("Nothing giveable on this tab.", "info");
					givePaging = false;
					return;
				}
				const wasPaging = givePaging;
				if (!givePaging) {
					giveDidAct = false;
					giveRecipientMemo = null;
				}
				givePaging = false;
				const members = await fetchFactionMembers();
				giveMembersError = members === null;
				giveMembers = members || [];
				closeGiveModal();
				const overlay = document.createElement("div");
				overlay.className = "an-modal-overlay an-retr-overlay";
				const panel = document.createElement("div");
				panel.className = "an-modal-panel an-retr-panel";
				panel.innerHTML = `
                <div class="an-modal-title">Give items to a member — this tab</div>
                <div class="an-retr-controls">
                    <label class="an-label" style="margin:0;">Give to</label>
                    <div class="an-owner-wrap" style="flex:1 1 auto;min-width:0;">
                        <input type="text" class="an-input an-give-recipient" autocomplete="off" placeholder="${giveMembersError ? "Couldn't load members - reopen to retry" : "Search member to give to"}" ${giveMembersError ? "disabled" : ""}>
                        <div class="an-owner-dropdown an-give-dd"></div>
                    </div>
                </div>
                <div class="an-retr-controls">
                    <label class="an-label" style="margin:0;">Mode</label>
                    <select class="an-input an-give-mode" style="flex:0 0 auto;">
                        <option value="loaned_in">Loaned-in (from notes)</option>
                        <option value="member_owned">Member owned (from notes)</option>
                        <option value="all">Everything</option>
                    </select>
                    <label class="an-label" style="margin:0;">Item</label>
                    <select class="an-input an-retr-item" style="flex:1 1 auto;min-width:0;"></select>
                </div>
                <div class="an-retr-controls">
                    <label class="an-label" style="margin:0;">Owner</label>
                    <select class="an-input an-retr-owner" style="flex:1 1 auto;min-width:0;"></select>
                </div>
                <div class="an-retr-list"></div>
                <div class="an-modal-footer">
                    <span class="an-status an-retr-status"></span>
                    <button class="an-btn an-retr-close">Close</button>
                    <button class="an-btn an-give-nextpage" style="display:none;">Next Page</button>
                    <button class="an-btn an-btn-primary an-retr-next">Give Next</button>
                </div>`;
				const recipInput = panel.querySelector(".an-give-recipient");
				const recipDd = panel.querySelector(".an-give-dd");
				const modeSel = panel.querySelector(".an-give-mode");
				const itemSel = panel.querySelector(".an-retr-item");
				const ownerSel = panel.querySelector(".an-retr-owner");
				const listEl = panel.querySelector(".an-retr-list");
				const statusEl = panel.querySelector(".an-retr-status");
				const closeBtn = panel.querySelector(".an-retr-close");
				const nextPageBtn = panel.querySelector(".an-give-nextpage");
				const nextBtn = panel.querySelector(".an-retr-next");
				let recipient = null;
				const byName = (a, b) => (a.itemName || "").localeCompare(b.itemName || "") || a.armouryId - b.armouryId;
				const noteCatOf = (i) => {
					const d = getCached(`armouryid:${i.armouryId}`);
					return d ? d.category : null;
				};
				function baseSet() {
					const m = modeSel.value;
					if (m === "all") return all.slice();
					if (m === "loaned_in") return all.filter((i) => itemLoanedIn(i.armouryId));
					return all.filter((i) => noteCatOf(i) === m);
				}
				function currentSet() {
					let set = baseSet();
					const chosen = itemSel.value;
					if (chosen && chosen !== "__all__") set = set.filter((i) => i.itemName === chosen);
					const owner = ownerSel.value;
					if (owner && owner !== "__all__") set = set.filter((i) => itemNoteOwner(i.armouryId) === owner);
					return set.sort(byName);
				}
				function rebuildItemOptions() {
					const set = baseSet();
					const counts = {};
					set.forEach((i) => {
						counts[i.itemName] = (counts[i.itemName] || 0) + 1;
					});
					const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
					const prev = itemSel.value;
					itemSel.innerHTML = `<option value="__all__">All items (${set.length})</option>` + names.map((n) => `<option value="${escHtml(n)}">${escHtml(n)} (${counts[n]})</option>`).join("");
					if (prev && Array.from(itemSel.options).some((o) => o.value === prev)) itemSel.value = prev;
				}
				function rebuildOwnerOptions() {
					const set = baseSet();
					const counts = {};
					set.forEach((i) => {
						const o = itemNoteOwner(i.armouryId);
						if (o) counts[o] = (counts[o] || 0) + 1;
					});
					const owners = Object.keys(counts).sort((a, b) => a.localeCompare(b));
					const prev = ownerSel.value;
					ownerSel.innerHTML = `<option value="__all__">All owners (${set.length})</option>` + owners.map((o) => `<option value="${escHtml(o)}">${escHtml(o)} (${counts[o]})</option>`).join("");
					if (prev && Array.from(ownerSel.options).some((x) => x.value === prev)) ownerSel.value = prev;
				}
				function openDd() {
					const r = recipInput.getBoundingClientRect();
					const up = r.bottom > window.innerHeight * .55;
					recipDd.classList.toggle("an-drop-up", up);
					recipDd.classList.toggle("an-drop-down", !up);
					recipDd.classList.add("show");
				}
				function closeDd() {
					recipDd.classList.remove("show");
					recipDd.innerHTML = "";
				}
				recipInput.addEventListener("keydown", (e) => e.stopPropagation());
				recipInput.addEventListener("input", () => {
					recipient = null;
					updateFooter();
					const q = recipInput.value.trim().toLowerCase();
					if (!q) {
						closeDd();
						return;
					}
					const matches = giveMembers.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 25);
					if (!matches.length) {
						recipDd.innerHTML = "<div class=\"an-owner-item an-owner-empty\">No matching members</div>";
						openDd();
						return;
					}
					recipDd.innerHTML = matches.map((m) => `<div class="an-owner-item" data-id="${m.id}" data-name="${escHtml(m.name)}">
                        <span class="an-owner-name">${escHtml(m.name)}</span>
                        <span class="an-owner-id">[${m.id}]</span>
                    </div>`).join("");
					openDd();
					recipDd.querySelectorAll(".an-owner-item[data-id]").forEach((el) => {
						el.addEventListener("click", () => {
							recipient = {
								id: Number(el.dataset.id),
								name: el.dataset.name
							};
							giveRecipientMemo = recipient;
							recipInput.value = `${recipient.name} [${recipient.id}]`;
							closeDd();
							updateFooter();
						});
					});
				});
				document.addEventListener("click", (e) => {
					if (!panel.querySelector(".an-give-recipient")?.parentElement.contains(e.target)) closeDd();
				});
				let queue = [];
				let busy = false;
				function buildQueue() {
					queue = currentSet().map((i) => ({
						item: i,
						qty: 1,
						skip: false,
						done: false,
						ok: null,
						msg: ""
					}));
					renderList();
					updateFooter();
				}
				function renderList() {
					if (!queue.length) {
						listEl.innerHTML = "<div class=\"an-retr-empty\">No items for this selection.</div>";
						return;
					}
					listEl.innerHTML = "";
					queue.forEach((q) => {
						const row = document.createElement("div");
						row.className = "an-retr-row" + (q.skip ? " an-retr-skipped" : "") + (q.done ? " an-retr-done" : "");
						row.dataset.armouryId = q.item.armouryId;
						const icon = q.done ? q.ok ? "✅" : "❌" : q.skip ? "⊘" : "•";
						row.innerHTML = `
                        <span class="an-retr-icon">${icon}</span>
                        <div class="an-retr-main">
                            <span class="an-retr-name" title="${escHtml(q.item.itemName)}">${escHtml(q.item.itemName)}</span>
                            ${itemNoteText(q.item.armouryId) ? `<span class="an-retr-note" title="${escHtml(itemNoteText(q.item.armouryId))}">${escHtml(itemNoteText(q.item.armouryId))}</span>` : ""}
                        </div>
                        <span class="an-retr-meta">${escHtml(q.item.type || "")}${q.item.avail > 1 ? " · avail " + q.item.avail : ""}</span>
                        <span class="an-retr-msg">${escHtml(q.msg || "")}</span>`;
						const qtyInput = document.createElement("input");
						qtyInput.type = "number";
						qtyInput.className = "an-input an-give-qty";
						qtyInput.min = "1";
						qtyInput.max = String(q.item.avail);
						qtyInput.value = String(q.qty);
						qtyInput.disabled = q.done || busy || q.item.avail <= 1;
						qtyInput.addEventListener("keydown", (e) => e.stopPropagation());
						qtyInput.addEventListener("change", () => {
							let v = parseInt(qtyInput.value, 10);
							if (!Number.isFinite(v) || v < 1) v = 1;
							q.qty = v;
							qtyInput.value = String(v);
						});
						row.appendChild(qtyInput);
						const skipBtn = document.createElement("button");
						skipBtn.className = "an-btn an-retr-skip";
						skipBtn.textContent = q.skip ? "Unskip" : "Skip";
						skipBtn.disabled = q.done || busy;
						skipBtn.addEventListener("click", () => {
							q.skip = !q.skip;
							renderList();
							updateFooter();
						});
						row.appendChild(skipBtn);
						listEl.appendChild(row);
					});
				}
				function nextPending() {
					return queue.find((q) => !q.done && !q.skip);
				}
				function updateFooter() {
					const remaining = queue.filter((q) => !q.done && !q.skip).length;
					const started = queue.some((q) => q.done);
					if (busy) {
						nextBtn.disabled = true;
						nextBtn.textContent = "Giving...";
					} else if (!recipient) {
						nextBtn.disabled = true;
						nextBtn.textContent = "Choose a member";
					} else if (remaining > 0) {
						nextBtn.disabled = false;
						nextBtn.textContent = `Give Next (${remaining} left)`;
					} else {
						nextBtn.disabled = true;
						nextBtn.textContent = "Nothing to give";
					}
					itemSel.disabled = busy || started;
					modeSel.disabled = busy || started;
					ownerSel.disabled = busy || started;
					recipInput.disabled = busy || started || giveMembersError;
					if (nextPageBtn) nextPageBtn.disabled = busy;
				}
				itemSel.addEventListener("change", () => {
					if (queue.some((q) => q.done)) return;
					rebuildOwnerOptions();
					buildQueue();
				});
				modeSel.addEventListener("change", () => {
					if (queue.some((q) => q.done)) return;
					rebuildItemOptions();
					rebuildOwnerOptions();
					buildQueue();
				});
				ownerSel.addEventListener("change", () => {
					if (!queue.some((q) => q.done)) buildQueue();
				});
				nextBtn.addEventListener("click", async () => {
					if (busy || !recipient) return;
					const q = nextPending();
					if (!q) return;
					if (q.qty > q.item.avail) {
						q.done = true;
						q.ok = false;
						q.msg = `Only ${q.item.avail} available`;
						renderList();
						updateFooter();
						return;
					}
					busy = true;
					updateFooter();
					renderList();
					const recipStr = `${recipient.name} [${recipient.id}]`;
					statusEl.textContent = `Giving ${q.item.itemName} to ${recipient.name}...`;
					try {
						const res = await giveOne(q.item, recipStr, q.qty);
						const ok = res && (res.success === true || !res.error && !res.errorMessage);
						q.done = true;
						q.ok = !!ok;
						q.msg = ok ? "Given" : res?.error || res?.errorMessage || "Failed";
						if (ok) {
							markRowGiven(q.item.armouryId);
							giveDidAct = true;
						}
					} catch (e) {
						q.done = true;
						q.ok = false;
						q.msg = e?.message || "Failed";
					} finally {
						busy = false;
						statusEl.textContent = "";
						renderList();
						updateFooter();
					}
				});
				closeBtn.addEventListener("click", closeGiveAndReload);
				if (wasPaging && giveRecipientMemo && !giveMembersError) {
					recipient = giveRecipientMemo;
					recipInput.value = `${recipient.name} [${recipient.id}]`;
					updateFooter();
				}
				if (retrNextPageLink()) {
					nextPageBtn.style.display = "";
					nextPageBtn.addEventListener("click", () => {
						if (!busy) giveGoNextPage();
					});
				}
				overlay.addEventListener("mousedown", (e) => {
					if (e.target === overlay) e.stopPropagation();
				});
				overlay.addEventListener("click", (e) => {
					if (e.target === overlay) e.stopPropagation();
				});
				overlay.appendChild(panel);
				document.body.appendChild(overlay);
				giveModalEl = overlay;
				document.addEventListener("keydown", onGiveKeydown, true);
				rebuildItemOptions();
				rebuildOwnerOptions();
				buildQueue();
			}
			function ensureGiveButton() {
				if (location.pathname !== "/factions.php") return;
				const onArmoury = /tab=armoury/i.test(location.hash || "");
				const hasGivables = visibleGiveLinks().length > 0;
				let btn = document.getElementById("an-give-btn");
				if (!onArmoury || !hasGivables) {
					if (btn) {
						btn.remove();
						removeActionBarIfEmpty();
					}
					return;
				}
				if (btn) return;
				const bar = ensureActionBar();
				btn = document.createElement("button");
				btn.id = "an-give-btn";
				btn.className = "an-btn an-retrieve-btn";
				btn.textContent = "Give items";
				btn.addEventListener("click", openGiveModal);
				if (bar) {
					const retr = document.getElementById("an-retrieve-btn");
					if (retr && retr.parentElement === bar) retr.insertAdjacentElement("afterend", btn);
					else bar.insertBefore(btn, bar.firstChild);
					return;
				}
				btn.classList.add("an-retrieve-btn-float");
				btn.style.bottom = "64px";
				document.body.appendChild(btn);
			}
			async function requestMigration() {
				try {
					const res = await req("POST", "/api/migrations", {});
					const n = res?.totalNotes || 0;
					if (n === 0) {
						toast("No notes found to migrate — you own no notes in other family factions.", "info");
						return;
					}
					const factions = (res?.pending || []).map((p) => p.originFaction).filter(Boolean);
					const from = factions.length ? ` from ${factions.join(", ")}` : "";
					await messageDialog("Migration requested", `Requested migration of ${n} note${n === 1 ? "" : "s"}${from}. An origin-faction leader must approve it.\n\n` + `You will be able to edit these notes once this faction's leadership grants you write access.`);
				} catch (e) {
					toast(e?.serverResponse?.error || e?.message || "Could not request migration.", "error");
				}
			}
			function messageDialog(title, message) {
				return new Promise((resolve) => {
					const overlay = document.createElement("div");
					overlay.className = "an-modal-overlay";
					const panel = document.createElement("div");
					panel.className = "an-modal-panel";
					panel.innerHTML = `<div class="an-modal-title"></div><div class="an-confirm-msg" style="white-space:pre-line;"></div>
                    <div class="an-modal-footer"><button class="an-btn an-btn-primary an-msg-ok">OK</button></div>`;
					panel.querySelector(".an-modal-title").textContent = title;
					panel.querySelector(".an-confirm-msg").textContent = message;
					const done = () => {
						overlay.remove();
						resolve();
					};
					panel.querySelector(".an-msg-ok").addEventListener("click", done);
					overlay.addEventListener("mousedown", (e) => {
						if (e.target === overlay) done();
					});
					overlay.appendChild(panel);
					document.body.appendChild(overlay);
				});
			}
			let migPollTimer = null;
			async function refreshPendingMigrations() {
				const btn = document.getElementById("an-mig-approve-btn");
				if (USER_ROLE !== "leadership") {
					if (btn) btn.remove();
					return;
				}
				let list = [];
				try {
					list = await req("GET", "/api/migrations/pending");
				} catch (e) {
					log("pending migs", e);
					return;
				}
				const count = Array.isArray(list) ? list.length : 0;
				let b = document.getElementById("an-mig-approve-btn");
				if (count === 0) {
					if (b) {
						b.remove();
						removeActionBarIfEmpty();
					}
					return;
				}
				const bar = ensureActionBar();
				if (!bar) return;
				if (!b) {
					b = document.createElement("button");
					b.id = "an-mig-approve-btn";
					b.className = "an-btn an-retrieve-btn an-mig-pulse";
					b.addEventListener("click", () => openApprovalsModal());
					bar.appendChild(b);
				}
				b.textContent = `\u26A0 Approve migrations (${count})`;
			}
			async function openApprovalsModal() {
				let list = [];
				try {
					list = await req("GET", "/api/migrations/pending");
				} catch (e) {
					toast("Could not load pending migrations.", "error");
					return;
				}
				const overlay = document.createElement("div");
				overlay.className = "an-modal-overlay";
				const panel = document.createElement("div");
				panel.className = "an-modal-panel an-council-panel";
				panel.innerHTML = `<div class="an-modal-title">Pending migrations</div>
                <div class="an-council-sub">Requests to move notes OUT of your faction into another family faction. Approving copies them and marks yours as migrated (reversible).</div>
                <div class="an-mig-list"></div>
                <div class="an-modal-footer"><button class="an-btn an-mig-close">Close</button></div>`;
				const listEl = panel.querySelector(".an-mig-list");
				const renderRows = (rows) => {
					if (!rows.length) {
						listEl.innerHTML = "<div class=\"an-retr-empty\">No pending migrations.</div>";
						return;
					}
					listEl.innerHTML = "";
					rows.forEach((m) => {
						const row = document.createElement("div");
						row.className = "an-council-row";
						const label = document.createElement("span");
						label.className = "an-council-name";
						label.textContent = `${m.noteCount} note${m.noteCount === 1 ? "" : "s"} -> ${m.destFaction} (requested by ${m.requesterId})`;
						const approve = document.createElement("button");
						approve.className = "an-btn an-btn-primary an-council-btn";
						approve.textContent = "Approve";
						approve.addEventListener("click", async () => {
							approve.disabled = true;
							try {
								await req("POST", `/api/migrations/${m.id}/approve`, {});
								toast("Migration approved.", "info");
							} catch (e) {
								toast(e?.serverResponse?.error || "Approve failed.", "error");
								approve.disabled = false;
								return;
							}
							const fresh = await req("GET", "/api/migrations/pending").catch(() => []);
							renderRows(fresh);
							refreshPendingMigrations();
						});
						row.append(label, approve);
						listEl.appendChild(row);
					});
				};
				renderRows(Array.isArray(list) ? list : []);
				const close = () => overlay.remove();
				panel.querySelector(".an-mig-close").addEventListener("click", close);
				overlay.addEventListener("mousedown", (e) => {
					if (e.target === overlay) close();
				});
				overlay.appendChild(panel);
				document.body.appendChild(overlay);
			}
			function ensureMigrationUI() {
				if (location.pathname !== "/factions.php") return;
				const onArmoury = /tab=armoury/i.test(location.hash || "");
				let mbtn = document.getElementById("an-mig-btn");
				if (!onArmoury) {
					if (mbtn) mbtn.remove();
					const ab = document.getElementById("an-mig-approve-btn");
					if (ab) ab.remove();
					if (migPollTimer) {
						clearInterval(migPollTimer);
						migPollTimer = null;
					}
					removeActionBarIfEmpty();
					return;
				}
				if (!mbtn) {
					const bar = ensureActionBar();
					if (bar) {
						mbtn = document.createElement("button");
						mbtn.id = "an-mig-btn";
						mbtn.className = "an-btn an-retrieve-btn";
						mbtn.textContent = "Migrate Notes";
						mbtn.title = "Request to move notes you own from other family factions into this one";
						mbtn.addEventListener("click", requestMigration);
						bar.appendChild(mbtn);
					}
				}
				if (USER_ROLE === "leadership" && !migPollTimer) {
					refreshPendingMigrations();
					migPollTimer = setInterval(refreshPendingMigrations, 6e4);
				}
			}
			const TRADE_PARTNER_SS = "an-trade-partner-";
			const TRADE_FILTER_SS = "an-trade-filter-";
			const TRADE_PENDING_SS = "an-trade-partner-pending";
			function tradeHashParams() {
				const h = location.hash || "";
				const step = ((h.match(/step=([a-z]+)/i) || [])[1] || "").toLowerCase();
				const id = (h.match(/ID=(\d+)/i) || [])[1] || "";
				return {
					step,
					id
				};
			}
			function possessive(n) {
				const s = (n || "").trim();
				if (!s) return s;
				return /s$/i.test(s) ? `${s}'` : `${s}'s`;
			}
			function readPartner(tradeId) {
				try {
					const v = sessionStorage.getItem(TRADE_PARTNER_SS + tradeId);
					return v ? JSON.parse(v) : null;
				} catch {
					return null;
				}
			}
			function writePartner(tradeId, p) {
				try {
					sessionStorage.setItem(TRADE_PARTNER_SS + tradeId, JSON.stringify(p));
				} catch (e) {
					log("partner persist", e);
				}
			}
			function readPending() {
				try {
					const v = sessionStorage.getItem(TRADE_PENDING_SS);
					return v ? JSON.parse(v) : null;
				} catch {
					return null;
				}
			}
			function writePending(p) {
				try {
					sessionStorage.setItem(TRADE_PENDING_SS, JSON.stringify(p));
				} catch (e) {
					log("pending persist", e);
				}
			}
			function clearPending() {
				try {
					sessionStorage.removeItem(TRADE_PENDING_SS);
				} catch {}
			}
			const getTradeFilterOn = (tradeId) => {
				try {
					return sessionStorage.getItem(TRADE_FILTER_SS + tradeId) === "1";
				} catch {
					return false;
				}
			};
			const setTradeFilterOn = (tradeId, on) => {
				try {
					sessionStorage.setItem(TRADE_FILTER_SS + tradeId, on ? "1" : "0");
				} catch (e) {
					log("filter persist", e);
				}
			};
			let partnerResolveInFlight = false;
			async function captureTradePartner() {
				const { step, id } = tradeHashParams();
				if (step !== "view" && step !== "initiatetrade") return;
				const store = id ? {
					get: () => readPartner(id),
					set: (p) => writePartner(id, p)
				} : {
					get: () => readPending(),
					set: (p) => writePending(p)
				};
				const existing = store.get();
				if (existing && existing.id) return;
				const rightUser = document.querySelector(".user.right");
				const headingEl = rightUser?.querySelector(".title-black[role=\"heading\"]");
				if (!headingEl) return;
				const clone = headingEl.cloneNode(true);
				clone.querySelectorAll("label, input, ul").forEach((n) => n.remove());
				const name = (clone.textContent || "").trim();
				if (!name) return;
				if (!existing || existing.name !== name) store.set({
					id: null,
					name
				});
				if (partnerResolveInFlight) return;
				partnerResolveInFlight = true;
				try {
					let resolved = null;
					try {
						const matches = await searchUsers(name);
						const exact = matches.find((m) => (m.name || "").toLowerCase() === name.toLowerCase()) || matches[0];
						if (exact) resolved = {
							id: exact.id,
							name: exact.name
						};
					} catch (e) {
						log("partner resolve", e);
					}
					store.set(resolved || {
						id: null,
						name
					});
				} finally {
					partnerResolveInFlight = false;
				}
			}
			function adoptPendingPartner() {
				const { step, id } = tradeHashParams();
				if (step !== "add" || !id) return;
				const cur = readPartner(id);
				if (cur && cur.name) return;
				const pend = readPending();
				if (pend && pend.name) {
					writePartner(id, pend);
					clearPending();
					return;
				}
				resolvePartnerFromTradeApi(id);
			}
			const tradeApiTried = new Set();
			async function resolvePartnerFromTradeApi(id) {
				if (!id || tradeApiTried.has(id)) return;
				tradeApiTried.add(id);
				try {
					const data = await tornApi(`/user/${id}/trade`);
					const t = data?.trade;
					if (!t) return;
					const me = Number(TORN_USER_ID || 0);
					const sides = [t.trader, t.user].filter(Boolean);
					const partner = sides.find((s) => Number(s.id) !== me) || sides[0];
					if (partner?.id && partner?.name) {
						writePartner(id, {
							id: Number(partner.id),
							name: partner.name
						});
						const now = tradeHashParams();
						if (now.step === "add" && now.id === id) {
							ensureTradeFilterToggle();
							applyTradeFilter();
						}
					}
				} catch (e) {
					log("trade api resolve", e);
				}
			}
			function tradeRowBadge(li) {
				return li.querySelector(".an-owner-badge");
			}
			function rowMatchesPartner(li, partner) {
				const badge = tradeRowBadge(li);
				if (!badge) return false;
				if (partner.id) return badge.dataset.ownerId && Number(badge.dataset.ownerId) === Number(partner.id);
				const txt = (badge.textContent || "").replace(/^⇠\s*/, "").trim().toLowerCase();
				return txt && txt === (partner.name || "").toLowerCase();
			}
			function applyTradeFilter() {
				const { step, id } = tradeHashParams();
				if (step !== "add" || !id) return;
				const on = getTradeFilterOn(id);
				const partner = readPartner(id);
				const rows = document.querySelectorAll("li.clearfix[data-group=\"child\"]");
				rows.forEach((li) => {
					if (!on || !partner) {
						li.style.removeProperty("display");
						return;
					}
					li.style.display = rowMatchesPartner(li, partner) ? "" : "none";
				});
			}
			function ensureTradeFilterToggle() {
				const { step, id } = tradeHashParams();
				if (step !== "add" || !id) return;
				const partner = readPartner(id);
				const labelText = partner?.name ? `Show only ${possessive(partner.name)} items` : "Show only partner's items";
				let existing = document.getElementById("an-trade-filter-wrap");
				if (existing) {
					const sp = existing.querySelector("span");
					if (sp && sp.textContent !== labelText) sp.textContent = labelText;
					return;
				}
				const wrap = document.createElement("label");
				wrap.id = "an-trade-filter-wrap";
				wrap.className = "an-trade-filter";
				const cb = document.createElement("input");
				cb.type = "checkbox";
				cb.checked = getTradeFilterOn(id);
				const span = document.createElement("span");
				span.textContent = labelText;
				wrap.append(cb, span);
				cb.addEventListener("change", () => {
					setTradeFilterOn(id, cb.checked);
					applyTradeFilter();
				});
				if (!partner?.name) {
					[
						400,
						900,
						1800,
						3e3
					].forEach((ms) => setTimeout(ensureTradeFilterToggle, ms));
				}
				const clearAll = Array.from(document.querySelectorAll("a, span, div")).find((el) => el.children.length === 0 && /^clear all$/i.test((el.textContent || "").trim()));
				if (clearAll && clearAll.parentElement) {
					wrap.classList.add("an-trade-filter-inline");
					clearAll.insertAdjacentElement("afterend", wrap);
					return;
				}
				const header = Array.from(document.querySelectorAll("div.title-black")).find((el) => {
					const sp = el.querySelector("span");
					return sp && /which items would you like to add to trade/i.test(sp.textContent || "");
				});
				if (header) {
					header.appendChild(wrap);
					return;
				}
				const firstRow = document.querySelector("li.clearfix[data-group=\"child\"]");
				const listParent = firstRow?.parentElement;
				if (listParent && listParent.parentElement) {
					const bar = document.createElement("div");
					bar.className = "an-trade-filter-bar";
					bar.appendChild(wrap);
					listParent.parentElement.insertBefore(bar, listParent);
				}
			}
			function tradeStepTick() {
				if (location.pathname !== "/trade.php") return;
				captureTradePartner();
				adoptPendingPartner();
				ensureTradeFilterToggle();
				applyTradeFilter();
			}
			(async function bootstrap() {
				ARMOURY_KEY = getArmouryKey();
				TORN_API_KEY = getTornKey();
				const access = await getAccessRole();
				USER_ROLE = access.role || "readonly";
				USER_CAN_WRITE = !!access.canWrite;
				TORN_USER_ID = access.userId || null;
				TORN_USER_NAME = access.name || null;
				await loadCategories();
				if (USER_CAN_WRITE) resolveFactionIdentity();
				renderDeletionBanner();
				UI.wireGuideField("an-armoury-key", wireSettingsGuide);
				if (!ARMOURY_KEY) {
					toast("Armoury Notes: set your Armoury key in DSS → Armoury Notes settings.", "info");
				}
				const pageKey = PAGE_FOR_PATH[location.pathname];
				const enabled = getEnabledPages();
				const notesUI = !!pageKey && enabled[pageKey] !== false;
				if (!notesUI) return;
				initAll();
				tradeStepTick();
				ensureRetrievalButton();
				ensureGiveButton();
				ensureMigrationUI();
				let tradePollTimer = null;
				function pollTradeStep(times = 16, gap = 400) {
					if (location.pathname !== "/trade.php") return;
					if (tradePollTimer) clearInterval(tradePollTimer);
					let n = 0;
					tradePollTimer = setInterval(() => {
						try {
							tradeStepTick();
						} catch (e) {
							log("pollTradeStep", e);
						}
						if (++n >= times) {
							clearInterval(tradePollTimer);
							tradePollTimer = null;
						}
					}, gap);
				}
				pollTradeStep();
				window.addEventListener("hashchange", () => {
					setTimeout(() => {
						try {
							tradeStepTick();
						} catch (e) {
							log("tick", e);
						}
						ensureRetrievalButton();
						ensureGiveButton();
						ensureMigrationUI();
					}, 150);
					pollTradeStep();
				});
				let moScheduled = false;
				const pendingRoots = new Set();
				const mo = new MutationObserver((records) => {
					for (const r of records) for (const n of r.addedNodes) if (n && n.nodeType === 1) pendingRoots.add(n);
					if (moScheduled) return;
					moScheduled = true;
					setTimeout(() => {
						moScheduled = false;
						if (pendingRoots.size === 0) return;
						const roots = Array.from(pendingRoots);
						pendingRoots.clear();
						for (const root of roots) {
							try {
								initAll(root);
							} catch (e) {
								log("initAll(root)", e);
							}
						}
						try {
							tradeStepTick();
						} catch (e) {
							log("tradeStepTick", e);
						}
						try {
							ensureRetrievalButton();
						} catch (e) {
							log("ensureRetrievalButton", e);
						}
						try {
							ensureGiveButton();
						} catch (e) {
							log("ensureGiveButton", e);
						}
						try {
							ensureMigrationUI();
						} catch (e) {
							log("ensureMigrationUI", e);
						}
					}, 150);
				});
				mo.observe(document.body, {
					childList: true,
					subtree: true
				});
			})();
		}
	});

// src/modules/cash-monitor/guide.html?raw
	var guide_default$4 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Cash Threshold</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Set the cash amount that triggers the alert. You'll be notified when your cash on hand exceeds this value.</p>\n                <div style=\"display:flex;gap:8px;align-items:center;margin-top:10px;\">\n                    <span style=\"color:#777;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0;\">Threshold</span>\n                    <input type=\"text\" inputmode=\"numeric\" id=\"dss-cash-threshold-input\" placeholder=\"$1,000,000\"\n                        style=\"width:160px;padding:8px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#ccc;font-size:12px;font-family:monospace;outline:none;\" />\n                    <button id=\"dss-cash-threshold-save\" style=\"padding:8px 16px;background:rgba(76,175,80,0.2);border:1px solid rgba(76,175,80,0.4);border-radius:4px;color:#4caf50;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;\">Save</button>\n                </div>\n                <div id=\"dss-cash-threshold-status\" style=\"margin-top:6px;font-size:11px;min-height:16px;\"></div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Dismiss Cooldown</div>\n            <div class=\"dss-guide-card-body\">\n                <p>After you dismiss the alert, it won't reappear for this long — even if your cash is still over the threshold. Set it in seconds.</p>\n                <div style=\"display:flex;gap:8px;align-items:center;margin-top:10px;\">\n                    <span style=\"color:#777;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0;\">Cooldown</span>\n                    <input type=\"number\" id=\"dss-cash-cooldown-input\" min=\"5\" step=\"5\" placeholder=\"300\"\n                        style=\"width:100px;padding:8px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#ccc;font-size:12px;font-family:monospace;outline:none;\" />\n                    <span style=\"color:#666;font-size:11px;\">seconds</span>\n                    <button id=\"dss-cash-cooldown-save\" style=\"padding:8px 16px;background:rgba(76,175,80,0.2);border:1px solid rgba(76,175,80,0.4);border-radius:4px;color:#4caf50;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;\">Save</button>\n                </div>\n                <div id=\"dss-cash-cooldown-status\" style=\"margin-top:6px;font-size:11px;min-height:16px;\"></div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">How It Works</div>\n            <div class=\"dss-guide-card-body\">\n                <p>When your cash on hand exceeds the threshold, a green alert dialog appears in the top-left with your current balance and three quick actions:</p>\n                <p><strong>Vault</strong> — navigates to your property vault and sets the max deposit, you must click deposit.</p>\n                <p><strong>Faction Vault</strong> — navigates to the faction armoury vault and sets the max deposit, you must click deposit.</p>\n                <p><strong>Trade</strong> — navigates to the trade page, for you to add to a ghost trade.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Alert Behaviour</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Dismissing the alert (the × button or Dismiss button) starts the cooldown set above. The cooldown is shared across all open tabs, so dismissing in one tab silences the alert everywhere.</p>\n                <p>This module runs on every Torn page since cash is always visible in the sidebar.</p>\n            </div>\n        </div>\n    ";

// src/modules/cash-monitor/index.js
	registerModule("cash-monitor", {
		name: "Cash Monitor",
		version: "1.1",
		description: "Monitor cash on hand with visual alerts and quick vault/faction vault/trade options when your cash exceeds a threshold.",
		pages: ["https://www.torn.com/"],
		guide: guide_default$4,
		init() {
			const SURPRISE_USER_ID = 3593405;
			const SURPRISE_VIDEO_ID = "i0M4ARe9v0Y";
			function getUserId() {
				const key = Object.keys(sessionStorage).find((k) => /sidebarData\d+/.test(k));
				if (!key) return null;
				try {
					const data = JSON.parse(sessionStorage.getItem(key));
					return data?.user?.userID ?? null;
				} catch (_) {
					return null;
				}
			}
			function isSurpriseUser() {
				const uid = getUserId();
				return uid !== null && Number(uid) === SURPRISE_USER_ID;
			}
			const THRESHOLD_KEY = "dss_cash_threshold";
			const COOLDOWN_KEY = "dss_cash_cooldown";
			const CASH_THRESHOLD = parseInt(GM_getValue(THRESHOLD_KEY, "1000000"), 10) || 1e6;
			const DEFAULT_COOLDOWN_SECS = 300;
			const ALERT_COOLDOWN = (parseInt(GM_getValue(COOLDOWN_KEY, String(DEFAULT_COOLDOWN_SECS)), 10) || DEFAULT_COOLDOWN_SECS) * 1e3;
			const CHECK_INTERVAL = 3e3;
			let checkTimer = null;
			let alertDialogOpen = false;
			let lastCashAmount = 0;
			let isTabFocused = document.hasFocus();
			window.addEventListener("focus", () => {
				isTabFocused = true;
			});
			window.addEventListener("blur", () => {
				isTabFocused = false;
				closeCashAlert();
			});
			document.addEventListener("visibilitychange", () => {
				isTabFocused = document.visibilityState === "visible" && document.hasFocus();
				if (!isTabFocused) closeCashAlert();
			});
			function digitsOnly(str) {
				return (str || "").replace(/[^\d]/g, "");
			}
			function formatCurrencyInput(str) {
				const digits = digitsOnly(str);
				if (!digits) return "";
				return "$" + parseInt(digits, 10).toLocaleString("en-US");
			}
			function wireGuideControls() {
				const input = document.getElementById("dss-cash-threshold-input");
				const saveBtn = document.getElementById("dss-cash-threshold-save");
				const status = document.getElementById("dss-cash-threshold-status");
				const cdInput = document.getElementById("dss-cash-cooldown-input");
				const cdSaveBtn = document.getElementById("dss-cash-cooldown-save");
				const cdStatus = document.getElementById("dss-cash-cooldown-status");
				if (input && saveBtn) {
					input.value = formatCurrencyInput(GM_getValue(THRESHOLD_KEY, "1000000"));
					input.addEventListener("input", () => {
						input.value = formatCurrencyInput(input.value);
					});
					saveBtn.addEventListener("click", () => {
						const val = parseInt(digitsOnly(input.value), 10);
						if (!val || val < 1e3) {
							if (status) {
								status.textContent = "⚠ Enter a value of at least $1,000";
								status.style.color = "#ef4444";
							}
							return;
						}
						GM_setValue(THRESHOLD_KEY, String(val));
						input.value = formatCurrencyInput(String(val));
						if (status) {
							status.textContent = "✅ Saved — threshold set to $" + val.toLocaleString();
							status.style.color = "#4caf50";
						}
					});
					input.addEventListener("keydown", (e) => {
						e.stopPropagation();
						if (e.key === "Enter") saveBtn.click();
					});
				}
				if (cdInput && cdSaveBtn) {
					cdInput.value = GM_getValue(COOLDOWN_KEY, String(DEFAULT_COOLDOWN_SECS));
					cdSaveBtn.addEventListener("click", () => {
						const val = parseInt(cdInput.value, 10);
						if (!val || val < 5) {
							if (cdStatus) {
								cdStatus.textContent = "⚠ Enter a value of at least 5 seconds";
								cdStatus.style.color = "#ef4444";
							}
							return;
						}
						GM_setValue(COOLDOWN_KEY, String(val));
						if (cdStatus) {
							cdStatus.textContent = "✅ Saved — cooldown set to " + val + "s (reload to apply)";
							cdStatus.style.color = "#4caf50";
						}
					});
					cdInput.addEventListener("keydown", (e) => {
						e.stopPropagation();
						if (e.key === "Enter") cdSaveBtn.click();
					});
				}
			}
			UI.wireGuideField("dss-cash-threshold-input", wireGuideControls);
			function getCashOnHand() {
				const el = document.getElementById("user-money");
				if (!el) return null;
				const cashString = el.getAttribute("data-money");
				if (!cashString) return null;
				const cash = parseInt(cashString, 10);
				return isNaN(cash) ? null : cash;
			}
			function formatCash(amount) {
				if (amount >= 1e9) return "$" + (amount / 1e9).toFixed(2) + "b";
				if (amount >= 1e6) return "$" + (amount / 1e6).toFixed(2) + "m";
				if (amount >= 1e3) return "$" + (amount / 1e3).toFixed(2) + "k";
				return "$" + amount.toLocaleString();
			}
			function updateCheck() {
				if (!isTabFocused) return;
				const currentCash = getCashOnHand();
				if (currentCash === null) return;
				const now = Date.now();
				const lastAlert = parseInt(GM_getValue("dss_lastCashAlertTime", "0"), 10) || 0;
				if (currentCash >= CASH_THRESHOLD && !alertDialogOpen && now - lastAlert >= ALERT_COOLDOWN) {
					showCashAlert(currentCash);
				}
				lastCashAmount = currentCash;
			}
			function startCooldown() {
				GM_setValue("dss_lastCashAlertTime", Date.now().toString());
			}
			function showCashAlert(cashAmount) {
				const existing = document.getElementById("cash-alert-dialog");
				if (existing) {
					const amountEl = existing.querySelector(".cash-amount");
					if (amountEl) amountEl.textContent = formatCash(cashAmount);
					alertDialogOpen = true;
					return;
				}
				alertDialogOpen = true;
				const surprise = isSurpriseUser();
				const videoHtml = surprise ? `
                    <div class="dss-surprise-video">
                        <iframe
                            src="https://www.youtube.com/embed/${SURPRISE_VIDEO_ID}?autoplay=1&mute=1&rel=0"
                            title="Cash Alert"
                            frameborder="0"
                            allow="autoplay; encrypted-media"
                            allowfullscreen></iframe>
                    </div>` : "";
				const dialog = document.createElement("div");
				dialog.id = "cash-alert-dialog";
				dialog.innerHTML = `
                <div class="dialog-content${surprise ? " cash-surprise" : ""}">
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
				dialog.querySelector(".btn-vault").addEventListener("click", handleVaultClick);
				dialog.querySelector(".btn-faction-vault").addEventListener("click", handleFactionVaultClick);
				dialog.querySelector(".btn-trade").addEventListener("click", handleTradeClick);
				dialog.querySelector(".dialog-close").addEventListener("click", dismissCashAlert);
				dialog.querySelector(".btn-dismiss").addEventListener("click", dismissCashAlert);
			}
			function showCashAlertOriginal(cashAmount) {
				const existing = document.getElementById("cash-alert-dialog");
				if (existing) {
					const amountEl = existing.querySelector(".cash-amount");
					if (amountEl) amountEl.textContent = formatCash(cashAmount);
					alertDialogOpen = true;
					return;
				}
				alertDialogOpen = true;
				const dialog = document.createElement("div");
				dialog.id = "cash-alert-dialog";
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
				dialog.querySelector(".btn-vault").addEventListener("click", handleVaultClick);
				dialog.querySelector(".btn-faction-vault").addEventListener("click", handleFactionVaultClick);
				dialog.querySelector(".btn-trade").addEventListener("click", handleTradeClick);
				dialog.querySelector(".dialog-close").addEventListener("click", dismissCashAlert);
				dialog.querySelector(".btn-dismiss").addEventListener("click", dismissCashAlert);
			}
			function handleVaultClick() {
				const onVaultPage = window.location.href.includes("properties.php") && window.location.hash.includes("vault");
				startCooldown();
				if (!onVaultPage) {
					sessionStorage.setItem("dss_highlightVaultControls", "true");
					closeCashAlert();
					window.location.href = "https://www.torn.com/properties.php#/p=options&tab=vault";
					return;
				}
				closeCashAlert();
				setTimeout(() => highlightDepositControls(), 200);
			}
			function handleFactionVaultClick() {
				const onFactionVaultPage = window.location.href.includes("factions.php?step=your") && window.location.hash.includes("armoury");
				startCooldown();
				if (!onFactionVaultPage) {
					sessionStorage.setItem("dss_highlightFactionVaultControls", "true");
					closeCashAlert();
					window.location.href = "https://www.torn.com/factions.php?step=your&type=1#/tab=armoury";
					return;
				}
				closeCashAlert();
				setTimeout(() => highlightFactionDepositControls(), 200);
			}
			function handleTradeClick() {
				startCooldown();
				closeCashAlert();
				window.location.href = "https://www.torn.com/trade.php";
			}
			function closeCashAlert() {
				const dialog = document.getElementById("cash-alert-dialog");
				if (dialog) dialog.remove();
				alertDialogOpen = false;
			}
			function dismissCashAlert() {
				startCooldown();
				closeCashAlert();
			}
			function highlightDepositControls() {
				const depositInput = document.querySelector("input[name=\"deposit\"][data-deposit].input-money");
				if (depositInput) {
					let parent = depositInput.parentElement;
					let maxButton = null;
					for (let i = 0; i < 5 && parent; i++) {
						maxButton = parent.querySelector("input.wai-btn[aria-label*=\"maximum amount\"]");
						if (maxButton) break;
						parent = parent.parentElement;
					}
					if (maxButton) {
						maxButton.click();
						depositInput.dispatchEvent(new Event("input", { bubbles: true }));
						depositInput.dispatchEvent(new Event("change", { bubbles: true }));
					}
				}
				const depositButton = document.querySelector("input[type=\"submit\"][value=\"DEPOSIT\"]");
				if (depositButton) {
					depositButton.classList.add("deposit-btn-highlight");
					const removeHighlight = () => {
						depositButton.classList.remove("deposit-btn-highlight");
						depositButton.removeEventListener("click", removeHighlight);
					};
					setTimeout(removeHighlight, 1e4);
					depositButton.addEventListener("click", removeHighlight);
				}
			}
			function highlightFactionDepositControls() {
				let waiButton = document.querySelector("span.input-money-symbol input.wai-btn[aria-label*=\"maximum amount\"]") || document.querySelector("input.wai-btn[aria-label*=\"maximum amount\"]");
				if (!waiButton) {
					const vaultSection = document.querySelector("[class*=\"vault\"], [class*=\"armoury\"]");
					if (vaultSection) waiButton = vaultSection.querySelector("input.wai-btn");
				}
				if (waiButton) {
					waiButton.click();
					waiButton.dispatchEvent(new Event("mousedown", { bubbles: true }));
					waiButton.dispatchEvent(new Event("mouseup", { bubbles: true }));
				}
				let depositButton = document.querySelector("button.torn-btn[i-data*=\"i_410\"]");
				if (!depositButton) {
					const buttons = document.querySelectorAll("button.torn-btn");
					for (const btn of buttons) {
						if (btn.textContent.includes("DEPOSIT MONEY")) {
							depositButton = btn;
							break;
						}
					}
				}
				if (depositButton) {
					depositButton.classList.add("deposit-btn-highlight");
					const removeHighlight = () => {
						depositButton.classList.remove("deposit-btn-highlight");
						depositButton.removeEventListener("click", removeHighlight);
					};
					setTimeout(removeHighlight, 1e4);
					depositButton.addEventListener("click", removeHighlight);
				}
			}
			function checkVaultHighlight() {
				if (window.location.href.includes("properties.php") && window.location.hash.includes("vault")) {
					if (sessionStorage.getItem("dss_highlightVaultControls") === "true") {
						sessionStorage.removeItem("dss_highlightVaultControls");
						const waitFor = setInterval(() => {
							const depositInput = document.querySelector("input[name=\"deposit\"][data-deposit].input-money");
							const depositButton = document.querySelector("input[type=\"submit\"][value=\"DEPOSIT\"]");
							if (depositInput && depositButton) {
								clearInterval(waitFor);
								setTimeout(() => highlightDepositControls(), 200);
							}
						}, 50);
						setTimeout(() => clearInterval(waitFor), 1e4);
					}
				}
				if (window.location.href.includes("factions.php")) {
					if (sessionStorage.getItem("dss_highlightFactionVaultControls") === "true") {
						sessionStorage.removeItem("dss_highlightFactionVaultControls");
						let attempts = 0;
						const waitFor = setInterval(() => {
							attempts++;
							const waiButton = document.querySelector("input.wai-btn[aria-label*=\"maximum amount\"]");
							const depositButton = document.querySelector("button.torn-btn");
							if (waiButton && depositButton) {
								clearInterval(waitFor);
								setTimeout(() => highlightFactionDepositControls(), 300);
							} else if (attempts >= 200) clearInterval(waitFor);
						}, 100);
					}
				}
			}
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
			if (IS_PDA) {
				GM_addStyle("#cash-alert-dialog { bottom: 20px; left: 50%; transform: translateX(-50%); }");
			} else {
				GM_addStyle("#cash-alert-dialog { top: 20px; left: 20px; }");
			}
			checkVaultHighlight();
			updateCheck();
			checkTimer = setInterval(updateCheck, CHECK_INTERVAL);
			window.addEventListener("beforeunload", () => {
				if (checkTimer) clearInterval(checkTimer);
			});
		}
	});

// src/modules/item-price-sorter/guide.html?raw
	var guide_default$3 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Price Sorting</div>\n            <div class=\"dss-guide-card-body\">\n                <p>A sort button appears next to the item search bar. Click to cycle through:</p>\n                <p><strong>Unsorted</strong> → <strong style=\"color:#90ee90;\">High → Low</strong> → <strong style=\"color:#ee9090;\">Low → High</strong> → back to Unsorted.</p>\n                <p>On mobile / PDA the button shows as a compact symbol (<strong>⇅</strong> → <strong>$↓</strong> → <strong>$↑</strong>) to fit the toolbar.</p>\n                <p>Sorting carries over when switching item tabs. The original order is preserved and can be restored.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Stacks &amp; Totals</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Stacks sort by their <strong>total</strong> value — unit price × quantity — so a pile of 500 cheap items is ranked by what the whole pile is worth, not by the single-item price. Single items sort by their unit price.</p>\n                <p>Each stack shows both figures: <strong>unit price | quantity× = total</strong>.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Price Data Source</div>\n            <div class=\"dss-guide-card-body\">\n                <p><strong>Desktop:</strong> reads price data injected by the <strong>TornTools</strong> browser extension. Install it from the <a href=\"https://chromewebstore.google.com/detail/torn-tools/hjpaapdjcgbmeikfnahipphknonhlhib\" target=\"_blank\" style=\"color:var(--link-color,#60a5fa);\">Chrome Web Store</a> or <a href=\"https://addons.mozilla.org/en-GB/firefox/addon/torn-tools/\" target=\"_blank\" style=\"color:var(--link-color,#60a5fa);\">Firefox Add-ons</a>.</p>\n                <p><strong>Mobile / Torn PDA:</strong> TornTools isn't available, so prices are pulled from the Torn API (<code>/torn/items</code>) using the API key set on the DSS <strong>Setup</strong> page, and shown as a small tag at the right of each row.</p>\n                <p>Items with no market price (untradeable or event items) show <strong style=\"color:#888;font-style:italic;\">N/A</strong> and sort to the bottom.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Daily Prices &amp; Freshness</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Market prices update roughly once a day, so the data is cached and refreshed at most once per day — on your first visit to the items page each day. Repeat visits use the cache and make no extra API calls.</p>\n                <p>If a daily refresh fails (no connection, API error), the last saved prices are used instead. When that happens the prices turn <strong style=\"color:#d9756b;\">red</strong> and a banner shows the date the data is from — reload the page to try refreshing again.</p>\n            </div>\n        </div>\n    ";

// src/modules/item-price-sorter/index.js
	registerModule("item-price-sorter", {
		name: "Item Price Sorter",
		version: "2.0",
		description: "Sort items by price on the items page. On desktop uses TornTools price data; on Torn PDA it pulls daily market prices from the Torn API.",
		pages: ["/item.php"],
		guide: guide_default$3,
		init() {
			let sortAscending = false;
			let sortActive = false;
			let originalOrder = new Map();
			let listObserver = null;
			let isSorting = false;
			let sortDebounceTimer = null;
			const PRICE_CACHE_KEY = "dss_item_market_prices_v1";
			let priceMap = null;
			let pricesLoading = false;
			let pricesStale = false;
			let staleDay = null;
			const DSS_FORCE_STALE = false;
			if (IS_PDA) {
				GM_addStyle(`
                .items-cont.ui-tabs-panel > li { position: relative; }
                .dss-pda-price {
                    position: absolute;
                    right: 10px;
                    top: 19px;
                    transform: translateY(-50%);
                    font-size: 9px;
                    color: #7bb661;
                    white-space: nowrap;
                    pointer-events: none;
                }
                .dss-pda-price .tt-item-quantity {
                    color: #ccc;
                }
                .dss-pda-price-stale {
                    color: #d9756b;
                }
                .dss-pda-price-stale .tt-item-quantity {
                    color: #ccc;
                }
                .dss-pda-price-na {
                    color: #888;
                    font-style: italic;
                }
                                .dss-price-stale-banner {
                    display: flex; align-items: center; gap: 8px;
                    padding: 6px 10px; margin: 0 0 4px 0;
                    background: rgba(160,50,45,0.18);
                    border: 1px solid rgba(217,117,107,0.5);
                    border-radius: 4px;
                    color: #d9756b; font-size: 11px; line-height: 1.4;
                    box-sizing: border-box;
                }
                .dss-price-stale-banner .dss-psb-text { flex: 1; }
                .dss-price-stale-banner .dss-psb-close {
                    flex-shrink: 0; cursor: pointer; border: none; background: none;
                    color: #d9756b; font-size: 15px; line-height: 1; padding: 0 2px;
                }
            `);
			}
			function todayUTC() {
				return new Date().toISOString().slice(0, 10);
			}
			function loadCachedPrices() {
				try {
					const raw = GM_getValue(PRICE_CACHE_KEY);
					if (!raw) return null;
					const data = JSON.parse(raw);
					if (data && data.prices) {
						return {
							prices: data.prices,
							day: data.day || null,
							stale: data.day !== todayUTC()
						};
					}
				} catch (_) {}
				return null;
			}
			function saveCachedPrices(prices) {
				try {
					GM_setValue(PRICE_CACHE_KEY, JSON.stringify({
						day: todayUTC(),
						prices
					}));
				} catch (_) {}
			}
			async function fetchPrices() {
				const apiKey = Storage.getSettings().apiKey;
				if (!apiKey) return null;
				try {
					const res = await fetch(`${API_BASE}/torn/items?cat=All&sort=ASC`, { headers: tornAuth(apiKey) });
					if (!res.ok) return null;
					const data = await res.json();
					if (data?.error || !Array.isArray(data?.items)) return null;
					const map = {};
					for (const item of data.items) {
						const mp = item?.value?.market_price;
						if (item?.id != null && mp) map[item.id] = mp;
					}
					return map;
				} catch (_) {
					return null;
				}
			}
			async function ensurePriceMap() {
				if (priceMap) return priceMap;
				const cached = loadCachedPrices();
				if (cached && !cached.stale && !DSS_FORCE_STALE) {
					priceMap = cached.prices;
					pricesStale = false;
					return priceMap;
				}
				if (pricesLoading) return null;
				pricesLoading = true;
				const fetched = await fetchPrices();
				pricesLoading = false;
				if (fetched && !DSS_FORCE_STALE) {
					priceMap = fetched;
					pricesStale = false;
					staleDay = null;
					saveCachedPrices(fetched);
				} else if (fetched && DSS_FORCE_STALE) {
					priceMap = fetched;
					pricesStale = true;
					staleDay = "2026-09-01";
				} else if (cached) {
					priceMap = cached.prices;
					pricesStale = true;
					staleDay = cached.day;
				}
				return priceMap;
			}
			function getItemId(li) {
				const dataEl = li.matches && li.matches("[data-item]") ? li : li.querySelector("[data-item]");
				if (dataEl) {
					const v = dataEl.getAttribute("data-item");
					if (v && /^\d+$/.test(v)) return v;
				}
				const imgs = li.querySelectorAll("img[src], img[data-src]");
				for (const im of imgs) {
					const src = im.getAttribute("src") || im.getAttribute("data-src") || "";
					const m = src.match(/\/items\/(\d+)\//);
					if (m) return m[1];
				}
				const idEl = li.querySelector("[data-itemid]");
				if (idEl) {
					const v = idEl.getAttribute("data-itemid");
					if (v && /^\d+$/.test(v)) return v;
				}
				return null;
			}
			function getRowQuantity(li) {
				const qtyEl = li.querySelector("span.qty, .qty");
				if (qtyEl) {
					const m = (qtyEl.textContent || "").replace(/[,\s]/g, "").match(/(\d+)/);
					if (m) return parseInt(m[1], 10);
				}
				return 1;
			}
			function injectPricesInto(list) {
				if (!IS_PDA || !priceMap || !list) return;
				const staleCls = pricesStale ? " dss-pda-price-stale" : "";
				const staleTitle = pricesStale ? staleDay ? `Market prices are out of date — showing cached data from ${staleDay}. Today's refresh failed; reload to retry.` : `Market prices are out of date — today's refresh failed. Reload to retry.` : "";
				for (const li of Array.from(list.children)) {
					if (li.tagName !== "LI") continue;
					if (li.querySelector("span.tt-item-price") || li.querySelector(".dss-pda-price")) continue;
					const id = getItemId(li);
					const host = li;
					const unit = id ? priceMap[id] : null;
					if (!unit) {
						const na = document.createElement("span");
						na.className = "dss-pda-price dss-pda-price-na";
						na.textContent = "N/A";
						host.appendChild(na);
						continue;
					}
					const qty = getRowQuantity(li);
					const wrap = document.createElement("span");
					wrap.className = "tt-item-price dss-pda-price" + staleCls;
					if (staleTitle) wrap.title = staleTitle;
					if (qty > 1) {
						const total = unit * qty;
						const s1 = document.createElement("span");
						s1.textContent = "$" + unit.toLocaleString("en-US") + " |";
						const s2 = document.createElement("span");
						s2.className = "tt-item-quantity";
						s2.textContent = " " + qty + "x = ";
						const s3 = document.createElement("span");
						s3.textContent = "$" + total.toLocaleString("en-US");
						wrap.append(s1, s2, s3);
					} else {
						const s = document.createElement("span");
						s.textContent = "$" + unit.toLocaleString("en-US");
						wrap.appendChild(s);
					}
					host.appendChild(wrap);
				}
				renderStaleBanner(list);
			}
			let staleBannerDismissed = false;
			function renderStaleBanner(list) {
				if (!IS_PDA || !list) return;
				const existing = list.querySelector(".dss-price-stale-banner");
				if (!pricesStale || staleBannerDismissed) {
					if (existing) existing.remove();
					return;
				}
				if (existing) return;
				const banner = document.createElement("div");
				banner.className = "dss-price-stale-banner";
				const text = document.createElement("span");
				text.className = "dss-psb-text";
				text.textContent = staleDay ? `⚠ Market prices are from ${staleDay} - today's refresh failed. Reload to retry.` : `⚠ Market prices are out of date - today's refresh failed. Reload to retry.`;
				const close = document.createElement("button");
				close.className = "dss-psb-close";
				close.type = "button";
				close.textContent = "×";
				close.title = "Dismiss";
				close.addEventListener("click", () => {
					staleBannerDismissed = true;
					banner.remove();
				});
				banner.append(text, close);
				list.insertBefore(banner, list.firstChild);
			}
			function ensurePricesForActiveList() {
				if (!IS_PDA) return;
				ensurePriceMap().then(() => injectPricesInto(getActiveList()));
			}
			function parsePrice(liElement) {
				const armouryLi = liElement.querySelector("li.tt-item-price.fl");
				if (armouryLi) {
					const aSpans = armouryLi.querySelectorAll("span");
					if (aSpans.length) {
						const last = aSpans[aSpans.length - 1];
						return parseFloat(last.textContent.replace(/[$,]/g, "")) || 0;
					}
				}
				const priceSpan = liElement.querySelector("span.tt-item-price");
				if (priceSpan) {
					const spans = priceSpan.querySelectorAll("span");
					if (spans.length >= 3) {
						return parseFloat(spans[spans.length - 1].textContent.replace(/[$,]/g, "")) || 0;
					} else if (spans.length === 1) {
						return parseFloat(spans[0].textContent.replace(/[$,]/g, "")) || 0;
					}
					const match = priceSpan.textContent.match(/\$([\d,]+)/g);
					if (match) {
						return parseFloat(match[match.length - 1].replace(/[$,]/g, "")) || 0;
					}
				}
				return 0;
			}
			function getActiveList() {
				const panels = document.querySelectorAll(".items-cont.ui-tabs-panel");
				for (const panel of panels) {
					if (panel.getAttribute("aria-hidden") === "false" || panel.style.display !== "none") {
						return panel;
					}
				}
				return null;
			}
			function saveOriginalOrder(list) {
				const id = list.id || list.dataset.info || "unknown";
				if (!originalOrder.has(id)) {
					originalOrder.set(id, Array.from(list.children));
				}
			}
			function sortItems(ascending) {
				const list = getActiveList();
				if (!list) return;
				if (IS_PDA) injectPricesInto(list);
				isSorting = true;
				const items = Array.from(list.children);
				items.sort((a, b) => {
					const priceA = parsePrice(a);
					const priceB = parsePrice(b);
					return ascending ? priceA - priceB : priceB - priceA;
				});
				const fragment = document.createDocumentFragment();
				items.forEach((item) => fragment.appendChild(item));
				list.appendChild(fragment);
				isSorting = false;
			}
			function restoreOriginalOrder() {
				const list = getActiveList();
				if (!list) return;
				const id = list.id || list.dataset.info || "unknown";
				const original = originalOrder.get(id);
				if (!original) return;
				isSorting = true;
				const fragment = document.createDocumentFragment();
				original.forEach((item) => fragment.appendChild(item));
				list.appendChild(fragment);
				isSorting = false;
				originalOrder.delete(id);
			}
			function updateButton(btn) {
				if (!sortActive) {
					btn.textContent = IS_PDA ? "⇅" : "Unsorted";
					btn.title = "Click to sort by price (high to low)";
					btn.style.background = "#2a2a2a";
					btn.style.borderColor = "#555";
					btn.style.color = "#e0e0e0";
				} else if (!sortAscending) {
					btn.textContent = IS_PDA ? "$↓" : "$ High → Low";
					btn.title = "Click to sort by price (low to high)";
					btn.style.background = "#1a3a1a";
					btn.style.borderColor = "#4a8a4a";
					btn.style.color = "#90ee90";
				} else {
					btn.textContent = IS_PDA ? "$↑" : "$ Low → High";
					btn.title = "Click to restore original order";
					btn.style.background = "#3a1a1a";
					btn.style.borderColor = "#8a4a4a";
					btn.style.color = "#ee9090";
				}
			}
			function injectButton() {
				if (document.getElementById("dss-sort-btn")) return;
				const searchForm = document.querySelector("form[name=\"itemsSearchForm\"]");
				if (!searchForm) return;
				const btn = document.createElement("button");
				btn.id = "dss-sort-btn";
				btn.type = "button";
				btn.style.cssText = `
                margin-left: 6px; padding: 3px 8px; background: #2a2a2a;
                color: #e0e0e0; border: 1px solid #555; border-radius: 3px;
                cursor: pointer; font-size: 11px; vertical-align: middle;
                line-height: 1.4; float: right; position: relative; top: 3px;
            `;
				updateButton(btn);
				btn.addEventListener("click", () => {
					const list = getActiveList();
					if (!list) return;
					if (IS_PDA && !priceMap) ensurePricesForActiveList();
					if (!sortActive) {
						saveOriginalOrder(list);
						sortActive = true;
						sortAscending = false;
						sortItems(false);
					} else if (!sortAscending) {
						sortAscending = true;
						sortItems(true);
					} else {
						sortActive = false;
						sortAscending = false;
						restoreOriginalOrder();
					}
					updateButton(btn);
				});
				searchForm.insertAdjacentElement("afterend", btn);
			}
			function observeActiveList() {
				if (listObserver) {
					listObserver.disconnect();
					listObserver = null;
				}
				const list = getActiveList();
				if (!list) return;
				listObserver = new MutationObserver((mutations) => {
					if (isSorting) return;
					const hasNewItemRows = mutations.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !(n.classList && n.classList.contains("show-item-info")) && (n.matches && n.matches("li[data-item]") || n.querySelector && n.querySelector("li[data-item]"))));
					if (!hasNewItemRows) return;
					if (IS_PDA) injectPricesInto(list);
					if (sortActive && !isDetailOpen(list)) {
						clearTimeout(sortDebounceTimer);
						sortDebounceTimer = setTimeout(() => {
							if (isDetailOpen(list)) return;
							const id = list.id || list.dataset.info || "unknown";
							originalOrder.delete(id);
							saveOriginalOrder(list);
							sortItems(sortAscending);
						}, 300);
					}
				});
				listObserver.observe(list, { childList: true });
			}
			function isDetailOpen(list) {
				return !!list.querySelector(".show-item-info, li.item-info-active, li.opened");
			}
			function onTabChange() {
				clearTimeout(sortDebounceTimer);
				setTimeout(() => {
					const list = getActiveList();
					if (!list) return;
					if (IS_PDA) injectPricesInto(list);
					const id = list.id || list.dataset.info || "unknown";
					originalOrder.delete(id);
					if (sortActive) {
						saveOriginalOrder(list);
						sortItems(sortAscending);
					}
					observeActiveList();
					const btn = document.getElementById("dss-sort-btn");
					if (btn) updateButton(btn);
				}, 300);
			}
			function startInit() {
				injectButton();
				const tabContainer = document.querySelector(".tabs-list") || document.querySelector("[role=\"tablist\"]");
				if (tabContainer) tabContainer.addEventListener("click", onTabChange);
				observeActiveList();
				if (IS_PDA) ensurePricesForActiveList();
			}
			const bodyObserver = new MutationObserver(() => {
				if (document.querySelector("form[name=\"itemsSearchForm\"]") && !document.getElementById("dss-sort-btn")) {
					startInit();
				}
			});
			bodyObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			setTimeout(startInit, 1e3);
		}
	});

// src/modules/honor-names/guide.html?raw
	var guide_default$2 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Display Mode</div>\n            <div class=\"dss-guide-card-body\">\n                <p><strong>Overlay</strong> — keeps the honor bar artwork (slightly dimmed) and puts the name on top in a clear font with a dark pill behind it.</p>\n                <p><strong>Plain</strong> — hides the artwork and shows just the name. Most readable, best for dense lists.</p>\n                <p><strong>Hover</strong> — bars look normal; hover (or tap) one to see the clean name.</p>\n                <div style=\"display:flex;flex-direction:column;gap:10px;margin-top:12px;\">\n                    <label style=\"display:flex;align-items:center;gap:8px;\">\n                        <span style=\"color:#777;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;width:110px;\">Mode</span>\n                        <select id=\"dss-hn-mode\" style=\"padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#ccc;font-size:12px;\">\n                            <option value=\"overlay\">Overlay</option>\n                            <option value=\"plain\">Plain</option>\n                            <option value=\"hover\">Hover</option>\n                        </select>\n                    </label>\n                    <label style=\"display:flex;align-items:center;gap:8px;\">\n                        <span style=\"color:#777;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;width:110px;\">Text size</span>\n                        <input type=\"range\" id=\"dss-hn-scale\" min=\"70\" max=\"150\" step=\"5\" style=\"width:140px;\">\n                        <span id=\"dss-hn-scale-val\" style=\"color:#aaa;font-size:11px;min-width:36px;\"></span>\n                    </label>\n                    <label style=\"display:flex;align-items:center;gap:8px;\">\n                        <span style=\"color:#777;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;width:110px;\">Pill opacity</span>\n                        <input type=\"range\" id=\"dss-hn-bg\" min=\"0\" max=\"100\" step=\"5\" style=\"width:140px;\">\n                        <span id=\"dss-hn-bg-val\" style=\"color:#aaa;font-size:11px;min-width:36px;\"></span>\n                    </label>\n                    <label style=\"display:flex;align-items:center;gap:8px;cursor:pointer;\">\n                        <input type=\"checkbox\" id=\"dss-hn-colour\">\n                        <span style=\"font-size:12px;\">Colour names by honor bar colour</span>\n                    </label>\n                    <label style=\"display:flex;align-items:center;gap:8px;cursor:pointer;\">\n                        <input type=\"checkbox\" id=\"dss-hn-war\">\n                        <span style=\"font-size:12px;\">Show readable names on the faction war page</span>\n                    </label>\n                    <label style=\"display:flex;align-items:center;gap:8px;cursor:pointer;\">\n                        <input type=\"checkbox\" id=\"dss-hn-self\">\n                        <span style=\"font-size:12px;\">Highlight my row on the faction war page</span>\n                    </label>\n                    <div style=\"font-size:11px;color:#4caf50;min-height:14px;\" id=\"dss-hn-status\"></div>\n                </div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Notes</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Changes apply instantly on open pages. Long names are truncated with an ellipsis; the full name is still in the link's tooltip.</p>\n                <p>This only adds a label on top of Torn's honor bars — it doesn't change or remove Torn's own elements, so other scripts keep working.</p>\n            </div>\n        </div>\n    ";

// src/modules/honor-names/index.js
	registerModule("honor-names", {
		name: "Readable Names",
		version: "1.1",
		description: "Makes honor bar names readable with a clean text label (overlay, plain or hover), and highlights your own row on the faction war page.",
		pages: ["https://www.torn.com/"],
		guide: guide_default$2,
		init() {
			const SETTINGS_KEY_HN = "dss_hn_settings";
			const MYID_KEY = "dss_hn_myid";
			const DEFAULTS = {
				mode: "overlay",
				scale: 100,
				bg: 55,
				colour: true,
				highlightSelf: true,
				warNames: true
			};
			const loadCfg = () => {
				try {
					return {
						...DEFAULTS,
						...JSON.parse(GM_getValue(SETTINGS_KEY_HN, "{}"))
					};
				} catch (_) {
					return { ...DEFAULTS };
				}
			};
			const saveCfg = (c) => GM_setValue(SETTINGS_KEY_HN, JSON.stringify(c));
			let cfg = loadCfg();
			const root = document.documentElement;
			function applyCfg() {
				root.classList.remove("dss-hn-overlay", "dss-hn-plain", "dss-hn-hover", "dss-hn-colour");
				if (!cfg.warNames && isWarPage()) return;
				root.classList.add("dss-hn-" + cfg.mode);
				root.classList.toggle("dss-hn-colour", !!cfg.colour);
				root.style.setProperty("--dss-hn-scale", String(cfg.scale / 100));
				root.style.setProperty("--dss-hn-bg", String(cfg.bg / 100));
			}
			GM_addStyle(`
            .honor-text-wrap[data-dss-hn] { position: relative !important; }
            .dss-hn-label {
                display: none;
                position: absolute; top: 50%;
                /* Centre within the space NOT covered by injected badges (--dss-hn-left) */
                left: calc(var(--dss-hn-left, 0px) + (100% - var(--dss-hn-left, 0px)) / 2);
                transform: translate(-50%, -50%);
                z-index: 2; pointer-events: none;
                max-width: calc(100% - var(--dss-hn-left, 0px) - 4px); box-sizing: border-box;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                font: 700 calc(10px * var(--dss-hn-scale, 1))/1.3 Arial, Helvetica, sans-serif;
                letter-spacing: 0.2px;
                color: #fff;
                padding: 0 5px; border-radius: 3px;
                background: rgba(0, 0, 0, var(--dss-hn-bg, 0.55));
                text-shadow: 0 0 2px #000, 0 1px 2px #000;
            }
            .honor-text-wrap.big .dss-hn-label { font-size: calc(12px * var(--dss-hn-scale, 1)); }

            /* Overlay: dim art, hide pixel glyphs, show label */
            html.dss-hn-overlay .honor-text-wrap[data-dss-hn] > img { filter: brightness(0.8) saturate(0.85); }
            html.dss-hn-overlay .honor-text-wrap[data-dss-hn] .honor-text-svg { visibility: hidden !important; }
            html.dss-hn-overlay .dss-hn-label { display: block; }

            /* Plain: hide art (keep its space so tables don't shift), bare text */
            html.dss-hn-plain .honor-text-wrap[data-dss-hn] > img { opacity: 0 !important; }
            html.dss-hn-plain .honor-text-wrap[data-dss-hn] .honor-text-svg { visibility: hidden !important; }
            html.dss-hn-plain .dss-hn-label { display: block; background: transparent; text-shadow: none; color: #ddd; }

            /* Hover: only on hover */
            html.dss-hn-hover .honor-text-wrap[data-dss-hn]:hover .honor-text-svg { visibility: hidden !important; }
            html.dss-hn-hover .honor-text-wrap[data-dss-hn]:hover .dss-hn-label { display: block; }

            /* Honor colours — classes confirmed from Torn's markup:
               regular players: blue; staff: admin, officer, moderator, helper
               (Developers also use "admin"). */
            html.dss-hn-colour .honor-text-wrap.blue      .dss-hn-label { color: #4a9eff; }
            html.dss-hn-colour .honor-text-wrap.admin     .dss-hn-label { color: #ff4a4a; }
            html.dss-hn-colour .honor-text-wrap.officer   .dss-hn-label { color: #3fcf3f; }
            html.dss-hn-colour .honor-text-wrap.moderator .dss-hn-label { color: #22b8f0; }
            html.dss-hn-colour .honor-text-wrap.helper    .dss-hn-label { color: #f0c419; }

            /* Own row on the war page */
            li.dss-hn-self {
                background: linear-gradient(90deg, rgba(102,126,234,0.38) 0%, rgba(102,126,234,0.12) 100%) !important;
                box-shadow: inset 4px 0 0 #667eea, inset 0 0 0 1px rgba(102,126,234,0.75) !important;
            }
            li.dss-hn-self > div { background: transparent !important; }
            li.dss-hn-self [class*="level___"],
            li.dss-hn-self [class*="points___"] { color: #fff !important; font-weight: 700; }
        `);
			applyCfg();
			function nameOf(wrap) {
				const plain = Array.from(wrap.querySelectorAll(".honor-text")).find((s) => !s.classList.contains("honor-text-svg"));
				let n = plain ? plain.textContent.trim() : "";
				if (!n) {
					const chars = wrap.querySelectorAll(".honor-text-svg [data-char]");
					if (chars.length) n = Array.from(chars).map((c) => c.getAttribute("data-char")).join("");
				}
				if (!n) n = (wrap.querySelector("img")?.alt || "").trim();
				if (!n) {
					const lbl = wrap.closest("a[aria-label]")?.getAttribute("aria-label") || "";
					const m = lbl.match(/^View profile of (.+)$/);
					if (m) n = m[1].trim();
				}
				return n;
			}
			function measureInset(wrap) {
				const link = wrap.closest("a") || wrap;
				const host = wrap.closest("[class*=\"honorWrap\"]") || link.parentElement;
				if (!host) return 0;
				const wr = wrap.getBoundingClientRect();
				if (!wr.width) return null;
				let inset = 0;
				host.querySelectorAll("*").forEach((el) => {
					if (link.contains(el)) return;
					const r = el.getBoundingClientRect();
					if (!r.width || !r.height) return;
					if (r.right <= wr.left || r.left >= wr.left + wr.width * .5) return;
					if (r.bottom <= wr.top || r.top >= wr.bottom) return;
					inset = Math.max(inset, r.right - wr.left);
				});
				return Math.min(Math.round(inset), Math.round(wr.width * .6));
			}
			function processWraps() {
				const wraps = Array.from(document.querySelectorAll(".honor-text-wrap"));
				wraps.forEach((wrap) => {
					const n = nameOf(wrap);
					if (!n) return;
					let label = wrap.querySelector(":scope > .dss-hn-label");
					if (!label) {
						label = document.createElement("span");
						label.className = "dss-hn-label";
						wrap.appendChild(label);
						wrap.dataset.dssHn = "1";
					}
					if (label.textContent !== n) label.textContent = n;
				});
				const insets = wraps.map((w) => w.dataset.dssHn ? measureInset(w) : null);
				wraps.forEach((wrap, i) => {
					const inset = insets[i];
					if (inset == null) return;
					if (wrap.dataset.dssHnLeft !== String(inset)) {
						wrap.dataset.dssHnLeft = String(inset);
						if (inset > 0) wrap.style.setProperty("--dss-hn-left", inset + "px");
						else wrap.style.removeProperty("--dss-hn-left");
					}
				});
			}
			function getMyId() {
				const key = Object.keys(sessionStorage).find((k) => /sidebarData\d+/.test(k));
				if (key) {
					try {
						const id = JSON.parse(sessionStorage.getItem(key))?.user?.userID;
						if (id) {
							GM_setValue(MYID_KEY, String(id));
							return String(id);
						}
					} catch (_) {}
				}
				return GM_getValue(MYID_KEY, "") || null;
			}
			function isWarPage() {
				return location.pathname === "/factions.php" && /#\/war\//.test(location.hash);
			}
			function highlightSelf() {
				const active = cfg.highlightSelf && isWarPage();
				const me = active ? getMyId() : null;
				const wanted = new Set();
				if (me) {
					document.querySelectorAll("li [class*=\"honorWrap\"] a[href*=\"XID=\"]").forEach((a) => {
						const m = (a.getAttribute("href") || "").match(/XID=(\d+)/);
						if (m && m[1] === me) {
							const li = a.closest("li");
							if (li) wanted.add(li);
						}
					});
				}
				document.querySelectorAll("li.dss-hn-self").forEach((li) => {
					if (!wanted.has(li)) li.classList.remove("dss-hn-self");
				});
				wanted.forEach((li) => li.classList.add("dss-hn-self"));
			}
			let pending = null;
			function schedule() {
				if (pending) return;
				pending = setTimeout(() => {
					pending = null;
					processWraps();
					highlightSelf();
				}, 150);
			}
			new MutationObserver(schedule).observe(document.body, {
				childList: true,
				subtree: true
			});
			window.addEventListener("hashchange", () => {
				applyCfg();
				schedule();
			});
			processWraps();
			highlightSelf();
			function wireGuideControls() {
				const modeSel = document.getElementById("dss-hn-mode");
				const scale = document.getElementById("dss-hn-scale");
				const scaleVal = document.getElementById("dss-hn-scale-val");
				const bg = document.getElementById("dss-hn-bg");
				const bgVal = document.getElementById("dss-hn-bg-val");
				const colour = document.getElementById("dss-hn-colour");
				const self = document.getElementById("dss-hn-self");
				const war = document.getElementById("dss-hn-war");
				const status = document.getElementById("dss-hn-status");
				if (!modeSel || modeSel.dataset.wired) return;
				modeSel.dataset.wired = "1";
				modeSel.value = cfg.mode;
				scale.value = cfg.scale;
				scaleVal.textContent = cfg.scale + "%";
				bg.value = cfg.bg;
				bgVal.textContent = cfg.bg + "%";
				colour.checked = !!cfg.colour;
				self.checked = !!cfg.highlightSelf;
				war.checked = cfg.warNames !== false;
				const commit = () => {
					cfg = {
						mode: modeSel.value,
						scale: parseInt(scale.value, 10),
						bg: parseInt(bg.value, 10),
						colour: colour.checked,
						highlightSelf: self.checked,
						warNames: war.checked
					};
					scaleVal.textContent = cfg.scale + "%";
					bgVal.textContent = cfg.bg + "%";
					saveCfg(cfg);
					applyCfg();
					highlightSelf();
					if (status) status.textContent = "✅ Saved";
				};
				[
					modeSel,
					colour,
					self,
					war
				].forEach((el) => el.addEventListener("change", commit));
				[scale, bg].forEach((el) => el.addEventListener("input", commit));
			}
			UI.wireGuideField("dss-hn-mode", wireGuideControls);
		}
	});

// src/modules/custom-background/guide.html?raw
	var guide_default$1 = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Background Image URL</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Enter the direct URL to your background image. Use <a href=\"https://catbox.moe/\" target=\"_blank\" style=\"color:var(--link-color,#60a5fa);\">Catbox.moe</a> or <a href=\"https://imgur.com/\" target=\"_blank\" style=\"color:var(--link-color,#60a5fa);\">Imgur</a> for best quality.</p>\n                <div style=\"display:flex;gap:8px;margin-top:10px;\">\n                    <input type=\"text\" id=\"dss-bg-url-input\" placeholder=\"https://i.imgur.com/yourimage.jpeg\"\n                        style=\"flex:1;padding:8px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#ccc;font-size:12px;font-family:monospace;outline:none;\" />\n                    <button id=\"dss-bg-url-save\" style=\"padding:8px 16px;background:rgba(76,175,80,0.2);border:1px solid rgba(76,175,80,0.4);border-radius:4px;color:#4caf50;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;\">Save</button>\n                    <button id=\"dss-bg-url-clear\" style=\"padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:4px;color:#ef4444;font-size:12px;cursor:pointer;white-space:nowrap;\">Clear</button>\n                </div>\n                <div id=\"dss-bg-url-status\" style=\"margin-top:6px;font-size:11px;min-height:16px;\"></div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">How It Works</div>\n            <div class=\"dss-guide-card-body\">\n                <p>The image is applied as a full-screen fixed background with <strong>cover</strong> sizing. Torn's default background elements are hidden.</p>\n                <p>A <strong>blur overlay</strong> is applied over the content column so text remains readable against the image.</p>\n                <p>The overlay scales automatically with browser zoom level.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Notes</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Changes take effect on the next page load after saving. To remove the background, click <strong>Clear</strong> and reload.</p>\n                <p>For best results, use a high-resolution image (1920x1080 or larger).</p>\n            </div>\n        </div>\n    ";

// src/modules/custom-background/index.js
	registerModule("custom-background", {
		name: "Custom Background",
		version: "1.0",
		pdaHidden: true,
		description: "Set a custom background image for Torn.com with a blur overlay on the content area.",
		pages: ["https://www.torn.com/"],
		guide: guide_default$1,
		init() {
			if (IS_PDA) return;
			const BG_STORAGE_KEY = "dss_custom_bg_url";
			const imageUrl = GM_getValue(BG_STORAGE_KEY, "");
			function wireGuideControls() {
				const input = document.getElementById("dss-bg-url-input");
				const saveBtn = document.getElementById("dss-bg-url-save");
				const clearBtn = document.getElementById("dss-bg-url-clear");
				const status = document.getElementById("dss-bg-url-status");
				if (!input || !saveBtn) return;
				input.value = GM_getValue(BG_STORAGE_KEY, "");
				saveBtn.addEventListener("click", () => {
					const val = input.value.trim();
					if (!val) {
						if (status) {
							status.textContent = "⚠ Please enter a URL";
							status.style.color = "#ef4444";
						}
						return;
					}
					if (status) {
						status.textContent = "Checking image…";
						status.style.color = "#999";
					}
					const probe = new Image();
					probe.onload = () => {
						GM_setValue(BG_STORAGE_KEY, val);
						if (status) {
							status.textContent = "✅ Saved — reload any page to apply";
							status.style.color = "#4caf50";
						}
					};
					probe.onerror = () => {
						if (status) {
							status.textContent = "⚠ Couldn’t load that as an image — use a direct link (e.g. https://i.imgur.com/abc123.jpg)";
							status.style.color = "#ef4444";
						}
					};
					probe.src = val;
				});
				clearBtn.addEventListener("click", () => {
					GM_setValue(BG_STORAGE_KEY, "");
					input.value = "";
					if (status) {
						status.textContent = "✅ Cleared — reload to remove background";
						status.style.color = "#4caf50";
					}
				});
				input.addEventListener("keydown", (e) => {
					e.stopPropagation();
					if (e.key === "Enter") saveBtn.click();
				});
			}
			UI.wireGuideField("dss-bg-url-input", wireGuideControls);
			if (!imageUrl || IS_PDA) return;
			const cls = (p) => `:is([class^="${p}___"], [class*=" ${p}___"])`;
			const effectRoot = cls("effectRoot");
			const cssUrl = JSON.stringify(imageUrl);
			const style = document.createElement("style");
			style.id = "dss-custom-bg-style";
			style.textContent = `
            /* Torn's effectRoot layer paints an opaque background over body — clear it. */
            ${effectRoot},
            ${effectRoot}::before,
            ${effectRoot}::after {
                background: transparent !important;
            }
            body {
                background-image: url(${cssUrl}) !important;
                background-size: cover !important;
                background-position: center center !important;
                background-repeat: no-repeat !important;
                background-attachment: fixed !important;
            }
            .d .backdrops-container {
                background: transparent !important;
            }
            .d .backdrops-container .custom-bg-desktop,
            .d .backdrops-container .custom-bg-mobile {
                background: transparent !important;
            }
            .d .backdrops-container::after {
                content: '' !important;
                position: fixed !important;
                top: 0 !important;
                left: 50% !important;
                transform: translateX(-50%) scaleX(var(--zoom-scale, 1)) !important;
                transform-origin: center top !important;
                width: 44% !important;
                height: 100vh !important;
                background: rgba(0.5, 0, 0, 0.5) !important;
                backdrop-filter: blur(8px) !important;
                -webkit-backdrop-filter: blur(8px) !important;
                pointer-events: none !important;
                z-index: 1 !important;
            }
        `;
			(document.head || document.documentElement).appendChild(style);
			const baselineWidth = 2048;
			const baselineZoom = .9;
			const referenceWidth = baselineWidth / baselineZoom;
			let lastWidth = null;
			function updateZoomScale() {
				const currentWidth = window.innerWidth;
				if (currentWidth !== lastWidth) {
					const zoomLevel = referenceWidth / currentWidth;
					document.body.style.setProperty("--zoom-scale", zoomLevel);
					lastWidth = currentWidth;
				}
			}
			window.addEventListener("resize", updateZoomScale);
			updateZoomScale();
		}
	});

// src/modules/medx-revive/guide.html?raw
	var guide_default = "\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">What It Does</div>\n            <div class=\"dss-guide-card-body\">\n                <p><strong>Desktop:</strong> while you're in hospital, a red <strong>MEDX REVIVE ME</strong> button appears under your life bar in the sidebar, and a green link is added to the top page links next to NITE, on every page. On a hospitalised player's profile the link reads <strong>MEDX Revive Player</strong> and requests a revive for that player instead.</p>\n                <p><strong>Phone / Torn PDA:</strong> a round red button floats in the bottom-right corner while you're in hospital, or while you're viewing a hospitalised player's profile.</p>\n                <p>One press sends the request. The button turns grey while sending and green for 10 seconds once Med X accepts it, so a double tap can't send twice.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Layout</div>\n            <div class=\"dss-guide-card-body\">\n                <p>The layout is picked automatically from your device. If it guesses wrong (for example on a tablet or a touchscreen laptop), set it here.</p>\n                <div style=\"display:flex;align-items:center;gap:8px;margin-top:10px;\">\n                    <span style=\"color:#777;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;width:60px;\">Layout</span>\n                    <select id=\"dss-medx-layout\" style=\"padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#ccc;font-size:12px;\">\n                        <option value=\"auto\">Auto</option>\n                        <option value=\"desktop\">Desktop (life bar button)</option>\n                        <option value=\"phone\">Phone (floating button)</option>\n                    </select>\n                </div>\n                <div id=\"dss-medx-layout-status\" style=\"font-size:11px;color:#4caf50;min-height:14px;margin-top:6px;\"></div>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Payment</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Revives cost <strong>2 Xanax or $1.8m per attempt</strong>, paid to your reviver.</p>\n            </div>\n        </div>\n        <div class=\"dss-guide-card\">\n            <div class=\"dss-guide-card-header\">Third-Party Data Sharing</div>\n            <div class=\"dss-guide-card-body\">\n                <p>Each request sends the API key from your DSS Setup page, your <strong>Torn ID</strong> and <strong>username</strong>, and the ID of the player to revive to <strong>medx.fun</strong>, the Med X revive service. Nothing is sent until you press a Revive button, and nothing is sent at all while this module is disabled.</p>\n            </div>\n        </div>\n    ";

// src/modules/medx-revive/index.js
	registerModule("medx-revive", {
		name: "Med X Revive",
		version: "1.3.0",
		description: "Request a revive from Med X: a MEDX REVIVE ME button under your life bar and in the top page links (desktop) or a floating button (phone) while you are in hospital, plus a revive link on hospitalised players' profiles.",
		pages: ["https://www.torn.com/"],
		guide: guide_default,
		init() {
			if (document.querySelector(".iAmUnderAttack, #cf-bubbles, iframe[src*=\"challenges.cloudflare\"]")) return;
			[
				"medx-btn",
				"medx-bar-btn",
				"medx-toast"
			].forEach((id) => document.getElementById(id)?.remove());
			const API_URL = "https://medx.fun/revive/request/";
			const LAYOUT_KEY = "dss_medx_layout";
			const path = location.pathname;
			const PHONE_BOTTOM_OFFSET_PX = 56;
			const SENT_STATE_MS = 1e4;
			const ERROR_STATE_MS = 4e3;
			const SELF_LABEL = "MEDX REVIVE ME";
			const OTHER_LABEL = "MEDX Revive Player";
			const LINK_GREEN = "#61be3b";
			const LINK_GREEN_HOVER = "#7fd65a";
			const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20"><path fill="none" class="medx-icon" d="M18.737,9.691h-5.462c-0.279,0-0.527,0.174-0.619,0.437l-1.444,4.104L8.984,3.195c-0.059-0.29-0.307-0.506-0.603-0.523C8.09,2.657,7.814,2.838,7.721,3.12L5.568,9.668H1.244c-0.36,0-0.655,0.291-0.655,0.655c0,0.36,0.294,0.655,0.655,0.655h4.8c0.281,0,0.532-0.182,0.621-0.45l1.526-4.645l2.207,10.938c0.059,0.289,0.304,0.502,0.595,0.524c0.016,0,0.031,0,0.046,0c0.276,0,0.524-0.174,0.619-0.437L13.738,11h4.999c0.363,0,0.655-0.294,0.655-0.655C19.392,9.982,19.1,9.691,18.737,9.691z"/></svg>`;
			function el(tag, props = {}, children = []) {
				const e = document.createElement(tag);
				Object.assign(e, props);
				children.forEach((c) => e.append(c));
				return e;
			}
			UI.wireGuideField("dss-medx-layout", () => {
				const sel = document.getElementById("dss-medx-layout");
				if (!sel || sel.dataset.wired) return;
				sel.dataset.wired = "1";
				sel.value = GM_getValue(LAYOUT_KEY, "auto");
				sel.addEventListener("change", () => {
					GM_setValue(LAYOUT_KEY, sel.value);
					const s = document.getElementById("dss-medx-layout-status");
					if (s) s.textContent = "✅ Saved — applies on your next page load";
				});
			});
			function detectPhone() {
				const override = GM_getValue(LAYOUT_KEY, "auto");
				if (override === "phone") return true;
				if (override === "desktop") return false;
				if (IS_PDA) return true;
				if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
				if (/iPhone|iPod|Windows Phone|Android.*Mobile/i.test(navigator.userAgent)) return true;
				const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
				return !!coarsePointer && Math.min(screen.width, screen.height) < 600;
			}
			const isPhone = detectPhone();
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
			let toastTimer;
			function showToast(message) {
				document.getElementById("medx-toast")?.remove();
				clearTimeout(toastTimer);
				const toast = el("div", {
					id: "medx-toast",
					textContent: message
				});
				toast.setAttribute("role", "status");
				document.body.append(toast);
				toastTimer = setTimeout(() => toast.remove(), 4e3);
			}
			function notify(message) {
				if (isPhone) showToast(message);
			}
			function getSessionData() {
				const key = Object.keys(sessionStorage).find((k) => /sidebarData\d+/.test(k));
				if (!key) return null;
				try {
					const data = JSON.parse(sessionStorage.getItem(key));
					return {
						userID: data.user.userID,
						userName: data.user.name,
						hospital: data.statusIcons?.icons?.hospital
					};
				} catch (_) {
					return null;
				}
			}
			function isProfileInHospital() {
				const desc = document.querySelector(".main-desc");
				return !!desc && desc.textContent.toLowerCase().includes("hospital");
			}
			function getProfilePlayerId() {
				const params = new URLSearchParams(location.search);
				return params.get("XID") || params.get("playerID") || params.get("playerId");
			}
			function httpPost(url, body) {
				const headers = { "Content-Type": "application/json" };
				if (hasGmRequest()) {
					return new Promise((resolve, reject) => {
						gmRequest({
							method: "POST",
							url,
							headers,
							data: body,
							timeout: 15e3,
							onload: resolve,
							onerror: reject,
							ontimeout: () => reject(new Error("timeout"))
						});
					});
				}
				if (typeof window.flutter_inappwebview !== "undefined") {
					return window.flutter_inappwebview.callHandler("PDA_httpPost", url, headers, body);
				}
				return Promise.reject(new Error("No cross-site request method available"));
			}
			async function submitRequest(playerId) {
				const apiKey = (Storage.getSettings().apiKey || "").trim();
				const session = getSessionData();
				const fail = (short, long) => {
					notify(long);
					return {
						ok: false,
						short,
						long
					};
				};
				if (!apiKey) return fail("NO API KEY", "No API key set. Add your Torn API key on the DSS Setup page.");
				if (!session) return fail("RELOAD THE PAGE", "Could not read your Torn session. Reload the page and try again.");
				const payload = {
					vendor: "MedX",
					tornid: parseInt(playerId, 10),
					username: session.userName,
					requestorid: parseInt(session.userID, 10),
					source: "userscript",
					type: "revive"
				};
				try {
					const res = await httpPost(API_URL + encodeURIComponent(apiKey), JSON.stringify(payload));
					const status = Number(res?.status) || 0;
					if (status === 200) {
						notify("Revive request sent to Med X");
						return {
							ok: true,
							short: "REQUEST SENT",
							long: "Revive request sent to Med X"
						};
					}
					console.warn("[DSS Med X] request failed:", status, res?.responseText);
					if (status === 400) return fail("BAD REQUEST", "Bad request: missing Torn ID or invalid data");
					if (status === 401) return fail("API KEY REJECTED", "Med X rejected your API key. Check it on the DSS Setup page.");
					if (status === 403) return fail("BANNED FROM MED X", "Forbidden: you are banned from the Med X service");
					return fail(`FAILED (${status || "?"})`, `Request failed (status ${status || "unknown"})`);
				} catch (err) {
					console.error("[DSS Med X] network error:", err);
					return fail("NETWORK ERROR", "Request failed (network error). Try again.");
				}
			}
			function addDesktopButton(playerId, label) {
				const target = document.querySelector("#top-page-links-list");
				if (!target) return;
				const btn = el("a", {
					id: "medx-btn",
					className: "custom-revive t-clear h c-pointer m-icon line-h24 right last",
					href: "#medx-revive",
					innerHTML: `<span class="icon-wrap svg-icon-wrap"><span class="link-icon-svg">${icon}</span></span><span class="medx-text">${label}</span><span class="medx-tag">MEDX</span>`
				});
				btn.dataset.playerId = String(playerId);
				if (document.body.classList.contains("dark-mode")) btn.classList.add("custom-dark-mode");
				const text = btn.querySelector(".medx-text");
				let sending = false;
				let resetTimer;
				btn.addEventListener("click", async (e) => {
					e.preventDefault();
					if (sending) return;
					sending = true;
					clearTimeout(resetTimer);
					text.textContent = "Sending…";
					const result = await submitRequest(playerId);
					text.textContent = result.ok ? "Request sent" : result.short;
					btn.title = result.long;
					resetTimer = setTimeout(() => {
						text.textContent = label;
						btn.title = "";
						sending = false;
					}, result.ok ? SENT_STATE_MS : ERROR_STATE_MS);
				});
				placeHeaderButton(btn, target);
			}
			function placeHeaderButton(btn, list) {
				const nite = list.querySelector("#custom-btn");
				if (nite) {
					if (btn.nextElementSibling !== nite) nite.insertAdjacentElement("beforebegin", btn);
				} else if (btn.parentElement !== list) {
					list.appendChild(btn);
				}
			}
			function addSendFlow(btn, playerId, text) {
				const label = el("span");
				btn.append(label);
				let resetTimer;
				function setState(state) {
					clearTimeout(resetTimer);
					btn.dataset.state = state;
					label.textContent = text[state] || "";
					btn.title = text.titles?.[state] || "";
				}
				const reset = () => setState("idle");
				btn.addEventListener("click", async (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (btn.dataset.state !== "idle") return;
					setState("sending");
					const result = await submitRequest(playerId);
					if (result.ok) {
						navigator.vibrate?.([
							30,
							50,
							30
						]);
						setState("sent");
						resetTimer = setTimeout(reset, SENT_STATE_MS);
					} else {
						btn.dataset.state = "error";
						label.textContent = text.error ?? result.short;
						btn.title = result.long;
						resetTimer = setTimeout(reset, ERROR_STATE_MS);
					}
				});
				reset();
			}
			function addPhoneButton(playerId) {
				const btn = el("button", {
					id: "medx-btn",
					className: "medx-fab",
					type: "button",
					innerHTML: icon
				});
				btn.dataset.playerId = String(playerId);
				btn.setAttribute("aria-label", "Request a Med X revive");
				addSendFlow(btn, playerId, {
					idle: "MEDX",
					sending: "MEDX",
					sent: "SENT",
					error: "MEDX",
					titles: {
						idle: "Request a Med X revive",
						sending: "Sending request",
						sent: "Revive requested"
					}
				});
				document.body.append(btn);
			}
			function findLifeBar() {
				return document.querySelector("[class*=\"bar___\"][class*=\"life___\"][class*=\"barDesktop___\"]");
			}
			function showLifeBarButton(playerId) {
				const bar = findLifeBar();
				let btn = document.getElementById("medx-bar-btn");
				if (!bar) {
					btn?.remove();
					return;
				}
				if (!btn) {
					btn = el("button", {
						id: "medx-bar-btn",
						type: "button",
						innerHTML: icon
					});
					btn.setAttribute("aria-label", "Request a Med X revive");
					addSendFlow(btn, playerId, {
						idle: SELF_LABEL,
						sending: "SENDING…",
						sent: "REQUEST SENT",
						titles: {
							idle: "Request a Med X revive",
							sending: "Sending request",
							sent: "Revive requested"
						}
					});
				}
				if (bar.nextElementSibling !== btn) bar.insertAdjacentElement("afterend", btn);
			}
			function removeLifeBarButton() {
				document.getElementById("medx-bar-btn")?.remove();
			}
			function getPhoneTarget(session) {
				if (path.includes("profiles.php") && isProfileInHospital()) {
					const profileId = getProfilePlayerId();
					if (profileId) return profileId;
				}
				return session?.hospital ? session.userID : null;
			}
			function updatePhoneButton(playerId) {
				const btn = document.getElementById("medx-btn");
				if (!playerId) return btn?.remove();
				if (btn && btn.dataset.playerId === String(playerId)) return;
				btn?.remove();
				addPhoneButton(playerId);
			}
			function showReviveButton(playerId, label) {
				const btn = document.getElementById("medx-btn");
				const list = document.querySelector("#top-page-links-list");
				if (btn && list && btn.dataset.playerId === String(playerId) && list.contains(btn)) {
					placeHeaderButton(btn, list);
					return;
				}
				btn?.remove();
				addDesktopButton(playerId, label);
			}
			function updateHeaderTag() {
				const btn = document.getElementById("medx-btn");
				const text = btn?.querySelector(".medx-text");
				if (!text) return;
				const cs = getComputedStyle(text);
				const hidden = cs.display === "none" || cs.visibility === "hidden" || text.getBoundingClientRect().width === 0;
				btn.classList.toggle("medx-tagged", hidden);
			}
			function removeReviveButton() {
				document.getElementById("medx-btn")?.remove();
			}
			function tick() {
				if (!document.body) return;
				const session = getSessionData();
				if (isPhone) {
					updatePhoneButton(getPhoneTarget(session));
					return;
				}
				if (session?.hospital) showLifeBarButton(session.userID);
				else removeLifeBarButton();
				const target = getPhoneTarget(session);
				if (target) {
					showReviveButton(target, String(target) === String(session?.userID) ? SELF_LABEL : OTHER_LABEL);
					updateHeaderTag();
				} else removeReviveButton();
			}
			const timer = setInterval(tick, 300);
			window.addEventListener("beforeunload", () => clearInterval(timer));
		}
	});

// src/main.js
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

})();