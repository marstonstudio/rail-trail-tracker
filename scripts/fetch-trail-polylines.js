#!/usr/bin/env node
/**
 * fetch-trail-polylines.js
 *
 * Fetches GPS polylines for all known rail trails from OpenStreetMap (Overpass API).
 * Run once (and re-run any time you add/update trails):
 *
 *   node scripts/fetch-trail-polylines.js
 *
 * Output: public/trail-polylines.json
 * Format: { "<trailId>": [[lat,lng], [lat,lng], ...], ... }
 *
 * Trails with no OSM data fall back to their single reference lat/lng.
 * The matching algorithm treats a 1-point "polyline" as centroid-only mode.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

// ── Trail data (mirrors NEARBY_TRAILS in index.html) ───────────────────────────
// Fields used here: id, name, lat, lng, miles
// Optional: searchTerm overrides the name used in the Overpass query
const TRAILS = [
  // ── 0–15 mi ───────────────────────────────────────────────────────────────────
  { id:'n01', name:'Bruce Freeman Rail Trail',              lat:42.399, lng:-71.471, miles:20 },
  { id:'n02', name:'Minuteman Commuter Bikeway',            lat:42.476, lng:-71.257, miles:10.1 },
  { id:'n03', name:'Assabet River Rail Trail',              lat:42.370, lng:-71.553, miles:12 },
  { id:'n04', name:'Northern Strand Community Trail',       lat:42.450, lng:-71.055, miles:10 },
  { id:'n05', name:'Tri-Community Greenway',                lat:42.476, lng:-71.133, miles:6.5 },
  { id:'n06', name:'Wakefield-Lynnfield Rail Trail',        lat:42.510, lng:-71.062, miles:5 },
  // ── 20–30 mi ─────────────────────────────────────────────────────────────────
  { id:'n07', name:'Nashua River Rail Trail',               lat:42.721, lng:-71.608, miles:12 },
  { id:'n08', name:'Windham Rail Trail',                    lat:42.812, lng:-71.303, miles:5.3 },
  { id:'n09', name:'Salem Bike-Ped Corridor',               lat:42.786, lng:-71.240, miles:5.2,  searchTerm:'Salem Bike' },
  { id:'n10', name:'Potanipo Rail Trail',                   lat:42.729, lng:-71.665, miles:6.5 },
  { id:'n11', name:'Upper Charles Rail Trail',              lat:42.195, lng:-71.456, miles:9 },
  { id:'n12', name:'Mass Central Rail Trail',               lat:42.280, lng:-71.800, miles:64,   searchTerm:'Mass Central Rail Trail' },
  { id:'n13', name:'Blackstone River Greenway',             lat:42.198, lng:-71.793, miles:20 },
  { id:'n14', name:'Mason-Greenville Rail Trail',           lat:42.748, lng:-71.755, miles:9.1,  searchTerm:'Mason Railroad Trail' },
  // ── 30–45 mi ─────────────────────────────────────────────────────────────────
  { id:'n15', name:'Southern New England Trunkline Trail',  lat:42.060, lng:-71.652, miles:22,   searchTerm:'Southern New England Trunkline' },
  { id:'n16', name:'World War II Veterans Memorial Trail',  lat:42.012, lng:-71.194, miles:6,    searchTerm:'Veterans Memorial Trail' },
  { id:'n17', name:'Rockingham Rail Trail',                 lat:42.930, lng:-71.175, miles:18,   searchTerm:'Rockingham Recreational Rail Trail' },
  { id:'n18', name:'Blackstone River Bikeway',              lat:41.948, lng:-71.492, miles:11.6 },
  { id:'n19', name:'Rockingham Recreational Trail',         lat:43.002, lng:-71.253, miles:26,   searchTerm:'Rockingham Recreational Rail Trail' },
  { id:'n20', name:'Goffstown Rail Trail',                  lat:42.993, lng:-71.617, miles:5.5 },
  { id:'n21', name:'Monadnock Rail Trail',                  lat:42.817, lng:-72.042, miles:7.5,  searchTerm:'Monadnock Recreational Rail Trail' },
  { id:'n22', name:'Peterborough Rail Trail',               lat:42.867, lng:-71.950, miles:6,    searchTerm:'Peterborough' },
  // ── 45–55 mi ─────────────────────────────────────────────────────────────────
  { id:'n23', name:'Rockingham Rail Trail (Portsmouth Branch)', lat:43.050, lng:-71.098, miles:25.3, searchTerm:'Rockingham Recreational Rail Trail' },
  { id:'n24', name:'Cheshire Rail Trail South',             lat:42.870, lng:-72.076, miles:18.5, searchTerm:'Cheshire Branch Rail Trail' },
  { id:'n25', name:'Grand Trunk Trail',                     lat:42.096, lng:-72.076, miles:7 },
  { id:'n26', name:'Air Line State Park Trail',             lat:41.900, lng:-71.870, miles:22,   searchTerm:'Air Line Trail' },
  { id:'n27', name:'Washington Secondary Rail Trail',       lat:41.755, lng:-71.553, miles:19,   searchTerm:'Washington Secondary' },
  { id:'n28', name:'East Bay Bike Path',                    lat:41.698, lng:-71.275, miles:14.5 },
  { id:'n29', name:'Concord-Lake Sunapee Rail Trail',       lat:43.150, lng:-71.860, miles:35,   searchTerm:'Concord Lake Sunapee' },
  { id:'n30', name:'NH Seacoast Greenway',                  lat:43.017, lng:-70.870, miles:8,    searchTerm:'Seacoast Greenway' },
  { id:'n31', name:'Hillsborough Rail Trail',               lat:43.113, lng:-71.906, miles:8,    searchTerm:'Hillsborough Recreational Rail Trail' },
  // ── 55–70 mi ─────────────────────────────────────────────────────────────────
  { id:'n32', name:'Eastern Trail',                         lat:43.290, lng:-70.720, miles:65,   searchTerm:'Eastern Trail' },
  { id:'n33', name:'Ashuelot Rail Trail',                   lat:42.930, lng:-72.254, miles:21,   searchTerm:'Ashuelot Recreational Rail Trail' },
  { id:'n34', name:'Cheshire Rail Trail North',             lat:43.012, lng:-72.295, miles:17.8, searchTerm:'Cheshire Recreational Rail Trail' },
  { id:'n35', name:'Northern Rail Trail',                   lat:43.350, lng:-71.900, miles:59,   searchTerm:'Northern Rail Trail' },
  { id:'n36', name:'Fort Hill Recreational Rail Trail',     lat:42.781, lng:-72.482, miles:8,    searchTerm:'Fort Hill Recreational Rail Trail' },
  { id:'n37', name:'Farmington Rail Trail',                 lat:43.388, lng:-71.065, miles:6,    searchTerm:'Farmington Recreational Rail Trail' },
  // ── 68–80 mi ─────────────────────────────────────────────────────────────────
  { id:'n38', name:'Winnipesaukee River Trail',             lat:43.443, lng:-71.649, miles:5 },
  { id:'n39', name:'Manhan Rail Trail',                     lat:42.267, lng:-72.673, miles:6 },
  { id:'n40', name:'Shining Sea Bikeway',                   lat:41.560, lng:-70.638, miles:10.7 },
  { id:'n41', name:'Sugar River Rail Trail',                lat:43.371, lng:-72.174, miles:9.5,  searchTerm:'Sugar River Recreational Rail Trail' },
  { id:'n42', name:'Hop River State Park Trail',            lat:41.800, lng:-72.390, miles:20.8, searchTerm:'Hop River State Park Trail' },
  { id:'n43', name:'Cotton Valley Rail Trail',              lat:43.578, lng:-71.209, miles:12 },
  { id:'n44', name:'Columbia Greenway Rail Trail',          lat:42.119, lng:-72.749, miles:6.5 },
  // ── 80–100 mi ────────────────────────────────────────────────────────────────
  { id:'n45', name:'Cape Cod Rail Trail',                   lat:41.783, lng:-70.049, miles:25.5 },
  { id:'n46', name:'Old Colony Rail Trail',                 lat:41.828, lng:-70.077, miles:9.4 },
  { id:'n47', name:'Southwick Rail Trail',                  lat:42.062, lng:-72.769, miles:8 },
  { id:'n48', name:'Farmington Canal Heritage Trail',       lat:41.870, lng:-72.810, miles:20,   searchTerm:'Farmington Canal Heritage Trail' },
  { id:'n49', name:'Norwottuck Rail Trail',                 lat:42.304, lng:-72.455, miles:10 },
  { id:'n50', name:'Ashuwillticook Rail Trail',             lat:42.637, lng:-73.121, miles:12 },
];

// ── Config ─────────────────────────────────────────────────────────────────────
const OVERPASS_URL  = 'https://overpass-api.de/api/interpreter';
const DELAY_MS      = 1200;   // polite rate limit between requests
const TIMEOUT_MS    = 25000;
const MAX_PTS       = 300;    // max stored points per trail (aim for ~1 per 150–300m)
const MAX_BBOX_DEG  = 0.60;   // cap bbox radius so huge trails don't explode

// ── Helpers ────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchText(url, postBody, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('too many redirects'));
    const u   = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'rail-trail-tracker/1.0 (personal project)',
      'Accept':     'application/json',
    };
    if (postBody) {
      headers['Content-Type']   = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(postBody);
    }
    const req = lib.request({
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method:   postBody ? 'POST' : 'GET',
      headers,
    }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchText(res.headers.location, postBody, hops + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', err => reject(new Error(err.code ? `${err.code}: ${err.message}` : err.message || JSON.stringify(err))));
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
    if (postBody) req.write(postBody);
    req.end();
  });
}

/** Build a lat/lng bounding box for the trail, capped at MAX_BBOX_DEG. */
function trailBbox(trail) {
  const { lat, lng, miles } = trail;
  const half   = miles / 2;
  const δlat   = Math.min(half / 69, MAX_BBOX_DEG);
  const δlng   = Math.min(half / (69 * Math.cos(lat * Math.PI / 180)), MAX_BBOX_DEG);
  const s = (lat - δlat).toFixed(4);
  const n = (lat + δlat).toFixed(4);
  const w = (lng - δlng).toFixed(4);
  const e = (lng + δlng).toFixed(4);
  return `${s},${w},${n},${e}`;
}

/** Downsample an array of [lat,lng] to at most maxPts, preserving start and end. */
function downsample(pts, maxPts) {
  if (pts.length <= maxPts) return pts;
  const step   = Math.ceil(pts.length / maxPts);
  const result = pts.filter((_, i) => i % step === 0);
  // Always keep the last point
  const last = pts[pts.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

/**
 * Query Overpass for ways matching the trail name within its bounding box.
 * Returns an array of [lat, lng] points (may be unsorted / from multiple ways).
 */
async function fetchWayPoints(trail) {
  const bbox       = trailBbox(trail);
  const term       = (trail.searchTerm || trail.name).replace(/"/g, '\\"');
  const query = `[out:json][timeout:20];
way["name"~"${term}","i"]["highway"~"path|cycleway|track|footway|bridleway|unclassified"](${bbox});
out geom qt;`;

  const body = 'data=' + encodeURIComponent(query);
  const text = await fetchText(OVERPASS_URL, body);
  if (!text || !text.trim()) return [];

  const json = JSON.parse(text);
  const pts  = [];
  for (const el of (json.elements || [])) {
    if (el.geometry) {
      for (const g of el.geometry) pts.push([g.lat, g.lon]);
    }
  }
  return pts;
}

/**
 * Fallback: query Overpass for a route relation matching the trail name.
 * Returns member way nodes (may be large — we downsample afterwards).
 */
async function fetchRelationPoints(trail) {
  const bbox       = trailBbox(trail);
  const term       = (trail.searchTerm || trail.name).replace(/"/g, '\\"');
  const query = `[out:json][timeout:20];
relation["name"~"${term}","i"]["route"~"bicycle|foot|hiking"](${bbox});
out geom qt;`;

  const body = 'data=' + encodeURIComponent(query);
  const text = await fetchText(OVERPASS_URL, body);
  if (!text || !text.trim()) return [];

  const json = JSON.parse(text);
  const pts  = [];
  for (const el of (json.elements || [])) {
    if (el.type === 'relation') {
      for (const member of (el.members || [])) {
        if (member.type === 'way' && member.geometry) {
          for (const g of member.geometry) pts.push([g.lat, g.lon]);
        }
      }
    }
  }
  return pts;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const outPath = path.join(__dirname, '../public/trail-polylines.json');
  const result  = {};
  let fetched = 0, fallback = 0;

  console.log(`Fetching polylines for ${TRAILS.length} trails from OpenStreetMap…\n`);

  for (const trail of TRAILS) {
    process.stdout.write(`  [${trail.id}] ${trail.name} … `);

    let pts = [];
    try {
      // 1. Try ways (faster, geometry inline)
      pts = await fetchWayPoints(trail);

      // 2. If no ways found, try route relations
      if (pts.length === 0) {
        pts = await fetchRelationPoints(trail);
      }
    } catch (err) {
      process.stdout.write(`ERROR (${err.message}) `);
    }

    if (pts.length >= 4) {
      const before = pts.length;
      pts = downsample(pts, MAX_PTS);
      console.log(`${before} pts → ${pts.length} stored`);
      result[trail.id] = pts;
      fetched++;
    } else {
      // Fall back to single reference point; matching will use centroid mode
      console.log(`no OSM data — using center point`);
      result[trail.id] = [[trail.lat, trail.lng]];
      fallback++;
    }

    await sleep(DELAY_MS);
  }

  // Write output
  fs.writeFileSync(outPath, JSON.stringify(result));

  const size = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\n✅ Done. ${fetched} trails with OSM data, ${fallback} using center-point fallback.`);
  console.log(`   Saved → ${outPath} (${size} KB)`);
  console.log(`\nRestart your dev server and refresh to pick up the new polylines.`);
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1); });
