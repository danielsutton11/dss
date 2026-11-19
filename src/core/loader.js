import { MODULES, factionAllowed } from './registry.js';
import { Storage } from './storage.js';

// ════════════════════════════════════════════════════════════════════════
// MODULE LOADER
// ════════════════════════════════════════════════════════════════════════

const Loader = {
    loaded: {},

    shouldRun(mod) {
        if (!factionAllowed(mod)) return false;
        const gateId = mod.controlledBy || mod.id;
        const state = Storage.getModuleState(gateId);
        if (!state.enabled) return false;
        const url = window.location.href;
        if (Array.isArray(mod.excludePages) && mod.excludePages.some(p => url.includes(p))) return false;
        return mod.pages.some(p => url.includes(p));
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
export { Loader };
