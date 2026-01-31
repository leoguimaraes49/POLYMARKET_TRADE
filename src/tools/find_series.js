/**
 * Discover all crypto series IDs from Polymarket
 */
import { CONFIG } from '../config.js';

async function findAllSeries() {
    console.log('Searching for crypto 15-min series on Polymarket...\n');

    // Search for events with crypto keywords
    const keywords = ['bitcoin', 'btc', 'xrp', 'ripple', 'solana', 'sol', 'ethereum', 'eth', 'up or down', '15'];

    // Fetch from gamma events endpoint
    const url = new URL('/events', CONFIG.gammaBaseUrl);
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');
    url.searchParams.set('limit', '200');

    const res = await fetch(url);
    const events = await res.json();

    console.log(`Found ${events.length} active events\n`);

    // Filter for 15-min crypto
    const crypto15m = events.filter(e => {
        const title = String(e.title || '').toLowerCase();
        const slug = String(e.slug || '').toLowerCase();
        const series = String(e.seriesSlug || '').toLowerCase();

        const hasCrypto = title.includes('bitcoin') || title.includes('btc') ||
            title.includes('xrp') || title.includes('ripple') ||
            title.includes('solana') || title.includes('sol') ||
            title.includes('ethereum') || title.includes('eth');

        const has15m = title.includes('15') || slug.includes('15') || series.includes('15');
        const hasUpDown = title.includes('up or down') || title.includes('up/down');

        return (hasCrypto && has15m) || (hasUpDown && has15m);
    });

    console.log(`Found ${crypto15m.length} potential 15-min crypto series:\n`);

    // Extract unique series
    const seriesMap = new Map();

    for (const e of crypto15m) {
        const seriesKey = e.seriesSlug || e.slug;
        if (!seriesMap.has(seriesKey)) {
            seriesMap.set(seriesKey, {
                seriesId: e.id,
                title: e.title,
                seriesSlug: e.seriesSlug,
                endDate: e.endDate,
                markets: e.markets?.length || 0
            });
        }
    }

    console.log('='.repeat(70));
    console.log('DISCOVERED 15-MIN CRYPTO SERIES');
    console.log('='.repeat(70));

    for (const [slug, info] of seriesMap) {
        console.log(`\n📊 ${info.title}`);
        console.log(`   Series ID: ${info.seriesId}`);
        console.log(`   Series Slug: ${info.seriesSlug || 'N/A'}`);
        console.log(`   Markets: ${info.markets}`);
    }

    // Also try direct series endpoint
    console.log('\n\n' + '='.repeat(70));
    console.log('TRYING KNOWN SERIES IDS');
    console.log('='.repeat(70));

    const knownIds = [
        { id: '10192', name: 'BTC 15m (current)' },
        { id: '10193', name: 'Possible XRP' },
        { id: '10194', name: 'Possible SOL' },
        { id: '10195', name: 'Possible ETH' },
    ];

    for (const k of knownIds) {
        try {
            const sUrl = new URL(`/events`, CONFIG.gammaBaseUrl);
            sUrl.searchParams.set('series_id', k.id);
            sUrl.searchParams.set('active', 'true');
            sUrl.searchParams.set('limit', '5');

            const sRes = await fetch(sUrl);
            const sEvents = await sRes.json();

            if (sEvents.length > 0) {
                console.log(`\n✅ Series ${k.id}: ${sEvents[0].title || sEvents[0].slug}`);
            } else {
                console.log(`\n❌ Series ${k.id}: No active events`);
            }
        } catch (err) {
            console.log(`\n❌ Series ${k.id}: Error - ${err.message}`);
        }
    }
}

findAllSeries().catch(console.error);
