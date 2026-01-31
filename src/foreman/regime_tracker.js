/**
 * Regime Tracker
 * Rastreia regime do mercado baseado em histórico de scores
 * 
 * Regimes: STEADY, WAKING, FADING, CHOPPY
 */
import { Logger } from '../utils/logger.js';

const logger = new Logger('regime');

// Configuração
const CONFIG = {
    HISTORY_SIZE: 24,          // 24 checks = ~24 minutos (1 check/min) ou ~6h (1 check/15min)
    STEADY_THRESHOLD: 0.15,    // Variação máxima para STEADY
    CONSISTENCY_WINDOW: 6      // Últimos N para calcular consistência
};

// Tipos de regime
export const REGIMES = {
    STEADY: 'STEADY',     // Estável, bom para operar
    WAKING: 'WAKING',     // Despertando, score subindo
    FADING: 'FADING',     // Enfraquecendo, score caindo
    CHOPPY: 'CHOPPY'      // Instável, evitar
};

export class RegimeTracker {
    constructor() {
        this.history = {};  // { asset: [scores...] }
        this.regimes = {};  // { asset: regime }
    }

    /**
     * Adiciona score ao histórico
     */
    addScore(asset, score) {
        if (!this.history[asset]) {
            this.history[asset] = [];
        }

        this.history[asset].push({
            score,
            timestamp: Date.now()
        });

        // Manter apenas últimos N
        if (this.history[asset].length > CONFIG.HISTORY_SIZE) {
            this.history[asset].shift();
        }

        // Recalcular regime
        this.updateRegime(asset);
    }

    /**
     * Calcula estatísticas do histórico
     */
    calculateStats(asset) {
        const hist = this.history[asset] || [];
        if (hist.length < 3) {
            return { avg: 0.5, std: 0.5, trend: 0 };
        }

        const scores = hist.map(h => h.score);
        const n = scores.length;

        // Média
        const avg = scores.reduce((a, b) => a + b, 0) / n;

        // Desvio padrão
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / n;
        const std = Math.sqrt(variance);

        // Tendência (diferença entre primeira e segunda metade)
        const mid = Math.floor(n / 2);
        const first = scores.slice(0, mid);
        const second = scores.slice(mid);
        const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
        const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
        const trend = avgSecond - avgFirst;

        return { avg, std, trend };
    }

    /**
     * Atualiza regime baseado no histórico
     */
    updateRegime(asset) {
        const stats = this.calculateStats(asset);
        let regime = REGIMES.CHOPPY;

        if (stats.std < CONFIG.STEADY_THRESHOLD) {
            // Baixa variação
            if (stats.trend > 0.05) {
                regime = REGIMES.WAKING;  // Subindo de forma estável
            } else if (stats.trend < -0.05) {
                regime = REGIMES.FADING;  // Caindo de forma estável
            } else {
                regime = REGIMES.STEADY;  // Estável
            }
        } else {
            // Alta variação
            regime = REGIMES.CHOPPY;
        }

        this.regimes[asset] = {
            regime,
            stats,
            updatedAt: Date.now()
        };

        return regime;
    }

    /**
     * Obtém regime atual
     */
    getRegime(asset) {
        return this.regimes[asset]?.regime || REGIMES.CHOPPY;
    }

    /**
     * Obtém detalhes do regime
     */
    getRegimeDetails(asset) {
        return this.regimes[asset] || {
            regime: REGIMES.CHOPPY,
            stats: { avg: 0.5, std: 0.5, trend: 0 },
            updatedAt: null
        };
    }

    /**
     * Verifica se é bom para operar
     */
    isGoodToTrade(asset) {
        const regime = this.getRegime(asset);
        return regime === REGIMES.STEADY || regime === REGIMES.WAKING;
    }

    /**
     * Calcula READY_FOR_NEXT
     * Pronto para próxima janela se regime é STEADY e faltam <= 3 minutos
     */
    isReadyForNext(asset, secUntilNext) {
        const regime = this.getRegime(asset);
        return regime === REGIMES.STEADY && secUntilNext <= 180;
    }

    /**
     * Obtém todos os regimes
     */
    getAllRegimes() {
        const result = {};
        for (const asset of Object.keys(this.regimes)) {
            result[asset] = this.regimes[asset].regime;
        }
        return result;
    }

    /**
     * Exporta estado para JSON
     */
    exportState() {
        return {
            regimes: this.regimes,
            historyLengths: Object.fromEntries(
                Object.entries(this.history).map(([k, v]) => [k, v.length])
            )
        };
    }
}
