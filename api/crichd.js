const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
const C_TOP = 'https://crichd.top';
const P_ADO = 'https://playerado.top';
const B_CAST = 'https://bhalocast.com';
const EX_SHIP = 'https://executeandship.com';
const S_LIVE = 'https://raw.githubusercontent.com/srhady/crichd-speical-live-event/main';
const C_LIVE = 'https://raw.githubusercontent.com/srhady/CricketLive/main';
const Z_CDN = 'https://zohanayaan.com:1686';

const cache = { matches: null, tM: 0, strCache: {}, chMap: null, tC: 0 };
const TTL = 30000, STTL = 120000;

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'User-Agent': UA, 'Accept': '*/*', ...(opts.headers || {}) },
      timeout: opts.timeout || 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetch(res.headers.location, opts).then(resolve).catch(reject);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), text: () => Buffer.concat(chunks).toString(), status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function extractChars(data) {
  const m = data.match(/return\s*\(\[([\s\S]*?)\]\.join/);
  if (!m) return null;
  const parts = m[1].match(/"([^"]*)"/g);
  if (!parts) return null;
  return parts.map(p => p.replace(/"/g, '')).join('').replace(/\\\//g, '/');
}

// ── Built-in channel map from srhady data ──
async function buildChMap() {
  if (cache.chMap && Date.now() - cache.tC < 120000) return cache.chMap;
  const m = {};
  try {
    const { text: je } = await fetch(`${S_LIVE}/Live_Events.json`);
    for (const ev of (JSON.parse(je).matches || [])) {
      const fid = (ev.embed || '').match(/id=([^&]+)/);
      const cid = (ev.channel_id || '').match(/(\d+)/);
      if (fid && cid) m[fid[1]] = { n: ev.title || '', c: cid[1] };
    }
    const { text: m3u } = await fetch(`${S_LIVE}/playlist.m3u`);
    let cur = {};
    for (const line of m3u.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#EXTINF:')) {
        cur = { name: t.replace(/.*?,[\s]*(.*)/, '$1').trim() };
      } else if (t && !t.startsWith('#')) {
        const z = t.match(/zohanayaan\.com:1686\/live\/(\d+)\.m3u8/);
        if (z) cur.cid = z[1];
      }
    }
  } catch {}
  cache.chMap = m; cache.tC = Date.now();
  return m;
}

function zUrl(cid) {
  return { url: `${Z_CDN}/live/${cid}.m3u8?md5=${Math.floor(Date.now()/1000)}&token=1`, ref: 'https://teachtrendhub.com/' };
}

// ── Match scraping ──
async function scrapeMatches() {
  if (cache.matches && Date.now() - cache.tM < TTL) return cache.matches;
  const { text: html } = await fetch(C_TOP + '/');
  const matches = [];
  for (const row of html.split(/<tr[\s>]/)) {
    if (!row.includes('gametitle')) continue;
    const league = (row.match(/rel="tag">([^<]+)</) || [])[1] || 'Cricket';
    const mu = row.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*itemprop="url">[\s\S]*?<h2\s+class="gametitle"[^>]*>([^<]+)</);
    if (!mu) continue;
    const url = mu[1], title = mu[2].trim();
    const time = (row.match(/<span\s+class="dt">([^<]+)</) || [])[1] || '';
    let day = (row.match(/<small\s+class="post-day"[^>]*>([^<]*)/) || [])[1] || '';
    day = day.replace(/&nbsp;/g, '').trim();
    if (day.includes('Today')) day = 'Today';
    else if (day.includes('Tomorrow')) day = 'Tomorrow';
    const isLive = row.includes('class="liveg');
    const wm = row.match(/<td\s+class="mobile-hide">\s*<a\s+href="(https?:\/\/[^"]+)"[^>]*>Watch/);
    matches.push({ id: new URL(url).pathname, title, league, url, pageUrl: wm ? wm[1] : url, time, day, isLive });
  }
  cache.matches = matches; cache.tM = Date.now();
  return matches;
}

// ── Server scraping ──
async function scrapeServers(matchUrl) {
  const { text: html } = await fetch(matchUrl);
  const servers = [], seen = new Set();
  const add = (n, u) => { if (u && !seen.has(u)) { seen.add(u); servers.push({ name: n, url: u }); } };
  let m;
  const r1 = /<a[^>]+href="(https?:\/\/dadocric\.st\/player\.php\?id=[^"]+)"[^>]*>([^<]*)<\/a>/gi;
  while ((m = r1.exec(html)) !== null) add(m[2].trim() || `S${servers.length+1}`, m[1]);
  const r2 = /<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = r2.exec(html)) !== null) { if (!m[1].includes('chat')) add(`E${servers.length+1}`, m[1]); }
  const r3 = /<a[^>]+href="(https?:\/\/(?!#)[^"]+)"[^>]*>([^<]*(?:player|server|stream|watch|hd|link)[^<]*)<\/a>/gi;
  while ((m = r3.exec(html)) !== null) { const n = m[2].trim(); if (n.length > 2 && n.length < 50) add(n, m[1]); }
  return servers;
}

// ── FID extraction from server URL ──
async function getFid(serverUrl) {
  let ifUrl = serverUrl;
  if (serverUrl.includes('dadocric.st')) {
    const { text } = await fetch(serverUrl, { headers: { Referer: C_TOP + '/' } });
    const m = text.match(/iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (m) ifUrl = m[1];
  }
  const { text } = await fetch(ifUrl, { headers: { Referer: serverUrl } });
  return {
    fid: (text.match(/fid="([^"]*)"/) || [])[1],
    v_con: (text.match(/v_con=["'](.*?)["']/) || [])[1] || '',
    v_dt: (text.match(/v_dt=["'](.*?)["']/) || [])[1] || '',
  };
}

// ── Method 1: executeandship premiumcr.php character array ──
async function m1(fid) {
  try {
    const { text } = await fetch(`${EX_SHIP}/premiumcr.php?player=desktop&live=${fid}`, { headers: { Referer: EX_SHIP + '/' }, timeout: 10000 });
    const url = extractChars(text);
    if (url && url.includes('.m3u8')) return { url, method: 'exship' };
  } catch {}
  return null;
}

// ── Method 2: streamcrichd -> executeandship chain ──
async function m2() {
  try {
    const { text } = await fetch(`https://streamcrichd.com/update/willowcricket.php`, { headers: { Referer: 'https://streamcrichd.com/' }, timeout: 10000 });
    const f2 = (text.match(/fid=(["\'])([^"\']+)\1/) || [])[2];
    if (f2) {
      await fetch(`https:${EX_SHIP}/premium.js`, { headers: { Referer: EX_SHIP + '/' }, timeout: 8000 }).catch(() => {});
      const { text: pText } = await fetch(`${EX_SHIP}/premiumcr.php?player=desktop&live=${f2}`, { headers: { Referer: EX_SHIP + '/' }, timeout: 10000 });
      const url = extractChars(pText);
      if (url && url.includes('.m3u8')) return { url, method: 'streamcrichd' };
    }
  } catch {}
  return null;
}

// ── Method 3: pzo.php (CloudStream 3) ──
async function m3(fid, v_con, v_dt) {
  try {
    const { text } = await fetch(`${B_CAST}/pzo.php?v=${fid}&secure=${v_con}&expires=${v_dt||'123456'}`, { headers: { Referer: P_ADO + '/' }, timeout: 10000 });
    const u = extractChars(text) || (text.match(/["'](https?:\/\/[^"']*?m3u8[^"']*?)["']/) || [])[1];
    if (u) return { url: u.replace(/\\\//g, '/'), method: 'pzo' };
  } catch {}
  return null;
}

// ── Method 4: srhady channel map -> zohanayaan CDN ──
async function m4(fid) {
  const map = await buildChMap();
  if (map[fid] && map[fid].c) {
    const { url, ref } = zUrl(map[fid].c);
    try { const t = await fetch(url, { headers: { Referer: ref }, timeout: 5000 }); if (t.status === 200 || t.status === 206) return { url, referer: ref, method: 'z-cdn' }; } catch {}
    return { url, referer: ref, method: 'z-cdn-best' };
  }
  for (const [, v] of Object.entries(map)) {
    if (!v.c) continue;
    const { url, ref } = zUrl(v.c);
    try { const t = await fetch(url, { headers: { Referer: ref }, timeout: 3000 }); if (t.status === 200 || t.status === 206) return { url, referer: ref, method: 'z-cdn-scan' }; } catch {}
  }
  return null;
}

// ── Method 5: scan known zohanayaan channel IDs ──
async function m5() {
  const ids = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,50,51,52,53,54,55,56,57,58,59,60,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,200,201,202,203,300,301,302,303,500,501,502,503,504,505,506];
  for (const cid of ids) {
    const { url, ref } = zUrl(cid);
    try { const t = await fetch(url, { headers: { Referer: ref }, timeout: 2000 }); if (t.status === 200 || t.status === 206) return { url, referer: ref, method: `z-scan-${cid}` }; } catch {}
  }
  return null;
}

// ── Method 6: CricketLive repo ──
async function m6(title) {
  if (!title) return null;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const pre of ['', 'live-', 'stream-']) {
    try {
      const { text } = await fetch(`https://raw.githubusercontent.com/srhady/CricketLive/main/${pre}${slug}.m3u8`, { timeout: 5000 });
      if (text) {
        const fl = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (fl && fl.includes('.m3u8')) return { url: fl.trim(), referer: 'https://teachtrendhub.com/', method: 'cricket-live' };
      }
    } catch {}
  }
  return null;
}

// ── Main resolver ──
async function resolve(serverUrl, title) {
  const ck = serverUrl + (title || '');
  if (cache.strCache[ck] && Date.now() - cache.strCache[ck].time < STTL) return cache.strCache[ck].data;

  const { fid, v_con, v_dt } = await getFid(serverUrl);
  if (!fid) return null;

  let r = fid ? (await m1(fid)) : null;
  if (!r) r = await m2();
  if (!r && fid) r = await m3(fid, v_con, v_dt);
  if (!r && fid) r = await m4(fid);
  if (!r) r = await m5();
  if (!r) r = await m6(title);

  if (r) { cache.strCache[ck] = { data: r, time: Date.now() }; return r; }
  const d = { fid, v_con, v_dt, method: 'client-fallback' };
  cache.strCache[ck] = { data: d, time: Date.now() };
  return d;
}

// ── Proxy ──
async function doProxy(url, referer) {
  const resp = await fetch(url, { headers: { Referer: referer || 'https://teachtrendhub.com/' } });
  const ct = resp.headers['content-type'] || '';
  if (ct.includes('mpegurl') || ct.includes('apple') || url.includes('.m3u8')) {
    const base = url.substring(0, url.lastIndexOf('/') + 1);
    const ref = referer || 'https://teachtrendhub.com/';
    const body = resp.text().split('\n').map(line => {
      const t = line.trim();
      if (t && !t.startsWith('#') && !t.startsWith('http'))
        return `/api/crichd?action=proxy&url=${encodeURIComponent(base + t)}&referer=${encodeURIComponent(ref)}`;
      return line;
    }).join('\n');
    return { type: 'application/vnd.apple.mpegurl', body };
  }
  return { type: ct || 'video/mp2t', body: resp.buf };
}

// ── Handler ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action, matchUrl, streamUrl, title } = req.query;

  try {
    if (action === 'proxy') {
      const url = req.query.url;
      if (!url) return res.status(400).json({ error: 'Missing url' });
      const { type, body } = await doProxy(url, req.query.referer);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=2');
      return res.status(200).send(body);
    }

    if (action === 'servers' && matchUrl) {
      return res.json({ success: true, servers: await scrapeServers(matchUrl.startsWith('http') ? matchUrl : C_TOP + matchUrl) });
    }

    if ((action === 'stream' && streamUrl) || (action === 'resolve')) {
      const r = await resolve(streamUrl || matchUrl, title);
      if (!r) return res.json({ success: false, error: 'No fid' });
      if (r.url) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host || 'localhost:3000';
        return res.json({ success: true, stream: { url: `${proto}://${host}/api/crichd?action=proxy&url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(r.referer||'https://teachtrendhub.com/')}` }, method: r.method, directUrl: r.url });
      }
      return res.json({ success: false, fid: r.fid, v_con: r.v_con, v_dt: r.v_dt, method: r.method });
    }

    if (action === 'channels') {
      const map = await buildChMap();
      const list = Object.entries(map).filter(([,v]) => v.c).map(([k,v]) => ({ fid: k, name: v.n, channelId: v.c }));
      return res.json({ success: true, channels: list, total: list.length });
    }

    const matches = await scrapeMatches();
    return res.json({ success: true, matches, total: matches.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.json({ success: false, error: err.message, fetchedAt: new Date().toISOString() });
  }
};
