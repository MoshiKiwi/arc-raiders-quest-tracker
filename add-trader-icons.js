#!/usr/bin/env node
// Fetches each trader's portrait icon from https://arcraiders.wiki/wiki/Traders
// and writes { traderName: iconUrl } to trader-icons.json.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUT = path.join(__dirname, 'trader-icons.json');
const WIKI_ORIGIN = 'https://arcraiders.wiki';

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

async function main() {
  const { status, body } = await get(`${WIKI_ORIGIN}/wiki/Traders`);
  if (status !== 200) throw new Error(`HTTP ${status}`);

  const icons = {};
  const imgRe = /<img[^>]+src="([^"]*Icon_Trader_([A-Za-z_]+)\.png[^"]*)"[^>]*>/g;
  let m;
  while ((m = imgRe.exec(body)) !== null) {
    const name = m[2].replace(/_/g, ' ');
    icons[name] = WIKI_ORIGIN + m[1];
  }

  fs.writeFileSync(OUT, JSON.stringify(icons, null, 2));
  console.log(`Saved ${Object.keys(icons).length} trader icons:`, Object.keys(icons));
}

main().catch(e => { console.error(e); process.exit(1); });
