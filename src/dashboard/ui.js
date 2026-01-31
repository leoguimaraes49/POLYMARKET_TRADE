import readline from "node:readline";

export const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[97m",
    gray: "\x1b[90m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
};

export function screenWidth() {
    const w = Number(process.stdout?.columns);
    return Number.isFinite(w) && w >= 40 ? w : 80;
}

export function sepLine(ch = "─") {
    const w = screenWidth();
    return `${ANSI.gray}${ch.repeat(w)}${ANSI.reset}`;
}

export function center(text, width = screenWidth()) {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, "").length;
    if (visible >= width) return text;
    const left = Math.floor((width - visible) / 2);
    return " ".repeat(left) + text;
}

export function renderScreen(lines) {
    // Clear screen command for Windows/Unix
    // \x1b[2J clears screen, \x1b[0f moves cursor to top-left
    process.stdout.write('\x1b[2J\x1b[0f');
    process.stdout.write(lines.join("\n"));
}

export function box(title, contentLines, color = ANSI.white) {
    const w = screenWidth();
    const innerW = w - 4;
    const top = `${color}┌─ ${title} ${"─".repeat(Math.max(0, w - title.length - 5))}┐${ANSI.reset}`;
    const bottom = `${color}└${"─".repeat(w - 2)}┘${ANSI.reset}`;

    const mid = contentLines.map(line => {
        // Very naive truncation/padding for now, assuming no crazy ansi in content
        // Improve later if needed
        return `${color}│${ANSI.reset} ${line}`;
    });

    return [top, ...mid, bottom];
}

export function formatMoney(n) {
    if (n === null || n === undefined) return "-";
    return `$${Number(n).toFixed(2)}`;
}

export function formatPct(n) {
    if (n === null || n === undefined) return "-";
    return `${(Number(n) * 100).toFixed(1)}%`;
}
