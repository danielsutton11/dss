import { registerModule } from '../../core/registry.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Hospital Revivable Filter
// ════════════════════════════════════════════════════════════════════════
registerModule('hospital-revive-filter', {
name: 'Hospital Revive Filter',
version: '1.0',
description: 'Filters hospital rows by revivable status, online status, time remaining, and level.',
pages: ['/hospitalview.php'],
guide,
init() {
    const MODULE_ID = 'hospital-revive-filter';

    const state = {
        revivableOnly: true,
        statusFilters: { Online: true, Idle: true, Offline: true },
        maxTime: 100,
        maxLevel: 100,
    };

    // ── Helpers ──────────────────────────────────────────────────────

    function getRowStatus(li) {
        const anchor = li.querySelector('ul#iconTray a[aria-label]');
        return anchor ? anchor.getAttribute('aria-label') : null;
    }

    function getRowTime(li) {
        const full = li.querySelector('span.time') ? li.querySelector('span.time').textContent : '';
        const hMatch = full.match(/(\d+)h/);
        const mMatch = full.match(/(\d+)m/);
        const hours = (hMatch ? parseInt(hMatch[1]) : 0) + (mMatch ? parseInt(mMatch[1]) / 60 : 0);
        return hours;
    }

    function getRowLevel(li) {
        const levelEl = li.querySelector('span.level');
        if (!levelEl) return null;
        const match = levelEl.textContent.match(/\d+/);
        return match ? parseInt(match[0]) : null;
    }

    // ── Filter logic ─────────────────────────────────────────────────

    function applyFilters() {
        const rows = document.querySelectorAll('ul.user-info-list-wrap.revive li');
        rows.forEach(li => {
            const reviveLink = li.querySelector('a.revive');
            if (!reviveLink) return;

            if (state.revivableOnly && reviveLink.classList.contains('reviveNotAvailable')) {
                li.style.display = 'none';
                return;
            }

            const status = getRowStatus(li);
            if (status && !state.statusFilters[status]) {
                li.style.display = 'none';
                return;
            }

            const time = getRowTime(li);
            if (time !== null && time > state.maxTime) {
                li.style.display = 'none';
                return;
            }

            const level = getRowLevel(li);
            if (level !== null && level > state.maxLevel) {
                li.style.display = 'none';
                return;
            }

            li.style.display = '';
        });
    }

    // ── Bar ──────────────────────────────────────────────────────────

    function addControlBar(tries = 0) {
        const titleBar = document.querySelector('.users-list-title.revive');
        if (!titleBar) {
            if (tries < 100) setTimeout(() => addControlBar(tries + 1), 300);
            return;
        }
        if (document.getElementById(`${MODULE_ID}-bar`)) return;

        const style = document.createElement('style');
        style.textContent = `
                #${MODULE_ID}-bar {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 6px 10px;
                    padding: 6px 10px;
                    margin-bottom: 2px;
                    background: rgba(0,0,0,0.35);
                    border-radius: 4px 4px 0 0;
                    font-size: 11px;
                    box-sizing: border-box;
                    width: 100%;
                }
                @media (min-width: 768px) {
                    #${MODULE_ID}-bar {
                        flex-wrap: nowrap;
                        gap: 10px;
                        padding: 6px 14px;
                    }
                }
                #${MODULE_ID}-bar .hrf-section {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                #${MODULE_ID}-bar .hrf-label {
                    color: #888;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                }
                #${MODULE_ID}-bar .hrf-divider {
                    width: 1px;
                    height: 20px;
                    background: #333;
                    flex-shrink: 0;
                }
                .hrf-toggle-btn {
                    padding: 3px 10px;
                    font-size: 11px;
                    cursor: pointer;
                    border-radius: 3px;
                    border: 1px solid #3a3;
                    background: rgba(0,180,0,0.15);
                    color: #7d7;
                    white-space: nowrap;
                    transition: background 0.2s, color 0.2s, border-color 0.2s;
                }
                .hrf-toggle-btn.off {
                    border-color: #a33;
                    background: rgba(180,0,0,0.15);
                    color: #d77;
                }
                .hrf-status-label {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    cursor: pointer;
                    font-size: 11px;
                    user-select: none;
                }
                .hrf-status-label input { margin: 0; cursor: pointer; }
                .hrf-slider-wrap {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .hrf-slider {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 80px;
                    height: 4px;
                    border-radius: 2px;
                    background: #333;
                    outline: none;
                    cursor: pointer;
                }
                @media (min-width: 768px) {
                    .hrf-slider {
                        width: 110px;
                    }
                }
                .hrf-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 13px;
                    height: 13px;
                    border-radius: 50%;
                    background: #5a5;
                    cursor: pointer;
                    border: 1px solid #3a3;
                }
                .hrf-slider::-moz-range-thumb {
                    width: 13px;
                    height: 13px;
                    border-radius: 50%;
                    background: #5a5;
                    cursor: pointer;
                    border: 1px solid #3a3;
                }
                .hrf-slider-val {
                    color: #7d7;
                    font-size: 11px;
                    min-width: 24px;
                    text-align: left;
                }
            `;
        document.head.appendChild(style);

        const bar = document.createElement('div');
        bar.id = `${MODULE_ID}-bar`;

        // ── Section: Revivable toggle ────────────────────────────────
        const revSection = document.createElement('div');
        revSection.className = 'hrf-section';

        const revBtn = document.createElement('button');
        revBtn.className = 'hrf-toggle-btn';
        revBtn.textContent = 'Revivable Only: ON';
        revBtn.addEventListener('click', () => {
            state.revivableOnly = !state.revivableOnly;
            revBtn.textContent = `Revivable Only: ${state.revivableOnly ? 'ON' : 'OFF'}`;
            revBtn.classList.toggle('off', !state.revivableOnly);
            applyFilters();
        });
        revSection.appendChild(revBtn);

        // ── Divider ──────────────────────────────────────────────────
        const div1 = document.createElement('div');
        div1.className = 'hrf-divider';

        // ── Section: Status ──────────────────────────────────────────
        const statusSection = document.createElement('div');
        statusSection.className = 'hrf-section';

        const statusLbl = document.createElement('span');
        statusLbl.className = 'hrf-label';
        statusLbl.textContent = 'Status:';
        statusSection.appendChild(statusLbl);

        const statusColors = { Online: '#7d7', Idle: '#da7', Offline: '#aaa' };
        ['Online', 'Idle', 'Offline'].forEach(status => {
            const lbl = document.createElement('label');
            lbl.className = 'hrf-status-label';
            lbl.style.color = statusColors[status];

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.addEventListener('change', () => {
                state.statusFilters[status] = cb.checked;
                applyFilters();
            });

            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(status));
            statusSection.appendChild(lbl);
        });

        // ── Divider ──────────────────────────────────────────────────
        const div2 = document.createElement('div');
        div2.className = 'hrf-divider';

        // ── Section: Time slider ─────────────────────────────────────
        const timeSection = document.createElement('div');
        timeSection.className = 'hrf-section';

        const timeLbl = document.createElement('span');
        timeLbl.className = 'hrf-label';
        timeLbl.textContent = 'Max Time:';
        timeSection.appendChild(timeLbl);

        const timeWrap = document.createElement('div');
        timeWrap.className = 'hrf-slider-wrap';

        const timeSlider = document.createElement('input');
        timeSlider.type = 'range';
        timeSlider.className = 'hrf-slider';
        timeSlider.min = 0;
        timeSlider.max = 100;
        timeSlider.value = 100;

        const timeVal = document.createElement('span');
        timeVal.className = 'hrf-slider-val';
        timeVal.textContent = '100h';

        timeSlider.addEventListener('input', () => {
            state.maxTime = parseInt(timeSlider.value);
            timeVal.textContent = `${state.maxTime}h`;
            applyFilters();
        });

        timeWrap.appendChild(timeSlider);
        timeWrap.appendChild(timeVal);
        timeSection.appendChild(timeWrap);

        // ── Divider ──────────────────────────────────────────────────
        const div3 = document.createElement('div');
        div3.className = 'hrf-divider';

        // ── Section: Level slider ────────────────────────────────────
        const levelSection = document.createElement('div');
        levelSection.className = 'hrf-section';

        const levelLbl = document.createElement('span');
        levelLbl.className = 'hrf-label';
        levelLbl.textContent = 'Max Level:';
        levelSection.appendChild(levelLbl);

        const levelWrap = document.createElement('div');
        levelWrap.className = 'hrf-slider-wrap';

        const levelSlider = document.createElement('input');
        levelSlider.type = 'range';
        levelSlider.className = 'hrf-slider';
        levelSlider.min = 0;
        levelSlider.max = 100;
        levelSlider.value = 100;

        const levelVal = document.createElement('span');
        levelVal.className = 'hrf-slider-val';
        levelVal.textContent = '100';

        levelSlider.addEventListener('input', () => {
            state.maxLevel = parseInt(levelSlider.value);
            levelVal.textContent = `${state.maxLevel}`;
            applyFilters();
        });

        levelWrap.appendChild(levelSlider);
        levelWrap.appendChild(levelVal);
        levelSection.appendChild(levelWrap);

        // ── Wrap time + level on same row ─────────────────────────────
        const slidersRow = document.createElement('div');
        slidersRow.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: nowrap;
            `;
        slidersRow.appendChild(timeSection);
        slidersRow.appendChild(div3);
        slidersRow.appendChild(levelSection);

        // ── Assemble ─────────────────────────────────────────────────
        bar.appendChild(revSection);
        bar.appendChild(div1);
        bar.appendChild(statusSection);
        bar.appendChild(div2);
        bar.appendChild(slidersRow);

        titleBar.parentElement.insertBefore(bar, titleBar);
    }

    function waitForList(tries = 0) {
        const list = document.querySelector('ul.user-info-list-wrap.revive');
        if (!list) {
            if (tries < 60) setTimeout(() => waitForList(tries + 1), 500);
            return;
        }

        applyFilters();
        addControlBar();

        const observer = new MutationObserver(() => {
            applyFilters();
            addControlBar();
        });

        observer.observe(list, { childList: true, subtree: false });
    }

    waitForList();
}
});
