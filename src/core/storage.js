import { MODULES_KEY, SETTINGS_KEY } from './constants.js';

// ════════════════════════════════════════════════════════════════════════
// STORAGE
// ════════════════════════════════════════════════════════════════════════

const Storage = {
    _get(key, fallback) {
        try {
            const v = GM_getValue(key);
            return v !== undefined ? JSON.parse(v) : fallback;
        } catch (_) { return fallback; }
    },
    _set(key, val) {
        try { GM_setValue(key, JSON.stringify(val)); } catch (_) { /* */ }
    },

    getSettings() {
        return this._get(SETTINGS_KEY, {
            apiKey: '',
            apiKeyValid: false,
            myFactionId: '',
            privacyAgreed: false
        });
    },
    setSettings(s) { this._set(SETTINGS_KEY, s); },

    getModuleStates() { return this._get(MODULES_KEY, {}); },
    setModuleStates(s) { this._set(MODULES_KEY, s); },

    getModuleState(id) {
        const all = this.getModuleStates();
        return all[id] || { enabled: false, settings: {} };
    },
    setModuleState(id, state) {
        const all = this.getModuleStates();
        all[id] = state;
        this.setModuleStates(all);
    }
};
export { Storage };
