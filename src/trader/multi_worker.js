/**
 * Multi-Asset Worker
 * Trades BTC, SOL, XRP simultaneously using shadow exchange
 */
import fs from 'node:fs';
import { ShadowExchange } from '../trader/shadow_exchange.js';
import { StrategyEngine } from '../trader/strategy.js';
import { Logger } from '../utils/logger.js';
import { sleep } from '../utils.js';

const logger = new Logger('multi-worker');
const ORDERS_FILE = "./orders_multi.json";
const STATE_FILE = "./data/multi_worker_state.json";

// State per asset
const assetStates = {};

// Shared exchange (tracks all positions)
const exchange = new ShadowExchange();
const strategy = new StrategyEngine({});

function readOrders() {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
        }
    } catch (err) {
        logger.error("Failed to read orders", { error: err.message });
    }
    return null;
}

function initAssetState(asset) {
    if (!assetStates[asset]) {
        assetStates[asset] = {
            entryDone: false,
            ladderPlaced: false,
            lastWindowId: null
        };
    }
    return assetStates[asset];
}

function exportMultiState(orders) {
    const allPositions = exchange.positions;
    const allOrders = exchange.orders;

    // Group by asset
    const positionsByAsset = {};

    for (const [asset, info] of Object.entries(orders?.assets || {})) {
        const upToken = info.tokens?.up;
        const downToken = info.tokens?.down;

        positionsByAsset[asset] = {
            yes: allPositions[upToken] || { size: 0, avgPrice: 0.50, cost: 0 },
            no: allPositions[downToken] || { size: 0, avgPrice: 0.50, cost: 0 }
        };
    }

    // Calculate totals
    let totalYesShares = 0, totalYesCost = 0;
    for (const pos of Object.values(allPositions)) {
        totalYesShares += pos.size || 0;
        totalYesCost += pos.cost || 0;
    }

    const state = {
        positions: {
            byAsset: positionsByAsset,
            total: {
                shares: totalYesShares,
                cost: totalYesCost,
                avgPrice: totalYesShares > 0 ? totalYesCost / totalYesShares : 0.50
            }
        },
        pendingOrders: allOrders.length,
        balance: exchange.balance,
        assets: Object.keys(orders?.assets || {}),
        window: orders?.window,
        lastUpdate: new Date().toISOString()
    };

    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) { }

    return state;
}

async function processAsset(asset, assetOrder, windowId) {
    const state = initAssetState(asset);

    // Detect new window for this asset
    if (windowId !== state.lastWindowId) {
        logger.info(`[${asset}] New window detected`);
        state.entryDone = false;
        state.ladderPlaced = false;
        state.lastWindowId = windowId;
    }

    // Entry
    if (!state.entryDone && assetOrder.tokens?.up) {
        logger.info(`[${asset}] Executing entry...`);

        try {
            const order = {
                tokenId: assetOrder.tokens.up,
                side: "BUY",
                price: 0.55, // Willing to pay up to 55 cents
                size: 10,
                type: "FOK"
            };

            const result = await exchange.placeOrder(order);
            logger.info(`[${asset}] Entry result: ${result.status}`, result);

            state.entryDone = true;
        } catch (err) {
            logger.warn(`[${asset}] Entry failed: ${err.message}`);
            state.entryDone = true; // Don't retry
        }
    }

    // Ladder
    if (state.entryDone && !state.ladderPlaced && assetOrder.tokens?.up) {
        logger.info(`[${asset}] Placing ladder orders...`);

        const ladderPrices = [0.48, 0.46, 0.44, 0.42, 0.40];

        for (const price of ladderPrices) {
            try {
                await exchange.placeOrder({
                    tokenId: assetOrder.tokens.up,
                    side: "BUY",
                    price,
                    size: 5,
                    type: "GTC"
                });
            } catch (err) { }
        }

        state.ladderPlaced = true;
        logger.info(`[${asset}] Ladder placed`);
    }
}

async function runMultiWorker() {
    logger.info("Starting Multi-Asset Worker (BTC, SOL, XRP)...");

    await exchange.init();

    while (true) {
        try {
            const orders = readOrders();

            if (!orders || !orders.assets) {
                logger.debug("Waiting for multi-foreman orders...");
                await sleep(2000);
                continue;
            }

            const windowId = orders.window?.id;

            // Process each asset
            for (const [asset, assetOrder] of Object.entries(orders.assets)) {
                await processAsset(asset, assetOrder, windowId);
            }

            // Export state for dashboard
            exportMultiState(orders);

        } catch (err) {
            logger.error("Worker loop error", { error: err.message });
        }

        await sleep(1000);
    }
}

runMultiWorker();
