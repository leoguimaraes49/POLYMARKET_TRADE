/**
 * Search for XRP and Solana 15-min series specifically
 */
import { CONFIG } from '../config.js';

async function searchCryptoSeries() {
    console.log('Searching for XRP and Solana series...\n');

    // First, try to find via events search
    const url = new URL('/events', CONFIG.gammaBaseUrl);
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');
    url.searchParams.set('limit', '500');

    console.log('Fetching all active events...');
    const res = await fetch(url);
    const allEvents = await res.json();
    console.log(`Total events: ${allEvents.length}\n`);

    // Search for XRP
    const xrpEvents = allEvents.filter(e => {
        const t = String(e.title || e.slug || '').toLowerCase();
        return t.includes('xrp') || t.includes('ripple');
    });

    // Search for Solana
    const solEvents = allEvents.filter(e => {
        const t = String(e.title || e.slug || '').toLowerCase();
        return t.includes('solana') || (t.includes('sol') && t.includes('up'));
    });

    // Search for any "Up or Down" crypto
    const upDownEvents = allEvents.filter(e => {
        const t = String(e.title || e.slug || '').toLowerCase();
        return t.includes('up or down') || t.includes('up/down');
    });

    console.log('='.repeat(60));
    console.log('XRP EVENTS');
    console.log('='.repeat(60));
    for (const e of xrpEvents.slice(0, 10)) {
        console.log(`ID: ${e.id} | ${e.title}`);
    }
    if (xrpEvents.length === 0) console.log('No XRP events found');

    console.log('\n' + '='.repeat(60));
    console.log('SOLANA EVENTS');
    console.log('='.repeat(60));
    for (const e of solEvents.slice(0, 10)) {
        console.log(`ID: ${e.id} | ${e.title}`);
    }
    if (solEvents.length === 0) console.log('No Solana events found');

    console.log('\n' + '='.repeat(60));
    console.log('ALL "UP OR DOWN" EVENTS');
    console.log('='.repeat(60));
    for (const e of upDownEvents.slice(0, 20)) {
        console.log(`ID: ${e.id} | ${e.title}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`XRP events: ${xrpEvents.length}`);
    console.log(`Solana events: ${solEvents.length}`);
    console.log(`Up/Down events: ${upDownEvents.length}`);
}

searchCryptoSeries().catch(console.error);
