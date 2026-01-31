/**
 * Lock Detector
 * Detects when dual-profit lock is achieved and calculates payoffs
 */
import { Logger } from '../utils/logger.js';

const logger = new Logger('lock');

export class LockDetector {
    constructor() {
        this.locked = false;
        this.lockTimestamp = null;
        this.lockDetails = null;
    }

    /**
     * Calculate payoff for a scenario
     * @param {Object} position - { yesShares, yesCost, noShares, noCost }
     * @param {string} winner - 'YES' or 'NO'
     */
    calculatePayoff(position, winner) {
        const { yesShares, yesCost, noShares, noCost } = position;
        const totalCost = yesCost + noCost;

        if (winner === 'YES') {
            // YES shares worth $1 each, NO shares worth $0
            const proceeds = yesShares * 1.00;
            return proceeds - totalCost;
        } else {
            // NO shares worth $1 each, YES shares worth $0
            const proceeds = noShares * 1.00;
            return proceeds - totalCost;
        }
    }

    /**
     * Calculate pair cost and potential profits
     * @param {Object} position - Current position
     */
    analyzePosition(position) {
        const { yesShares, yesCost, noShares, noCost } = position;
        const totalCost = yesCost + noCost;
        const totalShares = yesShares + noShares;

        // Calculate average prices
        const avgYesPrice = yesShares > 0 ? yesCost / yesShares : 0;
        const avgNoPrice = noShares > 0 ? noCost / noShares : 0;

        // Calculate payoffs
        const pnlIfYesWins = this.calculatePayoff(position, 'YES');
        const pnlIfNoWins = this.calculatePayoff(position, 'NO');

        // Pair cost = total cost for one full pair (1 YES + 1 NO = guaranteed $1)
        // Effective pair cost = total cost / min(yesShares, noShares)
        const pairedShares = Math.min(yesShares, noShares);
        const pairCost = pairedShares > 0 ? totalCost / pairedShares : null;

        // Breakeven check
        const breakevenYes = totalCost;  // Need this much in YES proceeds to break even
        const breakevenNo = totalCost;   // Need this much in NO proceeds to break even

        return {
            // Position
            yesShares,
            noShares,
            yesCost,
            noCost,
            totalCost,
            totalShares,

            // Averages
            avgYesPrice,
            avgNoPrice,
            pairCost,

            // Payoffs
            pnlIfYesWins,
            pnlIfNoWins,

            // Lock status
            isDualLock: pnlIfYesWins > 0 && pnlIfNoWins > 0,
            isBreakeven: pnlIfYesWins >= 0 && pnlIfNoWins >= 0,

            // Deficit (how much to recover on losing side)
            yesDeficit: pnlIfYesWins < 0 ? Math.abs(pnlIfYesWins) : 0,
            noDeficit: pnlIfNoWins < 0 ? Math.abs(pnlIfNoWins) : 0,

            // Which side needs help
            needsRecovery: pnlIfYesWins < 0 || pnlIfNoWins < 0,
            recoverySide: pnlIfYesWins < pnlIfNoWins ? 'YES' : 'NO'
        };
    }

    /**
     * Check if position achieves dual-profit lock
     * @param {Object} position - Current position
     */
    checkLock(position) {
        const analysis = this.analyzePosition(position);

        if (analysis.isDualLock && !this.locked) {
            // Just achieved lock!
            this.locked = true;
            this.lockTimestamp = Date.now();
            this.lockDetails = {
                pnlIfYesWins: analysis.pnlIfYesWins,
                pnlIfNoWins: analysis.pnlIfNoWins,
                position: { ...position }
            };

            logger.info(`🔒 DUAL PROFIT LOCK ACHIEVED!`, {
                yesProfit: analysis.pnlIfYesWins.toFixed(2),
                noProfit: analysis.pnlIfNoWins.toFixed(2)
            });
        }

        return {
            ...analysis,
            locked: this.locked,
            lockTimestamp: this.lockTimestamp
        };
    }

    /**
     * Calculate shares needed for breakeven on deficit side
     * Formula: X = D/(1-P) + B
     * Where: D = deficit, P = current price, B = buffer
     */
    calculateRecoveryShares(deficit, currentPrice, buffer = 2) {
        if (deficit <= 0) return 0;
        if (currentPrice >= 1) return Infinity;  // Can't recover at $1

        const shares = deficit / (1 - currentPrice) + buffer;
        return Math.ceil(shares);
    }

    /**
     * Calculate aggressive lock orders
     * Using the formulas:
     * dW = [L_def*P_L - (W_pnl - Target_W)*(1 - P_L)] / spread
     * dL = [L_def + dW*P_W] / (1 - P_L)
     */
    calculateAggressiveLock({
        winnerShares,
        winnerPrice,
        winnerPnl,
        loserShares,
        loserPrice,
        loserDeficit,
        targetWinnerProfit = 0
    }) {
        const spread = 1.0 - winnerPrice - loserPrice;

        if (spread <= 0) {
            return { error: 'Spread <= 0, cannot calculate' };
        }

        // dW = [L_def*P_L - (W_pnl - Target_W)*(1 - P_L)] / spread
        const dW = (loserDeficit * loserPrice - (winnerPnl - targetWinnerProfit) * (1 - loserPrice)) / spread;

        // dL = [L_def + dW*P_W] / (1 - P_L)
        const dL = (loserDeficit + dW * winnerPrice) / (1 - loserPrice);

        return {
            buyWinner: Math.max(0, Math.ceil(dW)),
            buyLoser: Math.max(0, Math.ceil(dL)),
            spread,
            estimatedCost: dW * winnerPrice + dL * loserPrice
        };
    }

    /**
     * Reset lock state for new window
     */
    reset() {
        this.locked = false;
        this.lockTimestamp = null;
        this.lockDetails = null;
    }

    /**
     * Get current state
     */
    getState() {
        return {
            locked: this.locked,
            lockTimestamp: this.lockTimestamp,
            lockDetails: this.lockDetails
        };
    }
}
