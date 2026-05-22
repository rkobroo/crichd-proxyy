const https = require('https');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SRHADY_REPO = 'https://raw.githubusercontent.com/srhady/crichd-speical-live-event/main';
const CRICKET_LIVE = 'https://raw.githubusercontent.com/srhady/CricketLive/main';

const cache = { liveEvents: null, liveTime: 0, footyEvents: null, footyTime: 0, channels24: null, channels24Time: 0 };
const TTL = 60000;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
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

function parseM3U(m3u) {
  const channels = [];
  const lines = m3u.split('\n');
  let current = {};
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXTINF:')) {
      const name = t.replace(/.*?,[\s]*(.*)/, '$1').trim();
      const logo = (t.match(/tvg-logo="([^"]*)"/) || [])[1] || '';
      const group = (t.match(/group-title="([^"]*)"/) || [])[1] || '';
      current = { name, logo, group };
    } else if (t.startsWith('#EXTVLCOPT:')) {
      const val = t.replace('#EXTVLCOPT:', '');
      if (val.startsWith('http-referrer=')) current.referer = val.replace('http-referrer=', '');
      if (val.startsWith('http-user-agent=')) current.ua = val.replace('http-user-agent=', '');
    } else if (t && !t.startsWith('#') && current.name) {
      current.url = t;
      channels.push({ ...current });
      current = {};
    }
  }
  return channels;
}

async function fetchLiveEvents() {
  if (cache.liveEvents && Date.now() - cache.liveTime < TTL) return cache.liveEvents;
  try {
    const json = JSON.parse(await fetchUrl(`${SRHADY_REPO}/Live_Events.json`));
    cache.liveEvents = json.matches || [];
    cache.liveTime = Date.now();
  } catch { cache.liveEvents = []; }
  return cache.liveEvents;
}

async function fetchFootyEvents() {
  if (cache.footyEvents && Date.now() - cache.footyTime < TTL) return cache.footyEvents;
  try {
    const json = JSON.parse(await fetchUrl(`${SRHADY_REPO}/Footy_Live.json`));
    cache.footyEvents = json.matches || [];
    cache.footyTime = Date.now();
  } catch { cache.footyEvents = []; }
  return cache.footyEvents;
}

async function fetchChannels24() {
  if (cache.channels24 && Date.now() - cache.channels24Time < TTL) return cache.channels24;
  try {
    const m3u = await fetchUrl(`${SRHADY_REPO}/playlist.m3u`);
    cache.channels24 = parseM3U(m3u);
    cache.channels24Time = Date.now();
  } catch { cache.channels24 = []; }
  return cache.channels24;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action } = req.query;

  try {
    if (action === 'live') {
      const events = await fetchLiveEvents();
      res.status(200).json({ success: true, events, total: events.length });
    } else if (action === 'footy') {
      const events = await fetchFootyEvents();
      res.status(200).json({ success: true, events, total: events.length });
    } else if (action === 'channels') {
      const channels = await fetchChannels24();
      res.status(200).json({ success: true, channels, total: channels.length });
    } else {
      const [live, footy, channels] = await Promise.all([fetchLiveEvents(), fetchFootyEvents(), fetchChannels24()]);
      res.status(200).json({ success: true, liveEvents: live, footyEvents: footy, channels24: channels });
    }
  } catch (err) {
    res.status(200).json({ success: false, error: err.message });
  }
};
