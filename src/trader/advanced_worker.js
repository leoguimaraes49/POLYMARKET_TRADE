/**
 * Advanced Multi-Asset Worker
 * Implements full trading strategy with guardrails, lock detection, and resolution
 */
import fs from 'node:fs';
import { ShadowExchange } from './shadow_exchange.js';
import { Guardrails } from './guardrails.js';
import { LockDetector } from './lock_detector.js';
import { LeaderTracker } from '../data/leader_tracker.js';
import { OBICalculator, updateOBIFromMarket } from '../data/obi_calculator.js';
import { resolutionTracker } from '../data/resolution_tracker.js';
import { Logger } from '../utils/logger.js';
import { sleep } from '../utils.js';

const logger = new Logger('adv-worker');
const ORDERS_FILE = "./orders_multi.json";
const STATE_FILE = "./data/advanced_worker_state.json";

// Trading States
const STATES = {
    IDLE: 'IDLE',
    ARMED: 'ARMED',           // Waiting for guardrails
    ENTRY: 'ENTRY',           // Executing entry
    LADDERING: 'LADDERING',   // Placing/managing ladder
    LOCKING: 'LOCKING',       // Checking for lock
    LOCKED: 'LOCKED',         // Dual profit locked
    RECOVERY: 'RECOVERY',     // Recovering from reversal
    ENDGAME: 'ENDGAME'        // Final 10 seconds
};

// Configuration
const CONFIG = {
    ENTRY_PRICE_YES: 0.60,    // FOK entry for YES
    ENTRY_PRICE_NO: 0.40,     // FOK entry for NO
    ENTRY_SIZE: 10,           // Shares per entry
    LADDER_LEVELS: [0.38, 0.36, 0.34, 0.32, 0.30],  // GTC ladder
    LADDER_SIZE: 5,           // Shares per ladder level
    MAX_GTC_ORDERS_PER_ASSET: 20,
    MAX_PAIR_COST: 1.00,
    PAIR_COST_BUFFER: 0.02,
    ENDGAME_SECONDS: 10,      // Endgame threshold
    ENDGAME_PRICE: 0.92,      // Buy winner at this price
    MAX_SHARES_PER_ASSET: 50, // Risk limit
    MAX_SPEND_PER_ASSET: 25,  // USD limit
    TICK_INTERVAL_MS: 2000    // 2 seconds between ticks
};

class AdvancedWorker {
    constructor() {
        this.exchange = new ShadowExchange();
        this.guardrails = new Guardrails();

        // Per-asset state
        this.assetState = {};  // { BTC: { state, tracker, obi, lock, ... }, ... }
        this.lastTelemetryMs = {};
    }

    getRiskCaps(orders) {
        const caps = orders?.risk_caps || {};
        return {
            maxShares: caps.max_shares_per_asset ?? CONFIG.MAX_SHARES_PER_ASSET,
            maxNotional: caps.max_notional_usd_per_asset ?? CONFIG.MAX_SPEND_PER_ASSET,
            maxOpenOrders: caps.max_open_orders_per_asset ?? CONFIG.MAX_GTC_ORDERS_PER_ASSET
        };
    }

    canPlaceOrder(state, price, size, caps, asset, label) {
        const currentShares = (state.position.yesShares || 0) + (state.position.noShares || 0);
        const currentCost = (state.position.yesCost || 0) + (state.position.noCost || 0);
        const orderCost = (price || 0) * size;

        if (currentShares + size > caps.maxShares) {
            logger.warn(`[${asset}] ${label} blocked: max_shares ${caps.maxShares}`);
            return false;
        }

        if (currentCost + orderCost > caps.maxNotional) {
            logger.warn(`[${asset}] ${label} blocked: max_notional ${caps.maxNotional}`);
            return false;
        }

        return true;
    }

    canAddPairPosition(state, side, price, size, orderType, asset, label) {
        const yesShares = state.position.yesShares || 0;
        const noShares = state.position.noShares || 0;
        const yesCost = state.position.yesCost || 0;
        const noCost = state.position.noCost || 0;

        const feeRate = (orderType === "FOK" || orderType === "IOC") ? 0.02 : 0.0;
        const addedCost = (price || 0) * size * (1 + feeRate);

        const nextYesShares = side === "YES" ? yesShares + size : yesShares;
        const nextNoShares = side === "NO" ? noShares + size : noShares;
        const nextYesCost = side === "YES" ? yesCost + addedCost : yesCost;
        const nextNoCost = side === "NO" ? noCost + addedCost : noCost;

        const pairedShares = Math.min(nextYesShares, nextNoShares);
        if (pairedShares <= 0) return true;

        const pairCost = (nextYesCost + nextNoCost) / pairedShares;
        const maxAllowed = CONFIG.MAX_PAIR_COST + CONFIG.PAIR_COST_BUFFER;
        if (pairCost > maxAllowed) {
            logger.warn(`[${asset}] ${label} blocked: pair_cost ${pairCost.toFixed(3)} > ${maxAllowed.toFixed(3)}`);
            return false;
        }

        return true;
    }

    countOpenGtcOrders(tokenIds = []) {
        const tokens = new Set(tokenIds.filter(Boolean));
        if (tokens.size === 0) return 0;
        return this.exchange.orders.filter((o) => o?.type === "GTC" && tokens.has(o.tokenId)).length;
    }

    initAssetState(asset) {
        if (!this.assetState[asset]) {
            this.assetState[asset] = {
                state: STATES.IDLE,
                leaderTracker: new LeaderTracker(90000),
                obiCalculator: new OBICalculator(90000),
                lockDetector: new LockDetector(),
                lastWindowId: null,
                lastTokens: { up: null, down: null },
                entryDone: false,
                ladderDone: false,
                position: {
                    yesShares: 0,
                    yesCost: 0,
                    noShares: 0,
                    noCost: 0
                }
            };
        }
        return this.assetState[asset];
    }

    readOrders() {
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
            }
        } catch (err) {
            logger.error("Failed to read orders", { error: err.message });
        }
        return null;
    }

    async processAsset(asset, assetOrder, window, orders) {
        const state = this.initAssetState(asset);
        const windowId = window.id;

        // Detect new window
        if (windowId !== state.lastWindowId) {
            logger.info(`[${asset}] New window detected`);

            // Register previous position for resolution
            if (state.lastWindowId && (state.position.yesShares > 0 || state.position.noShares > 0)) {
                const endTimeMs = window?.end ? new Date(window.end).getTime() : Date.now();
                resolutionTracker.registerPosition(
                    state.lastWindowId,
                    asset,
                    state.position,
                    Number.isFinite(endTimeMs) ? endTimeMs : Date.now(),
                    state.lastTokens || assetOrder?.tokens || {}
                );
            }

            // Reset for new window
            state.state = STATES.ARMED;
            state.entryDone = false;
            state.ladderDone = false;
            state.leaderTracker.resetForNewWindow();
            state.lockDetector.reset();
            state.lastWindowId = windowId;
            state.lastTokens = {
                up: assetOrder?.tokens?.up || null,
                down: assetOrder?.tokens?.down || null
            };

            // Reset position (new contracts each window)
            state.position = { yesShares: 0, yesCost: 0, noShares: 0, noCost: 0 };
        }

        // Get current prices
        let priceYes = 0.50, priceNo = 0.50;
        try {
            const yesToken = assetOrder.tokens?.up;
            const noToken = assetOrder.tokens?.down;

            if (yesToken && noToken) {
                const { fetchClobPrice } = await import('../data/polymarket.js');
                const [yesData, noData] = await Promise.all([
                    fetchClobPrice(yesToken),
                    fetchClobPrice(noToken)
                ]);
                priceYes = yesData?.price || 0.50;
                priceNo = noData?.price || 0.50;
            }
        } catch (err) {
            logger.debug(`[${asset}] Price fetch error: ${err.message}`);
        }

        // Update trackers
        const leaderInfo = state.leaderTracker.update(priceYes, priceNo);
        await updateOBIFromMarket(
            assetOrder.tokens?.up,
            assetOrder.tokens?.down,
            state.obiCalculator
        );

        // State machine
        switch (state.state) {
            case STATES.ARMED:
                await this.handleArmed(asset, state, window, leaderInfo);
                break;

            case STATES.ENTRY:
                await this.handleEntry(asset, state, assetOrder, priceYes, priceNo, this.getRiskCaps(orders));
                break;

            case STATES.LADDERING:
                await this.handleLaddering(asset, state, assetOrder, priceYes, priceNo, this.getRiskCaps(orders));
                break;

            case STATES.LOCKING:
                await this.handleLocking(asset, state, priceYes, priceNo);
                break;

            case STATES.LOCKED:
                // Stay locked, no more buying
                if (window.remaining_sec <= CONFIG.ENDGAME_SECONDS) {
                    state.state = STATES.ENDGAME;
                }
                break;

            case STATES.RECOVERY:
                await this.handleRecovery(asset, state, assetOrder, priceYes, priceNo, this.getRiskCaps(orders));
                break;

            case STATES.ENDGAME:
                await this.handleEndgame(asset, state, assetOrder, priceYes, priceNo, window.remaining_sec, this.getRiskCaps(orders));
                break;
        }

        return {
            asset,
            state: state.state,
            leader: leaderInfo.leader,
            flips: leaderInfo.flipCount,
            obi: state.obiCalculator.getRollingOBI('YES'),
            position: state.position,
            locked: state.lockDetector.locked,
            priceYes,
            priceNo
        };
    }

    async handleArmed(asset, state, window, leaderInfo) {
        // Check all guardrails
        const check = this.guardrails.checkAll({
            elapsedSec: window.elapsed_sec,
            windowSec: 900,
            obi: state.obiCalculator.getRollingOBI('YES'),
            obiSide: 'YES',
            flipCount: leaderInfo.flipCount,
            shares: state.position.yesShares + state.position.noShares,
            stability: 0.7,  // TODO: Get from foreman
            priceYes: leaderInfo.priceYes,
            priceNo: leaderInfo.priceNo,
            foremanOrder: 'START'
        });

        if (check.allowed) {
            if (check.mode === 'RECOVERY') {
                state.state = STATES.RECOVERY;
                logger.info(`[${asset}] Entering RECOVERY mode (${check.summary})`);
            } else {
                state.state = STATES.ENTRY;
                logger.info(`[${asset}] Guardrails passed, entering ENTRY`);
            }
        } else {
            logger.debug(`[${asset}] Guardrails: ${check.summary}`);
        }
    }

    async handleEntry(asset, state, assetOrder, priceYes, priceNo, caps) {
        if (state.entryDone) {
            state.state = STATES.LADDERING;
            return;
        }

        // Determine entry side based on leader
        const leader = state.leaderTracker.getLeader();
        const tokenId = leader === 'YES' ? assetOrder.tokens?.up : assetOrder.tokens?.down;
        const entryPrice = leader === 'YES' ? CONFIG.ENTRY_PRICE_YES : CONFIG.ENTRY_PRICE_NO;
        const entrySide = leader === 'YES' ? "YES" : "NO";

        if (!tokenId) {
            logger.warn(`[${asset}] No token ID for ${leader}`);
            state.entryDone = true;
            state.state = STATES.LADDERING;
            return;
        }

        logger.info(`[${asset}] Executing entry: BUY ${leader} @ ${entryPrice}`);

        try {
            if (!this.canPlaceOrder(state, entryPrice, CONFIG.ENTRY_SIZE, caps, asset, "ENTRY")) {
                state.entryDone = true;
                state.state = STATES.LADDERING;
                return;
            }
            if (!this.canAddPairPosition(state, entrySide, entryPrice, CONFIG.ENTRY_SIZE, "FOK", asset, "ENTRY")) {
                state.entryDone = true;
                state.state = STATES.LADDERING;
                return;
            }

            const result = await this.exchange.placeOrder({
                tokenId,
                side: 'BUY',
                price: entryPrice,
                size: CONFIG.ENTRY_SIZE,
                type: 'FOK'
            });

            if (result.status === 'FILLED') {
                // Update position
                if (leader === 'YES') {
                    state.position.yesShares += CONFIG.ENTRY_SIZE;
                    state.position.yesCost += result.fillPrice * CONFIG.ENTRY_SIZE;
                } else {
                    state.position.noShares += CONFIG.ENTRY_SIZE;
                    state.position.noCost += result.fillPrice * CONFIG.ENTRY_SIZE;
                }

                logger.info(`[${asset}] Entry FILLED @ ${result.fillPrice}`);
            } else {
                logger.info(`[${asset}] Entry ${result.status}`);
            }
        } catch (err) {
            logger.warn(`[${asset}] Entry error: ${err.message}`);
        }

        state.entryDone = true;
        state.state = STATES.LADDERING;
    }

    async handleLaddering(asset, state, assetOrder, priceYes, priceNo, caps) {
        if (state.ladderDone) {
            state.state = STATES.LOCKING;
            return;
        }

        // Place ladder on the opposite side (to reduce pair cost)
        const leader = state.leaderTracker.getLeader();
        const ladderSide = leader === 'YES' ? 'NO' : 'YES';
        const ladderSideLabel = ladderSide === 'YES' ? "YES" : "NO";
        const tokenId = ladderSide === 'YES' ? assetOrder.tokens?.up : assetOrder.tokens?.down;

        if (!tokenId) {
            state.ladderDone = true;
            state.state = STATES.LOCKING;
            return;
        }

        logger.info(`[${asset}] Placing ladder on ${ladderSide} side`);

        const tokenIds = [assetOrder?.tokens?.up, assetOrder?.tokens?.down];
        for (const price of CONFIG.LADDER_LEVELS) {
            try {
                const openOrders = this.countOpenGtcOrders(tokenIds);
                if (openOrders >= caps.maxOpenOrders) {
                    logger.warn(`[${asset}] LADDER blocked: max_open_orders ${caps.maxOpenOrders}`);
                    break;
                }
                if (!this.canPlaceOrder(state, price, CONFIG.LADDER_SIZE, caps, asset, "LADDER")) {
                    continue;
                }
                if (!this.canAddPairPosition(state, ladderSideLabel, price, CONFIG.LADDER_SIZE, "GTC", asset, "LADDER")) {
                    continue;
                }
                await this.exchange.placeOrder({
                    tokenId,
                    side: 'BUY',
                    price,
                    size: CONFIG.LADDER_SIZE,
                    type: 'GTC'
                });
            } catch (err) {
                logger.debug(`[${asset}] Ladder order error: ${err.message}`);
            }
        }

        state.ladderDone = true;
        state.state = STATES.LOCKING;
        logger.info(`[${asset}] Ladder placed, moving to LOCKING`);
    }

    async handleLocking(asset, state, priceYes, priceNo) {
        // Check for dual profit lock
        const analysis = state.lockDetector.checkLock(state.position);

        if (analysis.locked) {
            state.state = STATES.LOCKED;
            logger.info(`[${asset}] 🔒 LOCKED! YES:$${analysis.pnlIfYesWins.toFixed(2)} NO:$${analysis.pnlIfNoWins.toFixed(2)}`);
            return;
        }

        // Check if needs recovery
        if (analysis.needsRecovery) {
            const deficit = analysis.recoverySide === 'YES' ? analysis.yesDeficit : analysis.noDeficit;
            if (deficit > 5) {  // Significant deficit
                state.state = STATES.RECOVERY;
                logger.info(`[${asset}] Needs recovery on ${analysis.recoverySide} (deficit: $${deficit.toFixed(2)})`);
            }
        }

        // Log status
        logger.debug(`[${asset}] Lock check: YES=$${analysis.pnlIfYesWins.toFixed(2)} NO=$${analysis.pnlIfNoWins.toFixed(2)}`);
    }

    async handleRecovery(asset, state, assetOrder, priceYes, priceNo, caps) {
        const analysis = state.lockDetector.analyzePosition(state.position);

        // Calculate recovery shares needed
        const recoverySide = analysis.recoverySide;
        const deficit = recoverySide === 'YES' ? analysis.yesDeficit : analysis.noDeficit;
        const price = recoverySide === 'YES' ? priceYes : priceNo;

        const sharesNeeded = state.lockDetector.calculateRecoveryShares(deficit, price, 2);

        // Check risk limits
        const currentShares = state.position.yesShares + state.position.noShares;
        if (currentShares + sharesNeeded > caps.maxShares) {
            logger.warn(`[${asset}] Recovery would exceed share limit`);
            state.state = STATES.LOCKING;
            return;
        }

        const additionalCost = sharesNeeded * price;
        const currentCost = state.position.yesCost + state.position.noCost;
        if (currentCost + additionalCost > caps.maxNotional) {
            logger.warn(`[${asset}] Recovery would exceed spend limit`);
            state.state = STATES.LOCKING;
            return;
        }

        // Execute recovery buy
        const tokenId = recoverySide === 'YES' ? assetOrder.tokens?.up : assetOrder.tokens?.down;

        if (tokenId && sharesNeeded > 0 && sharesNeeded < 50) {
            logger.info(`[${asset}] Recovery: BUY ${sharesNeeded} ${recoverySide} @ ${price}`);

            try {
                const size = Math.min(sharesNeeded, 10);
                if (!this.canPlaceOrder(state, price + 0.02, size, caps, asset, "RECOVERY")) {
                    state.state = STATES.LOCKING;
                    return;
                }
                if (!this.canAddPairPosition(state, recoverySide, price + 0.02, size, "IOC", asset, "RECOVERY")) {
                    state.state = STATES.LOCKING;
                    return;
                }
                const result = await this.exchange.placeOrder({
                    tokenId,
                    side: 'BUY',
                    price: price + 0.02,  // Slightly aggressive for recovery
                    size,
                    type: 'IOC'
                });

                if (result.status === 'FILLED') {
                    if (recoverySide === 'YES') {
                        state.position.yesShares += result.size || Math.min(sharesNeeded, 10);
                        state.position.yesCost += (result.fillPrice || price) * (result.size || Math.min(sharesNeeded, 10));
                    } else {
                        state.position.noShares += result.size || Math.min(sharesNeeded, 10);
                        state.position.noCost += (result.fillPrice || price) * (result.size || Math.min(sharesNeeded, 10));
                    }
                }
            } catch (err) {
                logger.debug(`[${asset}] Recovery order error: ${err.message}`);
            }
        }

        state.state = STATES.LOCKING;
    }

    async handleEndgame(asset, state, assetOrder, priceYes, priceNo, remainingSec, caps) {
        // Final 10 seconds strategy
        const leader = state.leaderTracker.getLeader();
        const winnerPrice = leader === 'YES' ? priceYes : priceNo;
        const winnerSide = leader === 'YES' ? "YES" : "NO";

        // Buy winner if price >= 0.92
        if (winnerPrice >= CONFIG.ENDGAME_PRICE) {
            logger.info(`[${asset}] ENDGAME: ${leader} @ ${winnerPrice} (${remainingSec}s left)`);

            const tokenId = leader === 'YES' ? assetOrder.tokens?.up : assetOrder.tokens?.down;

            if (tokenId) {
                const analysis = state.lockDetector.analyzePosition(state.position);
                const deficit = leader === 'YES' ? analysis.yesDeficit : analysis.noDeficit;

                if (deficit > 0) {
                    const sharesToBuy = Math.min(6, Math.ceil(deficit / (1 - winnerPrice)));

                    try {
                        if (!this.canPlaceOrder(state, winnerPrice + 0.02, sharesToBuy, caps, asset, "ENDGAME")) {
                            return;
                        }
                        if (!this.canAddPairPosition(state, winnerSide, winnerPrice + 0.02, sharesToBuy, "IOC", asset, "ENDGAME")) {
                            return;
                        }
                        await this.exchange.placeOrder({
                            tokenId,
                            side: 'BUY',
                            price: winnerPrice + 0.02,
                            size: sharesToBuy,
                            type: 'IOC'
                        });

                        logger.info(`[${asset}] Endgame buy: ${sharesToBuy} ${leader}`);
                    } catch (err) {
                        logger.debug(`[${asset}] Endgame error: ${err.message}`);
                    }
                }
            }
        }
    }

    exportState(orders) {
        const assetData = {};

        for (const [asset, state] of Object.entries(this.assetState)) {
            assetData[asset] = {
                state: state.state,
                position: state.position,
                leader: state.leaderTracker.getLeader(),
                flips: state.leaderTracker.getFlipCount(),
                obi: state.obiCalculator.getRollingOBI('YES'),
                locked: state.lockDetector.locked,
                lockDetails: state.lockDetector.getState()
            };
        }

        // Calculate totals
        let totalYesShares = 0, totalNoShares = 0;
        let totalYesCost = 0, totalNoCost = 0;

        for (const state of Object.values(this.assetState)) {
            totalYesShares += state.position.yesShares;
            totalNoShares += state.position.noShares;
            totalYesCost += state.position.yesCost;
            totalNoCost += state.position.noCost;
        }

        const fullState = {
            assets: assetData,
            totals: {
                yesShares: totalYesShares,
                noShares: totalNoShares,
                yesCost: totalYesCost,
                noCost: totalNoCost,
                totalCost: totalYesCost + totalNoCost,
                pnlIfYesWins: totalYesShares - (totalYesCost + totalNoCost),
                pnlIfNoWins: totalNoShares - (totalYesCost + totalNoCost)
            },
            balance: this.exchange.balance,
            pendingOrders: this.exchange.orders.length,
            window: orders?.window,
            stats: resolutionTracker.getStats(),
            lastUpdate: new Date().toISOString()
        };

        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(fullState, null, 2));
        } catch (e) { }

        return fullState;
    }

    async run() {
        logger.info("Starting Advanced Multi-Asset Worker...");
        await this.exchange.init();

        while (true) {
            try {
                const orders = this.readOrders();

                if (!orders || !orders.assets) {
                    logger.debug("Waiting for orders...");
                    await sleep(CONFIG.TICK_INTERVAL_MS);
                    continue;
                }

                const window = orders.window;

                // Process each asset
                const results = [];
                for (const [asset, assetOrder] of Object.entries(orders.assets)) {
                    results.push(await this.processAsset(asset, assetOrder, window, orders));
                }

                // Export state
                this.exportState(orders);

                // Check pending resolutions
                await resolutionTracker.checkPendingResolutions();

                // Structured telemetry (every 10s per asset)
                const now = Date.now();
                const caps = this.getRiskCaps(orders);
                for (const r of results) {
                    const last = this.lastTelemetryMs[r.asset] || 0;
                    if (now - last < 10_000) continue;
                    this.lastTelemetryMs[r.asset] = now;
                    logger.debug(
                        `[${r.asset}] tick`,
                        {
                            window_id: window?.id,
                            remaining_sec: window?.remaining_sec,
                            state: r.state,
                            leader: r.leader,
                            flips: r.flips,
                            obi: Number.isFinite(r.obi) ? Number(r.obi) : null,
                            price_yes: r.priceYes,
                            price_no: r.priceNo,
                            position: r.position,
                            locked: r.locked,
                            risk_caps: caps
                        }
                    );
                }

            } catch (err) {
                logger.error("Worker loop error", { error: err.message });
            }

            await sleep(CONFIG.TICK_INTERVAL_MS);
        }
    }
}

// Run
const worker = new AdvancedWorker();
worker.run();
