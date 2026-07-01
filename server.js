const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const RIDES_FILE = process.env.RIDES_FILE || '/data/rides.json';
const FITS_DIR   = path.join(path.dirname(RIDES_FILE), 'fits');
const SAFE_KEY   = /^[a-zA-Z0-9_-]{1,80}$/;

// ── Build metadata stamped into HTML at startup ───────────────────────────────
// ENV vars BUILD_SHA / BUILD_DATE are baked into the Docker image by CI.
// We replace the placeholders once at startup and serve the cached result.
const BUILD_SHA  = process.env.BUILD_SHA  || '';
const BUILD_DATE = process.env.BUILD_DATE || '';
const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
let INDEX_HTML = null;
try {
  INDEX_HTML = fs.readFileSync(INDEX_PATH, 'utf8')
    .replace('content="__BUILD_SHA__"',  `content="${BUILD_SHA}"`)
    .replace('content="__BUILD_DATE__"', `content="${BUILD_DATE}"`);
  console.log(`Build: sha=${BUILD_SHA || '(dev)'} date=${BUILD_DATE || '(dev)'}`);
} catch (e) { console.warn('Could not read index.html:', e.message); }

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Startup: migrate old trails.json → rides.json if needed ──────────────────
(function migrate() {
  const OLD = path.join(path.dirname(RIDES_FILE), 'trails.json');
  if (fs.existsSync(OLD) && !fs.existsSync(RIDES_FILE)) {
    try {
      fs.copyFileSync(OLD, RIDES_FILE);
      console.log(`Migrated ${OLD} → ${RIDES_FILE}`);
    } catch (e) {
      console.warn('Migration failed:', e.message);
    }
  }
})();

function ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── GET /api/rides ────────────────────────────────────────────────────────────
app.get('/api/rides', (req, res) => {
  if (!fs.existsSync(RIDES_FILE)) return res.json([]);
  try {
    const data = JSON.parse(fs.readFileSync(RIDES_FILE, 'utf8'));
    res.json(Array.isArray(data) ? data : []);
  } catch { res.json([]); }
});

// ── POST /api/rides ───────────────────────────────────────────────────────────
app.post('/api/rides', (req, res) => {
  const rides = req.body;
  if (!Array.isArray(rides)) return res.status(400).json({ error: 'Expected array' });
  ensureDir(RIDES_FILE);
  fs.writeFileSync(RIDES_FILE, JSON.stringify(rides, null, 2));
  res.json({ ok: true, count: rides.length });
});

// ── DELETE /api/rides — reset all rides ───────────────────────────────────────
app.delete('/api/rides', (req, res) => {
  ensureDir(RIDES_FILE);
  fs.writeFileSync(RIDES_FILE, JSON.stringify([], null, 2));
  res.json({ ok: true });
});

// ── POST /api/fits/:key — store the raw FIT binary for later rescanning ──────
app.post('/api/fits/:key', express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  const key = req.params.key;
  if (!SAFE_KEY.test(key)) return res.status(400).json({ error: 'Invalid key' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty body' });
  if (!fs.existsSync(FITS_DIR)) fs.mkdirSync(FITS_DIR, { recursive: true });
  fs.writeFileSync(path.join(FITS_DIR, `${key}.fit`), req.body);
  res.json({ ok: true });
});

// ── GET /api/fits/:key — retrieve a previously stored FIT file ───────────────
app.get('/api/fits/:key', (req, res) => {
  const key = req.params.key;
  if (!SAFE_KEY.test(key)) return res.status(400).json({ error: 'Invalid key' });
  const filePath = path.join(FITS_DIR, `${key}.fit`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.type('application/octet-stream').send(fs.readFileSync(filePath));
});

// ── Catch-all → SPA (serve build-stamped HTML) ───────────────────────────────
app.get('*', (req, res) => {
  // In dev (no BUILD_SHA), read fresh from disk each request so HTML edits are
  // picked up without a server restart. In production, serve the stamped cache.
  if (!BUILD_SHA) return res.sendFile(INDEX_PATH);
  if (INDEX_HTML) return res.type('html').send(INDEX_HTML);
  res.sendFile(INDEX_PATH);
});

app.listen(PORT, () => {
  console.log(`Rail Trail Tracker running on http://localhost:${PORT}`);
  console.log(`Rides file: ${RIDES_FILE}`);
});
