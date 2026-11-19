import { validateApiKey } from './api.js';
import { Loader } from './loader.js';
import { addSidebarButton, setActiveNav } from './sidebar.js';
import { Storage } from './storage.js';
import { UI } from './ui.js';

// ════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════════════

function init() {
    // Sidebar button on every page
    addSidebarButton();

    // Settings page handling
    if (window.location.hash.startsWith('#/dss/')) {
        if (!window.location.pathname.includes('/city.php')) {
            window.location.href = 'https://www.torn.com/city.php' + window.location.hash;
        } else {
            setTimeout(() => { UI.render(); setActiveNav(); }, 100);
        }
    }
    window.addEventListener('hashchange', () => {
        if (window.location.hash.startsWith('#/dss/')) {
            if (!window.location.pathname.includes('/city.php')) {
                window.location.href = 'https://www.torn.com/city.php' + window.location.hash;
                return;
            }
            setTimeout(() => { UI.render(); setActiveNav(); }, 100);
        } else {
            UI.clear();
            setActiveNav();
        }
    });

    const s = Storage.getSettings();
    const lastFactionCheck = Number(GM_getValue('dss_faction_checked', 0));
    if (s.apiKeyValid && s.apiKey && Date.now() - lastFactionCheck > 86400000) {
        validateApiKey(s.apiKey).then(r => {
            if (!r.valid) return;
            const cur = Storage.getSettings();
            cur.myFactionId = r.factionId || '';
            Storage.setSettings(cur);
            GM_setValue('dss_faction_checked', Date.now());
        });
    }


    // Boot enabled modules
    Loader.runAll();
}
export { init };
