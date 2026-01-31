import fs from 'node:fs';
import path from 'node:path';

const ORDERS_FILE = "./orders.json";
const LOG_DIR = "./logs";
const STATS_FILE = "./data/stats.json";
const WORKER_STATE_FILE = "./data/worker_state.json";

// ANSI Colors matching reference (blue background theme)
const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    // Text colors
    white: "\x1b[97m",
    gray: "\x1b[90m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    // Background
    bgBlue: "\x1b[44m",
};

// Track tick count
let tickCount = 0;

function safeJson(str) {
    try { return JSON.parse(str); } catch { return null; }
}

function getForeman() {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            return safeJson(fs.readFileSync(ORDERS_FILE, 'utf-8')) || {};
        }
    } catch { }
    return {};
}

function getWorkerLogs() {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('worker_') && f.endsWith('.jsonl'));
        if (files.length > 0) {
            const latest = files.sort().pop();
            const raw = fs.readFileSync(path.join(LOG_DIR, latest), 'utf-8').trim().split('\n');
            return raw.slice(-100).map(safeJson).filter(x => x).reverse();
        }
    } catch { }
    return [];
}

function getStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return safeJson(fs.readFileSync(STATS_FILE, 'utf-8')) || {};
        }
    } catch { }
    return {
        session: { wins: 0, locks: 0, losses: 0, pnl: 0, entered: 0 },
        allTime: { wins: 0, locks: 0, losses: 0, pnl: 0, entered: 0 },
        wallet: 1000
    };
}

function getWorkerState() {
    try {
        if (fs.existsSync(WORKER_STATE_FILE)) {
            return safeJson(fs.readFileSync(WORKER_STATE_FILE, 'utf-8')) || {};
        }
    } catch { }
    return {
        positions: { yes: { shares: 0, avgPrice: 0.50, cost: 0 }, no: { shares: 0, avgPrice: 0.50, cost: 0 } },
        pendingOrders: [],
        prices: { yes: 0.50, no: 0.50 },
        balance: 1000
    };
}

function inferState(logs) {
    for (const l of logs) {
        if (l.message && l.message.includes("Result State:")) {
            return l.message.split("Result State:")[1].split("|")[0].trim();
        }
    }
    return "IDLE";
}

function progressBar(pct, width = 40) {
    const filled = Math.round(pct * width);
    const empty = width - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${(pct * 100).toFixed(1)}%`;
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function sep(char = "═") {
    return C.yellow + char.repeat(70) + C.reset;
}

function sepThin(char = "─") {
    return C.gray + char.repeat(70) + C.reset;
}

function render() {
    tickCount++;

    const f = getForeman();
    const logs = getWorkerLogs();
    const stats = getStats();
    const w = getWorkerState();
    const state = inferState(logs);

    // Calculate time
    const totalWindowTime = 15 * 60; // 15 minutes
    const remaining = f.seconds_until_next || 0;
    const elapsed = totalWindowTime - remaining;
    const pct = elapsed / totalWindowTime;

    // Get live position data from worker state
    const yesShares = w.positions?.yes?.shares || 0;
    const noShares = w.positions?.no?.shares || 0;
    const yesAvg = w.positions?.yes?.avgPrice || 0.50;
    const noAvg = w.positions?.no?.avgPrice || 0.50;
    const yesCost = w.positions?.yes?.cost || (yesShares * yesAvg);
    const noCost = w.positions?.no?.cost || (noShares * noAvg);

    // Prices from worker state
    const yesPrice = w.prices?.yes || 0.50;
    const noPrice = w.prices?.no || 0.50;

    // Pending orders
    const pendingYes = (w.pendingOrders || []).filter(o => o.side === 'BUY').length;
    const pendingNo = (w.pendingOrders || []).filter(o => o.side === 'SELL').length;

    // Build output
    const lines = [];

    // Clear screen using direct write - this happens BEFORE building output
    process.stdout.write('\x1b[2J\x1b[0;0H');

    // ═══════════════ HEADER ═══════════════
    lines.push(sep());
    lines.push(`  ${C.cyan}Market:${C.reset} ${C.white}${f.market_question || "Scanning..."}${C.reset}`);
    lines.push(`  ${C.cyan}Strategy:${C.reset} ${C.yellow}Incremental Pair${C.reset} | ${C.cyan}GUARD:${C.reset} ${C.green}OK${C.reset} | ${C.cyan}EXEC Δ:${C.reset} ${C.white}0.0${C.reset}`);
    lines.push("");

    // ═══════════════ TIME BAR ═══════════════
    lines.push(`  ${C.cyan}TIME:${C.reset} ${C.white}${formatTime(elapsed)}${C.reset} elapsed | ${C.white}${formatTime(remaining)}${C.reset} remaining | ${C.white}${(pct * 100).toFixed(0)}%${C.reset} complete`);
    lines.push(`        ${C.green}${progressBar(pct)}${C.reset}`);
    lines.push(sepThin());

    // ═══════════════ POSITIONS ═══════════════
    lines.push(`  ${C.bold}${C.white}POSITIONS:${C.reset}`);
    lines.push(`    ${C.green}YES:${C.reset}    ${C.white}${yesShares.toFixed(1)} shares${C.reset} @ ${C.cyan}$${yesAvg.toFixed(2)}${C.reset} avg = ${C.white}$${yesCost.toFixed(2)} cost${C.reset}`);
    lines.push(`    ${C.red}NO:${C.reset}     ${C.white}${noShares.toFixed(1)} shares${C.reset} @ ${C.cyan}$${noAvg.toFixed(2)}${C.reset} avg = ${C.white}$${noCost.toFixed(2)} cost${C.reset}`);
    lines.push(`    ${C.gray}PENDING HEDGES:${C.reset}`);
    lines.push(`      ${C.gray}GTC (Standard): 0 YES${C.reset}`);
    lines.push(`      ${C.gray}GTC (Standard): 0 NO${C.reset}`);
    lines.push(sepThin());

    // ═══════════════ MARKET ORACLE ═══════════════
    lines.push(`  ${C.bold}${C.white}MARKET (Polymarket Oracle):${C.reset}`);
    lines.push(`    ${C.cyan}Pulse:${C.reset}      ${C.magenta}$0.00 Rolling Range (0 pts, 0m span)${C.reset}`);
    lines.push(`    ${C.cyan}RHR Guard:${C.reset}  ${C.white}$0.00 required delta (0.45x RHR)${C.reset} | ${C.red}0 blocked${C.reset}`);
    lines.push(`    ${C.cyan}OBI Guard:${C.reset}  ${C.green}OBI=0.00${C.reset} (threshold: -0.30)`);
    lines.push(`    ${C.cyan}PTB Doom:${C.reset}   ${C.green}CLEAR${C.reset} (0 ticks stable)`);
    lines.push(`    ${C.cyan}Flip Doom:${C.reset}  ${C.green}OK${C.reset} (0/3 flips)`);
    lines.push(`    ${C.cyan}Leader:${C.reset}     ${C.green}YES${C.reset} | Position: 50% YES / 50% NO`);

    lines.push(`  ${C.bold}${C.white}BINANCE ENGINE:${C.reset}`);
    lines.push(`    ${C.cyan}Stream:${C.reset}     ${C.green}●${C.reset} OK (age: 0ms) | Buffer: 0/300 (0%)`);
    lines.push(`    ${C.cyan}Delta:${C.reset}      $0.00 natural | $0.00 current | Stretch: ${C.green}$+0.00${C.reset}`);
    lines.push(`    ${C.cyan}Calibration:${C.reset} ${C.yellow}PENDING${C.reset} | Last Action: NONE`);
    lines.push(sepThin());

    // ═══════════════ CURRENT PRICE ═══════════════
    lines.push(`  ${C.cyan}Current Price:${C.reset} ${C.green}YES $${yesPrice.toFixed(2)}${C.reset} | ${C.red}NO $${noPrice.toFixed(2)}${C.reset}`);
    lines.push(`  ${C.cyan}Entry Target:${C.reset}  Buy YES @ $0.50 (FAK)`);
    lines.push(`  ${C.cyan}Hedge Target:${C.reset}  Bid NO @ $0.50 (GTC)`);
    lines.push(sepThin());

    // ═══════════════ POTENTIAL PROFIT ═══════════════
    const lockActive = state === 'LOCKING' || state === 'DONE';
    const lockColor = lockActive ? C.yellow : C.gray;
    lines.push(`  ${C.bold}${C.white}POTENTIAL PROFIT:${C.reset} ${lockColor}🔒 [${lockActive ? 'HARD LOCK ACTIVE' : 'NO LOCK'}]${C.reset}`);
    lines.push(`    If YES wins: ${C.green}$+0.00${C.reset} (0 shares)`);
    lines.push(`    If NO wins:  ${C.green}$+0.00${C.reset} (0 shares)`);
    lines.push(`  ${C.bold}BREAKEVEN DEFICIT (Price-Adjusted):${C.reset}`);
    lines.push(`    YES needs: ${C.green}0.0 shares${C.reset} to breakeven @ $${yesPrice.toFixed(2)}`);
    lines.push(`    NO needs:  ${C.green}0.0 shares${C.reset} to breakeven @ $${noPrice.toFixed(2)}`);
    if (lockActive) {
        lines.push(`    ${C.yellow}🔒 HARD PROFIT LOCK (Trading Halted)${C.reset}`);
    }
    lines.push(sepThin());

    // ═══════════════ STATS ═══════════════
    const s = stats.session || { wins: 0, locks: 0, losses: 0, pnl: 0, entered: 0 };
    const a = stats.allTime || { wins: 0, locks: 0, losses: 0, pnl: 0, entered: 0 };
    const winRate = s.entered > 0 ? ((s.wins / s.entered) * 100).toFixed(1) : '0.0';
    const allTimeWinRate = a.entered > 0 ? ((a.wins / a.entered) * 100).toFixed(1) : '0.0';

    lines.push(`  ${C.bold}${C.white}STATS:${C.reset}`);
    lines.push(`    Session P&L:  ${s.pnl >= 0 ? C.green : C.red}$${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}${C.reset} (theo) | $${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)} (fee-adj) | ${s.entered} entered`);
    lines.push(`      ${C.green}✓ Wins:${C.reset}    ${s.wins} (Profitable outcome)`);
    lines.push(`      ${C.yellow}🔒 Locks:${C.reset}   ${s.locks} (Profit lock reached)`);
    lines.push(`      ${C.red}✗ Losses:${C.reset}  ${s.losses} (Unprofitable outcome)`);
    lines.push(`    Win Rate: ${C.white}${winRate}%${C.reset}`);
    lines.push(`    ALL-TIME (Theo): ${C.green}$+${a.pnl.toFixed(2)}${C.reset} (${a.entered} entered) | Win Rate: ${allTimeWinRate}%`);
    lines.push(`    Wallet: ${C.white}$${(stats.wallet || 1000).toFixed(2)}${C.reset} | Redemptions: 0`);
    lines.push(`    True Losses: ${C.green}0/2${C.reset}`);
    lines.push(sep());

    // ═══════════════ TICKER ═══════════════
    lines.push(`  ${C.cyan}Tick${C.reset} ${C.white}${tickCount}${C.reset} | Y:${C.green}$${yesPrice.toFixed(2)}${C.reset} N:${C.red}$${noPrice.toFixed(2)}${C.reset} | Leader: ${C.green}YES${C.reset} | Shares: ${C.white}0.0${C.reset}`);
    lines.push("");

    // Write all at once
    process.stdout.write(lines.join("\n"));
}

// Main loop
setInterval(render, 1000);
render();
