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

Minimum trail length for inclusion is 2.5 miles, with rare manual exceptions for well-known short spurs (e.g. Whitney Spur Rail Trail, 1.6 mi) or trails otherwise worth including despite falling under whatever length bar applies (e.g. `n110` Battle Road Trail, 4.9 mi, just under the newer ≥5mi non-rail-trail bar, kept anyway as the closest good trail to the user's home; `n111` Yankee Doodle Bike Path, 4 mi and still under construction as of 2026, added anyway per explicit user request — its `desc` notes it may not be rideable/mappable yet).

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
3. Each OSM way's name is checked against every `NEARBY_TRAILS` entry via `namesMatch()` — an **exact**, case/whitespace-insensitive match against the trail's declared `name` or one of its curated `osmNames` aliases. No fuzzy/partial scoring.
4. Among entries whose declared point is within 20mi of the way (`fetchPolylinesNearTrack`) or that are being searched for directly (`fetchTrailPolylineDirectAttempt`), an exact-name match wins; ties between multiple trail entries sharing the identical real OSM name (e.g. several "Mass Central RT — ..." segments) go to whichever is geographically closest to the way's own geometry

Matching used to be fuzzy (keyword-overlap scoring, ~50% threshold) and this caused real contamination: a way named "River Trail" in Carlisle (14mi away) scored 0.5 against "Assabet River Rail Trail" on the single shared word "River" and got merged in; the same happened with "Northern Avenue" in Boston's Seaport vs. "Northern Strand Community Trail" on "Northern". No fuzzy threshold is safe against this — short trail names routinely share one distinctive word with an unrelated real street/path somewhere in a multi-mile search radius. `nameMatchScore()`/`NAME_STOP` were removed entirely; matching is exact-only now (`namesMatch()`). A trail whose real OSM name differs from its declared name needs an explicit, manually-verified `osmNames` alias (see below) — there is no automatic partial-credit fallback, so an unmatched trail surfaces as `not-found` (or, during a ride import, as a "discovered" suggestion) rather than silently grabbing the closest-sounding way.

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

Fetching a trail's real path from Overpass is slow (sequential, one request per trail, with a retry — see below) and rate-limit-prone, so results are persisted as one small JSON file per trail, keyed by `NEARBY_TRAILS` id. Each file is `{ version: N, segments: [[[lat,lng],...],...] }` — segments is an array of disconnected point-arrays, never a flat point array, since a trail's OSM geometry often comes from several separate "ways" and flattening them creates phantom straight-line jumps between unrelated pieces (this was a real bug — see git history).

**Never committed to git — deployed by direct `POST`, not through GitHub.** All actual geocoded trail-path data (OSM/Overpass-derived *and* TrailLink-derived alike) lives only in `<data-dir>/trail-geometry/<id>.json`, on the same bind-mounted `/data` volume as `rides.json` — nothing is baked into the Docker image or checked into the repo. The repo only ever holds the *logic* to retrieve/match this data (`namesMatch()`, `osmNames` aliases, the manual-curation technique below) — never the coordinates themselves. This volume persists across redeploys/rebuilds on its own (that's the whole point of the bind mount), so there's no dependency on git for durability. In practice: when you fetch or fix a trail's geometry (from Overpass or TrailLink), `POST` the result directly to `/api/trail-geometry/:id` on **both** local dev (`http://localhost:3000/...`) **and** the NAS (`http://ugreen.local:3000/...`) — that's the full deploy for trail data, no `git commit`/push/Docker rebuild involved. Also keep the same JSON on disk somewhere in the project (e.g. `.scratch/`, itself gitignored) as your own working backup in case you need to re-push later.

*(History: an earlier version of this session committed a `trail-geometry-seed/` directory into the repo and baked it into the Docker image via the Dockerfile — this was reverted. `trail-geometry-seed/` may still exist locally as a gitignored leftover; it's not read by the app and not meaningfully different from `data/trail-geometry/` at this point, don't resurrect the two-tier setup.)*

**Cache versioning / cache-busting**: `TRAIL_GEOM_LOGIC_VERSION` (in `index.html`, currently `6`) must be bumped whenever the trail-matching logic *or* a specific trail's `osmNames`/`lat`/`lng` changes in a way that could change which OSM geometry gets attributed to a trail — e.g. editing `namesMatch()`, the distance cap/tiebreak, or adding aliases for a trail whose real OSM name differs from its declared name. `loadTrailGeometryCache()` only hydrates entries whose stored `version` matches the current constant; anything older (or in the pre-versioning legacy plain-array format) is silently treated as uncached. Since there's no more background fetch loop (see below), a version bump doesn't self-heal anymore the way it used to — every affected trail needs its geometry manually re-fetched/re-verified and re-`POST`ed (to both local and the NAS) with the new version number, or it just stops rendering until that happens. Also remember to clear any affected trail's entry from `data/trail-fetch-failures.json` if it had previously exhausted its not-found retry cap.

**"Renders as a dot" symptom checklist**: a trail with a cached-but-stale-version geometry file falls back to its single declared point exactly like a trail that was never fetched at all — visually indistinguishable, but the fix is much cheaper. Before assuming a trail needs a brand-new fetch, check whether `data/trail-geometry/<id>.json` already has real segments under an old `version` number (e.g. `n06` Wakefield-Lynnfield had a real 2-segment/31-point OSM capture sitting at `version:4`, orphaned when the constant bumped to 6) — if so, just re-stamp the existing data to the current version and re-`POST` it, no need to re-derive the geometry from scratch.

**v5/v6 note**: a manually-curated entry (e.g. `n109` Wompatuck, `n111` Yankee Doodle, `n112` Nickerson) needs its stamped `version` bumped and re-`POST`ed too whenever `TRAIL_GEOM_LOGIC_VERSION` changes, same as any other trail — it doesn't get any special exemption.

On page load, `loadTrailGeometryCache()` bulk-fetches everything currently in `data/trail-geometry/` in one request and hydrates `TRAIL_POLYLINES` before the first render — **there is no background fetch loop anymore**. A trail with no geometry on disk just shows no line; see "Per-trail investigation prompt" below for how that gets fixed.

**Manually-curated geometry (bypassing name-matching entirely)**: some trails simply aren't mapped in OSM as one coherently-named way — e.g. `n109` Wompatuck State Park Bike Path is really a network of individually-lettered internal park roads (`R Road`, `Y Road`, etc., tagged `highway=service`, which the standard Overpass query doesn't even search) tangled up with hundreds of unrelated residential streets in the surrounding towns; `n112` Nickerson State Park Bike Path (Brewster) hits the same problem — its paved internal loop is mapped as five separately-named cycleways (Nook Road, Ruth Pond, Cedar, Ober, Deer Park Trails) rather than one coherent trail name. For cases like this, skip the name-matching pipeline entirely: query Overpass directly for the specific named ways that make up the real trail (`out geom`), then `POST` the resulting `{version, segments}` straight to `/api/trail-geometry/:id` via the same endpoint the app itself uses, seeding the cache once by hand. The trail then behaves exactly like any other cached trail (hydrates on load, shows on the map, no re-fetch attempted) — the only difference is nobody will ever auto-discover or auto-correct this geometry the way name-matching does for everything else, so partial/disconnected coverage is expected and fine (the description field should say so). Not every OSM-naming mismatch needs this though — `n113` Manuel F. Correllus State Forest Bike Path (Martha's Vineyard) has consistent OSM naming ("State Forest Bike Path"), so a plain `osmNames` alias let it resolve through the normal live-fetch pipeline with no manual curation at all.

Same technique also applies to trails still `highway=proposed` in OSM rather than a real `highway=cycleway`/etc — the standard query only searches built-trail highway values, so a correctly-named-but-unbuilt way never matches no matter what `osmNames` says. `n111` Yankee Doodle Bike Path (under construction as of 2026) was seeded this way from its 3 `highway=proposed` OSM ways — the description notes it's the *planned* route, not a confirmed as-built path, since OSM's proposed geometry can differ from what actually gets built.

**TrailLink-sourced geometry**: OSM/Overpass isn't the only source worth curating from — TrailLink (traillink.com) draws its own trail maps, often as one continuous line even where OSM has the same real trail chopped into many short, disconnected ways (fine-grained street-segment tagging, missing `name` tags on some ways, etc.). `n05` Tri-Community Greenway was the first example: Overpass returned 31 fragmented segments (210 pts) for it, while TrailLink's own map renders it as 2 clean segments (658 pts) that visually read as one continuous trail.

TrailLink's map data isn't ours to redistribute (unlike OSM's ODbL-licensed data), which fits fine with the "nothing gets committed to git" policy above — `POST` a TrailLink-derived trail to `/api/trail-geometry/:id` on local dev *and* directly on the NAS exactly like any other trail's geometry.

To pull TrailLink's data: open the trail's map page (`https://www.traillink.com/trail-maps/<slug>/`) in a real logged-in browser tab, since the path isn't a separate fetchable endpoint — it's drawn via the Google Maps JS API with `google.maps.Polyline.prototype.setPath` called directly in page JS, not exposed on `window`. Monkey-patch `google.maps.Polyline` (constructor) and `.prototype.setPath` *before* calling the page's own `window.initMap()` again (a plain client-side re-invocation, not a new request to TrailLink) to capture the real coordinate arrays as they're set. `javascript_tool`'s output truncates well before typical trail lengths, so pull the captured data out via a `Blob` + programmatic `<a download>` click instead of returning it as a JS expression result — this reliably saves straight to the Downloads folder with no dialog **once Chrome's "Ask where to save each file before downloading" setting is turned off** (`chrome://settings/downloads`); with it on, every single trail triggers a native macOS save dialog that can't be automated (outside the browser extension's reach) and needs a manual click. Chrome may also show a one-time "Allow multiple automatic downloads from this site?" permission prompt on the first download from traillink.com in a session — click Allow once and it won't reappear.

Same page also exposes real parking-lot markers as `window.trailPkgMarkers` (an array of `google.maps.Marker`, `.getPosition()`/`.getTitle()`) — reverse-geocode these for real names same as any other parking source. Not every marker needs to be a displayed trailhead: store the full geocoded list under an optional `parkingCandidates` field (same shape as `parking`, not rendered anywhere) and curate just 2–4 into the actual displayed `parking` array (start/middle/end, or more if the trail forks) — see `n05` for the pattern.

**Be deliberate about request volume against TrailLink** — this only needs one real page load per trail; do the constructor/setPath patching and re-invoke `initMap()` in-page rather than reloading repeatedly to retry capture. When a trail isn't on TrailLink at all (`url` field pointing elsewhere), fall back to Overpass or another official source (DCR, state parks, a trail-specific nonprofit site) exactly as before.

**Rate-limiting vs. genuine not-found**: `fetchTrailPolylineDirectAttempt()` classifies every failure as either transient (`rateLimited: true` — retried, doesn't count against anything) or a genuine not-found. Any non-2xx HTTP response (429, but also 5xx/504 Overpass throws when overloaded) and a client-side `AbortError` from `OVERPASS_TIMEOUT_MS` (12s) are both treated as transient — a timeout usually just means Overpass was too slow to answer, not that the trail has no data. Only a clean 200 response with no matching-enough OSM way counts as a real not-found.

**Not-found retry cap**: genuine not-founds are tracked server-side in `trail-fetch-failures.json` as `{ [trailId]: { count, lastFailedAt } }`. After `MAX_AUTO_RETRIES` (3) consecutive genuine not-founds, the background loop and bulk "Retry all rate-limited" stop touching that trail automatically — a manual "Retry" click in the Queue tab always still works and resets the count. Rate-limited failures never count against this cap. `getTrailQueueStatus()` explicitly checks `autoRetryExhausted()` before falling back to `'pending'` — without this, a trail that exhausted its cap in a *previous* session (and therefore never gets a live session status set, since the background loop skips it outright rather than attempting and recording a status) would misleadingly show as "waiting in queue" forever instead of surfacing as `'not-found'`.

**Ignored trails**: `ignoredTrailIds` (hydrated from `ignored-trails.json`) lets a trail be permanently excluded from the background fetch loop. `fetchTrailPolylineDirect()` checks it at its single choke point. No in-app UI to toggle this (see below) — set directly via `POST /api/ignored-trails` when needed.

**State-government GIS sources**: several states publish their own rail-trail geometry as public ArcGIS `FeatureServer` endpoints — often cleaner and more authoritative than either Overpass or TrailLink, and directly queryable via `fetch()` with no auth, no page-scripting tricks, and no rate-limit concerns (these are meant for public consumption).
- **Massachusetts** — `masstrailtracker.com` (a MassDOT-adjacent project tracking rail-trail *build status*, not just existing paths). Its map is MapLibre GL, and the actual segment geometry isn't a plain fetchable URL — it's loaded into a `maplibregl.Map` instance held in React state. To get it: find the map's DOM container (`document.querySelector('.maplibregl-map')`), walk its `__reactFiber$...` property up the tree checking each fiber's hook chain (`memoizedState.memoizedState`) for an object with a `.getSource` method (the map instance), then call `map.getSource('segments_source')._data` for the full `FeatureCollection`. Each feature has a `state` property (`paved`/`stoneDust`/`onRoad`/`unimproved`/`design`/`proposed`/`construction`) — only `paved`/`stoneDust`/`onRoad` are actually built and rideable; filter out the rest. There's no trail-name field on the geometry itself, so match candidate features to a `NEARBY_TRAILS` entry by geographic proximity (haversine distance from each feature's centroid to the entry's declared `lat/lng`, same pattern as the app's own OSM tiebreak logic) rather than by name. Coverage is uneven — it's strongest for trails currently under active development (e.g. `n99` MCRT Waltham had 41 matching segments) and can be sparse-to-useless for older, already-fully-built trails (e.g. `n49` Norwottuck mostly returned `proposed`/`unimproved` noise nearby, not useful).
- **Vermont** — `railtrails.vermont.gov/map`, backed by a public ArcGIS FeatureServer at `services1.arcgis.com/NXmBVyW5TaiCXqFs/.../VT_State_Rail_Lines_and_Trails/FeatureServer/0`. Query directly, e.g. `?where=LineName='LVRT'&outFields=LineName&outSR=4326&f=geojson` (note the field is `LineName` in the response, case-sensitive, even though the SQL `where` clause itself is case-insensitive). Known `LineName` codes: `LVRT` (Lamoille Valley, `n57`), `DHRT` (Delaware & Hudson, `n52`), `MVRT` (Missisquoi Valley, `n60`), `BBRT` (Beebe Spur). Filter to `RailTrail='Y'` to exclude active freight rail lines also present in the same layer.
- **New Hampshire** — NH GRANIT's `CSD_RecreationResources` FeatureServer at `nhgeodata.unh.edu/hosting/rest/services/Hosted/CSD_RecreationResources/FeatureServer/2`, discovered via the "NH Recreational Trails" dataset on the NH GRANIT ArcGIS Hub. Query with `where=trailsys='<exact name>'` — trail names in the `trailsys` field don't always match our declared names or one another cleanly (e.g. `"Rockingham Rec. Rail Trail"` covers all three of our separate Rockingham branch entries — n17 Fremont Branch, n19 main, n23 Portsmouth Branch — as one undifferentiated set of 9 segments; split those by geographic proximity to each entry's declared `lat/lng` the same way as the MassTrailTracker case, and leave any segment that isn't clearly closest to one specific entry unassigned rather than guess). Coverage is inconsistent by name — some well-known trails (Northern Rail Trail, Fort Hill Recreational Rail Trail, Cotton Valley, Potanipo, Salem Bike-Ped Corridor, NH Seacoast Greenway, Concord–Lake Sunapee) simply aren't present under any close-enough `trailsys` value in this dataset and need another source.

**Trail-alliance/friends-group sites (per-corridor, not per-state)**: single-trail advocacy sites can be an even better source than any state GIS layer when they exist, since they're curated by the people who actually built and maintain the trail. [MassCentralRailTrail.org](https://www.masscentralrailtrail.org) (the MCRT Alliance's own site) was the source that finally gave us clean geometry for 8 of our 9 separate Mass Central RT entries (`n98`-`n104`, `n49` Norwottuck) — each of the site's per-town pages (`/waltham`, `/rutland`, etc., discoverable from the nav's "Explore the Trail" page) embeds a RideWithGPS route via an `<iframe>` pointing at a Wix-hosted static HTML wrapper (`www-<sitename>.filesusr.com/html/<hash>.html`), which in turn embeds `ridewithgps.com/embeds?...&type=route&id=<N>&...`. Pull the numeric route `id` from that query string, then hit `ridewithgps.com/routes/<id>.json` directly — no auth, a plain public JSON response with a `track_points` array of `{x: lng, y: lat, e: elevation, ...}`. Some towns share one embedded route with an adjacent town (e.g. New Braintree and Hardwick both embed the same route, matching our combined `n103` entry exactly); some towns have no embed at all (e.g. Belchertown), which for MCRT specifically confirms that stretch is genuinely undeveloped rather than a data gap — cross-check against MassTrailTracker's build-status data before assuming "no embed" always means "not built" elsewhere. When two adjacent towns each have their own separate route for what we track as one entry (e.g. `n98` Weston-Wayland, `n100` Sudbury-Hudson, `n101` Rutland-Holden, `n102` Barre-Rutland), just combine both towns' point arrays as separate segments under that one entry.

**Chrome's per-origin automatic-download limit**: browser-driven data pulls (TrailLink, these state GIS sources) that use the `Blob` + `<a download>` technique only get **one** automatic (no-dialog) download per origin per session — a second `.click()` triggering a download from the same origin silently does nothing (no error, no file, no visible prompt), even though the first one worked cleanly. Confirmed via a filesystem check (`find ~/Downloads -name ...`) after the second attempt came up empty. Workarounds, in order of preference: (1) if only pulling a small amount of data, skip the download entirely and just return the JS string in chunks (`str.slice(i*900, i*900+900)`, ~900 chars is a safe per-call size before the tool's own output truncates) across several `javascript_tool` calls, batched in parallel where possible, then reassemble in Python — tedious but reliable for anything under a few thousand points; (2) if a genuinely large single download is unavoidable, open a **fresh tab on a different origin** (even a sibling subdomain of the same service, e.g. `nhgeodata.unh.edu` vs. `nh-granit-nhgranit.hub.arcgis.com`) and do the fetch + download there instead, since the one-per-origin allowance is independent per origin. A same-origin page reload or new tab does *not* reset the allowance — only a genuinely different origin gets its own fresh one. (A same-origin `fetch()` POST to `localhost` from a public-site page was also tried as a workaround, exploiting the fact that cross-origin "simple" requests without JSON content-type get sent even when the response can't be read back — but Chrome's Private Network Access policy blocks public-page → localhost requests outright, so that path is a dead end.)

**Tracking trails still needing a better source**: `.scratch/manual_needed.json` (gitignored, local-only) is a running list of `{id, name, reason}` entries for trails that couldn't be resolved via TrailLink or a state GIS source — either no matching page/dataset exists, the match was too ambiguous to trust, or the source's own data was too sparse/uncertain to be worth using. Check it before starting a new investigation pass to avoid re-treading trails already ruled out, and remove an entry once a trail gets fixed.

## Per-trail investigation prompt (formerly the Queue tab)

There used to be a "📡 Queue" tab giving live visibility into the background Overpass fetch pipeline (pause/resume, per-trail retry/ignore, a rate-limit banner with live Overpass slot counts, a "copy investigation prompt" for all not-found trails at once). It was removed once trail geometry became committed static data (see "Trail geometry cache" above) — once a trail's path is seeded, the app never touches Overpass for it again, so there's nothing live to monitor for the vast majority of trails, and managing Overpass rate-limiting/retries is now a development-time concern (mine), not something the deployed app needs to expose to every visitor.

What replaced it: every Nearby card *and* map popup (for any non-ignored trail) shows a small "📋 Investigate" button (`copyTrailInvestigatePrompt(id)`, ids `investigate-<id>` on the card / `investigate-popup-<id>` in the popup — `copyTrailInvestigatePrompt` checks both so either caller gets its checkmark). It's deliberately shown for every trail, not just ones missing geometry — a trail can have geometry that's technically cached but badly fragmented (see `n05` Tri-Community Greenway, where Overpass returned 31 disconnected segments for a trail TrailLink itself draws as one clean line), so "has some cached data" doesn't mean "worth leaving alone." The copied prompt (`buildTrailInvestigatePrompt()`) adapts its wording based on current state — reporting the existing segment/point count and asking whether it's clean or fragmented when geometry already exists, vs. reporting "no geometry at all" when it doesn't — and points at both Overpass/OSM aliasing fixes and TrailLink as a supplementary source (see below), with an explicit reminder that the result gets `POST`ed to local dev and the NAS directly — never committed to git — once verified.

**No background or automatic Overpass calls remain in the live app.** There used to be a background loop (`fetchAllNearbyTrailLines`) and a "🔄 Load trail path" popup button (`forceLoadTrailLine`) that could fetch a trail's geometry live, on page load or on demand — both were removed once the seed reached 110/112 trails, so a missing line now always means "not yet seeded, use 📋 Investigate" rather than "still fetching, wait." `fetchTrailPolylineDirect`/`fetchTrailPolylineDirectAttempt` (and the not-found retry cap, `MAX_AUTO_RETRIES`/`autoRetryExhausted()`) still exist, but the only remaining caller is the ride-import match-picker (`findAllNearbyMatches` → shows a candidate trail's line while reviewing which trail a new ride matches) — a reactive, per-import lookup that only touches Overpass at all for the rare unseeded trail, not a standing background dependency.

## Docker / deployment workflow

**Normal deploy**: commit to `main` → GitHub Actions builds multi-platform image → pushes to Docker Hub. NAS pulls manually:

```bash
docker pull marstonstudio/rail-trail-tracker:latest
docker compose -f /volume1/docker/rail-trail-tracker/docker-compose.yaml up -d
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

## HTTPS access via Tailscale (for iOS Geolocation)

The app is normally served over plain HTTP (`http://ugreen.local:3000`), which blocks browser APIs that require a secure origin — notably `navigator.geolocation.watchPosition`, needed for a planned live-GPS-on-map feature (see below). Rather than reworking the deployment (S3/CloudFront + ACM cert, or a serverless rewrite), the NAS runs Tailscale to get a tailnet-scoped HTTPS URL with zero app/backend changes.

**Setup**: Tailscale runs in its own Docker container/project on the NAS (`tailscale`, separate from the app's `bike` project — not merged into the same compose file):

```yaml
services:
  tailscale:
    container_name: tailscale
    image: tailscale/tailscale:latest
    hostname: ugreen-nas
    restart: unless-stopped
    environment:
      - TS_AUTHKEY=<your auth key>
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_USERSPACE=false
    volumes:
      - ./tailscale-state:/var/lib/tailscale
    devices:
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - net_admin
      - net_raw
```

No `TS_ROUTES` needed — this only needs to reach one app on the NAS's own LAN IP, not advertise/route the whole subnet.

Once the container is up and authenticated, proxy the app's port to an HTTPS tailnet URL:

```bash
docker exec tailscale tailscale serve --bg http://<nas-lan-ip>:3000
```

This publishes `https://ugreen-nas.<tailnet-name>.ts.net/` — reachable from any device signed into the same tailnet (including over cellular, not just LAN), with a Tailscale-issued Let's Encrypt cert auto-provisioned. The tailnet's admin console must have **HTTPS Certificates** enabled (Network → DNS → HTTPS Certificates) for cert issuance to work at all — check there first if certs fail outright.

**Known snag**: `tailscale cert <hostname>` can fail with `500 Internal Server Error: SetDNS "_acme-challenge...` even when HTTPS Certificates is already enabled tailnet-wide — this was stuck control-plane registration state on the container, not a settings issue. Fix: `docker restart tailscale`, wait ~30s for it to reconnect (`docker exec tailscale tailscale status` should show all devices), then retry `docker exec tailscale tailscale cert <hostname>`.

The app itself needs no changes for this — Tailscale/HTTPS is purely a network-layer proxy in front of the existing plain-HTTP Express server.

## Data migration

On startup, `server.js` auto-migrates `trails.json` → `rides.json` if the old file exists and the new one doesn't (one-time migration, safe to leave in place).

## Preferences

- Commits and pushes can be done via `git` CLI directly — no need for GitHub Desktop
- Use Docker Hub API (web fetch / curl) for monitoring CI, not browser automation
- Always test changes locally at `localhost:3000` before committing and pushing
- When the user is mid-session making multiple changes, hold off on `git commit`/`git push` until they explicitly say to — don't commit after every individual edit
- Before committing, always check whether CLAUDE.md needs updating to reflect what changed (new API endpoints, new UI behavior, new architectural decisions) and update it as part of the same commit — don't let it drift stale
- A `PostToolUse` hook (`.claude/settings.json`, gitignored — local machine config, not checked in) watches `git push` commands and polls Docker Hub in the background, notifying when the new image is live so there's no need to manually check build status
