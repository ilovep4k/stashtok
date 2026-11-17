# Highlight reel service

Plays a performer's whole library as one continuous reel: **3 seconds from a
random spot in each clip, five windows in any long video**, each window taken
straight out of the original file. **Nothing is rendered.** No ffmpeg, no
transcode, no output MP4 — the browser seeks the original and plays 3 seconds.

```
python3 tools/reel-service/reel.py     # listens on :19000
```

Then open `http://<host>:19000/player?performerId=<id>&port=9998` — or press
**Highlight reel** on a performer's page in StashTok, which is just a link to it.

## Why it is a page and not a plugin view

Stash serves a strict CSP: `connect-src 'self' ws: wss:` and
`media-src blob: 'self'`. A plugin **cannot** fetch this service or play its
streams in-page — the request is refused before it leaves the browser. A
top-level navigation is not gated, so the plugin links to `/player`, which runs
on this origin and does its own fetch/play. Do not "simplify" this back into a
`fetch()` inside the plugin; it silently fails as "Failed to fetch".

## How the replay works

- Scene list and durations come from Stash's GraphQL (`findScenes` with a
  `performers INCLUDES` filter), API key read with `docker exec … sed` per
  instance and cached in memory — never logged or returned.
- The plan is a list of windows: scene id, `at` (seconds into the original),
  `dur` (3 s). No media is touched while planning.
- Each window gets a `/src/<job>/<i>` URL. That endpoint proxies the **original
  file** to the browser with Range support, so the `<video>` element seeks
  straight into the 4K source and plays 3 seconds of it.
- The player keeps two `<video>` elements and swaps them: one playing, one
  prefetched at the next window's `at`. A `loadedmetadata` handler seeks, and a
  `requestAnimationFrame` tick advances when `currentTime` reaches
  `at + dur - 0.04`.
- Plan: 1 window for clips under 45 s, 2 under 2 min, 3 under 5 min, 5 beyond;
  capped at 60 windows / 200 s. Windows are deterministic per library (seeded
  from the scene ids), so reopening a performer's reel plays the same reel.
- A clip the browser cannot decode as-is (`.mkv`, `.wmv`, HEVC, AC-3 …) is left
  out and counted, because replaying it would mean transcoding. The start
  overlay says how many were left out.

## Routes

| Route | What |
| --- | --- |
| `GET /player?performerId=&port=&name=` | the player page (the plugin links here) |
| `GET /plan?performerId=&port=&name=` | the window list as JSON |
| `GET /src/<job>/<i>` | the original file for window *i*, Range supported |
| `GET /healthz` | liveness |

## Notes / pitfalls

- The tap that dismisses the "Tap to play" overlay must `stopPropagation()`:
  the same click bubbles to the window-level toggle, which would otherwise see
  `paused === false` and pause the clip it just started.
- A `play()` promise rejected with `AbortError` means a window swap interrupted
  it. That must not clear the `playing` flag, or the reel stays paused forever
  while the HUD keeps counting windows.
- "Slow to start" only skips a clip whose `readyState` is still 0 after 20 s —
  i.e. it never parsed. `readyState 1` means the seek worked and the clip is
  buffering a 4K original, which is normal and must not be skipped.
- Playback is limited by the network, not by CPU: each swap pulls a range from
  the NAS. On a 4K clip the first frame can take a few seconds.
