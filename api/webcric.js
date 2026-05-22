const https = require('https');

const BASE_URL = 'https://go.webcric.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

const cache = { events: null, eventsTime: 0, servers: {}, serversTime: {} };
const CACHE_TTL = 30000;

function httpGet(url, headers, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
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
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        httpGet(loc, headers, maxRedirects - 1).then(resolve).catch(reject);
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

function enableVideo(pk) {
  return pk.substring(0, 53) + pk.substring(54);
}

function httpStream(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': USER_AGENT,
      }, headers || {}),
      timeout: 15000,
    }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ data: Buffer.concat(data), status: res.statusCode, headers: res.headers }));
    }).on('error', reject).end();
  });
}

async function proxyStream(req, res) {
  const { streamUrl, referer } = req.query;
  
  if (!streamUrl) {
    return res.status(400).json({ error: 'Missing streamUrl' });
  }

  const reqHeaders = {};
  if (referer) reqHeaders['Referer'] = referer;
  if (req.headers['range']) reqHeaders['Range'] = req.headers['range'];

  const result = await httpStream(streamUrl, reqHeaders);
  
  if (result.status >= 400) {
    return res.status(result.status).json({ error: 'Stream request failed' });
  }

  const contentType = result.headers['content-type'] || '';
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');

  if (result.headers['content-length']) res.setHeader('Content-Length', result.headers['content-length']);
  if (result.headers['content-range']) res.setHeader('Content-Range', result.headers['content-range']);
  if (result.headers['accept-ranges']) res.setHeader('Accept-Ranges', result.headers['accept-ranges']);
  if (result.headers['cache-control']) res.setHeader('Cache-Control', result.headers['cache-control']);

  // If it's an m3u8 playlist, rewrite segment URLs to go through proxy
  if (contentType.includes('application/x-mpegurl') || contentType.includes('audio/mpegurl') || streamUrl.includes('.m3u8')) {
    res.setHeader('Content-Type', 'application/x-mpegurl');
    const playlist = result.data.toString('utf-8');
    const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
    const proxyBase = `/api/webcric?action=proxy&referer=${encodeURIComponent(referer || '')}&streamUrl=`;
    
    const rewritten = playlist.split('\n').map(line => {
      if (line.startsWith('#')) return line;
      if (!line.trim()) return line;
      
      // If line is a URL or relative path, proxy it
      const fullUrl = line.startsWith('http') ? line : baseUrl + line;
      return proxyBase + encodeURIComponent(fullUrl);
    }).join('\n');
    
    return res.status(200).send(rewritten);
  }

  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  res.status(200).send(result.data);
}

async function scrapeLiveMatches() {
  const { text: html } = await httpGet(BASE_URL);
  const matches = [];
  const cards = html.split('class="card portfolio-item');

  for (let i = 1; i < cards.length; i++) {
    const card = cards[i];
    if (!card.includes('LIVE STREAM')) continue;

    const titleMatch = card.match(/<strong>([^<]+)<\/strong>/i);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();

    const urlMatch = card.match(/href="(https?:\/\/[^"]+\.htm)"/i);
    if (!urlMatch) continue;
    const url = urlMatch[1];

    matches.push({ title, url, poster: null, isLive: true, source: 'RKO TV' });
  }

  return matches;
}

async function getStreamPages(eventUrl) {
  const { text: html } = await httpGet(eventUrl, { Referer: BASE_URL + '/' });
  const pages = [];

  // Extract dropdown menu links (Cricket Stream 1, 2, 3, etc.)
  const dropdownRegex = /<li><a\s+href="(https?:\/\/[^"]+)">(Cricket\s+Stream\s+\d+|Cricket\s+Stream\s+HD|Cricket\s+Stream\s+\d+\s*-\s*[^<]+)<\/a><\/li>/gi;
  let dropdownMatch;
  while ((dropdownMatch = dropdownRegex.exec(html)) !== null) {
    pages.push({ name: dropdownMatch[2].trim(), url: dropdownMatch[1] });
  }

  // If no dropdown found, use the event URL itself
  if (pages.length === 0) {
    pages.push({ name: 'Stream 1', url: eventUrl });
  }

  return pages;
}

const CHANNEL_NAMES = {
  'webcricn04': { name: 'Sky Sports', logo: 'https://i.imgur.com/pTWblYk.png' },
  'webcricn02': { name: 'Willow TV', logo: 'https://i.imgur.com/MzxqTMf.png' },
  'webcrichindi': { name: 'Willow Hindi', logo: 'https://i.imgur.com/eg7RgjP.png' },
  'webcricp01': { name: 'Star Sports 1', logo: 'https://i.imgur.com/Js5Eg2V.png' },
  'webcricm04': { name: 'Sky Sports Hindi', logo: 'https://i.imgur.com/pTWblYk.png' },
  'webcricm05': { name: 'Star Sports 1 Hindi', logo: 'https://i.imgur.com/Js5Eg2V.png' },
  'webcricwillow': { name: 'Willow TV', logo: 'https://i.imgur.com/MzxqTMf.png' },
  'webcricsky': { name: 'Sky Sports', logo: 'https://i.imgur.com/pTWblYk.png' },
  'webcrict10': { name: 'T10 Cricket', logo: 'https://r2.thesportsdb.com/images/media/team/badge/4tzmfa1647445839.png/medium' },
  'starsports01': { name: 'Star Sports 1', logo: 'https://i.imgur.com/Js5Eg2V.png' },
};

function getChannelInfo(channel, fallbackName) {
  const info = CHANNEL_NAMES[channel] || { name: channel.charAt(0).toUpperCase() + channel.slice(1), logo: '' };
  return { name: `${info.name} ${fallbackName.replace('Cricket Stream ', '')}`, logo: info.logo };
}

async function extractHlsFromPage(pageUrl) {
  try {
    const { text: pageHtml } = await httpGet(pageUrl, { Referer: BASE_URL + '/' });

    // Find frame1.htm
    const frameMatch = pageHtml.match(/src=['"]frame(\d+)\.htm['"]/i);
    if (!frameMatch) return null;
    const frameUrl = `${BASE_URL}/frame${frameMatch[1]}.htm`;

    const { text: frameHtml } = await httpGet(frameUrl, { Referer: pageUrl });
    const channelMatch = frameHtml.match(/channel\s*=\s*['"]([^'"]+)['"]/i);
    const gMatch = frameHtml.match(/g\s*=\s*['"]([^'"]+)['"]/i);
    if (!channelMatch) return null;

    const channel = channelMatch[1];
    const gateway = gMatch ? gMatch[1] : '6';

    const embedUrl = `https://one.timesup.top/hembedplayer/${channel}/${gateway}/850/480`;
    const { text: embedHtml } = await httpGet(embedUrl, { Referer: BASE_URL + '/' });

    const eaMatch = embedHtml.match(/ea\s*=\s*["']([^"']+)["']/i);
    const hlsUrlMatch = embedHtml.match(/hlsUrl\s*=\s*["']https?:\/\/["']\s*\+\s*ea\s*\+\s*["']([^"']*)["']/i);
    const pkMatch = embedHtml.match(/var\s+pk\s*=\s*["']([^'"]+)["']/i);

    if (!eaMatch || !hlsUrlMatch || !pkMatch) return null;

    const ea = eaMatch[1];
    const hlsUrlPath = hlsUrlMatch[1];
    const rawPk = pkMatch[1];
    const pk = enableVideo(rawPk);
    const finalUrl = `https://${ea}${hlsUrlPath}${pk}`;

    if (!finalUrl.includes('.m3u8') && !finalUrl.includes('/playlist')) return null;

    return { url: finalUrl, type: 'm3u8', referer: embedUrl, channel };
  } catch (err) {
    console.error(`Extract error for ${pageUrl}:`, err.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { action, eventUrl, streamUrl } = req.query;

  if (req.url && req.url.includes('/api/icc')) {
    try {
      const base = 'https://dapi.icc-cricket.com/v2/content/en-gb/videos';
      const all = [];
      let skip = 0;
      while (true) {
        const url = `${base}?$skip=${skip}&$limit=100`;
        const resp = await httpGet(url, { 'Accept': 'application/json' });
        if (resp.status >= 400) break;
        const data = JSON.parse(resp.text);
        const items = data.items || [];
        if (!items.length) break;
        for (const item of items) {
          const tags = item.tags || [];
          const fields = item.fields || {};
          let teamA = '', teamB = '', seriesName = '', matchType = '', matchNumber = '', stage = '';
          for (const tag of tags) {
            const ed = tag.extraData || {};
            if (ed.teamA) teamA = ed.teamA;
            if (ed.teamB) teamB = ed.teamB;
            if (ed.seriesName) seriesName = ed.seriesName;
            if (ed.matchType) matchType = ed.matchType;
            if (ed.matchNumber) matchNumber = ed.matchNumber;
            if (ed.stage) stage = ed.stage;
          }
          all.push({
            title: item.title || 'No Title', id: fields.videoId, status: fields.videoStatus,
            workflow: fields.workflow, startTime: fields.scheduledStartTime,
            streamUrl: fields.mezzanineUrl || null,
            teamA, teamB, seriesName, matchType, matchNumber, stage,
            slug: item.slug, thumbnail: item.thumbnail?.thumbnailUrl || null
          });
        }
        skip += 100;
        if (skip >= 400) break;
      }
      return res.json({ total: all.length, matches: all });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    if (action === 'proxy' && streamUrl) {
      return await proxyStream(req, res);
    } else if (action === 'events') {
      if (cache.events && Date.now() - cache.eventsTime < CACHE_TTL) {
        res.status(200).json(cache.events);
        return;
      }
      const events = await scrapeLiveMatches();
      const result = { success: true, events, total: events.length, fetchedAt: new Date().toISOString() };
      cache.events = result;
      cache.eventsTime = Date.now();
      res.status(200).json(result);
    } else if (action === 'servers' && eventUrl) {
      if (cache.servers[eventUrl] && Date.now() - cache.serversTime[eventUrl] < CACHE_TTL) {
        res.status(200).json(cache.servers[eventUrl]);
        return;
      }
      const pages = await getStreamPages(eventUrl);

      // Extract all streams in parallel
      const results = await Promise.all(
        pages.map(async (page) => {
          const stream = await extractHlsFromPage(page.url);
          if (stream) {
            const proxyUrl = `/api/webcric?action=proxy&streamUrl=${encodeURIComponent(stream.url)}&referer=${encodeURIComponent(stream.referer)}`;
            const { name, logo } = getChannelInfo(stream.channel, page.name);
            return { name, url: proxyUrl, logo };
          }
          return null;
        })
      );

      const servers = results.filter(Boolean);

      if (servers.length > 0) {
        const result = { success: true, servers, total: servers.length };
        cache.servers[eventUrl] = result;
        cache.serversTime[eventUrl] = Date.now();
        res.status(200).json(result);
      } else {
        res.status(200).json({ success: false, error: 'No streams found' });
      }
    } else {
      if (cache.events && Date.now() - cache.eventsTime < CACHE_TTL) {
        res.status(200).json(cache.events);
        return;
      }
      const events = await scrapeLiveMatches();
      const result = { success: true, events, total: events.length, fetchedAt: new Date().toISOString() };
      cache.events = result;
      cache.eventsTime = Date.now();
      res.status(200).json(result);
    }
  } catch (err) {
    res.status(200).json({ success: false, error: err.message, events: [], fetchedAt: new Date().toISOString() });
  }
};
