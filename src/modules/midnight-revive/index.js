import { registerModule } from '../../core/registry.js';
import { gmRequest } from '../../core/request.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Midnight X Revive
// ════════════════════════════════════════════════════════════════════════

    registerModule('midnight-revive', {
name: 'Midnight X Revive',
version: '1.2.5',
description: 'Adds a "NITE Revive Me" button to the hospital status links to request a revive from Midnight X.',
pages: ['https://www.torn.com/'],
guide,
init() {
    const OWNER = 'Midnight X';
    const SOURCE = 'DSS Midnight X Module';
    const BUTTON_LABEL = 'NITE Revive Me';
    const COLOUR = '#61be3b';
    const API_URL = 'https://api.no1irishstig.co.uk/request';
    const VERSION = '1.2.5';

    // PDA cleanup: remove any stale button from a previous page load
    document.getElementById('custom-btn')?.remove();

    const icon = `
<svg xmlns="http://www.w3.org/2000/svg"
 width="15" height="15" viewBox="0 0 20 20">
  <path fill="none" class="revive-icon"
  d="M18.737,9.691h-5.462c-0.279,0-0.527,0.174-0.619,0.437l-1.444,4.104L8.984,3.195c-0.059-0.29-0.307-0.506-0.603-0.523C8.09,2.657,7.814,2.838,7.721,3.12L5.568,9.668H1.244c-0.36,0-0.655,0.291-0.655,0.655c0,0.36,0.294,0.655,0.655,0.655h4.8c0.281,0,0.532-0.182,0.621-0.45l1.526-4.645l2.207,10.938c0.059,0.289,0.304,0.502,0.595,0.524c0.016,0,0.031,0,0.046,0c0.276,0,0.524-0.174,0.619-0.437L13.738,11h4.999c0.363,0,0.655-0.294,0.655-0.655C19.392,9.982,19.1,9.691,18.737,9.691z"/>
</svg>`;

    GM_addStyle(`
            .revive-text { color: ${COLOUR}; }
            .revive-icon { fill: ${COLOUR} !important; }
            #custom-btn .nite-tag { display: none !important; }
            #custom-btn.nite-tagged { width: auto !important; overflow: visible !important; white-space: nowrap; }
            #custom-btn.nite-tagged .nite-tag {
                display: inline-block !important; margin-left: 3px; vertical-align: middle;
                font: 700 8px/1 Arial, sans-serif; color: ${COLOUR}; pointer-events: none;
            }
        `);

    let btn = null;

    // ── Session data ──────────────────────────────────────────────────
    function getSessionData() {
        const sidebarKey = Object.keys(sessionStorage).find(k => /sidebarData\d+/.test(k));
        if (!sidebarKey) return { userID: null, userName: null, hospital: false };
        let data;
        try { data = JSON.parse(sessionStorage.getItem(sidebarKey)); }
        catch (_) { return { userID: null, userName: null, hospital: false }; }
        return {
            userID: data?.user?.userID,
            userName: data?.user?.name,
            hospital: data?.statusIcons?.icons?.hospital,
        };
    }

    function inCloudflareChallenge() {
        return document.getElementsByClassName('iAmUnderAttack').length > 0;
    }

    // ── Button ────────────────────────────────────────────────────────
    function getButton() {
        btn = document.createElement('a');
        if (document.body.classList.contains('dark-mode')) {
            btn.classList.add('custom-dark-mode');
        }
        btn.id = 'custom-btn';
        btn.className = 'custom-revive t-clear h c-pointer m-icon line-h24 right last';
        btn.innerHTML = `
                <span class="icon-wrap svg-icon-wrap">
                    <span class="link-icon-svg">${icon}</span>
                </span>
                <span class="revive-text">${BUTTON_LABEL}</span>
                <span class="nite-tag">NITE</span>
            `;
        btn.href = '#custom-revive';
        btn.addEventListener('click', submitRequest);
        btn.addEventListener('mouseenter', () => {
            const text = document.getElementsByClassName('revive-text')[0];
            const svg = document.getElementsByClassName('revive-icon')[0];
            if (text) text.style.color = COLOUR;
            if (svg) svg.setAttribute('style', `fill: ${COLOUR} !important`);
        });
        btn.addEventListener('mouseleave', () => {
            const text = document.getElementsByClassName('revive-text')[0];
            const svg = document.getElementsByClassName('revive-icon')[0];
            if (text) text.style.color = null;
            if (svg) svg.removeAttribute('style');
        });
        return btn;
    }

    function checkButton() {
        if (inCloudflareChallenge()) return;

        const { hospital } = getSessionData();
        const exists = document.getElementById('custom-btn');

        if (!hospital) {
            if (btn) btn.remove();
            return;
        }
        if (exists) {
            // Torn hides link text on narrow screens (e.g. PDA): show the NITE tag under the icon instead
            const text = exists.querySelector('.revive-text');
            if (text) {
                const cs = getComputedStyle(text);
                const hidden = cs.display === 'none' || cs.visibility === 'hidden' || text.getBoundingClientRect().width === 0;
                exists.classList.toggle('nite-tagged', hidden);
            }
            return;
        }

        const location = document.getElementById('top-page-links-list');
        if (location != null) {
            // Remove TornTools' revive button if present to avoid duplication
            const issues = document.getElementsByClassName('tt-revive');
            if (issues.length !== 0) issues[0].remove();

            const last = location.children[location.children.length - 1];
            if (last) last.insertAdjacentElement('afterend', getButton());
        }
    }

    // ── Request ───────────────────────────────────────────────────────
    function handleResponse(response) {
        if (btn) { btn.removeAttribute('disabled'); btn.removeAttribute('aria-pressed'); }
        if (response?.status && response.status !== 200) {
            const responseText = (response.responseText || '').replace(/^"|"$/g, '');
            alert(`Error Code: ${response.status}\nMessage: ${responseText}`
                || `An unknown error has occurred - Please report this to ${OWNER} leadership.`);
            return;
        }

        let contract = false;
        try { contract = !!JSON.parse(response.responseText).contract; }
        catch (_) { /* ignore */ }

        if (contract) {
            alert(`Contract request has been sent to ${OWNER}. Thank you!`);
        } else {
            alert(`Request has been sent to ${OWNER}. Please pay your reviver 2 Xanax or $1.8m. Thank you!`);
        }
    }

    function submitRequest(e) {
        e?.preventDefault();

        const sessionData = getSessionData();
        if (!sessionData.hospital) {
            alert('You are not in the hospital.');
            return;
        }

        if (btn) {
            btn.setAttribute('disabled', true);
            btn.setAttribute('aria-pressed', true);
        }

        gmRequest({
            method: 'POST',
            url: API_URL,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({
                tornid: parseInt(sessionData.userID),
                username: '' + sessionData.userName,
                vendor: OWNER,
                source: `${SOURCE} ${VERSION}`,
                type: 'revive'
            }),
            onload: handleResponse,
        });
    }

    // ── Start ─────────────────────────────────────────────────────────
    const checkTimer = setInterval(checkButton, 500);
    window.addEventListener('beforeunload', () => clearInterval(checkTimer));
}
});
