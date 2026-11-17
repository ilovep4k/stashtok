# StashTok

A full-screen, TikTok-style vertical feed for [Stash](https://github.com/stashapp/stash). Swipe through your library one scene at a time, with the HUD out of the way until you touch the screen.

![status](https://img.shields.io/badge/version-0.1.0-informational)

## What it does

- **Vertical feed** — one scene per screen, 9:16 framing. On a portrait phone a 16:9 clip is auto-cropped to its middle half (a quarter off each side); on a wide screen it is letterboxed and centred instead, with a blurred backdrop behind it.
- **Feeds** — For You (random), Favorites, one or many tags, a performer's scenes in date order, markers, never-played, shorts, portrait-only, or any saved Stash filter. Build and save your own feeds in the app.
- **Gestures**
  - swipe up / down — next / previous
  - tap — pause or resume (a 300 ms wait lets a double tap win)
  - double-tap — step the framing: auto-crop → full frame → fill device height → auto-crop; on a clip that cannot crop it toggles fill
  - long-press the middle — quick menu: Mark for Delete, Speed (0.5x/1x/2x), Clear Display, Auto-Scroll, Close
  - hold the right side — fast-forward (rate configurable)
  - hold the left side — rewind
  - pinch — zoom the video inside the viewport; the HUD never scales
  - long-press, then drag — move the video inside the viewport without a second finger (only while it is larger than its box)
  - drag horizontally — scrub within the scene
- **Scrub bar** with a tick per marker, and the marker title as you pass it.
- **Details sheet** — file path, size, duration, resolution, codecs, bitrate, play counts, plus every performer and tag as a tappable chip.
- **Hearts are ratings.** Stash has no scene favourite, so a heart writes `rating100` through `sceneUpdate`. Hearts therefore show up in Stash's own rating filters, and in other clients.

## Install from a source (updates)

Add it once in each Stash instance:

**Settings → Plugins → Available Plugins → Add Source**

- URL: `https://raw.githubusercontent.com/ilovep4k/stashtok/main/index.yml`

StashTok then appears in the available list and installs into `plugins/community/stashTok`. Later releases show up under **Check for Updates** on that same screen — Stash updates plugins per instance, on demand, not automatically.

## Install

1. Copy the `plugins/stashTok` folder into your Stash plugins directory:
   - Linux / macOS: `~/.stash/plugins/stashTok`
   - Windows: `%USERPROFILE%\.stash\plugins\stashTok`
   - Docker: `docker cp plugins/stashTok <container>:/root/.stash/plugins/stashTok`
2. In Stash: **Settings → Plugins → Reload Plugins**.
3. Enable **StashTok**.
4. A **StashTok** item appears in the main nav. On a phone, open it from the nav — do not bookmark the `/plugin/stashTok` URL directly, because Stash answers that path with a 404 on a hard reload.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Feed source | scenes | Build For You from whole scenes or from markers |
| Heart rating | 80 | `rating100` written when you heart a scene |
| Minimum duration | 30 | Scenes shorter than this are excluded from every feed (0 disables) |
| Stop at marker end | off | Advance when a marker ends instead of playing on |
| Blurred backdrop | on | Backdrop behind non-9:16 video |
| Marker ticks | on | Ticks on the scrub bar |
| Hold speed | 3 | Playback rate while holding the right side |
| Start muted | on | Autoplay-friendly default |
| Double-tap to heart | on | Double-tap hearts the scene |

## Faster grids (optional)

Stash cannot resize a scene screenshot or a performer image on the fly, so a 200 px card
downloads the full picture. `tools/thumbs-service/` is a small sidecar that renders and
caches 320 px JPEGs; the plugin points at it when it is running and silently falls back
to Stash's originals when it is not. Point it out in `Settings -> thumbBase`, or leave
the setting empty and the app guesses from the port it is served on (9997 -> :18997,
9998 -> :18996). See [tools/thumbs-service/README.md](tools/thumbs-service/README.md).

## Notes and limits

- Feed definitions live in `localStorage` of the browser that created them; there is no server component and no database. Clear site data and they are gone.
- Scene video streams from `/scene/<id>/stream`, i.e. the original file. Stash decides whether it serves the original or a transcode based on your own settings.
- Marker items play the *scene*, positioned at the marker, so the whole-timeline scrub works. `SceneMarker.stream` previews are deliberately not used — they are short, low-resolution clips.
- iOS Safari has no Fullscreen API for arbitrary elements, so "fullscreen" is a fixed 100dvh overlay with the safe-area insets honoured. Using the native video fullscreen would break the gestures.
- Two fingers are required to zoom, which is why a single-finger vertical swipe is unambiguous.

## Troubleshooting

If visiting **Settings -> Plugins** kills the page until you reload, a community plugin
is probably declaring a global that another one already declares. Working through it:
[docs/community-plugin-collisions.md](docs/community-plugin-collisions.md).

## Licence

MIT — see `LICENSE`.
