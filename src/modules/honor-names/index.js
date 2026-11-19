import { registerModule } from '../../core/registry.js';
import { UI } from '../../core/ui.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Readable Names (honor bar legibility + own-row highlight on war page)
// ════════════════════════════════════════════════════════════════════════
//

registerModule('honor-names', {
name: 'Readable Names',
version: '1.1',
description: 'Makes honor bar names readable with a clean text label (overlay, plain or hover), and highlights your own row on the faction war page.',
pages: ['https://www.torn.com/'],
guide,
init() {
    const SETTINGS_KEY_HN = 'dss_hn_settings';
    const MYID_KEY = 'dss_hn_myid';
    const DEFAULTS = { mode: 'overlay', scale: 100, bg: 55, colour: true, highlightSelf: true, warNames: true };

    const loadCfg = () => {
        try { return { ...DEFAULTS, ...JSON.parse(GM_getValue(SETTINGS_KEY_HN, '{}')) }; }
        catch (_) { return { ...DEFAULTS }; }
    };
    const saveCfg = (c) => GM_setValue(SETTINGS_KEY_HN, JSON.stringify(c));
    let cfg = loadCfg();

    const root = document.documentElement;
    function applyCfg() {
        root.classList.remove('dss-hn-overlay', 'dss-hn-plain', 'dss-hn-hover', 'dss-hn-colour');
        // War page opt-out: with no mode class, labels stay hidden and the
        // original honor bars show untouched (own-row highlight still works).
        if (!cfg.warNames && isWarPage()) return;
        root.classList.add('dss-hn-' + cfg.mode);
        root.classList.toggle('dss-hn-colour', !!cfg.colour);
        root.style.setProperty('--dss-hn-scale', String(cfg.scale / 100));
        root.style.setProperty('--dss-hn-bg', String(cfg.bg / 100));
    }

    // ── Styles ───────────────────────────────────────────────────────
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

    // ── Name resolution ──────────────────────────────────────────────
    function nameOf(wrap) {
        const plain = Array.from(wrap.querySelectorAll('.honor-text'))
            .find(s => !s.classList.contains('honor-text-svg'));
        let n = plain ? plain.textContent.trim() : '';
        if (!n) {
            const chars = wrap.querySelectorAll('.honor-text-svg [data-char]');
            if (chars.length) n = Array.from(chars).map(c => c.getAttribute('data-char')).join('');
        }
        if (!n) n = (wrap.querySelector('img')?.alt || '').trim();
        if (!n) {
            const lbl = wrap.closest('a[aria-label]')?.getAttribute('aria-label') || '';
            const m = lbl.match(/^View profile of (.+)$/);
            if (m) n = m[1].trim();
        }
        return n;
    }

    // How far (px) other scripts' badges (stat estimates, value tags, etc.)
    // cover the LEFT side of a bar. Anything in the bar's host that isn't
    // part of the bar link, starts in the bar's left half and overlaps it
    // vertically counts. Capped at 60% of the bar so a name always has room.
    function measureInset(wrap) {
        const link = wrap.closest('a') || wrap;
        const host = wrap.closest('[class*="honorWrap"]') || link.parentElement;
        if (!host) return 0;
        const wr = wrap.getBoundingClientRect();
        if (!wr.width) return null;                     // not rendered (hidden tab)
        let inset = 0;
        host.querySelectorAll('*').forEach(el => {
            if (link.contains(el)) return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            if (r.right <= wr.left || r.left >= wr.left + wr.width * 0.5) return;
            if (r.bottom <= wr.top || r.top >= wr.bottom) return;
            inset = Math.max(inset, r.right - wr.left);
        });
        return Math.min(Math.round(inset), Math.round(wr.width * 0.6));
    }

    // Label every honor bar; refresh text if React reused the node for someone else.
    function processWraps() {
        const wraps = Array.from(document.querySelectorAll('.honor-text-wrap'));

        // Write pass 1: labels (so they exist before we measure)
        wraps.forEach(wrap => {
            const n = nameOf(wrap);
            if (!n) return;
            let label = wrap.querySelector(':scope > .dss-hn-label');
            if (!label) {
                label = document.createElement('span');
                label.className = 'dss-hn-label';
                wrap.appendChild(label);
                wrap.dataset.dssHn = '1';
            }
            if (label.textContent !== n) label.textContent = n;
        });

        // Read pass (one layout), then write pass — avoids layout thrashing.
        const insets = wraps.map(w => (w.dataset.dssHn ? measureInset(w) : null));
        wraps.forEach((wrap, i) => {
            const inset = insets[i];
            if (inset == null) return;
            if (wrap.dataset.dssHnLeft !== String(inset)) {
                wrap.dataset.dssHnLeft = String(inset);
                if (inset > 0) wrap.style.setProperty('--dss-hn-left', inset + 'px');
                else wrap.style.removeProperty('--dss-hn-left');
            }
        });
    }

    // ── Own row highlight (faction war page) ─────────────────────────
    function getMyId() {
        const key = Object.keys(sessionStorage).find(k => /sidebarData\d+/.test(k));
        if (key) {
            try {
                const id = JSON.parse(sessionStorage.getItem(key))?.user?.userID;
                if (id) { GM_setValue(MYID_KEY, String(id)); return String(id); }
            } catch (_) { /* ignore */ }
        }
        return GM_getValue(MYID_KEY, '') || null;
    }

    // Function declaration (hoisted) — applyCfg() calls this before this line runs.
    function isWarPage() {
        return location.pathname === '/factions.php' && /#\/war\//.test(location.hash);
    }

    function highlightSelf() {
        const active = cfg.highlightSelf && isWarPage();
        const me = active ? getMyId() : null;
        const wanted = new Set();
        if (me) {
            document.querySelectorAll('li [class*="honorWrap"] a[href*="XID="]').forEach(a => {
                const m = (a.getAttribute('href') || '').match(/XID=(\d+)/);
                if (m && m[1] === me) { const li = a.closest('li'); if (li) wanted.add(li); }
            });
        }
        document.querySelectorAll('li.dss-hn-self').forEach(li => { if (!wanted.has(li)) li.classList.remove('dss-hn-self'); });
        wanted.forEach(li => li.classList.add('dss-hn-self'));
    }

    // ── Observe ──────────────────────────────────────────────────────
    let pending = null;
    function schedule() {
        if (pending) return;
        pending = setTimeout(() => { pending = null; processWraps(); highlightSelf(); }, 150);
    }
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => { applyCfg(); schedule(); });
    processWraps();
    highlightSelf();

    // ── Guide controls (live) ────────────────────────────────────────
    function wireGuideControls() {
        const modeSel = document.getElementById('dss-hn-mode');
        const scale = document.getElementById('dss-hn-scale');
        const scaleVal = document.getElementById('dss-hn-scale-val');
        const bg = document.getElementById('dss-hn-bg');
        const bgVal = document.getElementById('dss-hn-bg-val');
        const colour = document.getElementById('dss-hn-colour');
        const self = document.getElementById('dss-hn-self');
        const war = document.getElementById('dss-hn-war');
        const status = document.getElementById('dss-hn-status');
        if (!modeSel || modeSel.dataset.wired) return;
        modeSel.dataset.wired = '1';

        modeSel.value = cfg.mode;
        scale.value = cfg.scale; scaleVal.textContent = cfg.scale + '%';
        bg.value = cfg.bg; bgVal.textContent = cfg.bg + '%';
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
            scaleVal.textContent = cfg.scale + '%';
            bgVal.textContent = cfg.bg + '%';
            saveCfg(cfg);
            applyCfg();
            highlightSelf();
            if (status) status.textContent = '\u2705 Saved';
        };
        [modeSel, colour, self, war].forEach(el => el.addEventListener('change', commit));
        [scale, bg].forEach(el => el.addEventListener('input', commit));
    }
    UI.wireGuideField('dss-hn-mode', wireGuideControls);
}
});
