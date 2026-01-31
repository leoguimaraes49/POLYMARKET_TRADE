/**
 * Leader and Flip Tracker
 * Tracks which side is "winning" and counts leader flips
 */
import { RollingAverage, RollingCounter } from './rolling_average.js';

export class LeaderTracker {
    constructor(windowMs = 90000) {
        this.windowMs = windowMs;
        this.flipCounter = new RollingCounter(windowMs);
        this.leaderHistory = new RollingAverage(windowMs);

        this.currentLeader = null;      // 'YES' or 'NO'
        this.pendingFlip = null;        // For 2-tick persistence
        this.pendingFlipCount = 0;
        this.totalFlips = 0;            // Lifetime flips this window
    }

    /**
     * Update with current prices
     * Returns: { leader, flipped, flipCount }
     */
    update(priceYes, priceNo) {
        const now = Date.now();

        // Determine leader (side with higher price = higher probability)
        const newLeader = priceYes > priceNo ? 'YES' : 'NO';

        // Record leader as numeric for averaging (YES=1, NO=-1)
        this.leaderHistory.add(newLeader === 'YES' ? 1 : -1, now);

        let flipped = false;

        if (this.currentLeader === null) {
            // First update
            this.currentLeader = newLeader;
        } else if (newLeader !== this.currentLeader) {
            // Potential flip - require 2-tick persistence
            if (this.pendingFlip === newLeader) {
                this.pendingFlipCount++;

                if (this.pendingFlipCount >= 2) {
                    // Confirmed flip!
                    this.currentLeader = newLeader;
                    this.flipCounter.record(now);
                    this.totalFlips++;
                    flipped = true;

                    // Reset pending
                    this.pendingFlip = null;
                    this.pendingFlipCount = 0;
                }
            } else {
                // New potential flip
                this.pendingFlip = newLeader;
                this.pendingFlipCount = 1;
            }
        } else {
            // Same leader, reset pending
            this.pendingFlip = null;
            this.pendingFlipCount = 0;
        }

        return {
            leader: this.currentLeader,
            flipped,
            flipCount: this.flipCounter.getCount(),
            totalFlips: this.totalFlips,
            priceYes,
            priceNo,
            spread: Math.abs(priceYes - priceNo)
        };
    }

    /**
     * Get current flip count in window
     */
    getFlipCount() {
        return this.flipCounter.getCount();
    }

    /**
     * Get current leader
     */
    getLeader() {
        return this.currentLeader;
    }

    /**
     * Get leader bias (1 = mostly YES, -1 = mostly NO, 0 = balanced)
     */
    getLeaderBias() {
        const avg = this.leaderHistory.getAverage();
        return avg || 0;
    }

    /**
     * Reset for new window
     */
    resetForNewWindow() {
        this.flipCounter.reset();
        this.totalFlips = 0;
        this.pendingFlip = null;
        this.pendingFlipCount = 0;
        // Keep currentLeader for continuity
    }

    /**
     * Get full state for logging
     */
    getState() {
        return {
            leader: this.currentLeader,
            flipCount: this.flipCounter.getCount(),
            totalFlips: this.totalFlips,
            leaderBias: this.getLeaderBias(),
            pendingFlip: this.pendingFlip,
            pendingFlipCount: this.pendingFlipCount
        };
    }
}
