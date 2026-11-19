import { API_BASE, IS_PDA, tornAuth } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Faction OC Prioritiser
// ════════════════════════════════════════════════════════════════════════

registerModule('crime-prioritiser', {
name: 'Faction OC Prioritiser',
version: '1.5',
description: 'Reorder crime roles by weight priority, show weight tooltips with CPR requirements, display overall success chance, show completion dates on completed crimes, filter completed crimes by date, restrict join buttons for specific factions, optionally highlight members below a role\'s minimum CPR, and reorder the Recruiting panel by pause priority (paused first, then soonest-to-pause).',
pages: ['/factions.php', '/organizedcrimes.php', '/city.php'],
guide,
init() {

            // ── Low CPR highlight setting (wired on the DSS guide page) ────────
    // Guide pages render on city.php, so the module also loads there purely
    // to wire this checkbox, then bails before any crimes-page work/fetches.
    const LOWCPR_KEY = 'dss_oc_lowcpr_highlight';
    const lowCprEnabled = GM_getValue(LOWCPR_KEY, '0') === '1';

    function wireLowCprToggle() {
        const cb = document.getElementById('dss-oc-lowcpr-toggle');
        if (!cb || cb.dataset.wired) return;
        cb.dataset.wired = '1';
        cb.checked = GM_getValue(LOWCPR_KEY, '0') === '1';
        const status = document.getElementById('dss-oc-lowcpr-status');
        cb.addEventListener('change', () => {
            GM_setValue(LOWCPR_KEY, cb.checked ? '1' : '0');
            if (status) {
                status.textContent = (cb.checked ? '\u2705 Enabled' : 'Disabled') + ' \u2014 reload the crimes page to apply';
                status.style.color = cb.checked ? '#4caf50' : '#999';
            }
        });
    }

    if (!/\/(factions|organizedcrimes)\.php/.test(window.location.pathname)) {
        // Guide can be re-rendered by sidebar tab switches without a hash
        // change, so poll cheaply; the dataset guard stops double-wiring.
        setInterval(wireLowCprToggle, 1000);
        return;
    }

    const DEBUG = false;

    // Torn's CSS-module class names carry a build hash (e.g. scenario___H5WJU)
    // that changes on redeploys. Match on the stable prefix only.
    const cls = (p) => `:is([class^="${p}___"], [class*=" ${p}___"])`;
    const S = {
        scenario: cls('scenario'), wrapper: cls('wrapper'), panelTitle: cls('panelTitle'),
        contentLayer: cls('contentLayer'), successChance: cls('successChance'), joinButton: cls('joinButton'),
        tabName: cls('tabName'), title: cls('title'), panelBody: cls('panelBody'), chainLink: cls('chainLink'),
    };

    // Role slots: the nearest wrapper___* above each successChance___* that
    // also holds a title___* (the role name). Several unrelated wrapper___
    // classes exist on the page, so slots are found structurally.
    function getSlots(root) {
        if (!root || !root.querySelectorAll) return [];
        const out = [];
        root.querySelectorAll(S.successChance).forEach(sc => {
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

    // Faction IDs where join button restrictions apply
    const RESTRICTED_FACTION_IDS = ['9528', '29107', '9357','18560'];

    // Faction where unpaid-slot markers are shown (CSV-driven).
    const UNPAID_FACTION_ID = '9357';

    function useBannerDate() {
        return IS_PDA || window.innerWidth <= 768;
    }

    let weightData = {};
    let scenarioData = {};
    let weightDataLoaded = false;
    let currentFactionId = null;

    function log(...args) {
        if (DEBUG) console.log('[DSS Crime Prioritiser]', ...args);
    }

    function logError(...args) {
        console.error('[DSS Crime Prioritiser]', ...args);
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
        const lines = csvData.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            if (parts.length < 3) continue;
            const crimeName = parts[0].trim();
            const roleName = parts[1].trim();
            const minCpr = parts[2].trim().toUpperCase();
            if (!crimePriorities[crimeName]) {
                crimePriorities[crimeName] = {};
            }
            const isUnpaid = minCpr === 'UNPAID';
            crimePriorities[crimeName][roleName] = {
                minCpr: (minCpr === 'OPEN' || isUnpaid) ? null : parseInt(minCpr),
                unpaid: isUnpaid
            };
        }
    }

    function normalize(str) {
        return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function normalizeRoleName(name) {
        return name.replace(/\s*#\d+$/, '').trim();
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
        if (normalizedPriority <= 0.5) {
            const t = normalizedPriority * 2;
            const r = 139 + (255 - 139) * t;
            const g = 0 + (165 - 0) * t;
            const b = 0;
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${b})`;
        } else {
            const t = (normalizedPriority - 0.5) * 2;
            const r = 255 + (144 - 255) * t;
            const g = 165 + (238 - 165) * t;
            const b = 0 + (144 - 0) * t;
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        }
    }

    // ── Detect current faction ID ──────────────────────────────────────
    function detectFactionId() {
        // Method 1: URL hash parameter
        const hashMatch = window.location.hash.match(/factionID=(\d+)/i);
        if (hashMatch) {
            currentFactionId = hashMatch[1];
            log('Faction ID from URL hash:', currentFactionId);
            return;
        }

        // Method 2: React fiber on faction info elements
        try {
            const factionEl = document.querySelector('[class*="faction-info"], [class*="factionName"]');
            if (factionEl) {
                const fiberKey = Object.keys(factionEl).find(k => k.startsWith('__reactFiber$'));
                if (fiberKey) {
                    const fiber = factionEl[fiberKey];
                    // Walk up fiber tree looking for faction ID in props
                    let node = fiber;
                    for (let i = 0; i < 20 && node; i++) {
                        if (node.memoizedProps?.factionId) {
                            currentFactionId = String(node.memoizedProps.factionId);
                            log('Faction ID from React fiber:', currentFactionId);
                            return;
                        }
                        node = node.return;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Method 3: Sidebar faction link
        const factionLink = document.querySelector('a[href*="factions.php?step=profile&ID="]');
        if (factionLink) {
            const linkMatch = factionLink.href.match(/ID=(\d+)/);
            if (linkMatch) {
                currentFactionId = linkMatch[1];
                log('Faction ID from sidebar link:', currentFactionId);
                return;
            }
        }

        // Method 4: XHR intercept - check page source for faction ID patterns
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
            const match = script.textContent.match(/factionID["\s:=]+(\d+)/);
            if (match) {
                currentFactionId = match[1];
                log('Faction ID from inline script:', currentFactionId);
                return;
            }
        }

        // Method 5: Use Torn API via stored API key if available
        // (Deferred — will try on first processCrimes call if still null)
        log('Could not detect faction ID from DOM');
    }

    function isRestrictedFaction() {
        return currentFactionId && RESTRICTED_FACTION_IDS.includes(currentFactionId);
    }

    function showUnpaidMarkers() {
        return currentFactionId === UNPAID_FACTION_ID;
    }

    // If faction ID not found from DOM, try the Torn API
    async function detectFactionIdFromAPI() {
        if (currentFactionId) return;

        const apiKey = Storage.getSettings().apiKey;
        if (!apiKey) {
            log('No API key available for faction ID lookup');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/user/faction`, { headers: tornAuth(apiKey) });
            const data = await response.json();
            if (data?.error) { logError('Faction ID API error:', data.error); return; }
            if (data?.faction?.id != null) {
                currentFactionId = String(data.faction.id);
                log('Faction ID from API:', currentFactionId);
            } else {
                log('No faction.id in API response', data);
            }
        } catch (e) {
            logError('Failed to fetch faction ID from API:', e);
        }
    }

    // ── Tooltip setup ──────────────────────────────────────────────────
    function addTooltipStyles() {
        const style = document.createElement('style');
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

        const tooltip = document.createElement('div');
        tooltip.id = 'dss-tooltip';
        document.body.appendChild(tooltip);

        // Desktop hover
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.crime-priority-tooltip');
            if (target) {
                const text = target.getAttribute('data-priority');
                if (text) {
                    tooltip.textContent = text;
                    tooltip.style.display = 'block';
                }
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (tooltip.style.display === 'block') {
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
                tooltip.style.left = left + 'px';
                tooltip.style.top = top + 'px';
            }
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('.crime-priority-tooltip');
            if (target) tooltip.style.display = 'none';
        });

        // Mobile touch
        document.addEventListener('touchstart', (e) => {
            const target = e.target.closest('.crime-priority-tooltip');
            if (target) {
                const text = target.getAttribute('data-priority');
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
                            let left = touchX - (tw / 2);
                            let top = touchY - th - 16;
                            if (left + tw > viewportWidth - 8) left = viewportWidth - tw - 8;
                            left = Math.max(8, left);
                            if (top < 8) top = touchY + 16;
                            tooltip.style.left = left + 'px';
                            tooltip.style.top = top + 'px';
                        });
                    });
                    e.stopPropagation();
                }
            } else {
                tooltip.style.left = '-9999px';
                tooltip.style.top = '-9999px';
            }
        }, { passive: false });

        document.addEventListener('touchmove', () => {
            tooltip.style.left = '-9999px';
            tooltip.style.top = '-9999px';
        }, { passive: true });
    }

    // ── Role helpers ───────────────────────────────────────────────────
    function getRoleCPR(roleSlot) {
        const cprElement = roleSlot.querySelector(`${S.successChance}`);
        return cprElement ? parseInt(cprElement.textContent.trim()) : null;
    }

    function checkRequirements(priorityInfo, userCpr) {
        if (priorityInfo.minCpr !== null) {
            if (userCpr === null) return { allowed: true, reason: null };
            if (userCpr < priorityInfo.minCpr) {
                return { allowed: false, reason: `CPR Too Low (Req: ${priorityInfo.minCpr})` };
            }
        }
        return { allowed: true, reason: null };
    }

    // Another script (TornTools) can highlight a crime green; grey weight
    // text washes out on it. Read the slot's actual rendered background
    // (and a few ancestors) so this works whichever class/style they use.
    function isGreenBg(colorStr) {
        const m = (colorStr || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return false;
        const p = m[1].split(',').map(s => parseFloat(s.trim()));
        const r = p[0], g = p[1], b = p[2], a = p.length > 3 ? p[3] : 1;
        if (!a) return false;                        // fully transparent
        return g > 60 && g > r + 25 && g > b + 25;   // green channel dominant
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
        const existingLabel = roleSlot.querySelector('.role-priority-label');
        if (existingLabel) existingLabel.remove();
        const label = document.createElement('div');
        label.className = 'role-priority-label' + (onGreen ? ' role-label-on-green' : '');
        label.textContent = `Weight: ${weight.toFixed(1)}%`;
        roleSlot.insertBefore(label, roleSlot.firstChild);
    }

    // UNPAID marker appended in-flow at the bottom of the slot, so it's
    // always contained within the slot (and thus the crime's box). It only
    // adds height at the bottom, leaving the label/role rows above aligned.
    // Idempotent: adds or removes to match `unpaid`, and keeps itself last.
    function setUnpaidTag(roleSlot, unpaid) {
        let tag = roleSlot.querySelector('.role-unpaid-tag');
        if (!unpaid) { if (tag) tag.remove(); return; }
        if (!tag) {
            tag = document.createElement('div');
            tag.className = 'role-unpaid-tag';
            tag.textContent = 'UNPAID';
        }
        if (roleSlot.lastElementChild !== tag) roleSlot.appendChild(tag);
    }

    // Low-CPR marker: red ring + in-flow bottom strip. Idempotent — pass
    // null to clear. Kept last in the slot, same as the UNPAID tag.
    function setLowCprTag(roleSlot, info) {
        let tag = roleSlot.querySelector('.role-lowcpr-tag');
        if (!info) {
            if (tag) tag.remove();
            roleSlot.classList.remove('role-lowcpr-slot');
            return;
        }
        roleSlot.classList.add('role-lowcpr-slot');
        if (!tag) {
            tag = document.createElement('div');
            tag.className = 'role-lowcpr-tag';
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

    // ── API helpers ────────────────────────────────────────────────────
    async function callOCAPI(endpoint, data = null, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error('Timeout')), timeout);
            GM.xmlHttpRequest({
                method: data ? 'POST' : 'GET',
                url: `${API_BASE_URL}/${endpoint}`,
                headers: data ? { 'Content-Type': 'application/json' } : {},
                data: data ? JSON.stringify(data) : null,
                onload: (response) => {
                    if (!response) return; // PDA fires onload with undefined before real response
                    clearTimeout(timeoutId);
                    try {
                        const text = response?.responseText || response?.response || (typeof response === 'string' ? response : '');
                        const result = JSON.parse(text);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(result);
                        } else {
                            reject(new Error(result.error || 'API error'));
                        }
                    } catch (err) { reject(err); }
                },
                 onerror: (err) => { clearTimeout(timeoutId); reject(new Error(err?.statusText || err?.message || 'XHR failed')); }
            });
        });
    }

    async function fetchScenarioData() {
        try {
            const [supportedScenarios, roleMappings] = await Promise.all([
                callOCAPI('api/GetSupportedScenarios'),
                callOCAPI('api/GetRoleNames')
            ]);
            scenarioData = supportedScenarios.reduce((acc, scenario) => {
                const roles = roleMappings[scenario.name];
                if (roles) {
                    acc[scenario.name] = {
                        paramCount: scenario.parameters,
                        paramOrder: Object.keys(roles)
                            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                            .slice(0, scenario.parameters)
                    };
                }
                return acc;
            }, {});
            log('Loaded scenario data');
        } catch (error) {
            logError('Failed to initialize scenario data:', error);
        }
    }

    let successChanceTimeoutLogged = false;

    async function processOCSuccessChance(element) {
        try {
            const ocName = element.querySelector(`${S.panelTitle}`)?.textContent?.trim();
            const scenario = scenarioData[ocName];
            if (!scenario) return;

            // Mirror the same rolesWrapper logic from processCrimes
            let rolesWrapper = null;
            const isCompletedContainer = element.hasAttribute('data-oc-id');

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

            const parameters = scenario.paramOrder.map(slotKey => {
                const slot = slots.find(s => {
                    const fiberKey = Object.keys(s).find(k => k.startsWith('__reactFiber$'));
                    const fiberNode = s[fiberKey];
                    return fiberNode?.return?.key === `slot-${slotKey}`;
                });
                const chanceText = slot?.querySelector(`${S.successChance}`)?.textContent;
                return chanceText ? parseFloat(chanceText.replace('%', '')) : 0;
            });

            if (parameters.length !== scenario.paramCount) return;

            const result = await callOCAPI('api/CalculateSuccess', {
                scenario: ocName,
                parameters
            });

            if (result?.successChance) {
                injectSuccessChance(element, result.successChance);
            }
        } catch (error) {
            if (error.message === 'Timeout' && !successChanceTimeoutLogged) {
                logError('OC success chance API timing out - silencing further timeout errors');
                successChanceTimeoutLogged = true;
            } else if (error.message !== 'Timeout') {
                logError('OC success chance processing failed:', error);
            }
        }
    }

    function injectSuccessChance(element, chance) {
        const chainLinkButton = element.querySelector(`${S.chainLink}`);
        if (!chainLinkButton) return;

        const existingDisplay = element.querySelector('.oc-success-display');
        if (existingDisplay) existingDisplay.remove();

        const display = document.createElement('div');
        display.className = 'oc-success-display';
        const percentage = Math.floor(chance * 100);
        display.textContent = `Success: ${percentage}%`;

        let bgColor, borderColor, textColor;
        if (percentage >= 90) {
            bgColor = 'rgba(76, 175, 80, 0.1)'; borderColor = '#4caf50'; textColor = '#4caf50';
        } else if (percentage >= 75) {
            bgColor = 'rgba(139, 195, 74, 0.1)'; borderColor = '#8bc34a'; textColor = '#8bc34a';
        } else if (percentage >= 60) {
            bgColor = 'rgba(255, 193, 7, 0.1)'; borderColor = '#ffc107'; textColor = '#ffc107';
        } else if (percentage >= 40) {
            bgColor = 'rgba(255, 152, 0, 0.1)'; borderColor = '#ff9800'; textColor = '#ff9800';
        } else {
            bgColor = 'rgba(244, 67, 54, 0.1)'; borderColor = '#f44336'; textColor = '#f44336';
        }

        display.style.background = bgColor;
        display.style.borderLeftColor = borderColor;
        display.style.color = textColor;
        chainLinkButton.parentNode.insertBefore(display, chainLinkButton);
    }

    // ── Recruiting-panel reorder (paused → imminent-pause → recruiting → later-pause) ──
    //
    // Pause model (per user): a crime pauses once its planning time budget is
    // spent. Budget = filledSlots × 24h; total execution time = totalSlots × 24h.
    // The countdown shown is time-to-execute (remaining), so:
    //     elapsed      = totalSlots × 24h − remaining
    //     pause when     elapsed = filledSlots × 24h
    //     timeToPause  = remaining − emptySlots × 24h
    // Slots plan sequentially but which positions are filled does not matter.
    const HOUR = 3600;
    const SLOT_HOURS = 24;

    // ── Recruiting-panel priority tuning ───────────────────────────────
    // Actively-recruiting crimes (no execution countdown yet) are treated as
    // the HIGHEST priority so members get funnelled into filling them — UNLESS
    // another crime is due to pause within this window, in which case that
    // soon-to-pause crime jumps above the recruiting ones. Tweak this number
    // to widen or narrow the window (hours): e.g. 12 = only pauses inside 12h
    // outrank recruiting; 48 = a wider net. Paused crimes always stay on top.
    const RECRUITING_PRIORITY_PAUSE_WINDOW_HOURS = 24;

    function isOnRecruitingTab() {
        if (!window.location.hash.includes('tab=crimes') && !window.location.pathname.includes('organizedcrimes')) return false;
        let recruitingActive = false, anyActive = false;
        document.querySelectorAll(`${S.tabName}`).forEach(btn => {
            const text = (btn.textContent || '').trim().toLowerCase();
            const parent = btn.parentElement;
            const pc = parent?.className || '';
            const active = pc.includes('active') || parent?.getAttribute('aria-selected') === 'true' || parent?.classList.contains('ui-state-active');
            if (active) anyActive = true;
            if (active && text.includes('recruit')) recruitingActive = true;
            if (active && text.includes('completed')) recruitingActive = false;
        });
        if (recruitingActive) return true;
        // A different tab is the active one → definitely not recruiting.
        if (anyActive) return false;
        // Tab-button classes didn't resolve. Use a content signal that separates
        // Recruiting from Planning: recruiting crimes always have open JOIN slots,
        // planning crimes are fully staffed. This keeps the reorder OFF the
        // planning tab, where moving nodes would clobber other scripts' styling.
        const cl = document.querySelector(`${S.contentLayer}`);
        const hasScenario = cl && cl.querySelector(`${S.scenario}`);
        const hasCompleted = document.querySelector(`${S.wrapper}[data-oc-id]`);
        const hasOpenSlot = cl && cl.querySelector(`${S.joinButton}, [class*="waitingJoin___"], [class*="joinContainer___"]`);
        return !!(hasScenario && hasOpenSlot && !hasCompleted);
    }

    function isCrimePaused(scenario) {
        const region = scenario.querySelector('[class*="phase___"]') || scenario.firstElementChild || scenario;
        for (const el of region.querySelectorAll('[aria-label]')) {
            if (/^\s*paused\s*$/i.test(el.getAttribute('aria-label') || '')) return true;
        }
        for (const el of scenario.querySelectorAll('span,div')) {
            const t = (el.textContent || '').trim();
            if (t.length <= 12 && /^paused$/i.test(t)) return true;   // exact-text = precise
        }
        return false;
    }

    function isEmptySlot(slot) {
        return !!slot.querySelector('[class*="joinContainer___"], [class*="joinButton___"]')
            || /waitingjoin/i.test(slot.className);
    }

    function parseAriaDuration(label) {
        let s = 0;
        const d = label.match(/(\d+)\s*day/i);    if (d) s += +d[1] * 86400;
        const h = label.match(/(\d+)\s*hour/i);   if (h) s += +h[1] * 3600;
        const m = label.match(/(\d+)\s*minute/i); if (m) s += +m[1] * 60;
        const x = label.match(/(\d+)\s*second/i); if (x) s += +x[1];
        return s;
    }

    function parseColonTime(txt) {
        const parts = txt.trim().split(':').map(Number);
        if (parts.some(isNaN)) return null;
        const r = parts.reverse();
        return (r[0] || 0) + (r[1] || 0) * 60 + (r[2] || 0) * 3600 + (r[3] || 0) * 86400;
    }

    function getRemainingSeconds(scenario) {
        const region = scenario.querySelector('[class*="phase___"]') || scenario;
        const labelled = Array.from(region.querySelectorAll('[aria-label]'))
            .find(el => /\d+\s*(day|hour|minute|second)/i.test(el.getAttribute('aria-label') || ''));
        if (labelled) { const s = parseAriaDuration(labelled.getAttribute('aria-label')); if (s > 0) return s; }
        const span = Array.from(region.querySelectorAll('span'))
            .find(el => /^\d{1,2}(:\d{2}){2,3}$/.test((el.textContent || '').trim()));
        if (span) { const s = parseColonTime(span.textContent); if (s != null) return s; }
        return null;
    }

    function humanizeDuration(secs) {
        if (secs <= 0) return 'imminent';
        const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    // A crime "unit" = the scenario panel node plus every following sibling
    // up to (not including) the next scenario. This travels as one block on
    // reorder, so the roles wrapper never gets stranded behind its panel —
    // regardless of whether roles are the immediate sibling or wrapped.
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
        // Roles wrapper = whichever unit node actually holds the slot elements.
        const roles = unit.find(n => getSlots(n).length > 0) || null;
        const slots = roles ? getSlots(roles) : [];
        const total = slots.length;
        let empty = 0; slots.forEach(s => { if (isEmptySlot(s)) empty++; });
        const paused = isCrimePaused(scenario);
        const remaining = getRemainingSeconds(scenario);
        const timeToPause = remaining == null ? null : remaining - empty * SLOT_HOURS * HOUR;
        return { scenario, roles, total, empty, filled: total - empty, paused, remaining, timeToPause };
    }

    // Priority tier for a NON-paused crime (lower = higher priority):
    //   0 = imminent   → will pause within the configured window (outranks recruiting)
    //   1 = recruiting → no execution countdown yet (top priority by default)
    //   2 = later      → will pause, but further out than the window
    function recruitingTier(item) {
        const t = item.timeToPause;
        if (t == null || !isFinite(t)) return 1;                        // recruiting
        if (t < RECRUITING_PRIORITY_PAUSE_WINDOW_HOURS * HOUR) return 0; // imminent
        return 2;                                                       // later
    }

    function crimeSortCmp(a, b) {
        if (a.paused !== b.paused) return a.paused ? -1 : 1;            // paused to top
        if (a.paused && b.paused) {
            if (a.empty !== b.empty) return a.empty - b.empty;         // fewer to fill = higher
            return (a.remaining ?? Infinity) - (b.remaining ?? Infinity);
        }

        // Non-paused ordering: imminent-pause → recruiting → later-pause.
        const ta = recruitingTier(a), tb = recruitingTier(b);
        if (ta !== tb) return ta - tb;

        if (ta === 1) {
            // Both recruiting (no countdown): fewer slots left to fill ranks
            // higher, then whatever remaining time we can read.
            if (a.empty !== b.empty) return a.empty - b.empty;
            return (a.remaining ?? Infinity) - (b.remaining ?? Infinity);
        }

        // Both imminent, or both later: soonest pause first.
        if (a.timeToPause !== b.timeToPause) return a.timeToPause - b.timeToPause;
        if (a.empty !== b.empty) return a.empty - b.empty;
        return (a.remaining ?? Infinity) - (b.remaining ?? Infinity);
    }

    function injectPriorityLabel(item, rank) {
        const container = item.scenario;
        let badge = container.querySelector('.oc-priority-display');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'oc-priority-display';
        }
        let text, bg, border, color;
        if (item.paused) {
            text = `Priority #${rank} - Paused`;
            bg = 'rgba(244,67,54,0.15)'; border = '#f44336'; color = '#ff6b6b';
        } else {
            const t = item.timeToPause;
            const when = (t == null || !isFinite(t)) ? 'Recruiting' : humanizeDuration(t);
            text = `Priority #${rank} - ${when}`;
            if (t == null || !isFinite(t))      { bg = 'rgba(96,165,250,0.12)'; border = '#60a5fa'; color = '#60a5fa'; }
            else if (t < 12 * HOUR)             { bg = 'rgba(255,152,0,0.15)';  border = '#ff9800'; color = '#ff9800'; }
            else if (t < 24 * HOUR)             { bg = 'rgba(255,193,7,0.12)';  border = '#ffc107'; color = '#ffc107'; }
            else if (t < 48 * HOUR)             { bg = 'rgba(139,195,74,0.12)'; border = '#8bc34a'; color = '#8bc34a'; }
            else                                { bg = 'rgba(76,175,80,0.12)';  border = '#4caf50'; color = '#4caf50'; }
        }
        if (badge.textContent !== text) badge.textContent = text;
        badge.style.background = bg; badge.style.borderLeftColor = border; badge.style.color = color;

        if (useBannerDate()) {
            // Overlay top-left on the crime banner (clock/status block), the
            // same spot the completed-date badge uses — avoids the squashed
            // header row on PDA/narrow. Darken bg for contrast over the image.
            badge.classList.add('oc-priority-display--banner');
            badge.style.background = 'rgba(0,0,0,0.6)';
            const banner = container.querySelector('[class*="phase___"]');
            const host = banner || container;
            host.classList.add('oc-priority-host'); // CSS handles positioning, not inline style
            if (badge.parentNode !== host) host.appendChild(badge);
            return;
        }

        // Desktop: first item in the panel header row. Also undo any banner-mode
        // artefacts so they don't leak onto a reused node after a tab switch.
        badge.classList.remove('oc-priority-display--banner');
        container.querySelectorAll('.oc-priority-host').forEach(el => {
            el.classList.remove('oc-priority-host');
            if (el.style.position === 'relative') el.style.position = '';
        });
        const panelBody = container.querySelector(`${S.panelBody}`)
            || container.querySelector('[class*="panelBody___"]');
        if (!panelBody) return;
        if (badge.parentNode !== panelBody || panelBody.firstChild !== badge) {
            panelBody.insertBefore(badge, panelBody.firstChild);
        }
    }

    // Find the element that directly contains every crime in its subtree —
    // works whether crimes are flat siblings or each in their own wrapper block.
    function findListContainer(scenarios) {
        const total = scenarios.length;
        let node = scenarios[0].parentNode;
        while (node) {
            if (node.querySelectorAll && node.querySelectorAll(`${S.scenario}`).length >= total) return node;
            node = node.parentNode;
        }
        return scenarios[0].parentNode;
    }

    // The direct child of `container` whose subtree holds this scenario — the
    // crime's top-level block (may be the scenario node itself in a flat layout).
    function blockOf(scenario, container) {
        let n = scenario;
        while (n && n.parentNode && n.parentNode !== container) n = n.parentNode;
        return (n && n.parentNode === container) ? n : null;
    }

    // A crime's full unit at container level: its block plus any trailing blocks
    // that don't introduce a new scenario (e.g. a detached roles wrapper in a
    // flat layout), so panel + roles always travel together.
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
        const all = scenarios.map(computeCrimeInfo).filter(it => it.roles);

        // Per-crime safety net independent of tab detection: only recruiting
        // crimes have empty slots. A crime you're IN on the Planning tab is
        // fully staffed (empty === 0) — never touch it (no move/label/outline),
        // so other scripts styling that crime aren't disturbed. Also strip any
        // stale paused ring off fully-staffed crimes.
        const items = [];
        all.forEach(it => {
            if (it.empty > 0) { items.push(it); return; }
            it.scenario.classList.remove('oc-paused-block');
            if (it.roles) it.roles.classList.remove('oc-paused-block');
        });
        if (!items.length) return;

        items.sort(crimeSortCmp);
        items.forEach((it, i) => injectPriorityLabel(it, i + 1));

        // Reorder at the list-container's child level. Each crime is resolved to
        // its top-level block, so this works whether scenarios are flat siblings
        // or each wrapped in a per-crime container. List is `display: block`, so
        // nodes must be physically moved (CSS `order` is inert here).
        const container = findListContainer(scenarios);
        const desired = [];
        const seen = new Set();
        items.forEach(it => {
            const block = blockOf(it.scenario, container);
            if (!block || seen.has(block)) return;
            seen.add(block);
            // Red ring when paused — tag the panel and roles directly (real
            // rendered boxes; the resolved block may be a layout-only wrapper).
            it.scenario.classList.toggle('oc-paused-block', !!it.paused);
            if (it.roles) it.roles.classList.toggle('oc-paused-block', !!it.paused);
            blockUnit(block).forEach(n => { if (n.parentNode === container) desired.push(n); });
        });
        if (desired.length < 2) return;

        const set = new Set(desired);
        const domOrder = Array.from(container.children).filter(c => set.has(c));
        const already = domOrder.length === desired.length && domOrder.every((n, i) => n === desired[i]);
        if (already) return;                                            // already sorted → no DOM ops, no loop

        reorderInFlight = true;
        try {
            const endAnchor = domOrder[domOrder.length - 1].nextSibling; // marker after our block (or null)
            desired.forEach(n => container.insertBefore(n, endAnchor));  // whole blocks, in rank order
        } finally {
            setTimeout(() => { reorderInFlight = false; }, 0);
        }
    }

    let reorderTimeout = null;
    function debouncedReorder() {
        if (reorderTimeout) clearTimeout(reorderTimeout);
        reorderTimeout = setTimeout(() => { try { reorderAndLabel(); } catch (e) {} }, 150);
    }

    // ── Completed-crime data via faction/crimes list (batched) ─────────
    const PAGE_LIMIT = 100;                 // max the endpoint allows; fewer calls
    const executedAtMap = {};               // crimeId (string) -> executed_at (int)
    let nextOffset = 0;                     // next page offset to request
    let morePages = true;                   // false once _metadata.links.next is null
    let pageFetchInFlight = false;

    const dateFilterState = { fromRaw: '', toRaw: '', from: null, to: null };

    // Fetch one page of completed crimes and merge into executedAtMap.
    // Returns true if a page was fetched, false if none left / no key / busy.
    async function fetchCompletedPage() {
        if (!morePages || pageFetchInFlight) return false;

        const apiKey = Storage.getSettings().apiKey;
        if (!apiKey) { log('No API key for completed crimes fetch'); return false; }

        pageFetchInFlight = true;
        try {
            const url = `${API_BASE}/faction/crimes?cat=completed`
                      + `&limit=${PAGE_LIMIT}&offset=${nextOffset}&sort=DESC`;
            const res = await fetch(url, { headers: tornAuth(apiKey) });
            const data = await res.json();
            if (data?.error) { logError('Torn API error:', data.error); morePages = false; return false; }

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
            logError('Failed to fetch completed crimes page:', e);
            return false;
        } finally {
            pageFetchInFlight = false;
        }
    }

    // Given the IDs currently in the DOM, page through the API until they're
    // all covered (or we run out of pages), then re-render dates + re-filter.
    let ensureInFlight = false;
    async function ensureDatesForVisible() {
        if (ensureInFlight) return;
        ensureInFlight = true;
        try {
            let guard = 0;
            while (guard++ < 50) {
                const ids = Array.from(document.querySelectorAll(`${S.wrapper}[data-oc-id]`))
                    .map(el => el.getAttribute('data-oc-id'))
                    .filter(Boolean);
                const missing = ids.filter(id => executedAtMap[id] === undefined);

                if (missing.length === 0) break;      // all covered
                if (!morePages) break;                // nothing left to fetch

                const fetched = await fetchCompletedPage();
                if (!fetched) break;                  // no key / error / busy

                renderCompletedDates();               // progressive: show what we have
            }
            renderCompletedDates();
            applyDateFilter();
        } finally {
            ensureInFlight = false;
        }
    }

    // Shown in the browser's local timezone (matches the date filter inputs).
    function formatDateTime(unixSeconds) {
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function injectCompletedDate(container, executedAt) {
        let display = container.querySelector('.oc-completed-display');
        if (!display) {
            display = document.createElement('div');
            display.className = 'oc-completed-display';
        }
        display.textContent = `Completed: ${formatDateTime(executedAt)}`;

        if (useBannerDate()) {
            // Overlay it on the big success/failed banner (top-left), where
            // there's room — avoids the squashed header row on PDA/narrow.
            display.classList.add('oc-completed-display--banner');
            if (getComputedStyle(container).position === 'static') {
                container.style.position = 'relative';
            }
            const banner = container.querySelector('[class*="phase___"]') || container;
            const host = (banner === container) ? container : (banner.parentNode || container);
            if (display.parentNode !== host) {
                host.appendChild(display);
            }
            return;
        }

        // Desktop: sit to the LEFT of the success box in the header row.
        display.classList.remove('oc-completed-display--banner');
        const chainLinkButton = container.querySelector(`${S.chainLink}`);
        if (!chainLinkButton) return;
        const parent = chainLinkButton.parentNode;
        parent.classList.add('dss-oc-header-row'); // enables mobile full-width wrap

        const successBox = parent.querySelector('.oc-success-display');
        const ref = successBox || chainLinkButton;
        if (display.parentNode !== parent || display.nextSibling !== ref) {
            parent.insertBefore(display, ref);
        }
    }

    // Stamp every completed container in the DOM with whatever dates we know.
    function renderCompletedDates() {
        document.querySelectorAll(`${S.wrapper}[data-oc-id]`).forEach(container => {
            const id = container.getAttribute('data-oc-id');
            const executedAt = executedAtMap[id];
            if (executedAt != null) {
                container.dataset.executedAt = String(executedAt);
                injectCompletedDate(container, executedAt);
            }
        });
    }

    // ── Date filter ────────────────────────────────────────────────────
    function applyDateFilterToContainer(container) {
        const { from, to } = dateFilterState;
        if (from === null && to === null) { container.style.display = ''; return; }

        const executedAt = container.dataset.executedAt ? parseInt(container.dataset.executedAt) : null;
        if (executedAt === null || isNaN(executedAt)) { container.style.display = ''; return; } // not loaded yet

        let visible = true;
        if (from !== null && executedAt < from) visible = false;
        if (to   !== null && executedAt > to)   visible = false;
        container.style.display = visible ? '' : 'none';
    }

    function applyDateFilter() {
        const containers = document.querySelectorAll(`${S.wrapper}[data-oc-id]`);
        let shown = 0;
        containers.forEach(c => {
            applyDateFilterToContainer(c);
            if (c.style.display !== 'none') shown++;
        });
        const countEl = document.querySelector('#dss-date-filter-bar .dss-df-count');
        if (countEl) {
            countEl.textContent = (dateFilterState.from !== null || dateFilterState.to !== null)
                ? `Showing ${shown} of ${containers.length}` : '';
        }
    }

    function getCompletedListParent() {
        const firstCompleted = document.querySelector(`${S.wrapper}[data-oc-id]`);
        if (firstCompleted && firstCompleted.parentNode) return firstCompleted.parentNode;
        return document.querySelector(`${S.contentLayer}`);
    }

    function ensureDateFilterBar(show) {
        let bar = document.getElementById('dss-date-filter-bar');

        if (!show) { if (bar) bar.style.display = 'none'; return; }

        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'dss-date-filter-bar';
            bar.className = 'dss-date-filter-bar';
            bar.innerHTML = `
                    <span class="dss-df-label">Filter by completion date</span>
                    <label>From <input type="date" id="dss-df-from"></label>
                    <label>To <input type="date" id="dss-df-to"></label>
                    <button type="button" id="dss-df-clear">Clear</button>
                    <span class="dss-df-count"></span>`;

            const fromInput = bar.querySelector('#dss-df-from');
            const toInput   = bar.querySelector('#dss-df-to');

            const onChange = () => {
                dateFilterState.fromRaw = fromInput.value;
                dateFilterState.toRaw   = toInput.value;
                // From = start of that day (local); To = end of that day (local, inclusive).
                dateFilterState.from = fromInput.value
                    ? Math.floor(new Date(fromInput.value + 'T00:00:00').getTime() / 1000) : null;
                dateFilterState.to = toInput.value
                    ? Math.floor(new Date(toInput.value + 'T23:59:59').getTime() / 1000) : null;
                // A narrower/older filter may need dates we haven't paged to yet.
                ensureDatesForVisible();
                applyDateFilter();
            };
            fromInput.addEventListener('change', onChange);
            toInput.addEventListener('change', onChange);
            bar.querySelector('#dss-df-clear').addEventListener('click', () => {
                fromInput.value = ''; toInput.value = '';
                Object.assign(dateFilterState, { fromRaw: '', toRaw: '', from: null, to: null });
                applyDateFilter();
            });
        }

        // Repopulate inputs from stored state (survives React re-renders wiping the bar)
        bar.querySelector('#dss-df-from').value = dateFilterState.fromRaw;
        bar.querySelector('#dss-df-to').value   = dateFilterState.toRaw;

        const parent = getCompletedListParent();
        if (parent && (bar.parentNode !== parent || parent.firstChild !== bar)) {
            parent.insertBefore(bar, parent.firstChild);
        }
        bar.style.display = '';
        applyDateFilter();
    }

    // ── Main processing ────────────────────────────────────────────────
    let isProcessing = false;

    function processCrimes(retryCount = 0) {
        if (isProcessing) return;
        isProcessing = true;

        try {
            if (!window.location.hash.includes('tab=crimes') && !window.location.pathname.includes('organizedcrimes')) {
                return;
            }

            if (!weightDataLoaded) {
                log('Weight data not loaded yet, skipping processing...');
                return;
            }

            const restrictJoinButtons = isRestrictedFaction();
            const markUnpaid = showUnpaidMarkers();

            const highlightLowCpr = lowCprEnabled && isRestrictedFaction();

            let isOnCompletedTab = false;
            const urlHash = window.location.hash;
            if (urlHash.includes('completed')) {
                isOnCompletedTab = true;
            }

            if (!isOnCompletedTab) {
                const tabButtons = document.querySelectorAll(`${S.tabName}`);
                tabButtons.forEach(btn => {
                    const text = btn.textContent?.trim();
                    const parent = btn.parentElement;
                    const parentClasses = parent?.className || '';
                    const isActive = parentClasses.includes('active') ||
                                   parent?.getAttribute('aria-selected') === 'true' ||
                                   parent?.classList.contains('ui-state-active');
                    if (text === 'Completed' && isActive) {
                        isOnCompletedTab = true;
                    }
                });
            }

            if (!isOnCompletedTab) {
                const hasVisibleDataOcId = Array.from(document.querySelectorAll(`${S.wrapper}[data-oc-id]`))
                    .some(el => el.offsetParent !== null);
                const hasVisibleScenario = Array.from(document.querySelectorAll(`${S.scenario}`))
                    .some(el => el.offsetParent !== null);
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

            crimeContainers.forEach(container => {
                const crimeNameElement = container.querySelector(`${S.panelTitle}`);
                if (!crimeNameElement) return;
                const crimeName = crimeNameElement.textContent.trim();

                if (!container.querySelector('.oc-success-display')) {
                    processOCSuccessChance(container);
                }

                let rolesWrapper = null;
                const isCompletedContainer = container.hasAttribute('data-oc-id');

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
                const roleData = roleSlots.map(slot => {
                    const titleElement = slot.querySelector(`${S.title}`);
                    if (!titleElement) return null;
                    const roleName = titleElement.textContent.trim();
                    const priorityInfo = getRolePriority(crimeName, roleName);
                    const userCpr = getRoleCPR(slot);
                    let weight = getRoleWeight(crimeName, roleName);
                    if (weight !== null && Math.abs(weight) < 0.01) weight = 0;
                    return { element: slot, roleName, weight: weight || 0, priorityInfo, userCpr };
                }).filter(item => item !== null);

                if (!isCompletedContainer) {
                    roleData.sort((a, b) => b.weight - a.weight);
                }

                const maxWeight = Math.max(...roleData.map(r => r.weight));
                const allWeights = roleData.map(r => Math.max(0, r.weight)).filter(w => w !== null);
                const minWeight = Math.min(...allWeights);

                // Flag filled slots whose member CPR is under the CSV minimum
                // (Recruiting/Planning only; open + unpaid slots never flag).
                roleData.forEach(r => {
                    r.lowCpr = highlightLowCpr && !isCompletedContainer &&
                        !isEmptySlot(r.element) &&
                        r.priorityInfo && r.priorityInfo.minCpr !== null &&
                        r.userCpr !== null && r.userCpr < r.priorityInfo.minCpr;
                });

                // If any slot carries a bottom tag (unpaid or low CPR), stop
                // the slots stretching to equal height — otherwise the taller
                // slot drags the others down with it.
                const crimeHasUnpaid = markUnpaid && !isCompletedContainer &&
                    roleData.some(r => !!r.priorityInfo?.unpaid);
                const crimeHasTag = crimeHasUnpaid || roleData.some(r => r.lowCpr);

                roleData.forEach((item, index) => {
                    if (!isCompletedContainer) {
                        item.element.style.order = index;
                    } else {
                        item.element.style.order = '';
                    }

                    item.element.style.alignSelf = crimeHasTag ? 'flex-start' : '';

                    // Self-heal: an earlier build set some borders to dashed.
                    // A hard-refresh clears those inline styles, but reset here
                    // too so a stale one doesn't linger if the gradient branch
                    // below (which only runs when weights differ) doesn't rewrite it.
                    if (item.element.style.borderLeftStyle === 'dashed') {
                        item.element.style.borderLeftStyle = 'solid';
                    }

                    const isUnpaidSlot = markUnpaid && !isCompletedContainer && !!item.priorityInfo?.unpaid;
                    const onGreen = slotHasGreenHighlight(item.element);

                    if (item.weight !== null) {
                        addPriorityLabel(item.element, Math.max(0, item.weight), onGreen);
                    }
                    setUnpaidTag(item.element, isUnpaidSlot);

                    setLowCprTag(item.element, item.lowCpr
                                 ? { cpr: item.userCpr, min: item.priorityInfo.minCpr } : null);

                    // Only restrict join buttons for whitelisted factions
                    if (restrictJoinButtons) {
                        const joinButton = item.element.querySelector(`${S.joinButton}, button[type="button"].torn-btn`);
                        if (joinButton && item.priorityInfo) {
                            const requirementCheck = checkRequirements(item.priorityInfo, item.userCpr);
                            if (!requirementCheck.allowed) {
                                joinButton.classList.add('join-button-disabled');
                                joinButton.setAttribute('disabled', 'true');
                                joinButton.classList.add('crime-priority-tooltip');
                                joinButton.setAttribute('data-priority', requirementCheck.reason);
                            } else {
                                joinButton.classList.remove('join-button-disabled');
                                joinButton.removeAttribute('disabled');
                                joinButton.classList.remove('crime-priority-tooltip');
                                joinButton.removeAttribute('data-priority');
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

            // Completed tab: batch-fetch executed_at for any visible crime IDs
            // we haven't covered yet, then show the date filter bar.
            if (isOnCompletedTab) {
                ensureDatesForVisible();
            }
            ensureDateFilterBar(isOnCompletedTab);

            // Recruiting panel: reorder by pause priority + add priority labels.
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
            GM.xmlHttpRequest({
                method: "GET",
                url: API_WEIGHTS_URL,
                onload: (response) => {
                    if (!response) return; // PDA fires onload with undefined before real response
                    try {
                        const text = response?.responseText || response?.response || (typeof response === 'string' ? response : '');
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
                },
            });
        });
    }

    // ── Initialise ────────────────────────────────────────────────────
    async function start() {
        parseCSV();
        addTooltipStyles();
        detectFactionId();

        await fetchScenarioData();
        await fetchWeightData();

        // If we still don't have faction ID, try API
        await detectFactionIdFromAPI();

        log(`Faction ID: ${currentFactionId}, Restricted: ${isRestrictedFaction()}, Unpaid markers: ${showUnpaidMarkers()}`);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', processCrimes);
        } else {
            processCrimes();
        }

        // Tab click handler
        document.addEventListener('click', (e) => {
            const target = e.target.closest(`${S.tabName}, .crimeNav___abc123`);
            if (target) {
                const textContent = target.textContent || '';
                if (textContent.includes('CRIMES') ||
                    textContent.includes('Recruiting') ||
                    textContent.includes('Planning') ||
                    textContent.includes('Completed')) {
                    document.querySelectorAll(`${S.wrapper}.oc-processed, ${S.scenario}.oc-processed`).forEach(el => {
                        el.classList.remove('oc-processed');
                    });
                    setTimeout(processCrimes, 500);
                }
            }
        }, true);

        // Join guard — re-checks CPR at click time, capture phase on window so it
        // runs before React's root listener. Covers join buttons React has
        // re-rendered since processCrimes() last ran (fresh button, no disabled attr).
        window.addEventListener('click', (e) => {
            if (!isRestrictedFaction()) return;
            const btn = e.target.closest?.(`${S.joinButton}, button[type="button"].torn-btn`);
            if (!btn) return;

            // Role slot: nearest wrapper___ holding both a role title and CPR.
            let slot = btn.parentElement;
            while (slot && !(slot.matches(S.wrapper) && slot.querySelector(S.title) && slot.querySelector(S.successChance))) {
                slot = slot.parentElement;
            }
            if (!slot) return;

            // Crime name: roles wrapper sits right after the scenario___ panel
            // (recruiting), or is the data-oc-id wrapper itself (completed).
            let crimeName = null;
            for (let n = slot; n && n !== document.body; n = n.parentElement) {
                const prev = n.previousElementSibling;
                const titleHost = (prev && prev.matches(S.scenario)) ? prev
                    : (n.matches(`${S.wrapper}[data-oc-id]`) ? n : null);
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
            // Re-apply the disabled state so the button looks/behaves blocked again.
            btn.classList.add('join-button-disabled', 'crime-priority-tooltip');
            btn.setAttribute('disabled', 'true');
            btn.setAttribute('data-priority', check.reason);
            log(`Blocked join: ${crimeName} / ${roleName} — ${check.reason}`);
        }, true);

        window.addEventListener('hashchange', () => {
            document.querySelectorAll(`${S.wrapper}.oc-processed, ${S.scenario}.oc-processed`).forEach(el => {
                el.classList.remove('oc-processed');
            });
            setTimeout(processCrimes, 500);
        });
        // Mutation observer — scoped to content layer when available
        let lastProcessedContent = '';
        const obsCallback = () => {
            const crimeContainers = document.querySelectorAll(`${S.contentLayer} ${S.scenario}, ${S.wrapper}[data-oc-id]`);
            if (crimeContainers.length > 0) {
                // Sort the title set so reorder (which changes order, not membership)
                // doesn't churn the signature and retrigger processing. Timer text
                // also stays out of the signature so it won't tick us into a loop.
                const currentContent = Array.from(crimeContainers).map(c => {
                    const title = c.querySelector(`${S.panelTitle}`);
                    return title ? title.textContent : '';
                }).sort().join('|');
                if (currentContent && currentContent !== lastProcessedContent) {
                    lastProcessedContent = currentContent;
                    debouncedProcess();
                }
                // Membership-stable renders (timer ticks, React re-reconciling
                // our moved nodes) won't change the sorted signature above, so
                // run the guarded reorder too — cheap no-op once already sorted.
                debouncedReorder();
            }
        };

        const obs = new MutationObserver(obsCallback);
        obs.observe(document.body, { childList: true, subtree: true });

        // Manual refresh shortcut
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                processCrimes();
            }
        });

        // Keep pause-priority labels/order fresh as the countdowns tick down,
        // without waiting on a DOM mutation. Cheap: no-ops when already sorted.
        setInterval(() => { try { reorderAndLabel(); } catch (e) {} }, 30000);

        console.log('[DSS Crime Prioritiser] Initialized successfully');
    }

    start();
}
});
