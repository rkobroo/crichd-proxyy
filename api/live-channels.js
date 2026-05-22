const https = require('https');

const REPO = 'https://raw.githubusercontent.com/srhady/crichd-speical-live-event/main';
const cache = { data: null, time: 0 };
const CACHE_TTL = 60000; // 1 min

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function parseM3U(text) {
  const channels = [];
  const lines = text.split('\n');
  let current = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const logoMatch = trimmed.match(/tvg-logo="([^"]*)"/);
      const groupMatch = trimmed.match(/group-title="([^"]*)"/);
      const commaIdx = trimmed.lastIndexOf(',');
      const name = commaIdx >= 0 ? trimmed.substring(commaIdx + 1).trim() : '';
      current = {
        name: name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name,
        logo: logoMatch ? logoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        referer: '',
        userAgent: '',
      };
    } else if (trimmed.startsWith('#EXTVLCOPT:http-referrer=')) {
      current.referer = trimmed.split('=').slice(1).join('=');
    } else if (trimmed.startsWith('#EXTVLCOPT:http-user-agent=')) {
      current.userAgent = trimmed.split('=').slice(1).join('=');
    } else if (trimmed.startsWith('http') && current.name) {
      current.url = trimmed;
      channels.push({ ...current });
      current = {};
    }
  }
  return channels;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (cache.data && Date.now() - cache.time < CACHE_TTL) {
      res.status(200).json(cache.data);
      return;
    }
    const [playlistM3u, goLiveM3u, liveEventsJson, goLiveJson, footyJson] = await Promise.all([
      httpGetText(`${REPO}/playlist.m3u`).catch(() => ''),
      httpGetText(`${REPO}/Go_Live_Events.m3u`).catch(() => ''),
      httpGetText(`${REPO}/Live_Events.json`).catch(() => '{}'),
      httpGetText(`${REPO}/Go_Live_Events.json`).catch(() => '{}'),
      httpGetText(`${REPO}/Footy_Live.json`).catch(() => '{}'),
    ]);

    const channels = parseM3U(playlistM3u);
    const goLiveChannels = parseM3U(goLiveM3u);
    const allChannels = [...channels, ...goLiveChannels];

    let liveEvents = [];
    try {
      liveEvents = JSON.parse(liveEventsJson).matches || [];
    } catch (e) {}

    let goLiveEvents = [];
    try {
      goLiveEvents = JSON.parse(goLiveJson).channels || [];
    } catch (e) {}

    const result = {
      success: true,
      totalChannels: allChannels.length,
      channels: allChannels,
      liveEvents,
      goLiveEvents,
    };
    cache.data = result;
    cache.time = Date.now();
    res.status(200).json(result);
  } catch (err) {
    res.status(200).json({ success: false, error: err.message, channels: [], liveEvents: [], goLiveEvents: [] });
  }
};
