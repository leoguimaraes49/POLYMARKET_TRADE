import fs from 'node:fs';
import { Logger } from '../utils/logger.js';
import { ShadowExchange } from './shadow_exchange.js';
import { StateMachine, TRADER_STATES } from './state_machine.js';
import { StrategyEngine } from './strategy.js';
import { RiskManager } from './risk.js';
import { sleep } from '../utils.js';

const logger = new Logger('worker');
const ORDERS_FILE = "./orders.json";

async function readForemanState() {
    try {
        if (!fs.existsSync(ORDERS_FILE)) return null;
        const raw = fs.readFileSync(ORDERS_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

async function runWorker() {
    logger.info("Worker Starting...");

    const exchange = new ShadowExchange();
    await exchange.init();

    const stateMachine = new StateMachine();
    const strategy = new StrategyEngine();
    let risk = new RiskManager({});

    let currentWindowId = null;
    let entryDone = false;
    let ladderPlaced = false;
    let lastLockCheck = 0;

    while (true) {
        try {
            const packet = await readForemanState();

            if (!packet) {
                logger.info("Waiting for Foreman packet...");
                await sleep(2000);
                continue;
            }

            // Detect new window - reset all per-window state
            if (packet.window_id !== currentWindowId) {
                logger.info(`New Window detected: ${packet.window_id}`);
                currentWindowId = packet.window_id;
                stateMachine.transitionTo(TRADER_STATES.IDLE, "New Window");
                entryDone = false;
                ladderPlaced = false;
                lastLockCheck = 0;
                risk = new RiskManager(packet.risk_caps || {});
            }

            const state = stateMachine.getState();
            logger.debug(`Result State: ${state} | Order: ${packet.order} | Market: ${packet.market_slug}`);

            // Export state for dashboard
            exchange.exportState(packet.tokens, { yes: 0.50, no: 0.50 });

            switch (state) {
                case TRADER_STATES.IDLE:
                    if (packet.order === "START" && packet.market_slug) {
                        stateMachine.transitionTo(TRADER_STATES.ARMED, "Foreman START signal received");
                    }
                    break;

                case TRADER_STATES.ARMED:
                    const guard = strategy.checkGuardrails({}, []);
                    if (guard.ok) {
                        stateMachine.transitionTo(TRADER_STATES.ENTERING, "Guardrails Passed");
                    }
                    break;

                case TRADER_STATES.ENTERING:
                    if (!entryDone) {
                        logger.info("Executing Entry Strategy...");
                        if (packet.tokens?.up) {
                            try {
                                const order = {
                                    tokenId: packet.tokens.up,
                                    side: "BUY",
                                    price: 0.50,
                                    size: 10,
                                    type: "FOK"
                                };
                                const res = await exchange.placeOrder(order);
                                logger.info("Entry Order Result:", res);
                            } catch (err) {
                                logger.warn("Entry order failed", { error: err.message });
                            }
                        }
                        entryDone = true;
                    }
                    stateMachine.transitionTo(TRADER_STATES.ACCUMULATING, "Entry Complete");
                    break;

                case TRADER_STATES.ACCUMULATING:
                    if (!ladderPlaced && packet.tokens?.up && packet.tokens?.down) {
                        try {
                            const upLadder = strategy.calculateLadderOrders('UP', 0.50, packet.tokens.up);
                            const downLadder = strategy.calculateLadderOrders('DOWN', 0.50, packet.tokens.down);
                            const allLadder = [...upLadder, ...downLadder];

                            logger.info(`Placing ${allLadder.length} Ladder Orders...`);
                            for (const o of allLadder) {
                                try {
                                    await exchange.placeOrder(o);
                                } catch (err) {
                                    // Ignore individual order failures in shadow mode
                                }
                            }
                            ladderPlaced = true;
                        } catch (err) {
                            logger.warn("Ladder placement failed", { error: err.message });
                            ladderPlaced = true; // Prevent retry spam
                        }
                    }
                    stateMachine.transitionTo(TRADER_STATES.LOCKING, "Ladder Active");
                    break;

                case TRADER_STATES.LOCKING:
                    // Only check for lock every 10 seconds to avoid spam
                    const now = Date.now();
                    if (now - lastLockCheck < 10000) {
                        break; // Wait
                    }
                    lastLockCheck = now;

                    if (packet.tokens?.up && packet.tokens?.down) {
                        try {
                            const positions = await exchange.getPositions();
                            const bookUp = await exchange.getOrderBook(packet.tokens.up);
                            const bookDown = await exchange.getOrderBook(packet.tokens.down);

                            const prices = {
                                up: { bestBid: bookUp?.bids?.[0] ? parseFloat(bookUp.bids[0].price) : 0 },
                                down: { bestBid: bookDown?.bids?.[0] ? parseFloat(bookDown.bids[0].price) : 0 }
                            };

                            const lockDecision = strategy.checkForLock(positions, prices, packet.tokens);
                            if (lockDecision) {
                                logger.info("EXECUTE LOCK:", lockDecision);
                                stateMachine.transitionTo(TRADER_STATES.DONE, "Lock Executed");
                            }
                        } catch (err) {
                            // Book fetch failed - this is expected in shadow mode without real market
                            // Just log once and continue waiting
                            logger.debug("Lock check skipped (no book data)");
                        }
                    }
                    // Stay in LOCKING state, don't transition
                    break;

                case TRADER_STATES.DONE:
                    // Window complete, wait for next window
                    break;
            }

        } catch (err) {
            logger.error("Worker Loop Error", { error: err.message });
        }

        await sleep(1000);
    }
}

runWorker();
