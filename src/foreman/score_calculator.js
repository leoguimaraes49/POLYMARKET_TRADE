/**
 * Score Calculator
 * Calcula score de convicção baseado em trendiness e estabilidade
 * 
 * Score = micro_t*0.4 + stability*0.3 + meso_t*0.2 + macro_t*0.1
 */
import { Logger } from '../utils/logger.js';

const logger = new Logger('score');

// Configuração
const CONFIG = {
    // Pesos do score
    MICRO_WEIGHT: 0.4,
    STABILITY_WEIGHT: 0.3,
    MESO_WEIGHT: 0.2,
    MACRO_WEIGHT: 0.1,

    // Thresholds
    SCORE_YES: 0.55,    // START
    SCORE_HOLD: 0.35,   // HOLD
    // Abaixo de SCORE_HOLD = STOP

    // Penalidades de divergência
    MICRO_MESO_PENALTY: 0.5,   // micro != meso
    MICRO_MACRO_PENALTY: 0.8   // micro != macro
};

export class ScoreCalculator {
    constructor() {
        this.lastScores = {};  // Por ativo
    }

    /**
     * Calcula trendiness
     * trendiness = abs(net_return) / sum_abs(log_returns)
     * Valor entre 0 e 1: quanto maior, mais direcional
     */
    calculateTrendiness(returns) {
        if (!returns || returns.length === 0) return 0;

        const netReturn = returns.reduce((sum, r) => sum + r, 0);
        const sumAbs = returns.reduce((sum, r) => sum + Math.abs(r), 0);

        if (sumAbs === 0) return 0;
        return Math.abs(netReturn) / sumAbs;
    }

    /**
     * Calcula direção do movimento
     * 1 = up, -1 = down, 0 = neutral
     */
    calculateDirection(returns) {
        if (!returns || returns.length === 0) return 0;
        const net = returns.reduce((sum, r) => sum + r, 0);
        if (net > 0.0001) return 1;
        if (net < -0.0001) return -1;
        return 0;
    }

    /**
     * Calcula estabilidade
     * stability = net_move_abs / (vol_30m * sqrt(minutes))
     */
    calculateStability(netMove, volatility30m, minutes = 30) {
        if (volatility30m === 0) return 1;
        const stability = Math.abs(netMove) / (volatility30m * Math.sqrt(minutes));
        return Math.min(1.0, stability / 0.5);  // Clamp e normaliza
    }

    /**
     * Calcula score completo para um ativo
     * @param {Object} data - { microReturns, mesoReturns, macroReturns, volatility30m, netMove }
     */
    calculateScore(asset, data) {
        const {
            microReturns = [],   // Últimos 30 minutos
            mesoReturns = [],    // Últimas 4 horas
            macroReturns = [],   // Últimas 72 horas
            volatility30m = 0.01,
            netMove = 0
        } = data;

        // Trendiness por timeframe
        const microT = this.calculateTrendiness(microReturns);
        const mesoT = this.calculateTrendiness(mesoReturns);
        const macroT = this.calculateTrendiness(macroReturns);

        // Direções
        const microDir = this.calculateDirection(microReturns);
        const mesoDir = this.calculateDirection(mesoReturns);
        const macroDir = this.calculateDirection(macroReturns);

        // Estabilidade
        const stability = this.calculateStability(netMove, volatility30m);

        // Score base
        let score =
            microT * CONFIG.MICRO_WEIGHT +
            stability * CONFIG.STABILITY_WEIGHT +
            mesoT * CONFIG.MESO_WEIGHT +
            macroT * CONFIG.MACRO_WEIGHT;

        // Penalidades por divergência
        if (microDir !== 0 && mesoDir !== 0 && microDir !== mesoDir) {
            score *= CONFIG.MICRO_MESO_PENALTY;
        }
        if (microDir !== 0 && macroDir !== 0 && microDir !== macroDir) {
            score *= CONFIG.MICRO_MACRO_PENALTY;
        }

        // Determina ordem
        let order = 'STOP';
        if (score >= CONFIG.SCORE_YES) {
            order = 'START';
        } else if (score >= CONFIG.SCORE_HOLD) {
            order = 'HOLD';
        }

        const result = {
            asset,
            score: Math.round(score * 100) / 100,
            order,
            components: {
                microT: Math.round(microT * 100) / 100,
                mesoT: Math.round(mesoT * 100) / 100,
                macroT: Math.round(macroT * 100) / 100,
                stability: Math.round(stability * 100) / 100
            },
            directions: {
                micro: microDir,
                meso: mesoDir,
                macro: macroDir
            },
            divergence: microDir !== mesoDir || microDir !== macroDir
        };

        this.lastScores[asset] = result;
        return result;
    }

    /**
     * Obtém último score calculado
     */
    getLastScore(asset) {
        return this.lastScores[asset] || null;
    }

    /**
     * Obtém todos os scores
     */
    getAllScores() {
        return { ...this.lastScores };
    }
}
