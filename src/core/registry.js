import { Storage } from './storage.js';

// ════════════════════════════════════════════════════════════════════════
// MODULE REGISTRY
// ════════════════════════════════════════════════════════════════════════

const MODULES = {};
/**
 * Register a module.
 * @param {string} id        - Unique module ID
 * @param {object} config    - { name, description, version, pages:[], guide:'', init:Function }
 *   pages  — URL substrings this module should run on
 *   guide  — HTML string shown on the module's settings page
 *   init   — function() called when the module is enabled & page matches
 */
function registerModule(id, config) {
    MODULES[id] = { id, ...config };
}
/** True if the module has no faction restriction, or the user's faction is on its list. */
function factionAllowed(mod) {
    if (!Array.isArray(mod.factions) || !mod.factions.length) return true;
    const fid = String(Storage.getSettings().myFactionId || '');
    return !!fid && mod.factions.map(String).includes(fid);
}
export { MODULES, registerModule, factionAllowed };
