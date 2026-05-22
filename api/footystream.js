const https = require('https');
const zlib = require('zlib');

const REPO = 'https://raw.githubusercontent.com/srhady/crichd-speical-live-event/main';

const cache = { events: null, eventsTime: 0 };
const CACHE_TTL = 30000;

function httpGetText(url, referer, ua, redirects = 3) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
        ...(referer ? { 'Referer': referer } : {}),
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = urlObj.origin + redirectUrl;
        } else if (!redirectUrl.startsWith('http')) {
          redirectUrl = urlObj.origin + urlObj.pathname.replace(/\/[^\/]*$/, '/') + redirectUrl;
        }
        httpGetText(redirectUrl, referer, ua, redirects - 1).then(resolve).catch(reject);
        return;
      }
      let buffers = [];
      res.on('data', chunk => buffers.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(buffers);
        const encoding = res.headers['content-encoding'];
        if (encoding === 'gzip') {
          zlib.gunzip(buffer, (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded.toString('utf8'));
          });
        } else if (encoding === 'deflate') {
          zlib.inflate(buffer, (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded.toString('utf8'));
          });
        } else {
          resolve(buffer.toString('utf8'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function httpGetJson(url) {
  return httpGetText(url).then(text => { try { return JSON.parse(text); } catch(e) { throw new Error('Invalid JSON'); } });
}

const KNOWN_PLAYER_DOMAINS = [
  'playeraio', 'bhalocast', 'procast', 'vipcast', 'embed', 'streamcast',
  'cloudstream', 'hdcast', 'livecast', 'player', 'cast',
];

function isAdUrl(url) {
  const lower = url.toLowerCase();
  const adKeywords = ['exoclick', 'popads', 'propellerads', 'adsterra', 'adfoc'];
  return adKeywords.some(k => lower.includes(k));
}

function isPlayerUrl(url) {
  const lower = url.toLowerCase();
  return KNOWN_PLAYER_DOMAINS.some(d => lower.includes(d));
}

function extractUrlFromCharArrays(html) {
  const regex = /\[\s*((?:"[^"]*"\s*,?\s*)+)\]\s*\.\s*join\s*\(\s*""\s*\)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const chars = match[1].match(/"([^"]*)"/g).map(s => s.slice(1, -1).replace(/\\\//g, '/'));
      const url = chars.join('');
      if (url.startsWith('http') && url.includes('.m3u8')) return url;
    } catch(e) {}
  }
  return null;
}

async function findM3u8(html) {
  const patterns = [
    /(https?:\/\/[^"'\s<>,)]+\.m3u8[^"'\s<>,)]*)/i,
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /source["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /file["']?\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /src["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /url["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /["']?src["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /["']?file["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /["']?url["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /(?:source|sources)\s*[:=]\s*\[?\s*\{[^}]*?["']?src["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /["']?(?:hls|m3u8)["']?\s*[:=]\s*["']([^"']+)["']/i,
    /data["']?\[["']?file["']?\]\s*=\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /['"](?:https?:\/\/[^'"]+?\/[^'"]*?)(?:\.m3u8|\.mp4)(?:[^'"]*)['"]/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].trim();
    if (m && !m[1]) return m[0];
  }
  const arrayUrl = extractUrlFromCharArrays(html);
  if (arrayUrl) return arrayUrl;
  return null;
}

async function findBhalocastUrl(html) {
  const fidMatch = html.match(/["']?fid["']?\s*[:=]\s*["']([^"']+)["']/i);
  const vConMatch = html.match(/["']?v_con["']?\s*[:=]\s*["']([^"']+)["']/i);
  const vDtMatch = html.match(/["']?v_dt["']?\s*[:=]\s*["']([^"']+)["']/i);
  if (fidMatch && vConMatch && vDtMatch) {
    return `https://bhalocast.pro/atofplay.php?v=${fidMatch[1]}&secure=${vConMatch[1]}&expires=${vDtMatch[1]}`;
  }
  const directMatch = html.match(/https?:\/\/bhalocast\.pro\/atofplay\.php[^"'\s<>]*/i);
  if (directMatch) return directMatch[0];
  return null;
}

async function extractHlsFromEmbed(embedUrl, referer, ua) {
  try {
    const html = await httpGetText(embedUrl, referer || embedUrl, ua);
    let m3u8 = await findM3u8(html);
    if (m3u8) return { type: 'hls', url: m3u8 };
    let bhalo = await findBhalocastUrl(html);
    if (bhalo) {
      const bhaloReferer = 'https://playeraio.top/';
      const bhaloHtml = await httpGetText(bhalo, bhaloReferer, ua).catch(() => '');
      m3u8 = await findM3u8(bhaloHtml);
      if (m3u8) return { type: 'hls', url: m3u8 };
      return { type: 'embed', url: bhalo, referer: bhaloReferer };
    }
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch && !iframeMatch[1].includes('chat') && !isAdUrl(iframeMatch[1])) {
      const iframeUrl = iframeMatch[1];
      const iframeHtml = await httpGetText(iframeUrl, embedUrl, ua).catch(() => '');
      m3u8 = await findM3u8(iframeHtml);
      if (m3u8) return { type: 'hls', url: m3u8 };
      bhalo = await findBhalocastUrl(iframeHtml);
      if (bhalo) {
        const bhaloReferer = 'https://playeraio.top/';
        const bhaloHtml = await httpGetText(bhalo, bhaloReferer, ua).catch(() => '');
        m3u8 = await findM3u8(bhaloHtml);
        if (m3u8) return { type: 'hls', url: m3u8 };
        return { type: 'embed', url: bhalo, referer: bhaloReferer };
      }
      if (isPlayerUrl(iframeUrl)) {
        return { type: 'embed', url: iframeUrl };
      }
    }
  } catch (e) {}
  return { type: 'embed', url: embedUrl };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action, channelUrl, referer, ua } = req.query;

  if (action === 'resolve' && channelUrl) {
    const result = await extractHlsFromEmbed(channelUrl, referer || '', ua || '');
    // Wrap external m3u8 URLs through hls-proxy to handle CORS + headers
    if (result.type === 'hls' && result.url && (result.url.includes('bhalocast') || result.url.includes('dz'))) {
      const proxyUrl = `/api/hls-proxy?ua=${encodeURIComponent(ua || '')}&referer=${encodeURIComponent('https://bhalocast.pro/')}&origin=${encodeURIComponent('https://executeandship.com')}&url=${encodeURIComponent(result.url)}`;
      res.status(200).json({ success: true, type: 'hls', url: proxyUrl });
      return;
    }
    res.status(200).json({ success: true, ...result });
    return;
  }

  if (action === 'proxy' && channelUrl) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const body = await httpGetText(channelUrl, referer || channelUrl, ua || '').catch(() => '');
    if (!body) { res.status(502).end('Proxy fetch failed'); return; }
    res.status(200).end(body);
    return;
  }

  try {
    if (cache.events && Date.now() - cache.eventsTime < CACHE_TTL) {
      res.status(200).json(cache.events);
      return;
    }
    const [footyData, goLiveData] = await Promise.all([
      httpGetJson(`${REPO}/Footy_Live.json`).catch(() => ({ matches: [] })),
      httpGetJson(`${REPO}/Go_Live_Events.json`).catch(() => ({ channels: [] })),
    ]);

    const events = [];

    for (const m of (footyData.matches || [])) {
      const t1 = m["Team 1 Name"] || '';
      const t2 = m["Team 2 Name"] || '';
      const matchReferer = m["referer"] || '';
      const matchUA = m["User agent"] || '';
      const channels = (m.Channels || [])
        .filter(c => c["Embed link"] || c["Stream link"])
        .map(c => ({
          name: c["Channel name"] || 'Stream',
          url: c["Stream link"] || c["Embed link"],
          type: (c["Stream link"] || '').includes('.m3u8') ? 'hls' : 'embed',
          language: c.Language || '',
          referer: matchReferer,
          ua: matchUA,
        }));
      if (channels.length > 0) {
        events.push({
          title: m["match name"] || (t1 && t2 ? `${t1} vs ${t2}` : t1 || t2 || 'Event'),
          league: m["Tour/Group name"] || '',
          startTime: m["Start time"] || '',
          teams: [t1, t2].filter(Boolean),
          logos: [m["Team 1 Logo"], m["Team 2 Logo"]].filter(Boolean),
          isLive: m.Status === 'LIVE',
          channels,
        });
      }
    }

    for (const ch of (goLiveData.channels || [])) {
      if (ch.url) {
        events.push({
          title: ch.match_name || ch.channel_name || 'Live Event',
          league: ch.group_title || 'Live Events',
          startTime: '',
          teams: [],
          logos: [ch.logo || ''],
          isLive: true,
          channels: [{
            name: ch.channel_name || 'Direct Stream',
            url: ch.url,
            type: 'hls',
            referer: ch.referrer || '',
            ua: ch.user_agent || '',
          }],
        });
      }
    }

    const result = { success: true, events, total: events.length, fetchedAt: new Date().toISOString() };
    cache.events = result;
    cache.eventsTime = Date.now();
    res.status(200).json(result);
  } catch (err) {
    res.status(200).json({ success: false, error: err.message, events: [], fetchedAt: new Date().toISOString() });
  }
};
