# Changelog

## Unreleased - feed chrome

- **Hashtags are one line.** Whatever does not fit is cut and the strip ends in
  "…more", which opens a **More Tags** sheet with every tag as a chip. Pure React
  state, not a URL param, so browser Back never lands you back inside the sheet.
- **The right rail sits higher** (104 px off the bottom) so its last button clears
  the timeline and a wrapped caption on a short window.
- **The rail's action button always reads "More".** It used to relabel itself "2x"
  whenever the playback speed was not 1, which read as a speed button.
- **The profile tab bar is a fixed widget**: it sticks to the top of the pane, with
  the tile-size toggle locked to its right edge.

## Unreleased - profile identity stack

- **Performer tags are gone from the profile strip.** The only performer tags this
  library carries are award tags, so the row was removed outright and `tags` dropped
  from the performer query.

- **Counts line reads "526 scenes, 0 images, 283 markers"** in a larger 15.5 px face,
  one line, each count still tapping through to its tab.
- **Metadata strip under the counts**: `ethnicity | country | natural-or-fake`, then
  the performer's tags, then parenthesised site links `(X) (OnlyFans) (IG)`.
- **Links are filtered to SimpCity, X, IG, Linktree, OnlyFans and Babepedia.** imdb,
  iafd, bang.com and the rest of the catalogue URLs are dropped; one per site.
- **"View on Stash" moved off the header** into the ⋯ menu, which now sits beside the
  Highlight reel button instead of floating at the top right.

## Unreleased - profile header without a banner

- **The performer header is a plain identity row.** No cover art behind it: avatar on
  the left, then the name with a favourite heart beside it (one tap on, one tap off,
  replacing the old wide Favourite button), and a single counts line
  "526 scenes, 283 markers" -- one line, never two stacked stat blocks. Both counts
  still tap through to their tab. Links, tags and Highlight reel stay below.
- **The tab bar reads as labels on a wide screen**: `[ Scenes ][ Images ][ Markers ]`
  with the tile-size toggle alone on the far right as a four-pane gallery icon, the
  same control that used to hide as "Smaller icons" inside each sort dropdown.
- **Desktop tiles are 200 px wide** (were 224) and the profile page no longer caps at
  1180 px, so the grid uses the whole pane.

## Unreleased - no swipe-right to profile

- **Swipe right no longer opens the performer page.** The shortcut swallowed the right
  half of the screen, which is hold-to-fast-forward, so a slightly diagonal hold turned
  into a profile jump or a dead gesture. Rightward drags scrub the clip now; a leftward
  drag past ~120 px still steps the channel carousel.

## Unreleased - tag autocomplete in the feed builder

- **New feed → Tags is a type-to-search field.** Any tag in the library can be picked
  from a live results list (debounced 180 ms, `findTags(filter:{q})` sorted by scene
  count), with ↑/↓/Enter to pick, chips to remove and Backspace on an empty field to
  drop the last one. Escape clears the results before it closes the sheet.
- **Tags are no longer hidden behind the "Tags" feed type.** The field sits under *How
  recent* for every feed, so "For You", "Fresh", "Markers" and the rest can all be
  narrowed by tag; the AND/OR switch appears once a tag is picked. Saved feeds reload
  their chips by name (`findTag(id)`) even when the tag is outside the top 200.

## Unreleased - View on Stash

- A **View on Stash** pill centred at the top of every profile opens the same page in
  Stash itself in a new tab: the performer record, or — for a folder profile — the scene
  list carrying the folder's `Path includes …` filter, the same query the folder page
  runs, so the counts match. The pill is a sibling of the cover, not a child: the
  safe-for-work blur is a `filter` on the cover and would blur anything inside it.

## Unreleased - pull to refresh, near-ratio crop

- **Pull to refresh**: at the first clip, pulling down shows an indicator and reloading
  the feed once past ~120 px; anywhere else a pull down still steps back a clip.
- **Portrait clips fill the screen too**, 9:16 included: any clip whose framing would
  cost no more than 20 % of the picture per edge is scaled to cover, so the bars go. Once
  the crop would eat more than that (4:3, 5:4) it letterboxes as before. Double tap flips
  between the fill and the 100 % fit.
- **Auto-crop is a setting**: Settings → Feed → *Auto-crop to fill*, on by default. It
  applies to every clip regardless of what you pinched on another one.
- Fixed a framing bug where every other clip came up uncropped: a prewarmed clip fires
  `canplay` before it becomes active, so the reset on clip change was the last word.

## Unreleased - quick menu, autoscroll

- Quick menu, in the order it is used: **Mark for Delete** (the old flag, now named
  plainly), **Speed** centred with 0.5x / 1x / 2x, **Clear Display**, **Auto-Scroll**,
  **Close**.
- **Clear Display** strips every overlay for that clip — top bar, rail, bottom tab bar,
  caption, badges, the big pause icon — and taps no longer bring them back. Gestures keep
  working: the timeline is invisible but still grabbable, and it fades in while you scrub.
  The next clip restores the display, and the row turns into **Restore Display** so the
  menu is never a dead end. The quick menu is 30 % wider now that its rows carry words.
- **Auto-Scroll** advances by itself 15 s into a clip, and opens each clip past the intro:
  70 % of the time a quarter to a half in, 30 % of the time in the last third. It holds
  while the clip is paused or a menu/sheet is open, and a clip that ends first just
  advances. The switch is remembered in `localStorage` (`stashTok.autoScroll`).

## Unreleased - desktop shell, discover, favourites, thumbnails

Desktop mode and the browsing surfaces, plus the fixes found while profiling them.

### A refresh no longer comes up zoomed

- The portrait crop step was remembered in `localStorage` and re-applied on load, so a
  refresh with the last step on "fill height" reopened the feed at ~3.6x with the HUD
  already gone: a giant cropped frame and no visible control. Only the un-zoomed step
  ("full frame") is restored now; anything else starts from the default middle-half crop.
- A single tap on **any** zoomed frame — crop step or pinch — now opens it to the full
  frame and shows the "Full frame" badge, instead of being swallowed by the play/pause
  tap. With the HUD hidden three seconds into playback, a zoomed frame must never be a
  dead end.
- The document scroll lock used `stk-lock`, the same class as the PIN pad overlay, so
  `html` inherited the pad's `display:flex; position:absolute; background:#000`
  centering for the whole session. Renamed to `stk-noscroll`.

### Keep the screen awake

- The phone used to sleep mid-clip. The old code asked for a wake lock once, on mount —
  which does nothing on the LAN, because `navigator.wakeLock` exists only in a secure
  context and Stash is served over plain `http://`. It now also runs a 2x2 px silent
  looping clip as a blob URL (Stash's CSP is `media-src blob: 'self'`, so a `data:` video
  would be refused), requested on the next user gesture and re-requested after every hide,
  focus or system release. The clip runs even when the lock resolves: in low power mode
  and in a home-screen web app before iOS 18.4 the OS ignores the lock while still
  answering yes. It is held only while a clip is playing, and dropped when the feed closes.

### Portrait auto-crop

- A 16:9 (or wider) clip on a portrait screen is framed on the middle half: a quarter of
  the width is cut from each side, so the subject fills more of the phone without losing
  the middle. Portrait clips and landscape screens are untouched.
- Double-tap steps the framing: auto-crop → full frame (no crop) → fill the device
  height → auto-crop. A pinch still zooms freely; the next tap returns to the step the
  cycle is on. The step is remembered in `localStorage` (`stashTok.crop`).
- A single tap now pauses after a 300 ms wait, so a double tap can win. A second tap
  inside 500 ms counts as a double tap: if the first tap already paused the clip it is
  resumed, and the framing steps instead of the clip pausing. Resuming a paused clip
  stays immediate, because a delayed `play()` is refused as "not a user gesture".
- While the crop is on, a drag is still a swipe (up/down) or a scrub (sideways) — only a
  pinch hands the gesture over to panning.
- Long-press, then drag, grabs the frame and moves it under one finger — the pan that
  used to need two. It only engages when the picture is larger than its box (auto-crop or
  a pinch) and cancels the quick menu / speed hold, which need a still finger anyway.

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

- Discover is a dashboard, after stashy: a stats strip (scenes, performers, studios,
  galleries) and a horizontal row per sort - scenes last played, recently added, most
  viewed and random; performers new, top and highest rated; galleries new and updated.
  Empty rows are not rendered, so a library without galleries shows no gallery rows.
  Scene cards open the feed on that clip, performer cards open the profile, gallery
  cards open Stash's gallery page.
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