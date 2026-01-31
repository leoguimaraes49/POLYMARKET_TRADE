/**
 * Advanced Multi-Foreman
 * Integra Score, Regime, Wind e dados Binance
 */
import fs from 'node:fs';
import { resolveMarket, getWindowInfo, SUPPORTED_ASSETS } from '../data/multi_market_resolver.js';
import { BinanceDataFetcher } from '../data/binance_fetcher.js';
import { ScoreCalculator } from './score_calculator.js';
import { RegimeTracker, REGIMES } from './regime_tracker.js';
import { WindCalculator } from './wind_calculator.js';
import { Logger } from '../utils/logger.js';
import { sleep } from '../utils.js';

const logger = new Logger('adv-foreman');

const ORDERS_FILE = "./orders_multi.json";
const STATE_FILE = "./data/foreman_state.json";
const POLL_INTERVAL = 15000;  // 15 segundos

// Risk caps
const RISK_CAPS = {
    max_shares_per_asset: 30,
    max_notional_usd_per_asset: 15,
    max_concurrent: 2,  // Máximo 2 mercados simultâneos
    stop_loss_usd: 3
};

// Componentes
const binance = new BinanceDataFetcher();
const scoreCalc = new ScoreCalculator();
const regimeTracker = new RegimeTracker();
const windCalc = new WindCalculator();

async function run() {
    logger.info("Iniciando Advanced Foreman...");

    while (true) {
        try {
            // 1. Buscar dados Binance
            const binanceData = await binance.getAllAssetsData(Object.keys(SUPPORTED_ASSETS));

            // 2. Calcular score para cada ativo
            const scores = {};
            for (const asset of Object.keys(SUPPORTED_ASSETS)) {
                const data = binanceData[asset];
                if (data) {
                    const scoreResult = scoreCalc.calculateScore(asset, data);
                    scores[asset] = scoreResult;

                    // Atualizar regime
                    regimeTracker.addScore(asset, scoreResult.score);

                    // Atualizar wind
                    windCalc.updateDirection(asset, scoreResult.directions.micro);
                }
            }

            // 3. Resolver mercados Polymarket
            const window = getWindowInfo();
            const assetsData = {};
            let activeCount = 0;
            const scoreAssets = Object.keys(scores);
            const windSum = scoreAssets.reduce((sum, a) => sum + (scores[a]?.directions?.micro || 0), 0);
            const windFactor = scoreAssets.length ? Math.abs(windSum) / scoreAssets.length : 0;

            for (const asset of Object.keys(SUPPORTED_ASSETS)) {
                const market = await resolveMarket(asset);

                if (!market) {
                    logger.debug(`[${asset}] Mercado não encontrado`);
                    continue;
                }

                const score = scores[asset];
                const regime = regimeTracker.getRegime(asset);
                const binData = binanceData[asset];

                const dir = score?.directions?.micro || 0;
                const align = windSum === 0 ? true : Math.sign(dir) === Math.sign(windSum);
                const windBoost = align ? (1.0 + windFactor * 0.2) : (1.0 - windFactor * 0.3);
                const adjustedScore = score ? Math.max(0, Math.min(1, score.score * windBoost)) : 0;

                // Determinar ordem baseado em score + regime
                let order = 'STOP';
                if (score && adjustedScore >= 0.55 && regime !== REGIMES.CHOPPY) {
                    order = 'START';
                    activeCount++;
                } else if (score && adjustedScore >= 0.35) {
                    order = 'HOLD';
                }

                // Verificar limite de concorrência
                if (activeCount > RISK_CAPS.max_concurrent && order === 'START') {
                    order = 'HOLD';  // Demais ficam em HOLD
                    logger.info(`[${asset}] Limite de concorrência atingido, mantendo HOLD`);
                }

                assetsData[asset] = {
                    asset,
                    slug: market.market?.slug,
                    question: market.market?.question,
                    tokens: {
                        up: market.tokens?.up,
                        down: market.tokens?.down
                    },
                    order,
                    ready: !!market.tokens?.up,
                    ready_for_next: regime === REGIMES.STEADY && window.remainingSec <= 180,
                    // Novos dados
                    score: adjustedScore,
                    rawScore: score?.score || 0,
                    windBoost,
                    regime,
                    zScore: binData?.zScore || 0,
                    hasBoost: binData?.hasBoost || false,
                    consistency: {
                        micro: binData?.consistencyMicro || 0,
                        meso: binData?.consistencyMeso || 0,
                        macro: binData?.consistencyMacro || 0
                    },
                    volatility: {
                        vol30mLog: binData?.volatility30mLog || 0,
                        vol24hLog: binData?.volatility24hLog || 0,
                        squeeze: binData?.volSqueeze || false
                    },
                    currentPrice: binData?.currentPrice || 0,
                    components: score?.components || {},
                    divergence: score?.divergence || false
                };
            }

            // 4. Wind global
            const wind = windCalc.exportState();

            // 5. Escrever arquivo de ordens
            const output = {
                timestamp: new Date().toISOString(),
                window: {
                    id: window.windowTimestamp,
                    start: window.startTime.toISOString(),
                    end: window.endTime.toISOString(),
                    elapsed_sec: window.elapsedSec,
                    remaining_sec: window.remainingSec,
                    progress: window.elapsedSec / 900
                },
                assets: assetsData,
                active_count: activeCount,
                risk_caps: RISK_CAPS,
                // Novos dados avançados
                wind,
                regimes: regimeTracker.getAllRegimes(),
                scores: scoreCalc.getAllScores()
            };

            fs.writeFileSync(ORDERS_FILE, JSON.stringify(output, null, 2));

            // 6. Salvar estado do foreman
            const foremanState = {
                lastUpdate: new Date().toISOString(),
                wind,
                regimes: regimeTracker.exportState(),
                scores: scoreCalc.getAllScores()
            };
            fs.writeFileSync(STATE_FILE, JSON.stringify(foremanState, null, 2));

            logger.debug(`Ativos ativos: ${activeCount}, Wind: ${wind.description}`);

        } catch (err) {
            logger.error(`Erro no loop principal: ${err.message}`);
        }

        await sleep(POLL_INTERVAL);
    }
}

run().catch(err => {
    logger.error("Foreman falhou", { error: err.message });
    process.exit(1);
});
