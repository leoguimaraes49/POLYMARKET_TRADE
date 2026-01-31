/**
 * Multi-Asset Foreman
 * Monitors and manages orders for BTC, SOL, XRP simultaneously
 */
import fs from 'node:fs';
import { resolveAllMarkets, getWindowInfo, SUPPORTED_ASSETS } from '../data/multi_market_resolver.js';
import { Logger } from '../utils/logger.js';
import { sleep } from '../utils.js';

const logger = new Logger('multi-foreman');
const ORDERS_FILE = "./orders_multi.json";

function writeOrders(orders) {
    try {
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
    } catch (err) {
        logger.error("Failed to write orders", { error: err.message });
    }
}

async function runMultiForeman() {
    logger.info("Starting Multi-Asset Foreman (BTC, SOL, XRP)...");

    let lastWindowTimestamp = null;

    while (true) {
        try {
            const windowInfo = getWindowInfo();
            const markets = await resolveAllMarkets();

            // Detect new window
            const isNewWindow = windowInfo.windowTimestamp !== lastWindowTimestamp;
            if (isNewWindow) {
                logger.info(`New Window: ${windowInfo.startTime.toLocaleTimeString()} - ${windowInfo.endTime.toLocaleTimeString()}`);
                lastWindowTimestamp = windowInfo.windowTimestamp;
            }

            // Build orders for all assets
            const assetOrders = {};

            for (const [asset, market] of Object.entries(markets)) {
                assetOrders[asset] = {
                    asset,
                    slug: market.slug,
                    question: market.question,
                    tokens: market.tokens,
                    order: "START",
                    ready: true
                };

                if (isNewWindow) {
                    logger.info(`  ${asset}: ${market.question}`);
                }
            }

            // Write combined state
            const state = {
                timestamp: new Date().toISOString(),
                window: {
                    id: windowInfo.windowTimestamp,
                    start: windowInfo.startTime.toISOString(),
                    end: windowInfo.endTime.toISOString(),
                    elapsed_sec: windowInfo.elapsedSec,
                    remaining_sec: windowInfo.remainingSec,
                    progress: windowInfo.progress
                },
                assets: assetOrders,
                active_count: Object.keys(assetOrders).length,
                risk_caps: {
                    max_shares_per_asset: 50,
                    max_notional_usd_per_asset: 25,
                    stop_loss_usd: 5
                }
            };

            writeOrders(state);

            // Log status periodically
            if (windowInfo.elapsedSec % 30 === 0) {
                logger.info(`Window ${(windowInfo.progress * 100).toFixed(0)}% | Assets: ${Object.keys(assetOrders).join(', ')}`);
            }

        } catch (err) {
            logger.error("Foreman loop error", { error: err.message });
        }

        await sleep(2000);
    }
}

runMultiForeman();
