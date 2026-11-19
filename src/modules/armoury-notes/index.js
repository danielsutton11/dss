import { IS_PDA, escHtml } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { gmRequest, hasGmRequest } from '../../core/request.js';
import { Storage } from '../../core/storage.js';
import { UI } from '../../core/ui.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Armoury Notes
// ════════════════════════════════════════════════════════════════════════
registerModule('armoury-notes', {
name: 'Armoury Notes',
version: '1.1',
// Runs on every page so the settings guide (rendered on city.php) can be
// wired; the note UI itself is gated to item/armoury/trade pages inside init.
pages: ['https://www.torn.com/'],
description: 'Shared faction item notes with owner, category and colour tags. Edit access authenticated via your Torn API key; everyone else is read-only.',
guide,

init() {
    'use strict';

    // ─── Config ────────────────────────────────────────────────────────
    const SERVER_BASE = 'https://tornarmourynotesmanager-production.up.railway.app';
    const TORN_V2 = 'https://api.torn.com/v2';
    const DEBUG = false;
    const log = (...a) => DEBUG && console.log('[ArmouryNotes]', ...a);

    const isMobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        window.innerWidth <= 768 || 'ontouchstart' in window;

    // ─── Storage keys (module-local via GM) ────────────────────────────
    const ARMOURY_KEY_STORE  = 'an-armoury-key';
    const DELETION_MODE_KEY  = 'an-deletion-mode';
    const PAGE_ENABLE_KEY    = 'an-enabled-pages-v1';
    const CACHE_KEY          = 'an-cache-v1';
    const ACCESS_CACHE_KEY   = 'an-access-cache-v1';
    const CACHE_TTL_MS       = 30 * 1000;
    const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

    const getArmouryKey = () => (GM_getValue(ARMOURY_KEY_STORE, '') || '').trim();
    const setArmouryKey = (k) => GM_setValue(ARMOURY_KEY_STORE, (k || '').trim());
    // Torn API key is the shared, unified-manager key now — no separate prompt.
    const getTornKey = () => (Storage.getSettings().apiKey || '').trim();

    let ARMOURY_KEY = getArmouryKey();
    let TORN_API_KEY = getTornKey();

    const PAGE_FOR_PATH = { '/item.php': 'inventory', '/factions.php': 'armoury', '/trade.php': 'trade' };
    const DEFAULT_ENABLED_PAGES = { armoury: true, inventory: true, trade: true };
    function getEnabledPages() {
        let stored = null;
        try { stored = GM_getValue(PAGE_ENABLE_KEY, null); } catch (e) { log('getEnabledPages', e); }
        return { ...DEFAULT_ENABLED_PAGES, ...(stored && typeof stored === 'object' ? stored : {}) };
    }
    const setEnabledPages = (p) => { try { GM_setValue(PAGE_ENABLE_KEY, p); } catch (e) { log('setEnabledPages', e); } };

    let deletionMode = !!GM_getValue(DELETION_MODE_KEY, false);
    function setDeletionMode(v) {
        deletionMode = !!v;
        try { GM_setValue(DELETION_MODE_KEY, deletionMode); } catch (e) { log('deletion persist', e); }
        renderDeletionBanner();
        document.querySelectorAll('.an-note-btn').forEach(setNoteButtonMode);
    }

    // Access state (populated during bootstrap)
    let USER_ROLE = 'readonly';
    let USER_CAN_WRITE = false;
    let TORN_USER_ID = null;
    let TORN_USER_NAME = null;
    let ACCESS_SOURCE = 'live';

    // Category taxonomy + colours (from GET /api/categories, tenant-resolved)
    let CATEGORIES = [];                 // [{id,label,colour}]
    const catById = (id) => CATEGORIES.find(c => c.id === id) || null;

    // Faction identity for owner picker
    let MY_FACTION_ID = (Storage.getSettings().myFactionId || '').toString() || null;
    let MY_FACTION_NAME = null;

    // ─── Cross-platform HTTP for the Railway server ────────────────────
    const IS_PDA_LOCAL = IS_PDA;

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function serverRequest(method, path, body) {
        return new Promise((resolve, reject) => {
            if (!hasGmRequest()) { reject(new Error('No GM_xmlhttpRequest available')); return; }
            gmRequest({
                method,
                url: SERVER_BASE + path,
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': ARMOURY_KEY,
                    'X-Torn-API-Key': TORN_API_KEY || ''
                },
                data: body != null ? JSON.stringify(body) : undefined,
                timeout: 12000,
                onload: (r) => resolve({ status: Number(r.status || 0), text: r.responseText || '' }),
                onerror: () => reject(new Error('network error')),
                ontimeout: () => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }))
            });
        });
    }

    // Only connection-level failures are retried (PDA handshake drops); a real
    // HTTP status is a legitimate answer.
    async function req(method, path, body) {
        const MAX = 3;
        let res;
        for (let attempt = 1; attempt <= MAX; attempt++) {
            try { res = await serverRequest(method, path, body); break; }
            catch (e) {
                if (attempt === MAX) throw e;
                await sleep(300 * attempt);
            }
        }
        let data;
        try { data = res.text ? JSON.parse(res.text) : {}; }
        catch { throw Object.assign(new Error(`Non-JSON from server (HTTP ${res.status})`), { status: res.status }); }
        if (res.status >= 200 && res.status < 300) return data;
        throw Object.assign(new Error(data?.error || data?.message || `HTTP ${res.status}`), { status: res.status, serverResponse: data });
    }

    // ─── Torn API (uses the unified manager key) ───────────────────────
    async function tornApi(path) {
        const key = TORN_API_KEY;
        if (!key) throw new Error('No Torn API key');
        const res = await fetch(`${TORN_V2}${path}`, {
            headers: { 'Accept': 'application/json', 'Authorization': 'ApiKey ' + key }
        });
        const data = await res.json().catch(() => ({}));
        if (data?.error) throw new Error(data.error.error || 'Torn API error');
        return data;
    }

    // ─── In-page UI primitives (replace prompt/alert/confirm) ──────────
    injectBaseStyles();

    let toastTimer = null;
    function toast(msg, type = 'info') {
        let el = document.getElementById('an-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'an-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.className = 'an-toast an-toast-' + type + ' an-show';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.classList.remove('an-show'); }, 3200);
    }

    // Promise<boolean> in-page confirm — no native confirm()
    function confirmDialog(message, { danger = false, okLabel = 'Confirm' } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'an-modal-overlay';
            const panel = document.createElement('div');
            panel.className = 'an-modal-panel an-confirm';
            panel.innerHTML = `<div class="an-confirm-msg"></div>
                    <div class="an-modal-footer">
                        <button class="an-btn an-btn-cancel">Cancel</button>
                        <button class="an-btn ${danger ? 'an-btn-danger' : 'an-btn-primary'} an-btn-ok">${okLabel}</button>
                    </div>`;
            panel.querySelector('.an-confirm-msg').textContent = message;
            const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
            panel.querySelector('.an-btn-cancel').addEventListener('click', () => done(false));
            panel.querySelector('.an-btn-ok').addEventListener('click', () => done(true));
            overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false); });
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
            document.addEventListener('keydown', onKey, true);
        });
    }

    // ─── Access check ──────────────────────────────────────────────────
    const readAccessCache = () => { try { const c = GM_getValue(ACCESS_CACHE_KEY, null); return (c && c.d) ? c : null; } catch { return null; } };
    const writeAccessCache = (d) => { try { GM_setValue(ACCESS_CACHE_KEY, { d, t: Date.now() }); } catch (e) { log('acc cache', e); } };

    async function fetchAccessLive() {
        if (!ARMOURY_KEY) return { ok: false, invalidKey: true };
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await serverRequest('GET', '/api/access-check');
                const data = res.text ? JSON.parse(res.text) : {};
                if (res.status >= 200 && res.status < 300) return { ok: true, ...data };
                if (res.status === 401) return { ok: false, invalidKey: true };
                return { ok: false };
            } catch (e) {
                if (attempt === 3) return { ok: false };
                await sleep(300 * attempt);
            }
        }
        return { ok: false };
    }

    async function getAccessRole() {
        const cached = readAccessCache();
        if (cached && (Date.now() - cached.t) < ACCESS_CACHE_TTL_MS) { ACCESS_SOURCE = 'cache'; return cached.d; }
        const result = await fetchAccessLive();
        if (result.ok) {
            ACCESS_SOURCE = 'live';
            const d = { role: result.role || 'readonly', canWrite: !!result.canWrite, userId: result.userId || null, name: result.name || null };
            writeAccessCache(d); return d;
        }
        if (result.invalidKey) { ACCESS_SOURCE = 'invalid-key'; return { role: 'readonly', canWrite: false, userId: null, name: null }; }
        ACCESS_SOURCE = 'error';
        if (cached) return cached.d;
        return { role: 'readonly', canWrite: false, userId: null, name: null };
    }

    async function forceRefreshAccess() {
        try { GM_deleteValue(ACCESS_CACHE_KEY); } catch (e) { log('acc clear', e); }
        const before = { role: USER_ROLE, canWrite: USER_CAN_WRITE };
        const fresh = await getAccessRole();
        USER_ROLE = fresh.role; USER_CAN_WRITE = !!fresh.canWrite;
        TORN_USER_ID = fresh.userId; TORN_USER_NAME = fresh.name;
        if (fresh.role !== before.role || !!fresh.canWrite !== before.canWrite) {
            toast('Access level changed — reloading...', 'info');
            setTimeout(() => location.reload(), 900);
        } else {
            toast(`Access level unchanged (${fresh.role}).`, 'info');
        }
    }

    // ─── Categories + faction identity ─────────────────────────────────
    async function loadCategories() {
        try { CATEGORIES = await req('GET', '/api/categories'); }
        catch (e) { log('loadCategories', e); CATEGORIES = []; }
    }

    async function resolveFactionIdentity() {
        try {
            const data = await tornApi('/faction/basic');
            if (data?.basic?.id) MY_FACTION_ID = String(data.basic.id);
            if (data?.basic?.name) MY_FACTION_NAME = data.basic.name;
        } catch (e) { log('faction basic', e); }
    }

    // ─── Owner search (Torn user/search) ───────────────────────────────
    let ownerSearchTimer = null;
    async function searchUsers(query) {
        if (!query || query.length < 3) return [];
        try {
            const data = await tornApi(`/user/search?name=${encodeURIComponent(query)}`);
            return (data?.search || []).map(u => ({
                id: u.id, name: u.name, factionId: u.faction_id || null, online: u.online || null
            }));
        } catch (e) { log('user search', e); return []; }
    }

    // ─── Faction members (own faction) for the strict Access picker ────
    // Fresh pull each time the Access panel opens (membership churns). Returns
    // null on failure so the caller can fail closed rather than silently drop
    // to free-text ID entry.
    async function fetchFactionMembers() {
        try {
            const data = await tornApi('/faction/members');
            const raw = Array.isArray(data?.members) ? data.members
                : (data?.members && typeof data.members === 'object'
                    ? Object.entries(data.members).map(([id, m]) => ({ id: Number(id), ...m }))
                    : []);
            return raw
                .map(m => ({ id: Number(m.id), name: m.name, position: m.position || '' }))
                .filter(m => m.id && m.name);
        } catch (e) { log('faction members', e); return null; }
    }

    // Cached faction roster for the note-modal owner picker (member-owned scope).
    // Fetched once per session and reused; null after a failed fetch so callers
    // can fall back to the all-Torn user/search.
    let NOTE_ROSTER = null;
    let noteRosterTried = false;
    async function getNoteRoster() {
        if (NOTE_ROSTER || noteRosterTried) return NOTE_ROSTER;
        noteRosterTried = true;
        NOTE_ROSTER = await fetchFactionMembers();   // [{id,name,...}] or null
        return NOTE_ROSTER;
    }
    function normalizeName(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

    function findIdentifiers(el) {
        const root = el.closest ? (el.closest('li') || el) : el;
        const ds = root?.dataset || {};
        let aid = ds.armoryid || ds.armoury || ds.armouryid || null;
        let iid = ds.itemid || null;
        if ((!aid || !iid) && root && root.querySelector) {
            const found = root.querySelector('[data-armoryid],[data-armoury],[data-armouryid],[data-itemid]');
            if (found) { const d2 = found.dataset || {}; aid = aid || d2.armoryid || d2.armoury || d2.armouryid || null; iid = iid || d2.itemid || null; }
        }
        if (!aid && root.getAttribute) { const rid = root.getAttribute('data-reactid'); if (rid) { const m = rid.match(/\$(\d+)(?:\.[^.]+)?$/); if (m) aid = m[1]; } }
        if (!aid && root.querySelector) { const cb = root.querySelector('input[type="checkbox"][id*="-"]'); const id = cb && cb.id; if (id) { const m2 = id.match(/-(\d+)$/); if (m2) aid = m2[1]; } }
        if ((!aid || !iid) && root.querySelector) {
            const link = root.querySelector('a[href*="armoryID="], a[href*="itemID="]');
            if (link) { const href = link.getAttribute('href') || ''; const mA = href.match(/armoryID=(\d+)/); const mI = href.match(/itemID=(\d+)/); if (mA && !aid) aid = mA[1]; if (mI && !iid) iid = mI[1]; }
        }
        return { aid, iid };
    }
    function keyFromIds(name, ids) {
        if (ids?.aid) return `armouryid:${ids.aid}`;
        if (ids?.iid) return `itemid:${ids.iid}`;
        return `name:${normalizeName(name)}`;
    }

    // ─── SWR cache ─────────────────────────────────────────────────────
    let CACHE = {};
    try { const raw = GM_getValue(CACHE_KEY); if (raw && typeof raw === 'object') CACHE = raw; } catch (e) { log('cache load', e); }
    let persistTimer = null;
    function persistCacheSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(() => { try { GM_setValue(CACHE_KEY, CACHE); } catch (e) { log('cache save', e); } }, 250); }
    const inflight = new Map();
    const getCached = (k) => (CACHE[k] ? CACHE[k].d : {});
    const isFresh = (k) => { const e = CACHE[k]; return e ? (Date.now() - e.t < CACHE_TTL_MS) : false; };
    function setCached(k, d) { CACHE[k] = { d: d || {}, t: Date.now() }; persistCacheSoon(); return CACHE[k].d; }

    async function fetchRemote(key) {
        if (inflight.has(key)) return inflight.get(key);
        const p = (async () => {
            try { const d = await req('GET', `/api/torn-notes/${encodeURIComponent(key)}`); return setCached(key, d || {}); }
            catch (e) { log('fetchRemote', key, e); return getCached(key); }
            finally { inflight.delete(key); }
        })();
        inflight.set(key, p); return p;
    }
    async function ensureFresh(key, { force = false } = {}) { if (!force && isFresh(key)) return getCached(key); return await fetchRemote(key); }

    async function saveData(key, data) {
        const d = setCached(key, data || {});
        try { applyDataToUI(key, d); } catch (e) { log('applyDataToUI', e); }
        try { await req('PUT', `/api/torn-notes/${encodeURIComponent(key)}`, data); return true; }
        catch (e) { console.error('[ArmouryNotes] PUT failed', key, e); toast('Failed to save note — see console.', 'error'); return false; }
    }
    async function delData(key) {
        const prev = getCached(key);
        setCached(key, {});
        try { applyDataToUI(key, {}); } catch (e) { log('applyDataToUI del', e); }
        try { await req('DELETE', `/api/torn-notes/${encodeURIComponent(key)}`); return true; }
        catch (e) { log('DELETE failed', key, e); setCached(key, prev); try { applyDataToUI(key, prev); } catch {} toast('Failed to delete note — see console.', 'error'); return false; }
    }

    // ─── UI index + apply ──────────────────────────────────────────────
    const UI_INDEX = new Map();
    function registerUI(key, refs) { let s = UI_INDEX.get(key); if (!s) { s = new Set(); UI_INDEX.set(key, s); } s.add(refs); }

    function applyDataToUI(key, d) {
        const set = UI_INDEX.get(key); if (!set) return;
        const inherited = !!(d && d.inherited);
        for (const refs of Array.from(set)) {
            const { li, badge, tooltipEl, btn } = refs;
            if (!li.isConnected || !badge) { set.delete(refs); continue; }
            // Inherited notes are read-only -> eye icon; own notes -> pencil/bin.
            if (btn) setNoteButtonInherited(btn, inherited);
            const anchor = tooltipEl || li;
            // Tooltip: inherited notes are prefixed so the source faction is clear.
            let tip = d.note || '';
            if (inherited && d.sourceFaction) tip = `Loaned in from ${d.sourceFaction}` + (tip ? ` — ${tip}` : '');
            if (tip) anchor.setAttribute('data-note-tooltip', tip); else anchor.removeAttribute('data-note-tooltip');

            // Colour: inherited notes always take the loaned-in colour (they read
            // as loaned-in here, whatever category the origin faction gave them);
            // otherwise category-locked colour wins, else per-item colour.
            let colourVal;
            if (inherited) {
                const li = catById('loaned_from');
                colourVal = (li ? li.colour : (d.colour || '')).trim();
            } else {
                const cat = d.category ? catById(d.category) : null;
                colourVal = (cat ? cat.colour : (d.colour || '')).trim();
            }
            applyBadgeColour(badge, colourVal);

            // Inherited notes always read as loaned-in (they belong to another
            // family faction and must be returned there).
            const isLoaned = inherited || d.category === 'loaned_from';
            badge.classList.toggle('an-loaned', isLoaned);
            badge.classList.toggle('an-inherited', inherited);

            // Badge label: for an inherited note show the SOURCE FACTION (not the
            // owner) — from our side the actionable fact is "return to that faction".
            const labelTxt = inherited ? (d.sourceFaction || 'another faction') : (d.owner || '');
            const txt = (isLoaned && labelTxt) ? `⇠ ${labelTxt}` : labelTxt;
            if (badge.textContent !== txt) badge.textContent = txt;

            // Invisible owner-id for the trade owner filter (#3). Faction-owned
            // and legacy (no id yet) notes carry none, so they never match a partner.
            if (d.ownerId) badge.dataset.ownerId = String(d.ownerId);
            else delete badge.dataset.ownerId;

            const show = !!labelTxt || !!colourVal;
            const want = show ? 'inline-block' : 'none';
            if (badge.style.display !== want) badge.style.display = want;
        }
    }

    function repaintAllBadges() {
        for (const key of UI_INDEX.keys()) applyDataToUI(key, getCached(key));
    }

    // ─── Stale-key batch refresh ───────────────────────────────────────
    const STALE_KEYS = new Set();
    let refreshTimer = null;
    const CONCURRENCY = IS_PDA_LOCAL ? 2 : 8;
    const BATCH_CHUNK_SIZE = 150;

    function scheduleRefresh() {
        if (refreshTimer) return;
        refreshTimer = setTimeout(() => { refreshTimer = null; refreshPass().catch(e => log('refreshPass', e)); }, 60);
    }
    async function limitParallel(n, arr, worker) {
        let i = 0;
        const workers = new Array(Math.min(n, arr.length)).fill(0).map(async () => {
            while (true) { const idx = i++; if (idx >= arr.length) break; try { await worker(arr[idx], idx); } catch (e) { log('worker', e); } }
        });
        await Promise.all(workers);
    }
    async function fetchRemoteBatch(keys) {
        const uniq = Array.from(new Set(keys));
        if (!uniq.length) return {};
        const results = {};
        const toFetch = [];
        const piggyback = [];
        for (const k of uniq) { const ex = inflight.get(k); if (ex) piggyback.push(ex.then(() => { results[k] = getCached(k); })); else toFetch.push(k); }
        const chunks = [];
        for (let i = 0; i < toFetch.length; i += BATCH_CHUNK_SIZE) chunks.push(toFetch.slice(i, i + BATCH_CHUNK_SIZE));
        await limitParallel(CONCURRENCY, chunks, async (chunk) => {
            const p = (async () => {
                try { const data = await req('POST', '/api/torn-notes/batch-get', { keys: chunk }); for (const k of chunk) setCached(k, data[k] || {}); }
                catch (e) { log('batch-get', chunk, e); }
                finally { for (const k of chunk) inflight.delete(k); }
            })();
            for (const k of chunk) inflight.set(k, p);
            await p;
            for (const k of chunk) results[k] = getCached(k);
        });
        await Promise.all(piggyback);
        return results;
    }
    async function refreshKeys(keys) {
        const uniq = Array.from(new Set(keys)); if (!uniq.length) return;
        const results = await fetchRemoteBatch(uniq);
        for (const k of uniq) applyDataToUI(k, results[k] !== undefined ? results[k] : getCached(k));
    }
    async function refreshPass() { const keys = Array.from(STALE_KEYS); STALE_KEYS.clear(); if (!keys.length) return; await refreshKeys(keys); }

    // ─── Badge / button builders ───────────────────────────────────────
    function makeNoteIconSvg() {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '13'); svg.setAttribute('height', '13'); svg.setAttribute('aria-hidden', 'true'); svg.style.display = 'block';
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z');
        svg.appendChild(path); return svg;
    }
    function makeBinIconSvg() {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '13'); svg.setAttribute('height', '13'); svg.setAttribute('aria-hidden', 'true'); svg.style.display = 'block';
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M6 7h12l-1 14H7L6 7Zm3-3h6l1 2h4v2H2V6h4l1-2Z');
        svg.appendChild(path);
        return svg;
    }

    function makeEyeIconSvg() {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '13'); svg.setAttribute('height', '13'); svg.setAttribute('aria-hidden', 'true'); svg.style.display = 'block';
        const p1 = document.createElementNS(NS, 'path');
        p1.setAttribute('fill', 'currentColor');
        p1.setAttribute('d', 'M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z');
        const p2 = document.createElementNS(NS, 'circle');
        p2.setAttribute('fill', 'currentColor'); p2.setAttribute('cx', '12'); p2.setAttribute('cy', '12'); p2.setAttribute('r', '2');
        svg.appendChild(p1); svg.appendChild(p2); return svg;
    }

    function makeNoteButton() {
        const b = document.createElement('button');
        b.className = 'an-note-btn';
        setNoteButtonMode(b);
        return b;
    }
    function setNoteButtonMode(b) {
        b.textContent = '';
        b.appendChild(deletionMode ? makeBinIconSvg() : makeNoteIconSvg());
        b.title = deletionMode ? 'Delete this note' : 'Add/edit note, owner, category';
        b.classList.toggle('an-note-btn-del', deletionMode);
        b.classList.remove('an-note-btn-view');
    }
    // Inherited (family) notes are read-only: the pencil/bin becomes an eye.
    function setNoteButtonInherited(b, inherited) {
        if (!b) return;
        if (inherited) {
            b.textContent = '';
            b.appendChild(makeEyeIconSvg());
            b.title = 'View note (loaned in from another faction, read-only)';
            b.classList.remove('an-note-btn-del');
            b.classList.add('an-note-btn-view');
        } else {
            setNoteButtonMode(b);
        }
    }
    function makeOwnerBadge() { const el = document.createElement('span'); el.className = 'an-owner-badge'; el.style.display = 'none'; return el; }
    function applyBadgeColour(badge, colour) {
        if (!badge) return; const val = (colour || '').trim();
        if (val) { badge.dataset.colour = val; badge.style.borderColor = val; badge.style.boxShadow = `0 0 0 2px ${val}`; }
        else { delete badge.dataset.colour; badge.style.borderColor = ''; badge.style.boxShadow = ''; }
    }

    // ─── Tooltip ───────────────────────────────────────────────────────
    const tooltip = document.createElement('div');
    tooltip.className = 'an-tooltip';
    document.body.appendChild(tooltip);
    let tooltipTimeout = null, raf = null;
    function showTooltip(el, x, y) {
        const txt = el.getAttribute('data-note-tooltip'); if (!txt) return;
        tooltip.textContent = txt; tooltip.style.opacity = '1'; tooltip.style.transform = 'translate3d(0,0,0) scale(1)';
        positionTooltip(x, y); if (isMobile) tooltipTimeout = setTimeout(hideTooltip, 2500);
    }
    function hideTooltip() { tooltip.style.opacity = '0'; tooltip.style.transform = 'translate3d(0,2px,0) scale(0.98)'; clearTimeout(tooltipTimeout); }
    function positionTooltip(x, y) {
        const pad = 16, vw = innerWidth, vh = innerHeight, rect = tooltip.getBoundingClientRect();
        let left = x + pad, top = y + pad;
        if (left + rect.width > vw - pad) left = vw - rect.width - pad;
        if (top + rect.height > vh - pad) top = vh - rect.height - pad;
        tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
    }
    if (isMobile) {
        document.body.addEventListener('touchstart', (e) => { const t = e.target.closest('[data-note-tooltip]'); if (t) { const tc = e.touches[0]; showTooltip(t, tc.clientX, tc.clientY); } else hideTooltip(); });
    } else {
        document.body.addEventListener('mousemove', (e) => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const t = e.target.closest('[data-note-tooltip]'); if (!t) return hideTooltip(); showTooltip(t, e.clientX, e.clientY); }); });
    }

    // ─── Note editor modal ─────────────────────────────────────────────
    const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
    let noteModalEl = null, noteModalKey = null, noteModalApplyRemote = null;

    function closeNoteModal() {
        if (noteModalEl) { noteModalEl.remove(); noteModalEl = null; }
        noteModalKey = null; noteModalApplyRemote = null;
        document.removeEventListener('keydown', onNoteModalKeydown, true);
    }
    function onNoteModalKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); closeNoteModal(); } }
    function applyRemoteToOpenNoteModal(key, data) { if (noteModalKey === key && noteModalApplyRemote) noteModalApplyRemote(data); }

    function openNoteModal(key, label, cur, { onSave, onDelete, readOnly = false } = {}) {
        closeNoteModal();
        noteModalKey = key;

        const overlay = document.createElement('div');
        overlay.className = 'an-modal-overlay';
        const panel = document.createElement('div');
        panel.className = 'an-modal-panel';

        panel.innerHTML = `
                <div class="an-modal-title"></div>
                <div class="an-field">
                    <label class="an-label">Note</label>
                    <textarea class="an-textarea" id="an-f-note"></textarea>
                </div>
                <div class="an-field">
                    <label class="an-label">Category</label>
                    <select class="an-input" id="an-f-category">
                        <option value="">None</option>
                    </select>
                </div>
                <div class="an-field" id="an-owner-field">
                    <label class="an-label">Owner</label>
                    <div class="an-owner-wrap">
                        <input type="text" class="an-input" id="an-f-owner" placeholder="Search player name..." autocomplete="off">
                        <div class="an-owner-dropdown" id="an-owner-dd"></div>
                    </div>
                    <label class="an-owner-scope" id="an-owner-scope" style="display:none;">
                        <input type="checkbox" id="an-f-scope" checked>
                        <span>Current faction members only</span>
                    </label>
                    <div class="an-owner-hint" id="an-owner-hint"></div>
                </div>
                <div class="an-field" id="an-colour-field">
                    <label class="an-label">Colour tag</label>
                    <div class="an-colour-row">
                        <input type="color" id="an-f-colour-pick">
                        <input type="text" class="an-input" id="an-f-colour-text" placeholder="#ff8800 (blank = none)">
                    </div>
                </div>
                <div class="an-modal-footer">
                    <span class="an-status" id="an-f-status"></span>
                    <button class="an-btn an-btn-danger" id="an-f-delete">Delete</button>
                    <button class="an-btn" id="an-f-cancel">Cancel</button>
                    <button class="an-btn an-btn-primary" id="an-f-save">Save</button>
                </div>`;

        panel.querySelector('.an-modal-title').textContent = readOnly
            ? `Note — ${label}`
            : `Edit note — ${label}`;

        const noteInput   = panel.querySelector('#an-f-note');
        const catSelect   = panel.querySelector('#an-f-category');
        const ownerField  = panel.querySelector('#an-owner-field');
        const ownerInput  = panel.querySelector('#an-f-owner');
        const ownerDd     = panel.querySelector('#an-owner-dd');
        const ownerHint   = panel.querySelector('#an-owner-hint');
        const scopeWrap   = panel.querySelector('#an-owner-scope');
        const scopeCb      = panel.querySelector('#an-f-scope');
        const colourField = panel.querySelector('#an-colour-field');
        const colourPick  = panel.querySelector('#an-f-colour-pick');
        const colourText  = panel.querySelector('#an-f-colour-text');
        const statusEl    = panel.querySelector('#an-f-status');
        const deleteBtn   = panel.querySelector('#an-f-delete');
        const cancelBtn   = panel.querySelector('#an-f-cancel');
        const saveBtn     = panel.querySelector('#an-f-save');

        // Populate category options from taxonomy
        CATEGORIES.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; catSelect.appendChild(o); });

        // Selected owner state: {id, name} — id null until (re)picked
        let ownerSel = { id: cur.ownerId || null, name: cur.owner || '' };

        // Initial values
        noteInput.value = cur.note || '';
        catSelect.value = cur.category || '';
        ownerInput.value = cur.owner || '';
        colourText.value = cur.category ? '' : (cur.colour || '');
        colourPick.value = HEX.test(colourText.value) ? colourText.value : '#ffffff';

        // Read-only view (inherited/loaned-in note): show the TRUE data (real
        // owner, category, note text) but lock everything and drop Save/Delete.
        if (readOnly) {
            const src = cur.sourceFaction || 'another faction';
            const banner = document.createElement('div');
            banner.className = 'an-readonly-banner';
            banner.textContent = `Loaned in from ${src} — read-only. Owned by ${cur.owner || 'unknown'}.`;
            panel.insertBefore(banner, panel.children[1]);
            [noteInput, catSelect, ownerInput, colourPick, colourText, scopeCb].forEach(el => { if (el) el.disabled = true; });
            deleteBtn.style.display = 'none';
            saveBtn.style.display = 'none';
            cancelBtn.textContent = 'Close';
            // Skip all the edit wiring below.
            cancelBtn.addEventListener('click', closeNoteModal);
            let downRO = false;
            overlay.addEventListener('mousedown', (e) => { downRO = (e.target === overlay); });
            overlay.addEventListener('click', (e) => { if (e.target === overlay && downRO) closeNoteModal(); downRO = false; });
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
            noteModalEl = overlay;
            document.addEventListener('keydown', onNoteModalKeydown, true);
            return;
        }

        function refreshCategoryDependentUI() {
            const cat = catSelect.value;
            // Colour only editable when no category (decision B)
            colourField.style.display = cat ? 'none' : '';
            // faction_owned: owner auto = faction name, picker hidden
            if (cat === 'faction_owned') {
                ownerField.style.display = 'none';
                ownerSel = { id: null, name: MY_FACTION_NAME || MY_FACTION_ID || 'Faction' };
            } else {
                ownerField.style.display = '';
                // If we auto-set a faction name previously, clear it back to the note's owner
                if (ownerInput.value === (MY_FACTION_NAME || MY_FACTION_ID)) { /* keep */ }
            }
            // Faction-members scope toggle: only for member_owned, auto-enabled
            // each time member_owned becomes the category.
            if (cat === 'member_owned') {
                if (scopeWrap.style.display === 'none') scopeCb.checked = true; // auto-enable when it (re)appears
                scopeWrap.style.display = '';
            } else {
                scopeWrap.style.display = 'none';
            }
            updateOwnerHint();
        }

        function updateOwnerHint() {
            const cat = catSelect.value;
            ownerHint.textContent = '';
            ownerHint.classList.remove('an-owner-hint-warn');
            // Unresolved owner text (typed but not picked) is not saveable for
            // person-owner categories — surface it live rather than at Save.
            const typed = (ownerInput.value || '').trim();
            if (cat !== 'faction_owned' && typed && !ownerSel.id) {
                ownerHint.textContent = 'Not a selected player yet — pick one from the list.';
                ownerHint.classList.add('an-owner-hint-warn');
                return;
            }
            if (!ownerSel.id || !MY_FACTION_ID) return;
            const inMyFaction = String(ownerSel.factionId || '') === String(MY_FACTION_ID);
            if (cat === 'loaned_from' && inMyFaction) ownerHint.textContent = 'Heads up: this player is in your faction — did you mean Member Owned?';
            else if (cat === 'member_owned' && ownerSel.factionId && !inMyFaction) ownerHint.textContent = "Heads up: this player isn't in your faction - did you mean Loaned From?";
        }

        catSelect.addEventListener('change', () => { markDirty(); refreshCategoryDependentUI(); });

        function openOwnerDd() {
            // Flip up when the input is in the lower ~45% of the viewport so the
            // list opens into visible space instead of the panel's clipped edge.
            const r = ownerInput.getBoundingClientRect();
            const up = r.bottom > window.innerHeight * 0.55;
            ownerDd.classList.toggle('an-drop-up', up);
            ownerDd.classList.toggle('an-drop-down', !up);
            ownerDd.classList.add('show');
        }

        // Owner autocomplete
        function closeOwnerDd() { ownerDd.classList.remove('show'); ownerDd.innerHTML = ''; }

        // Search source: faction roster when member_owned + "faction members only"
        // is ticked (falls back to all-Torn if the roster couldn't load); else
        // the all-Torn user/search.
        async function searchOwners(q) {
            const factionScope = catSelect.value === 'member_owned' && scopeCb.checked;
            if (factionScope) {
                const roster = await getNoteRoster();
                if (roster) {
                    const ql = q.toLowerCase();
                    return roster.filter(m => (m.name || '').toLowerCase().includes(ql)).slice(0, 25)
                        .map(m => ({ id: m.id, name: m.name, factionId: MY_FACTION_ID, online: null }));
                }
                // roster fetch failed -> fall through to all-Torn
            }
            return await searchUsers(q);
        }

        ownerInput.addEventListener('keydown', (e) => e.stopPropagation());
        function runOwnerSearch() {
            const q = ownerInput.value.trim();
            if (q.length < 3) { closeOwnerDd(); return; }
            clearTimeout(ownerSearchTimer);
            ownerSearchTimer = setTimeout(async () => {
                const results = await searchOwners(q);
                if (!results.length) { ownerDd.innerHTML = '<div class="an-owner-item an-owner-empty">No players found</div>'; openOwnerDd(); return; }
                ownerDd.innerHTML = results.map(r =>
                    `<div class="an-owner-item" data-id="${r.id}" data-name="${escHtml(r.name)}" data-fac="${r.factionId || ''}">
                            <span class="an-owner-name">${escHtml(r.name)}</span>
                            <span class="an-owner-id">[${r.id}]${r.online === 'Online' ? ' \u2022' : ''}</span>
                        </div>`).join('');
                openOwnerDd();
                ownerDd.querySelectorAll('.an-owner-item[data-id]').forEach(el => {
                    el.addEventListener('click', () => {
                        ownerSel = { id: parseInt(el.dataset.id, 10), name: el.dataset.name, factionId: el.dataset.fac || null };
                        ownerInput.value = el.dataset.name;
                        closeOwnerDd(); updateOwnerHint();
                    });
                });
            }, 300);
        }
        ownerInput.addEventListener('input', () => {
            markDirty();
            ownerSel = { id: null, name: ownerInput.value.trim() }; // typing invalidates a prior pick
            updateOwnerHint();
            runOwnerSearch();
        });
        // Flipping the faction-members toggle re-runs the current query.
        scopeCb.addEventListener('change', () => { markDirty(); runOwnerSearch(); });
        document.addEventListener('click', (e) => { if (!e.target.closest('#an-owner-field')) closeOwnerDd(); });

        colourPick.addEventListener('input', () => { markDirty(); colourText.value = colourPick.value; });
        colourText.addEventListener('input', markDirty);

        // Dirty tracking so a background refresh never clobbers edits-in-progress
        let dirty = false;
        function markDirty() { dirty = true; }
        noteInput.addEventListener('input', markDirty);

        noteModalApplyRemote = (data) => {
            if (dirty) return;
            noteInput.value = data.note || '';
            catSelect.value = data.category || '';
            ownerInput.value = data.owner || '';
            ownerSel = { id: data.ownerId || null, name: data.owner || '' };
            colourText.value = data.category ? '' : (data.colour || '');
            colourPick.value = HEX.test(colourText.value) ? colourText.value : '#ffffff';
            refreshCategoryDependentUI();
        };

        refreshCategoryDependentUI();

        // Busy state
        let busy = false;
        function setBusy(b, label) { busy = b; saveBtn.disabled = b; deleteBtn.disabled = b; cancelBtn.disabled = b; statusEl.textContent = b ? label : ''; }

        cancelBtn.addEventListener('click', closeNoteModal);
        deleteBtn.addEventListener('click', async () => {
            if (busy) return;
            const ok = await confirmDialog(`Delete the saved note for ${label}?`, { danger: true, okLabel: 'Delete' });
            if (!ok) return;
            setBusy(true, 'Deleting...'); await onDelete(); closeNoteModal();
        });
        saveBtn.addEventListener('click', async () => {
            if (busy) return;
            const category = catSelect.value || null;
            // Owner must be a resolved person (picked from the list) for every
            // category except faction_owned. Free text with no id is rejected so
            // owner-based matching (trade/give/retrieve/migration) stays reliable.
            if (category !== 'faction_owned') {
                const typed = (ownerInput.value || '').trim();
                if (typed && !ownerSel.id) {
                    statusEl.textContent = 'Pick a player from the list, or clear the owner field.';
                    statusEl.style.color = '#ef4444';
                    ownerInput.focus();
                    return;
                }
            }
            setBusy(true, 'Saving...');
            let owner = '', ownerId = null;
            if (category === 'faction_owned') { owner = MY_FACTION_NAME || MY_FACTION_ID || 'Faction'; ownerId = null; }
            else { owner = (ownerInput.value || '').trim(); ownerId = ownerSel.id || null; }
            const d = {
                note: noteInput.value.trim(),
                category,
                owner,
                ownerId,
                colour: category ? '' : (colourText.value.trim())
            };
            const okSaved = await onSave(d);
            if (okSaved === false) { setBusy(false, ''); return; }
            closeNoteModal();
        });

        // Backdrop close only when the drag started on the backdrop
        let downOnBackdrop = false;
        overlay.addEventListener('mousedown', (e) => { downOnBackdrop = (e.target === overlay); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay && downOnBackdrop && !busy) closeNoteModal(); downOnBackdrop = false; });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        noteModalEl = overlay;
        document.addEventListener('keydown', onNoteModalKeydown, true);
        noteInput.focus();
    }

    async function handleClick(key, el, badge, label) {
        const cur = getCached(key);
        // Inherited (family) notes are read-only regardless of deletion mode.
        if (cur && cur.inherited) {
            openNoteModal(key, label, cur, { readOnly: true });
            return;
        }
        if (deletionMode) {
            const ok = await confirmDialog(`Delete the saved note for ${label}?`, { danger: true, okLabel: 'Delete' });
            if (ok) await delData(key);
            return;
        }
        openNoteModal(key, label, cur, {
            onSave: async (d) => await saveData(key, d),
            onDelete: async () => await delData(key)
        });
        try { const fresh = await ensureFresh(key, { force: true }); applyRemoteToOpenNoteModal(key, fresh); }
        catch (e) { log('bg refresh', e); }
    }

    // ─── DOM processing (adapted from original) ────────────────────────
    const BTN_CTX = new WeakMap();

    function processOne(li, labelFn, opts = {}) {
        const { requireArmouryId = false } = opts;
        if (!li || li.classList.contains('an-enhanced')) return;
        if (li.matches?.('[data-action], [data-role="action"]')) return;
        if (li.closest?.('.actions, .actions-wrap, .item-action, .action-wrap')) return;

        const ids = findIdentifiers(li);
        if (location.pathname === '/trade.php' && !ids.aid && !ids.iid) return;
        if (requireArmouryId && !ids.aid && !ids.iid) return;

        const nameEl =
            li.querySelector('[class*="item-name"]') || li.querySelector('.name') ||
            li.querySelector('[data-test*="item-name"]') || li.querySelector('.t-overflow, .desc___VJSNQ span b') ||
            li.querySelector('b, strong, span');
        if (!nameEl) return;

        let name = '';
        if (nameEl.childNodes && nameEl.childNodes.length) {
            for (const node of nameEl.childNodes) { if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) { name = t; break; } } }
        }
        if (!name) { let raw = nameEl.textContent || ''; nameEl.querySelectorAll('.tt-item-value, .bonus-tooltip, .networth-info-icon').forEach(el => { raw = raw.replace(el.textContent || '', ''); }); raw = raw.replace(/\$[\d,]+/g, ''); name = raw.trim(); }
        if (!name) return;

        const key = keyFromIds(name, ids);

        let controls = null;
        for (let i = 0; i < nameEl.children.length; i++) { const c = nameEl.children[i]; if (c.classList && c.classList.contains('an-controls')) { controls = c; break; } }
        let btn = controls?.querySelector?.('.an-note-btn') || null;
        let badge = controls?.querySelector?.('.an-owner-badge') || null;
        if (!controls) controls = document.createElement('span');
        controls.className = 'an-controls';
        if (!badge) badge = makeOwnerBadge();
        if (!btn && USER_CAN_WRITE && ids.aid) btn = makeNoteButton();

        controls.textContent = '';
        if (USER_CAN_WRITE && btn) controls.append(badge, btn); else controls.append(badge);

        let textWrap = null;
        for (let i = 0; i < nameEl.children.length; i++) { const c = nameEl.children[i]; if (c.classList && c.classList.contains('an-name-text')) { textWrap = c; break; } }
        if (!textWrap) { textWrap = document.createElement('span'); textWrap.className = 'an-name-text'; while (nameEl.firstChild) textWrap.appendChild(nameEl.firstChild); nameEl.appendChild(textWrap); }

        const tag = (nameEl.tagName || '').toUpperCase();
        const inlineLikely = ['SPAN','B','STRONG','I','EM','A','SMALL','LABEL'].includes(tag);
        nameEl.classList.add('an-name'); nameEl.classList.add(inlineLikely ? 'an-inline' : 'an-block');
        nameEl.appendChild(controls);

        if (USER_CAN_WRITE && btn) BTN_CTX.set(btn, { key, el: li, badge, label: labelFn(name) });
        li.classList.add('an-enhanced');
        registerUI(key, { li, badge, tooltipEl: nameEl, btn: (USER_CAN_WRITE ? btn : null) });

        applyDataToUI(key, getCached(key));
        if (!isFresh(key)) { STALE_KEYS.add(key); scheduleRefresh(); }
    }

    function processInRoot(root, selector, labelFn, opts = {}) {
        if (!root || !root.querySelectorAll) return;
        if (root.matches && root.matches(selector)) processOne(root, labelFn, opts);
        const nodes = root.querySelectorAll(selector);
        for (let i = 0; i < nodes.length; i++) processOne(nodes[i], labelFn, opts);
    }

    function initAll(root = document) {
        processInRoot(root, 'li[data-item]', (n) => `"${n}" (Inventory)`, { requireArmouryId: true });
        processInRoot(root, 'ul.item-list > li, ul[class*="items-list"] > li[class*="item"]', (n) => `"${n}" (Armoury)`, { requireArmouryId: true });
        processInRoot(root, 'li.clearfix[data-group="child"], .item___jLJcf', (n) => `"${n}" (Trade add)`);
        if (location.pathname === '/trade.php') {
            processInRoot(root, '.trade-cont .user.left ul.desc > li, li.clearfix[data-reactid]', (n) => `"${n}" (Trade left)`, { requireArmouryId: true });
        }
    }

    // Delegated click for note buttons
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.an-note-btn'); if (!btn) return;
        e.preventDefault(); e.stopPropagation();
        if (!USER_CAN_WRITE) return;
        const ctx = BTN_CTX.get(btn); if (!ctx) return;
        handleClick(ctx.key, ctx.el, ctx.badge, ctx.label);
    }, true);

    // ─── Deletion-mode banner ──────────────────────────────────────────
    function renderDeletionBanner() {
        let banner = document.getElementById('an-deletion-banner');
        if (!deletionMode) { if (banner) banner.remove(); return; }
        if (banner) return;
        banner = document.createElement('button');
        banner.id = 'an-deletion-banner';
        banner.type = 'button';
        banner.textContent = 'Armoury Notes: Deletion mode is ON — tap to turn off';
        banner.addEventListener('click', () => setDeletionMode(false));
        document.body.appendChild(banner);
    }

    // ─── Council / Access manager (in-page, from original, popups removed) ─
    let councilModalEl = null;
    // Cached once per panel-open; both add-pickers share it. null members list
    // means the fetch failed → fail closed (disabled picker, no free-text add).
    let councilFactionMembers = [];
    let councilMembersError = false;

    function closeCouncilModal() { if (councilModalEl) { councilModalEl.remove(); councilModalEl = null; } document.removeEventListener('keydown', onCouncilKeydown, true); }
    function onCouncilKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); closeCouncilModal(); } }

    async function openCouncilManager() {
        // Fresh member pull every open — membership changes over time.
        const members = await fetchFactionMembers();
        councilMembersError = (members === null);
        councilFactionMembers = members || [];
        let lists;
        try { lists = await req('GET', '/api/council'); }
        catch (e) { toast('Could not load access lists (needs Leadership + valid Torn key).', 'error'); return; }
        renderCouncilModal(lists);
    }
    // Refresh after add/remove reuses the members already fetched this open —
    // only the council/leadership lists changed, not faction membership.
    async function refreshCouncilModal() { try { renderCouncilModal(await req('GET', '/api/council')); } catch (e) { log('refreshCouncil', e); } }

    async function councilAction(listName, action, rawId) {
        const id = parseInt(String(rawId).replace(/\D/g, ''), 10);
        if (!id) { toast('Pick a valid faction member.', 'error'); return; }
        try { await req('POST', `/api/${listName}/${action}`, { userId: id }); await refreshCouncilModal(); }
        catch (e) { toast(`Could not ${action} ${id}: ${e?.serverResponse?.error || e?.message || 'failed'}`, 'error'); }
    }

    // Strict faction-member add-row: autocomplete over the current faction
    // roster only (no raw-ID entry). Disabled with a retry hint if the member
    // fetch failed. Excludes members already on this list.
    function buildMemberAddRow(title, listName, excludeIds) {
        const addRow = document.createElement('div'); addRow.className = 'an-council-add';
        const wrap = document.createElement('div'); wrap.className = 'an-owner-wrap'; wrap.style.flex = '1 1 auto'; wrap.style.minWidth = '0';
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'an-input'; input.autocomplete = 'off';
        input.placeholder = councilMembersError ? "Couldn't load members - reopen to retry" : "Search member to add";
        if (councilMembersError) input.disabled = true;
        const dd = document.createElement('div'); dd.className = 'an-owner-dropdown';
        wrap.append(input, dd);

        function openDd() {
            const r = input.getBoundingClientRect();
            const up = r.bottom > window.innerHeight * 0.55;
            dd.classList.toggle('an-drop-up', up);
            dd.classList.toggle('an-drop-down', !up);
            dd.classList.add('show');
        }
        function closeDd() { dd.classList.remove('show'); dd.innerHTML = ''; }

        input.addEventListener('keydown', (e) => e.stopPropagation());
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            if (!q) { closeDd(); return; }
            const matches = councilFactionMembers
                .filter(m => !excludeIds.has(m.id) && m.name.toLowerCase().includes(q))
                .slice(0, 25);
            if (!matches.length) { dd.innerHTML = '<div class="an-owner-item an-owner-empty">No matching members</div>'; openDd(); return; }
            dd.innerHTML = matches.map(m =>
                `<div class="an-owner-item" data-id="${m.id}" data-name="${escHtml(m.name)}">
                        <span class="an-owner-name">${escHtml(m.name)}</span>
                        <span class="an-owner-id">[${m.id}]</span>
                    </div>`).join('');
            openDd();
            dd.querySelectorAll('.an-owner-item[data-id]').forEach(el => {
                el.addEventListener('click', () => { closeDd(); input.value = ''; councilAction(listName, 'add', el.dataset.id); });
            });
        });
        document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) closeDd(); });

        addRow.appendChild(wrap);
        return addRow;
    }

    function buildListSection(title, listName, members) {
        const wrap = document.createElement('div'); wrap.className = 'an-council-section';
        const h = document.createElement('div'); h.className = 'an-council-section-title'; h.textContent = `${title} (${members.length})`; wrap.appendChild(h);
        const list = document.createElement('div'); list.className = 'an-council-list';
        if (!members.length) { const e = document.createElement('div'); e.className = 'an-council-empty'; e.textContent = '— none —'; list.appendChild(e); }
        // Resolve names the server hasn't stored yet from the roster we already
        // fetched this open. Still-unknown = not in the current roster (e.g. left).
        const rosterById = new Map((councilFactionMembers || []).map(fm => [Number(fm.id), fm.name]));
        for (const m of members) {
            let name = (m.name && m.name.trim()) ? m.name.trim() : (rosterById.get(Number(m.id)) || '');
            const pending = !name;
            if (!name) name = 'Unknown';
            const row = document.createElement('div'); row.className = 'an-council-row';
            const label = document.createElement('span'); label.className = 'an-council-name';
            const suffix = (m.id === TORN_USER_ID) ? '  (you)' : (pending ? '  (pending)' : '');
            label.textContent = `${name} — ${m.id}${suffix}`;
            row.appendChild(label);
            const rm = document.createElement('button'); rm.className = 'an-btn an-btn-danger an-council-btn'; rm.textContent = 'Remove';
            rm.addEventListener('click', async () => { if (await confirmDialog(`Remove ${name} (${m.id}) from ${title}?`, { danger: true, okLabel: 'Remove' })) councilAction(listName, 'remove', m.id); });
            row.appendChild(rm); list.appendChild(row);
        }
        wrap.appendChild(list);
        // Strict member picker replaces the old numeric-ID input.
        const excludeIds = new Set(members.map(m => Number(m.id)));
        wrap.appendChild(buildMemberAddRow(title, listName, excludeIds));
        return wrap;
    }

    function renderCouncilModal(lists) {
        closeCouncilModal();
        const overlay = document.createElement('div'); overlay.className = 'an-modal-overlay';
        let down = false;
        overlay.addEventListener('mousedown', (e) => { down = (e.target === overlay); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay && down) closeCouncilModal(); down = false; });
        const panel = document.createElement('div'); panel.className = 'an-modal-panel an-council-panel';
        const title = document.createElement('div'); title.className = 'an-modal-title'; title.textContent = 'Manage Access'; panel.appendChild(title);
        const sub = document.createElement('div'); sub.className = 'an-council-sub'; sub.textContent = 'Changes apply for everyone.'; panel.appendChild(sub);
        if (councilMembersError) {
            const warn = document.createElement('div'); warn.className = 'an-council-sub'; warn.style.color = '#ff8a80';
            warn.textContent = "Couldn't load the faction roster - add pickers are disabled. Close and reopen to retry.";
            panel.appendChild(warn);
        }
        panel.appendChild(buildListSection('Leadership', 'leadership', lists.leadership || []));
        panel.appendChild(buildListSection('Council', 'council', lists.council || []));
        const footer = document.createElement('div'); footer.className = 'an-modal-footer';
        const close = document.createElement('button'); close.className = 'an-btn'; close.textContent = 'Close'; close.addEventListener('click', closeCouncilModal);
        footer.appendChild(close); panel.appendChild(footer);
        overlay.appendChild(panel); document.body.appendChild(overlay); councilModalEl = overlay;
        document.addEventListener('keydown', onCouncilKeydown, true);
    }

    // ─── Settings guide wiring ─────────────────────────────────────────
    function buildAccessSummary() {
        const id = TORN_USER_ID ? `#${TORN_USER_ID}` : 'unknown';
        const name = TORN_USER_NAME || 'unknown';
        const serverState = {
            live: 'reachable (checked this session)',
            cache: 'reachable (recent cached result)',
            'invalid-key': 'REJECTED — Armoury key missing or wrong',
            error: 'UNREACHABLE — showing last known/default access'
        }[ACCESS_SOURCE] || ACCESS_SOURCE;
        return `${name} (${id})\nRole: ${USER_ROLE}  •  Write access: ${USER_CAN_WRITE ? 'yes' : 'no'}\n` +
               `Armoury key: ${getArmouryKey() ? 'set' : 'not set'}  •  Torn API key: ${getTornKey() ? 'set (DSS)' : 'not set'}\nServer: ${serverState}`;
    }

    function renderCategoryEditor() {
        const list = document.getElementById('an-categories-list');
        if (!list) return;
        list.innerHTML = '';
        CATEGORIES.forEach(c => {
            const row = document.createElement('div'); row.className = 'an-cat-row';
            row.innerHTML = `<span class="an-cat-label">${escHtml(c.label)}</span>
                    <input type="color" class="an-cat-pick" value="${HEX.test(c.colour) ? c.colour : '#ffffff'}">
                    <input type="text" class="an-input an-cat-text" data-cat="${escHtml(c.id)}" data-orig="${escHtml(c.colour || '')}" value="${escHtml(c.colour || '')}" placeholder="#hex (blank = default)">`;
            const pick = row.querySelector('.an-cat-pick');
            const text = row.querySelector('.an-cat-text');
            pick.addEventListener('input', () => { text.value = pick.value; });
            text.addEventListener('keydown', (e) => e.stopPropagation());
            list.appendChild(row);
        });

        // One Save button for all colours.
        const saveWrap = document.createElement('div'); saveWrap.className = 'an-cat-saveall';
        const saveBtn = document.createElement('button'); saveBtn.className = 'an-btn an-btn-primary'; saveBtn.textContent = 'Save colours';
        saveWrap.appendChild(saveBtn);
        list.appendChild(saveWrap);

        saveBtn.addEventListener('click', async () => {
            const statusEl = document.getElementById('an-categories-status');
            const rows = Array.from(list.querySelectorAll('.an-cat-text'));
            // Only push rows whose value actually changed.
            const changed = rows.filter(t => (t.value.trim()) !== (t.dataset.orig || ''));
            if (!changed.length) { if (statusEl) { statusEl.textContent = 'No changes to save.'; statusEl.style.color = '#999'; } return; }
            saveBtn.disabled = true; if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = '#999'; }
            let ok = 0, failMsg = '';
            for (const t of changed) {
                try {
                    const updated = await req('PUT', `/api/categories/${encodeURIComponent(t.dataset.cat)}`, { colour: t.value.trim() });
                    const idx = CATEGORIES.findIndex(x => x.id === t.dataset.cat);
                    if (idx >= 0 && updated) CATEGORIES[idx] = updated;
                    ok++;
                } catch (e) { failMsg = e?.message || 'Save failed'; }
            }
            renderCategoryEditor();
            repaintAllBadges();
            const s2 = document.getElementById('an-categories-status');
            if (s2) {
                if (failMsg) { s2.textContent = `Saved ${ok}, but one or more failed: ${failMsg}`; s2.style.color = '#ef4444'; }
                else { s2.textContent = `Saved ${ok} colour${ok === 1 ? '' : 's'}.`; s2.style.color = '#4caf50'; }
            }
        });
    }

    function wireSettingsGuide() {
        const summary = document.getElementById('an-access-summary');
        if (summary) summary.textContent = buildAccessSummary();

        // Armoury key
        const keyInput = document.getElementById('an-armoury-key');
        const keySave = document.getElementById('an-armoury-key-save');
        const keyStatus = document.getElementById('an-key-status');
        if (keyInput) keyInput.value = getArmouryKey();
        keyInput?.addEventListener('keydown', (e) => e.stopPropagation());
        keySave?.addEventListener('click', () => {
            setArmouryKey(keyInput.value);
            // A new key means a different tenant/role — drop the cached access
            // result so the reload performs a fresh live check for this key.
            try { GM_deleteValue(ACCESS_CACHE_KEY); } catch (e) { log('acc clear on save', e); }
            if (keyStatus) { keyStatus.textContent = keyInput.value.trim() ? 'Armoury key saved. Reloading...' : 'Armoury key cleared. Reloading...'; keyStatus.style.color = '#4caf50'; }
            setTimeout(() => location.reload(), 700);
        });
        document.getElementById('an-access-refresh')?.addEventListener('click', (e) => {
            e.target.disabled = true;
            forceRefreshAccess().finally(() => { e.target.disabled = false; const s = document.getElementById('an-access-summary'); if (s) s.textContent = buildAccessSummary(); });
        });

        // Page toggles
        const pages = getEnabledPages();
        [['an-page-armoury', 'armoury'], ['an-page-inventory', 'inventory'], ['an-page-trade', 'trade']].forEach(([elId, k]) => {
            const cb = document.getElementById(elId); if (!cb) return;
            cb.checked = pages[k] !== false;
            cb.addEventListener('change', () => { const cur = getEnabledPages(); cur[k] = cb.checked; setEnabledPages(cur); });
        });

        // Leadership-only cards
        if (USER_ROLE === 'leadership') {
            const catCard = document.getElementById('an-categories-card');
            if (catCard) { catCard.style.display = ''; renderCategoryEditor(); }
            const leadCard = document.getElementById('an-leadership-card');
            if (leadCard) leadCard.style.display = '';
            document.getElementById('an-open-council')?.addEventListener('click', openCouncilManager);
        }

        // Danger zone (writers)
        if (USER_CAN_WRITE) {
            const danger = document.getElementById('an-danger-card');
            if (danger) danger.style.display = '';
            const delCb = document.getElementById('an-deletion-mode');
            if (delCb) { delCb.checked = deletionMode; delCb.addEventListener('change', () => setDeletionMode(delCb.checked)); }
            document.getElementById('an-clear-cache')?.addEventListener('click', async () => {
                const ok = await confirmDialog('Clear the local notes cache? Notes are safe on the server — this just forces a fresh pull.', { okLabel: 'Clear cache' });
                if (!ok) return;
                CACHE = {}; try { GM_setValue(CACHE_KEY, {}); } catch (e) { log('clear cache', e); }
                const s = document.getElementById('an-danger-status'); if (s) { s.textContent = 'Notes cache cleared.'; s.style.color = '#4caf50'; }
            });
        }

        document.getElementById('an-armoury-key-toggle')?.addEventListener('click', () => {
            keyInput?.classList.toggle('an-key-hidden');
        });
    }

    // ─── Styles ────────────────────────────────────────────────────────
    function injectBaseStyles() {
        if (document.getElementById('an-styles')) return;
        const s = document.createElement('style');
        s.id = 'an-styles';
        s.textContent = `
            .an-name{ position:relative; overflow:visible; max-width:100%; }
            .an-name.an-inline{ display:inline-flex; }
            .an-name.an-block{ display:flex; }
            .an-name .an-name-text{ display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 auto; min-width:0; }
            .an-note-btn{ background:none; border:none; padding:0; margin:0 2px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; opacity:0.8; line-height:1; color:inherit; position:relative; z-index:1001; pointer-events:auto !important; }
            .an-note-btn svg{ width:100%; height:100%; display:block; }
            .an-note-btn:hover{ opacity:1; }
            .an-controls{ display:inline-flex; align-items:center; gap:4px; z-index:1000; pointer-events:auto; margin-left:6px; flex:0 0 auto; }
            .an-controls .an-owner-badge{ display:inline-block; padding:0 5px; font-size:10px; line-height:1; border-radius:6px; background:rgba(255,255,255,0.1); white-space:nowrap; max-width:90px; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; border:1px solid rgba(255,255,255,0.25); box-shadow:none; transition:box-shadow .2s ease, border-color .2s ease; }
            .an-controls .an-owner-badge.an-loaned{ font-style:italic; }
            .an-key-hidden{ -webkit-text-security:disc; text-security:disc; }
            .an-note-btn-del{ color:#ff6b6b !important; }
            .an-note-btn-view{ color:#8fb7ff !important; }
            .an-readonly-banner{ background:rgba(96,165,250,0.12); border:1px solid rgba(96,165,250,0.35); color:#bcd4ff; border-radius:6px; padding:8px 10px; font-size:12px; margin-bottom:12px; }
            .an-trade-filter{ display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#ccc; cursor:pointer; vertical-align:middle; user-select:none; float:right; font-weight:normal; text-transform:none; }
            .an-trade-filter input{ cursor:pointer; margin:0; }
            div.title-black > .an-trade-filter{ margin-left:14px; }
            .an-trade-filter-bar{ padding:6px 12px; background:rgba(0,0,0,0.25); border-bottom:1px solid rgba(255,255,255,0.08); }
            .an-trade-filter-bar .an-trade-filter{ float:none; }
            .an-trade-filter.an-trade-filter-inline{ float:none; margin-left:14px; }
            @media (max-width: 784px){
                .an-trade-filter.an-trade-filter-inline{ display:flex; width:100%; margin:8px 0 0 0; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); }
                div.title-black > .an-trade-filter{ float:none; display:flex; width:100%; margin:6px 0 0 0; }
                /* Fix 1: keep enhanced armoury/inventory rows from overflowing on small screens */
                .an-controls{ margin-left:4px; gap:3px; }
                .an-controls .an-owner-badge{ max-width:68px; font-size:9px; padding:0 4px; }
                .name-wrap > .name.an-name .custom-bonus-badge{ max-width:84px !important; }
                .an-name .an-name-text{ min-width:0; }
            }

            /* Settings: collapsible configuration section */
            .an-cfg-details{ margin:0; }
            .an-guide-card{ margin:0 0 8px 0; }
            .an-cfg-body{ padding:2px 4px 6px; font-size:12px; color:#bbb; line-height:1.5; }
            .an-cfg-body p{ margin:0 0 8px; }
            .an-cfg-body p:last-child{ margin-bottom:0; }
            .an-cfg-summary{ cursor:pointer; list-style:none; padding:10px 14px; margin-top:4px; border:1px solid rgba(255,255,255,0.08); border-radius:6px; background:rgba(96,165,250,0.06); color:var(--link-color,#60a5fa); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; user-select:none; display:flex; align-items:center; gap:8px; }
            .an-cfg-summary::-webkit-details-marker{ display:none; }
            .an-cfg-summary::before{ content:'\u25B8'; font-size:10px; transition:transform .15s ease; }
            .an-cfg-details[open] > .an-cfg-summary::before{ transform:rotate(90deg); }
            .an-cfg-details[open] > .an-cfg-summary{ margin-bottom:12px; }

            /* Compatibility with RW Bonus name plugin (kept from original) */
            .name-wrap > .name.an-name { display:inline-flex !important; align-items:center !important; width:auto !important; min-width:0 !important; max-width:100% !important; box-sizing:border-box !important; overflow:visible !important; white-space:nowrap !important; vertical-align:middle !important; position:relative !important; z-index:9999 !important; }
            .name-wrap > .name.an-name > .an-name-text { display:flex !important; align-items:center !important; flex:1 1 auto !important; min-width:0 !important; max-width:none !important; overflow:hidden !important; white-space:nowrap !important; }
            .name-wrap { position:relative !important; z-index:9998 !important; overflow:visible !important; }
            .name-wrap > .name.an-name > .an-controls { display:inline-flex !important; align-items:center !important; flex:0 0 auto !important; margin-left:6px !important; position:relative !important; z-index:10000 !important; pointer-events:auto !important; }
            .name-wrap > .name.an-name .an-note-btn { width:18px !important; height:18px !important; z-index:10001 !important; pointer-events:auto !important; cursor:pointer !important; }

            /* Tooltip */
            .an-tooltip{ position:fixed; max-width:${isMobile ? '90vw' : '360px'}; padding:${isMobile ? '12px 16px' : '8px 10px'}; border-radius:8px; font-size:${isMobile ? '14px' : '12px'}; line-height:1.4; z-index:999999; opacity:0; transform:translate3d(0,2px,0) scale(0.98); transition:opacity .18s ease, transform .18s ease; white-space:pre-wrap; word-break:break-word; background:rgba(16,16,16,0.92); color:#f0f0f0; box-shadow:0 8px 24px rgba(0,0,0,0.35); }

            /* Modals (note / confirm / council) */
            .an-modal-overlay{ position:fixed; inset:0; z-index:1000000; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px; }
            .an-modal-panel{ background:#1b1b1b; color:#f0f0f0; border:1px solid rgba(255,255,255,0.15); border-radius:10px; width:100%; max-width:440px; max-height:85vh; overflow:visible; padding:16px 18px; box-shadow:0 12px 40px rgba(0,0,0,0.5); font-size:13px; line-height:1.4; }
            .an-modal-title{ font-size:15px; font-weight:600; margin-bottom:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-field{ margin-bottom:12px; }
            .an-label{ display:block; font-size:11px; opacity:0.7; margin-bottom:4px; }
            .an-input, .an-textarea{ width:100%; box-sizing:border-box; background:#111; color:#f0f0f0; border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:7px 9px; font-size:13px; font-family:inherit; }
            .an-textarea{ resize:vertical; min-height:60px; }
            .an-owner-wrap{ position:relative; }
            .an-owner-dropdown{ position:absolute; left:0; right:0; background:#2a2c2e; border:1px solid #444; border-radius:6px; max-height:180px; overflow-y:auto; z-index:15; box-shadow:0 8px 24px rgba(0,0,0,0.5); display:none; }
            .an-owner-dropdown.show{ display:block; }
            .an-owner-dropdown.an-drop-down{ top:100%; margin-top:2px; }
            .an-owner-dropdown.an-drop-up{ bottom:100%; margin-bottom:2px; }
            .an-owner-item{ padding:6px 10px; cursor:pointer; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center; }
            .an-owner-item:last-child{ border-bottom:none; }
            .an-owner-item:hover{ background:rgba(96,165,250,0.15); }
            .an-owner-empty{ color:#777; cursor:default; }
            .an-owner-id{ color:#777; font-size:11px; }
            .an-owner-hint{ font-size:11px; color:#e8c96a; margin-top:4px; min-height:14px; }
            .an-owner-hint.an-owner-hint-warn{ color:#ef8a8a; }
            .an-owner-scope{ display:flex; align-items:center; gap:6px; font-size:11px; color:#ccc; margin-top:6px; cursor:pointer; user-select:none; }
            .an-owner-scope input{ cursor:pointer; margin:0; }
            .an-colour-row{ display:flex; align-items:center; gap:8px; }
            .an-colour-row .an-input{ flex:1 1 auto; min-width:0; }
            .an-colour-row input[type="color"]{ width:34px; height:30px; flex:0 0 auto; padding:0; border:1px solid rgba(255,255,255,0.2); border-radius:6px; background:#111; cursor:pointer; }
            .an-modal-footer{ display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:4px; flex-wrap:wrap; }
            .an-status{ font-size:11px; opacity:0.85; flex:1 0 100%; order:-1; margin:0 0 6px; min-width:0; }
            .an-status:empty{ display:none; margin:0; }
            .an-confirm-msg{ font-size:14px; margin-bottom:14px; }
            .an-btn{ background:rgba(255,255,255,0.12); color:#f0f0f0; cursor:pointer; border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:6px 14px; font-size:12px; }
            .an-btn:hover{ background:rgba(255,255,255,0.2); }
            .an-btn:disabled{ opacity:0.5; cursor:default; }
            .an-btn-primary{ background:rgba(90,160,255,0.28); border-color:rgba(90,160,255,0.5); }
            .an-btn-primary:hover{ background:rgba(90,160,255,0.4); }
            .an-btn-danger{ background:rgba(220,70,70,0.18); border-color:rgba(220,70,70,0.4); }
            .an-btn-danger:hover{ background:rgba(220,70,70,0.32); }

            /* Council */
            .an-council-panel{ max-width:460px; }
            .an-council-sub{ font-size:11px; opacity:0.7; margin-bottom:12px; }
            .an-council-section{ margin-bottom:14px; }
            .an-council-section-title{ font-weight:600; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:4px; }
            .an-council-list{ display:flex; flex-direction:column; gap:4px; margin-bottom:8px; }
            .an-council-empty{ opacity:0.5; font-style:italic; }
            .an-council-row{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:3px 0; }
            .an-council-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-council-add{ display:flex; gap:6px; margin-top:4px; }
            .an-council-btn{ padding:5px 10px; }

            /* Settings guide category editor */
            .an-cat-row{ display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
            .an-cat-label{ min-width:110px; font-size:12px; }
            .an-cat-pick{ width:34px; height:28px; padding:0; border:1px solid rgba(255,255,255,0.2); border-radius:5px; background:#111; cursor:pointer; }
            .an-cat-text{ flex:1 1 120px; min-width:0; }
            .an-cat-saveall{ margin-top:10px; }

            /* Toast + deletion banner */
            .an-toast{ position:fixed; bottom:18px; left:50%; transform:translateX(-50%) translateY(10px); z-index:1000001; background:#222; color:#f0f0f0; border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:10px 16px; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.4); opacity:0; pointer-events:none; transition:opacity .2s ease, transform .2s ease; max-width:calc(100vw - 32px); }
            .an-toast.an-show{ opacity:1; transform:translateX(-50%) translateY(0); }
            .an-toast-error{ border-color:rgba(220,70,70,0.6); }
            .an-toast-info{ border-color:rgba(90,160,255,0.5); }
            #an-deletion-banner{ position:fixed; bottom:14px; left:14px; z-index:999999; background:#c0392b; color:#fff; border:none; border-radius:8px; padding:8px 14px; font-size:12px; font-weight:600; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,0.4); max-width:calc(100vw - 28px); }

            /* Staged retrieval */
            .an-retrieve-bar{ margin:10px 0; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
            .an-mig-pulse{ animation:an-mig-flash 1.1s ease-in-out infinite; border-color:rgba(255,170,60,0.7) !important; color:#ffc27a !important; }
            @keyframes an-mig-flash{ 0%,100%{ box-shadow:0 0 0 0 rgba(255,170,60,0.5); } 50%{ box-shadow:0 0 0 4px rgba(255,170,60,0.05); } }
            .an-retrieve-btn{ vertical-align:middle; }
            .an-retrieve-btn-float{ position:fixed; right:16px; bottom:16px; z-index:999998; box-shadow:0 6px 18px rgba(0,0,0,0.4); }
            .an-retr-panel{ max-width:560px; }
            .an-retr-controls{ display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
            .an-retr-controls > select, .an-retr-controls > .an-owner-wrap{ min-width:0; max-width:100%; }
            .an-retr-controls .an-retr-item{ flex:1 1 160px; }
            .an-retr-controls .an-give-mode, .an-retr-controls .an-retr-mode{ flex:0 1 auto; max-width:100%; }
            .an-retr-list{ max-height:48vh; overflow-y:auto; border:1px solid rgba(255,255,255,0.12); border-radius:8px; margin-bottom:12px; }
            .an-retr-empty{ padding:14px; opacity:0.6; font-style:italic; text-align:center; }
            .an-retr-row{ display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.06); }
            .an-retr-row:last-child{ border-bottom:none; }
            .an-retr-row.an-retr-skipped{ opacity:0.45; }
            .an-retr-icon{ width:18px; text-align:center; flex:0 0 auto; }
            .an-retr-name{ flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
            .an-retr-main{ flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:1px; }
            .an-retr-main .an-retr-name{ display:block; }
            .an-retr-note{ display:block; font-size:11px; color:#9fb6d6; opacity:0.9; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-retr-meta{ flex:0 0 auto; font-size:11px; opacity:0.7; white-space:nowrap; }
            .an-retr-msg{ flex:0 0 auto; font-size:11px; opacity:0.8; min-width:0; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .an-retr-row.an-retr-done .an-retr-msg{ color:#8bc34a; }
            .an-retr-skip{ flex:0 0 auto; padding:3px 10px; }
            .an-give-qty{ flex:0 0 auto; width:56px; padding:4px 6px; text-align:center; }
            @media (max-width: 784px){
                .an-retr-row{ flex-wrap:nowrap; gap:6px; padding:6px 8px; }
                .an-retr-name{ flex:1 1 auto; min-width:0; }
                .an-retr-meta{ flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
                .an-retr-msg{ display:none; }
                .an-retr-skip{ padding:3px 8px; }
            }
            `;
        document.head.appendChild(s);
    }

    // ─── Staged armoury retrieval (#4) ──────────────────────────────────
    // Recalls loaned-out items one at a time via Torn's own action, mirroring
    // the faction-payments mechanic: snapshot the current tab/page's retrievable
    // rows, then fire ONE getAction per manual "Retrieve Next" press. The button
    // only appears when Torn itself renders Retrieve links here — that defers the
    // faction-permission check entirely to Torn, so we never offer an action the
    // user can't perform. Current tab/page only; a blocking modal prevents the
    // snapshot from going stale (you can't switch tab while it's open).

    const RETR_ACTOR = () => `${TORN_USER_NAME || ''} [${TORN_USER_ID || ''}]`.trim();

    // The note text stored for an armoury item (for display in the staged lists).
    function itemNoteText(armouryId) { const d = getCached(`armouryid:${armouryId}`); return (d && d.note) ? d.note : ''; }
    // The note OWNER stored for an armoury item (for the owner filter). For an
    // inherited (family) note, show the SOURCE FACTION instead of the owner.
    function itemNoteOwner(armouryId) {
        const d = getCached(`armouryid:${armouryId}`);
        if (!d) return '';
        if (d.inherited) return d.sourceFaction || 'another faction';
        return d.owner || '';
    }
    // True when the item is loaned-in: an explicit loaned_from note, OR any
    // inherited family note (it belongs to another faction, return it there).
    function itemLoanedIn(armouryId) {
        const d = getCached(`armouryid:${armouryId}`);
        return !!(d && (d.inherited || d.category === 'loaned_from'));
    }

    // A retrievable row = <a data-role="retrieve"> whose row carries the ids and
    // whose Loaned/Type columns we can read. Snapshot the values (not the nodes),
    // so a run is stable even as Torn re-renders rows after each retrieval.
    // Only the ACTIVE armoury tab is included — Torn keeps inactive tab panels in
    // the DOM (hidden), so we filter to links that are actually visible.
    function isVisibleRow(el) {
        // offsetParent is null for display:none subtrees (hidden tab panels).
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        // Fallback for position:fixed ancestors: walk up for an aria-hidden/hidden panel.
        let n = el;
        while (n && n !== document.body) {
            const cs = n.getAttribute && (n.getAttribute('aria-hidden') === 'true');
            if (cs) return false;
            if (n.style && n.style.display === 'none') return false;
            n = n.parentElement;
        }
        return true;
    }
    function visibleRetrieveLinks() {
        return Array.from(document.querySelectorAll('a[data-role="retrieve"]')).filter(a => isVisibleRow(a.closest('li') || a));
    }

    function snapshotRetrievables() {
        const out = [];
        visibleRetrieveLinks().forEach(a => {
            // The ids live on ancestor/nearby elements carrying data-armoryid/itemid.
            const idHost = a.closest('[data-armoryid]') ||
                  a.closest('li')?.querySelector('[data-armoryid]') || null;
            const li = a.closest('li') || idHost?.closest('li');
            if (!li) return;
            const holder = idHost || li.querySelector('[data-armoryid]');
            const armouryId = holder?.getAttribute('data-armoryid') || null;
            const itemId    = holder?.getAttribute('data-itemid') || null;
            if (!armouryId || !itemId) return;

            // Item name: the row's name element (same lookup the notes code uses).
            // Quantity is split out so identical items group together in the filters.
            const nameEl = li.querySelector('.name, [class*="item-name"], b, strong');
            let itemName = '', qty = 1;
            const qtyEl = nameEl ? nameEl.querySelector('.qty') : null;
            if (nameEl) {
                if (qtyEl) qty = parseInt((qtyEl.textContent || '').replace(/[^\d]/g, ''), 10) || 1;
                const clone = nameEl.cloneNode(true);
                clone.querySelectorAll('.an-controls, .an-owner-badge, .an-note-btn, .qty').forEach(n => n.remove());
                itemName = (clone.textContent || '').trim();
            }
            // Fallback: quantity rendered as plain text ("Smoke Grenade x13") rather than a .qty span.
            const qm = itemName.match(/^(.*?)\s+x(\d+)$/i);
            if (qm) { itemName = qm[1].trim(); if (!qtyEl) qty = parseInt(qm[2], 10) || 1; }

            // Type column ("Primary"/"Melee"/...): the payload needs it verbatim.
            const typeEl = li.querySelector('.type');
            const type = (typeEl?.textContent || '').trim();
            // Loaned-to name + ID: the Loaned column's profile link. The ID is
            // needed because retrieve's `user` field is the HOLDER we recall FROM
            // (Name [id]), not the person running the script.
            const loanedCell = li.querySelector('.loaned');
            let loanedTo = '', loanedToId = null;
            if (loanedCell) {
                const link = loanedCell.querySelector('a[href*="XID="], a[href*="profiles.php"]');
                loanedTo = ((link || loanedCell).textContent || '').replace(/^\s*Loaned:\s*/i, '').trim();
                const m = (link?.getAttribute('href') || '').match(/XID=(\d+)/);
                if (m) loanedToId = parseInt(m[1], 10);
            }
            out.push({ armouryId, itemId, itemName: itemName || `Item ${itemId}`, type, loanedTo, loanedToId, qty });
        });
        return out;
    }

    // The single retrieve action — same POST Torn's UI fires, via getAction so
    // the CSRF token is supplied for us. Resolves the parsed response.
    function retrieveOne(item) {
        return new Promise((resolve, reject) => {
            const getAction = (typeof unsafeWindow !== 'undefined' && unsafeWindow.getAction)
                || (typeof window !== 'undefined' && window.getAction) || null;
            if (typeof getAction !== 'function') { reject(new Error("Torn's getAction not found on this page")); return; }
            // `user` is the HOLDER the item is being recalled FROM (the Loaned-to
            // person), not the actor running the script. Without this, retrieving
            // someone else's loaned item fails ("does not belong to the faction").
            if (!item.loanedToId) { reject(new Error('No loaned-to player found for this item')); return; }
            const holder = `${item.loanedTo || 'Player'} [${item.loanedToId}]`;
            getAction({
                type: 'post',
                action: 'factions.php',
                data: {
                    ajax: 'true',
                    step: 'armouryActionItem',
                    role: 'retrieve',
                    item: item.armouryId,
                    itemID: item.itemId,
                    type: item.type,
                    user: holder
                },
                success: (str) => { try { resolve(typeof str === 'string' ? JSON.parse(str) : str); } catch { resolve({ raw: str }); } },
                error: (err) => reject(err instanceof Error ? err : new Error(String(err?.error || err?.message || 'request failed')))
            });
        });
    }

    // After a successful retrieve, Torn's own React re-render doesn't fire for
    // our getAction call, so the row still looks loaned. Neutralise it directly:
    // remove the Retrieve link and flip the Loaned column to "Available".
    function markRowRetrieved(armouryId) {
        try {
            const holder = document.querySelector(`[data-armoryid="${armouryId}"]`);
            const li = holder?.closest('li');
            if (!li) return;
            li.querySelectorAll('a[data-role="retrieve"]').forEach(a => a.remove());
            const loanedCell = li.querySelector('.loaned');
            if (loanedCell) { loanedCell.textContent = 'Available'; loanedCell.classList.add('an-retrieved'); }
        } catch (e) { log('markRowRetrieved', e); }
    }

    let retrModalEl = null;
    let retrDidAct = false;   // true once at least one retrieve completed this session
    let retrPaging = false;   // true while hopping to the next page (skip reload + flag reset)
    function closeRetrModal() { if (retrModalEl) { retrModalEl.remove(); retrModalEl = null; } document.removeEventListener('keydown', onRetrKeydown, true); }
    // Reload only if an action actually happened, so closing an untouched modal
    // doesn't needlessly refresh the page.
    function closeRetrAndReload() { const acted = retrDidAct; closeRetrModal(); if (acted) location.reload(); }
    function onRetrKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); closeRetrAndReload(); } }

    // Next-page navigation for the retrieve sweep. The armoury paginates within
    // a sub-tab via <a class="page-number" page="N"> links. "Next Page" closes
    // the modal WITHOUT reloading, clicks the next page link, waits for it to
    // render, and reopens the modal on the fresh page.
    function retrNextPageLink() {
        const wrap = document.querySelector('.pagination-wrap');
        if (!wrap) return null;
        const active = wrap.querySelector('a.page-number.active');
        const cur = active ? parseInt(active.getAttribute('page') || '0', 10) : 0;
        if (!cur) return null;
        const links = Array.from(wrap.querySelectorAll('a.page-number[page]'));
        return links.find(a => parseInt(a.getAttribute('page'), 10) === cur + 1 && !a.classList.contains('active')) || null;
    }
    function waitFor(pred, timeout = 4000, interval = 120) {
        return new Promise((resolve) => {
            const t0 = Date.now();
            const tick = () => {
                let ok = false; try { ok = !!pred(); } catch { ok = false; }
                if (ok) return resolve(true);
                if (Date.now() - t0 >= timeout) return resolve(false);
                setTimeout(tick, interval);
            };
            tick();
        });
    }
    async function retrGoNextPage() {
        const link = retrNextPageLink();
        if (!link) return;
        const targetPage = parseInt(link.getAttribute('page'), 10);
        retrPaging = true;              // preserve retrDidAct across the hop
        closeRetrModal();              // close WITHOUT reload
        link.click();                  // Torn loads the next page
        await waitFor(() => {
            const a = document.querySelector('.pagination-wrap a.page-number.active');
            return a && parseInt(a.getAttribute('page') || '0', 10) === targetPage
                && visibleRetrieveLinks().length >= 0;   // page swapped in
        });
        await sleep(200);              // small settle for rows to finish rendering
        openRetrievalModal();
    }

    function openRetrievalModal() {
        const all = snapshotRetrievables();
        if (!all.length) { toast('Nothing retrievable on this tab.', 'info'); retrPaging = false; return; }
        if (!retrPaging) retrDidAct = false;   // fresh open resets; paging keeps it
        retrPaging = false;

        closeRetrModal();
        const overlay = document.createElement('div');
        overlay.className = 'an-modal-overlay an-retr-overlay';
        const panel = document.createElement('div');
        panel.className = 'an-modal-panel an-retr-panel';

        panel.innerHTML = `
        <div class="an-modal-title">Retrieve loaned items — this tab</div>
        <div class="an-retr-controls">
            <label class="an-label" style="margin:0;">Mode</label>
            <select class="an-input an-retr-mode" style="width:auto;flex:0 0 auto;">
                <option value="loaned_out">Loaned to member</option>
                <option value="loaned_in">Loaned-in (from notes)</option>
            </select>
            <label class="an-label an-retr-person-label" style="margin:0;">Loaned to</label>
            <select class="an-input an-retr-person" style="width:auto;flex:1 1 auto;min-width:0;"></select>
        </div>
        <div class="an-retr-controls">
            <label class="an-label" style="margin:0;">Item</label>
            <select class="an-input an-retr-item" style="flex:1 1 auto;min-width:0;"></select>
        </div>
        <div class="an-retr-controls">
            <label class="an-label" style="margin:0;">Owner</label>
            <select class="an-input an-retr-owner" style="flex:1 1 auto;min-width:0;"></select>
        </div>
        <div class="an-retr-list"></div>
        <div class="an-modal-footer">
            <span class="an-status an-retr-status"></span>
            <button class="an-btn an-retr-close">Close</button>
            <button class="an-btn an-retr-nextpage" style="display:none;">Next Page</button>
            <button class="an-btn an-btn-primary an-retr-next">Retrieve Next</button>
        </div>`;

        const modeSel      = panel.querySelector('.an-retr-mode');
        const personSel    = panel.querySelector('.an-retr-person');
        const personLabel  = panel.querySelector('.an-retr-person-label');
        const itemSel      = panel.querySelector('.an-retr-item');
        const ownerSel     = panel.querySelector('.an-retr-owner');
        const listEl       = panel.querySelector('.an-retr-list');
        const statusEl     = panel.querySelector('.an-retr-status');
        const closeBtn     = panel.querySelector('.an-retr-close');
        const nextPageBtn  = panel.querySelector('.an-retr-nextpage');
        const nextBtn      = panel.querySelector('.an-retr-next');

        // Mode B default: only retrievable rows whose note is tagged loaned_from.
        const loanedInOf = (i) => {
            const d = getCached(`armouryid:${i.armouryId}`);
            return d && (d.inherited || d.category === 'loaned_from');
        };

        // Group by item name, bigger stacks first within a name.
        const byName = (a, b) => (a.itemName || '').localeCompare(b.itemName || '')
        || ((b.qty || 1) - (a.qty || 1))
        || (a.armouryId - b.armouryId);

        const qtyLabel = (i) => (i.qty > 1 ? ` x${i.qty}` : '');

        // Base set = mode (+ person). Item/owner dropdowns filter on top.
        function baseSet() {
            let set = (modeSel.value === 'loaned_in') ? all.filter(loanedInOf) : all.slice();
            if (modeSel.value === 'loaned_out') {
                const who = personSel.value;
                if (who && who !== '__all__') set = set.filter(i => i.loanedTo === who);
            }
            return set;
        }
        function currentSet() {
            let set = baseSet();
            const chosen = itemSel.value;
            if (chosen && chosen !== '__all__') set = set.filter(i => i.itemName === chosen);
            const owner = ownerSel.value;
            if (owner && owner !== '__all__') set = set.filter(i => itemNoteOwner(i.armouryId) === owner);
            return set.slice().sort(byName);
        }

        // Item dropdown: one entry per base item name, with row count + total units.
        function rebuildItemOptions() {
            const set = baseSet();
            const counts = {}, units = {};
            set.forEach(i => {
                counts[i.itemName] = (counts[i.itemName] || 0) + 1;
                units[i.itemName]  = (units[i.itemName]  || 0) + (i.qty || 1);
            });
            const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
            const prev = itemSel.value;
            const label = (n) => units[n] > counts[n]
            ? `${n} (${counts[n]} · ${units[n].toLocaleString()} total)`
            : `${n} (${counts[n]})`;
            itemSel.innerHTML = `<option value="__all__">All items (${set.length})</option>` +
                names.map(n => `<option value="${escHtml(n)}">${escHtml(label(n))}</option>`).join('');
            if (prev && Array.from(itemSel.options).some(o => o.value === prev)) itemSel.value = prev;
        }

        // Owner dropdown from the distinct note-owners in the base set.
        function rebuildOwnerOptions() {
            const set = baseSet();
            const counts = {};
            set.forEach(i => { const o = itemNoteOwner(i.armouryId); if (o) counts[o] = (counts[o] || 0) + 1; });
            const owners = Object.keys(counts).sort((a, b) => a.localeCompare(b));
            const prev = ownerSel.value;
            ownerSel.innerHTML = `<option value="__all__">All owners (${set.length})</option>` +
                owners.map(o => `<option value="${escHtml(o)}">${escHtml(o)} (${counts[o]})</option>`).join('');
            if (prev && Array.from(ownerSel.options).some(x => x.value === prev)) ownerSel.value = prev;
        }

        function rebuildPersonOptions() {
            const set = currentSet();
            const holders = Array.from(new Set(set.map(i => i.loanedTo).filter(Boolean))).sort((a, b) => a.localeCompare(b));
            // Person selector only applies in loaned-out mode.
            const showPerson = modeSel.value === 'loaned_out';
            personSel.style.display = showPerson ? '' : 'none';
            personLabel.style.display = showPerson ? '' : 'none';
            personSel.innerHTML = `<option value="__all__">Everyone (${set.length})</option>` +
                holders.map(h => `<option value="${escHtml(h)}">${escHtml(h)} (${set.filter(i => i.loanedTo === h).length})</option>`).join('');
        }

        // Queue state: each staged item gets skip + status.
        let queue = [];      // {item, skip, done, ok, msg}
        let running = false;
        let busy = false;

        function buildQueue() {
            const items = currentSet();
            queue = items.map(i => ({ item: i, skip: false, done: false, ok: null, msg: '' }));
            renderList();
            updateFooter();
        }

        function renderList() {
            if (!queue.length) { listEl.innerHTML = '<div class="an-retr-empty">No items for this selection.</div>'; return; }
            listEl.innerHTML = '';
            queue.forEach((q) => {
                const row = document.createElement('div');
                row.className = 'an-retr-row' + (q.skip ? ' an-retr-skipped' : '') + (q.done ? ' an-retr-done' : '');
                row.dataset.armouryId = q.item.armouryId;
                const icon = q.done ? (q.ok ? '✅' : '❌') : (q.skip ? '⊘' : '•');
                const note = itemNoteText(q.item.armouryId);
                row.innerHTML = `
                <span class="an-retr-icon">${icon}</span>
                <div class="an-retr-main">
                    <span class="an-retr-name" title="${escHtml(q.item.itemName + qtyLabel(q.item))}">${escHtml(q.item.itemName)}${q.item.qty > 1 ? ` <span style="opacity:.7;font-weight:normal;">x${q.item.qty}</span>` : ''}</span>
                    ${note ? `<span class="an-retr-note" title="${escHtml(note)}">${escHtml(note)}</span>` : ''}
                </div>
                <span class="an-retr-meta">${escHtml(q.item.type || '')}${q.item.loanedTo ? ' · ' + escHtml(q.item.loanedTo) : ''}</span>
                <span class="an-retr-msg">${escHtml(q.msg || '')}</span>`;
                const skipBtn = document.createElement('button');
                skipBtn.className = 'an-btn an-retr-skip';
                skipBtn.textContent = q.skip ? 'Unskip' : 'Skip';
                skipBtn.disabled = q.done || busy;
                skipBtn.addEventListener('click', () => { q.skip = !q.skip; renderList(); updateFooter(); });
                row.appendChild(skipBtn);
                listEl.appendChild(row);
            });
        }

        function nextPending() { return queue.find(q => !q.done && !q.skip); }

        function updateFooter() {
            const remaining = queue.filter(q => !q.done && !q.skip).length;
            if (busy) { nextBtn.disabled = true; nextBtn.textContent = 'Retrieving...'; }
            else if (remaining > 0) { nextBtn.disabled = false; nextBtn.textContent = `Retrieve Next (${remaining} left)`; }
            else { nextBtn.disabled = true; nextBtn.textContent = 'Nothing to retrieve'; }
            const started = queue.some(q => q.done);
            personSel.disabled = busy || started; // lock selectors once a run has started
            modeSel.disabled   = busy || started;
            itemSel.disabled   = busy || started;
            ownerSel.disabled  = busy || started;
            if (nextPageBtn) nextPageBtn.disabled = busy;
        }

        personSel.addEventListener('change', () => { if (queue.some(q => q.done)) return; rebuildItemOptions(); rebuildOwnerOptions(); buildQueue(); });
        modeSel.addEventListener('change', () => { if (queue.some(q => q.done)) return; rebuildPersonOptions(); rebuildItemOptions(); rebuildOwnerOptions(); buildQueue(); });
        itemSel.addEventListener('change', () => { if (queue.some(q => q.done)) return; rebuildOwnerOptions(); buildQueue(); });
        ownerSel.addEventListener('change', () => { if (!queue.some(q => q.done)) buildQueue(); });

        nextBtn.addEventListener('click', async () => {
            if (busy) return;
            const q = nextPending();
            if (!q) return;
            busy = true; running = true; updateFooter(); renderList();
            statusEl.textContent = `Retrieving ${q.item.itemName}${qtyLabel(q.item)}...`;
            try {
                const res = await retrieveOne(q.item);
                // Torn returns { success: true } or an { error } / message on failure.
                const ok = res && (res.success === true || (!res.error && !res.errorMessage));
                q.done = true; q.ok = !!ok;
                q.msg = ok ? 'Retrieved' : (res?.error || res?.errorMessage || 'Failed');
                if (ok) { markRowRetrieved(q.item.armouryId); retrDidAct = true; }
            } catch (e) {
                q.done = true; q.ok = false; q.msg = e?.message || 'Failed';
            } finally {
                busy = false; statusEl.textContent = '';
                renderList(); updateFooter();
            }
        });

        closeBtn.addEventListener('click', closeRetrAndReload);
        // Next Page: only shown when a further page exists in this sub-tab.
        if (retrNextPageLink()) {
            nextPageBtn.style.display = '';
            nextPageBtn.addEventListener('click', () => { if (!busy) retrGoNextPage(); });
        }

        // Blocking overlay: no click-through, no close-on-backdrop mid-run — the
        // page (and its tabs) can't be touched while staged, keeping the snapshot valid.
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) e.stopPropagation(); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) e.stopPropagation(); });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        retrModalEl = overlay;
        document.addEventListener('keydown', onRetrKeydown, true);
        rebuildPersonOptions();
        rebuildItemOptions();
        rebuildOwnerOptions();
        buildQueue();
    }

    // Button by the Armoury Filter bar — only shown when Torn rendered Retrieve
    // links on this tab/page (i.e. the user is permitted + something is loaned out).
    // One persistent action bar on the armoury tab that Retrieve/Give/Migrate
    // all share, so the buttons sit on a single row. Created after the armoury
    // status message; removed when leaving the armoury tab.
    function ensureActionBar() {
        let bar = document.getElementById('an-action-bar');
        if (bar) return bar;
        const anchor = document.querySelector('.armoury-msg');
        if (!anchor || !anchor.parentElement) return null;
        bar = document.createElement('div');
        bar.id = 'an-action-bar';
        bar.className = 'an-retrieve-bar';
        anchor.insertAdjacentElement('afterend', bar);
        return bar;
    }
    function removeActionBarIfEmpty() {
        const bar = document.getElementById('an-action-bar');
        if (bar && bar.children.length === 0) bar.remove();
    }

    function ensureRetrievalButton() {
        if (location.pathname !== '/factions.php') return;
        const onArmoury = /tab=armoury/i.test(location.hash || '');
        const hasRetrievables = visibleRetrieveLinks().length > 0;

        let btn = document.getElementById('an-retrieve-btn');
        if (!onArmoury || !hasRetrievables) {
            if (btn) { btn.remove(); removeActionBarIfEmpty(); }
            return;
        }
        if (btn) return;

        const bar = ensureActionBar();
        btn = document.createElement('button');
        btn.id = 'an-retrieve-btn';
        btn.className = 'an-btn an-retrieve-btn';
        btn.textContent = 'Retrieve items';
        btn.addEventListener('click', openRetrievalModal);
        if (bar) { bar.insertBefore(btn, bar.firstChild); return; }  // retrieve sits first
        btn.classList.add('an-retrieve-btn-float');
        document.body.appendChild(btn);
    }

    // ─── Staged armoury GIVE (companion to retrieve) ───────────────────
    // Give hands an available item TO a chosen faction member. Same mechanic as
    // retrieve (snapshot -> one getAction per manual click), with two differences:
    //   - a single RECIPIENT member is chosen for the whole run (payload `user`
    //     is the RECIPIENT here, not the actor);
    //   - a per-item QUANTITY (default 1), capped at the row's available amount.
    // Give links appear only on rows where retrieve does not (item is available).

    function visibleGiveLinks() {
        return Array.from(document.querySelectorAll('a[data-role="give"]')).filter(a => isVisibleRow(a.closest('li') || a));
    }

    function snapshotGivables() {
        const out = [];
        visibleGiveLinks().forEach(a => {
            const idHost = a.closest('[data-armoryid]') || a.closest('li')?.querySelector('[data-armoryid]') || null;
            const li = a.closest('li') || idHost?.closest('li');
            if (!li) return;
            const holder = idHost || li.querySelector('[data-armoryid]');
            const armouryId = holder?.getAttribute('data-armoryid') || null;
            const itemId    = holder?.getAttribute('data-itemid') || null;
            if (!armouryId || !itemId) return;

            // Item name (strip our injected controls and the qty span for the label).
            const nameEl = li.querySelector('.name, [class*="item-name"], b, strong');
            let itemName = '';
            if (nameEl) {
                const clone = nameEl.cloneNode(true);
                clone.querySelectorAll('.an-controls, .an-owner-badge, .an-note-btn, .qty').forEach(n => n.remove());
                itemName = (clone.textContent || '').trim();
            }
            const type = (li.querySelector('.type')?.textContent || '').trim();
            // Available amount: stackables show <span class="qty">N</span>; a
            // single-instance weapon has no qty span, so cap at 1.
            const qtyEl = li.querySelector('.name .qty, .an-name-text .qty, .qty');
            const avail = qtyEl ? (parseInt((qtyEl.textContent || '').replace(/[^\d]/g, ''), 10) || 1) : 1;

            out.push({ armouryId, itemId, itemName: itemName || `Item ${itemId}`, type, avail });
        });
        return out;
    }

    // recipient = "Name [id]" (copy format, same as Torn's give autocomplete).
    function giveOne(item, recipient, quantity) {
        return new Promise((resolve, reject) => {
            const getAction = (typeof unsafeWindow !== 'undefined' && unsafeWindow.getAction)
                || (typeof window !== 'undefined' && window.getAction) || null;
            if (typeof getAction !== 'function') { reject(new Error("Torn's getAction not found on this page")); return; }
            getAction({
                type: 'post',
                action: 'factions.php',
                data: {
                    ajax: 'true',
                    step: 'armouryActionItem',
                    role: 'give',
                    item: item.armouryId,
                    itemID: item.itemId,
                    type: item.type,
                    user: recipient,               // RECIPIENT (not the actor)
                    quantity: String(quantity)
                },
                success: (str) => { try { resolve(typeof str === 'string' ? JSON.parse(str) : str); } catch { resolve({ raw: str }); } },
                error: (err) => reject(err instanceof Error ? err : new Error(String(err?.error || err?.message || 'request failed')))
            });
        });
    }

    // After a successful give, neutralise the row so it stops looking available.
    function markRowGiven(armouryId) {
        try {
            const holder = document.querySelector(`[data-armoryid="${armouryId}"]`);
            const li = holder?.closest('li');
            if (!li) return;
            li.querySelectorAll('a[data-role="give"], a[data-role="loan"]').forEach(a => a.remove());
        } catch (e) { log('markRowGiven', e); }
    }

    let giveModalEl = null;
    let giveDidAct = false;   // true once at least one give completed this session
    let givePaging = false;   // true while hopping to the next page (skip reload + flag reset)
    let giveRecipientMemo = null;  // chosen recipient, preserved across page hops
    // Recipient picker roster, fetched fresh on open (null = fetch failed).
    let giveMembers = [];
    let giveMembersError = false;
    function closeGiveModal() { if (giveModalEl) { giveModalEl.remove(); giveModalEl = null; } document.removeEventListener('keydown', onGiveKeydown, true); }
    function closeGiveAndReload() { const acted = giveDidAct; closeGiveModal(); if (acted) location.reload(); }
    function onGiveKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); closeGiveAndReload(); } }

    async function giveGoNextPage() {
        const link = retrNextPageLink();   // pagination markup is identical to retrieve
        if (!link) return;
        const targetPage = parseInt(link.getAttribute('page'), 10);
        givePaging = true;
        closeGiveModal();                  // close WITHOUT reload
        link.click();
        await waitFor(() => {
            const a = document.querySelector('.pagination-wrap a.page-number.active');
            return a && parseInt(a.getAttribute('page') || '0', 10) === targetPage;
        });
        await sleep(200);
        openGiveModal();
    }

    async function openGiveModal() {
        const all = snapshotGivables();
        if (!all.length) { toast('Nothing giveable on this tab.', 'info'); givePaging = false; return; }
        const wasPaging = givePaging;
        if (!givePaging) { giveDidAct = false; giveRecipientMemo = null; }   // fresh open resets
        givePaging = false;

        const members = await fetchFactionMembers();
        giveMembersError = (members === null);
        giveMembers = members || [];

        closeGiveModal();
        const overlay = document.createElement('div');
        overlay.className = 'an-modal-overlay an-retr-overlay';
        const panel = document.createElement('div');
        panel.className = 'an-modal-panel an-retr-panel';

        panel.innerHTML = `
                <div class="an-modal-title">Give items to a member — this tab</div>
                <div class="an-retr-controls">
                    <label class="an-label" style="margin:0;">Give to</label>
                    <div class="an-owner-wrap" style="flex:1 1 auto;min-width:0;">
                        <input type="text" class="an-input an-give-recipient" autocomplete="off" placeholder="${giveMembersError ? "Couldn't load members - reopen to retry" : 'Search member to give to'}" ${giveMembersError ? 'disabled' : ''}>
                        <div class="an-owner-dropdown an-give-dd"></div>
                    </div>
                </div>
                <div class="an-retr-controls">
                    <label class="an-label" style="margin:0;">Mode</label>
                    <select class="an-input an-give-mode" style="flex:0 0 auto;">
                        <option value="loaned_in">Loaned-in (from notes)</option>
                        <option value="member_owned">Member owned (from notes)</option>
                        <option value="all">Everything</option>
                    </select>
                    <label class="an-label" style="margin:0;">Item</label>
                    <select class="an-input an-retr-item" style="flex:1 1 auto;min-width:0;"></select>
                </div>
                <div class="an-retr-controls">
                    <label class="an-label" style="margin:0;">Owner</label>
                    <select class="an-input an-retr-owner" style="flex:1 1 auto;min-width:0;"></select>
                </div>
                <div class="an-retr-list"></div>
                <div class="an-modal-footer">
                    <span class="an-status an-retr-status"></span>
                    <button class="an-btn an-retr-close">Close</button>
                    <button class="an-btn an-give-nextpage" style="display:none;">Next Page</button>
                    <button class="an-btn an-btn-primary an-retr-next">Give Next</button>
                </div>`;

        const recipInput = panel.querySelector('.an-give-recipient');
        const recipDd    = panel.querySelector('.an-give-dd');
        const modeSel    = panel.querySelector('.an-give-mode');
        const itemSel    = panel.querySelector('.an-retr-item');
        const ownerSel   = panel.querySelector('.an-retr-owner');
        const listEl     = panel.querySelector('.an-retr-list');
        const statusEl   = panel.querySelector('.an-retr-status');
        const closeBtn   = panel.querySelector('.an-retr-close');
        const nextPageBtn = panel.querySelector('.an-give-nextpage');
        const nextBtn    = panel.querySelector('.an-retr-next');

        // Chosen recipient: { id, name } or null until picked.
        let recipient = null;

        const byName = (a, b) => (a.itemName || '').localeCompare(b.itemName || '') || (a.armouryId - b.armouryId);
        // Mode filters the snapshot by the item's note category.
        const noteCatOf = (i) => { const d = getCached(`armouryid:${i.armouryId}`); return d ? d.category : null; };
        function baseSet() {
            const m = modeSel.value;
            if (m === 'all') return all.slice();
            if (m === 'loaned_in') return all.filter(i => itemLoanedIn(i.armouryId));
            return all.filter(i => noteCatOf(i) === m);   // member_owned etc.
        }
        function currentSet() {
            let set = baseSet();
            const chosen = itemSel.value;
            if (chosen && chosen !== '__all__') set = set.filter(i => i.itemName === chosen);
            const owner = ownerSel.value;
            if (owner && owner !== '__all__') set = set.filter(i => itemNoteOwner(i.armouryId) === owner);
            return set.sort(byName);
        }
        function rebuildItemOptions() {
            const set = baseSet();
            const counts = {};
            set.forEach(i => { counts[i.itemName] = (counts[i.itemName] || 0) + 1; });
            const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
            const prev = itemSel.value;
            itemSel.innerHTML = `<option value="__all__">All items (${set.length})</option>` +
                names.map(n => `<option value="${escHtml(n)}">${escHtml(n)} (${counts[n]})</option>`).join('');
            if (prev && Array.from(itemSel.options).some(o => o.value === prev)) itemSel.value = prev;
        }
        function rebuildOwnerOptions() {
            const set = baseSet();
            const counts = {};
            set.forEach(i => { const o = itemNoteOwner(i.armouryId); if (o) counts[o] = (counts[o] || 0) + 1; });
            const owners = Object.keys(counts).sort((a, b) => a.localeCompare(b));
            const prev = ownerSel.value;
            ownerSel.innerHTML = `<option value="__all__">All owners (${set.length})</option>` +
                owners.map(o => `<option value="${escHtml(o)}">${escHtml(o)} (${counts[o]})</option>`).join('');
            if (prev && Array.from(ownerSel.options).some(x => x.value === prev)) ownerSel.value = prev;
        }

        // Recipient autocomplete over the faction roster (strict).
        function openDd() {
            const r = recipInput.getBoundingClientRect();
            const up = r.bottom > window.innerHeight * 0.55;
            recipDd.classList.toggle('an-drop-up', up);
            recipDd.classList.toggle('an-drop-down', !up);
            recipDd.classList.add('show');
        }
        function closeDd() { recipDd.classList.remove('show'); recipDd.innerHTML = ''; }
        recipInput.addEventListener('keydown', (e) => e.stopPropagation());
        recipInput.addEventListener('input', () => {
            recipient = null; updateFooter();
            const q = recipInput.value.trim().toLowerCase();
            if (!q) { closeDd(); return; }
            const matches = giveMembers.filter(m => m.name.toLowerCase().includes(q)).slice(0, 25);
            if (!matches.length) { recipDd.innerHTML = '<div class="an-owner-item an-owner-empty">No matching members</div>'; openDd(); return; }
            recipDd.innerHTML = matches.map(m =>
                `<div class="an-owner-item" data-id="${m.id}" data-name="${escHtml(m.name)}">
                        <span class="an-owner-name">${escHtml(m.name)}</span>
                        <span class="an-owner-id">[${m.id}]</span>
                    </div>`).join('');
            openDd();
            recipDd.querySelectorAll('.an-owner-item[data-id]').forEach(el => {
                el.addEventListener('click', () => {
                    recipient = { id: Number(el.dataset.id), name: el.dataset.name };
                    giveRecipientMemo = recipient;
                    recipInput.value = `${recipient.name} [${recipient.id}]`;
                    closeDd(); updateFooter();
                });
            });
        });
        document.addEventListener('click', (e) => { if (!panel.querySelector('.an-give-recipient')?.parentElement.contains(e.target)) closeDd(); });

        // Queue: each item carries an editable quantity (default 1, capped at avail).
        let queue = [];
        let busy = false;

        function buildQueue() {
            queue = currentSet().map(i => ({ item: i, qty: 1, skip: false, done: false, ok: null, msg: '' }));
            renderList(); updateFooter();
        }

        function renderList() {
            if (!queue.length) { listEl.innerHTML = '<div class="an-retr-empty">No items for this selection.</div>'; return; }
            listEl.innerHTML = '';
            queue.forEach((q) => {
                const row = document.createElement('div');
                row.className = 'an-retr-row' + (q.skip ? ' an-retr-skipped' : '') + (q.done ? ' an-retr-done' : '');
                row.dataset.armouryId = q.item.armouryId;
                const icon = q.done ? (q.ok ? '\u2705' : '\u274C') : (q.skip ? '\u2298' : '\u2022');
                row.innerHTML = `
                        <span class="an-retr-icon">${icon}</span>
                        <div class="an-retr-main">
                            <span class="an-retr-name" title="${escHtml(q.item.itemName)}">${escHtml(q.item.itemName)}</span>
                            ${itemNoteText(q.item.armouryId) ? `<span class="an-retr-note" title="${escHtml(itemNoteText(q.item.armouryId))}">${escHtml(itemNoteText(q.item.armouryId))}</span>` : ''}
                        </div>
                        <span class="an-retr-meta">${escHtml(q.item.type || '')}${q.item.avail > 1 ? ' \u00B7 avail ' + q.item.avail : ''}</span>
                        <span class="an-retr-msg">${escHtml(q.msg || '')}</span>`;
                // Quantity input (only meaningful when more than 1 is available).
                const qtyInput = document.createElement('input');
                qtyInput.type = 'number'; qtyInput.className = 'an-input an-give-qty';
                qtyInput.min = '1'; qtyInput.max = String(q.item.avail); qtyInput.value = String(q.qty);
                qtyInput.disabled = q.done || busy || q.item.avail <= 1;
                qtyInput.addEventListener('keydown', (e) => e.stopPropagation());
                qtyInput.addEventListener('change', () => {
                    let v = parseInt(qtyInput.value, 10);
                    if (!Number.isFinite(v) || v < 1) v = 1;
                    q.qty = v; qtyInput.value = String(v);   // no clamp: >avail is allowed to be entered and will fail on give
                });
                row.appendChild(qtyInput);

                const skipBtn = document.createElement('button');
                skipBtn.className = 'an-btn an-retr-skip';
                skipBtn.textContent = q.skip ? 'Unskip' : 'Skip';
                skipBtn.disabled = q.done || busy;
                skipBtn.addEventListener('click', () => { q.skip = !q.skip; renderList(); updateFooter(); });
                row.appendChild(skipBtn);
                listEl.appendChild(row);
            });
        }

        function nextPending() { return queue.find(q => !q.done && !q.skip); }
        function updateFooter() {
            const remaining = queue.filter(q => !q.done && !q.skip).length;
            const started = queue.some(q => q.done);
            if (busy) { nextBtn.disabled = true; nextBtn.textContent = 'Giving...'; }
            else if (!recipient) { nextBtn.disabled = true; nextBtn.textContent = 'Choose a member'; }
            else if (remaining > 0) { nextBtn.disabled = false; nextBtn.textContent = `Give Next (${remaining} left)`; }
            else { nextBtn.disabled = true; nextBtn.textContent = 'Nothing to give'; }
            itemSel.disabled = busy || started;
            modeSel.disabled = busy || started;
            ownerSel.disabled = busy || started;
            recipInput.disabled = busy || started || giveMembersError; // lock recipient once a run starts
            if (nextPageBtn) nextPageBtn.disabled = busy;
        }

        itemSel.addEventListener('change', () => { if (queue.some(q => q.done)) return; rebuildOwnerOptions(); buildQueue(); });
        modeSel.addEventListener('change', () => { if (queue.some(q => q.done)) return; rebuildItemOptions(); rebuildOwnerOptions(); buildQueue(); });
        ownerSel.addEventListener('change', () => { if (!queue.some(q => q.done)) buildQueue(); });

        nextBtn.addEventListener('click', async () => {
            if (busy || !recipient) return;
            const q = nextPending();
            if (!q) return;
            // Client-side guard: fail before sending if quantity exceeds available.
            if (q.qty > q.item.avail) {
                q.done = true; q.ok = false; q.msg = `Only ${q.item.avail} available`;
                renderList(); updateFooter(); return;
            }
            busy = true; updateFooter(); renderList();
            const recipStr = `${recipient.name} [${recipient.id}]`;
            statusEl.textContent = `Giving ${q.item.itemName} to ${recipient.name}...`;
            try {
                const res = await giveOne(q.item, recipStr, q.qty);
                const ok = res && (res.success === true || (!res.error && !res.errorMessage));
                q.done = true; q.ok = !!ok;
                q.msg = ok ? 'Given' : (res?.error || res?.errorMessage || 'Failed');
                if (ok) { markRowGiven(q.item.armouryId); giveDidAct = true; }
            } catch (e) {
                q.done = true; q.ok = false; q.msg = e?.message || 'Failed';
            } finally {
                busy = false; statusEl.textContent = ''; renderList(); updateFooter();
            }
        });

        closeBtn.addEventListener('click', closeGiveAndReload);
        // Restore the chosen recipient after a page hop so you don't re-pick it.
        if (wasPaging && giveRecipientMemo && !giveMembersError) {
            recipient = giveRecipientMemo;
            recipInput.value = `${recipient.name} [${recipient.id}]`;
            updateFooter();
        }
        // Next Page: only shown when a further page exists in this sub-tab.
        if (retrNextPageLink()) {
            nextPageBtn.style.display = '';
            nextPageBtn.addEventListener('click', () => { if (!busy) giveGoNextPage(); });
        }

        // Blocking overlay (same as retrieve): can't touch the page while staged.
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) e.stopPropagation(); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) e.stopPropagation(); });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        giveModalEl = overlay;
        document.addEventListener('keydown', onGiveKeydown, true);
        rebuildItemOptions();
        rebuildOwnerOptions();
        buildQueue();
    }

    function ensureGiveButton() {
        if (location.pathname !== '/factions.php') return;
        const onArmoury = /tab=armoury/i.test(location.hash || '');
        const hasGivables = visibleGiveLinks().length > 0;

        let btn = document.getElementById('an-give-btn');
        if (!onArmoury || !hasGivables) { if (btn) { btn.remove(); removeActionBarIfEmpty(); } return; }
        if (btn) return;

        const bar = ensureActionBar();
        btn = document.createElement('button');
        btn.id = 'an-give-btn';
        btn.className = 'an-btn an-retrieve-btn';
        btn.textContent = 'Give items';
        btn.addEventListener('click', openGiveModal);
        if (bar) {
            // Sit right after the Retrieve button if present, else at the start.
            const retr = document.getElementById('an-retrieve-btn');
            if (retr && retr.parentElement === bar) retr.insertAdjacentElement('afterend', btn);
            else bar.insertBefore(btn, bar.firstChild);
            return;
        }
        btn.classList.add('an-retrieve-btn-float');
        btn.style.bottom = '64px';
        document.body.appendChild(btn);
    }

    // ─── Family note migration (armoury bar) ────────────────────────────
    // "Migrate Notes": request to pull all notes across the family where the
    // caller is the owner into this faction's store (origin-leader approved).
    // Leaders also get a pulsing "Approve migrations (N)" button when their
    // tenant has pending requests to move notes OUT.

    async function requestMigration() {
        try {
            const res = await req('POST', '/api/migrations', {});
            const n = res?.totalNotes || 0;
            if (n === 0) { toast('No notes found to migrate — you own no notes in other family factions.', 'info'); return; }
            const factions = (res?.pending || []).map(p => p.originFaction).filter(Boolean);
            const from = factions.length ? ` from ${factions.join(', ')}` : '';
            await messageDialog('Migration requested',
                `Requested migration of ${n} note${n === 1 ? '' : 's'}${from}. An origin-faction leader must approve it.\n\n` +
                `You will be able to edit these notes once this faction's leadership grants you write access.`);
        } catch (e) {
            toast(e?.serverResponse?.error || e?.message || 'Could not request migration.', 'error');
        }
    }

    // Simple in-page message dialog (OK only).
    function messageDialog(title, message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div'); overlay.className = 'an-modal-overlay';
            const panel = document.createElement('div'); panel.className = 'an-modal-panel';
            panel.innerHTML = `<div class="an-modal-title"></div><div class="an-confirm-msg" style="white-space:pre-line;"></div>
                    <div class="an-modal-footer"><button class="an-btn an-btn-primary an-msg-ok">OK</button></div>`;
            panel.querySelector('.an-modal-title').textContent = title;
            panel.querySelector('.an-confirm-msg').textContent = message;
            const done = () => { overlay.remove(); resolve(); };
            panel.querySelector('.an-msg-ok').addEventListener('click', done);
            overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(); });
            overlay.appendChild(panel); document.body.appendChild(overlay);
        });
    }

    let migPollTimer = null;
    async function refreshPendingMigrations() {
        const btn = document.getElementById('an-mig-approve-btn');
        if (USER_ROLE !== 'leadership') { if (btn) btn.remove(); return; }
        let list = [];
        try { list = await req('GET', '/api/migrations/pending'); } catch (e) { log('pending migs', e); return; }
        const count = Array.isArray(list) ? list.length : 0;
        let b = document.getElementById('an-mig-approve-btn');
        if (count === 0) { if (b) { b.remove(); removeActionBarIfEmpty(); } return; }
        const bar = ensureActionBar();
        if (!bar) return;
        if (!b) {
            b = document.createElement('button');
            b.id = 'an-mig-approve-btn';
            b.className = 'an-btn an-retrieve-btn an-mig-pulse';
            b.addEventListener('click', () => openApprovalsModal());
            bar.appendChild(b);
        }
        b.textContent = `\u26A0 Approve migrations (${count})`;
    }

    async function openApprovalsModal() {
        let list = [];
        try { list = await req('GET', '/api/migrations/pending'); }
        catch (e) { toast('Could not load pending migrations.', 'error'); return; }

        const overlay = document.createElement('div'); overlay.className = 'an-modal-overlay';
        const panel = document.createElement('div'); panel.className = 'an-modal-panel an-council-panel';
        panel.innerHTML = `<div class="an-modal-title">Pending migrations</div>
                <div class="an-council-sub">Requests to move notes OUT of your faction into another family faction. Approving copies them and marks yours as migrated (reversible).</div>
                <div class="an-mig-list"></div>
                <div class="an-modal-footer"><button class="an-btn an-mig-close">Close</button></div>`;
        const listEl = panel.querySelector('.an-mig-list');
        const renderRows = (rows) => {
            if (!rows.length) { listEl.innerHTML = '<div class="an-retr-empty">No pending migrations.</div>'; return; }
            listEl.innerHTML = '';
            rows.forEach(m => {
                const row = document.createElement('div'); row.className = 'an-council-row';
                const label = document.createElement('span'); label.className = 'an-council-name';
                label.textContent = `${m.noteCount} note${m.noteCount === 1 ? '' : 's'} -> ${m.destFaction} (requested by ${m.requesterId})`;
                const approve = document.createElement('button'); approve.className = 'an-btn an-btn-primary an-council-btn'; approve.textContent = 'Approve';
                approve.addEventListener('click', async () => {
                    approve.disabled = true;
                    try { await req('POST', `/api/migrations/${m.id}/approve`, {}); toast('Migration approved.', 'info'); }
                    catch (e) { toast(e?.serverResponse?.error || 'Approve failed.', 'error'); approve.disabled = false; return; }
                    const fresh = await req('GET', '/api/migrations/pending').catch(() => []);
                    renderRows(fresh); refreshPendingMigrations();
                });
                row.append(label, approve); listEl.appendChild(row);
            });
        };
        renderRows(Array.isArray(list) ? list : []);
        const close = () => overlay.remove();
        panel.querySelector('.an-mig-close').addEventListener('click', close);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
        overlay.appendChild(panel); document.body.appendChild(overlay);
    }

    function ensureMigrationUI() {
        if (location.pathname !== '/factions.php') return;
        const onArmoury = /tab=armoury/i.test(location.hash || '');

        let mbtn = document.getElementById('an-mig-btn');
        if (!onArmoury) {
            if (mbtn) mbtn.remove();
            const ab = document.getElementById('an-mig-approve-btn'); if (ab) ab.remove();
            if (migPollTimer) { clearInterval(migPollTimer); migPollTimer = null; }
            removeActionBarIfEmpty();
            return;
        }

        // Migrate Notes button (everyone) — always present on the armoury tab.
        if (!mbtn) {
            const bar = ensureActionBar();
            if (bar) {
                mbtn = document.createElement('button');
                mbtn.id = 'an-mig-btn';
                mbtn.className = 'an-btn an-retrieve-btn';
                mbtn.textContent = 'Migrate Notes';
                mbtn.title = 'Request to move notes you own from other family factions into this one';
                mbtn.addEventListener('click', requestMigration);
                bar.appendChild(mbtn);
            }
        }

        // Leader approvals: poll for pending, pulse when > 0.
        if (USER_ROLE === 'leadership' && !migPollTimer) {
            refreshPendingMigrations();
            migPollTimer = setInterval(refreshPendingMigrations, 60000);
        }
    }

    // ─── Trade owner filter (#3: filter add-list to the partner's items) ─
    // Partner name is on #step=view; the item list to filter is on #step=add.
    // We resolve the partner name → id once (user/search), stash it per-trade in
    // sessionStorage keyed by trade ID, then on #step=add offer a toggle that
    // hides every item row whose badge ownerId != the partner. ID-based match;
    // falls back to name match only if the id lookup fails.
    const TRADE_PARTNER_SS = 'an-trade-partner-';   // + tradeId  -> {id,name}
    const TRADE_FILTER_SS  = 'an-trade-filter-';    // + tradeId  -> '1' | '0'
    // The initiate step (#step=initiateTrade) shows the partner but has no trade
    // ID in the URL yet, so we stash there under a pending key and adopt it for
    // the real ID once #step=add (which has the ID) is reached.
    const TRADE_PENDING_SS = 'an-trade-partner-pending';

    function tradeHashParams() {
        const h = location.hash || '';
        const step = ((h.match(/step=([a-z]+)/i) || [])[1] || '').toLowerCase();
        const id = (h.match(/ID=(\d+)/i) || [])[1] || '';
        return { step, id };
    }

    // "Hoezey" -> "Hoezey's" ; "Chris" -> "Chris'"
    function possessive(n) {
        const s = (n || '').trim();
        if (!s) return s;
        return /s$/i.test(s) ? `${s}'` : `${s}'s`;
    }

    function readPartner(tradeId) {
        try { const v = sessionStorage.getItem(TRADE_PARTNER_SS + tradeId); return v ? JSON.parse(v) : null; } catch { return null; }
    }
    function writePartner(tradeId, p) {
        try { sessionStorage.setItem(TRADE_PARTNER_SS + tradeId, JSON.stringify(p)); } catch (e) { log('partner persist', e); }
    }
    function readPending() {
        try { const v = sessionStorage.getItem(TRADE_PENDING_SS); return v ? JSON.parse(v) : null; } catch { return null; }
    }
    function writePending(p) {
        try { sessionStorage.setItem(TRADE_PENDING_SS, JSON.stringify(p)); } catch (e) { log('pending persist', e); }
    }
    function clearPending() { try { sessionStorage.removeItem(TRADE_PENDING_SS); } catch {} }
    const getTradeFilterOn = (tradeId) => { try { return sessionStorage.getItem(TRADE_FILTER_SS + tradeId) === '1'; } catch { return false; } };
    const setTradeFilterOn = (tradeId, on) => { try { sessionStorage.setItem(TRADE_FILTER_SS + tradeId, on ? '1' : '0'); } catch (e) { log('filter persist', e); } };

    // On #step=view OR #step=initiateTrade: read the partner heading + resolve id.
    // The initiate step (fresh trade) has no ID in the hash yet, so we stash under
    // a pending key and the add step adopts it once an ID exists.
    let partnerResolveInFlight = false;
    async function captureTradePartner() {
        const { step, id } = tradeHashParams();
        if (step !== 'view' && step !== 'initiatetrade') return;

        // Where does this capture get stored? Real ID when the hash has one,
        // otherwise the pending key.
        const store = id
            ? { get: () => readPartner(id), set: (p) => writePartner(id, p) }
            : { get: () => readPending(),   set: (p) => writePending(p) };

        const existing = store.get();
        if (existing && existing.id) return;             // already fully resolved (has id)

        // The partner sits in the ".user.right" column; its ".title-black"
        // heading holds their name. (The other headings are the trade title and
        // your own side, so target the right column specifically.)
        const rightUser = document.querySelector('.user.right');
        const headingEl = rightUser?.querySelector('.title-black[role="heading"]');
        if (!headingEl) return;
        // First text node = the name; strip the "Hide item values" label/inputs.
        const clone = headingEl.cloneNode(true);
        clone.querySelectorAll('label, input, ul').forEach(n => n.remove());
        const name = (clone.textContent || '').trim();
        if (!name) return;

        // Stash the NAME immediately so the add step has it even if you navigate
        // straight away; the id is filled in below once user/search resolves.
        if (!existing || existing.name !== name) store.set({ id: null, name });

        if (partnerResolveInFlight) return;
        partnerResolveInFlight = true;
        try {
            let resolved = null;
            try {
                const matches = await searchUsers(name);
                const exact = matches.find(m => (m.name || '').toLowerCase() === name.toLowerCase()) || matches[0];
                if (exact) resolved = { id: exact.id, name: exact.name };
            } catch (e) { log('partner resolve', e); }
            store.set(resolved || { id: null, name });
        } finally { partnerResolveInFlight = false; }
    }

    // On #step=add (which has the ID): if we have no partner for this trade yet
    // but a pending one was captured on the initiate step, adopt it for this ID.
    function adoptPendingPartner() {
        const { step, id } = tradeHashParams();
        if (step !== 'add' || !id) return;
        const cur = readPartner(id);
        if (cur && cur.name) return;                     // already have it for this trade
        const pend = readPending();
        if (pend && pend.name) { writePartner(id, pend); clearPending(); return; }
        // New-tab case (ctrl/right-click "add"): this tab never saw the initiate
        // step, so there's no pending capture. Resolve straight from the trade
        // itself via the API (Limited key). Guarded to fire once per trade.
        resolvePartnerFromTradeApi(id);
    }

    const tradeApiTried = new Set();
    async function resolvePartnerFromTradeApi(id) {
        if (!id || tradeApiTried.has(id)) return;
        tradeApiTried.add(id);
        try {
            const data = await tornApi(`/user/${id}/trade`);
            const t = data?.trade;
            if (!t) return;
            // The partner is whichever side isn't us.
            const me = Number(TORN_USER_ID || 0);
            const sides = [t.trader, t.user].filter(Boolean);
            const partner = sides.find(s => Number(s.id) !== me) || sides[0];
            if (partner?.id && partner?.name) {
                writePartner(id, { id: Number(partner.id), name: partner.name });
                // Reflect it immediately if we're still on this trade's add step.
                const now = tradeHashParams();
                if (now.step === 'add' && now.id === id) { ensureTradeFilterToggle(); applyTradeFilter(); }
            }
        } catch (e) { log('trade api resolve', e); }
    }

    // On #step=add: apply the filter to the item rows.
    function tradeRowBadge(li) { return li.querySelector('.an-owner-badge'); }
    function rowMatchesPartner(li, partner) {
        const badge = tradeRowBadge(li);
        if (!badge) return false;
        if (partner.id) return badge.dataset.ownerId && Number(badge.dataset.ownerId) === Number(partner.id);
        // Fallback: match on displayed name (badge text may carry a loaned ⇠ prefix)
        const txt = (badge.textContent || '').replace(/^⇠\s*/, '').trim().toLowerCase();
        return txt && txt === (partner.name || '').toLowerCase();
    }

    function applyTradeFilter() {
        const { step, id } = tradeHashParams();
        if (step !== 'add' || !id) return;
        const on = getTradeFilterOn(id);
        const partner = readPartner(id);
        const rows = document.querySelectorAll('li.clearfix[data-group="child"]');
        rows.forEach(li => {
            if (!on || !partner) { li.style.removeProperty('display'); return; }
            li.style.display = rowMatchesPartner(li, partner) ? '' : 'none';
        });
    }

    // Toggle injected into the grey "Which items..." bar on #step=add.
    function ensureTradeFilterToggle() {
        const { step, id } = tradeHashParams();
        if (step !== 'add' || !id) return;

        const partner = readPartner(id);
        const labelText = partner?.name ? `Show only ${possessive(partner.name)} items` : "Show only partner's items";

        // Already built? Just keep its label in sync — the partner may resolve
        // after the toggle was created (freshly-created trade, id still pending).
        let existing = document.getElementById('an-trade-filter-wrap');
        if (existing) {
            const sp = existing.querySelector('span');
            if (sp && sp.textContent !== labelText) sp.textContent = labelText;
            return;
        }

        const wrap = document.createElement('label');
        wrap.id = 'an-trade-filter-wrap';
        wrap.className = 'an-trade-filter';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = getTradeFilterOn(id);
        const span = document.createElement('span');
        span.textContent = labelText;
        wrap.append(cb, span);
        cb.addEventListener('change', () => { setTradeFilterOn(id, cb.checked); applyTradeFilter(); });

        // If we built the toggle before the partner name was known, re-check a
        // few times so the label updates once the view-step lookup lands in
        // sessionStorage (no DOM mutation would otherwise re-trigger us).
        if (!partner?.name) { [400, 900, 1800, 3000].forEach(ms => setTimeout(ensureTradeFilterToggle, ms)); }

        // Preferred anchor: the ADD TO TRADE action row, placed right after the
        // "Clear all" link so it sits just after the ADD TO TRADE button.
        const clearAll = Array.from(document.querySelectorAll('a, span, div')).find(el =>
            el.children.length === 0 && /^clear all$/i.test((el.textContent || '').trim()));
        if (clearAll && clearAll.parentElement) {
            wrap.classList.add('an-trade-filter-inline');
            clearAll.insertAdjacentElement('afterend', wrap);
            return;
        }

        // Secondary anchor: the "Which items..." header bar.
        const header = Array.from(document.querySelectorAll('div.title-black')).find(el => {
            const sp = el.querySelector('span');
            return sp && /which items would you like to add to trade/i.test(sp.textContent || '');
        });
        if (header) { header.appendChild(wrap); return; }

        // Fallback: a slim bar directly above the item list, so it can never
        // silently fail to appear if Torn changes the markup.
        const firstRow = document.querySelector('li.clearfix[data-group="child"]');
        const listParent = firstRow?.parentElement;
        if (listParent && listParent.parentElement) {
            const bar = document.createElement('div');
            bar.className = 'an-trade-filter-bar';
            bar.appendChild(wrap);
            listParent.parentElement.insertBefore(bar, listParent);
        }
    }

    function tradeStepTick() {
        if (location.pathname !== '/trade.php') return;
        captureTradePartner();       // captures on #step=view / #step=initiateTrade
        adoptPendingPartner();       // #step=add: adopt the initiate-step capture
        ensureTradeFilterToggle();   // no-op unless on #step=add
        applyTradeFilter();          // re-hides after category switch / re-render
    }


    (async function bootstrap() {
        ARMOURY_KEY = getArmouryKey();
        TORN_API_KEY = getTornKey();

        const access = await getAccessRole();
        USER_ROLE = access.role || 'readonly';
        USER_CAN_WRITE = !!access.canWrite;
        TORN_USER_ID = access.userId || null;
        TORN_USER_NAME = access.name || null;

        await loadCategories();
        // Faction name/id needed for faction_owned auto-fill + external detection
        if (USER_CAN_WRITE) resolveFactionIdentity(); // fire-and-forget; cached for modal

        renderDeletionBanner();

        // Wire the settings guide whenever it renders (city.php settings page)
        UI.wireGuideField('an-armoury-key', wireSettingsGuide);

        // No armoury key yet? Nudge to settings instead of a native prompt.
        if (!ARMOURY_KEY) {
            toast('Armoury Notes: set your Armoury key in DSS → Armoury Notes settings.', 'info');
        }

        // Note UI only on enabled item/armoury/trade pages
        const pageKey = PAGE_FOR_PATH[location.pathname];
        const enabled = getEnabledPages();
        const notesUI = !!pageKey && enabled[pageKey] !== false;
        if (!notesUI) return;

        initAll();
        tradeStepTick();
        ensureRetrievalButton();
        ensureGiveButton();
        ensureMigrationUI();

        // Independent bounded poller for trade.php: partner capture / toggle /
        // filter must not depend on the mutation observer (which can be starved
        // by an initAll() throw on the view page's different DOM). Runs for a few
        // seconds after load and after each hash change; the underlying calls are
        // cheap no-ops once resolved.
        let tradePollTimer = null;
        function pollTradeStep(times = 16, gap = 400) {
            if (location.pathname !== '/trade.php') return;
            if (tradePollTimer) clearInterval(tradePollTimer);
            let n = 0;
            tradePollTimer = setInterval(() => {
                try { tradeStepTick(); } catch (e) { log('pollTradeStep', e); }
                if (++n >= times) { clearInterval(tradePollTimer); tradePollTimer = null; }
            }, gap);
        }
        pollTradeStep();

        window.addEventListener('hashchange', () => {
            setTimeout(() => { try { tradeStepTick(); } catch (e) { log('tick', e); } ensureRetrievalButton(); ensureGiveButton(); ensureMigrationUI(); }, 150);
            pollTradeStep();
        });
        let moScheduled = false;
        const pendingRoots = new Set();
        const mo = new MutationObserver((records) => {
            for (const r of records) for (const n of r.addedNodes) if (n && n.nodeType === 1) pendingRoots.add(n);
            if (moScheduled) return;
            moScheduled = true;
            setTimeout(() => {
                moScheduled = false;
                if (pendingRoots.size === 0) return;
                const roots = Array.from(pendingRoots); pendingRoots.clear();
                // Isolate each initAll so a throw on one root never blocks the
                // trade-step work (partner capture, filter toggle) that follows.
                for (const root of roots) { try { initAll(root); } catch (e) { log('initAll(root)', e); } }
                try { tradeStepTick(); } catch (e) { log('tradeStepTick', e); }
                try { ensureRetrievalButton(); } catch (e) { log('ensureRetrievalButton', e); }
                try { ensureGiveButton(); } catch (e) { log('ensureGiveButton', e); }
                try { ensureMigrationUI(); } catch (e) { log('ensureMigrationUI', e); }
            }, 150);
        });
        mo.observe(document.body, { childList: true, subtree: true });
    })();
}
});
