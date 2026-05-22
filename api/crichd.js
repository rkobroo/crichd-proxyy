const https = require('https');
const http = require('http');

const BASE_URL = 'https://crichd.top';
const PLAYERADO_URL = 'https://playerado.top';
const BHALOCAST_URL = 'https://bhalocast.com';
const SRHADY_REPO = 'https://raw.githubusercontent.com/srhady/crichd-speical-live-event/main';
const CRICKET_LIVE = 'https://raw.githubusercontent.com/srhady/CricketLive/main';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

const cache = { matches: null, matchTime: 0, srhadyEvents: null, srhadyTime: 0, streamCache: {} };
const TTL = 30000;
const STREAM_TTL = 120000;

function httpFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search, method: opts.method || 'GET',
      headers: {
        'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.5',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpFetch(res.headers.location, opts).then(resolve).catch(reject);
        return;
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

// ── Match Scraping ──
async function scrapeMatches() {
  if (cache.matches && Date.now() - cache.matchTime < TTL) return cache.matches;
  const { text: html } = await httpFetch(BASE_URL + '/');
  const matches = [];
  const rows = html.split(/<tr[\s>]/);
  for (const row of rows) {
    if (!row.includes('gametitle')) continue;
    const leagueMatch = row.match(/rel="tag">([^<]+)</);
    const league = leagueMatch ? leagueMatch[1].trim() : 'Cricket';
    const urlMatch = row.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*itemprop="url">[\s\S]*?<h2\s+class="gametitle"[^>]*>([^<]+)</);
    if (!urlMatch) continue;
    const matchUrl = urlMatch[1], title = urlMatch[2].trim();
    const timeMatch = row.match(/<span\s+class="dt">([^<]+)</);
    const time = timeMatch ? timeMatch[1].trim() : '';
    const dayMatch = row.match(/<small\s+class="post-day"[^>]*>([^<]*)/);
    let day = dayMatch ? dayMatch[1].replace(/&nbsp;/g, '').trim() : '';
    if (day.includes('Today')) day = 'Today';
    else if (day.includes('Tomorrow')) day = 'Tomorrow';
    const isLive = row.includes('class="liveg');
    const watchMatch = row.match(/<td\s+class="mobile-hide">\s*<a\s+href="(https?:\/\/[^"]+)"[^>]*>Watch/);
    const pageUrl = watchMatch ? watchMatch[1] : matchUrl;
    matches.push({ id: new URL(matchUrl).pathname, title, league, url: matchUrl, pageUrl, time, day, isLive });
  }
  cache.matches = matches;
  cache.matchTime = Date.now();
  return matches;
}

// ── Server Scraping ──
async function scrapeServers(matchUrl) {
  const { text: html } = await httpFetch(matchUrl);
  const servers = [];
  const seen = new Set();
  const add = (name, url) => { if (url && !seen.has(url)) { seen.add(url); servers.push({ name, url }); } };
  let m;
  const re1 = /<a[^>]+href="(https?:\/\/dadocric\.st\/player\.php\?id=[^"]+)"[^>]*>([^<]*)<\/a>/gi;
  while ((m = re1.exec(html)) !== null) add(m[2].trim() || `Server ${servers.length+1}`, m[1]);
  const re2 = /<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = re2.exec(html)) !== null) { if (!m[1].includes('chat') && !m[1].includes('histats')) add(`Embed ${servers.length+1}`, m[1]); }
  const re3 = /<a[^>]+href="(https?:\/\/(?!#)[^"]+)"[^>]*>([^<]*(?:player|server|stream|watch|hd|link)[^<]*)<\/a>/gi;
  while ((m = re3.exec(html)) !== null) { const n = m[2].trim(); if (n.length > 2 && n.length < 50) add(n, m[1]); }
  return servers;
}

// ── srhady Data ──
async function fetchSrhadyEvents() {
  if (cache.srhadyEvents && Date.now() - cache.srhadyTime < TTL) return cache.srhadyEvents;
  try {
    const { text } = await httpFetch(`${SRHADY_REPO}/Live_Events.json`);
    cache.srhadyEvents = JSON.parse(text).matches || [];
    cache.srhadyTime = Date.now();
  } catch { cache.srhadyEvents = []; }
  return cache.srhadyEvents;
}

async function fetchSrhadyChannels() {
  try {
    const { text: m3u } = await httpFetch(`${SRHADY_REPO}/playlist.m3u`);
    const channels = [];
    let cur = {};
    for (const line of m3u.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#EXTINF:')) {
        cur = {
          name: t.replace(/.*?,[\s]*(.*)/, '$1').trim(),
          logo: (t.match(/tvg-logo="([^"]*)"/) || [])[1] || '',
          group: (t.match(/group-title="([^"]*)"/) || [])[1] || '',
        };
      } else if (t.startsWith('#EXTVLCOPT:')) {
        const val = t.replace('#EXTVLCOPT:', '');
        if (val.startsWith('http-referrer=')) cur.referer = val.replace('http-referrer=', '');
      } else if (t && !t.startsWith('#') && cur.name) {
        cur.url = t;
        channels.push({ ...cur });
        cur = {};
      }
    }
    return channels;
  } catch { return []; }
}

// ── Extract FID from embed2.php ──
async function extractFid(serverUrl) {
  let iframeUrl = serverUrl;
  if (serverUrl.includes('dadocric.st')) {
    const { text } = await httpFetch(serverUrl, { headers: { Referer: BASE_URL + '/' } });
    const m = text.match(/iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (m) iframeUrl = m[1];
  }
  const { text } = await httpFetch(iframeUrl, { headers: { Referer: serverUrl } });
  const fid = (text.match(/fid="([^"]*)"/) || [])[1];
  const v_con = (text.match(/v_con=["'](.*?)["']/) || [])[1] || '';
  const v_dt = (text.match(/v_dt=["'](.*?)["']/) || [])[1] || '';
  return { fid, v_con, v_dt, iframeUrl };
}

// ── Try pzo.php extraction (from CloudStream 3 approach) ──
async function tryPzoExtract(fid, v_con, v_dt) {
  const url = `${BHALOCAST_URL}/pzo.php?v=${fid}&secure=${v_con}&expires=${v_dt || '123456'}`;
  try {
    const { text } = await httpFetch(url, { headers: { Referer: PLAYERADO_URL + '/' }, timeout: 10000 });
    // pzo.php returns HTML with decoded m3u8 URL or redirect
    const m3u8 = text.match(/["'](https?:\/\/[^"']*?bhalocast[^"']*?m3u8[^"']*?)["']/);
    if (m3u8) return { url: m3u8[1].replace(/\\\//g, '/'), method: 'pzo' };
    // Sometimes returns a JavaScript redirect with the URL
    const jsUrl = text.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/);
    if (jsUrl) return { url: jsUrl[1].replace(/\\\//g, '/'), method: 'pzo' };
    // Try to extract from embedded redirect
    const loc = text.match(/location\.href\s*=\s*["']([^"']+)["']/);
    if (loc) {
      const { text: locText } = await httpFetch(loc[1], { headers: { Referer: url }, timeout: 10000 });
      const m2 = locText.match(/["'](https?:\/\/[^"']*?bhalocast[^"']*?m3u8[^"']*?)["']/);
      if (m2) return { url: m2[1].replace(/\\\//g, '/'), method: 'pzo' };
    }
  } catch {}
  return null;
}

// ── Try playergo1.php fallback ──
async function tryPlayerGo(fid, v_con, v_dt) {
  const url = `https://bhalocast.pro/playergo1.php?v=${fid}&secure=${v_con}&expires=${v_dt || '123456'}`;
  try {
    const { text } = await httpFetch(url, { headers: { Referer: PLAYERADO_URL + '/' }, timeout: 10000 });
    const m = text.match(/["'](https?:\/\/[^"']*?m3u8[^"']*?)["']/);
    if (m) return { url: m[1].replace(/\\\//g, '/'), method: 'playergo1' };
  } catch {}
  return null;
}

// ── Try direct CDN via srhady match title matching ──
async function trySrhadyDirect(title, events) {
  const t = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  // Look through Live_Events.json for matching title
  for (const ev of events) {
    const et = (ev.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (!et) continue;
    // Match if one contains the other or similar
    const tParts = t.split(/\s+/).filter(s => s.length > 2);
    const etParts = et.split(/\s+/).filter(s => s.length > 2);
    const common = tParts.filter(p => etParts.includes(p));
    if (common.length >= Math.min(2, tParts.length, etParts.length)) {
      // Found a match — try to find direct CDN URL
      if (ev.cdn_url || ev.m3u8) return { url: ev.cdn_url || ev.m3u8, method: 'srhady-event' };
      if (ev.embed && ev.embed.includes('embed2.php')) {
        const id = ev.embed.match(/id=([^&]+)/);
        if (id) {
          // Construct zohanayaan CDN URL from channel ID pattern
          const channelMatch = (ev.channel_id || ev.channel || id[1]).match(/(\d+)/);
          if (channelMatch) {
            const ch = channelMatch[1];
            const cdnUrl = `https://zohanayaan.com:1686/live/${ch}.m3u8?md5=${Date.now()}&token=1`;
            return { url: cdnUrl, method: 'srhady-cdn', referer: 'https://teachtrendhub.com/' };
          }
        }
      }
    }
  }
  return null;
}

// ── Try to fetch from CricketLive repo ──
async function tryCricketLive(title) {
  // srhady/CricketLive repo has files named by match with .m3u8 extension
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const { text } = await httpFetch(`https://raw.githubusercontent.com/srhady/CricketLive/main/${slug}.m3u8`, { timeout: 5000 });
    if (text && text.includes('.m3u8') || text.includes('#EXTM3U')) {
      const firstLine = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
      if (firstLine) return { url: firstLine.trim(), method: 'cricket-live' };
    }
  } catch {}
  // Try some common variations
  for (const prefix of ['', 'live-', 'stream-']) {
    try {
      const { text } = await httpFetch(`https://raw.githubusercontent.com/srhady/CricketLive/main/${prefix}${slug}.m3u8`, { timeout: 5000 });
      if (text) {
        const firstLine = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (firstLine && firstLine.includes('.m3u8')) return { url: firstLine.trim(), method: 'cricket-live' };
      }
    } catch {}
  }
  return null;
}

// ── Main stream extraction with fallback chain ──
async function extractStream(serverUrl) {
  const cacheKey = serverUrl;
  if (cache.streamCache[cacheKey] && Date.now() - cache.streamCache[cacheKey].time < STREAM_TTL) {
    return cache.streamCache[cacheKey].result;
  }

  const { fid, v_con, v_dt } = await extractFid(serverUrl);
  const srhadyEvents = await fetchSrhadyEvents();

  let result = null;

  // Try 1: pzo.php (works from some server IPs)
  if (fid) {
    result = await tryPzoExtract(fid, v_con, v_dt);
    if (result) { cache.streamCache[cacheKey] = { result, time: Date.now() }; return result; }

    // Try 2: playergo1.php fallback
    result = await tryPlayerGo(fid, v_con, v_dt);
    if (result) { cache.streamCache[cacheKey] = { result, time: Date.now() }; return result; }
  }

  // Try 3: Direct CDN via srhady (title matching against Live_Events.json)
  // We don't need login page to get title - we cache it from match context
  if (srhadyEvents.length > 0 && fid) {
    // We'll match by fid which is the channel id
    const channelId = fid;
    for (const ev of srhadyEvents) {
      const evId = (ev.embed || '').match(/id=([^&]+)/);
      if (evId && evId[1] === channelId) {
        const chMatch = (ev.channel_id || '').match(/(\d+)/);
        if (chMatch) {
          const cdnUrl = `https://zohanayaan.com:1686/live/${chMatch[1]}.m3u8?md5=${Date.now()}&token=1`;
          result = { url: cdnUrl, method: 'srhady-cdn', referer: 'https://teachtrendhub.com/' };
          cache.streamCache[cacheKey] = { result, time: Date.now() };
          return result;
        }
      }
    }
  }

  // Return fid for client-side extraction as last resort
  cache.streamCache[cacheKey] = { result: { fid, v_con, v_dt, method: 'client-fallback' }, time: Date.now() };
  return { fid, v_con, v_dt, method: 'client-fallback' };
}

// ── Handler ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action, matchUrl, streamUrl, matchId, title, url: proxyUrl } = req.query;

  try {
    // ── inline proxy for m3u8/ts ──
    if (action === 'proxy' && proxyUrl) {
      const target = httpFetch(proxyUrl, { headers: { Referer: req.query.referer || 'https://bhalocast.com/' } });
      const resp = await target;
      const ct = resp.headers['content-type'] || '';
      if (ct.includes('mpegurl') || ct.includes('apple') || proxyUrl.includes('.m3u8')) {
        const baseUrl = proxyUrl.substring(0, proxyUrl.lastIndexOf('/') + 1);
        const lines = resp.text.split('\n');
        const rewritten = lines.map(line => {
          const t = line.trim();
          if (t && !t.startsWith('#') && !t.startsWith('http')) {
            return `/api/crichd?action=proxy&url=${encodeURIComponent(baseUrl + t)}&referer=${encodeURIComponent(req.query.referer || 'https://bhalocast.com/')}`;
          }
          return line;
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'public, max-age=2');
        return res.status(200).send(rewritten);
      }
      res.setHeader('Content-Type', ct || 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=2');
      return res.status(200).send(resp.text);
    }

    // ── match servers ──
    if (action === 'servers' && matchUrl) {
      const fullUrl = matchUrl.startsWith('http') ? matchUrl : BASE_URL + matchUrl;
      const servers = await scrapeServers(fullUrl);
      return res.json({ success: true, servers, total: servers.length });

    // ── stream extraction ──
    } else if ((action === 'stream' && streamUrl) || action === 'resolve') {
      const url = streamUrl || matchUrl;
      const result = await extractStream(url);
      if (result && result.url) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host || 'localhost:3000';
        const referer = result.referer || 'https://bhalocast.com/';
        const proxied = `${proto}://${host}/api/crichd?action=proxy&url=${encodeURIComponent(result.url)}&referer=${encodeURIComponent(referer)}`;
        return res.json({ success: true, stream: { url: proxied, headers: { Referer: referer } }, method: result.method, directUrl: result.url });
      }
      // Return fid for client-side extraction
      return res.json({ success: false, fid: result?.fid, v_con: result?.v_con, v_dt: result?.v_dt, method: result?.method, error: !result?.fid ? 'Could not extract stream' : undefined });

    // ── srhady data ──
    } else if (action === 'srhady') {
      const [events, channels] = await Promise.all([fetchSrhadyEvents(), fetchSrhadyChannels()]);
      return res.json({ success: true, events, channels24: channels, totalEvents: events.length, totalChannels: channels.length });

    // ── srhady live events ──
    } else if (action === 'srhady-events') {
      const events = await fetchSrhadyEvents();
      return res.json({ success: true, events, total: events.length });

    // ── srhady 24/7 channels ──
    } else if (action === 'channels') {
      const channels = await fetchSrhadyChannels();
      return res.json({ success: true, channels, total: channels.length });

    // ── cricket live direct ──
    } else if (action === 'cricket-live' && title) {
      const result = await tryCricketLive(title);
      if (result) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host || 'localhost:3000';
        const referer = 'https://teachtrendhub.com/';
        const proxied = `${proto}://${host}/api/crichd?action=proxy&url=${encodeURIComponent(result.url)}&referer=${encodeURIComponent(referer)}`;
        return res.json({ success: true, stream: { url: proxied }, method: result.method, directUrl: result.url });
      }
      return res.json({ success: false, error: 'No direct CDN URL found' });

    // ── matches ──
    } else {
      const matches = await scrapeMatches();
      return res.json({ success: true, matches, total: matches.length, fetchedAt: new Date().toISOString() });
    }
  } catch (err) {
    return res.json({ success: false, error: err.message, fetchedAt: new Date().toISOString() });
  }
};
