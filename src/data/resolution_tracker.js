/**
 * Market Resolution Tracker
 * Tracks win/loss outcomes for completed markets
 */
import fs from 'node:fs';
import { fetchClobPrice } from './polymarket.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('resolution');
const STATS_FILE = './data/trading_stats.json';

export class ResolutionTracker {
    constructor() {
        this.pendingResolutions = new Map();  // windowId -> position info
        this.stats = this.loadStats();
    }

    /**
     * Load stats from file
     */
    loadStats() {
        try {
            if (fs.existsSync(STATS_FILE)) {
                return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
            }
        } catch (err) {
            logger.error('Failed to load stats', { error: err.message });
        }

        return {
            session: {
                wins: 0,
                losses: 0,
                breakeven: 0,
                totalPnl: 0,
                tradesEntered: 0,
                startTime: new Date().toISOString()
            },
            allTime: {
                wins: 0,
                losses: 0,
                breakeven: 0,
                totalPnl: 0,
                tradesEntered: 0
            },
            history: []  // Recent trades
        };
    }

    /**
     * Save stats to file
     */
    saveStats() {
        try {
            fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
        } catch (err) {
            logger.error('Failed to save stats', { error: err.message });
        }
    }

    /**
     * Register a position for resolution tracking
     * @param {string} windowId - Window identifier
     * @param {string} asset - Asset name (BTC, SOL, XRP)
     * @param {Object} position - Position details
     * @param {number} endTime - When the window ends (Unix ms)
     */
    registerPosition(windowId, asset, position, endTime, tokens = {}) {
        const key = `${windowId}-${asset}`;

        this.pendingResolutions.set(key, {
            windowId,
            asset,
            position: { ...position },
            endTime,
            tokens: {
                up: tokens?.up || null,
                down: tokens?.down || null
            },
            registeredAt: Date.now()
        });

        logger.debug(`Registered position for resolution: ${key}`);
    }

    /**
     * Check resolution for a completed window
     * @param {string} windowId 
     * @param {string} asset 
     * @param {string} winner - 'YES' or 'NO'
     */
    resolvePosition(windowId, asset, winner) {
        const key = `${windowId}-${asset}`;
        const pending = this.pendingResolutions.get(key);

        if (!pending) {
            logger.debug(`No pending position for ${key}`);
            return null;
        }

        const { position } = pending;
        const { yesShares = 0, yesCost = 0, noShares = 0, noCost = 0 } = position;
        const totalCost = yesCost + noCost;

        // Calculate outcome
        let proceeds = 0;
        if (winner === 'YES') {
            proceeds = yesShares * 1.00;
        } else if (winner === 'NO') {
            proceeds = noShares * 1.00;
        }

        const pnl = proceeds - totalCost;

        // Determine result type
        let result = 'LOSS';
        if (pnl > 0.01) {
            result = 'WIN';
            this.stats.session.wins++;
            this.stats.allTime.wins++;
        } else if (pnl < -0.01) {
            result = 'LOSS';
            this.stats.session.losses++;
            this.stats.allTime.losses++;
        } else {
            result = 'BREAKEVEN';
            this.stats.session.breakeven++;
            this.stats.allTime.breakeven++;
        }

        // Update stats
        this.stats.session.totalPnl += pnl;
        this.stats.allTime.totalPnl += pnl;

        // Add to history
        const tradeResult = {
            timestamp: new Date().toISOString(),
            windowId,
            asset,
            winner,
            result,
            pnl,
            position: {
                yesShares,
                noShares,
                totalCost
            }
        };

        this.stats.history.unshift(tradeResult);

        // Keep only last 100 trades
        if (this.stats.history.length > 100) {
            this.stats.history = this.stats.history.slice(0, 100);
        }

        // Save and cleanup
        this.saveStats();
        this.pendingResolutions.delete(key);

        logger.info(`📊 RESOLUTION: ${asset} ${result}`, {
            winner,
            pnl: pnl.toFixed(2),
            proceeds: proceeds.toFixed(2),
            cost: totalCost.toFixed(2)
        });

        return tradeResult;
    }

    /**
     * Determine winner based on final prices
     * If YES price >= 0.90, YES won. If NO price >= 0.90, NO won.
     */
    async determineWinner(tokenIdYes, tokenIdNo) {
        try {
            const [yesData, noData] = await Promise.all([
                fetchClobPrice(tokenIdYes),
                fetchClobPrice(tokenIdNo)
            ]);

            const yesPrice = yesData?.price || 0.50;
            const noPrice = noData?.price || 0.50;

            // Market resolved
            if (yesPrice >= 0.95) return 'YES';
            if (noPrice >= 0.95) return 'NO';

            // Still uncertain
            return null;
        } catch (err) {
            logger.debug(`Could not determine winner: ${err.message}`);
            return null;
        }
    }

    /**
     * Check all pending resolutions
     */
    async checkPendingResolutions() {
        const now = Date.now();

        for (const [key, pending] of this.pendingResolutions) {
            // Only check if window has ended (add 30s buffer for resolution)
            if (now < pending.endTime + 30000) continue;

            const tokenYes = pending.tokens?.up;
            const tokenNo = pending.tokens?.down;
            if (!tokenYes || !tokenNo) {
                logger.debug(`Skipping resolution for ${key} (missing tokens)`);
                continue;
            }

            logger.debug(`Checking resolution for ${key}...`);
            const winner = await this.determineWinner(tokenYes, tokenNo);
            if (winner) {
                this.resolvePosition(pending.windowId, pending.asset, winner);
            }
        }
    }

    /**
     * Get current stats
     */
    getStats() {
        const s = this.stats.session;
        const totalTrades = s.wins + s.losses + s.breakeven;

        return {
            session: {
                ...s,
                winRate: totalTrades > 0 ? (s.wins / totalTrades * 100).toFixed(1) + '%' : 'N/A',
                totalTrades
            },
            allTime: {
                ...this.stats.allTime,
                totalTrades: this.stats.allTime.wins + this.stats.allTime.losses + this.stats.allTime.breakeven
            },
            recentTrades: this.stats.history.slice(0, 5)
        };
    }

    /**
     * Get pending count
     */
    getPendingCount() {
        return this.pendingResolutions.size;
    }
}

// Singleton instance
export const resolutionTracker = new ResolutionTracker();
