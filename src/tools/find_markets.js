/**
 * Find all crypto 15-min markets - shows actual slugs
 */
import { fetchActiveMarkets } from '../data/polymarket.js';

async function findCryptoMarkets() {
    console.log('Fetching markets...');
    const markets = await fetchActiveMarkets({ limit: 500 });

    // Find all markets that might be crypto 15-min
    const crypto15m = markets.filter(m => {
        const q = String(m.question || '').toLowerCase();
        const slug = String(m.slug || '').toLowerCase();

        return (
            (q.includes('15') || slug.includes('15')) &&
            (q.includes('bitcoin') || q.includes('btc') ||
                q.includes('xrp') || q.includes('ripple') ||
                q.includes('solana') || q.includes('sol') ||
                q.includes('ethereum') || q.includes('eth') ||
                q.includes('up or down'))
        );
    });

    console.log(`\nFound ${crypto15m.length} potential 15-min crypto markets:\n`);

    for (const m of crypto15m.slice(0, 20)) {
        console.log('---');
        console.log(`Slug: ${m.slug}`);
        console.log(`Question: ${m.question}`);
        console.log(`End: ${m.endDate}`);
        if (m.clobTokenIds) {
            console.log(`Tokens: ${m.clobTokenIds.length}`);
        }
    }

    // Also show unique slug prefixes
    const prefixes = new Set();
    for (const m of crypto15m) {
        const parts = m.slug.split('-');
        if (parts.length >= 3) {
            prefixes.add(parts.slice(0, 3).join('-'));
        }
    }

    console.log('\n=== Unique Slug Prefixes ===');
    for (const p of prefixes) {
        console.log(`  ${p}`);
    }
}

findCryptoMarkets().catch(console.error);
