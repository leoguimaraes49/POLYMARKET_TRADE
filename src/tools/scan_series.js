/**
 * Scan range of series IDs looking for crypto 15-min markets
 */
import { CONFIG } from '../config.js';

async function scanSeriesRange(start, end) {
    console.log(`Scanning series IDs ${start} to ${end}...\n`);

    const found = [];

    for (let id = start; id <= end; id++) {
        try {
            const url = new URL('/events', CONFIG.gammaBaseUrl);
            url.searchParams.set('series_id', String(id));
            url.searchParams.set('active', 'true');
            url.searchParams.set('limit', '1');

            const res = await fetch(url);
            const events = await res.json();

            if (events.length > 0) {
                const title = events[0].title || events[0].slug || '';
                const lower = title.toLowerCase();

                // Check if crypto related
                const isCrypto = lower.includes('bitcoin') || lower.includes('btc') ||
                    lower.includes('xrp') || lower.includes('ripple') ||
                    lower.includes('solana') || lower.includes('sol') ||
                    lower.includes('ethereum') || lower.includes('eth') ||
                    lower.includes('up or down') || lower.includes('crypto');

                const is15m = lower.includes('15');

                if (isCrypto) {
                    console.log(`✅ ID ${id}: ${title.substring(0, 60)}...`);
                    found.push({ id, title, is15m });
                }
            }
        } catch (err) {
            // Ignore errors
        }

        // Small delay to not spam API
        await new Promise(r => setTimeout(r, 50));
    }

    console.log('\n' + '='.repeat(70));
    console.log('FOUND CRYPTO SERIES');
    console.log('='.repeat(70));

    for (const f of found) {
        console.log(`\nSeries ID: ${f.id}`);
        console.log(`Title: ${f.title}`);
        console.log(`15-min: ${f.is15m ? 'YES' : 'NO'}`);
    }

    return found;
}

// Scan around the known BTC series
scanSeriesRange(10180, 10220).catch(console.error);
