// Entry point. Core first, then every module registers itself, then boot.
// Module order matches the original single-file script.
import { init } from './core/init.js';

import './modules/tyronic-war/index.js';
import './modules/attack-enhancer/index.js';
import './modules/chain-monitor/index.js';
import './modules/midnight-revive/index.js';
import './modules/hospital-revive-filter/index.js';
import './modules/crime-prioritiser/index.js';
import './modules/oc-reminder/index.js';
import './modules/faction-family-buttons/index.js';
import './modules/activity-stats/index.js';
import './modules/faction-money/index.js';
import './modules/armoury-notes/index.js';
import './modules/cash-monitor/index.js';
import './modules/item-price-sorter/index.js';
import './modules/honor-names/index.js';
import './modules/custom-background/index.js';
import './modules/medx-revive/index.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
