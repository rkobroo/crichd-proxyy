const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url: targetUrl, referer, origin, ua } = req.query;
  if (!targetUrl) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  const decodedUrl = decodeURIComponent(targetUrl);
  const isM3U = decodedUrl.includes('.m3u8');

  const urlObj = new URL(decodedUrl);
  const mod = urlObj.protocol === 'http:' ? http : https;

  const opts = {
    hostname: urlObj.hostname,
    port: urlObj.port || 443,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
      'Accept': '*/*',
      'Referer': referer || 'https://executeandship.com/',
    },
    timeout: 30000,
    rejectUnauthorized: false,
  };

  if (origin) {
    opts.headers['Origin'] = origin;
  }

  const reqOut = mod.request(opts, (resOut) => {
    res.status(resOut.statusCode);

    const contentType = resOut.headers['content-type'] || '';
    if (isM3U) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    let data = [];
    resOut.on('data', chunk => data.push(chunk));
    resOut.on('end', () => {
      const body = Buffer.concat(data);

      if (isM3U) {
        let text = body.toString('utf8');
        const proxyBase = `/api/hls-proxy?ua=${encodeURIComponent(ua || '')}&referer=${encodeURIComponent(referer || 'https://executeandship.com/')}&origin=${encodeURIComponent(origin || 'https://executeandship.com')}&url=`;
        const lines = text.split('\n');
        const rewritten = lines.map(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('http')) {
            const absUrl = new URL(trimmed, decodedUrl).href;
            return proxyBase + encodeURIComponent(absUrl);
          }
          if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('http')) {
            return proxyBase + encodeURIComponent(trimmed);
          }
          return line;
        });
        res.send(rewritten.join('\n'));
      } else {
        res.send(body);
      }
    });
  });

  reqOut.on('error', (err) => {
    res.status(502).json({ error: err.message });
  });

  reqOut.on('timeout', () => {
    reqOut.destroy();
    res.status(504).json({ error: 'Timeout' });
  });

  reqOut.end();
};
