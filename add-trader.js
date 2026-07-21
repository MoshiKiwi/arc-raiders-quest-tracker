#!/usr/bin/env node
// One-off fix pass: the original scraper's trader-cell regex was capped at
// 600 chars, but the cell's responsive <picture>/<source srcset> markup
// runs to ~750 chars, so `trader` silently came back empty for every quest.
// Re-fetches each quest page and fills in the real trader name.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUT      = path.join(__dirname, 'quests.json');
const DELAY_MS = 160;

function get(url, hops = 0) {
  if (hops > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location, hops + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    })
    .on('error', reject)
    .setTimeout(12000, function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function extractTrader(html) {
  const traderM = html.match(/<th scope="row">Trader<\/th><td>([\s\S]{0,1500}?)<\/td>/);
  if (!traderM) return '';
  const iconM = traderM[1].match(/Icon_Trader_([A-Za-z_]+)\.png/);
  return iconM ? iconM[1].replace(/_/g, ' ') : '';
}

async function main() {
  const quests = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const slugs = Object.keys(quests);
  console.log(`Fetching trader for ${slugs.length} quests…`);

  let fixed = 0;
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const encoded = slug.replace(/'/g, '%27');
    const url = `https://arcraiders.wiki/wiki/${encoded}`;
    process.stdout.write(`[${String(i + 1).padStart(3)}/${slugs.length}] ${slug.replace(/_/g, ' ').padEnd(36)} `);
    try {
      const { status, body } = await get(url);
      if (status !== 200) { console.log(`SKIP (HTTP ${status})`); continue; }
      const trader = extractTrader(body);
      quests[slug].trader = trader;
      if (trader) fixed++;
      console.log(trader || '(no trader)');
      fs.writeFileSync(OUT, JSON.stringify(quests, null, 2));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. ${fixed}/${slugs.length} quests now have a trader.`);
}

main().catch(e => { console.error(e); process.exit(1); });
