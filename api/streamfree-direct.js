const https = require('https');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const PROXY_PREFIX = '/api/sf-proxy?url=';

function fetchUrl(url, referer) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': referer || 'https://streamfree.app/',
        'Accept': '*/*',
      },
      timeout: 20000,
    }, (resp) => {
      let body = '';
      resp.on('data', chunk => body += chunk);
      resp.on('end', () => resolve({ body, headers: resp.headers, status: resp.statusCode }));
    }).on('error', reject);
  });
}

async function resolveStreamUrl(category, key) {
  const [embedHtml, statusData, keyData] = await Promise.all([
    fetchUrl(`https://streamfree.app/embed/${category}/${key}`).catch(() => null),
    fetchUrl(`https://streamfree.app/api/stream-status/${encodeURIComponent(key)}`).catch(() => null),
    fetchUrl(`https://streamfree.app/get-stream-key/${encodeURIComponent(key)}`).catch(() => null),
  ]);

  if (!embedHtml) return null;

  const tokenMatch = embedHtml.body.match(/const\s+_0x\s*=\s*(\{[^;]+);/);
  if (!tokenMatch) return null;
  const tokens = JSON.parse(tokenMatch[1]);

  let qualities = { '540p': true };
  if (statusData) {
    try { const s = JSON.parse(statusData.body); if (s.qualities) qualities = s.qualities; } catch (e) {}
  }

  let keyInfo = { server_domain: '', server_name: 'origin' };
  if (keyData) {
    try { keyInfo = JSON.parse(keyData.body); } catch (e) {}
  }

  const qualityOrder = ['2160p', '1080p', '720p', '540p'];
  let selectedQuality = '540p';
  for (const q of qualityOrder) {
    if (qualities[q] && tokens[q]) { selectedQuality = q; break; }
  }

  const token = tokens[selectedQuality];
  if (!token) return null;

  const serverDomain = keyInfo.server_domain || '';
  const basePath = serverDomain ? `${serverDomain}/live` : '/live';
  const m3u8Path = `${basePath}/${key}${selectedQuality}/index.m3u8`;
  const m3u8FullUrl = serverDomain
    ? `${m3u8Path}?_t=${token._t}&_e=${token._e}&_n=${token._n}`
    : `https://streamfree.app${m3u8Path}?_t=${token._t}&_e=${token._e}&_n=${token._n}`;

  return { url: m3u8FullUrl, quality: selectedQuality, server: keyInfo.server_name };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const category = req.query.category;
  const key = req.query.key;
  if (!category || !key) {
    res.status(400).json({ error: 'Missing category or key' });
    return;
  }

  try {
    const resolved = await resolveStreamUrl(category, key);
    if (!resolved) {
      res.status(500).json({ error: 'Failed to resolve stream URL' });
      return;
    }

    // Fetch the m3u8 playlist
    const baseUrl = resolved.url.substring(0, resolved.url.lastIndexOf('/') + 1);
    const playlistData = await fetchUrl(resolved.url);

    if (playlistData.status !== 200) {
      res.status(playlistData.status).json({ error: 'Failed to fetch playlist' });
      return;
    }

    // Rewrite segment URLs to go through our proxy (for CORS)
    const lines = playlistData.body.split('\n');
    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('http')) {
        return `${PROXY_PREFIX}${encodeURIComponent(baseUrl + trimmed)}`;
      }
      return line;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewritten);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
