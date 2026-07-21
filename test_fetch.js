// Run this: node test_fetch.js
// It prints the raw HTML section around the infobox so we can see the real structure

const https = require('https');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    }, r => {
      if (r.statusCode >= 300 && r.headers.location) {
        res.resume();
        return get(r.headers.location).then(res).catch(rej);
      }
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    }).on('error', rej);
  });
}

get('https://arcraiders.wiki/wiki/Picking_Up_The_Pieces').then(html => {
  console.log('=== STATUS: got', html.length, 'bytes ===\n');

  // Print 400 chars around the h1
  const h1 = html.indexOf('<h1');
  console.log('=== AROUND H1 ===');
  console.log(html.slice(h1, h1 + 200));

  // Print 800 chars around "Trader"
  const ti = html.indexOf('Trader');
  console.log('\n=== FIRST "Trader" OCCURRENCE ===');
  console.log(JSON.stringify(html.slice(Math.max(0, ti - 50), ti + 300)));

  // Find all "Trader" occurrences with context
  let idx = 0, count = 0;
  while ((idx = html.indexOf('Trader', idx)) !== -1 && count < 5) {
    console.log(`\n--- Trader at pos ${idx} ---`);
    console.log(JSON.stringify(html.slice(Math.max(0, idx-30), idx+150)));
    idx++; count++;
  }

  // Print 600 chars around "Related Quests"
  const rq = html.indexOf('Related Quests');
  console.log('\n=== AROUND "Related Quests" ===');
  console.log(JSON.stringify(html.slice(Math.max(0, rq - 30), rq + 600)));

}).catch(e => console.error('FETCH ERROR:', e.message));
