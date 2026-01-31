import { ExchangeInterface } from "./exchange_interface.js";
import { fetchClobPrice } from "../data/polymarket.js";
import { Logger } from "../utils/logger.js";
import fs from 'node:fs';

const logger = new Logger("shadow-exchange");

// Fee configuration
const FEES = {
    MAKER: 0.00,   // 0% for maker (resting orders)
    TAKER: 0.02    // 2% for taker (aggressive orders FOK/IOC)
};

export class ShadowExchange extends ExchangeInterface {
    constructor() {
        super();
        this.positions = {};      // { tokenId: { size, avgPrice, cost } }
        this.orders = [];         // GTC orders (pending)
        this.pendingFills = [];   // Operations awaiting resolution
        this.filledOrders = [];   // History of filled orders
        this.balance = 100.0;     // Starting balance: $100
        this.totalFees = 0;       // Track total fees paid
        this.orderIdCounter = 1;
        this.priceCache = {};
        this.lastPriceFetch = 0;
    }

    async init() {
        logger.info("Shadow Exchange Initialized (Realistic Mode)");
    }

    async fetchRealPrice(tokenId, side = 'BUY') {
        // Cache prices for 5 seconds to avoid API spam
        const now = Date.now();
        const cacheKey = `${tokenId}-${side}`;

        if (this.priceCache[cacheKey] && (now - this.lastPriceFetch < 5000)) {
            return this.priceCache[cacheKey];
        }

        try {
            const result = await fetchClobPrice({ tokenId, side });
            const price = result?.price || 0.50;
            this.priceCache[cacheKey] = price;
            this.lastPriceFetch = now;
            logger.debug(`Real price fetched: ${side} @ $${price}`);
            return price;
        } catch (err) {
            logger.warn(`Price fetch failed, using default: ${err.message}`);
            return 0.50; // Default if API fails
        }
    }

    async getOrderBook(tokenId) {
        // Build synthetic orderbook from real prices
        try {
            const bidPrice = await this.fetchRealPrice(tokenId, 'SELL');
            const askPrice = await this.fetchRealPrice(tokenId, 'BUY');

            return {
                bids: [{ price: String(bidPrice), size: "100" }],
                asks: [{ price: String(askPrice), size: "100" }]
            };
        } catch (err) {
            // Fallback
            return {
                bids: [{ price: "0.48", size: "100" }],
                asks: [{ price: "0.52", size: "100" }]
            };
        }
    }

    async placeOrder(order) {
        logger.info(`[SHADOW] Placing Order: ${order.side} ${order.size} @ ${order.price} (${order.type})`);

        // Get real market price for this token
        const marketPrice = await this.fetchRealPrice(order.tokenId, order.side);

        if (order.type === 'FOK' || order.type === 'IOC') {
            // For BUY: fill if our limit >= market ask
            // For SELL: fill if our limit <= market bid
            let canFill = false;

            if (order.side.toUpperCase() === 'BUY') {
                canFill = order.price >= marketPrice;
            } else {
                canFill = order.price <= marketPrice;
            }

            if (canFill) {
                this.executeFill(order, marketPrice);
                logger.info(`[SHADOW] FILLED at real price $${marketPrice}`);
                return { status: 'FILLED', orderId: `shadow-${this.orderIdCounter++}`, fillPrice: marketPrice };
            } else {
                logger.info(`[SHADOW] KILLED - limit $${order.price} vs market $${marketPrice}`);
                return { status: 'KILLED' };
            }
        }

        // GTC orders - store for later fill simulation
        const shadowOrder = { ...order, id: `shadow-${this.orderIdCounter++}`, status: 'OPEN', marketPrice };
        this.orders.push(shadowOrder);
        logger.info(`[SHADOW] GTC Order placed, waiting for fill`);
        return { status: 'OPEN', orderId: shadowOrder.id };
    }

    async cancelOrder(orderId) {
        const idx = this.orders.findIndex(o => o.id === orderId);
        if (idx >= 0) {
            this.orders.splice(idx, 1);
            logger.info(`[SHADOW] Cancelled order ${orderId}`);
            return true;
        }
        return false;
    }

    executeFill(order, fillPrice, isTaker = true) {
        const baseCost = fillPrice * order.size;
        const feeRate = isTaker ? FEES.TAKER : FEES.MAKER;
        const fee = baseCost * feeRate;
        const totalCost = baseCost + fee;  // Cost includes fee
        const tokenId = order.tokenId;

        if (order.side.toUpperCase() === 'BUY') {
            this.balance -= totalCost;
            this.totalFees += fee;

            // Track position with average price (cost includes fees)
            if (!this.positions[tokenId]) {
                this.positions[tokenId] = { size: 0, avgPrice: 0, cost: 0 };
            }
            const pos = this.positions[tokenId];
            const newSize = pos.size + order.size;
            const newCost = pos.cost + totalCost;
            pos.avgPrice = newCost / newSize;
            pos.size = newSize;
            pos.cost = newCost;

            // Track as pending fill (awaiting resolution)
            this.pendingFills.push({
                id: `fill-${this.orderIdCounter}`,
                tokenId,
                side: 'BUY',
                size: order.size,
                price: fillPrice,
                fee,
                totalCost,
                timestamp: Date.now(),
                status: 'PENDING_RESOLUTION'
            });

        } else {
            const netProceeds = baseCost - fee;
            this.balance += netProceeds;
            this.totalFees += fee;

            if (this.positions[tokenId]) {
                const pos = this.positions[tokenId];
                const soldCost = pos.avgPrice * order.size;
                pos.size -= order.size;
                pos.cost -= soldCost;
                if (pos.size <= 0) {
                    delete this.positions[tokenId];
                }
            }
        }

        logger.info(`[SHADOW] Balance: $${this.balance.toFixed(2)} (Fee: $${fee.toFixed(4)})`);
    }

    async getPositions() {
        return this.positions;
    }

    async getBalance() {
        return this.balance;
    }

    exportState(tokens, prices = {}) {
        // Calculate totals across ALL positions (not just current window's tokens)
        let totalYesShares = 0, totalYesCost = 0;
        let totalNoShares = 0, totalNoCost = 0;

        for (const [tokenId, pos] of Object.entries(this.positions)) {
            // For now, treat all positions as "yes" since we primarily buy YES
            totalYesShares += pos.size || 0;
            totalYesCost += pos.cost || 0;
        }

        const avgYesPrice = totalYesShares > 0 ? totalYesCost / totalYesShares : 0.50;

        const state = {
            positions: {
                yes: {
                    shares: totalYesShares,
                    avgPrice: avgYesPrice,
                    cost: totalYesCost
                },
                no: {
                    shares: totalNoShares,
                    avgPrice: 0.50,
                    cost: totalNoCost
                }
            },
            pendingOrders: this.orders.map(o => ({
                side: o.side,
                price: o.price,
                size: o.size,
                type: o.type
            })),
            prices: {
                yes: prices.yes || this.priceCache[`${tokens?.up}-BUY`] || 0.50,
                no: prices.no || this.priceCache[`${tokens?.down}-BUY`] || 0.50
            },
            balance: this.balance,
            lastUpdate: new Date().toISOString()
        };

        try {
            fs.writeFileSync('./data/worker_state.json', JSON.stringify(state, null, 2));
        } catch (e) {
            // Ignore write errors
        }
    }
}
