#!/usr/bin/env node
// One-off enrichment pass: fetch each quest's wiki page and pull its
// "Granted Items" list (items given immediately on quest acceptance,
// distinct from the completion "Rewards" list) into quests.json.
// Safe to re-run — merges into existing quests.json without touching
// previous/next/trader/rewards.

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

function extractItemList(html, headingId) {
  const re = new RegExp(`id="${headingId}">[^<]*<\\/h2><\\/div><section[^>]*>([\\s\\S]*?)<\\/section>`);
  const secM = html.match(re);
  if (!secM) return [];
  const items = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let liM;
  while ((liM = liRe.exec(secM[1])) !== null) {
    const li = liM[1];
    const qtyM = li.match(/^\s*(\d+)\s*×\s*/);
    const qty = qtyM ? parseInt(qtyM[1], 10) : 1;
    const linkM = li.match(/<a href="\/wiki\/([^"#?]+)"[^>]*>([^<]+)<\/a>/);
    let name, itemSlug;
    if (linkM) { itemSlug = decodeURIComponent(linkM[1]); name = linkM[2].trim(); }
    else { name = li.replace(/^\s*\d+\s*×\s*/, '').trim(); itemSlug = null; }
    if (name) items.push({ qty, name, item: itemSlug });
  }
  return items;
}

async function main() {
  const quests = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const slugs = Object.keys(quests);
  console.log(`Checking ${slugs.length} quests for Granted Items…`);

  let withGranted = 0;
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const encoded = slug.replace(/'/g, '%27');
    const url = `https://arcraiders.wiki/wiki/${encoded}`;
    process.stdout.write(`[${String(i + 1).padStart(3)}/${slugs.length}] ${slug.replace(/_/g, ' ').padEnd(36)} `);
    try {
      const { status, body } = await get(url);
      if (status !== 200) { console.log(`SKIP (HTTP ${status})`); continue; }
      const granted = extractItemList(body, 'Granted_Items');
      quests[slug].grantedItems = granted;
      if (granted.length) withGranted++;
      console.log(granted.length ? `${granted.length} granted item${granted.length !== 1 ? 's' : ''}` : '—');
      fs.writeFileSync(OUT, JSON.stringify(quests, null, 2));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. ${withGranted} quests grant items on acceptance.`);
}

main().catch(e => { console.error(e); process.exit(1); });
