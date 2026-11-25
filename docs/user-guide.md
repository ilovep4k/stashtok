# Using StashTok

StashTok turns your Stash library into a full-screen vertical feed: one scene per
screen, swipe up for the next one. Everything runs inside Stash as a plugin — no
separate server, no second library, no account.

This guide describes the app as it works today. If a screen named here looks
different, you are probably on an older installed copy: reload plugins in Stash,
then hard-reload the page (the plugin's files carry no cache-buster).

---

## 1. Getting in

1. Install the plugin (see the README) and enable **StashTok** in
   *Settings → Plugins*.
2. A **StashTok** entry appears in Stash's navigation. Open it from there — don't
   bookmark `/plugin/stashTok`, because a hard reload of that path gives a 404.

On a phone, add it to your home screen for a full-screen, chrome-free feed.

## 2. Moving around

- **Bottom bar**: `Feed` is fixed on the left. The next four slots are yours —
  long-press a slot to pick what it is (Discover, Performers, Favorites, Tags,
  Folders, Markers, Random, Settings, Ops).
- **Menu (☰)**: the drawer lists every section, whatever your bottom bar holds.
- **Back**: browser/phone back returns you where you came from. Opening a clip
  adds one history entry, not one per swipe.
- **Long-press Feed** to choose what the feed shows.

## 3. The feed

| Gesture | What it does |
| --- | --- |
| swipe up / down | next / previous clip |
| tap | pause / resume (a short delay lets a double-tap win) |
| double-tap | step the framing: auto-crop → full frame → fill height |
| drag sideways | scrub inside the current scene |
| swipe left past ~120 px | jump to the next scene in the channel carousel |
| hold left edge | rewind while held |
| hold right edge | fast-forward while held |
| two-finger pinch | zoom the video (the interface never scales) |
| long-press the middle | quick menu: mark for delete, speed, clear display, auto-scroll |

The scrub bar shows a tick per marker, and the marker's title as you reach it.
Long clips open in the middle of the action, not at the intro — a marker when the
scene has one, otherwise a random fifth of the way in.

**`M` adds a marker at the playhead** (right-click the video does the same, and the
⋯ panel has *Add marker here* for touch). The sheet takes an in point, a name, and
one tag from the Positions & Acts / Fetish lists — the name and the marker's primary
tag are the same word, so the marker is filterable as a tag in Stash. Markers are
start-only: Stash's `end_seconds` is optional and this sheet leaves it empty, so
none of the library's existing ranges are touched. An accidental marker is one tap
on the toast's **Undo**.

**Hearts are ratings.** Stash has no scene "favourite", so a heart writes
`rating100`. That means anything you heart also shows up in Stash's own rating
filters, and in other clients.

## 4. Favorites

The Favorites tab is a discovery page, not a feed:

- **Favorite performers** — up to ten hearted performers, in a fresh order each
  visit. The tile at the end of the row, **All Favorites**, opens the performers
  gallery scoped to the performers you have hearted. Tapping a circle opens that
  performer's full page.
- **Recently favorited**, **Random Favorites**, **Largest**, **Most viewed** — four
  rows of your hearted scenes, each sorted differently. *Most viewed* uses Stash's
  own play counter.
- **View all** (or the row title) opens the row as a **gallery**: the whole list as
  a grid, with a **Play Feed** button at the top to start playing from it. Tapping
  a tile starts the feed at that clip, in the row's own order.

Every tile shows the performer's name in the corner and the duration at the
top-right.

## 5. Performers, tags, markers, folders, search

- **Performers / Discover** — a grid of your library's performers. A performer page
  has their scenes, images and markers, with a highlight reel link.
- **Tags** — the tags that actually have scenes, most-used first.
- **Markers** — every marker grouped by its own tag; tap one to open its scene at
  that moment.
- **Folders** — browse by library path, the way your files are organised.
- **Search** — performers, scenes and folders in one field.

## 6. Feeds

**A feed is a saved filter that also knows how to play.** The filter half is the
same vocabulary Stash's own scene filter uses — tags, performers, date range,
rating, exclusions. The playback half is what makes it a feed: the order clips are
drawn in, and where a clip starts playing.

Build one in **Settings → Your Feeds**:

- **Built-in Feeds** — `For You` and `Favorites` templates. They open the editor
  pre-filled with your current settings, so you can clone the built-in feed and
  change anything about it.
- **Custom Feeds** — every feed you have saved. Edit, use, or delete them.

The editor has:

| Field | What it controls |
| --- | --- |
| Feed name | what the HUD and the feed list call it |
| Algorithm preferences | which weighting the feed draws from |
| Content time range | added this week / 30 days / 90 days / everything |
| Filter by tag | one or more tags, all of them or any of them |
| Performers | anyone, your hearted performers, or a picked list |
| Sort | shuffle, newest, top rated, most viewed, size, longest, A–Z |
| Exclusions | one path fragment per line — anything containing it stays out |

Two more things worth knowing:

- **Saved filters**: a feed can point at a filter you already built in Stash's own
  scene UI (`Saved filter` in the builder). That is the intended way to bring your
  existing Stash filters into the feed — a feed reads Stash's filter language
  directly rather than re-implementing Stash's page URLs.
- **Reshuffling**: a shuffle is drawn once and held for the day, so paging through
  a feed doesn't re-draw the library under you. Reshuffle explicitly when you want
  a new draw.

Feed definitions live in this browser's `localStorage`. Nothing is sent anywhere.

## 7. Settings

- **Your Feeds** — the feed list and the feed editor (above).
- **Performer Page** — default sort for performer pages.
- **Blur Content Thumbnails** — a safe-for-work switch. When it is on, nothing
  plays; thumbnails are blurred instead.
- **Privacy Lock** — a PIN in front of the app, checked when the tab loses focus.
  Turning the lock off resets the PIN.
- **Appearance**, **Navigation** — colour/mono mode and what the bottom bar holds.
- **Stash Operations** — run Stash jobs from the app: scan, rescan, generate,
  detect markers, identify, clean.
- **About** — version and diagnostics.

There is also a settings gear on most pages, and a **Watch history** list of the
last 100 scenes played in this browser.

## 8. When something looks wrong

1. **Reload plugins** in Stash, then hard-reload the page. The plugin's JS and CSS
   are served without a cache-buster, so a stale tab is the most common cause of
   "my change isn't there".
2. **Blank screen right after opening**: the shell can take a few seconds to mount
   the plugin. Reload once before assuming it is broken.
3. **A feed is empty**: check its tags, time range and exclusions. A feed that
   excludes a path, or requires a tag nothing carries, is legitimately empty.
4. **Video won't play**: StashTok uses Stash's original file. If Stash itself can't
   play that file, neither can the feed — check the scene in Stash first.
