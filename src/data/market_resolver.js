import { CONFIG } from "../config.js";
import { fetchMarketBySlug, fetchLiveEventsBySeriesId, flattenEventMarkets, pickLatestLiveMarket } from "./polymarket.js";

const marketCache = {
    market: null,
    fetchedAtMs: 0
};

const WINDOW_TOLERANCE_MS = 90_000;

function getWindowBoundsMs(now = Date.now()) {
    const windowMs = 15 * 60 * 1000;
    const startMs = Math.floor(now / windowMs) * windowMs;
    const endMs = startMs + windowMs;
    return { startMs, endMs };
}

export async function resolveCurrentBtc15mMarket() {
    // 1. If explicit slug provided, use it
    if (CONFIG.polymarket.marketSlug) {
        return await fetchMarketBySlug(CONFIG.polymarket.marketSlug);
    }

    // 2. If auto-select is disabled, return null (or handle otherwise)
    if (!CONFIG.polymarket.autoSelectLatest) return null;

    const now = Date.now();
    // Cache for a short period to avoid spamming API if called frequently
    if (marketCache.market && now - marketCache.fetchedAtMs < CONFIG.pollIntervalMs) {
        return marketCache.market;
    }

    // 3. Fetch latest live markets
    try {
        const events = await fetchLiveEventsBySeriesId({ seriesId: CONFIG.polymarket.seriesId, limit: 25 });
        const markets = flattenEventMarkets(events);

        // Logic to pick the *correct* market for the current/next window
        // The existing `pickLatestLiveMarket` does a good job, but we might want to ensure 
        // we lock onto the one that matches our current "Trading Window".

        const picked = pickLatestLiveMarket(markets);

        const { endMs } = getWindowBoundsMs();
        const matched = markets.find((m) => {
            const mEnd = m?.endDate ? new Date(m.endDate).getTime() : null;
            if (!mEnd) return false;
            return Math.abs(mEnd - endMs) <= WINDOW_TOLERANCE_MS;
        });

        const choice = matched || picked;

        if (choice) {
            marketCache.market = choice;
            marketCache.fetchedAtMs = now;
        }
        return choice;
    } catch (err) {
        console.error("Error resolving market:", err);
        return null;
    }
}

export function getWindowId(date = new Date()) {
    // Return a string identifier for the 15m window, e.g., "YYYY-MM-DDTHH:00" or "HH:15"
    // We want the *start* of the 15m window.
    const ms = date.getTime();
    const windowMs = 15 * 60 * 1000;
    const windowStart = Math.floor(ms / windowMs) * windowMs;
    const d = new Date(windowStart);

    // Format: HH:MM
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

export function getSecondsUntilNextWindow() {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const nextWindowStart = Math.ceil(now / windowMs) * windowMs;
    return Math.floor((nextWindowStart - now) / 1000);
}
