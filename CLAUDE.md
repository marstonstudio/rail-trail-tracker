# Rail Trail Tracker — Claude Code Context

## What this is

A single-page web app for tracking bicycle rides on rail trails. Users import Garmin `.fit` files, which get matched to a curated list of nearby trails via GPS overlap scoring. Rides are persisted server-side in a JSON file. The app is self-hosted on a Synology NAS via Docker.

## Stack

- **Backend**: Node.js / Express (`server.js`) — serves the SPA and a small REST API
- **Frontend**: Vanilla JS + Leaflet maps, all in `public/index.html` (single file, no build step)
- **Persistence**: `rides.json` mounted from NAS at `/data/rides.json`
- **Container**: Docker, multi-platform (`linux/amd64` + `linux/arm64`)
- **CI/CD**: GitHub Actions → Docker Hub (`marstonstudio/rail-trail-tracker`)
- **Deployment**: NAS pulls `:latest` and runs via `docker-compose.nas.yml`

## Key files

```
server.js                          Express server + build metadata stamping
public/index.html                  Entire frontend (HTML + CSS + JS, ~2500 lines)
Dockerfile                         Multi-platform build, ENV-based build metadata
.github/workflows/docker-publish.yml   CI: build → push to Docker Hub on main
docker-compose.nas.yml             NAS deployment config
publish.sh                         Local manual publish helper (rarely used)
```

## Build metadata / version badge

The app shows a build badge in the header (hover to see SHA + date).

**How it works** — two-step approach to avoid Docker BuildKit GHA cache bugs:
1. `Dockerfile` bakes `BUILD_SHA` and `BUILD_DATE` as `ENV` vars (from `ARG`, passed by CI)
2. `server.js` reads `process.env.BUILD_SHA / BUILD_DATE` at startup and replaces `__BUILD_SHA__` / `__BUILD_DATE__` placeholders in `index.html` in memory — the stamped HTML is cached and served from the catch-all route

**Why not `RUN sed` in Dockerfile**: Docker BuildKit's GHA layer cache (`cache-from: type=gha`) reuses cached `RUN` layers even when build args change, so `sed` silently no-ops. The ENV → Node.js approach is immune to this.

In local dev, `BUILD_SHA` is empty, so the badge shows "Local dev build" — that is correct and expected.

The same `build-sha` meta tag also drives `IS_PROD_BUILD` (`index.html`) — `true` only when a real SHA has been stamped in, `false` in dev where the raw `__BUILD_SHA__` placeholder is left in place. This paces `fetchAllNearbyTrailLines()`'s background trail-geometry loop: `BACKGROUND_FETCH_PACE_MS` is `0` in production (go as fast as the existing per-request rate-limit/retry backoff allows) but a few seconds in dev, since local development reloads/cache-busts far more often than a real user's session and shares Overpass's public rate limit with production and everyone else using the app.

## Trail data (`NEARBY_TRAILS` in index.html)

Hardcoded array of 100+ trails. IDs are non-contiguous (`n1`–`n60` from the original set, `n61`+ appended over time as trails were added — new additions should just use the next unused `n` number, not renumber existing entries). Originally scoped to rail-trails only, but that's no longer a requirement — any safe, primarily car-free, mostly paved/gravel multi-use path ≥5 miles within ~100 miles of Concord is in scope (e.g. `n106` Charles River Bike Path, `n107` Neponset River Greenway, `n108` Cape Cod Canal Bikeway — none are former rail corridors). Each entry:

```js
{
  id: 'n1',
  name: 'Minuteman Bikeway',
  state: 'MA',
  miles: 10,
  distMi: 8,          // distance from Concord MA
  surface: 'Paved',
  lat: 42.378,
  lng: -71.228,
  url: 'https://...',
  desc: 'One-line description',
  osmNames: ['Alias 1', 'Alias 2'],  // optional — for OSM matching (see below)
  parking: [                         // optional — up to 3 real trailhead lots, roughly start/middle/end
    { name: 'Lot name, street, town', lat: 42.xxx, lng: -71.xxx },
  ]
}
```

Trails are split into two radius bands, visually separated by a `.radius-divider` in the Nearby panel based on `distMi`:
- `distMi <= 100`: within ~100 miles of Concord, MA
- `distMi > 100`: extended range, 100–250 miles (VT, NY, ME, NJ, PA)

The divider is inserted automatically by `renderNearby()` the first time it hits an entry with `distMi > 100` while iterating — array order should roughly ascend by `distMi`, but exact sorting isn't required as long as all `>100` entries come after all `<=100` entries.

Minimum trail length for inclusion is 2.5 miles, with rare manual exceptions for well-known short spurs (e.g. Whitney Spur Rail Trail, 1.6 mi).

The Mass Central Rail Trail is tracked as multiple separate entries (`n98`–`n105`, prefixed "Mass Central RT — ...") rather than one single trail, since it's actually many independently-built, non-contiguous rideable sections. The Norwottuck Branch section is tracked separately under its own historical name/id (`n49`) rather than under the Mass Central RT prefix.

**Nearby tab filters**: surface filter chips (Paved, Gravel, etc.) plus an "Unridden" chip that sits right after "All", styled identically but toggling independently (`nearbyHideRidden`, defaults to `true`/active) — both a surface filter and "Unridden" can be active at the same time, since they filter different dimensions.

**Parking**: the optional `parking` array (real, non-fabricated trailhead lots — geocoded via OSM Nominatim or sourced from official trail/town sites, never guessed) is rendered as one 🅿️ Apple Maps link per spot, labeled with the spot's actual address/name (not a generic "Lot N"), via `appleMapsUrl()` which builds a universal `maps.apple.com/?daddr=...&q=...` link (opens the native app on iOS/Mac, falls back to Apple Maps web elsewhere). Two different layouts for two different spots: the Nearby card uses `parkingLinksHtml()` (compact inline buttons, matching Source/Map) while the map popup (`buildNearbyPopup()`) uses `parkingRowsHtml()` — one full-width row per lot underneath the TrailLink/Maps links, so a long lot address is fully readable instead of being squeezed into a same-row button.

Parking pins are plotted directly on the main map as their own square "P" markers (`parkingIcon()`/`addParkingMarkersForTrail()`), but stay hidden until that specific trail is clicked — either directly on the map (its dot/line, or a ridden trail's green line) or via its Nearby card — via a `popupopen` listener on each trail's layer calling `revealParkingForTrail(id)` (also called directly from `focusNearby()` since a ridden trail's card click routes through `focusRidden()` instead of opening the nearby-marker popup). Once revealed, a trail's pins stay visible for the rest of the session (`revealedParkingTrailIds`, session-only — a page refresh hides them again); `parkingMarkersByTrail` guards against adding the same trail's pins twice. Clicking a pin pops up the lot address, trail name, and the same Apple Maps directions link.

As of this writing 103 of 104 trails have real parking data (only `n06` Wakefield-Lynnfield Rail Trail is excluded — it isn't open to the public yet per official sources). All spots were sourced from official trail/town/state sites and geocoded via OSM Nominatim, never fabricated; when a query returned an implausible match (e.g. wrong state/region), a more specific query was used or a town-center fallback was substituted with a note in the entry's `name`. Filling in the remaining trail (`n06`) once it opens, and periodically re-verifying stale addresses, is ongoing maintenance rather than a one-shot migration.

**Map tiles**: both the main map and the match-picker map use CartoDB Voyager tiles (`basemaps.cartocdn.com/rastertiles/voyager`), not stock OpenStreetMap raster tiles — Voyager keeps street names/road network visible but doesn't bake in highway route-shield numbers (I-190, MA-2, etc.) the way stock OSM tiles do.

## GPS / FIT file matching

When a `.fit` file is imported:
1. The browser parses GPS coords from the FIT binary
2. An Overpass API query fetches OSM way geometries near the ride's bounding box (timeout: 12 s)
3. Each OSM way name is scored against all `NEARBY_TRAILS` entries via `nameMatchScore()` (keyword overlap, stop words stripped, threshold >50%)
4. The trail with the best score above threshold is used as the match

**`osmNames` aliases** — some trails have OSM ways with names that don't match the display name. Add aliases to the `osmNames` array on the trail entry:

```js
// Island Line Trail's OSM ways are named differently
osmNames: ['Island Line Trail', 'Island Line Rail Trail', 'Burlington Greenway', 'Colchester Causeway']
```

The matching loop checks `[t.name, ...(t.osmNames || [])]` for each trail.

**Distance tiebreak** — several same-family trails (e.g. the "Mass Central RT — ..." segments) routinely tie on name-match score, because the real OSM way is often just the generic trail name with no segment-specific qualifier. When candidates tie on score, the closer one (by `haversineMi` from the way's geometry centroid to the candidate's declared `lat/lng`) wins, instead of silently keeping whichever trail happened to appear first in `NEARBY_TRAILS`. Without this, one segment's geometry can get misattributed to a neighboring segment.

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/rides` | Returns all rides as JSON array |
| `POST` | `/api/rides` | Saves entire rides array (body: JSON array) |
| `DELETE` | `/api/rides` | Resets rides to empty array |
| `POST` | `/api/fits/:key` | Stores a raw FIT file binary under `<data-dir>/fits/<key>.fit` (see FIT storage below) |
| `GET` | `/api/fits/:key` | Retrieves a previously stored FIT file |
| `GET` | `/api/trail-geometry` | Bulk-loads all cached trail line geometry as `{ [trailId]: segments }` (see Trail geometry cache below) |
| `POST` | `/api/trail-geometry/:id` | Caches one trail's fetched line geometry under `<data-dir>/trail-geometry/<id>.json` |
| `GET` | `/api/ignored-trails` | Returns the array of trail ids the user has marked "ignored" (excluded from the fetch queue forever) |
| `POST` | `/api/ignored-trails` | Saves the full ignored-ids array (body: JSON array), mirrors the `rides.json` full-overwrite pattern |
| `GET` | `/api/trail-fetch-failures` | Returns `{ [trailId]: { count, lastFailedAt } }` — persisted not-found retry counts (see Queue tab below) |
| `POST` | `/api/trail-fetch-failures` | Saves the full failure-counts object (body: JSON object), full overwrite |
| `GET` | `*` | Catch-all → serves `index.html` (see dev-vs-prod note below) |

**Dev vs. prod HTML serving**: the catch-all reads `index.html` fresh from disk on every request when `BUILD_SHA` is unset (local dev) — so editing `public/index.html` is picked up immediately, no server restart needed. In production (`BUILD_SHA` set by CI), it serves the in-memory build-stamped cache instead. `express.static` is mounted with `{ index: false }` so it never intercepts `/` before the catch-all runs (this was a real bug once — `express.static` was silently serving the raw, unstamped `index.html` for every request).

## FIT file storage & rescanning

Every FIT import uploads a copy of the raw file server-side (fire-and-forget, won't block the import UI if it fails), keyed by `hashString(fitFingerprint)` — a small non-cryptographic hash of the ride's date/miles/start/end fingerprint. The ride record stores this as `fitFile`.

Rides with a stored `fitFile` show a 🔄 **Rescan** button in My Rides. This re-downloads the original FIT, re-parses it, and re-runs the Overpass trail-matching (`findAllNearbyMatches`) — useful after `NEARBY_TRAILS` gains new entries or the matching logic improves, to pick up a better match on old rides. Rides imported before this feature shipped have no `fitFile` and won't show the button.

## Trail geometry cache

Fetching a trail's real path from Overpass is slow (sequential, one request per trail, with a retry — see below) and rate-limit-prone, so results are persisted server-side as one small JSON file per trail under `<data-dir>/trail-geometry/<id>.json`, keyed by `NEARBY_TRAILS` id. Each file is `{ version: N, segments: [[[lat,lng],...],...] }` — segments is an array of disconnected point-arrays, never a flat point array, since a trail's OSM geometry often comes from several separate "ways" and flattening them creates phantom straight-line jumps between unrelated pieces (this was a real bug — see git history).

**Cache versioning / cache-busting**: `TRAIL_GEOM_LOGIC_VERSION` (in `index.html`, currently `4`) must be bumped whenever the trail-matching/name-scoring logic *or* a specific trail's `osmNames`/`lat`/`lng` changes in a way that could change which OSM geometry gets attributed to a trail — e.g. editing `NAME_STOP`, the per-way distance sanity check, the distance tiebreak, scoring thresholds, or adding aliases for a trail whose real OSM name differs from its declared name. `loadTrailGeometryCache()` only hydrates entries whose stored `version` matches the current constant; anything older (or in the pre-versioning legacy plain-array format) is silently treated as uncached and gets naturally re-fetched with current logic. This means a logic-fixing deploy self-heals every stale cache entry across all users with no manual cleanup, migration step, or deploy-time script — just remember to bump the constant when the matching logic changes. Also remember to clear any affected trail's entry from `data/trail-fetch-failures.json` if it had previously exhausted its not-found retry cap — a version bump alone doesn't reset that separate persisted store, so a trail fixed by adding an alias can still stay artificially capped.

On page load, `loadTrailGeometryCache()` bulk-fetches everything already cached in one request and hydrates `TRAIL_POLYLINES` before the first render, so previously-discovered trails show as real blue lines immediately. A background loop (`fetchAllNearbyTrailLines`) then fetches any trail still missing (including anything just invalidated by a version bump), one at a time — Overpass reliably fails when hit with concurrent requests — persisting each result as it resolves so it's instant on every future page load, by anyone. Clicking a trail's "🔄 Load trail path" popup button (`forceLoadTrailLine`) jumps the queue for that one trail on demand, bypassing the "already attempted" guard so a previously-failed trail can be retried.

Since `trail-geometry/` lives under the same `/data` directory as `rides.json` and `fits/`, it's covered by the existing bind-mount volume and survives container redeploys with no extra Docker config.

**Manually-curated geometry (bypassing name-matching entirely)**: some trails simply aren't mapped in OSM as one coherently-named way — e.g. `n109` Wompatuck State Park Bike Path is really a network of individually-lettered internal park roads (`R Road`, `Y Road`, etc., tagged `highway=service`, which the standard Overpass query doesn't even search) tangled up with hundreds of unrelated residential streets in the surrounding towns. For cases like this, skip the name-matching pipeline entirely: query Overpass directly for the specific named ways that make up the real trail (`out geom`), then `POST` the resulting `{version, segments}` straight to `/api/trail-geometry/:id` via the same endpoint the app itself uses, seeding the cache once by hand. The trail then behaves exactly like any other cached trail (hydrates on load, shows on the map, no re-fetch attempted) — the only difference is nobody will ever auto-discover or auto-correct this geometry the way name-matching does for everything else, so partial/disconnected coverage is expected and fine (the description field should say so).

**Rate-limiting vs. genuine not-found**: `fetchTrailPolylineDirectAttempt()` classifies every failure as either transient (`rateLimited: true` — retried, doesn't count against anything) or a genuine not-found. Any non-2xx HTTP response (429, but also 5xx/504 Overpass throws when overloaded) and a client-side `AbortError` from `OVERPASS_TIMEOUT_MS` (12s) are both treated as transient — a timeout usually just means Overpass was too slow to answer, not that the trail has no data. Only a clean 200 response with no matching-enough OSM way counts as a real not-found.

**Not-found retry cap**: genuine not-founds are tracked server-side in `trail-fetch-failures.json` as `{ [trailId]: { count, lastFailedAt } }`. After `MAX_AUTO_RETRIES` (3) consecutive genuine not-founds, the background loop and bulk "Retry all rate-limited" stop touching that trail automatically — a manual "Retry" click in the Queue tab always still works and resets the count. Rate-limited failures never count against this cap. `getTrailQueueStatus()` explicitly checks `autoRetryExhausted()` before falling back to `'pending'` — without this, a trail that exhausted its cap in a *previous* session (and therefore never gets a live session status set, since the background loop skips it outright rather than attempting and recording a status) would misleadingly show as "waiting in queue" forever instead of surfacing as `'not-found'`.

**Ignored trails**: `ignoredTrailIds` (hydrated from/persisted to `ignored-trails.json`) lets a trail be permanently excluded from the fetch queue. `fetchTrailPolylineDirect()` checks it at its single choke point, so it's respected uniformly across the background loop, manual retry, and match-picker eager fetches.

## Queue tab

The "📡 Queue" tab (`switchTab('queue')`, `renderQueuePanel()`) gives visibility into the background Overpass fetch pipeline. Each trail's live status (`trailFetchStatus`, session-only) is one of `pending`/`fetching`/`success`/`rate-limited`/`not-found`/`ignored`, shown with live summary counts, per-trail Retry/Ignore/Un-ignore buttons, and a research link (trail's `url`) per row.

- **Pause/resume** (`queuePaused` + `waitWhilePaused()`) halts the background loop and manual "Retry all"; a single per-trail Retry click still works even while paused.
- **Rate-limit banner**: whenever any trail is currently `rate-limited`, an inline banner explains that Overpass is rate-limiting and backing off automatically — this replaced an `alert()` popup that used to interrupt on every manual retry.
- **"📋 Copy investigation prompt"** button (in the "Not found" section) copies a ready-to-paste Claude Code prompt to the clipboard listing every not-found trail's name, id, coordinates, `osmNames` aliases, and source URL, framed as an investigation task pointing at `fetchTrailPolylineDirectAttempt()`.
- Not-found trails are deliberately excluded from any bulk retry — only their own individual "Retry" button overrides the cap. (There used to be a "Retry all failed" button covering both rate-limited and not-found trails; it was removed entirely per user request, since not-found trails failing for a real reason shouldn't be swept into a bulk action.)

## Docker / deployment workflow

**Normal deploy**: commit to `main` → GitHub Actions builds multi-platform image → pushes to Docker Hub. NAS pulls manually:

```bash
docker pull marstonstudio/rail-trail-tracker:latest
docker-compose -f /volume1/docker/rail-trail-tracker/docker-compose.yaml up -d
```

The actual compose file on the NAS lives at `/volume1/docker/rail-trail-tracker/docker-compose.yaml` (not the repo root) — it's a copy of `docker-compose.nas.yml`, kept in sync manually. Data volume is `/volume1/docker/rail-trail-tracker/data:/data`. Env var is `RIDES_FILE` (not `DATA_FILE`); healthcheck hits `/api/rides` (not `/api/trails`).

**Monitor Docker Hub** for build completion via API (don't use computer use for this):

```bash
curl -s "https://hub.docker.com/v2/repositories/marstonstudio/rail-trail-tracker/tags/?page_size=5" \
  | python3 -c "import sys,json; tags=json.load(sys.stdin)['results']; [print(t['name'], t['last_updated']) for t in tags]"
```

**Local dev**:
```bash
npm run dev        # node --watch server.js
# app at http://localhost:3000
# rides saved to /data/rides.json (set RIDES_FILE env var to override)
```

## Data migration

On startup, `server.js` auto-migrates `trails.json` → `rides.json` if the old file exists and the new one doesn't (one-time migration, safe to leave in place).

## Preferences

- Commits and pushes can be done via `git` CLI directly — no need for GitHub Desktop
- Use Docker Hub API (web fetch / curl) for monitoring CI, not browser automation
- The NAS is at `ugreen.local:3000` when on the local network
- Always test changes locally at `localhost:3000` before committing and pushing
- When the user is mid-session making multiple changes, hold off on `git commit`/`git push` until they explicitly say to — don't commit after every individual edit
- Before committing, always check whether CLAUDE.md needs updating to reflect what changed (new API endpoints, new UI behavior, new architectural decisions) and update it as part of the same commit — don't let it drift stale
- A `PostToolUse` hook (`.claude/settings.json`, gitignored — local machine config, not checked in) watches `git push` commands and polls Docker Hub in the background, notifying when the new image is live so there's no need to manually check build status
