import WebSocket from "ws";
import { wsAgentForUrl } from "../net/proxy.js";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export class ClobOrderbookStream {
  constructor({ wsUrl }) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.closed = false;
    this.reconnectMs = 500;
    this.subscribed = new Set();
    this.handlers = new Set();
  }

  onUpdate(fn) {
    if (typeof fn === "function") this.handlers.add(fn);
  }

  connect() {
    if (this.closed || !this.wsUrl || this.ws) return;

    const url = this.wsUrl;
    this.ws = new WebSocket(url, { agent: wsAgentForUrl(url), handshakeTimeout: 10_000 });

    const scheduleReconnect = () => {
      if (this.closed) return;
      try {
        this.ws?.terminate();
      } catch {
        // ignore
      }
      this.ws = null;
      const wait = this.reconnectMs;
      this.reconnectMs = Math.min(10_000, Math.floor(this.reconnectMs * 1.5));
      setTimeout(() => this.connect(), wait);
    };

    this.ws.on("open", () => {
      this.reconnectMs = 500;
      for (const tokenId of this.subscribed) {
        this.sendSubscribe(tokenId);
      }
    });

    this.ws.on("message", (buf) => {
      const msg = safeJsonParse(typeof buf === "string" ? buf : buf.toString());
      if (!msg) return;

      const payload = msg.data || msg.payload || msg;
      const tokenId = payload.token_id || payload.tokenId || payload.market;
      const bids = payload.bids || payload.orderbook?.bids;
      const asks = payload.asks || payload.orderbook?.asks;

      if (!tokenId || !Array.isArray(bids) || !Array.isArray(asks)) return;

      for (const handler of this.handlers) {
        try {
          handler({ tokenId, bids, asks });
        } catch {
          // ignore
        }
      }
    });

    this.ws.on("close", scheduleReconnect);
    this.ws.on("error", scheduleReconnect);
  }

  sendSubscribe(tokenId) {
    try {
      this.ws?.send(
        JSON.stringify({
          event: "subscribe",
          channel: "agg_orderbook",
          token_id: tokenId
        })
      );
    } catch {
      // ignore
    }
  }

  subscribe(tokenId) {
    if (!tokenId) return;
    this.subscribed.add(tokenId);
    if (!this.ws) this.connect();
    this.sendSubscribe(tokenId);
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }
}
