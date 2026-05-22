const https = require('https');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action } = req.query;

  try {
    if (action === 'match') {
      const category = req.query.category;
      const streamKey = req.query.key;
      if (!category || !streamKey) {
        res.status(400).json({ success: false, error: 'Missing category or key' });
        return;
      }
      res.json({ success: true, embedUrl: `https://streamfree.app/embed/${category}/${streamKey}` });
      return;
    }

    // Fetch all streams
    const data = await new Promise((resolve, reject) => {
      https.get('https://streamfree.app/streams', {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json'
        },
        timeout: 20000
      }, (resp) => {
        let body = '';
        resp.on('data', chunk => body += chunk);
        resp.on('end', () => resolve(body));
      }).on('error', reject);
    });

    const parsed = JSON.parse(data);
    if (!parsed.streams) {
      res.json({ success: false, error: 'No streams data' });
      return;
    }

    // Flatten all events into a single array
    const events = [];
    const categoryNames = {
      soccer: 'Soccer', basketball: 'Basketball', hockey: 'Hockey',
      combat: 'Combat', baseball: 'Baseball', football: 'Football',
      racing: 'Racing', tennis: 'Tennis', cricket: 'Cricket'
    };

    for (const [category, streams] of Object.entries(parsed.streams)) {
      if (!streams || !Array.isArray(streams)) continue;
      for (const stream of streams) {
        const now = Math.floor(Date.now() / 1000);
        const isLive = stream.match_timestamp <= now + 540;

        events.push({
          id: stream.id,
          name: stream.name,
          streamKey: stream.stream_key,
          category: category,
          league: stream.league || categoryNames[category] || category,
          team1: stream.team1 ? { name: stream.team1.name, logo: stream.team1.logo } : null,
          team2: stream.team2 ? { name: stream.team2.name, logo: stream.team2.logo } : null,
          matchTimestamp: stream.match_timestamp,
          thumbnail: stream.thumbnail_url || null,
          viewers: stream.viewers || 0,
          isLive: isLive,
        });
      }
    }

    events.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return (a.match_timestamp || 0) - (b.match_timestamp || 0);
    });

    res.json({
      success: true,
      events: events,
      totalEvents: events.length,
      categories: Object.keys(parsed.streams).filter(k => parsed.streams[k]?.length > 0),
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    res.status(200).json({ success: false, error: err.message, events: [] });
  }
};
