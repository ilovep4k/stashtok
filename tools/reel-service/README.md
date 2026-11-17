# Highlight reel service

Cuts a tight edit out of a performer's whole library: **3 seconds from a random
spot in each clip, five windows in any long video**, stitched into one MP4.

```
python3 tools/reel-service/reel.py     # listens on :19000
```

Then open `http://<host>:19000/player?performerId=<id>&port=9998` — or press
**Highlight reel** on a performer's page in StashTok, which is just a link to it.

## Why a sidecar and a separate tab

Stash serves a strict CSP: `connect-src 'self' ws: wss:` and
`media-src blob: 'self'`. A plugin **cannot** fetch this service or play its MP4
in-page — the request is refused before it leaves the browser. A top-level
navigation is not gated, so the plugin links to `/player`, which runs on this
origin and does its own POST/poll/play. Do not "simplify" this back into a
`fetch()` inside the plugin; it silently fails as "Failed to fetch".

## How the cut is made

- Scene list and durations come from Stash's GraphQL (`findScenes` with a
  `performers INCLUDES` filter), API key read with `docker exec … sed` per
  instance and cached in memory — never logged or returned.
- Each window is grabbed by **stream copy** (`-ss … -i … -c copy`), so ffmpeg
  range-seeks and downloads a few MB instead of decoding the source. Then the
  small local cut is normalised to 720p/30fps/H.264 + AAC 48k stereo, because
  the concat demuxer needs identical stream layouts. A silent clip gets a silent
  track rather than being dropped.
- Plan: 1 window for clips under 45 s, 2 under 2 min, 3 under 5 min, 5 beyond;
  capped at 60 windows / 200 s. Segments hash to a cache key, so reopening a
  performer's reel is instant; `?refresh=1` rebuilds.
- A scene served as a live transcode cannot seek cheaply. Those cuts are
  abandoned after 45 s, and the whole build stops at 4 minutes with whatever it
  has, so a slow library still yields a reel instead of hanging.

Measured on this host: 248-scene performer → 24 clips, 72 s reel, 7 MB, ~4 min
first build.

## Routes

| Route | What |
| --- | --- |
| `GET /player?performerId=&port=&name=` | progress bar + player (the page the plugin links to) |
| `POST /reel {performerId, port, name, refresh?}` | start or reuse a build |
| `GET /status/<job>` | `queued / running / done / error`, `pct`, `kept` |
| `GET /reel/<job>/<name>.mp4` | the reel, Range supported |
| `GET /healthz` | liveness |

## Env

`REEL_PORT` (19000), `REEL_CACHE` (`~/.cache/stashtok-reels`), and per instance
`REEL_STASH_9998` / `REEL_KEYCMD_9998`, `REEL_STASH_9997` / `REEL_KEYCMD_9997`.

## Run it

Nothing on this host auto-starts, so after a reboot:

```
cd ~/Documents/Dev/stash-tok/tools/reel-service
nohup python3 reel.py >> ~/.cache/reel-service.log 2>&1 &
```

The service listens on `0.0.0.0:19000` with no auth of its own — the same
exposure as the thumbnail sidecar. It only serves reels it generated for
library content the LAN already trusts; bind it to a specific address or put it
behind the VPN if that is not acceptable.
