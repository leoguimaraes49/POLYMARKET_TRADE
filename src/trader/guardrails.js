/**
 * Entry Guardrails
 * Implements RHR, OBI, Flips checks before allowing entry
 */
import { Logger } from '../utils/logger.js';

const logger = new Logger('guardrails');

// Configuration
const CONFIG = {
    RHR_THRESHOLD: 0.10,        // Only enter after 10% of window (for testing)
    OBI_BLOCK_THRESHOLD: -0.30, // Block if OBI <= this
    FLIP_SKIP_COUNT: 2,         // Skip if 2+ flips and no shares
    FLIP_RECOVERY_COUNT: 3,     // Recovery mode if 3+ flips with shares
    MIN_STABILITY: 0.6,         // Minimum stability for lock attempts
    MIN_SPREAD: 0.00,           // Minimum spread to enter (0 = no minimum)
    MAX_SPREAD: 0.50,           // Maximum spread (too volatile)
    MAX_PAIR_COST: 0.99         // Max pair cost (bestBidYES + bestBidNO)
};

export class Guardrails {
    constructor(config = {}) {
        this.config = { ...CONFIG, ...config };
    }

    /**
     * Check if RHR has passed (45% of window)
     * @param {number} elapsedSec - Seconds elapsed in current window
     * @param {number} windowSec - Total window size (900 for 15m)
     */
    checkRHR(elapsedSec, windowSec = 900) {
        const progress = elapsedSec / windowSec;
        const passed = progress >= this.config.RHR_THRESHOLD;

        return {
            check: 'RHR',
            passed,
            progress,
            threshold: this.config.RHR_THRESHOLD,
            reason: passed ? null : `Only ${(progress * 100).toFixed(1)}% of window, need ${this.config.RHR_THRESHOLD * 100}%`
        };
    }

    /**
     * Check if OBI is blocking
     * @param {number} obi - Rolling 90s OBI value
     * @param {string} side - 'YES' or 'NO'
     */
    checkOBI(obi, side = 'YES') {
        const blocking = obi <= this.config.OBI_BLOCK_THRESHOLD;

        return {
            check: 'OBI',
            passed: !blocking,
            value: obi,
            threshold: this.config.OBI_BLOCK_THRESHOLD,
            side,
            reason: blocking ? `OBI ${obi.toFixed(2)} <= ${this.config.OBI_BLOCK_THRESHOLD} on ${side}` : null
        };
    }

    /**
     * Check flip count rules
     * @param {number} flipCount - Number of flips in window
     * @param {number} shares - Current shares held
     */
    checkFlips(flipCount, shares) {
        // 2 flips + 0 shares = SKIP
        if (flipCount >= this.config.FLIP_SKIP_COUNT && shares === 0) {
            return {
                check: 'FLIPS',
                passed: false,
                mode: 'SKIP',
                flipCount,
                shares,
                reason: `${flipCount} flips with 0 shares = SKIP`
            };
        }

        // 3 flips + shares = RECOVERY MODE (don't accumulate)
        if (flipCount >= this.config.FLIP_RECOVERY_COUNT && shares > 0) {
            return {
                check: 'FLIPS',
                passed: true,
                mode: 'RECOVERY',
                flipCount,
                shares,
                reason: `${flipCount} flips with ${shares} shares = RECOVERY MODE`
            };
        }

        return {
            check: 'FLIPS',
            passed: true,
            mode: 'NORMAL',
            flipCount,
            shares,
            reason: null
        };
    }

    /**
     * Check market stability
     * @param {number} stability - Stability score (0-1)
     */
    checkStability(stability) {
        const passed = stability >= this.config.MIN_STABILITY;

        return {
            check: 'STABILITY',
            passed,
            value: stability,
            threshold: this.config.MIN_STABILITY,
            reason: passed ? null : `Stability ${stability.toFixed(2)} < ${this.config.MIN_STABILITY}`
        };
    }

    /**
     * Check spread is acceptable
     * @param {number} priceYes 
     * @param {number} priceNo 
     */
    checkSpread(priceYes, priceNo) {
        const spread = Math.abs(priceYes - priceNo);
        const tooNarrow = spread < this.config.MIN_SPREAD;
        const tooWide = spread > this.config.MAX_SPREAD;
        const passed = !tooNarrow && !tooWide;

        return {
            check: 'SPREAD',
            passed,
            value: spread,
            minThreshold: this.config.MIN_SPREAD,
            maxThreshold: this.config.MAX_SPREAD,
            reason: tooNarrow ? `Spread ${spread.toFixed(3)} too narrow` :
                tooWide ? `Spread ${spread.toFixed(3)} too wide` : null
        };
    }

    /**
     * Check pair cost from best bids
     * @param {number|null} pairCost
     */
    checkPairCost(pairCost) {
        if (pairCost === null || pairCost === undefined) {
            return { check: 'PAIR_COST', passed: true, value: null, threshold: this.config.MAX_PAIR_COST, reason: null };
        }
        const passed = pairCost <= this.config.MAX_PAIR_COST;
        return {
            check: 'PAIR_COST',
            passed,
            value: pairCost,
            threshold: this.config.MAX_PAIR_COST,
            reason: passed ? null : `Pair cost ${pairCost.toFixed(3)} > ${this.config.MAX_PAIR_COST}`
        };
    }

    /**
     * Run all guardrail checks
     * Returns overall decision and individual results
     */
    checkAll({
        elapsedSec,
        windowSec = 900,
        obi,
        obiSide = 'YES',
        flipCount,
        shares,
        stability,
        priceYes,
        priceNo,
        foremanOrder = 'START',
        pairCost = null
    }) {
        const results = {
            foreman: {
                check: 'FOREMAN',
                passed: foremanOrder === 'START',
                value: foremanOrder,
                reason: foremanOrder !== 'START' ? `Foreman says ${foremanOrder}` : null
            },
            rhr: this.checkRHR(elapsedSec, windowSec),
            obi: this.checkOBI(obi, obiSide),
            flips: this.checkFlips(flipCount, shares),
            stability: this.checkStability(stability),
            spread: this.checkSpread(priceYes, priceNo),
            pairCost: this.checkPairCost(pairCost)
        };

        // Overall decision
        const allPassed = Object.values(results).every(r => r.passed);
        const blockers = Object.entries(results)
            .filter(([_, r]) => !r.passed)
            .map(([name, r]) => ({ name, reason: r.reason }));

        // Determine mode
        let mode = 'BLOCKED';
        if (allPassed) {
            mode = results.flips.mode === 'RECOVERY' ? 'RECOVERY' : 'ENTRY_ALLOWED';
        }

        return {
            allowed: allPassed,
            mode,
            results,
            blockers,
            summary: allPassed ?
                `Entry allowed (${mode})` :
                `Entry blocked by: ${blockers.map(b => b.name).join(', ')}`
        };
    }
}

// Export singleton for convenience
export const guardrails = new Guardrails();
