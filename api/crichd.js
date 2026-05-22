const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
const C_TOP = 'https://crichd.top';
const P_ADO = 'https://playerado.top';
const B_CAST = 'https://bhalocast.com';
const EX_SHIP = 'https://executeandship.com';
const S_LIVE = 'https://raw.githubusercontent.com/srhady/crichd-speical-live-event/main';
const C_LIVE = 'https://raw.githubusercontent.com/srhady/CricketLive/main';

const cache = { matches: null, tM: 0, srhadyEv: null, tS: 0, strCache: {} };
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
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, opts).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString(), status: res.statusCode, headers: res.headers }));
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

/* ── Match scraping ── */
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

/* ── Server scraping ── */
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

/* ── srhady data ── */
async function getSrhadyEv() {
  if (cache.srhadyEv && Date.now() - cache.tS < TTL) return cache.srhadyEv;
  try { const { text } = await fetch(`${S_LIVE}/Live_Events.json`); cache.srhadyEv = JSON.parse(text).matches || []; cache.tS = Date.now(); } catch { cache.srhadyEv = []; }
  return cache.srhadyEv;
}
async function getSrhadyCh() {
  try {
    const { text: m3u } = await fetch(`${S_LIVE}/playlist.m3u`);
    const ch = []; let cur = {};
    for (const l of m3u.split('\n')) {
      const t = l.trim();
      if (t.startsWith('#EXTINF:')) {
        cur = { name: t.replace(/.*?,[\s]*(.*)/, '$1').trim(), logo: (t.match(/tvg-logo="([^"]*)"/) || [])[1] || '', group: (t.match(/group-title="([^"]*)"/) || [])[1] || '' };
      } else if (t.startsWith('#EXTVLCOPT:')) {
        const v = t.replace('#EXTVLCOPT:', '');
        if (v.startsWith('http-referrer=')) cur.referer = v.replace('http-referrer=', '');
      } else if (t && !t.startsWith('#') && cur.name) { cur.url = t; ch.push({ ...cur }); cur = {}; }
    }
    return ch;
  } catch { return []; }
}

/* ── FID extraction ── */
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
    ifUrl,
    serverUrl,
  };
}

/* ── Stream extraction methods ── */

/* Method 1: executeandship.com premiumcr.php (from siam3310's scraper) */
async function m1_execShip(fid) {
  try {
    const url = `${EX_SHIP}/premiumcr.php?player=desktop&live=${fid}`;
    const { text } = await fetch(url, { headers: { Referer: EX_SHIP + '/' }, timeout: 10000 });
    const m3u8 = extractChars(text);
    if (m3u8 && m3u8.includes('.m3u8')) return { url: m3u8, method: 'exec-ship' };
  } catch {}
  return null;
}

/* Method 2: Try executeandship.com with warmup (fetch premium.js first) */
async function m2_execShipWarm(fid) {
  try {
    await fetch(`https:${EX_SHIP}/premium.js`, { headers: { Referer: EX_SHIP + '/' }, timeout: 8000 });
    const url = `${EX_SHIP}/premiumcr.php?player=desktop&live=${fid}`;
    const { text } = await fetch(url, { headers: { Referer: EX_SHIP + '/' }, timeout: 10000 });
    const m3u8 = extractChars(text);
    if (m3u8 && m3u8.includes('.m3u8')) return { url: m3u8, method: 'exec-ship-warm' };
  } catch {}
  return null;
}

/* Method 3: pzo.php */
async function m3_pzo(fid, v_con, v_dt) {
  try {
    const url = `${B_CAST}/pzo.php?v=${fid}&secure=${v_con}&expires=${v_dt || '123456'}`;
    const { text } = await fetch(url, { headers: { Referer: P_ADO + '/' }, timeout: 10000 });
    const m3u8 = extractChars(text) || (text.match(/["'](https?:\/\/[^"']*?bhalocast[^"']*?m3u8[^"']*?)["']/) || [])[1];
    if (m3u8) return { url: (typeof m3u8 === 'string' ? m3u8 : m3u8[1]).replace(/\\\//g, '/'), method: 'pzo' };
  } catch {}
  return null;
}

/* Method 4: news123.php */
async function m4_news123(fid) {
  try {
    const url = `${B_CAST}/news123.php?v=${fid}`;
    const { text } = await fetch(url, { headers: { Referer: P_ADO + '/' }, timeout: 10000 });
    const m3u8 = (text.match(/["'](https?:\/\/[^"']*?bhalocast[^"']*?m3u8[^"']*?)["']/) || [])[1];
    if (m3u8) return { url: m3u8.replace(/\\\//g, '/'), method: 'news123' };
  } catch {}
  return null;
}

/* Method 5: playergo1.php */
async function m5_playergo1(fid, v_con, v_dt) {
  try {
    const url = `https://bhalocast.pro/playergo1.php?v=${fid}&secure=${v_con}&expires=${v_dt || '123456'}`;
    const { text } = await fetch(url, { headers: { Referer: P_ADO + '/' }, timeout: 10000 });
    const m3u8 = extractChars(text) || (text.match(/["'](https?:\/\/[^"']*?m3u8[^"']*?)["']/) || [])[1];
    if (m3u8) return { url: (typeof m3u8 === 'string' ? m3u8 : m3u8[1]).replace(/\\\//g, '/'), method: 'playergo1' };
  } catch {}
  return null;
}

/* Method 6: srhady CDN direct (zohanayaan CDN) — match by fid as channel_id */
async function m6_srhadyCdn(fid, events) {
  for (const ev of events) {
    const evId = (ev.embed || '').match(/id=([^&]+)/);
    if (evId && evId[1] === fid) {
      const ch = (ev.channel_id || '').match(/(\d+)/);
      if (ch) return { url: `https://zohanayaan.com:1686/live/${ch[1]}.m3u8`, method: 'srhady-cdn', referer: 'https://teachtrendhub.com/' };
    }
  }
  return null;
}

/* Method 7: Try alternative base URLs */
async function m7_altEndpoints(fid) {
  const tries = [
    { url: `https://streamcrichd.com/update/willowcricket.php`, ref: 'https://streamcrichd.com/', label: 'streamcrichd' },
  ];
  for (const t of tries) {
    try {
      const { text } = await fetch(t.url, { headers: { Referer: t.ref }, timeout: 8000 });
      const f2 = (text.match(/fid=(["\'])([^"\']+)\1/) || [])[2];
      if (f2) {
        const { text: pText } = await fetch(`${EX_SHIP}/premiumcr.php?player=desktop&live=${f2}`, { headers: { Referer: EX_SHIP + '/' }, timeout: 10000 });
        const m3u8 = extractChars(pText);
        if (m3u8 && m3u8.includes('.m3u8')) return { url: m3u8, method: t.label };
      }
    } catch {}
  }
  return null;
}

/* Method 8: CricketLive repo direct lookup */
async function m8_cricketLive(title) {
  if (!title) return null;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const pre of ['', 'live-', 'stream-']) {
    try {
      const { text } = await fetch(`https://raw.githubusercontent.com/srhady/CricketLive/main/${pre}${slug}.m3u8`, { timeout: 5000 });
      if (text) {
        const fl = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (fl && fl.includes('.m3u8')) return { url: fl.trim(), method: 'cricket-live', referer: 'https://teachtrendhub.com/' };
      }
    } catch {}
  }
  return null;
}

/* ── Main extraction with fallback chain ── */
async function extractStream(serverUrl, title) {
  const ck = serverUrl + (title || '');
  if (cache.strCache[ck] && Date.now() - cache.strCache[ck].time < STTL) return cache.strCache[ck].data;

  const { fid, v_con, v_dt } = await getFid(serverUrl);
  const events = await getSrhadyEv();

  let result = null;

  // Try methods in order: fastest/reliable first
  if (fid) {
    result = await m1_execShip(fid) || await m2_execShipWarm(fid) || await m6_srhadyCdn(fid, events) || await m3_pzo(fid, v_con, v_dt) || await m4_news123(fid) || await m5_playergo1(fid, v_con, v_dt) || await m7_altEndpoints(fid);
  }

  // Try cricket live if title available
  if (!result && title) result = await m8_cricketLive(title);

  if (result) {
    cache.strCache[ck] = { data: result, time: Date.now() };
    return result;
  }

  cache.strCache[ck] = { data: { fid, v_con, v_dt, method: 'client-fallback' }, time: Date.now() };
  return { fid, v_con, v_dt, method: 'client-fallback' };
}

/* ── Inline proxy ── */
async function proxyStream(proxyUrl, referer) {
  const resp = await fetch(proxyUrl, { headers: { Referer: referer || 'https://bhalocast.com/' } });
  const ct = resp.headers['content-type'] || '';
  if (ct.includes('mpegurl') || ct.includes('apple') || proxyUrl.includes('.m3u8')) {
    const base = proxyUrl.substring(0, proxyUrl.lastIndexOf('/') + 1);
    const ref = referer || 'https://bhalocast.com/';
    const lines = resp.text.split('\n').map(line => {
      const t = line.trim();
      if (t && !t.startsWith('#') && !t.startsWith('http')) return `/api/crichd?action=proxy&url=${encodeURIComponent(base + t)}&referer=${encodeURIComponent(ref)}`;
      return line;
    }).join('\n');
    return { type: 'application/vnd.apple.mpegurl', body: lines };
  }
  return { type: ct || 'video/mp2t', body: resp.text };
}

/* ── Handler ── */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action, matchUrl, streamUrl, title, url: pUrl } = req.query;

  try {
    if (action === 'proxy' && pUrl) {
      const { type, body } = await proxyStream(pUrl, req.query.referer);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=2');
      return res.status(200).send(body);
    }

    if (action === 'servers' && matchUrl) {
      const s = await scrapeServers(matchUrl.startsWith('http') ? matchUrl : C_TOP + matchUrl);
      return res.json({ success: true, servers: s, total: s.length });
    }

    if ((action === 'stream' && streamUrl) || action === 'resolve') {
      const r = await extractStream(streamUrl || matchUrl, title);
      if (r && r.url) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host || 'localhost:3000';
        const ref = r.referer || 'https://bhalocast.com/';
        return res.json({ success: true, stream: { url: `${proto}://${host}/api/crichd?action=proxy&url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(ref)}`, headers: { Referer: ref } }, method: r.method, directUrl: r.url });
      }
      return res.json({ success: false, fid: r?.fid, v_con: r?.v_con, v_dt: r?.v_dt, method: r?.method, error: !r?.fid ? 'Could not extract stream' : undefined });
    }

    if (action === 'srhady') {
      const [ev, ch] = await Promise.all([getSrhadyEv(), getSrhadyCh()]);
      return res.json({ success: true, events: ev, channels24: ch, totalEvents: ev.length, totalChannels: ch.length });
    }

    if (action === 'srhady-events') {
      const ev = await getSrhadyEv();
      return res.json({ success: true, events: ev, total: ev.length });
    }

    if (action === 'channels') {
      const ch = await getSrhadyCh();
      return res.json({ success: true, channels: ch, total: ch.length });
    }

    if (action === 'cricket-live' && title) {
      const r = await m8_cricketLive(title);
      if (r) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host || 'localhost:3000';
        const ref = 'https://teachtrendhub.com/';
        return res.json({ success: true, stream: { url: `${proto}://${host}/api/crichd?action=proxy&url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(ref)}` }, method: r.method, directUrl: r.url });
      }
      return res.json({ success: false, error: 'No direct CDN URL found' });
    }

    // Default: matches
    const matches = await scrapeMatches();
    return res.json({ success: true, matches, total: matches.length, fetchedAt: new Date().toISOString() });

  } catch (err) {
    return res.json({ success: false, error: err.message, fetchedAt: new Date().toISOString() });
  }
};
