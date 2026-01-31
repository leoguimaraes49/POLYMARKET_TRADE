/**
 * Fetch specific markets by slug to find series IDs
 */
import { fetchMarketBySlug } from '../data/polymarket.js';

const slugs = [
    'sol-updown-15m-1769823900',
    'xrp-updown-15m-1769823900',
    'btc-updown-15m-1769823900',
    'eth-updown-15m-1769823900'
];

async function fetchMarkets() {
    console.log('Fetching specific markets by slug...\n');

    for (const slug of slugs) {
        try {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Slug: ${slug}`);
            console.log('='.repeat(60));

            const market = await fetchMarketBySlug(slug);

            if (market) {
                console.log(`✅ FOUND!`);
                console.log(`   Question: ${market.question}`);
                console.log(`   Event ID: ${market.eventId || market.id || 'N/A'}`);
                console.log(`   Series Slug: ${market.seriesSlug || 'N/A'}`);
                console.log(`   End Date: ${market.endDate}`);
                console.log(`   Token IDs: ${market.clobTokenIds?.length || 0}`);

                if (market.clobTokenIds && market.clobTokenIds.length >= 2) {
                    const tokens = typeof market.clobTokenIds === 'string'
                        ? JSON.parse(market.clobTokenIds)
                        : market.clobTokenIds;
                    console.log(`   UP Token: ${String(tokens[0]).substring(0, 25)}...`);
                    console.log(`   DOWN Token: ${String(tokens[1]).substring(0, 25)}...`);
                }
            } else {
                console.log(`❌ NOT FOUND`);
            }
        } catch (err) {
            console.log(`❌ ERROR: ${err.message}`);
        }
    }
}

fetchMarkets().catch(console.error);
