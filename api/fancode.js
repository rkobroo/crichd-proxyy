const https = require('https');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FANCODE_M3U = 'https://raw.githubusercontent.com/srhady/Fancode-bd/main/playlist.m3u';

const cache = { channels: null, time: 0 };
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

async function fetchChannels() {
  if (cache.channels && Date.now() - cache.time < TTL) return cache.channels;
  try {
    const m3u = await fetchUrl(FANCODE_M3U);
    const channels = parseM3U(m3u);
    cache.channels = channels.map(c => ({
      name: c.name,
      url: c.url,
      logo: c.logo,
      group: c.group || 'Cricket',
      referer: c.referer || 'https://www.fancode.com/',
    }));
    cache.time = Date.now();
  } catch { cache.channels = []; }
  return cache.channels;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const channels = await fetchChannels();
    res.status(200).json({ success: true, channels, total: channels.length });
  } catch (err) {
    res.status(200).json({ success: false, error: err.message });
  }
};
