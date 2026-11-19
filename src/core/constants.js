// ════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════

const DSS_VERSION = __DSS_VERSION__; // injected from package.json at build time
const SETTINGS_KEY = 'dss_settings';
const MODULES_KEY = 'dss_modules';
const API_BASE = 'https://api.torn.com/v2';
const tornAuth = (key) => ({ 'Accept': 'application/json', 'Authorization': 'ApiKey ' + key });
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IS_PDA = navigator.userAgent.includes('com.manuito.tornpda')
    || /TornPDA/i.test(navigator.userAgent)
    || typeof window.flutter_inappwebview !== 'undefined'
    || typeof window.PDA_httpGet === 'function';
export { DSS_VERSION, SETTINGS_KEY, MODULES_KEY, API_BASE, tornAuth, escHtml, IS_PDA };
