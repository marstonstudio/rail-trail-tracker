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

## Trail data (`NEARBY_TRAILS` in index.html)

Hardcoded array of 100+ trails. IDs are non-contiguous (`n1`–`n60` from the original set, `n61`+ appended over time as trails were added — new additions should just use the next unused `n` number, not renumber existing entries). Each entry:

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
  osmNames: ['Alias 1', 'Alias 2']   // optional — for OSM matching (see below)
}
```

Trails are split into two radius bands, visually separated by a `.radius-divider` in the Nearby panel based on `distMi`:
- `distMi <= 100`: within ~100 miles of Concord, MA
- `distMi > 100`: extended range, 100–250 miles (VT, NY, ME, NJ, PA)

The divider is inserted automatically by `renderNearby()` the first time it hits an entry with `distMi > 100` while iterating — array order should roughly ascend by `distMi`, but exact sorting isn't required as long as all `>100` entries come after all `<=100` entries.

Minimum trail length for inclusion is 2.5 miles, with rare manual exceptions for well-known short spurs (e.g. Whitney Spur Rail Trail, 1.6 mi).

The Mass Central Rail Trail is tracked as multiple separate entries (`n98`–`n105`, prefixed "Mass Central RT — ...") rather than one single trail, since it's actually many independently-built, non-contiguous rideable sections. The Norwottuck Branch section is tracked separately under its own historical name/id (`n49`) rather than under the Mass Central RT prefix.

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

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/rides` | Returns all rides as JSON array |
| `POST` | `/api/rides` | Saves entire rides array (body: JSON array) |
| `DELETE` | `/api/rides` | Resets rides to empty array |
| `POST` | `/api/fits/:key` | Stores a raw FIT file binary under `<data-dir>/fits/<key>.fit` (see FIT storage below) |
| `GET` | `/api/fits/:key` | Retrieves a previously stored FIT file |
| `GET` | `*` | Catch-all → serves `index.html` (see dev-vs-prod note below) |

**Dev vs. prod HTML serving**: the catch-all reads `index.html` fresh from disk on every request when `BUILD_SHA` is unset (local dev) — so editing `public/index.html` is picked up immediately, no server restart needed. In production (`BUILD_SHA` set by CI), it serves the in-memory build-stamped cache instead. `express.static` is mounted with `{ index: false }` so it never intercepts `/` before the catch-all runs (this was a real bug once — `express.static` was silently serving the raw, unstamped `index.html` for every request).

## FIT file storage & rescanning

Every FIT import uploads a copy of the raw file server-side (fire-and-forget, won't block the import UI if it fails), keyed by `hashString(fitFingerprint)` — a small non-cryptographic hash of the ride's date/miles/start/end fingerprint. The ride record stores this as `fitFile`.

Rides with a stored `fitFile` show a 🔄 **Rescan** button in My Rides. This re-downloads the original FIT, re-parses it, and re-runs the Overpass trail-matching (`findAllNearbyMatches`) — useful after `NEARBY_TRAILS` gains new entries or the matching logic improves, to pick up a better match on old rides. Rides imported before this feature shipped have no `fitFile` and won't show the button.

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
- A `PostToolUse` hook (`.claude/settings.json`, gitignored — local machine config, not checked in) watches `git push` commands and polls Docker Hub in the background, notifying when the new image is live so there's no need to manually check build status
