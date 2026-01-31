/**
 * Rolling Average System
 * Generic system for maintaining 90-second rolling averages of any metric
 */

export class RollingAverage {
    constructor(windowMs = 90000) {
        this.windowMs = windowMs;  // Default 90 seconds
        this.samples = [];  // Array of { timestamp, value }
    }

    /**
     * Add a sample
     */
    add(value, timestamp = Date.now()) {
        this.samples.push({ timestamp, value });
        this.cleanup();
    }

    /**
     * Remove samples outside the window
     */
    cleanup() {
        const cutoff = Date.now() - this.windowMs;
        this.samples = this.samples.filter(s => s.timestamp >= cutoff);
    }

    /**
     * Get the average value
     */
    getAverage() {
        this.cleanup();
        if (this.samples.length === 0) return null;
        const sum = this.samples.reduce((acc, s) => acc + s.value, 0);
        return sum / this.samples.length;
    }

    /**
     * Get the latest value
     */
    getLatest() {
        this.cleanup();
        if (this.samples.length === 0) return null;
        return this.samples[this.samples.length - 1].value;
    }

    /**
     * Get all samples in window
     */
    getSamples() {
        this.cleanup();
        return [...this.samples];
    }

    /**
     * Get count of samples
     */
    getCount() {
        this.cleanup();
        return this.samples.length;
    }

    /**
     * Check if we have enough samples (at least N)
     */
    hasMinSamples(n) {
        this.cleanup();
        return this.samples.length >= n;
    }
}

/**
 * Rolling Counter - For counting events (like flips) in a window
 */
export class RollingCounter {
    constructor(windowMs = 90000) {
        this.windowMs = windowMs;
        this.events = [];  // Array of timestamps
    }

    /**
     * Record an event
     */
    record(timestamp = Date.now()) {
        this.events.push(timestamp);
        this.cleanup();
    }

    /**
     * Remove events outside window
     */
    cleanup() {
        const cutoff = Date.now() - this.windowMs;
        this.events = this.events.filter(t => t >= cutoff);
    }

    /**
     * Get count of events in window
     */
    getCount() {
        this.cleanup();
        return this.events.length;
    }

    /**
     * Reset counter
     */
    reset() {
        this.events = [];
    }
}
