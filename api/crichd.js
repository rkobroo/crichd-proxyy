const https = require('https');
const http = require('http');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://player0003.com/',
      },
      timeout: 15000,
      rejectUnauthorized: false,
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url: targetUrl } = req.query;
  if (!targetUrl) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  try {
    const { status, headers, body } = await fetchUrl(targetUrl);

    const contentType = headers['content-type'] || '';
    if (contentType.includes('mpegurl') || contentType.includes('m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      // Rewrite relative .ts URLs to proxy through our endpoint
      const text = body.toString();
      const rewritten = text.replace(/([^\n]+\.ts[^\n]*)/g, (match) => {
        const tsUrl = match.includes('://') ? match : new URL(match, targetUrl).href;
        return `/api/crichd-proxy?url=${encodeURIComponent(tsUrl)}`;
      });
      res.status(status).send(rewritten);
    } else if (contentType.includes('video') || contentType.includes('mp2t')) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.status(status).send(body);
    } else {
      res.setHeader('Content-Type', contentType);
      res.status(status).send(body);
    }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
