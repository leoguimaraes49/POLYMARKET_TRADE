/**
 * Global Wind Calculator
 * Calcula direção geral do mercado agregando todos os ativos
 */
import { Logger } from '../utils/logger.js';

const logger = new Logger('wind');

export class WindCalculator {
    constructor() {
        this.directions = {};  // { asset: direction }
        this.lastWind = 0;
    }

    /**
     * Atualiza direção de um ativo
     * @param {string} asset 
     * @param {number} direction - 1 (up), -1 (down), 0 (neutral)
     */
    updateDirection(asset, direction) {
        this.directions[asset] = direction;
        this.calculateWind();
    }

    /**
     * Calcula wind global
     * Wind = soma das direções / número de ativos
     * Range: -1 (todos down) a +1 (todos up)
     */
    calculateWind() {
        const assets = Object.keys(this.directions);
        if (assets.length === 0) {
            this.lastWind = 0;
            return 0;
        }

        const sum = Object.values(this.directions).reduce((a, b) => a + b, 0);
        this.lastWind = sum / assets.length;
        return this.lastWind;
    }

    /**
     * Obtém wind atual
     */
    getWind() {
        return this.lastWind;
    }

    /**
     * Obtém interpretação do wind
     */
    getWindDescription() {
        if (this.lastWind > 0.5) return 'FORTE ALTA';
        if (this.lastWind > 0.2) return 'ALTA';
        if (this.lastWind > -0.2) return 'NEUTRO';
        if (this.lastWind > -0.5) return 'BAIXA';
        return 'FORTE BAIXA';
    }

    /**
     * Verifica se ativo está alinhado com wind
     * @param {string} asset 
     * @returns {number} - Multiplicador (1.2 se alinhado, 0.8 se contra, 1.0 se neutro)
     */
    getAlignmentMultiplier(asset) {
        const assetDir = this.directions[asset] || 0;

        if (this.lastWind > 0.3 && assetDir > 0) {
            return 1.2;  // Alinhado com wind positivo
        }
        if (this.lastWind < -0.3 && assetDir < 0) {
            return 1.2;  // Alinhado com wind negativo
        }
        if (this.lastWind > 0.3 && assetDir < 0) {
            return 0.8;  // Contra wind positivo
        }
        if (this.lastWind < -0.3 && assetDir > 0) {
            return 0.8;  // Contra wind negativo
        }
        return 1.0;  // Neutro
    }

    /**
     * Exporta estado
     */
    exportState() {
        return {
            wind: Math.round(this.lastWind * 100) / 100,
            description: this.getWindDescription(),
            directions: { ...this.directions }
        };
    }
}
