import { API_BASE, IS_PDA, tornAuth } from '../../core/constants.js';
import { registerModule } from '../../core/registry.js';
import { Storage } from '../../core/storage.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Price Sorter
// ════════════════════════════════════════════════════════════════════════

registerModule('item-price-sorter', {
name: 'Item Price Sorter',
version: '2.0',
description: 'Sort items by price on the items page. On desktop uses TornTools price data; on Torn PDA it pulls daily market prices from the Torn API.',
pages: ['/item.php'],
guide,
init() {
    let sortAscending = false;
    let sortActive = false;
    let originalOrder = new Map();
    let listObserver = null;
    let isSorting = false;
    let sortDebounceTimer = null;


    // ── PDA price layer ─────────────────────────────────────────────
    // Recreates TornTools' `span.tt-item-price` on each row so the shared
    // sort logic below works unchanged. Desktop skips all of this.
    const PRICE_CACHE_KEY = 'dss_item_market_prices_v1';
    let priceMap = null;
    let pricesLoading = false;
    let pricesStale = false;
    let staleDay = null;

    const DSS_FORCE_STALE = false;

    if (IS_PDA) {
        GM_addStyle(`
                .items-cont.ui-tabs-panel > li { position: relative; }
                .dss-pda-price {
                    position: absolute;
                    right: 10px;
                    top: 19px;
                    transform: translateY(-50%);
                    font-size: 9px;
                    color: #7bb661;
                    white-space: nowrap;
                    pointer-events: none;
                }
                .dss-pda-price .tt-item-quantity {
                    color: #ccc;
                }
                .dss-pda-price-stale {
                    color: #d9756b;
                }
                .dss-pda-price-stale .tt-item-quantity {
                    color: #ccc;
                }
                .dss-pda-price-na {
                    color: #888;
                    font-style: italic;
                }
                                .dss-price-stale-banner {
                    display: flex; align-items: center; gap: 8px;
                    padding: 6px 10px; margin: 0 0 4px 0;
                    background: rgba(160,50,45,0.18);
                    border: 1px solid rgba(217,117,107,0.5);
                    border-radius: 4px;
                    color: #d9756b; font-size: 11px; line-height: 1.4;
                    box-sizing: border-box;
                }
                .dss-price-stale-banner .dss-psb-text { flex: 1; }
                .dss-price-stale-banner .dss-psb-close {
                    flex-shrink: 0; cursor: pointer; border: none; background: none;
                    color: #d9756b; font-size: 15px; line-height: 1; padding: 0 2px;
                }
            `);
    }

    function todayUTC() { return new Date().toISOString().slice(0, 10); }

    function loadCachedPrices() {
        try {
            const raw = GM_getValue(PRICE_CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data && data.prices) {
                return { prices: data.prices, day: data.day || null, stale: data.day !== todayUTC() };
            }
        } catch (_) { /* ignore */ }
        return null;
    }

    function saveCachedPrices(prices) {
        try { GM_setValue(PRICE_CACHE_KEY, JSON.stringify({ day: todayUTC(), prices })); }
        catch (_) { /* ignore */ }
    }

    async function fetchPrices() {
        const apiKey = Storage.getSettings().apiKey;
        if (!apiKey) return null;
        try {
            const res = await fetch(`${API_BASE}/torn/items?cat=All&sort=ASC`, {
                headers: tornAuth(apiKey)
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (data?.error || !Array.isArray(data?.items)) return null;
            const map = {};
            for (const item of data.items) {
                const mp = item?.value?.market_price;
                if (item?.id != null && mp) map[item.id] = mp; // skip 0 / untradeable
            }
            return map;
        } catch (_) { return null; }
    }

    async function ensurePriceMap() {
        if (priceMap) return priceMap;

        const cached = loadCachedPrices();
        if (cached && !cached.stale && !DSS_FORCE_STALE) {
            priceMap = cached.prices;
            pricesStale = false;
            return priceMap;
        }

        if (pricesLoading) return null;
        pricesLoading = true;
        const fetched = await fetchPrices();
        pricesLoading = false;

        if (fetched && !DSS_FORCE_STALE) {
            priceMap = fetched;
            pricesStale = false;
            staleDay = null;
            saveCachedPrices(fetched);
        } else if (fetched && DSS_FORCE_STALE) {
            // Debug: real prices, but pretend they're yesterday's.
            priceMap = fetched;
            pricesStale = true;
            staleDay = '2026-09-01';
        } else if (cached) {
            priceMap = cached.prices;
            pricesStale = true;
            staleDay = cached.day;
        }
        return priceMap;
    }

    function getItemId(li) {
        // 1. data-item on the row or a descendant
        const dataEl = (li.matches && li.matches('[data-item]')) ? li : li.querySelector('[data-item]');
        if (dataEl) {
            const v = dataEl.getAttribute('data-item');
            if (v && /^\d+$/.test(v)) return v;
        }
        // 2. item image src: /images/items/{id}/...
        const imgs = li.querySelectorAll('img[src], img[data-src]');
        for (const im of imgs) {
            const src = im.getAttribute('src') || im.getAttribute('data-src') || '';
            const m = src.match(/\/items\/(\d+)\//);
            if (m) return m[1];
        }
        // 3. data-itemid fallback
        const idEl = li.querySelector('[data-itemid]');
        if (idEl) {
            const v = idEl.getAttribute('data-itemid');
            if (v && /^\d+$/.test(v)) return v;
        }
        return null;
    }

    function getRowQuantity(li) {
        // TornTools/Torn render the stack count as e.g. "x73" in a qty span.
        const qtyEl = li.querySelector('span.qty, .qty');
        if (qtyEl) {
            const m = (qtyEl.textContent || '').replace(/[,\s]/g, '').match(/(\d+)/);
            if (m) return parseInt(m[1], 10);
        }
        return 1;
    }

    function injectPricesInto(list) {
        if (!IS_PDA || !priceMap || !list) return;
        const staleCls = pricesStale ? ' dss-pda-price-stale' : '';
        const staleTitle = pricesStale
            ? (staleDay
                ? `Market prices are out of date — showing cached data from ${staleDay}. Today's refresh failed; reload to retry.`
                : `Market prices are out of date — today's refresh failed. Reload to retry.`)
            : '';
           for (const li of Array.from(list.children)) {
               if (li.tagName !== 'LI') continue;
               if (li.querySelector('span.tt-item-price') || li.querySelector('.dss-pda-price')) continue;
            const id = getItemId(li);
            const host = li;

            const unit = id ? priceMap[id] : null;
            if (!unit) {
                const na = document.createElement('span');
                na.className = 'dss-pda-price dss-pda-price-na';
                na.textContent = 'N/A';
                host.appendChild(na);
                continue;
            }

            const qty = getRowQuantity(li);
            const wrap = document.createElement('span');
            wrap.className = 'tt-item-price dss-pda-price' + staleCls;
            if (staleTitle) wrap.title = staleTitle;

            if (qty > 1) {
                const total = unit * qty;
                const s1 = document.createElement('span');
                s1.textContent = '$' + unit.toLocaleString('en-US') + ' |';
                const s2 = document.createElement('span');
                s2.className = 'tt-item-quantity';
                s2.textContent = ' ' + qty + 'x = ';
                const s3 = document.createElement('span');
                s3.textContent = '$' + total.toLocaleString('en-US');
                wrap.append(s1, s2, s3);
            } else {
                const s = document.createElement('span');
                s.textContent = '$' + unit.toLocaleString('en-US');
                wrap.appendChild(s);
            }
            host.appendChild(wrap);
        }
        renderStaleBanner(list);
    }

    let staleBannerDismissed = false;

    function renderStaleBanner(list) {
        if (!IS_PDA || !list) return;
        const existing = list.querySelector('.dss-price-stale-banner');

        // Remove the banner when not stale, or if the user dismissed it.
        if (!pricesStale || staleBannerDismissed) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return; // already shown on this list

        const banner = document.createElement('div');
        banner.className = 'dss-price-stale-banner';

        const text = document.createElement('span');
        text.className = 'dss-psb-text';
        text.textContent = staleDay
            ? `⚠ Market prices are from ${staleDay} - today's refresh failed. Reload to retry.`
            : `⚠ Market prices are out of date - today's refresh failed. Reload to retry.`;

        const close = document.createElement('button');
        close.className = 'dss-psb-close';
        close.type = 'button';
        close.textContent = '\u00D7';
        close.title = 'Dismiss';
        close.addEventListener('click', () => {
            staleBannerDismissed = true;
            banner.remove();
        });

        banner.append(text, close);
        list.insertBefore(banner, list.firstChild);
    }

    function ensurePricesForActiveList() {
        if (!IS_PDA) return;
        ensurePriceMap().then(() => injectPricesInto(getActiveList()));
    }

    // ── Shared logic (price-source agnostic) ────────────────────────
    function parsePrice(liElement) {
        // TornTools' "armoury"-style price block: <li class="tt-item-price fl">.
        // For a stack it holds 3 spans (unit | qty× = total); for a single item,
        // one span. Either way the LAST span is the value we sort by.
        const armouryLi = liElement.querySelector('li.tt-item-price.fl');
        if (armouryLi) {
            const aSpans = armouryLi.querySelectorAll('span');
            if (aSpans.length) {
                const last = aSpans[aSpans.length - 1];
                return parseFloat(last.textContent.replace(/[$,]/g, '')) || 0;
            }
        }
        const priceSpan = liElement.querySelector('span.tt-item-price');
        if (priceSpan) {
            const spans = priceSpan.querySelectorAll('span');
            if (spans.length >= 3) {
                return parseFloat(spans[spans.length - 1].textContent.replace(/[$,]/g, '')) || 0;
            } else if (spans.length === 1) {
                return parseFloat(spans[0].textContent.replace(/[$,]/g, '')) || 0;
            }
            const match = priceSpan.textContent.match(/\$([\d,]+)/g);
            if (match) {
                return parseFloat(match[match.length - 1].replace(/[$,]/g, '')) || 0;
            }
        }
        return 0;
    }

    function getActiveList() {
        const panels = document.querySelectorAll('.items-cont.ui-tabs-panel');
        for (const panel of panels) {
            if (panel.getAttribute('aria-hidden') === 'false' || panel.style.display !== 'none') {
                return panel;
            }
        }
        return null;
    }

    function saveOriginalOrder(list) {
        const id = list.id || list.dataset.info || 'unknown';
        if (!originalOrder.has(id)) {
            originalOrder.set(id, Array.from(list.children));
        }
    }

    function sortItems(ascending) {
        const list = getActiveList();
        if (!list) return;
        if (IS_PDA) injectPricesInto(list); // make sure current rows are priced
        isSorting = true;
        const items = Array.from(list.children);
        items.sort((a, b) => {
            const priceA = parsePrice(a);
            const priceB = parsePrice(b);
            return ascending ? priceA - priceB : priceB - priceA;
        });
        const fragment = document.createDocumentFragment();
        items.forEach(item => fragment.appendChild(item));
        list.appendChild(fragment);
        isSorting = false;
    }

    function restoreOriginalOrder() {
        const list = getActiveList();
        if (!list) return;
        const id = list.id || list.dataset.info || 'unknown';
        const original = originalOrder.get(id);
        if (!original) return;
        isSorting = true;
        const fragment = document.createDocumentFragment();
        original.forEach(item => fragment.appendChild(item));
        list.appendChild(fragment);
        isSorting = false;
        originalOrder.delete(id);
    }

    function updateButton(btn) {
        if (!sortActive) {
            btn.textContent = IS_PDA ? '\u21C5' : 'Unsorted';
            btn.title = 'Click to sort by price (high to low)';
            btn.style.background = '#2a2a2a';
            btn.style.borderColor = '#555';
            btn.style.color = '#e0e0e0';
        } else if (!sortAscending) {
            btn.textContent = IS_PDA ? '$\u2193' : '$ High \u2192 Low';
            btn.title = 'Click to sort by price (low to high)';
            btn.style.background = '#1a3a1a';
            btn.style.borderColor = '#4a8a4a';
            btn.style.color = '#90ee90';
        } else {
            btn.textContent = IS_PDA ? '$\u2191' : '$ Low \u2192 High';
            btn.title = 'Click to restore original order';
            btn.style.background = '#3a1a1a';
            btn.style.borderColor = '#8a4a4a';
            btn.style.color = '#ee9090';
        }
    }

    function injectButton() {
        if (document.getElementById('dss-sort-btn')) return;
        const searchForm = document.querySelector('form[name="itemsSearchForm"]');
        if (!searchForm) return;

        const btn = document.createElement('button');
        btn.id = 'dss-sort-btn';
        btn.type = 'button';
        btn.style.cssText = `
                margin-left: 6px; padding: 3px 8px; background: #2a2a2a;
                color: #e0e0e0; border: 1px solid #555; border-radius: 3px;
                cursor: pointer; font-size: 11px; vertical-align: middle;
                line-height: 1.4; float: right; position: relative; top: 3px;
            `;
        updateButton(btn);

        btn.addEventListener('click', () => {
            const list = getActiveList();
            if (!list) return;
            if (IS_PDA && !priceMap) ensurePricesForActiveList(); // late load, if needed
            if (!sortActive) {
                saveOriginalOrder(list);
                sortActive = true;
                sortAscending = false;
                sortItems(false);
            } else if (!sortAscending) {
                sortAscending = true;
                sortItems(true);
            } else {
                sortActive = false;
                sortAscending = false;
                restoreOriginalOrder();
            }
            updateButton(btn);
        });

        searchForm.insertAdjacentElement('afterend', btn);
    }

    function observeActiveList() {
        if (listObserver) { listObserver.disconnect(); listObserver = null; }
        const list = getActiveList();
        if (!list) return;

        listObserver = new MutationObserver((mutations) => {
            if (isSorting) return;

            // A detail panel is <li class="show-item-info"> — NOT a real row.
            // Only genuine item rows carry data-item; use that to tell them apart.
            const hasNewItemRows = mutations.some(m =>
                                                  Array.from(m.addedNodes).some(n =>
                                                                                n.nodeType === 1 &&
                                                                                !(n.classList && n.classList.contains('show-item-info')) &&
                                                                                (
                (n.matches && n.matches('li[data-item]')) ||
                (n.querySelector && n.querySelector('li[data-item]'))
            )
                                                                               )
                                                 );
            if (!hasNewItemRows) return;

            if (IS_PDA) injectPricesInto(list);
            if (sortActive && !isDetailOpen(list)) {
                clearTimeout(sortDebounceTimer);
                sortDebounceTimer = setTimeout(() => {
                    if (isDetailOpen(list)) return;   // re-check after debounce
                    const id = list.id || list.dataset.info || 'unknown';
                    originalOrder.delete(id);
                    saveOriginalOrder(list);
                    sortItems(sortAscending);
                }, 300);
            }
        });
        listObserver.observe(list, { childList: true });
    }

    function isDetailOpen(list) {
        // Torn injects <li class="show-item-info"> and marks the opened row
        // with .item-info-active/.opened when an item's details are expanded.
        // Re-sorting reappends all rows and rips that panel out, so skip it.
        return !!list.querySelector('.show-item-info, li.item-info-active, li.opened');
    }

    function onTabChange() {
        clearTimeout(sortDebounceTimer);
        setTimeout(() => {
            const list = getActiveList();
            if (!list) return;
            if (IS_PDA) injectPricesInto(list);
            const id = list.id || list.dataset.info || 'unknown';
            originalOrder.delete(id);
            if (sortActive) {
                saveOriginalOrder(list);
                sortItems(sortAscending);
            }
            observeActiveList();
            const btn = document.getElementById('dss-sort-btn');
            if (btn) updateButton(btn);
        }, 300);
    }

    function startInit() {
        injectButton();
        const tabContainer = document.querySelector('.tabs-list') || document.querySelector('[role="tablist"]');
        if (tabContainer) tabContainer.addEventListener('click', onTabChange);
        observeActiveList();
        if (IS_PDA) ensurePricesForActiveList();
    }

    // Watch for the search form to appear (Torn loads content async)
    const bodyObserver = new MutationObserver(() => {
        if (document.querySelector('form[name="itemsSearchForm"]') && !document.getElementById('dss-sort-btn')) {
            startInit();
        }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    setTimeout(startInit, 1000);
}
});
