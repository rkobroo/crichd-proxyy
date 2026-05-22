const https = require('https');

const BASE_URL = 'https://crichd.top';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

// In-memory cache
const cache = { matches: null, matchTime: 0, stream: {}, streamTime: {} };
const CACHE_TTL = 30000; // 30 seconds
const STREAM_CACHE_TTL = 120000; // 2 min for stream URLs

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }, headers || {}),
      timeout: 10000,
    };

    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location, headers).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ text: data, status: res.statusCode }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function scrapeMatches() {
  if (cache.matches && Date.now() - cache.matchTime < CACHE_TTL) return cache.matches;
  const { text: html } = await httpGet(BASE_URL + '/');
  const matches = [];
  const rows = html.split(/<tr[\s>]/);

  for (const row of rows) {
    if (!row.includes('gametitle')) continue;
    const leagueMatch = row.match(/rel="tag">([^<]+)</);
    const league = leagueMatch ? leagueMatch[1].trim() : 'Cricket';
    const matchUrlMatch = row.match(/<a\s+href="(https?:\/\/[^"]+)"[^>]*itemprop="url">[\s\S]*?<h2\s+class="gametitle"[^>]*>([^<]+)</);
    if (!matchUrlMatch) continue;

    const matchUrl = matchUrlMatch[1];
    const title = matchUrlMatch[2].trim();
    const timeMatch = row.match(/<span\s+class="dt">([^<]+)</);
    const time = timeMatch ? timeMatch[1].trim() : '';
    const dayMatch = row.match(/<small\s+class="post-day"[^>]*>([^<]*)/);
    let day = '';
    if (dayMatch) {
      const dayText = dayMatch[1].replace(/&nbsp;/g, '').trim();
      if (dayText.includes('Today')) day = 'Today';
      else if (dayText.includes('Tomorrow')) day = 'Tomorrow';
      else day = dayText; // date string like "15-05-2026"
    }
    const isLive = row.includes('class="liveg');
    const watchMatch = row.match(/<td\s+class="mobile-hide">\s*<a\s+href="(https?:\/\/[^"]+)"[^>]*>Watch/);
    const pageUrl = watchMatch ? watchMatch[1] : matchUrl;

    matches.push({ id: new URL(matchUrl).pathname, title, league, url: matchUrl, pageUrl, time, day, isLive });
  }
  cache.matches = matches;
  cache.matchTime = Date.now();
  return matches;
}

async function scrapeMatchServers(matchUrl) {
  const { text: html } = await httpGet(matchUrl);
  const servers = [];
  const seenUrls = new Set();

  function addServer(name, url) {
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      servers.push({ name, url });
    }
  }

  const dadocricRegex = /<a[^>]+href="(https?:\/\/dadocric\.st\/player\.php\?id=[^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let dMatch;
  while ((dMatch = dadocricRegex.exec(html)) !== null) {
    addServer(dMatch[2].trim() || ('Server ' + (servers.length + 1)), dMatch[1]);
  }

  const iframeRegex = /<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  let iMatch;
  while ((iMatch = iframeRegex.exec(html)) !== null) {
    const src = iMatch[1];
    if (!src.includes('chat') && !src.includes('histats')) {
      addServer('Embed ' + (servers.length + 1), src);
    }
  }

  const linkRegex = /<a[^>]+href="(https?:\/\/(?!#|https:\/\/crichd)[^"]+)"[^>]*>([^<]*(?:player|server|stream|watch|hd|link)[^<]*)<\/a>/gi;
  let lMatch;
  while ((lMatch = linkRegex.exec(html)) !== null) {
    const name = lMatch[2].trim();
    if (name.length > 2 && name.length < 50) {
      addServer(name, lMatch[1]);
    }
  }

  return servers;
}

async function extractM3u8FromServer(serverUrl) {
  const cacheKey = serverUrl;
  if (cache.stream[cacheKey] && Date.now() - cache.streamTime[cacheKey] < STREAM_CACHE_TTL) return cache.stream[cacheKey];
  // Step 1: Fetch dadocric.st player page to get iframe URL
  let iframeUrl;
  if (serverUrl.includes('dadocric.st')) {
    const { text: playerHtml } = await httpGet(serverUrl, { Referer: BASE_URL + '/' });
    const iframeMatch = playerHtml.match(/iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (!iframeMatch) return null;
    iframeUrl = iframeMatch[1];
  } else {
    iframeUrl = serverUrl;
  }

  // Step 2: Fetch embed page (playerado.top/embed2.php) to get fid, v_con, v_dt
  const { text: embedHtml } = await httpGet(iframeUrl, { Referer: serverUrl });
  const fid = (embedHtml.match(/fid="([^"]*)"/) || [])[1];
  const v_con = (embedHtml.match(/v_con=["'](.*?)["']/) || [])[1] || '';
  if (!fid) return null;

  // Step 3: Fetch bello.php which contains the m3u8 URL construction
  const belloUrl = 'https://player0003.com/bello.php?v=' + fid + '&hello=' + v_con + '&expires=123456';
  const { text: belloHtml } = await httpGet(belloUrl, { Referer: iframeUrl });

  // Step 4: Extract the URL from the function that joins character arrays
  // Pattern: return([...].join("") + <var>.join("") + document.getElementById("<id>").innerHTML)
  const urlMarker = '.join("") + ';
  let idx = belloHtml.indexOf(urlMarker);
  if (idx < 0) return null;

  // Find the function start
  const funcStart = belloHtml.lastIndexOf('function ', idx);
  if (funcStart < 0) return null;

  // Find the return statement with the array
  const returnIdx = belloHtml.indexOf('return(', funcStart);
  if (returnIdx < 0) return null;

  // Extract the first array (the m3u8 URL parts)
  const arrEnd = belloHtml.indexOf('].join("")', returnIdx);
  if (arrEnd < 0) return null;

  const arrStr = belloHtml.substring(returnIdx + 7, arrEnd + 1);
  const parts = arrStr.replace(/[\[\]]/g, '').replace(/\\?\//g, '/').replace(/["']/g, '').split(',');
  const m3u8Url = parts.join('');

  // Verify it looks like an m3u8 URL
  if (!m3u8Url.includes('.m3u8')) {
    cache.stream[cacheKey] = null;
    cache.streamTime[cacheKey] = Date.now();
    return null;
  }

  cache.stream[cacheKey] = m3u8Url.replace(/\\\\/g, '');
  cache.streamTime[cacheKey] = Date.now();
  return cache.stream[cacheKey];
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

  const { action, matchUrl, streamUrl } = req.query;

  try {
    if (action === 'servers' && matchUrl) {
      const fullUrl = matchUrl.startsWith('http') ? matchUrl : BASE_URL + matchUrl;
      const servers = await scrapeMatchServers(fullUrl);
      res.status(200).json({ success: true, servers });
    } else if (action === 'stream' && streamUrl) {
      const m3u8Url = await extractM3u8FromServer(streamUrl);
      if (m3u8Url) {
        const host = req.headers.host || 'localhost:3000';
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const proxiedUrl = `${protocol}://${host}/api/crichd-proxy?url=${encodeURIComponent(m3u8Url)}`;
        res.status(200).json({
          success: true,
          stream: {
            url: proxiedUrl,
            headers: {}
          }
        });
      } else {
        res.status(200).json({ success: false, error: 'Could not extract stream' });
      }
    } else {
      const matches = await scrapeMatches();
      res.status(200).json({ success: true, matches, total: matches.length, fetchedAt: new Date().toISOString() });
    }
  } catch (err) {
    res.status(200).json({ success: false, error: err.message, matches: [], fetchedAt: new Date().toISOString() });
  }
};
