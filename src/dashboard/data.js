import fs from 'node:fs';
import path from 'node:path';

const ORDERS_FILE = "./orders.json";
const LOG_DIR = "./logs";

function safeJson(str) {
    try { return JSON.parse(str); } catch { return null; }
}

export function getState() {
    // 1. Read Orders (Foreman State)
    let foreman = {};
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            foreman = safeJson(fs.readFileSync(ORDERS_FILE, 'utf-8')) || {};
        }
    } catch { }

    // 2. Read latest worker logs for activity and positions
    let workerLog = [];
    let positions = {};
    let lastWorkerState = "UNKNOWN";

    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('worker_') && f.endsWith('.jsonl'));
        if (files.length > 0) {
            const latest = files.sort().pop();
            const raw = fs.readFileSync(path.join(LOG_DIR, latest), 'utf-8').trim().split('\n');
            const lines = raw.slice(-50).map(safeJson).filter(x => x); // Last 50 lines

            workerLog = lines.reverse(); // Newest first

            // Infer state from logs (naive)
            for (const l of lines) {
                if (l.message && l.message.includes("Result State:")) {
                    lastWorkerState = l.message.split("Result State:")[1].split("|")[0].trim();
                }
            }
        }
    } catch { }

    // 3. Read shadow exchange for PnL/Positions (if we can find the file)
    let balance = 1000;
    let pnl = 0;

    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('shadow-exchange_') && f.endsWith('.jsonl'));
        if (files.length > 0) {
            const latest = files.sort().pop();
            const raw = fs.readFileSync(path.join(LOG_DIR, latest), 'utf-8').trim().split('\n');
            const lines = raw.map(safeJson).filter(x => x);

            // Extract Balance
            const balLog = lines.reverse().find(l => l.message && l.message.includes("Balance:"));
            if (balLog) {
                const m = balLog.message.match(/Balance:\s*([0-9.]+)/);
                if (m) balance = parseFloat(m[1]);
            }

            // Extract Positions (This requires logic that tracks fills or "Positions" log if available)
            // ShadowExchange logs fills like: "FILLED! Balance: 995.00"
            // It doesn't explicitly log positions snapshot unless we add it. 
            // Better approach: Replay fills to build state.
            // Simplified for now: Log "Filled" counts from Worker Logs if possible or just infer active trades.
            // Let's assume we read "Entry Order Result" or similar from Worker logs.
        }
    } catch { }

    return {
        foreman,
        worker: {
            state: lastWorkerState,
            logs: workerLog.slice(0, 8)
        },
        portfolio: {
            balance,
            pnl: balance - 1000 // Assumes starting 1000
        }
    };
}
