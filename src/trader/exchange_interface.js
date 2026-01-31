export class ExchangeInterface {
    constructor() { }

    async init() { throw new Error("Not implemented"); }

    /**
     * @param {string} tokenId
     * @returns {Promise<{bids: {price: number, size: number}[], asks: {price: number, size: number}[]}>}
     */
    async getOrderBook(tokenId) { throw new Error("Not implemented"); }

    /**
     * @param {Object} order
     * @param {string} order.tokenId
     * @param {string} order.side 'BUY' | 'SELL'
     * @param {number} order.price
     * @param {number} order.size
     * @param {string} order.type 'FOK' | 'GTC' | 'IOC'
     */
    async placeOrder(order) { throw new Error("Not implemented"); }

    async cancelOrder(orderId) { throw new Error("Not implemented"); }

    async cancelAll(tokenId) { throw new Error("Not implemented"); }

    async getPositions() { throw new Error("Not implemented"); }

    async getBalance() { throw new Error("Not implemented"); }
}
