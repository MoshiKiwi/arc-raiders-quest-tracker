#!/usr/bin/env node
// ARC Raiders quest tree scraper
// Usage:  node scrape.js
// Output: quests.json

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUT      = path.join(__dirname, 'quests.json');
const DELAY_MS = 160;

// ── Slugs that are definitely not quests ──────────────────────────────────
const NOT_QUEST = new Set([
  'Quest','Quests',
  'Celeste','Shani','Tian_Wen','Apollo','Lance','Ermal',
  'Dam_Battlegrounds','The_Spaceport','Spaceport','Buried_City',
  'The_Blue_Gate','Blue_Gate','Stella_Montis','Riven_Tides',
  'Weapons','Augments','Shields','Healing','Quick_Use','Grenades','Traps',
  'Projects','Trials','Decks','Skills','Customization',
  'Raider_Hatch','Field_Depot','ARC_Probe','ARC_Courier',
]);
const NOT_QUEST_PREFIX = [
  'Special:','File:','Category:','Talk:','Help:','ARC_Raiders_Wiki:',
];

function isQuest(slug) {
  if (NOT_QUEST.has(slug)) return false;
  if (NOT_QUEST_PREFIX.some(p => slug.startsWith(p))) return false;
  // Items, ammo, gear — anything with a roman numeral or "Mk." is probably not a quest
  if (/\s+(I|II|III|IV|V)$/.test(slug.replace(/_/g,' '))) return false;
  if (slug.includes('_Mk.') || slug.includes('_Ammo') || slug.includes('Blueprint')) return false;
  return true;
}

// ── HTTP GET with redirect follow ─────────────────────────────────────────
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

// The wiki inconsistently cases little words ("of"/"in"/"the") in links
// pointing at the same page (e.g. some pages link Eyes_In_The_Sky, others
// Eyes_in_the_Sky) — both resolve to identical content via a soft redirect.
// Trusting the requested slug as the storage key causes case-variant
// duplicates. Use the page's own canonical URL as the real slug instead.
function extractCanonicalSlug(html, fallbackSlug) {
  const m = html.match(/<link rel="canonical" href="https:\/\/arcraiders\.wiki\/wiki\/([^"]+)"/);
  return m ? decodeURIComponent(m[1]) : fallbackSlug;
}

// ── Parse a quest page ────────────────────────────────────────────────────
function parseQuest(html, slug) {
  // Title: <span class="mw-page-title-main">...</span>
  const titleM = html.match(/<span class="mw-page-title-main">([^<]+)<\/span>/);
  const title = titleM ? titleM[1].trim() : slug.replace(/_/g, ' ');

  // Trader: <th scope="row">Trader</th><td>...Icon_Trader_NAME...
  // The image filename is always Icon_Trader_<Name>.png — most reliable signal
  let trader = '';
  // Cap must exceed the responsive <picture>/<source srcset> markup in the
  // cell (~750 chars) — 600 silently truncated the match on every quest.
  const traderM = html.match(/<th scope="row">Trader<\/th><td>([\s\S]{0,1500}?)<\/td>/);
  if (traderM) {
    const cell = traderM[1];
    // Image filename: Icon_Trader_Shani.png, Icon_Trader_Tian_Wen.png etc.
    const iconM = cell.match(/Icon_Trader_([A-Za-z_]+)\.png/);
    if (iconM) {
      trader = iconM[1].replace(/_/g, ' ');  // "Tian_Wen" -> "Tian Wen"
    }
  }

  // Location: <th scope="row">Location</th><td><ul><li>Any</li></ul></td>
  // or <li><a href="/wiki/Buried_City" title="Buried City">Buried City</a></li> — map name(s), or "Any".
  function extractLocation() {
    const m = html.match(/<th scope="row">Location<\/th><td>([\s\S]{0,600}?)<\/td>/);
    if (!m) return [];
    const cell = m[1];
    const locs = [];
    const liRe = /<li>([\s\S]*?)<\/li>/g;
    let liM;
    while ((liM = liRe.exec(cell)) !== null) {
      const linkM = liM[1].match(/<a[^>]*>([^<]+)<\/a>/);
      locs.push((linkM ? linkM[1] : liM[1]).trim());
    }
    return locs;
  }

  // Objectives: <h2 id="Objectives">Objectives</h2></div><section ...>
  //   <div class="quest-entry">...<div class="quest-label quest-label-standard">TEXT</div></div>...
  // "quest-label-bold" is a section header (e.g. "IN ONE ROUND", meaning every
  // objective below it must be done within a single raid) — not itself a step,
  // but worth surfacing separately since it's a real gameplay constraint.
  function getObjectivesSection() {
    const secM = html.match(/id="Objectives">Objectives<\/h2><\/div><section[^>]*>([\s\S]*?)<\/section>/);
    return secM ? secM[1] : '';
  }
  // Each objective's icon is either icon-checkmark-square (required) or
  // icon-checkmark-circle (optional — e.g. a bonus loot search, not needed
  // to actually complete the quest). Pair each entry's icon with its label
  // so optional steps can be shown without counting toward the step total.
  function extractObjectives() {
    const section = getObjectivesSection();
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
  function extractInOneRound() {
    const section = getObjectivesSection();
    return /<div class="quest-label quest-label-bold">\s*IN ONE ROUND\s*<\/div>/i.test(section);
  }

  // Dialog: <h2 id="Dialog">Dialog</h2></div><section ...>
  //   <p><b>Introduction:</b></p><blockquote><p>TEXT</p>...</blockquote>
  //   ...other stages (Upon Acceptance, Idle, Upon Entering Raid, Upon Completion) follow —
  //   only "Introduction" (the trader's opening line) is captured for the tooltip.
  function extractIntroDialogue() {
    const secM = html.match(/id="Dialog">Dialog<\/h2><\/div><section[^>]*>([\s\S]*?)<\/section>/);
    if (!secM) return '';
    // Label is usually "Introduction:" but some pages use "Introduction" (no colon) or "Intro:"
    const introM = secM[1].match(/<b>(?:Introduction|Intro):?<\/b>\s*<\/p>\s*<blockquote>([\s\S]*?)<\/blockquote>/);
    if (!introM) return '';
    return introM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Previous: <th scope="row">Previous</th><td>...</td>
  // Next:     <th scope="row">Next</th><td>...</td>
  function extractLinks(label) {
    const re = new RegExp(`<th scope="row">${label}<\\/th><td>([\\s\\S]{0,2000}?)<\\/td>`);
    const m = html.match(re);
    if (!m) return [];
    const cell = m[1];
    // "—" means no quests
    if (!cell.includes('href')) return [];
    const links = [];
    const re2 = /href="\/wiki\/([^"#?]+)"/g;
    let hm;
    while ((hm = re2.exec(cell)) !== null) {
      const s = decodeURIComponent(hm[1]);
      if (isQuest(s)) links.push(s);
    }
    return [...new Set(links)]; // dedupe
  }

  // Item lists: <h2 id="HeadingId">Heading</h2></div><section ...><ul><li>N× <a href="/wiki/Slug" title="Name">Label</a></li>...</ul></section>
  // Used for both "Rewards" (given on quest completion) and "Granted_Items"
  // (given immediately on quest acceptance — e.g. starting grenades for a raid objective).
  function extractItemList(headingId) {
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

  return {
    title,
    trader,
    location:     extractLocation(),
    objectives:   extractObjectives(),
    inOneRound:   extractInOneRound(),
    dialogue:     extractIntroDialogue(),
    previous:     extractLinks('Previous'),
    next:         extractLinks('Next'),
    rewards:      extractItemList('Rewards'),
    grantedItems: extractItemList('Granted_Items'),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────
const SEED = [
  'Picking_Up_The_Pieces','Trash_Into_Treasure','Clearer_Skies','Off_The_Radar',
  'A_Bad_Feeling','Hatch_Repairs','The_Right_Tool','Down_To_Earth','A_Better_Use',
  'The_Trifecta','Greasing_Her_Palms','Dormant_Barons','What_We_Left_Behind',
  "Doctor's_Orders",'Broken_Monument','Medical_Merchandise','Marked_For_Death',
  'Straight_Record','A_Reveal_In_Ruins','Market_Correction','Keeping_The_Memory',
  'A_Lay_Of_The_Land','Eyes_On_The_Prize','Echoes_Of_Victory_Ridge','Eyes_In_The_Sky',
  'Industrial_Espionage','A_Balanced_Harvest','Unexpected_Initiative','Untended_Garden',
  'A_Symbol_Of_Unification','After_Rain_Comes','The_Root_Of_The_Matter',
  "The_Major's_Footlocker","Celeste's_Journals",'Water_Troubles','Back_on_Top',
  'Source_Of_The_Contamination','Our_Presence_up_There','Switching_The_Supply',
  'Lost_In_Transmission','A_Warm_Place_To_Rest','Communication_Hideout',
  'Prescriptions_Of_The_Past','Into_The_Fray','Power_Out','Paving_The_Way',
  'Flickering_Threat','Deciphering_The_Data','Bees!','Groundbreaking',
  'Dust_On_The_Wires','Espresso','A_Dead_End','Life_Of_A_Pharmacist',
  'Fragmented_Logs','Safe_Passage','In_My_Image','Tribute_To_Toledo',
  'Furtive_Meetings','With_A_Trace','What_Goes_Around','Cold_Storage',
  'Digging_Up_Dirt','Last_Entry','A_First_Foothold','Battening_Down',
  'Shoring_Up_Defenses','Reduced_To_Rubble',
];

async function main() {
  console.log('ARC Raiders Quest Scraper');
  console.log('─'.repeat(52));

  const visited = new Set();          // requested slugs already dequeued (avoids re-fetching the same href)
  const visitedCanonical = new Set(); // lowercased canonical slugs already stored (avoids case-variant dupes)
  const queue   = [...SEED];
  const quests  = {};

  while (queue.length > 0) {
    const slug = queue.shift();
    if (visited.has(slug)) continue;
    visited.add(slug);

    const encoded = slug.replace(/'/g, '%27');
    const url = `https://arcraiders.wiki/wiki/${encoded}`;
    const n = Object.keys(quests).length + 1;

    process.stdout.write(`[${String(n).padStart(3)}] ${slug.replace(/_/g,' ').padEnd(36)} `);

    try {
      const { status, body } = await get(url);

      if (status !== 200) {
        console.log(`SKIP (HTTP ${status})`);
        continue;
      }

      const canonical = extractCanonicalSlug(body, slug);
      if (visitedCanonical.has(canonical.toLowerCase())) {
        console.log(`DUPLICATE (same page as "${canonical}")`);
        continue;
      }
      visitedCanonical.add(canonical.toLowerCase());

      const data = parseQuest(body, canonical);
      quests[canonical] = data;

      console.log(`trader="${data.trader || '?'}"  prev=${data.previous.length}  next=${data.next.length}`);

      for (const s of [...data.previous, ...data.next]) {
        if (!visited.has(s) && !queue.includes(s) && isQuest(s)) {
          queue.push(s);
        }
      }

      fs.writeFileSync(OUT, JSON.stringify(quests, null, 2));

    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // previous/next entries may still carry whatever casing the linking page
  // used (that's the whole problem) — remap them all to the canonical key
  // actually used to store each quest.
  const lowerToCanonical = {};
  Object.keys(quests).forEach(k => { lowerToCanonical[k.toLowerCase()] = k; });
  Object.values(quests).forEach(entry => {
    ['previous', 'next'].forEach(field => {
      entry[field] = [...new Set((entry[field] || []).map(s => lowerToCanonical[s.toLowerCase()] || s))];
    });
  });
  fs.writeFileSync(OUT, JSON.stringify(quests, null, 2));

  console.log('─'.repeat(52));
  console.log(`Done! ${Object.keys(quests).length} quests → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });