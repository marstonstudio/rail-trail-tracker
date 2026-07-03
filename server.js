const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const RIDES_FILE = process.env.RIDES_FILE || '/data/rides.json';
const FITS_DIR   = path.join(path.dirname(RIDES_FILE), 'fits');
const TRAIL_GEOM_DIR = path.join(path.dirname(RIDES_FILE), 'trail-geometry');
const IGNORED_TRAILS_FILE = path.join(path.dirname(RIDES_FILE), 'ignored-trails.json');
const FETCH_FAILURES_FILE = path.join(path.dirname(RIDES_FILE), 'trail-fetch-failures.json');
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

// ── GET /api/trail-geometry — bulk-load all cached trail geometry in one shot ─
// { [trailId]: segments } so the client can hydrate its map cache with a
// single request at startup instead of one Overpass fetch per trail.
app.get('/api/trail-geometry', (req, res) => {
  if (!fs.existsSync(TRAIL_GEOM_DIR)) return res.json({});
  const out = {};
  for (const file of fs.readdirSync(TRAIL_GEOM_DIR)) {
    if (!file.endsWith('.json')) continue;
    const id = file.slice(0, -5);
    if (!SAFE_KEY.test(id)) continue;
    try {
      out[id] = JSON.parse(fs.readFileSync(path.join(TRAIL_GEOM_DIR, file), 'utf8'));
    } catch { /* skip corrupt file */ }
  }
  res.json(out);
});

// ── POST /api/trail-geometry/:id — cache one trail's fetched line geometry ───
// Body: { version: N, segments: [[[lat,lng],...],...] } — stored opaquely;
// the client owns interpreting/invalidating by version, this just persists
// whatever shape it's given (including legacy plain-array bodies, for
// backward compatibility with anything cached before versioning existed).
app.post('/api/trail-geometry/:id', (req, res) => {
  const id = req.params.id;
  if (!SAFE_KEY.test(id)) return res.status(400).json({ error: 'Invalid id' });
  const isLegacyArray = Array.isArray(req.body);
  const isVersioned = req.body && typeof req.body === 'object' && Array.isArray(req.body.segments);
  if (!isLegacyArray && !isVersioned) return res.status(400).json({ error: 'Expected {version, segments} or a legacy array of segments' });
  if (!fs.existsSync(TRAIL_GEOM_DIR)) fs.mkdirSync(TRAIL_GEOM_DIR, { recursive: true });
  fs.writeFileSync(path.join(TRAIL_GEOM_DIR, `${id}.json`), JSON.stringify(req.body));
  res.json({ ok: true });
});

// ── GET /api/ignored-trails — list of trail ids excluded from the fetch queue ─
app.get('/api/ignored-trails', (req, res) => {
  if (!fs.existsSync(IGNORED_TRAILS_FILE)) return res.json([]);
  try {
    const data = JSON.parse(fs.readFileSync(IGNORED_TRAILS_FILE, 'utf8'));
    res.json(Array.isArray(data) ? data : []);
  } catch { res.json([]); }
});

// ── POST /api/ignored-trails — save the full ignored-ids array ───────────────
app.post('/api/ignored-trails', (req, res) => {
  const ids = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Expected array' });
  ensureDir(IGNORED_TRAILS_FILE);
  fs.writeFileSync(IGNORED_TRAILS_FILE, JSON.stringify(ids, null, 2));
  res.json({ ok: true, count: ids.length });
});

// ── GET /api/trail-fetch-failures — persisted not-found retry counts ─────────
// { [trailId]: { count, lastFailedAt } } — lets the background queue stop
// automatically re-hammering a trail that has genuinely failed repeatedly
// across sessions, instead of retrying it forever on every page load.
app.get('/api/trail-fetch-failures', (req, res) => {
  if (!fs.existsSync(FETCH_FAILURES_FILE)) return res.json({});
  try {
    const data = JSON.parse(fs.readFileSync(FETCH_FAILURES_FILE, 'utf8'));
    res.json(data && typeof data === 'object' ? data : {});
  } catch { res.json({}); }
});

// ── POST /api/trail-fetch-failures — save the full failure-counts object ─────
app.post('/api/trail-fetch-failures', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'Expected an object' });
  ensureDir(FETCH_FAILURES_FILE);
  fs.writeFileSync(FETCH_FAILURES_FILE, JSON.stringify(data, null, 2));
  res.json({ ok: true });
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
