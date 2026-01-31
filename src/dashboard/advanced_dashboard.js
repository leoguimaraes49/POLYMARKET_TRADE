/**
 * Advanced Dashboard
 * Displays complete trading state with guardrails, leader, OBI, lock status
 */
import fs from 'node:fs';

const STATE_FILE = "./data/advanced_worker_state.json";
const ORDERS_FILE = "./orders_multi.json";

// ANSI Colors
const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    bgBlue: "\x1b[44m",
    bgGreen: "\x1b[42m",
    bgRed: "\x1b[41m"
};

// State colors
const STATE_COLORS = {
    IDLE: C.gray,
    ARMED: C.yellow,
    ENTRY: C.cyan,
    LADDERING: C.blue,
    LOCKING: C.magenta,
    LOCKED: C.green,
    RECOVERY: C.red,
    ENDGAME: C.yellow + C.bold
};

let tick = 0;

function safeJson(path) {
    try {
        if (fs.existsSync(path)) {
            return JSON.parse(fs.readFileSync(path, 'utf-8'));
        }
    } catch { }
    return null;
}

function progressBar(pct, width = 30) {
    const filled = Math.round(pct * width);
    const empty = width - filled;
    return `${C.green}${"█".repeat(filled)}${C.gray}${"░".repeat(empty)}${C.reset}`;
}

function formatMoney(n, showSign = true) {
    const sign = showSign && n >= 0 ? '+' : '';
    const color = n >= 0 ? C.green : C.red;
    return `${color}${sign}$${n.toFixed(2)}${C.reset}`;
}

function formatState(state) {
    const color = STATE_COLORS[state] || C.white;
    return `${color}${state}${C.reset}`;
}

function render() {
    tick++;

    const state = safeJson(STATE_FILE) || {};
    const orders = safeJson(ORDERS_FILE) || {};

    const window = state.window || orders.window || {};
    const assets = state.assets || {};
    const totals = state.totals || {};
    const stats = state.stats || {};

    // Time calculation
    const progress = window.progress || 0;
    const remainingSec = window.remaining_sec || 0;
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;

    // Clear screen
    process.stdout.write('\x1b[2J\x1b[0;0H');

    const lines = [];

    // Header
    lines.push(`${C.bgBlue}${C.white}${C.bold}${"═".repeat(78)}${C.reset}`);
    lines.push(`${C.bgBlue}${C.white}${C.bold}  POLYMARKET ADVANCED BOT  │  BTC • SOL • XRP  │  Dual-Profit Lock Strategy   ${C.reset}`);
    lines.push(`${C.bgBlue}${C.white}${C.bold}${"═".repeat(78)}${C.reset}`);

    // Time Bar
    lines.push('');
    lines.push(`  ${C.bold}WINDOW:${C.reset} ${progressBar(progress)} ${(progress * 100).toFixed(1)}%  │  ${C.yellow}${mins}m ${secs}s${C.reset} remaining`);

    // Assets Section
    lines.push('');
    lines.push(`${C.gray}${"─".repeat(78)}${C.reset}`);
    lines.push(`  ${C.bold}ASSET${C.reset}      ${C.bold}STATE${C.reset}       ${C.bold}LEADER${C.reset}  ${C.bold}FLIPS${C.reset}  ${C.bold}OBI${C.reset}     ${C.bold}YES${C.reset}         ${C.bold}NO${C.reset}          ${C.bold}LOCK${C.reset}`);
    lines.push(`${C.gray}${"─".repeat(78)}${C.reset}`);

    for (const [asset, data] of Object.entries(assets)) {
        const st = formatState(data.state || 'IDLE');
        const leader = data.leader === 'YES' ? `${C.green}YES${C.reset}` : `${C.red}NO${C.reset}`;
        const flips = data.flips || 0;
        const obi = (data.obi || 0).toFixed(2);
        const obiColor = data.obi >= 0 ? C.green : C.red;
        const pos = data.position || {};
        const yesStr = `${pos.yesShares || 0}@$${(pos.yesCost || 0).toFixed(2)}`;
        const noStr = `${pos.noShares || 0}@$${(pos.noCost || 0).toFixed(2)}`;
        const locked = data.locked ? `${C.green}✓ LOCKED${C.reset}` : `${C.gray}○${C.reset}`;

        lines.push(`  ${C.bold}${asset.padEnd(8)}${C.reset}   ${st.padEnd(20)}  ${leader.padEnd(12)}  ${String(flips).padEnd(5)}  ${obiColor}${obi.padEnd(7)}${C.reset} ${yesStr.padEnd(12)} ${noStr.padEnd(12)} ${locked}`);
    }

    // Totals Section
    lines.push('');
    lines.push(`${C.gray}${"─".repeat(78)}${C.reset}`);
    lines.push(`  ${C.bold}PORTFOLIO TOTALS${C.reset}`);
    lines.push(`${C.gray}${"─".repeat(78)}${C.reset}`);

    const pnlYes = totals.pnlIfYesWins || 0;
    const pnlNo = totals.pnlIfNoWins || 0;
    const isDualLock = pnlYes > 0 && pnlNo > 0;

    lines.push(`  YES Shares: ${C.cyan}${totals.yesShares || 0}${C.reset}  │  NO Shares: ${C.cyan}${totals.noShares || 0}${C.reset}  │  Total Cost: ${C.yellow}$${(totals.totalCost || 0).toFixed(2)}${C.reset}  │  Balance: ${C.green}$${(state.balance || 0).toFixed(2)}${C.reset}`);

    // P&L Box
    lines.push('');
    const lockBg = isDualLock ? C.bgGreen : '';
    lines.push(`  ${lockBg}${C.bold}P&L IF:${C.reset}${lockBg}  YES WINS = ${formatMoney(pnlYes)}${lockBg}  │  NO WINS = ${formatMoney(pnlNo)}${C.reset}  ${isDualLock ? `  ${C.bgGreen}${C.bold} 🔒 DUAL PROFIT LOCKED! ${C.reset}` : ''}`);

    // Stats Section
    lines.push('');
    lines.push(`${C.gray}${"─".repeat(78)}${C.reset}`);
    lines.push(`  ${C.bold}SESSION STATS${C.reset}`);
    lines.push(`${C.gray}${"─".repeat(78)}${C.reset}`);

    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const total = wins + losses + (stats.breakeven || 0);
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';
    const sessionPnl = stats.totalPnl || 0;

    lines.push(`  Wins: ${C.green}${wins}${C.reset}  │  Losses: ${C.red}${losses}${C.reset}  │  Win Rate: ${C.cyan}${winRate}%${C.reset}  │  Session P&L: ${formatMoney(sessionPnl)}`);

    // Footer
    lines.push('');
    lines.push(`${C.bgBlue}${C.white}${"═".repeat(78)}${C.reset}`);
    lines.push(`${C.gray}  Tick ${tick}  │  Assets: ${Object.keys(assets).length}  │  Orders: ${state.pendingOrders || 0}  │  Updated: ${new Date().toLocaleTimeString()}${C.reset}`);
    lines.push(`${C.bgBlue}${C.white}${"═".repeat(78)}${C.reset}`);

    console.log(lines.join('\n'));
}

// Run
console.log('Starting Advanced Dashboard...');
setInterval(render, 1000);
render();
