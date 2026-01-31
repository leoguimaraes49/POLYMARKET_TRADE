import fs from 'node:fs';
import path from 'node:path';
import { resolveCurrentBtc15mMarket, getWindowId, getSecondsUntilNextWindow } from '../data/market_resolver.js';
import { Logger } from '../utils/logger.js';
import { sleep } from '../utils.js';

const logger = new Logger('foreman');
const ORDERS_FILE = "./orders.json";

function writeOrders(orders) {
    try {
        // DEBUG: Log if tokens are missing
        if (!orders.tokens) {
            logger.warn("writeOrders: tokens MISSING in object!");
        } else {
            // logger.debug("writeOrders: tokens present", orders.tokens);
        }
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
    } catch (err) {
        logger.error("Failed to write orders.json", { error: err.message });
    }
}

async function runForeman() {
    logger.info("Starting Foreman...");

    while (true) {
        try {
            const market = await resolveCurrentBtc15mMarket();
            const windowId = getWindowId();
            const secondsLeft = getSecondsUntilNextWindow();

            let tokenIds = { up: null, down: null };
            if (market) {
                try {
                    const clobIds = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
                    if (Array.isArray(clobIds) && clobIds.length >= 2) {
                        tokenIds.up = clobIds[0];
                        tokenIds.down = clobIds[1];
                    }
                } catch (err) {
                    logger.error("Failed to parse token IDs", { error: err.message });
                }
            }

            const state = {
                timestamp: new Date().toISOString(),
                window_id: windowId,
                seconds_until_next: secondsLeft,
                market_slug: market?.slug || null,
                market_question: market?.question || null,
                tokens: tokenIds,

                order: market ? "START" : "STOP",
                ready_for_next: secondsLeft < 30,

                risk_caps: {
                    max_shares: 100,
                    max_notional_usd: 50,
                    stop_loss_usd: 10
                }
            };

            writeOrders(state);

            if (market) {
                logger.info(`Window ${windowId} | Market: ${market.slug} | Tokens: ${tokenIds.up?.slice(0, 6)}... | Status: ${state.order}`);
            } else {
                logger.warn(`Window ${windowId} | No Market Found`);
            }

        } catch (err) {
            logger.error("Foreman loop error", { error: err.message });
        }

        await sleep(2000);
    }
}

runForeman();
