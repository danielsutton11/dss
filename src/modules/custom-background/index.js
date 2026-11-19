import { IS_PDA } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { UI } from '../../core/ui.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Custom Background
// ════════════════════════════════════════════════════════════════════════

registerModule('custom-background', {
name: 'Custom Background',
version: '1.0',
pdaHidden: true,
description: 'Set a custom background image for Torn.com with a blur overlay on the content area.',
pages: ['https://www.torn.com/'],
guide,
init() {
    if (IS_PDA) return;
    const BG_STORAGE_KEY = 'dss_custom_bg_url';
    const imageUrl = GM_getValue(BG_STORAGE_KEY, '');

    // Wire up guide page controls if on the settings page
    function wireGuideControls() {
        const input = document.getElementById('dss-bg-url-input');
        const saveBtn = document.getElementById('dss-bg-url-save');
        const clearBtn = document.getElementById('dss-bg-url-clear');
        const status = document.getElementById('dss-bg-url-status');
        if (!input || !saveBtn) return;

        // Populate with current value
        input.value = GM_getValue(BG_STORAGE_KEY, '');

        saveBtn.addEventListener('click', () => {
            const val = input.value.trim();
            if (!val) {
                if (status) { status.textContent = '\u26A0 Please enter a URL'; status.style.color = '#ef4444'; }
                return;
            }
            // Make sure it's a direct image link that actually loads here
            // (catches imgur page links like imgur.com/abc instead of i.imgur.com/abc.jpg).
            if (status) { status.textContent = 'Checking image\u2026'; status.style.color = '#999'; }
            const probe = new Image();
            probe.onload = () => {
                GM_setValue(BG_STORAGE_KEY, val);
                if (status) { status.textContent = '\u2705 Saved — reload any page to apply'; status.style.color = '#4caf50'; }
            };
            probe.onerror = () => {
                if (status) {
                    status.textContent = '\u26A0 Couldn\u2019t load that as an image — use a direct link (e.g. https://i.imgur.com/abc123.jpg)';
                    status.style.color = '#ef4444';
                }
            };
            probe.src = val;
        });

        clearBtn.addEventListener('click', () => {
            GM_setValue(BG_STORAGE_KEY, '');
            input.value = '';
            if (status) { status.textContent = '\u2705 Cleared — reload to remove background'; status.style.color = '#4caf50'; }
        });

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') saveBtn.click();
        });
    }

    // Check periodically for the guide controls (they render when the user navigates to the module page)
    UI.wireGuideField('dss-bg-url-input', wireGuideControls);

    // If no URL configured or running on PDA, skip background injection
    if (!imageUrl || IS_PDA) return;

    // Torn's CSS-module classes carry a build hash (effectRoot___IiOap) — match the prefix.
    const cls = (p) => `:is([class^="${p}___"], [class*=" ${p}___"])`;
    const effectRoot = cls('effectRoot');
    // JSON.stringify gives a safely-escaped CSS string, so quotes in the URL can't break the rule.
    const cssUrl = JSON.stringify(imageUrl);

    // Inject CSS immediately
    const style = document.createElement('style');
    style.id = 'dss-custom-bg-style';
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

    // Zoom scale calculation
    const baselineWidth = 2048;
    const baselineZoom = 0.9;
    const referenceWidth = baselineWidth / baselineZoom;
    let lastWidth = null;

    function updateZoomScale() {
        const currentWidth = window.innerWidth;
        if (currentWidth !== lastWidth) {
            const zoomLevel = referenceWidth / currentWidth;
            document.body.style.setProperty('--zoom-scale', zoomLevel);
            lastWidth = currentWidth;
        }
    }

    window.addEventListener('resize', updateZoomScale);
    updateZoomScale();
}
});
