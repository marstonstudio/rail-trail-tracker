const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT      || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/trails.json';

app.use(express.json({ limit: '20mb' })); // FIT polylines can be chunky
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/trails ──────────────────────────────────────────────────────────
app.get('/api/trails', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.json([]);
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(Array.isArray(data) ? data : []);
  } catch {
    res.json([]);
  }
});

// ── POST /api/trails ─────────────────────────────────────────────────────────
app.post('/api/trails', (req, res) => {
  const trails = req.body;
  if (!Array.isArray(trails)) return res.status(400).json({ error: 'Expected array' });

  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(DATA_FILE, JSON.stringify(trails, null, 2));
  res.json({ ok: true, count: trails.length });
});

// ── Catch-all → SPA ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Rail Trail Tracker running on http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
