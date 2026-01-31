export class RiskManager {
    constructor(config) {
        this.maxShares = config.max_shares || 100;
        this.maxNotional = config.max_notional_usd || 50;
    }

    checkOrder(order, currentPositions, currentBalance) {
        // 1. Check Max Shares
        if (order.size > this.maxShares) {
            return { ok: false, reason: `Order size ${order.size} exceeds max shares ${this.maxShares}` };
        }

        // 2. Check Max Notional
        const cost = order.price * order.size;
        if (cost > this.maxNotional) {
            return { ok: false, reason: `Order cost ${cost} exceeds max notional ${this.maxNotional}` };
        }

        // 3. Balance Check (Simplified)
        if (order.side === 'BUY' && cost > currentBalance) {
            return { ok: false, reason: `Insufficient balance ${currentBalance} for cost ${cost}` };
        }

        return { ok: true };
    }
}
