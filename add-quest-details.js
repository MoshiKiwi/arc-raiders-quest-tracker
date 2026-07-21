#!/usr/bin/env node
// One-off enrichment pass: fetch each quest's wiki page and pull its
// Location (which map(s) it's available on) and Objectives (the
// step-by-step checklist of what to actually do) into quests.json.
// Safe to re-run — merges into existing quests.json without touching
// previous/next/trader/rewards/grantedItems.

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

function extractLocation(html) {
  const m = html.match(/<th scope="row">Location<\/th><td>([\s\S]{0,600}?)<\/td>/);
  if (!m) return [];
  const locs = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let liM;
  while ((liM = liRe.exec(m[1])) !== null) {
    const linkM = liM[1].match(/<a[^>]*>([^<]+)<\/a>/);
    locs.push((linkM ? linkM[1] : liM[1]).trim());
  }
  return locs;
}

function getObjectivesSection(html) {
  const secM = html.match(/id="Objectives">Objectives<\/h2><\/div><section[^>]*>([\s\S]*?)<\/section>/);
  return secM ? secM[1] : '';
}
// Each objective's icon is either icon-checkmark-square (required) or
// icon-checkmark-circle (optional — e.g. a bonus loot search, not needed to
// actually complete the quest). Pair each entry's icon with its label so
// optional steps can be shown without counting toward the step total.
function extractObjectives(html) {
  const section = getObjectivesSection(html);
  if (!section) return [];
  const objectives = [];
  const entryRe = /entry-icon (icon-checkmark-square|icon-checkmark-circle)"><\/span>[\s\S]*?<div class="quest-label quest-label-standard">([\s\S]*?)<\/div>/g;
  let em;
  while ((em = entryRe.exec(section)) !== null) {
    const optional = em[1] === 'icon-checkmark-circle';
    const text = em[2].replace(/<[^>]+>/g, '').trim();
    if (text) objectives.push({ text, optional });
  }
  return objectives;
}
function extractInOneRound(html) {
  return /<div class="quest-label quest-label-bold">\s*IN ONE ROUND\s*<\/div>/i.test(getObjectivesSection(html));
}

async function main() {
  const quests = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const slugs = Object.keys(quests);
  console.log(`Fetching location + objectives for ${slugs.length} quests…`);

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const encoded = slug.replace(/'/g, '%27');
    const url = `https://arcraiders.wiki/wiki/${encoded}`;
    process.stdout.write(`[${String(i + 1).padStart(3)}/${slugs.length}] ${slug.replace(/_/g, ' ').padEnd(36)} `);
    try {
      const { status, body } = await get(url);
      if (status !== 200) { console.log(`SKIP (HTTP ${status})`); continue; }
      const location = extractLocation(body);
      const objectives = extractObjectives(body);
      const inOneRound = extractInOneRound(body);
      quests[slug].location = location;
      quests[slug].objectives = objectives;
      quests[slug].inOneRound = inOneRound;
      console.log(`loc=${location.join('/') || '?'}  obj=${objectives.length}${inOneRound ? '  [1 round]' : ''}`);
      fs.writeFileSync(OUT, JSON.stringify(quests, null, 2));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
