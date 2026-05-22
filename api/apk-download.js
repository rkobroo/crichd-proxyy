const { MongoClient } = require('mongodb');
const APK_FILE_URL = '/rkotv-file.apk';
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

async function logDownload(req) {
  const country = req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || '';
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
  const ua = req.headers['user-agent'] || '';
  const referer = req.headers['referer'] || '';
  const timestamp = new Date().toISOString();

  if (MONGO_URI) {
    const db = await getDb();
    await db.collection('downloads').insertOne({ country, ip, ua, referer, timestamp });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && req.query.action === 'stats') {
    try {
      const db = await getDb();
      const collection = db.collection('downloads');
      const total = await collection.countDocuments();
      const downloads = await collection.find({})
        .sort({ timestamp: -1 })
        .limit(1000)
        .toArray();

      return res.status(200).json({ total, downloads });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action === 'clear') {
      try {
        const db = await getDb();
        await db.collection('downloads').deleteMany({});
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (body.action === 'delete' && body.id) {
      try {
        const db = await getDb();
        const { ObjectId } = require('mongodb');
        const result = await db.collection('downloads').deleteOne({ _id: new ObjectId(body.id) });
        return res.status(200).json({ ok: true, deleted: result.deletedCount });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    try { await logDownload(req); } catch (err) { console.error('Download log error:', err); }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    try { await logDownload(req); } catch (err) { console.error('Download log error:', err); }
    res.setHeader('Location', APK_FILE_URL);
    return res.status(302).end();
  }

  res.status(405).end();
};
