import { UI } from './ui.js';

// ════════════════════════════════════════════════════════════════════════
// UI — SIDEBAR BUTTON
// ════════════════════════════════════════════════════════════════════════

function addSidebarButton() {
    let desktopAdded = false;
    let mobileAdded = false;

    const observer = new MutationObserver((_, obs) => {
        // ── Desktop sidebar ──
        if (!desktopAdded) {
            if (document.getElementById('nav-dss-scripts')) {
                desktopAdded = true;
            } else {
                const anyNavItem = document.querySelector('div[class*="area-desktop"]');
                if (anyNavItem) {
                    const navContainer = anyNavItem.parentNode;
                    if (navContainer && navContainer.querySelectorAll('div[class*="area-desktop"]').length >= 3) {
                        const areaClass = anyNavItem.className.replace(/\bactive\S*/g, '').trim();
                        const dssNav = document.createElement('div');
                        dssNav.className = areaClass;
                        dssNav.id = 'nav-dss-scripts';

                        const innerRow = anyNavItem.querySelector('[class*="area-row"]');
                        const innerLink = anyNavItem.querySelector('a[class*="desktopLink"]');
                        const iconWrap = anyNavItem.querySelector('[class*="svgIconWrap"]');
                        const iconSpan = anyNavItem.querySelector('[class*="defaultIcon"]');
                        const linkName = anyNavItem.querySelector('[class*="linkName"]');

                        dssNav.innerHTML = `
                            <div class="${innerRow?.className || ''}">
                                <a href="#/dss/settings" class="${innerLink?.className || ''} dss-manager-link">
                                    <span class="${iconWrap?.className || ''}">
                                        <span class="${iconSpan?.className || ''}" style="font-size:13px;display:flex;align-items:center;justify-content:center;margin-left:-5px;">🔧</span>
                                    </span>
                                    <span class="${linkName?.className || ''}" style="margin-left:-1px">Dsuttz Scripts</span>
                                </a>
                            </div>
                        `;

                        GM_addStyle(`
                            #nav-dss-scripts { border-left: 3px solid #667eea; }
                            #nav-dss-scripts.dss-active,
                            #nav-dss-scripts.dss-active > div,
                            #nav-dss-scripts.dss-active a { background: rgba(102,126,234,0.15) !important; }
                        `);

                        navContainer.appendChild(dssNav);
                        dssNav.querySelector('a').addEventListener('click', dssNavClick);
                        if (window.location.hash.startsWith('#/dss/')) {
                            dssNav.style.background = 'rgba(102,126,234,0.08)';
                        }
                        desktopAdded = true;
                        setActiveNav();
                    }
                }
            }
        }

        // ── Mobile swiper ──
        if (!mobileAdded) {
            if (document.getElementById('nav-dss-scripts-mobile')) {
                mobileAdded = true;
            } else {
                const anyMobileSlide = document.querySelector('.swiper-slide [class*="area-mobile"]');
                if (anyMobileSlide) {
                    const swiperWrapper = anyMobileSlide.closest('.swiper-wrapper');
                    if (swiperWrapper && swiperWrapper.querySelectorAll('[class*="area-mobile"]').length >= 3) {
                        const slideClass = anyMobileSlide.closest('.swiper-slide')?.className?.replace(/swiper-slide-(active|prev|next)/g, '').trim() || '';
                        const mobileAreaClass = anyMobileSlide.className;

                        const innerRow = anyMobileSlide.querySelector('[class*="area-row"]');
                        const innerLink = anyMobileSlide.querySelector('a[class*="sidebarMobileLink"]');
                        const iconWrap = anyMobileSlide.querySelector('[class*="svgIconWrap"]');
                        const iconSpan = anyMobileSlide.querySelector('[class*="defaultIcon"]');

                        const dssSlide = document.createElement('div');
                        dssSlide.className = slideClass;
                        dssSlide.style.width = anyMobileSlide.closest('.swiper-slide')?.style.width || '';
                        dssSlide.innerHTML = `
                            <div id="nav-dss-scripts-mobile" class="${mobileAreaClass}">
                                <div class="${innerRow?.className || ''}">
                                    <a href="#/dss/settings" class="${innerLink?.className || ''} dss-manager-link">
                                        <span class="${iconWrap?.className || ''}">
                                            <span class="${iconSpan?.className || ''}" style="font-size:13px;display:flex;align-items:center;justify-content:center;">🔧</span>
                                        </span>
                                        <span>DSS</span>
                                    </a>
                                </div>
                            </div>
                        `;

                        GM_addStyle('#nav-dss-scripts-mobile { border-bottom: 3px solid #667eea; }');
                        swiperWrapper.appendChild(dssSlide);
                        dssSlide.querySelector('a').addEventListener('click', dssNavClick);
                        mobileAdded = true;
                    }
                }
            }
        }

        if (desktopAdded && mobileAdded) obs.disconnect();
    });

    function dssNavClick(e) {
        e.preventDefault();
        if (!window.location.pathname.includes('/city.php')) {
            window.location.href = 'https://www.torn.com/city.php#/dss/settings';
            return;
        }
        if (window.location.hash !== '#/dss/settings') {
            window.location.hash = '#/dss/settings';
        }
        setTimeout(() => UI.render(), 50);
        setActiveNav();
    }

    function injectFlyoutNav() {
        const panel = document.getElementById('fly-out-panel');
        if (!panel) return;                                   // flyout not enabled
        if (panel.querySelector('#nav-dss-scripts-flyout')) return; // already added

        // The scrolling nav list container (holds all the <div id="nav-*"> rows)
        const areas = panel.querySelector('[class*="areasMobile___"]')
        || panel.querySelector('[class*="areas___"]');
        if (!areas) return;

        // Grab a real entry to clone Torn's exact (hashed) classes from.
        const sample = areas.querySelector('[class*="area-mobile___"]');
        if (!sample) return;
        const sampleRow  = sample.querySelector('[class*="areaRow___"]');
        const sampleLink = sample.querySelector('a[class*="mobileLink___"]');
        const iconWrap   = sample.querySelector('[class*="svgIconWrap___"]');
        const iconSpan   = sample.querySelector('[class*="defaultIcon___"]');
        const nameSpan   = sample.querySelector('[class*="linkName___"]');
        if (!sampleLink) return;

        // Clone the outer wrapper's classes, minus per-item state classes.
        const outerClass = sample.className
        .replace(/\bactive\S*/g, '')
        .replace(/\battention\S*/g, '')
        .trim();

        const entry = document.createElement('div');
        entry.id = 'nav-dss-scripts-flyout';
        entry.className = outerClass;
        entry.innerHTML = `
        <div class="${sampleRow?.className || ''}">
            <a href="#/dss/settings" class="${sampleLink.className} dss-manager-link">
                <span class="${iconWrap?.className || ''}">
                    <span class="${iconSpan?.className || ''}"
                          style="display:flex;align-items:center;justify-content:center;font-size:13px;">🔧</span>
                </span>
                <span class="${nameSpan?.className || ''}">Dsuttz Scripts</span>
            </a>
        </div>`;

        GM_addStyle('#nav-dss-scripts-flyout { border-left: 3px solid #667eea; }');

        areas.appendChild(entry);
        entry.querySelector('a').addEventListener('click', dssNavClick);
    }


    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);

    // Observe the flyout list for rebuilds; slow-poll only to catch the
    // panel appearing late or being replaced wholesale by Torn.
    let flyoutPanel = null;
    let flyoutObs = null;
    function watchFlyout() {
        const panel = document.getElementById('fly-out-panel');
        if (panel !== flyoutPanel) {
            if (flyoutObs) { flyoutObs.disconnect(); flyoutObs = null; }
            flyoutPanel = panel;
            if (panel) {
                flyoutObs = new MutationObserver(() => {
                    if (!panel.querySelector('#nav-dss-scripts-flyout')) injectFlyoutNav();
                });
                flyoutObs.observe(panel, { childList: true, subtree: true });
            }
        }
        injectFlyoutNav();
    }
    watchFlyout();
    setInterval(watchFlyout, 5000);
}
function setActiveNav() {
    const dss = document.getElementById('nav-dss-scripts');
    if (!dss) return;

    const isOnDSS = window.location.hash.startsWith('#/dss/');
    dss.classList.toggle('dss-active', isOnDSS);

    if (isOnDSS) {
        const strip = () => {
            const cityNav = document.getElementById('nav-city');
            if (cityNav) {
                [...cityNav.classList].forEach(c => { if (c.includes('active')) cityNav.classList.remove(c); });
                cityNav.querySelectorAll('*').forEach(child => {
                    [...child.classList].forEach(c => { if (c.includes('active')) child.classList.remove(c); });
                });
            }
        };
        strip();
        setTimeout(strip, 200);
        setTimeout(strip, 500);
    }
}
export { addSidebarButton, setActiveNav };
