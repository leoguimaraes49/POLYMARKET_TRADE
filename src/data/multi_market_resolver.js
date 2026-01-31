/**
 * Multi-Asset Market Resolver
 * Resolves current 15-minute markets for multiple crypto assets
 */
import { fetchMarketBySlug } from "./polymarket.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("multi-market");
const WINDOW_TOLERANCE_SEC = 90;

// Supported assets with their slug prefixes (ETH removed per user request)
export const SUPPORTED_ASSETS = {
    BTC: { prefix: 'btc-updown-15m', name: 'Bitcoin', symbol: 'BTCUSDT' },
    SOL: { prefix: 'sol-updown-15m', name: 'Solana', symbol: 'SOLUSDT' },
    XRP: { prefix: 'xrp-updown-15m', name: 'XRP', symbol: 'XRPUSDT' }
};

/**
 * Get the current 15-minute window Unix timestamp
 */
export function getCurrentWindowTimestamp() {
    const now = Math.floor(Date.now() / 1000); // Unix seconds
    const windowSize = 15 * 60; // 15 minutes in seconds
    return Math.floor(now / windowSize) * windowSize;
}

/**
 * Generate slug for a specific asset and window
 */
export function generateSlug(asset, windowTimestamp = null) {
    const config = SUPPORTED_ASSETS[asset.toUpperCase()];
    if (!config) throw new Error(`Unsupported asset: ${asset}`);

    const ts = windowTimestamp || getCurrentWindowTimestamp();
    return `${config.prefix}-${ts}`;
}

/**
 * Resolve market for a specific asset
 */
export async function resolveMarket(asset) {
    const slug = generateSlug(asset);
    const windowInfo = getWindowInfo();

    try {
        const market = await fetchMarketBySlug(slug);
        if (market) {
            const endMs = market.endDate ? new Date(market.endDate).getTime() : null;
            const expectedEndMs = windowInfo?.endTime ? windowInfo.endTime.getTime() : null;
            if (endMs && expectedEndMs && Math.abs(endMs - expectedEndMs) > WINDOW_TOLERANCE_SEC * 1000) {
                logger.debug(`Market end mismatch for ${asset}: ${slug}`);
                return null;
            }

            // Parse token IDs
            let tokenIds = { up: null, down: null };
            if (market.clobTokenIds) {
                const tokens = typeof market.clobTokenIds === 'string'
                    ? JSON.parse(market.clobTokenIds)
                    : market.clobTokenIds;
                if (Array.isArray(tokens) && tokens.length >= 2) {
                    tokenIds.up = tokens[0];
                    tokenIds.down = tokens[1];
                }
            }

            return {
                asset,
                slug: market.slug,
                question: market.question,
                endDate: market.endDate,
                tokens: tokenIds,
                market
            };
        }
    } catch (err) {
        logger.debug(`Market not found for ${asset}: ${err.message}`);
    }

    return null;
}

/**
 * Resolve all available markets
 */
export async function resolveAllMarkets() {
    const results = {};

    for (const asset of Object.keys(SUPPORTED_ASSETS)) {
        const market = await resolveMarket(asset);
        if (market) {
            results[asset] = market;
        }
    }

    return results;
}

/**
 * Get window info
 */
export function getWindowInfo() {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;
    const elapsed = now - windowStart;
    const remaining = windowEnd - now;

    return {
        windowTimestamp: Math.floor(windowStart / 1000),
        startTime: new Date(windowStart),
        endTime: new Date(windowEnd),
        elapsedMs: elapsed,
        remainingMs: remaining,
        elapsedSec: Math.floor(elapsed / 1000),
        remainingSec: Math.floor(remaining / 1000),
        progress: elapsed / windowMs
    };
}

// Export for use by other modules
