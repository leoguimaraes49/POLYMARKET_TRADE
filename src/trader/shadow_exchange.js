import { ExchangeInterface } from "./exchange_interface.js";
import { fetchOrderBook } from "../data/polymarket.js";
import { Logger } from "../utils/logger.js";
import fs from 'node:fs';

const logger = new Logger("shadow-exchange");

export class ShadowExchange extends ExchangeInterface {
    constructor() {
        super();
        this.positions = {}; // { tokenId: size }
        this.orders = []; // { id, tokenId, side, price, size, type, timestamp }
        this.balance = 1000.0; // Start with $1000 fictitious
        this.orderIdCounter = 1;
    }

    async init() {
        logger.info("Shadow Exchange Initialized");
    }

    async getOrderBook(tokenId) {
        // In shadow mode, return simulated orderbook
        // We don't rely on real API which often returns 404
        return {
            bids: [{ price: "0.48", size: "100" }, { price: "0.45", size: "200" }],
            asks: [{ price: "0.52", size: "100" }, { price: "0.55", size: "200" }]
        };
    }

    async placeOrder(order) {
        logger.info(`[SHADOW] Placing Order: ${order.side} ${order.size} @ ${order.price} (${order.type})`);

        // In shadow mode, we simulate fills based on order type
        if (order.type === 'FOK' || order.type === 'IOC') {
            // Simulate fill: assume order can fill if price is reasonable (within 0.40-0.60 range)
            const canFill = order.price >= 0.40 && order.price <= 0.60;

            if (canFill) {
                this.executeFill(order);
                return { status: 'FILLED', orderId: `shadow-${this.orderIdCounter++}` };
            } else {
                return { status: 'KILLED' };
            }
        }

        // GTC orders sit in the book
        const shadowOrder = { ...order, id: `shadow-${this.orderIdCounter++}`, status: 'OPEN' };
        this.orders.push(shadowOrder);
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

    simulateFill(order, book) {
        // Simple logic: if BUY, look at Asks. If SELL, look at Bids.
        // If best ask <= order.price, we fill.
        // Note: Real matching is more complex with size, but we simplify for shadow.

        if (order.side.toUpperCase() === 'BUY') {
            const asks = book.asks || [];
            if (asks.length === 0) return false;
            // Polymarket book format from API might need parsing? 
            // In `polymarket.js`, summarizeOrderBook handles it. 
            // `fetchOrderBook` returns raw JSON. usually { asks: [{price: "0.55", size: "100"}] }

            // Check if any ask is <= order.price and has size
            // We assume full fill for simplicity in this V1
            const bestAsk = parseFloat(asks[0].price);
            return bestAsk <= order.price;
        } else {
            const bids = book.bids || [];
            if (bids.length === 0) return false;
            const bestBid = parseFloat(bids[0].price);
            return bestBid >= order.price;
        }
    }

    executeFill(order) {
        const cost = order.price * order.size;
        if (order.side.toUpperCase() === 'BUY') {
            this.balance -= cost;
            this.positions[order.tokenId] = (this.positions[order.tokenId] || 0) + order.size;
        } else {
            this.balance += cost;
            this.positions[order.tokenId] = (this.positions[order.tokenId] || 0) - order.size;
        }
        logger.info(`[SHADOW] FILLED! Balance: ${this.balance.toFixed(2)}`);
    }

    async getPositions() {
        return this.positions;
    }

    async getBalance() {
        return this.balance;
    }

    exportState(tokens, prices = {}) {
        // Export state to file for dashboard to read
        const state = {
            positions: {
                yes: {
                    shares: this.positions[tokens?.up] || 0,
                    avgPrice: 0.50, // TODO: Track actual avg
                    cost: (this.positions[tokens?.up] || 0) * 0.50
                },
                no: {
                    shares: this.positions[tokens?.down] || 0,
                    avgPrice: 0.50,
                    cost: (this.positions[tokens?.down] || 0) * 0.50
                }
            },
            pendingOrders: this.orders.map(o => ({
                side: o.side,
                price: o.price,
                size: o.size,
                type: o.type
            })),
            prices: {
                yes: prices.yes || 0.50,
                no: prices.no || 0.50
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
