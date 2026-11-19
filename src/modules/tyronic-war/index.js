import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import guide from './guide.html?raw';

// ══════════════════════════════════════════════════════════════════════════════════════════
// MODULE REGISTRATIONS
// ══════════════════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// TYRONIC WAR PANEL  (was the standalone "Torn War -> Tyronic Native Panel" v3.52.3)
// ════════════════════════════════════════════════════════════════════════

registerModule('tyronic-war', {
name: 'Tyronic War Panel',
version: '3.52.3',
factions: ['9357'],
description: 'Replaces the ranked war member list with Tyronic war data: dibs, assists, live hospital timers, stat estimates, travel, activity, roll call and an attack ticker.',
pages: ['torn.com/factions.php'],
excludePages: ['step=profile'],
guide,
init() {
/* Compatibility layer: Tampermonkey/Violentmonkey provide GM_* natively; Torn PDA (mobile) provides
   PDA_httpGet/PDA_httpPost (native requests that bypass Torn\u2019s CSP) and may lack some GM_* functions. */
const DSS_GM = (() => {
  // GM_* live in the userscript's own scope under Tampermonkey (NOT on window), so test the identifiers directly.
  /* global GM_getValue, GM_setValue, GM_addStyle, GM_registerMenuCommand, GM_xmlhttpRequest, PDA_httpGet, PDA_httpPost */
  const gm = {
getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
addStyle: typeof GM_addStyle === 'function' ? GM_addStyle : null,
menu: typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : null,
xhr: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
pdaGet: typeof PDA_httpGet === 'function' ? PDA_httpGet : null,
pdaPost: typeof PDA_httpPost === 'function' ? PDA_httpPost : null,
  };
  const LS = 'dss-ty:';
  // In Torn PDA, GM_xmlhttpRequest is a compatibility shim - use PDA's native HTTP functions directly instead.
  const isPDA = !!(gm.pdaPost || gm.pdaGet);
  const env = isPDA ? 'Torn PDA (native)' : gm.xhr ? 'userscript manager' : 'none';
  return {
env,
// inside DSS the GM storage is shared with the other modules: keep ours under a 'tyr_' prefix. With no key of
// its own yet, the panel uses the API key saved in the DSS settings.
getValue: (k, d) => {
  let v;
  if (gm.getValue) v = gm.getValue('tyr_' + k, d);
  else { try { const raw = localStorage.getItem(LS + k); v = raw == null ? d : JSON.parse(raw); } catch (_) { v = d; } }
  if (k === 'tornKey' && !v) { try { const s = Storage.getSettings(); if (s && s.apiKey) return s.apiKey; } catch (_) { /* no DSS key */ } }
  return v;
},
setValue: gm.setValue ? ((k, v) => gm.setValue('tyr_' + k, v))
  : ((k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } }),
addStyle: gm.addStyle || (css => { const el = document.createElement('style'); el.textContent = css; (document.head || document.documentElement).appendChild(el); return el; }),
registerMenuCommand: gm.menu || (() => {}),
xmlhttpRequest: (!isPDA && gm.xhr) || ((o) => {
  const done = r => {
    let text = r && (r.responseText != null ? r.responseText : r.body != null ? r.body : r.data);
    if (text != null && typeof text !== 'string') { try { text = JSON.stringify(text); } catch (_) { text = String(text); } }
    const status = Number(r && (r.status != null ? r.status : r.statusCode)) || 0;
    if (!status) return o.onerror && o.onerror();
    o.onload && o.onload({ status, responseText: text || '' });
  };
  const fail = () => o.onerror && o.onerror();
  let data = o.data || '';
  if (typeof data !== 'string') data = JSON.stringify(data);
  try {
    if (gm.pdaPost && o.method === 'POST') return Promise.resolve(gm.pdaPost(o.url, o.headers || {}, data)).then(done, fail);
    if (gm.pdaGet && (o.method || 'GET') === 'GET') return Promise.resolve(gm.pdaGet(o.url, o.headers || {})).then(done, fail);
  } catch (e) { fail(e); return; }
  // No cross-origin transport: a page fetch would just be blocked by Torn's CSP, so fail clearly instead.
  setTimeout(() => o.onerror && o.onerror(new Error('no cross-origin transport')), 0);
}),
  };
})();

(function () {
  'use strict';
  if (document.documentElement.dataset.dssTyronic) return;     // already running (e.g. the standalone script too)
  document.documentElement.dataset.dssTyronic = 'dss';
  const GM_getValue = DSS_GM.getValue, GM_setValue = DSS_GM.setValue, GM_addStyle = DSS_GM.addStyle,
GM_registerMenuCommand = DSS_GM.registerMenuCommand, GM_xmlhttpRequest = DSS_GM.xmlhttpRequest;

  // ================= config =================
  const SB = 'https://iwmpklkqwlniguyeaygv.supabase.co';
  const PUB_KEY = 'sb_publishable_HhDjKMdmr14Xjc6yqgXOkw_E7EJT4uK'; // Supabase publishable key (public by design)
  const SCHEMA = 'tyapi';
  const MIN_POLL_S = 3;                  // fastest allowed refresh (seconds)
  const pollMs = () => Math.max(MIN_POLL_S, Number(GM_getValue('pollSec', MIN_POLL_S)) || MIN_POLL_S) * 1000;
  const BOX_ID = 'dss-ty';
  const HIDE = 'dss-ty-hidden';

  // ================= state =================
  let state = null, lastFetch = 0, lastAsked = 0, busyAt = 0, error = null, busy = false, showOriginal = !!GM_getValue('showOriginal', false), pending = null;
  let view = GM_getValue('view', 'enemy');
  let filter = GM_getValue('filter', 'all');     // all | available | online
  let stFilter = GM_getValue('stFilter', 'all');  // all | okay | hosp | travel
  let revFilter = GM_getValue('revFilter', 'all') === 'yes' ? 'yes' : 'all'; // all | yes (only revivable)
  let ctryFilter = new Set(GM_getValue('ctryFilter', []) || []);  // country keys picked while the Travel filter is on (empty = all)
  // every page load starts on Status (\u2193: OK, then hospital soonest out, then travel) - like Tyronic's default;
  // clicking a header still re-sorts for the rest of the visit
  let sortKey = 'status';
  let sortDir = 1;
  let search = '';
  let failStreak = 0;
  let lastScrollLeft = 0, lastScrollTop = 0, lastViewKey = '';

  GM_registerMenuCommand('Tyronic panel settings', () => openSettings(true));

  // ---- in-panel settings drawer (no browser prompt) ----
  function openSettings(force) {
const box = document.getElementById(BOX_ID);
if (!box) return;
const cfg = box.querySelector('.cfg');
const open = force === true ? true : force === false ? false : cfg.hidden;
cfg.hidden = !open;
box.querySelector('[data-a=key]').classList.toggle('on', open);
if (open) {
  cfg.querySelector('#dss-poll').value = pollMs() / 1000;
  cfg.querySelector('#dss-rev').value = revPerMin();
  cfg.querySelector('#dss-revevery').value = revEvery();
  cfg.querySelector('#dss-dibwarn').value = dibWarnSec();
  cfg.querySelectorAll('.seg[data-g=pres] button').forEach(b => b.classList.toggle('on', b.dataset.v === presMode()));
  const inp = cfg.querySelector('.keyin');
  inp.value = GM_getValue('tornKey', '');
  inp.classList.add('masked');
  cfg.querySelector('.cfg-status').textContent = GM_getValue('tornKey', '') ? '' : 'Paste the Torn API key you use on tyronic.io.';
  cfg.querySelector('.cfg-status').className = 'cfg-status';
  setTimeout(() => inp.focus(), 0);
}
  }

  async function saveKey(key) {
const box = document.getElementById(BOX_ID);
const st = box.querySelector('.cfg-status');
key = (key || '').trim();
if (!/^[A-Za-z0-9]{16}$/.test(key)) { st.textContent = 'That doesn\u2019t look like a Torn API key (16 letters/numbers).'; st.className = 'cfg-status err'; return; }
st.textContent = 'Checking with Tyronic\u2026'; st.className = 'cfg-status';
const prevKey = GM_getValue('tornKey', ''), prevSession = GM_getValue('session', null);
GM_setValue('tornKey', key);
GM_setValue('session', null);
try {
  await newToken();                                   // validates the new key (own login, never a shared one) + initial state
  error = null;
  const me = state && state.user && (memberName(state.user.user_id) || `#${state.user.user_id}`);
  st.textContent = `Connected${me ? ' as ' + me : ''}.`; st.className = 'cfg-status ok';
  revStop = null; revPauseUntil = 0;                  // new key -> resume revive checks
  render();
  setTimeout(() => openSettings(false), 1200);
  refresh(true);
} catch (e) {
  GM_setValue('tornKey', prevKey); GM_setValue('session', prevSession);   // keep the old working key
  st.textContent = `Tyronic rejected that key \u2014 ${e.message}`; st.className = 'cfg-status err';
}
  }

  function memberName(id) {
for (const f of [state && state.home_faction, state && state.away_faction])
  for (const m of (f && f.members) || []) if (m.player_id === id) return m.name;
return null;
  }

  // ================= network =================
  // Desktop (Tampermonkey/Violentmonkey): requests run in parallel, so a dib never waits behind a refresh,
  // revive check or Torn status read.
  // Torn PDA: its native HTTP bridge can fail one of two overlapping calls, so requests go one at a time -
  // but actions (dib, assist, roll call) jump to the front of the line.
  const SERIAL = DSS_GM.env === 'Torn PDA (native)';
  // attack links: same tab on Torn PDA (a new tab there is clumsy to get back from), new tab on desktop
  const ATK_TARGET = SERIAL ? '_self' : '_blank';
  const reqQueue = [];
  let reqActive = false;
  function req(method, url, headers, body, priority) {
if (!SERIAL) return reqOnce(method, url, headers, body);
return new Promise((resolve, reject) => {
  const job = { run: () => reqOnce(method, url, headers, body).then(resolve, reject) };
  if (priority) reqQueue.unshift(job); else reqQueue.push(job);
  reqPump();
});
  }
  function reqPump() {
if (reqActive || !reqQueue.length) return;
reqActive = true;
reqQueue.shift().run().then(() => { reqActive = false; reqPump(); });
  }

  // Every request is guaranteed to finish: besides the normal callbacks we handle onabort and keep our own
  // watchdog, because a request whose callbacks never fire (aborted by the browser/extension, network switch,
  // sleep/wake) used to leave the panel 'busy' for good - no more refreshes, dibs never showing - until a page reload.
  const REQ_TIMEOUT = 20000;
  function reqOnce(method, url, headers, body) {
return new Promise((res, rej) => {
  let done = false;
  const resolve = v => { if (!done) { done = true; clearTimeout(dog); res(v); } };
  const reject = e => { if (!done) { done = true; clearTimeout(dog); rej(e); } };
  const dog = setTimeout(() => reject(Object.assign(new Error('Request timed out'), { network: true, watchdog: true })), REQ_TIMEOUT + 5000);
  GM_xmlhttpRequest({
    method, url, headers,
    data: body !== undefined ? JSON.stringify(body) : undefined,
    timeout: REQ_TIMEOUT,
    onabort: () => reject(Object.assign(new Error('Request aborted'), { network: true })),
    onload: r => {
      let json = null;
      try { json = JSON.parse(r.responseText); } catch (_) { /* empty / non-JSON */ }
      if (r.status >= 200 && r.status < 300) return resolve(json);
      // PostgREST errors carry code/message/hint - surface them so a wrong name/arg is obvious
      const msg = json && (json.message || json.error || json.msg);
      const hint = json && (json.hint || json.details);
      reject(Object.assign(new Error(`HTTP ${r.status}${msg ? ': ' + msg : ''}${hint ? ' \u2014 ' + hint : ''}`),
        { status: r.status, code: json && json.code, hint, body: json || r.responseText }));
    },
    onerror: () => reject(Object.assign(new Error(DSS_GM.env === 'none'
      ? 'No way to reach Tyronic from this page \u2014 install via Tampermonkey/Violentmonkey (with GM_xmlhttpRequest granted) or Torn PDA'
      : 'Network error'), { network: true })),
    ontimeout: () => reject(Object.assign(new Error('Request timed out'), { network: true })),
  });
});
  }

  // register-session trades the Torn key for a ~30 min JWT (and returns an initial state snapshot)
  // share one login between everyone who needs a fresh token at the same moment
  let tokenInFlight = null;
  function getToken(force) {
const s = GM_getValue('session', null);
if (!force && s && Date.parse(s.expires_at) - Date.now() > 120000) return Promise.resolve(s.token);
if (!tokenInFlight) tokenInFlight = newToken().finally(() => { tokenInFlight = null; });
return tokenInFlight;
  }
  async function newToken() {
const key = GM_getValue('tornKey', '');
if (!key) throw Object.assign(new Error('No Torn API key set'), { needKey: true });
const res = await req('POST', `${SB}/functions/v1/register-session`, {
  'Content-Type': 'application/json', apikey: PUB_KEY, Authorization: `Bearer ${PUB_KEY}`,
}, { torn_api_key: key });
if (!res || !res.token) throw new Error('register-session returned no token');
GM_setValue('session', { token: res.token, expires_at: res.expires_at });
if (res.state) { state = res.state; lastFetch = lastAsked = Date.now(); liveOnTyronic(true); }
return res.token;
  }

  // authenticated PostgREST call against the tyapi schema (rpc or table)
  async function pg(method, path, body, retried, priority) {
const token = await getToken(false);
try {
  return await req(method, `${SB}/rest/v1/${path}`, {
    'Content-Type': 'application/json',
    'Content-Profile': SCHEMA,
    'Accept-Profile': SCHEMA,
    Prefer: 'return=representation',
    apikey: PUB_KEY,
    Authorization: `Bearer ${token}`,
  }, body, priority);
} catch (e) {
  if (!retried && (e.status === 401 || (e.status === 403 && /jwt/i.test(e.message)))) {
    await getToken(true);
    return pg(method, path, body, true, priority);
  }
  throw e;
}
  }
  const ACTIONS = { setdib: 1, removedib: 1, assistdib: 1, updaterollcall: 1, updateconfig: 1 };   // user clicks: never wait in line
  // Tyronic's action RPCs answer HTTP 200 with { code, status } - a refusal comes back as e.g. { code: 400, status: '...' },
  // so treat a non-2xx code in the body as a failure (shown in the error toast) instead of silent success.
  async function rpc(name, args) {
const out = await pg('POST', `rpc/${name}`, args || {}, false, !!ACTIONS[name]);
if (ACTIONS[name] && out && typeof out === 'object' && !Array.isArray(out) && out.code != null && !(+out.code >= 200 && +out.code < 300))
  throw Object.assign(new Error(out.status || out.message || `Tyronic refused (code ${out.code})`), { tyronic: out });
return out;
  }

  // One refresh at a time. A forced one (after an action, the refresh button, back on the tab) that arrives while
  // another is running is queued to run straight after it; timed polls just skip. Requests always finish (watchdog
  // above), so 'busy' can't get stuck.
  let refreshAgain = false;
  async function refresh(force) {
if (!GM_getValue('tornKey', '')) {
  error = Object.assign(new Error('No Torn API key set'), { needKey: true }); render();
  const cfg = document.querySelector(`#${BOX_ID} .cfg`);
  if (cfg && cfg.hidden && !refresh.askedKey) { refresh.askedKey = true; openSettings(true); }   // once, so typing isn't wiped
  return;
}
refresh.askedKey = false;
if (busy) { if (force) refreshAgain = true; return; }
if ((!force && document.hidden) || !document.getElementById(BOX_ID)) return;
busy = true; busyAt = Date.now(); tick();
const asked = busyAt;
try {
  try { state = await rpc('getstate', {}); }
  catch (e) {
    if (!e.network) throw e;
    await new Promise(r => setTimeout(r, 700));        // one quiet retry for transient network blips
    state = await rpc('getstate', {});
  }
  lastFetch = Date.now(); lastAsked = asked; error = null; failStreak = 0;
  liveOnTyronic(true);
} catch (e) {
  failStreak++;
  if (failStreak >= 2 || !state) error = e;           // keep showing the last good data for a single miss
  liveOnTyronic(false);
} finally {
  busy = false;
  render();
  if (refreshAgain) { refreshAgain = false; refresh(true); }
}
  }

  // ================= dib / assist API =================
  // Same calls Tyronic's own frontend makes (tyapi schema RPCs).
  const api = {
setDib: (foe, assist = false) => rpc('setdib', {
  _dib: { faction_id: state.user.faction_id, player_id: state.user.user_id, foe_id: foe, sticky: false, assist: !!assist },
}),
removeDib: (d) => rpc('removedib', { _dibid: d.dib_id }),
// takes the whole (modified) dib: joining/leaving assists, or toggling assist_enabled on your own dib
assistDib: (d, ids, extra) => rpc('assistdib', { _dib: Object.assign({}, d, { assist_player_ids: ids }, extra || {}) }),
  };

  // Request/cancel assists on MY dib - exactly what Tyronic's button does:
  // flip assist_enabled, clear assist_player_ids, send the whole dib via assistdib(_dib).
  function setAssistRequest(d, on) {
return api.assistDib(d, [], { assist_enabled: on });
  }

  const dibsByFoe = () => {
const out = {};
for (const d of state.dibs || []) if (d && d.foe_id != null) out[d.foe_id] = d;
return out;
  };

  // ---- optimistic actions ----
  // A click changes the panel straight away (your dib / undib / assist shows instantly), then Tyronic's reply
  // confirms it. Until a refresh shows the change for real we keep re-applying it on top of each refresh, so a
  // refresh that started before the click can't make it flicker back. Gives up after OPT_MS (or on an error).
  const OPT_MS = 15000;
  let optimistic = null;                 // { key, until, apply(st), confirmed(st), done }
  function optOverlay() {
if (!optimistic || !state) return;
if (optimistic.confirmed(state)) { if (pending === optimistic.key) pending = null; optimistic = null; return; }
if (Date.now() > optimistic.until) { if (pending === optimistic.key) pending = null; optimistic = null; return; }
optimistic.apply(state);
  }
  const myDibOn = (st, foe, me) => (st.dibs || []).some(x => x && x.foe_id === foe && x.player_id === me);
  function optFor(kind, foeId, d, me) {
const key = `${kind}:${foeId}`, until = Date.now() + OPT_MS;
if (kind === 'dib' && !d) return { key, until,
  apply: st => { if (!myDibOn(st, foeId, me)) st.dibs = [...(st.dibs || []), { dib_id: -1, foe_id: foeId, player_id: me,
    assist_player_ids: [], assist_enabled: false, dib_window_resolved: true, created_at: new Date().toISOString(), optimistic: true }]; },
  confirmed: st => (st.dibs || []).some(x => x && x.foe_id === foeId && x.player_id === me && !x.optimistic) };
if (kind === 'dib' && d && d.player_id === me) return { key, until,
  apply: st => { st.dibs = (st.dibs || []).filter(x => !(x && x.foe_id === foeId && x.player_id === me)); },
  confirmed: st => !myDibOn(st, foeId, me) };
if (kind === 'assist' && d) {
  const joining = !(d.assist_player_ids || []).includes(me);
  const has = st => { const x = (st.dibs || []).find(y => y && y.dib_id === d.dib_id); return !!x && (x.assist_player_ids || []).includes(me); };
  return { key, until,
    apply: st => { const x = (st.dibs || []).find(y => y && y.dib_id === d.dib_id); if (!x) return;
      const cur = x.assist_player_ids || []; x.assist_player_ids = joining ? (cur.includes(me) ? cur : [...cur, me]) : cur.filter(y => y !== me); },
    confirmed: st => has(st) === joining || !(st.dibs || []).some(y => y && y.dib_id === d.dib_id) };
}
if (kind === 'request' && d && d.player_id === me) {
  const on = !d.assist_enabled;
  return { key, until,
    apply: st => { const x = (st.dibs || []).find(y => y && y.dib_id === d.dib_id); if (x) { x.assist_enabled = on; x.assist_player_ids = []; } },
    confirmed: st => { const x = (st.dibs || []).find(y => y && y.dib_id === d.dib_id); return !x || !!x.assist_enabled === on; } };
}
return null;
  }

  let actionBusy = false;                                 // one dib/assist action in flight at a time
  async function doAction(kind, foeId) {
const me = state.user.user_id;
// a copy as it was at the click: the instant (optimistic) change below edits the live dib object, and the request
// must be built from the old values (otherwise "request assist" sends assist_enabled:false, "assist" sends a leave)
const live0 = dibsByFoe()[foeId];
const d = live0 && Object.assign({}, live0, { assist_player_ids: [...(live0.assist_player_ids || [])] });
if (d && d.optimistic) { toast('Still saving your dib\u2026', 'warn', 2000); return; }
if (actionBusy) return;                               // still sending the last click: a double tap would undo it
pending = `${kind}:${foeId}`;
// show it now (not for dib windows - who wins is decided by Tyronic)
const opt = !(d && d.dib_window_resolved === false) ? optFor(kind, foeId, d, me) : null;
const before = { st: state, dibs: state.dibs && state.dibs.map(x => x && Object.assign({}, x, x.assist_player_ids ? { assist_player_ids: [...x.assist_player_ids] } : {})) };
if (opt) {
  const mineCount = (state.dibs || []).filter(x => x && x.player_id === me).length;
  const max = (state.factionconfig && state.factionconfig.num_dibs) || 1;
  if (!(kind === 'dib' && !d && mineCount >= max)) { optimistic = opt; opt.apply(state); }
}
render();
actionBusy = true;                                    // (set right before the request, cleared in its finally)
let failed = false;
try {
  if (kind === 'dib') {
    if (d && d.dib_window_resolved === false) { await api.setDib(foeId, false); toast(`Joined dib window on ${nameOf(foeId)}`, 'ok'); }
    else if (d && d.player_id === me) { await api.removeDib(d); toast('Dib removed', 'ok'); }
    else if (d) toast(`Already dibbed by ${nameOf(d.player_id)}`, 'warn');
    else {
      const mineCount = (state.dibs || []).filter(x => x && x.player_id === me && !x.optimistic).length;
      const max = (state.factionconfig && state.factionconfig.num_dibs) || 1;
      if (mineCount >= max) toast(`You already have ${mineCount}/${max} dib${max > 1 ? 's' : ''} \u2014 undib first`, 'warn');
      else {
        await api.setDib(foeId, false);
        toast(`Dibbed ${nameOf(foeId)}`, 'ok');
      }
    }
  } else if (kind === 'request' && d && d.player_id === me) {
    const on = !d.assist_enabled;
    await setAssistRequest(d, on);
    toast(on ? `Assist requested on ${nameOf(foeId)}` : 'Assist request cancelled', 'ok');
  } else if (kind === 'assist' && d) {
    const cur = d.assist_player_ids || [];
    const joining = !cur.includes(me);
    await api.assistDib(d, joining ? [...cur, me] : cur.filter(x => x !== me));
    toast(joining ? `Assisting ${nameOf(d.player_id)} on ${nameOf(foeId)}` : 'Stopped assisting', 'ok');
  }
} catch (e) {
  failed = true;
  toast(`${{ dib: 'Dib', assist: 'Assist', request: 'Assist request' }[kind]} failed \u2014 ${e.message}`, 'err', 10000);
} finally {
  if (optimistic === opt && opt) { if (failed) optimistic = null; else optimistic.until = Math.min(optimistic.until, Date.now() + 5000); }
  if (failed && opt && state === before.st) state.dibs = before.dibs;   // undo the instant change (no newer data yet)
  actionBusy = false;
  if (pending === `${kind}:${foeId}`) pending = null;
  render();
  refresh(true);
}
  }

  // ================= roll call (Tyronic) =================
  // getstate.rollcall rows: { war_id, player_id, start_online, chain_watch, start_hosped, hour_online, note }
  //   start_online / chain_watch: true = Yes, false = No, null = Maybe
  //   start_hosped / hour_online are only asked when the player isn't sure to be online at start (hour = TCT 0-23, null = don't know)
  // Submitting: rpc/updaterollcall with { _data: { start_online, start_hosped, hour_online, chain_watch, note } }
  // (same call Tyronic's own form makes; war and player come from the session token)
  const ROLLCALL_RPC = 'updaterollcall';
  function rollIdx() {
const out = {}, war = state && state.wardata && state.wardata.war_id;
for (const r of (state && state.rollcall) || []) if (r && (war == null || r.war_id === war)) out[r.player_id] = r;
return out;
  }
  const rollOn = () => !!(state && state.factionconfig && state.factionconfig.rollcall_enabled);
  const ynm = v => v === true ? 'Yes' : v === false ? 'No' : 'Maybe';
  const ynmCls = v => v === true ? 'y' : v === false ? 'n' : 'm';
  const hourTxt = h => h == null ? 'Don\u2019t know' : `${String(h).padStart(2, '0')}:00 TCT`;
  function rollTip(r) {
if (!r) return 'No roll call';
const lines = ['Roll call', `Online at start: ${ynm(r.start_online)}`];
if (r.start_online !== true) {
  lines.push(`Self-hosp: ${r.start_hosped == null ? '\u2014' : ynm(r.start_hosped)}`, `Online at: ${hourTxt(r.hour_online)}`);
}
lines.push(`Chain-watch abroad: ${ynm(r.chain_watch)}`);
if (r.note) lines.push(`Note: ${r.note}`);
return lines.join('\n');
  }
  // sort: answered first - online at start Yes, Maybe, No - then unanswered
  const rollRank = r => !r ? 9 : r.start_online === true ? 0 : r.start_online == null ? 1 : 2;

  // ================= activity by hour (Tyronic's history) =================
  // getstate.home_activity / away_activity: 168 rows { d: 1-7 (Mon-Sun), h: 0-23 TCT, v: average active members }.
  // Shown as one line per faction for a chosen day; today (TCT) by default.
  const ACT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ACT_C = { ours: '#3b8fe8', enemy: '#e5484d' };   // validated pair for the dark surface (CVD-safe, unlike green/red)
  let actDay = null;                                       // 1-7, null = today
  const tctDow = (t = Date.now()) => new Date(t).getUTCDay() || 7;
  function actSeries(day) {
const { ours, enemy } = sides(), oursHome = state.home_faction === ours;
const pick = arr => { const out = Array(24).fill(null); for (const a of arr || []) if (a && a.d === day && a.h >= 0 && a.h < 24) out[a.h] = +a.v; return out; };
return [
  { key: 'ours', name: (ours.info && ours.info.name) || 'Us', n: (ours.members || []).length, v: pick(oursHome ? state.home_activity : state.away_activity) },
  { key: 'enemy', name: (enemy.info && enemy.info.name) || 'Them', n: (enemy.members || []).length, v: pick(oursHome ? state.away_activity : state.home_activity) },
];
  }
  function actOpen() { const m = document.querySelector(`#${BOX_ID} .acm`); if (!m) return; actDay = null; m.hidden = false; fitOverlays(); actPaint(); }
  function actClose() { const m = document.querySelector(`#${BOX_ID} .acm`); if (m) m.hidden = true; }
  function actPaint() {
const m = document.querySelector(`#${BOX_ID} .acm`);
if (!m || m.hidden || !state) return;
const today = tctDow(), day = actDay || today;
m.querySelector('.acm-days').innerHTML = ACT_DAYS.map((n, i) => `<button type="button" data-d="${i + 1}" class="${i + 1 === day ? 'on' : ''}">${n}${i + 1 === today ? '<i></i>' : ''}</button>`).join('');
const S = actSeries(day), all = S.flatMap(x => x.v).filter(v => v != null);
const plot = m.querySelector('.acm-plot');
if (!all.length) { plot.innerHTML = '<div class="muted acm-none">No activity history from Tyronic yet.</div>'; m.querySelector('.acm-sum').textContent = ''; return; }
// drawn at the plot's real width so text stays a readable size on phones
const W = Math.round(Math.max(320, Math.min(640, plot.clientWidth || 600))), H = W < 480 ? 190 : 210, L = 28, R = 90, T = 10, B = 24, pw = W - L - R, ph = H - T - B;
const step = all.length && Math.max(...all) > 40 ? 20 : 10, top = Math.max(step, Math.ceil(Math.max(...all) / step) * step);
const x = h => L + (h / 23) * pw, y = v => T + ph - (v / top) * ph;
let g = '';
for (let v = 0; v <= top; v += step) g += `<line class="gl" x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
for (let h = 0; h < 24; h += (W < 480 ? 6 : 3)) g += `<text class="ax" x="${x(h)}" y="${H - 6}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`;
const wd = state.wardata || {}, ws = Date.parse(wd.warstart);
if (isFinite(ws) && tctDow(ws) === day) { const wh = new Date(ws).getUTCHours() + new Date(ws).getUTCMinutes() / 60;
  g += `<line class="mk" x1="${x(wh)}" x2="${x(wh)}" y1="${T}" y2="${T + ph}"/><text class="mkt" x="${x(wh) + 4}" y="${T + 9}">war start</text>`; }
if (day === today) { const nh = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  g += `<line class="now" x1="${x(nh)}" x2="${x(nh)}" y1="${T}" y2="${T + ph}"/><text class="mkt" x="${x(nh) + 4}" y="${T + ph - 4}">now</text>`; }
// lines + direct labels at the right end (nudged apart if they'd overlap)
const ends = S.map(sr => { const last = sr.v.reduce((a, v, h) => v != null ? h : a, -1); return last < 0 ? null : { sr, h: last, yy: y(sr.v[last]) }; }).filter(Boolean);
if (ends.length === 2 && Math.abs(ends[0].yy - ends[1].yy) < 14) { const [a, b2] = ends[0].yy < ends[1].yy ? ends : [ends[1], ends[0]]; const mid = (a.yy + b2.yy) / 2; a.yy = mid - 7; b2.yy = mid + 7; }
for (const sr of S) {
  const pts = sr.v.map((v, h) => v == null ? null : `${x(h).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
  if (pts) g += `<polyline class="ln" points="${pts}" stroke="${ACT_C[sr.key]}"/>`;
}
for (const e of ends) g += `<text class="dl" x="${x(e.h) + 6}" y="${e.yy + 4}"><tspan fill="${ACT_C[e.sr.key]}">\u25cf</tspan> ${esc(e.sr.name.length > 12 ? e.sr.name.slice(0, 11) + '\u2026' : e.sr.name)}</text>`;
g += `<g class="hov" visibility="hidden"><line class="xh" y1="${T}" y2="${T + ph}"/>${S.map(sr => `<circle r="4" data-k="${sr.key}" fill="${ACT_C[sr.key]}"/>`).join('')}</g>`;
g += `<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`;
plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Average active members by hour on ${ACT_DAYS[day - 1]}: ` + S.map(sr => `${sr.name} peak ${Math.round(Math.max(...sr.v.filter(v => v != null)))}`).join(', '))}">${g}</svg><div class="acm-tip" hidden></div>`;
m.querySelector('.acm-leg').innerHTML = S.map(sr => `<span><i style="background:${ACT_C[sr.key]}"></i>${esc(sr.name)} <span class="muted">(${sr.n})</span></span>`).join('');
const peak = sr => { let bh = -1, bv = -1; sr.v.forEach((v, h) => { if (v != null && v > bv) { bv = v; bh = h; } }); return bh < 0 ? '' : `${esc(sr.name)} peaks ${String(bh).padStart(2, '0')}:00 (${Math.round(bv)})`; };
m.querySelector('.acm-sum').innerHTML = S.map(peak).filter(Boolean).join(' \u00b7 ');
// hover: nearest hour -> crosshair, dots, tooltip
const svgEl = plot.querySelector('svg'), hov = svgEl.querySelector('.hov'), tip = plot.querySelector('.acm-tip');
const move = ev => {
  const r = svgEl.getBoundingClientRect(), pt = ev.touches ? ev.touches[0] : ev;
  const h = Math.max(0, Math.min(23, Math.round(((pt.clientX - r.left) / r.width * W - L) / pw * 23)));
  hov.setAttribute('visibility', 'visible');
  hov.querySelector('.xh').setAttribute('x1', x(h)); hov.querySelector('.xh').setAttribute('x2', x(h));
  for (const c of hov.querySelectorAll('circle')) { const sr = S.find(z => z.key === c.dataset.k), v = sr.v[h];
    c.setAttribute('visibility', v == null ? 'hidden' : 'visible'); if (v != null) { c.setAttribute('cx', x(h)); c.setAttribute('cy', y(v)); } }
  tip.innerHTML = `<b>${ACT_DAYS[day - 1]} ${String(h).padStart(2, '0')}:00 TCT</b>` + S.map(sr => `<div><i style="background:${ACT_C[sr.key]}"></i>${esc(sr.name)}<span class="num">${sr.v[h] == null ? '\u2014' : Math.round(sr.v[h])}</span></div>`).join('');
  tip.hidden = false;
  const px = x(h) / W * r.width, tw = tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(r.width - tw, px + (px > r.width / 2 ? -tw - 12 : 12)))}px`;
};
const leave = () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
const hit = svgEl.querySelector('.hit');
hit.addEventListener('mousemove', move); hit.addEventListener('mouseleave', leave);
hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true });
  }

  // ================= roll call summary =================
  // Everyone in our faction against the current war's roll call: one bar per question (tap a part to list who),
  // when the not-at-start players say they'll be on, and the notes.
  const RS_COLS = { y: 'var(--ok)', m: 'var(--warn)', n: 'var(--red)', x: '#3d4048' };
  const RS_TXT = { y: 'Yes', m: 'Maybe', n: 'No', x: 'No answer' };
  let rsPick = null;                                       // { q, v } group whose names are listed
  let rsNotesOpen = false;                                 // notes start collapsed
  function rsOpen() { const m = document.querySelector(`#${BOX_ID} .rsm`); if (!m) return; rsPick = { q: 'start', v: 'x' }; rsNotesOpen = false; m.hidden = false; fitOverlays(); rsPaint(); }
  function rsClose() { const m = document.querySelector(`#${BOX_ID} .rsm`); if (m) m.hidden = true; }
  function rsData() {
const { ours } = sides(), rolls = rollIdx(), members = [...(ours.members || [])].sort((a, b) => a.name.localeCompare(b.name));
const later = members.filter(m => rolls[m.player_id] && rolls[m.player_id].start_online !== true);
const key = v => v === true ? 'y' : v === false ? 'n' : 'm';
const Q = {
  start: { label: 'Online at start', who: members, val: m => rolls[m.player_id] ? key(rolls[m.player_id].start_online) : 'x', order: ['y', 'm', 'n', 'x'] },
  hosp: { label: 'Self-hosp before start', who: later, val: m => { const r = rolls[m.player_id]; return r.start_hosped == null ? 'x' : r.start_hosped ? 'y' : 'n'; }, order: ['y', 'n', 'x'], note: 'of those not sure to be on at start' },
  watch: { label: 'Chain-watch abroad', who: members.filter(m => rolls[m.player_id]), val: m => key(rolls[m.player_id].chain_watch), order: ['y', 'm', 'n'] },
};
for (const k in Q) { const q = Q[k]; q.groups = {}; for (const v of q.order) q.groups[v] = []; for (const m of q.who) (q.groups[q.val(m)] = q.groups[q.val(m)] || []).push(m); }
return { members, rolls, later, Q };
  }
  function rsPaint() {
const box = document.getElementById(BOX_ID), m = box && box.querySelector('.rsm');
if (!m || m.hidden || !state) return;
const { members, rolls, later, Q } = rsData();
const answered = members.filter(x => rolls[x.player_id]).length;
m.querySelector('.rsm-top').innerHTML = `<b class="num">${answered}</b><span class="muted">/${members.length} answered</span>`;
// one bar per question
m.querySelector('.rsm-qs').innerHTML = Object.entries(Q).map(([k, q]) => {
  const tot = q.who.length || 1;
  const seg = q.order.filter(v => q.groups[v].length).map(v => `<button type="button" class="rs-seg ${rsPick && rsPick.q === k && rsPick.v === v ? 'on' : ''}" data-rq="${k}" data-rv="${v}" style="flex:${q.groups[v].length};background:${RS_COLS[v]}" title="${RS_TXT[v]}: ${q.groups[v].length}"></button>`).join('');
  const leg = q.order.filter(v => q.groups[v].length || (rsPick && rsPick.q === k && rsPick.v === v)).map(v => `<button type="button" class="rs-key ${rsPick && rsPick.q === k && rsPick.v === v ? 'on' : ''}" data-rq="${k}" data-rv="${v}"><i style="background:${RS_COLS[v]}"></i>${RS_TXT[v]} <b class="num">${q.groups[v].length}</b><span class="muted num">${Math.round(q.groups[v].length / tot * 100)}%</span></button>`).join('');
  return `<div class="rs-q"><div class="rs-qh">${q.label}${q.note ? ` <span class="muted">(${q.who.length} ${q.note})</span>` : ''}</div>
        ${q.who.length ? `<div class="rs-bar">${seg}</div>` : '<div class="muted rs-empty">Nobody yet</div>'}<div class="rs-keys">${leg}</div></div>`;
}).join('');
// names for the picked group
const pick = rsPick && Q[rsPick.q], names = pick ? pick.groups[rsPick.v] || [] : [];
m.querySelector('.rsm-names').innerHTML = !pick ? '' : `<div class="rs-nh"><span><i style="background:${RS_COLS[rsPick.v]}"></i>${pick.label}: <b>${RS_TXT[rsPick.v]}</b> <span class="muted">(${names.length})</span></span>
        ${names.length ? '<button type="button" class="ghost" data-a="rscopy">Copy names</button>' : ''}</div>
      <div class="rs-groups">${names.length ? rsBands(names).map(bd => `<div class="rs-band"><div class="rs-bh">${bd.label} <span class="muted">(${bd.list.length})</span></div><div class="rs-chips">`
    + bd.list.map(({ m: x, v }) => { const r = rolls[x.player_id];
      const extra = rsPick.q === 'start' && r && r.start_online !== true && r.hour_online != null ? ` <span class="muted num">${String(r.hour_online).padStart(2, '0')}h</span>` : '';
      return `<a class="rs-chip" href="https://www.torn.com/profiles.php?XID=${x.player_id}" target="_blank"><span class="dot ${esc(x.active_status)}"></span>${esc(x.name)}${v ? ` <span class="muted num">${fmtBS(v)}</span>` : ''}${extra}</a>`; }).join('')
    + '</div></div>').join('') : '<span class="muted">Nobody</span>'}</div>`;
// when the not-at-start players come online (TCT)
const hrs = Array(24).fill(0); let unknown = 0;
for (const x of later) { const h = rolls[x.player_id].hour_online; if (h == null || h < 0 || h > 23) unknown++; else hrs[h]++; }
const hp = m.querySelector('.rsm-hours'), max = Math.max(1, ...hrs);
if (!later.length) hp.innerHTML = '';
else if (!hrs.some(Boolean)) hp.innerHTML = `<div class="rs-qh">When the rest come online <span class="muted">(nobody gave an hour \u00b7 ${unknown} don\u2019t know)</span></div>`;
else {
  const W = Math.round(Math.max(300, Math.min(640, hp.clientWidth || 600))), H = 120, L = 6, R = 6, T = 14, B = 18, pw = W - L - R, ph = H - T - B, bw = pw / 24;
  const ws = Date.parse((state.wardata || {}).warstart), wh = isFinite(ws) ? new Date(ws).getUTCHours() : -1;
  let g = `<line class="gl" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/>`;
  hrs.forEach((n, h) => {
    const x = L + h * bw, bh = n / max * ph;
    if (n) g += `<rect class="hb" x="${(x + 1).toFixed(1)}" y="${(T + ph - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2"><title>${String(h).padStart(2, '0')}:00 TCT: ${n}</title></rect><text class="hn" x="${(x + bw / 2).toFixed(1)}" y="${(T + ph - bh - 3).toFixed(1)}" text-anchor="middle">${n}</text>`;
    if (h % (W < 480 ? 6 : 3) === 0) g += `<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`;
  });
  if (wh >= 0) g += `<line class="mk" x1="${(L + wh * bw).toFixed(1)}" x2="${(L + wh * bw).toFixed(1)}" y1="${T - 6}" y2="${T + ph}"/><text class="mkt" x="${(L + wh * bw + 3).toFixed(1)}" y="${T - 2}">war start</text>`;
  hp.innerHTML = `<div class="rs-qh">When the rest come online <span class="muted">(TCT${unknown ? ` \u00b7 ${unknown} don\u2019t know` : ''})</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours players will come online">${g}</svg>`;
}
// notes
const notes = members.filter(x => rolls[x.player_id] && rolls[x.player_id].note);
const nb = m.querySelector('.rsm-notes');
nb.innerHTML = !notes.length ? '' : `<details${rsNotesOpen ? ' open' : ''}><summary class="rs-qh">Notes <span class="muted">(${notes.length})</span></summary>`
  + notes.map(x => `<div class="rs-note"><b>${esc(x.name)}</b> ${esc(rolls[x.player_id].note)}</div>`).join('') + '</details>';
const det = nb.querySelector('details');
if (det) det.addEventListener('toggle', () => { rsNotesOpen = det.open; });
  }
  // group players by their best stat estimate (same figure as the Stats column), strongest first
  const RS_BANDS = [[50e9, '50B+'], [20e9, '20B \u2013 50B'], [10e9, '10B \u2013 20B'], [5e9, '5B \u2013 10B'], [1e9, '1B \u2013 5B'], [0, 'Under 1B']];
  function rsBands(list) {
const sIdx = statsIndex(), out = RS_BANDS.map(([min, label]) => ({ min, label, list: [] })), none = { label: 'No estimate', list: [] };
for (const m of list) {
  const v = bestEst(sIdx[m.player_id] || {}).v;
  if (!v) { none.list.push({ m, v: 0 }); continue; }
  out.find(b => v >= b.min).list.push({ m, v });
}
for (const b of out) b.list.sort((a, c) => c.v - a.v);
return [...out, none].filter(b => b.list.length);
  }
  async function rsCopy(btn) {
const { Q } = rsData(), names = rsPick && Q[rsPick.q] ? Q[rsPick.q].groups[rsPick.v] || [] : [];
const txt = rsBands(names).map(b => `${b.label}: ${b.list.map(x => x.m.name).join(', ')}`).join('\n');
let ok = false;
try { await navigator.clipboard.writeText(txt); ok = true; } catch (_) {
  try { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (__) { ok = false; }
}
btn.textContent = ok ? `\u2713 Copied ${names.length}` : 'Copy blocked';
setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy names'; }, 2000);
  }

  // ================= travellers (both factions, by country) =================
  // Like Tyronic's Travellers page: one row per country (travel-agency order or A-Z), our faction left, theirs right.
  // Each player shows direction (flying out / returning to Torn / abroad), stat estimate and a live landing countdown
  // (earliest landing still possible from the departure window - full ticket breakdown on hover), soonest first.
  const TRAV_ORDER = ['mexico', 'cayman islands', 'canada', 'hawaii', 'united kingdom', 'argentina', 'switzerland', 'japan', 'china', 'uae', 'south africa'];
  const TRAV_IC = {
out: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 22h20"/><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z"/></svg>',
back: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 22h20"/><path d="M3.77 10.77 2 9l2-4.5 1.1.55c.55.28.9.84.9 1.45s.35 1.17.9 1.45L8 8.5l3-6 1.05.53a2 2 0 0 1 1.09 1.52l.72 5.4a2 2 0 0 0 1.09 1.52l4.4 2.2c.42.22.78.55 1.01.96l.6 1.03c.49.88-.06 1.98-1.06 2.1l-1.18.15c-.47.06-.95-.02-1.37-.24L4.29 11.15a2 2 0 0 1-.52-.38Z"/></svg>',
abroad: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
  };
  let travSort = GM_getValue('travSort', 'flight');       // flight | az
  let travEmpty = false;                                    // show countries nobody is in/flying to
  const travDir = { ours: null, enemy: null };             // per faction: only out / back / abroad (null = all)
  const travCtry = new Set();                               // picked countries (empty = all)
  function travOpen() { const m = document.querySelector(`#${BOX_ID} .trm`); if (!m) return; m.hidden = false; fitOverlays(); travPaint(); }
  function travClose() { const m = document.querySelector(`#${BOX_ID} .trm`); if (m) m.hidden = true; popHide(); }
  // one traveller -> what to show
  function travInfo(m, sIdx, mine) {
const st = statusInfo(m);
if (st.rank !== 3 || !st.where) return null;
const p = travelPlan(m), now = Date.now(), est = bestEst(sIdx[m.player_id] || {}).v;
const dir = m.status_state === 'Abroad' ? 'abroad' : m.travel_destination === 'Torn' ? 'back' : 'out';
let sortT = Infinity, when = '', cls = '', tip = '';
const win = (lo, hi) => p.exact ? `${hm(hi)}` : `${hm(lo)}\u2013${hm(hi)}`;
if (dir === 'abroad') {
  sortT = 9e15 - (p && p.known ? p.hi : 0);                        // after the flights; longest there first
  when = `<span class="muted">${p && p.known ? 'there ' + (now - p.hi >= 864e5 ? `${Math.floor((now - p.hi) / 864e5)}d ${Math.floor((now - p.hi) % 864e5 / 36e5)}h` : relMin(now - p.hi)) : 'abroad'}</span>`;
  tip = `In ${st.where}` + (p && p.known ? `\nLanded ${win(p.lo, p.hi)} TCT` : '');
} else if (!p || !p.known) {
  sortT = 8e15; when = '<span class="muted">?</span>';
  tip = `${dir === 'back' ? 'Returning to Torn from' : 'Flying to'} ${st.where}\nDeparture time unknown`;
} else {
  const next = p.rows.find(r => now <= r.hi);
  tip = `${dir === 'back' ? 'Returning to Torn from' : 'Flying to'} ${st.where}${p.ticket ? ` (${p.ticket})` : ''}\nLeft ${win(p.lo, p.hi)} TCT\n`
    + p.rows.map(r => `${r.t}: ${win(r.lo, r.hi)}${now > r.hi ? (p.ticket ? ' (due)' : ' (ruled out)') : ''}`).join('\n');
  if (!next) { sortT = 7e15; when = '<span class="muted">due</span>'; }
  else if (now >= next.lo) { sortT = now; when = '<span class="tv-now">landing</span>'; cls = 'soon'; }
  else {
    sortT = next.lo;
    when = `<span class="muted">in </span><span class="num" data-until="${next.lo}">${clock(next.lo - now)}</span>`;
    if (next.lo - now < 5 * 60000) cls = 'soon';
  }
}
return { m, dir, key: flagKey(st.where), where: st.where, est, estCls: strengthClass(est, mine), sortT, when, cls, tip };
  }
  function travPaint() {
const box = document.getElementById(BOX_ID), el = box && box.querySelector('.trm');
if (!el || el.hidden || !state) return;
const { ours, enemy } = sides(), sIdx = statsIndex(), mine = bestEst(sIdx[state.user.user_id] || {}).v;
const sideRows = f => (f.members || []).map(m => travInfo(m, sIdx, mine)).filter(Boolean);
const S = [{ k: 'ours', f: ours, all: sideRows(ours) }, { k: 'enemy', f: enemy, all: sideRows(enemy) }];
S.forEach(x => { x.list = travDir[x.k] ? x.all.filter(t => t.dir === travDir[x.k]) : x.all; });   // header icons filter their side
const keys = new Set(TRAV_ORDER);
S.forEach(x => x.list.forEach(t => keys.add(t.key)));
let rows = [...keys].map(k => ({ k, name: (S.flatMap(x => x.list).find(t => t.key === k) || {}).where || k.replace(/\b\w/g, c => c.toUpperCase()), cells: S.map(x => x.list.filter(t => t.key === k).sort((a, b) => a.sortT - b.sortT || a.m.name.localeCompare(b.m.name))) }));
rows.forEach(r => { r.name = r.k === 'uae' ? 'UAE' : r.name.replace(/\b\w/g, c => c.toUpperCase()); r.n = r.cells[0].length + r.cells[1].length; });
if (travSort === 'az') rows.sort((a, b) => a.name.localeCompare(b.name));
else rows.sort((a, b) => ((TRAV_ORDER.indexOf(a.k) + 1) || 99) - ((TRAV_ORDER.indexOf(b.k) + 1) || 99));
// country filter: click a country's label to show only it, click again (or "All countries") to show them all
for (const k of [...travCtry]) if (!rows.some(r => r.k === k && r.n)) travCtry.delete(k);   // nobody left there: drop it
if (travCtry.size) rows = rows.filter(r => travCtry.has(r.k));
const empty = rows.filter(r => !r.n), filtered = !!(travDir.ours || travDir.enemy);
if (!travEmpty || travCtry.size) rows = rows.filter(r => r.n);
const cnt = list => ({ out: list.filter(t => t.dir === 'out').length, back: list.filter(t => t.dir === 'back').length, abroad: list.filter(t => t.dir === 'abroad').length });
const DIR_TXT = { out: 'flying out', back: 'returning to Torn', abroad: 'abroad' };
const head = x => { const c = cnt(x.all), on = travDir[x.k];
  const b = d => `<button type="button" class="tv-f ${on === d ? 'on' : ''}" data-tdir="${d}" data-side="${x.k}" title="${on === d ? 'Show everyone' : `Only ${DIR_TXT[d]}`}">${TRAV_IC[d]}${c[d]}</button>`;
  return `<div class="tv-fh ${x.k}"><b>${esc((x.f.info && x.f.info.name) || (x.k === 'ours' ? 'Us' : 'Them'))}</b><span class="tv-cnt">${b('out')}${b('back')}${b('abroad')}</span></div>`; };
const line = t => `<div class="tv-p ${t.cls}" data-pop="${t.m.player_id}" aria-label="${esc(t.tip.replace(/\n/g, ' \u00b7 '))}"><span class="tv-ic ${t.dir}">${TRAV_IC[t.dir]}</span>`
  + `<a class="tv-n" href="https://www.torn.com/profiles.php?XID=${t.m.player_id}" target="_blank"><span class="dot ${esc(t.m.active_status)}"></span>${esc(t.m.name)}</a>`
  + `<span class="tv-s num ${t.est ? t.estCls : 'none'}">${t.est ? fmtBS(t.est) : '\u2014'}</span><span class="tv-t">${t.when}</span></div>`;
const cell = (list, k) => list.length ? `<div class="tv-c ${k}">${list.map(line).join('')}</div>` : '<div class="tv-c none"></div>';
const html = `<div class="tv-grid">
        <div class="tv-corner">${travCtry.size ? '<button type="button" class="tv-all" data-tctry="" title="Show all countries">\u2715 All countries</button>' : ''}</div>${S.map(head).join('')}
        ${rows.map(r => `<div class="tv-ct ${r.n ? '' : 'mt'}" ${r.n ? `data-tctry="${esc(r.k)}" title="${travCtry.has(r.k) ? 'Show all countries' : `Only ${esc(r.name)}`}"` : ''}>${flag(r.name)}<span>${esc(r.name)}</span></div>${r.cells.map((c, i) => cell(c, S[i].k)).join('')}`).join('')}
      </div>
      ${!rows.length ? `<div class="muted tv-none">${filtered ? 'Nobody matches the filter.' : 'Nobody is travelling right now.'}</div>` : ''}
      ${!travEmpty && !travCtry.size && empty.length && rows.length ? `<div class="muted tv-empty">${filtered ? 'No matches in' : 'Nobody in or flying to'}: ${empty.map(r => esc(r.name)).join(', ')}</div>` : ''}`;
el.querySelectorAll('.trm-sort button').forEach(b => b.classList.toggle('on', b.dataset.v === travSort));
el.querySelector('[data-a=travempty]').classList.toggle('on', travEmpty);
const body = el.querySelector('.trm-body');
if (!sameHtml(body, html)) { body.innerHTML = html; stripTitles(body); }   // landing countdowns tick in place
  }

  // ================= faction settings (Tyronic's) =================
  // getstate.factionconfig, laid out like Tyronic's Faction Settings panel. Everyone can look; leaders
  // (getstate.user.access_name 'LEADER') can change them here too - same call tyronic.io makes:
  // rpc/updateconfig { _config: <the whole config with the change> }. Tyronic checks the permission itself.
  const FS_STRAT = [['None', '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'], ['Turtle', '<path d="M3 15c0-4.4 4-8 9-8s9 3.6 9 8"/><path d="M3 15h18"/><path d="M7 15v3M17 15v3M21 13h1.5"/><path d="M9 8.5 10.5 12h3L15 8.5"/>'],
['Attack', '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4M7 17l-3 3M3 19l2 2"/>'],
['Custom', '<path d="M4 6h16M4 12h16M4 18h10"/>']];
  // numbers: [field, min, max, step, shown as]
  const FS_NUM = { dibs_time: [60, 1800, 60, v => `${Math.round(v / 60)}m`], num_dibs: [1, 10, 1, v => v], num_assists: [0, 10, 1, v => v] };
  let fsSaving = false;
  const fsCanEdit = () => !!(state && state.user && String(state.user.access_name || '').toUpperCase() !== 'MEMBER' && state.user.access_name);
  // faction strategy for the header (hidden when there is none); leaders can click it to open the settings
  function stratPill() {
const c = (state && state.factionconfig) || {}, st = Number(c.strategy) || 0;
if (!st || !FS_STRAT[st]) return '';
const name = st === 3 ? (c.strategy_custom_title || 'Custom') : FS_STRAT[st][0];
const tip = `Faction strategy: ${name}` + (st === 3 && c.strategy_custom ? `\n${c.strategy_custom}` : '');
return `<${fsCanEdit() ? 'button type="button" data-a="fsopen"' : 'div'} class="pill strat s${st}" title="${esc(tip)}">${svg(FS_STRAT[st][1])}<span>${esc(name)}</span></${fsCanEdit() ? 'button' : 'div'}>`;
  }
  function fsOpen() { const m = document.querySelector(`#${BOX_ID} .fsm`); if (!m || !fsCanEdit()) return; m.hidden = false; fitOverlays(); fsPaint(); }
  function fsClose() { const m = document.querySelector(`#${BOX_ID} .fsm`); if (m) m.hidden = true; }
  async function fsSave(change) {
if (fsSaving || !state || !state.factionconfig || !fsCanEdit()) return;
const before = state.factionconfig, next = Object.assign({}, before, change);
state.factionconfig = next; fsSaving = true; fsPaint(); render();             // show it straight away
try {
  await rpc('updateconfig', { _config: next });
  toast('Faction settings saved', 'ok', 2000);
} catch (e) {
  if (state && state.factionconfig === next) state.factionconfig = before;       // put it back
  toast(`Couldn\u2019t save \u2014 ${e.message}`, 'err', 8000);
} finally { fsSaving = false; fsPaint(); render(); refresh(true); }
  }
  function fsPaint() {
const m = document.querySelector(`#${BOX_ID} .fsm`);
if (m && !m.hidden && !fsCanEdit()) { m.hidden = true; return; }   // lost leader access
if (!m || m.hidden || !state) return;
const c = state.factionconfig || {}, edit = fsCanEdit(), dis = fsSaving ? ' disabled' : '';
const on = (k, v) => edit
  ? `<button type="button" class="fs-sw ${v ? 'on' : ''}" data-fs="${k}" aria-pressed="${!!v}" title="${v ? 'Turn off' : 'Turn on'}"${dis}><i></i></button>`
  : `<span class="fs-sw ${v ? 'on' : ''}" role="img" aria-label="${v ? 'On' : 'Off'}"><i></i></span>`;
const num = (k, v) => {
  const [min, max, step, fmt] = FS_NUM[k], pct = (v - min) / (max - min) * 100;
  return edit
    ? `<span class="fs-val"><button type="button" class="ghost fs-st" data-fsn="${k}" data-d="-${step}" title="Less"${v <= min ? ' disabled' : dis}>\u2212</button><b class="num">${esc(fmt(v))}</b><button type="button" class="ghost fs-st" data-fsn="${k}" data-d="${step}" title="More"${v >= max ? ' disabled' : dis}>+</button></span>`
    : `<span class="fs-val"><b class="num">${esc(fmt(v))}</b><span class="fs-bar"><i style="width:${Math.max(4, Math.min(100, pct))}%"></i></span></span>`;
};
const row = (icon, label, ctl) => `<div class="fs-row"><span class="fs-l">${icon}<span>${label}</span></span>${ctl}</div>`;
const st = Number(c.strategy) || 0;
const strat = `<span class="fs-strat">${FS_STRAT.map(([n, d], i) => edit
  ? `<button type="button" class="fs-si ${i === st ? 'on' : ''}" data-fss="${i}" title="${n}"${dis}>${svg(d)}</button>`
  : `<span class="fs-si ${i === st ? 'on' : ''}" title="${n}">${svg(d)}</span>`).join('')}</span>`;
const custom = st !== 3 ? '' : edit
  ? `<div class="fs-custom"><input type="text" class="fs-ct" maxlength="40" placeholder="Strategy title" value="${esc(c.strategy_custom_title || '')}">
          <textarea class="fs-cx" maxlength="500" rows="3" placeholder="What should members do?">${esc(c.strategy_custom || '')}</textarea>
          <button type="button" class="btn-save" data-a="fscustom"${dis}>Save strategy</button></div>`
  : (c.strategy_custom_title || c.strategy_custom)
    ? `<div class="fs-custom">${c.strategy_custom_title ? `<b>${esc(c.strategy_custom_title)}</b>` : ''}${c.strategy_custom ? `<div>${esc(c.strategy_custom)}</div>` : ''}</div>` : '';
const v = (k, d) => c[k] == null ? d : Number(c[k]);
// chat options left out: they only affect tyronic.io (the rest of the config is still sent back unchanged)
const html = row(ICON.roll, 'Roll call', on('rollcall_enabled', c.rollcall_enabled))
  + row(ICON.dib, 'Calling dibs', on('dibs_enabled', c.dibs_enabled !== false))
  + row(svg('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>'), 'Dib window', on('dib_window_enabled', c.dib_window_enabled))
  + row(ICON.clock, 'Dibs time limit', num('dibs_time', v('dibs_time', 300)))
  + row(svg('<path d="M18 7V4H6l6 8-6 8h12v-3"/>'), 'Dibs / assists per member', num('num_dibs', v('num_dibs', 1)))
  + row(svg('<path d="M18 7V4H6l6 8-6 8h12v-3"/>'), 'Assists per dib', num('num_assists', v('num_assists', 1)))
  + row(ICON.assist, 'Auto request assists', on('auto_request_assists', c.auto_request_assists))
  + row(svg('<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'), `Faction strategy <span class="muted">\u00b7 ${FS_STRAT[st] ? FS_STRAT[st][0] : st}</span>`, strat)
  + custom
  + (c.updated_at ? `<div class="fs-upd muted">Last changed ${esc(sdateShort(Date.parse(c.updated_at)))} ${hm(Date.parse(c.updated_at))} TCT</div>` : '');
const body = m.querySelector('.fsm-body');
const typing = body.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
if (body.dssLast !== html && !typing) { body.innerHTML = html; body.dssLast = html; stripTitles(body); }   // don't wipe a strategy being typed
  }

  // ================= Tyronic war credits (leaders) =================
  // getstate.subscription: { member_credits_remaining, member_count, estimated_wars_remaining, credit_rate }.
  // Same info as tyronic.io's War Credits panel; payment details are Tyronic's (Xanax to Fjord).
  // wars the remaining credits cover (Tyronic's estimate, else credits / members); null if unknown
  function crWars() {
const sub = state && state.subscription;
if (!sub) return null;
if (sub.estimated_wars_remaining != null) return Number(sub.estimated_wars_remaining);
const n = Number(sub.member_count) || 0;
return n ? Math.floor((Number(sub.member_credits_remaining) || 0) / n) : null;
  }
  function crOpen() { const m = document.querySelector(`#${BOX_ID} .crm`); if (!m || !fsCanEdit()) return; m.hidden = false; fitOverlays(); crPaint(); }
  function crClose() { const m = document.querySelector(`#${BOX_ID} .crm`); if (m) m.hidden = true; }
  function crPaint() {
const m = document.querySelector(`#${BOX_ID} .crm`);
if (m && !m.hidden && !fsCanEdit()) { m.hidden = true; return; }
if (!m || m.hidden || !state) return;
const sub = state.subscription || {}, fac = (sides().ours || {}).info || {};
const credits = Math.round(Number(sub.member_credits_remaining) || 0), members = Number(sub.member_count) || 0;
const wars = crWars() || 0;
const rate = Number(sub.credit_rate) || 2, low = wars <= 2;
const html = `<div class="cr-box ${wars <= 1 ? 'crit' : low ? 'low' : ''}"><b class="num">${num(credits)}</b> war credits left for ${esc(fac.name || 'your faction')}
        <div>Covers about <b class="num">${wars}</b> war${wars === 1 ? '' : 's'} with ${members} members${low ? ' \u2014 time to top up' : ''}</div></div>
      <p>Pay by sending Xanax to <a href="https://www.torn.com/profiles.php?XID=3317544" target="_blank" rel="noopener">Fjord [3317544]</a>.</p>
      <ul><li>1 credit covers 1 member for 1 war</li><li>1 Xanax = ${rate} credits</li><li>5% volume discount for every 100 Xanax, up to 25%</li><li>Credits update automatically within an hour</li></ul>
      ${members ? `<div class="cr-calc muted">One war for ${members} members \u2248 <b class="num">${Math.ceil(members / rate)}</b> Xanax (before discount)</div>` : ''}`;
const body = m.querySelector('.crm-body');
if (body.dssLast !== html) { body.innerHTML = html; body.dssLast = html; }
  }

  // ================= merc list =================
  // Our members picked by roll call answers + last action, as "Name - attack link" lines to paste for mercs.
  // Multi-select groups: an empty group means "any". Choices are remembered.
  const MERC_DEFAULT = { start: ['n', 'm'], hosp: ['n', 'x'], idle: 0, skipHosp: true };
  let merc = Object.assign({}, MERC_DEFAULT, GM_getValue('mercF', {}) || {});
  function mercRows() {
if (!state) return [];
const { ours } = sides(), rolls = rollIdx(), now = Date.now();
return (ours.members || []).filter(m => {
  const r = rolls[m.player_id];
  const sk = r ? ynmCls(r.start_online) : 'x';
  if (merc.start.length && !merc.start.includes(sk)) return false;
  const hk = !r || r.start_hosped == null ? 'x' : r.start_hosped ? 'y' : 'n';
  if (merc.hosp.length && !merc.hosp.includes(hk)) return false;
  if (merc.idle && now - Date.parse(m.active_stamp) < merc.idle * 3600000) return false;
  if (merc.skipHosp && m.status_state === 'Hospital') return false;
  return true;
}).sort((a, b) => a.name.localeCompare(b.name));
  }
  const attackUrl = id => `https://www.torn.com/page.php?sid=attack&user2ID=${id}`;
  function mercPaint() {
const m = document.querySelector(`#${BOX_ID} .mcm`);
if (!m || m.hidden) return;
m.querySelectorAll('.mq').forEach(seg => seg.querySelectorAll('button').forEach(btn =>
  btn.classList.toggle('on', merc[seg.dataset.q].includes(btn.dataset.v))));
m.querySelector('.mcm-idle').value = String(merc.idle);
m.querySelector('.mcm-skip').checked = !!merc.skipHosp;
const rows = mercRows();
m.querySelector('.mcm-out').value = rows.map(x => `${x.name} - ${attackUrl(x.player_id)}`).join('\n');
m.querySelector('.mcm-n').textContent = `${rows.length} player${rows.length === 1 ? '' : 's'}`;
m.querySelector('[data-a=merccopy]').disabled = !rows.length;
  }
  function mercSave() { GM_setValue('mercF', merc); mercPaint(); }
  function mercOpen() { const m = document.querySelector(`#${BOX_ID} .mcm`); if (!m) return; m.hidden = false; fitOverlays(); mercPaint(); }
  function mercClose() { const m = document.querySelector(`#${BOX_ID} .mcm`); if (m) m.hidden = true; }
  function mercPick(q, v) {
const cur = merc[q], i = cur.indexOf(v);
merc[q] = i >= 0 ? cur.filter(x => x !== v) : [...cur, v];
mercSave();
  }
  async function mercCopy() {
const ta = document.querySelector(`#${BOX_ID} .mcm-out`);
let ok = false;
try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (_) {
  try { ta.focus(); ta.select(); ok = document.execCommand('copy'); } catch (__) { ok = false; }
}
// confirmation inside the form (the panel toast sits behind the modal / off screen on long lists)
const card = ta.closest('.rcm-card'), btn = card.querySelector('[data-a=merccopy]');
const n = ta.value ? ta.value.split('\n').length : 0;
let pop = card.querySelector('.mcm-pop');
if (!pop) { pop = document.createElement('div'); pop.className = 'mcm-pop'; card.appendChild(pop); }
pop.className = `mcm-pop ${ok ? 'ok' : 'warn'}`;
pop.innerHTML = ok ? `${ICON.ok}<span>Copied ${n} player${n === 1 ? '' : 's'}</span>` : '<span>Copy blocked \u2014 select the text and copy it</span>';
void pop.offsetWidth; pop.classList.add('show');
btn.textContent = ok ? '\u2713 Copied' : 'Copy list';
btn.classList.toggle('done', ok);
clearTimeout(mercCopy.t);
mercCopy.t = setTimeout(() => { pop.classList.remove('show'); btn.textContent = 'Copy list'; btn.classList.remove('done'); }, 2200);
  }

  let rollDraft = null;
  const toV = v => v === 'y' ? true : v === 'n' ? false : null;
  const fromV = v => v === true ? 'y' : v === false ? 'n' : 'm';
  function rollPaint() {
const box = document.getElementById(BOX_ID), m = box && box.querySelector('.rcm.rollm');
if (!m || !rollDraft) return;
m.querySelectorAll('.rq').forEach(seg => {
  const cur = rollDraft[seg.dataset.q];
  seg.querySelectorAll('button').forEach(btn => btn.classList.toggle('on', cur !== undefined && fromV(cur) === btn.dataset.v));
});
m.querySelector('.rcm-later').hidden = rollDraft.start_online === true || rollDraft.start_online === undefined;
  }
  function rollOpen() {
const box = document.getElementById(BOX_ID), m = box && box.querySelector('.rcm.rollm');
if (!m || !state) return;
const cur = rollIdx()[state.user.user_id];
rollDraft = cur ? { start_online: cur.start_online, chain_watch: cur.chain_watch, start_hosped: cur.start_hosped == null ? undefined : cur.start_hosped }
                : { start_online: undefined, chain_watch: undefined, start_hosped: undefined };
m.querySelector('.rcm-hour').value = cur && cur.hour_online != null ? String(cur.hour_online) : '';
m.querySelector('.rcm-note').value = (cur && cur.note) || '';
m.querySelector('.rcm-err').textContent = '';
rollPaint();
m.hidden = false; fitOverlays();
  }
  function rollClose() { const m = document.querySelector(`#${BOX_ID} .rcm.rollm`); if (m) m.hidden = true; rollDraft = null; }
  function rollPick(q, v) { if (!rollDraft) return; rollDraft[q] = toV(v); rollPaint(); }
  async function rollSubmit() {
const m = document.querySelector(`#${BOX_ID} .rcm.rollm`), err = m.querySelector('.rcm-err'), go = m.querySelector('.rcm-go');
const d = rollDraft;
if (!d || d.start_online === undefined || d.chain_watch === undefined) { err.textContent = 'Answer both questions first.'; return; }
const later = d.start_online !== true;
if (later && d.start_hosped === undefined) { err.textContent = 'Say whether you\u2019ll self-hosp.'; return; }
const hv = m.querySelector('.rcm-hour').value;
const row = {
  start_online: d.start_online, chain_watch: d.chain_watch,
  start_hosped: later ? d.start_hosped : null, hour_online: later && hv !== '' ? +hv : null,
  note: m.querySelector('.rcm-note').value.trim().slice(0, 60) || null,
};
go.disabled = true; err.textContent = '';
try {
  await rpc(ROLLCALL_RPC, { _data: row });
  rollClose(); toast('Roll call saved', 'ok'); refresh(true);
} catch (e) {
  err.textContent = `Couldn\u2019t save: ${e.message}`;
} finally { go.disabled = false; }
  }

  // ================= revivable (Torn API v2 user profile, rate-limited) =================
  // One /user/{id}/profile call per player. Torn allows 100 calls/min per player across ALL their keys (and
  // Tyronic + other scripts share that budget), so calls are trickled out under a configurable per-minute cap,
  // cached for revTtl() (persisted across reloads) and fetched in the order the user is most likely to care about:
  // rows currently on screen (hospitalised first), then the rest of that faction, then the other tab.
  // How often each player is re-checked. 5 min floor: ~200 players / 5 min is already ~40 calls/min, so going
  // lower would just keep the queue pinned at the per-minute cap for no real gain (and starve the other tab).
  const REV_EVERY_MIN = 5, REV_EVERY_MAX = 60, REV_EVERY_DEFAULT = 10;
  const revEvery = () => Math.min(REV_EVERY_MAX, Math.max(REV_EVERY_MIN, Math.round(Number(GM_getValue('revEveryMin', REV_EVERY_DEFAULT)) || REV_EVERY_DEFAULT)));
  const revTtl = () => revEvery() * 60 * 1000;
  const WARN_MAX = 300, WARN_DEFAULT = 30;
  const dibWarnSec = () => { const v = Number(GM_getValue('dibWarnSec', WARN_DEFAULT)); return isFinite(v) ? Math.min(WARN_MAX, Math.max(0, Math.round(v))) : WARN_DEFAULT; };
  const dibWarnMs = () => dibWarnSec() * 1000;
  const REV_KEEP = 7 * 24 * 3600 * 1000;       // forget cached players after a week
  const REV_DEFAULT = 30, REV_MAX = 90;
  const revPerMin = () => Math.min(REV_MAX, Math.max(5, Math.round(Number(GM_getValue('revPerMin', REV_DEFAULT)) || REV_DEFAULT)));
  let revCache = (() => {
const c = GM_getValue('revCache', null), out = {}, now = Date.now();
if (c && typeof c === 'object') for (const id in c) if (c[id] && now - c[id].t < REV_KEEP) out[id] = c[id];
return out;
  })();
  let revWanted = [];                          // priority-ordered player ids, rebuilt on every render
  let revStamps = [];                          // send times inside the last minute (sliding window)
  let revInFlight = null;                      // player id whose profile is being fetched right now
  let revTimer = null, revRunning = false, revPauseUntil = 0, revStop = null, revSaveTimer = null;

  function revSave() {
if (!revSaveTimer) revSaveTimer = setTimeout(() => { revSaveTimer = null; GM_setValue('revCache', revCache); }, 3000);
  }

  // called from render(): shown = rows in display order, cur/other = full member lists of both tabs
  function revPlan(shown, cur, other) {
const ids = [], seen = new Set();
const add = id => { if (id != null && !seen.has(id)) { seen.add(id); ids.push(id); } };
shown.filter(m => m.status_state === 'Hospital').forEach(m => add(m.player_id));
shown.forEach(m => add(m.player_id));
(cur || []).forEach(m => add(m.player_id));
(other || []).forEach(m => add(m.player_id));
revWanted = ids;
revKick();
  }

  function revNextId(now) {
const ttl = revTtl();
for (const id of revWanted) { const e = revCache[id]; if (!e || now - e.t > ttl) return id; }
return null;
  }

  function revLater(ms) { clearTimeout(revTimer); revTimer = setTimeout(revPump, Math.max(0, ms)); }
  function revKick() { if (!revRunning) revLater(0); }

  // Torn API error codes -> what to do (https://www.torn.com/api.html#)
  function revOnApiError(err) {
const code = err && err.code, msg = (err && err.error) || 'Torn API error';
if ([2, 10, 13, 16, 18].includes(code)) { revStop = msg; return; }        // key unusable: stop until the key changes
revPauseUntil = Date.now() + (code === 5 ? 60000 : code === 8 ? 600000 : 60000); // 5 = too many requests, 8 = IP block
  }

  async function revPump() {
revTimer = null;
if (revRunning) return;
const key = GM_getValue('tornKey', '');
// nothing to do in the background: render() / visibilitychange kick us again
if (!key || revStop || document.hidden || !document.getElementById(BOX_ID)) return;
const now = Date.now();
if (now < revPauseUntil) return revLater(revPauseUntil - now);
const per = revPerMin();
revStamps = revStamps.filter(t => now - t < 60000);
if (revStamps.length >= per) return revLater(60000 - (now - revStamps[0]) + 50);
const gap = 60000 / per, last = revStamps[revStamps.length - 1] || 0;  // spread calls evenly, no bursts
if (now - last < gap) return revLater(gap - (now - last));
const id = revNextId(now);
if (id == null) return revLater(30000);                                   // all fresh - look again later
revRunning = true;
revStamps.push(now);
revInFlight = id; revPatch(id);                // show the spinner on that row while we wait
let changed = false;
try {
  const res = await req('GET', `https://api.torn.com/v2/user/${id}/profile?striptags=true&comment=dss-ty`,
    { accept: 'application/json', Authorization: `ApiKey ${key}` });
  if (res && res.error) {
    if (res.error.code === 6 || res.error.code === 7) { revKeep(id); changed = true; } // bad id: don't retry for a while
    else revOnApiError(res.error);
  } else if (res && res.profile && typeof res.profile.revivable === 'boolean') {
    revCache[id] = { v: res.profile.revivable, t: Date.now() }; changed = true;
  } else {
    revKeep(id); changed = true;
  }
} catch (e) {
  revPauseUntil = Date.now() + (e.network ? 15000 : 60000);
} finally { revRunning = false; revInFlight = null; }
if (changed) revSave();
revPatch(id);
revLater(0);
  }

  // a failed check keeps whatever we last knew (just pushes the next retry back)
  function revKeep(id) {
const prev = revCache[id];
revCache[id] = { v: prev && typeof prev.v === 'boolean' ? prev.v : null, t: Date.now() };
  }
  // best known answer: our own last check, otherwise the (older) flag Tyronic stores on each member
  function revValue(id) {
const e = revCache[id];
if (e && typeof e.v === 'boolean') return { v: e.v, t: e.t, src: 'api' };
const m = memberIdx[id];
if (m && typeof m.revivable === 'boolean') return { v: m.revivable, t: Date.parse(m.profile_updated_at), src: 'tyronic' };
return null;
  }
  function revInfo(id) {
const r = revValue(id);
if (!r) {   // nothing known from anywhere yet
  if (revInFlight === id) return { cls: 'none rev-busy', html: ICON.spin, tip: 'Checking\u2026' };
  return { cls: 'none rev-wait', html: ICON.clock, tip: revStop ? `Checks stopped\n${revStop}` : 'Queued' };
}
// absolute time (not "5m ago"), so the cell's markup doesn't change every minute and force a table rebuild
const at = !isFinite(r.t) ? '?' : Date.now() - r.t < 86400000 ? `${hm(r.t)} TCT` : sdateShort(r.t);
const when = r.src === 'api' ? `\nChecked ${at}` : `\nTyronic data from ${at}`;
return r.v ? { cls: 'rev-y', html: ICON.revive, tip: 'Revivable' + when } : { cls: 'rev-n', html: ICON.revive, tip: 'Not revivable' + when };
  }
  const revTd = id => {
const r = revInfo(id);
return `<td class="c num c-rev ${r.cls}" data-rev="${id}" title="${esc(r.tip)}">${r.html}</td>`;
  };
  // update one cell in place so a fresh result shows immediately without a full re-render
  function revPatch(id) {
const box = document.getElementById(BOX_ID);
const td = box && box.querySelector(`td[data-rev="${id}"]`);
if (!td) return;
const r = revInfo(id);
td.className = `c num c-rev ${r.cls}`;
td.innerHTML = r.html;
td.setAttribute('aria-label', r.tip.replace(/\n/g, ' \u00b7 '));
if (!noHover()) { td.dataset.tt = r.tip; ttRefresh(); }
  }

  // ================= live status fallback (Torn API v2 faction members) =================
  // Tyronic sometimes stops updating statuses. When that's spotted (thresholds below liveHealth) we pull statuses
  // straight from Torn - one call per faction returns every member's status + last action - and lay them over
  // Tyronic's data. Once Tyronic has looked right for LIVE_RECOVER_MS we switch back.
  // Calls share the revive limiter's per-minute window (and take priority over revive checks).
  const LIVE_FAST_MS = 5000;        // enemy faction while the fallback is on
  const LIVE_OURS_MS = 30000;       // our faction while the fallback is on
  const LIVE_PROBE_MS = 120000;     // health probe of the enemy faction while Tyronic looks fine
  const LIVE_RECOVER_MS = 30000;
  const LIVE_GRACE_MS = 60000;      // how long Torn must have shown a state before Tyronic missing it counts
  let liveCand = 0;                 // differences seen on the last comparison that haven't lasted long enough yet
  let liveOn = false, liveHealthySince = 0, liveTimer = null, liveBusy = false, liveWhy = '';
  let rawSnap = null;                                    // Tyronic's own statuses, before any overlay
  const live = {};                                       // factionId -> { t, rows: { playerId: row } }
  const liveSeen = {};                                   // playerId -> last state seen from Torn (travel times, staleness)

  const stKey = (st, desc) => `${st}|${String(desc || '').trim()}`;
  function snapRaw() {
if (!state) return;
const now = Date.now(), snap = { t: now, m: {} };
for (const f of [state.home_faction, state.away_faction]) for (const m of (f && f.members) || [])
  snap.m[m.player_id] = { state: m.status_state, until: Date.parse(m.status_until) };
rawSnap = snap;
  }
  // Thresholds tuned to avoid normal Tyronic lag (it refreshes each faction in batches every ~20-60s, and expired
  // hospital timers already show as OK in the panel, so a bit of lag costs nothing):
  //   stuck timers : 3+ players still "in hospital/jail" 2 min after their timer ended
  //   out of date  : 3+ players whose Torn state (war list, or an API read) has been different for 60s+
  //   failing      : 2 getstate failures in a row
  // With Torn's live data (websocket / war list) that comparison is free and continuous; the API probe is only for when
  // neither is available.
  const LIVE_OVERDUE_MS = 120000, LIVE_STALE_N = 3;
  function liveHealth() {
const now = Date.now(), name = id => (memberIdx[id] && memberIdx[id].name) || memberName(+id) || `#${id}`;
const overdue = [], diff = [];
let cand = 0;
if (rawSnap) {
  for (const id in rawSnap.m) {
    const r = rawSnap.m[id];
    if ((r.state === 'Hospital' || r.state === 'Jail') && isFinite(r.until) && r.until > 0 && r.until < now - LIVE_OVERDUE_MS) overdue.push(id);
  }
  let compared = false;
  for (const fid in live) {
    const L = live[fid];
    if (now - L.t > 60000 || Math.abs(L.t - rawSnap.t) > 20000) continue;      // Torn read and snapshot ~same moment
    compared = true;
    for (const id in L.rows) {
      const r = rawSnap.m[id];
      if (!r || r.state === L.rows[id].status.state) continue;
      cand++;
      const seen = liveSeen[id];
      if (seen && rawSnap.t - seen.stT >= LIVE_GRACE_MS) diff.push(id);
    }
  }
  if (compared) liveCand = cand;                   // keep the last verdict between Torn reads
  for (const id in tornSeen) {                       // Torn's own live data vs Tyronic's raw snapshot
    const d = tornSeen[id], r = rawSnap.m[id];
    if (!r || !tornValid(d) || diff.includes(id) || rawSnap.t - d.t < LIVE_GRACE_MS) continue;
    const rs = HJ(r.state) && isFinite(r.until) && r.until > 0 && r.until <= rawSnap.t ? 'Okay' : r.state;
    if (d.st === 'Clear' ? HJ(rs) : rs !== d.st) diff.push(id);
  }
}
const failing = failStreak >= 2;
const stale = failing || overdue.length >= LIVE_STALE_N || diff.length >= LIVE_STALE_N;
const list = ids => ids.slice(0, 6).map(name).join(', ') + (ids.length > 6 ? ` +${ids.length - 6}` : '');
const why = failing ? 'Tyronic isn\u2019t responding'
  : overdue.length >= LIVE_STALE_N ? `${overdue.length} hospital timers stuck 2m+\n${list(overdue)}`
  : diff.length >= LIVE_STALE_N ? `${diff.length} statuses out of date 60s+\n${list(diff)}` : '';
return { stale, healthy: !failing && overdue.length === 0 && diff.length <= 1, why };
  }
  function liveDecide() {
const h = liveHealth(), now = Date.now();
if (h.stale) {
  liveHealthySince = 0;
  if (!liveOn) { liveOn = true; liveKick(0); }
  liveWhy = h.why;
} else if (liveOn) {
  if (!h.healthy) liveHealthySince = 0;
  else if (!liveHealthySince) liveHealthySince = now;
  else if (now - liveHealthySince >= LIVE_RECOVER_MS) { liveOn = false; liveWhy = ''; liveHealthySince = 0; }
}
  }
  // map one Torn member row onto Tyronic's member fields
  function liveApplyRow(m, row) {
const st = row.status || {}, la = row.last_action || {};
const desc = plain(st.description), key = stKey(st.state, desc);
m.status_state = st.state;
m.status_color = st.color;
m.status_description = desc;
m.status_details = plain(st.details);
m.status_until = st.until ? new Date(st.until * 1000).toISOString() : '1970-01-01T00:00:00+00:00';
m.until_unknown = false;
if (la.status) m.active_status = la.status;
if (la.timestamp) m.active_stamp = new Date(la.timestamp * 1000).toISOString();
if (typeof row.is_revivable === 'boolean') m.revivable = row.is_revivable;
if (st.state === 'Traveling' || st.state === 'Abroad') {
  const to = desc.match(/^Traveling from .+ to (.+)$/), at = desc.match(/^In (.+)$/);
  const dest = to ? to[1] : at ? at[1] : m.travel_destination;
  const seen = liveSeen[m.player_id];
  if (seen && seen.change && seen.key === key) {                  // we watched this trip start/land: we know when
    m.travel_departure_stamp = new Date(seen.change.hi).toISOString();
    m.travel_departure_error = Math.round((seen.change.hi - seen.change.lo) / 1000);
  } else if (m.travel_destination !== dest) {                      // new trip Tyronic didn't see: time unknown
    m.travel_departure_stamp = null; m.travel_departure_error = null;
  }
  m.travel_destination = dest;
}
  }
  function liveOverlay() {
if (!state) return;
const now = Date.now();
if (!liveOn) tornApply();                            // mark Torn's flips first, so their timers can be borrowed below
for (const f of [state.home_faction, state.away_faction]) {
  const L = f && f.info && live[f.info.faction_id];
  if (!L || now - L.t > 120000) continue;
  for (const m of f.members || []) {
    const row = L.rows[m.player_id];
    if (!row) continue;
    // fallback: Torn's data wins. Otherwise only borrow a timer for someone the list just put in hospital/jail.
    if (liveOn || (m.until_unknown && row.status && row.status.state === m.status_state && row.status.until * 1000 > now)) liveApplyRow(m, row);
  }
}
tornApply();                                         // Torn has the last word on Okay vs Hospital/Jail
onlineApply();                                       // and on online / idle / offline (the war page's own poll)
  }

  // ---- Torn's own live data: instant hospital/jail flips ----
  // Torn pushes status changes to the page straight away; Tyronic and the API can lag on quick hospital in/outs.
  // Two sources, both free (no API calls), merged into tornSeen:
  //   ws  : Torn's websocket (ws-centrifugo.torn.com). Channel faction-users-<factionId> sends updateIcons with the
  //         player's icon tray whenever it changes; the Hospital/Jail icon carries the reason and the exact seconds
  //         left. We listen on the page's own socket (no connection of our own) - see wsHook below.
  //   dom : the (hidden) ranked war list, read every second while it's on the page. Okay/Hospital/Jail only, no timer.
  // Torn wins over Tyronic for Okay vs Hospital/Jail. If we only know "in hospital" without a timer it shows as "new"
  // until one arrives (one Torn API read of that faction, at most every LIVE_TIMER_MS, or Tyronic's next update).
  // Travel and everything else still come from Tyronic. Disagreements also tell us when Tyronic is stale (liveHealth).
  const LIVE_TIMER_MS = 10000;
  const liveNeed = {};                                   // factionId -> true when a flip needs a timer
  const tornSeen = {};                                   // playerId -> { st, t (since), at (heard), src, until, reason }
  const tornChanged = [];                                // ids whose state changed since the last tornTick
  let domLastScan = 0, wsLastMsg = 0;
  const domLive = () => Date.now() - domLastScan < 5000;   // list on the page and read in the last few seconds
  const wsLive = () => Date.now() - wsLastMsg < 90000;     // socket alive (Torn pings every ~25s)
  const tornLive = () => domLive() || wsLive();
  const tornValid = d => !!d && (d.src === 'ws' ? wsLive() : domLive());
  const HJ = st => st === 'Hospital' || st === 'Jail';
  // st: Okay | Hospital | Jail | Traveling | Abroad | Clear (ws: no hospital/jail/travel icon - "not locked up")
  function tornNote(id, st, src, x) {
const now = Date.now(), prev = tornSeen[id];
const same = prev && prev.st === st;
tornSeen[id] = { st, src, at: now, t: same ? prev.t : now, from: same ? prev.from : prev && prev.st,
  until: (x && x.until) || null, reason: (x && x.reason) || '' };
if (!same) tornChanged.push(id);
  }

  // ---- the war list ----
  const DOM_STATES = { okay: 'Okay', hospital: 'Hospital', jail: 'Jail', traveling: 'Traveling', abroad: 'Abroad' };
  function domScan() {
if (wsLive() && Date.now() - domLastScan < 3000) return;  // the websocket covers it: only a light backup look
const wrap = findWrap();
if (!wrap) return;
let found = 0;
for (const li of wrap.querySelectorAll('li')) {
  const a = li.querySelector('a[href*="XID="]'), sd = li.querySelector('[class*="status___"]');
  if (!a || !sd) continue;
  const id = +((a.getAttribute('href') || '').match(/XID=(\d+)/) || [])[1];
  if (!id) continue;
  let st = null;
  for (const c of sd.classList) if (DOM_STATES[c]) { st = DOM_STATES[c]; break; }
  if (!st) st = DOM_STATES[sd.textContent.trim().toLowerCase()] || null;
  if (!st) continue;
  found++;
  const prev = tornSeen[id];
  if (prev && prev.st === st) continue;                                    // agrees (keeps a websocket timer)
  if (prev && prev.st === 'Clear' && !HJ(st)) continue;                    // "not locked up" already covers it
  if (prev && prev.src === 'ws' && wsLive() && Date.now() - prev.at < 3000) continue;   // list catching up with a push
  tornNote(id, st, 'dom');
}
if (found) domLastScan = Date.now();
  }

  // ---- per-player war score: Torn's own (hidden) war list has a points column for every player on both sides ----
  const domScore = {};                                   // id -> score
  function domScores() {
const wrap = findWrap();
if (!wrap) return false;
let changed = false;
for (const li of wrap.querySelectorAll('li')) {
  const a = li.querySelector('a[href*="XID="]'), pt = li.querySelector('[class*="points___"]');
  if (!a || !pt) continue;
  const id = +((a.getAttribute('href') || '').match(/XID=(\d+)/) || [])[1];
  const v = parseFloat(pt.textContent.replace(/[^\d.]/g, ''));
  if (!id || !isFinite(v)) continue;
  if (domScore[id] !== v) { domScore[id] = v; changed = true; }
}
return changed;
  }

  // ---- the websocket ----
  // Hook WebSocket.prototype.send on the page: the first time Torn's centrifugo socket sends anything (subscribe,
  // or its reply to the server's ~25s ping) we add our own message listener to it. Works even if the socket was
  // opened before this script ran. Firefox needs exportFunction to hand our functions to the page.
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  function wsOnMessage(ev) {
try {
  wsLastMsg = Date.now();
  const raw = ev && ev.data;
  if (typeof raw !== 'string') return;
  const icons = raw.indexOf('updateIcons') >= 0, fin = raw.indexOf('attackFinish') >= 0;
  if (!icons && !fin) return;
  for (const line of raw.split('\n')) {
    if (line.indexOf('updateIcons') < 0 && line.indexOf('attackFinish') < 0) continue;
    let j; try { j = JSON.parse(line); } catch (_) { continue; }
    if (fin) atkFinish(j);
    if (icons) wsPush(j);
  }
} catch (_) { /* never disturb Torn's socket */ }
  }
  (function wsHook() {
try {
  const WS = PAGE.WebSocket, proto = WS && WS.prototype, orig = proto && proto.send;
  if (!orig || orig.dssHooked) return;
  const exp = typeof exportFunction === 'function';
  const listener = exp ? exportFunction(wsOnMessage, PAGE) : wsOnMessage;
  const hooked = new WeakSet();
  const send = function () {
    try {
      if (!hooked.has(this) && /centrifugo\.torn\.com/.test(String(this.url))) { hooked.add(this); this.addEventListener('message', listener); }
    } catch (_) { /* ignore */ }
    return orig.apply(this, arguments);
  };
  if (exp) exportFunction(send, proto, { defineAs: 'send' }); else proto.send = send;
  try { proto.send.dssHooked = true; } catch (_) { /* ignore */ }
} catch (_) { /* no hook: the war list still works */ }
  })();

  // ---- attacks in progress ----
  // Torn's war page polls faction_wars.php?step=getwardata (~every 6s, also on the ranked war view); its
  // warDesc.currentAttacks lists our faction's attacks in progress (attacker, defender, others joined). We read the
  // page's own responses - no requests of our own. The socket's attackFinish (channel faction-war-boxes-<id>) says
  // the moment one ends, so the marker clears straight away instead of on the next poll.
  const ATK_STALE_MS = 20000;                              // no poll for this long -> stop showing what we last saw
  let atkNow = {}, atkT = 0;                               // defenderId -> { by, name, others, mine }
  let atkUsers = {};                                       // names from the same poll
  // finished attacks, from the socket's attackFinish (newest first). The message names the attacker but not the target:
  // the target is filled in when someone goes into hospital "...by <attacker>" (their updateIcons) within a few seconds.
  const FEED_MAX = 15, FEED_KEEP_MS = 3600e3, FEED_MATCH_MS = 20000;
  let atkFeed = (GM_getValue('atkFeed', []) || []).filter(a => a && Date.now() - a.t < FEED_KEEP_MS);
  const hospSeen = [];                                     // recent hospitalisations { id, reason, t } waiting for their attackFinish
  function feedSave() { try { GM_setValue('atkFeed', atkFeed); } catch (_) { /* ignore */ } }
  const byName = (reason, id) => { const n = String(memberIdx[id] ? memberIdx[id].name : '').toLowerCase(); return !!n && String(reason || '').toLowerCase().indexOf(` by ${n}`) >= 0; };
  function feedMatch() {
const now = Date.now();
for (let i = hospSeen.length - 1; i >= 0; i--) if (now - hospSeen[i].t > FEED_MATCH_MS) hospSeen.splice(i, 1);
let hit = false;
for (const a of atkFeed) {
  if (a.def || now - a.seen > FEED_MATCH_MS) continue;
  const i = hospSeen.findIndex(h => byName(h.reason, a.by));
  if (i >= 0) { a.def = hospSeen[i].id; a.how = (hospSeen[i].reason.match(/^\s*(\w+)/) || [])[1] || ''; hospSeen.splice(i, 1); hit = true; }
}
return hit;
  }
  // a player went into hospital (from Torn's socket): maybe the target of an attack we just saw finish
  function feedHosp(id, reason) {
if (!reason || !/\bby\b/i.test(reason)) return;
hospSeen.push({ id, reason, t: Date.now() });
if (feedMatch()) { feedSave(); atkBar(); }
  }
  function atkSet(next) {
atkNow = next; atkT = Date.now();
atkBar();
  }
  // ---- online / idle / offline from the same poll (ranked war view): rankedWarMembers, both factions, ~6s fresh ----
  const ONLINE_FRESH_MS = 30000;
  let onlineNow = {}, onlineT = 0;                         // id -> 'Online' | 'Idle' | 'Offline'
  const ONLINE_MAP = { online: 'Online', idle: 'Idle', offline: 'Offline' };
  function onlineData(rwm) {
const next = {};
for (const id in rwm) { const st = rwm[id] && rwm[id].onlineStatus && ONLINE_MAP[String(rwm[id].onlineStatus.status).toLowerCase()]; if (st) next[id] = st; }
if (!Object.keys(next).length) return;
onlineNow = next; onlineT = Date.now();
if (onlineApply() && document.getElementById(BOX_ID)) render();
  }
  // lay the live online statuses over Tyronic's (called after every getstate too); true if anything changed
  function onlineApply() {
if (!state || !onlineT || Date.now() - onlineT > ONLINE_FRESH_MS) return false;
let changed = false;
const now = Date.now();
for (const f of [state.home_faction, state.away_faction]) for (const m of (f && f.members) || []) {
  const st = onlineNow[m.player_id];
  if (!st) continue;
  if (m.active_status !== st) { m.active_status = st; changed = true; }
  if (st === 'Online' && !(now - Date.parse(m.active_stamp) < 300000)) { m.active_stamp = new Date(now).toISOString(); changed = true; }   // online = active in the last few minutes
}
return changed;
  }

  // attack strip under the score header: newest on the right (attacks in progress at the far right), older ones
  // pushed off to the left. A new one slides in from the right; swipe/scroll left to see older ones.
  function atkBar() {
const box = document.getElementById(BOX_ID), bar = box && box.querySelector('.atkbar');
if (!bar) return;
const fresh = atkT && Date.now() - atkT < ATK_STALE_MS;
const myF = state && state.home_faction && state.home_faction.info && state.home_faction.info.faction_id;
const nm = id => { const u = atkUsers[id]; return esc((u && u.playername) || nameOf(id)); };
const me = state && state.user && state.user.user_id;
const items = [];
for (const a of atkFeed.slice(0, FEED_MAX).reverse()) {   // oldest first -> newest ends up on the right
  if (Date.now() - a.t > FEED_KEEP_MS) continue;
  const ours = !a.fac || !myF || +a.fac === +myF, gain = +a.respect > 0;
  const cls = !ours ? 'inc' : gain ? 'win' : 'loss';
  const who = +a.by === +me ? 'You' : nm(a.by);
  const verb = a.def ? esc((a.how || 'hit').toLowerCase()) : gain ? 'hit' : 'no respect';
  items.push(`<span class="ak ${cls} ${a.rw ? '' : 'nrw'}" data-k="f${a.id}"><b>${who}</b><i>${verb}</i>${a.def ? `<b>${nm(a.def)}</b>` : ''}${gain ? `<em>+${(+a.respect).toFixed(2)}</em>` : ''}</span>`);
}
if (fresh) for (const d in atkNow) {
  const a = atkNow[d];
  items.push(`<span class="ak live ${a.mine ? 'mine' : ''}" data-k="l${d}">${ICON.attack}<b>${a.mine ? 'You' : esc(a.name)}</b><i>\u2192</i><b>${nm(d)}</b>${a.others ? `<em>+${a.others}</em>` : ''}</span>`);
}
const html = items.join('');
const tr = bar.querySelector('.atk-track');
if (!bar.dssWired) {                                   // remember when they've scrolled back to read older ones
  bar.dssWired = true;
  // only the user's own scrolling counts (wheel / drag / swipe) - our animation and trimming also fire scroll events
  const touched = () => { bar.dssUser = Date.now(); };
  for (const ev of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']) bar.addEventListener(ev, touched, { passive: true });
  bar.addEventListener('scroll', () => { if (Date.now() - (bar.dssUser || 0) < 1500) bar.dssBack = bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 30; }, { passive: true });
}
const toEnd = force => { const x = bar.scrollWidth - bar.clientWidth; if (Math.abs(bar.scrollLeft - x) > 1 && (force || !(tr.getAnimations && tr.getAnimations().length))) bar.scrollLeft = x; };
if (bar.dssLast === html) { if (!bar.dssBack && !bar.hidden) toEnd(); return; }   // (e.g. it was laid out while hidden)
bar.dssLast = html;
const wasHidden = bar.hidden;
bar.hidden = !html;
// pills already showing: where they are now, so they can glide to their new place instead of jumping
const atEnd = !bar.dssBack;                            // (not if they've scrolled back to read)
const before = {};
if (!wasHidden && atEnd) for (const el of tr.children) before[el.dataset.k] = el.getBoundingClientRect().left;   // where they are on screen now (mid-slide too)
try { if (tr.getAnimations) tr.getAnimations().forEach(an => an.cancel()); } catch (_) { /* ignore */ }
tr.innerHTML = html;
if (!html) return;
if (atEnd) toEnd(true);
if (wasHidden || !atEnd || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
let shift = 0;                                           // how far the pills that were showing moved left to make room
for (let i = tr.children.length - 1; i >= 0; i--) { const el = tr.children[i]; if (el.dataset.k in before) { shift = before[el.dataset.k] - el.getBoundingClientRect().left; break; } }
if (shift > 0 && tr.animate) tr.animate([{ transform: `translateX(${shift}px)` }, { transform: 'translateX(0)' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function atkData(text) {
let j; try { j = JSON.parse(text); } catch (_) { return; }
if (j && j.rankedWarMembers && typeof j.rankedWarMembers === 'object') onlineData(j.rankedWarMembers);
const wd = j && j.warDesc;                             // only on the chain view
if (!wd || !Array.isArray(wd.currentAttacks)) return;
const users = wd.users || {}, next = {};
atkUsers = users;
for (const a of wd.currentAttacks) {
  if (!a || !a.defenderID || !a.attackerID) continue;
  const u = users[a.attackerID];
  next[a.defenderID] = { by: +a.attackerID, name: (u && u.playername) || nameOf(a.attackerID), others: Math.max(0, +a.attackersAmount || 0), mine: !!(state && state.user && +a.attackerID === +state.user.user_id) };   // (myAttack isn't reliable for this)
}
atkSet(next);
  }
  function atkFinish(j) {
const p = j && j.push;
if (!p || !/^faction-war-boxes-\d+$/.test(p.channel || '')) return;
const msg = p.pub && p.pub.data && p.pub.data.message;
const acts = msg && msg.namespaces && msg.namespaces.warBoxes && msg.namespaces.warBoxes.actions;
const f = acts && acts.attackFinish, by = f && f.attacker && +f.attacker.userId;
if (!by) return;
if (f.attackId && !atkFeed.some(a => a.id === f.attackId)) {
  const now = Date.now();
  atkFeed.unshift({ id: f.attackId, by, fac: f.attacker.factionId || null, respect: +f.respect || 0, rw: !!f.isRankedWar,
    t: f.currentTime ? f.currentTime * 1000 : now, seen: now, def: null });
  atkFeed = atkFeed.slice(0, FEED_MAX);
  feedMatch();
  feedSave();
}
const gone = Object.keys(atkNow).filter(k => atkNow[k].by === by);
if (!gone.length) { atkBar(); return; }               // (don't touch atkT: only a poll makes the in-progress list fresh)
gone.forEach(k => delete atkNow[k]);
atkBar();
  }
  (function fetchHook() {
try {
  const orig = PAGE.fetch;
  if (typeof orig !== 'function' || orig.dssHooked) return;
  const exp = typeof exportFunction === 'function';
  const onText = exp ? exportFunction(t => { try { atkData(String(t)); } catch (_) { /* ignore */ } }, PAGE) : t => { try { atkData(String(t)); } catch (_) { /* ignore */ } };
  const onRes = res => { try { if (PAGE.Response.prototype.dssHooked && res.url) return; res.clone().text().then(onText); } catch (_) { /* ignore */ } };   // Response hook has it
  const onResP = exp ? exportFunction(onRes, PAGE) : onRes;
  const wrap = function (input) {
    const p = orig.apply(this || PAGE, arguments);
    try {
      const url = String((input && input.url) || input || '');
      if (url.indexOf('faction_wars.php') >= 0 && url.indexOf('step=getwardata') >= 0) p.then(onResP);   // (its clone().text() is seen by the Response hook)
    } catch (_) { /* never disturb Torn's request */ }
    return p;
  };
  if (exp) exportFunction(wrap, PAGE, { defineAs: 'fetch' }); else PAGE.fetch = wrap;
  try { PAGE.fetch.dssHooked = true; } catch (_) { /* ignore */ }
} catch (_) { /* no hook: just no attack markers */ }
  })();
  // Torn's bundle can hold its own reference to fetch (taken before we ran), which skips the hook above. Whatever
  // called fetch, the page still reads the body with Response.text()/json() - so listen there too (same url check).
  (function responseHook() {
try {
  const R = PAGE.Response, proto = R && R.prototype;
  if (!proto || proto.dssHooked) return;
  const exp = typeof exportFunction === 'function';
  const isWar = r => { try { const u = String(r.url || ''); return u.indexOf('faction_wars.php') >= 0 && u.indexOf('step=getwardata') >= 0; } catch (_) { return false; } };
  const seen = exp ? exportFunction(v => { try { atkData(typeof v === 'string' ? v : PAGE.JSON.stringify(v)); } catch (_) { /* ignore */ } }, PAGE)
    : v => { try { atkData(typeof v === 'string' ? v : JSON.stringify(v)); } catch (_) { /* ignore */ } };
  for (const name of ['text', 'json']) {
    const orig = proto[name];
    if (typeof orig !== 'function') continue;
    const wrap = function () {
      const p = orig.apply(this, arguments);
      try { if (isWar(this)) p.then(seen); } catch (_) { /* never disturb Torn */ }
      return p;
    };
    if (exp) exportFunction(wrap, proto, { defineAs: name }); else proto[name] = wrap;
  }
  try { proto.dssHooked = true; } catch (_) { /* ignore */ }
} catch (_) { /* no hook */ }
  })();

  // updateIcons -> state from the icon tray (Hospital/Jail icons carry reason + seconds left)
  function wsPush(j) {
const p = j && j.push;
if (!p || !/^faction-users-\d+$/.test(p.channel || '')) return;
const msg = p.pub && p.pub.data && p.pub.data.message;
const acts = msg && msg.namespaces && msg.namespaces.users && msg.namespaces.users.actions;
const u = acts && acts.updateIcons;
if (!u || !u.userId || typeof u.icons !== 'string') return;
const ic = iconState(u.icons);
tornNote(+u.userId, ...ic);
if (ic[0] === 'Hospital' && ic[2]) feedHosp(+u.userId, ic[2].reason);
wsSoon();
  }
  function iconState(html) {
const doc = new DOMParser().parseFromString(html, 'text/html');   // inert: nothing in it runs
for (const li of doc.querySelectorAll('li[title]')) {
  const t = li.getAttribute('title') || '';
  const m = t.match(/^\s*<b>\s*(Hospital|Jail|Traveling|Abroad)\s*<\/b>/i);
  if (!m) continue;
  const st = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const secs = +((t.match(/data-time=['"]?(\d+)/) || [])[1]);
  const reason = plain(t.replace(/^[\s\S]*?<\/b>/i, '').replace(/<span[^>]*timer[\s\S]*$/i, '').replace(/<br\s*\/?>/gi, ' '));
  return [st, 'ws', { until: secs > 0 ? Date.now() + secs * 1000 : null, reason }];
}
return ['Clear', 'ws', null];
  }
  let wsTimer = null;
  function wsSoon() { if (!wsTimer) wsTimer = setTimeout(() => { wsTimer = null; tornTick(); }, 150); }   // batch bursts

  // lay Torn's Okay / Hospital / Jail over whatever we have; returns ids that changed
  function tornApply() {
if (!state) return [];
const now = Date.now(), done = [];
for (const f of [state.home_faction, state.away_faction]) for (const m of (f && f.members) || []) {
  const d = tornSeen[m.player_id];
  if (!tornValid(d)) continue;
  const until = Date.parse(m.status_until), timed = isFinite(until) && until > now;
  if (d.st === 'Okay' || d.st === 'Clear') {
    if (d.st === 'Clear' && now - d.at > 120000) continue;               // only trust "not locked up" while fresh
    if (!HJ(m.status_state) || (!timed && !m.until_unknown)) continue;    // already shows as out
    Object.assign(m, { status_state: 'Okay', status_color: 'green', status_description: 'Okay', status_details: '',
      status_until: '1970-01-01T00:00:00+00:00', until_unknown: false });
    done.push(m.player_id);
  } else if (HJ(d.st)) {
    const base = { status_state: d.st, status_color: 'red', status_description: d.st === 'Jail' ? 'In jail' : 'In hospital' };
    if (d.until) {                                                        // exact timer from the websocket
      if (d.until <= now) continue;
      if (m.status_state === d.st && timed && Math.abs(until - d.until) < 5000) continue;
      Object.assign(m, base, { status_details: d.reason || (m.status_state === d.st ? m.status_details : ''),
        status_until: new Date(d.until).toISOString(), until_unknown: false });
      done.push(m.player_id);
    } else if (m.status_state !== d.st || !(timed || m.until_unknown)) {  // list only: no timer yet
      Object.assign(m, base, { status_details: '', status_until: null, until_unknown: true });
      const L = f.info && live[f.info.faction_id], row = L && L.rows[m.player_id];
      if (f.info && !(row && row.status && row.status.state === d.st && row.status.until * 1000 > now)) liveNeed[f.info.faction_id] = true;
      done.push(m.player_id);
    }
  }
}
return done;
  }
  // every second, and shortly after websocket pushes
  function tornTick() {
if (!state) return;
domScan();
const changed = tornChanged.splice(0);
const applied = tornApply();
let hit = false;
for (const id of changed) {
  const d = tornSeen[id];
  if (d.st !== 'Hospital') continue;
  // a change we saw happen (a list flip, or a push while Tyronic still had them out) - not just our first look
  const before = d.from || (d.src === 'ws' && rawSnap && rawSnap.m[id] && rawSnap.m[id].state);
  if (before && before !== 'Hospital') { hit = true; dibClearFor(id, d.t); }
}
if (changed.length) liveDecide();
if (!applied.length && !hit) return;
liveKick(0);                                         // fetch any missing timers straight away
render();
  }
  // called after every getstate attempt: judge Tyronic on its own data first, then overlay if needed
  function liveOnTyronic(ok) {
if (ok) { snapRaw(); rememberWar(); }
liveDecide();
liveOverlay();
dibHideCleared();
optOverlay();
liveKick();
  }

  async function liveFetch(fid) {
const key = GM_getValue('tornKey', '');
if (!key || !fid) return false;
revStamps.push(Date.now());                                        // count against the shared per-minute budget
const res = await req('GET', `https://api.torn.com/v2/faction/${fid}/members?striptags=true&comment=dss-ty`,
  { accept: 'application/json', Authorization: `ApiKey ${key}` });
if (!res || res.error || !Array.isArray(res.members)) {
  if (res && res.error) revOnApiError(res.error);      // bad key -> stop; too many requests / IP block -> pause
  return false;
}
const t = Date.now(), prevT = live[fid] ? live[fid].t : 0, rows = {}, hit = [];
for (const r of res.members) {
  rows[r.id] = r;
  planeNote(r, t);
  const now = r.status && r.status.state;
  const k = stKey(now, plain(r.status && r.status.description));
  const seen = liveSeen[r.id];
  // was OK (by our last Torn read, or by Tyronic if this is our first read) and is now in hospital
  const before = seen ? seen.key.split('|')[0] : rawSnap && rawSnap.m[r.id] && rawSnap.m[r.id].state;
  if (now === 'Hospital' && before === 'Okay') hit.push(r.id);
  // key (state + description) drives travel timing; st/stT track the bare state for the staleness check
  // (hospital descriptions tick down every read, so the key alone would keep resetting)
  const stT = seen && seen.st === now ? seen.stT : t;
  if (!seen) liveSeen[r.id] = { key: k, t, st: now, stT };
  else if (seen.key !== k) liveSeen[r.id] = { key: k, t, change: prevT ? { lo: prevT, hi: t } : null, st: now, stT };
  else { seen.st = now; seen.stT = stT; }
}
live[fid] = { t, rows };
planeSave();
return { hit, t };
  }

  // ---- ticket type: Torn's faction members read gives status.plane_image_type while someone is in the air ----
  // private_jet = Private, light_aircraft = Airstrip, airliner = Standard, anything else = Business.
  // Kept per player with the trip it belongs to (description + when we saw it), so a later trip never reuses it.
  const PLANE_TICKET = { private_jet: 'Private', light_aircraft: 'Airstrip', airliner: 'Standard' };
  const PLANE_READ_MS = 30000;                             // unknown traveller -> at most one faction read per 30s
  const planeSeen = GM_getValue('planeSeen', {}) || {};    // id -> { desc, type, t }
  const planeTried = {};                                   // id -> desc we already read once without getting a type
  let planeDirty = false;
  function planeNote(r, t) {
const st = r.status || {};
if (st.state !== 'Traveling') return;
const desc = plain(st.description);
if (st.plane_image_type) {
  const type = PLANE_TICKET[st.plane_image_type] || 'Business';
  const old = planeSeen[r.id];
  if (!old || old.desc !== desc || old.type !== type) { planeSeen[r.id] = { desc, type, t }; planeDirty = true; }
} else planeTried[r.id] = desc;
  }
  function planeSave() {
if (!planeDirty) return;
planeDirty = false;
const now = Date.now();
for (const id in planeSeen) if (now - planeSeen[id].t > 6 * 3600e3) delete planeSeen[id];   // longest flight is ~5h
GM_setValue('planeSeen', planeSeen);
  }
  // the ticket for this member's current flight, or null if we don't know it
  function planeOf(m) {
if (!m || m.status_state !== 'Traveling') return null;
const p = planeSeen[m.player_id], desc = plain(m.status_description);
if (!p || p.desc !== desc) return null;
const dep = Date.parse(m.travel_departure_stamp), err = Math.max(0, Number(m.travel_departure_error) || 0) * 1000;
if (isFinite(dep) && dep > 0) {
  if (p.t < dep - err - 120000) return null;           // seen before this trip took off: an earlier flight on the same route
  if (p.t > dep + 5.5 * 3600e3) return null;
} else if (Date.now() - p.t > 5.5 * 3600e3) return null;
return p.type;
  }
  // a traveller in this faction whose ticket we don't know yet (and haven't already looked up for this trip)
  function planeNeeded(f) {
return (f && f.members || []).some(m => m.status_state === 'Traveling' && !planeOf(m) && planeTried[m.player_id] !== plain(m.status_description));
  }

  // ---- a dibbed target got hospitalised (Torn's list or an API read) before Tyronic noticed -> clear the dib(s) ----
  // Our own dib: ask Tyronic to remove it. Someone else's: just hide it here until Tyronic (or their panel) clears it.
  const dibCleared = {};                                 // dib_id -> { foe, t }
  function dibClearFor(foeId, t) {
if (!state || !state.dibs) return;
const me = state.user && state.user.user_id;
for (const d of state.dibs) {
  if (!d || d.optimistic || d.foe_id !== foeId || dibCleared[d.dib_id] || !(Date.parse(d.created_at) < t)) continue;
  dibCleared[d.dib_id] = { foe: foeId, t };
  if (d.player_id !== me) continue;
  api.removeDib(d).catch(() => { /* the local hide still applies */ });
}
dibHideCleared();
render();
  }
  function dibHideCleared() {
if (!state || !Array.isArray(state.dibs)) return;
const now = Date.now();
for (const id in dibCleared) {
  if (now - dibCleared[id].t > 15 * 60000) { delete dibCleared[id]; continue; }          // forget after 15 min
  // Tyronic still has it a minute after the hit (it decided to keep the dib): stop hiding it
  if (lastFetch - dibCleared[id].t > 60000 && state.dibs.some(d => d && String(d.dib_id) === id)) delete dibCleared[id];
}
state.dibs = state.dibs.filter(d => !d || !dibCleared[d.dib_id]);
  }
  let liveLastProbe = 0;
  // One pump loop only: a kick while a read is in flight just asks for another look straight after it.
  let liveAgain = false;
  function liveKick(ms) {
if (liveBusy) { if (ms === 0) liveAgain = true; return; }
if (ms === 0 || !liveTimer) { clearTimeout(liveTimer); liveTimer = setTimeout(livePump, ms || 0); }
  }
  function key2plane(ours, enemy, now) {
for (const f of [enemy, ours]) {
  const fid = f && f.info && f.info.faction_id;
  if (fid && (!live[fid] || now - live[fid].t >= PLANE_READ_MS) && planeNeeded(f)) return fid;
}
return null;
  }
  async function livePump() {
liveTimer = null;
if (liveBusy) return;
let wait = liveOn ? 1000 : 5000;                       // fallback on: check every second so reads land on time
try {
  if (Date.now() < revPauseUntil) return;              // Torn asked us to slow down (shared with revive checks)
  if (!state || document.hidden || !document.getElementById(BOX_ID) || !GM_getValue('tornKey', '') || revStop) return;
  const { ours, enemy } = sides(), now = Date.now();
  const eid = enemy && enemy.info && enemy.info.faction_id, oid = ours && ours.info && ours.info.faction_id;
  const eL = live[eid], oL = live[oid];
  let target = null;
  if (liveOn) {
    if (!oL || now - oL.t >= LIVE_OURS_MS) target = oid;
    else if (!eL || now - eL.t >= LIVE_FAST_MS) target = eid;
  } else {
    if (!tornLive()) tornTick();                     // first look at Torn's own data before deciding on a probe
    const need = [eid, oid].find(fid => liveNeed[fid] && (!live[fid] || now - live[fid].t >= LIVE_TIMER_MS));
    if (need) target = need;
    else if (key2plane(ours, enemy, now)) target = key2plane(ours, enemy, now);
    else if (!tornLive() && now - liveLastProbe >= (liveCand ? LIVE_GRACE_MS + 5000 : LIVE_PROBE_MS)) target = eid;
  }
  if (!target) return;
  liveBusy = true;
  if (!liveOn && !liveNeed[target]) liveLastProbe = now;
  delete liveNeed[target];
  const got = await liveFetch(target);
  if (got) {
    liveDecide();
    if (liveOn) for (const id of got.hit) dibClearFor(id, got.t);
    liveOverlay(); render();
  }
} catch (_) { wait = 15000; }
finally {
  liveBusy = false;
  if (!liveTimer) liveTimer = setTimeout(livePump, liveAgain ? 0 : wait);
  liveAgain = false;
}
  }

  // ================= Tyronic presence (who has Tyronic open) =================
  // Tyronic's chat shows "23/93 members": Supabase Realtime presence on the private channel realtime:channel:<factionId>
  // (a public channel of the same name is a different room). Torn's CSP blocks websockets to supabase.co, so we use
  // Realtime's HTTP long-poll transport through GM_xmlhttpRequest. Modes:
  //   snap (default): once a minute open a session, read the list, close it. Nothing stays open, so it can't hold up
  //                   dibs on setups that only allow a few connections per site. Others don't see you in this mode.
  //   live          : stay joined and count yourself for everyone (one request held open the whole time; desktop only -
  //                   on Torn PDA it would block the one-at-a-time request queue, so PDA always uses snap).
  //   off
  const PRES_SNAP_MS = 60000;
  // Torn PDA runs one request at a time, so a held-open poll would make a dib click wait behind it: off by default there
  const presMode = () => { const m = GM_getValue('presMode', SERIAL ? 'off' : 'snap'); return SERIAL && m === 'live' ? 'snap' : m; };
  const presOff = () => presMode() === 'off';
  let presRef = 0, presJoinRef = null, presTopic = null, presHb = null, presRetry = 0, presTimer = null;
  let presLive = false, presGen = 0, lpToken = null, lpJwt = null, presStarted = false, presSnapGot = false;
  const presence = {};                                     // playerId -> true while present
  let presKnown = false;                                   // got a presence_state at least once

  function presChanged() {
const box = document.getElementById(BOX_ID), el = box && box.querySelector('.pres-c');
if (!el) return;
const ids = Object.keys(presence), total = state && sides().ours ? (sides().ours.members || []).length : 0;
if (presKnown && state && state.user && !presence[state.user.user_id]) ids.push(String(state.user.user_id));   // we're here too
el.hidden = !presKnown || presOff();
const txt = `${ids.length}/${total}`;
const n = el.querySelector('.num'); if (n && n.textContent !== txt) n.textContent = txt;
const names = ids.map(id => (memberIdx[id] && memberIdx[id].name) || `#${id}`).sort((a, b) => a.localeCompare(b));
const tip = `${ids.length} on Tyronic now\n` + names.join(', ');
el.setAttribute('aria-label', tip.replace(/\n/g, ' \u00b7 '));
if (!noHover()) el.dataset.tt = tip;
  }

  // ---- long-poll requests: [join_ref, ref, topic, event, payload] ----
  // Same 'never hang' guarantee as reqOnce. On Torn PDA they go through the one-at-a-time queue (an action clicked
  // meanwhile waits for the poll in flight, at most ~8s - which is why presence is off by default there).
  function lpReqOnce(method, token, body) {
return new Promise(res => {
  let done = false;
  const resolve = v => { if (!done) { done = true; clearTimeout(dog); res(v); } };
  const dog = setTimeout(() => resolve({ http: 0, j: null }), SERIAL ? 8000 : 55000);   // PDA: never hold the queue long
  GM_xmlhttpRequest({
    method, url: `${SB}/realtime/v1/longpoll?apikey=${encodeURIComponent(lpJwt)}&vsn=2.0.0` + (token ? `&token=${encodeURIComponent(token)}` : ''),
    headers: Object.assign({ apikey: PUB_KEY, Authorization: `Bearer ${lpJwt}` }, body ? { 'Content-Type': 'application/json' } : {}),
    data: body, timeout: 45000,
    onload: r => { let j = null; try { j = JSON.parse(r.responseText); } catch (_) { /* empty */ } resolve({ http: r.status, j }); },
    onerror: () => resolve({ http: -1, j: null }),
    onabort: () => resolve({ http: -1, j: null }),
    ontimeout: () => resolve({ http: 0, j: null }),
  });
});
  }
  function lpReq(method, token, body) {
if (!SERIAL) return lpReqOnce(method, token, body);
return new Promise(resolve => { reqQueue.push({ run: () => lpReqOnce(method, token, body).then(resolve) }); reqPump(); });
  }
  function presSend(topic, event, payload, joinRef) {
if (!lpToken) return;
lpReq('POST', lpToken, JSON.stringify([joinRef === undefined ? presJoinRef : joinRef, String(++presRef), topic, event, payload]));
  }

  function presHandle(m) {
if (m.topic !== presTopic) return;
const p = m.payload || {};
if (m.event === 'phx_reply' && m.ref === presJoinRef) {
  if (p.status !== 'ok') { presStop(); presSchedule(); return; }
  presRetry = 0; presLive = true;
  if (presMode() === 'live') presSend(presTopic, 'presence', { type: 'presence', event: 'track', payload: { player_id: state.user.user_id, joined: new Date().toISOString() } });
} else if (m.event === 'phx_error' || m.event === 'phx_close') { presStop(); presSchedule(); }
else if (m.event === 'presence_state') {
  for (const k in presence) delete presence[k];
  for (const k in p) presence[k] = true;
  presKnown = true; presSnapGot = true; presChanged();
} else if (m.event === 'presence_diff') {
  for (const k in (p.joins || {})) presence[k] = true;
  for (const k in (p.leaves || {})) delete presence[k];
  presKnown = true; presChanged();
}
  }
  function presStop() {
presGen++; presLive = false;
clearInterval(presHb); presHb = null;
lpToken = null; presJoinRef = null;
  }
  function presSchedule(ms) {
clearTimeout(presTimer);
if (ms == null) ms = Math.min(60000, 3000 * Math.pow(2, presRetry++));
presTimer = setTimeout(() => { presTimer = null; presConnect(); }, ms);
  }

  async function lpRun() {
const gen = presGen, snap = presMode() === 'snap', t0 = Date.now();
try {
  let r = await lpReq('GET');                                     // new session: server answers 410 + token
  if (gen !== presGen) return;
  if (!r.j || !r.j.token) throw new Error('no session');
  lpToken = r.j.token;
  presJoinRef = String(++presRef);
  await lpReq('POST', lpToken, JSON.stringify([presJoinRef, presJoinRef, presTopic, 'phx_join', {
    config: { broadcast: { ack: false, self: false }, presence: { key: String(state.user.user_id), enabled: true }, postgres_changes: [], private: true },
    access_token: lpJwt }]));
  if (gen !== presGen) return;
  // live mode stays joined past the ~30 min login: hand the channel each new token before the old one expires
  if (!snap) presHb = setInterval(() => {
    presSend('phoenix', 'heartbeat', {}, null);
    getToken(false).then(t => { if (gen === presGen && t && t !== lpJwt) { lpJwt = t; presSend(presTopic, 'access_token', { access_token: t }); } }).catch(() => {});
  }, 30000);
  while (gen === presGen) {
    if (snap && (presSnapGot || Date.now() - t0 > 15000)) {      // got the list (or gave up): close up until next minute
      presSnapGot = false; presStop(); presSchedule(PRES_SNAP_MS);
      return;
    }
    if (document.hidden) { presStop(); presSchedule(PRES_SNAP_MS); return; }   // tab hidden: let go of the connection
    r = await lpReq('GET', lpToken);                              // held open by the server until something arrives
    if (gen !== presGen) return;
    if (!r.j) { if (r.http === 0) continue; throw new Error(`http ${r.http}`); }
    if (r.j.token) lpToken = r.j.token;
    if (r.j.status === 200) {
      for (const raw of r.j.messages || []) {
        let a = raw; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { continue; } }
        if (Array.isArray(a)) presHandle({ join_ref: a[0], ref: a[1], topic: a[2], event: a[3], payload: a[4] });
        else if (a && a.topic) presHandle(a);
      }
    } else if (r.j.status !== 204) throw new Error(`status ${r.j.status}`);   // 410 = session gone, 403 = refused
  }
} catch (_) {
  if (gen === presGen) { presStop(); presSchedule(); }
}
  }

  async function presConnect() {
if (presOff() || presLive || lpToken) return;
if (document.hidden || !document.getElementById(BOX_ID)) return presSchedule(PRES_SNAP_MS);   // not looking: check back later
if (!state || !state.user || !state.factionconfig || state.factionconfig.chat_enabled === false) return presSchedule();
try { lpJwt = await getToken(false); } catch (_) { return presSchedule(); }
presTopic = `realtime:channel:${state.user.faction_id}`;
lpRun();
  }

  // ================= win probability (straight port of Tyronic's model) =================
  const WP = {
ONLINE: 1, IDLE: 0.6, OFFLINE: 0.15, RECENT_S: 900, PCT: 0.9, CAP: [4, 12], ACT: [0.6, 1.4],
ONLINE_RATIO: [1, 5], STABLE_BASE: 0.7, SW_EXP: 0.5, SW_POW: 0.55, WS: [0.01, 0.99], LEAD: [-1, 1],
ODDS_MAX: 5, ODDS_K: 2.5, W_LO: 0.25, W_HI: 0.85, W_POW: 1.5,
  };
  const U = {
clamp: (t, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), t)),
sum: a => a.reduce((x, y) => x + y, 0),
avg: a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0,
percentile: (t, p) => { if (!t.length) return 0; const r = [...t].sort((a, b) => a - b), x = p * (r.length - 1), n = Math.floor(x), c = Math.ceil(x); return r[n] + (r[c] - r[n]) * (x - n); },
  };

  function winModel(ours, enemy) {
const sIdx = statsIndex();
const strength = mid => { const s = sIdx[mid] || {}; for (const p of ['SPY', 'BSP', 'FFSCOUTER', 'TORNSTATS', 'YATA']) if (s[p] && s[p].total) return s[p].total; return 0; };
const powers = members => members.map(m => ({ mid: m.player_id, power: Math.log10(Math.max(1, strength(m.player_id))) }));
const H = powers(ours.members || []), A = powers(enemy.members || []);
const cap = U.clamp(Math.sqrt(U.percentile(H.map(x => x.power), WP.PCT) * U.percentile(A.map(x => x.power), WP.PCT)), ...WP.CAP);
[...H, ...A].forEach(x => { x.power_cap = cap * Math.tanh(x.power / cap); });

const oursIsHome = state.home_faction === ours;
const act = arr => {
  const v = (arr || []).map(a => a.v);
  const o = { min: Math.max(1, Math.min(...v, Infinity)), max: Math.max(1, ...v), hour: Math.max(1, U.avg(v)) };
  const now = new Date(), hit = (arr || []).find(a => a.d === now.getUTCDay() && a.h === now.getUTCHours());
  if (hit) o.hour = Math.max(1, hit.v);
  return o;
};
const actOurs = act(oursIsHome ? state.home_activity : state.away_activity);
const actEnemy = act(oursIsHome ? state.away_activity : state.home_activity);

const nowS = Date.now() / 1000;
const statusMap = members => Object.fromEntries(members.map(m => {
  let w = WP.OFFLINE;
  const stamp = Date.parse(m.active_stamp) / 1000 || 0;
  if (m.active_status === 'Idle' || nowS - stamp < WP.RECENT_S) w = WP.IDLE;
  if (m.active_status === 'Online') w = WP.ONLINE;
  return [m.player_id, w];
}));

const target = (state.wardata && state.wardata.scoretarget) || 1;
const side = (st, pw, ac, score) => {
  const c = { warscore: score, wartargetscore: target };
  c.score_power_faction = U.sum(pw.map(a => a.power_cap * st[a.mid]));
  c.activity_ratio = U.clamp(Object.values(st).filter(x => x === WP.ONLINE).length / ac.hour, ...WP.ACT);
  c.score_power_faction_activity = c.score_power_faction * c.activity_ratio;
  c.faction_stability = U.clamp(ac.hour / ac.max, 0, 1);
  c.stable = c.score_power_faction_activity * (WP.STABLE_BASE + (1 - WP.STABLE_BASE) * c.faction_stability);
  c.online_power = U.sum(pw.map(a => st[a.mid] === WP.ONLINE ? a.power_cap : 0));
  return c;
};
const s = side(statusMap(ours.members || []), H, actOurs, (ours.warstats || {}).score || 0);
const t = side(statusMap(enemy.members || []), A, actEnemy, (enemy.warstats || {}).score || 0);

const swarm = r => Math.pow(r * Math.pow(2, WP.SW_EXP * (r - 1)), WP.SW_POW);
for (const [a, b] of [[s, t], [t, s]]) a.swarm = swarm(U.clamp(a.online_power / Math.max(1e-9, b.online_power), ...WP.ONLINE_RATIO));
s.score = s.stable * s.swarm; t.score = t.stable * t.swarm;
for (const [a, b] of [[s, t], [t, s]]) {
  a.warstrength = U.clamp(a.score / (a.score + b.score), ...WP.WS);
  a.odds_ws = Math.log(a.warstrength / (1 - a.warstrength));
  a.lead = U.clamp((a.warscore - b.warscore) / a.wartargetscore, ...WP.LEAD);
  a.odds_score = WP.ODDS_MAX * Math.tanh(WP.ODDS_K * a.lead);
  a.weight = WP.W_HI - (WP.W_HI - WP.W_LO) * Math.pow(U.clamp(Math.abs(a.lead), 0, 1), WP.W_POW);
  a.winprob = 1 / (1 + Math.exp(-(a.weight * a.odds_ws + (1 - a.weight) * a.odds_score)));
}
return (isFinite(s.winprob) && isFinite(s.warstrength)) ? { ours: s, enemy: t } : null;
  }

  // ================= helpers =================
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('en-GB');

  function fmtBS(n) {
if (n == null || !n) return '\u2014';
for (const [v, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
  if (n >= v) { const x = n / v; return +x.toFixed(x >= 100 ? 0 : 1) + s; }
}
return String(n);
  }

  function clock(ms) {
if (!isFinite(ms)) return '';
ms = Math.max(0, ms);
const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  const tct = () => new Date().toISOString().slice(11, 19);

  const sdateShort = t => { const d = new Date(t); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`; };
  function ago(ts) {
const d = (Date.now() - Date.parse(ts)) / 1000;
if (!isFinite(d)) return '?';
if (d < 60) return 'now';
if (d < 3600) return `${Math.floor(d / 60)}m`;
if (d < 86400) return `${Math.floor(d / 3600)}h`;
return `${Math.floor(d / 86400)}d`;
  }

  let memberIdx = {};
  const nameOf = id => (memberIdx[id] && memberIdx[id].name) || `#${id}`;

  function statsIndex() {
const idx = {};
for (const b of state.battlestats || []) (idx[b.player_id] = idx[b.player_id] || {})[b.bsprovider] = b;
return idx;
  }

  // relative strength vs. my own estimate -> Tyronic-style colour
  function strengthClass(total, mine) {
if (!total || !mine) return '';
const r = total / mine;
return r < 0.75 ? 'st-easy' : r < 1.5 ? 'st-even' : r < 3.5 ? 'st-hard' : 'st-nope';
  }

  // ---- travel flags: simplified inline SVGs (no external images, so Torn's CSP can't block them and
  // they look the same on Windows, which has no flag emoji). 30x20 viewBox, shown as 14px circles.
  const star = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => {
const a = (-90 + i * 36) * Math.PI / 180, rr = i % 2 ? r * 0.4 : r;
return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  const UNION = '<rect width="30" height="20" fill="#012169"/><path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/>'
+ '<path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" stroke-width="1.5"/><path d="M15 0V20M0 10H30" stroke="#fff" stroke-width="6"/>'
+ '<path d="M15 0V20M0 10H30" stroke="#C8102E" stroke-width="3.5"/>';
  const FLAG_SVG = {
'mexico': '<rect width="10" height="20" fill="#006847"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#CE1126"/><circle cx="15" cy="10" r="2.6" fill="#8C5B2B"/>',
'cayman islands': `<rect width="30" height="20" fill="#012169"/><g transform="scale(.5)">${UNION}</g><circle cx="22" cy="10.5" r="4" fill="#fff"/><path d="M19.5 12h5l-2.5 3z" fill="#C8102E"/><rect x="20" y="8" width="4" height="2.5" fill="#3a7ac2"/>`,
'canada': `<rect width="30" height="20" fill="#fff"/><rect width="7.5" height="20" fill="#D52B1E"/><rect x="22.5" width="7.5" height="20" fill="#D52B1E"/><polygon points="${star(15, 9.6, 5.6)}" fill="#D52B1E"/><rect x="14.4" y="12" width="1.2" height="4.5" fill="#D52B1E"/>`,
'hawaii': `${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect y="${i * 2.5}" width="30" height="2.5" fill="${['#fff', '#C8102E', '#012169'][i % 3]}"/>`).join('')}<g transform="scale(.5)">${UNION}</g>`,
'united kingdom': UNION,
'argentina': '<rect width="30" height="20" fill="#74ACDF"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><circle cx="15" cy="10" r="2.3" fill="#F6B40E"/>',
'switzerland': '<rect width="30" height="20" fill="#DA291C"/><rect x="13" y="4" width="4" height="12" fill="#fff"/><rect x="9" y="8" width="12" height="4" fill="#fff"/>',
'japan': '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#BC002D"/>',
'china': `<rect width="30" height="20" fill="#DE2910"/><polygon points="${star(5.5, 5, 3)}" fill="#FFDE00"/>${[[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y]) => `<polygon points="${star(x, y, 1)}" fill="#FFDE00"/>`).join('')}`,
'uae': '<rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#00732F"/><rect y="13.33" width="30" height="6.67" fill="#000"/><rect width="8" height="20" fill="#FF0000"/>',
'south africa': '<rect width="30" height="10" fill="#E03C31"/><rect y="10" width="30" height="10" fill="#001489"/>'
  + '<path d="M0 0L12 10H30M0 20L12 10" stroke="#fff" stroke-width="6" fill="none"/><path d="M0 0L12 10H30M0 20L12 10" stroke="#007749" stroke-width="3.6" fill="none"/>'
  + '<polygon points="0,3.4 8.2,10 0,16.6" fill="#FFB81C"/><polygon points="0,5.4 5.8,10 0,14.6" fill="#000"/>',
  };
  const FLAG_ALIAS = { 'uk': 'united kingdom', 'cayman': 'cayman islands', 'united arab emirates': 'uae', 'dubai': 'uae' };
  // flags are shown as round 20x20 crops of the 30x20 artwork (to match Torn's round icon); x = where the crop starts
  const FLAG_CROP = { 'china': 0, 'hawaii': 0, 'uae': 0, 'south africa': 0, 'cayman islands': 7 };
  const flagKey = name => { const k0 = String(name || '').trim().toLowerCase(); return FLAG_ALIAS[k0] || k0; };
  function flag(name) {
const k = flagKey(name);
const svgInner = FLAG_SVG[k];
const x = FLAG_CROP[k] != null ? FLAG_CROP[k] : 5;
return svgInner
  ? `<svg class="flag" viewBox="${x} 0 20 20" width="14" height="14" aria-hidden="true">${svgInner}</svg>`
  : `<span class="flag-txt">${esc(name || '?')}</span>`;            // unknown destination: fall back to the name
  }
  const PLANE = `<svg class="pl" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;
  const ARROW = '<svg class="ar" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  const PIN = '<svg class="pl" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>';
  // Torn's own favicon, same-origin so the page's CSP allows it
  const TORN = '<img class="flag torn" src="/favicon.ico" width="14" height="14" alt="Torn">';

  // ---- flight times (minutes, one way) by ticket: [business, private, airstrip, standard] ----
  const FLIGHT_MIN = {
'mexico': [8, 13, 18, 26], 'cayman islands': [11, 18, 25, 35], 'canada': [12, 20, 29, 41], 'hawaii': [40, 67, 94, 134],
'united kingdom': [48, 80, 111, 159], 'argentina': [50, 83, 117, 167], 'switzerland': [53, 88, 123, 175],
'japan': [68, 113, 158, 225], 'china': [72, 121, 169, 242], 'uae': [81, 135, 190, 271], 'south africa': [89, 149, 208, 297],
  };
  const TICKETS = ['Business', 'Private', 'Airstrip', 'Standard'];
  const hm = ms => new Date(ms).toISOString().slice(11, 16);

  // ---- travel popover: a small card with the route, departure window and one row per ticket ----
  function travelPlan(m) {
const st = statusInfo(m);
if (st.rank !== 3 || !st.where) return null;
const abroad = m.status_state === 'Abroad', back = m.travel_destination === 'Torn';
const dep = Date.parse(m.travel_departure_stamp), known = isFinite(dep);
const err = Math.max(0, Number(m.travel_departure_error) || 0) * 1000;
const mins = FLIGHT_MIN[flagKey(st.where)], ticket = planeOf(m);
const all = !abroad && known && mins ? TICKETS.map((t, i) => ({ t, lo: dep - err + mins[i] * 60000, hi: dep + mins[i] * 60000 })) : [];
return { abroad, back, country: st.where, known, lo: dep - err, hi: dep, exact: err <= 60000, ticket,
  rows: ticket ? all.filter(r => r.t === ticket) : all };
  }
  const relMin = ms => { const n = Math.max(1, Math.round(ms / 60000)); return n < 60 ? `${n}m` : `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m`; };
  function popHtml(id) {
const m = memberIdx[id], p = m && travelPlan(m);
if (!p) return '';
const now = Date.now();
const win = (lo, hi) => p.exact ? hm(hi) : `${hm(lo)}\u2013${hm(hi)}`;
const title = p.abroad ? `In ${p.country}` : p.back ? `Returning from ${p.country}` : `Flying to ${p.country}`;
const route = p.abroad ? `${PIN}${flag(p.country)}` : p.back ? `${flag(p.country)}${ARROW}${TORN}` : `${TORN}${ARROW}${flag(p.country)}`;
const sub = (!p.known ? 'Departure time unknown' : `${p.abroad ? 'Landed' : 'Left'} ${win(p.lo, p.hi)} TCT`)
  + (p.ticket ? ` \u00b7 <span class="pop-tk">${p.ticket}</span>` : '');
let marked = false;
const rows = p.rows.map(r => {
  let cls, when;
  if (now > r.hi) { cls = p.ticket ? 'now' : 'gone'; when = p.ticket ? 'due' : 'ruled out'; }   // known ticket: overdue, not ruled out              // still in the air after this ticket's latest landing
  else if (now >= r.lo) { cls = 'now'; when = 'landing now'; }
  else { cls = 'soon'; when = `in ${relMin(r.lo - now)}`; }
  if (cls !== 'gone' && !marked) { cls += ' first'; marked = true; } // earliest landing still possible
  return `<tr class="${cls}"><td>${r.t}</td><td class="num">${win(r.lo, r.hi)}</td><td class="num r">${when}</td></tr>`;
}).join('');
return `<div class="pop-h"><span class="pop-route">${route}</span><b>${esc(title)}</b></div>
      <div class="pop-sub">${sub}</div>
      ${rows ? `<table class="pop-t"><tbody>${rows}</tbody></table>` : ''}`;
  }
  let popId = null, popCell = null;
  function popShow(td) { popId = td.dataset.pop; popCell = td; popRefresh(); }
  function popHide() {
popId = null; popCell = null;
const el = document.querySelector(`#${BOX_ID} .pop`);
if (el) el.hidden = true;
  }
  // (re)draw and (re)position - called on show, every tick (live countdowns), after renders and on scroll
  function popRefresh() {
const box = document.getElementById(BOX_ID);
if (!box || popId == null) return;
const el = box.querySelector('.pop');
if (!popCell || !box.contains(popCell))           // redrawn: find it again (in an open pop-up first, else the table)
  popCell = box.querySelector(`.rcm:not([hidden]) [data-pop="${popId}"]`) || box.querySelector(`td[data-pop="${popId}"]`);
const html = popCell ? popHtml(popId) : '';
if (!html) return popHide();
const cr = popCell.getBoundingClientRect(), vw = document.documentElement.clientWidth;
const tw = box.querySelector('.tw'), twr = tw && tw.getBoundingClientRect();
if (twr && tw.contains(popCell) && (cr.bottom < twr.top || cr.top > twr.bottom)) { el.hidden = true; return; }   // row scrolled out of view
if (el.dssLast !== html) { el.innerHTML = html; el.dssLast = html; }
el.hidden = false;
const pw = el.offsetWidth, ph = el.offsetHeight;
const left = Math.max(8, Math.min(cr.left + cr.width / 2 - pw / 2, vw - pw - 8));
let top = cr.top - ph - 6;
if (top < 4) top = cr.bottom + 6;
placeFixed(el, left, top);
  }

  // hospital reason: anything "...by <someone>" came from another player; drugs, transfusions, crashes etc. are self-inflicted
  const isSelfHosp = d => !!d && !/\bby\b/i.test(d);
  // Torn's hospital reasons are long - boil them down to a word or two
  const HOSP_SHORT = [[/ipecac|emesis/i, 'Ipecac'], [/transfusion/i, 'Blood bag'], [/overdos/i, 'Overdose'], [/crash/i, 'Car crash'],
[/food poisoning/i, 'Food poisoning'], [/explo/i, 'Explosion'], [/burn/i, 'Burns'], [/fell|fall/i, 'Fall']];
  // Torn's status text can contain HTML, e.g. 'Attacked by <a href = "...XID=1">Name</a>' - keep just the text
  const plain = h => String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
.replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
  function hospLabel(d) {
d = plain(d);
if (!d) return 'In hospital';
const by = d.match(/\b(mugged|hospitali[sz]ed|attacked|beaten up|shot|lost to)\b.*?\bby\s+(.+)$/i);
if (by) return /^someone$/i.test(by[2].trim()) ? 'Attacked' : `${/mugged/i.test(by[1]) ? 'Mugged' : 'Attacked'} by ${by[2].trim()}`;
if (/\bby\b/i.test(d)) return d.length > 34 ? d.slice(0, 33) + '\u2026' : d;
const hit = HOSP_SHORT.find(([re]) => re.test(d));
return `Self-hosp \u00b7 ${hit ? hit[1] : (d.length > 28 ? d.slice(0, 27) + '\u2026' : d)}`;
  }

  function statusInfo(m) {
switch (m.status_state) {
  case 'Okay': return { rank: 1, cls: 'ok', text: 'OK' };
  case 'Hospital':
  case 'Jail': {
    // timer already over but the data hasn't caught up yet: they're out, treat them as attackable
    if (m.until_unknown) return { rank: 2, cls: 'hosp', text: m.status_state === 'Jail' ? 'Jail' : 'Hosp', until: Date.now() + 864e5, unknown: true,
      detail: m.status_state === 'Jail' ? 'Just jailed' : 'Just hospitalised' };
    const until = Date.parse(m.status_until);
    if (isFinite(until) && until > 0 && until <= Date.now())
      return { rank: 1, cls: 'ok', text: 'OK', out: true, detail: m.status_state === 'Jail' ? 'Out of jail' : 'Out of hospital' };
    if (m.status_state === 'Jail') return { rank: 2, cls: 'hosp', text: 'Jail', until };
    const self = isSelfHosp(plain(m.status_details));
    return { rank: 2, cls: 'hosp', text: 'Hosp', until, self,
      detail: hospLabel(m.status_details) };
  }
  case 'Traveling': {
    const back = m.travel_destination === 'Torn';
    const where = back ? plain(m.status_description).replace(/^Traveling from (.*) to Torn$/, '$1') : m.travel_destination;
    return { rank: 3, cls: 'trav', text: back ? `\u2708 ${where} \u2192 Torn` : `\u2708 \u2192 ${where}`,
      icon: back ? `${PLANE}${flag(where)}${ARROW}${TORN}` : `${PLANE}${TORN}${ARROW}${flag(where)}`,
      detail: back ? `Returning to Torn from ${where}` : `Travelling to ${where}`, where, fkey: back ? 'torn' : flagKey(where) };
  }
  case 'Abroad': return { rank: 3, cls: 'trav', text: `In ${m.travel_destination || 'abroad'}`,
    icon: `${PIN}${flag(m.travel_destination)}`, detail: `Abroad in ${m.travel_destination || 'another country'}`, where: m.travel_destination || '', fkey: flagKey(m.travel_destination) };
  default: return { rank: 4, cls: 'muted', text: plain(m.status_description) || m.status_state || '?' };
}
  }

  function sides() {
const my = state.user && state.user.faction_id;
const h = state.home_faction, a = state.away_faction;
return (h && h.info && h.info.faction_id === my) ? { ours: h, enemy: a } : { ours: a, enemy: h };
  }

  function counts(members) {
const c = { Online: 0, Idle: 0, Offline: 0 };
for (const m of members || []) c[m.active_status] = (c[m.active_status] || 0) + 1;
return c;
  }

  const bsOf = (s, p) => (s && s[p] && s[p].total) || null;
  // One "Stats" figure per player: a spy if it's at least as new as every other estimate,
  // otherwise the average of the other estimates (an older spy is left out so it can't drag the average).
  // Build type from a spy's stat split (the only source with a breakdown); YATA's Offensive/Defensive guess as a fallback.
  //   Glass cannon : STR+SPD at least 65% and DEF, DEX each under 15%
  //   Def / Dex    : that stat is over 30% and the biggest (both over 30% -> Def/Dex)
  //   Balanced     : biggest stat no more than 1.5x the smallest
  //   otherwise    : named after the biggest stat, e.g. "Str-heavy"
  function buildOf(s) {
const spy = s && s.SPY;
const SPY_BUILD_MAX_AGE = 180 * 86400000;            // an older spy's split is too stale to trust (stats get retrained)
if (spy && spy.total && Date.now() - (Date.parse(spy.statsdate) || 0) <= SPY_BUILD_MAX_AGE) {
  const v = { Str: +spy.strength || 0, Def: +spy.defense || 0, Spd: +spy.speed || 0, Dex: +spy.dexterity || 0 };
  const sum = v.Str + v.Def + v.Spd + v.Dex;
  if (sum > 0 && Math.abs(sum - spy.total) <= spy.total * 0.05) {      // skip partial spies (unknown stats come through as 0)
    const sh = {}; for (const k in v) sh[k] = v[k] / sum;
    const keys = Object.keys(sh).sort((a, b) => sh[b] - sh[a]);
    let label;
    if (sh.Str + sh.Spd >= 0.65 && sh.Def < 0.15 && sh.Dex < 0.15) label = 'Glass cannon';
    else if (sh.Def > 0.3 && sh.Dex > 0.3) label = 'Def/Dex';
    else if (sh.Def > 0.3 && keys[0] === 'Def') label = 'Def';
    else if (sh.Dex > 0.3 && keys[0] === 'Dex') label = 'Dex';
    else if (Math.min(...Object.values(v)) > 0 && sh[keys[0]] / sh[keys[3]] <= 1.5) label = 'Balanced';
    else label = `${keys[0]}-heavy`;
    return { label, src: 'spy' };
  }
}
const y = s && s.YATA && s.YATA.build_type;
return y ? { label: y, src: 'YATA guess' } : null;
  }

  function bestEst(s) {
s = s || {};
const spy = s.SPY && s.SPY.total ? s.SPY : null;
const others = ['FFSCOUTER', 'BSP', 'YATA'].map(p => s[p]).filter(b => b && b.total);
const date = b => Date.parse(b.statsdate) || 0;
if (spy && (!others.length || date(spy) >= Math.max(...others.map(date)))) return { v: spy.total, kind: 'SPY', used: [spy] };
if (!others.length) return { v: null, kind: null, used: [] };
return { v: Math.round(others.reduce((a, b) => a + b.total, 0) / others.length), kind: others.length > 1 ? 'AVG' : others[0].bsprovider, used: others };
  }

  // exact port of Tyronic's Status sort value: green 1, red 2 (by release time), blue returning 3 / out 4 (by destination)
  function tyStatusKey(m) {
if (!m || m.status_state === 'Fallen') return [99, 0, ''];
if (m.status_color === 'green') return [1, 0, ''];
if (m.status_color === 'red') { if (m.until_unknown) return [2, Infinity, '']; const u = Date.parse(m.status_until) || 0; return u > 0 && u <= Date.now() ? [1, 0, ''] : [2, u, '']; }
if (m.status_color === 'blue') return [String(m.status_description || '').includes('Returning') ? 3 : 4, 0, String(m.travel_destination || '').toLowerCase()];
return [98, 0, ''];
  }
  const num0 = v => (v == null ? Infinity : v);   // missing values sort last
  const revRank = id => { const r = revValue(id); return !r ? 2 : r.v ? 0 : 1; };
  function sortRows(rows) {
const cmp = {
  smart: (a, b) => a.st.rank - b.st.rank
    || (a.st.rank === 2 ? a.st.until - b.st.until : 0)
    || num0(a.est) - num0(b.est),
  name: (a, b) => a.m.name.localeCompare(b.m.name),
  status: (a, b) => {
    const ka = tyStatusKey(a.m), kb = tyStatusKey(b.m);
    return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  },
  est: (a, b) => num0(a.est) - num0(b.est),
  score: (a, b) => b.score - a.score,             // highest first, like a leaderboard
  bsp: (a, b) => num0(a.bsp) - num0(b.bsp),
  ffs: (a, b) => num0(a.ffs) - num0(b.ffs),
  yata: (a, b) => num0(a.yata) - num0(b.yata),
  level: (a, b) => a.m.level - b.m.level,
  last: (a, b) => Date.parse(b.m.active_stamp) - Date.parse(a.m.active_stamp),
  dib: (a, b) => (b.dib ? 1 : 0) - (a.dib ? 1 : 0),
  rev: (a, b) => revRank(a.m.player_id) - revRank(b.m.player_id),   // Yes, No, unknown, not checked
  roll: (a, b) => rollRank(a.roll) - rollRank(b.roll),
}[sortKey] || (() => 0);
// no pinning: dibbed targets stay where Tyronic would list them; ties break on player id like Tyronic
return rows.sort((a, b) => cmp(a, b) * sortDir || a.m.player_id - b.m.player_id);
  }

  // ================= icons (lucide-style line icons, like Tyronic) =================
  const svg = inner => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON = {
dib: svg('<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>'),
assist: svg('<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>'),
attack: svg('<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/>'),
spin: svg('<path d="M21 12a9 9 0 1 1-6.2-8.56"/>'),
ok: svg('<path d="M20 6 9 17l-5-5"/>'),
hosp: svg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>'),
selfhosp: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
jail: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 3v18M12 3v18M16 3v18"/>'),
power: svg('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'),
globe: svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
note: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
// raised fist, filled like Torn's faction icon
fist: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6.5" y="2.5" width="2.6" height="6" rx="1.3"/><rect x="9.6" y="2" width="2.6" height="6.5" rx="1.3"/><rect x="12.7" y="2.3" width="2.6" height="6.2" rx="1.3"/><rect x="15.8" y="3" width="2.4" height="5.5" rx="1.2"/><path d="M6.5 8h11.7v4.2a3 3 0 0 1-1 2.2l-.7.6V22H8.2v-7c-1-.6-1.7-1.6-1.7-2.8z"/><rect x="4.2" y="7.2" width="7.8" height="2.6" rx="1.3" transform="rotate(-8 8 8.5)"/><path d="M9 11.5h4" stroke="#0f1012" stroke-width=".9" stroke-linecap="round"/></svg>',
coins: svg('<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>'),
roll: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'),
bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
revive: svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>'),
  };

  // ================= styles =================
  const B = `#${BOX_ID}`;
  GM_addStyle(`
    [class*="factionWarInfo___"][data-dss-graph="show"] { display: block !important; visibility: visible !important; height: auto !important; max-height: none !important; overflow: visible !important; opacity: 1 !important; }
    [class*="factionWarInfo___"][data-dss-graph="hide"] { display: none !important; }
    @property --score { syntax: '<percentage>'; inherits: true; initial-value: 50%; }
    .${HIDE} { display: none !important; }
    ${B} {
      --bg: #0f1012; --panel: #16171a; --row: #17181b; --row2: #131417; --line: #2a2c31;
      --txt: #e6e7ea; --mut: #8b9099; --acc: #e5484d; --red: #f0616d; --ok: #3ddc84; --warn: #f5a524; --yel: #e2c35b; --blue: #4ea3ff;
      clear: both; margin: 10px 0; background: var(--bg); color: var(--txt); border: 1px solid var(--line); border-radius: 8px;
      font: 12.5px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; overflow: hidden;
      position: relative;
    }
    ${B} * { box-sizing: border-box; }
    ${B} a, ${B} a:visited, ${B} a:hover { color: inherit; text-decoration: none; }
    ${B} .num { font-variant-numeric: tabular-nums; }
    ${B} button { font: inherit; cursor: pointer; }

    /* ---- header ---- */
    ${B} .hd { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 16px 12px 12px; background: linear-gradient(180deg,#18191d,#111215); }
    ${B} .fac { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; min-width: 0; }
    ${B} .fac.right { text-align: right; }
    ${B} .fac-top { display: flex; align-items: center; gap: 8px; }
    ${B} .fac.right .fac-top { flex-direction: row-reverse; }
    ${B} .fac-tag { width: 26px; height: 26px; border-radius: 4px; object-fit: contain; background: #0003; flex: none; }
    ${B} .fac-name { font-size: 14px; font-weight: 600; color: var(--txt) !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .fac-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8px; gap: 8px; }
    ${B} .fac.right .fac-row { flex-direction: row-reverse; }
    ${B} .fac-score { font-size: 22px; font-weight: 700; line-height: 1; color: var(--txt); }
    ${B} .fac-sub { color: var(--mut); font-size: 11px; margin-top: 3px; }
    ${B} .pres { display: flex; gap: 8px; color: var(--txt); white-space: nowrap; }
    ${B} .pres i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; vertical-align: 1px; }
    ${B} .chain { margin-top: 6px; color: var(--mut); font-size: 11px; display: flex; justify-content: space-between; align-items: center; }
    ${B} .fac.right .chain, ${B} .fac.right .bar { transform: scaleX(-1); }
    ${B} .fac.right .chain > * { transform: scaleX(-1); }
    ${B} .ctimer { padding: 1px 8px; border: 1px solid var(--line); border-radius: 99px; color: var(--txt); }
    ${B} .ctimer.warn { color: var(--warn); border-color: #7a5a14; } ${B} .ctimer.crit { color: var(--red); border-color: var(--acc); }
    ${B} .ctimer.cd { color: var(--blue); }
    ${B} .chain b { color: var(--txt); }
    ${B} .mid { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 110px; }
    ${B} .lead { width: 104px; height: 104px; border-radius: 50%; border: 2px solid var(--line); background: var(--panel); display: flex; flex-direction: column; align-items: center; justify-content: center; }
    ${B} .lead b { font-size: 24px; line-height: 1; }
    ${B} .lead span { color: var(--txt); margin-top: 4px; }
    ${B} .lead.win b { color: var(--ok); } ${B} .lead.lose b { color: var(--red); }
    ${B} .bar { width: 100%; height: 5px; border-radius: 3px; background: #2a2c31; margin-top: 8px; overflow: hidden; }
    ${B} .bar > div { height: 100%; background: var(--red); }
    ${B} .fac.ours .bar > div { background: var(--ok); }
    ${B} .pill.tct { margin-top: 4px; color: var(--mut); }
    ${B} .fsbtn[hidden] { display: none; } ${B} .fsbtn svg { display: block; width: 15px; height: 15px; }
    ${B} .pill.strat { margin-top: 4px; display: inline-flex; align-items: center; gap: 5px; max-width: 160px; color: var(--txt); background: #f5a52414; border-color: #7a5a14; font: inherit; font-size: 11px; }
    ${B} .pill.strat span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .pill.strat svg { width: 13px; height: 13px; flex: none; color: var(--warn); }
    ${B} button.pill.strat { cursor: pointer; } ${B} button.pill.strat:hover { border-color: var(--warn); }
    ${B} .wi { --score: 50%; --winprob: 50%; position: absolute; top: 0; left: 0; right: 0; height: 12px; z-index: 7; cursor: help; }
    ${B} .wi[hidden] { display: none; }
    ${B} .wi::before { content: ""; position: absolute; top: 2px; left: var(--winprob); transform: translateX(-50%); transition: left 2s ease;
      height: 5px; width: 48px; background: linear-gradient(to bottom, transparent, #e0b33a 2px); border-radius: 0 0 6px 6px; }
    ${B} .ws { width: 100%; height: 3px; transition: --score 2s ease;
      background: linear-gradient(to right, rgb(61 220 132 / .8) calc(var(--score) - 3%), rgb(240 97 109 / .8) calc(var(--score) + 3%)); }
    ${B} .wtip { display: none; position: absolute; top: 12px; left: var(--winprob); transform: translateX(-50%); white-space: nowrap;
      background: #1b1c20; border: 1px solid #34363c; border-left: 3px solid #5fb3e6; border-radius: 8px; padding: 8px 12px; line-height: 1.6;
      font-size: 12px; color: var(--txt); box-shadow: 0 8px 24px #000a; z-index: 8; }
    ${B} .wi:hover .wtip, ${B} .wi.open .wtip { display: block; }
    ${B} .wtip { left: clamp(120px, var(--winprob), calc(100% - 120px)) !important; }
    ${B} .wtip b.gold { color: #e0b33a; } ${B} .wtip b.g { color: var(--ok); } ${B} .wtip b.r { color: var(--red); }
    ${B} .pill { margin-top: 8px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 99px; color: var(--blue); font-size: 11px; }

    /* ---- toolbar ---- */
    ${B} .atkbar { position: relative; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; border-top: 1px solid var(--line); background: #0f1013; padding: 5px 0; font-size: 11.5px;
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 32px); mask-image: linear-gradient(90deg, transparent, #000 32px); }
    ${B} .atkbar::-webkit-scrollbar { display: none; }
    ${B} .atkbar[hidden] { display: none; }
    ${B} .atk-track { display: flex; justify-content: flex-end; gap: 8px; width: max-content; min-width: 100%; box-sizing: border-box; padding: 0 12px; }
    ${B} .ak { flex: none; }
    ${B} .ak { display: inline-flex; align-items: center; gap: 5px; padding: 1px 9px; border-radius: 999px; white-space: nowrap; line-height: 18px;
      border: 1px solid #2a2c33; background: #17181c; color: var(--mut); }
    ${B} .ak b { color: var(--txt); font-weight: 600; }
    ${B} .ak i { font-style: normal; }
    ${B} .ak em { font-style: normal; font-weight: 600; }
    ${B} .ak svg { width: 11px; height: 11px; flex: none; }
    ${B} .ak.live { color: #ffb4b9; background: #f0616d1f; border-color: #f0616d66; }
    ${B} .ak.live em { color: #fff; }
    ${B} .ak.live.mine { color: #9ff0c0; background: #3ddc841f; border-color: #3ddc8466; }
    ${B} .ak.win em { color: var(--ok); }
    ${B} .ak.loss i { color: var(--warn); }
    ${B} .ak.inc { border-color: #f0616d44; } ${B} .ak.inc i { color: var(--red); }
    ${B} .ak.nrw { opacity: .6; }
    ${B} .tb { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--panel); }
    ${B} .tb-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    ${B} .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    ${B} .seg button { background: transparent; color: var(--mut); border: 0; padding: 4px 10px; }
    ${B} .seg button + button { border-left: 1px solid var(--line); }
    ${B} .seg button.on { background: #2a2c31; color: var(--txt); }
    ${B} .tb input[type=search] { background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 4px 8px; width: 200px; font: inherit; }
    ${B} .tb .sp { flex: 1; }
    ${B} .ghost { background: transparent; border: 1px solid var(--line); color: var(--mut) !important; border-radius: 6px; padding: 4px 8px; }
    ${B} .ghost:hover { color: var(--txt) !important; border-color: #444; }
    ${B} .age { color: var(--mut); font-size: 11px; display: inline-block; min-width: 58px; text-align: right; white-space: nowrap; position: relative; padding-left: 10px; font-variant-numeric: tabular-nums; }
    ${B} .age::before { content: ""; position: absolute; left: 0; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%; background: var(--blue); opacity: 0; transition: opacity .2s; }
    ${B} .age.busy::before { opacity: 1; animation: dss-pulse .8s ease-in-out infinite; }
    ${B} .ghost.on { color: var(--txt) !important; border-color: #555; background: #2a2c31; }
    ${B} .revtog { display: inline-flex; align-items: center; padding: 3px 8px; }
    ${B} .tb .ctry[hidden] { display: none; }
    ${B} .tb .ctry { gap: 5px; }
    ${B} .cbtn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 5px; border-radius: 999px; }
    ${B} .cbtn .flag { display: block; flex: none; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff40; }
    ${B} .cbtn .flag-txt { font-size: 11px; }
    ${B} .cbtn img.flag { display: block; width: 16px; height: 16px; border-radius: 50%; }
    ${B} .cbtn.on { color: var(--txt) !important; border-color: var(--blue); background: #4ea3ff1f; }
    ${B} .cbtn.clr { padding: 3px 8px; }
    ${B} .revtog.on { color: var(--ok) !important; border-color: #2f6b45; background: #3ddc8414; }
    ${B} .cfg { padding: 10px 12px; background: #131417; border-bottom: 1px solid var(--line); }
    /* pre-war / roll call bar */
    /* Torn list mode: the table-only controls (tabs, filters, country picker, search) would do nothing - hide them */
    ${B}.orig .seg[data-g=view], ${B}.orig .tb-filters, ${B}.orig .tb .ctry, ${B}.orig .tb input[type=search] { display: none !important; }
    ${B} .wbar { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--line); background: #15161a; }
    ${B} .wbar.pre { background: linear-gradient(90deg, #4ea3ff14, transparent 70%); }
    ${B} .wbar .wb-i { display: inline-flex; color: var(--blue); }
    ${B} .wbar .sp { flex: 1; }
    ${B} .rbtn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    ${B} .wbar > * { flex-shrink: 0; white-space: nowrap; }
    ${B} .wbar > .sp { flex-shrink: 1; }
    ${B} .pres-c { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; background: #3ddc8414; border: 1px solid #3ddc8433; }
    ${B} .pres-c[hidden] { display: none; }
    ${B} .pres-c svg { width: 14px; height: 14px; color: var(--ok); }
    ${B} .pres-c .num { color: var(--txt); font-weight: 600; }
    ${B} .rbtn.todo { color: var(--warn) !important; border-color: #7a5a14; animation: dss-pulse 1.8s ease-in-out infinite; }
    /* roll call column */
    ${B} .rc { display: inline-flex; align-items: center; gap: 5px; vertical-align: middle; }
    ${B} .rc-i { display: inline-flex; } ${B} .rc-i svg { width: 14px; height: 14px; }
    ${B} .rc-i.y { color: var(--ok); } ${B} .rc-i.n { color: var(--red); } ${B} .rc-i.m { color: var(--warn); } ${B} .rc-i.note { color: var(--mut); }
    ${B} .rc-h { color: var(--txt); font-size: 11px; }
    ${B} table td.c-roll.none { color: #555a63; }
    /* roll call form */
    /* pop-up forms float over the whole page (so they work in Torn list mode, and open where you're looking) */
    ${B} .rcm { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 99990; display: flex; align-items: flex-start; justify-content: center; padding: 16px 0; background: #000b; overflow-y: auto; }
    ${B} .rcm-card { max-height: calc(100vh - 32px); overflow-y: auto; margin: auto 0; }   /* centred; top-aligned if taller than the screen */
    ${B} .rcm[hidden] { display: none; }
    ${B} .rcm-card { width: min(360px, calc(100% - 24px)); padding: 14px 16px; border-radius: 10px; background: #17181c; border: 1px solid #33363d; box-shadow: 0 14px 40px #000c; }
    ${B} .rcm-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    ${B} .rcm-hd b { font-size: 13px; letter-spacing: .3px; text-transform: uppercase; }
    ${B} .rcm-q { margin: 10px 0 5px; color: var(--txt); font-weight: 500; }
    ${B} .rcm .seg { display: flex; } ${B} .rcm .seg button { flex: 1; padding: 6px 0; }
    ${B} .rcm .seg button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .rcm-later[hidden] { display: none; }
    ${B} .rcm-hour, ${B} .rcm-note { width: 100%; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 6px 8px; font: inherit; }
    ${B} .rcm-err { min-height: 16px; margin-top: 8px; color: #ff8a8d; font-size: 11.5px; }
    ${B} .rcm-go { width: 100%; margin-top: 4px; padding: 8px 0; }
    ${B} .mcm .rcm-card { position: relative; width: min(440px, calc(100% - 24px)); }
    ${B} .acm .rcm-card { width: min(640px, calc(100% - 24px)); }
    ${B} .crm .rcm-card { width: min(460px, calc(100% - 24px)); }
    ${B} .cr-box { margin: 10px 0 14px; padding: 12px 14px; border-radius: 10px; border: 1px solid #2f6b45; background: #3ddc840d; text-align: center; line-height: 1.6; }
    ${B} .cr-box > b { font-size: 18px; } ${B} .cr-box div { color: var(--mut); }
    ${B} .cr-box.low { border-color: #7a5a14; background: #f5a5240f; } ${B} .cr-box.low div { color: #ffd27a; }
    ${B} .cr-box.crit { border-color: var(--acc); background: #e5484d14; } ${B} .cr-box.crit div { color: #ff8a8d; }
    ${B} .fsbtn.cr-warn { color: var(--warn) !important; border-color: #7a5a14; animation: dss-crw 1.4s ease-in-out infinite; }
    ${B} .fsbtn.cr-crit { color: #ff6b70 !important; border-color: var(--acc); animation: dss-crc 1s ease-in-out infinite; }
    @keyframes dss-crw { 50% { background: #f5a52433; box-shadow: 0 0 0 3px #f5a52426; } }
    @keyframes dss-crc { 50% { background: #e5484d40; box-shadow: 0 0 0 3px #e5484d33; } }
    ${B} .crm p { margin: 0 0 6px; } ${B} .crm a { color: var(--blue) !important; text-decoration: underline !important; }
    ${B} .crm ul { margin: 0 0 8px 18px; padding: 0; color: var(--txt); line-height: 1.6; }
    ${B} .cr-calc { font-size: 12px; padding-top: 8px; border-top: 1px solid #ffffff0d; }
    ${B} .fsm .rcm-card { width: min(440px, calc(100% - 24px)); }
    ${B} button.fs-sw { padding: 0; cursor: pointer; } ${B} button.fs-sw:disabled, ${B} button.fs-si:disabled { opacity: .5; cursor: default; }
    ${B} .fs-st { padding: 2px 9px; min-width: 28px; } ${B} button.fs-si { background: none; cursor: pointer; } ${B} button.fs-si:hover { color: var(--txt); }
    ${B} .fs-custom input, ${B} .fs-custom textarea { width: 100%; margin: 0 0 6px; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 6px 8px; font: inherit; resize: vertical; }
    ${B} .fs-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 2px; border-top: 1px solid #ffffff0d; }
    ${B} .fs-l { display: inline-flex; align-items: center; gap: 8px; color: var(--txt); } ${B} .fs-l svg { width: 15px; height: 15px; color: var(--mut); flex: none; }
    ${B} .fs-sw { position: relative; width: 34px; height: 19px; border-radius: 999px; background: #2a2c31; border: 1px solid #3a3d44; flex: none; }
    ${B} .fs-sw i { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #6b707a; transition: left .15s; }
    ${B} .fs-sw.on { background: #4ea3ff33; border-color: #4ea3ff88; } ${B} .fs-sw.on i { left: 17px; background: var(--blue); }
    ${B} .fs-val { display: inline-flex; align-items: center; gap: 10px; } ${B} .fs-val b { min-width: 28px; text-align: right; }
    ${B} .fs-bar { width: 110px; height: 4px; border-radius: 2px; background: #2a2c31; overflow: hidden; } ${B} .fs-bar i { display: block; height: 100%; background: var(--blue); }
    ${B} .fs-strat { display: inline-flex; gap: 4px; }
    ${B} .fs-si { display: inline-flex; padding: 4px; border-radius: 6px; color: #5b606a; border: 1px solid transparent; } ${B} .fs-si svg { width: 16px; height: 16px; }
    ${B} .fs-si.on { color: var(--txt); border-color: var(--blue); background: #4ea3ff1f; }
    ${B} .fs-custom { margin: 2px 0 6px; padding: 8px 10px; border-radius: 8px; background: #0f1012; border: 1px solid var(--line); font-size: 12px; } ${B} .fs-custom div { color: var(--mut); white-space: pre-wrap; margin-top: 3px; }
    ${B} .fs-upd { margin-top: 8px; font-size: 11px; text-align: right; }
    ${B} .trm .rcm-card { width: min(780px, calc(100% - 24px)); max-height: calc(100vh - 40px); display: flex; flex-direction: column; }
    ${B} .trm .rcm-hd { gap: 8px; flex-wrap: wrap; } ${B} .trm-ctl { display: flex; gap: 6px; margin-left: auto; }
    ${B} .trm-sort { display: inline-flex; } ${B} .trm .trm-sort button { flex: none; padding: 4px 10px; white-space: nowrap; } ${B} .trm-sort button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .trm [data-a=travempty].on { color: var(--txt); border-color: var(--blue); }
    ${B} .trm-body { overflow: auto; margin-top: 6px; }
    ${B} .tv-grid { display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1fr); gap: 6px 8px; align-items: start; }
    ${B} .tv-corner { grid-column: 1; }
    ${B} .tv-fh { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 2px 6px; border-bottom: 2px solid; font-size: 12px; }
    ${B} .tv-fh.ours { border-color: #3b8fe8; } ${B} .tv-fh.enemy { border-color: #e5484d; }
    ${B} .tv-fh b { text-transform: uppercase; letter-spacing: .4px; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .tv-cnt { display: inline-flex; gap: 3px; color: var(--mut); }
    ${B} .tv-f { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 999px; background: none; border: 1px solid transparent; color: var(--mut); font: inherit; cursor: pointer; }
    ${B} .tv-f:hover { border-color: var(--line); color: var(--txt); }
    ${B} .tv-all { padding: 3px 9px; border-radius: 999px; background: #4ea3ff1f; border: 1px solid var(--blue); color: var(--txt); font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
    ${B} .tv-ct[data-tctry] { cursor: pointer; } ${B} .tv-ct[data-tctry]:hover span { text-decoration: underline; }
    ${B} .tv-f.on { border-color: var(--blue); background: #4ea3ff1f; color: var(--txt); }
    ${B} .tv-cnt svg { width: 12px; height: 12px; }
    ${B} .tv-ct { display: flex; align-items: center; gap: 7px; min-height: 30px; font-weight: 600; font-size: 11.5px; white-space: nowrap; text-transform: uppercase; letter-spacing: .3px; }
    ${B} .tv-ct.mt { color: var(--mut); font-weight: 500; min-height: 18px; }
    ${B} .tv-ct .flag { width: 16px; height: 16px; border-radius: 50%; flex: none; box-shadow: 0 0 0 1px #ffffff40; }
    ${B} .tv-c { border-radius: 8px; padding: 3px 0; background: #1b1d22; border: 1px solid #2c2f36; border-left: 3px solid; }
    ${B} .tv-c.ours { border-left-color: #3b8fe8; } ${B} .tv-c.enemy { border-left-color: #e5484d; }
    ${B} .tv-c.none { background: none; border: 0; padding: 0; }
    ${B} .tv-p { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 76px; align-items: center; gap: 6px; padding: 3px 9px 3px 7px; }
    ${B} .tv-p.soon { background: #f5a52414; }
    ${B} .tv-ic { display: flex; } ${B} .tv-ic.out { color: var(--blue); } ${B} .tv-ic.back { color: var(--warn); } ${B} .tv-ic.abroad { color: var(--mut); }
    ${B} .tv-n { color: var(--txt) !important; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${B} .tv-n:hover { text-decoration: underline; }
    ${B} .tv-s { font-size: 12px; } ${B} .tv-s.none { color: var(--mut); }
    ${B} .tv-s.st-easy { color: var(--ok); } ${B} .tv-s.st-even { color: var(--yel); } ${B} .tv-s.st-hard { color: var(--warn); } ${B} .tv-s.st-nope { color: var(--red); }
    ${B} .tv-t { text-align: right; font-size: 12px; color: var(--txt); white-space: nowrap; } ${B} .tv-now { color: var(--ok); font-weight: 600; }
    ${B} .tv-p.soon .tv-t { color: var(--warn); font-weight: 600; }
    ${B} .tv-none, ${B} .tv-empty { margin-top: 10px; font-size: 12px; } ${B} .tv-none { text-align: center; padding: 24px 0; }
    /* phones: country as a heading, each faction's card below it */
    ${B}.w560 .tv-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 5px 6px; }
    ${B}.w560 .tv-fh { flex-wrap: wrap; row-gap: 2px; } ${B}.w560 .tv-f { padding: 1px 4px; }
    ${B}.w560 .tv-corner { display: none; } ${B}.w560 .tv-corner:not(:empty) { display: block; grid-column: 1 / -1; order: -1; }
    ${B}.w560 .tv-ct { grid-column: 1 / -1; min-height: 0; margin-top: 4px; }
    ${B}.w560 .tv-ct.mt { margin-top: 0; }
    ${B}.w560 .tv-p { grid-template-columns: 14px minmax(0, 1fr) auto; row-gap: 0; padding: 3px 6px; font-size: 12px; }
    ${B}.w560 .tv-p .tv-t { grid-column: 2 / -1; text-align: left; font-size: 11px; }
    ${B}.w560 .tv-cnt { gap: 5px; }
    ${B} .rsm .rcm-card { width: min(640px, calc(100% - 24px)); max-height: calc(100vh - 40px); overflow: auto; }
    ${B} .rsm .rcm-hd { gap: 10px; } ${B} .rsm-top { margin-left: auto; font-size: 12px; } ${B} .rsm-top b { font-size: 15px; }
    ${B} .rs-q { margin-top: 12px; }
    ${B} .rs-qh { color: var(--txt); font-weight: 500; margin-bottom: 6px; }
    ${B} .rs-bar { display: flex; gap: 2px; height: 12px; border-radius: 4px; overflow: hidden; }
    ${B} .rs-seg { border: 0; padding: 0; min-width: 4px; cursor: pointer; opacity: .85; }
    ${B} .rs-seg:hover, ${B} .rs-seg.on { opacity: 1; box-shadow: inset 0 0 0 2px #ffffffaa; }
    ${B} .rs-keys { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 6px; }
    ${B} .rs-key { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; background: transparent; border: 1px solid transparent; color: var(--mut); cursor: pointer; font-size: 12px; }
    ${B} .rs-key b { color: var(--txt); }
    ${B} .rs-key:hover { border-color: var(--line); } ${B} .rs-key.on { border-color: var(--blue); background: #4ea3ff1a; color: var(--txt); }
    ${B} .rs-key i, ${B} .rs-nh i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex: none; }
    ${B} .rs-empty { font-size: 12px; }
    ${B} .rsm-names { margin-top: 14px; padding: 10px; border-radius: 8px; background: #0f1012; border: 1px solid var(--line); }
    ${B} .rsm-names:empty { display: none; }
    ${B} .rs-nh { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    ${B} .rs-nh > span { display: inline-flex; align-items: center; gap: 6px; }
    ${B} .rs-groups { max-height: 260px; overflow: auto; }
    ${B} .rs-band + .rs-band { margin-top: 8px; }
    ${B} .rs-bh { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--mut); margin-bottom: 4px; }
    ${B} .rs-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    ${B} .rs-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: #1d1f24; border: 1px solid var(--line); color: var(--txt) !important; text-decoration: none; font-size: 12px; }
    ${B} .rs-chip:hover { border-color: var(--blue); }
    ${B} .rsm-hours { margin-top: 14px; } ${B} .rsm-hours:empty { display: none; }
    ${B} .rsm-hours svg { display: block; width: 100%; height: auto; overflow: visible; }
    ${B} .rsm-hours .hb { fill: var(--blue); } ${B} .rsm-hours .hn { fill: var(--txt); font-size: 10px; }
    ${B} .rsm-hours .ax { fill: var(--mut); font-size: 10px; } ${B} .rsm-hours .gl { stroke: #ffffff1f; }
    ${B} .rsm-hours .mk { stroke: var(--warn); stroke-dasharray: 3 3; } ${B} .rsm-hours .mkt { fill: var(--mut); font-size: 9.5px; }
    ${B} .rsm-notes { margin-top: 14px; } ${B} .rsm-notes:empty { display: none; }
    ${B} .rsm-notes summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; margin-bottom: 0; }
    ${B} .rsm-notes summary::-webkit-details-marker { display: none; }
    ${B} .rsm-notes summary::before { content: '\u25b8'; color: var(--mut); font-size: 11px; transition: transform .15s; }
    ${B} .rsm-notes details[open] summary::before { transform: rotate(90deg); }
    ${B} .rsm-notes details[open] summary { margin-bottom: 6px; }
    ${B} .rs-note { padding: 5px 0; border-top: 1px solid #ffffff0d; font-size: 12px; color: var(--mut); } ${B} .rs-note b { color: var(--txt); margin-right: 6px; }
    ${B} .rb-c { font-size: 12px; }
    ${B} .acm-sub { font-size: 11.5px; margin-bottom: 8px; }
    ${B} .acm-days { display: flex; margin-bottom: 8px; } ${B} .acm-days button { flex: 1; padding: 5px 0; position: relative; }
    ${B} .acm-days button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .acm-days i { position: absolute; left: 50%; bottom: 1px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--mut); }
    ${B} .acm-plot { position: relative; }
    ${B} .acm-plot svg { display: block; width: 100%; height: auto; overflow: visible; }
    ${B} .acm-plot .gl { stroke: #ffffff12; stroke-width: 1; }
    ${B} .acm-plot .ax { fill: var(--mut); font-size: 10px; font-variant-numeric: tabular-nums; }
    ${B} .acm-plot .ln { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    ${B} .acm-plot .dl { fill: var(--txt); font-size: 11px; }
    ${B} .acm-plot .mk { stroke: var(--warn); stroke-width: 1; stroke-dasharray: 3 3; }
    ${B} .acm-plot .now { stroke: #ffffff55; stroke-width: 1; stroke-dasharray: 2 3; }
    ${B} .acm-plot .mkt { fill: var(--mut); font-size: 9.5px; }
    ${B} .acm-plot .xh { stroke: #ffffff40; stroke-width: 1; }
    ${B} .acm-plot .hov circle { stroke: #17181c; stroke-width: 2; }
    ${B} .acm-plot .hit { fill: transparent; cursor: crosshair; }
    ${B} .acm-tip { position: absolute; top: 4px; padding: 6px 9px; border-radius: 6px; background: #0f1012f2; border: 1px solid var(--line); pointer-events: none; font-size: 11.5px; min-width: 140px; }
    ${B} .acm-tip[hidden] { display: none; }
    ${B} .acm-tip b { display: block; margin-bottom: 3px; }
    ${B} .acm-tip div { display: flex; align-items: center; gap: 6px; color: var(--mut); } ${B} .acm-tip .num { margin-left: auto; color: var(--txt); font-weight: 600; }
    ${B} .acm-tip i, ${B} .acm-leg i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
    ${B} .acm-leg { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; font-size: 12px; }
    ${B} .acm-leg span { display: inline-flex; align-items: center; gap: 6px; }
    ${B} .acm-sum { margin-top: 6px; font-size: 11.5px; }
    ${B} .acm-none { padding: 30px 0; text-align: center; }
    ${B} .mcm-pop { position: absolute; left: 50%; bottom: 58px; transform: translate(-50%, 8px); display: flex; align-items: center; gap: 7px;
      padding: 8px 14px; border-radius: 999px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none;
      transition: opacity .18s, transform .18s; box-shadow: 0 8px 24px #000b; }
    ${B} .mcm-pop.show { opacity: 1; transform: translate(-50%, 0); }
    ${B} .mcm-pop.ok { background: #143323; border: 1px solid var(--ok); color: #9ff0c0; }
    ${B} .mcm-pop.warn { background: #3a2a0c; border: 1px solid var(--warn); color: #ffd27a; }
    ${B} .mcm-pop svg { width: 15px; height: 15px; }
    ${B} .rcm-go.done { background: var(--ok); color: #0c2416; }
    ${B} .mcm .seg button.on { background: #4ea3ff26; color: var(--txt); }
    ${B} .mcm-idle { width: 100%; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 6px 8px; font: inherit; }
    ${B} .mcm-chk { display: flex; align-items: center; gap: 7px; margin: 10px 0 0; color: var(--txt); cursor: pointer; }
    ${B} .mcm-hd2 { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 5px; }
    ${B} .mcm-out { width: 100%; height: 170px; resize: vertical; background: var(--bg); border: 1px solid var(--line); color: var(--txt);
      border-radius: 6px; padding: 7px 8px; font: 11.5px/1.5 ui-monospace, Consolas, monospace; white-space: pre; }
    ${B} .cfg[hidden] { display: none; }
    ${B} .cfg label { display: block; color: var(--txt); margin-bottom: 6px; font-weight: 500; }
    ${B} .cfg label small { color: var(--mut); font-weight: 400; }
    ${B} .cfg-row { display: flex; gap: 6px; flex-wrap: wrap; }
    ${B} .cfg-poll { margin-top: 10px; align-items: center; gap: 8px; }
    ${B} .cfg-poll label { display: inline-block; margin: 0; width: 160px; flex: none; }   /* fixed label column -> inputs line up */
    ${B} .cfg .cfg-poll input { flex: none; width: 64px; min-width: 0; text-align: center; }
    ${B} .cfg [class$=-saved] { color: var(--ok); font-size: 11.5px; }
    ${B} .cfg input { flex: 1; min-width: 180px; background: var(--bg); border: 1px solid var(--line); color: var(--txt); border-radius: 6px; padding: 5px 8px; font: 12px ui-monospace, Consolas, monospace; letter-spacing: .5px; }
    ${B} .cfg input:focus { outline: none; border-color: var(--blue); }
    ${B} .keyin.masked { -webkit-text-security: disc; text-security: disc; }
    @supports not (-webkit-text-security: disc) {
      ${B} .keyin.masked:not(:placeholder-shown) { color: transparent; text-shadow: 0 0 7px rgb(230 231 234 / .75); }
    }
    ${B} .btn-save { background: var(--blue); color: #08111d; border: 0; border-radius: 6px; padding: 5px 14px; font-weight: 600; }
    ${B} .cfg-status { margin-top: 6px; min-height: 15px; color: var(--mut); font-size: 11.5px; }
    ${B} .cfg-status.ok { color: var(--ok); } ${B} .cfg-status.err { color: #ff8a8d; }
    /* desktop: settings as two columns of rows - name + hint on the left, the control on the right */
    ${B}:not(.w560) .cfg { padding: 12px 14px 6px; }
    ${B}:not(.w560) .cfg-status:empty { min-height: 0; margin: 0; }
    ${B}:not(.w560) .cfg-set { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; margin-top: 8px; align-items: start; }
    ${B}.w760:not(.w560) .cfg-set { grid-template-columns: 1fr; }
    ${B}:not(.w560) .cfg-poll { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "l c" "h s"; align-items: center;
      column-gap: 14px; row-gap: 2px; margin: 0; padding: 9px 0; border-top: 1px solid #ffffff0f; }
    ${B}:not(.w560) .cfg-poll label { grid-area: l; width: auto; }
    ${B}:not(.w560) .cfg-poll > input, ${B}:not(.w560) .cfg-poll > .seg { grid-area: c; justify-self: end; }
    ${B}:not(.w560) .cfg .cfg-poll input { width: 70px; padding: 5px 6px; }
    ${B}:not(.w560) .cfg-poll > .muted { grid-area: h; font-size: 11px; line-height: 1.35; }
    ${B}:not(.w560) .cfg-poll > .muted small { font-size: inherit; }
    ${B}:not(.w560) .cfg-poll > [class$=-saved] { grid-area: s; justify-self: end; font-size: 11px; }
    ${B}:not(.w560) .cfg-poll > [class$=-saved]:empty { display: none; }
    ${B}:not(.w560) .cfg-poll .seg button { padding: 4px 10px; }
    ${B} .age.bad { color: var(--red); }

    /* ---- table ---- */
    ${B} .tw { max-height: 70vh; overflow: auto; scrollbar-gutter: stable; }
    ${B} table { width: 100%; border-collapse: collapse; font: inherit; font-size: 11.5px; color: var(--txt); }
    ${B} table th { position: sticky; top: 0; z-index: 1; background: #1a1b1f; color: var(--mut); font-weight: 500; text-align: left; padding: 6px 5px; border-bottom: 1px solid var(--acc); white-space: nowrap; cursor: pointer; user-select: none; }
    ${B} table th.on { color: var(--blue); }
    ${B} table th .sa { display: inline-block; font-size: 10px; line-height: 1; margin: 0 3px; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; vertical-align: 1px; }
    ${B} table th.r, ${B} table td.r { text-align: right; }
    ${B} table th.c, ${B} table td.c { text-align: center; }
    ${B} table th:last-child, ${B} table td:last-child { padding-right: 16px; }
    ${B} a.pname { display: inline-block; max-width: 120px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
    ${B} .dibber > :first-child { max-width: 90px; }
    ${B} table td { padding: 4px 5px; border-bottom: 1px solid #1f2024; white-space: nowrap; color: var(--txt); }
    ${B} tbody tr { background: var(--row2); }
    ${B} tbody tr:nth-child(even) { background: var(--row); }
    ${B} tbody tr:hover { background: #202227; }
    ${B} tr.taken td:not(.keep) { opacity: .6; }
    /* your own row (Ours tab): blue tint + accent bar, solid colour so the sticky name cell matches */
    ${B} tbody tr.me { background: #16223a; }
    ${B} tbody tr.me:hover { background: #1b2944; }
    ${B} tbody tr.me > td:first-child { box-shadow: inset 3px 0 0 var(--blue); }
    ${B} tr.me .pname { color: #d6e7ff; font-weight: 600; }
    ${B} tr.unavail td:not(.keep) { opacity: .6; }
    ${B} .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
    ${B} .Online { background: var(--ok); } ${B} .Idle { background: var(--warn); } ${B} .Offline { background: #5b606a; }
    ${B} a.pname { color: var(--txt) !important; font-weight: 500; }
    ${B} a.pname:hover { color: #fff !important; text-decoration: underline; }
    ${B} table td.ok { color: var(--ok); } ${B} table td .hosp { color: var(--red); } ${B} table td .trav { color: var(--blue); }
    ${B} table td.muted, ${B} .muted { color: var(--mut); }
    ${B} table td.st-easy { color: var(--ok); } ${B} table td.st-even { color: var(--yel); }
    ${B} table td.st-hard { color: var(--warn); } ${B} table td.st-nope { color: var(--red); }
    ${B} table td.none { color: #555a63; }
    ${B} table td.c-rev svg { width: 14px; height: 14px; vertical-align: middle; }
    ${B} table td.rev-wait svg { opacity: .35; } ${B} table td.rev-busy { color: var(--blue); }
    ${B} table td.rev-busy svg { animation: dss-spin .8s linear infinite; }
    ${B} table td.rev-y { color: var(--ok); } ${B} table td.rev-n { color: #5b606a; } ${B} table td.rev-n svg { opacity: .45; }
    ${B} th.c-rev .rev-h { display: inline-flex; vertical-align: -3px; } ${B} th.c-rev .rev-h svg { width: 14px; height: 14px; }
    ${B} .dibber { display: inline-flex; gap: 6px; align-items: center; padding-left: 7px; border-left: 2px solid var(--red); }
    ${B} tr.mine .dibber { border-color: var(--warn); }
    ${B} .dibber .as { color: var(--mut); font-size: 11px; }

    /* ---- action icons ---- */
    ${B} .acts { display: inline-flex; gap: 2px; vertical-align: middle; }
    ${B} .ic { display: inline-flex; align-items: center; justify-content: center; width: 23px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: #cfd2d8 !important; padding: 0; }
    ${B} .ic:hover { background: #2a2c31; color: #fff !important; }
    ${B} .ic.on { color: var(--warn) !important; }
    ${B} .ic.taken { color: var(--red) !important; }
    ${B} .ic[disabled] { opacity: .35; cursor: not-allowed; background: transparent; }
    ${B} .ic.atk:hover { color: var(--red) !important; }
    ${B} .ic.off { opacity: .35; }
    ${B} .ic.ask { color: var(--ok) !important; animation: dss-pulse 1.4s ease-in-out infinite; }
    @keyframes dss-pulse { 50% { opacity: .35; } }
    ${B} .dibber .help { display: inline-flex; color: var(--warn); }
    ${B} .dibber .help svg { width: 13px; height: 13px; }
    ${B} .ic.busy svg { animation: dss-spin .8s linear infinite; }
    @keyframes dss-spin { to { transform: rotate(360deg); } }

    ${B} .msg { padding: 18px 12px; color: var(--mut); }
    ${B} .err { color: #ff8a8d; }
    /* travel card */
    ${B} .pop { position: fixed; z-index: 99995; min-width: 240px; padding: 10px 12px; border-radius: 8px; pointer-events: none;
      background: #1c1d22; border: 1px solid #33363d; box-shadow: 0 10px 28px #000b; font-size: 12px; color: var(--txt); }
    ${B} .pop[hidden] { display: none; }
    ${B} .tt { position: fixed; z-index: 99995; max-width: min(320px, calc(100vw - 12px)); width: max-content; padding: 6px 9px; border-radius: 6px; pointer-events: none;
      background: #1c1d22; border: 1px solid #33363d; box-shadow: 0 6px 18px #000a; font-size: 11.5px; line-height: 1.4; white-space: nowrap; }
    ${B} .tt b { white-space: normal; }
    ${B} .tt[hidden] { display: none; }
    ${B} .tt b { display: block; color: var(--txt); font-weight: 600; }
    ${B} .tt div { color: var(--mut); white-space: normal; overflow-wrap: anywhere; }
    ${B} .tt div.hl { display: flex; align-items: baseline; gap: 6px; margin: 3px 0 4px; padding: 3px 7px; border-radius: 5px;
      background: #4ea3ff1a; border: 1px solid #4ea3ff33; }
    ${B} .tt .hl .k { color: var(--mut); font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
    ${B} .tt .hl .v { color: var(--blue); font-weight: 600; }
    ${B} .tt .hl .s { color: var(--mut); font-size: 10.5px; margin-left: auto; padding-left: 8px; }
    ${B} .pop-h { display: flex; align-items: center; gap: 9px; }
    ${B} .pop-route { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 999px; background: #4ea3ff14; border: 1px solid #4ea3ff2e; }
    ${B} .pop-route .pl { display: block; color: var(--blue); } ${B} .pop-route .ar { display: block; color: var(--mut); }
    ${B} .pop-route .flag { display: block; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff40; }
    ${B} .pop-sub { color: var(--mut); font-size: 11px; margin: 4px 0 8px; }
    ${B} .pop-tk { color: var(--txt); font-weight: 600; }
    ${B} .pop table.pop-t { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    ${B} .pop table.pop-t td { padding: 4px 6px 4px 0; border: 0; border-top: 1px solid #26282e; background: transparent; color: var(--txt); }
    ${B} .pop table.pop-t td:last-child { padding-right: 0; }
    ${B} .pop table.pop-t tr { background: transparent; }
    ${B} .pop table.pop-t td:nth-child(2) { padding-left: 10px; }
    ${B} .pop table.pop-t td:nth-child(3) { padding-left: 14px; color: var(--mut); }
    ${B} .pop tr.gone td { color: #555a63; } ${B} .pop tr.gone td:nth-child(2) { text-decoration: line-through; }
    ${B} .pop tr.gone td:nth-child(3) { color: #555a63; }
    ${B} .pop tr.first td { color: var(--blue); font-weight: 600; } ${B} .pop tr.first td:nth-child(3) { color: var(--blue); }
    ${B} .pop tr.now td, ${B} .pop tr.now td:nth-child(3) { color: var(--ok); font-weight: 600; }
    ${B} .toast { position: fixed; left: 0; top: 0; z-index: 99996; max-width: 75%; padding: 8px 12px; border-radius: 6px; white-space: pre-line; background: #26282e; border: 1px solid var(--line); box-shadow: 0 6px 20px #0008; color: var(--txt); }
    ${B} .toast.ok { border-color: #2f6b45; } ${B} .toast.warn { border-color: #7a5a14; } ${B} .toast.err { border-color: var(--acc); color: #ffb3b5; }

    /* phone "all columns" mode: every column, sideways scroll, player + actions pinned */
    ${B}.w560.mcols-all .c-score, ${B}.w560.mcols-all .c-bsp, ${B}.w560.mcols-all .c-ffs, ${B}.w560.mcols-all .c-yata,
    ${B}.w560.mcols-all .c-lvl, ${B}.w560.mcols-all .c-last, ${B}.w560.mcols-all .c-rev, ${B}.w560.mcols-all .c-roll { display: table-cell !important; }
    ${B}.w560.mcols-all .m-meta { display: none !important; }
    /* Compact on any width: just the combined Stats figure, no per-provider columns */
    ${B}:not(.mcols-all) .c-bsp, ${B}:not(.mcols-all) .c-ffs, ${B}:not(.mcols-all) .c-yata { display: none; }
    ${B}.w560.mcols-all table td, ${B}.w560.mcols-all table th { padding: 6px 7px; }
    ${B}.w560.mcols-all .c-name { position: sticky; left: 0; z-index: 2; background: inherit; }
    ${B}.w560.mcols-all th.c-name { z-index: 3; background: #1a1b1f; }
    ${B}.w560.mcols-all .c-act { position: sticky; left: var(--namew, 120px); z-index: 2; background: inherit; }
    ${B}.w560.mcols-all .tw.scrolled .c-act { box-shadow: 6px 0 6px -4px #0009; }
    ${B}.w560.mcols-all th.c-act { z-index: 3; background: #1a1b1f; }
    ${B}.w560.mcols-all tbody td { background: inherit; }
    ${B}.w560.mcols-all .swipe-hint { display: block; }
    ${B} .swipe-hint { display: none; text-align: right; color: var(--mut); font-size: 10.5px; padding: 3px 8px 0; }

    /* hospital / jail chip: [icon] countdown, same shape as the travel chip */
    ${B} .hchip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 6px; border-radius: 999px;
      background: #f0616d17; border: 1px solid #f0616d38; vertical-align: middle; line-height: 1.2; }
    ${B} .hchip svg { display: block; flex: none; width: 13px; height: 13px; }
    ${B} .hchip .num { min-width: 34px; }
    ${B} .dwarn { display: inline-flex; align-items: center; gap: 7px; margin-left: 10px; padding: 4px 11px; border-radius: 999px; min-width: 0;
      background: #f5a52422; border: 1px solid var(--warn); color: #ffd27a !important; font-weight: 500; white-space: nowrap;
      animation: dss-pulse 1.2s ease-in-out infinite; }
    ${B} .dwarn[hidden] { display: none; }
    ${B} .dwarn svg { width: 14px; height: 14px; flex: none; }
    ${B} .dwarn i { font-style: normal; font-size: .82em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .85; }
    ${B} .dwarn b { color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
    ${B} .dwarn.out { background: #3ddc8422; border-color: var(--ok); color: #9ff0c0 !important; }
    ${B} .dwarn:hover { animation: none; filter: brightness(1.2); }
    ${B}.w560 .dwarn { order: -1; flex: 1 1 100%; justify-content: center; margin: 0 0 4px; }
    /* desktop: centred in the top toolbar row and bigger */
    ${B} .tb-row:first-child { position: relative; }
    ${B}:not(.w760) .dwarn { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); margin: 0;
      gap: 9px; padding: 7px 20px; font-size: 14.5px; max-width: min(46%, calc(100% - 480px));   /* never over the buttons either side */ box-shadow: 0 0 18px #f5a52433; }
    ${B}:not(.w760) .dwarn.out { box-shadow: 0 0 18px #3ddc8433; }
    ${B}:not(.w760) .dwarn svg { width: 18px; height: 18px; }
    ${B} .lvb { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px;
      color: var(--warn); background: #f5a5241a; border: 1px solid #f5a52455; }
    ${B} .lvb[hidden] { display: none; }
    ${B} .lvb { padding: 3px 6px; } ${B} .lvb > span { display: none; }   /* Torn API badge: just the bolt (hover for why) */
    ${B} .lvb svg { width: 12px; height: 12px; }
    ${B} .hchip.soon { color: var(--warn); border-color: var(--warn); background: #f5a52426; animation: dss-pulse 1s ease-in-out infinite; }
    ${B} .hchip .selfic { display: inline-flex; color: var(--warn); margin-left: -1px; }
    ${B} .hchip.self { border-color: #f5a52455; }
    ${B} .hchip.okchip { color: var(--ok); background: #3ddc8414; border-color: #3ddc8433; }
    ${B} .hchip.okchip svg { stroke-width: 2.6; }
    /* travel chip: [plane] [from] -> [to], all icons round and the same size */
    ${B} .trv { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 6px; border-radius: 999px;
      background: #4ea3ff14; border: 1px solid #4ea3ff2e; vertical-align: middle; line-height: 0; }
    ${B} .trv .pl { display: block; flex: none; color: var(--blue); margin-right: 1px; }
    ${B} .trv .ar { display: block; flex: none; color: var(--mut); }
    ${B} .trv .flag { display: block; flex: none; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff40; overflow: hidden; }
    ${B} .trv .flag-txt { line-height: 1.2; }
    ${B} .flag-txt { font-size: 10.5px; }
    ${B} td.c-st[data-tip] { cursor: help; }
    @media (hover: none) { ${B} td.c-st[data-tip] { cursor: pointer; -webkit-tap-highlight-color: transparent; } }

    /* mobile-only bits are hidden on desktop */
    ${B} .m-dib, ${B} .m-meta { display: none; }
    ${B} .prov { color: var(--mut); font-size: 9px; margin-left: 2px; }
    ${B} .m-dib { font-size: 10.5px; color: var(--red); margin: 1px 0 0 13px; }
    ${B} .m-dib.mine { color: var(--warn); }
    ${B} .m-dib .help svg { width: 11px; height: 11px; vertical-align: -1px; color: var(--warn); }
    ${B} .m-meta { font-size: 10px; margin: 1px 0 0 13px; }

    /* ---- narrow widths (mobile / PDA) ---- */
      ${B}.w760 .c-ffs, ${B}.w760 .c-yata, ${B}.w760 .c-last { display: none; }
      ${B}.w760 table td, ${B}.w760 table th { padding: 5px 5px; }
      ${B}.w760 .hd { grid-template-columns: 1fr 1fr; }
      ${B}.w760 .mid { grid-column: 1 / -1; order: -1; flex-direction: row; gap: 10px; }
      ${B}.w760 .lead { width: auto; height: auto; border-radius: 8px; padding: 6px 14px; flex-direction: row; gap: 8px; }
      ${B}.w760 .pill { margin-top: 0; }
      ${B}.w760 .fac-row { flex-direction: column !important; align-items: flex-start; }
      ${B}.w760 .fac.right .fac-row { align-items: flex-end; }
      /* header */
      ${B}.w560 .hd { padding: 14px 8px 8px; gap: 8px; }
      ${B}.w560 .fac { padding: 8px; }
      ${B}.w560 .fac-name { font-size: 12.5px; }
      ${B}.w560 .fac-tag { width: 20px; height: 20px; }
      ${B}.w560 .fac-score { font-size: 18px; }
      ${B}.w560 .fac-row { margin-top: 5px; gap: 4px; }
      ${B}.w560 .pres { gap: 6px; font-size: 11px; }
      ${B}.w560 .mid { flex-wrap: wrap; gap: 6px; }
      ${B}.w560 .lead b { font-size: 20px; }
      /* toolbar: tabs on one line, search + icon buttons on the next */
      ${B}.w560 .tb { padding: 8px 8px 10px; gap: 9px; }
      ${B}.w560 .tb .seg button { padding: 5px 9px; }
      ${B}.w460 .tb .seg button { padding: 5px 7px; font-size: 12px; }
      ${B}.w460 .tb .ghost { padding: 5px 7px; }
      ${B}.w560 .tb input[type=search] { flex: 1 1 0; min-width: 0; width: auto; padding: 6px 8px; }
      ${B}.w560 .tb .sp { display: none; }
      ${B}.w560 .tb .lbl { display: none; }
      /* phones: search gets the whole row, the page buttons share the row underneath */
      ${B}.w560 .tb-search input[type=search] { flex: 1 1 100%; }
      ${B}.w560 .tb-search { row-gap: 9px; }
      ${B}.w560 .tb-search .ghost { flex: 1 1 auto; white-space: nowrap; text-align: center; }
      ${B}.w560 .ghost { padding: 5px 9px; }
      /* top row on phones: tabs, status, then the icon buttons - keep it on one line */
      ${B}.w560 .tb-row:first-child { flex-wrap: wrap; }   /* only the attack warning wraps: it takes a row of its own */
      ${B}.w560 .tb-row:first-child .ghost { padding: 5px 8px; flex: none; }
      ${B}.w560 .age { font-size: 11px; white-space: nowrap; }
      ${B}.w400 .tb-row:first-child .seg button { padding: 5px 8px; }
      ${B}.w400 .tb-row:first-child .ghost { padding: 5px 6px; }
      ${B}.w560 .tb-row:first-child .seg { flex: none; }
      ${B}.w340 .tb-row:first-child .age { display: none; }   /* very narrow: the refresh button still spins while updating */
      ${B}.w560 .age { margin-left: auto; }
      /* table: name(+dibber, lvl, last) | actions | status | best stats */
      ${B}.w560 .c-score, ${B}.w560 .c-bsp, ${B}.w560 .c-ffs, ${B}.w560 .c-yata, ${B}.w560 .c-lvl, ${B}.w560 .c-last, ${B}.w560 .c-dib, ${B}.w560 .c-rev, ${B}.w560 .c-roll { display: none; }
      ${B}.w560 .c-est { display: table-cell; }
      ${B}.w560 .m-dib, ${B}.w560 .m-meta { display: block; }
      ${B}.w560 table { font-size: 12px; }
      ${B}.w560 table td { padding: 6px 5px; vertical-align: middle; }
      ${B}.w560 a.pname { max-width: 118px; }
      ${B}.w560 .ic { width: 32px; height: 30px; }
      ${B}.w560 .ic svg { width: 17px; height: 17px; }
      ${B}.w560 .tw { max-height: 65vh; -webkit-overflow-scrolling: touch; }
      ${B}.w560 .cfg-row { gap: 5px; }
      ${B}.w560 .cfg input { min-width: 0; flex: 1 1 100%; }
      /* settings: label left, control right, hint underneath */
      ${B}.w560 .cfg-poll { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 10px; row-gap: 3px;
        margin-top: 0; padding: 9px 0; border-top: 1px solid #ffffff0d; }
      ${B}.w560 .cfg-status + .cfg-poll { border-top: 0; }
      ${B}.w560 .cfg-poll label { width: auto; }
      ${B}.w560 .cfg .cfg-poll input { width: 72px; flex: none; padding: 6px 4px; }
      ${B}.w560 .cfg-poll > .muted, ${B}.w560 .cfg-poll > [class$=-saved] { grid-column: 1 / -1; font-size: 11px; line-height: 1.35; }
      ${B}.w560 .cfg-poll > [class$=-saved]:empty { display: none; }
      ${B}.w560 .cfg-poll > .muted small { font-size: inherit; }
      ${B}.w560 .cfg-status:empty { min-height: 4px; }
      ${B}.w560 .cfg-poll .seg button { padding: 5px 9px; }
      /* war bar: one tidy line - count pill, answers, buttons */
      ${B}.w560 .wbar { flex-wrap: wrap; gap: 6px; padding: 6px 8px; }
      /* phones: keep the bar on one line - "answered" goes (the count stays), very narrow ones lose the button words */
      ${B}.w560 .rb-c .rb-l { display: none; }
      ${B}.w340 .wbar .rbtn span { display: none; }
      ${B}.w560 .pres-c > .muted { display: none; }
      ${B}.w560 .pres-c { padding: 3px 8px; }
      ${B}.w560 .rb-c { font-size: 11.5px; }
      ${B}.w560 .rbtn { padding: 5px 9px; gap: 5px; }
      ${B}.w560 .toast { width: calc(100vw - 16px); max-width: none; }
      ${B}.w400 .fac-name { font-size: 11.5px; }
      ${B}.w400 .fac-score { font-size: 16px; }
      ${B}.w400 .fac-sub { display: none; }
      ${B}.w400 .ic { width: 27px; }
      ${B}.w400 .ic svg { width: 16px; height: 16px; }
      ${B}.w400 a.pname { max-width: 92px; }
      ${B}.w400 table td { padding: 6px 3px; }
      ${B}.w400 .c-name { padding-left: 6px !important; }
  `);

  // ================= rendering =================
  // desktop + mobile Torn: the ranked-war members block (hashed class names, so match on prefixes)
  const findWrap = () =>
document.querySelector('.faction-war[class*="membersWrap___"]') ||
document.querySelector('[class*="membersWrap___"]') ||
document.querySelector('#faction_war_list_id .faction-war') ||
document.querySelector('.desc-wrap .faction-war');

  // position:fixed is relative to the screen - unless some ancestor on Torn's page has a transform/filter, in which case it
  // is relative to that ancestor (pop-ups ended up off to one side and scrolled away). fixedOrigin() measures where
  // "0,0" really is for an element, so everything below can be placed in true screen coordinates.
  function fixedOrigin(el) {
const l = el.style.left, t = el.style.top;
el.style.left = '0px'; el.style.top = '0px';
const r = el.getBoundingClientRect();
el.style.left = l; el.style.top = t;
return { x: r.left, y: r.top };
  }
  function placeFixed(el, x, y) { const o = fixedOrigin(el); el.style.left = `${Math.round(x - o.x)}px`; el.style.top = `${Math.round(y - o.y)}px`; }
  // pin open pop-up overlays to the screen (called on open, scroll, resize and every tick)
  function fitOverlays() {
for (const m of document.querySelectorAll(`#${BOX_ID} .rcm:not([hidden])`)) placeFixed(m, 0, 0);
const t = document.querySelector(`#${BOX_ID} .toast`);
if (t) placeFixed(t, document.documentElement.clientWidth - t.offsetWidth - (t.offsetWidth > 300 ? 8 : 16), window.innerHeight - t.offsetHeight - (box560() ? 72 : 16));
  }
  const box560 = () => { const b = document.getElementById(BOX_ID); return !!b && b.classList.contains('w560'); };
  window.addEventListener('scroll', () => { fitOverlays(); popRefresh(); if (noHover()) ttHide(); }, { passive: true });
  window.addEventListener('resize', fitOverlays, { passive: true });

  function toast(text, kind, ms) {
const box = document.getElementById(BOX_ID);
if (!box) return;
const oldToast = box.querySelector('.toast'); if (oldToast) oldToast.remove();
const t = document.createElement('div');
t.className = `toast ${kind || ''}`;
t.textContent = text;
box.appendChild(t);
fitOverlays();
setTimeout(() => t.remove(), ms || 3500);
  }

  // Torn's "View graph" toggles a hiddenGraph___xxx class on the faction-war-info block.
  // 1) native .click() on the icon and its children (works through Firefox's userscript sandbox);
  // 2) if Torn didn't respond, force it visible with a data attribute (React leaves unknown attributes alone).
  function toggleGraph() {
const info = document.querySelector('[class*="factionWarInfo___"]');
const g = document.querySelector('[class*="graphIcon___"]');
if (!info && !g) return toast("Couldn\u2019t find Torn\u2019s war graph on this page", 'warn');
const shown = () => info && info.dataset.dssGraph !== 'hide' &&
  (info.dataset.dssGraph === 'show' || ![...info.classList].some(c => c.startsWith('hiddenGraph___')));
const before = shown();

if (info && info.dataset.dssGraph) {             // we're already controlling it -> just flip our override
  info.dataset.dssGraph = before ? 'hide' : 'show';
  return reveal(info, !before);
}
if (g) {
  const wasHidden = g.classList.contains(HIDE);
  g.classList.remove(HIDE);
  for (const el of [g, ...g.querySelectorAll('*')]) {
    try { el.click(); } catch (_) { /* try the next element */ }
    if (shown() !== before) break;
  }
  if (wasHidden) g.classList.add(HIDE);
}
setTimeout(() => {
  if (!info) return;
  if (shown() === before) {                        // Torn ignored the click -> take over
    info.dataset.dssGraph = before ? 'hide' : 'show';
  }
  reveal(info, shown());
}, 200);
  }
  function reveal(info, on) {
if (on) setTimeout(() => info.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }

  // Touch screens (Torn PDA, phones): native title tooltips pop up on tap and never close once the button is
  // re-rendered, so they pile up. Move them to aria-label (screen readers keep them, no pop-up).
  const HOVER_MQ = window.matchMedia ? window.matchMedia('(hover: none)') : null;
  const noHover = () => SERIAL || !!(HOVER_MQ && HOVER_MQ.matches);
  // Every title in the panel becomes data-tt (our own tooltip: first line bold, the rest muted) plus an aria-label.
  // Touch devices get no hover tip at all (native ones pile up there) - status badges still toast / open on tap.
  function stripTitles(root) {
if (!root) return;
root.querySelectorAll('[title]').forEach(el => {
  const t = el.getAttribute('title');
  el.removeAttribute('title');
  if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', t.replace(/\n!?/g, ' \u00b7 ').replace(/\|/g, ' '));
  if (!noHover()) el.dataset.tt = t;
});
  }
  let ttEl = null, mouseX = -1, mouseY = -1;
  function ttShow(el) {
const box = document.getElementById(BOX_ID), tip = box && box.querySelector('.tt');
if (!tip || !el || !el.dataset.tt) return ttHide();
ttEl = el;
const [head, ...rest] = el.dataset.tt.split('\n');
const line = l => {
  if (l[0] !== '!') return `<div>${esc(l)}</div>`;
  const [k, v, src] = l.slice(1).split('|');          // "!Build|Def|spy" -> highlighted key / value / source row
  return `<div class="hl"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>${src ? `<span class="s">${esc(src)}</span>` : ''}</div>`;
};
const html = `<b>${esc(head)}</b>${rest.map(line).join('')}`;
if (tip.innerHTML !== html) tip.innerHTML = html;
tip.hidden = false;
const cr = el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
const w = tip.offsetWidth, h = tip.offsetHeight;
const left = Math.max(6, Math.min(cr.left + cr.width / 2 - w / 2, vw - w - 6));
let top = cr.top - h - 6;
if (top < 4) top = cr.bottom + 6;
placeFixed(tip, left, top);
  }
  function ttHide() {
ttEl = null;
const tip = document.querySelector(`#${BOX_ID} .tt`);
if (tip) tip.hidden = true;
  }
  // after a re-render the hovered element is a new node: pick it up again under the pointer
  function ttRefresh() {
if (!ttEl || noHover()) return;
if (document.contains(ttEl)) return ttShow(ttEl);
const under = mouseX >= 0 && document.elementFromPoint(mouseX, mouseY);
const el = under && under.closest('[data-tt]');
if (el && document.getElementById(BOX_ID).contains(el)) ttShow(el); else ttHide();
  }

  // pinned action column sits exactly where it naturally starts (measured after layout, not before)
  function fixSticky() {
const box = document.getElementById(BOX_ID);
const tw = box && box.querySelector('.tw');
if (!tw) return;
const measure = () => {
  tw.style.removeProperty('--namew');
  const act = tw.querySelector('th.c-act'), name = tw.querySelector('th.c-name');
  if (act && name) tw.style.setProperty('--namew', (act.getBoundingClientRect().left - name.getBoundingClientRect().left) + 'px');
};
measure();
setTimeout(measure, 0);
  }

  function applyMobileCols() {
const box = document.getElementById(BOX_ID);
if (!box) return;
const mode = GM_getValue('mobileCols', 'compact');
box.classList.toggle('mcols-all', mode === 'all');
box.querySelectorAll('.seg[data-g=mcols] button').forEach(b => b.classList.toggle('on', b.dataset.v === mode));
  }

  function buildBox() {
const box = document.createElement('div');
box.id = BOX_ID;
box.innerHTML = `
      <div class="wi" hidden><div class="ws"></div><div class="wtip"></div></div>
      <div class="hd"></div>
      <div class="atkbar" hidden><div class="atk-track"></div></div>
      <div class="tb">
        <div class="tb-row">
          <div class="seg" data-g="view">
            <button data-v="enemy">Enemy</button><button data-v="ours">Ours</button>
          </div>
          <span class="lvb" hidden>${ICON.bolt}<span>Torn API</span></span>
          <a class="dwarn" hidden target="_blank" rel="noopener"></a>
          <span class="sp"></span>
          <span class="age num"></span>
          <button class="ghost" data-a="refresh" title="Refresh">\u21bb</button>
          <button class="ghost fsbtn" data-a="cropen" title="War credits" hidden>${ICON.coins}</button>
          <button class="ghost fsbtn" data-a="fsopen" title="Faction settings" hidden>${ICON.fist}</button>
          <button class="ghost" data-a="key" title="Settings">\u2699</button>
        </div>
        <div class="tb-row tb-filters">
          <div class="seg" data-g="filter">
            <button data-v="all">All</button><button data-v="available">Available</button><button data-v="online">Online</button>
          </div>
          <button class="ghost revtog" data-a="revtog" title="Revivable only">${ICON.revive}</button>
          <div class="seg" data-g="stfilter">
            <button data-v="all">Any</button><button data-v="okay">Okay</button><button data-v="hosp">Hosp</button><button data-v="travel">Travel</button>
          </div>
        </div>
        <div class="tb-row ctry" hidden></div>
        <div class="tb-row tb-search">
          <input type="search" placeholder="Search name\u2026">
          <span class="sp"></span>
          <button class="ghost" data-a="travel" title="Travellers">${TRAV_IC.out}<span class="lbl"> Travel</span></button>
          <button class="ghost" data-a="activity" title="Activity by hour">${ICON.users}<span class="lbl"> Activity</span></button>
          <button class="ghost" data-a="graph" title="War graph">\ud83d\udcc8<span class="lbl"> Graph</span></button>
          <button class="ghost" data-a="orig" title="Swap list"><span class="lbl-orig">Torn list</span></button>
          <a class="ghost" href="https://tyronic.io/war" target="_blank" rel="noopener" title="Open Tyronic">\u2197</a>
        </div>
      </div>
      <div class="cfg" hidden>
        <label>Torn API key <small>(the one you use on tyronic.io \u2014 stored only in Tampermonkey)</small></label>
        <div class="cfg-row">
          <input type="text" class="keyin masked" name="dss-ty-token" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"
                 data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" placeholder="16-character API key">
          <button type="button" class="ghost" data-a="eye" title="Show key">\ud83d\udc41</button>
          <button type="button" class="btn-save" data-a="savekey">Save</button>
          <button type="button" class="ghost" data-a="clearkey" title="Delete key">Remove</button>
          <button type="button" class="ghost" data-a="key">Close</button>
        </div>
        <div class="cfg-status"></div>
        <div class="cfg-set">
        <div class="cfg-row cfg-poll">
          <label>Columns</label>
          <div class="seg" data-g="mcols"><button type="button" data-v="all">All columns</button><button type="button" data-v="compact">Compact</button></div>
          <span class="muted"><small>Compact shows one combined Stats column</small></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-poll">Refresh every</label>
          <input id="dss-poll" type="number" min="${MIN_POLL_S}" max="300" step="1" inputmode="numeric">
          <span class="muted">seconds <small>(minimum ${MIN_POLL_S})</small></span>
          <span class="poll-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-rev">Revive checks</label>
          <input id="dss-rev" type="number" min="5" max="${REV_MAX}" step="1" inputmode="numeric">
          <span class="muted">calls / minute <small>(Torn allows 100/min across all your keys)</small></span>
          <span class="rev-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-revevery">Re-check revives every</label>
          <input id="dss-revevery" type="number" min="${REV_EVERY_MIN}" max="${REV_EVERY_MAX}" step="1" inputmode="numeric">
          <span class="muted">minutes <small>(minimum ${REV_EVERY_MIN})</small></span>
          <span class="revevery-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label for="dss-dibwarn">Dib hosp warning</label>
          <input id="dss-dibwarn" type="number" min="0" max="${WARN_MAX}" step="5" inputmode="numeric">
          <span class="muted">seconds before they\u2019re out <small>(0 = off)</small></span>
          <span class="dibwarn-saved"></span>
        </div>
        <div class="cfg-row cfg-poll">
          <label>Tyronic user count</label>
          <div class="seg" data-g="pres"><button type="button" data-v="snap">Every minute</button><button type="button" data-v="live">Live</button><button type="button" data-v="off">Off</button></div>
          <span class="muted"><small>Live counts you for others but keeps a connection open \u2014 use Every minute if clicks are slow</small></span>
        </div>
        </div>
      </div>
      <div class="wbw"></div>
      <div class="bd"></div>
      <div class="pop" hidden></div>
      <div class="tt" hidden></div>
      <div class="rcm crm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Tyronic war credits</b><button type="button" class="ghost" data-a="crclose" title="Close">\u2715</button></div>
          <div class="crm-body"></div>
        </div>
      </div>
      <div class="rcm fsm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Faction settings</b><button type="button" class="ghost" data-a="fsclose" title="Close">\u2715</button></div>
          <div class="fsm-body"></div>
        </div>
      </div>
      <div class="rcm trm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Travellers</b>
            <span class="trm-ctl"><span class="seg trm-sort"><button type="button" data-v="flight" title="Countries by flight time">Flight time</button><button type="button" data-v="az" title="Countries A to Z">A\u2013Z</button></span>
            <button type="button" class="ghost" data-a="travempty" title="Show countries nobody is in">Empty</button></span>
            <button type="button" class="ghost" data-a="travclose" title="Close">\u2715</button></div>
          <div class="trm-body"></div>
        </div>
      </div>
      <div class="rcm rsm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Roll call summary</b><span class="rsm-top"></span><button type="button" class="ghost" data-a="rsclose" title="Close">\u2715</button></div>
          <div class="rsm-qs"></div>
          <div class="rsm-names"></div>
          <div class="rsm-hours"></div>
          <div class="rsm-notes"></div>
        </div>
      </div>
      <div class="rcm acm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Activity by hour</b><button type="button" class="ghost" data-a="actclose" title="Close">\u2715</button></div>
          <div class="acm-sub muted">Average active members, from Tyronic's history</div>
          <div class="seg acm-days"></div>
          <div class="acm-plot"></div>
          <div class="acm-leg"></div>
          <div class="acm-sum muted"></div>
        </div>
      </div>
      <div class="rcm mcm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>Merc list</b><button type="button" class="ghost" data-a="mercclose" title="Close">\u2715</button></div>
          <div class="rcm-q">Online at start <span class="muted">(any if none picked)</span></div>
          <div class="seg mq" data-q="start"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="m">Maybe</button><button type="button" data-v="x">No answer</button></div>
          <div class="rcm-q">Self-hosp</div>
          <div class="seg mq" data-q="hosp"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="x">No answer</button></div>
          <div class="rcm-q">Last active</div>
          <select class="mcm-idle">
            <option value="0">Any time</option><option value="0.25">15m+ ago</option><option value="1">1h+ ago</option><option value="3">3h+ ago</option>
            <option value="6">6h+ ago</option><option value="12">12h+ ago</option><option value="24">1d+ ago</option>
          </select>
          <label class="mcm-chk"><input type="checkbox" class="mcm-skip"> Skip players already in hospital</label>
          <div class="mcm-hd2"><span class="mcm-n muted"></span><button type="button" class="ghost" data-a="mercreset" title="Reset filters">Reset</button></div>
          <textarea class="mcm-out" readonly spellcheck="false"></textarea>
          <button type="button" class="btn-save rcm-go" data-a="merccopy">Copy list</button>
        </div>
      </div>
      <div class="rcm rollm" hidden>
        <div class="rcm-card">
          <div class="rcm-hd"><b>War roll call</b><button type="button" class="ghost" data-a="rollclose" title="Close">\u2715</button></div>
          <div class="rcm-q">Online at start?</div>
          <div class="seg rq" data-q="start_online"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="m">Maybe</button></div>
          <div class="rcm-later">
            <div class="rcm-q">Self-hosp before start?</div>
            <div class="seg rq" data-q="start_hosped"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button></div>
            <div class="rcm-q">Online from (TCT)</div>
            <select class="rcm-hour"><option value="">Don\u2019t know</option>${Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('')}</select>
          </div>
          <div class="rcm-q">Chain-watch abroad?</div>
          <div class="seg rq" data-q="chain_watch"><button type="button" data-v="y">Yes</button><button type="button" data-v="n">No</button><button type="button" data-v="m">Maybe</button></div>
          <div class="rcm-q">Note <span class="muted">(optional)</span></div>
          <input type="text" class="rcm-note" maxlength="60" placeholder="Max 60 characters" autocomplete="off">
          <div class="rcm-err"></div>
          <button type="button" class="btn-save rcm-go" data-a="rollsubmit">Submit</button>
        </div>
      </div>`;

box.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });
box.addEventListener('mouseleave', () => { if (!noHover()) ttHide(); });   // touch fires fake mouse events - its tips close on tap
box.addEventListener('mouseover', e => {
  if (noHover()) return;
  const t = e.target.closest('[data-tt]');
  if (t && t !== ttEl) ttShow(t); else if (!t && ttEl) ttHide();
  const td = e.target.closest('[data-pop]');
  if (td && td.dataset.pop !== popId) popShow(td);
});
box.addEventListener('mouseout', e => {
  if (noHover()) return;
  const td = e.target.closest('[data-pop]');
  if (td && !td.contains(e.relatedTarget)) popHide();
});
box.addEventListener('click', e => {
  if (noHover()) {                                   // touch: tap a travel badge to open its card, tap anywhere else to close
    const pt = e.target.closest('[data-pop]');
    if (pt && pt.dataset.pop !== popId) popShow(pt); else popHide();
    // tap a hospital / jail status for its reason in a small bubble next to it; tap it again or anywhere else to close
    const stCell = e.target.closest('td.c-st[data-tip]');
    if (stCell && stCell !== ttEl) { stCell.dataset.tt = stCell.dataset.tip; ttShow(stCell); }
    else if (ttEl) ttHide();
  }
  const wiEl = e.target.closest('.wi');
  box.querySelector('.wi').classList.toggle('open', !!wiEl && !box.querySelector('.wi').classList.contains('open'));
  if (e.target.classList && e.target.classList.contains('crm')) { crClose(); return; }
  if (e.target.classList && e.target.classList.contains('fsm')) { fsClose(); return; }
  if (e.target.classList && e.target.classList.contains('trm')) { travClose(); return; }
  if (e.target.classList && e.target.classList.contains('rsm')) { rsClose(); return; }
  if (e.target.classList && e.target.classList.contains('acm')) { actClose(); return; }
  if (e.target.classList && e.target.classList.contains('mcm')) { mercClose(); return; }
  if (e.target.classList && e.target.classList.contains('rcm')) { rollClose(); return; }   // click outside the form
  const b = e.target.closest('button, th[data-sort], .tv-ct[data-tctry]');
  if (!b || !box.contains(b)) return;
  const seg = b.parentElement && b.parentElement.dataset.g;
  if (seg === 'view') { view = b.dataset.v; GM_setValue('view', view); render(); }
  else if (seg === 'mcols') { GM_setValue('mobileCols', b.dataset.v); applyMobileCols(); }
  else if (seg === 'pres') {
    GM_setValue('presMode', b.dataset.v);
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    presStop(); clearTimeout(presTimer); presTimer = null;
    if (presOff()) { presKnown = false; for (const k in presence) delete presence[k]; presChanged(); }
    else { presStarted = true; presConnect(); }
  }
  else if (seg === 'filter') { filter = b.dataset.v; GM_setValue('filter', filter); render(); }
  else if (seg === 'stfilter') { stFilter = b.dataset.v; GM_setValue('stFilter', stFilter); render(); }
  else if (b.dataset.ctry != null) {
    const k = b.dataset.ctry;
    if (k === '') ctryFilter.clear(); else if (ctryFilter.has(k)) ctryFilter.delete(k); else ctryFilter.add(k);
    GM_setValue('ctryFilter', [...ctryFilter]); render();
  }
  else if (b.dataset.a === 'revtog') { revFilter = revFilter === 'yes' ? 'all' : 'yes'; GM_setValue('revFilter', revFilter); render(); }
  else if (b.dataset.a === 'refresh') refresh(true);
  else if (b.dataset.a === 'key') openSettings();
  else if (b.dataset.a === 'eye') box.querySelector('.cfg .keyin').classList.toggle('masked');
  else if (b.dataset.a === 'savekey') saveKey(box.querySelector('.cfg .keyin').value);
  else if (b.dataset.a === 'clearkey') {
    GM_setValue('tornKey', ''); GM_setValue('session', null);
    box.querySelector('.cfg .keyin').value = '';
    const st = box.querySelector('.cfg-status'); st.textContent = 'Key removed.'; st.className = 'cfg-status';
  }
  else if (b.dataset.a === 'rollcall') rollOpen();
  else if (b.dataset.a === 'rssum') rsOpen();
  else if (b.dataset.a === 'rsclose') rsClose();
  else if (b.dataset.a === 'rscopy') rsCopy(b);
  else if (b.dataset.rq) { rsPick = { q: b.dataset.rq, v: b.dataset.rv }; rsPaint(); }
  else if (b.dataset.a === 'merc') mercOpen();
  else if (b.dataset.a === 'activity') actOpen();
  else if (b.dataset.a === 'travel') travOpen();
  else if (b.dataset.a === 'fsopen') fsOpen();
  else if (b.dataset.a === 'cropen') crOpen();
  else if (b.dataset.a === 'crclose') crClose();
  else if (b.dataset.a === 'fsclose') fsClose();
  else if (b.dataset.fs) { const c = state.factionconfig || {}, k = b.dataset.fs; fsSave({ [k]: k === 'dibs_enabled' ? c[k] === false : !c[k] }); }
  else if (b.dataset.fsn) { const k = b.dataset.fsn, [min, max] = FS_NUM[k], c = state.factionconfig || {}, cur = c[k] == null ? { dibs_time: 300, num_dibs: 1, num_assists: 1 }[k] : Number(c[k]); fsSave({ [k]: Math.max(min, Math.min(max, cur + Number(b.dataset.d))) }); }
  else if (b.dataset.fss != null) { const n = +b.dataset.fss; if (n !== (Number((state.factionconfig || {}).strategy) || 0)) fsSave({ strategy: n }); }
  else if (b.dataset.a === 'fscustom') { const card = b.closest('.fs-custom'); fsSave({ strategy: 3, strategy_custom_title: card.querySelector('.fs-ct').value.trim() || null, strategy_custom: card.querySelector('.fs-cx').value.trim() || null }); }
  else if (b.dataset.a === 'travclose') travClose();
  else if (b.dataset.a === 'travempty') { travEmpty = !travEmpty; travPaint(); }
  else if (b.dataset.tctry != null) { const k = b.dataset.tctry, was = travCtry.has(k); travCtry.clear(); if (k && !was) travCtry.add(k); ttHide(); travPaint(); }
  else if (b.dataset.tdir) { const k = b.dataset.side; travDir[k] = travDir[k] === b.dataset.tdir ? null : b.dataset.tdir; ttHide(); travPaint(); }
  else if (b.parentElement && b.parentElement.classList.contains('trm-sort')) { travSort = b.dataset.v; GM_setValue('travSort', travSort); travPaint(); }
  else if (b.dataset.a === 'actclose') actClose();
  else if (b.dataset.d && b.parentElement && b.parentElement.classList.contains('acm-days')) { actDay = +b.dataset.d; actPaint(); }
  else if (b.dataset.a === 'mercclose') mercClose();
  else if (b.dataset.a === 'merccopy') mercCopy();
  else if (b.dataset.a === 'mercreset') { merc = Object.assign({}, MERC_DEFAULT); mercSave(); }
  else if (b.parentElement && b.parentElement.classList.contains('mq')) mercPick(b.parentElement.dataset.q, b.dataset.v);
  else if (b.dataset.a === 'rollclose') rollClose();
  else if (b.dataset.a === 'rollsubmit') rollSubmit();
  else if (b.parentElement && b.parentElement.classList.contains('rq')) { rollPick(b.parentElement.dataset.q, b.dataset.v); }
  else if (b.dataset.a === 'graph') toggleGraph();
  else if (b.dataset.a === 'orig') {
    showOriginal = !showOriginal;
    GM_setValue('showOriginal', showOriginal);
    apply();
    // bring the top of the panel back into view whichever way we toggled
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  else if (b.dataset.act) doAction(b.dataset.act, +b.dataset.id);
  else if (b.dataset.sort) {
    const k = b.dataset.sort;
    sortDir = sortKey === k ? -sortDir : 1;
    sortKey = k;
    render();
  }
});
const pollInp = box.querySelector('#dss-poll');
pollInp.addEventListener('change', () => {
  const v = Math.min(300, Math.max(MIN_POLL_S, Math.round(Number(pollInp.value) || MIN_POLL_S)));
  pollInp.value = v;
  GM_setValue('pollSec', v);
  schedulePoll();
  const sv = box.querySelector('.poll-saved'); sv.textContent = `Saved \u2014 every ${v}s`;
  setTimeout(() => { sv.textContent = ''; }, 2000);
});
box.querySelector('.trm-body').addEventListener('scroll', () => { popRefresh(); ttHide(); }, { passive: true });
box.querySelector('.mcm-idle').addEventListener('change', e => { merc.idle = Number(e.target.value) || 0; mercSave(); });
box.querySelector('.mcm-skip').addEventListener('change', e => { merc.skipHosp = e.target.checked; mercSave(); });
box.querySelector('.mcm-out').addEventListener('focus', e => e.target.select());
box.querySelector('.cfg .keyin').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveKey(e.target.value); } });
const revInp = box.querySelector('#dss-rev');
revInp.addEventListener('change', () => {
  const v = Math.min(REV_MAX, Math.max(5, Math.round(Number(revInp.value) || REV_DEFAULT)));
  revInp.value = v;
  GM_setValue('revPerMin', v);
  revKick();
  const sv = box.querySelector('.rev-saved'); sv.textContent = `Saved \u2014 ${v}/min`;
  setTimeout(() => { sv.textContent = ''; }, 2000);
});
const warnInp = box.querySelector('#dss-dibwarn');
warnInp.addEventListener('change', () => {
  const raw = Number(warnInp.value);
  const v = Math.min(WARN_MAX, Math.max(0, Math.round(isFinite(raw) ? raw : WARN_DEFAULT)));
  warnInp.value = v;
  GM_setValue('dibWarnSec', v);
  const sv = box.querySelector('.dibwarn-saved'); sv.textContent = v ? `Saved \u2014 ${v}s` : 'Saved \u2014 off';
  setTimeout(() => { sv.textContent = ''; }, 2000);
});
const revEvInp = box.querySelector('#dss-revevery');
revEvInp.addEventListener('change', () => {
  const v = Math.min(REV_EVERY_MAX, Math.max(REV_EVERY_MIN, Math.round(Number(revEvInp.value) || REV_EVERY_DEFAULT)));
  revEvInp.value = v;
  GM_setValue('revEveryMin', v);
  revKick();
  const sv = box.querySelector('.revevery-saved'); sv.textContent = `Saved \u2014 every ${v} min`;
  setTimeout(() => { sv.textContent = ''; }, 2000);
});
applyMobileCols();
stripTitles(box);
box.querySelector('input[type=search]').addEventListener('input', e => { search = e.target.value.trim().toLowerCase(); render(); });
const sizeClasses = () => {
  applyMobileCols();
  setTimeout(fixSticky, 0);
  const w = box.clientWidth;
  for (const bp of [760, 560, 460, 400, 340]) box.classList.toggle('w' + bp, w > 0 && w <= bp);
};
if (typeof ResizeObserver === 'function') new ResizeObserver(sizeClasses).observe(box);
else window.addEventListener('resize', sizeClasses);
setTimeout(sizeClasses, 0);
return box;
  }

  function facCard(f, side, cls) {
const ws = f.warstats || {};
const c = counts(f.members);
const avg = ws.score_log_count ? (ws.score_log_sum / ws.score_log_count).toFixed(2) : '\u2014';
const cur = ws.chaincurrent || 0, max = Math.max(1, ws.chainmax || 10);
const pct = Math.min(100, cur / max * 100);
const chainEnd = Date.parse(ws.chainend);
const chainLive = ws.chaincurrent > 0 && chainEnd > Date.now();
return `
      <div class="fac ${side} ${cls}">
        <div class="fac-top">
          <img class="fac-tag" src="https://factiontags.torn.com/${esc(f.info.pfpurl)}" alt="">
          <a class="fac-name" href="https://www.torn.com/factions.php?step=profile&ID=${f.info.faction_id}" target="_blank" title="${esc(f.info.name)}">${esc(f.info.name)}</a>
        </div>
        <div class="fac-row">
          <div>
            <div class="fac-score num">${num(ws.score)}</div>
            <div class="fac-sub num">${avg} avg/hit</div>
          </div>
          <div class="pres num">
            <span title="Online"><i class="Online"></i>${c.Online}</span>
            <span title="Idle"><i class="Idle"></i>${c.Idle}</span>
            <span title="Offline"><i class="Offline"></i>${c.Offline}</span>
          </div>
        </div>
        <div class="bar" title="Chain ${num(cur)} / ${num(max)}"><div style="width:${pct}%"></div></div>
        <div class="chain num">
          <span><b>${num(cur)}</b></span>
          ${ws.chaincooldown > 0 ? `<span class="ctimer cd" title="Cooldown">cooldown <span data-until="${(lastFetch || Date.now()) + ws.chaincooldown * 1000}">${clock(ws.chaincooldown * 1000)}</span></span>`
        : chainLive ? `<span class="ctimer" data-chainend="${chainEnd}" title="Chain timeout"><span data-until="${chainEnd}">${clock(chainEnd - Date.now())}</span></span>`
        : `<span class="ctimer muted">00:00</span>`}
          <span>${num(max)}</span>
        </div>
      </div>`;
  }

  function render() {
const box = document.getElementById(BOX_ID);
if (!box) return;
box.querySelectorAll('.seg[data-g=view] button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
box.querySelectorAll('.seg[data-g=filter] button').forEach(b => b.classList.toggle('on', b.dataset.v === filter));
box.querySelectorAll('.seg[data-g=stfilter] button').forEach(b => b.classList.toggle('on', b.dataset.v === stFilter));
box.querySelector('[data-a=revtog]').classList.toggle('on', revFilter === 'yes');
box.querySelector('[data-a=orig] .lbl-orig').textContent = showOriginal ? 'Tyronic view' : 'Torn list';
const hd = box.querySelector('.hd'), bd = box.querySelector('.bd');

if (!state) {
  hd.innerHTML = '';
  bd.innerHTML = error
    ? `<div class="msg err">${error.needKey ? 'No Torn API key set yet \u2014 add it in the settings above.' : 'Could not load Tyronic data: ' + esc(error.message)}</div>`
    : '<div class="msg">Loading Tyronic war data\u2026</div>';
  return;
}

const { ours, enemy } = sides();
if (!ours || !enemy || !ours.info || !enemy.info) {     // Tyronic has no war pairing for us right now
  hd.innerHTML = '';
  bd.innerHTML = '<div class="msg">Tyronic has no ranked war data for your faction right now.</div>';
  bd.dssHtml = hd.dssHtml = null;
  return;
}
memberIdx = {};
for (const m of [...(ours.members || []), ...(enemy.members || [])]) memberIdx[m.player_id] = m;

// ---- header ----
const oS = (ours.warstats || {}).score || 0, eS = (enemy.warstats || {}).score || 0, lead = oS - eS;
const wd = state.wardata || {};
const start = Date.parse(wd.warstart);
let wm = null;
try { wm = winModel(ours, enemy); } catch (_) { wm = null; }
const wi = box.querySelector('.wi');
if (wm) {
  const pct = (x, lo, hi) => U.clamp(x * 100, lo, hi);
  wi.hidden = false;
  wi.style.setProperty('--score', `${pct(wm.ours.warstrength, 0, 100)}%`);
  wi.style.setProperty('--winprob', `${pct(wm.ours.winprob, 3, 97)}%`);
  wi.querySelector('.wtip').innerHTML = `
        <div><span>Win probability:</span> <b class="gold">${pct(wm.ours.winprob, 0, 100).toFixed(2)}%</b></div>
        <div><span>Your current strength:</span> <b class="g">${pct(wm.ours.warstrength, 0, 100).toFixed(1)}%</b></div>
        <div><span>Enemy current strength:</span> <b class="r">${pct(wm.enemy.warstrength, 0, 100).toFixed(1)}%</b></div>`;
} else wi.hidden = true;
const hdHtml = `
      ${facCard(ours, 'left', 'ours')}
      <div class="mid">
        <div class="lead ${lead >= 0 ? 'win' : 'lose'}"><b class="num">${lead >= 0 ? '+' : ''}${num(lead)}</b><span class="num">${num(wd.scoretarget)}</span></div>
        ${isFinite(start) ? `<div class="pill num" title="War time">\u23f1 <span data-since="${start}">${clock(Date.now() - start)}</span></div>` : ''}
        <div class="pill tct num" title="Torn time">TCT <span data-tct>${tct()}</span></div>
        ${stratPill()}
      </div>
      ${facCard(enemy, 'right', 'enemy')}`;
if (sameHtml(hd, hdHtml)) { /* nothing changed: keep the DOM */ } else {
  hd.innerHTML = hdHtml;
  stripTitles(hd);
  hd.querySelectorAll('img.fac-tag').forEach(img => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
}

// ---- rows ----
const isEnemy = view === 'enemy';
const rolls = rollIdx(), showRoll = !isEnemy && rollOn();
const fac = isEnemy ? enemy : ours;
const sIdx = statsIndex();
const me = state.user.user_id;
const mine = bestEst(sIdx[me]).v;
const dibs = dibsByFoe();
const cfg = state.factionconfig || {};
const dibsOn = cfg.dibs_enabled !== false;
const maxAssist = cfg.num_assists == null ? 1 : cfg.num_assists;
const maxDibs = cfg.num_dibs || 1;
const dibsTime = cfg.dibs_time || 300;
const autoAssist = !!cfg.auto_request_assists;
const allDibs = Object.values(dibs);
const myDibCount = allDibs.filter(x => x.dib_window_resolved === false ? (x.entrant_player_ids || []).includes(me) : x.player_id === me).length;
const myAssistCount = allDibs.filter(x => (x.assist_player_ids || []).includes(me)).length;

const warscore = Object.assign({}, (ours.warstats || {}).warscore || {}, (enemy.warstats || {}).warscore || {});
let rows = (fac.members || []).map(m => {
  const s = sIdx[m.player_id] || {};
  const bsp = bsOf(s, 'BSP'), ffs = bsOf(s, 'FFSCOUTER'), yata = bsOf(s, 'YATA');
  const be = bestEst(s);
  const score = Math.round((domScore[m.player_id] != null ? domScore[m.player_id] : Number(warscore[m.player_id]) || 0) * 100) / 100;   // Torn's list first: Tyronic's per-player warscore is often empty
  return { m, s, st: statusInfo(m), bsp, ffs, yata, est: be.v, be, score, roll: rolls[m.player_id], dib: isEnemy ? dibs[m.player_id] : null };
});
if (search) rows = rows.filter(r => r.m.name.toLowerCase().includes(search));
if (filter === 'available') rows = rows.filter(r => r.st.rank === 1 || (r.st.rank === 2 && r.st.until - Date.now() < 60000));
if (filter === 'online') rows = rows.filter(r => r.m.active_status !== 'Offline');
const ST_RANK = { okay: 1, hosp: 2, travel: 3 };
if (stFilter !== 'all') rows = rows.filter(r => r.st.rank === ST_RANK[stFilter]);
// ---- country picker (only while Travel is selected): one flag button per country someone in this tab is in/flying to/from ----
const ctryRow = box.querySelector('.tb .ctry');
if (stFilter === 'travel') {
  const seen = {};
  for (const m of fac.members || []) {
    const st = statusInfo(m);
    if (st.rank !== 3 || !st.fkey) continue;
    const k = st.fkey;                                   // destination: return flights count under Torn
    (seen[k] = seen[k] || { name: k === 'torn' ? 'Torn' : st.where, n: 0 }).n++;
  }
  for (const k of ctryFilter) if (!seen[k]) seen[k] = { name: k.replace(/\b\w/g, c => c.toUpperCase()), n: 0 };   // keep picked ones visible
  const order = ['torn', ...Object.keys(FLAG_SVG)];                                          // Torn first, then travel-agency order
  const keys = Object.keys(seen).sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99) || a.localeCompare(b));
  ctryRow.innerHTML = keys.length
    ? keys.map(k => `<button class="ghost cbtn ${ctryFilter.has(k) ? 'on' : ''}" data-ctry="${esc(k)}" title="${esc(k === 'torn' ? 'Flying to Torn' : seen[k].name)}">${k === 'torn' ? TORN : flag(seen[k].name)}<span class="num">${seen[k].n}</span></button>`).join('')
      + (ctryFilter.size ? `<button class="ghost cbtn clr" data-ctry="" title="All countries">\u2715</button>` : '')
    : '<span class="muted">Nobody is travelling.</span>';
  ctryRow.hidden = false;
  if (ctryFilter.size) rows = rows.filter(r => ctryFilter.has(r.st.fkey));
} else ctryRow.hidden = true;
const revCandidates = rows.map(r => r.m);          // checks still follow the other filters, so filtered-out rows get resolved
const revPending = revFilter === 'all' ? 0 : revCandidates.filter(m => !revValue(m.player_id)).length;
if (revFilter !== 'all') rows = rows.filter(r => { const v = revValue(r.m.player_id); return !!v && v.v === true; });
rows = sortRows(rows);

// sort arrow: text-style glyph (\ufe0e stops iOS drawing it as an emoji), placed on the side away from the column's alignment
const th = (k, label, cls = '') => {
  const on = sortKey === k;
  const arrow = on ? `<span class="sa">${sortDir === 1 ? '\u2193' : '\u2191'}\ufe0e</span>` : '';
  const right = /(^|\s)r(\s|$)/.test(cls);
  return `<th data-sort="${k}" class="${cls} ${on ? 'on' : ''}">${right ? arrow + label : label + arrow}</th>`;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sdate = iso => {
  const d = new Date(iso), y = d.getUTCFullYear();
  if (!isFinite(d)) return '?';
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${y !== new Date().getUTCFullYear() ? ` \u2019${String(y).slice(2)}` : ''}`;
};
const bsCell = (v, b, cls) => {
  const tip = b ? sdate(b.statsdate) : 'No estimate';
  return `<td class="r num ${cls} ${v ? strengthClass(v, mine) : 'none'}" title="${esc(tip)}">${fmtBS(v)}</td>`;
};
const NAMES = { SPY: 'Spy', FFSCOUTER: 'FFS', BSP: 'BSP', YATA: 'YATA' };
const estCell = (r) => {
  const be = r.be, all = ['SPY', 'FFSCOUTER', 'BSP', 'YATA'].map(p => r.s[p]).filter(b => b && b.total)
    .sort((x, y) => (Date.parse(y.statsdate) || 0) - (Date.parse(x.statsdate) || 0));   // newest first
  const head = !be.v ? 'No estimate' : be.kind === 'SPY' ? 'Spy' : be.kind === 'AVG' ? 'Average' : NAMES[be.kind];
  const bt = buildOf(r.s);
  let tip = head + (bt ? `\n!Build|${bt.label}|${bt.src}` : '') + (all.length ? '\n' : '') + all.map(b => `${NAMES[b.bsprovider]} ${fmtBS(b.total)} \u00b7 ${sdate(b.statsdate)}${be.used.includes(b) ? '' : ' (old)'}`).join('\n');
  const spy = r.s.SPY;
  if (be.kind === 'SPY' && spy.strength != null) tip += `\nSTR ${fmtBS(spy.strength)}  DEF ${fmtBS(spy.defense)}  SPD ${fmtBS(spy.speed)}  DEX ${fmtBS(spy.dexterity)}`;
  const tag = be.kind === 'SPY' ? '<small class="prov">S</small>' : '';   // only flag the exception; how the figure is built is in the header tooltip
  return `<td class="r num c-est ${be.v ? strengthClass(be.v, mine) : 'none'}" title="${esc(tip)}">${fmtBS(be.v)}${tag}</td>`;
};

// roll call cell: power = online at start, globe = chain-watch abroad (green yes / amber maybe / red no),
// plus the hour they'll be on and a note marker when given
const rollTd = rc => {
  if (!rc) return `<td class="c c-roll none" title="No roll call">\u2014</td>`;
  const hour = rc.start_online !== true && rc.hour_online != null ? `<span class="rc-h num">${String(rc.hour_online).padStart(2, '0')}h</span>` : '';
  const sh = rc.start_online !== true && rc.start_hosped === true ? `<span class="rc-i y">${ICON.hosp}</span>` : '';
  return `<td class="c c-roll" title="${esc(rollTip(rc))}"><span class="rc">`
    + `<span class="rc-i ${ynmCls(rc.start_online)}">${ICON.power}</span>`
    + `<span class="rc-i ${ynmCls(rc.chain_watch)}">${ICON.globe}</span>${sh}${hour}`
    + (rc.note ? `<span class="rc-i note">${ICON.note}</span>` : '') + `</span></td>`;
};

const COLS = isEnemy
  ? ['stats', 'status', 'score', 'lvl', 'last', 'rev']
  : ['status', 'rev', 'roll', 'score', 'stats', 'lvl', 'last'];

const rowList = rows.map(r => {
  const m = r.m, st = r.st, d = r.dib;
  const myDib = d && d.player_id === me;
  const assists = (d && d.assist_player_ids) || [];
  const iAssist = assists.includes(me);
  const busyDib = pending === `dib:${m.player_id}`, busyAs = pending === `assist:${m.player_id}`, busyReq = pending === `request:${m.player_id}`;
  const wantsHelp = d && d.assist_enabled;
  const statusCell = st.rank === 2
    ? `<td class="keep c-st" data-tip="${esc(st.detail || st.text)}" title="${esc(st.detail || st.text)}"><span class="hosp hchip ${st.self ? 'self' : ''}">${st.text === 'Jail' ? ICON.jail : ICON.hosp}${st.unknown ? '<span class="num">new</span>' : `<span class="num" data-until="${st.until}">${clock(st.until - Date.now())}</span>`}${st.self ? `<span class="selfic">${ICON.selfhosp}</span>` : ''}</span></td>`
    : st.rank === 1 ? `<td class="keep ok c-st"${st.out ? ` title="${esc(st.detail)}"` : ''}><span class="hchip okchip">${ICON.ok}<span>${esc(st.text)}</span></span></td>`
    : st.icon ? `<td class="keep c-st" data-pop="${m.player_id}" aria-label="${esc(st.detail)}"><span class="${st.cls} trv">${st.icon}</span></td>`
    : `<td class="keep c-st"><span class="${st.cls}">${esc(st.text)}</span></td>`;
  const trCls = [m.player_id === me ? 'me' : '', myDib ? 'mine' : '', iAssist && !myDib ? 'assisting' : '', d && !myDib && !iAssist ? 'taken' : '', st.rank > 1 ? 'unavail' : ''].join(' ');

  // ---- dib button (Tyronic's rules) ----
  const nowMs = Date.now();
  const inWindow = d && d.dib_window_resolved === false;
  const hospLong = m.status_color === 'red' && m.status_until && Date.parse(m.status_until) > nowMs + dibsTime * 1000;
  let dibState, dibTip;
  if (inWindow) {
    const entered = (d.entrant_player_ids || []).includes(me);
    dibState = entered ? 'on' : myDibCount >= maxDibs ? 'off' : 'free';
    const winEnd = `ends ${new Date(Date.parse(d.dib_window_expires_at) || nowMs).toISOString().slice(11, 19)} TCT`;   // fixed time: a ticking count would rebuild the table every render
    dibTip = entered ? `In dib window \u00b7 ${winEnd}` : myDibCount >= maxDibs ? `Max ${maxDibs} dibs` : `Join dib window \u00b7 ${winEnd}`;
  } else if (d) {
    dibState = myDib ? 'on' : 'taken';
    dibTip = myDib ? 'Undib' : `Dibbed by ${nameOf(d.player_id)}`;
  } else if (myDibCount >= maxDibs) { dibState = 'off'; dibTip = `Max ${maxDibs} dib${maxDibs > 1 ? 's' : ''}`; }
  else if (hospLong) { dibState = 'off'; dibTip = `Dibs open at ${Math.floor(dibsTime / 60)}m left`; }
  else { dibState = 'free'; dibTip = 'Dib'; }
  const dibDisabled = dibState === 'taken' || dibState === 'off' || (inWindow && dibState === 'on');

  // ---- assist button (Tyronic's rules) ----
  let asState = null, asTip = '', asAct = 'assist';
  const helpList = assists.length ? `\nWith ${assists.map(nameOf).join(', ')}` : '';
  if (d && !inWindow && maxAssist > 0) {
    if (!d.assist_enabled && !autoAssist) {
      if (myDib) { asState = 'idle'; asTip = 'Request assist'; asAct = 'request'; }
    } else if (myDib) {
      if (autoAssist) { asState = 'fixed'; asTip = 'Auto-assist on' + helpList; }
      else { asState = 'on'; asTip = 'Cancel assist request' + helpList; asAct = 'request'; }
    } else if (iAssist) { asState = 'on'; asTip = 'Stop assisting' + helpList; }
    else if (assists.length >= maxAssist) { asState = 'full'; asTip = 'Assists full' + helpList; }
    else if (myAssistCount >= maxDibs) { asState = 'full'; asTip = `Max ${maxDibs} assists`; }
    else { asState = 'ask'; asTip = `Assist ${nameOf(d.player_id)}` + helpList; }
  }
  const busyAsAny = busyAs || busyReq;

  const acts = !isEnemy ? '' : `<td class="keep c-act"><span class="acts">
        ${dibsOn ? `<button class="ic ${dibState === 'on' ? 'on' : dibState === 'taken' ? 'taken' : ''} ${busyDib ? 'busy' : ''}" data-act="dib" data-id="${m.player_id}" title="${esc(dibTip)}" ${dibDisabled ? 'disabled' : ''}>${busyDib ? ICON.spin : ICON.dib}</button>` : ''}
        ${dibsOn && asState ? `<button class="ic ${asState === 'on' || asState === 'fixed' ? 'on' : asState === 'ask' ? 'ask' : ''} ${busyAsAny ? 'busy' : ''}" data-act="${asAct}" data-id="${m.player_id}" title="${esc(asTip)}" ${asState === 'full' || asState === 'fixed' ? 'disabled' : ''}>${busyAsAny ? ICON.spin : ICON.assist}</button>` : ''}
        <a class="ic atk ${st.rank > 1 ? 'off' : ''}" href="https://www.torn.com/page.php?sid=attack&user2ID=${m.player_id}" target="${ATK_TARGET}" title="Attack">${ICON.attack}</a>
      </span></td>`;

  return [m.player_id, `<tr class="${trCls}" data-pid="${m.player_id}">
        <td class="keep c-name"><span class="dot ${esc(m.active_status)}" title="${esc(m.active_status)}"></span><a class="pname" href="https://www.torn.com/profiles.php?XID=${m.player_id}" target="_blank">${esc(m.name)}</a>${d && isEnemy ? `<div class="m-dib ${myDib ? 'mine' : ''}">${esc(nameOf(d.player_id))}${wantsHelp ? ` <span class="help">${ICON.assist}</span>` : ''}${assists.length ? ` +${assists.length}` : ''}</div>` : ''}<div class="m-meta muted">Lvl ${m.level} \u00b7 <span data-ago="${Date.parse(m.active_stamp) || ''}">${ago(m.active_stamp)}</span></div></td>
        ${acts}
        ${isEnemy && dibsOn ? `<td class="keep c-dib">${d ? `<span class="dibber">${esc(nameOf(d.player_id))}${wantsHelp ? ` <span class="help" title="Assist requested">${ICON.assist}</span>` : ''}${assists.length ? ` <span class="as" title="${esc(assists.map(nameOf).join(', '))}">+${assists.length}</span>` : ''}</span>` : ''}</td>` : ''}
        ${COLS.map(k => ({
      stats: () => estCell(r) + bsCell(r.bsp, r.s.BSP, 'c-bsp') + bsCell(r.ffs, r.s.FFSCOUTER, 'c-ffs') + bsCell(r.yata, r.s.YATA, 'c-yata'),
      status: () => statusCell,
      score: () => `<td class="r num c-score ${r.score ? '' : 'muted'}" title="War score">${num(r.score)}</td>`,
      lvl: () => `<td class="r num c-lvl">${m.level}</td>`,
      last: () => `<td class="r num c-last muted"><span data-ago="${Date.parse(m.active_stamp) || ''}">${ago(m.active_stamp)}</span></td>`,
      rev: () => revTd(m.player_id),
      roll: () => showRoll ? rollTd(r.roll) : '',
    })[k]()).join('')}
      </tr>`];
});
const body = rowList.map(x => x[1]).join('');

const wstart = Date.parse(wd.warstart), preWar = isFinite(wstart) && wstart > Date.now();
box.querySelectorAll('.fsbtn').forEach(fb => { if (fb.hidden === fsCanEdit()) fb.hidden = !fsCanEdit(); });   // faction settings / credits: leaders only
// credits button flashes amber with 2 wars of credit left, red with 1 or none
const cb = box.querySelector('[data-a=cropen]'), cw = crWars();
if (cb) { const lvl = cw == null ? '' : cw <= 1 ? 'crit' : cw <= 2 ? 'warn' : '';
  if ((cb.dataset.lvl || '') !== lvl) { cb.dataset.lvl = lvl; cb.classList.toggle('cr-warn', lvl === 'warn'); cb.classList.toggle('cr-crit', lvl === 'crit');
    cb.title = lvl ? `War credits: ${cw <= 0 ? 'none left' : `${cw} war${cw === 1 ? '' : 's'} left`}` : 'War credits'; stripTitles(cb.parentElement); } }
// Torn's war graph only exists once the war has started: no Graph button before then
const gb = box.querySelector('[data-a=graph]'), noGraph = !(isFinite(wstart) && wstart <= Date.now());
if (gb && (gb.style.display === 'none') !== noGraph) gb.style.display = noGraph ? 'none' : '';
const myRoll = rolls[me];
const rollCount = Object.keys(rolls).filter(id => (ours.members || []).some(x => String(x.player_id) === id)).length;
const showBar = preWar || rollOn() || !presOff();
const banner = !showBar ? '' : `<div class="wbar ${preWar ? 'pre' : ''}">
        ${preWar ? `<span class="wb-i">${ICON.clock}</span><span><b>War starts in <span class="num" data-until="${wstart}">${clock(wstart - Date.now())}</span></b>
          <span class="muted">${wstart - Date.now() > 4 * 3600000 ? ' \u00b7 data is slower until 4h before' : ' \u00b7 live'}</span></span>` : ''}
        <span class="pres-c" ${presKnown ? '' : 'hidden'}>${ICON.users}<span class="num"></span><span class="muted"></span></span>
        ${rollOn() ? `<span class="sp"></span><button class="ghost rb-c" data-a="rssum" title="Roll call summary">${rollCount}/${(ours.members || []).length}<span class="rb-l"> answered</span></button>
          <button class="ghost rbtn ${myRoll ? '' : 'todo'}" data-a="rollcall" title="${myRoll ? 'Update your roll call' : 'You haven\u2019t answered yet'}">${ICON.roll}<span>${myRoll ? 'Roll call' : 'Answer roll call'}</span></button>
          <button class="ghost rbtn" data-a="merc" title="Build a merc list">${ICON.attack}<span>Merc list</span></button>` : ''}
      </div>`;
const wbw = box.querySelector('.wbw');
if (!sameHtml(wbw, banner || ' ')) { wbw.innerHTML = banner; stripTitles(wbw); }   // war bar: shown in both modes
const bdHtml = `
      ${error ? `<div class="msg err" style="padding:6px 12px">Last refresh failed: ${esc(error.message)}</div>` : ''}
      <div class="swipe-hint">swipe for more columns \u2192</div>
      <div class="tw"><table>
        <thead><tr>
          ${th('name', `Players (${(fac.members || []).length})`, 'c-name')}
          ${isEnemy ? th('smart', '', 'c c-act') : ''}
          ${isEnemy && dibsOn ? th('dib', 'Dibber', 'c-dib') : ''}
          ${COLS.map(k => ({
        stats: () => th('est', '<span title="Newest spy, else average">Stats</span>', 'r c-est') + th('bsp', 'BSP', 'r c-bsp') + th('ffs', 'FFS', 'r c-ffs') + th('yata', 'YATA', 'r c-yata'),
        status: () => th('status', 'Status', 'c-st'),
        score: () => th('score', 'Score', 'r c-score'),
        lvl: () => th('level', 'Lvl', 'r c-lvl'),
        last: () => th('last', 'Last', 'r c-last'),
        rev: () => th('rev', `<span class="rev-h" title="Revivable">${ICON.revive}</span>`, 'c c-rev'),
        roll: () => showRoll ? th('roll', 'Roll call', 'c c-roll') : '',
      })[k]()).join('')}
        </tr></thead>
        <tbody>${rowList.length ? '<!--ROWS-->' : `<tr><td colspan="12" class="msg">No players match.${revFilter !== 'all' && revPending ? ` Still checking revive status for ${revPending} player${revPending > 1 ? 's' : ''}\u2026` : ''}</td></tr>`}</tbody>
      </table></div>`;
// Rebuilding ~200 rows is the panel's most expensive step, so it only happens when something in them changed
// (most refreshes bring identical data; ticking clocks are filled in by tick(), not compared).
// Only the shell (headings, columns) changing means a full rebuild. Otherwise just the rows that changed are
// swapped and the rest kept and re-ordered: rebuilding every row on each refresh was heavy, above all on Firefox
// (each rebuild left thousands of nodes for its cycle collector -> the page froze for 1-2s every few seconds).
const tbodyOld = bd.querySelector('tbody');
const rebuilt = !sameHtml(bd, bdHtml) || !tbodyOld || (rowList.length && !tbodyOld.querySelector('tr[data-pid]'));
if (rebuilt) {
  bd.innerHTML = bdHtml.replace('<!--ROWS-->', body);
  const tb = bd.querySelector('tbody');
  if (tb && rowList.length) [...tb.children].forEach((tr, i) => { if (rowList[i]) tr.dssKey = tickKey(rowList[i][1]); });
} else if (rowList.length && patchRows(tbodyOld, rowList)) {
  fixSticky();
}
revPlan(revCandidates, fac.members, (isEnemy ? ours : enemy).members);
mercPaint();
travPaint();
fsPaint();
crPaint();
presChanged();
if (!presStarted && !presOff()) { presStarted = true; presConnect(); }
if (rebuilt) {
  const tw = bd.querySelector('.tw');
  stripTitles(box);
  fixSticky();
  const viewKey = view + '|' + filter + '|' + stFilter + '|' + [...ctryFilter].join(',') + '|' + revFilter + '|' + sortKey + '|' + sortDir + '|' + search;
  if (viewKey !== lastViewKey) { lastScrollTop = 0; lastViewKey = viewKey; }  // new view/sort/filter -> start at the top
  tw.scrollTop = lastScrollTop;                                     // keep position across auto-refreshes
  tw.scrollLeft = lastScrollLeft;
  tw.classList.toggle('scrolled', tw.scrollLeft > 0);
  tw.addEventListener('scroll', () => { lastScrollLeft = tw.scrollLeft; lastScrollTop = tw.scrollTop; tw.classList.toggle('scrolled', tw.scrollLeft > 0); popRefresh(); ttHide(); }, { passive: true });
}
popRefresh();
ttRefresh();

tick();
  }

  // true when el already shows this markup (ignoring the ticking clock text, which tick() keeps current)
  const tickKey = html => html.replace(/(data-(?:until|since|ago)="[^"]*"[^>]*>)[^<]*/g, '$1').replace(/(data-tct[^>]*>)[^<]*/g, '$1');
  // bring the table body in line with [pid, html] rows: keep unchanged rows (moved into the new order), replace changed
  // ones, drop the rest. Returns how many rows were (re)built.
  function patchRows(tbody, rowList) {
const old = {};
for (const tr of [...tbody.children]) { if (tr.dataset.pid) old[tr.dataset.pid] = tr; else tr.remove(); }
const tmp = document.createElement('tbody');
let made = 0;
rowList.forEach(([pid, html], i) => {
  const key = tickKey(html);
  let tr = old[pid];
  if (!tr || tr.dssKey !== key) {
    tmp.innerHTML = html;
    const fresh = tmp.firstElementChild;
    stripTitles(fresh);
    fresh.dssKey = key;
    if (tr) tr.replaceWith(fresh);
    tr = fresh; made++;
  }
  delete old[pid];
  if (tbody.children[i] !== tr) tbody.insertBefore(tr, tbody.children[i] || null);
});
for (const pid in old) old[pid].remove();
return made;
  }
  function sameHtml(el, html) {
const key = tickKey(html);
if (el.dssHtml === key && el.firstElementChild) return true;
el.dssHtml = key;
return false;
  }

  // per-second: countdowns, war clock, "updated Xs ago"
  // Inline warning in the toolbar for my dibbed target:
  //   in hospital and inside the warning window -> amber countdown
  //   available (Okay, or hospital time already up) -> green "available - attack", stays until they're hospitalised
  //   again, leave (travel/jail), or the dib goes. Click to attack. The row's hospital badge pulses too.
  // Warning window is a setting in seconds; 0 turns it off.
  function dibAlert(now) {
const el = document.querySelector(`#${BOX_ID} .dwarn`);
if (!el) return;
let best = null;
if (state && state.user && dibWarnMs() > 0) {
  const me = state.user.user_id;
  for (const d of state.dibs || []) {
    if (!d || d.dib_window_resolved === false) continue;
    const assist = d.player_id !== me;                 // someone else's dib that I've joined as an assist
    if (assist && !(d.assist_player_ids || []).includes(me)) continue;
    const m = memberIdx[d.foe_id];
    if (!m) continue;
    let left;
    if (m.status_state === 'Okay') left = 0;
    else if (m.status_state === 'Hospital') left = Math.max(0, Date.parse(m.status_until) - now);
    else continue;                                     // travelling, jailed, etc: not attackable
    if (left <= dibWarnMs() && (!best || left < best.left || (left === best.left && best.assist && !assist))) best = { m, left, assist };
  }
}
if (!best) { if (!el.hidden) el.hidden = true; return; }
const out = best.left <= 0;
const html = `${best.assist ? ICON.assist : ICON.attack}${best.assist ? '<i>Assist</i>' : ''}<b>${esc(best.m.name)}</b><span>${out ? 'available' : `out in <span class="num">${clock(best.left)}</span>`}</span>`;
if (el.dssLast !== html) { el.innerHTML = html; el.dssLast = html; }
el.href = `https://www.torn.com/page.php?sid=attack&user2ID=${best.m.player_id}`;
if (el.target !== ATK_TARGET) el.target = ATK_TARGET;
el.classList.toggle('out', out);
el.classList.toggle('asst', !!best.assist);
el.hidden = false;
  }

  function tick() {
const box = document.getElementById(BOX_ID);
if (!box) return;
const now = Date.now();
box.querySelectorAll('[data-until]').forEach(el => { const t = clock(+el.dataset.until - now); if (el.textContent !== t) el.textContent = t; });
box.querySelectorAll('tr.mine .hchip, tr.assisting .hchip').forEach(ch => {
  const u = ch.querySelector('[data-until]'), left = u ? +u.dataset.until - now : Infinity;
  ch.classList.toggle('soon', left > 0 && left <= dibWarnMs());
});
dibAlert(now);
if (now - (tick.lastScore || 0) > 3000) { tick.lastScore = now; if (domScores()) render(); }   // war scores from Torn's list
atkBar();                                            // cheap when nothing changed; drops attacks older than an hour, keeps it at the newest
if (atkT && now - atkT > ATK_STALE_MS && Object.keys(atkNow).length) { atkNow = {}; atkBar(); }   // Torn stopped polling
fitOverlays();
tornTick();
if (now - (tick.lastFlip || 0) > 900 && [...box.querySelectorAll('.hchip [data-until]')].some(el => +el.dataset.until <= now)) {
  tick.lastFlip = now; render();
}
if (now - (tick.lastAgo || 0) > 15000) {               // "last action" ages: minute resolution, so a 15s refresh is plenty
  tick.lastAgo = now;
  box.querySelectorAll('[data-ago]').forEach(el => { const v = +el.dataset.ago, t = v ? ago(new Date(v).toISOString()) : '?'; if (el.textContent !== t) el.textContent = t; });
}
box.querySelectorAll('[data-since]').forEach(el => { const t = clock(now - +el.dataset.since); if (el.textContent !== t) el.textContent = t; });
box.querySelectorAll('[data-tct]').forEach(el => { const t = tct(); if (el.textContent !== t) el.textContent = t; });
box.querySelectorAll('[data-chainend]').forEach(el => {
  const left = (+el.dataset.chainend - now) / 1000;
  el.classList.toggle('crit', left < 60);
  el.classList.toggle('warn', left >= 60 && left < 150);
});
const lvb = box.querySelector('.lvb');
if (lvb) {
  if (lvb.hidden === liveOn) lvb.hidden = !liveOn;
  const tip = `Live statuses from Torn\n${liveWhy || 'Tyronic data looks stale'}`;
  if (liveOn && !noHover() && lvb.dataset.tt !== tip) lvb.dataset.tt = tip;
}
const age = box.querySelector('.age');
if (age) {
  // counted from when the request behind the data went out, and held at the poll interval while the next one is on
  // its way - so polling every 5s reads up to 5s, not 5s + Tyronic's response time (unless it's really stuck)
  const since = lastAsked || lastFetch;
  let secs = since ? Math.max(0, Math.floor((now - since) / 1000)) : null;
  if (secs != null && busy && now - busyAt < 15000) secs = Math.min(secs, Math.round(pollMs() / 1000));
  const label = secs == null ? '' : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
  if (age.textContent !== label) age.textContent = label;
  age.classList.toggle('busy', busy);
  const at = busy ? 'Updating\u2026' : 'Last update';
  if (!noHover() && age.dataset.tt !== at) age.dataset.tt = at;
  age.classList.toggle('bad', !!error || (secs != null && secs > 60));
}
if (popId != null) popRefresh();
  }

  // ================= mount =================
  function apply() {
let wrap = findWrap();
if (!wrap) return;
// safety net: only ever hide the members list itself. If the match is a bigger container (it holds the war banner,
// the faction tabs or our own panel - seen briefly while Torn rebuilds the page) hiding it would blank the whole page.
const tooBig = el => el.contains(document.getElementById(BOX_ID)) || !!el.querySelector('[class*="rankBox___"], [class*="warListItem___"], .faction-tabs, #factions');
if (tooBig(wrap)) {
  wrap.classList.remove(HIDE);
  if (!apply.warned) { apply.warned = true; console.warn('[Tyronic panel] war list match is a page container - not hiding it', wrap.className); }
  return;
}
document.querySelectorAll(`.${HIDE}`).forEach(el => { if (el !== wrap && !el.closest(`#${BOX_ID}`) && tooBig(el)) el.classList.remove(HIDE); });
wrap.classList.toggle(HIDE, !showOriginal);
const graphBtn = document.querySelector('[class*="graphIcon___"]'); // Torn's floating "View graph" link
if (graphBtn) graphBtn.classList.toggle(HIDE, !showOriginal);
const ttFilter = document.getElementById('rankedWarFilter'); // TornTools filter bar
if (ttFilter) ttFilter.classList.toggle(HIDE, !showOriginal);

// panel sits ABOVE Torn's list, so the toggle stays at the top in both modes
let box = document.getElementById(BOX_ID);
if (!box) {
  box = buildBox();
  wrap.before(box);
  render();
  refresh(true);
} else if (box.nextElementSibling !== wrap) {
  wrap.before(box);
}
box.querySelector('.hd').classList.toggle(HIDE, showOriginal);
box.querySelector('.bd').classList.toggle(HIDE, showOriginal);
box.classList.toggle('orig', showOriginal);         // Torn list mode: hide the controls that only act on our table
// only write when it changes: writing text is a DOM change, which would wake the observer below again (a loop)
const lbl = box.querySelector('[data-a=orig] .lbl-orig'), want = showOriginal ? 'Tyronic view' : 'Torn list';
if (lbl.textContent !== want) lbl.textContent = want;
  }

  // ---- open the ranked war automatically once per page load, if it has started ----
  // Torn's war list item (li.warListItem___ > .rankBox___[data-warid]) expands the members list when clicked.
  // Tyronic says whether the war has started; Torn's API has the final say on whether it's over (Tyronic's warend
  // can be missing or late, which used to reopen finished wars). A confirmed end is remembered so it's never asked again.
  const AUTO_EXPAND_PAUSE = 300;
  const WAR_TRUST_MS = 120000;     // a remembered "ongoing" is trusted this long; older -> ask Tyronic first
  let autoExpandDone = false;
  // time values arrive as ISO strings, unix seconds, ms or a 1970 placeholder -> ms, 0 = none
  const toMs = v => {
if (v == null || v === '') return 0;
if (typeof v === 'number' || /^\d+$/.test(String(v))) { const n = +v; return n > 1e12 ? n : n * 1000; }
const t = Date.parse(v); return isFinite(t) && t > 0 ? t : 0;
  };
  // save what we know about a war without ever un-ending it
  function saveWar(id, start, end, extra) {
id = String(id);
const prev = GM_getValue('warInfo', null), same = prev && prev.id === id;
GM_setValue('warInfo', Object.assign({ id, start: start || null, end: end || null, t: Date.now() },
  same && prev.ended ? { ended: true } : {}, extra || {}));
  }
  function rememberWar() {
const wd = state && state.wardata;
if (wd && wd.war_id) saveWar(wd.war_id, wd.warstart, wd.warend);
  }
  // 'live' only once the war has started and has no end time in the past
  function warPhase(w) {
if (w.ended) return 'ended';
const now = Date.now(), s = toMs(w.start), e = toMs(w.end);
if (e && e <= now) return 'ended';
if (!s || s > now) return 'pending';
return 'live';
  }
  // true = over, false = still on, null = couldn't tell
  async function tornWarOver(warId) {
const key = GM_getValue('tornKey', '');
if (!key) return null;
revStamps.push(Date.now());                          // shared per-minute budget
try {
  const res = await req('GET', 'https://api.torn.com/v2/faction/wars?comment=dss-ty',
    { accept: 'application/json', Authorization: `ApiKey ${key}` });
  if (!res || res.error || !res.wars) return null;
  const rw = res.wars.ranked;
  if (!rw) return true;                              // no ranked war at all: the one on the page is finished
  if (rw.war_id != null && String(rw.war_id) !== String(warId)) return true;   // a different war is current
  const end = toMs(rw.end);
  return !!rw.winner || (end > 0 && end <= Date.now());
} catch (_) { return null; }
  }
  function autoExpand() {
if (autoExpandDone) return;
if (findWrap()) { autoExpandDone = true; return; }                 // already open
const rb = document.querySelector('[class*="rankBox___"][data-warid]');
const li = rb && (rb.closest('li[class*="warListItem___"]') || rb.closest('li'));
if (!li) return;
autoExpandDone = true;
const warId = String(rb.dataset.warid), seen = Date.now();
const click = () => setTimeout(() => { if (!findWrap()) li.click(); }, Math.max(0, seen + AUTO_EXPAND_PAUSE - Date.now()));
const known = GM_getValue('warInfo', null), mine = known && known.id === warId;
if (mine) {
  const ph = warPhase(known);
  if (ph === 'ended') return;                                      // over: leave it closed (no calls)
  if (ph === 'pending' && toMs(known.start)) return;               // start time known and not reached yet
}
if (!GM_getValue('tornKey', '')) return;
(async () => {
  let live = mine && warPhase(known) === 'live' && Date.now() - (known.t || 0) < WAR_TRUST_MS;
  if (!live) {                                                     // nothing fresh remembered: check with Tyronic
    const st = await rpc('getstate', {});
    if (!state) { state = st; lastFetch = lastAsked = Date.now(); }
    const wd = st && st.wardata;
    if (!wd || String(wd.war_id) !== warId) return;                // Tyronic is tracking a different war
    saveWar(warId, wd.warstart, wd.warend);
    live = warPhase(GM_getValue('warInfo', {})) === 'live';
  }
  if (!live) return;
  const over = await tornWarOver(warId);                           // Tyronic thinks it's on - make sure with Torn
  if (over === true) { saveWar(warId, known && known.start, known && known.end, { ended: true }); return; }
  click();                                                         // still on (or Torn unreachable: trust Tyronic)
})().catch(() => { /* leave it closed */ });
  }

  const safeApply = () => {
try { autoExpand(); } catch (_) { /* never block the panel */ }
try { apply(); } catch (e) { console.error('[Tyronic panel] could not attach to the war page', e); }
  };

  let pollTimer = null;
  function schedulePoll() {
clearTimeout(pollTimer);
pollTimer = setTimeout(() => { refresh(false); schedulePoll(); }, pollMs());   // don't wait on it: a slow refresh mustn't pause the timer
  }

  // Torn PDA can inject scripts before <body> exists - wait for it before observing.
  function start() {
if (!document.body) return setTimeout(start, 50);
let queued = false;
new MutationObserver(muts => {
  if (queued) return;
  const box = document.getElementById(BOX_ID);
  if (box && muts.every(m => box.contains(m.target))) return;   // our own panel updating: nothing for apply() to do
  queued = true;
  setTimeout(() => { queued = false; safeApply(); }, 50);   // timer, not rAF: rAF can stall in background WebViews
}).observe(document.body, { childList: true, subtree: true });
setInterval(tick, 1000);
setInterval(safeApply, 2000);                              // belt and braces for SPA/hash navigation
schedulePoll();
setTimeout(() => liveKick(0), 8000);
// back on the tab: fresh Tyronic data and an immediate Torn status read (catches hits on our dibs while away)
let lastBack = 0;
const onBack = () => {
  if (document.hidden || Date.now() - lastBack < 5000) return;
  lastBack = Date.now();
  refresh(false);
  liveLastProbe = 0;
  liveKick(0);
  if (!presTimer && !presLive && !lpToken && presStarted) presConnect();
};
document.addEventListener('visibilitychange', onBack);
window.addEventListener('focus', onBack);
safeApply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
}
});
