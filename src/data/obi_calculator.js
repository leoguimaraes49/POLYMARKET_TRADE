/**
 * OBI (Order Book Imbalance) Calculator
 * Calculates imbalance from Polymarket CLOB orderbook
 */
import { RollingAverage } from './rolling_average.js';
import { fetchClobPrice, fetchOrderBook } from './polymarket.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('obi');

export class OBICalculator {
    constructor(windowMs = 90000, topN = 10) {
        this.windowMs = windowMs;
        this.topN = topN;  // Top N levels to consider

        // Rolling averages for YES and NO sides
        this.obiYes = new RollingAverage(windowMs);
        this.obiNo = new RollingAverage(windowMs);
        this.obiCombined = new RollingAverage(windowMs);
    }

    /**
     * Calculate OBI from bid/ask volumes
     * OBI = (bidVol - askVol) / (bidVol + askVol)
     * Range: -1 (all asks) to +1 (all bids)
     * Positive = buying pressure, Negative = selling pressure
     */
    calculateOBI(bidVolume, askVolume) {
        const total = bidVolume + askVolume;
        if (total === 0) return 0;
        return (bidVolume - askVolume) / total;
    }

    /**
     * Update OBI from orderbook data
     * @param {Object} orderbook - { bids: [{price, size}...], asks: [{price, size}...] }
     * @param {string} side - 'YES' or 'NO'
     */
    updateFromOrderbook(orderbook, side = 'YES') {
        if (!orderbook || !orderbook.bids || !orderbook.asks) {
            return null;
        }

        // Sum top N levels
        const bidVol = orderbook.bids
            .slice(0, this.topN)
            .reduce((sum, level) => sum + (parseFloat(level.size) || 0), 0);

        const askVol = orderbook.asks
            .slice(0, this.topN)
            .reduce((sum, level) => sum + (parseFloat(level.size) || 0), 0);

        const obi = this.calculateOBI(bidVol, askVol);

        // Store in appropriate rolling average
        if (side === 'YES') {
            this.obiYes.add(obi);
        } else {
            this.obiNo.add(obi);
        }

        // Combined OBI (average of both sides)
        const yesObi = this.obiYes.getLatest() || 0;
        const noObi = this.obiNo.getLatest() || 0;
        this.obiCombined.add((yesObi + noObi) / 2);

        return {
            obi,
            bidVolume: bidVol,
            askVolume: askVol,
            side
        };
    }

    /**
     * Update OBI using price-based estimation (fallback when orderbook unavailable)
     * Uses price deviation from 0.50 as a proxy for imbalance
     */
    updateFromPrices(priceYes, priceNo) {
        // Simple estimation: deviation from fair value (0.50)
        // If priceYes > 0.50, there's buying pressure on YES
        const yesImbalance = (priceYes - 0.50) * 2;  // Scale to -1 to +1
        const noImbalance = (priceNo - 0.50) * 2;

        this.obiYes.add(yesImbalance);
        this.obiNo.add(noImbalance);
        this.obiCombined.add((yesImbalance - noImbalance) / 2);

        return {
            yesObi: yesImbalance,
            noObi: noImbalance,
            combined: (yesImbalance - noImbalance) / 2,
            method: 'price-based'
        };
    }

    /**
     * Get rolling 90s OBI for a side
     */
    getRollingOBI(side = 'YES') {
        if (side === 'YES') {
            return this.obiYes.getAverage() || 0;
        } else if (side === 'NO') {
            return this.obiNo.getAverage() || 0;
        }
        return this.obiCombined.getAverage() || 0;
    }

    /**
     * Check if OBI is blocking entry
     * Threshold: -0.30 blocks entry on that side
     */
    isBlocking(side = 'YES', threshold = -0.30) {
        const obi = this.getRollingOBI(side);
        return obi <= threshold;
    }

    /**
     * Get full state for logging
     */
    getState() {
        return {
            yesObi: this.obiYes.getAverage() || 0,
            noObi: this.obiNo.getAverage() || 0,
            combinedObi: this.obiCombined.getAverage() || 0,
            yesBlocking: this.isBlocking('YES'),
            noBlocking: this.isBlocking('NO'),
            sampleCount: this.obiYes.getCount()
        };
    }

    /**
     * Reset for new window
     */
    reset() {
        this.obiYes = new RollingAverage(this.windowMs);
        this.obiNo = new RollingAverage(this.windowMs);
        this.obiCombined = new RollingAverage(this.windowMs);
    }
}

/**
 * Fetch and calculate OBI for a token
 * @param {string} tokenIdYes - YES token ID
 * @param {string} tokenIdNo - NO token ID
 * @param {OBICalculator} calculator - OBI calculator instance
 */
export async function updateOBIFromMarket(tokenIdYes, tokenIdNo, calculator) {
    try {
        if (tokenIdYes && tokenIdNo) {
            const [yesBook, noBook] = await Promise.all([
                fetchOrderBook({ tokenId: tokenIdYes }),
                fetchOrderBook({ tokenId: tokenIdNo })
            ]);

            const yesObi = calculator.updateFromOrderbook(yesBook, 'YES');
            const noObi = calculator.updateFromOrderbook(noBook, 'NO');

            if (yesObi && noObi) {
                return { method: 'orderbook', yesObi, noObi };
            }
        }
    } catch (err) {
        logger.debug(`OBI update failed: ${err.message}`);
    }

    try {
        const [yesPrice, noPrice] = await Promise.all([
            fetchClobPrice(tokenIdYes),
            fetchClobPrice(tokenIdNo)
        ]);

        return {
            method: 'price-based',
            ...calculator.updateFromPrices(
                yesPrice?.price || 0.50,
                noPrice?.price || 0.50
            )
        };
    } catch (err) {
        logger.debug(`OBI price fallback failed: ${err.message}`);
        return null;
    }
}
