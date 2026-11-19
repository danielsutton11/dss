import { registerModule } from '../../core/registry.js';
import guide from './guide.html?raw';

// ════════════════════════════════════════════════════════════════════════
// Faction Money Payments
// ════════════════════════════════════════════════════════════════════════

registerModule('faction-money', {
name: 'Faction War Pay',
version: '1.1',
description: 'Assists with processing faction member money balance adjustments via the controls tab.',
pages: ['/factions.php'],
guide,
init() {
    let isInitialized = false;
    let container = null;
    let resultsPanel = null;
    let resultsTable = null;
    let nextPaymentButton = null;
    let undoButton = null;
    let paymentInstructions = [];
    let paymentHistory = [];
    let isUndoing = false;
    let isProcessing = false;
    let paymentButton = null;

    const paymentMessage = "PROCESS FACTION PAYMENTS";
    const nextPaymentMessage = "PROCESS NEXT PAYMENT";

    function shouldShowButton() {
        return window.location.href.includes("tab=controls");
    }

    function formatCurrency(amount) {
        const isNegative = amount < 0;
        const absAmount = Math.abs(amount);
        const formatted = '$' + absAmount.toLocaleString('en-US');
        return isNegative ? '-' + formatted : formatted;
    }

    // ── Results Panel ────────────────────────────────────────────────
    function createResultsPanel() {
        resultsPanel = document.createElement('div');
        resultsPanel.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:800px;max-height:80vh;padding:15px;background-color:#1a1a1a;border-radius:8px;border:2px solid #333;box-shadow:0 4px 20px rgba(0,0,0,0.5);z-index:10000;box-sizing:border-box;overflow-y:auto;';

        const resultsHeader = document.createElement('div');
        resultsHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid #333;flex-wrap:wrap;gap:8px;';

        const resultsTitle = document.createElement('h3');
        resultsTitle.textContent = 'Payment Results';
        resultsTitle.style.cssText = 'margin:0;font-size:16px;font-weight:bold;color:#fff;';

        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

        nextPaymentButton = document.createElement('button');
        nextPaymentButton.className = 'torn-btn';
        nextPaymentButton.textContent = 'Process Next Payment';
        nextPaymentButton.style.cssText = 'padding:8px 10px;font-size:11px;display:flex;align-items:center;white-space:nowrap;';
        nextPaymentButton.addEventListener('click', async () => {
            if (paymentInstructions.length > 0 && !isProcessing) {
                isProcessing = true;
                nextPaymentButton.disabled = true;
                try {
                    await processOneInstruction();
                } finally {
                    isProcessing = false;
                    updateModalButtons();
                }
            }
        });

        undoButton = document.createElement('button');
        undoButton.className = 'torn-btn';
        undoButton.textContent = 'Undo Next Payment';
        undoButton.disabled = true;
        undoButton.style.cssText = 'padding:8px 10px;font-size:11px;display:flex;align-items:center;white-space:nowrap;';
        undoButton.addEventListener('click', async () => {
            if (paymentHistory.length > 0 && !isProcessing && !isUndoing) {
                isUndoing = true;
                undoButton.disabled = true;
                try {
                    await undoOnePayment();
                } finally {
                    isUndoing = false;
                    updateModalButtons();
                }
            }
        });

        const closeButton = document.createElement('button');
        closeButton.className = 'torn-btn';
        closeButton.textContent = 'Close';
        closeButton.style.cssText = 'padding:8px 10px;font-size:11px;display:flex;align-items:center;white-space:nowrap;';
        closeButton.addEventListener('click', () => {
            resultsPanel.style.display = 'none';
            const backdrop = document.getElementById('faction-payment-backdrop');
            if (backdrop) backdrop.remove();

            // Reset everything to a clean idle state
            paymentInstructions = [];
            paymentHistory = [];
            isProcessing = false;
            isUndoing = false;

            paymentButton.textContent = paymentMessage;
            paymentButton.disabled = false;

            updateUndoButton();
        });

        buttonGroup.appendChild(nextPaymentButton);
        buttonGroup.appendChild(undoButton);
        buttonGroup.appendChild(closeButton);
        resultsHeader.appendChild(resultsTitle);
        resultsHeader.appendChild(buttonGroup);
        resultsPanel.appendChild(resultsHeader);

        const tableWrapper = document.createElement('div');
        tableWrapper.style.cssText = 'max-height:calc(80vh - 100px);overflow-y:auto;overflow-x:auto;';

        resultsTable = document.createElement('table');
        resultsTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;color:#ccc;';
        resultsTable.innerHTML = `
                <thead>
                    <tr style="background-color:#2a2a2a;position:sticky;top:0;">
                        <th style="padding:6px 4px;text-align:center;width:36px;border-bottom:2px solid #333;font-size:10px;">Status</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">Player</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">Previous</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">Change</th>
                        <th style="padding:6px 4px;text-align:center;border-bottom:2px solid #333;font-size:10px;">New</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;

        tableWrapper.appendChild(resultsTable);
        resultsPanel.appendChild(tableWrapper);
        document.body.appendChild(resultsPanel);
    }

    function showResultsPanel() {
        let backdrop = document.getElementById('faction-payment-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'faction-payment-backdrop';
            backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.7);z-index:9999;';
            document.body.appendChild(backdrop);
        }
        resultsPanel.style.display = 'block';
        updateModalButtons();
    }

    function addResultRow(playerName, playerId, previousBalance, change, newBalance, isError, errorMsg) {
        showResultsPanel();
        const tbody = resultsTable.querySelector('tbody');
        const row = document.createElement('tr');
        row.style.cssText = 'border-bottom:1px solid #2a2a2a;transition:background-color 0.2s;';
        row.addEventListener('mouseenter', () => { row.style.backgroundColor = '#2a2a2a'; });
        row.addEventListener('mouseleave', () => { row.style.backgroundColor = 'transparent'; });

        const iconCell = document.createElement('td');
        iconCell.style.cssText = 'padding:6px 4px;text-align:center;font-size:14px;';
        iconCell.innerHTML = isError ? '\u274C' : '\u2705';

        const nameCell = document.createElement('td');
        nameCell.style.cssText = 'padding:6px 4px;color:#fff;text-align:center;font-size:11px;word-break:break-all;';
        nameCell.textContent = playerName || `ID: ${playerId}`;

        const prevCell = document.createElement('td');
        prevCell.style.cssText = 'padding:6px 4px;text-align:center;font-family:monospace;color:#aaa;font-size:10px;';
        prevCell.textContent = formatCurrency(previousBalance);

        const changeCell = document.createElement('td');
        const changeColor = isError ? '#ff4444' : (change >= 0 ? '#4CAF50' : '#ff4444');
        changeCell.style.cssText = `padding:6px 4px;text-align:center;font-family:monospace;color:${changeColor};font-weight:bold;font-size:10px;`;
        changeCell.textContent = (change >= 0 ? '+' : '') + formatCurrency(change);

        const newCell = document.createElement('td');
        newCell.style.cssText = 'padding:6px 4px;text-align:center;font-family:monospace;color:#fff;font-weight:bold;font-size:10px;';
        newCell.textContent = formatCurrency(newBalance);

        row.appendChild(iconCell);
        row.appendChild(nameCell);
        row.appendChild(prevCell);
        row.appendChild(changeCell);
        row.appendChild(newCell);
        tbody.appendChild(row);

        if (errorMsg) {
            const errorRow = document.createElement('tr');
            errorRow.style.cssText = 'background-color:rgba(255,68,68,0.1);';
            const errorCell = document.createElement('td');
            errorCell.colSpan = 5;
            errorCell.style.cssText = 'padding:8px 10px;font-size:12px;color:#ff4444;border-bottom:1px solid #2a2a2a;';
            errorCell.innerHTML = `\u26A0\uFE0F ${errorMsg}`;
            errorRow.appendChild(errorCell);
            tbody.appendChild(errorRow);
        }
    }

    // ── Button State ─────────────────────────────────────────────────
    function updateUndoButton() {
        if (paymentHistory.length > 0 && !isProcessing && !isUndoing) {
            undoButton.disabled = false;
            undoButton.textContent = `Undo Next Payment (${paymentHistory.length} to undo)`;
        } else if (isUndoing) {
            undoButton.disabled = true;
            undoButton.textContent = 'Undoing...';
        } else {
            undoButton.disabled = true;
            undoButton.textContent = 'Undo Next Payment';
        }
    }

    function updateModalButtons() {
        if (isProcessing) {
            nextPaymentButton.disabled = true;
            nextPaymentButton.textContent = 'Processing...';
        } else if (paymentInstructions.length > 0) {
            nextPaymentButton.disabled = false;
            nextPaymentButton.textContent = `Process Next Payment (${paymentInstructions.length} remaining)`;
        } else {
            nextPaymentButton.disabled = true;
            nextPaymentButton.textContent = 'No More Payments';
        }
        updateUndoButton();
    }

    function updateButtonText() {
        if (paymentInstructions.length === 0) {
            paymentButton.textContent = paymentMessage;
            paymentButton.disabled = isUndoing;
        } else {
            paymentButton.textContent = `${nextPaymentMessage} (${paymentInstructions.length} remaining)`;
        }
    }



    // ── Payment Logic ────────────────────────────────────────────────
    async function processOneInstruction() {

        const getAction = (typeof unsafeWindow !== 'undefined' && unsafeWindow.getAction) || window.getAction;

        if (typeof getAction !== 'function') {
            addResultRow(null, null, 0, 0, 0, true,
                         "Torn's internal API (getAction) not found — this feature may need updating");
            updateButtonText(); updateModalButtons();
            return;
        }

        const instruction = paymentInstructions.shift();
        const player_id = instruction[0];
        const amount = instruction[1];

        let existing_money_str = null;
        let player_name = null;

        document.querySelectorAll('[class*="listItem___"]').forEach(function (item) {
            const userLink = item.querySelector("a[href*='/profiles.php?XID=']");
            if (!userLink) return;
            const href = userLink.getAttribute("href");
            const match = href.match(/XID=(\d+)/);
            if (!(match && match[1] === String(player_id))) return;

            const balanceWrap = item.querySelector('[class*="editBalanceWrap___"][class*="canEdit___"]');
            if (!balanceWrap) return;

            // Read the displayed balance: clone, strip inputs/button/hidden span, take text.
            const clone = balanceWrap.cloneNode(true);
            clone.querySelectorAll('input, button, .hidden, [class*="hidden"]').forEach(el => el.remove());
            const displayed = clone.textContent.trim();

            // The controls tab renders each player in both a money list and a points list.
            // The money row is currency-formatted with a "$"; the points row is a bare number.
            // Only accept the money row.
            if (!displayed.includes('$')) return;

            // Prefer the mirrored hidden input (exact integer), fall back to displayed text.
            const hiddenInput = balanceWrap.querySelector('input[type="hidden"]');
            existing_money_str = (hiddenInput && hiddenInput.value.trim() !== '')
                ? hiddenInput.value
                : displayed;

            const honorText = item.querySelector('.honor-text');
            if (honorText) {
                const chars = honorText.querySelectorAll('[data-char]');
                player_name = chars.length > 0
                    ? Array.from(chars).map(c => c.getAttribute('data-char')).join('')
                : honorText.textContent.trim();
            }
        });

        // Strip currency symbol, commas, whitespace — keep digits and a leading minus
        const cleaned = (existing_money_str || '').replace(/[^\d-]/g, '');
        const existing_money = parseInt(cleaned, 10);

        if (!Number.isFinite(existing_money)) {
            addResultRow(player_name, player_id, 0, 0, 0, true,
                         `Failed to read balance (got "${existing_money_str}")`);
            updateButtonText(); updateModalButtons();
            return;
        }

        const final_money = existing_money + amount;
        if (!Number.isFinite(final_money)) {
            addResultRow(player_name, player_id, existing_money, amount, 0, true,
                         "Computed balance is not a valid number");
            updateButtonText(); updateModalButtons();
            return;
        }

        try {
            const response = await new Promise((resolve, reject) => {
                getAction({
                    type: 'post',
                    action: 'page.php?sid=factionsEditMoneyBalance',
                    data: { depositor: player_id, balance: final_money },
                    success: (str) => resolve(str),
                    error: (error) => reject(error)
                });
            });

            let msg;
            if (typeof response === 'string') {
                try { msg = JSON.parse(response); }
                catch (e) {
                    addResultRow(player_name, player_id, existing_money, amount, final_money, true, "Error parsing server response: " + e.message);
                    updateButtonText(); updateModalButtons();
                    return;
                }
            } else { msg = response; }

            if (msg.success === true || (msg.depositor && typeof msg.balance === 'number')) {
                paymentHistory.push({ playerName: player_name, playerId: player_id, amount, previousBalance: existing_money, newBalance: final_money });
                addResultRow(player_name, player_id, existing_money, amount, final_money, false);
            } else if (msg.error) {
                addResultRow(player_name, player_id, existing_money, amount, final_money, true, "API Error: " + msg.error);
            } else {
                paymentHistory.push({ playerName: player_name, playerId: player_id, amount, previousBalance: existing_money, newBalance: final_money });
                addResultRow(player_name, player_id, existing_money, amount, final_money, false);
            }
        } catch (e) {
            addResultRow(player_name, player_id, existing_money, amount, final_money, true, "Network error: " + e.message);
        }

        updateButtonText(); updateModalButtons();
    }


    async function undoOnePayment() {
        const getAction = (typeof unsafeWindow !== 'undefined' && unsafeWindow.getAction) || window.getAction;

        if (paymentHistory.length === 0) return;

        if (typeof getAction !== 'function') {
            addResultRow(null, null, 0, 0, 0, true,
                         "Torn's internal API (getAction) not found — this feature may need updating");
            updateButtonText(); updateModalButtons();
            return;
        }

        const lastPayment = paymentHistory.pop();

        // Add undo header if this is the first undo
        const tbody = resultsTable.querySelector('tbody');
        if (!tbody.querySelector('.undo-header-row')) {
            const headerRow = document.createElement('tr');
            headerRow.className = 'undo-header-row';
            headerRow.style.cssText = 'background-color:#2a2a2a;';
            const headerCell = document.createElement('td');
            headerCell.colSpan = 5;
            headerCell.style.cssText = 'padding:12px 10px;font-size:14px;color:#fff;font-weight:bold;text-align:center;border-top:2px solid #444;border-bottom:2px solid #444;';
            headerCell.textContent = '\u27F2 Payment Corrections';
            headerRow.appendChild(headerCell);
            tbody.appendChild(headerRow);
        }

        try {
            const response = await new Promise((resolve, reject) => {
                getAction({
                    type: 'post',
                    action: 'page.php?sid=factionsEditMoneyBalance',
                    data: { depositor: lastPayment.playerId, balance: lastPayment.previousBalance },
                    success: (str) => resolve(str),
                    error: (error) => reject(error)
                });
            });

            let msg;
            if (typeof response === 'string') {
                try { msg = JSON.parse(response); }
                catch (e) { msg = { success: response.includes('success') || response.includes('Success') }; }
            } else { msg = response; }

            if (msg.success === true || (msg.depositor && typeof msg.balance === 'number')) {
                addResultRow(lastPayment.playerName, lastPayment.playerId,
                             lastPayment.newBalance, -lastPayment.amount, lastPayment.previousBalance, false);
            } else {
                addResultRow(lastPayment.playerName, lastPayment.playerId,
                             lastPayment.newBalance, -lastPayment.amount, lastPayment.previousBalance, true, "Failed to undo payment");
                paymentHistory.push(lastPayment);
            }
        } catch (e) {
            addResultRow(lastPayment.playerName, lastPayment.playerId,
                         lastPayment.newBalance, -lastPayment.amount, lastPayment.previousBalance, true,
                         "Network error undoing payment: " + e.message);
            paymentHistory.push(lastPayment);
        }

        updateButtonText(); updateModalButtons();
    }

    async function processPaymentClick() {
        if (paymentButton.textContent === paymentMessage) {
            showInputModal();
        } else {
            if (!isProcessing) {
                isProcessing = true;
                paymentButton.disabled = true;
                try {
                    await processOneInstruction();
                } finally {
                    isProcessing = false;
                    updateButtonText();
                }
            }
        }
    }

    // ── Input Modal ──────────────────────────────────────────────────
    function showInputModal() {
        const inputModal = document.createElement('div');
        inputModal.style.cssText = 'display:block;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:600px;padding:0;background:#1a1a1a;border-radius:5px;border:1px solid #2a2a2a;box-shadow:0 10px 40px rgba(0,0,0,0.6);z-index:10000;';

        const inputHeader = document.createElement('div');
        inputHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:15px 20px;background:#222;border-bottom:1px solid #2a2a2a;border-radius:5px 5px 0 0;';
        const inputTitle = document.createElement('h3');
        inputTitle.textContent = 'Enter Payment Instructions';
        inputTitle.style.cssText = 'margin:0;font-size:16px;font-weight:bold;color:#fff;';
        inputHeader.appendChild(inputTitle);
        inputModal.appendChild(inputHeader);

        const tabContainer = document.createElement('div');
        tabContainer.style.cssText = 'display:flex;gap:0;border-bottom:1px solid #2a2a2a;background-color:#1a1a1a;';

        const textTab = document.createElement('button');
        textTab.className = 'torn-btn';
        textTab.textContent = 'Manual Entry';
        textTab.style.cssText = 'padding:12px 20px;font-size:12px;flex:1;border-radius:0;border-bottom:2px solid transparent;background-color:transparent;display:flex;align-items:center;justify-content:center;text-transform:uppercase;font-weight:normal;letter-spacing:0.5px;color:#999;';

        const fileTab = document.createElement('button');
        fileTab.className = 'torn-btn';
        fileTab.textContent = 'Upload File';
        fileTab.style.cssText = 'padding:12px 20px;font-size:12px;flex:1;border-radius:0;border-bottom:2px solid transparent;background-color:transparent;display:flex;align-items:center;justify-content:center;text-transform:uppercase;font-weight:normal;letter-spacing:0.5px;color:#999;';

        tabContainer.appendChild(textTab);
        tabContainer.appendChild(fileTab);
        inputModal.appendChild(tabContainer);

        createTextInputSection(inputModal, textTab, fileTab);
        createFileInputSection(inputModal, textTab, fileTab);

        textTab.style.borderBottom = '2px solid #7ac231';
        textTab.style.backgroundColor = 'rgba(122,194,49,0.1)';
        textTab.style.color = '#fff';

        const backdrop = document.createElement('div');
        backdrop.id = 'faction-input-backdrop';
        backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.85);z-index:9999;';

        document.body.appendChild(backdrop);
        document.body.appendChild(inputModal);
    }

    function createTextInputSection(inputModal, textTab, fileTab) {
        const textSection = document.createElement('div');
        textSection.setAttribute('data-section', 'text');
        textSection.style.cssText = 'display:block;padding:20px;';

        const instructionText = document.createElement('p');
        instructionText.style.cssText = 'color:#888;font-size:12px;margin:0 0 10px 0;';
        instructionText.textContent = 'Format: [[userID, amount], [userID, amount], ...]';

        const textarea = document.createElement('textarea');
        textarea.style.cssText = 'width:100%;height:150px;padding:10px;background-color:#0f0f0f;border:1px solid #2a2a2a;border-radius:3px;color:#ccc;font-family:"Courier New",monospace;font-size:12px;resize:vertical;margin-bottom:15px;box-sizing:border-box;';
        textarea.placeholder = '[[1561637, 1000], [2795521, 500]]';

        const textErrorMsg = document.createElement('div');
        textErrorMsg.style.cssText = 'display:none;padding:10px;margin-bottom:15px;background-color:rgba(255,68,68,0.1);border:1px solid #ff4444;border-radius:3px;color:#ff4444;font-size:12px;';

        const submitTextButton = document.createElement('button');
        submitTextButton.className = 'torn-btn ctaButton___waMIZ';
        submitTextButton.textContent = 'Process Payments';
        submitTextButton.style.cssText = 'width:100%;padding:10px;font-size:14px;display:flex;align-items:center;justify-content:center;';
        submitTextButton.disabled = true;

        const textCancelButton = document.createElement('button');
        textCancelButton.className = 'torn-btn';
        textCancelButton.textContent = 'Cancel';
        textCancelButton.style.cssText = 'padding:10px 15px;font-size:14px;display:flex;align-items:center;justify-content:center;';
        textCancelButton.addEventListener('click', () => {
            inputModal.remove();
            const bd = document.getElementById('faction-input-backdrop');
            if (bd) bd.remove();
        });

        const textButtonGroup = document.createElement('div');
        textButtonGroup.style.cssText = 'display:flex;gap:10px;';
        textButtonGroup.appendChild(submitTextButton);
        textButtonGroup.appendChild(textCancelButton);

        textarea.addEventListener('input', () => { submitTextButton.disabled = textarea.value.trim().length === 0; });

        submitTextButton.addEventListener('click', () => {
            const userInput = textarea.value.trim();
            textErrorMsg.style.display = 'none';
            if (!userInput) { textErrorMsg.textContent = '\u26A0\uFE0F Please enter payment instructions'; textErrorMsg.style.display = 'block'; return; }
            try {
                const instructions = JSON.parse(userInput);
                if (!Array.isArray(instructions)) throw new Error("Input must be an array");
                if (instructions.length < 1) { textErrorMsg.textContent = '\u26A0\uFE0F No payments to make'; textErrorMsg.style.display = 'block'; return; }
                for (let i = 0; i < instructions.length; i++) {
                    const inst = instructions[i];
                    if (!Array.isArray(inst) || inst.length !== 2) throw new Error(`Invalid instruction at index ${i}`);
                    if (typeof inst[0] !== 'number' || typeof inst[1] !== 'number') throw new Error(`Invalid types at index ${i}`);
                }
                inputModal.remove();
                const bd = document.getElementById('faction-input-backdrop');
                if (bd) bd.remove();
                const tbody = resultsTable.querySelector('tbody');
                if (tbody) tbody.innerHTML = '';
                paymentHistory = [];
                isProcessing = false;
                isUndoing = false;
                paymentInstructions = instructions;
                paymentButton.disabled = false;
                updateButtonText();
                showResultsPanel();
            } catch (e) {
                textErrorMsg.textContent = `\u26A0\uFE0F Parse error: ${e.message}`;
                textErrorMsg.style.display = 'block';
            }
        });

        textTab.addEventListener('click', () => {
            textSection.style.display = 'block';
            const fs = inputModal.querySelector('[data-section="file"]');
            if (fs) fs.style.display = 'none';
            textTab.style.borderBottom = '2px solid #7ac231'; textTab.style.backgroundColor = 'rgba(122,194,49,0.1)'; textTab.style.color = '#fff';
            fileTab.style.borderBottom = '2px solid transparent'; fileTab.style.backgroundColor = 'transparent'; fileTab.style.color = '#999';
        });

        textSection.appendChild(instructionText);
        textSection.appendChild(textarea);
        textSection.appendChild(textErrorMsg);
        textSection.appendChild(textButtonGroup);
        inputModal.appendChild(textSection);
    }

    function createFileInputSection(inputModal, textTab, fileTab) {
        const fileSection = document.createElement('div');
        fileSection.setAttribute('data-section', 'file');
        fileSection.style.cssText = 'display:none;padding:20px;';

        const fileInstructionText = document.createElement('p');
        fileInstructionText.style.cssText = 'color:#888;font-size:12px;margin:0 0 10px 0;';
        fileInstructionText.innerHTML = 'Upload a .txt or .csv file with format:<br><br><strong>userID,amount</strong> (one per line)';

        const dropZone = document.createElement('div');
        dropZone.style.cssText = 'width:100%;padding:40px;margin-bottom:15px;background-color:#0f0f0f;border:2px dashed #333;border-radius:3px;text-align:center;cursor:pointer;transition:all 0.3s ease;box-sizing:border-box;';

        const dropZoneText = document.createElement('div');
        dropZoneText.style.cssText = 'color:#888;font-size:14px;';
        dropZoneText.innerHTML = '<div style="font-size:48px;margin-bottom:10px;">\uD83D\uDCC1</div><div style="margin-bottom:5px;">Drag & drop your file here</div><div style="font-size:12px;color:#666;">or click to browse</div>';
        dropZone.appendChild(dropZoneText);

        const fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = '.txt,.csv'; fileInput.style.cssText = 'display:none;';

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = '#7ac231'; dropZone.style.backgroundColor = 'rgba(122,194,49,0.1)'; });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.style.borderColor = '#333'; dropZone.style.backgroundColor = '#0f0f0f'; });
        dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.style.borderColor = '#333'; dropZone.style.backgroundColor = '#0f0f0f'; if (e.dataTransfer.files.length > 0) { fileInput.files = e.dataTransfer.files; fileInput.dispatchEvent(new Event('change', { bubbles: true })); } });

        const filePreview = document.createElement('div');
        filePreview.style.cssText = 'max-height:120px;overflow-y:auto;padding:10px;background-color:#0f0f0f;border:1px solid #2a2a2a;border-radius:3px;margin-bottom:15px;font-family:"Courier New",monospace;font-size:12px;color:#888;display:none;';

        const submitFileButton = document.createElement('button');
        submitFileButton.className = 'torn-btn ctaButton___waMIZ';
        submitFileButton.textContent = 'Process Payments';
        submitFileButton.style.cssText = 'width:100%;padding:10px;font-size:14px;display:flex;align-items:center;justify-content:center;';
        submitFileButton.disabled = true;

        const fileCancelButton = document.createElement('button');
        fileCancelButton.className = 'torn-btn';
        fileCancelButton.textContent = 'Cancel';
        fileCancelButton.style.cssText = 'padding:10px 15px;font-size:14px;display:flex;align-items:center;justify-content:center;';
        fileCancelButton.addEventListener('click', () => {
            inputModal.remove();
            const bd = document.getElementById('faction-input-backdrop');
            if (bd) bd.remove();
        });

        const fileButtonGroup = document.createElement('div');
        fileButtonGroup.style.cssText = 'display:flex;gap:10px;';
        fileButtonGroup.appendChild(submitFileButton);
        fileButtonGroup.appendChild(fileCancelButton);

        let parsedInstructions = [];

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            dropZoneText.innerHTML = `<div style="font-size:48px;margin-bottom:10px;">\uD83D\uDCC4</div><div style="margin-bottom:5px;color:#7ac231;font-weight:bold;">${file.name}</div><div style="font-size:12px;color:#666;">Click to choose a different file</div>`;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const lines = event.target.result.split('\n').filter(line => line.trim());
                    parsedInstructions = [];
                    let previewHTML = '';
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const parts = line.split(',').map(p => p.trim());
                        if (parts.length !== 2) throw new Error(`Invalid format on line ${i + 1}`);
                        const userId = parseInt(parts[0]);
                        const amount = parseInt(parts[1]);
                        if (isNaN(userId) || isNaN(amount)) throw new Error(`Invalid numbers on line ${i + 1}`);
                        parsedInstructions.push([userId, amount]);
                        previewHTML += `<div>[${userId}, ${amount}]</div>`;
                    }
                    filePreview.innerHTML = `<strong>Parsed ${parsedInstructions.length} payments:</strong><br><br>${previewHTML}`;
                    filePreview.style.display = 'block';
                    filePreview.style.cssText = 'max-height:120px;overflow-y:auto;padding:10px;background-color:#0f0f0f;border:1px solid #2a2a2a;border-radius:3px;margin-bottom:15px;font-family:"Courier New",monospace;font-size:12px;color:#888;display:block;';
                    submitFileButton.disabled = false;
                } catch (error) {
                    filePreview.innerHTML = `\u26A0\uFE0F ${error.message}`;
                    filePreview.style.cssText = 'display:block;padding:10px;margin-bottom:15px;background-color:rgba(255,68,68,0.1);border:1px solid #ff4444;border-radius:3px;color:#ff4444;font-size:12px;';
                    submitFileButton.disabled = true;
                    parsedInstructions = [];
                }
            };
            reader.readAsText(file);
        });

        submitFileButton.addEventListener('click', () => {
            if (parsedInstructions.length < 1) { alert("No valid payments to process"); return; }
            inputModal.remove();
            const bd = document.getElementById('faction-input-backdrop');
            if (bd) bd.remove();
            const tbody = resultsTable.querySelector('tbody');
            if (tbody) tbody.innerHTML = '';
            paymentHistory = [];
            isProcessing = false;
            isUndoing = false;
            paymentInstructions = parsedInstructions;
            paymentButton.disabled = false;
            updateButtonText();
            showResultsPanel();
        });

        fileTab.addEventListener('click', () => {
            const ts = inputModal.querySelector('[data-section="text"]');
            if (ts) ts.style.display = 'none';
            fileSection.style.display = 'block';
            fileTab.style.borderBottom = '2px solid #7ac231'; fileTab.style.backgroundColor = 'rgba(122,194,49,0.1)'; fileTab.style.color = '#fff';
            textTab.style.borderBottom = '2px solid transparent'; textTab.style.backgroundColor = 'transparent'; textTab.style.color = '#999';
        });

        fileSection.appendChild(fileInstructionText);
        fileSection.appendChild(dropZone);
        fileSection.appendChild(fileInput);
        fileSection.appendChild(filePreview);
        fileSection.appendChild(fileButtonGroup);
        inputModal.appendChild(fileSection);
    }

    // ── Init / Teardown ──────────────────────────────────────────────
    function initializeButton() {
        if (isInitialized || !shouldShowButton()) return;

        // PDA cleanup: remove stale elements from previous page load
        document.querySelectorAll('.faction-payment-container').forEach(el => el.remove());

        paymentButton = document.createElement('button');
        paymentButton.type = 'button';
        paymentButton.className = "torn-btn ctaButton___waMIZ silver";
        paymentButton.textContent = paymentMessage;
        paymentButton.style.cssText = 'margin-top:10px;width:100%;';
        paymentButton.addEventListener('click', async () => { await processPaymentClick(); });

        container = document.createElement('div');
        container.className = 'faction-payment-container';
        container.style.cssText = 'width:100%;display:flex;flex-direction:column;';
        container.appendChild(paymentButton);

        createResultsPanel();

        const controlsRadioGroup = document.querySelector('[class*="controls___"]');
        if (controlsRadioGroup && controlsRadioGroup.parentElement) {
            controlsRadioGroup.parentElement.appendChild(container);
            isInitialized = true;
        }
    }

    function removeButton() {
        if (container && container.parentNode) { container.parentNode.removeChild(container); isInitialized = false; container = null; }
        if (resultsPanel && resultsPanel.parentNode) { resultsPanel.parentNode.removeChild(resultsPanel); resultsPanel = null; resultsTable = null; nextPaymentButton = null; undoButton = null; }
        const backdrop = document.getElementById('faction-payment-backdrop');
        if (backdrop) backdrop.remove();
        const inputBackdrop = document.getElementById('faction-input-backdrop');
        if (inputBackdrop) inputBackdrop.remove();
        paymentInstructions = [];
        paymentHistory = [];
    }

    function checkAndToggleButton() {
        if (shouldShowButton() && !isInitialized) initializeButton();
        else if (!shouldShowButton() && isInitialized) removeButton();
    }

    function waitForElement() {
        const controlsElement = document.querySelector('[class*="controls___"]');
        if (controlsElement) {
            checkAndToggleButton();
            let lastUrl = location.href;
            new MutationObserver(() => {
                const url = location.href;
                if (url !== lastUrl) { lastUrl = url; checkAndToggleButton(); }
            }).observe(document, { subtree: true, childList: true });
        } else {
            setTimeout(waitForElement, 100);
        }
    }

    waitForElement();
}
});
