#!/usr/bin/env node
// Fetches the real in-game icon image for every unique reward item
// referenced in quests.json, and writes { itemSlug: iconUrl } to
// item-icons.json. Safe to re-run — overwrites the whole file.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const QUESTS_FILE = path.join(__dirname, 'quests.json');
const OUT         = path.join(__dirname, 'item-icons.json');
const DELAY_MS    = 160;
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

// The item's own page always renders its icon as the first real <img> in
// the content (the wiki's page-logo <img class="mw-logo-icon"> comes first
// in the raw HTML but isn't part of the article body, so skip it).
function extractIcon(html) {
  const imgRe = /<img\s[^>]*src="([^"]+)"[^>]*>/g;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    if (m[0].includes('mw-logo-icon')) continue;
    return WIKI_ORIGIN + m[1].trim();
  }
  return null;
}

async function main() {
  const quests = JSON.parse(fs.readFileSync(QUESTS_FILE, 'utf8'));
  const slugs = new Set();
  Object.values(quests).forEach(q => {
    (q.rewards || []).forEach(r => { if (r.item) slugs.add(r.item); });
    (q.grantedItems || []).forEach(r => { if (r.item) slugs.add(r.item); });
  });
  const list = [...slugs].sort();
  console.log(`Fetching icons for ${list.length} unique items…`);

  const icons = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

  for (let i = 0; i < list.length; i++) {
    const slug = list[i];
    const encoded = slug.replace(/'/g, '%27');
    const url = `${WIKI_ORIGIN}/wiki/${encoded}`;
    process.stdout.write(`[${String(i + 1).padStart(3)}/${list.length}] ${slug.padEnd(36)} `);
    try {
      const { status, body } = await get(url);
      if (status !== 200) { console.log(`SKIP (HTTP ${status})`); continue; }
      const icon = extractIcon(body);
      if (icon) { icons[slug] = icon; console.log('ok'); }
      else { console.log('NO ICON FOUND'); }
      fs.writeFileSync(OUT, JSON.stringify(icons, null, 2));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
