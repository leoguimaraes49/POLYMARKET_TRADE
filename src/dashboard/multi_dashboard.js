/**
 * Multi-Asset Dashboard
 * Displays status for BTC, SOL, XRP trading
 */
import fs from 'node:fs';

const ORDERS_FILE = "./orders_multi.json";
const STATE_FILE = "./data/multi_worker_state.json";

// ANSI Colors
const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
    magenta: "\x1b[35m"
};

let tickCount = 0;

function safeJson(str) {
    try { return JSON.parse(str); } catch { return null; }
}

function getOrders() {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            return safeJson(fs.readFileSync(ORDERS_FILE, 'utf-8')) || {};
        }
    } catch { }
    return {};
}

function getState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return safeJson(fs.readFileSync(STATE_FILE, 'utf-8')) || {};
        }
    } catch { }
    return {};
}

function progressBar(pct, width = 40) {
    const filled = Math.round(pct * width);
    const empty = width - filled;
    return `[${C.green}${"█".repeat(filled)}${C.gray}${"░".repeat(empty)}${C.reset}] ${(pct * 100).toFixed(1)}%`;
}

function formatMoney(n) {
    const sign = n >= 0 ? '+' : '';
    return `$${sign}${n.toFixed(2)}`;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function computeWindowTiming(window) {
    const startMs = window?.start ? new Date(window.start).getTime() : null;
    const endMs = window?.end ? new Date(window.end).getTime() : null;
    const now = Date.now();

    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        const totalMs = endMs - startMs;
        const remainingSec = Math.max(0, Math.floor((endMs - now) / 1000));
        const progress = clamp((now - startMs) / totalMs, 0, 1);
        return { remainingSec, progress };
    }

    const remainingSec = Number.isFinite(window?.remaining_sec) ? window.remaining_sec : 0;
    const progress = Number.isFinite(window?.progress) ? clamp(window.progress, 0, 1) : 0;
    return { remainingSec, progress };
}

function render() {
    tickCount++;

    const orders = getOrders();
    const state = getState();

    const window = orders.window || {};
    const assets = orders.assets || {};
    const positions = state.positions?.byAsset || {};
    const total = state.positions?.total || { shares: 0, cost: 0, avgPrice: 0.50 };
    const balance = state.balance || 1000;

    // Calculate time
    const timing = computeWindowTiming(window);
    const remainingSec = timing.remainingSec;
    const progress = timing.progress;
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;

    // Clear screen
    process.stdout.write('\x1b[2J\x1b[0;0H');

    const lines = [];

    // Header
    lines.push(`${C.yellow}${"═".repeat(70)}${C.reset}`);
    lines.push(`${C.bold}${C.cyan}  POLYMARKET MULTI-ASSET BOT${C.reset} | BTC • SOL • XRP | Shadow Mode`);
    lines.push(`${C.yellow}${"═".repeat(70)}${C.reset}`);

    // Time bar
    lines.push('');
    lines.push(`  ${C.bold}TIME:${C.reset} ${mins}m ${secs}s remaining | ${progressBar(progress)}`);

    // Assets section
    lines.push('');
    lines.push(`${C.gray}${"─".repeat(70)}${C.reset}`);
    lines.push(`  ${C.bold}ACTIVE MARKETS:${C.reset}`);

    for (const [asset, info] of Object.entries(assets)) {
        const pos = positions[asset] || { yes: { size: 0, cost: 0 }, no: { size: 0, cost: 0 } };
        const yesShares = pos.yes?.size || 0;
        const yesCost = pos.yes?.cost || 0;

        lines.push(`    ${C.bold}${asset}${C.reset}: ${yesShares.toFixed(1)} shares | Cost: $${yesCost.toFixed(2)}`);
    }

    // Totals
    lines.push('');
    lines.push(`${C.gray}${"─".repeat(70)}${C.reset}`);
    lines.push(`  ${C.bold}PORTFOLIO:${C.reset}`);
    lines.push(`    Total Shares: ${C.cyan}${total.shares.toFixed(1)}${C.reset}`);
    lines.push(`    Total Cost:   ${C.yellow}$${total.cost.toFixed(2)}${C.reset}`);
    lines.push(`    Avg Price:    $${total.avgPrice.toFixed(2)}`);
    lines.push(`    Balance:      ${C.green}$${balance.toFixed(2)}${C.reset}`);

    // Pending orders
    const pendingCount = state.pendingOrders || 0;
    lines.push(`    Pending GTC:  ${pendingCount} orders`);

    // P&L Calculation
    const currentValue = total.shares * 1.00; // If YES wins, each share = $1
    const pnlIfWin = currentValue - total.cost;
    const pnlIfLose = 0 - total.cost;

    lines.push('');
    lines.push(`${C.gray}${"─".repeat(70)}${C.reset}`);
    lines.push(`  ${C.bold}POTENTIAL P&L:${C.reset}`);
    lines.push(`    If WIN:  ${pnlIfWin >= 0 ? C.green : C.red}${formatMoney(pnlIfWin)}${C.reset} (${total.shares.toFixed(1)} shares @ $1.00)`);
    lines.push(`    If LOSE: ${C.red}${formatMoney(pnlIfLose)}${C.reset}`);

    // Footer
    lines.push('');
    lines.push(`${C.yellow}${"═".repeat(70)}${C.reset}`);
    lines.push(`  Tick ${tickCount} | Assets: ${Object.keys(assets).length} | Updated: ${new Date().toLocaleTimeString()}`);
    lines.push(`${C.yellow}${"═".repeat(70)}${C.reset}`);

    console.log(lines.join('\n'));
}

// Run
console.log('Starting Multi-Asset Dashboard...');
setInterval(render, 1000);
render();
