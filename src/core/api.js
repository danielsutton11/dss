import { API_BASE } from './constants.js';

// ════════════════════════════════════════════════════════════════════════
// API KEY VALIDATION
// ════════════════════════════════════════════════════════════════════════

async function validateApiKey(key) {
    if (!key || key.length !== 16) return { valid: false };
    try {
        const res = await fetch(`${API_BASE}/key/info`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': 'ApiKey ' + key }
        });
        if (!res.ok) return { valid: false };
        const data = await res.json();
        if (data?.error) return { valid: false };

        const access = data?.info?.access || {};
        const user = data?.info?.user || {};

        return {
            valid: true,
            keyType: access.type || 'Unknown',
            accessLevel: access.level,
            playerId: user.id,
            factionId: user.faction_id?.toString() || null
        };
    } catch (_) { return { valid: false }; }
}
export { validateApiKey };
