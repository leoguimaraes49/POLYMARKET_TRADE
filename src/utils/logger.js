import fs from 'node:fs';
import path from 'node:path';

function getLogDir() {
    const dir = "./logs";
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        // ignore
    }
    return dir;
}

export class Logger {
    constructor(serviceName) {
        this.serviceName = serviceName;
        this.logDir = getLogDir();
        this.logFile = path.join(this.logDir, `${serviceName}_${new Date().toISOString().split('T')[0]}.jsonl`);
    }

    log(level, message, meta = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            service: this.serviceName,
            level,
            message,
            ...meta
        };
        const line = JSON.stringify(entry) + "\n";

        // Console output (simplified)
        const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
        const reset = '\x1b[0m';
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        console.log(`${color}[${level}]${reset} [${this.serviceName}] ${message}${metaStr}`);

        // File output
        try {
            fs.appendFileSync(this.logFile, line);
        } catch (err) {
            console.error("Failed to write to log file:", err);
        }
    }

    info(message, meta) { this.log('INFO', message, meta); }
    warn(message, meta) { this.log('WARN', message, meta); }
    error(message, meta) { this.log('ERROR', message, meta); }
    debug(message, meta) { this.log('DEBUG', message, meta); }
}
