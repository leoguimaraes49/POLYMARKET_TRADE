/**
 * Dashboard Avançado - Interface em Português
 * Mostra Score, Regime, Wind, Operações Pendentes
 */
import fs from 'node:fs';

const STATE_FILE = "./data/advanced_worker_state.json";
const ORDERS_FILE = "./orders_multi.json";
const FOREMAN_FILE = "./data/foreman_state.json";

// ANSI
const ESC = '\x1b';
const CLEAR = `${ESC}[2J`;
const HOME = `${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

const C = {
    reset: `${ESC}[0m`,
    bold: `${ESC}[1m`,
    dim: `${ESC}[2m`,
    green: `${ESC}[32m`,
    red: `${ESC}[31m`,
    yellow: `${ESC}[33m`,
    cyan: `${ESC}[36m`,
    gray: `${ESC}[90m`,
    white: `${ESC}[97m`,
    magenta: `${ESC}[35m`
};

const ESTADOS = {
    IDLE: 'PARADO', ARMED: 'ARMADO', ENTRY: 'ENTRANDO',
    LADDERING: 'ESCALONANDO', LOCKING: 'TRAVANDO',
    LOCKED: 'TRAVADO ✓', RECOVERY: 'RECUPERANDO', ENDGAME: 'FINAL'
};

const REGIMES_PT = {
    STEADY: 'ESTÁVEL', WAKING: 'DESPERTANDO',
    FADING: 'ENFRAQUECENDO', CHOPPY: 'INSTÁVEL'
};

function readJson(path) {
    try {
        if (fs.existsSync(path)) {
            return JSON.parse(fs.readFileSync(path, 'utf-8'));
        }
    } catch { }
    return null;
}

function pad(s, n) { return String(s).padEnd(n); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function money(n, sign = true) {
    if (n === undefined || n === null) return '$0.00';
    return `${sign && n >= 0 ? '+' : ''}$${n.toFixed(2)}`;
}
function progressBar(pct, w = 20) {
    const f = Math.round(pct * w);
    return '█'.repeat(f) + '░'.repeat(w - f);
}
function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

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
    const state = readJson(STATE_FILE) || {};
    const orders = readJson(ORDERS_FILE) || {};
    const foreman = readJson(FOREMAN_FILE) || {};

    const window = state.window || orders.window || {};
    const assets = state.assets || {};
    const totals = state.totals || {};
    const statsFull = state.stats || {};
    const stats = statsFull.session || statsFull || {};
    const wind = orders.wind || foreman.wind || {};
    const regimes = orders.regimes || {};
    const scores = orders.scores || {};

    const timing = computeWindowTiming(window);
    const progress = timing.progress;
    const remaining = timing.remainingSec;

    let out = HOME + '\n';

    // Cabeçalho
    out += `  ${C.cyan}${C.bold}BOT POLYMARKET${C.reset}  │  BTC • SOL • XRP  │  Shadow Mode\n`;
    out += `  ${C.gray}${'─'.repeat(65)}${C.reset}\n`;

    // Timer + Wind
    const windDesc = wind.description || 'NEUTRO';
    const windColor = windDesc.includes('ALTA') ? C.green : windDesc.includes('BAIXA') ? C.red : C.gray;
    out += `  Tempo: ${C.yellow}${formatTime(remaining)}${C.reset}  ${progressBar(progress)} ${(progress * 100).toFixed(0)}%`;
    out += `  │  Vento: ${windColor}${windDesc}${C.reset}\n\n`;

    // Ativos
    out += `  ${C.dim}ATIVO   ESTADO       SCORE  REGIME       LÍDER  OBI     POSIÇÃO${C.reset}\n`;
    out += `  ${C.gray}${'─'.repeat(65)}${C.reset}\n`;

    for (const [name, data] of Object.entries(assets)) {
        const st = ESTADOS[data.state] || data.state;
        let stColor = C.gray;
        if (data.state === 'LOCKING') stColor = C.cyan;
        else if (data.state === 'LOCKED') stColor = C.green;
        else if (data.state === 'RECOVERY') stColor = C.red;
        else if (data.state === 'ENTRY' || data.state === 'ARMED') stColor = C.yellow;

        // Score
        const scoreData = scores[name] || {};
        const score = (scoreData.score || 0).toFixed(2);
        const scoreColor = scoreData.score >= 0.55 ? C.green : scoreData.score >= 0.35 ? C.yellow : C.red;

        // Regime
        const regime = REGIMES_PT[regimes[name]] || regimes[name] || '-';
        let regColor = C.gray;
        if (regime === 'ESTÁVEL' || regime === 'DESPERTANDO') regColor = C.green;
        else if (regime === 'INSTÁVEL') regColor = C.red;

        // Leader
        const leader = data.leader || '-';
        const leaderPt = leader === 'YES' ? 'ALTA' : leader === 'NO' ? 'BAIXA' : '-';
        const leaderColor = leader === 'YES' ? C.green : leader === 'NO' ? C.red : C.gray;

        // OBI
        const obi = (data.obi || 0).toFixed(2);
        const obiColor = data.obi >= 0 ? C.green : C.red;

        // Position
        const pos = data.position || {};
        const posStr = (pos.yesShares || 0) + (pos.noShares || 0) > 0
            ? `A:${pos.yesShares || 0} B:${pos.noShares || 0}` : '-';

        out += `  ${C.white}${pad(name, 7)}${C.reset} `;
        out += `${stColor}${pad(st, 12)}${C.reset} `;
        out += `${scoreColor}${pad(score, 6)}${C.reset} `;
        out += `${regColor}${pad(regime, 12)}${C.reset} `;
        out += `${leaderColor}${pad(leaderPt, 6)}${C.reset} `;
        out += `${obiColor}${pad(obi, 7)}${C.reset} `;
        out += `${posStr}\n`;
    }

    if (Object.keys(assets).length === 0) {
        out += `  ${C.gray}Aguardando dados...${C.reset}\n`;
    }

    // Operações Pendentes
    out += `\n  ${C.gray}${'─'.repeat(65)}${C.reset}\n`;
    out += `  ${C.bold}OPERAÇÕES PENDENTES${C.reset}\n`;
    out += `  ${C.gray}${'─'.repeat(65)}${C.reset}\n`;

    let pending = 0;
    for (const [name, data] of Object.entries(assets)) {
        const pos = data.position || {};
        const total = (pos.yesShares || 0) + (pos.noShares || 0);
        if (total > 0) {
            const cost = (pos.yesCost || 0) + (pos.noCost || 0);
            out += `  ${C.yellow}●${C.reset} ${name}: ${total} shares @ $${cost.toFixed(2)} - aguardando resultado\n`;
            pending++;
        }
    }

    const gtc = state.pendingOrders || 0;
    if (gtc > 0) {
        out += `  ${C.cyan}○${C.reset} ${gtc} ordens GTC (ladder) - aguardando preenchimento\n`;
    }

    if (pending === 0 && gtc === 0) {
        out += `  ${C.gray}Nenhuma operação pendente${C.reset}\n`;
    }

    // Financeiro
    out += `\n  ${C.gray}${'─'.repeat(65)}${C.reset}\n`;
    const cost = totals.totalCost || 0;
    const pnlYes = totals.pnlIfYesWins || 0;
    const pnlNo = totals.pnlIfNoWins || 0;
    const locked = pnlYes > 0 && pnlNo > 0;
    const balance = state.balance || 100;

    out += `  Saldo: ${C.green}$${balance.toFixed(2)}${C.reset}`;
    out += `  │  Investido: ${C.yellow}$${cost.toFixed(2)}${C.reset}`;
    out += `  │  Ordens: ${gtc}\n`;

    const yC = pnlYes >= 0 ? C.green : C.red;
    const nC = pnlNo >= 0 ? C.green : C.red;
    out += `  Se ALTA: ${yC}${money(pnlYes)}${C.reset}  │  Se BAIXA: ${nC}${money(pnlNo)}${C.reset}`;
    if (locked) out += `  ${C.green}${C.bold}[TRAVADO]${C.reset}`;
    out += '\n';

    // Stats
    out += `\n  ${C.gray}${'─'.repeat(65)}${C.reset}\n`;
    const w = stats.wins || 0;
    const l = stats.losses || 0;
    const t = w + l + (stats.breakeven || 0);
    const wr = t > 0 ? ((w / t) * 100).toFixed(0) : '-';
    out += `  V:${C.green}${w}${C.reset} D:${C.red}${l}${C.reset} Taxa:${wr}% Sessão:${money(stats.totalPnl || 0)}\n`;

    const recent = Array.isArray(statsFull.recentTrades) ? statsFull.recentTrades : [];
    if (recent.length > 0) {
        const last = recent[0];
        const pnl = last?.pnl || 0;
        const pnlColor = pnl >= 0 ? C.green : C.red;
        out += `  Ultimo: ${last.asset || '-'} ${last.result || '-'} ${pnlColor}${money(pnl)}${C.reset}\n`;
    }

    out += `\n  ${C.dim}${new Date().toLocaleTimeString('pt-BR')} │ Ctrl+C sair${C.reset}\n`;
    out += `${ESC}[J`;

    process.stdout.write(out);
}

process.stdout.write(CLEAR + HIDE_CURSOR);
process.on('SIGINT', () => { process.stdout.write(SHOW_CURSOR + '\n'); process.exit(0); });
setInterval(render, 1000);
render();
