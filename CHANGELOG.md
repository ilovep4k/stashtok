# Changelog

## Unreleased - desktop shell, discover, favourites, thumbnails

Desktop mode and the browsing surfaces, plus the fixes found while profiling them.

### Desktop performance

- Four simultaneous video streams were what stuttered a big desktop pane: only the card
  actually on screen keeps a decoding stream now, the others release theirs.
- The active video is promoted to its own compositor layer, so the rounded card clip is
  applied on the GPU instead of re-rasterising every frame. Corners are unchanged.
- Offscreen cards use `content-visibility`, and the Discover grid renders 60 cards and
  grows on scroll instead of mounting 200 at once.
- The scrub bar repaints once per frame instead of on every `timeupdate`.
- The page itself no longer zooms: pinch belongs to the video only, and a stored Safari
  pinch-zoom is nudged back on load.

### Thumbnails

- Grid and strip photos are real `<img loading="lazy" decoding="async">` elements
  instead of CSS `background-image`, so offscreen cards are never requested. On
  Discover: 100 cards in the DOM, 57 fetched (previously every card loaded up front).
- New `thumbBase` setting plus a companion resize service (see
  `tools/thumbs-service/`), because Stash cannot resize screenshots or performer images
  on the fly. A 320 px JPEG averages ~12.5 KB against ~67 KB for the original, and the
  service caches on disk. If it is down or has no image, the `<img>` falls back to
  Stash's original URL.

### Screens

- Discover replaces Performers: creator search, circles of creators you follow, a strip
  of random performers and one of your most-used tags.
- Favourites is a gallery of hearted scenes with the folders-style middle picker for
  sort (recent/oldest/name/size/duration). Sequential, no longer reshuffled on every tap.
- Folders is a file-manager layout: circular back, centred title, search, sort bar, blue
  folder rows with subtitle and dividers.
- Bottom nav defaults to Feed / Performers / Favorites / Folders / Settings.

### Feed

- Top-middle "For You" dropdown carries the feed order: New (recently added) and Random,
  with room for more.
- Quick tagging from the rail: a `+` beside the tag icon opens search and recent tags,
  and the performer icon is gone from the right side.
- PIN: four digits accept themselves, no confirm key. The page unlocks on the last one.
- Overlays share one dialog contract: Esc closes, Tab stays inside, focus returns to the
  trigger.

### Fixes

- Stash renders the settings panel from its own settings page with no props; every field
  now has a default, so the tab no longer dies with *Something went wrong*.
- Screen wake lock while the feed is open, re-acquired when the tab becomes visible
  again, released on unmount.
- Community plugins that declare a duplicate top-level identifier no longer take the
  page down; see `docs/community-plugin-collisions.md`.

## 0.1.0

First public shape.

- Full-screen vertical feed for scenes and markers, 9:16 letterboxing with a blurred backdrop.
- Autoplay, swipe next/previous, hold-to-fast-forward, hold-to-rewind, pinch zoom (video only), tap pause, double-tap heart.
- Marker ticks and labels on the scrub bar.
- Feed picker in the top pill: For You (random), Favorites, Markers, saved custom feeds, and a builder for tag / performer / fresh / shorts / vertical / saved-filter feeds.
- Bottom nav: Home, Performers, Favorites, Tags, Settings.
- Performer profiles with cover, avatar, follow (Stash favourite), stats and a 3-column grid; folder profiles for performers that only exist as a directory.
- Username = Stash performer, else performer folder below the library root, else an @handle from the filename.
- Follow Stash's `rating100` for hearts, so ratings stay visible in Stash and other clients.
- Skips scenes whose files are missing, with a \"files missing from disk\" state after repeated failures.