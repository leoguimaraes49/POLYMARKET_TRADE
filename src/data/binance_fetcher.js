/**
 * Binance Data Fetcher
 * Busca dados de klines (velas) para cálculo de score/regime
 */
import { Logger } from '../utils/logger.js';

const logger = new Logger('binance');

const BINANCE_BASE = 'https://api.binance.com';

// Mapeamento de ativos para símbolos Binance
const SYMBOL_MAP = {
    'BTC': 'BTCUSDT',
    'SOL': 'SOLUSDT',
    'XRP': 'XRPUSDT',
    'ETH': 'ETHUSDT'
};

export class BinanceDataFetcher {
    constructor() {
        this.cache = {};
        this.lastFetch = {};
    }

    /**
     * Busca klines do Binance
     * @param {string} symbol - Ex: BTCUSDT
     * @param {string} interval - 1m, 5m, 15m, 30m, 1h, 4h, 1d
     * @param {number} limit - Número de velas
     */
    async fetchKlines(symbol, interval = '15m', limit = 30) {
        const cacheKey = `${symbol}-${interval}`;
        const now = Date.now();

        // Cache por 30 segundos
        if (this.cache[cacheKey] && now - this.lastFetch[cacheKey] < 30000) {
            return this.cache[cacheKey];
        }

        try {
            const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error(`Binance error: ${res.status}`);
            }

            const data = await res.json();

            // Parse klines
            const klines = data.map(k => ({
                openTime: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
                closeTime: k[6]
            }));

            this.cache[cacheKey] = klines;
            this.lastFetch[cacheKey] = now;

            return klines;
        } catch (err) {
            logger.warn(`Erro ao buscar klines: ${err.message}`);
            return this.cache[cacheKey] || [];
        }
    }

    /**
     * Calcula retornos a partir de klines
     */
    calculateReturns(klines) {
        if (!klines || klines.length < 2) return [];

        const returns = [];
        for (let i = 1; i < klines.length; i++) {
            const ret = (klines[i].close - klines[i - 1].close) / klines[i - 1].close;
            returns.push(ret);
        }
        return returns;
    }

    /**
     * Calcula log returns
     */
    calculateLogReturns(klines) {
        if (!klines || klines.length < 2) return [];

        const returns = [];
        for (let i = 1; i < klines.length; i++) {
            const prev = klines[i - 1].close;
            const cur = klines[i].close;
            if (!prev || !cur) continue;
            returns.push(Math.log(cur / prev));
        }
        return returns;
    }

    /**
     * Calcula volatilidade a partir de retornos
     */
    calculateVolatility(returns) {
        if (!returns || returns.length < 2) return 0.01;

        const n = returns.length;
        const mean = returns.reduce((a, b) => a + b, 0) / n;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
        return Math.sqrt(variance);
    }

    /**
     * Consistência direcional (% no sinal dominante)
     */
    calculateConsistency(returns) {
        if (!returns || returns.length === 0) return 0;
        let pos = 0;
        let neg = 0;
        for (const r of returns) {
            if (r > 0) pos += 1;
            else if (r < 0) neg += 1;
        }
        const total = pos + neg;
        if (total === 0) return 0;
        return Math.max(pos, neg) / total;
    }

    /**
     * Obtém dados completos para um ativo
     * @param {string} asset - BTC, SOL, XRP
     */
    async getAssetData(asset) {
        const symbol = SYMBOL_MAP[asset];
        if (!symbol) {
            logger.warn(`Símbolo não encontrado para ${asset}`);
            return null;
        }

        try {
            // Buscar diferentes timeframes
            const [klines1m, klines15m, klines1h, klines4h] = await Promise.all([
                this.fetchKlines(symbol, '1m', 30),   // Últimos 30 minutos
                this.fetchKlines(symbol, '15m', 16),  // Últimas 4 horas
                this.fetchKlines(symbol, '1h', 24),   // Últimas 24 horas
                this.fetchKlines(symbol, '4h', 18)    // Últimas 72 horas
            ]);

            // Calcular retornos
            const microReturns = this.calculateReturns(klines1m);      // Micro: 30 min
            const mesoReturns = this.calculateReturns(klines15m);      // Meso: 4h
            const macroReturns = this.calculateReturns(klines4h);      // Macro: 72h
            const microLogReturns = this.calculateLogReturns(klines1m);
            const mesoLogReturns = this.calculateLogReturns(klines15m);
            const macroLogReturns = this.calculateLogReturns(klines4h);

            // Volatilidade 30m (a partir de 1m klines)
            const volatility30m = this.calculateVolatility(microReturns);
            const volatility30mLog = this.calculateVolatility(microLogReturns);
            const volatility24hLog = this.calculateVolatility(this.calculateLogReturns(klines1h));
            const volSqueeze = volatility24hLog > 0 ? volatility30mLog < 0.7 * volatility24hLog : false;

            // Net move (variação total em 30 min)
            const netMove = klines1m.length > 0
                ? (klines1m[klines1m.length - 1].close - klines1m[0].close) / klines1m[0].close
                : 0;

            // Preço atual
            const currentPrice = klines1m.length > 0
                ? klines1m[klines1m.length - 1].close
                : 0;

            // Detectar boost de 2-sigma
            const zScore = volatility30m > 0 ? Math.abs(netMove) / volatility30m : 0;
            const hasBoost = zScore >= 2.0;

            return {
                asset,
                symbol,
                currentPrice,
                microReturns,
                mesoReturns,
                macroReturns,
                microLogReturns,
                mesoLogReturns,
                macroLogReturns,
                consistencyMicro: this.calculateConsistency(microLogReturns),
                consistencyMeso: this.calculateConsistency(mesoLogReturns),
                consistencyMacro: this.calculateConsistency(macroLogReturns),
                volatility30m,
                volatility30mLog,
                volatility24hLog,
                volSqueeze,
                netMove,
                zScore: Math.round(zScore * 100) / 100,
                hasBoost,
                timestamp: Date.now()
            };
        } catch (err) {
            logger.error(`Erro ao obter dados de ${asset}: ${err.message}`);
            return null;
        }
    }

    /**
     * Obtém dados de todos os ativos
     */
    async getAllAssetsData(assets = ['BTC', 'SOL', 'XRP']) {
        const results = {};

        await Promise.all(assets.map(async asset => {
            const data = await this.getAssetData(asset);
            if (data) {
                results[asset] = data;
            }
        }));

        return results;
    }
}
