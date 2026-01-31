/**
 * Multi-Asset Market Checker
 * Verifies which 15-minute markets are currently available
 */
import { resolveAllMarkets, getWindowInfo, SUPPORTED_ASSETS } from '../data/multi_market_resolver.js';

async function checkMarkets() {
    console.log('\n' + '='.repeat(70));
    console.log('  POLYMARKET 15-MINUTE MARKETS - MULTI-ASSET CHECK');
    console.log('  Time: ' + new Date().toLocaleString());
    console.log('='.repeat(70));

    // Window info
    const window = getWindowInfo();
    console.log(`\n  Window: ${window.startTime.toLocaleTimeString()} - ${window.endTime.toLocaleTimeString()}`);
    console.log(`  Progress: ${(window.progress * 100).toFixed(1)}% | Remaining: ${window.remainingSec}s`);

    console.log('\n' + '-'.repeat(70));
    console.log('  Checking all supported assets...');
    console.log('-'.repeat(70));

    const markets = await resolveAllMarkets();
    const found = Object.keys(markets);
    const missing = Object.keys(SUPPORTED_ASSETS).filter(a => !found.includes(a));

    // Print found markets
    for (const [asset, market] of Object.entries(markets)) {
        console.log(`\n  ✅ ${asset} (${SUPPORTED_ASSETS[asset].name})`);
        console.log(`     Question: ${market.question}`);
        console.log(`     End: ${new Date(market.endDate).toLocaleTimeString()}`);
        console.log(`     Tokens: UP=${market.tokens.up?.substring(0, 15)}... | DOWN=${market.tokens.down?.substring(0, 15)}...`);
    }

    // Print missing
    for (const asset of missing) {
        console.log(`\n  ❌ ${asset} (${SUPPORTED_ASSETS[asset].name}) - NOT FOUND`);
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    console.log(`  Found: ${found.length}/${Object.keys(SUPPORTED_ASSETS).length} assets`);
    console.log(`  Active: ${found.join(', ') || 'None'}`);
    console.log(`  Missing: ${missing.join(', ') || 'None'}`);
    console.log('='.repeat(70) + '\n');

    return { markets, found, missing };
}

checkMarkets().catch(console.error);
