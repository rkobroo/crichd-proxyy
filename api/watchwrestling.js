const https = require('https');

const BASE_URL = 'https://watchwrestling.ae';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

const CATEGORIES = [
  { name: 'WWE', url: `${BASE_URL}/` },
  { name: 'UFC', url: `${BASE_URL}/ufc41/` },
  { name: 'AEW', url: `${BASE_URL}/aew65/` },
  { name: 'NJPW', url: `${BASE_URL}/njpw51/` },
  { name: 'ROH', url: `${BASE_URL}/roh24/` },
  { name: 'Impact Wrestling', url: `${BASE_URL}/impact-wrestlingss30/` },
  { name: 'Other Wrestling', url: `${BASE_URL}/other-wrestling30/` },
];

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
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        httpGet(redirectUrl, headers, maxRedirects - 1)
          .then(result => resolve({ ...result }))
          .catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ text: data, status: res.statusCode, finalUrl: url }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function scrapeEvents(categoryUrl) {
  const { text: html } = await httpGet(categoryUrl);
  const events = [];
  const seen = new Set();

  const itemRegex = /<div[^>]*class="item[^"]*cf[^>]*>([\s\S]*?)<\/div>\s*<!--\s*end\s*#post-/gi;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<h2[^>]*class="entry-title"[^>]*>[\s\S]*?<a[^>]*href="[^"]*"[^>]*>([^<]+)<\/a>/i);
    const linkMatch = block.match(/<h2[^>]*class="entry-title"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"/i);
    const imgMatch = block.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);

    if (titleMatch && linkMatch) {
      const title = titleMatch[1].replace(/&#8211;/g, '-').replace(/&#8217;/g, "'").trim();
      const url = linkMatch[1];
      const poster = imgMatch ? imgMatch[1] : null;
      const slug = new URL(url).pathname;

      if (!seen.has(slug)) {
        seen.add(slug);
        events.push({ title, url, poster, slug });
      }
    }
  }

  return events;
}

async function scrapeEventPage(eventUrl) {
  const { text: html } = await httpGet(eventUrl);
  const servers = [];

  let hiddenHtml = '';
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const content = scriptMatch[1];
    if (content.includes('episodeRepeater') && content.includes('textarea')) {
      const textareaMatch = content.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
      if (textareaMatch) {
        hiddenHtml = textareaMatch[1];
      } else {
        const innerMatch = content.match(/<textarea[^>]*(?:value|innerHTML)\s*=\s*["']([\s\S]*?)["']/i);
        if (innerMatch) hiddenHtml = innerMatch[1];
      }
    }
  }

  if (!hiddenHtml) {
    const directIframeMatch = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (directIframeMatch) {
      servers.push({ name: 'Direct Embed', url: directIframeMatch[1] });
    }
    return servers;
  }

  const innerDoc = hiddenHtml;
  const blockRegex = /<div\s+class=["']episodeRepeater["'][^>]*>([\s\S]*?)<\/div>/gi;
  let blockMatch;
  let serverNum = 1;

  while ((blockMatch = blockRegex.exec(innerDoc)) !== null) {
    const block = blockMatch[1];
    const titleMatch = block.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const hostTitle = titleMatch
      ? titleMatch[1].replace(/Watch\s*/gi, '').replace(/HD/gi, '').trim()
      : `Server ${serverNum}`;

    const linkRegex = /<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(block)) !== null) {
      const videoUrl = linkMatch[1];
      const partLabel = linkMatch[2].trim();
      const name = partLabel ? `${hostTitle} - ${partLabel}` : hostTitle;

      if (videoUrl && videoUrl.startsWith('http')) {
        servers.push({ name, url: videoUrl });
        serverNum++;
      }
    }
  }

  return servers;
}

function extractVideoUrl(html) {
  // Try common video URL patterns in order of reliability
  const patterns = [
    // HLS URLs anywhere
    /(?:https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/gi,
    // MP4 URLs
    /(?:https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/gi,
    // <source src="...m3u8" type="application/x-mpegURL">
    /<source[^>]+src=["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    // data attributes
    /data-(?:source|hls|video|stream|src)["']?\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    // JW Player sources array
    /sources:\s*\[([^\]]+)\]/i,
    // file/src property in JS objects (JW Player, Video.js, etc.)
    /["'](?:file|src|url)["']\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /playlistUrl["']?\s*[:=]\s*["']([^"']+)["']/i,
    /hls_url["']?\s*[:=]\s*["']([^"']+)["']/i,
    /videoUrl["']?\s*[:=]\s*["']([^"']+)["']/i,
    /video_url["']?\s*[:=]\s*["']([^"']+)["']/i,
    /mp4_url["']?\s*[:=]\s*["']([^"']+)["']/i,
    // player.src("...m3u8")
    /player\.src\(["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']\)/i,
    /loadSource\(["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']\)/i,
    // var xxxUrl = "...m3u8"
    /(?:var|let|const)\s+\w*[Uu]rl\s*=\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    // Generic source/file/src assignments (broad)
    /(?:file|source|src|url|link)["']?\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
  ];

  const results = [];
  for (const pattern of patterns) {
    let m;
    if (pattern.global) pattern.lastIndex = 0;
    while ((m = pattern.exec(html)) !== null) {
      const url = m[1] || m[0];
      if (url && url.startsWith('http') && (url.includes('.m3u8') || url.includes('.mp4'))) {
        results.push(url);
      }
    }
    if (results.length > 0) break;
  }

  // Deduplicate and prefer m3u8 over mp4
  const unique = [...new Set(results)];
  const m3u8 = unique.find(u => u.includes('.m3u8'));
  return m3u8 || unique[0] || null;
}

async function resolveDailymotionUrl(dmUrl) {
  try {
    const videoId = dmUrl.match(/video\/([a-zA-Z0-9]+)/i);
    if (!videoId) return null;
    const { text } = await httpGet(`https://www.dailymotion.com/player/metadata/video/${videoId[1]}`, {
      'Accept': 'application/json',
      'Referer': 'https://www.dailymotion.com/'
    });
    const meta = JSON.parse(text);
    // Dailymotion returns qualities in meta.qualities
    if (meta && meta.qualities) {
      const prefer = ['auto', '1080', '720', '480', '360'];
      for (const q of prefer) {
        if (meta.qualities[q] && meta.qualities[q][0] && meta.qualities[q][0].url) {
          return meta.qualities[q][0].url;
        }
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Try constructing Firebase HLS URL from channel ID in query params
function tryConstructFirebaseUrl(serverUrl) {
  const idMatch = serverUrl.match(/[?&]id=([^&]+)/);
  if (!idMatch) return null;
  const idParts = idMatch[1].match(/ch(\d+)_(SD|LQ|HD|FHD)/i);
  if (!idParts) return null;
  const channel = idParts[1];
  const quality = idParts[2].toUpperCase();
  const firebaseUrl = `https://android-database1.firebase-api.com/AccessLog2/1080${channel}_${quality}/apache.m3u8`;
  try {
    return httpGet(firebaseUrl, { Referer: 'https://watchwrestling.ae' }, 3).then(({ status }) =>
      status === 200 ? { url: firebaseUrl, type: 'm3u8' } : null
    );
  } catch(e) { return null; }
}

async function resolveStreamUrl(serverUrl, eventPageUrl) {
  try {
    // Direct .m3u8 URL — return as-is
    if (serverUrl.includes('.m3u8')) {
      return { url: serverUrl, type: 'm3u8' };
    }

    // Dailymotion — extract direct video URL via metadata API
    if (serverUrl.includes('dailymotion.com') || serverUrl.includes('dai.ly')) {
      const direct = await resolveDailymotionUrl(serverUrl);
      if (direct) return { url: direct, type: 'm3u8' };
      return { url: serverUrl, type: 'iframe' };
    }

    // Try Firebase URL construction for any URL with channel ID pattern
    const firebaseResult = await tryConstructFirebaseUrl(serverUrl);
    if (firebaseResult) return firebaseResult;

    if (serverUrl.includes('punjabeducareapp.com') || serverUrl.includes('tuberep_')) {
      // tuberep_ variant - extract m3u8 from linux-developers.top
      if (serverUrl.includes('tuberep_')) {
        const id = serverUrl.substring(serverUrl.lastIndexOf('id=') + 3).split('&')[0];
        const mirror = serverUrl.substring(serverUrl.lastIndexOf('tuberep_') + 8);
        const link = `https://451nj1za7g9v2kexgxatdrh.linux-developers.top/vgroupWRSc/vsecureWRSc/?line=${id}${mirror}&waiting=C&background=undefined`;

        const { text: videoHtml } = await httpGet(link, { Referer: link });
        const videoUrl = extractVideoUrl(videoHtml);
        if (videoUrl) return { url: videoUrl, type: videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4' };
        return { url: serverUrl, type: 'iframe' };
      }

      // Regular variant — follow iframe chain, search for video at each level
      const { text: pageHtml, finalUrl } = await httpGet(serverUrl, { Referer: eventPageUrl }, 10);
      // Check if we ended up on Dailymotion after redirects
      if (finalUrl && (finalUrl.includes('dailymotion.com') || finalUrl.includes('dai.ly'))) {
        const direct = await resolveDailymotionUrl(finalUrl);
        if (direct) return { url: direct, type: 'm3u8' };
      }
      // Try constructing Firebase HLS URL from channel ID query params
      // Pattern: https://android-database1.firebase-api.com/AccessLog2/1080{channel}_{quality}/apache.m3u8
      const firebaseResult = tryConstructFirebaseUrl(serverUrl);
      if (firebaseResult) return firebaseResult;
      // Try to extract video URL from the final page (may have m3u8 after redirect)
      let videoUrl = extractVideoUrl(pageHtml);
      if (videoUrl) return { url: videoUrl, type: videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4' };

      let lastIframeUrl = null;
      const iframeSrcs = pageHtml.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi) || [];
      for (const iframeTag of iframeSrcs) {
        const srcMatch = iframeTag.match(/src=["'](https?:\/\/[^"']+)["']/i);
        if (!srcMatch) continue;
        const iframeUrl = srcMatch[1];
        lastIframeUrl = iframeUrl;

        if (iframeUrl.includes('dailymotion.com') || iframeUrl.includes('dai.ly')) {
          const direct = await resolveDailymotionUrl(iframeUrl);
          if (direct) return { url: direct, type: 'm3u8' };
        }

        if (iframeUrl.includes('/null')) continue;
        const { text: iframeHtml, finalUrl: iframeFinalUrl } = await httpGet(iframeUrl, { Referer: serverUrl }, 10);
        // Check Dailymotion redirect from iframe URL
        if (iframeFinalUrl && (iframeFinalUrl.includes('dailymotion.com') || iframeFinalUrl.includes('dai.ly'))) {
          const direct = await resolveDailymotionUrl(iframeFinalUrl);
          if (direct) return { url: direct, type: 'm3u8' };
        }
        videoUrl = extractVideoUrl(iframeHtml);
        if (videoUrl) return { url: videoUrl, type: videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4' };

        // Second level
        let lastInnerIframeUrl = null;
        const innerSrcs = iframeHtml.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi) || [];
        for (const innerTag of innerSrcs) {
          const innerMatch = innerTag.match(/src=["'](https?:\/\/[^"']+)["']/i);
          if (!innerMatch) continue;
          const innerUrl = innerMatch[1];
          lastInnerIframeUrl = innerUrl;

          if (innerUrl.includes('dailymotion.com') || innerUrl.includes('dai.ly')) {
            const direct = await resolveDailymotionUrl(innerUrl);
            if (direct) return { url: direct, type: 'm3u8' };
          }

          if (innerUrl.includes('/null')) continue;
          const { text: innerHtml, finalUrl: innerFinalUrl } = await httpGet(innerUrl, { Referer: iframeUrl }, 10);
          if (innerFinalUrl && (innerFinalUrl.includes('dailymotion.com') || innerFinalUrl.includes('dai.ly'))) {
            const direct = await resolveDailymotionUrl(innerFinalUrl);
            if (direct) return { url: direct, type: 'm3u8' };
          }
          videoUrl = extractVideoUrl(innerHtml);
          if (videoUrl) return { url: videoUrl, type: videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4' };
        }

        if (lastInnerIframeUrl) lastIframeUrl = lastInnerIframeUrl;
      }

      return { url: lastIframeUrl || serverUrl, type: 'iframe' };
    }

    // Generic embed/player pages
    if (serverUrl.includes('embed') || serverUrl.includes('player')) {
      const { text: embedHtml, finalUrl: embedFinalUrl } = await httpGet(serverUrl, { Referer: eventPageUrl }, 10);
      if (embedFinalUrl && (embedFinalUrl.includes('dailymotion.com') || embedFinalUrl.includes('dai.ly'))) {
        const direct = await resolveDailymotionUrl(embedFinalUrl);
        if (direct) return { url: direct, type: 'm3u8' };
      }
      let videoUrl = extractVideoUrl(embedHtml);
      if (videoUrl) return { url: videoUrl, type: videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4' };

      const iframeMatch = embedHtml.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
      if (iframeMatch) {
        const innerUrl = iframeMatch[1];

        if (innerUrl.includes('dailymotion.com') || innerUrl.includes('dai.ly')) {
          const direct = await resolveDailymotionUrl(innerUrl);
          if (direct) return { url: direct, type: 'm3u8' };
        }

        const { text: innerHtml, finalUrl: innerFinalUrl } = await httpGet(innerUrl, { Referer: serverUrl }, 10);
        if (innerFinalUrl && (innerFinalUrl.includes('dailymotion.com') || innerFinalUrl.includes('dai.ly'))) {
          const direct = await resolveDailymotionUrl(innerFinalUrl);
          if (direct) return { url: direct, type: 'm3u8' };
        }
        videoUrl = extractVideoUrl(innerHtml);
        if (videoUrl) return { url: videoUrl, type: videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4' };

        // Return the embed iframe URL, not the original server URL
        return { url: innerUrl, type: 'iframe' };
      }
    }

    return { url: serverUrl, type: 'iframe' };
  } catch (err) {
    console.error('resolveStreamUrl error:', err.message);
    return { url: serverUrl, type: 'iframe' };
  }
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

  const { action, eventUrl, serverUrl, url } = req.query;

  try {
    if (action === 'servers' && eventUrl) {
      const servers = await scrapeEventPage(eventUrl);
      res.status(200).json({ success: true, servers, total: servers.length });
    } else if (action === 'stream' && serverUrl && req.query.referer) {
      const stream = await resolveStreamUrl(serverUrl, req.query.referer);
      res.status(200).json({ success: true, stream });
    } else if (action === 'proxy-embed' && url) {
      // Proxy an embed page with correct referer, stripping anti-embed JS
      const referer = req.query.referer || url;
      const { text: html, finalUrl } = await httpGet(url, { Referer: referer }, 10);
      const baseUrl = finalUrl || url;
      // Strip anti-embed/anti-iframe scripts
      let clean = html
        .replace(/<script[^>]*>[\s\S]*?ConsoleBan[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?isEmbedded[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?window\.self[\s\S]*?window\.top[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?document\.referrer[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?document\.write\([\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?(?:loyaltycheck|finaloutput|pvpoutput)[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?self\s*!==\s*top[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?top\s*!==\s*self[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?parent\.document[\s\S]*?<\/script>/gi, '');
      // Inject base tag for relative URLs
      if (!clean.match(/<base\s/i)) {
        if (clean.includes('<head>')) {
          clean = clean.replace('<head>', `<head><base href="${baseUrl}">`);
        } else {
          clean = `<base href="${baseUrl}">\n` + clean;
        }
      }
      // Inject URL-capture script so parent page can extract the m3u8 stream URL
      const captureScript = `
<script>
(function(){
  var captured = null;
  function tryCapture(url) {
    if (!url || captured) return;
    if (typeof url === 'string' && (url.includes('.m3u8') || url.includes('.mp4'))) {
      captured = url;
      window._capturedM3u8 = url;
    }
  }
  function patchHls(ctor) {
    if (!ctor || !ctor.prototype) return;
    var orig = ctor.prototype.loadSource;
    ctor.prototype.loadSource = function(url) {
      tryCapture(url);
      return orig ? orig.call(this, url) : undefined;
    };
  }
  // Patch HLS.js now if available; also watch for lazyloaded HLS.js
  patchHls(window.Hls);
  var hlsWatchTimer = setInterval(function() {
    if (window.Hls && window.Hls._patched) return;
    if (window.Hls) { window.Hls._patched = true; patchHls(window.Hls); }
  }, 200);
  // Watch for new video elements
  var obs = new MutationObserver(function(muts) {
    muts.forEach(function(mut) {
      mut.addedNodes.forEach(function(n) {
        if (n.tagName === 'VIDEO' && n.src) tryCapture(n.src);
        if (n.querySelectorAll) {
          n.querySelectorAll('video').forEach(function(v) {
            if (v.src) tryCapture(v.src);
          });
        }
      });
    });
  });
  obs.observe(document, { childList: true, subtree: true });
  // Check existing videos
  document.querySelectorAll('video').forEach(function(v) {
    if (v.src) tryCapture(v.src);
  });
  // Poll for player configs and globals
  var pollTimer = setInterval(function() {
    if (captured) { clearInterval(pollTimer); clearInterval(hlsWatchTimer); return; }
    try {
      if (window.jwplayer) {
        var perf = window.jwplayer().getPlaylistItem && window.jwplayer().getPlaylistItem();
        if (perf && perf.file) tryCapture(perf.file);
        if (perf && perf.sources) perf.sources.forEach(function(s) { tryCapture(s.file); });
      }
    } catch(e) {}
    try {
      if (window.player && window.player.options && window.player.options.sources) {
        window.player.options.sources.forEach(function(s) { tryCapture(s); });
      }
    } catch(e) {}
    try {
      if (window.videojs) {
        var vjs = window.videojs();
        if (vjs && vjs.src) tryCapture(vjs.src());
      }
    } catch(e) {}
    for (var k in window) {
      try {
        var v = window[k];
        if (typeof v === 'string' && (v.includes('.m3u8') || v.includes('.mp4'))) tryCapture(v);
      } catch(e) {}
    }
  }, 1000);
})();
</script>`;
      clean = clean.replace('</body>', captureScript + '\n</body>');
      if (!clean.includes('</body>')) clean += captureScript;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.status(200).send(clean);
    } else {
      let allEvents = [];

      const category = req.query.category;
      if (category) {
        const cat = CATEGORIES.find(c => c.name.toLowerCase().includes(category.toLowerCase()));
        if (cat) {
          allEvents = await scrapeEvents(cat.url);
        }
      } else {
        const results = await Promise.allSettled(
          CATEGORIES.map(cat => scrapeEvents(cat.url))
        );

        const eventMap = new Map();
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            result.value.forEach(event => {
              if (!eventMap.has(event.slug)) {
                eventMap.set(event.slug, { ...event, category: 'Wrestling' });
              }
            });
          }
        });

        allEvents = Array.from(eventMap.values());
      }

      res.status(200).json({
        success: true,
        events: allEvents,
        total: allEvents.length,
        categories: CATEGORIES.map(c => c.name),
        fetchedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    res.status(200).json({
      success: false,
      error: err.message,
      events: [],
      fetchedAt: new Date().toISOString()
    });
  }
};
