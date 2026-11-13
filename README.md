# StashTok

A full-screen, TikTok-style vertical feed for [Stash](https://github.com/stashapp/stash). Swipe through your library one scene at a time, with the HUD out of the way until you touch the screen.

![status](https://img.shields.io/badge/version-0.1.0-informational)

## What it does

- **Vertical feed** — one scene per screen, 9:16 framing. 16:9 video is letterboxed and centred rather than cropped, with a blurred backdrop behind it.
- **Feeds** — For You (random), Favorites, one or many tags, a performer's scenes in date order, markers, never-played, shorts, portrait-only, or any saved Stash filter. Build and save your own feeds in the app.
- **Gestures**
  - swipe up / down — next / previous
  - tap — pause or resume
  - long-press the middle — actions (heart, rating, details, performers, markers)
  - hold the right side — fast-forward (rate configurable)
  - hold the left side — rewind
  - pinch — zoom the video inside the viewport; the HUD never scales
  - drag horizontally — scrub within the scene
  - double-tap — heart (or reset the zoom when zoomed)
- **Scrub bar** with a tick per marker, and the marker title as you pass it.
- **Details sheet** — file path, size, duration, resolution, codecs, bitrate, play counts, plus every performer and tag as a tappable chip.
- **Hearts are ratings.** Stash has no scene favourite, so a heart writes `rating100` through `sceneUpdate`. Hearts therefore show up in Stash's own rating filters, and in other clients.

## Install from a source (updates)

Once this repo is published, add it once in each Stash instance:

**Settings → Plugins → Available Plugins → Add Source**

- URL: `https://<your-user>.github.io/stash-tok/index.yml`

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

## Notes and limits

- Feed definitions live in `localStorage` of the browser that created them; there is no server component and no database. Clear site data and they are gone.
- Scene video streams from `/scene/<id>/stream`, i.e. the original file. Stash decides whether it serves the original or a transcode based on your own settings.
- Marker items play the *scene*, positioned at the marker, so the whole-timeline scrub works. `SceneMarker.stream` previews are deliberately not used — they are short, low-resolution clips.
- iOS Safari has no Fullscreen API for arbitrary elements, so "fullscreen" is a fixed 100dvh overlay with the safe-area insets honoured. Using the native video fullscreen would break the gestures.
- Two fingers are required to zoom, which is why a single-finger vertical swipe is unambiguous.

## Licence

MIT — see `LICENSE`.
