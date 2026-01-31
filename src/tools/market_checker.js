/**
 * Market Checker - Verifies available 15-minute markets for BTC, XRP, SOL
 * Run with: node src/tools/market_checker.js
 */

import { fetchActiveMarkets, pickLatestLiveMarket } from '../data/polymarket.js';

const ASSETS = [
    { name: 'Bitcoin', slugPrefix: 'btc-updown-15m', symbol: 'BTC' },
    { name: 'XRP', slugPrefix: 'xrp-updown-15m', symbol: 'XRP' },
    { name: 'Solana', slugPrefix: 'sol-updown-15m', symbol: 'SOL' },
    { name: 'Ethereum', slugPrefix: 'eth-updown-15m', symbol: 'ETH' },
];

function printHeader() {
    console.log('\n' + '='.repeat(70));
    console.log('  POLYMARKET 15-MINUTE MARKETS CHECKER');
    console.log('  ' + new Date().toLocaleString());
    console.log('='.repeat(70));
}

function printMarketInfo(asset, market) {
    if (!market) {
        console.log(`\n❌ ${asset.symbol} (${asset.name})`);
        console.log(`   Status: NO ACTIVE MARKET FOUND`);
        console.log(`   Slug prefix: ${asset.slugPrefix}*`);
        return false;
    }

    const endTime = new Date(market.endDate);
    const now = new Date();
    const remainingMs = endTime - now;
    const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
    const remainingMin = Math.floor(remainingSec / 60);
    const remainingSecs = remainingSec % 60;

    console.log(`\n✅ ${asset.symbol} (${asset.name})`);
    console.log(`   Market: ${market.question || market.slug}`);
    console.log(`   Slug: ${market.slug}`);
    console.log(`   End Time: ${endTime.toLocaleTimeString()}`);
    console.log(`   Remaining: ${remainingMin}m ${remainingSecs}s`);

    // Token IDs
    if (market.clobTokenIds && market.clobTokenIds.length >= 2) {
        console.log(`   Token UP:   ${market.clobTokenIds[0].substring(0, 20)}...`);
        console.log(`   Token DOWN: ${market.clobTokenIds[1].substring(0, 20)}...`);
    }

    return true;
}

async function checkMarkets() {
    printHeader();

    console.log('\nFetching active markets from Polymarket...');

    let allMarkets;
    try {
        allMarkets = await fetchActiveMarkets({ limit: 200 });
        console.log(`Found ${allMarkets.length} total active markets.`);
    } catch (err) {
        console.error('Error fetching markets:', err.message);
        return;
    }

    let foundCount = 0;
    const results = [];

    for (const asset of ASSETS) {
        // Filter markets for this asset
        const assetMarkets = allMarkets.filter(m => {
            const slug = String(m.slug || '').toLowerCase();
            return slug.startsWith(asset.slugPrefix);
        });

        console.log(`\nSearching for ${asset.symbol} markets (prefix: ${asset.slugPrefix}*)...`);
        console.log(`   Found ${assetMarkets.length} matching markets`);

        // Pick the current live one
        const liveMarket = pickLatestLiveMarket(assetMarkets);

        const found = printMarketInfo(asset, liveMarket);
        if (found) foundCount++;

        results.push({
            asset: asset.symbol,
            found: !!liveMarket,
            market: liveMarket
        });
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    console.log(`  Markets found: ${foundCount}/${ASSETS.length}`);

    for (const r of results) {
        console.log(`  ${r.found ? '✅' : '❌'} ${r.asset}: ${r.found ? 'ACTIVE' : 'NOT FOUND'}`);
    }

    console.log('\n' + '='.repeat(70));

    return results;
}

// Run
checkMarkets().catch(console.error);
