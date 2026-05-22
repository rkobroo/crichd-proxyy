const https = require('https');
const http = require('http');
const url = require('url');

const PROXY_PREFIX = '/api/sf-proxy?url=';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    res.status(400).send('Missing url param');
    return;
  }

  try {
    const parsed = new URL(targetUrl);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: req.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://streamfree.app/',
        'Accept': '*/*',
      },
      timeout: 30000,
    };

    const proxyRes = await new Promise((resolve, reject) => {
      const client = parsed.protocol === 'https:' ? https : http;
      const request = client.request(opts, (response) => resolve(response));
      request.on('error', reject);
      request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
      request.end();
    });

    const ext = targetUrl.match(/\.(\w+)(\?|$)/)?.[1];
    const isM3U8 = ext === 'm3u8' || proxyRes.headers['content-type']?.includes('mpegurl') || proxyRes.headers['content-type']?.includes('apple');

    if (isM3U8) {
      // Buffer entire m3u8 response to rewrite relative URLs
      const chunks = [];
      for await (const chunk of proxyRes) chunks.push(chunk);
      let body = Buffer.concat(chunks).toString('utf-8');

      // Determine base URL for resolving relative paths
      let baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      // If URL has query string, remove it for base resolution
      if (baseUrl.includes('?')) baseUrl = targetUrl.substring(0, targetUrl.indexOf('?'));

      const lines = body.split('\n');
      const rewritten = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('http')) {
          const absoluteUrl = baseUrl.endsWith('/') ? baseUrl + trimmed : baseUrl + '/' + trimmed;
          return `${PROXY_PREFIX}${encodeURIComponent(absoluteUrl)}`;
        }
        if (trimmed.startsWith('#EXT-X-MAP:URI=')) {
          // Rewrite fMP4 init segment URL in EXT-X-MAP
          const match = trimmed.match(/URI="([^"]+)"/);
          if (match && !match[1].startsWith('http')) {
            const absoluteUrl = baseUrl.endsWith('/') ? baseUrl + match[1] : baseUrl + '/' + match[1];
            return trimmed.replace(match[1], PROXY_PREFIX + encodeURIComponent(absoluteUrl));
          }
        }
        return line;
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'public, max-age=2');
      res.status(proxyRes.statusCode);
      res.send(rewritten);
    } else {
      // Pass through non-m3u8 content (TS segments, images, etc.)
      res.statusCode = proxyRes.statusCode;
      const contentTypes = {
        ts: 'video/mp2t',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        mpd: 'application/dash+xml',
        js: 'application/javascript',
        css: 'text/css',
        json: 'application/json',
        html: 'text/html',
      };
      if (ext && contentTypes[ext]) {
        res.setHeader('Content-Type', contentTypes[ext]);
      } else if (proxyRes.headers['content-type']) {
        res.setHeader('Content-Type', proxyRes.headers['content-type']);
      }
      res.setHeader('Cache-Control', 'public, max-age=2');
      proxyRes.pipe(res);
    }
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
};
