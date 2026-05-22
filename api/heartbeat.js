const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const MONGO_URI = process.env.MONGODB_URI;

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;
  if (!MONGO_URI) throw new Error('MONGODB_URI env var required');
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
    });
  }
  await cachedClient.connect();
  cachedDb = cachedClient.db('rko-tv');
  return cachedDb;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    const isVersion = req.url && req.url.includes('/api/latest-version');
    if (isVersion) {
      res.setHeader('Cache-Control', 'no-cache');
      try {
        const versionPath = path.join(__dirname, '..', 'version.json');
        const data = fs.readFileSync(versionPath, 'utf-8');
        return res.json(JSON.parse(data));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.query.action === 'live') {
      try {
        const db = await getDb();
        const cutoff = new Date(Date.now() - 60000).toISOString();
        const active = await db.collection('heartbeats')
          .find({ lastSeen: { $gt: cutoff } })
          .project({ _id: 0, sessionId: 1, country: 1, ip: 1, ua: 1, page: 1, lastSeen: 1 })
          .sort({ lastSeen: -1 })
          .toArray();
        return res.json({ total: active.length, users: active });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const sessionId = body.sessionId || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    const country = body.country || req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || '';
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    const ua = req.headers['user-agent'] || '';
    const page = req.headers['referer'] || '';

    if (MONGO_URI) {
      const db = await getDb();
      await db.collection('heartbeats').updateOne(
        { sessionId },
        { $set: { sessionId, country, ip, ua, page, lastSeen: new Date().toISOString() } },
        { upsert: true }
      );
    }

    return res.json({ ok: true });
  }

  res.status(405).end();
};
