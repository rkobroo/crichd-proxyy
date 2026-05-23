const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
const C_TOP = 'https://crichd.top';
const P_ADO = 'https://playerado.top';
const S_LIVE = 'https://raw.githubusercontent.com/srhady/crichd-speical-live-event/main';
const C_LIVE = 'https://raw.githubusercontent.com/srhady/CricketLive/main';
const Z_CDN = 'https://zohanayaan.com:1686';

const cache = { matches: null, tM: 0, snMap: null, tS: 0, strCache: {} };
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
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString(), status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── srhady slug→numeric channel map ──
async function buildChannelMap() {
  if (cache.snMap && Date.now() - cache.tS < 120000) return cache.snMap;
  const map = {};
  try {
    // Fetch playlist.m3u for numeric IDs
    const { text: m3u } = await fetch(`${S_LIVE}/playlist.m3u`);
    for (const line of m3u.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#EXTINF:')) {
        const name = t.replace(/.*?,[\s]*(.*)/, '$1').trim();
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
        map[slug] = { name };
      } else if (t && !t.startsWith('#') && !t.startsWith('#EXT')) {
        const m = t.match(/zohanayaan\.com:1686\/live\/(\d+)\.m3u8/);
        if (m) {
          const ch = m[1];
          for (const key of Object.keys(map)) {
            if (!map[key].id) map[key].id = ch;
          }
          map[`ch${ch}`] = { name: `Channel ${ch}`, id: ch };
        }
      }
    }
    // Fetch Live_Events.json for embed→channel_id mapping
    const { text: je } = await fetch(`${S_LIVE}/Live_Events.json`);
    const events = JSON.parse(je).matches || [];
    for (const ev of events) {
      const fid = (ev.embed || '').match(/id=([^&]+)/);
      const chId = (ev.channel_id || '').match(/(\d+)/);
      if (fid && chId) map[fid[1]] = { name: ev.title || '', id: chId[1] };
    }
    // Fetch Footy data too
    try {
      const { text: fj } = await fetch(`${S_LIVE}/Footy_Live.json`);
      const fEvents = JSON.parse(fj).matches || [];
      for (const ev of fEvents) {
        const fid = (ev.embed || '').match(/id=([^&]+)/);
        const chId = (ev.channel_id || '').match(/(\d+)/);
        if (fid && chId && !map[fid[1]]) map[fid[1]] = { name: ev.title || '', id: chId[1] };
      }
    } catch {}
  } catch {}
  cache.snMap = map;
  cache.tS = Date.now();
  return map;
}

function zohanayaanUrl(chId) {
  const ts = Math.floor(Date.now() / 1000);
  return { url: `${Z_CDN}/live/${chId}.m3u8?md5=${ts}&token=1`, referer: 'https://teachtrendhub.com/' };
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

// ── Get fid from any server URL ──
async function resolveFid(serverUrl) {
  let target = serverUrl;
  if (serverUrl.includes('dadocric.st')) {
    const { text } = await fetch(serverUrl, { headers: { Referer: C_TOP + '/' } });
    const m = text.match(/iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (m) target = m[1];
  }
  const { text } = await fetch(target, { headers: { Referer: serverUrl } });
  return {
    fid: (text.match(/fid="([^"]*)"/) || [])[1],
    v_con: (text.match(/v_con=["'](.*?)["']/) || [])[1] || '',
    v_dt: (text.match(/v_dt=["'](.*?)["']/) || [])[1] || '',
  };
}

// ── Channel ID from slug using srhady map + me.crichd.tv ──
async function channelIdFromSlug(slug) {
  const map = await buildChannelMap();
  if (map[slug] && map[slug].id) return map[slug].id;
  // Try fuzzy match
  for (const [k, v] of Object.entries(map)) {
    if (v.id && (k.includes(slug) || slug.includes(k))) return v.id;
  }
  return null;
}

// ── Try CricketLive repo ──
async function tryCricketLive(title) {
  if (!title) return null;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const pre of ['', 'live-', 'stream-']) {
    try {
      const { text } = await fetch(`https://raw.githubusercontent.com/srhady/CricketLive/main/${pre}${slug}.m3u8`, { timeout: 5000 });
      if (text) {
        const fl = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (fl && fl.includes('.m3u8')) return { url: fl.trim(), referer: 'https://teachtrendhub.com/' };
      }
    } catch {}
  }
  return null;
}

// ── Main stream resolution ──
async function resolveStream(serverUrl, matchTitle) {
  const ck = serverUrl + (matchTitle || '');
  if (cache.strCache[ck] && Date.now() - cache.strCache[ck].time < STTL) return cache.strCache[ck].data;

  const { fid, v_con, v_dt } = await resolveFid(serverUrl);
  if (!fid) return null;

  // Step 1: Try CricketLive direct CDN
  const cl = await tryCricketLive(matchTitle);
  if (cl) { const d = { ...cl, method: 'cricket-live' }; cache.strCache[ck] = { data: d, time: Date.now() }; return d; }

  // Step 2: Build zohanayaan CDN URL from fid→channel_id mapping
  const chId = await channelIdFromSlug(fid);
  if (chId) {
    const { url, referer } = zohanayaanUrl(chId);
    // Verify the URL works (check if CDN responds)
    try {
      const test = await fetch(url, { headers: { Referer: referer }, timeout: 5000 });
      if (test.status === 200 || test.status === 206) {
        const d = { url, referer, method: 'zohanayaan' };
        cache.strCache[ck] = { data: d, time: Date.now() };
        return d;
      }
      // If 403, try with a different timestamp
      const { url: url2 } = zohanayaanUrl(chId);
      const d = { url: url2, referer, method: 'zohanayaan' };
      cache.strCache[ck] = { data: d, time: Date.now() };
      return d;
    } catch {
      // CDN might be down, still return the URL as best effort
      const d = { url, referer, method: 'zohanayaan-best' };
      cache.strCache[ck] = { data: d, time: Date.now() };
      return d;
    }
  }

  // Step 3: Try common channel IDs
  const commonIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 200, 201, 202, 203, 300, 301, 302, 303, 500, 501, 502, 503, 504, 505, 506];
  for (const cid of commonIds) {
    const { url, referer } = zohanayaanUrl(cid);
    try {
      const test = await fetch(url, { headers: { Referer: referer }, timeout: 3000 });
      if (test.status === 200 || test.status === 206) {
        const d = { url, referer, method: `zohanayaan-scan-${cid}` };
        cache.strCache[ck] = { data: d, time: Date.now() };
        // Cache the mapping
        const map = await buildChannelMap();
        map[fid] = { name: matchTitle || fid, id: String(cid) };
        return d;
      }
    } catch {}
  }

  // Step 4: Return fid for client-side
  const d = { fid, v_con, v_dt, method: 'client-fallback' };
  cache.strCache[ck] = { data: d, time: Date.now() };
  return d;
}

// ── Inline proxy for m3u8/TS ──
async function proxyStream(url, referer) {
  const resp = await fetch(url, { headers: { Referer: referer || 'https://teachtrendhub.com/' } });
  const ct = resp.headers['content-type'] || '';
  if (ct.includes('mpegurl') || ct.includes('apple') || url.includes('.m3u8')) {
    const base = url.substring(0, url.lastIndexOf('/') + 1);
    const ref = referer || 'https://teachtrendhub.com/';
    const lines = resp.text.split('\n').map(line => {
      const t = line.trim();
      if (t && !t.startsWith('#') && !t.startsWith('http'))
        return `/api/crichd?action=proxy&url=${encodeURIComponent(base + t)}&referer=${encodeURIComponent(ref)}`;
      return line;
    }).join('\n');
    return { type: 'application/vnd.apple.mpegurl', body: lines };
  }
  return { type: ct || 'video/mp2t', body: resp.text };
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
      const { type, body } = await proxyStream(url, req.query.referer);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=2');
      return res.status(200).send(body);
    }

    if (action === 'servers' && matchUrl) {
      const s = await scrapeServers(matchUrl.startsWith('http') ? matchUrl : C_TOP + matchUrl);
      return res.json({ success: true, servers: s, total: s.length });
    }

    if ((action === 'stream' && streamUrl) || (action === 'resolve' && matchUrl)) {
      const r = await resolveStream(streamUrl || matchUrl, title);
      if (!r) return res.json({ success: false, error: 'Could not extract fid' });
      if (r.url) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host || 'localhost:3000';
        return res.json({
          success: true,
          stream: { url: `${proto}://${host}/api/crichd?action=proxy&url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(r.referer || 'https://teachtrendhub.com/')}` },
          method: r.method,
          directUrl: r.url,
        });
      }
      return res.json({ success: false, fid: r.fid, v_con: r.v_con, v_dt: r.v_dt, method: r.method });
    }

    if (action === 'channels') {
      const map = await buildChannelMap();
      const channels = Object.entries(map).filter(([k, v]) => v.id).map(([k, v]) => ({ slug: k, name: v.name, channelId: v.id, url: zohanayaanUrl(v.id).url }));
      return res.json({ success: true, channels, total: channels.length });
    }

    if (action === 'srhady') {
      const { text: je } = await fetch(`${S_LIVE}/Live_Events.json`);
      const { text: m3u } = await fetch(`${S_LIVE}/playlist.m3u`);
      return res.json({ success: true, events: JSON.parse(je).matches || [], playlist: m3u });
    }

    if (action === 'map') {
      const map = await buildChannelMap();
      return res.json({ success: true, map });
    }

    // Default: match list
    const matches = await scrapeMatches();
    return res.json({ success: true, matches, total: matches.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.json({ success: false, error: err.message, fetchedAt: new Date().toISOString() });
  }
};
