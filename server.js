const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const RIDES_FILE = process.env.RIDES_FILE || '/data/rides.json';

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// ── Catch-all → SPA ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Rail Trail Tracker running on http://localhost:${PORT}`);
  console.log(`Rides file: ${RIDES_FILE}`);
});
