/*
 * StashTok — a full-screen, TikTok-style vertical feed for Stash.
 *
 * Feeds: For You (random), Favorites, one or many tags, performer, markers,
 * fresh (never played), shorts, portrait-only, and any saved Stash filter.
 * Gestures: swipe up/down, tap pause, long-press centre = actions,
 * hold right = fast-forward, hold left = rewind, pinch = zoom (video only),
 * double-tap = step the portrait framing (auto-crop / full / fill height),
 * drag the scrub bar to seek.
 */
(function () {
  "use strict";

  const api = window.PluginApi;
  if (!api) {
    console.warn("[stashTok] PluginApi unavailable");
    return;
  }

  const React = api.React;
  const h = React.createElement;
  const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;
  const RouterDOM = api.libraries.ReactRouterDOM || {};
  const Link = RouterDOM.Link || "a";

  /* Sheets must not live inside a page's scroll container. A page is
     `overflow-y: auto` (and `-webkit-overflow-scrolling: touch` for iOS), and a
     fixed child of a scroll container is still clipped/stacked by it on WebKit:
     the long-press action sheet came up underneath the bottom nav there. The
     portal puts every sheet at the top of the document, where position: fixed
     means the viewport and z-index 9500 beats the app root's 9000. */
  const PORTAL = document.createElement("div");
  PORTAL.className = "stk-portal";
  document.body.appendChild(PORTAL);
  function Portal({ children }) {
    return api.ReactDOM.createPortal(children, PORTAL);
  }

  const PLUGIN_ID = "stashTok";
  const ROUTE = "/stashtok";
  const LEGACY_ROUTES = ["/stash-tok", "/plugin/stashTok"];
  const FEEDS_KEY = "stashTok.feeds.v1";
  /* the channel title card is set just before a feed switch remounts FeedView */
  let PENDING_CARD = null;
  const FOLDER_FAV_KEY = "stashTok.folderFavs.v1";
  const PAGE_SIZE = 8;

  /* Gooners Delight shows one feed in two windows: both panes ask for the same
     pages, so the fetch (and the random order) is shared and each pane keeps a
     parity slice of it — pane 0 gets posts 0,2,4…, pane 1 gets 1,3,5… */
  const FEED_SHARED = new Map();
  function fetchFeedPageShared(spec, cfg, page) {
    if (!spec || !spec.cacheKey) return fetchFeedPage(spec, cfg, page);
    const key = spec.cacheKey + ":" + page;
    if (!FEED_SHARED.has(key)) FEED_SHARED.set(key, fetchFeedPage(spec, cfg, page));
    return FEED_SHARED.get(key);
  }
  function paritySlice(items, spec, page) {
    if (!spec || spec.parity == null || !items) return items;
    const offset = (page - 1) * PAGE_SIZE;
    return items.filter((_, i) => (offset + i) % 2 === spec.parity);
  }
  const HOLD_MS = 380;
  /* the quick menu owns a still finger for longer than a grab needs */
  const LONG_PRESS_MS = 400;
  /* a press that moves this far is a grab, not a tap: the frame follows the
     finger from here on */
  const PAN_SLOP = 8;
  /* past the edge of the picture the frame keeps moving at a third of the
     finger's speed and no further than RUBBER_MAX, so the drag itself is what
     says "I want the next clip" while the picture says "there is nothing more".
     The release is judged on the RAW overscroll, so a short flick still pages. */
  const RUBBER_RATIO = 0.35;
  const RUBBER_MAX = 96;
  const SWIPE_PX = 70;
  /* a leftward drag longer than this switches from scrubbing to the channel
     carousel. Rightward drags stay scrubbing: the old "swipe right = performer
     page" fought hold-to-fast-forward on the right half of the screen. */
  const CHANNEL_PX = 120;
  /* pull the first clip down this far to reload the feed */
  const REFRESH_PX = 120;
  const MAX_ZOOM = 8;
  const HEART_POP_MS = 700;
  /* portrait auto-crop: 25 % of the width off each side leaves the middle half */
  const CROP_SIDE = 0.25;
  /* a tap only pauses after this long, so a double tap can still win */
  const TAP_WAIT_MS = 300;
  /* a second tap up to here is a double tap and zooms; after this it is a new tap */
  const DOUBLE_TAP_MS = 500;
  /* a double tap inside the outer stripe of the stage is a −5 s / +5 s seek,
     the phone's stand-in for an arrow key. The stripe is 200 px on a laptop and
     33 % of the width on anything narrower: 200 px of a 390 px phone would leave
     no centre to double tap for the crop cycle. */
  const EDGE_ZONE_PX = 200;
  const EDGE_ZONE_RATIO = 0.33;
  const SEEK_STEP = 5;
  /* how far up the scrub bar the finger travels before the Marker bubble arms */
  const MARKER_LIFT_PX = 96;

  /* ------------------------------------------------------------------ */
  /* icons                                                              */
  /* ------------------------------------------------------------------ */

  const ICONS = {
    home: "M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5",
    /* a post sitting on top of another card */
    /* a checklist: the operations screen */
    ops: "M4 7.5l2 2 3.2-3.4M12.5 8h7.5M4 16.5l2 2 3.2-3.4M12.5 17h7.5",
    /* a fanned deck: two cards peeking behind the front one */
    feed: "M11.2 4.1h4.6a3 3 0 0 1 3 3v4.6M9.4 6.3h4.5a3 3 0 0 1 3 3v4.5M6.6 8.5h4.8a3 3 0 0 1 3 3v6.9a3 3 0 0 1-3 3H6.6a3 3 0 0 1-3-3v-6.9a3 3 0 0 1 3-3zM7.3 13.4h3.4M7.3 16.3h2.2",
    heart: "M12 20.5S3.5 15 3.5 9.4A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 8.5 3c0 5.6-8.5 11.1-8.5 11.1z",
    user: "M4.5 21a7.5 7.5 0 0 1 15 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    tag: "M3.5 11.5v8a1 1 0 0 0 1 1h8L21 12 12 3l-8.5 8.5zM7.5 8.5h.01",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 8L4.2 8a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.3V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4.9z",
    back: "M15 4.5 7.5 12 15 19.5",
    play: "M8 5.5v13l11-6.5-11-6.5z",
    pause: "M9 5v14M15 5v14",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.6h.01",
    volume: "M4 9.5v5h3.5L12 19V5L7.5 9.5H4zM16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12",
    mute: "M4 9.5v5h3.5L12 19V5L7.5 9.5H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
    flag: "M5 21V4M5 4h11l-1.5 4L16 12H5",
    x: "M6 6l12 12M18 6 6 18",
    plus: "M12 5v14M5 12h14",
    chevron: "M9 6l6 6-6 6",
    menu: "M4 7h16M4 12h16M4 17h16",
    chevronUp: "M6 15l6-6 6 6",
    chevronDown: "M6 9l6 6 6-6",
    fullscreen: "M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5",
    fullscreenExit: "M4 9h5V4m11 5h-5V4M9 20v-5H4m11 5v-5h5",
    /* a box with an arrow leaving it: opens the page in Stash itself */
    external: "M13 4h7v7M20 4l-8.2 8.2M18 14v5.5A1.5 1.5 0 0 1 16.5 21h-11A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7H11",
    sort: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5 16 16",
    folder: "M3.5 7.5A1.5 1.5 0 0 1 5 6h3.6l1.9 2.4H19a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V7.5z",
    /* four panes: the tile-size toggle at the end of the profile bar */
    gallery: "M4 4.6h6.4v6.4H4zM13.6 4.6H20v6.4h-6.4zM4 13.6h6.4V20H4zM13.6 13.6H20V20h-6.4z",
    chapter: "M6.5 4.5h11v15.2l-5.5-3.9-5.5 3.9V4.5z",
    video: "M3.5 6.5h11.5v11H3.5zM15 10.2l5.5-2.7v9l-5.5-2.7",
    music: "M9 18.5V7.2l10-2v11.1M9 18.5a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0zM19 16.3a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0z",
    image: "M3.5 5.5h17v13h-17zM8.2 11.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM4.2 17.2l5-5 3.6 3.6 2.6-2.6 4.4 4.4",
    video: "M3.5 6.5h11.5v11H3.5zM15 10.2l5.5-2.7v9l-5.5-2.7",
    music: "M9 18.5V7.2l10-2v11.1M9 18.5a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0zM19 16.3a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0z",
    image: "M3.5 5.5h17v13h-17zM8.2 11.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM4.2 17.2l5-5 3.6 3.6 2.6-2.6 4.4 4.4",
    sparkle: "M12 3.5 13.8 9l5.7 1.8L13.8 13 12 18.5 10.2 13 4.5 10.8 10.2 9 12 3.5z",
    rotate: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4",
    verified: "M12 2.3l2.5 1.4 2.9-.2 1.2 2.6 2.4 1.6-1 2.8 1 2.8-2.4 1.6-1.2 2.6-2.9-.2L12 21.7l-2.5-1.4-2.9.2-1.2-2.6-2.4-1.6 1-2.8-1-2.8 2.4-1.6 1.2-2.6 2.9.2L12 2.3zM8.5 12.1l2.3 2.3 4.7-4.8",
    /* horizontal ellipsis: the performer menu */
    more: "M5.5 12h.01M12 12h.01M18.5 12h.01",
    /* two squares: find duplicate images */
    dupe: "M9 9h11v11H9zM5 15V4h11",
    link: "M10 14l4-4M9.2 11.4 7 13.6a3.6 3.6 0 1 0 5.1 5.1L14.3 16.5M14.8 12.6 17 10.4a3.6 3.6 0 1 0-5.1-5.1L9.7 7.5",
    /* tick: the chosen option in a settings picker */
    check: "M4.5 12.5l5 5 10-11",
    /* padlock: the privacy lock section */
    lock: "M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5zM8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7",
  };

  /* ---- thumbnails ------------------------------------------------- *
   * Stash cannot resize on the fly, so a sidecar renders 320 px JPEGs.
   * THUMB_BASE is set from plugin config, or guessed from the port the app
   * is served on (9997 -> :18997, 9998 -> :18996). If the service is down the
   * <img> falls back to the original URL, so nothing breaks.               */

  let THUMB_BASE = null;
  /* QA hook: how the thumbnail path is behaving right now */
  if (typeof window !== "undefined") {
    window.__stkThumb = () => ({ base: THUMB_BASE });
  }

  /* The resizing sidecar sits beside each instance: 9997 -> 18997, 9998 -> 18996.
     A viewport served from any other port (a QA proxy, a tunnel) has no known
     sidecar, so it keeps Stash's own images. */
  const THUMB_PORTS = { 9997: 18997, 9998: 18996, 18997: 18997, 18996: 18996 };

  function guessThumbBase() {
    try {
      const override = new URLSearchParams(window.location.search).get("thumbs");
      if (override) return override === "off" ? "" : override;
    } catch (e) {
      /* ignore */
    }
    const loc = window.location;
    const mapped = THUMB_PORTS[Number(loc.port)];
    if (!mapped) return "";
    return `${loc.protocol}//${loc.hostname || "127.0.0.1"}:${mapped}`;
  }

  function thumbWidth(width) {
    /* `width` is the CSS box the image is drawn into, so retina gets the pixels
       it actually needs. Grid tiles do not know their size at render time and
       pass nothing: 320 device px covers a ~160 px tile at 2x, and asking for
       more is what made every grid pad out half a gigabyte of bitmaps. Rounded
       to 80 px steps so the sidecar cache stays small. */
    if (!width) return 320;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const want = Math.round((width * dpr) / 80) * 80;
    return Math.max(80, Math.min(1280, want));
  }

  function thumbSrc(raw, width) {
    if (!raw || !THUMB_BASE) return raw;
    const match = /^(?:.*)?\/(scene|performer|image)\/([^/]+)\//.exec(raw);
    if (!match) return raw;
    const [, kind, id] = match;
    return `${THUMB_BASE}/t/${kind}/${id}?w=${thumbWidth(width)}`;
  }

  /* ---- discover dashboard ------------------------------------------- *
   * stashy's home in one screen: a stats strip and a horizontal row per
   * sort. Rows hide themselves when the instance has nothing to show.   */

  function DashRow({ title, children }) {
    if (!children) return null;
    const items = React.Children.toArray(children);
    if (!items.length) return null;
    return h(
      "section",
      { className: "stk-row" },
      h("h4", { className: "stk-row-h" }, title),
      h("div", { className: "stk-row-track" }, items)
    );
  }

  function SceneCard({ scene, onOpen }) {
    const file = (scene.files || [])[0];
    return h(
      "button",
      { className: "stk-card", onClick: () => onOpen(scene) },
      h("span", { className: "stk-card-img" }, h(Thumb, { src: rel(scene.paths && scene.paths.screenshot) })),
      file && file.duration ? h("span", { className: "stk-card-dur" }, fmtTime(file.duration)) : null,
      h("span", { className: "stk-card-title" }, scene.title || "Scene " + scene.id)
    );
  }

  function PerformerCard({ performer, onOpen }) {
    return h(
      "button",
      { className: "stk-card stk-card-person", onClick: () => onOpen(performer) },
      h("span", { className: "stk-card-img stk-card-round" }, h(Thumb, { src: rel(performer.image_path) })),
      h("span", { className: "stk-card-title" }, performer.name),
      h("span", { className: "stk-card-sub" }, fmtCount(performer.scene_count) + " scenes")
    );
  }

  function GalleryCard({ gallery, onOpen }) {
    return h(
      "button",
      { className: "stk-card", onClick: () => onOpen(gallery) },
      h("span", { className: "stk-card-img" }, h(Thumb, { src: rel(gallery.paths && gallery.paths.cover) })),
      h("span", { className: "stk-card-dur" }, fmtCount(gallery.image_count)),
      h("span", { className: "stk-card-title" }, gallery.title || "Gallery " + gallery.id)
    );
  }

  /** lazy thumbnail: a CSS background-image is fetched immediately even when the card
      is far off screen; a real <img> with loading=lazy never even requests it. */
  /* One shared observer, so a slow sidecar is only ever given a horizon for the
     tiles that actually entered the viewport. `loading=lazy` holds far-off images
     back, and a timeout set at mount would fire while they are still waiting
     their turn — which used to mark a working service as dead. */
  let THUMB_IO = null;
  const THUMB_PENDING = new Map();

  function whenOnScreen(el, fn) {
    if (typeof IntersectionObserver === "undefined") {
      fn();
      return () => {};
    }
    if (!THUMB_IO) {
      THUMB_IO = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const cb = THUMB_PENDING.get(entry.target);
            if (!cb) return;
            THUMB_PENDING.delete(entry.target);
            THUMB_IO.unobserve(entry.target);
            cb();
          });
        },
        { rootMargin: "300px" }
      );
    }
    THUMB_PENDING.set(el, fn);
    THUMB_IO.observe(el);
    return () => {
      THUMB_PENDING.delete(el);
      if (THUMB_IO) THUMB_IO.unobserve(el);
    };
  }

  function Thumb({ src, className, width }) {
    const imgRef = useRef(null);
    const [fallback, setFallback] = useState(false);
    const fallbackTimer = useRef(0);
    const primary = src && !fallback ? thumbSrc(src, width) : src;
    /* The thumbnail service is a second origin (host:18996/18997). If that port
       is firewalled the request hangs instead of failing, which fires no onError
       and leaves a blank tile forever — so once the tile is on screen and its
       image still has not arrived, fall back to Stash's own screenshot. */
    useEffect(() => {
      window.clearTimeout(fallbackTimer.current);
      setFallback(false);
      if (!src || !THUMB_BASE || thumbSrc(src, width) === src) return undefined;
      const el = imgRef.current;
      let stop = () => {};
      const arm = () => {
        /* A cold cache renders on demand, so a tile deep in a fast scroll can
           queue for a while. Swap this one to Stash's own image and leave the
           service alone: a down sidecar costs every tile this wait, not the
           session. */
        window.clearTimeout(fallbackTimer.current);
        fallbackTimer.current = window.setTimeout(() => setFallback(true), 6000);
      };
      /* the real clock starts when the request does, not when the tile scrolls
         into view: `loading=lazy` may hold it back for a while yet */
      if (el) {
        el.__stkArm = arm;
        stop = whenOnScreen(el, arm);
      } else {
        arm();
      }
      return () => {
        stop();
        window.clearTimeout(fallbackTimer.current);
      };
    }, [src, width]);
    if (!src) return null;
    return h("img", {
      ref: imgRef,
      className: "stk-thumb" + (className ? " " + className : ""),
      src: primary,
      alt: "",
      loading: "lazy",
      decoding: "async",
      draggable: false,
      onLoadStart: () => {
        /* restart the grace clock now that this tile's request is really out */
        const el = imgRef.current;
        if (el && el.__stkArm && !fallback) el.__stkArm();
      },
      onLoad: () => window.clearTimeout(fallbackTimer.current),
      onError: () => {
        window.clearTimeout(fallbackTimer.current);
        /* a 404 here is usually a performer with no image at all, which the
           sidecar answers with the same 404 Stash would: fall back for this one
           tile but keep the service (one bad id must not poison the session) */
        if (!fallback && primary !== src) setFallback(true);
      },
    });
  }

  /* Optional desktop hover preview (Settings → Performer page, off by default).
     It streams the scene's own file — generated preview mp4s 404 behind the LAN
     proxy and leave a blank tile — and seeks +30 s about once a second so a long
     clip is sampled rather than played. Off unless the user turns it on: the
     seeking costs real bandwidth and decode work. */
  const HOVER_PLAY = 1;
  const HOVER_STEP = 30;

  function HoverPreview({ src }) {
    const ref = useRef(null);
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
      const v = ref.current;
      if (!v) return undefined;
      v.muted = true;
      v.defaultMuted = true;
      let timer = 0;
      let lastJump = 0;
      const tick = () => {
        const el = ref.current;
        if (!el || !el.duration || !isFinite(el.duration)) return;
        if (el.currentTime - lastJump < HOVER_PLAY) return;
        /* lastJump is the position we just seeked TO: comparing against the
           position we left makes the next tick see a 30 s delta and jump again
           immediately, so the whole file flies past in seconds. */
        const next = el.currentTime + HOVER_STEP;
        const target = next >= el.duration - 1 ? 0 : next;
        lastJump = target;
        el.currentTime = target;
        const playing = el.play();
        if (playing && playing.catch) playing.catch(() => {});
      };
      const start = () => {
        window.clearInterval(timer);
        lastJump = 0;
        try {
          v.currentTime = 0;
        } catch (e) {
          /* seeking before metadata is known throws; the next event retries */
        }
        const playing = v.play();
        if (playing && playing.catch) playing.catch(() => {});
        timer = window.setInterval(tick, 250);
      };
      v.addEventListener("loadedmetadata", start);
      if (v.readyState >= 1) start();
      return () => {
        window.clearInterval(timer);
        v.removeEventListener("loadedmetadata", start);
      };
    }, [src]);

    if (!src || failed) return null;
    return h("video", {
      ref,
      className: "stk-tile-preview" + (ready ? " stk-preview-ready" : ""),
      src,
      muted: true,
      autoPlay: true,
      playsInline: true,
      /* Firefox paints its own PiP toggle over the top-right of any playing
         video; the rail's save button lives under that corner, so the badge
         landed on top of our own icon. Off for every video we render. */
      disablePictureInPicture: true,
      preload: "metadata",
      /* reveal only once a frame can paint; a file the browser cannot decode
         stays hidden and the still underneath keeps showing */
      onLoadedData: (event) => {
        const v = event && event.currentTarget;
        if (v && v.videoWidth > 0) setReady(true);
      },
      onError: () => setFailed(true),
    });
  }

  function Icon({ name, size = 22, className = "", filled = false }) {
    return h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        fill: filled && name === "heart" ? "currentColor" : "none",
        stroke: "currentColor",
        strokeWidth: name === "more" ? 3.4 : name === "heart" ? 1.8 : 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        className,
        "aria-hidden": "true",
      },
      h("path", { d: ICONS[name] || ICONS.info })
    );
  }

  /* ------------------------------------------------------------------ */
  /* helpers                                                            */
  /* ------------------------------------------------------------------ */

  async function gql(query, variables) {
    const response = await fetch("/graphql", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
      throw new Error(payload.errors.map((e) => e.message).join("; "));
    }
    return payload.data;
  }

  /** Stash returns absolute asset URLs pinned to its own host — make them relative. */
  function rel(url) {
    if (!url) return "";
    try {
      if (/^https?:\/\//i.test(url)) {
        const parsed = new URL(url);
        return parsed.pathname + parsed.search;
      }
      return url.startsWith("/") ? url : "/" + url;
    } catch (e) {
      return url;
    }
  }


  let LIB_ROOTS = null;
  let LIB_ROOTS_PROMISE = null;

  /** Library roots are the folders Stash knows with no parent. */
  function loadLibraryRoots() {
    if (LIB_ROOTS) return Promise.resolve(LIB_ROOTS);
    if (LIB_ROOTS_PROMISE) return LIB_ROOTS_PROMISE;
    LIB_ROOTS_PROMISE = (async () => {
      const roots = [];
      for (let page = 1; page <= 6; page += 1) {
        const data = await gql(
          `query StashTokRoots($page: Int!) {
            findFolders(filter: { per_page: 2000, page: $page }) {
              folders { path parent_folder { id } }
            }
          }`,
          { page }
        );
        const folders = (data.findFolders && data.findFolders.folders) || [];
        folders.forEach((folder) => {
          if (!folder.parent_folder && roots.indexOf(folder.path) === -1) roots.push(folder.path);
        });
        if (folders.length < 2000) break;
      }
      LIB_ROOTS = roots.sort((a, b) => b.length - a.length);
      return LIB_ROOTS;
    })().catch(() => {
      LIB_ROOTS = [];
      return LIB_ROOTS;
    });
    return LIB_ROOTS_PROMISE;
  }

  /** Performer folder = first segment below the library root: /O/<name>/... -> <name>. */
  function performerFolder(file) {
    if (!file || !file.path) return "";
    const clean = "/" + String(file.path).split("/").filter(Boolean).join("/");
    const roots = LIB_ROOTS || [];
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots[i].replace(/\/+$/, "");
      if (root && (clean === root || clean.indexOf(root + "/") === 0)) {
        const rest = clean.slice(root.length + 1).split("/").filter(Boolean);
        if (rest.length) return rest[0];
      }
    }
    const parts = clean.split("/").filter(Boolean);
    return parts.length > 1 ? parts[1] : parts[0] || "";
  }

  function forgetResume(key) {
    RESUME_VERSIONS.set(key, (RESUME_VERSIONS.get(key) || 0) + 1);
    try {
      const map = readResumeMap();
      if (map && Object.prototype.hasOwnProperty.call(map, key)) {
        delete map[key];
        window.localStorage.setItem(RESUME_KEY, JSON.stringify(map));
      }
    } catch (e) {
      /* ignore */
    }
  }

  /** Stash performer > library-root folder > @handle in the filename. */
  function resolveHandle(scene, file) {
    const performer = (scene.performers && scene.performers[0]) || null;
    if (performer) {
      return { name: performer.name, image: rel(performer.image_path), performer, folder: null, source: "stash" };
    }
    const folder = performerFolder(file);
    if (folder) {
      return { name: folder, image: "", performer: null, folder, source: "folder" };
    }
    const haystack = `${scene.title || ""} ${file && file.path ? file.path : ""}`;
    const match = /@([A-Za-z0-9._-]{2,})/.exec(haystack);
    if (match) {
      const raw = match[1].replace(/\.(mp4|mov|mkv|webm|m4v|wmv)$/i, "");
      const cleaned = raw
        .split("_")
        .filter((part) => part && !/^\d{4,}$/.test(part))
        .join("_");
      return { name: cleaned || raw, image: "", performer: null, folder: "", source: "filename" };
    }
    return { name: "Scene", image: "", performer: null, folder: "", source: "none" };
  }

  function initials(name) {
    return String(name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  }


  /** Stash signs stream URLs for its configured host; the signature 404s on any
   *  other host (LAN IP, reverse proxy). Prefer the unsigned path and keep the
   *  signed URL as a fallback for installs that require it. */
  function streamSource(scene) {
    const raw = rel(scene.paths && scene.paths.stream);
    return { plain: raw.split("?")[0], signed: raw };
  }


  /** Start where the action is: a random marker when the scene has them, else a
   *  random fifth for long scenes, so a feed never opens on an intro. */

  /** Browsers cannot decode these containers/codecs, so a feed containing them
   *  is a run of dead frames. Drop them before they reach the player. */
  const BAD_EXT = ["wmv", "avi", "flv", "mpg", "mpeg", "vob", "ts", "m2ts", "rmvb", "divx", "ogv", "3gp", "asf"];
  const BAD_CODEC = ["wmv1", "wmv2", "wmv3", "vc-1", "msmpeg4", "mpeg4", "mpeg2video", "mpeg1video", "rv40", "h263", "msvideo1"];

  const FLAG_TAG_FALLBACK = "stashtok-delete";

  /* keyed by name: the tag can be renamed in setup, and a single cached id
     would keep flagging scenes with the name the user just replaced */
  const flagTagIds = {};

  async function ensureFlagTag(name) {
    if (flagTagIds[name]) return flagTagIds[name];
    const found = await gql(
      `query StashTokFindFlagTag($q: String) { findTags(filter: { q: $q, per_page: 20 }) { tags { id name } } }`,
      { q: name }
    );
    const exact = ((found.findTags && found.findTags.tags) || []).find(
      (tag) => tag.name.toLowerCase() === name.toLowerCase()
    );
    if (exact) {
      flagTagIds[name] = exact.id;
      return flagTagIds[name];
    }
    const created = await gql(
      `mutation StashTokMakeFlagTag($name: String!) { tagCreate(input: { name: $name }) { id name } }`,
      { name }
    );
    flagTagIds[name] = created.tagCreate.id;
    return flagTagIds[name];
  }

  async function flagScene(scene, cfg) {
    const name = (cfg && cfg.flagTag) || FLAG_TAG_FALLBACK;
    const tagId = await ensureFlagTag(name);
    const existing = (scene.tags || []).map((tag) => tag.id);
    await gql(
      `mutation StashTokFlagScene($id: ID!, $tags: [ID!]) {
        sceneUpdate(input: { id: $id, tag_ids: $tags }) { id }
      }`,
      { id: scene.id, tags: existing.concat([tagId]) }
    );
  }

  function isFlagged(scene, cfg) {
    const name = ((cfg && cfg.flagTag) || FLAG_TAG_FALLBACK).toLowerCase();
    return (scene.tags || []).some((tag) => String(tag.name).toLowerCase() === name);
  }

  function isPlayable(scene) {
    const file = (scene.files && scene.files[0]) || {};
    const path = String(file.path || (scene.paths && scene.paths.stream) || "");
    const dot = path.lastIndexOf(".");
    const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
    if (BAD_EXT.indexOf(ext) >= 0) return false;
    const codec = String(file.video_codec || "").toLowerCase();
    return !BAD_CODEC.some((bad) => codec.indexOf(bad) === 0);
  }

  function pickStartAt(scene, cfg, spec) {
    if (spec && spec.startAt) return Number(spec.startAt) || 0;
    if (cfg.randomStart === false) return 0;
    const file = (scene.files && scene.files[0]) || {};
    const duration = Number(file.duration) || 0;
    const markers = (scene.scene_markers || []).filter((marker) => Number(marker.seconds) > 5);
    if (markers.length) return Number(markers[Math.floor(Math.random() * markers.length)].seconds) || 0;
    const floor = Number(cfg.longSceneSeconds) || 300;
    if (duration > floor) {
      const fifth = 1 + Math.floor(Math.random() * 4);
      return Math.floor((duration * fifth) / 5);
    }
    return 0;
  }

  function fmtTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
  }

  /** 7550 -> 7.5K, 45265 -> 45K, 1_240_000 -> 1.2M (truncated, never rounds up past the real count) */
  function fmtCount(value) {
    const n = Math.floor(Number(value) || 0);
    if (n < 1000) return String(n);
    const units = [
      [1000000000, "B"],
      [1000000, "M"],
      [1000, "K"],
    ];
    for (let i = 0; i < units.length; i += 1) {
      const [div, suffix] = units[i];
      if (n >= div) {
        const scaled = n / div;
        const text = scaled >= 10 ? String(Math.floor(scaled)) : (Math.floor(scaled * 10) / 10).toFixed(1);
        return text.replace(/\.0$/, "") + suffix;
      }
    }
    return String(n);
  }

  function fmtBytes(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* how far the frame moves when the finger has already left the picture: the
     same distance, compressed, so the edge reads as elastic instead of stiff */
  function rubber(distance) {
    if (!distance) return 0;
    return Math.sign(distance) * Math.min(RUBBER_MAX, Math.abs(distance) * RUBBER_RATIO);
  }

  /* the part of the stage the picture actually covers: the element is the whole
     box even when object-fit leaves black bars, and a grab on the bars must not
     pan. Returns the painted rect in viewport pixels, transform included. */
  function paintedRect(video) {
    const rect = video.getBoundingClientRect();
    /* in cover mode the picture fills the element and is cropped by the stage, so
       the whole element box is picture — there are no bars to grab */
    if (video.classList && video.classList.contains("stk-active") &&
        video.closest && video.closest(".stk-fill")) return rect;
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) return rect;
    const ar = vw / vh;
    let w = rect.width;
    let h = rect.height;
    if (w / h > ar) w = h * ar;
    else h = w / ar;
    return {
      left: rect.left + (rect.width - w) / 2,
      top: rect.top + (rect.height - h) / 2,
      right: rect.left + (rect.width + w) / 2,
      bottom: rect.top + (rect.height + h) / 2,
    };
  }

  function buzz(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* graphql fragments                                                  */
  /* ------------------------------------------------------------------ */

  const SCENE_FIELDS = `
    id
    title
    date
    created_at
    details
    rating100
    o_counter
    play_count
    paths { stream preview screenshot vtt sprite }
    files { path size duration width height video_codec audio_codec frame_rate bit_rate }
    performers { id name image_path ethnicity rating100 }
    studio { id name }
    tags { id name }
    scene_markers { id title seconds end_seconds primary_tag { id name } }
  `;

  /** A feed's own tags win. For You and Favorites fall back to the narrowing set
   *  in Settings → Your Feeds, so the filter survives a spec that was rebuilt
   *  from a route (the root feed is re-made on every navigation). */
  function effectiveTags(spec, cfg) {
    if (spec.tags && spec.tags.length) return { tags: spec.tags, mode: spec.tagMode || "OR" };
    const type = spec.type || "foryou";
    if (cfg && type === "foryou" && cfg.foryouTags && cfg.foryouTags.length) {
      return { tags: cfg.foryouTags, mode: cfg.foryouTagMode || "OR" };
    }
    if (cfg && type === "favorites" && cfg.favoriteTags && cfg.favoriteTags.length) {
      return { tags: cfg.favoriteTags, mode: "OR" };
    }
    return { tags: [], mode: "OR" };
  }

  const DEFAULT_PERFORMER_SCOPE = { mode: "all", ids: [] };
  /* Stash keeps ethnicity as a free string on the performer, so a feed needs the
     value the library actually stores. These are the ones in use here (checked
     live: Caucasian 1399, Black 769, Mixed 75, Asian 74, Indian 5, Other 5,
     Middle Eastern 3). */
  const ETHNICITY_OPTIONS = ["Caucasian", "Black", "Mixed", "Asian", "Indian", "Middle Eastern", "Other"];

  /* Stash's GenderEnum. Kept as a list rather than introspected: the enum is
     fixed by the server version, and an unknown value would break the query. */
  const GENDER_OPTIONS = [
    { value: "FEMALE", label: "Female" },
    { value: "MALE", label: "Male" },
    { value: "TRANSGENDER_FEMALE", label: "Trans female" },
    { value: "TRANSGENDER_MALE", label: "Trans male" },
    { value: "NON_BINARY", label: "Non-binary" },
    { value: "INTERSEX", label: "Intersex" },
  ];
  const GENDER_VALUES = GENDER_OPTIONS.map((option) => option.value);

  function shownGenders(cfg) {
    const chosen = (cfg && cfg.genders) || [];
    const valid = chosen.filter((value) => GENDER_VALUES.indexOf(value) >= 0);
    return valid.length ? valid : GENDER_VALUES;
  }

  function hiddenGenders(cfg) {
    const shown = shownGenders(cfg);
    return GENDER_VALUES.filter((value) => shown.indexOf(value) < 0);
  }

  function genderLabel(cfg) {
    const hidden = hiddenGenders(cfg);
    if (!hidden.length) return "All";
    const label = (value) => (GENDER_OPTIONS.find((option) => option.value === value) || {}).label || value;
    return "All except " + hidden.map(label).join(", ");
  }

  /* Scenes are filtered by performer id, not by Stash's performers_filter: that
     filter drops every scene with no performers at all (158k -> 16k here), and
     most of this library has no performer metadata. "performers EXCLUDES <ids>"
     keeps scenes that have no performers and drops the ones that do. */
  let genderIdCache = { key: "", ids: [] };

  function hiddenGenderIds(cfg) {
    const hidden = hiddenGenders(cfg);
    if (!hidden.length) return [];
    return genderIdCache.key === hidden.slice().sort().join(",") ? genderIdCache.ids : [];
  }

  async function ensureGenderIds(cfg) {
    const hidden = hiddenGenders(cfg);
    if (!hidden.length) { genderIdCache = { key: "", ids: [] }; return []; }
    const key = hidden.slice().sort().join(",");
    if (genderIdCache.key === key) return genderIdCache.ids;
    const ids = [];
    try {
      for (let page = 1; page <= 40; page += 1) {
        const data = await gql(
          `query StashTokGenderScope($page: Int!) {
            findPerformers(
              filter: { page: $page, per_page: 500 },
              performer_filter: { gender: { value_list: [${hidden.join(", ")}], modifier: INCLUDES } }
            ) { performers { id } }
          }`,
          { page }
        );
        const rows = (data.findPerformers && data.findPerformers.performers) || [];
        rows.forEach((row) => ids.push(row.id));
        if (rows.length < 500) break;
      }
    } catch (err) {
      /* no filter at all is better than an empty feed */
      return [];
    }
    genderIdCache = { key, ids };
    return ids;
  }

  /** Who a feed is restricted to. A feed's own scope always wins; only the root
   *  For You feed falls back to the one set in Settings. */
  function effectivePerformers(spec, cfg) {
    const own = spec && spec.performerScope;
    const rootForyou = (spec.type || "foryou") === "foryou" && (!spec.id || spec.id === "foryou");
    const scope = own && own.mode ? own : rootForyou && cfg ? cfg.foryouPerformers : null;
    if (!scope || !scope.mode || scope.mode === "all") return DEFAULT_PERFORMER_SCOPE;
    /* "filter" with nothing ticked means no restriction, not an empty feed */
    if (scope.mode === "filter" && !(scope.ids || []).length) return DEFAULT_PERFORMER_SCOPE;
    return scope;
  }

  /** the favourites scope needs performer ids, which only arrive by query */
  async function ensurePerformerScope(spec, cfg) {
    if (effectivePerformers(spec, cfg).mode === "favorites") {
      await favouritePerformerIds().catch(() => []);
    }
    /* the scene filter is synchronous and cannot await a performer lookup */
    await ensureGenderIds(cfg).catch(() => []);
  }

  /** Which algorithm axes bias this feed. A custom feed carries its own; the
   *  root For You feed reads the ones set in Settings. */
  function effectiveAlgo(spec, cfg) {
    const own = spec && spec.algo;
    if (own && (own.performers || own.favorites || own.recent)) return own;
    if ((spec.type || "foryou") === "foryou" && cfg && cfg.foryouAlgo) return cfg.foryouAlgo;
    return {};
  }

  function sceneFilterBody(spec, cfg) {
    const parts = [];
    const type = spec.type || "foryou";

    const minDur = spec.minDuration !== undefined ? spec.minDuration : cfg.minDuration;
    if (type !== "shorts" && Number(minDur) > 0) {
      parts.push(`duration: { value: ${Number(minDur)}, modifier: GREATER_THAN }`);
    }
    if (type === "favorites") {
      parts.push(`rating100: { value: 0, modifier: GREATER_THAN }`);
    }
    const windowDays = spec.windowDays !== undefined ? spec.windowDays : cfg.windowDays;
    if (windowDays && Number(windowDays) > 0) {
      const since = new Date(Date.now() - Number(windowDays) * 86400000).toISOString();
      /* "new" means recently added to the library: `date` is the scene's own date
         and is empty for whole libraries (every OnlyFans scene), which made 30 days
         match nothing at all */
      parts.push(`created_at: { value: "${since}", modifier: GREATER_THAN }`);
    }
    if (type === "performer" && spec.performerId) {
      parts.push(`performers: { value: ["${spec.performerId}"], modifier: INCLUDES }`);
    }
    if (type === "fresh") {
      parts.push(`play_count: { value: 0, modifier: EQUALS }`);
    }
    if (type === "shorts") {
      parts.push(`duration: { value: 300, modifier: LESS_THAN }`);
    }
    if (type === "portrait") {
      parts.push(`orientation: { value: [PORTRAIT] }`);
    }
    if (spec.pathIncludes) {
      parts.push(`path: { value: ${JSON.stringify(spec.pathIncludes)}, modifier: INCLUDES }`);
    }
    /* Stash's own path exclusions: one criterion per fragment, chained through
       AND because a filter input can name `path` only once per object. */
    const excl = exclusionClause(spec.excludePaths);
    /* "Show performers" — drop scenes starring a gender the user switched off.
       Shares the AND slot with the path exclusions: a filter object may carry
       `AND` once, so both criteria have to live inside the same one. */
    const hiddenIds = hiddenGenderIds(cfg);
    const genderClause = hiddenIds.length
      ? `performers: { value: [${hiddenIds.map((id) => `"${id}"`).join(",")}], modifier: EXCLUDES }`
      : "";
    if (excl && genderClause) parts.push(`AND: { ${excl}, ${genderClause} }`);
    else if (excl) parts.push(excl);
    else if (genderClause) parts.push(`AND: { ${genderClause} }`);
    const scope = effectivePerformers(spec, cfg);
    if (type !== "performer" && scope.mode !== "all") {
      const ids = scope.mode === "favorites" ? (FAV_PERFORMER_IDS || []) : (scope.ids || []);
      if (ids.length) {
        parts.push(
          `performers: { value: [${ids.map((id) => `"${id}"`).join(",")}], modifier: INCLUDES }`
        );
      }
    }
    /* Performer tags are a different table: a scene carries no such tag, so they
       cannot ride in `tags` (a value there matches nothing, or a same-named scene
       tag, and silently narrows the feed to a lie). `performer_tags` is Stash's
       own criterion for "one of the performers carries this tag". */
    const ptagSel = spec.performerTags || {};
    const ptagIds = (ptagSel.tags || []).filter(Boolean);
    if (ptagIds.length) {
      const modifier = ptagSel.mode === "AND" ? "INCLUDES_ALL" : "INCLUDES";
      parts.push(
        `performer_tags: { value: [${ptagIds.map((id) => `"${id}"`).join(",")}], modifier: ${modifier} }`
      );
    }
    /* The performer's own attributes (ethnicity today) live in `performers_filter`,
       which is a semi-join on the scene's performers and ANDs with everything else:
       "Asian performers AND oil AND big tits" is exactly this pair of clauses. */
    if (spec.performerEthnicity) {
      parts.push(
        `performers_filter: { ethnicity: { value: ${JSON.stringify(spec.performerEthnicity)}, modifier: EQUALS } }`
      );
    }
    const tagSel = effectiveTags(spec, cfg);
    if (tagSel.tags.length) {
      const modifier = tagSel.mode === "AND" ? "INCLUDES_ALL" : "INCLUDES";
      parts.push(
        `tags: { value: [${tagSel.tags.map((id) => `"${id}"`).join(",")}], modifier: ${modifier} }`
      );
    }
    return parts.join(", ");
  }

  /* "exclude these paths", the way Stash's own filter does it: every fragment
     becomes a path EXCLUDES (Stash's own modifier), the extras nest via AND */
  function exclusionClause(list) {
    const frags = (list || []).map((item) => String(item || "").trim()).filter(Boolean);
    if (!frags.length) return "";
    const one = (frag) => `path: { value: ${JSON.stringify(frag)}, modifier: EXCLUDES }`;
    let acc = "";
    for (let i = frags.length - 1; i >= 1; i -= 1) {
      acc = acc ? `AND: { ${one(frags[i])}, ${acc} }` : `AND: { ${one(frags[i])} }`;
    }
    return [one(frags[0]), acc].filter(Boolean).join(", ");
  }

  function sortClause(spec) {
    const sort = spec.sort || (spec.type === "favorites" ? "rating" : "random");
    const direction = spec.direction || "DESC";
    return `sort: "${sort}", direction: ${direction}`;
  }

  /* ---- the shuffle is held for a day, not re-drawn every page -------- *
   * `sort: "random"` re-shuffles the whole library on every request, so page 2
   * used to be a brand-new 8-clip sample (0.13-0.19 s a page on a 158k-scene
   * library) and the order moved under the user. Draw one bounded pool of ids,
   * keep it in localStorage for a day, and serve every page out of it with the
   * top-level `findScenes(ids: [...])` (0.02-0.05 s). A full-library id list is
   * 18-27 s / 2.4 MB, hence the cap: when the pool runs dry another draw is
   * appended, so the feed keeps going without ever re-fetching the library.
   * Re-shuffle bumps POOL_EPOCH, which lands on a different pool key. */
  const POOL_SIZE = 400;
  const POOL_MAX = 4000;
  const POOL_TTL_MS = 24 * 60 * 60 * 1000;
  const POOL_PREFIX = "stashTok.pool.v1:";
  const POOL_EPOCH_KEY = "stashTok.poolEpoch.v1";
  /* the epoch persists, so a reload keeps yesterday's shuffle; only an explicit
     re-shuffle moves it */
  let POOL_EPOCH = (() => {
    try {
      return Number(window.localStorage.getItem(POOL_EPOCH_KEY)) || 0;
    } catch (err) {
      return 0;
    }
  })();

  function reshufflePools() {
    POOL_EPOCH += 1;
    FEED_SHARED.clear();
    FAV_PERFORMER_IDS = null;
    try {
      window.localStorage.setItem(POOL_EPOCH_KEY, String(POOL_EPOCH));
      /* the old draws are dead weight: a reshuffle means a whole new key */
      for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
        const name = window.localStorage.key(i);
        if (name && name.indexOf(POOL_PREFIX) === 0) window.localStorage.removeItem(name);
      }
    } catch (err) {
      /* a blocked storage just means the shuffle is per-session */
    }
  }

  /** only a random order is pooled; an explicit sort is already stable */
  function isPooledSort(spec) {
    const sort = spec.sort || (spec.type === "favorites" ? "rating" : "random");
    return sort === "random";
  }

  function poolKey(spec, cfg) {
    const minDur = spec.minDuration !== undefined ? spec.minDuration : (cfg || {}).minDuration;
    const windowDays = spec.windowDays !== undefined ? spec.windowDays : (cfg || {}).windowDays;
    const text = [
      POOL_EPOCH, spec.type || "foryou", spec.direction || "",
      Number(minDur) || 0, Number(windowDays) || 0, spec.performerId || "",
      spec.pathIncludes || "", effectiveTags(spec, cfg).tags.join(","), spec.tagMode || "",
      ((spec.performerTags || {}).tags || []).join("."), (spec.performerTags || {}).mode || "",
      spec.performerEthnicity || "",
      (() => { const algo = effectiveAlgo(spec, cfg); return ["performers", "favorites", "recent"].filter((k) => algo[k]).join("+"); })(),
      (() => {
        const scope = effectivePerformers(spec, cfg);
        return scope.mode === "all" ? "" : scope.mode + ":" + (scope.mode === "favorites" ? "fav" : (scope.ids || []).join("."));
      })(),
      /* changing "Show performers" must not keep serving the pool drawn under the
         old setting */
      hiddenGenders(cfg).join("+"),
    ].join("|");
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return POOL_PREFIX + hash.toString(36);
  }

  function readPool(key) {
    try {
      const box = JSON.parse(window.localStorage.getItem(key) || "null");
      if (!box || !Array.isArray(box.ids) || !box.ids.length) return null;
      if (!box.at || Date.now() - box.at > POOL_TTL_MS) return null;
      return box;
    } catch (err) {
      return null;
    }
  }

  function writePool(key, box) {
    try {
      /* drop yesterday's pools, or the quota creeps up with every reshuffle */
      for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
        const name = window.localStorage.key(i);
        if (!name || name.indexOf(POOL_PREFIX) !== 0 || name === key) continue;
        if (!readPool(name)) window.localStorage.removeItem(name);
      }
      window.localStorage.setItem(key, JSON.stringify(box));
    } catch (err) {
      /* a full quota just means this page is fetched live, as before */
    }
  }

  /* performers the user favourites are the only "taste" signal a scene filter
     cannot express directly, so they are resolved once into ids */
  let FAV_PERFORMER_IDS = null;
  async function favouritePerformerIds() {
    if (FAV_PERFORMER_IDS) return FAV_PERFORMER_IDS;
    const data = await gql(
      `query StashTokAlgoPerformers {
        findPerformers(performer_filter: { rating100: { value: 80, modifier: GREATER_THAN } },
                       filter: { per_page: 40, sort: "rating", direction: DESC }) { performers { id } }
      }`
    ).catch(() => null);
    FAV_PERFORMER_IDS = ((data && data.findPerformers && data.findPerformers.performers) || []).map((p) => String(p.id));
    return FAV_PERFORMER_IDS;
  }

  /** How a random feed is weighted. Each selected axis gets a slice of the pool
   *  and the rest stays a plain random draw, so the feed still feels shuffled
   *  rather than sorted. */
  async function algoRuns(spec, cfg, body) {
    const algo = effectiveAlgo(spec, cfg);
    const wanted = ["favorites", "performers", "recent"].filter((k) => algo[k]);
    if (!wanted.length) return null;
    const slices = [];
    if (wanted.indexOf("favorites") >= 0) {
      slices.push({ extra: "rating100: { value: 0, modifier: GREATER_THAN }", sort: "random" });
    }
    if (wanted.indexOf("performers") >= 0) {
      const ids = await favouritePerformerIds();
      if (ids.length) {
        slices.push({
          extra: `performers: { value: [${ids.map((id) => `"${id}"`).join(",")}], modifier: INCLUDES }`,
          sort: "random",
        });
      }
    }
    if (wanted.indexOf("recent") >= 0) {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      slices.push({ extra: `created_at: { value: "${since}", modifier: GREATER_THAN }`, sort: "created_at" });
    }
    if (!slices.length) return null;
    const share = Math.round(POOL_SIZE * (slices.length === 1 ? 0.5 : slices.length === 2 ? 0.4 : 0.3));
    const runs = slices.map((slice) => ({
      n: share,
      sort: slice.sort,
      body: [body, slice.extra].filter(Boolean).join(", "),
    }));
    runs.push({ n: Math.max(40, POOL_SIZE - share * slices.length), sort: "random", body });
    return runs;
  }

  async function drawPool(spec, cfg, key, box) {
    const body = sceneFilterBody(spec, cfg);
    const plan = await algoRuns(spec, cfg, body).catch(() => null);
    const runs = plan || [{ n: POOL_SIZE, sort: "random", body }];
    const results = await Promise.all(
      runs.map((run) =>
        gql(
          `query StashTokPool($n: Int!) {
            findScenes(filter: { per_page: $n, sort: "${run.sort}" }${run.body ? `, scene_filter: { ${run.body} }` : ""}) {
              count
              scenes { id }
            }
          }`,
          { n: run.n }
        )
      )
    );
    /* interleave the slices so a weighted feed still alternates instead of
       running its hearted half then its recent half */
    const lists = results.map((data) => (((data || {}).findScenes || {}).scenes || []).slice());
    const found = [];
    let more = true;
    while (more) {
      more = false;
      lists.forEach((list) => {
        const next = list.shift();
        if (next) {
          found.push(next);
          more = true;
        }
      });
    }
    const count = results.reduce((max, data) => Math.max(max, (((data || {}).findScenes || {}).count || 0)), 0);
    const ids = box && box.ids ? box.ids.slice() : [];
    const seen = new Set(ids);
    found.forEach((scene) => {
      const id = String(scene.id);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });
    const next = { at: Date.now(), count, ids };
    writePool(key, next);
    return next;
  }

  /** full scene records for a slice of pooled ids, in the pool's order */
  async function scenesForIds(ids, spec, cfg) {
    if (!ids.length) return [];
    const data = await gql(
      `query StashTokByIds($ids: [ID!]) {
        findScenes(ids: $ids) { scenes { ${SCENE_FIELDS} } }
      }`,
      { ids }
    );
    const scenes = (data.findScenes && data.findScenes.scenes) || [];
    const byId = new Map(scenes.map((scene) => [String(scene.id), scene]));
    return ids
      .map((id) => byId.get(String(id)))
      .filter((scene) => scene && scene.files && scene.files.length && isPlayable(scene) && !isFlagged(scene, cfg))
      .map((scene) => ({ key: "s" + scene.id, scene, startAt: pickStartAt(scene, cfg, spec), endAt: 0 }));
  }

  async function fetchSceneFeedFromPool(spec, cfg, page) {
    const key = poolKey(spec, cfg);
    let box = readPool(key);
    if (!box) box = await drawPool(spec, cfg, key, null);
    const need = Math.max(1, page) * PAGE_SIZE;
    let guard = 0;
    while (box.ids.length < need && box.ids.length < POOL_MAX && guard < 5) {
      const before = box.ids.length;
      box = await drawPool(spec, cfg, key, box);
      guard += 1;
      if (box.ids.length === before) break; /* the draw returned only ids we had */
    }
    let start = (Math.max(1, page) - 1) * PAGE_SIZE;
    let slice = box.ids.slice(start, start + PAGE_SIZE);
    let items = [];
    /* a slice of flagged or missing clips must not read as the end of the feed */
    for (let hop = 0; hop < 3 && slice.length && !items.length; hop += 1) {
      items = await scenesForIds(slice, spec, cfg);
      if (items.length) break;
      start += PAGE_SIZE;
      slice = box.ids.slice(start, start + PAGE_SIZE);
    }
    return { count: box.count || 0, items };
  }

  async function fetchSceneFeed(spec, cfg, page) {
    await ensurePerformerScope(spec, cfg);
    if (isPooledSort(spec)) {
      try {
        return await fetchSceneFeedFromPool(spec, cfg, page);
      } catch (err) {
        /* a pool problem must not kill the feed: fall through to the live query */
      }
    }
    const body = sceneFilterBody(spec, cfg);
    const filterArg = body ? `, scene_filter: { ${body} }` : "";
    const query = `query StashTokScenes($n: Int!, $page: Int!) {
      findScenes(filter: { per_page: $n, page: $page, ${sortClause(spec)} }${filterArg}) {
        count
        scenes { ${SCENE_FIELDS} }
      }
    }`;
    const data = await gql(query, { n: PAGE_SIZE, page });
    const scenes = (data.findScenes && data.findScenes.scenes) || [];
    return {
      count: (data.findScenes && data.findScenes.count) || 0,
      items: scenes
        .filter((scene) => scene.files && scene.files.length && isPlayable(scene) && !isFlagged(scene, cfg))
        .map((scene) => ({ key: "s" + scene.id, scene, startAt: pickStartAt(scene, cfg, spec), endAt: 0 })),
    };
  }

  async function fetchSceneById(spec) {
    const data = await gql(
      `query StashTokSceneById($id: ID!) { findScene(id: $id) { ${SCENE_FIELDS} } }`,
      { id: spec.sceneId }
    );
    const scene = data.findScene;
    if (!scene) return { count: 0, items: [] };
    // a remembered clip whose file has gone missing must not strand the feed
    if (!scene.files || !scene.files.length) return { count: 0, items: [] };
    return { count: 1, items: [{ key: "s" + scene.id, scene, startAt: Number(spec.startAt) || 0, endAt: 0 }] };
  }

  async function fetchMarkerFeed(spec, cfg, page) {
    await ensurePerformerScope(spec, cfg);
    const body = sceneFilterBody(spec, cfg);
    const sceneFilterArg = body ? `scene_filter: { ${body} }` : "";
    /* `tags` on a marker filter is the marker's own (primary) tag, but it is a
       HierarchicalMultiCriterionInput — a bare array of ids is a validation
       error, and the whole query failing is why a tag feed used to come back
       empty. */
    const markerTagArg = spec.markerTagId
      ? `tags: { value: [${JSON.stringify(String(spec.markerTagId))}], modifier: INCLUDES }`
      : "";
    /* A marker NAME is its own feed: every marker Stash calls the same thing,
       in whatever scenes they live in. This Stash has no title criterion on
       SceneMarkerFilterType, so the name rides on the find filter's `q` and is
       matched exactly in the client below. */
    const markerFilterArg = [markerTagArg, sceneFilterArg].filter(Boolean).join(", ");
    const findArg = `per_page: $n, page: $page, sort: "${spec.markerTagId ? "title" : "random"}"` +
      (spec.markerTitle ? `, q: ${JSON.stringify(spec.markerTitle)}` : "");
    const query = `query StashTokMarkers($n: Int!, $page: Int!) {
      findSceneMarkers(
        filter: { ${findArg} }
        scene_marker_filter: { ${markerFilterArg} }
      ) {
        count
        scene_markers {
          id
          title
          seconds
          end_seconds
          primary_tag { id name }
          scene { ${SCENE_FIELDS} }
        }
      }
    }`;
    const data = await gql(query, { n: PAGE_SIZE, page });
    const wanted = spec.markerTitle ? String(spec.markerTitle).trim().toLowerCase() : "";
    const markers = ((data.findSceneMarkers && data.findSceneMarkers.scene_markers) || []).filter(
      (marker) => !wanted || String(marker.title || "").trim().toLowerCase() === wanted
    );
    return {
      count: (data.findSceneMarkers && data.findSceneMarkers.count) || 0,
      items: markers
        .filter(
          (marker) =>
            marker.scene &&
            marker.scene.files &&
            marker.scene.files.length &&
            isPlayable(marker.scene) &&
            !isFlagged(marker.scene, cfg)
        )
        .map((marker) => ({
          key: "m" + marker.id,
          scene: marker.scene,
          startAt: Number(marker.seconds) || 0,
          endAt: Number(marker.end_seconds) || 0,
          marker,
        })),
    };
  }

  async function fetchSavedFilterFeed(spec, cfg, page) {
    const data = await gql(
      `query StashTokSavedFilter($id: ID!) {
        findSavedFilter(id: $id) { id name find_filter object_filter }
      }`,
      { id: spec.savedFilterId }
    );
    const saved = data.findSavedFilter;
    if (!saved) throw new Error("Saved filter not found");
    const findFilter = Object.assign(JSON.parse(saved.find_filter || "{}"), {
      per_page: PAGE_SIZE,
      page,
    });
    const objectFilter = JSON.parse(saved.object_filter || "{}");
    const data2 = await gql(
      `query StashTokSavedScenes($filter: FindFilterType, $scene: SceneFilterType) {
        findScenes(filter: $filter, scene_filter: $scene) {
          count
          scenes { ${SCENE_FIELDS} }
        }
      }`,
      { filter: findFilter, scene: objectFilter }
    );
    const scenes = (data2.findScenes && data2.findScenes.scenes) || [];
    return {
      count: (data2.findScenes && data2.findScenes.count) || 0,
      items: scenes
        .filter((scene) => scene.files && scene.files.length && isPlayable(scene) && !isFlagged(scene, cfg))
        .map((scene) => ({ key: "s" + scene.id, scene, startAt: pickStartAt(scene, cfg, spec), endAt: 0 })),
    };
  }


  /* ---- routing ----------------------------------------------------- */

  function baseRoot() {
    const match = window.location.pathname.match(/^(.*?\/(?:stashtok|stash-tok))(\/|$)/);
    return match ? match[1] : ROUTE;
  }

  /* ---- links into Stash's own UI ----------------------------------- *
   * The plugin is injected into Stash, so the origin is the instance the
   * user is already logged into: a relative link needs no other config. */
  function stashUrl(path) {
    return window.location.origin + path;
  }

  /** Stash keeps list filters in the URL as `c=` criteria: JSON with braces
   *  outside strings swapped for parens, then URI-encoded, then the query
   *  reserved characters escaped (ListFilterModel.getEncodedParams). */
  function encodeStashCriterion(criterion) {
    let out = "";
    let inString = false;
    let escaped = false;
    for (const ch of JSON.stringify(criterion)) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\" && inString) {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString && ch === "{") {
        out += "(";
        continue;
      } else if (!inString && ch === "}") {
        out += ")";
        continue;
      }
      out += ch;
    }
    return encodeURI(out)
      .replace(/\?/g, "%3F")
      .replace(/#/g, "%23")
      .replace(/&/g, "%26")
      .replace(/;/g, "%3B")
      .replace(/=/g, "%3D")
      .replace(/\+/g, "%2B");
  }

  /** The same page in Stash: the performer record, or — for a folder profile —
   *  the scene list narrowed to that folder with the `path` criterion, which is
   *  exactly how this page queries it. */
  function stashHref(spec) {
    if (!spec) return "";
    if (spec.folder) {
      const criterion = { type: "path", modifier: "INCLUDES", value: String(spec.folder) };
      return stashUrl("/scenes?c=" + encodeStashCriterion(criterion));
    }
    if (!spec.performerId) return "";
    return stashUrl("/performers/" + encodeURIComponent(spec.performerId));
  }

  /* the clip on screen, so a route written by the feed is not mistaken for a navigation */
  const clipState = { sceneId: null };

  function currentRoute() {
    return window.location.hash.replace(/^#\/?/, "");
  }

  let NAV_DEPTH = 0;
  window.addEventListener("popstate", () => {
    if (NAV_DEPTH > 0) NAV_DEPTH -= 1;
  });

  function goTo(path, replace) {
    const clean = String(path || "").replace(/^\/+/, "");
    const next = clean ? "#/" + clean : "#/";
    if (window.location.hash === next) return;
    if (replace) window.history.replaceState({}, "", baseRoot() + next);
    else {
      NAV_DEPTH += 1;
      window.location.hash = next;
    }
  }

  /* The grid already knows the order the user is looking at. Asking Stash for
     "filesize DESC" a second time is what made a swipe land on a video that was
     nowhere near the one that had been tapped (the profile can be sorted ASC, or
     with favourites pinned, or filtered to one folder). This fetches exactly the
     ids that were on screen, in that order, and nothing else. */
  async function fetchSceneOrder(spec, cfg) {
    const ids = (spec.orderIds || []).map((id) => String(id));
    const out = [];
    for (let at = 0; at < ids.length; at += 100) {
      const chunk = ids.slice(at, at + 100);
      const data = await gql(
        `query StashTokSceneOrder($ids: [ID!]!) { findScenes(ids: $ids) { scenes { ${SCENE_FIELDS} } } }`,
        { ids: chunk }
      );
      const rows = (data.findScenes && data.findScenes.scenes) || [];
      const byId = {};
      rows.forEach((row) => {
        byId[String(row.id)] = row;
      });
      chunk.forEach((id) => {
        const scene = byId[id];
        if (scene) out.push(scene);
      });
    }
    return {
      count: out.length,
      items: out
        .filter((scene) => scene.files && scene.files.length && isPlayable(scene) && !isFlagged(scene, cfg))
        .map((scene) => ({ key: "s" + scene.id, scene, startAt: pickStartAt(scene, cfg, spec), endAt: 0 })),
    };
  }

  function fetchFeedPage(spec, cfg, page) {
    if (spec.orderIds && spec.orderIds.length) return fetchSceneOrder(spec, cfg);
    if (spec.type === "scene") return fetchSceneById(spec);
    if (spec.type === "markers") return fetchMarkerFeed(spec, cfg, page);
    if (spec.type === "saved") return fetchSavedFilterFeed(spec, cfg, page);
    if (spec.type === "foryou" && cfg.source === "markers") {
      return fetchMarkerFeed(spec, cfg, page);
    }
    return fetchSceneFeed(spec, cfg, page);
  }

  async function setSceneRating(sceneId, rating) {
    const data = await gql(
      `mutation StashTokRate($id: ID!, $rating: Int) {
        sceneUpdate(input: { id: $id, rating100: $rating }) { id rating100 }
      }`,
      { id: sceneId, rating: rating == null ? null : Math.round(rating) }
    );
    return data.sceneUpdate;
  }

  async function setImageRating(imageId, rating) {
    const data = await gql(
      `mutation StashTokRateImage($id: ID!, $rating: Int) {
        imageUpdate(input: { id: $id, rating100: $rating }) { id rating100 }
      }`,
      { id: imageId, rating: rating == null ? null : Math.round(rating) }
    );
    return data.imageUpdate;
  }

  async function fetchTagOptions(limit) {
    const data = await gql(
      `query StashTokTagOptions($n: Int!) {
        findTags(filter: { per_page: $n, sort: "scenes_count", direction: DESC }) {
          tags { id name scene_count }
        }
      }`,
      { n: limit || 250 }
    );
    return (data.findTags && data.findTags.tags) || [];
  }

  async function addSceneTags(sceneId, tagIds) {
    if (!tagIds.length) return null;
    const data = await gql(
      `mutation StashTokAddTags($id: ID!, $tags: [ID!]!) {
        bulkSceneUpdate(input: { ids: [$id], tag_ids: { ids: $tags, mode: ADD } }) { id }
      }`,
      { id: sceneId, tags: tagIds.map(String) }
    );
    return data.bulkSceneUpdate;
  }

  async function addPerformerTags(performerId, tagIds) {
    if (!performerId || !tagIds.length) return null;
    const data = await gql(
      `mutation StashTokAddPerformerTags($id: ID!, $tags: [ID!]!) {
        bulkPerformerUpdate(input: { ids: [$id], tag_ids: { ids: $tags, mode: ADD } }) { id }
      }`,
      { id: performerId, tags: tagIds.map(String) }
    );
    return data.bulkPerformerUpdate;
  }

  /* undo is only safe for tags this sheet actually added: removal takes exact
     ids, so a tag the scene already had must never be in the list */
  async function removeSceneTags(sceneId, tagIds) {
    if (!sceneId || !tagIds.length) return null;
    const data = await gql(
      `mutation StashTokRemoveTags($id: ID!, $tags: [ID!]!) {
        bulkSceneUpdate(input: { ids: [$id], tag_ids: { ids: $tags, mode: REMOVE } }) { id }
      }`,
      { id: sceneId, tags: tagIds.map(String) }
    );
    return data.bulkSceneUpdate;
  }

  async function removePerformerTags(performerId, tagIds) {
    if (!performerId || !tagIds.length) return null;
    const data = await gql(
      `mutation StashTokRemovePerformerTags($id: ID!, $tags: [ID!]!) {
        bulkPerformerUpdate(input: { ids: [$id], tag_ids: { ids: $tags, mode: REMOVE } }) { id }
      }`,
      { id: performerId, tags: tagIds.map(String) }
    );
    return data.bulkPerformerUpdate;
  }

  async function performerTagIds(performerId) {
    if (!performerId) return [];
    const data = await gql(`query StashTokPerformerTags($id: ID!) { findPerformer(id: $id) { id tags { id } } }`, { id: performerId });
    const found = data.findPerformer;
    return ((found && found.tags) || []).map((tag) => String(tag.id));
  }

  /* ---- tag schema ---------------------------------------------------- *
     One taxonomy for every tagging surface: the scene sheet, the marker sheet
     and the performer's body-tag panel all read these lists, so a tag cannot
     mean one thing here and something else there.

     Order is deliberate. Ethnicity and Category describe the person and the
     production, Content Format and Body are flat multi-selects, and Positions
     and Fetish are in popularity order — the first eight carry most of the
     tagging, the rest reveal eight at a time. */
  const ETHNICITY_TAGS = [
    { name: "Asian", performer: ["Asian"], scene: ["Asian"] },
    /* Black and Ebony travel together: the library tags both on a black scene */
    { name: "Ebony", performer: ["Black", "Ebony"], scene: ["Black", "Ebony"] },
    { name: "Latina", performer: ["Latina"], scene: ["Latina"] },
    { name: "White", performer: ["White"], scene: ["White"] },
    { name: "Middle Eastern", performer: ["Middle Eastern"], scene: ["Middle Eastern"] },
    { name: "Indian", performer: ["Indian"], scene: ["Indian"] },
  ];

  /* Category is the one mutually exclusive pair, and each parent owns a drawer
     of children: picking a child implies its parent, switching parents clears
     the other parent's children so an orphan tag can never be saved. */
  const CATEGORY_TAGS = {
    Solo: ["Striptease", "Toys", "Shower"],
    Sextape: ["BG", "GG", "Group", "Cuckold"],
  };
  const CATEGORY_PARENTS = Object.keys(CATEGORY_TAGS);

  const CONTENT_TAGS = ["Full Scene", "Short Clip", "Livestream", "Compilation"];
  const BODY_TAGS = ["Big Tits", "Big Ass", "Curvy", "Petite", "Fit / Athletic"];

  const POSITION_TAGS = [
    "Doggy Style", "Missionary", "Cowgirl", "Reverse Cowgirl", "Blowjob", "Anal", "Facial", "Cumshot",
    "Prone Bone", "Standing", "Titfuck", "Handjob", "Deepthroat", "69", "Spooning", "Squirting",
    "Double Penetration", "Piledriver",
  ];
  const FETISH_TAGS = [
    "BDSM", "Bondage", "Choking", "Domination", "Submission", "Roleplay", "Foot Fetish", "Interracial",
    "BBC", "Femdom", "Spanking", "Exhibitionism", "Voyeur", "Blindfold", "Latex", "Leather",
    "Collar", "Face Slapping", "Raceplay",
  ];

  /* Hidden for now: the caption's hashtag strip on the player. A clip's tags are
     something to check and edit, not something to read while watching, and the
     rail's add-tag button is the one place that shows them. Flip this back to
     true to return the strip. */
  const SHOW_CAPTION_TAGS = false;

  /* the section order is the order the sheet draws them in */
  const TAG_SHEET_SECTIONS = [
    { id: "ethnicity", title: "Ethnicity", tags: ETHNICITY_TAGS.map((eth) => eth.name) },
    { id: "category", title: "Category", parents: CATEGORY_PARENTS, children: CATEGORY_TAGS },
    { id: "content", title: "Content Format", tags: CONTENT_TAGS },
    { id: "body", title: "Body", tags: BODY_TAGS },
    { id: "positions", title: "Positions & Acts", tags: POSITION_TAGS, paged: true },
    { id: "fetish", title: "Fetish Tags", tags: FETISH_TAGS, paged: true },
  ];
  /* how many chips a paged section shows before "+ N more" */
  const TAG_PAGE = 8;

  const TAG_VOCABULARY = TAG_SHEET_SECTIONS.reduce((all, section) => {
    if (section.parents) {
      return all.concat(section.parents).concat(
        section.parents.reduce((kids, parent) => kids.concat(section.children[parent]), [])
      );
    }
    return all.concat(section.tags);
  }, []);

  /* A marker is named by one tag and is drawn from the same section list as the
     add-tag sheet, minus the sections that describe a person rather than a
     moment: no ethnicity, no body. */
  const MARKER_TAG_SECTIONS = TAG_SHEET_SECTIONS.filter(
    (section) => section.id !== "ethnicity" && section.id !== "body"
  );
  const MARKER_TAG_NAMES = MARKER_TAG_SECTIONS.reduce((all, section) => {
    if (section.parents) {
      return all.concat(section.parents).concat(
        section.parents.reduce((kids, parent) => kids.concat(section.children[parent]), [])
      );
    }
    return all.concat(section.tags);
  }, []);

  /* Attributes belong to a person, not a clip: they are the tags the performer
     page may push across every scene of a performer. Ebony carries its scene
     pair (Black + Ebony), which is why an attribute is a list of tags rather
     than a single name. */
  const SYNC_ATTRS = ETHNICITY_TAGS.map((eth) => ({
    name: eth.name,
    kind: "Ethnicity",
    tags: eth.scene.slice(),
  })).concat(BODY_TAGS.map((name) => ({ name, kind: "Body", tags: [name] })));

  /* one request resolves the whole vocabulary: aliased findTags per name, exact
     case-insensitive match. Tags the library has never seen resolve to null and
     are created only when the user actually picks them. */
  async function resolveTagNames(names) {
    const list = Array.from(new Set((names || []).map((n) => String(n).trim()).filter(Boolean)));
    const out = {};
    if (!list.length) return out;
    const body = list
      .map((name, i) => `t${i}: findTags(filter: { q: ${JSON.stringify(name)}, per_page: 10 }) { tags { id name } }`)
      .join(" ");
    const data = await gql(`query StashTokTagVocabulary { ${body} }`);
    list.forEach((name, i) => {
      const rows = (data["t" + i] && data["t" + i].tags) || [];
      const hit = rows.find((tag) => String(tag.name).trim().toLowerCase() === name.toLowerCase());
      out[name] = hit ? String(hit.id) : null;
    });
    return out;
  }

  async function ensureTagId(name, cache) {
    const key = String(name).trim().toLowerCase();
    if (cache[key]) return cache[key];
    try {
      const data = await gql(
        `mutation StashTokMakeTag($name: String!) { tagCreate(input: { name: $name }) { id name } }`,
        { name: String(name).trim() }
      );
      cache[key] = String(data.tagCreate.id);
    } catch (err) {
      /* Stash treats names case-insensitively on create, so a duplicate throws:
         look the existing one up instead of failing the tap */
      const found = await resolveTagNames([name]);
      if (!found[name]) throw err;
      cache[key] = found[name];
    }
    return cache[key];
  }

  /* ---- free text → tags ---------------------------------------------- *
     Typing is the fast path: "oil, outside, tv" is three tags, and one the
     library has never seen is created on the spot. Casing is normalised to
     Title Case because tag names are read by eye in the feed, but an existing
     tag always wins the lookup, so typing "bbc" lands on "BBC" instead of
     spawning "Bbc". */
  const TAG_ACRONYMS = {
    tv: "TV", vr: "VR", pov: "POV", dp: "DP", bbc: "BBC", bbw: "BBW",
    bdsm: "BDSM", milf: "MILF", gilf: "GILF", hd: "HD", ai: "AI", of: "OF",
  };

  function titleTagName(raw) {
    const words = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().split(" ");
    return words
      .filter(Boolean)
      .map((word) => {
        const lower = word.toLowerCase();
        if (TAG_ACRONYMS[lower]) return TAG_ACRONYMS[lower];
        /* anything the user capitalised on purpose keeps its shape: "iPhone"
           must not come back as "Iphone" */
        if (/[A-Z]/.test(word.slice(1))) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ")
      /* a word that is only punctuation is not a tag: it arrived from a stray
         separator, and creating "Oil," as a tag name would be a mess to undo.
         Only the edges are trimmed — inner hyphens and apostrophes are part of
         real names. */
      .replace(/^[^A-Za-z0-9]+/, "")
      .replace(/[^A-Za-z0-9)]+$/, "");
  }

  /* one typed string is a list: commas (typed or pasted, with or without a
     trailing space) and newlines both separate tags */
  function splitTagInput(text) {
    const seen = {};
    return String(text == null ? "" : text)
      .split(/[,\n]/)
      .map((chunk) => titleTagName(chunk))
      .filter((name) => {
        if (!name) return false;
        const key = name.toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  /* autocomplete source: the library's own tags, best-used first. The client
     filter is case-insensitive anywhere in the name, so "tits" finds both
     "Big Tits" and "Natural Tits". */
  async function searchTagNames(q, limit) {
    const query = String(q == null ? "" : q).trim();
    if (!query) return [];
    const data = await gql(
      `query StashTokTagSuggest($q: String!, $n: Int!) {
        findTags(filter: { q: $q, per_page: $n, sort: "scenes_count", direction: DESC },
                 tag_filter: { name: { value: $q, modifier: INCLUDES } }) {
          tags { id name scene_count }
        }
      }`,
      { q: query, n: limit || 12 }
    );
    return (data.findTags && data.findTags.tags) || [];
  }

  /* Ethnicity thumbnails: the named performer first, else the best-known
     performer with that ethnicity that has a photo. */
  async function fetchEthnicityThumbs() {
    const named = ETHNICITY_TAGS.filter((eth) => eth.thumb);
    const body = []
      .concat(
        named.map((eth, i) => `n${i}: findPerformers(filter: { q: ${JSON.stringify(eth.thumb)}, per_page: 10 }) { performers { id name image_path } }`),
        ETHNICITY_TAGS.map((eth, i) => `e${i}: findPerformers(performer_filter: { ethnicity: { value: ${JSON.stringify(eth.ethnicity)}, modifier: EQUALS } }, filter: { per_page: 6, sort: "scenes_count", direction: DESC }) { performers { id name image_path } }`)
      )
      .join(" ");
    const data = await gql(`query StashTokEthnicityThumbs { ${body} }`);
    const out = {};
    ETHNICITY_TAGS.forEach((eth, i) => {
      const byName = named.indexOf(eth);
      let hit = null;
      if (byName >= 0) {
        const rows = (data["n" + byName] && data["n" + byName].performers) || [];
        const want = eth.thumb.trim().toLowerCase();
        hit = rows.find((row) => String(row.name).trim().toLowerCase() === want) || null;
      }
      if (!hit) {
        const rows = (data["e" + i] && data["e" + i].performers) || [];
        hit = rows.find((row) => row.image_path) || null;
      }
      out[eth.name] = hit ? { name: hit.name, src: hit.image_path ? rel(hit.image_path) : "" } : null;
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* settings + feeds                                                   */
  /* ------------------------------------------------------------------ */

  function pluginSettingsFrom(settings) {
    const plugins = (settings && settings.plugins) || {};
    return plugins[PLUGIN_ID] || plugins.StashTok || {};
  }

  function readConfig(settings) {
    const raw = pluginSettingsFrom(settings);
    return {
      source: raw.source === "markers" ? "markers" : "scenes",
      heartRating: Number(raw.heartRating) || 80,
      blurBackdrop: raw.blurBackdrop === true,
      showMarkerTicks: raw.showMarkerTicks !== false,
      holdSpeed: clamp(Number(raw.holdSpeed) || 2, 1, 8),
      autoplayMuted: raw.autoplayMuted !== false,
      randomStart: raw.randomStart !== false,
      longSceneSeconds: Number(raw.longSceneSeconds) || 300,
      flagTag: raw.flagTag || "stashtok-delete",
      doubleTapHeart: raw.doubleTapHeart !== false,
      sfw: raw.sfw === true,
      // 10s keeps 2-second clips out without cutting whole folders
      minDuration: raw.minDuration == null ? 10 : Number(raw.minDuration),
      /* "" = auto-guess from the port, "off" = always use Stash's own images */
      thumbBase: typeof raw.thumbBase === "string" ? raw.thumbBase : "",
      /* written by the setup wizard: this *server* has been configured */
      setupDone: raw.setupDone === true,
      /* any key at all means somebody has been here before: an upgraded
         installation must not be handed the first-run wizard */
      serverConfigured: Object.keys(raw || {}).length > 0,
    };
  }

  /* ---- per-server configuration ------------------------------------- *
   * Everything in stashTok.yml belongs to one Stash instance: a second
   * server starts with an empty map and falls back to the coded defaults.
   * These two helpers are how the setup wizard reads and writes it.
   * configurePlugin REPLACES the plugin's whole map, so always send the
   * current one merged with the changes, never just the changes.        */

  async function readServerSettings() {
    const data = await gql("{ configuration { plugins } }");
    return pluginSettingsFrom(data && data.configuration) || {};
  }

  async function writeServerSettings(changes) {
    const current = await readServerSettings();
    const next = Object.assign({}, current, changes);
    await gql(
      `mutation StashTokConfigure($id: ID!, $in: Map!) {
        configurePlugin(plugin_id: $id, input: $in)
      }`,
      { id: PLUGIN_ID, in: next }
    );
    return next;
  }

  function defaultFeed() {
    return { id: "foryou", name: "For You", type: "foryou", sort: "random" };
  }

  function loadFeeds() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FEEDS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((f) => f && f.type) : [];
    } catch (e) {
      return [];
    }
  }

  /* Leaving a feed (tap a performer, open search) must not cost the user their place:
     remember the clip and the playhead for an hour, and reopen there. */
  const WATCH_HISTORY_KEY = "stashTok.watchHistory.v1";
  const PLAYBACK_LOG_KEY = "stashTok.playbackLog.v1";

  function readLocalList(key) {
    try {
      const rows = JSON.parse(window.localStorage.getItem(key) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      return [];
    }
  }

  function writeLocalList(key, rows) {
    try {
      window.localStorage.setItem(key, JSON.stringify(rows));
    } catch (error) {
      // Private browsing and a full quota can prevent persistence.
    }
  }

  function recordPlayback(event, video, elapsed) {
    const quality = video.getVideoPlaybackQuality?.();
    const entry = { event, at: Date.now(), elapsedMs: Math.round(elapsed),
      width: video.videoWidth, height: video.videoHeight,
      frames: quality?.totalVideoFrames ?? video.webkitDecodedFrameCount ?? null,
      dropped: quality?.droppedVideoFrames ?? video.webkitDroppedFrameCount ?? null,
      errorCode: video.error?.code ?? null };
    writeLocalList(PLAYBACK_LOG_KEY, [...readLocalList(PLAYBACK_LOG_KEY).slice(-199), entry]);
  }

  function playbackReport() {
    return JSON.stringify({ version: 1, events: readLocalList(PLAYBACK_LOG_KEY) }, null, 2);
  }

  function downloadPlaybackReport() {
    const url = URL.createObjectURL(new Blob([playbackReport()], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "stashtok-playback.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const RESUME_KEY = "stashTok.resume.v1";
  const RESUME_VERSIONS = new Map();
  const RESUME_TTL_MS = 60 * 60 * 1000;

  /* The resume map is read on every clip advance and written on every clip
     advance. Both used to hit localStorage: two JSON parses plus a synchronous,
     disk-backed setItem right when the next video element is being swapped in.
     Keep the map in memory and flush it once the user settles. */
  let RESUME_CACHE = null;
  let RESUME_FLUSH = 0;

  function feedResumeKey(spec) {
    return String(spec.key || spec.id || (spec.type + ":" + (spec.name || spec.sort || "")));
  }

  function readResumeMap() {
    if (RESUME_CACHE) return RESUME_CACHE;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RESUME_KEY) || "{}");
      RESUME_CACHE = parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      RESUME_CACHE = {};
    }
    return RESUME_CACHE;
  }

  function flushResume() {
    RESUME_FLUSH = 0;
    if (!RESUME_CACHE) return;
    try {
      window.localStorage.setItem(RESUME_KEY, JSON.stringify(RESUME_CACHE));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  function writeResume(key, sceneId, time) {
    const map = readResumeMap();
    map[key] = { sceneId, time: Number(time) || 0, at: Date.now() };
    if (!RESUME_FLUSH) RESUME_FLUSH = window.setTimeout(flushResume, 400);
  }

  if (typeof window !== "undefined" && window.addEventListener) {
    /* a tab closed inside the debounce window must still remember its seat */
    window.addEventListener("pagehide", flushResume);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flushResume();
    });
  }

  function readResume(key) {
    const row = readResumeMap()[key];
    if (!row || !row.sceneId) return null;
    if (Date.now() - (row.at || 0) > RESUME_TTL_MS) return null;
    return row;
  }

  /** A chosen sort sticks for the page it was chosen on, then lapses after a day. */
  const SORT_TTL_MS = 24 * 60 * 60 * 1000;

  function readSortPref(key, fallback) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(key) || "null");
      if (!raw || typeof raw.at !== "number") return fallback;
      if (Date.now() - raw.at > SORT_TTL_MS) {
        window.localStorage.removeItem(key);
        return fallback;
      }
      return raw.value === undefined || raw.value === null ? fallback : raw.value;
    } catch (e) {
      return fallback;
    }
  }

  /* Unlike readSortPref, these do not expire: a sort choice is a habit, and the
     profile page is rebuilt every time you come back from a clip -- an expiring
     value is exactly what made "back" land on a different order than the grid. */
  function readPinned(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined || raw === "") return fallback;
      const parsed = JSON.parse(raw);
      if (parsed === null || parsed === undefined) return fallback;
      /* earlier builds stored {value, at} here; keep reading those */
      if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "value")) {
        return parsed.value === null || parsed.value === undefined ? fallback : parsed.value;
      }
      return parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writePinned(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  function writeSortPref(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify({ value, at: Date.now() }));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  /** /O/username/videos/sub — the path as the filesystem sees it, minus the library root */
  function prettyPath(full) {
    const raw = String(full || "");
    if (!raw) return "";
    const dir = raw.slice(0, raw.lastIndexOf("/"));
    return dir.replace(/^\/data(?=\/)/, "") || dir;
  }

  /* The folder a performer lives in, as the user thinks of it: the segment that
     names them, not the download subfolder below it. /Onlyfans/<name>/mega/videos
     and /Onlyfans/<name>/coomer both come back as /Onlyfans/<name>, which is the one
     path that stays right no matter which subfolder a clip came from. */
  function performerRoot(path, name) {
    const parts = String(path || "").replace(/^\/data(?=\/)/, "").split("/").filter(Boolean);
    const want = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!want) return "";
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (parts[i].toLowerCase().replace(/[^a-z0-9]/g, "") === want) return "/" + parts.slice(0, i + 1).join("/");
    }
    return "";
  }

  function shortDate(value) {
    const raw = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  }

  /* in-app preferences (the plugin's own config lives in Stash's settings page) */
  const PREFS_KEY = "stashTok.prefs.v1";
  /* did this device already have prefs before this build loaded? the merged
     defaults look identical to a first run, so the stored key is the only tell */
  let PREFS_SEEN = false;
  const PREF_DEFAULTS = {
    performerSort: "filesize",
    performerImages: true,
    performerMarkers: true,
    foldersOnTop: true,
    showPath: false,
    /* portrait framing: on unless turned off in Settings */
    autoCrop: true,
    /* sideways drag on the video seeks the clip. Off by default: a horizontal
       drag is how a thumb slips while swiping, and the seek it caused read as the
       clip jumping on its own. The scrub bar is opened by tapping the caption. */
    dragScrub: false,
    /* double tap the left/right stripe of the stage to seek ∓5 s, the phone's
       arrow keys. On by default; the centre still steps the crop. */
    edgeSeek: true,
    mono: false,
    /* hover a grid tile to play its file: off by default — it streams the real
       scene and seeks every second, which is real work for a decoration */
    hoverPreview: false,
    favoritesSort: "updated_at",
    favoritesOpen: "gallery",
    feedWindow: "all",
    /* Your Feeds → For You: tag narrowing plus the algorithm axes that bias a
       random feed towards what this library already knows about the user */
    foryouTags: [],
    foryouTagMode: "OR",
    /* who For You draws from: every performer, only the ones you favourite, or
       a hand-picked list { mode: "all"|"favorites"|"filter", ids: [] } */
    foryouPerformers: { mode: "all", ids: [] },
    /* which performer genders the app shows at all. Empty = every gender, so a
       library that never set a gender on anyone is not filtered into nothing */
    genders: [],
    favoriteTags: [],
    favoritesAlgo: {},
    folderView: "list",
    /* the gear in the feed's top bar: the settings page is one tap away from the
       feed, and this is the switch that hides it again for a cleaner stage */
    topSettings: true,
    /* Feed is fixed on the far left, then four slots:
       Feed | Discover | Performers | Favorites | Settings */
    navSlots: ["discover", "performers", "favorites", "settings"],
    /* set by the setup wizard: this device has finished (or skipped) setup */
    setupDone: false,
  };

  /* one-time: earlier builds stored a sort per performer, which kept resurrecting
     "recently added" on pages the user had opened before. Drop them. */
  const SORT_PURGE_KEY = "stashTok.sortReset.v3";
  try {
    if (!window.localStorage.getItem(SORT_PURGE_KEY)) {
      Object.keys(window.localStorage)
        .filter((key) => /^stashTok\.perfSort/.test(key))
        .forEach((key) => window.localStorage.removeItem(key));
      window.localStorage.setItem(SORT_PURGE_KEY, "1");
    }
  } catch (e) {
    /* ignore */
  }

  function loadPrefs() {
    return migratePrefs();
  }

  /* older builds saved performerSort: "updated_at" on its own, which then beat the
     default forever on the user's device. One-time: drop that override. */
  function migratePrefs() {
    let parsed = {};
    try {
      const stored = window.localStorage.getItem(PREFS_KEY);
      /* an upgrade keeps every device's existing prefs, so the presence of the
         key is what tells a returning user from a first-run one — the merged
         defaults alone would look identical */
      if (stored) PREFS_SEEN = true;
      parsed = JSON.parse(stored || "{}") || {};
    } catch (e) {
      parsed = {};
    }
    const merged = Object.assign({}, PREF_DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
    if (merged.sortDefaultsV !== 2) {
      merged.performerSort = "filesize";
      merged.sortDefaultsV = 2;
      savePrefs(merged);
    }
    /* bottom bar: Feed first, then Discover / Performers / Favorites / Settings */
    if (merged.navDefaultsV !== 4) {
      merged.navSlots = DEFAULT_NAV_SLOTS.slice();
      merged.navDefaultsV = 4;
      savePrefs(merged);
    }
    /* Markers belong to the sidebar next to Tags now that they can be created
       from the player. A slot list that has tags but no markers gains one right
       after tags; the bar is flex, so five slots just tighten rather than break. */
    if (merged.navMarkerV !== 1) {
      const slots = (Array.isArray(merged.navSlots) ? merged.navSlots : DEFAULT_NAV_SLOTS.slice()).slice();
      if (!slots.includes("markers")) {
        const at = slots.indexOf("tags");
        if (at >= 0) slots.splice(at + 1, 0, "markers");
        else slots.push("markers");
      }
      merged.navSlots = slots;
      merged.navMarkerV = 1;
      savePrefs(merged);
    }
    /* hover previews shipped on by default for one build; the preview stream
       blanks the poster and returns nothing on libraries without generated
       previews, so every device gets one forced reset to off. */
    if (merged.hoverDefaultsV !== 1) {
      merged.hoverPreview = false;
      merged.hoverDefaultsV = 1;
      savePrefs(merged);
    }
    return merged;
  }

  function savePrefs(prefs) {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  /** one popover for every sort control: same shape, different options */
  function sortMenuTree({ options, value, onPick, onClose, favorite }) {
    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-pop-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-pop", role: "menu" },
        favorite &&
          h(
            "button",
            {
              className: "stk-pop-toggle" + (favorite.on ? " stk-on" : ""),
              role: "menuitemcheckbox",
              "aria-checked": !!favorite.on,
              onClick: favorite.onToggle,
            },
            h("span", null, favorite.label || "Favorites first"),
            h("span", { className: "stk-pop-check" }, favorite.on ? "✓" : "")
          ),
        favorite && h("div", { className: "stk-pop-sep" }),
        options.map(([key, label]) =>
          h(
            "button",
            {
              key,
              role: "menuitemradio",
              "aria-checked": key === value,
              className: "stk-pop-item" + (key === value ? " stk-on" : ""),
              onClick: () => onPick(key),
            },
            h("span", null, label),
            key === value && h("span", { className: "stk-pop-check" }, "✓")
          )
        )
      )
    );
  }

  /* Per-category sort dropdown. The caret beside a tab's icon opens its own list,
     because scenes and images do not sort by the same things. Tapping the row that
     is already active flips its direction (Largest First <-> Smallest First), and
     the two switches that used to be standalone icons in the navbar live here. */
  function categoryPopover({ options, value, dir, onPick, onFlip, favorite, onClose }) {
    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-pop-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-pop stk-cat-pop", role: "menu" },
        options.map((option) => {
          const active = option.key === value;
          return h(
            "button",
            {
              key: option.key,
              role: "menuitemradio",
              "aria-checked": active,
              className: "stk-pop-item" + (active ? " stk-on" : ""),
              onClick: () => (active ? onFlip() : onPick(option.key)),
            },
            h("span", null, option.label),
            active && option.key !== "random"
              ? h("span", { className: "stk-pop-check" }, dir === "ASC" ? "\u2191" : "\u2193")
              : null
          );
        }),
        favorite && h("div", { className: "stk-pop-sep" }),
        favorite &&
          h(
            "button",
            {
              className: "stk-pop-toggle" + (favorite.on ? " stk-on" : ""),
              role: "menuitemcheckbox",
              "aria-checked": !!favorite.on,
              onClick: favorite.onToggle,
            },
            h("span", null, favorite.label || "Favorites on top"),
            h("span", { className: "stk-pop-check" }, favorite.on ? "\u2713" : "")
          )
      )
    );
  }

  function loadFolderFavs() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FOLDER_FAV_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((row) => typeof row === "string") : [];
    } catch (e) {
      return [];
    }
  }

  function saveFolderFavs(list) {
    try {
      window.localStorage.setItem(FOLDER_FAV_KEY, JSON.stringify(list));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  function saveFeeds(feeds) {
    try {
      window.localStorage.setItem(FEEDS_KEY, JSON.stringify(feeds));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  /* ------------------------------------------------------------------ */
  /* feed view                                                          */
  /* ------------------------------------------------------------------ */

  /** Put a not-yet-active layer on its start frame so activating it is just play(). */
  function prewarm(video, startAt) {
    const start = Number(startAt) || 0;
    if (!video || !start) return;
    const doSeek = () => {
      if (video.readyState < 1) return;
      const duration = video.duration || 0;
      if (!duration || start >= duration) return;
      if (Math.abs(video.currentTime - start) < 0.5) return;
      try {
        video.currentTime = start;
      } catch (e) {
        /* ignore */
      }
    };
    if (video.readyState >= 1) doSeek();
    else video.addEventListener("loadedmetadata", doSeek, { once: true });
  }

  function feedFrameFit(width, height, stageAspect) {
    const aspect = width / height;
    if (!width || !height || !stageAspect) return "contain";
    const retained = Math.min(aspect / stageAspect, stageAspect / aspect);
    return retained >= 0.75 ? "cover" : "contain";
  }

  /** Play, but never start before a pending seek has landed: that race is the black flash. */
  function seekThenPlay(video, startAt, playVideo) {
    const start = Number(startAt) || 0;
    const play = () => playVideo(video);
    if (start <= 0) {
      play();
      return;
    }
    // metadata may not have arrived yet: seeking blindly is what left clips at 0:00
    const landOnStart = () => {
      const total = video.duration;
      if (!isFinite(total) || total <= 0 || start >= total) {
        play();
        return;
      }
      if (Math.abs(video.currentTime - start) <= 1) {
        play();
        return;
      }
      try {
        video.currentTime = start;
      } catch (e) {
        play();
        return;
      }
      video.addEventListener("seeked", play, { once: true });
    };
    if (video.readyState >= 1) {
      landOnStart();
      return;
    }
    video.addEventListener("loadedmetadata", landOnStart, { once: true });
  }


  /* ---------- VR: one fragment shader, no library ----------
     A VR180 clip is two fisheye eyes side by side (3840x1920 = 1920x1920 each). A
     rectilinear 2D view is the inverse projection of that fisheye: for every output
     pixel, build a camera ray, rotate it by yaw/pitch, then map it back through an
     equidistant fisheye into the left eye. That is the whole trick the web players
     use; everything else in them is stereo, controllers and a 3D scene. */
  const VR_FS = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform float yaw, pitch, fov, aspect;
uniform int kind;              /* 0 = vr180 fisheye SBS, 1 = equirect (360) */
const float PI = 3.14159265;
void main() {
  vec2 q = uv * 2.0 - 1.0;
  q.x *= aspect;
  float t = tan(fov * 0.5);
  vec3 d = normalize(vec3(q.x * t, -q.y * t, -1.0));
  float cy = cos(yaw), sy = sin(yaw);
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  d = normalize(d);
  if (kind == 1) {
    float lon = atan(d.x, -d.z);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    gl_FragColor = texture2D(tex, clamp(vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI), 0.001, 0.999));
    return;
  }
  if (d.z > -0.001) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  /* VR180 is a 180x180 EQUIRECT per eye, not a fisheye: longitude and latitude
     are linear in the image, so the inverse is lon/lat straight to u/v. The old
     equidistant-fisheye inverse (r = theta/(pi/2)) only agrees with this along the
     two axes and pulls everything off-axis toward the centre, which is the
     "squished heads" the user sees on a portrait phone. Verified against ffmpeg's
     v360=hequirect:flat unwrap of the same frame (mean abs error ~1/255 for this
     model, ~57/255 for the fisheye one). */
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  if (abs(lon) > PI * 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  /* left eye occupies x in [0, 0.5]; its 180 degrees map across that half.
     v is 0.5 + lat/pi, not minus: the vertex shader negates q.y, so the top of the
     screen already looks upward, and the texture's first row is its top. Proven
     against ffmpeg by rendering at yaw=0/pitch=0 and comparing pixels (mean abs
     error 1.2/255 with this sign, 34/255 with the other). */
  vec2 s = vec2(0.25 + 0.5 * (lon / PI), 0.5 + lat / PI);
  gl_FragColor = texture2D(tex, clamp(s, 0.001, 0.999));
}`;

  const VR_VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }";

  /* what a scene's video actually is: null | "vr180" | "equirect" */
  function vrLayout(scene) {
    /* ?vr=1 forces the VR path on any clip: handy for testing the shader on a device
       that cannot decode the 8K master */
    try {
      if (/(^|[?&])vr=1/.test(window.location.search)) return "vr180";
    } catch (e) { /* ignore */ }
    const file = (scene && scene.files && scene.files[0]) || {};
    const w = Number(file.width) || 0;
    const hgt = Number(file.height) || 0;
    if (!w || !hgt) return null;
    const ratio = w / hgt;
    const hay = (
      (scene.title || "") +
      " " + ((scene.performers || []).map((p) => p.name).join(" ")) +
      " " + ((scene.tags || []).map((t) => t.name).join(" "))
    ).toLowerCase();
    const is360 = /\b360\b|equirect/.test(hay);
    const isVr = /\bvr\b|vr180|fisheye|stereoscop/.test(hay);
    if (ratio > 3.7) return "equirect";                         /* 360 stereoscopic = 4:1 */
    if (Math.abs(ratio - 2) <= 0.08 && (w >= 2400 || isVr || is360)) {
      return is360 && !isVr ? "equirect" : "vr180";
    }
    return null;
  }

  /* the view is a ref, not state: panning must not re-render react 60 times a second */
  const VR_FOV_MIN = 0.55;
  const VR_FOV_MAX = 2.9;
  /* the "swipe here" hint is shown once per session, not on every clip */
  let vrHintShown = false;

  function VrCanvas({ videoRef, layout, sceneKey, previewUrl, onTap, onSource }) {
    const canvasRef = useRef(null);
    /* non-empty when the GL path could not run: shown in place of the canvas so a
       broken viewer says why instead of presenting a white rectangle */
    const [problem, setProblem] = useState("");
    /* captured once per mount, not read during render: react may render twice
       (strict mode, the shell's two-stage route) and the second render would drop
       a hint the first one already consumed */
    const [hint] = useState(() => !vrHintShown);
    useEffect(() => { if (hint) vrHintShown = true; }, [hint]);
    const tapRef = useRef(onTap);
    tapRef.current = onTap;
    const srcRef = useRef(onSource);
    srcRef.current = onSource;
    const viewRef = useRef({ yaw: 0, pitch: 0, fov: 1.75 });
    const touchRef = useRef({ points: new Map(), moved: 0, lastDist: 0, started: 0 });

    useEffect(() => {
      viewRef.current.yaw = 0;
      viewRef.current.pitch = 0;
      viewRef.current.fov = 1.75;
      /* a new clip retries the GL path even if the previous one failed */
      setProblem("");
    }, [sceneKey]);

    useEffect(() => {
      if (!layout) return undefined;
      const canvas = canvasRef.current;
      if (!canvas) return undefined;
      /* A throw inside the render loop leaves the canvas transparent, and a phone
         shows a transparent canvas over a light page as a plain white rectangle
         with no hint of what broke. Any setup or per-frame failure now replaces
         the canvas with the reason. */
      let raf = 0;
      let stopped = false;
      const fail = (why) => {
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        setProblem(String(why));
      };
      /* webgl1 FIRST: it is the context this shader was written and proven on, and
         some Android drivers hand out a webgl2 context that then refuses a GLSL ES
         1.00 shader ("did not compile" on a phone where the same source worked on
         webgl1). webgl2 is only the fallback for a browser with no webgl1 at all;
         nothing here needs webgl2 now that there are no mipmaps. */
      const gl = canvas.getContext("webgl", { alpha: false, antialias: false }) ||
        canvas.getContext("experimental-webgl", { alpha: false, antialias: false }) ||
        canvas.getContext("webgl2", { alpha: false, antialias: false });
      if (!gl) {
        fail("VR view unavailable: this browser has no WebGL");
        return undefined;
      }
      /* the compiler's own words, trimmed: a screenshot of the banner is then
         enough to diagnose a device that rejects the shader */
      const shader = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
        const log = String(gl.getShaderInfoLog(sh) || "").replace(/\s+/g, " ").trim();
        fail("VR view unavailable: the " + (type === gl.VERTEX_SHADER ? "vertex" : "fragment") +
          " shader did not compile" + (log ? " — " + log.slice(0, 280) : ""));
        return null;
      };
      const vs = shader(gl.VERTEX_SHADER, VR_VS);
      const fs = shader(gl.FRAGMENT_SHADER, VR_FS);
      if (!vs || !fs) return undefined;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = String(gl.getProgramInfoLog(prog) || "").replace(/\s+/g, " ").trim();
        fail("VR view unavailable: the shaders did not link" + (log ? " — " + log.slice(0, 280) : ""));
        return undefined;
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      /* Plain LINEAR, no mipmaps: this is the upload path that always painted. The
         frame is copied through a 2D canvas at three times the player's pixel
         width, so the fisheye shrink reads from a big texture and the old
         blocky/jagged look is gone without a per-frame 9 MP mip chain. */
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      /* Every uniform the shader reads, looked up once. Losing this block is what
         blanked the viewer: paint() dereferenced an undefined `u` on the first
         frame, the throw killed the loop, and the canvas stayed transparent. */
      const u = {
        tex: gl.getUniformLocation(prog, "tex"),
        yaw: gl.getUniformLocation(prog, "yaw"),
        pitch: gl.getUniformLocation(prog, "pitch"),
        fov: gl.getUniformLocation(prog, "fov"),
        aspect: gl.getUniformLocation(prog, "aspect"),
        kind: gl.getUniformLocation(prog, "kind"),
      };
      if (!u.tex || !u.yaw || !u.pitch || !u.fov || !u.aspect || !u.kind) {
        fail("VR view unavailable: shader uniforms missing");
        return undefined;
      }
      /* the driver's real limit: a 4320-wide VR frame must not be shrunk by an
         arbitrary cap, only by what the GPU cannot hold */
      const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
      /* the frame is copied here, then uploaded: one canvas, resized to the
         texture size, drawn once per decoded frame */
      const scratch = document.createElement("canvas");
      scratch.width = 1024;
      scratch.height = 512;
      const sctx = scratch.getContext("2d");
      /* false once the driver refuses a video as a texture source */
      let direct = true;

      /* Safari will not decode an 8K HEVC master (and refuses to sample some
         hardware-decoded streams at all), which shows up as a black canvas. Stash
         already renders a small H.264 preview per scene: use it as the texture
         whenever the master has no frames to give. */
      let fallback = null;
      if (previewUrl) {
        fallback = document.createElement("video");
        fallback.src = previewUrl;
        fallback.muted = true;
        fallback.loop = true;
        fallback.playsInline = true;
        fallback.setAttribute("playsinline", "");
        fallback.preload = "auto";
        fallback.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
        document.body.appendChild(fallback);
        const kick = () => {
          const p = fallback.play();
          if (p && p.catch) p.catch(() => {});
        };
        fallback.addEventListener("canplay", kick, { once: true });
        kick();
      }
      const usable = (el) => el && el.readyState >= 2 && el.videoWidth > 0;
      /* Once the master has handed us a frame it stays the source for this scene:
         an active seek or a buffer stall must not demote a sharp 8K frame to the
         small preview mid-playback. The preview is only for a master that never
         decodes at all, and only after a grace period. */
      let masterSeen = false;
      const opened = Date.now();
      const pickSource = () => {
        const master = videoRef.current;
        if (usable(master)) {
          masterSeen = true;
          return master;
        }
        if (master && master.error && usable(fallback)) return fallback;
        if (masterSeen) return master;
        if (usable(fallback) && Date.now() - opened > 2500) return fallback;
        return null;
      };

      let last = 0;
      let lastFrame = -1;
      let lastKind = "";
      const frame = (now) => {
        if (now - last < 16) return;
        last = now;
        /* Render at the device's real pixel count: at dpr 3 a 2x cap left the
           canvas a third of the screen's resolution and the browser upscaled it,
           which is half of why the image looked aliased before the shader even
           ran. Bounded so a huge desktop pane cannot allocate an absurd buffer. */
        let dpr = Math.min(3, window.devicePixelRatio || 1);
        const cssW = canvas.clientWidth || 640;
        const cssH = canvas.clientHeight || 360;
        /* 8 MP: covers a tablet at dpr 2 (5.6 MP) without letting a huge desktop
           pane allocate an absurd buffer */
        const BUDGET = 8000000;
        if (cssW * cssH * dpr * dpr > BUDGET) dpr = Math.sqrt(BUDGET / (cssW * cssH));
        const w = Math.max(320, Math.round(cssW * dpr));
        const h = Math.max(180, Math.round(cssH * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const source = pickSource();
        if (!source) return;
        const kind = source === fallback ? "preview" : "master";
        if (kind !== lastKind) {
          lastKind = kind;
          lastFrame = -1;
          if (srcRef.current) srcRef.current(kind);
        }
        /* the shader is driven entirely by uniforms; the texture is already bound */
        const view = viewRef.current;
        const paint = () => {
          gl.viewport(0, 0, canvas.width, canvas.height);
          /* a clear as well as a full-screen quad: if the draw ever produces
             nothing, the canvas goes black instead of transparent white */
          gl.clearColor(0.0, 0.0, 0.0, 1.0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform1i(u.tex, 0);
          gl.uniform1f(u.yaw, view.yaw);
          gl.uniform1f(u.pitch, view.pitch);
          gl.uniform1f(u.fov, view.fov);
          gl.uniform1f(u.aspect, canvas.width / canvas.height);
          gl.uniform1i(u.kind, layout === "equirect" ? 1 : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        /* a 30fps source does not need 60 uploads a second: the texture is only
           re-uploaded when a new frame has actually been decoded */
        if (source.currentTime === lastFrame) {
          paint();
          return;
        }
        lastFrame = source.currentTime;
        const vw = source.videoWidth || 1920;
        const vh = source.videoHeight || 960;
        /* Three times the player's own pixel width. The version that uploaded at
           1.15x is the one that loaded but looked jagged; 3x of a phone at dpr 3
           is the native 4320-wide VR frame, so the fisheye shrink stops throwing
           detail away before the shader even samples it. Capped by the source and
           by what this GPU will hold. */
        const wanted = Math.max(720, Math.min(maxTex, Math.round(w * 1.15 * 3)));
        const texW = Math.min(vw, wanted);
        const texH = Math.max(2, Math.round((texW * vh) / Math.max(1, vw)));
        const master = videoRef.current;
        if (source === fallback && master && master.currentTime > 1 && fallback.duration > 2) {
          /* keep the stand-in roughly where the timeline says we are */
          const want = master.currentTime % fallback.duration;
          if (Math.abs(fallback.currentTime - want) > 1.5) fallback.currentTime = want;
        }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (vw <= wanted && direct) {
          /* Nothing to resize, so hand the decoded frame to the GPU directly: one
             GPU-to-GPU copy and no CPU scaling at all. This is the cheap path and
             it is only taken when the frame already fits the texture we want -
             texImage2D cannot resize a video, and uploading an 8192-wide frame
             whole (134 MB) every frame is worse than scaling it. A device that
             refuses a video as a texture source demotes this canvas to the canvas
             path for the rest of its life instead of failing frame after frame. */
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            if (gl.getError() !== gl.NO_ERROR) throw new Error("video texture refused");
          } catch (err) {
            direct = false;
            uploadScaled(texW, texH);
          }
        } else {
          uploadScaled(texW, texH);
        }
        paint();

        function uploadScaled(width, height) {
          if (scratch.width !== width || scratch.height !== height) {
            scratch.width = width;
            scratch.height = height;
          }
          try {
            sctx.drawImage(source, 0, 0, width, height);
          } catch (err) {
            return;
          }
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
        }
      };
      /* one guarded loop: a throw here used to kill the animation silently and
         leave an empty canvas behind, so it is caught and reported instead */
      const draw = (now) => {
        raf = requestAnimationFrame(draw);
        if (stopped) return;
        try {
          frame(now);
        } catch (err) {
          fail("VR: " + ((err && err.message) || err));
        }
      };
      raf = requestAnimationFrame(draw);

      /* desktop wheel is the zoom. react attaches wheel as passive, so preventDefault
         has to come from a native non-passive listener. */
      const onWheel = (event) => {
        event.preventDefault();
        const view = viewRef.current;
        view.fov = Math.max(VR_FOV_MIN, Math.min(VR_FOV_MAX, view.fov + event.deltaY * 0.0016));
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });

      /* pointer handling is native and stops propagation: the feed's swipe-to-next
         gesture sits on ancestor React handlers and would otherwise treat a pan
         as a swipe. */
      const points = new Map();
      let moved = 0;
      let started = 0;
      let lastDist = 0;

      const down = (event) => {
        event.stopPropagation();
        if (canvas.setPointerCapture) {
          try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
        }
        if (points.size === 0) {
          moved = 0;
          started = Date.now();
          lastDist = 0;
        }
        points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      };

      const move = (event) => {
        const point = points.get(event.pointerId);
        if (!point) return;
        event.stopPropagation();
        const dx = event.clientX - point.x;
        const dy = event.clientY - point.y;
        point.x = event.clientX;
        point.y = event.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        const view = viewRef.current;
        if (points.size === 1) {
          /* dragging right must pull the world right; the sign was flipped */
          view.yaw += dx * 0.0052;
          view.pitch = Math.max(-1.15, Math.min(1.15, view.pitch - dy * 0.0042));
        } else if (points.size >= 2) {
          const entries = Array.from(points.values());
          const dist = Math.hypot(entries[0].x - entries[1].x, entries[0].y - entries[1].y) || 1;
          if (lastDist) {
            view.fov = Math.max(VR_FOV_MIN, Math.min(VR_FOV_MAX, view.fov * (lastDist / dist)));
          }
          lastDist = dist;
        }
      };

      const up = (event) => {
        if (!points.has(event.pointerId)) return;
        event.stopPropagation();
        points.delete(event.pointerId);
        if (points.size === 0) {
          lastDist = 0;
          if (Date.now() - started < 260 && moved < 9 && tapRef.current) tapRef.current();
        }
      };

      const reset = (event) => {
        event.stopPropagation();
        viewRef.current.yaw = 0;
        viewRef.current.pitch = 0;
        viewRef.current.fov = 1.75;
      };
      const swallow = (event) => event.stopPropagation();

      canvas.addEventListener("pointerdown", down);
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("dblclick", reset);
      canvas.addEventListener("click", swallow);

      return () => {
        stopped = true;
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", up);
        canvas.removeEventListener("dblclick", reset);
        canvas.removeEventListener("click", swallow);
        if (fallback) {
          try { fallback.pause(); } catch (e) { /* ignore */ }
          if (fallback.parentNode) fallback.parentNode.removeChild(fallback);
        }
        cancelAnimationFrame(raf);
        const lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      };
    }, [layout, sceneKey, videoRef, previewUrl]);

    if (!layout) return null;
    /* a viewer that cannot run says so; it does not present a blank rectangle */
    if (problem) return h("div", { className: "stk-vr-fail" }, problem);

    /* The canvas owns every drag on the picture, so a VR clip had no way to reach
       the next one. This strip is left out of the canvas' pointer handling, so the
       feed's own swipe gesture runs there - invisible, but it is the place to
       swipe (a vertical drag, the feed's next-clip gesture). The hint names it
       once per session and then never comes back. */
    return h(React.Fragment, null,
      h("canvas", { className: "stk-vr-canvas", ref: canvasRef }),
      h("div", { className: "stk-vr-nav", "aria-hidden": "true" }),
      hint ? h("div", { className: "stk-vr-hint" }, "swipe up here for the next clip · drag the picture to look around") : null
    );
  }

  /* ---- keeping the display awake while a clip plays -------------------
     navigator.wakeLock exists only in a secure context, and the phone reaches
     Stash over plain http on the LAN, where the property is missing outright -
     an unconditional request therefore did nothing at all. iOS additionally
     refuses a lock that no gesture preceded, drops it whenever the tab hides
     and lets low-battery mode deny it. So: request on demand, retry on the next
     gesture, re-request on every show or release, and when the API is absent
     fall back to a silent looping clip - the only thing iOS counts as playback
     without the API (the NoSleep technique). */

  /* 1 s of black, 16x16, 5 fps, no audio, moov first: ~1.5 kB. Served as a
     blob, not inline: Stash sends `media-src blob: 'self'`, so a data: video
     is refused by its own CSP. */
  const SILENT_CLIP =
      "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM3bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAA" +
      "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA" +
      "AmF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA" +
      "AAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHZbWRpYQAAACBtZGhk" +
      "AAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhG1p" +
      "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAURzdGJsAAAAuHN0c2QA" +
      "AAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGli" +
      "eDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAe/+EAFmdCwB7ZHsBEAAADAAQAAAMAKDxYuSABAAVoy4PLIAAAABBwYXNwAAAA" +
      "AQAAAAEAAAAUYnRydAAAAAAAABUwAAAVMAAAABhzdHRzAAAAAAAAAAEAAAAFAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0" +
      "c2MAAAAAAAAAAQAAAAEAAAAFAAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAACgAAAAAoAAAAKAAAACQAAAAkAAAAUc3RjbwAAAAAA" +
      "AAABAAADZwAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRv" +
      "bwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAAKubWRhdAAAAm0GBf//adxF6b3m2Ui3lizYINkj7u94MjY0" +
      "IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBo" +
      "dHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5h" +
      "bHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0x" +
      "NiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9x" +
      "cF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEg" +
      "aW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50" +
      "PTUga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NSByYz1jcmYgbWJ0cmVlPTEg" +
      "Y3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAL" +
      "ZYiEBHyYoAA2I4AAAAAGQZo4CPqAAAAABkGaVAI+oAAAAAVBmmAQ9QAAAAVBmoA/1A==";

  let silentUrl = "";
  function silentClipUrl() {
    if (silentUrl) return silentUrl;
    try {
      const raw = window.atob(SILENT_CLIP);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      silentUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    } catch (e) {
      silentUrl = "";
    }
    return silentUrl;
  }

  function createAwake() {
    let sentinel = null;
    let requesting = false;
    let silent = null;
    let want = false;
    let retryTimer = 0;
    let bound = false;

    const supported = () => !!(navigator.wakeLock && navigator.wakeLock.request);
    const needsSilent = () => !supported() || navigator.maxTouchPoints > 0;

    const release = () => {
      const held = sentinel;
      sentinel = null;
      if (held) {
        try { held.release(); } catch (e) { /* already gone */ }
      }
    };

    const quiet = () => {
      const el = silent;
      silent = null;
      if (!el) return;
      try { el.pause(); } catch (e) { /* ignore */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    };

    /* 2x2 px in the corner and not display:none: WebKit pauses an inline video
       it considers offscreen or invisible, and a paused clip holds nothing */
    const startSilent = () => {
      if (silent || document.hidden || !needsSilent()) return;
      const el = document.createElement("video");
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      el.setAttribute("muted", "");
      el.setAttribute("aria-hidden", "true");
      el.muted = true;
      el.loop = true;
      el.preload = "auto";
      const clip = silentClipUrl();
      if (!clip) return;
      el.src = clip;
      el.style.cssText =
        "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:10000;";
      /* webkit pauses an inline clip for its own reasons; put it back */
      el.addEventListener("pause", () => {
        if (!want || document.hidden) return;
        window.setTimeout(() => {
          if (silent === el && want && !document.hidden) restartSilent();
        }, 300);
      });
      document.body.appendChild(el);
      silent = el;
      const started = el.play();
      if (started && started.catch) {
        /* no gesture yet: the next tap arms it (gesture() retries) */
        started.catch(() => {});
      }
    };

    const request = () => {
      if (!want || document.hidden) return;
      if (!supported() || sentinel || requesting) return;
      let pending;
      try {
        pending = navigator.wakeLock.request("screen");
      } catch (e) {
        return;
      }
      requesting = true;
      Promise.resolve(pending)
        .then((held) => {
          if (!want || document.hidden) {
            try { held.release(); } catch (e) { /* ignore */ }
            return;
          }
          sentinel = held;
          held.addEventListener("release", () => {
            if (sentinel === held) sentinel = null;
            /* a system release (low power, app switch) must not spin: retry
               once, slowly, and let the next gesture do the rest */
            if (want && !document.hidden && !retryTimer) {
              retryTimer = window.setTimeout(() => {
                retryTimer = 0;
                request();
              }, 1000);
            }
          });
        })
        .catch(() => {
          startSilent();
        })
        .finally(() => { requesting = false; });
    };

    const restartSilent = () => {
      if (!silent) return;
      const started = silent.play();
      if (started && started.catch) started.catch(() => {});
    };

    const gesture = () => {
      if (!want || document.hidden) return;
      request();
      if (silent) restartSilent();
      else startSilent();
    };

    const onVisibility = () => {
      if (document.hidden) {
        release();
        if (silent) { try { silent.pause(); } catch (e) { /* ignore */ } }
        return;
      }
      gesture();
    };

    const bind = () => {
      if (bound) return;
      bound = true;
      /* capture, so a tap the feed swallows still counts as activation */
      document.addEventListener("pointerdown", gesture, true);
      document.addEventListener("click", gesture, true);
      document.addEventListener("keydown", gesture, true);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("focus", onVisibility);
      window.addEventListener("pageshow", onVisibility);
    };

    const unbind = () => {
      if (!bound) return;
      bound = false;
      document.removeEventListener("pointerdown", gesture, true);
      document.removeEventListener("click", gesture, true);
      document.removeEventListener("keydown", gesture, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };

    return {
      set(next) {
        const on = !!next;
        if (on === want) return;
        want = on;
        if (on) {
          bind();
          /* the clip runs even when the API answers yes: in low power mode, in
             a home-screen web app before iOS 18.4 and anywhere the OS quietly
             ignores the request, a resolved sentinel proves nothing */
          startSilent();
          request();
        } else {
          unbind();
          release();
          quiet();
          if (retryTimer) { window.clearTimeout(retryTimer); retryTimer = 0; }
        }
      },
      dispose() {
        this.set(false);
        unbind();
      },
    };
  }

  function FeedView({ prefs, spec, cfg, refreshKey, onBack, onSearch, onSettings, onMenu, onOpenPerformer, onOpenTag, onDeriveFeed, onEditFeed, onOpenFolder, onOpenFolderProfile, feeds, onSwitchFeed, onNewFeed, onManageFeeds, onDuo, duo, desktop }) {
    const sfw = !!cfg.sfw;
    const [items, setItems] = useState([]);
    const [index, setIndex] = useState(0);
    const [count, setCount] = useState(0);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState(false);
    const [ready, setReady] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [fullscreenFit, setFullscreenFit] = useState("auto");
    const nativeFullscreenRef = useRef(false);
    const exitFullscreen = useCallback(() => {
      setFullscreen(false);
      if (nativeFullscreenRef.current && document.fullscreenElement === document.documentElement) {
        document.exitFullscreen().catch(() => {});
      }
      nativeFullscreenRef.current = false;
    }, []);
    function enterFullscreen() {
      setFullscreen(true);
      if (document.fullscreenEnabled && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        nativeFullscreenRef.current = true;
        document.documentElement.requestFullscreen().catch(() => { nativeFullscreenRef.current = false; });
      }
    }
    useEffect(() => {
      if (!fullscreen) return undefined;
      document.body.classList.add("stk-fullscreen-mode");
      const onChange = () => {
        if (nativeFullscreenRef.current && !document.fullscreenElement) exitFullscreen();
      };
      document.addEventListener("fullscreenchange", onChange);
      return () => {
        document.body.classList.remove("stk-fullscreen-mode");
        document.removeEventListener("fullscreenchange", onChange);
      };
    }, [fullscreen, exitFullscreen]);
    useEffect(() => () => {
      if (nativeFullscreenRef.current && document.fullscreenElement === document.documentElement) {
        document.exitFullscreen().catch(() => {});
      }
    }, []);
    const [streamFallback, setStreamFallback] = useState(false);
    const [failCount, setFailCount] = useState(0);
    const lastTimePush = useRef(0);
    /* where the playhead actually was, kept outside the video element: iOS wipes
       currentTime when it evicts the buffer for a backgrounded tab */
    const lastPosRef = useRef(0);
    /* the reload-in-flight for a seek on an evicted video, and its timer */
    const reloadRef = useRef(null);
    const reloadTimerRef = useRef(0);
    /* the phone sleeping mid-clip is the complaint this exists for: hold the
       display while a clip is actually running, let go the moment it stops */
    const awakeRef = useRef(null);
    if (!awakeRef.current) awakeRef.current = createAwake();
    useEffect(() => {
      awakeRef.current.set(playing);
    }, [playing]);
    useEffect(() => () => awakeRef.current.dispose(), []);
    const [rotation, setRotation] = useState(0);
    const [speed, setSpeed] = useState(() => Number(window.localStorage.getItem("stashTok.speed")) || 1);
    const [muted, setMuted] = useState(cfg.autoplayMuted);
    /* two feeds at once would talk over each other: the split view starts muted */
    useEffect(() => {
      if (duo) setMuted(true);
    }, [duo]);
    /* VR clips default to the 2D rectilinear view; v toggles back to raw */
    const [vrMode, setVrMode] = useState(true);
    const [people, setPeople] = useState(false);
    const quickRef = useRef(null);
    const [vrSource, setVrSource] = useState("");
    const [scrubPreview, setScrubPreview] = useState(null);
    /* a scene with no generated sprite sheet falls back to Stash's own
       screenshot-at-time endpoint; when that also fails the overlay gets out
       of the way and the video stays visible */
    const [snapFail, setSnapFail] = useState(false);
    const spriteRef = useRef({ key: "", cues: [], ok: false });
    const [spriteTick, setSpriteTick] = useState(0);
    const [hud, setHud] = useState(true);
    const [hudTick, setHudTick] = useState(0);
    const [sheet, setSheet] = useState(null); // 'actions' | 'details'
    const [chanOpen, setChanOpen] = useState(false);
    const [card, setCard] = useState(() => PENDING_CARD);
    /* quick tagging straight from the rail */
    const [tagOpen, setTagOpen] = useState(false);
    const [tagPicked, setTagPicked] = useState({});
    /* Category: one exclusive parent, plus the drawer of children it owns */
    const [tagCat, setTagCat] = useState("");
    const [tagKids, setTagKids] = useState({});
    /* how many chips each paged section shows; +8 per tap, reset on close */
    const [tagShown, setTagShown] = useState({});
    const [markerShown, setMarkerShown] = useState({});
    const [tagFilter, setTagFilter] = useState("");
    /* free-text queue: what the user typed and committed with , / Tab, before
       "Done" writes any of it. Names, not ids: a tag that does not exist yet is
       only created at write time. */
    const [tagQueue, setTagQueue] = useState([]);
    const [tagSugg, setTagSugg] = useState([]);
    const [tagSuggSel, setTagSuggSel] = useState(-1);
    const tagInputRef = useRef(null);
    const tagSuggTimer = useRef(0);
    const tagSuggSeq = useRef(0);
    const [tagBusy, setTagBusy] = useState(false);
    const [ethThumbs, setEthThumbs] = useState({});
    const [ethBusy, setEthBusy] = useState("");
    /* last tag write, so a mis-tap is one tap to undo */
    const [undo, setUndo] = useState(null);
    const undoTimer = useRef(0);
    const tagIdCache = useRef({});
    const tagDialogRef = useDialog(tagOpen, () => setTagOpen(false));
    /* add marker: M (or right-click) freezes the in point, one tag names it */
    const [markerAt, setMarkerAt] = useState(null);
    const [markerName, setMarkerName] = useState("");
    /* the name field doubles as a search, but only while it is being typed:
       picking a chip must not filter the sheet down to that one word */
    const [markerTyping, setMarkerTyping] = useState(false);
    /* the marker sheet is single-select, so its Category drawer follows the
       chosen name: a parent is itself, a child inherits its parent */
    const markerCategory = (() => {
      const name = markerName.trim().toLowerCase();
      if (!name) return "";
      const direct = CATEGORY_PARENTS.find((parent) => parent.toLowerCase() === name);
      if (direct) return direct;
      return CATEGORY_PARENTS.find((parent) => CATEGORY_TAGS[parent].some((kid) => kid.toLowerCase() === name)) || "";
    })();
    const [markerBusy, setMarkerBusy] = useState(false);
    const [markerUndo, setMarkerUndo] = useState(null);
    const markerUndoTimer = useRef(0);
    const markerDialogRef = useDialog(markerAt != null, () => setMarkerAt(null));
    const [ctxMenu, setCtxMenu] = useState(null); // {x, y, at}
    const [press, setPress] = useState(null); // {x,y} pip while a long press builds
    const [quick, setQuick] = useState(null); // {x,y} quick menu anchored at the thumb
    /* "Clear Display" hides every overlay for this clip; gestures keep working */
    const [clearDisplay, setClearDisplay] = useState(false);
    const [autoScroll, setAutoScroll] = useState(() => {
      try {
        return window.localStorage.getItem("stashTok.autoScroll") === "1";
      } catch (e) {
        return false;
      }
    });
    const [rating, setRating] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [dragY, setDragY] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [scrubbing, setScrubbing] = useState(false);
    /* the scrub bar is summoned by tapping the caption, then folds away again */
    const [scrubBar, setScrubBar] = useState(false);
    const scrubBarTimer = useRef(0);
    const [tip, setTip] = useState(null);
    /* the ripple an edge double tap leaves behind: { zone, x, y, delta, at } */
    const [seekFlash, setSeekFlash] = useState(null);
    const seekFlashTimer = useRef(0);
    /* the Marker bubble that a scrub arms when the finger pushes up:
       { x, at, over } — x is inside the stage, at is the frozen in point */
    const [markerDrop, setMarkerDrop] = useState(null);
    const markerDropEl = useRef(null);
    const [scrubTime, setScrubTime] = useState(0);
    /* Stash's screenshot endpoint runs ffmpeg per request, so a no-sprite
       scrub asks it at most ~7 times a second instead of once per pixel */
    const snapRef = useRef({ at: 0, t: 0 });
    const [duration, setDuration] = useState(0);
    const [time, setTime] = useState(0);
    const [rateBadge, setRateBadge] = useState("");
    /* the hashtag strip is one line. When the tags do not fit we drop the last
       one(s) and put "…more" in flow after them — a control drawn on top of the
       line covered the final "#" and read as sloppy. `tagFit` is how many tags
       fit; the rest stay in the DOM (absolutely positioned, invisible) so the
       measurement still sees their widths after a rotate. */
    const [tagsOpen, setTagsOpen] = useState(false);
    const [tagFit, setTagFit] = useState(0);
    const tagsRef = useRef(null);
    useLayoutEffect(() => {
      const box = tagsRef.current;
      if (!box) return;
      const measure = () => {
        const kids = Array.from(box.children).filter(
          (el) => el.classList && el.classList.contains("stk-hashtext") && !el.classList.contains("stk-hashtext-more")
        );
        if (!kids.length) {
          setTagFit((cur) => (cur === 0 ? cur : 0));
          return;
        }
        const wrap = box.closest(".stk-hashtagwrap") || box;
        const avail = Math.max(box.clientWidth, wrap.clientWidth);
        if (!avail) return;
        const moreEl = box.querySelector(".stk-hashtext-more");
        const gap = 9; /* .stk-hashtags column-gap */
        const reserve = moreEl ? moreEl.offsetWidth + gap : 0;
        let acc = 0;
        let fit = 0;
        for (const el of kids) {
          const w = el.offsetWidth + (fit ? gap : 0);
          if (acc + w > avail - reserve) break;
          acc += w;
          fit += 1;
        }
        /* everything fits now: allow the last one back in, no "…more" needed */
        if (fit < kids.length && !moreEl) {
          let all = 0;
          let count = 0;
          for (const el of kids) {
            const w = el.offsetWidth + (count ? gap : 0);
            if (all + w > avail) break;
            all += w;
            count += 1;
          }
          if (count === kids.length) fit = count;
        }
        setTagFit((cur) => (cur === fit ? cur : fit));
      };
      measure();
      /* re-fit when the card changes width (rotate, window resize) */
      let ro = null;
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(measure);
        ro.observe(box);
      }
      return () => { if (ro) ro.disconnect(); };
      /* `tags` is declared further down the component, so the deps use the item
         list and index instead — referencing it here threw at render time */
    }, [items, index, tagFit]);
    const [heartBurst, setHeartBurst] = useState(0);
    /* long-press on the heart asks which kind of favourite, instead of guessing */
    const [railMenu, setRailMenu] = useState(null);
    const railPress = useRef(0);
    /* the press that opened the menu must not also count as a tap */
    const railHeld = useRef(false);
    const frameHandoff = desktop && !spec.single && !sfw;
    const useSmartFit = frameHandoff || (fullscreen && desktop);
    const [stageAspect, setStageAspect] = useState(0);
    const [decodedSize, setDecodedSize] = useState(null);
    /* portrait framing of a landscape clip: auto (middle half) → full → height */
    const [cropMode, setCropMode] = useState(() => {
      /* only the un-zoomed step comes back after a reload. "fill height" is ~3.6x
         on a phone, and the HUD is hidden three seconds in, so restoring it meant a
         refresh landed on a giant cropped frame with nothing to tap. */
      try {
        return window.localStorage.getItem("stashTok.crop") === "full" ? "full" : "auto";
      } catch (e) {
        return "auto";
      }
    });
    const [cropBadge, setCropBadge] = useState("");

    const stageRef = useRef(null);
    /* Stage size, kept current by a ResizeObserver instead of read back from the
       DOM on every crop/fit decision. `stage.clientWidth` after a style write in
       the same frame forces a synchronous layout, and the per-clip crop path
       asked for it four times in a row. */
    const stageBoxRef = useRef({ w: 0, h: 0 });
    const stageBox = useCallback(() => {
      const box = stageBoxRef.current;
      if (box.w && box.h) return box;
      const stage = stageRef.current;
      const w = (stage && stage.clientWidth) || 0;
      const h = (stage && stage.clientHeight) || 0;
      if (w && h) {
        box.w = w;
        box.h = h;
      }
      return box;
    }, []);
    const videoRef = useRef(null);
    const wrapRef = useRef(null);
    const slideRef = useRef(null);
    const pageRef = useRef(1);
    const busyRef = useRef(false);
    const exhaustedRef = useRef(false);
    const pts = useRef(new Map());
    const gesture = useRef(null);
    const holdTimer = useRef(null);
    const pressTimer = useRef(0);
    const tapTimer = useRef(null);
    const lastTapAt = useRef(0);
    /* which stripe the first tap of a possible double tap landed in, so two taps
       in the same stripe are a seek and a stray pair across stripes is not */
    const lastTapZone = useRef("");
    /* the scrub bar's own gesture: where the finger started, and whether the
       upward push has already armed the Marker bubble */
    const dropRef = useRef(null);
    /* the moment a tap un-zoomed the frame: a second tap inside the same double
       belongs to that gesture and must not fall through to play/pause */
    const swallowTapRef = useRef(0);
    /* what the first tap of a possible double tap did, so the second can undo it */
    const tapUndoRef = useRef(null);
    const cropModeRef = useRef(cropMode);
    cropModeRef.current = cropMode;
    const autoScrollRef = useRef(autoScroll);
    autoScrollRef.current = autoScroll;
    /* true while the current transform came from the crop cycle, not a pinch */
    const cropZoomRef = useRef(false);
    /* the scale at which the picture exactly covers the stage, cached: a gesture
       calls applyTransform on every pointermove and coverScale() reads layout */
    const coverRef = useRef(1);
    const cropRefreshRef = useRef(null);
    const cropBadgeTimer = useRef(null);
    const rafRef = useRef(0);
    const tf = useRef({ s: 1, x: 0, y: 0 });

    /* React can leave videoRef pointing at the clip we just swiped away from, so
       always resolve the element that is actually marked active on screen. */
    const activeVideo = useCallback(() => {
      const stage = stageRef.current;
      const live = stage && stage.querySelector(".stk-video.stk-active");
      return live || videoRef.current;
    }, []);

    const item = items[index] || null;
    const hasItem = !!item;
    useLayoutEffect(() => {
      const stage = stageRef.current;
      if (!useSmartFit || !stage) return undefined;
      const measure = () => {
        setStageAspect(stage.clientHeight ? stage.clientWidth / stage.clientHeight : 0);
      };
      measure();
      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
      }
      const observer = new ResizeObserver(measure);
      observer.observe(stage);
      return () => observer.disconnect();
    }, [useSmartFit, hasItem]);
    const sceneTags = item && item.scene.tags;

    useEffect(() => {
      const video = activeVideo();
      const scene = item && item.scene;
      if (!video || !scene || sfw) return undefined;
      const startedAt = performance.now();
      const id = String(scene.id);
      let watchedAt = 0;
      let bufferingAt = 0;
      const log = (event, since = startedAt) => {
        if (prefs.playbackDiagnostics !== false) recordPlayback(event, video, performance.now() - since);
      };
      const onPlaying = () => {
        if (!watchedAt) {
          watchedAt = Date.now();
          const previous = readLocalList(WATCH_HISTORY_KEY).filter((row) => row.id !== id);
          writeLocalList(WATCH_HISTORY_KEY, [
            { id, title: String(scene.title || "Scene " + id).slice(0, 240),
              watchedAt, time: video.currentTime || 0 },
            ...previous.slice(0, 99),
          ]);
          log("playing");
        } else if (bufferingAt) {
          log("resumed", bufferingAt);
        }
        bufferingAt = 0;
      };
      const onWaiting = () => {
        if (bufferingAt || video.paused || video.seeking) return;
        bufferingAt = performance.now();
        log("buffering");
      };
      const onError = () => log("media-error");
      video.addEventListener("playing", onPlaying);
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("error", onError);
      if (!video.paused && !video.seeking && video.readyState >= 2) onPlaying();
      const timer = prefs.playbackDiagnostics === false ? 0 : window.setInterval(() => {
        if (!video.paused && !document.hidden) log("sample");
      }, 15000);
      const savePosition = () => {
        if (!watchedAt) return;
        const rows = readLocalList(WATCH_HISTORY_KEY);
        const row = rows.find((entry) => entry.id === id && entry.watchedAt === watchedAt);
        if (row && Number.isFinite(video.currentTime)) {
          row.time = video.currentTime;
          writeLocalList(WATCH_HISTORY_KEY, rows);
        }
      };
      window.addEventListener("pagehide", savePosition);
      return () => {
        savePosition();
        window.clearInterval(timer);
        window.removeEventListener("pagehide", savePosition);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("error", onError);
      };
    }, [activeVideo, item && item.key, sfw, prefs.playbackDiagnostics]);

    useEffect(() => {
      if (!PENDING_CARD) return undefined;
      const next = PENDING_CARD;
      PENDING_CARD = null;
      setCard(next);
      const t = window.setTimeout(() => setCard(null), 1900);
      return () => window.clearTimeout(t);
    }, []);

    const [, setRootsReady] = useState(0);

    const feedKey = feedResumeKey(spec);
    const resumeVersion = RESUME_VERSIONS.get(feedKey) || 0;
    const resumeRef = useRef(undefined);
    const positionedRef = useRef(null);
    if (resumeRef.current === undefined) {
      const saved = spec.startSceneId || spec.startAt ? null : readResume(feedKey);
      resumeRef.current = saved ? { sceneId: saved.sceneId, time: saved.time } : null;
    }
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const indexRef = useRef(index);
    indexRef.current = index;
    const timeRef = useRef(time);
    timeRef.current = time;
    const speedRef = useRef(speed);
    speedRef.current = Number(speed) || 1;
    const hydratedRef = useRef(false);
    /* which scene we already restored a start time for: paging in more items must
       never re-seek the clip the user is watching */
    const seekedSceneRef = useRef(null);

    useEffect(() => {
      const stage = stageRef.current;
      if (!stage || typeof ResizeObserver === "undefined") return undefined;
      const observer = new ResizeObserver((entries) => {
        const box = entries[0] && entries[0].contentRect;
        if (!box) return;
        const w = Math.round(box.width);
        const h = Math.round(box.height);
        const changed = w !== stageBoxRef.current.w || h !== stageBoxRef.current.h;
        stageBoxRef.current.w = w;
        stageBoxRef.current.h = h;
        /* the desktop rail expanding or the window resizing changes the cover scale,
           and that number is cached for gestures: re-measure it here, after the box
           cache is updated, or a pan would start from a stale zoom and jump */
        if (changed && cropRefreshRef.current) cropRefreshRef.current();
      });
      observer.observe(stage);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const onResize = () => {
        const video = activeVideo();
        if (video) {
          /* turning the phone re-decides auto-crop (and re-scales "fill height") */
          if (cropRefreshRef.current) cropRefreshRef.current();
        }
      };
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      };
    }, [activeVideo]);

    /* remember the seat as we move, not only on the way out */
    useEffect(() => {
      if (!hydratedRef.current || resumeVersion !== (RESUME_VERSIONS.get(feedKey) || 0)) return;
      const cur = items[index];
      if (!cur || !cur.scene) return;
      const kept = readResume(feedKey);
      const same = kept && String(kept.sceneId) === String(cur.scene.id);
      writeResume(feedKey, cur.scene.id, same ? kept.time : 0);
    }, [feedKey, index, items, resumeVersion]);

    /* walking away must not reset the feed: remember where we were */
    useEffect(
      () => () => {
        const cur = itemsRef.current[indexRef.current];
        // the element may already be detached by now; the state mirror is reliable
        if (cur && cur.scene && resumeVersion === (RESUME_VERSIONS.get(feedKey) || 0)) {
          writeResume(feedKey, cur.scene.id, timeRef.current);
        }
      },
      [feedKey, resumeVersion]
    );

    useEffect(() => {
      loadLibraryRoots().then(() => setRootsReady((n) => n + 1));
    }, []);

    /* ---- loading --------------------------------------------------- */

    const loadPage = useCallback(
      async (reset) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setLoading(true);
        try {
          const page = reset ? 1 : pageRef.current;
          const raw = await fetchFeedPageShared(spec, cfg, page);
          const result = Object.assign({}, raw, { items: paritySlice(raw.items, spec, page) });
          setCount(result.count);
          if (reset) {
            pageRef.current = 2;
            exhaustedRef.current = result.items.length === 0;
            /* an explicit order is a finished list: paging past it would append the
               same clips again */
            if (spec.orderIds && spec.orderIds.length) exhaustedRef.current = true;
            let list = result.items.slice();
            const resume = resumeRef.current;
            const startId = spec.startSceneId || (resume && resume.sceneId);
            const startTime = spec.startAt || (resume && resume.time) || null;
            /* Land ON the resumed clip instead of moving it to slot 0. The old
               rotate-to-front threw away everything the user had already swiped
               past: back from a performer page put you on video 8 as if it were
               the first clip, and swiping up could not reach 7. */
            let startAt = 0;
            if (startId) {
              const at = list.findIndex((entry) => String(entry.scene.id) === String(startId));
              if (at >= 0) startAt = at;
              else {
                // it may not be on page 1 at all: fetch it and lead with it
                try {
                  const single = await fetchSceneById({ sceneId: startId, startAt: startTime });
                  if (single.items.length) {
                    list.unshift(single.items[0]);
                    startAt = 0;
                  }
                } catch (err) {
                  /* fall through to the normal order */
                }
              }
            }
            if (reset && startTime && list.length && list[startAt]) {
              list[startAt] = Object.assign({}, list[startAt], { startAt: startTime });
            }
            setItems(list);
            setIndex(startAt);
            hydratedRef.current = true;
          } else {
            pageRef.current = page + 1;
            exhaustedRef.current = result.items.length === 0;
            setItems((prev) => {
              const seen = new Set(prev.map((entry) => entry.key));
              const fresh = result.items.filter((entry) => !seen.has(entry.key));
              return prev.concat(fresh);
            });
          }
          setError("");
        } catch (err) {
          setError(String(err.message || err));
        } finally {
          busyRef.current = false;
          setLoading(false);
        }
      },
      [spec, cfg]
    );

    const [refreshTick, setRefreshTick] = useState(0);
    useEffect(() => {
      pageRef.current = 1;
      exhaustedRef.current = false;
      setItems([]);
      setIndex(0);
      loadPage(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spec.id, spec.type, refreshKey, cfg.heartRating, cfg.source, refreshTick]);

    useEffect(() => {
      const stage = stageRef.current;
      if (stage) {
        Array.from(stage.querySelectorAll("video")).forEach((video) => {
          if (video.classList.contains("stk-active")) {
            if (frameHandoff) return;
            const start = Number(item && item.startAt) || 0;
            const activeKey = item ? item.key : null;
            if (video.paused && seekedSceneRef.current !== activeKey) {
              seekedSceneRef.current = activeKey;
              seekThenPlay(video, start, playGuarded);
              window.setTimeout(() => {
                const nowActive = stage.querySelector(".stk-video.stk-active");
                if (nowActive && nowActive.paused) playGuarded(nowActive);
              }, 220);
            } else {
              setPlaying(true);
            }
          } else if (!video.paused) {
            video.pause();
          }
        });
      }
      if (index >= items.length - 3 && !exhaustedRef.current) loadPage(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index, items.length]);

    /* the address bar always names the clip on screen, so it can be shared or reloaded */
    useEffect(() => {
      const sceneId = item && item.scene && item.scene.id;
      if (!sceneId || !spec) return;
      let target = null;
      /* a single-scene page keeps its own route: rewriting it to scene/<id> would
         turn a reload into the performer's feed */
      if (spec.single) target = "clip/" + sceneId;
      /* only a feed opened from a performer's own page belongs on that page's route.
         A performer *channel* (the GoonCave row in the feed menu) is a feed: writing
         the profile route here turned "switch to her channel" into "leave the feed". */
      else if (spec.type === "performer" && spec.origin && spec.origin.kind === "performer")
        target = "performers/" + encodeURIComponent(spec.name) + "/" + sceneId;
      else if (spec.type === "scene") target = "scene/" + sceneId;
      if (!target) return;
      clipState.sceneId = String(sceneId);
      if (currentRoute() !== target) goTo(target, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item && item.scene && item.scene.id, spec.type, spec.name]);

    /* Every channel is just a Stash search: For You is the default random query,
       GoonCave is "performers INCLUDES <current performer>", the rest are ordinary
       filters. Saved feeds are appended, so the carousel grows to the left forever. */
    /* The list behind the feed name. Two feeds ship with the app, in order:
       For You and Favorites. Everything after them is either a feed the user
       made or a preset of the same machinery, so the list reads "mine, then
       suggestions" instead of an undifferentiated pile. */
    function channelsNow() {
      const list = [
        { id: "foryou", name: "For You", spec: defaultFeed(), builtin: true },
        { id: "favorites", name: "Favorites", spec: { id: "favorites", name: "Favorites", type: "favorites", sort: "rating", direction: "DESC" }, builtin: true },
      ];
      (feeds || []).forEach((f) => {
        if (!f || !f.type) return;
        list.push({ id: f.id || f.key || f.name, name: f.name || "Feed", spec: f, saved: true });
      });
      /* presets: the useful shapes of the same filter language */
      const p = item && item.scene && item.scene.performers && item.scene.performers[0];
      if (p) {
        list.push({
          id: "gooncave:" + p.id,
          name: p.name,
          image: p.image_path,
          kind: "performer",
          spec: { id: "gooncave:" + p.id, name: p.name, type: "performer", performerId: p.id, sort: "random" },
        });
      }
      list.push({ id: "markers", name: "Markers", spec: { id: "markers", name: "Markers", type: "markers" } });
      list.push({ id: "newest", name: "Newest first", spec: { id: "newest", name: "Newest first", type: "foryou", sort: "created_at", direction: "DESC" } });
      list.push({ id: "unwatched", name: "Never played", spec: { id: "unwatched", name: "Never played", type: "fresh", sort: "random" } });
      list.push({ id: "long", name: "Long clips", spec: { id: "long", name: "Long clips", type: "foryou", minDuration: 900, sort: "random" } });
      return list;
    }

    function channelAt() {
      const list = channelsNow();
      const at = list.findIndex(
        (c) => (c.spec.id && spec.id && c.spec.id === spec.id) || (c.spec.type === spec.type && (c.spec.name || "") === (spec.name || ""))
      );
      return { list, at: at < 0 ? 0 : at };
    }

    function goChannel(step) {
      const { list, at } = channelAt();
      const next = at + step;
      if (next < 0 || next >= list.length) return;
      const target = list[next];
      PENDING_CARD = { name: target.name, image: target.image, kind: target.kind || "feed" };
      setChanOpen(false);
      if (onSwitchFeed) onSwitchFeed(Object.assign({}, target.spec, { startSceneId: null, startAt: null }));
    }

    function pickChannel(target) {
      PENDING_CARD = { name: target.name, image: target.image, kind: target.kind || "feed" };
      setChanOpen(false);
      if (onSwitchFeed) onSwitchFeed(Object.assign({}, target.spec, { startSceneId: null, startAt: null }));
    }

    useEffect(() => {
      if (item) setRating(item.scene.rating100 == null ? null : Number(item.scene.rating100));
      setReady(false);
      setStreamFallback(false);
      setDuration(0);
      setTime((item && Number(item.startAt)) || 0);
      lastPosRef.current = (item && Number(item.startAt)) || 0;
      /* a pending reload belongs to the clip we are leaving */
      reloadRef.current = null;
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = 0;
      }
      /* the previous clip's cover framing must not survive the next one */
      setFillMode(false);
      /* reset the user's pinch AND put the clip's framing back: a prewarmed clip
         fires canplay before it becomes active, so waiting for that event here
         left every second clip uncropped */
      applyCrop(cropModeRef.current, false, true);
      /* "Clear Display" belongs to one clip: the next one starts with its HUD */
      setClearDisplay(false);
      /* a tap still waiting out its double-tap window must not pause the next clip */
      window.clearTimeout(tapTimer.current);
      tapUndoRef.current = null;
      lastTapAt.current = 0;
      cropZoomRef.current = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item && item.key]);

    /* the timeline needs the real duration, whenever the metadata lands */
    useEffect(() => {
      const video = activeVideo();
      if (!video) return undefined;
      const sync = () => setDuration(video.duration || 0);
      sync();
      video.addEventListener("loadedmetadata", sync);
      video.addEventListener("durationchange", sync);
      return () => {
        video.removeEventListener("loadedmetadata", sync);
        video.removeEventListener("durationchange", sync);
      };
    }, [item && item.key, index]);

    /* ---- video ----------------------------------------------------- */

    useEffect(() => {
      const video = activeVideo();
      if (!video || !item) return;
      const start = Number(item.startAt) || 0;
      let cancelReveal = () => {};
      const onLoaded = () => {
        const file = item.scene.files && item.scene.files[0];
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (desktop && width && height && (!file || !file.width || !file.height ||
            Math.abs(width / height - file.width / file.height) > 0.01)) {
          setDecodedSize((size) => size && size.key === item.key && size.width === width && size.height === height
            ? size
            : { key: item.key, width, height });
        }
        /* the frame size is only known once metadata lands, so the crop lands here */
        applyCrop(cropModeRef.current, false);
        const total = video.duration || 0;
        setDuration(total);
        /* canplay fires again every time the browser re-buffers, so seek to the start
           frame ONCE per clip: otherwise scrubbing back lands in an unbuffered gap,
           triggers a refill, and this yanks the playhead forward again */
        const source = video.getAttribute("src");
        const positioned = positionedRef.current;
        if (positioned && positioned.video === video && positioned.key === item.key && positioned.source === source) return;
        positionedRef.current = { video, key: item.key, source };
        /* autoscroll picks its own way into the clip; otherwise the feed's start */
        const wanted = autoScrollRef.current ? autoScrollStart(total) : start;
        // a remembered playhead can outlive the file it came from: never seek past the end
        const seekTo = total > 0 ? Math.min(wanted, Math.max(0, total - 3)) : wanted;
        seekThenPlay(video, seekTo, (element) => {
          const stillCurrent = () => element.isConnected && element === activeVideo() &&
            element.getAttribute("src") === source;
          if (!stillCurrent()) return;
          if (frameHandoff) {
            cancelReveal();
            const reveal = () => {
              if (stillCurrent()) element.classList.add("stk-frame-ready");
            };
            if (typeof element.requestVideoFrameCallback === "function") {
              const frame = element.requestVideoFrameCallback(reveal);
              cancelReveal = () => element.cancelVideoFrameCallback(frame);
            } else {
              let frame = 0;
              const afterPlaying = () => { frame = requestAnimationFrame(reveal); };
              if (element.paused) element.addEventListener("playing", afterPlaying, { once: true });
              else afterPlaying();
              cancelReveal = () => {
                element.removeEventListener("playing", afterPlaying);
                cancelAnimationFrame(frame);
              };
            }
          }
          playGuarded(element);
        });
      };
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("canplay", onLoaded);
      if (video.readyState >= 1) onLoaded();
      return () => {
        cancelReveal();
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("canplay", onLoaded);
        video.pause();
        if (!video.isConnected) {
          video.removeAttribute("src");
          video.load();
        }
      };
    }, [item && item.key, frameHandoff]);

    /* play/pause is driven directly on the active element: a state-driven pause
       races the layer swap and kills the incoming video */

    useEffect(() => {
      const video = activeVideo();
      if (!video) return;
      video.muted = muted;
      if (frameHandoff && !video.classList.contains("stk-frame-ready")) return undefined;
      // some browsers pause an autoplaying video the moment it becomes audible,
      // and a muted autoplay that is unmuted by a tap must keep running
      const resume = () => {
        if (video.paused) video.play().catch(() => {});
      };
      resume();
      const a = window.setTimeout(resume, 80);
      const b = window.setTimeout(resume, 450);
      return () => {
        window.clearTimeout(a);
        window.clearTimeout(b);
      };
    }, [muted]);

    useEffect(() => {
      try {
        window.localStorage.setItem("stashTok.speed", String(speed));
      } catch (e) {
        /* ignore */
      }
      if (rateBadge) return undefined;
      /* apply to every rendered clip, not just the one flagged active: on a deep
         link that flag can be missing, and then the rate never reached the video.
         Re-apply on metadata/play too, because a fresh source resets playbackRate. */
      const apply = () => {
        document.querySelectorAll(".stk-video").forEach((el) => {
          if (Math.abs(el.playbackRate - speed) > 0.01) el.playbackRate = speed;
        });
      };
      apply();
      const stage = stageRef.current;
      if (!stage) return undefined;
      stage.addEventListener("loadedmetadata", apply, true);
      stage.addEventListener("play", apply, true);
      return () => {
        stage.removeEventListener("loadedmetadata", apply, true);
        stage.removeEventListener("play", apply, true);
      };
    }, [speed, index, rateBadge]);

    /** the scale at which the video covers the stage, i.e. a pinch-fill */
    function coverScale() {
      const video = activeVideo();
      if (!video) return 1;
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      /* measure the stage live: the cached box lags the first paint (the desktop
         rail settles a frame or two late), and this number is the zoom a pan starts
         from, so a stale read shows up as the picture jumping under the finger */
      const stage = stageRef.current;
      const ew = (stage && stage.clientWidth) || (stageBox().w || 1);
      const eh = (stage && stage.clientHeight) || (stageBox().h || 1);
      const videoAspect = vw / vh;
      const stageAspect = ew / eh;
      const contentW = stageAspect > videoAspect ? eh * videoAspect : ew;
      const contentH = stageAspect > videoAspect ? eh : ew / videoAspect;
      return Math.max(ew / contentW, eh / contentH);
    }

    function toggleFill() {
      if (tf.current.s > 1.02) {
        resetZoom();
        return;
      }
      const target = clamp(coverScale(), 1, MAX_ZOOM);
      /* the same number the framing lands on, so applyTransform's cover test
         (which reads the cache) recognises it as a fill */
      coverRef.current = target;
      tf.current = { s: target, x: 0, y: 0 };
      applyTransform();
      buzz(6);
    }

    /* take the clip out of the feed: the next one slides into its slot, so there
       is nothing to "scroll" and nothing to come back to when swiping up */
    function dropCurrent() {
      if (!item) return;
      const key = item.key;
      setSheet(null);
      setItems((prev) => {
        const at = prev.findIndex((entry) => entry.key === key);
        if (at < 0) return prev;
        return prev.slice(0, at).concat(prev.slice(at + 1));
      });
      /* the next clip slides into this slot; only clamp when we flagged the last one */
      setIndex((cur) => Math.max(0, Math.min(cur, items.length - 2)));
    }

    function flagCurrent() {
      if (!item) return;
      dropCurrent();
      buzz(40);
      flagScene(item.scene, cfg).catch(() => {});
    }

    /* ---- the clip panel's two flags ---------------------------------- */

    /* a duplicate flag can be any of the library's "_Duplicate*" tags, so the
       state is matched by name, exactly like duplicateTagIds() filters */
    function sceneDupeTagged(scene) {
      return !!scene && (scene.tags || []).some((tag) => {
        const name = String(tag.name || "").replace(/^_+/, "");
        if (/whitelist|exclude/i.test(name)) return false;
        return /^duplicate/i.test(name) || /^dupe$/i.test(name);
      });
    }

    /* one write, then mirror it into the feed item so reopening the panel reads
       the new state without a refetch */
    function commitSceneTag(tagId, name, add) {
      if (!item || !tagId) return;
      const sceneId = item.scene.id;
      (add ? addSceneTags(sceneId, [String(tagId)]) : removeSceneTags(sceneId, [String(tagId)])).catch(() => {});
      setItems((prev) =>
        prev.map((entry) => {
          if (String(entry.scene.id) !== String(sceneId)) return entry;
          const kept = (entry.scene.tags || []).filter((tag) => String(tag.id) !== String(tagId));
          return Object.assign({}, entry, {
            scene: Object.assign({}, entry.scene, {
              tags: add ? kept.concat([{ id: String(tagId), name }]) : kept,
            }),
          });
        })
      );
    }

    async function toggleFlagTag(on) {
      const name = cfg.flagTag || FLAG_TAG_FALLBACK;
      const id = await ensureFlagTag(name).catch(() => null);
      if (id) commitSceneTag(id, name, on);
    }

    async function toggleDupeTag(on) {
      const found = await gql(
        `query StashTokDupePick { findTags(filter: { per_page: 200, q: "duplicate" }) { tags { id name } } }`
      )
        .then((data) =>
          ((data.findTags && data.findTags.tags) || []).filter((tag) => {
            const name = String(tag.name || "").replace(/^_+/, "");
            if (/whitelist|exclude/i.test(name)) return false;
            return /^duplicate/i.test(name) || /^dupe$/i.test(name);
          })[0]
        )
        .catch(() => null);
      let id = found && found.id;
      let name = (found && found.name) || "_DuplicateMarkForDeletion";
      if (!id) {
        const made = await gql(
          `mutation StashTokMakeDupeTag($name: String!) { tagCreate(input: { name: $name }) { id name } }`,
          { name }
        ).catch(() => null);
        if (!made || !made.tagCreate) return;
        id = made.tagCreate.id;
        name = made.tagCreate.name;
        DUPE_TAG_IDS = null;
      }
      commitSceneTag(id, name, on);
    }

    function rotate(delta) {
      setRotation((value) => (value + delta + 360) % 360);
      buzz(8);
    }

    /* ---- hud auto hide --------------------------------------------- */

    const poke = useCallback(() => {
      /* a cleared display stays clear: the gestures work, nothing comes back */
      if (clearDisplay) return;
      setHud(true);
      setHudTick((n) => n + 1);
    }, [clearDisplay]);

    useEffect(() => {
      /* desktop keeps the chrome up: there is room for it, and hiding the labels on
         a big screen means hunting for controls that were already out of the way */
      if (desktop) {
        setHud(true);
        return undefined;
      }
      if (!playing || sheet || scrubbing) return undefined;
      const timer = window.setTimeout(() => setHud(false), 3200);
      return () => window.clearTimeout(timer);
    }, [playing, sheet, scrubbing, hudTick, index, desktop]);

    /* the bottom tab bar sits outside this view, so clear mode reaches it through
       the body; the effect cleanup keeps it off every other screen */
    useEffect(() => {
      document.body.classList.toggle("stk-clear-mode", clearDisplay);
      return () => document.body.classList.remove("stk-clear-mode");
    }, [clearDisplay]);

    /* ---- zoom ------------------------------------------------------ */

    const playGuarded = useCallback((video) => {
      if (!video) return;
      const started = video.play();
      if (started && started.catch) {
        started.then(() => setPlaying(true)).catch(() => {
          // autoplay-with-sound was refused: keep the video moving, muted
          video.muted = true;
          setMuted(true);
          video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        });
      } else {
        setPlaying(true);
      }
    }, []);

    /* A frame that exactly fills the stage is drawn with object-fit:cover instead
       of a scale transform. Scaling the full-pane element by the cover factor makes
       the compositor allocate a layer at the scaled size — on a 1360x900 pane at
       2x that is ~49 megapixels per frame, most of it pillarbox that gets clipped
       away. object-fit:cover keeps the composited layer at stage size and lets the
       sampler do the crop: the same picture for ~10x fewer composited pixels. Only
       a pinch or a pan leaves this path. */
    const [fillMode, setFillMode] = useState(false);
    const fillModeRef = useRef(false);
    fillModeRef.current = fillMode;

    /* the object-fit is an inline style owned by React, so the handoff has to be a
       render, not a class: this runs in the same commit as the object-fit change,
       which is why the picture never jumps between the two framings */
    useLayoutEffect(() => {
      const video = activeVideo();
      if (!video) return;
      if (fillMode) {
        video.style.transition = "none";
        video.style.transform = "";
      }
    }, [fillMode]);

    const applyTransform = useCallback((animate) => {
      const video = activeVideo();
      if (!video) return;
      const { s, x, y } = tf.current;
      const atCover =
        Math.abs(s - coverRef.current) < 0.004 && Math.abs(x) < 0.5 && Math.abs(y) < 0.5;
      if (atCover) {
        if (animate) {
          /* keep the ease on the transform, then hand the finished frame over */
          video.style.transition = "transform 240ms cubic-bezier(.22,1,.36,1)";
          video.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
          let fallback = 0;
          const done = () => {
            video.removeEventListener("transitionend", done);
            window.clearTimeout(fallback);
            setFillMode(true);
          };
          fallback = window.setTimeout(done, 260);
          video.addEventListener("transitionend", done, { once: true });
        } else {
          setFillMode(true);
        }
      } else {
        setFillMode(false);
        video.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
        /* a zoom step eases; a drag or a pinch must follow the finger exactly */
        video.style.transition = animate ? "transform 240ms cubic-bezier(.22,1,.36,1)" : "none";
      }
      setZoom(s);
    }, []);

    const clampPan = useCallback(() => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const maxX = (rect.width * (tf.current.s - 1)) / 2;
      const maxY = (rect.height * (tf.current.s - 1)) / 2;
      tf.current.x = clamp(tf.current.x, -maxX, maxX);
      tf.current.y = clamp(tf.current.y, -maxY, maxY);
    }, []);

    const resetZoom = useCallback(() => {
      tf.current = { s: 1, x: 0, y: 0 };
      applyTransform();
    }, [applyTransform]);

    /* ---- portrait auto-crop ---------------------------------------
       A landscape clip on a tall phone screen is framed in three steps: auto
       (the outer quarter of each side is cut, so the middle half shows), full
       frame, then fill the device height. Two fingers still zoom freely; the
       cycle only decides where a double tap starts from. */

    const CROP_SCALE = 1 / (1 - CROP_SIDE * 2);
    /* portrait clips fill the frame too, as long as no edge loses more than a
       fifth of the picture: 0.4 of the frame in total, i.e. 20 % per edge */
    const NEAR_RATIO = 0.4;

    /** why this clip wants cropping: "wide" (16:9 on a phone), "near" (a hair
        off, so the bars are the only thing lost), or "" for leave it alone. */
    const cropKind = useCallback(() => {
      /* Settings → Auto-crop to fill; on unless the user turned it off */
      if (prefs.autoCrop === false || (fullscreen && fullscreenFit !== "auto")) return "";
      const video = activeVideo();
      if (!video) return "";
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      const box = stageBox();
      const sw = box.w || 0;
      const sh = box.h || 0;
      if (!vw || !vh || !sw || !sh) return "";
      /* only a tall screen is worth filling; a wide pane keeps its letterbox */
      if (sh <= sw) return "";
      const vr = vw / vh;
      const sr = sw / sh;
      if (vr >= 1.5) return "wide";
      const lost = vr > sr ? 1 - sr / vr : 1 - vr / sr;
      return lost <= NEAR_RATIO ? "near" : "";
    }, [activeVideo, prefs.autoCrop, fullscreen, fullscreenFit]);

    const cropEligible = useCallback(() => !!cropKind(), [cropKind]);

    /** the scale a framing step lands on; "auto" is the middle half of a wide
        clip and a plain fill for one nearly the screen's ratio */
    const cropScaleFor = (mode, kind) => {
      if (mode === "full") return 1;
      const cover = clamp(coverScale(), 1, MAX_ZOOM);
      if (mode === "height") return cover;
      return kind === "wide" ? CROP_SCALE : cover;
    };

    /** is the frame zoomed by the user (a pinch) rather than by the crop step?
        Derived from the numbers, because a stale flag here swallows a tap. */
    const userZoomed = useCallback(() => {
      const s = tf.current.s;
      if (s <= 1.02) return false;
      const kind = cropKind();
      if (!kind) return true;
      return Math.abs(s - cropScaleFor(cropModeRef.current, kind)) > 0.02;
    }, [cropKind]);

    const applyCrop = useCallback(
      (mode, animate, reset) => {
        if (!activeVideo()) return;
        /* the user's pinch owns the transform: a media event (canplay re-fires on
           every re-buffer) must not pull a zoomed frame back to the crop scale
           mid-grab, which is what made a zoomed pan snap to 1x a beat later */
        /* the cached cover is the number a pan starts from, so keep it honest even
           when a pinch owns the framing and this call returns early */
        const prevCover = coverRef.current;
        coverRef.current = coverScale();
        if (!reset && userZoomed()) {
          /* a resize can move the cover scale under a frame that is already filled;
             keep the cached zoom in step with what is on screen so a pan still
             starts exactly where the picture is */
          if (Math.abs(tf.current.s - prevCover) < 0.004 &&
              Math.abs(coverRef.current - prevCover) > 0.004) {
            tf.current.s = coverRef.current;
            applyTransform();
          }
          return;
        }
        const kind = cropKind();
        const s = kind ? cropScaleFor(mode, kind) : 1;
        /* canplay fires again on every re-buffer, and this runs from it: without
           this guard a grab on a cropped clip snapped back to centre mid-pan.
           Only a new clip, a framing step or a scale change recentres. */
        const keepPan = !reset && Math.abs((tf.current.s || 1) - s) < 0.001;
        tf.current = {
          s,
          x: keepPan ? tf.current.x : 0,
          y: keepPan ? tf.current.y : 0,
        };
        cropZoomRef.current = kind ? s > 1.02 : false;
        applyTransform(animate);
      },
      [activeVideo, cropKind, applyTransform]
    );

    cropRefreshRef.current = () => applyCrop(cropModeRef.current, false, false);
    useEffect(() => {
      cropRefreshRef.current();
    }, [fullscreen, fullscreenFit]);

    const cropLabel = (mode) =>
      mode === "full" ? "Full frame" : mode === "height" ? "Fill height" : cropKind() === "wide" ? "Crop 50%" : "Fill frame";

    /** double tap: auto → full → height → auto. A near-ratio portrait clip has
        only two useful framings (fill and full frame), so it flips between them. */
    const cycleCrop = useCallback(() => {
      const kind = cropKind();
      if (!kind) {
        toggleFill();
        return;
      }
      const current = cropModeRef.current;
      const next =
        kind === "near"
          ? current === "full" ? "auto" : "full"
          : current === "auto" ? "full" : current === "full" ? "height" : "auto";
      cropModeRef.current = next;
      setCropMode(next);
      try {
        window.localStorage.setItem("stashTok.crop", next);
      } catch (e) {
        /* ignore */
      }
      applyCrop(next, true, true);
      window.clearTimeout(cropBadgeTimer.current);
      setCropBadge(cropLabel(next));
      cropBadgeTimer.current = window.setTimeout(() => setCropBadge(""), 900);
      buzz(6);
    }, [applyCrop, cropKind]);

    useLayoutEffect(() => {
      const el = quickRef.current;
      if (!el || !quick) return;
      const rect = el.getBoundingClientRect();
      const pad = 8;
      let dx = 0;
      let dy = 0;
      if (rect.left < pad) dx = pad - rect.left;
      if (rect.right > window.innerWidth - pad) dx = window.innerWidth - pad - rect.right;
      if (rect.top < pad) dy = pad - rect.top;
      if (rect.bottom > window.innerHeight - pad) dy = window.innerHeight - pad - rect.bottom;
      /* nudge with left/top so the CSS centring transform stays intact */
      if (dx) el.style.left = quick.x + dx + "px";
      if (dy) el.style.top = quick.y + dy + "px";
    }, [quick]);

    /* ---- navigation ------------------------------------------------ */

    const loopCurrent = useCallback(() => {
      const video = activeVideo();
      if (!video) return;
      video.currentTime = item && item.startAt ? item.startAt : 0;
      playGuarded(video);
    }, [item]);

    /** autoscroll drops the viewer into the action, never into the intro:
        70 % of clips open a quarter to a half in, 30 % near the payoff */
    function autoScrollStart(duration) {
      if (!duration || !isFinite(duration)) return 0;
      const roll = Math.random();
      const fraction = roll < 0.7 ? 0.25 + Math.random() * 0.2 : 0.55 + Math.random() * 0.4;
      return Math.max(0, Math.min(duration - 3, duration * fraction));
    }

    const goNext = useCallback(() => {
      if (spec.single) return;   // one clip on this page: nothing to step to
      resetZoom();
      setDragY(0);
      setSheet(null);
      setPlaying(true);
      setIndex((i) => (i + 1 < items.length ? i + 1 : 0));
    }, [resetZoom, items.length, spec.single]);

    const goPrev = useCallback(() => {
      if (spec.single) return;
      resetZoom();
      setDragY(0);
      setSheet(null);
      setPlaying(true);
      setIndex((i) => Math.max(0, i - 1));
    }, [resetZoom, spec.single]);

    /* Keep the strip at the end of the slide until React commits the new index. */
    useLayoutEffect(() => () => {
      if (slideRef.current) slideRef.current.cancel();
      slideRef.current = null;
    }, [index]);

    const slideStep = useCallback(
      (direction) => {
        if (spec.single || slideRef.current) return;
        const advance = direction > 0 ? goNext : goPrev;
        const wrap = wrapRef.current;
        const stage = stageRef.current;
        const height = stage && stage.clientHeight;
        const target = index + direction;
        if (target < 0 || items.length < 2) {
          setDragY(0);
          return;
        }
        if (!wrap || !height || !wrap.animate || target >= items.length ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          advance();
          return;
        }
        const y = direction > 0 ? -height : height;
        const slide = wrap.animate(
          [{ transform: getComputedStyle(wrap).transform }, { transform: `translateY(${y}px) rotate(${rotation}deg)` }],
          { duration: 190, easing: "cubic-bezier(.22,.61,.36,1)", fill: "forwards" }
        );
        slideRef.current = slide;
        slide.onfinish = advance;
      },
      [goNext, goPrev, index, items.length, rotation, spec.single]
    );

    /* ---- desktop wheel -------------------------------------------------
       A mouse wheel or a two-finger trackpad flick is the desktop form of the
       phone's swipe: one notch, one clip. A trackpad keeps firing wheel events
       from inertia long after the fingers lift, so a gesture is spent once and
       only re-arms after the wheel has been quiet for WHEEL_IDLE; a real mouse
       notch (line/page delta, or a delta far larger than a trackpad's) counts
       on its own. The listener is native and non-passive because React attaches
       wheel passively, and preventDefault is what stops the page scrolling. */
    const wheelRef = useRef({ acc: 0, at: 0, cool: 0 });
    useEffect(() => {
      const WHEEL_STEP = 40; // accumulated px that mean "next"
      const WHEEL_IDLE = 260; // quiet time that starts a new gesture
      const WHEEL_COOL = 260; // ignore the inertia tail after a step
      /* a sheet, the details list or any other scrollable box keeps its wheel */
      const scrolls = (el) => {
        for (let node = el; node && node !== document.body; node = node.parentElement) {
          if (node.nodeType !== 1) continue;
          if (node.scrollHeight - node.clientHeight > 4) {
            const oy = window.getComputedStyle(node).overflowY;
            if (oy === "auto" || oy === "scroll") return true;
          }
        }
        return false;
      };
      const onWheel = (event) => {
        const stage = stageRef.current;
        if (!stage || !event.target) return;
        /* the whole feed shell answers, not just the video box: a wheel over the
           caption, the scrub bar or the desktop rail is still "next clip". The
           shell only holds the feed while this tab is the one on screen, and any
           dialog is portaled to document.body, so a sheet keeps its own wheel. */
        const shell = stage.closest(".stk-fixed") || stage;
        if (!shell.contains(event.target)) return;
        if (event.ctrlKey) return; // trackpad pinch-zoom
        if (sheet || quick || people || tagOpen) return;
        if (event.target.closest && event.target.closest(".stk-vr-canvas")) return; // VR owns its wheel
        if (event.target.closest && event.target.closest("input, textarea, select")) return;
        if (scrolls(event.target)) return;
        if (!event.deltaY) return;
        event.preventDefault();
        const now = performance.now();
        const w = wheelRef.current;
        const notch = event.deltaMode !== 0 || Math.abs(event.deltaY) >= 90;
        if (now < w.cool) {
          w.acc = 0;
          return;
        }
        if (notch || now - w.at > WHEEL_IDLE) w.acc = 0;
        w.at = now;
        w.acc += event.deltaY;
        if (Math.abs(w.acc) < (notch ? 1 : WHEEL_STEP)) return;
        const direction = w.acc > 0 ? 1 : -1;
        w.acc = 0;
        w.cool = now + WHEEL_COOL;
        slideStep(direction);
      };
      document.addEventListener("wheel", onWheel, { passive: false });
      return () => document.removeEventListener("wheel", onWheel);
    }, [slideStep, sheet, quick, people, tagOpen]);

    /** pull-to-refresh at the top of the feed: refetch page 1 and start over */
    const refreshFeed = useCallback(() => {
      buzz(12);
      reshufflePools();
      setRefreshTick((n) => n + 1);
      window.clearTimeout(cropBadgeTimer.current);
      setCropBadge("Refreshed");
      cropBadgeTimer.current = window.setTimeout(() => setCropBadge(""), 900);
    }, []);

    /* ---- autoscroll -------------------------------------------------
       A 15 s dwell per clip, restarted whenever the clip changes. It stops while
       the viewer is paused or has a sheet/menu open, so touching the screen never
       yanks the clip away mid-action. A clip that ends first simply advances. */
    useEffect(() => {
      if (!autoScroll || !playing || sheet || quick || tagOpen || people || scrubbing) return undefined;
      const timer = window.setTimeout(() => {
        if (document.hidden) return;
        goNext();
        buzz(6);
      }, 15000);
      return () => window.clearTimeout(timer);
    }, [autoScroll, index, playing, sheet, quick, tagOpen, people, scrubbing, goNext]);


    /* ---- rating ---------------------------------------------------- */

    const commitRating = useCallback(
      async (value) => {
        if (!item) return;
        setRating(value);
        try {
          await setSceneRating(item.scene.id, value);
        } catch (err) {
          setError(String(err.message || err));
        }
      },
      [item]
    );

    const toggleHeart = useCallback(() => {
      if (!item) return;
      const next = rating != null && rating >= cfg.heartRating ? null : cfg.heartRating;
      commitRating(next);
      if (next != null) setHeartBurst((n) => n + 1);
      buzz(12);
    }, [item, rating, cfg.heartRating, commitRating]);

    /* Opening the sheet does no work at all: no vocabulary request, no
       thumbnails, no images. Names are resolved when the user commits, so the
       sheet is on screen before the first frame is painted. */
    const openTagSheet = useCallback(() => {
      if (!item) return;
      setTagOpen(true);
      setTagFilter("");
      setTagQueue([]);
      setTagSugg([]);
      setTagSuggSel(-1);
      setTagPicked({});
      setTagCat("");
      setTagKids({});
      setTagShown({});
    }, [item]);

    /* merge tags into the clip on screen so the caption updates without a refetch */
    const mergeSceneTags = useCallback(
      (sceneId, added) => {
        setItems((prev) =>
          prev.map((entry) => {
            if (!entry.scene || String(entry.scene.id) !== String(sceneId)) return entry;
            const have = entry.scene.tags || [];
            return Object.assign({}, entry, {
              scene: Object.assign({}, entry.scene, {
                tags: have.concat(added.filter((tag) => !have.some((old) => String(old.id) === String(tag.id)))),
              }),
            });
          })
        );
      },
      [setItems]
    );

    /* undo: hold the last write for a few seconds and take the tags back off */
    const noteUndo = useCallback((entry) => {
      window.clearTimeout(undoTimer.current);
      const count = (entry.sceneTagIds || []).length + (entry.performerTagIds || []).length;
      if (!count) {
        setUndo(null);
        return;
      }
      setUndo(Object.assign({}, entry, { count }));
      undoTimer.current = window.setTimeout(() => setUndo(null), 9000);
    }, []);

    const unmergeSceneTags = useCallback(
      (sceneId, ids) => {
        const drop = new Set((ids || []).map(String));
        if (!drop.size) return;
        setItems((prev) =>
          prev.map((entry) => {
            if (!entry.scene || String(entry.scene.id) !== String(sceneId)) return entry;
            return Object.assign({}, entry, {
              scene: Object.assign({}, entry.scene, {
                tags: (entry.scene.tags || []).filter((tag) => !drop.has(String(tag.id))),
              }),
            });
          })
        );
      },
      [setItems]
    );

    const revertUndo = useCallback(async () => {
      const current = undo;
      if (!current) return;
      setUndo(null);
      window.clearTimeout(undoTimer.current);
      try {
        if (current.sceneTagIds.length) await removeSceneTags(current.sceneId, current.sceneTagIds);
        if (current.performerId && current.performerTagIds.length) {
          await removePerformerTags(current.performerId, current.performerTagIds);
        }
        unmergeSceneTags(current.sceneId, current.sceneTagIds);
        buzz(8);
      } catch (err) {
        setError(String(err.message || err));
      }
    }, [undo, unmergeSceneTags]);

    /* Ethnicity is the one picker that writes twice: a performer tag and the
       scene tag(s). Only Black carries the extra Ebony scene tag. A performer
       whose ethnicity is already filled in is left alone — on Wario the field is
       populated, on the OF library it is not, and a scene must not rewrite it. */
    const applyEthnicity = useCallback(
      async (eth) => {
        if (!item || !item.scene || ethBusy) return;
        /* already fully tagged: no write at all, the circle is just reporting it */
        const present = new Set((item.scene.tags || []).map((tag) => String(tag.name).trim().toLowerCase()));
        if (eth.scene.every((name) => present.has(name.trim().toLowerCase()))) return;
        const performer = (item.scene.performers || [])[0] || null;
        const locked = !!(performer && String(performer.ethnicity || "").trim());
        setEthBusy(eth.name);
        try {
          const sceneIds = [];
          for (let i = 0; i < eth.scene.length; i += 1) {
            sceneIds.push(await ensureTagId(eth.scene[i], tagIdCache.current));
          }
          const hadScene = new Set((item.scene.tags || []).map((tag) => String(tag.id)));
          let performerIds = [];
          let addedPerformer = [];
          if (performer && performer.id && !locked) {
            const hadPerformer = new Set(await performerTagIds(performer.id));
            for (let i = 0; i < eth.performer.length; i += 1) {
              performerIds.push(await ensureTagId(eth.performer[i], tagIdCache.current));
            }
            addedPerformer = performerIds.filter((id) => !hadPerformer.has(String(id)));
            await addPerformerTags(performer.id, performerIds);
          }
          await addSceneTags(item.scene.id, sceneIds);
          mergeSceneTags(item.scene.id, eth.scene.map((name, i) => ({ id: sceneIds[i], name })));
          noteUndo({
            sceneId: item.scene.id,
            sceneTagIds: sceneIds.filter((id) => !hadScene.has(String(id))),
            performerId: locked ? null : (performer && performer.id) || null,
            performerTagIds: addedPerformer,
            label: eth.name + (locked ? " (scene only)" : ""),
          });
          buzz(12);
        } catch (err) {
          setError(String(err.message || err));
        } finally {
          setEthBusy("");
        }
      },
      [item, ethBusy, mergeSceneTags, noteUndo]
    );

    /* ---- free-text entry -----------------------------------------------
       `T` opens the sheet with the caret already in the field. Comma or Tab
       closes the word into a chip and readies the field for the next one, so
       "oil, outdoors, tv" types five tags without leaving the keyboard. Names
       are title-cased as they are typed and resolved against the library at
       write time, which is where a tag that does not exist yet gets created. */
    const appendTagNames = useCallback((names) => {
      const add = (names || []).filter(Boolean);
      if (!add.length) return;
      setTagQueue((prev) => {
        const have = {};
        prev.forEach((name) => {
          have[name.toLowerCase()] = true;
        });
        const extra = add.filter((name) => {
          if (have[name.toLowerCase()]) return false;
          have[name.toLowerCase()] = true;
          return true;
        });
        return extra.length ? prev.concat(extra) : prev;
      });
    }, []);

    const commitTagField = useCallback(() => {
      const names = splitTagInput(tagFilter);
      if (!names.length) {
        /* a field holding only separators is not a tag: clear it so the next
           word starts clean instead of "Oilwith" */
        if (tagFilter) setTagFilter("");
        return false;
      }
      appendTagNames(names);
      setTagFilter("");
      setTagSugg([]);
      setTagSuggSel(-1);
      return true;
    }, [tagFilter, appendTagNames]);

    /* the sheet opens on the field, not on the close button useDialog focuses */
    useEffect(() => {
      if (!tagOpen) return undefined;
      const timer = window.setTimeout(() => {
        const el = tagInputRef.current;
        if (el && el.focus) el.focus();
      }, 40);
      return () => window.clearTimeout(timer);
    }, [tagOpen]);

    /* autocomplete: debounced library lookup, and a sequence guard so a slow
       response for "oi" cannot overwrite the list for "oil" */
    useEffect(() => {
      if (!tagOpen) {
        setTagSugg([]);
        return undefined;
      }
      const q = tagFilter.trim();
      if (!q) {
        setTagSugg([]);
        setTagSuggSel(-1);
        return undefined;
      }
      const seq = tagSuggSeq.current + 1;
      tagSuggSeq.current = seq;
      const timer = window.setTimeout(() => {
        searchTagNames(q, 10)
          .then((rows) => {
            if (tagSuggSeq.current !== seq) return;
            setTagSugg(rows);
            setTagSuggSel(-1);
          })
          .catch(() => undefined);
      }, 130);
      return () => window.clearTimeout(timer);
    }, [tagFilter, tagOpen]);

    const commitTags = useCallback(async () => {
      /* read the performer here rather than closing over a value declared later
         in the component: the dependency array is evaluated at render time */
      const ethPerformer = ((item && item.scene && item.scene.performers) || [])[0] || null;
      const ethLocked = !!(ethPerformer && String(ethPerformer.ethnicity || "").trim());
      const picked = Object.keys(tagPicked).filter((name) => tagPicked[name]);
      const kids = Object.keys(tagKids).filter((name) => tagKids[name]);
      /* a name typed but not yet closed with a comma still counts: hitting Done
         right after typing must not silently drop it */
      const pending = splitTagInput(tagFilter);
      const base = [];
      const seen = {};
      pending.concat(tagQueue, picked, tagCat ? [tagCat] : [], kids).forEach((name) => {
        const key = String(name).trim().toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        base.push(String(name).trim());
      });

      /* an ethnicity chip carries its scene pair (Ebony writes Black + Ebony)
         and, when the performer has no ethnicity yet, is a fact about her too */
      const names = [];
      const sceneSeen = {};
      const performerNames = [];
      base.forEach((name) => {
        const eth = ETHNICITY_TAGS.find((row) => row.name.toLowerCase() === name.toLowerCase());
        (eth ? eth.scene : [name]).forEach((tagName) => {
          const key = tagName.trim().toLowerCase();
          if (!key || sceneSeen[key]) return;
          sceneSeen[key] = true;
          names.push(tagName.trim());
        });
        if (eth && ethPerformer && !ethLocked) {
          eth.performer.forEach((tagName) => {
            if (performerNames.indexOf(tagName) < 0) performerNames.push(tagName);
          });
        }
      });

      if (!item || !item.scene || !names.length) {
        setTagOpen(false);
        return;
      }
      setTagBusy(true);
      try {
        const ids = [];
        for (let i = 0; i < names.length; i += 1) {
          ids.push(await ensureTagId(names[i], tagIdCache.current));
        }
        const hadScene = new Set((item.scene.tags || []).map((tag) => String(tag.id)));
        await addSceneTags(item.scene.id, ids);
        mergeSceneTags(item.scene.id, names.map((name, i) => ({ id: ids[i], name })));

        let performerTagIds = [];
        if (performerNames.length && ethPerformer && !ethLocked) {
          for (let i = 0; i < performerNames.length; i += 1) {
            performerTagIds.push(await ensureTagId(performerNames[i], tagIdCache.current));
          }
          await addPerformerTags(ethPerformer.id, performerTagIds);
        }

        noteUndo({
          sceneId: item.scene.id,
          sceneTagIds: ids.filter((id) => !hadScene.has(String(id))),
          performerId: performerTagIds.length ? ethPerformer.id : null,
          performerTagIds: performerTagIds,
          label: names.length === 1 ? names[0] : names.length + " tags",
        });
        setTagPicked({});
        setTagQueue([]);
        setTagFilter("");
        setTagSugg([]);
        setTagCat("");
        setTagKids({});
        setTagOpen(false);
      } catch (err) {
        setError(String(err.message || err));
      } finally {
        setTagBusy(false);
      }
    }, [item, tagPicked, tagKids, tagCat, tagQueue, tagFilter, mergeSceneTags, noteUndo]);

    /* ---- markers -------------------------------------------------------
       A Stash SceneMarker is a start point (seconds) plus a primary tag; the
       end is optional, so an in point is the whole of what "add a marker"
       needs. The tag is the marker's name: typed in, or taken from the
       prefilled Positions & Acts / Fetish lists. */
    const mergeSceneMarker = useCallback(
      (sceneId, marker) => {
        setItems((prev) =>
          prev.map((entry) => {
            if (!entry.scene || String(entry.scene.id) !== String(sceneId)) return entry;
            const have = entry.scene.scene_markers || [];
            if (have.some((old) => String(old.id) === String(marker.id))) return entry;
            return Object.assign({}, entry, {
              scene: Object.assign({}, entry.scene, { scene_markers: have.concat([marker]) }),
            });
          })
        );
      },
      [setItems]
    );

    const unmergeSceneMarker = useCallback(
      (sceneId, markerId) => {
        setItems((prev) =>
          prev.map((entry) =>
            entry.scene && String(entry.scene.id) === String(sceneId)
              ? Object.assign({}, entry, {
                  scene: Object.assign({}, entry.scene, {
                    scene_markers: (entry.scene.scene_markers || []).filter(
                      (marker) => String(marker.id) !== String(markerId)
                    ),
                  }),
                })
              : entry
          )
        );
      },
      [setItems]
    );

    const openMarkerSheet = useCallback(
      (at) => {
        if (!item || !item.scene) return;
        const video = activeVideo();
        const total = duration || (video && video.duration) || 0;
        const raw = Number(at != null ? at : video ? video.currentTime : 0) || 0;
        const seconds = Math.max(0, total ? Math.min(total - 0.05, raw) : raw);
        setCtxMenu(null);
        setMarkerName("");
        setMarkerAt(Math.round(seconds * 100) / 100);
        setMarkerShown({});
      },
      [item, duration, activeVideo]
    );

    const createMarker = useCallback(async () => {
      const name = markerName.trim();
      if (!name || markerAt == null || !item || !item.scene || markerBusy) return;
      const sceneId = item.scene.id;
      setMarkerBusy(true);
      try {
        const tagId = await ensureTagId(name, tagIdCache.current);
        const data = await gql(
          `mutation StashTokMarkerCreate($sceneId: ID!, $seconds: Float!, $tagId: ID!, $title: String!) {
            sceneMarkerCreate(input: { scene_id: $sceneId, seconds: $seconds, primary_tag_id: $tagId, title: $title }) {
              id seconds end_seconds title primary_tag { id name }
            }
          }`,
          { sceneId, seconds: markerAt, tagId, title: name }
        );
        const marker = data.sceneMarkerCreate;
        mergeSceneMarker(sceneId, marker);
        setMarkerAt(null);
        setMarkerName("");
        window.clearTimeout(markerUndoTimer.current);
        setMarkerUndo({ sceneId, markerId: marker.id, label: name, seconds: marker.seconds });
        markerUndoTimer.current = window.setTimeout(() => setMarkerUndo(null), 9000);
        buzz(14);
      } catch (err) {
        setError(String((err && err.message) || err));
      } finally {
        setMarkerBusy(false);
      }
    }, [markerName, markerAt, item, markerBusy, mergeSceneMarker]);

    const revertMarker = useCallback(async () => {
      const current = markerUndo;
      if (!current) return;
      setMarkerUndo(null);
      window.clearTimeout(markerUndoTimer.current);
      try {
        await gql(`mutation StashTokMarkerDestroy($id: ID!) { sceneMarkerDestroy(id: $id) }`, { id: current.markerId });
        unmergeSceneMarker(current.sceneId, current.markerId);
        buzz(8);
      } catch (err) {
        setError(String((err && err.message) || err));
      }
    }, [markerUndo, unmergeSceneMarker]);

    /* No autofocus: a phone raises the keyboard the moment the field takes the
       caret, and the whole point of this sheet is the prefilled pills — tapping
       one names the marker without typing at all. The field is there for the
       occasional custom name, and it still works the moment it is tapped. */

    /* desktop keyboard map. Every control has a key that matches what the rest of
       the web uses: space/K play, arrows seek, , and . nudge a frame, digits jump,
       L likes, M mutes, I details, O the scene in Stash, / search, R reshuffle,
       Enter the performer, Backspace/Esc back. */
    useEffect(() => {
      /* No desktop gate: an iPad with a Magic Keyboard is a touch device that types,
         and its arrow keys must step the feed like a laptop's. iOS also reports the
         odd key as "Unidentified", so fall back to keyCode. */
      const CODE_KEYS = {
        8: "Backspace", 9: "Tab", 13: "Enter", 27: "Escape", 32: " ", 33: "PageUp", 34: "PageDown",
        35: "End", 36: "Home", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown",
        188: ",", 190: ".",
      };
      function onKey(event) {
        const tag = (event.target && event.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || (event.target && event.target.isContentEditable)) return;
        const video = activeVideo ? activeVideo() : null;
        const key = event.key && event.key !== "Unidentified" ? event.key : CODE_KEYS[event.keyCode] || "";
        if (fullscreen && (key === "Tab" || (tag === "BUTTON" && (key === "Enter" || key === " ")))) return;
        if (key === "ArrowDown" || key === "PageDown") {
          event.preventDefault();
          goNext();
        } else if (key === "ArrowUp" || key === "PageUp") {
          event.preventDefault();
          goPrev();
        } else if (key === "Home") {
          event.preventDefault();
          setIndex(0);
        } else if (key === "End") {
          event.preventDefault();
          setIndex(Math.max(0, items.length - 1));
        } else if (key === "Enter") {
          /* enter opens whoever posted this clip */
          event.preventDefault();
          openHandle();
        } else if (key === "Backspace" || key === "Escape") {
          event.preventDefault();
          /* escape peels one layer first: sheet, quick menu, then back */
          if (sheet) setSheet(null);
          else if (quick) setQuick(null);
          else if (fullscreen && key === "Escape") exitFullscreen();
          else if (onBack) onBack();
        } else if (key === "Tab") {
          event.preventDefault();
          if (event.shiftKey) goPrev();
          else goNext();
        } else if (key === "ArrowRight" || key === "ArrowLeft") {
          if (!video) return;
          event.preventDefault();
          /* shift = a tenth of the clip, plain = five seconds */
          const total = video.duration || 0;
          const step = event.shiftKey ? total * 0.1 : 5;
          const delta = key === "ArrowRight" ? step : -step;
          video.currentTime = Math.max(0, Math.min(total - 0.2, video.currentTime + delta));
          setScrubTime(video.currentTime);
        } else if (key === "." || key === ",") {
          /* frame step, for finding the exact frame to stop on */
          if (!video) return;
          event.preventDefault();
          const total = video.duration || 0;
          const next = video.currentTime + (key === "." ? 1 / 25 : -1 / 25);
          video.currentTime = Math.max(0, Math.min(total - 0.05, next));
          setScrubTime(video.currentTime);
        } else if (/^[0-9]$/.test(key)) {
          /* 1..9 jump to that tenth of the clip, 0 goes back to the start */
          if (!video || !video.duration) return;
          event.preventDefault();
          const at = video.duration * (Number(key) / 10);
          video.currentTime = Math.max(0, Math.min(video.duration - 0.2, at));
          setScrubTime(video.currentTime);
        } else if (key === " " || key === "k" || key === "K") {
          event.preventDefault();
          if (!video) return;
          if (video.paused) playGuarded(video);
          else video.pause();
        } else if (key === "l" || key === "L") {
          event.preventDefault();
          toggleHeart();
        } else if (key === "f" || key === "F") {
          event.preventDefault();
          flagCurrent();
        } else if (key === "i" || key === "I") {
          event.preventDefault();
          setSheet((cur) => (cur === "details" ? null : "details"));
        } else if (key === "o" || key === "O") {
          /* the same page Stash itself would show, in a new tab */
          const id = item && item.scene && item.scene.id;
          if (!id) return;
          event.preventDefault();
          window.open(window.location.origin + "/scenes/" + id, "_blank", "noopener");
        } else if (key === "v" || key === "V") {
          event.preventDefault();
          setVrMode((on) => !on);
        } else if (key === "m" || key === "M") {
          /* M adds a marker at the playhead. Mute moved into the clip panel,
             where it is a visible control instead of a hidden shortcut. */
          event.preventDefault();
          openMarkerSheet();
        } else if (key === "t" || key === "T") {
          /* T tags the clip: the sheet opens with the caret in the field, so
             "oil, outdoors, tv" is five tags without touching the pointer */
          event.preventDefault();
          if (!tagOpen) openTagSheet();
        } else if (key === "r" || key === "R") {
          event.preventDefault();
          refreshFeed();
        } else if (key === "/") {
          if (!onSearch) return;
          event.preventDefault();
          onSearch();
        }
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [desktop, goNext, goPrev, toggleHeart, flagCurrent, vrMode, sheet, quick, items, refreshFeed, onSearch, onBack,
      fullscreen, exitFullscreen, openMarkerSheet, openTagSheet, tagOpen]);

    /* ---- scrubber sprites -----------------------------------------
       Stash already renders a sprite sheet plus a WebVTT index for scenes with
       generated thumbnails; the timeline just reads that instead of asking ffmpeg
       for a frame per hover. */
    const sceneIdForSprite = item && item.scene ? item.scene.id : "";
    useEffect(() => {
      const scene = item && item.scene;
      if (!scene) return undefined;
      const vttPath = rel(scene.paths && scene.paths.vtt);
      const spritePath = rel(scene.paths && scene.paths.sprite);
      spriteRef.current = { key: String(scene.id), cues: [], ok: false, src: spritePath || "", sheetW: 0, sheetH: 0 };
      if (spriteTick) setSpriteTick(0);
      setSnapFail(false);
      let alive = true;
      /* the sheet's own pixel size, needed to blow one cell up to the stage */
      if (spritePath) {
        const sheet = new Image();
        sheet.onload = () => {
          if (!alive) return;
          spriteRef.current = Object.assign({}, spriteRef.current, {
            sheetW: sheet.naturalWidth,
            sheetH: sheet.naturalHeight,
          });
          setSpriteTick((n) => n + 1);
        };
        sheet.src = spritePath;
      }
      if (!vttPath) return undefined;
      const stamp = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
      const secs = (line) => {
        const m = stamp.exec(line);
        return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0;
      };
      fetch(vttPath, { credentials: "same-origin" })
        .then((res) => (res.ok ? res.text() : ""))
        .then((text) => {
          if (!alive || !text) return;
          const cues = [];
          text.split(/\n\n/).forEach((block) => {
            const box = /#xywh=(\d+),(\d+),(\d+),(\d+)/.exec(block);
            const range = /^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/m.exec(block);
            if (!box || !range) return;
            cues.push({
              start: secs(range[1]),
              end: secs(range[2]),
              x: Number(box[1]),
              y: Number(box[2]),
              w: Number(box[3]),
              h: Number(box[4]),
            });
          });
          if (!cues.length) return;
          spriteRef.current = Object.assign({}, spriteRef.current, {
            key: String(scene.id), cues, ok: true, src: spritePath || "",
          });
          setSpriteTick((n) => n + 1);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [sceneIdForSprite]);

    /* ---- hold to speed -------------------------------------------- */

    const stopHold = useCallback(() => {
      const video = activeVideo();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (video) video.playbackRate = speedRef.current;
      setRateBadge("");
    }, []);

    const startHold = useCallback(
      (side) => {
        const video = activeVideo();
        if (!video) return;
        poke();
        if (side === "left" || side === "right") {
          video.playbackRate = cfg.holdSpeed;
          setRateBadge(`${cfg.holdSpeed}x`);
          buzz(8);
        } else {
          setSheet("actions");
        }
      },
      [cfg.holdSpeed, poke]
    );

    /* ---- pointer gestures ----------------------------------------- */

    function dist(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    /** forget half-finished gestures (app switch, blur, cancel) and restore the rate */
    const dropGestures = useCallback(() => {
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(tapTimer.current);
      window.clearTimeout(cropBadgeTimer.current);
      setCropBadge("");
      tapUndoRef.current = null;
      lastTapAt.current = 0;
      pts.current.clear();
      gesture.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const video = activeVideo();
      if (video) video.playbackRate = speedRef.current;
      setRateBadge("");
    }, [activeVideo]);

    useEffect(() => {
      let wasPlaying = false;
      const onHide = () => {
        const video = activeVideo();
        wasPlaying = !!(video && !video.paused);
        dropGestures();
      };
      const onShow = () => {
        const video = activeVideo();
        if (!video) {
          wasPlaying = false;
          return;
        }
        /* iOS throws the media away while the tab is in the background: the
           element returns with nothing decoded and currentTime at 0, so every
           later seek is written to a dead element. Bring the source back and
           restore the playhead before anything else touches it. */
        if (video.readyState === 0) {
          const at = lastPosRef.current || 0;
          const wantResume = wasPlaying;
          const resume = () => {
            video.removeEventListener("loadedmetadata", resume);
            try {
              video.currentTime = at;
            } catch (e) {
              /* ignore */
            }
            if (wantResume) {
              const attempt = video.play();
              if (attempt && attempt.catch) attempt.catch(() => {});
            }
          };
          video.addEventListener("loadedmetadata", resume);
          try {
            video.load();
          } catch (e) {
            /* ignore */
          }
          wasPlaying = false;
          return;
        }
        if (wasPlaying && video.paused) {
          const attempt = video.play();
          if (attempt && attempt.catch) attempt.catch(() => {});
        }
        wasPlaying = false;
      };
      const onVisibility = () => (document.visibilityState === "hidden" ? onHide() : onShow());
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("blur", onHide);
      window.addEventListener("focus", onShow);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("blur", onHide);
        window.removeEventListener("focus", onShow);
      };
    }, [activeVideo, dropGestures]);

    /* ---- edge stripes: the phone's arrow keys --------------------------
       The stage is cut in three. The outer stripes are the seek zones — 200 px
       on a wide screen, a third of the width on a phone, so the centre stripe
       always survives for the crop cycle. A double tap has to land twice in the
       SAME stripe: a stray left-then-right pair is not a seek. */
    function tapZoneAt(clientX, box) {
      if (!box || !box.width) return "center";
      const stripe = Math.min(EDGE_ZONE_PX, box.width * EDGE_ZONE_RATIO);
      const x = clientX - box.left;
      if (x <= stripe) return "left";
      if (x >= box.width - stripe) return "right";
      return "center";
    }

    /* one seek path, so an arrow key, an edge tap and the scrub bar cannot
       disagree about where the end of the clip is */
    function seekTo(seconds) {
      const video = activeVideo();
      if (!video) return 0;
      const fileTotal = Number((item && item.scene.files && item.scene.files[0] && item.scene.files[0].duration) || 0);
      const liveTotal = isFinite(video.duration) ? video.duration : 0;
      const total = duration || fileTotal || liveTotal || 0;
      const next = Math.max(0, Math.min(total ? total - 0.12 : seconds, seconds));
      applySeek(video, next);
      setScrubTime(next);
      setTime(next);
      return next;
    }

    function seekBy(delta, zone, x, y) {
      const video = activeVideo();
      if (!video) return;
      seekTo(video.currentTime + delta);
      setSeekFlash({ zone, delta, x, y, key: Date.now() });
      window.clearTimeout(seekFlashTimer.current);
      seekFlashTimer.current = window.setTimeout(() => setSeekFlash(null), 640);
      buzz(9);
    }

    function onPointerDown(event) {
      if (sheet) return;
      /* a press on the quick menu belongs to its buttons: dismissing the menu on
         pointerdown removed them before their click could fire, so every row was
         dead and only Close-by-tapping-outside worked */
      if (event.target && event.target.closest && event.target.closest(".stk-quick-menu")) return;
      if (chanOpen) {
        /* a press inside the top bar belongs to the bar: closing here unmounted
           the dropdown between pointerdown and click, so every feed row was
           dead and the tap "did nothing". Outside the bar, the press is the
           dismiss gesture. */
        const inTop = event.target && event.target.closest && event.target.closest(".stk-top");
        if (!inTop) {
          setChanOpen(false);
          return;
        }
      }
      if (quick) {
        setQuick(null);
        return;
      }
      // a tap on a rail button / HUD must not also toggle playback
      if (event.target && event.target.closest && event.target.closest("button, input, .stk-rail, .stk-nav, .stk-timeline, .stk-sheet, .stk-top, a")) return;
      const stage = stageRef.current;
      if (!stage) return;
      // switching apps can eat the pointerup, leaving a phantom point behind: the
      // next tap then reads as a two-finger pinch and zooms the video
      if (event.isPrimary) {
        pts.current.clear();
        gesture.current = null;
      }
      try {
        stage.setPointerCapture(event.pointerId);
      } catch (e) {
        /* ignore */
      }
      pts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      poke();

      if (pts.current.size === 2) {
        window.clearTimeout(holdTimer.current);
        const [a, b] = Array.from(pts.current.values());
        const rect = stage.getBoundingClientRect();
        gesture.current = {
          mode: "pinch",
          d0: dist(a, b) || 1,
          s0: tf.current.s,
          x0: tf.current.x,
          y0: tf.current.y,
          cx: (a.x + b.x) / 2 - rect.left - rect.width / 2,
          cy: (a.y + b.y) / 2 - rect.top - rect.height / 2,
          left: rect.left,
          top: rect.top,
          w: rect.width,
          h: rect.height,
        };
        return;
      }

      const rect = stage.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / rect.width;
      const side = relX < 0.32 ? "left" : relX > 0.68 ? "right" : "center";
      /* a grip on the black bars is not a grip on the picture */
      let onPicture = false;
      const pressedVideo = activeVideo();
      if (pressedVideo) {
        const p = paintedRect(pressedVideo);
        onPicture =
          event.clientX >= p.left - 6 && event.clientX <= p.right + 6 &&
          event.clientY >= p.top - 6 && event.clientY <= p.bottom + 6;
      }
      gesture.current = {
        mode: "press",
        side,
        onPicture,
        /* capture retargets pointerup to the stage, so remember what the press
           actually landed on: a tap on the caption has to be recognisable */
        target: event.target,
        x0: event.clientX,
        y0: event.clientY,
        t0: performance.now(),
        moved: false,
        startTime: activeVideo() ? activeVideo().currentTime : 0,
        seekTo: null,
      };
      window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => {
        const cur = gesture.current;
        /* the middle press is the quick-menu gesture, not a fast-forward */
        if (cur && !cur.moved && cur.mode === "press" && cur.side !== "center") {
          cur.mode = "hold";
          startHold(cur.side);
        }
      }, HOLD_MS);

      /* a still thumb in the middle: grow a pip, then pop a quick menu under it */
      if (side === "center") {
        const pip = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        setPress(pip);
        window.setTimeout(() => setPress((cur) => (cur ? Object.assign({}, cur, { grow: true }) : cur)), 24);
        window.clearTimeout(pressTimer.current);
        pressTimer.current = window.setTimeout(() => {
          if (!gesture.current || gesture.current.moved || gesture.current.mode !== "press") return;
          gesture.current.mode = "menu";
          setPress(null);
          setQuick({
            x: event.clientX,
            y: event.clientY,
            /* open upward unless the thumb is near the top of the screen */
            below: event.clientY < 200,
          });
        }, LONG_PRESS_MS);
      }
    }

    function onPointerMove(event) {
      const point = pts.current.get(event.pointerId);
      if (point) {
        point.x = event.clientX;
        point.y = event.clientY;
      }
      const g = gesture.current;
      const stage = stageRef.current;
      if (!g || !stage) return;

      if (g.mode === "pinch" && pts.current.size >= 2) {
        /* fingers win: from here the transform is the user's, not the crop cycle */
        cropZoomRef.current = false;
        const [a, b] = Array.from(pts.current.values());
        const ratio = dist(a, b) / g.d0;
        const next = clamp(g.s0 * ratio, 1, MAX_ZOOM);
        const scaleRatio = next / g.s0;
        /* zoom about the point the pinch started on, and follow the fingers:
           two fingers can also drag the picture around while pinching */
        const cxNow = (a.x + b.x) / 2 - g.left - g.w / 2;
        const cyNow = (a.y + b.y) / 2 - g.top - g.h / 2;
        tf.current.s = next;
        tf.current.x = g.cx - (g.cx - g.x0) * scaleRatio + (cxNow - g.cx);
        tf.current.y = g.cy - (g.cy - g.y0) * scaleRatio + (cyNow - g.cy);
        clampPan();
        applyTransform();
        return;
      }

      if (g.mode === "hold") return;

      const dx = event.clientX - g.x0;
      const dy = event.clientY - g.y0;
      if (!g.moved && (Math.abs(dx) > PAN_SLOP || Math.abs(dy) > PAN_SLOP)) {
        g.moved = true;
        window.clearTimeout(holdTimer.current);
        if (g.mode === "press" || g.mode === "menu") {
          clearPress();
          setQuick(null);
          /* Swipe beats pan. A vertical drag is how you reach the next clip and
             it must never be eaten by a grab, so a pan only starts when all of
             these hold: the press landed on the picture (not the black bars),
             the picture really overflows its box (a clip that already fills the
             frame has nothing to move), and either the user pinched — any
             direction pans then — or the drag is sideways, which is the axis a
             cropped 16:9 frame actually has to give. */
          const box = stage.getBoundingClientRect();
          const slackX = (box.width * (tf.current.s - 1)) / 2;
          const slackY = (box.height * (tf.current.s - 1)) / 2;
          const hasSlack = slackX > 8 || slackY > 8;
          const sideways = Math.abs(dx) >= Math.abs(dy);
          const wantsSeek = prefs && prefs.dragScrub === true && !userZoomed();
          if (!wantsSeek && g.onPicture && hasSlack && (userZoomed() || sideways)) {
            g.mode = "pan";
            g.panX = tf.current.x;
            g.panY = tf.current.y;
            g.overX = 0;
            g.overY = 0;
            /* re-anchor at the slop threshold so the frame does not jump */
            g.x0 = event.clientX;
            g.y0 = event.clientY;
            buzz(6);
            return;
          }
          /* not a grab: vertical is the feed swipe, sideways is scrub/channel */
          g.mode = sideways ? "seek" : "swipe";
          if (g.mode === "swipe") setDragY(dy);
        }
      }
      if (!g.moved) return;

      if (g.mode === "pan") {
        const rect = stage.getBoundingClientRect();
        const maxX = (rect.width * (tf.current.s - 1)) / 2;
        const maxY = (rect.height * (tf.current.s - 1)) / 2;
        const wantX = g.panX + (event.clientX - g.x0);
        const wantY = g.panY + (event.clientY - g.y0);
        /* what the finger asked for beyond the picture's own edge: kept raw for
           the release test, drawn through rubber() so the edge feels elastic */
        const overX = maxX > 0 ? (wantX > maxX ? wantX - maxX : wantX < -maxX ? wantX + maxX : 0) : wantX;
        const overY = maxY > 0 ? (wantY > maxY ? wantY - maxY : wantY < -maxY ? wantY + maxY : 0) : wantY;
        g.overX = overX;
        g.overY = overY;
        tf.current.x = clamp(wantX, -maxX, maxX) + rubber(overX);
        tf.current.y = clamp(wantY, -maxY, maxY) + rubber(overY);
        applyTransform();
      } else if (g.mode === "swipe") {
        setDragY(dy);
      } else if (g.mode === "seek") {
        /* only a leftward drag leaves scrubbing; rightward keeps seeking */
        if (dx < -CHANNEL_PX) {
          g.mode = "channel";
          setScrubbing(false);
          setTip(null);
          return;
        }
        /* drag-scrub is off unless it was turned on in Settings: sideways travel
           is ignored, so a thumb slipping out of a swipe cannot seek the clip.
           The channel edge above still fires. */
        if (!(prefs && prefs.dragScrub === true)) {
          if (scrubbing) setScrubbing(false);
          return;
        }
        const rect = stage.getBoundingClientRect();
        const live = activeVideo();
        const total = duration || (live && isFinite(live.duration) ? live.duration : 0) || 0;
        const span = Math.min(total || 600, 600);
        const target = clamp(g.startTime + (dx / rect.width) * span, 0, total);
        g.seekTo = target;
        setScrubTime(target);
        setScrubbing(true);
        setTip({
          x: clamp(event.clientX - rect.left, 86, Math.max(86, rect.width - 86)),
          y: clamp(event.clientY - rect.top, 104, Math.max(104, rect.height - 86)),
        });
        if (activeVideo()) activeVideo().currentTime = target;
      }
    }

    function clearPress() {
      window.clearTimeout(pressTimer.current);
      setPress((current) => (current ? null : current));
    }

    function onPointerUp(event) {
      const g = gesture.current;
      window.clearTimeout(holdTimer.current);
      clearPress();
      // a fast-forward hold must end even when the finger lifts over a control,
      // otherwise the clip keeps playing at holdSpeed while the badge says 1x
      if (g && g.mode === "hold") stopHold();
      else if (!rateBadge) {
        const held = activeVideo();
        if (held && Math.abs(held.playbackRate - speedRef.current) > 0.01) held.playbackRate = speedRef.current;
      }
      if (event.target && event.target.closest && event.target.closest("button, input, .stk-rail, .stk-nav, .stk-timeline, .stk-sheet, .stk-top, a")) return;

      const remaining = pts.current.size;
      pts.current.delete(event.pointerId);
      if (g && g.mode === "pinch") {
        if (pts.current.size < 2) gesture.current = null;
        return;
      }
      if (!g) return;
      gesture.current = null;

      if (g.mode === "press" && !g.moved) {
        const video = activeVideo();
        if (!video) return;
        /* a tap on the caption opens the scrub bar instead of pausing: with
           drag-scrub off (the default) the bar is how you seek. Hashtags, the
           performer handle and "more" are buttons and returned above, so a
           single tap on a hashtag still opens that tag. */
        const pressTarget = g.target || event.target;
        if (pressTarget && pressTarget.closest && pressTarget.closest(".stk-info")) {
          openScrubber();
          return;
        }
        /* a pinch left the frame zoomed: the first tap returns to the framing
           step the cycle is on. The crop's own 2x is not a pinch, so a tap at
           crop scale still pauses. */
        if (userZoomed()) {
          applyCrop(cropModeRef.current, true, true);
          window.clearTimeout(cropBadgeTimer.current);
          setCropBadge(cropLabel(cropModeRef.current));
          cropBadgeTimer.current = window.setTimeout(() => setCropBadge(""), 900);
          /* this tap is the first half of a double tap more often than not, and it
             is not recorded as one: without the marker the second tap reads as a
             lone tap and pauses the clip, so un-zooming looked like "two taps
             pauses". Swallow the partner instead of pausing on it. */
          swallowTapRef.current = performance.now();
          window.clearTimeout(tapTimer.current);
          tapUndoRef.current = null;
          return;
        }
        const now = performance.now();
        if (swallowTapRef.current && now - swallowTapRef.current <= DOUBLE_TAP_MS) {
          swallowTapRef.current = 0;
          return;
        }
        const box = stageRef.current ? stageRef.current.getBoundingClientRect() : null;
        const zone = tapZoneAt(event.clientX, box);
        const isDouble = lastTapAt.current && now - lastTapAt.current <= DOUBLE_TAP_MS;
        if (isDouble) {
          lastTapAt.current = 0;
          const firstZone = lastTapZone.current;
          lastTapZone.current = "";
          window.clearTimeout(tapTimer.current);
          /* the first tap may already have paused (or resumed) the clip: undo it,
             because two taps mean "zoom", not play/pause */
          const undo = tapUndoRef.current;
          tapUndoRef.current = null;
          if (undo === "resume" && video.paused) playGuarded(video);
          else if (undo === "pause" && !video.paused) {
            video.pause();
            setPlaying(false);
          }
          /* an edge double tap seeks 5 s, the way an arrow key does; the centre
             keeps the crop cycle. Both taps must land in the same stripe. */
          if (zone !== "center" && zone === firstZone && (!prefs || prefs.edgeSeek !== false)) {
            /* keep the ripple inside the stage: a tap 20 px from the edge would
               otherwise draw half a ring against the cut */
            const w = box ? box.width : 0;
            const hgt = box ? box.height : 0;
            const fx = Math.max(Math.min(56, w / 2), Math.min(w - Math.min(56, w / 2), event.clientX - (box ? box.left : 0)));
            const fy = Math.max(Math.min(56, hgt / 2), Math.min(hgt - Math.min(56, hgt / 2), event.clientY - (box ? box.top : 0)));
            seekBy(zone === "right" ? SEEK_STEP : -SEEK_STEP, zone, fx, fy);
            return;
          }
          /* a pair that straddles two stripes is neither: swallow it rather than
             reframing the picture on a gesture the user did not mean */
          if (zone !== "center" || firstZone !== "center") return;
          cycleCrop();
          return;
        }
        lastTapAt.current = now;
        lastTapZone.current = zone;
        tapUndoRef.current = null;
        if (video.paused) {
          /* resuming has to happen inside the gesture or the browser refuses to
             start playback; a following double tap pauses it again */
          playGuarded(video);
          tapUndoRef.current = "pause";
          return;
        }
        /* hold the pause for one double-tap window: if a second tap lands, the
           user meant to zoom and the clip keeps playing */
        window.clearTimeout(tapTimer.current);
        tapTimer.current = window.setTimeout(() => {
          const live = activeVideo();
          if (!live || live.paused) return;
          live.pause();
          setPlaying(false);
          tapUndoRef.current = "resume";
        }, TAP_WAIT_MS);
        return;
      }

      if (g.mode === "swipe") {
        const wrap = wrapRef.current;
        const stageEl = stageRef.current;
        const height = stageEl ? stageEl.getBoundingClientRect().height : 0;
        const direction = dragY < -SWIPE_PX ? 1 : dragY > SWIPE_PX ? -1 : 0;
        if (!direction || !wrap || !height) {
          setDragY(0);
          if (wrap) wrap.style.transition = "";
        } else if (direction < 0 && index === 0) {
          /* nothing above the first clip, so a pull down is a refresh */
          const armed = dragY >= REFRESH_PX;
          setDragY(0);
          if (wrap) {
            wrap.style.transition = "transform 220ms cubic-bezier(.22,.61,.36,1)";
            window.setTimeout(() => {
              wrap.style.transition = "";
            }, 240);
          }
          if (armed) refreshFeed();
        } else {
          slideStep(direction);
        }
      }
      if (g.mode === "seek") {
        setScrubbing(false);
        setTip(null);
      }
      if (g.mode === "channel") {
        /* leftward only: the carousel steps forward. The performer shortcut that
           used to live on a rightward drag is gone — it stole the right half,
           which is hold-to-fast-forward. */
        goChannel(1);
      }
      if (g.mode === "pan") {
        const stageEl = stageRef.current;
        const height = stageEl ? stageEl.getBoundingClientRect().height : 0;
        const ox = g.overX || 0;
        const oy = g.overY || 0;
        const vertical = Math.abs(oy) >= Math.abs(ox);
        if (vertical && Math.abs(oy) > SWIPE_PX && height) {
          /* the picture was already at its edge and the finger kept going: the
             leftover travel is the swipe, so paging never needs a second gesture */
          const direction = oy < 0 ? 1 : -1;
          if (direction < 0 && index === 0) refreshFeed();
          else slideStep(direction);
        } else if (!vertical && -ox > CHANNEL_PX) {
          /* leftward past the edge opens the channel carousel */
          goChannel(1);
        } else {
          /* still inside the picture, or a pull that never got far enough */
          clampPan();
          applyTransform(true);
        }
        poke();
      }
      poke();
    }

    /* ---- timeline -------------------------------------------------- */

    /* ---- writing a seek ------------------------------------------------
       iOS drops the media buffer when the tab is backgrounded: the element comes
       back with readyState 0 and a NaN duration, and a write to currentTime on it
       is silently ignored. The scrubber still looks alive, because the chapter
       previews come from the sprite sheet rather than the video, and then the bar
       snaps back to where the clip was on release because nothing ever moved.
       Reload the source and seek again once the metadata is back. */
    function applySeek(video, target) {
      if (!video) return false;
      const seek = () => {
        try {
          video.currentTime = target;
          lastPosRef.current = target;
        } catch (e) {
          return false;
        }
        return true;
      };
      if (video.readyState >= 1 && isFinite(video.duration)) return seek();
      /* one reload at a time: a drag calls this on every move, and a load() per
         move would restart the request dozens of times a second. Remember the
         latest target instead and land it when the metadata is back. */
      reloadRef.current = { el: video, target };
      if (reloadTimerRef.current) return false;
      const finish = () => {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = 0;
        video.removeEventListener("loadedmetadata", finish);
        const job = reloadRef.current;
        reloadRef.current = null;
        if (job && job.el === video) {
          try {
            video.currentTime = job.target;
            lastPosRef.current = job.target;
          } catch (e) {
            /* ignore */
          }
        }
      };
      video.addEventListener("loadedmetadata", finish);
      reloadTimerRef.current = window.setTimeout(finish, 1500);
      try {
        video.load();
      } catch (e) {
        /* ignore: a dead element is not worth a crash */
      }
      return false;
    }

    function seekAt(clientX) {
      const video = activeVideo();
      const bar = document.querySelector(".stk-timeline-inner");
      const rect = (bar || stageRef.current || document.body).getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / (rect.width || 1), 0, 1);
      /* the same total the preview used, and for the same reason: a video with
         its buffer evicted reports duration NaN, and `duration || video.duration`
         collapsed to 0, which turned every drag into a seek back to the start */
      const fileTotal = Number((item && item.scene.files && item.scene.files[0] && item.scene.files[0].duration) || 0);
      const liveTotal = video && isFinite(video.duration) ? video.duration : 0;
      const total = duration || fileTotal || liveTotal || 0;
      const target = ratio * total;
      if (video) applySeek(video, target);
      setScrubTime(target);
      return target;
    }

    function seekFromEvent(event) {
      return seekAt(event.clientX);
    }

    /* taps in the top third of the tab bar scrub instead of switching tabs */
    const seekAtRef = useRef(seekAt);
    seekAtRef.current = seekAt;
    useEffect(() => {
      const onScrub = (event) => {
        const x = event.detail && event.detail.x;
        if (typeof x === "number") seekAtRef.current(x);
      };
      document.addEventListener("stashtok-scrub", onScrub);
      return () => document.removeEventListener("stashtok-scrub", onScrub);
    }, []);

    /* summon the scrub bar: tapping the caption opens it, and it folds back to
       the thin progress line after a few idle seconds so the feed stays clean */
    function openScrubber() {
      setScrubBar(true);
      poke();
      window.clearTimeout(scrubBarTimer.current);
      scrubBarTimer.current = window.setTimeout(() => setScrubBar(false), 4500);
    }

    /* ---- the Marker bubble ---------------------------------------------
       Scrubbing is accurate but slow on a phone: the thumb is on the bar, so
       there is no hand left for a button. Push the finger up instead. 96 px of
       lift arms a bubble above the playhead, the same finger travels the last
       few pixels onto it, and letting go opens the marker sheet at the frozen
       in point. The playhead stops moving the moment the bubble appears, so the
       marker cannot drift while the thumb is on its way. */
    function onTimelineDown(event) {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      window.clearTimeout(scrubBarTimer.current);
      setScrubBar(true);
      setScrubbing(true);
      setSnapFail(false);
      snapRef.current = { at: 0, t: 0 };
      dropRef.current = { y0: event.clientY, at: null, armed: false, over: false, x: 0 };
      setMarkerDrop(null);
      poke();
      seekFromEvent(event);
    }

    function onTimelineMove(event) {
      event.stopPropagation();
      const box = event.currentTarget.getBoundingClientRect();
      const pct = box.width ? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) : 0;
      const store = spriteRef.current;
      const total = duration || Number((item && item.scene.files && item.scene.files[0] && item.scene.files[0].duration) || 0);
      const at = pct * total;
      const cue = store.cues && store.cues.length
        ? store.cues.find((c) => at >= c.start && at < c.end) || store.cues[store.cues.length - 1]
        : null;
      const hasSprite = Boolean(store.ok && cue);
      if (!hasSprite || !spriteRef.current.sheetW) {
        const now = performance.now();
        if (now - snapRef.current.at > 140) snapRef.current = { at: now, t: Math.round(at) };
      }
      const stage = stageRef.current;
      const sbox = stage ? stage.getBoundingClientRect() : null;
      const activeEl = activeVideo();
      const fit = activeEl ? getComputedStyle(activeEl).objectFit : "contain";
      setScrubPreview({
        pct,
        time: at,
        snapT: snapRef.current.t,
        fit: fit === "cover" ? "cover" : "contain",
        hasSprite,
        x: cue ? cue.x : 0,
        y: cue ? cue.y : 0,
        w: cue ? cue.w : 0,
        h: cue ? cue.h : 0,
        src: store.src,
        sceneId: item && item.scene ? item.scene.id : "",
        stageW: sbox ? sbox.width : 0,
        stageH: sbox ? sbox.height : 0,
      });
      if (!scrubbing) return;

      const drop = dropRef.current;
      if (drop) {
        if (!drop.armed) {
          if (drop.y0 - event.clientY >= MARKER_LIFT_PX) {
            /* freeze the in point where the finger was scrubbing to, and park
               the bubble right above it */
            drop.at = seekFromEvent(event);
            const stage = stageRef.current;
            const box = stage ? stage.getBoundingClientRect() : { left: 0, width: 0, bottom: 0, height: 0 };
            drop.x = Math.max(64, Math.min(Math.max(64, box.width - 64), event.clientX - box.left));
            /* the chapter preview hangs right above the bar, so the pill is
               parked above its top edge — 210 px clears a 160x90 cell plus the
               time label with room to spare, and the preview's own height wins
               when it is taller than that */
            const preview = document.querySelector(".stk-scrub-preview");
            const previewTop = preview ? preview.getBoundingClientRect().top : 0;
            const clear = previewTop ? box.bottom - previewTop + 22 : 0;
            drop.bottom = Math.max(210, Math.min(clear, (box.height || 720) - 150));
            drop.armed = true;
            drop.over = false;
            setMarkerDrop({ x: drop.x, at: drop.at, over: false, bottom: drop.bottom });
            buzz(12);
          }
        } else {
          /* the finger is on its way to the bubble: keep the playhead still and
             only test the hit. 14 px of slack is the whole point — the bubble
             arms below the finger, so the highlight has to mean "travel here",
             not "you breathed on it". */
          const el = markerDropEl.current;
          const box = el ? el.getBoundingClientRect() : null;
          const over = !!box &&
            event.clientX >= box.left - 14 && event.clientX <= box.right + 14 &&
            event.clientY >= box.top - 14 && event.clientY <= box.bottom + 14;
          if (over !== drop.over) {
            drop.over = over;
            if (over) buzz(8);
            setMarkerDrop((cur) => (cur ? Object.assign({}, cur, { over }) : cur));
          }
        }
        return;
      }

      seekFromEvent(event);
    }

    function onTimelineUp(event) {
      event.stopPropagation();
      const drop = dropRef.current;
      dropRef.current = null;
      setMarkerDrop(null);
      setScrubPreview(null);
      if (drop && drop.armed && drop.over && drop.at != null) {
        setScrubbing(false);
        buzz(14);
        openMarkerSheet(drop.at);
        return;
      }
      setScrubbing(false);
      if (scrubBar) {
        window.clearTimeout(scrubBarTimer.current);
        scrubBarTimer.current = window.setTimeout(() => setScrubBar(false), 4500);
      }
      poke();
    }

    /* ---- derived --------------------------------------------------- */

    const markers = (item && item.scene.scene_markers) || [];
    const scrubbingRatio = duration ? (scrubbing ? scrubTime : time) / duration : 0;
    const nearMarker = markers.find(
      (marker) => Math.abs(Number(marker.seconds) - (scrubbing ? scrubTime : time)) < 2.5
    );

    const watchedRatio = duration ? Math.min(1, (time - (item ? item.startAt : 0)) / duration) : 0;

    function openHandle() {
      if (handle.performer) return onOpenPerformer(handle.performer);
      if (handle.folder && onOpenFolderProfile) return onOpenFolderProfile({ name: handle.name, folder: handle.folder });
      setSheet("details");
    }

    const onTimeUpdate = () => {
      const video = activeVideo();
      if (!video) return;
      /* one render per frame is plenty: timeupdate can fire far more often and each
         one re-renders the whole stage on a big desktop pane */
      const now = performance.now();
      if (now - lastTimePush.current < 180) return;
      lastTimePush.current = now;
      lastPosRef.current = video.currentTime;
      setTime(video.currentTime);
      if (!duration && video.duration) setDuration(video.duration);
    };

    /* ---- render ---------------------------------------------------- */

    if (failCount >= 20) {
      return h(
        "div",
        { className: "stash-tok stk-embedded" },
        h(
          "div",
          { className: "stk-top stk-top-right" },
          h(
            "button",
            { className: "stk-top-btn", onClick: (event) => { event.stopPropagation(); if (onSearch) onSearch(); } },
            h(Icon, { name: "search", size: 18 })
          ),
          h(
            "button",
            { className: "stk-top-btn", onClick: (event) => { event.stopPropagation(); if (onSettings) onSettings(); } },
            h(Icon, { name: "gear", size: 18 })
          )
        ),
        h(
          "div",
          { className: "stk-state" },
          h("p", null, "Several scenes in a row could not be played."),
          h("p", { style: { fontSize: "12px", opacity: 0.6 } }, "Their files look missing from disk — run a Stash scan, or pick another feed."),
          h("button", { className: "stk-btn", onClick: () => { setFailCount(0); goNext(); } }, "Keep going")
        )
      );
    }
    if (!item) {
      return h(
        "div",
        { className: "stash-tok stk-embedded" },
        h(
          "div",
          { className: "stk-stage" },
          error
            ? h("div", { className: "stk-state" }, h("p", null, error))
            : loading
            ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }), h("p", null, "Loading feed…"))
            : h(
                "div",
                { className: "stk-state" },
                h("p", null, "Nothing in this feed yet."),
                h(
                  "p",
                  { style: { fontSize: "12px", opacity: 0.6 } },
                  spec.type === "favorites"
                    ? "Heart a scene and it lands here."
                    : "Try another feed from the picker at the top."
                )
              )
        )
      );
    }

    const scene = item.scene;
    const file = (scene.files && scene.files[0]) || {};
    const performers = scene.performers || [];
    const tags = scene.tags || [];
    const handle = resolveHandle(scene, file);
    const showPath = !!(prefs && prefs.showPath);

    /* tag sheet: sections mirror the Discover page — a heading, then the tags
       under it. Chips are keyed by tag NAME (the section lists are names; ids
       are resolved when the user commits), and a tag the scene already has
       paints as applied and cannot be picked twice. */
    const sceneTagNames = new Set((scene.tags || []).map((tag) => String(tag.name).trim().toLowerCase()));
    const ethnicityPerformer = performers[0] || null;
    /* a filled-in performer ethnicity is authoritative: the scene write leaves it
       alone (Wario is populated, the OF library is not) */
    const ethnicityLocked = !!(ethnicityPerformer && String(ethnicityPerformer.ethnicity || "").trim());

    /* what the typed word would become if committed: shown as a "Create …" row
       when the library has no exact match, and it is also what , / Tab adds */
    const tagQueueLower = new Set(tagQueue.map((name) => name.toLowerCase()));
    const tagCreateName = (() => {
      const typed = titleTagName(tagFilter);
      if (!typed) return "";
      const key = typed.toLowerCase();
      if (tagQueueLower.has(key) || sceneTagNames.has(key)) return "";
      if (tagSugg.some((row) => String(row.name).trim().toLowerCase() === key)) return "";
      const inVocab = TAG_VOCABULARY.some((name) => name.toLowerCase() === key);
      return inVocab ? "" : typed;
    })();

    function queueSuggestion(name) {
      appendTagNames([name]);
      setTagFilter("");
      setTagSugg([]);
      setTagSuggSel(-1);
    }

    /* everything the Done button is about to write: typed, queued, ticked */
    const tagPending = splitTagInput(tagFilter)
      .concat(
        tagQueue,
        Object.keys(tagPicked).filter((name) => tagPicked[name]),
        tagCat ? [tagCat] : [],
        Object.keys(tagKids).filter((name) => tagKids[name])
      )
      .filter((name, at, all) => all.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === at);

    /* separators are read from the value, not from the keydown: the browser
       inserts the comma *after* its keydown, so handling it there queued the
       word and then left the comma sitting in the field. Whatever comma
       arrives, the text before the last one becomes chips and the tail stays
       as the word still being typed. */
    function onTagFieldChange(raw) {
      const value = String(raw == null ? "" : raw);
      if (/[,\n]/.test(value)) {
        const parts = value.split(/[,\n]/);
        const tail = parts.pop().replace(/^[,\s]+/, "");
        const names = parts.map(titleTagName).filter(Boolean);
        if (names.length) appendTagNames(names);
        setTagFilter(tail);
        if (!tail) setTagSugg([]);
        setTagSuggSel(-1);
        return;
      }
      setTagFilter(value);
      setTagSuggSel(-1);
    }

    /* comma closes a tag, Tab closes a tag, Enter takes the highlighted
       suggestion else closes the tag (or writes the sheet when the field is
       already empty). Backspace on an empty field takes the last chip back. */
    function onTagFieldKey(event) {
      const key = event.key;
      if (key === "Tab") {
        event.preventDefault();
        commitTagField();
      } else if (key === "Enter") {
        event.preventDefault();
        const highlighted = tagSuggSel >= 0 ? tagSugg[tagSuggSel] : null;
        if (highlighted) queueSuggestion(highlighted.name);
        else if (tagCreateName) queueSuggestion(tagCreateName);
        else if (splitTagInput(tagFilter).length) commitTagField();
        else commitTags();
      } else if (key === "ArrowDown") {
        event.preventDefault();
        setTagSuggSel((cur) => Math.min(tagSugg.length - 1, cur + 1));
      } else if (key === "ArrowUp") {
        event.preventDefault();
        setTagSuggSel((cur) => Math.max(-1, cur - 1));
      } else if (key === "Escape") {
        event.preventDefault();
        setTagOpen(false);
      } else if (key === "Backspace" && !tagFilter && tagQueue.length) {
        event.preventDefault();
        setTagQueue((prev) => prev.slice(0, -1));
      }
    }

    /* ---- selection ---------------------------------------------------- *
       Everything except Category is a plain on/off name. Category is the one
       exclusive pair: picking a parent clears the other parent's children, so a
       child can never survive its parent, and picking a child implies its
       parent. */
    function tagIsOn(name) {
      return sceneTagNames.has(name.trim().toLowerCase()) || !!tagPicked[name];
    }

    function toggleTagName(name) {
      if (sceneTagNames.has(name.trim().toLowerCase())) return;
      setTagPicked((prev) => Object.assign({}, prev, { [name]: !prev[name] }));
    }

    function toggleCategory(name) {
      if (tagCat === name) {
        setTagCat("");
        setTagKids({});
        return;
      }
      setTagCat(name);
      setTagKids({});
    }

    function toggleChild(parent, name) {
      if (tagCat !== parent) {
        setTagCat(parent);
        setTagKids({ [name]: true });
        return;
      }
      setTagKids((prev) => Object.assign({}, prev, { [name]: !prev[name] }));
    }

    function showMore(sectionId, total, setter) {
      setter((prev) => {
        const current = prev[sectionId] || TAG_PAGE;
        const next = current >= total ? TAG_PAGE : Math.min(total, current + TAG_PAGE);
        return Object.assign({}, prev, { [sectionId]: next });
      });
    }

    return h(
      "div",
      { className: "stash-tok stk-embedded" + (hud && !clearDisplay ? "" : " stk-hud-hidden") +
        (clearDisplay ? " stk-clear" : "") + (fullscreen ? " stk-feed-fullscreen" : "") },
      h(
        "div",
        {
          className: "stk-stage",
          ref: stageRef,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onContextMenu: (event) => {
            event.preventDefault();
            if (sfw) return;
            const video = activeVideo();
            setCtxMenu({ x: event.clientX, y: event.clientY, at: video ? video.currentTime : 0 });
          },
        },
        cfg.blurBackdrop &&
          h("div", {
            className: "stk-backdrop",
            style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` },
          }),
        h("div", { className: "stk-scan" }),
        vrMode && vrSource === "preview" && vrLayout(scene) &&
          h("div", { className: "stk-vr-chip" }, "preview"),
        h(VrCanvas, {
          videoRef,
          layout: vrMode ? vrLayout(scene) : null,
          sceneKey: item.key,
          previewUrl: rel(scene.paths && scene.paths.preview),
          onSource: setVrSource,
          onTap: () => {
            const video = activeVideo();
            if (!video) return;
            if (video.paused) playGuarded(video);
            else {
              video.pause();
              setPlaying(false);
            }
          },
        }),

        h(
          "div",
          {
            className: "stk-dragwrap" + (dragY ? " stk-dragging" : ""),
            ref: wrapRef,
            style: {
              transform: `translateY(${dragY || 0}px) rotate(${rotation}deg)`,
              transition: dragY || rotation ? "none" : undefined,
            },
          },
          (desktop && !sfw ? [index - 1, index, index + 1] : [index - 1, index, index + 1, index + 2])
            .filter((at) => at >= 0 && items[at])
            .flatMap((at) => {
              const entry = items[at];
              const active = at === index;
              const screenshot = rel(entry.scene.paths && entry.scene.paths.screenshot);
              const file = entry.scene.files && entry.scene.files[0];
              const dimensions = decodedSize && decodedSize.key === entry.key ? decodedSize : file;
              const fit = fullscreen && fullscreenFit !== "auto"
                ? fullscreenFit
                : useSmartFit ? feedFrameFit(dimensions?.width, dimensions?.height, stageAspect) : "contain";
              const still = (sfw || (frameHandoff && screenshot)) && h("img", {
                key: entry.key + ":still",
                className: "stk-frame" + (frameHandoff ? " stk-handoff-still" : active ? " stk-active" : ""),
                src: screenshot || undefined,
                alt: "",
                draggable: false,
                style: {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: (at - index) * 100 + "%",
                  width: "100%",
                  height: "100%",
                  objectFit: fit,
                  pointerEvents: "none",
                  zIndex: active ? 3 : 1,
                },
              });
              if (sfw || (frameHandoff && !active)) return still ? [still] : [];
              const source = streamSource(entry.scene);
              const video = h("video", {
                key: entry.key,
                ref: active
                  ? videoRef
                  : (el) => {
                      if (el) prewarm(el, entry.startAt);
                    },
                className: "stk-video" + (active ? " stk-active" : ""),
                src: active && streamFallback ? source.signed : source.plain,
                poster: desktop && !spec.single ? screenshot || undefined : undefined,
                playsInline: true,
                /* no Firefox PiP badge over the top-right corner: it drew on top
                   of the rail's save button, and PiP is not how this feed is used */
                disablePictureInPicture: true,
                autoPlay: active && !frameHandoff,
                muted: active ? muted : true,
                /* four simultaneous streams is what makes a big desktop pane stutter:
                   neighbours only need a header to prewarm their ref */
                preload: active ? "auto" : "metadata",
                onCanPlay: active
                  ? () => {
                      setReady(true);
                      setFailCount(0);
                    }
                  : undefined,
                onTimeUpdate: active ? onTimeUpdate : undefined,
                onPlay: active ? () => setPlaying(true) : undefined,
                onPause: active ? () => setPlaying(false) : undefined,
                /* a sheet over the stage means the user is typing, not watching:
                   auto-scroll must not advance to the next clip mid-sentence, or
                   the tags land on the clip that replaced the one on screen */
                onEnded: active ? (autoScroll && !tagOpen && !sheet ? goNext : loopCurrent) : undefined,
                onError: active
                  ? (event) => {
                      event.currentTarget.classList.remove("stk-frame-ready");
                      setPlaying(false);
                      if (!streamFallback) {
                        setStreamFallback(true);
                        return;
                      }
                      setFailCount((count) => count + 1);
                      if (!window.__stkNoAutoAdvance) window.setTimeout(goNext, 600);
                    }
                  : undefined,
                style: {
                  // inline so a stale CSS cache can never stack the layers vertically
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: (at - index) * 100 + "%",
                  width: "100%",
                  height: "100%",
                  /* a frame that exactly fills the stage is drawn by the sampler
                     instead of a scale transform, which would composite a layer of
                     the whole scaled box (~10x the pixels, mostly clipped bars) */
                  objectFit: active && fillMode ? "cover" : fit,
                  opacity: 1,
                  pointerEvents: active ? "auto" : "none",
                  zIndex: active ? 2 : 1,
                },
              });
              return still ? [video, still] : [video];
            }),
        ),


        /* ---- scrub frame -------------------------------------------
           While the playhead is being dragged the frame under it fills the
           stage, so the viewer shows what the timeline is pointing at instead
           of the last decoded frame. A generated sprite sheet is instant and
           free; without one, Stash's screenshot-at-time endpoint is asked
           (throttled); if that fails too the overlay gets out of the way and
           leaves the video visible. */
        scrubbing &&
          scrubPreview &&
          !sfw &&
          !snapFail &&
          h(
            "div",
            { className: "stk-scrub-frame", "aria-hidden": "true" },
            scrubPreview.hasSprite && spriteRef.current.sheetW
              ? h("div", {
                  className: "stk-scrub-frame-img",
                  style: (() => {
                    const preview = scrubPreview;
                    const vw = preview.stageW || window.innerWidth || 360;
                    const vh = preview.stageH || window.innerHeight || 640;
                    const scale = preview.fit === "cover"
                      ? Math.max(vw / preview.w, vh / preview.h)
                      : Math.min(vw / preview.w, vh / preview.h);
                    const sheetW = spriteRef.current.sheetW * scale;
                    const sheetH = spriteRef.current.sheetH * scale;
                    return {
                      backgroundImage: `url("${preview.src}")`,
                      backgroundSize: `${sheetW}px ${sheetH}px`,
                      backgroundPosition:
                        `${-(preview.x * scale + (preview.w * scale - vw) / 2)}px ` +
                        `${-(preview.y * scale + (preview.h * scale - vh) / 2)}px`,
                    };
                  })(),
                })
              : h("img", {
                  className: "stk-scrub-frame-img",
                  src: `/scene/${scrubPreview.sceneId}/screenshot?t=${scrubPreview.snapT}`,
                  alt: "",
                  draggable: false,
                  style: { objectFit: scrubPreview.fit === "cover" ? "cover" : "contain" },
                  onError: () => setSnapFail(true),
                })
          ),

        /* the first clip has nothing above it: pulling down reloads the feed */
        index === 0 &&
          dragY > 8 &&
          h(
            "div",
            {
              className: "stk-pull" + (dragY >= REFRESH_PX ? " stk-armed" : ""),
              style: { opacity: Math.min(1, dragY / 90) },
            },
            h(Icon, { name: "rotate", size: 16 }),
            dragY >= REFRESH_PX ? "Release to refresh" : "Pull to refresh"
          ),

        press &&
          h("div", {
            className: "stk-press-pip" + (press.grow ? " stk-grow" : ""),
            style: { left: `${press.x}px`, top: `${press.y}px` },
          }),

        people &&
          performers.length > 1 &&
          h(
            React.Fragment,
            null,
            h("div", { className: "stk-people-backdrop", onClick: () => setPeople(false) }),
            h(
              "div",
              { className: "stk-people", onClick: (event) => event.stopPropagation() },
              h("h4", null, "In this scene"),
              performers.map((performer) =>
                h(
                  "button",
                  {
                    key: performer.id,
                    className: "stk-people-row",
                    onClick: (event) => {
                      event.stopPropagation();
                      setPeople(false);
                      onOpenPerformer(performer);
                    },
                  },
                  performer.image_path
                    ? h("img", { className: "stk-people-avatar", src: rel(performer.image_path), alt: "" })
                    : h("span", { className: "stk-people-avatar stk-people-initials" }, initials(performer.name)),
                  h("span", { className: "stk-people-name" }, performer.name),
                  h(Icon, { name: "chevron", size: 16 })
                )
              ),
              h("button", { className: "stk-people-close", onClick: () => setPeople(false) }, "Close")
            )
          ),

        quick &&
          h(
            "div",
            {
              className: "stk-quick-menu" + (quick.below ? " stk-below" : ""),
              ref: quickRef,
              style: { left: `${quick.x}px`, top: `${quick.y}px` },
            },
            h(
              "button",
              {
                className: "stk-qm-danger",
                onClick: () => {
                  setQuick(null);
                  flagCurrent();
                },
              },
              h(Icon, { name: "flag", size: 15 }),
              "Mark for Delete"
            ),
            h(
              "div",
              { className: "stk-qm-speed" },
              h("span", { className: "stk-qm-speed-label" }, "Speed"),
              h(
                "div",
                { className: "stk-qm-seg" },
                [0.5, 1, 2].map((value) =>
                  h(
                    "button",
                    {
                      key: value,
                      className: "stk-qm-seg-btn" + (speed === value ? " stk-on" : ""),
                      onClick: (event) => {
                        event.stopPropagation();
                        setSpeed(value);
                        buzz(8);
                      },
                    },
                    `${value}x`
                  )
                )
              )
            ),
            h(
              "button",
              {
                className: "stk-qm-wide",
                onClick: () => {
                  setQuick(null);
                  const on = !clearDisplay;
                  setClearDisplay(on);
                  if (!on) {
                    setHud(true);
                    setHudTick((n) => n + 1);
                  }
                  buzz(8);
                },
              },
              h(Icon, { name: clearDisplay ? "rotate" : "sparkle", size: 15 }),
              clearDisplay ? "Restore Display" : "Clear Display"
            ),
            h(
              "button",
              {
                className: "stk-qm-wide",
                onClick: () => {
                  setQuick(null);
                  buzz(8);
                  if (onDuo) onDuo();
                },
              },
              h(Icon, { name: "video", size: 15 }),
              "Gooners Delight",
              h("span", { className: "stk-qm-state" }, "2 feeds")
            ),
            h(
              "button",
              {
                className: "stk-qm-wide",
                onClick: () => {
                  const next = !autoScroll;
                  setAutoScroll(next);
                  try {
                    window.localStorage.setItem("stashTok.autoScroll", next ? "1" : "0");
                  } catch (e) {
                    /* ignore */
                  }
                  buzz(8);
                },
              },
              h(Icon, { name: "chevronDown", size: 15 }),
              "Auto-Scroll",
              h("span", { className: "stk-qm-state" + (autoScroll ? " stk-on" : "") }, autoScroll ? "On" : "Off")
            ),
            h("button", { className: "stk-qm-close", onClick: () => setQuick(null) }, h(Icon, { name: "x", size: 15 }), "Close")
          ),

        scrubbing &&
          tip &&
          (() => {
            /* a 90 degree arc that fills above the thumb, not a full circle */
            const R = 26;
            const box = (R + 6) * 2;
            const mid = box / 2;
            const len = (Math.PI / 2) * R;
            const ratio = duration ? clamp(scrubTime / duration, 0, 1) : 0;
            const leg = R * Math.SQRT1_2;
            const d = `M ${mid - leg} ${mid - leg} A ${R} ${R} 0 0 1 ${mid + leg} ${mid - leg}`;
            return h(
              "div",
              { className: "stk-touch-hud", style: { left: `${tip.x}px`, top: `${tip.y}px` } },
              h(
                "svg",
                { className: "stk-touch-ring", width: box, height: box, viewBox: `0 0 ${box} ${box}` },
                h("path", { d, className: "stk-ring-track" }),
                h("path", {
                  d,
                  className: "stk-ring-fill",
                  style: { strokeDasharray: `${len * ratio} ${len}` },
                })
              ),
              h("div", { className: "stk-touch-time" }, `${fmtTime(scrubTime)} / ${fmtTime(duration)}`)
            );
          })(),

        /* the edge double tap leaves a ring and ±5 s on the half it fired on */
        seekFlash &&
          h(
            "div",
            {
              key: seekFlash.key,
              className: "stk-seek-flash stk-seek-" + seekFlash.zone,
              style: { left: `${seekFlash.x}px`, top: `${seekFlash.y}px` },
            },
            h(
              "div",
              { className: "stk-seek-ring" },
              h(Icon, { name: seekFlash.zone === "right" ? "chevron" : "back", size: 20 }),
              h("span", { className: "stk-seek-delta" }, (seekFlash.delta > 0 ? "+" : "\u2212") + Math.abs(seekFlash.delta) + "s")
            )
          ),

        /* the Marker bubble a scrub arms: it hangs above the playhead and the
           finger is already on its way up to it */
        markerDrop &&
          h(
            "div",
            {
              ref: markerDropEl,
              className: "stk-marker-drop" + (markerDrop.over ? " stk-over" : ""),
              style: { left: `${markerDrop.x}px`, bottom: `${markerDrop.bottom || 210}px` },
            },
            h("span", { className: "stk-marker-drop-icon" }, h(Icon, { name: "plus", size: 16 })),
            h("span", { className: "stk-marker-drop-label" }, "Marker"),
            h("span", { className: "stk-marker-drop-time" }, fmtTime(markerDrop.at))
          ),

        onBack &&
          (spec.origin && ["performer", "folder", "tag", "markers", "clip", "favorites"].indexOf(spec.origin.kind) >= 0) &&
          /* same control, same corner as the profile page: the player is embedded in
             a centred 520px stage on a tablet, so absolute positioning put it 157px
             in from the edge and it stopped matching the page it came from */
          h(
            "button",
            { className: "stk-feed-back stk-back-fixed", onClick: onBack, title: "Back", "aria-label": "Back" },
            h(Icon, { name: "back", size: 22 })
          ),

        h(
          "div",
          { className: "stk-pause" + (!playing && ready ? " stk-show" : "") },
          /* keyed so the glyph remounts and its entrance runs on every swap: the
             circle is already fading, and an unkeyed path change teleports */
          h(Icon, { key: playing ? "pause" : "play", name: playing ? "pause" : "play", size: 32 })
        ),

        heartBurst > 0 &&
          h(
            "div",
            { key: heartBurst, className: "stk-big-heart stk-fire" },
            h(Icon, { name: "heart", size: 110, filled: true })
          ),

        rateBadge && h("div", { className: "stk-rate" }, rateBadge),

        cropBadge && h("div", { className: "stk-rate stk-crop-badge" }, cropBadge),

        card &&
          h(
            "div",
            { className: "stk-titlecard" },
            card.image
              ? h("img", { className: "stk-titlecard-img", src: rel(card.image), alt: "" })
              : h("span", { className: "stk-titlecard-img stk-titlecard-glyph" }, h(Icon, { name: "sparkle", size: 20 })),
            h(
              "div",
              { className: "stk-titlecard-text" },
              h("span", { className: "stk-titlecard-kicker" }, card.kind === "performer" ? "GoonCave" : "Feed"),
              h("span", { className: "stk-titlecard-name" }, card.name || "")
            )
          ),

        h(
          "div",
          { className: "stk-top stk-top-left" },
          h(
            "button",
            {
              className: "stk-top-btn",
              title: "Menu",
              onClick: (event) => {
                event.stopPropagation();
                if (onMenu) onMenu();
                else setSheet("feeds");
              },
            },
            h(Icon, { name: "menu", size: 18 })
          ),
          /* mute sits beside the menu button: the user's phone grip is up here
             and the rail is for the actions you take on the clip */
          h(
            "button",
            {
              type: "button",
              className: "stk-top-btn",
              title: muted ? "Unmute" : "Mute",
              "aria-label": muted ? "Unmute" : "Mute",
              onClick: (event) => {
                event.stopPropagation();
                setMuted((value) => !value);
              },
            },
            h(Icon, { name: muted ? "mute" : "volume", size: 18 })
          ),
          /* a one-tag feed is exactly "this tag", so it gets the reel too.
             A plain anchor: CSP blocks fetches to the service, not navigations. */
          spec.type === "tags" && spec.tags && spec.tags.length === 1 &&
            h(
              "a",
              {
                className: "stk-top-btn",
                title: "Highlight reel",
                target: "_blank",
                rel: "noopener",
                href: reelServiceBase() + "/player?tagId=" +
                  encodeURIComponent(String(spec.tags[0])) +
                  "&port=" + encodeURIComponent(String(window.location.port || "")) +
                  "&name=" + encodeURIComponent(spec.name || ""),
              },
              h(Icon, { name: "play", size: 18 })
            )
        ),

        h(
          "div",
          { className: "stk-top stk-top-center" },
          h(
            "button",
            {
              className: "stk-feed-name" + (chanOpen ? " stk-open" : ""),
              onClick: (event) => {
                event.stopPropagation();
                setChanOpen(!chanOpen);
              },
            },
            spec.name || "For You",
            h(Icon, { name: "chevronDown", size: 14, className: "stk-pill-caret" })
          ),
          /* a scrim under the list: the stage's own gestures must not see the tap
             that was meant for a feed row, which is what closed the menu before */
          chanOpen &&
            h("div", { className: "stk-chan-scrim", onClick: () => setChanOpen(false) }),
          chanOpen &&
            h(
              "div",
              { className: "stk-chan-menu", ref: (el) => { if (el) el.scrollTop = 0; } },
              (() => {
                const rows = [];
                const here = channelAt().at;
                let seenMine = false;
                let seenMore = false;
                channelsNow().forEach((c, i) => {
                  if (c.saved && !seenMine) {
                    seenMine = true;
                    rows.push(h("div", { key: "hd-mine", className: "stk-chan-head" }, "Your feeds"));
                  }
                  if (!c.builtin && !c.saved && !seenMore) {
                    seenMore = true;
                    rows.push(h("div", { key: "hd-more", className: "stk-chan-head" }, "More feeds"));
                  }
                  rows.push(
                    h(
                      "button",
                      {
                        key: c.id,
                        className: "stk-chan-row" + (i === here ? " stk-on" : ""),
                        onClick: (event) => {
                          event.stopPropagation();
                          pickChannel(c);
                        },
                      },
                      c.image
                        ? h("img", { className: "stk-chan-avatar", src: rel(c.image), alt: "" })
                        : h("span", { className: "stk-chan-avatar stk-chan-glyph" }, h(Icon, { name: c.builtin ? "sparkle" : c.saved ? "feed" : c.id === "favorites" ? "heart" : c.id === "markers" ? "chapter" : "sort", size: 13 })),
                      h("span", { className: "stk-chan-name" }, c.name),
                      c.kind === "performer" && h("span", { className: "stk-chan-tag" }, "GoonCave"),
                      i === here && h("span", { className: "stk-chan-dot" })
                    )
                  );
                });
                rows.push(h("div", { key: "hd-add", className: "stk-chan-head" }, "Add"));
                rows.push(
                  h(
                    "button",
                    {
                      key: "new-feed",
                      className: "stk-chan-row stk-chan-action",
                      onClick: (event) => {
                        event.stopPropagation();
                        setChanOpen(false);
                        if (onNewFeed) onNewFeed();
                      },
                    },
                    h(Icon, { name: "plus", size: 14 }),
                    h("span", { className: "stk-chan-name" }, "New feed")
                  )
                );
                rows.push(
                  h(
                    "button",
                    {
                      key: "manage-feeds",
                      className: "stk-chan-row stk-chan-action",
                      onClick: (event) => {
                        event.stopPropagation();
                        setChanOpen(false);
                        if (onManageFeeds) onManageFeeds();
                      },
                    },
                    h(Icon, { name: "gear", size: 14 }),
                    h("span", { className: "stk-chan-name" }, "Manage feeds")
                  )
                );
                return rows;
              })(),
              h(
                "button",
                {
                  className: "stk-chan-more",
                  onClick: (event) => {
                    event.stopPropagation();
                    setChanOpen(false);
                    setSheet("feeds");
                  },
                },
                "All feeds…"
              )
            )
        ),

        fullscreen && h(
          "div",
          { className: "stk-fullscreen-controls", role: "group", "aria-label": "Fullscreen playback" },
          !spec.single && h("button", {
            type: "button", className: "stk-top-btn", "aria-label": "Previous clip", disabled: index === 0,
            onClick: () => slideStep(-1),
          }, h(Icon, { name: "chevronUp", size: 19 })),
          !spec.single && h("button", {
            type: "button", className: "stk-top-btn", "aria-label": "Next clip", disabled: items.length < 2,
            onClick: () => slideStep(1),
          }, h(Icon, { name: "chevronDown", size: 19 })),
          h("div", { className: "stk-fullscreen-fit", role: "group", "aria-label": "Framing" },
            [["auto", "Auto"], ["contain", "Fit"], ["cover", "Fill"]].map(([mode, label]) =>
              h("button", { key: mode, type: "button", "aria-pressed": fullscreenFit === mode,
                onClick: () => setFullscreenFit(mode) }, label))
          ),
          h("button", { type: "button", className: "stk-top-btn", "aria-label": "Exit full screen",
            onClick: exitFullscreen }, h(Icon, { name: "fullscreenExit", size: 19 }))
        ),
        !fullscreen && h(
          "div",
          { className: "stk-top stk-top-right" },
          /* the full-screen button is gone from the bar: the top row is now
             settings + search, and full screen still comes from the clip's own
             controls. */
          /* settings sits between full screen and search, and the switch in
             Settings → Navigation removes it for a bare stage */
          prefs.topSettings !== false && onSettings &&
            h(
              "button",
              {
                type: "button",
                className: "stk-top-btn",
                title: "Settings",
                "aria-label": "Settings",
                onClick: (event) => {
                  event.stopPropagation();
                  onSettings();
                },
              },
              h(Icon, { name: "gear", size: 18 })
            ),
          h(
            "button",
            {
              className: "stk-top-btn",
              onClick: (event) => {
                event.stopPropagation();
                if (onSearch) onSearch();
              },
            },
            h(Icon, { name: "search", size: 18 })
          )
        ),

        h(
          "div",
          { className: "stk-info" + (scrubBar ? " stk-up" : "") },
          h(
            "div",
            { className: "stk-handle-row stk-handle-row-text" },
            h(
              "button",
              { className: "stk-handle-at", onClick: (event) => { event.stopPropagation(); openHandle(); } },
              String(handle.name || "").replace(/\s+/g, " ").trim()
            ),
            handle.performer &&
              (handle.performer.rating100 != null && handle.performer.rating100 >= cfg.heartRating
                /* a favourited performer is the stronger fact, so the heart replaces
                   the blue performer check rather than sitting beside it */
                ? h(
                    "span",
                    { className: "stk-verified stk-verified-fav", title: "Favorite performer", "aria-label": "Favorite performer" },
                    h(Icon, { name: "heart", size: 14, filled: true })
                  )
                : h(
                    "span",
                    { className: "stk-verified", title: "Performer", "aria-label": "Performer" },
                    h(Icon, { name: "verified", size: 14 })
                  ))
          ),
          (() => {
            const scene = item && item.scene;
            if (!scene) return null;
            const file = (scene.files && scene.files[0]) || {};
            const path = prettyPath(file.path);
            const meta = [
              shortDate(scene.created_at || scene.date),
              file.size ? fmtBytes(file.size) : "",
              file.width && file.height ? Math.min(file.width, file.height) + "p" : "",
            ].filter(Boolean);
            if (!path && !meta.length) return null;
            return h(
              "div",
              { className: "stk-caption" },
              scene.title && h("div", { className: "stk-caption-line stk-caption-title" }, scene.title),
              h(
                "div",
                { className: "stk-caption-line stk-caption-meta" },
                h("span", { className: "stk-caption-metatext" }, meta.join(" • ")),
                !sfw &&
                  h("span", { className: "stk-caption-time" }, `${fmtTime(time)} / ${fmtTime(duration)}`)
              ),
              showPath &&
                path &&
                h(
                  "div",
                  { className: "stk-caption-line stk-caption-path" },
                  h(Icon, { name: "folder", size: 11 }),
                  h("span", null, path)
                )
            );
          })(),
          /* the caption's hashtag strip is hidden: a clip's tags are a thing to
             check and edit, not something to read while watching, and the rail's
             add-tag button now opens the one place that shows them. Flip
             SHOW_CAPTION_TAGS back to true to bring the strip back. */
          SHOW_CAPTION_TAGS &&
          tags.length > 0 &&
            h(
              "div",
              { className: "stk-hashtagwrap" },
              h(
                "div",
                { className: "stk-hashtags", ref: tagsRef },
                tags.map((tag, tagIndex) =>
                  h(
                    "button",
                    {
                      key: tag.id,
                      className: "stk-hashtext" + (tagIndex >= tagFit ? " stk-hashtext-cut" : ""),
                      onClick: (event) => {
                        event.stopPropagation();
                        onOpenTag(tag);
                      },
                    },
                    "#" + tag.name.replace(/\s+/g, "-").toLowerCase()
                  )
                ),
                /* in flow, after the tags that fit: nothing is drawn over a tag,
                   and it disappears with the strip when the HUD folds away */
                tagFit < tags.length &&
                  h(
                    "button",
                    {
                      className: "stk-hashtext stk-hashtext-more",
                      onClick: (event) => {
                        event.stopPropagation();
                        setTagsOpen(true);
                      },
                    },
                    "…more"
                  )
              )
            ),
        ),

        h(
          "div",
          { className: "stk-rail" },
          desktop &&
            h(
              "div",
              { className: "stk-rail-nav" },
              h(
                "button",
                {
                  className: "stk-rail-arrow",
                  title: "Previous clip",
                  onClick: (event) => {
                    event.stopPropagation();
                    goPrev();
                  },
                },
                h(Icon, { name: "chevronUp", size: 20 })
              ),
              h(
                "button",
                {
                  className: "stk-rail-arrow",
                  title: "Next clip",
                  onClick: (event) => {
                    event.stopPropagation();
                    goNext();
                  },
                },
                h(Icon, { name: "chevronDown", size: 20 })
              )
            ),
          h(
            "button",
            {
              className: "stk-rail-avatar-btn",
              onClick: (event) => {
                event.stopPropagation();
                openHandle();
              },
            },
            handle.image
              ? h("img", { className: "stk-rail-avatar", src: handle.image, alt: "" })
              : h("span", { className: "stk-rail-avatar stk-rail-avatar-text" }, initials(handle.name)),
            performers.length > 1 && h("span", { className: "stk-rail-badge" }, performers.length)
          ),
          h(
            "button",
            {
              className: "stk-rail-heart" + (rating != null && rating >= cfg.heartRating ? " stk-on" : ""),
              title: "Heart (hold for favourites)",
              onClick: (event) => {
                event.stopPropagation();
                if (railHeld.current) {
                  railHeld.current = false;
                  return;
                }
                toggleHeart();
              },
              onPointerDown: (event) => {
                const box = event.currentTarget.getBoundingClientRect();
                railHeld.current = false;
                window.clearTimeout(railPress.current);
                railPress.current = window.setTimeout(() => {
                  railHeld.current = true;
                  setRailMenu({ top: Math.max(12, box.top - 10) });
                }, 450);
              },
              onPointerUp: () => window.clearTimeout(railPress.current),
              onPointerCancel: () => window.clearTimeout(railPress.current),
              onPointerLeave: () => window.clearTimeout(railPress.current),
              onContextMenu: (event) => {
                event.preventDefault();
                event.stopPropagation();
                window.clearTimeout(railPress.current);
                railHeld.current = true;
                setRailMenu({ top: Math.max(12, event.currentTarget.getBoundingClientRect().top - 10) });
              },
            },
            h(Icon, { name: "heart", size: 26, filled: rating != null && rating >= cfg.heartRating })
          ),
          h(
            "button",
            {
              className: "stk-rail-tagbtn",
              title: "Add tag",
              onClick: (event) => {
                event.stopPropagation();
                openTagSheet();
              },
            },
            h(
              "span",
              { className: "stk-rail-icoplus" },
              h(Icon, { name: "tag", size: 26 }),
              h("i", { className: "stk-rail-plus", "aria-hidden": "true" }, "+")
            )
          ),
          /* add a marker: the same shape as add-tag, one row below it, so the
             rail reads heart → tag → marker → more */
          h(
            "button",
            {
              className: "stk-rail-markerbtn",
              title: "Add marker",
              onClick: (event) => {
                event.stopPropagation();
                openMarkerSheet();
              },
            },
            h(
              "span",
              { className: "stk-rail-icoplus" },
              h(Icon, { name: "chapter", size: 26 }),
              h("i", { className: "stk-rail-plus", "aria-hidden": "true" }, "+")
            )
          ),
          /* more: a circle with three dots, the shape the user asked for, and no
             caption — the rail is icons only */
          h(
            "button",
            {
              className: "stk-rail-more",
              title: "More",
              onClick: (event) => {
                event.stopPropagation();
                setSheet("actions");
              },
            },
            h("span", { className: "stk-rail-circle" }, h(Icon, { name: "more", size: 20 }))
          )
        ),

        railMenu &&
          h(
            "div",
            { className: "stk-rail-backdrop", onClick: () => setRailMenu(null), style: { position: "fixed", inset: 0, zIndex: 59 } },
            h(
              "div",
              {
                className: "stk-rail-menu",
                style: { top: railMenu.top + "px", right: "84px" },
                onClick: (event) => event.stopPropagation(),
              },
              h(
                "button",
                {
                  onClick: () => {
                    toggleHeart();
                    setRailMenu(null);
                  },
                },
                h(Icon, { name: "heart", size: 18, filled: rating != null && rating >= cfg.heartRating }),
                rating != null && rating >= cfg.heartRating ? "Remove scene from Favorites" : "Add scene to Favorites"
              ),
              h(
                "button",
                {
                  onClick: () => {
                    const target = handle.performer || (item && item.scene && (item.scene.performers || [])[0]);
                    if (target && target.id) {
                      gql(`mutation StashTokFavPerformer($id: ID!) { performerUpdate(input: { id: $id, rating100: 100 }) { id } }`, { id: target.id });
                    }
                    setRailMenu(null);
                  },
                },
                h(Icon, { name: "verified", size: 18 }),
                "Add performer to Favorites"
              )
            )
          ),

        /* the pinch-zoom readout ("1.5x" / "2x") used to sit here; the user read it
           as a leftover speed control and asked for it to go */

        /* right-click on the video: one row, because "add marker here" is the
           only thing the stage has to say about the frame under the cursor */
        ctxMenu &&
          h(
            "div",
            {
              className: "stk-ctx-backdrop",
              style: { position: "fixed", inset: 0, zIndex: 61 },
              onClick: () => setCtxMenu(null),
              onContextMenu: (event) => {
                event.preventDefault();
                setCtxMenu(null);
              },
            },
            h(
              "div",
              {
                className: "stk-ctx-menu",
                style: {
                  left: Math.max(8, Math.min(ctxMenu.x, (window.innerWidth || 360) - 216)) + "px",
                  top: Math.max(8, Math.min(ctxMenu.y, (window.innerHeight || 640) - 64)) + "px",
                },
                onClick: (event) => event.stopPropagation(),
              },
              h(
                "button",
                { type: "button", onClick: () => openMarkerSheet(ctxMenu.at) },
                h(Icon, { name: "chapter", size: 16 }),
                "Add marker",
                h("span", null, fmtTime(ctxMenu.at))
              )
            )
          ),

        undo &&
          item &&
          String(undo.sceneId) === String(item.scene.id) &&
          h(
            "div",
            { className: "stk-undo" },
            h("span", null, "Tagged " + undo.label),
            h("button", { onClick: revertUndo }, "Undo")
          ),

        markerUndo &&
          item &&
          String(markerUndo.sceneId) === String(item.scene.id) &&
          h(
            "div",
            { className: "stk-undo" },
            h("span", null, "Marker " + markerUndo.label + " · " + fmtTime(markerUndo.seconds)),
            h("button", { onClick: revertMarker }, "Undo")
          ),

        !sfw &&
        h(
          "div",
          {
            className: "stk-timeline" + (scrubbing ? " stk-scrubbing" : "") + (scrubBar ? " stk-open" : ""),
            onPointerDown: onTimelineDown,
            onPointerMove: onTimelineMove,
            onPointerUp: onTimelineUp,
            onPointerCancel: onTimelineUp,
            onPointerLeave: () => setScrubPreview(null),
          },
          scrubPreview &&
            (duration > 0 || Number((scene.files && scene.files[0] && scene.files[0].duration) || 0) > 0) &&
            h(
              "div",
              {
                className: "stk-scrub-preview",
                style: { left: `${Math.max(4, Math.min(96, scrubPreview.pct * 100))}%` },
              },
              scrubPreview.hasSprite
                ? h("div", {
                    className: "stk-scrub-cell",
                    style: {
                      width: scrubPreview.w + "px",
                      height: scrubPreview.h + "px",
                      backgroundImage: `url("${scrubPreview.src}")`,
                      backgroundPosition: `-${scrubPreview.x}px -${scrubPreview.y}px`,
                    },
                  })
                : h("img", {
                    className: "stk-scrub-cell",
                    src: `/scene/${scrubPreview.sceneId}/screenshot?t=${Math.round(scrubPreview.time)}`,
                    alt: "",
                    loading: "eager",
                  }),
              h("span", { className: "stk-scrub-time" }, fmtTime(scrubPreview.time))
            ),

          h(
            "div",
            { className: "stk-timeline-inner" },
            h("div", { className: "stk-timeline-fill", style: { width: `${scrubbingRatio * 100}%` } }),
            scrubBar &&
              h("div", {
                className: "stk-timeline-knob",
                style: { left: `${scrubbingRatio * 100}%` },
                "aria-hidden": "true",
              }),
            cfg.showMarkerTicks &&
              duration > 0 &&
              markers.map((marker) =>
                h("div", {
                  key: marker.id,
                  className: "stk-tick",
                  style: { left: `${(Number(marker.seconds) / duration) * 100}%` },
                })
              ),
            scrubbing &&
              nearMarker &&
              h(
                "div",
                { className: "stk-scrub-label", style: { left: `${scrubbingRatio * 100}%` } },
                `${fmtTime(nearMarker.seconds)} · ${nearMarker.primary_tag ? nearMarker.primary_tag.name : "Marker"}`
              )
          )
        ),

        tagsOpen &&
          h(
            TagSheetShell,
            { title: "More Tags", onClose: () => setTagsOpen(false), extraClass: "stk-moretags-sheet" },
            h(
              "div",
              { className: "stk-moretags-list" },
              tags.map((tag) =>
                h(
                  "button",
                  {
                    key: tag.id,
                    className: "stk-tagpill",
                    onClick: () => {
                      setTagsOpen(false);
                      onOpenTag(tag);
                    },
                  },
                  "#" + tag.name.replace(/\s+/g, "-").toLowerCase()
                )
              )
            )
          ),

        sheet === "feeds" &&
          h(FeedPicker, {
            feeds: feeds || [],
            current: spec,
            onPick: (next) => {
              setSheet(null);
              onSwitchFeed(next);
            },
            onNew: () => {
              setSheet(null);
              onNewFeed();
            },
            onOrder: (order) => {
              setSheet(null);
              onSwitchFeed(Object.assign({}, spec || defaultFeed(), order, { startSceneId: null, startAt: null }));
            },
            onDetails: () => {
              setSheet(null);
              onEditFeed(Object.assign({}, spec || defaultFeed()));
            },
            onClose: () => setSheet(null),
          }),

        /* ---- Add Marker ---------------------------------------------------
           H1, the name field, then the prefilled names. One tag names the
           marker: tapping a chip fills the field, tapping it again clears it,
           and whatever is in the field is what gets created. */
        markerAt != null &&
          h(
            TagSheetShell,
            {
              title: "Add Marker",
              subtitle: "In point " + fmtTime(markerAt),
              onClose: () => setMarkerAt(null),
              dialogRef: markerDialogRef,
              footer: h(
                "button",
                {
                  className: "stk-btn stk-tag-done",
                  disabled: markerBusy || !markerName.trim(),
                  onClick: createMarker,
                },
                markerBusy ? "Saving…" : "Create marker"
              ),
            },
            /* the frame itself, as a snapshot: the in point is easier to trust
               when you can see it, and a polaroid reads as "this moment" rather
               than as another control competing with the pills */
            item &&
              item.scene &&
              h(
                "figure",
                { className: "stk-marker-snap" },
                h("img", {
                  className: "stk-marker-snap-img",
                  src: `/scene/${item.scene.id}/screenshot?t=${Math.max(0, Math.round(Number(markerAt) || 0))}`,
                  alt: "",
                  draggable: false,
                  loading: "eager",
                })
              ),
            h("label", { className: "stk-marker-label", htmlFor: "stk-marker-name" }, "Marker Name"),
            h("input", {
              id: "stk-marker-name",
              className: "stk-tag-search stk-marker-input",
              placeholder: "Type any tag or a new name…",
              value: markerName,
              onChange: (event) => {
                setMarkerName(event.target.value);
                setMarkerTyping(true);
              },
              onKeyDown: (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                createMarker();
              },
            }),
            h("h4", { className: "stk-marker-pre" }, "Prefilled Names"),
            h("p", { className: "stk-tag-note" }, "Use the below tags to automatically name the Marker"),
            h(
              "div",
              { className: "stk-tag-scroll" },
              h(TagSections, {
                /* typing is the override: a name outside the four marker
                   sections (an ethnicity, a body tag, or something the library
                   has never seen) is searched across the whole vocabulary and
                   is still creatable as-is */
                sections: markerTyping ? TAG_SHEET_SECTIONS : MARKER_TAG_SECTIONS,
                query: markerTyping ? markerName : "",
                shown: markerShown,
                onMore: (sectionId, total) => showMore(sectionId, total, setMarkerShown),
                isOn: (name) => markerName.trim().toLowerCase() === String(name).toLowerCase(),
                onToggle: (name) => {
                  setMarkerTyping(false);
                  setMarkerName((cur) => (cur.trim().toLowerCase() === String(name).toLowerCase() ? "" : name));
                },
                category: markerCategory,
                onCategory: (name) => {
                  setMarkerTyping(false);
                  setMarkerName((cur) => (cur.trim().toLowerCase() === String(name).toLowerCase() ? "" : name));
                },
                onChild: (parent, name) => {
                  setMarkerTyping(false);
                  setMarkerName((cur) => (cur.trim().toLowerCase() === String(name).toLowerCase() ? parent : name));
                },
              })
            )
          ),

        tagOpen &&
          h(
            TagSheetShell,
            {
              title: "Add tags",
              onClose: () => setTagOpen(false),
              dialogRef: tagDialogRef,
              footer: h(
                "button",
                {
                  className: "stk-btn stk-tag-done",
                  disabled: tagBusy,
                  onClick: commitTags,
                },
                tagBusy ? "Saving…" : "Done" + (tagPending.length ? ` (${tagPending.length})` : "")
              ),
            },
            h("input", {
              className: "stk-tag-search",
              ref: tagInputRef,
              placeholder: "Type a tag — comma or Tab to add",
              value: tagFilter,
              autoComplete: "off",
              autoCapitalize: "words",
              spellCheck: false,
              onChange: (event) => onTagFieldChange(event.target.value),
              onKeyDown: onTagFieldKey,
            }),
            /* the chips closed with , / Tab, and the live suggestions under the
               field: clicking one queues it exactly as the library spells it */
            (tagQueue.length > 0 || tagSugg.length > 0 || tagCreateName) &&
              h(
                "div",
                { className: "stk-tagfield" },
                tagQueue.length > 0 &&
                  h(
                    "div",
                    { className: "stk-tagqueue" },
                    tagQueue.map((name) =>
                      h(
                        "button",
                        {
                          key: name,
                          type: "button",
                          className: "stk-queuechip",
                          title: "Remove",
                          onClick: () => setTagQueue((prev) => prev.filter((entry) => entry !== name)),
                        },
                        name,
                        h("span", { className: "stk-queuechip-x", "aria-hidden": "true" }, "\u00d7")
                      )
                    )
                  ),
                (tagSugg.length > 0 || tagCreateName) &&
                  h(
                    "div",
                    { className: "stk-tagsugg", role: "listbox" },
                    tagCreateName &&
                      h(
                        "button",
                        {
                          type: "button",
                          className: "stk-sugg stk-sugg-new",
                          onMouseDown: (event) => event.preventDefault(),
                          onClick: () => {
                            appendTagNames([tagCreateName]);
                            setTagFilter("");
                            setTagSugg([]);
                            setTagSuggSel(-1);
                          },
                        },
                        h("span", { className: "stk-sugg-name" }, "Create \u201c" + tagCreateName + "\u201d"),
                        h("span", { className: "stk-sugg-count" }, "new")
                      ),
                    tagSugg.map((row, rowIndex) => {
                      const have = sceneTagNames.has(String(row.name).trim().toLowerCase());
                      return h(
                        "button",
                        {
                          key: row.id,
                          type: "button",
                          role: "option",
                          "aria-selected": rowIndex === tagSuggSel,
                          className: "stk-sugg" + (rowIndex === tagSuggSel ? " stk-sel" : "") + (have ? " stk-have" : ""),
                          onMouseDown: (event) => event.preventDefault(),
                          onClick: () => {
                            if (have) return;
                            appendTagNames([row.name]);
                            setTagFilter("");
                            setTagSugg([]);
                            setTagSuggSel(-1);
                          },
                        },
                        h("span", { className: "stk-sugg-name" }, row.name),
                        h(
                          "span",
                          { className: "stk-sugg-count" },
                          have ? "on scene" : row.scene_count != null ? String(row.scene_count) : ""
                        )
                      );
                    })
                  )
              ),
            h(
              "div",
              { className: "stk-tag-scroll" },
              h(TagSections, {
                query: tagFilter,
                shown: tagShown,
                onMore: (sectionId, total) => showMore(sectionId, total, setTagShown),
                isOn: tagIsOn,
                isChildOn: (name) => !!tagKids[name] || sceneTagNames.has(String(name).trim().toLowerCase()),
                onToggle: toggleTagName,
                category: tagCat,
                onCategory: toggleCategory,
                onChild: toggleChild,
              })
            )
          ),

        sheet && sheet !== "feeds" &&
          h(Sheet, {
            mode: sheet,
            item,
            cfg,
            rating,
            onRate: commitRating,
            onHeart: toggleHeart,
            speed,
            onSpeed: setSpeed,
            onRotate: rotate,
            onFlag: flagCurrent,
            /* the panel's flags are state, not one-shot actions: the delete flag
               also removes the clip from the feed, the duplicate flag only tags */
            flagged: item ? isFlagged(item.scene, cfg) : false,
            dupeFlagged: item ? sceneDupeTagged(item.scene) : false,
            onFlagToggle: (on) => { toggleFlagTag(on); if (on) { dropCurrent(); buzz(40); } },
            onDupeToggle: toggleDupeTag,
            onAddMarker: () => {
              setSheet(null);
              openMarkerSheet();
            },
            onClose: () => setSheet(null),
            onOpenPerformer,
            onOpenTag,
            onDeriveFeed,
            onJump: (seconds) => {
              const video = activeVideo();
              if (video) video.currentTime = seconds;
              setSheet(null);
              setPlaying(true);
            },
            onNext: goNext,
          })
      ),
    );
  }

  const NAV_OPTIONS = [
    { id: "performers", label: "Performers", icon: "user" },
    { id: "discover", label: "Discover", icon: "sparkle" },
    { id: "favorites", label: "Favorites", icon: "heart" },
    { id: "tags", label: "Tags", icon: "tag" },
    { id: "folders", label: "Folders", icon: "folder" },
    { id: "markers", label: "Markers", icon: "chapter" },
    { id: "random", label: "Random", icon: "sparkle" },
    { id: "settings", label: "Settings", icon: "gear" },
    { id: "ops", label: "Ops", icon: "ops" },
  ];
  /* Feed is fixed, then the four slots render in order */
  const DEFAULT_NAV_SLOTS = ["discover", "performers", "favorites", "settings"];

  /* The bottom bar's own tabs: tapped tens of times a day, so they get the shorter
     fade. Everything else (a profile, a settings section, the clip page) is an
     occasional arrival and gets the full one. */
  const NAV_TABS = ["home", "performers", "discover", "search", "favorites", "tags", "folders", "markers"];

  /* Fades the arriving page in. The animation is restarted through a data attribute
     instead of a React key: a key would remount the page's own component on every
     sub-page change (settings sections, a tag page) and re-run its queries. React
     never writes this attribute, so an imperative write survives its renders — the
     same trap the scroll reveal's data-in documents. */
  function PageSwap({ swapKey, tab, children }) {
    const ref = useRef(null);
    /* layout effect, not effect: the attribute has to be set before the browser
       paints, or the page shows at full opacity for one frame and then jumps back
       to the animation's from-state */
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      el.removeAttribute("data-swap");
      /* force a reflow so the same attribute re-adds as a new animation */
      void el.offsetWidth;
      el.dataset.swap = "1";
    }, [swapKey]);
    return h(
      "div",
      { ref, className: "stk-page-swap" + (tab ? " stk-tab-swap" : "") },
      children
    );
  }

  function NavButton({ active, icon, label, onClick, onLongPress }) {
    const timer = useRef(0);
    const fired = useRef(false);
    return h(
      "button",
      {
        className: active ? "stk-active" : "",
        onPointerDown: () => {
          if (!onLongPress) return;
          fired.current = false;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            fired.current = true;
            onLongPress();
          }, 480);
        },
        onPointerUp: () => window.clearTimeout(timer.current),
        onPointerLeave: () => window.clearTimeout(timer.current),
        onPointerCancel: () => window.clearTimeout(timer.current),
        onClick: () => {
          if (fired.current) {
            fired.current = false;
            return;
          }
          onClick();
        },
      },
      h(Icon, { name: icon, size: 21 }),
      h("span", null, label)
    );
  }



  /* ------------------------------------------------------------------ */
  /* sheet                                                              */
  /* ------------------------------------------------------------------ */

  /** dialog behaviour for every overlay: Esc closes, Tab stays inside, focus returns
      to whatever opened it. Returns the ref to put on the sheet element. */
  function useDialog(open, onClose) {
    const ref = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
      if (!open) return undefined;
      const previous = document.activeElement;
      const el = ref.current;
      const focusables = () =>
        el
          ? Array.from(
              el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
            ).filter((node) => !node.disabled && node.offsetParent !== null)
          : [];
      const first = focusables()[0];
      if (first && first.focus) first.focus();
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (closeRef.current) closeRef.current();
          return;
        }
        if (event.key !== "Tab") return;
        const list = focusables();
        if (!list.length) return;
        const head = list[0];
        const tail = list[list.length - 1];
        if (event.shiftKey && document.activeElement === head) {
          event.preventDefault();
          tail.focus();
        } else if (!event.shiftKey && document.activeElement === tail) {
          event.preventDefault();
          head.focus();
        }
      };
      document.addEventListener("keydown", onKey, true);
      return () => {
        document.removeEventListener("keydown", onKey, true);
        if (previous && previous.focus) previous.focus();
      };
    }, [open]);
    return ref;
  }

  /* ---- the six sections, drawn the same way everywhere ------------------
     A section is either a flat chip grid or (Category) a pair of exclusive
     parents with a child drawer. Paged sections show TAG_PAGE chips and grow
     eight at a time; a search query overrides the pagination so a hidden tag
     is never unreachable by typing. */
  function TagSections({ sections = TAG_SHEET_SECTIONS, query, shown, onMore, isOn, isChildOn, onToggle, category, onCategory, onChild }) {
    const kidOn = isChildOn || isOn;
    const q = String(query || "").trim().toLowerCase();
    const matches = (name) => !q || String(name).toLowerCase().includes(q);

    const chip = (name, extraClass) => {
      const on = isOn(name);
      return h(
        "button",
        {
          key: name,
          type: "button",
          className: "stk-tagpick" + (on ? " stk-on" : "") + (extraClass ? " " + extraClass : ""),
          "aria-pressed": on,
          onClick: () => onToggle(name),
        },
        name
      );
    };

    return sections.map((section) => {
      if (section.parents) {
        const ownerOf = (name) =>
          section.parents.find((parent) =>
            (section.children[parent] || []).some((kid) => kid.toLowerCase() === String(name).toLowerCase())
          ) || "";
        /* a query surfaces children even with the drawer closed; otherwise the
           drawer only exists for the selected parent */
        const kidRows = [];
        if (q) {
          section.parents.forEach((parent) => {
            (section.children[parent] || []).filter(matches).forEach((name) => kidRows.push(name));
          });
        } else if (category) {
          (section.children[category] || []).forEach((name) => kidRows.push(name));
        }
        const anyParent = section.parents.some(matches);
        if (!anyParent && !kidRows.length) return null;
        return h(
          "div",
          { key: section.id, className: "stk-tag-section stk-cat-section" },
          h("h4", null, section.title),
          h(
            "div",
            { className: "stk-tag-grid" },
            section.parents.map((name) =>
              h(
                "button",
                {
                  key: name,
                  type: "button",
                  className: "stk-tagpick stk-catpill" + (category === name ? " stk-on" : ""),
                  "aria-pressed": category === name,
                  onClick: () => onCategory(name),
                },
                name
              )
            )
          ),
          kidRows.length
            ? h(
                "div",
                { className: "stk-cat-drawer" },
                kidRows.map((name) =>
                  h(
                    "button",
                    {
                      key: name,
                      type: "button",
                      className: "stk-tagpick stk-kidchip" + (kidOn(name) ? " stk-on" : ""),
                      "aria-pressed": kidOn(name),
                      /* a child is picked through its parent, so picking one
                         always selects the parent it belongs to */
                      onClick: () => onChild(ownerOf(name), name),
                    },
                    name
                  )
                )
              )
            : null
        );
      }

      const all = section.tags.filter(matches);
      if (!all.length) return null;
      const limit = section.paged && !q ? Math.min(shown[section.id] || TAG_PAGE, all.length) : all.length;
      const visible = all.slice(0, limit);
      const remaining = all.length - limit;
      return h(
        "div",
        { key: section.id, className: "stk-tag-section" },
        h("h4", null, section.title),
        h(
          "div",
          { className: "stk-tag-grid" },
          visible.map((name) => chip(name)),
          section.paged && !q
            ? h(
                "button",
                {
                  key: "__more",
                  type: "button",
                  className: "stk-morepill",
                  onClick: () => onMore(section.id, all.length),
                },
                remaining > 0 ? "+ " + Math.min(TAG_PAGE, remaining) + " more" : "Show less"
              )
            : null
        )
      );
    });
  }

  /* ---- one shell for every tag surface ----------------------------------
     The tag sheet, the marker sheet, the "more tags" list and the performer's
     body tags are the same object: a bottom sheet with a title, a body that
     scrolls, and an optional footer action. They had drifted into four shapes
     (one of them a height-less strip pinned to the bottom), so the geometry and
     the head live here and each caller only supplies content. */
  function TagSheetShell({ title, subtitle, note, onClose, dialogRef, extraClass, children, footer }) {
    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
      h(
        "div",
        {
          className: "stk-sheet stk-tag-sheet" + (extraClass ? " " + extraClass : ""),
          ref: dialogRef,
          onClick: (event) => event.stopPropagation(),
        },
        h(
          "h3",
          null,
          h("span", null, title),
          h("button", { className: "stk-btn", onClick: onClose, "aria-label": "Close" }, h(Icon, { name: "x", size: 16 }))
        ),
        subtitle ? h("p", { className: "stk-tag-note" }, subtitle) : null,
        note ? h("p", { className: "stk-tag-note" }, note) : null,
        h("div", { className: "stk-tag-body" }, children),
        footer ? h("div", { className: "stk-tag-foot" }, footer) : null
      )
    );
  }

  function FeedPicker({ feeds, current, onPick, onNew, onClose, onOrder, onDetails }) {
    const dialogRef = useDialog(true, onClose);
    const builtins = [
      { id: "foryou", name: "For You", type: "foryou", sort: "random", hint: "Random across the library" },
      { id: "favorites", name: "Favorites", type: "favorites", sort: "rating", direction: "DESC", hint: "Everything you rated or hearted" },
      { id: "markers", name: "Markers", type: "markers", hint: "Random scene markers" },
    ];
    const saved = (feeds || []).filter((feed) => feed.type !== "foryou" && feed.type !== "favorites");
    const row = (feed, hint) =>
      h(
        "button",
        {
          key: feed.id,
          className: "stk-marker-row" + (current && current.id === feed.id ? " stk-row-current" : ""),
          onClick: () => onPick(feed),
        },
        h(Icon, { name: "sparkle", size: 14 }),
        h("div", null, feed.name, h("br"), h("span", null, hint || feed.type)),
        current && current.id === feed.id ? h("b", null, "●") : null
      );

    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-sheet", ref: dialogRef, onClick: (event) => event.stopPropagation() },
        h(
          "h3",
          null,
          h("span", null, "Feeds"),
          h("button", { className: "stk-btn", onClick: onClose }, h(Icon, { name: "x", size: 16 }))
        ),
        onOrder &&
          h(
            React.Fragment,
            null,
            h("h4", null, "Order"),
            h(
              "div",
              { className: "stk-order-row" },
              [
                ["new", "New", "updated_at", "DESC"],
                ["random", "Random", "random", "DESC"],
                ["top", "Top rated", "rating", "DESC"],
                ["longest", "Longest", "duration", "DESC"],
              ].map(([key, text, sort, direction]) =>
                h(
                  "button",
                  {
                    key,
                    className:
                      "stk-order-pill" +
                      (current && current.sort === sort && (current.direction || "DESC") === direction ? " stk-active" : ""),
                    onClick: () => onOrder({ sort, direction }),
                  },
                  text
                )
              )
            )
          ),
        onDetails &&
          h(
            "button",
            { className: "stk-marker-row", onClick: onDetails },
            h(Icon, { name: "sliders", size: 14 }),
            h("div", null, "Feed details", h("br"), h("span", null, "filters, minimum length, time window"))
          ),
        h("h4", null, "Built in"),
        builtins.map((feed) => row(feed, feed.hint)),
        saved.length > 0 && h("h4", null, "Your feeds"),
        saved.map((feed) => row(feed)),
        h(
          "button",
          { className: "stk-btn stk-primary", onClick: onNew, style: { marginTop: "10px" } },
          h(Icon, { name: "plus", size: 14 }),
          "Build a feed"
        ),
        h(
          "p",
          { className: "stk-sub", style: { marginTop: "12px" } },
          "For You is random. Custom feeds can be a tag, a set of tags, a performer, markers, never-played, shorts, vertical-only or a saved Stash filter."
        )
      )
    );
  }

  /* The clip panel behind the rail's "more" button.

     `actions` is the shape the user specified: file name + one meta line, the
     performers as circles you can tap, Playback (speed, rotate) and Stash
     Management (the two flags) as rows with rounded-square icons and the control
     on the right. `details` keeps the full file table for the same scene.
     Rating is deliberately gone: the only thing worth showing is whether the
     scene is one of your favourites. */
  function Sheet({ mode, item, cfg, rating, onRate, onHeart, speed, onSpeed, onRotate, onFlag,
    onFlagToggle, onDupeToggle, flagged, dupeFlagged, onClose, onOpenPerformer, onOpenTag,
    onDeriveFeed, onJump, onNext, onAddMarker }) {
    const dialogRef = useDialog(true, onClose);
    const scene = item.scene;
    const file = (scene.files && scene.files[0]) || {};
    const markers = scene.scene_markers || [];
    const performers = scene.performers || [];
    const tags = scene.tags || [];
    const [flagOn, setFlagOn] = useState(!!flagged);
    const [dupeOn, setDupeOn] = useState(!!dupeFlagged);

    useEffect(() => { setFlagOn(!!flagged); }, [flagged]);
    useEffect(() => { setDupeOn(!!dupeFlagged); }, [dupeFlagged]);

    const fileName = (file.path || "").split("/").pop() || scene.title || "Scene";
    const meta = [
      shortDate(scene.date || scene.created_at),
      file.size ? fmtBytes(file.size) : "",
      file.width && file.height ? `${file.width}x${file.height}` : "",
      file.duration ? fmtTime(file.duration) : "",
    ].filter(Boolean).join(" · ");
    const hearted = rating != null && rating >= cfg.heartRating;

    const head = [
      h("h3", null,
        h("span", { className: "stk-sheet-name" }, fileName),
        h("button", { className: "stk-btn", onClick: onClose }, h(Icon, { name: "x", size: 16 }))
      ),
      h("div", { className: "stk-sheet-meta" }, meta),
    ];

    if (mode !== "details") {
      const panelRow = (icon, label, control) =>
        h("div", { className: "stk-panel-row", key: label },
          h("span", { className: "stk-panel-ic" }, h(Icon, { name: icon, size: 15 })),
          h("span", { className: "stk-panel-label" }, label),
          control
        );
      return h(
        React.Fragment,
        null,
        h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
        h(
          "div",
          { className: "stk-sheet stk-clip-panel", ref: dialogRef, onClick: (event) => event.stopPropagation() },
          head,

          h("button", { type: "button", className: "stk-panel-row stk-panel-fav" + (hearted ? " stk-on" : ""), onClick: onHeart },
            h("span", { className: "stk-panel-ic" }, h(Icon, { name: "heart", size: 15, filled: hearted })),
            h("span", { className: "stk-panel-label" }, "Favorite"),
            h("span", { className: "stk-panel-value" }, hearted ? "On" : "Off")
          ),

          performers.length > 0 &&
            h("div", { className: "stk-panel-sec" },
              h("h4", { className: "stk-panel-head" }, performers.length > 1 ? "Performers" : "Performer"),
              h("div", { className: "stk-perfcircles" },
                performers.map((performer) =>
                  h("button",
                    {
                      key: performer.id,
                      type: "button",
                      className: "stk-perfcircle",
                      onClick: () => { onClose(); onOpenPerformer(performer); },
                    },
                    performer.image_path
                      ? h("img", { className: "stk-perfcircle-img", src: rel(performer.image_path), alt: "" })
                      : h("span", { className: "stk-perfcircle-img stk-perfcircle-initials" }, initials(performer.name)),
                    h("span", { className: "stk-perfcircle-name" }, performer.name)
                  )
                )
              ),
              performers.length > 1 &&
                h("button", {
                  type: "button",
                  className: "stk-panel-link",
                  onClick: () => { onClose(); onOpenPerformer(performers[0]); },
                }, "Show all performers")
            ),

          h("div", { className: "stk-panel-sec" },
            h("h4", { className: "stk-panel-head" }, "Playback"),
            panelRow("play", "Speed",
              h("div", { className: "stk-qm-seg" },
                [0.5, 1, 2].map((value) =>
                  h("button",
                    {
                      key: value,
                      type: "button",
                      className: "stk-qm-seg-btn" + (speed === value ? " stk-on" : ""),
                      onClick: () => onSpeed(value),
                    },
                    `${value}x`
                  )
                )
              )
            ),
            panelRow("rotate", "Rotate Video",
              h("button", { type: "button", className: "stk-panel-chip", onClick: () => onRotate(90) }, "Rotate Right 90°")
            )
          ),

          h("div", { className: "stk-panel-sec" },
            h("h4", { className: "stk-panel-head" }, "Markers"),
            h("button", {
              type: "button",
              className: "stk-panel-row",
              onClick: () => { if (onAddMarker) onAddMarker(); },
            },
              h("span", { className: "stk-panel-ic" }, h(Icon, { name: "chapter", size: 15 })),
              h("span", { className: "stk-panel-label" }, "Add marker here"),
              h("span", { className: "stk-panel-value" }, "M")
            )
          ),

          h("div", { className: "stk-panel-sec" },
            h("h4", { className: "stk-panel-head" }, "Stash Management"),
            panelRow("flag", "Flag for Deletion",
              h(PrefToggle, {
                label: "Flag for Deletion",
                on: flagOn,
                onChange: (value) => { setFlagOn(value); if (onFlagToggle) onFlagToggle(value); },
              })
            ),
            panelRow("dupe", "Flag as Duplicate",
              h(PrefToggle, {
                label: "Flag as Duplicate",
                on: dupeOn,
                onChange: (value) => { setDupeOn(value); if (onDupeToggle) onDupeToggle(value); },
              })
            )
          )
        )
      );
    }

    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-sheet", ref: dialogRef, onClick: (event) => event.stopPropagation() },
        head,
        h("h4", null, "File"),
        h(
          "dl",
          { className: "stk-kv" },
          h("dt", null, "Path"),
          h("dd", null, file.path || "—"),
          h("dt", null, "Size"),
          h("dd", null, fmtBytes(file.size)),
          h("dt", null, "Duration"),
          h("dd", null, fmtTime(file.duration)),
          h("dt", null, "Resolution"),
          h("dd", null, file.width ? `${file.width}x${file.height}${file.frame_rate ? ` @ ${Math.round(file.frame_rate)}fps` : ""}` : "—"),
          h("dt", null, "Codec"),
          h("dd", null, [file.video_codec, file.audio_codec].filter(Boolean).join(" / ") || "—"),
          h("dt", null, "Bitrate"),
          h("dd", null, file.bit_rate ? `${Math.round(file.bit_rate / 1000)} kbps` : "—"),
          h("dt", null, "Plays"),
          h("dd", null, String(scene.play_count || 0)),
          h("dt", null, "O counter"),
          h("dd", null, String(scene.o_counter || 0)),
          h("dt", null, "Rating"),
          h("dd", null, rating == null ? "unrated" : String(rating))
        ),

        markers.length > 0 &&
          h(React.Fragment, null,
            h("h4", null, `Markers (${markers.length})`),
            markers.map((marker) =>
              h("button",
                { key: marker.id, className: "stk-marker-row", onClick: () => onJump(Number(marker.seconds)) },
                h("b", null, fmtTime(marker.seconds)),
                h("div", null, marker.primary_tag ? marker.primary_tag.name : "Marker", h("br"), h("span", null, marker.title || "")),
                h(Icon, { name: "play", size: 14 })
              )
            )
          ),

        tags.length > 0 &&
          h(React.Fragment, null,
            h("h4", null, "Tags"),
            h("div", null,
              tags.map((tag) =>
                h("button", { key: tag.id, className: "stk-tagpill", onClick: () => onOpenTag(tag) },
                  h(Icon, { name: "tag", size: 13 }), tag.name)
              )
            )
          )
      )
    );
  }

  /* Scenes tagged as duplicates stay off the performer pages. The library uses
     Stash's own _DuplicateMarkForDeletion family, whose ids differ per install, so
     the names are resolved once at runtime instead of being hard-coded. */
  let DUPE_TAG_IDS = null;
  async function duplicateTagIds() {
    if (DUPE_TAG_IDS) return DUPE_TAG_IDS;
    try {
      const data = await gql(
        `query StashTokDupeTags { findTags(filter: { per_page: 200, q: "duplicate" }) { tags { id name } } }`
      );
      DUPE_TAG_IDS = ((data.findTags && data.findTags.tags) || [])
        .filter((tag) => {
          const name = String(tag.name || "").replace(/^_+/, "");
          if (/whitelist|exclude/i.test(name)) return false;
          return /^duplicate/i.test(name) || /^dupe$/i.test(name);
        })
        .map((tag) => String(tag.id));
    } catch (err) {
      DUPE_TAG_IDS = [];
    }
    return DUPE_TAG_IDS;
  }

  /* ------------------------------------------------------------------ */
  /* library pages                                                      */
  /* ------------------------------------------------------------------ */

  const SCENE_SORTS = [
    ["filesize", "File size"],
    ["updated_at", "Recently added"],
    ["duration", "Duration"],
    ["resolution", "Resolution"],
    ["title", "A–Z"],
    ["random", "Random"],
  ];

  /* Label pairs, so a row says which way round it is: tapping the active row
     flips (Largest First) to (Smallest First) instead of showing a bare arrow. */
  /* short labels: the direction is the arrow on the active row, not a sentence */
  const SCENE_SORT_OPTIONS = [
    { key: "filesize", label: "File size" },
    { key: "updated_at", label: "Added date" },
    { key: "duration", label: "Duration" },
    { key: "resolution", label: "Resolution" },
    { key: "random", label: "Random" },
  ];

  const IMAGE_SORT_OPTIONS = [
    { key: "filesize", label: "File size" },
    { key: "updated_at", label: "Added date" },
    { key: "resolution", label: "Resolution" },
    { key: "random", label: "Random" },
  ];

  /* ------------------------------------------------------------------ */
  /* photo actions                                                       */
  /* ------------------------------------------------------------------ */

  /* Long-press a photo tile (500 ms). Returns props for the tile button; a fired hold
     swallows the click, so the viewer does not pop open underneath the action sheet. */
  function usePhotoHold(onHold) {
    const hold = useRef({ timer: 0, fired: false });
    const holdRef = useRef(onHold);
    holdRef.current = onHold;
    useEffect(() => () => window.clearTimeout(hold.current.timer), []);
    return useCallback(function tileProps(image, onTap) {
      return {
        onPointerDown: () => {
          hold.current.fired = false;
          window.clearTimeout(hold.current.timer);
          hold.current.timer = window.setTimeout(() => {
            hold.current.fired = true;
            buzz(18);
            holdRef.current(image);
          }, 500);
        },
        onPointerUp: () => window.clearTimeout(hold.current.timer),
        onPointerLeave: () => window.clearTimeout(hold.current.timer),
        onPointerCancel: () => window.clearTimeout(hold.current.timer),
        /* a long press on a phone raises the callout menu as well */
        onContextMenu: (event) => event.preventDefault(),
        onClick: (event) => {
          window.clearTimeout(hold.current.timer);
          if (hold.current.fired) {
            hold.current.fired = false;
            return;
          }
          onTap(event);
        },
      };
    }, []);
  }

  /* Long-press a photo tile: favourite it, or set its performer. Both steps live in
     one bottom sheet, because a second sheet stacked on the first is unclosable on a
     phone and the picker needs the photo's current performers right there. */
  function ImageActions({ image, performer, onClose, onChanged }) {
    const dialogRef = useDialog(true, onClose);
    const searchRef = useRef(null);
    const [step, setStep] = useState("actions");
    const [confirmKind, setConfirmKind] = useState("photo");
    const [rating, setRating] = useState(image ? image.rating100 : null);
    const [performers, setPerformers] = useState([]);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const hearted = rating != null && Number(rating) >= 60;

    /* the tile only carries a thumbnail: read the authoritative rating and the
       performers already set, so the sheet never shows a stale state */
    useEffect(() => {
      if (!image) return undefined;
      let alive = true;
      gql(
        `query StashTokImageActions($id: ID!) {
           findImage(id: $id) { id rating100 performers { id name image_path } }
         }`,
        { id: image.id }
      )
        .then((data) => {
          const fresh = data && data.findImage;
          if (!alive || !fresh) return;
          setRating(fresh.rating100);
          setPerformers(fresh.performers || []);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [image && image.id]);

    useEffect(() => {
      if ((step === "performer" || step === "photo") && searchRef.current) searchRef.current.focus();
    }, [step]);

    useEffect(() => {
      if (step !== "performer" && step !== "photo") return undefined;
      let alive = true;
      const q = query.trim();
      const timer = window.setTimeout(
        () => {
          gql(
            `query StashTokFindPerformer($q: String) {
               findPerformers(filter: { q: $q, per_page: 30, sort: "scenes_count", direction: DESC }) {
                 performers { id name image_path scene_count }
               }
             }`,
            { q: q || null }
          )
            .then((data) => alive && setResults((data.findPerformers && data.findPerformers.performers) || []))
            .catch(() => alive && setResults([]));
        },
        q ? 180 : 0
      );
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }, [step, query]);

    async function toggleHeart() {
      if (!image || busy) return;
      const next = hearted ? null : 100;
      const previous = rating;
      setRating(next);
      setBusy(true);
      setError("");
      try {
        await setImageRating(image.id, next);
        if (onChanged) onChanged(image.id, { rating100: next });
        buzz(12);
        onClose();
      } catch (err) {
        setRating(previous);
        setError("Stash refused the change.");
        setBusy(false);
      }
    }

    async function assign(performer) {
      if (!image || busy) return;
      const ids = performers.map((row) => row.id);
      if (ids.indexOf(performer.id) >= 0) {
        setStep("actions");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const data = await gql(
          `mutation StashTokImagePerformer($id: ID!, $ids: [ID!]!) {
             imageUpdate(input: { id: $id, performer_ids: $ids }) { id performers { id name } }
           }`,
          { id: image.id, ids: ids.concat(performer.id) }
        );
        const fresh = (data.imageUpdate && data.imageUpdate.performers) || [];
        setPerformers(fresh);
        if (onChanged) onChanged(image.id, { performers: fresh });
        buzz(12);
        setStep("actions");
      } catch (err) {
        setError("Could not set the performer.");
      }
      setBusy(false);
    }

    /* "Use as profile photo" is a different write from "set performer": Stash stores
       a performer's picture as image bytes on the performer record, so the picture
       has to be read back and posted as a data URL. Linking the image to the
       performer (assign, above) does not touch performer.image at all -- which is
       why it used to look like nothing happened to the profile. */
    async function assignPhoto(performer) {
      if (!image || busy) return;
      setBusy(true);
      setError("");
      try {
        const src = rel((image.paths && (image.paths.image || image.paths.thumbnail)) || "");
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) throw new Error("could not read the image");
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("could not encode the image"));
          reader.readAsDataURL(blob);
        });
        if (!dataUrl) throw new Error("empty image");
        const data = await gql(
          `mutation StashTokPerformerPhoto($id: ID!, $image: String!) {
             performerUpdate(input: { id: $id, image: $image }) { id name image_path }
           }`,
          { id: performer.id, image: dataUrl }
        );
        const fresh = (data && data.performerUpdate) || {};
        if (onChanged) onChanged(image.id, { performerPhoto: { id: performer.id, name: performer.name, image_path: fresh.image_path } });
        buzz(12);
        onClose();
      } catch (err) {
        setError("Could not set the profile photo: " + (err.message || "Stash refused it"));
      }
      setBusy(false);
    }

    if (!image) return null;
    /* Stash serves images as /image/<id>/image?t=…, so the URL is not a filename */
    const rawPath = String((image.paths && image.paths.image) || "").split("?")[0];
    const base = rawPath.split("/").filter(Boolean).pop() || "";
    const label = image.title || (base && base !== "image" ? base : "Image " + image.id);

    return h(
      Portal,
      null,
      h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
      h(
        "div",
        {
          className:
            "stk-sheet stk-photo-actions" + (step === "performer" || step === "photo" ? " stk-photo-pick" : ""),
          ref: dialogRef,
          onClick: (event) => event.stopPropagation(),
        },
        h(
          "h3",
          null,
          h("span", null, label),
          h("button", { className: "stk-btn", onClick: onClose, "aria-label": "Close" }, h(Icon, { name: "x", size: 16 }))
        ),
        performers.length > 0 &&
          h(
            "div",
            { className: "stk-photo-perfs" },
            performers.map((row) => h("span", { key: row.id, className: "stk-photo-perf" }, row.name))
          ),

        step === "actions"
          ? h(
              React.Fragment,
              null,
              h(
                "button",
                {
                  className: "stk-actionrow" + (hearted ? " stk-actionrow-on" : ""),
                  disabled: busy,
                  onClick: toggleHeart,
                },
                h(Icon, { name: "heart", size: 20, filled: hearted }),
                h("span", null, hearted ? "Unfavourite" : "Favourite"),
                h("small", null, hearted ? "hearted in Stash" : "rate 100")
              ),
              h(
                "button",
                {
                  className: "stk-actionrow",
                  onClick: () => {
                    setError("");
                    if (performer) {
                      setConfirmKind("assign");
                      setStep("confirm");
                    } else {
                      setStep("performer");
                    }
                  },
                },
                h(Icon, { name: "user", size: 20 }),
                h("span", null, "Set performer"),
                h("small", null, performers.length ? performers.map((row) => row.name).join(", ") : "none set")
              ),
              h(
                "button",
                {
                  className: "stk-actionrow",
                  disabled: busy,
                  onClick: () => {
                    setError("");
                    /* already on a performer's page: the performer is known, so
                       confirm instead of asking which performer this is */
                    setStep(performer ? "confirm" : "photo");
                  },
                },
                h(Icon, { name: "image", size: 20 }),
                h("span", null, "Use as profile photo"),
                h("small", null, performer ? "sets " + performer.name + "'s picture" : "sets the performer's picture in Stash")
              )
            )
          : step === "confirm"
          ? h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "stk-photo-stephead" },
                h(
                  "button",
                  { className: "stk-btn", onClick: () => setStep("actions") },
                  h(Icon, { name: "back", size: 16 }),
                  "Back"
                ),
                h("h4", null, confirmKind === "assign" ? "Set performer" : "Use as profile photo")
              ),
              h(
                "p",
                { className: "stk-sub", style: { margin: "4px 0 14px" } },
                confirmKind === "assign"
                  ? "Link this image to " + (performer && performer.name ? performer.name : "the performer") + "?"
                  : "Set this image as " + (performer && performer.name ? performer.name : "the performer") + "\u2019s profile photo?"
              ),
              h(
                "div",
                { className: "stk-xactions", style: { display: "flex", gap: 10 } },
                h(
                  "button",
                  {
                    className: "stk-xbtn stk-xbtn-primary",
                    disabled: busy,
                    onClick: () => (confirmKind === "assign" ? assign(performer) : assignPhoto(performer)),
                  },
                  busy ? "Setting\u2026" : "OK"
                ),
                h(
                  "button",
                  { className: "stk-xbtn", disabled: busy, onClick: () => setStep("actions") },
                  "Cancel"
                )
              )
            )
          : h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "stk-photo-pickhead" },
                h("span", { className: "stk-photo-grip", "aria-hidden": "true" }),
                h("h4", null, step === "photo" ? "Use as profile photo" : "Set performer"),
                h(
                  "button",
                  { className: "stk-btn stk-photo-pickx", onClick: () => setStep("actions"), title: "Back" },
                  h(Icon, { name: "x", size: 15 })
                )
              ),
              h("input", {
                className: "stk-actionsearch",
                type: "search",
                ref: searchRef,
                value: query,
                placeholder: "Search performers…",
                onChange: (event) => setQuery(event.currentTarget.value),
              }),
              h(
                "div",
                { className: "stk-actionlist" },
                results == null
                  ? h("p", { className: "stk-sub" }, "Loading…")
                  : results.length === 0
                  ? h("p", { className: "stk-sub" }, "No performer matches that name.")
                  : results.map((row) => {
                      const already = performers.some((cur) => String(cur.id) === String(row.id));
                      return h(
                        "button",
                        {
                          key: row.id,
                          className: "stk-marker-row",
                          disabled: busy,
                          onClick: () => (step === "photo" ? assignPhoto(row) : assign(row)),
                        },
                        row.image_path && h("img", { className: "stk-actionavatar", src: rel(row.image_path), alt: "" }),
                        h("span", null, row.name),
                        h("small", null, already ? "already set" : fmtCount(row.scene_count) + " scenes")
                      );
                    })
              )
            ),

        error && h("p", { className: "stk-actionerror" }, error)
      )
    );
  }

  /* A single image opened full-screen, stepped vertically like the feed: swipe up or
     down (or arrows) to move through the grid, double tap to zoom into the point you
     tapped (1x <-> 2x), the top-right chip to go to 4x when the file has the pixels,
     heart to favourite, pinch to zoom anywhere in between. */
  function ImageViewer({ image, rect, items, index, onClose }) {
    const list = (items && items.length ? items : [image]).filter(Boolean);
    const [pos, setPos] = useState(() => clamp(Number(index) || 0, 0, Math.max(0, list.length - 1)));
    const [zoom, setZoom] = useState(1);
    const [dragY, setDragY] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [maxZoom, setMaxZoom] = useState(2);
    const [natural, setNatural] = useState(null);
    const [hero, setHero] = useState(rect || null);
    const [ratings, setRatings] = useState({});
    const stageRef = useRef(null);
    const imgRef = useRef(null);
    const view = useRef({ s: 1, x: 0, y: 0 });
    const gesture = useRef(null);
    const pts = useRef(new Map());
    const lastTap = useRef(0);

    const item = list[pos] || image;
    const src = item && item.paths ? rel(item.paths.image || item.paths.thumbnail) : "";
    const rated = item && ratings[item.id] !== undefined ? ratings[item.id] : item && item.rating100;
    const hearted = rated != null && Number(rated) >= 60;
    const canQuad = maxZoom >= 3.9;

    const step = useCallback(
      (dir) => {
        setPos((cur) => {
          const next = cur + dir;
          return next < 0 || next >= list.length ? cur : next;
        });
      },
      [list.length]
    );

    const toggleHeart = useCallback(() => {
      if (!item) return;
      const next = hearted ? null : 100;
      setRatings((cur) => Object.assign({}, cur, { [item.id]: next }));
      setImageRating(item.id, next).catch(() => {
        setRatings((cur) => Object.assign({}, cur, { [item.id]: rated }));
      });
    }, [item && item.id, hearted, rated]);

    useEffect(() => {
      // grow out of the thumbnail instead of popping in
      const t = window.setTimeout(() => setHero(null), 40);
      const onKey = (event) => {
        if (!event.key) return;
        if (event.key === "Escape") onClose();
        else if (event.key === "ArrowDown" || event.key === "ArrowRight") step(1);
        else if (event.key === "ArrowUp" || event.key === "ArrowLeft") step(-1);
      };
      window.addEventListener("keydown", onKey);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener("keydown", onKey);
      };
    }, [step, onClose]);

    /* desktop wheel steps through the pictures, same notch-per-item rule as the
       feed: a trackpad's inertia tail must not skip three images at once */
    useEffect(() => {
      const el = stageRef.current;
      if (!el) return undefined;
      let acc = 0;
      let at = 0;
      let cool = 0;
      const onWheel = (event) => {
        if (event.ctrlKey || !event.deltaY) return;
        event.preventDefault();
        const now = performance.now();
        const notch = event.deltaMode !== 0 || Math.abs(event.deltaY) >= 90;
        if (now < cool) {
          acc = 0;
          return;
        }
        if (notch || now - at > 260) acc = 0;
        at = now;
        acc += event.deltaY;
        if (Math.abs(acc) < (notch ? 1 : 40)) return;
        const direction = acc > 0 ? 1 : -1;
        acc = 0;
        cool = now + 260;
        step(direction);
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [step]);

    // a new picture starts at 1x, un-panned
    useEffect(() => {
      setNatural(null);
      setZoom(1);
      view.current = { s: 1, x: 0, y: 0 };
    }, [pos]);

    const clampPan = useCallback(() => {
      const el = stageRef.current;
      if (!el) return;
      const { s } = view.current;
      const maxX = Math.max(0, (el.clientWidth * s - el.clientWidth) / 2);
      const maxY = Math.max(0, (el.clientHeight * s - el.clientHeight) / 2);
      view.current.x = clamp(view.current.x, -maxX, maxX);
      view.current.y = clamp(view.current.y, -maxY, maxY);
    }, []);

    const paint = useCallback((animated) => {
      const img = imgRef.current;
      if (!img) return;
      img.style.transition = animated ? "transform 240ms cubic-bezier(.2,.7,.2,1)" : "none";
      const { s, x, y } = view.current;
      img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
      /* only a zoomed photo needs its own layer; at 1x the layer costs an iPad the
         texture it needs to draw a large image at all */
      img.style.willChange = s > 1.01 ? "transform" : "auto";
    }, []);

    /* How far we can go before the picture is upscaled past one image pixel per
       device pixel ("100%" / retina). Phones are 2-3x DPR, so a 4000 px photo on a
       412 px stage tops out around 3x and there is no honest 4x. */
    useEffect(() => {
      const el = stageRef.current;
      if (!el || !natural) return;
      const contain = Math.min(el.clientWidth / natural.w, el.clientHeight / natural.h);
      const dpr = window.devicePixelRatio || 1;
      const cap = contain > 0 ? 1 / (contain * dpr) : 4;
      setMaxZoom(clamp(cap, 2, 8));
    }, [natural, pos, hero]);

    // zoom about a point in stage coordinates (0,0 = centre), so a double tap
    // magnifies what is under the finger
    const zoomTo = useCallback((next, cx, cy) => {
      const z0 = view.current.s;
      const z1 = clamp(next, 1, Math.max(2, maxZoom));
      if (Math.abs(z1 - z0) < 0.01) return;
      const k = z1 / z0;
      const ax = cx == null ? 0 : cx;
      const ay = cy == null ? 0 : cy;
      view.current.x = ax - (ax - view.current.x) * k;
      view.current.y = ay - (ay - view.current.y) * k;
      view.current.s = z1;
      if (z1 <= 1.01) {
        view.current.x = 0;
        view.current.y = 0;
      }
      clampPan();
      paint(true);
      setZoom(z1);
    }, [maxZoom, clampPan, paint]);

    function stagePoint(event) {
      const el = stageRef.current;
      if (!el) return { cx: 0, cy: 0 };
      const r = el.getBoundingClientRect();
      return { cx: event.clientX - r.left - r.width / 2, cy: event.clientY - r.top - r.height / 2 };
    }

    function onDown(event) {
      pts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pts.current.size >= 2) {
        const [a, b] = Array.from(pts.current.values());
        gesture.current = {
          mode: "pinch",
          d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          s0: view.current.s,
          x0: view.current.x,
          y0: view.current.y,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
        return;
      }
      const now = performance.now();
      const isDouble = now - lastTap.current < 280;
      lastTap.current = isDouble ? 0 : now;
      if (isDouble) {
        gesture.current = { mode: "tap" };
        const { cx, cy } = stagePoint(event);
        zoomTo(view.current.s > 1.01 ? 1 : 2, cx, cy);
        return;
      }
      setDragging(true);
      gesture.current = { mode: "drag", x0: event.clientX, y0: event.clientY, px: view.current.x, py: view.current.y };
    }

    function onMove(event) {
      const point = pts.current.get(event.pointerId);
      if (point) {
        point.x = event.clientX;
        point.y = event.clientY;
      }
      const g = gesture.current;
      if (!g) return;
      if (g.mode === "pinch" && pts.current.size >= 2) {
        const [a, b] = Array.from(pts.current.values());
        const rect0 = stageRef.current;
        if (!rect0) return;
        const bx = rect0.getBoundingClientRect();
        const ratio = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) / g.d0;
        /* pinch is free: past the crisp 2x/4x stops the user may go to 10x */
        const z1 = clamp(g.s0 * ratio, 1, 10);
        const k = z1 / g.s0;
        const startX = g.cx - bx.left - bx.width / 2;
        const startY = g.cy - bx.top - bx.height / 2;
        const nowX = (a.x + b.x) / 2 - bx.left - bx.width / 2;
        const nowY = (a.y + b.y) / 2 - bx.top - bx.height / 2;
        view.current.s = z1;
        view.current.x = nowX - (startX - g.x0) * k;
        view.current.y = nowY - (startY - g.y0) * k;
        clampPan();
        paint(false);
        setZoom(z1);
        return;
      }
      if (g.mode !== "drag") return;
      // at 1x a vertical drag slides the strip of pictures, not the pan
      if (view.current.s <= 1.01) {
        const dy = event.clientY - g.y0;
        const dx = event.clientX - g.x0;
        if (Math.abs(dy) > Math.abs(dx)) {
          const canMove = (dy < 0 && pos < list.length - 1) || (dy > 0 && pos > 0);
          setDragY(canMove ? dy : dy * 0.32);
          return;
        }
      }
      view.current.x = g.px + (event.clientX - g.x0);
      view.current.y = g.py + (event.clientY - g.y0);
      clampPan();
      paint(false);
    }

    function onUp(event) {
      const g = gesture.current;
      if (g && g.mode === "drag" && pts.current.size === 1 && view.current.s <= 1.01) {
        const dy = event.clientY - g.y0;
        const dx = event.clientX - g.x0;
        if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) step(dy < 0 ? 1 : -1);
      }
      setDragging(false);
      setDragY(0);
      pts.current.delete(event.pointerId);
      if (pts.current.size === 0) gesture.current = null;
      if (pts.current.size === 1) {
        const only = Array.from(pts.current.values())[0];
        gesture.current = { mode: "drag", x0: only.x, y0: only.y, px: view.current.x, py: view.current.y };
      }
    }

    const stopPointer = (event) => event.stopPropagation();

    const frame = hero
      ? { left: hero.left + "px", top: hero.top + "px", width: hero.width + "px", height: hero.height + "px", borderRadius: "14px" }
      : { left: "0px", top: "0px", width: window.innerWidth + "px", height: window.innerHeight + "px", borderRadius: "0px" };

    return h(
      "div",
      {
        className: "stk-img-overlay" + (dragging ? " stk-dragging" : ""),
        onPointerDown: onDown,
        onPointerMove: onMove,
        onPointerUp: onUp,
        onPointerCancel: onUp,
      },
      h(
        "div",
        { className: "stk-img-frame" + (hero ? " stk-img-hero" : ""), style: frame },
        h(
          "div",
          { className: "stk-img-stage", ref: stageRef },
          [pos - 1, pos, pos + 1]
            .filter((i) => list[i])
            .map((i) => {
              const paths = list[i].paths || {};
              const thumb = rel(paths.thumbnail || paths.image || "");
              return h(
                "div",
                {
                  key: list[i].id || i,
                  className: "stk-img-slide",
                  /* The thumbnail sits underneath as a painted background, always.
                     iPad Safari refuses to draw a very large photo inside a
                     transformed layer (a 3744x5616 JPEG is 21 MP: past what it will
                     texture), and the slide used to come up pure black. With the
                     thumbnail behind it, the picture is on screen either way and the
                     full file simply fades in over it when it actually decodes. */
                  style: {
                    transform: "translate3d(0, calc(" + (i - pos) * 100 + "% + " + dragY + "px), 0)",
                    backgroundImage: thumb ? `url("${thumb}")` : undefined,
                  },
                },
                h("img", {
                  ref: i === pos ? imgRef : null,
                  className: "stk-img",
                  src: paths.image ? rel(paths.image) : thumb,
                  draggable: false,
                  onLoad:
                    i === pos
                      ? (event) => {
                          event.currentTarget.classList.add("stk-img-ready");
                          setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight });
                        }
                      : (event) => event.currentTarget.classList.add("stk-img-ready"),
                  onError: (event) => {
                    /* never leave a hole: the thumbnail background stays visible */
                    event.currentTarget.style.display = "none";
                  },
                })
              );
            })
        )
      ),
      h("button", { className: "stk-img-close", onPointerDown: stopPointer, onClick: onClose, "aria-label": "Close" }, h(Icon, { name: "chevron", size: 22 })),
      h(
        "button",
        {
          className: "stk-img-heart" + (hearted ? " stk-on" : ""),
          onPointerDown: stopPointer,
          onClick: toggleHeart,
          "aria-label": hearted ? "Remove favourite" : "Favourite",
        },
        h(Icon, { name: "heart", size: 22, filled: hearted })
      ),
      zoom > 1.01 &&
        canQuad &&
        h(
          "button",
          {
            className: "stk-img-zoombtn",
            onPointerDown: stopPointer,
            onClick: () => zoomTo(zoom > 2.01 ? 2 : 4, null, null),
            "aria-label": zoom > 2.01 ? "Zoom to 2x" : "Zoom to 4x",
          },
          zoom > 2.01 ? "2×" : "4×"
        ),
      list.length > 1 && h("div", { className: "stk-img-count" }, pos + 1 + " / " + list.length)
    );
  }


  /* ---- scrubber sprite index (shared: timeline hover + contact sheets) ---- */
  const SPRITE_STAMP = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
  function spriteSeconds(line) {
    const m = SPRITE_STAMP.exec(line);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0;
  }

  function fetchSpriteCues(scene) {
    const vttPath = rel(scene && scene.paths && scene.paths.vtt);
    const spritePath = rel(scene && scene.paths && scene.paths.sprite);
    if (!vttPath || !spritePath) return Promise.resolve(null);
    return fetch(vttPath, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!text) return null;
        const cues = [];
        text.split(/\n\n/).forEach((block) => {
          const box = /#xywh=(\d+),(\d+),(\d+),(\d+)/.exec(block);
          const range = /^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/m.exec(block);
          if (!box || !range) return;
          cues.push({
            start: spriteSeconds(range[1]),
            end: spriteSeconds(range[2]),
            x: Number(box[1]),
            y: Number(box[2]),
            w: Number(box[3]),
            h: Number(box[4]),
          });
        });
        if (!cues.length) return null;
        let sheetW = 0;
        let sheetH = 0;
        cues.forEach((cue) => {
          sheetW = Math.max(sheetW, cue.x + cue.w);
          sheetH = Math.max(sheetH, cue.y + cue.h);
        });
        return { cues, src: spritePath, sheetW, sheetH };
      })
      .catch(() => null);
  }

  /* A 3x4 contact sheet built from the sprite Stash already rendered: twelve frames
     at even marks, no new assets and no ffmpeg calls. */
  function ContactSheet({ scene, duration, onClose, onPick }) {
    const [tiles, setTiles] = useState(null);
    /* re-fit when the viewport changes: rotating the phone or resizing the window
       must re-run the width/height fit, not leave the old tile size behind */
    const [, setFitTick] = useState(0);
    useEffect(() => {
      const onResize = () => setFitTick((n) => n + 1);
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      };
    }, []);
    const COLS = 3;
    const ROWS = 4;

    useEffect(() => {
      let alive = true;
      if (!scene) return undefined;
      const total = Number(duration) || Number((scene.files && scene.files[0] && scene.files[0].duration) || 0);
      fetchSpriteCues(scene).then((sheet) => {
        if (!alive) return;
        const count = COLS * ROWS;
        const out = [];
        for (let i = 0; i < count; i += 1) {
          const at = total ? ((i + 0.5) / count) * total : 0;
          if (sheet) {
            const cue = sheet.cues.find((c) => at >= c.start && at < c.end) || sheet.cues[Math.min(sheet.cues.length - 1, Math.floor((i / count) * sheet.cues.length))];
            out.push({ at, cue, sheet });
          } else {
            out.push({ at, cue: null, sheet: null });
          }
        }
        setTiles(out);
      });
      return () => {
        alive = false;
      };
    }, [scene && scene.id, duration]);

    /* the sheet fills the viewport: grow until width or height binds, whichever
       comes first. No fixed pixel cap -- a 3x4 grid is always 3 wide and 4 tall,
       so the tile is the smaller of the two fits. */
    const vw = (typeof window !== "undefined" ? window.innerWidth : 380) || 380;
    const vh = (typeof window !== "undefined" ? window.innerHeight : 700) || 700;
    const GAP = 6;
    const PAD_X = 16;            /* .stk-sheet padding: 14px 16px */
    const PAD_Y = 14;
    const HEAD = 46;             /* title row + its margin */
    const boxW = vw * 0.8 - PAD_X * 2;
    const boxH = vh * 0.8 - HEAD - PAD_Y * 2;
    const byWidth = Math.floor((boxW - GAP * (COLS - 1)) / COLS);
    const byHeight = Math.floor((boxH - GAP * (ROWS - 1)) / ROWS / 0.5625);
    const TILE = Math.max(64, Math.min(byWidth, byHeight));
    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-sheet stk-contact-sheet", onClick: (event) => event.stopPropagation() },
        h(
          "h3",
          null,
          h("span", null, "Contact sheet"),
          h("button", { className: "stk-btn", onClick: onClose }, h(Icon, { name: "x", size: 16 }))
        ),
        !tiles
          ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
          : h(
              "div",
              { className: "stk-contact-grid", style: { gridTemplateColumns: `repeat(${COLS}, ${TILE}px)` } },
              tiles.map((tile, index) => {
                const scale = tile.cue ? TILE / tile.cue.w : 1;
                return h(
                  "button",
                  {
                    key: index,
                    className: "stk-contact-cell",
                    title: "Jump to " + fmtTime(tile.at),
                    onClick: () => {
                      if (onPick) onPick(tile.at);
                      else onClose();
                    },
                    style: { width: TILE + "px", height: Math.round(TILE * 0.5625) + "px" },
                  },
                  tile.cue
                    ? h("div", {
                        className: "stk-contact-img",
                        style: {
                          width: TILE + "px",
                          height: Math.round(tile.cue.h * scale) + "px",
                          backgroundImage: `url("${tile.sheet.src}")`,
                          backgroundSize: `${Math.round(tile.sheet.sheetW * scale)}px ${Math.round(tile.sheet.sheetH * scale)}px`,
                          backgroundPosition: `-${Math.round(tile.cue.x * scale)}px -${Math.round(tile.cue.y * scale)}px`,
                        },
                      })
                    : h("img", {
                        className: "stk-contact-img",
                        alt: "",
                        src: `/scene/${tile.sheet ? scene.id : scene.id}/screenshot?t=${Math.round(tile.at)}`,
                      }),
                  h("span", { className: "stk-contact-at" }, fmtTime(tile.at))
                );
              })
            )
      )
    );
  }

  /* which clip the user just opened: coming back should land the keyboard cursor on it */
  let lastOpenedSceneId = "";
  /* The clip a grid just opened, with the exact list behind it. Opening a clip goes
     through the router (goTo -> applyRoute -> resolvePerformerSlug -> openPerformer),
     which only knows the performer name and the scene id -- so without this the feed
     rebuilt itself from a fresh query and a swipe left the grid's order entirely. */
  let gridPlay = null;

  /* ---- dense profile grid (the ▦/▥ button) ---------------------------- *
   * The dense grid is a masonry of flex columns built here rather than CSS
   * multicol: `column-count` measured fine in Chrome but on iPad Safari the
   * columns after the first two never painted, and its vertical gutter lived on
   * `margin-bottom` while the column gutter came from `gap`, so the two could
   * never match. Every tile is placed in the currently shortest column using the
   * clip's own aspect ratio, and one gap value governs both axes. */
  const DENSE_GAP = 8;
  /* how much of a portrait clip's height we can give back to the grid */
  const PORTRAIT_CROP = 0.1;

  function denseColumns() {
    const w = (typeof window !== "undefined" && window.innerWidth) || 1024;
    /* wide screens get more of the smaller tiles per row -- the toggle used to be
       a fixed 5, which painted 300 px tiles on a desktop */
    if (w >= 1500) return 8;
    if (w >= 1200) return 7;
    if (w >= 900) return 6;
    /* an iPad is 5 across in both orientations — that is the view this button is
       for. Only a phone shrinks it, where 5 columns would be thumbnails. */
    if (w >= 560) return 5;
    if (w >= 420) return 4;
    return 3;
  }

  /* width/height of the box a tile draws. Portrait clips lose 10% of their height
     (5% off the top and bottom, since the art fills the box); landscape clips keep
     their true ratio because their cover art is the point. */
  function tileRatio(file) {
    const w = Number(file && file.width) || 0;
    const h = Number(file && file.height) || 0;
    if (!w || !h) return 9 / 16;
    return h > w ? w / (h * (1 - PORTRAIT_CROP)) : w / h;
  }

  function denseLayout(tiles, ratioAt, cols) {
    const buckets = [];
    const heights = [];
    for (let i = 0; i < cols; i += 1) {
      buckets.push([]);
      heights.push(0);
    }
    tiles.forEach((tile, index) => {
      let target = 0;
      for (let i = 1; i < cols; i += 1) if (heights[i] < heights[target] - 0.01) target = i;
      buckets[target].push(tile);
      const ratio = ratioAt(index) || 9 / 16;
      // heights in units of one column width, so an even column width is all it needs
      heights[target] += 1000 / ratio + DENSE_GAP;
    });
    return h(
      "div",
      { className: "stk-grid-5" },
      buckets.map((bucket, index) => h("div", { key: index, className: "stk-col" }, bucket))
    );
  }

  function PerformerProfile({ performerId, folder, onBack, onPlay, onOpenTag, prefs, favoritesOnly }) {
    /* one view for both: a performer record, or a bare folder standing in for one */
    const isFolder = !!folder;
    const profileKey = isFolder ? "folder:" + folder : performerId;
    const [performer, setPerformer] = useState(null);
    const [scenes, setScenes] = useState([]);

    /* ---- highlight reel ------------------------------------------- *
     * The reel service lives beside Stash (tools/reel-service) and serves its
     * own player page. It has to be a separate top-level tab: Stash's CSP allows
     * connect-src 'self' only, so the plugin may not fetch the service or play
     * its streams in-page. An anchor is a navigation, which CSP does not gate. */
    const reelBase = () => {
      const asked = new URLSearchParams(window.location.search).get("reel");
      return (asked || "http://" + window.location.hostname + ":19000").replace(/\/$/, "");
    };
    /* a plain anchor: popup blockers drop window.open, CSP leaves navigations alone.
       A function, not a const: `performer` is state that arrives after this line. */
    function reelHref() {
      const port = encodeURIComponent(String(window.location.port || ""));
      if (isFolder) {
        /* a folder profile is a path, not a performer id: the reel must walk
           every clip in that folder and its subfolders, not one performer's */
        return reelBase() + "/player?folder=" + encodeURIComponent(folder) +
          "&port=" + port + "&name=" + encodeURIComponent(folder.replace(/\/+$/, "").split("/").pop() || folder);
      }
      if (!performer) return "";
      return reelBase() + "/player?performerId=" + encodeURIComponent(String(performerId)) +
        "&port=" + port + "&name=" + encodeURIComponent(performer.name || "");
    }
    const [markers, setMarkers] = useState([]);
    const [images, setImages] = useState([]);
    const [imageTotal, setImageTotal] = useState(null);
    const [imgPage, setImgPage] = useState(1);
    const [imgBusy, setImgBusy] = useState(false);
    const imagesRef = useRef([]);
    const imageTotalRef = useRef(null);
    const imgBusyRef = useRef(false);
    const [markerCount, setMarkerCount] = useState(null);
    const [tab, setTab] = useState("scenes");
    const [media, setMedia] = useState("videos");
    const [viewer, setViewer] = useState(null);
    const [photoAction, setPhotoAction] = useState(null);
    const photoTileProps = usePhotoHold(setPhotoAction);
    const [menuOpen, setMenuOpen] = useState(false);
    const profileMenuRef = useDialog(menuOpen, () => setMenuOpen(false));
    const [dupes, setDupes] = useState(null);
    /* body & ethnicity attributes: a reviewed, manual sync across every scene
       of this performer. Nothing here runs on its own — a scene tag never
       propagates without the confirmation on this panel. */
    const [attrOpen, setAttrOpen] = useState(false);
    const [attrScenes, setAttrScenes] = useState(null);
    const [attrPick, setAttrPick] = useState({});
    const [attrBusy, setAttrBusy] = useState(false);
    const [attrError, setAttrError] = useState("");
    const [attrUndo, setAttrUndo] = useState(null);
    const [attrDone, setAttrDone] = useState("");
    /* images carry the same attributes, and a performer page is mostly photos */
    const [attrImages, setAttrImages] = useState(null);
    /* the bulk write runs as a Stash job, not in this tab: this is its handle */
    const [attrJob, setAttrJob] = useState(null);
    /* follow the job instead of waiting inside a fetch: progress, failure and
       cancellation all arrive from the queue, and the panel stays usable */
    const attrJobId = attrJob && attrJob.id ? attrJob.id : "";
    useEffect(() => {
      if (!attrJobId) return undefined;
      let alive = true;
      let timer = 0;
      const finish = (message, isError) => {
        if (!alive) return;
        setAttrJob(null);
        setAttrBusy(false);
        if (isError) setAttrError(message);
        else setAttrDone(message);
        refreshAttrRows();
      };
      const tick = async () => {
        if (!alive) return;
        try {
          const data = await gql(`query StashTokAttrJob { jobQueue { id status progress description error } }`);
          const jobs = (data && data.jobQueue) || [];
          const mine = jobs.filter((job) => String(job.id) === String(attrJobId))[0];
          if (!mine) {
            /* Stash drops a job from the queue the moment it ends, so absence is
               the success signal; failures are caught while it is still listed */
            finish("Done — the write finished on the server.", false);
            return;
          }
          if (mine.status === "FINISHED") {
            finish("Done — the write finished on the server.", false);
            return;
          }
          if (mine.status === "FAILED" || mine.status === "CANCELLED") {
            finish(
              (mine.error && String(mine.error)) ||
                (mine.status === "CANCELLED" ? "Stopped." : "The job failed."),
              true
            );
            return;
          }
          const progress = mine.progress == null ? 0 : Number(mine.progress);
          setAttrJob((prev) => (prev ? Object.assign({}, prev, { progress: progress }) : prev));
          timer = setTimeout(tick, 1200);
        } catch (err) {
          timer = setTimeout(tick, 2500);
        }
      };
      tick();
      return () => {
        alive = false;
        clearTimeout(timer);
      };
    }, [attrJobId]);
    /* ids of the duplicate tags, resolved once; empty list = no exclusion */
    const [dupeTags, setDupeTags] = useState([]);
    const [stuck, setStuck] = useState(false);
    const pageRef = useRef(null);
    // v2: older builds stored their own default ("updated_at") per performer, which
    // would keep overriding the file-size default for a day after this change
    const sortKey = "stashTok.perfSort.v2." + profileKey;
    const favKey = "stashTok.perfFavFirst." + profileKey;
    const dirKey = "stashTok.perfDir.v1." + profileKey;
    const imgSortKey = "stashTok.imgSort.v1." + profileKey;
    const imgDirKey = "stashTok.imgDir.v1." + profileKey;
    const imgFavKey = "stashTok.imgFavFirst.v1." + profileKey;
    const [sort, setSort] = useState(() => readPinned(sortKey, (prefs && prefs.performerSort) || "filesize"));
    /* scenes and images keep their own order: they are two different lists, and one
       shared sort meant re-sorting the photos when you only wanted the videos */
    const [sortDir, setSortDir] = useState(() => (readPinned(dirKey, "DESC") === "ASC" ? "ASC" : "DESC"));
    const [imgSort, setImgSort] = useState(() => readPinned(imgSortKey, "filesize"));
    const [imgDir, setImgDir] = useState(() => (readPinned(imgDirKey, "DESC") === "ASC" ? "ASC" : "DESC"));
    const [imgFavFirst, setImgFavFirst] = useState(() => readPinned(imgFavKey, false));
    const [favFirst, setFavFirst] = useState(() => readPinned(favKey, false));
    /* which category's caret menu is open: null | "scenes" | "images" */
    const [menuKind, setMenuKind] = useState(null);
    const [density, setDensity] = useState(() => {
      /* the ▦/▥ choice is a habit, not a per-visit decision: remember it */
      try {
        return window.localStorage.getItem("stashTok.gridDensity") === "5" ? 5 : 3;
      } catch (e) {
        return 3;
      }
    });
    const [cols, setCols] = useState(denseColumns);
    useEffect(() => {
      function onResize() {
        setCols(denseColumns());
      }
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);
    function pickDensity(next) {
      setDensity(next);
      try {
        window.localStorage.setItem("stashTok.gridDensity", String(next));
      } catch (e) {
        /* ignore quota errors */
      }
    }
    const [folderPick, setFolderPick] = useState(null);
    /* opt-in hover preview (Settings → Performer page); off = tiles never mount a video */
    const hoverOn = !!(prefs && prefs.hoverPreview);
    const [hoverScene, setHoverScene] = useState(null);
    const [sel, setSel] = useState(-1);
    /* long press = contact sheet instead of opening the clip */
    const [contactScene, setContactScene] = useState(null);
    const holdRef = useRef({ timer: 0, fired: false });

    /* coming back from a clip: put the cursor on the tile that was opened */
    useEffect(() => {
      if (!scenes.length || !lastOpenedSceneId) return undefined;
      const index = scenes.findIndex((entry) => String(entry.id) === lastOpenedSceneId);
      if (index < 0) return undefined;
      setSel(index);
      const timer = window.setTimeout(() => {
        const tile = document.querySelector(".stk-tile.stk-sel");
        if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: "nearest" });
      }, 120);
      return () => window.clearTimeout(timer);
    }, [scenes]);
    const [error, setError] = useState("");

    useEffect(() => {
      if (!isFolder) return undefined;
      let alive = true;
      const name = String(folder).split("/").filter(Boolean).pop() || folder;
      const favs = loadFolderFavs();
      setPerformer({
        id: "folder:" + folder,
        name,
        folder,
        favorite: favs.indexOf(folder) >= 0,
        alias_list: [],
        tags: [],
        scene_count: null,
        image_count: null,
      });
      gql(
        `query StashTokFolderMarkers($p: String!) {
          findSceneMarkers(filter: { per_page: 60, sort: "random" },
                           scene_marker_filter: { scene_filter: { path: { value: $p, modifier: INCLUDES } } }) {
            count
            scene_markers { id seconds title primary_tag { id name } scene { id paths { screenshot } } }
          }
        }`,
        { p: folder }
      )
        .then((data) => {
          if (!alive) return;
          setMarkers(data.findSceneMarkers.scene_markers || []);
          setMarkerCount(data.findSceneMarkers.count || 0);
        })
        .catch(() => alive && setMarkers([]));
      return () => {
        alive = false;
      };
    }, [folder, isFolder]);

    useEffect(() => {
      if (isFolder) return undefined;
      let alive = true;
      gql(
        `query StashTokPerformer($id: ID!) {
          findPerformer(id: $id) {
            id name alias_list image_path scene_count image_count gallery_count o_counter rating100 favorite
            birthdate country ethnicity fake_tits height_cm measurements details urls
          }
        }`,
        { id: performerId }
      )
        .then((data) => alive && setPerformer(data.findPerformer))
        .catch((err) => alive && setError(String(err.message || err)));

      gql(
        `query StashTokPerformerMarkers($id: ID!) {
          findSceneMarkers(filter: { per_page: 60, sort: "random" },
                           scene_marker_filter: { scene_filter: { performers: { value: [$id], modifier: INCLUDES } } }) {
            count
            scene_markers { id seconds title primary_tag { id name } scene { id paths { screenshot } } }
          }
        }`,
        { id: performerId }
      )
        .then((data) => {
          if (!alive) return;
          setMarkers(data.findSceneMarkers.scene_markers || []);
          setMarkerCount(data.findSceneMarkers.count || 0);
        })
        .catch(() => alive && setMarkers([]));

      return () => {
        alive = false;
      };
    }, [performerId]);

    useEffect(() => {
      let alive = true;
      duplicateTagIds().then((ids) => {
        if (alive && ids.length) setDupeTags(ids);
      });
      return () => {
        alive = false;
      };
    }, []);

    useEffect(() => {
      let alive = true;
      const direction = sortDir;
      if (isFolder) {
        gql(
          `query StashTokFolderScenes($p: String!, $sort: String, $dir: SortDirectionEnum) {
            findScenes(scene_filter: { path: { value: $p, modifier: INCLUDES } },
                       filter: { per_page: 200, sort: $sort, direction: $dir }) {
              count
              scenes { id title date rating100 paths { stream screenshot preview vtt sprite } files { duration size width height } }
            }
          }`,
          { p: folder, sort, dir: direction }
        )
          .then((data) => {
            if (!alive) return;
            const rows = data.findScenes.scenes || [];
            const orderedRows = favFirst
              ? rows.filter((row) => (row.rating100 || 0) > 0).concat(rows.filter((row) => !((row.rating100 || 0) > 0)))
              : rows;
            setScenes(orderedRows);
            setPerformer((cur) => (cur ? Object.assign({}, cur, { scene_count: data.findScenes.count }) : cur));
          })
          .catch(() => alive && setScenes([]));
        return () => {
          alive = false;
        };
      }
      gql(
        `query StashTokPerformerScenes($id: ID!, $sort: String, $dir: SortDirectionEnum, $dupes: [ID!]) {
          findScenes(scene_filter: { performers: { value: [$id], modifier: INCLUDES },
                                     tags: { value: $dupes, modifier: EXCLUDES }${
                                       favoritesOnly ? ", rating100: { value: 0, modifier: GREATER_THAN }" : ""
                                     } },
                     filter: { per_page: 100, sort: $sort, direction: $dir }) {
            count
            scenes {
              id title date rating100
              paths { stream screenshot preview vtt sprite }
              files { duration size width height path }
            }
          }
        }`,
        { id: performerId, sort, dir: direction, dupes: dupeTags }
      )
        .then((data) => {
          if (!alive) return;
          const rows = data.findScenes.scenes || [];
          // favourites first is a stable partition, so the chosen sort survives inside each half
          const ordered = favFirst
            ? rows.filter((row) => (row.rating100 || 0) > 0).concat(rows.filter((row) => !((row.rating100 || 0) > 0)))
            : rows;
          setScenes(ordered);
        })
        .catch(() => alive && setScenes([]));
      return () => {
        alive = false;
      };
    }, [performerId, sort, sortDir, favFirst, folder, isFolder, dupeTags, favoritesOnly]);

    /* Images page in 100 at a time. A performer here has 900+ and the grid used to
       stop dead at the first 60 with nothing on screen saying so -- which reads as
       "half my images are missing" rather than "this is page one". */
    const loadImages = useCallback(
      async (page, replace) => {
        if (imgBusyRef.current) return;
        const have = replace ? 0 : imagesRef.current.length;
        if (!replace && imageTotalRef.current != null && have >= imageTotalRef.current) return;
        imgBusyRef.current = true;
        setImgBusy(true);
        const sortArg = imgSort;
        try {
          const data = isFolder
            ? await gql(
                `query StashTokFolderImages($p: String!, $sort: String, $page: Int!, $dir: SortDirectionEnum) {
                  findImages(image_filter: { path: { value: $p, modifier: INCLUDES } },
                             filter: { per_page: 100, page: $page, sort: $sort, direction: $dir }) {
                    count
                    images { id title rating100 paths { thumbnail image } }
                  }
                }`,
                { p: folder, sort: sortArg, dir: imgDir, page }
              )
            : await gql(
                `query StashTokPerformerImages($id: ID!, $sort: String, $page: Int!, $dir: SortDirectionEnum) {
                  findImages(image_filter: { performers: { value: [$id], modifier: INCLUDES } },
                             filter: { per_page: 100, page: $page, sort: $sort, direction: $dir }) {
                    count
                    images { id title rating100 paths { thumbnail image } }
                  }
                }`,
                { id: performerId, sort: sortArg, dir: imgDir, page }
              );
          const rows = (data.findImages && data.findImages.images) || [];
          const total = data.findImages ? data.findImages.count : null;
          imageTotalRef.current = total;
          setImageTotal(total);
          setImgPage(page);
          if (replace) {
            setImages(rows);
            setPerformer((cur) => (cur ? Object.assign({}, cur, { image_count: total }) : cur));
          } else {
            setImages((cur) => {
              const seen = {};
              cur.forEach((row) => {
                seen[row.id] = true;
              });
              return cur.concat(rows.filter((row) => !seen[row.id]));
            });
          }
        } catch (err) {
          if (replace) setImages([]);
        }
        imgBusyRef.current = false;
        setImgBusy(false);
      },
      [performerId, imgSort, imgDir, folder, isFolder]
    );

    useEffect(() => {
      imagesRef.current = images;
    }, [images]);

    useEffect(() => {
      if (media !== "images") return undefined;
      /* a new sort (or a different performer) starts over at page one */
      imageTotalRef.current = null;
      let alive = true;
      loadImages(1, true);
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [performerId, media, imgSort, imgDir, folder, isFolder]);

    async function toggleFollow() {
      if (!performer) return;
      const next = !performer.favorite;
      if (isFolder) {
        const favs = loadFolderFavs();
        const at = favs.indexOf(folder);
        if (next && at < 0) favs.push(folder);
        if (!next && at >= 0) favs.splice(at, 1);
        saveFolderFavs(favs);
        setPerformer(Object.assign({}, performer, { favorite: next }));
        buzz(10);
        return;
      }
      setPerformer(Object.assign({}, performer, { favorite: next }));
      try {
        await gql(
          `mutation StashTokFollow($id: ID!, $fav: Boolean!) {
            performerUpdate(input: { id: $id, favorite: $fav }) { id favorite }
          }`,
          { id: performer.id, fav: next }
        );
      } catch (err) {
        setError(String(err.message || err));
        setPerformer(Object.assign({}, performer, { favorite: !next }));
      }
    }

    /* ---- menu actions ------------------------------------------------ */
    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) {
        /* fall through to the old API */
      }
      try {
        const node = document.createElement("textarea");
        node.value = text;
        document.body.appendChild(node);
        node.select();
        document.execCommand("copy");
        document.body.removeChild(node);
        return true;
      } catch (e) {
        return false;
      }
    }

    /* Duplicate detection, scoped to this performer.
     * Stash's own duplicate checker is library-wide and phash-based, and it cannot be
     * filtered to a performer, so this groups the performer's images by exact file
     * size + pixel dimensions instead: that catches the same file saved twice (which
     * is what re-downloads and copies look like) without pretending to find
     * re-encodes. Read-only: it reports, it never deletes. */
    async function scanDuplicates() {
      if (isFolder) return;
      setDupes({ busy: true, groups: [], scanned: 0, total: null });
      const rows = [];
      try {
        let page = 1;
        let total = null;
        /* ids + file size only: 45k images is 45 small responses, not 45 large ones.
           Thumbnails are fetched afterwards, for the handful of sets that matter. */
        for (;;) {
          const data = await gql(
            `query StashTokDupeScan($id: ID!, $page: Int!) {
              findImages(image_filter: { performers: { value: [$id], modifier: INCLUDES } },
                         filter: { per_page: 1000, page: $page }) {
                count
                images { id files { size width height } }
              }
            }`,
            { id: performerId, page }
          );
          const pageRows = (data.findImages && data.findImages.images) || [];
          total = data.findImages ? data.findImages.count : 0;
          rows.push.apply(rows, pageRows);
          setDupes({ busy: true, groups: [], scanned: rows.length, total });
          if (!pageRows.length || rows.length >= (total || 0) || page >= 200) break;
          page += 1;
        }
        const buckets = {};
        rows.forEach((row) => {
          const file = (row.files && row.files[0]) || {};
          if (!file.size) return;
          const key = file.size + ":" + (file.width || 0) + "x" + (file.height || 0);
          (buckets[key] = buckets[key] || []).push(row);
        });
        let groups = Object.keys(buckets)
          .map((key) => buckets[key])
          .filter((group) => group.length > 1)
          .sort((a, b) => b.length - a.length)
          .slice(0, 100);
        /* one more query gives the copies somewhere to be looked at */
        const ids = [];
        groups.forEach((group) => group.forEach((row) => ids.push(row.id)));
        if (ids.length) {
          const data = await gql(
            `query StashTokDupeThumbs($ids: [ID!]!) {
              findImages(ids: $ids) { images { id title paths { thumbnail image } } }
            }`,
            { ids: ids.slice(0, 800) }
          );
          const byId = {};
          ((data.findImages && data.findImages.images) || []).forEach((row) => {
            byId[String(row.id)] = row;
          });
          groups = groups.map((group) =>
            group.map((row) => {
              const detail = byId[String(row.id)];
              return detail ? Object.assign({}, row, { title: detail.title, paths: detail.paths }) : row;
            })
          );
        }
        setDupes({ busy: false, groups, scanned: rows.length, total });
      } catch (err) {
        setDupes({ busy: false, groups: [], scanned: rows.length, total: null, error: String(err.message || err) });
      }
    }

    /* the markers tab can disappear once the count lands (this performer has none);
       if it was the open tab, fall back to the scenes grid */
    useEffect(() => {
      if (tab === "markers" && markerCount === 0) setTab("scenes");
    }, [tab, markerCount]);

    /* keyboard: arrows walk the grid, space/enter plays, backspace steps out */
    useEffect(() => {
      function onKey(event) {
        const tag = (event.target && event.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || (event.target && event.target.isContentEditable)) return;
        const list = folderPick ? scenes.filter((row) => prettyPath(((row.files && row.files[0]) || {}).path) === folderPick || "(root)" === folderPick) : scenes;
        const total = list.length;
        if (event.key === "Backspace") {
          event.preventDefault();
          onBack();
          return;
        }
        if (!total) return;
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          const target = list[sel] || list[0];
          if (!target) return;
          event.preventDefault();
          setSel(sel < 0 ? 0 : sel);
          openScene(target);
          return;
        }
        /* the dense grid is JS-packed, so its column count is known, not read back
           from grid-template-columns (a masonry has no rows to stride by anyway —
           up/down step a whole column's worth of tiles) */
        const stride = density === 5 ? cols : (() => {
          const grid = document.querySelector(".stk-page .stk-grid-3");
          if (!grid) return 3;
          return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 3;
        })();
        let next = sel;
        if (event.key === "ArrowRight") next = sel < 0 ? 0 : Math.min(total - 1, sel + 1);
        else if (event.key === "ArrowLeft") next = sel < 0 ? 0 : Math.max(0, sel - 1);
        else if (event.key === "ArrowDown") next = sel < 0 ? 0 : Math.min(total - 1, sel + stride);
        else if (event.key === "ArrowUp") next = sel < 0 ? 0 : Math.max(0, sel - stride);
        else return;
        event.preventDefault();
        setSel(next);
        /* look the tile up by index: the dense grid's DOM order is column-major */
        const node = document.querySelector('.stk-page .stk-tile[data-idx="' + next + '"]');
        if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [sel, scenes, folderPick, onBack, density, cols]);

    if (error) {
      return h("div", { className: "stk-page" }, h("div", { className: "stk-state" }, h("p", null, error)));
    }
    if (!performer) {
      return h("div", { className: "stk-page" }, h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" })));
    }

    const cover = rel(performer.image_path);
    const goImages = () => { setTab("images"); setMedia("images"); };
    const goMarkers = () => { setTab("markers"); setMedia("videos"); };
    const goScenes = () => { setTab("scenes"); setMedia("videos"); };
    /* scenes / images / markers, in that order: the counts are tap targets, the way
       the numbers on a profile are */
    const stats = [
      ["Scenes", performer.scene_count == null ? scenes.length : performer.scene_count, goScenes],
      ["Images", performer.image_count == null ? images.length : performer.image_count, goImages],
      ["Markers", markerCount == null ? "—" : markerCount, goMarkers],
    ];
    /* the "handle" line: the folder this performer lives in -- the one thing every
       record here has that Stash itself does not show */
    const firstPath = ((scenes[0] || {}).files || [{}])[0].path || "";
    const handleText = isFolder
      ? String(folder)
      : performerRoot(firstPath, performer.name) ||
        prettyPath(firstPath) ||
        (performer.alias_list || []).slice(0, 3).join(" · ");

    const bioText = isFolder ? "" : String(performer.details || "").trim();
    /* links: only the sites a profile is actually looked up on. imdb / iafd /
       bang.com and the rest of the catalog URLs are noise here. One chip per site. */
    const LINK_SITES = [
      [/simpcity/i, "SimpCity"],
      [/(?:\/\/|\.)(?:x\.com|twitter\.com)(?:\/|$)/i, "X"],
      [/instagram/i, "IG"],
      [/linktr\.ee|linktree/i, "Linktree"],
      [/onlyfans/i, "OnlyFans"],
      [/babepedia/i, "Babepedia"],
    ];
    const seenLink = {};
    const links = (isFolder ? [] : performer.urls || [])
      .filter(Boolean)
      .map((url) => {
        const clean = String(url).trim();
        const site = LINK_SITES.find(([pattern]) => pattern.test(clean));
        return site ? { url: clean, label: site[1] } : null;
      })
      .filter((link) => {
        if (!link) return false;
        if (seenLink[link.label]) return false;
        seenLink[link.label] = true;
        return true;
      });
    /* the strip under the counts: ethnicity | country | natural-or-fake */
    const metaLine = isFolder
      ? ""
      : [performer.ethnicity, performer.country, performer.fake_tits]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(" | ");
    const gridClass = density === 5 ? "stk-grid-5" : "stk-grid-3";
    /* dense mode packs the same tiles into JS-balanced columns; normal mode keeps
       the 3-across grid. `ratios` is optional: a branch that knows its aspect
       ratios (scenes do) gets a properly balanced masonry, the rest fall back to 9:16. */
    function gridWrap(tiles, ratios) {
      if (density !== 5) return h("div", { className: gridClass }, tiles);
      return denseLayout(tiles, (index) => (ratios && ratios[index]) || 0, cols);
    }

    const sortLabel = (SCENE_SORTS.find((entry) => entry[0] === sort) || SCENE_SORTS[0])[1];
    /* the same page in Stash, so a performer or a folder can be curated there */
    const stashLink = stashHref(isFolder ? { folder } : { performerId });

    /* ---- attribute sync ------------------------------------------------ *
       The performer is the authority for body and ethnicity tags; a single
       scene is not. This panel is the review step: it counts how many of that
       performer's scenes already carry each attribute, the user confirms, and
       only then does it go everywhere. A two-performer scene is exactly why
       this is manual — the tag that scene needs is not the tag of one person. */
    async function loadAttrScenes(pid) {
      const rows = [];
      let page = 1;
      for (;;) {
        const data = await gql(
          `query StashTokPerfAttrScenes($id: ID!, $page: Int!) {
            findScenes(filter: { per_page: 250, page: $page },
                       scene_filter: { performers: { value: [$id], modifier: INCLUDES } }) {
              count
              scenes { id tags { id name } }
            }
          }`,
          { id: pid, page }
        );
        const found = (data && data.findScenes) || {};
        const batch = found.scenes || [];
        batch.forEach((row) => rows.push(row));
        if (!batch.length || rows.length >= (found.count || 0) || page >= 40) break;
        page += 1;
      }
      return rows;
    }

    async function loadAttrImages(pid) {
      const rows = [];
      let page = 1;
      for (;;) {
        const data = await gql(
          `query StashTokPerfAttrImages($id: ID!, $page: Int!) {
            findImages(filter: { per_page: 250, page: $page },
                       image_filter: { performers: { value: [$id], modifier: INCLUDES } }) {
              count
              images { id tags { id name } }
            }
          }`,
          { id: pid, page }
        );
        const found = (data && data.findImages) || {};
        const batch = found.images || [];
        batch.forEach((row) => rows.push(row));
        if (!batch.length || rows.length >= (found.count || 0) || page >= 80) break;
        page += 1;
      }
      return rows;
    }

    function attrHave(attr, scene) {
      const have = new Set(((scene && scene.tags) || []).map((tag) => String(tag.name).trim().toLowerCase()));
      return attr.tags.every((name) => have.has(name.toLowerCase()));
    }

    function attrCount(attr, scenes) {
      return (scenes || []).filter((scene) => attrHave(attr, scene)).length;
    }

    /* The undo record must outlive the panel: it is the only thing standing
       between a wrong bulk write and a manual cleanup of hundreds of rows. It
       goes to localStorage per performer, not into React state that a
       navigation throws away. */
    function undoKeyFor(pid) {
      return "stashTok.attrUndo.v1." + String(pid || "");
    }

    function readUndoRecord(pid) {
      try {
        const raw = window.localStorage.getItem(undoKeyFor(pid));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.entries || !parsed.entries.length) return null;
        /* a week is enough to notice a mistake; older records are noise */
        if (parsed.at && Date.now() - parsed.at > 7 * 24 * 60 * 60 * 1000) {
          window.localStorage.removeItem(undoKeyFor(pid));
          return null;
        }
        return parsed;
      } catch (err) {
        return null;
      }
    }

    function writeUndoRecord(pid, payload) {
      try {
        if (!payload) {
          window.localStorage.removeItem(undoKeyFor(pid));
          return;
        }
        window.localStorage.setItem(undoKeyFor(pid), JSON.stringify(Object.assign({ at: Date.now() }, payload)));
      } catch (err) {
        /* private mode: undo just becomes panel-only, which is still correct */
      }
    }

    function hasTag(row, name) {
      const want = String(name).trim().toLowerCase();
      return ((row && row.tags) || []).some((tag) => String(tag.name).trim().toLowerCase() === want);
    }

    function openAttrs() {
      if (isFolder || !performerId) return;
      setMenuOpen(false);
      setAttrOpen(true);
      setAttrDone("");
      setAttrError("");
      /* an undo from a previous visit is still a live undo */
      if (!attrUndo && performerId) {
        const kept = readUndoRecord(performerId);
        if (kept) {
          setAttrUndo(kept);
          setAttrDone("Last sync: " + kept.label + " — still reversible.");
        }
      }
      /* scenes and images are separate reads, and the panel is dishonest if it
         only counts half of what it is about to write */
      if (!attrScenes) {
        loadAttrScenes(performerId)
          .then((rows) => setAttrScenes(rows))
          .catch((err) => {
            setAttrError(String((err && err.message) || err));
            setAttrScenes([]);
          });
      }
      if (!attrImages) {
        loadAttrImages(performerId)
          .then((rows) => setAttrImages(rows))
          .catch(() => setAttrImages([]));
      }
    }

    function toggleAttr(name) {
      setAttrPick((prev) => Object.assign({}, prev, { [name]: !prev[name] }));
    }

    /* Hand the write to Stash as a job. The tab is only a spectator after this:
       close it, lock the iPad, walk away — the job keeps writing, and comes back
       with progress instead of a spinner. */
    async function startAttrJob(payload, description) {
      const args = {
        mode: payload.mode,
        performerId: payload.performerId,
        entries: JSON.stringify(payload.entries),
        chunk: "100",
      };
      const data = await gql(
        `mutation StashTokRunTask($p: ID!, $t: String!, $a: Map, $d: String) {
          runPluginTask(plugin_id: $p, task_name: $t, args_map: $a, description: $d)
        }`,
        { p: "stashTok", t: "TagSync", a: args, d: description }
      );
      const id = (data && data.runPluginTask) || "";
      setAttrJob({ id: String(id), progress: 0, label: payload.label, description });
      return id;
    }

    async function refreshAttrRows() {
      if (!performerId) return;
      try {
        const [rows, images] = await Promise.all([loadAttrScenes(performerId), loadAttrImages(performerId)]);
        setAttrScenes(rows);
        setAttrImages(images);
      } catch (err) {
        /* the write already landed; a failed re-read is not a failed operation */
      }
    }

    async function applyAttrs() {
      const picks = SYNC_ATTRS.filter((attr) => attrPick[attr.name]);
      if (!picks.length || attrBusy || !performerId || !attrScenes) return;
      setAttrBusy(true);
      setAttrError("");
      setAttrDone("");
      setAttrUndo(null);
      setAttrJob(null);
      try {
        const cache = {};
        const ids = {};
        const names = [];
        picks.forEach((attr) => attr.tags.forEach((name) => {
          if (names.indexOf(name) < 0) names.push(name);
        }));
        for (const name of names) ids[name] = await ensureTagId(name, cache);

        /* one entry per tag, listing only the rows actually missing it: that
           list is both the write plan and the undo record */
        const sceneRows = attrScenes || [];
        const imageRows = attrImages || [];
        const entries = names
          .map((name) => ({
            tagId: ids[name],
            name,
            scenes: sceneRows.filter((row) => !hasTag(row, name)).map((row) => String(row.id)),
            images: imageRows.filter((row) => !hasTag(row, name)).map((row) => String(row.id)),
          }))
          .filter((entry) => entry.scenes.length || entry.images.length);

        if (!entries.length) {
          setAttrDone("Everything here already carries those tags.");
          setAttrBusy(false);
          return;
        }

        const scenesWanted = new Set();
        const imagesWanted = new Set();
        entries.forEach((entry) => {
          entry.scenes.forEach((id) => scenesWanted.add(id));
          entry.images.forEach((id) => imagesWanted.add(id));
        });
        const payload = {
          mode: "add",
          performerId: String(performerId),
          entries,
          label: picks.map((attr) => attr.name).join(", "),
        };
        await startAttrJob(
          payload,
          "StashTok: " + payload.label + " \u2014 " + scenesWanted.size + " scenes, " + imagesWanted.size + " images"
        );
        setAttrUndo(payload);
        writeUndoRecord(performerId, payload);
        setAttrPick({});
      } catch (err) {
        setAttrError(String((err && err.message) || err));
        setAttrBusy(false);
      }
    }

    async function undoAttrs() {
      const snap = attrUndo;
      if (!snap || attrBusy) return;
      setAttrBusy(true);
      setAttrError("");
      setAttrDone("");
      try {
        await startAttrJob(Object.assign({}, snap, { mode: "remove" }), "StashTok undo: " + snap.label);
        setAttrUndo(null);
        writeUndoRecord(performerId, null);
      } catch (err) {
        setAttrError(String((err && err.message) || err));
        setAttrBusy(false);
      }
    }

    async function stopAttrJob() {
      if (!attrJob || !attrJob.id) return;
      try {
        await gql(`mutation StashTokStopJob($id: ID!) { stopJob(job_id: $id) }`, { id: attrJob.id });
        setAttrDone("Stopped. Rows already written stay written \u2014 Undo reverses them.");
      } catch (err) {
        setAttrError(String((err && err.message) || err));
      }
    }

    function attrSheet() {
      const scenes = attrScenes;
      const images = attrImages;
      const total = scenes ? scenes.length : 0;
      const imageTotal = images ? images.length : 0;
      const picks = SYNC_ATTRS.filter((attr) => attrPick[attr.name]);
      const sceneTargets = scenes
        ? scenes.filter((scene) => picks.some((attr) => !attrHave(attr, scene))).length
        : 0;
      const imageTargets = images
        ? images.filter((row) => picks.some((attr) => attr.tags.some((name) => !hasTag(row, name)))).length
        : 0;
      const targets = sceneTargets + imageTargets;
      const targetLabel = [
        sceneTargets ? sceneTargets + " scene" + (sceneTargets === 1 ? "" : "s") : "",
        imageTargets ? imageTargets + " image" + (imageTargets === 1 ? "" : "s") : "",
      ]
        .filter(Boolean)
        .join(" + ");
      /* what is on some of her scenes and not others is the interesting row:
         it sorts first, so the panel reads as "these are the ones to settle" */
      const rows = SYNC_ATTRS
        .map((attr) => ({ attr, count: attrCount(attr, scenes) }))
        .sort((a, b) => {
          const aPartial = scenes && a.count > 0 && a.count < total ? 0 : 1;
          const bPartial = scenes && b.count > 0 && b.count < total ? 0 : 1;
          if (aPartial !== bPartial) return aPartial - bPartial;
          if (b.count !== a.count) return b.count - a.count;
          return a.attr.name.localeCompare(b.attr.name);
        });
      return h(
        Portal,
        null,
        h(
          TagSheetShell,
          {
            title: "Body tags",
            note: h(
              React.Fragment,
              null,
              "Every scene by ",
              h("b", null, (performer && performer.name) || "this performer"),
              " \u2014 ",
              total || "\u2026",
              " scene" + (total === 1 ? "" : "s"),
              imageTotal ? " and " + imageTotal + " image" + (imageTotal === 1 ? "" : "s") : "",
              ". Tick what is true of her. Nothing is written until you confirm."
            ),
            onClose: () => setAttrOpen(false),
            footer: h(
              "div",
              { className: "stk-attr-actions" },
              h(
                "button",
                {
                  type: "button",
                  className: "stk-btn stk-primary",
                  disabled: attrBusy || !picks.length || !targets,
                  onClick: applyAttrs,
                },
                attrBusy
                  ? attrJob
                    ? "Working\u2026 " + Math.round((attrJob.progress || 0) * 100) + "%"
                    : "Starting\u2026"
                  : picks.length
                  ? "Apply to " + targetLabel
                  : "Pick attributes"
              ),
              attrUndo &&
                h(
                  "button",
                  { type: "button", className: "stk-btn stk-btn-danger", disabled: attrBusy, onClick: undoAttrs },
                  attrBusy && !attrJob ? "Undoing\u2026" : "Undo"
                )
            ),
          },
          !scenes
            ? h("p", { className: "stk-sub" }, "Reading scenes\u2026")
            : h(
                "div",
                { className: "stk-attr-grid" },
                rows.map(({ attr, count }) => {
                  const on = !!attrPick[attr.name];
                  const all = total > 0 && count === total;
                  return h(
                    "button",
                    {
                      key: attr.name,
                      type: "button",
                      className: "stk-attrchip" + (on ? " stk-on" : "") + (all ? " stk-all" : ""),
                      "aria-pressed": on,
                      title: attr.kind + (attr.tags.length > 1 ? " \u2192 " + attr.tags.join(" + ") : ""),
                      onClick: () => toggleAttr(attr.name),
                    },
                    h("span", { className: "stk-attrchip-name" }, attr.name),
                    h("span", { className: "stk-attrchip-count" }, total ? count + "/" + total : "\u2014")
                  );
                })
              ),
          attrJob
            ? h(
                "div",
                { className: "stk-attr-progress" },
                h(
                  "div",
                  { className: "stk-attr-bar" },
                  h("span", { style: { width: Math.round((attrJob.progress || 0) * 100) + "%" } })
                ),
                h(
                  "div",
                  { className: "stk-attr-progress-row" },
                  h(
                    "span",
                    null,
                    Math.round((attrJob.progress || 0) * 100) + "% \u2014 running on the server, safe to close this page"
                  ),
                  h("button", { type: "button", className: "stk-btn stk-btn-danger", onClick: stopAttrJob }, "Stop")
                )
              )
            : null,
          attrError ? h("p", { className: "stk-attr-error" }, attrError) : null,
          attrDone ? h("p", { className: "stk-attr-done" }, attrDone) : null,
          h(
            "p",
            { className: "stk-attr-warn" },
            "This writes across every scene and image of her at once, so it cannot be undone one scene at a time. ",
            attrUndo
              ? "Undo removes exactly these tags from exactly the rows that were missing them \u2014 anything you tag by hand in between comes off too."
              : "Undo is offered here right after you apply."
          )
        )
      );
    }

    /* the tiles on screen right now: the same filter the grid renders with */
    function visibleScenes() {
      return folderPick
        ? scenes.filter((scene) => (prettyPath(((scene.files && scene.files[0]) || {}).path) || "(root)") === folderPick)
        : scenes;
    }

    /* the ⋯ menu, as a popup anchored under its own button: the same gesture as the
       sort carets, not a sheet that takes the whole screen */
    function menuPopup() {
      const row = (key, icon, label, detail, onClick, extra) =>
        h(
          "button",
          Object.assign(
            {
              key,
              className: "stk-pop-item stk-pop-row",
              onClick: (event) => {
                event.stopPropagation();
                setMenuOpen(false);
                onClick();
              },
            },
            extra || {}
          ),
          h(Icon, { name: icon, size: 17 }),
          h("span", null, label),
          detail ? h("small", null, detail) : null
        );
      return h(
        Portal,
        null,
        h("div", { className: "stk-profile-menu-backdrop", onClick: () => setMenuOpen(false) }),
        h(
          "div",
          { className: "stk-pop stk-menu-pop", ref: profileMenuRef, role: "dialog", "aria-modal": "true",
            "aria-label": "Profile actions", onClick: (event) => event.stopPropagation() },
          stashLink &&
            row("stash", "external", "View on Stash", null, () => window.open(stashLink, "_blank", "noopener")),
          !isFolder &&
            row("dupes", "dupe", "Detect duplicates", null, () => {
              scanDuplicates();
            }),
          !isFolder &&
            row("attrs", "tag", "Body tags", "Sync across every scene", () => {
              openAttrs();
            }),
          handleText &&
            !isFolder &&
            row("folder", "folder", "Open folder", null, () => goTo("folder/" + encodeURIComponent(handleText))),
          row("copy", "link", "Copy link", null, () => copyText(window.location.href)),
          row("reload", "rotate", "Reload from Stash", null, () => window.location.reload())
        )
      );
    }

    function openScene(scene) {
      lastOpenedSceneId = String(scene.id);
      // the URL names the performer and the exact clip, like tiktok.com/@user/video/<id>
      /* one history entry: this goTo below is the push, the feed switch must not add another */
      gridPlay = {
        performerId: String(performerId),
        sceneId: String(scene.id),
        sort,
        dir: sortDir,
        orderIds: visibleScenes().map((row) => String(row.id)),
      };
      onPlay({
        sceneId: scene.id,
        tab: "scenes",
        sort,
        dir: sortDir,
        /* the visible list in the visible order: the feed opens on it verbatim, so a
           swipe goes to the next tile instead of Stash's own next-by-sort */
        orderIds: visibleScenes().map((row) => String(row.id)),
        noPush: true,
      });
      if (isFolder) goTo("folder/" + encodeURIComponent(folder) + "/" + scene.id);
      else goTo("performers/" + encodeURIComponent(performer.name) + "/" + scene.id);
    }

    return h(
      "div",
      {
        className: "stk-page stk-profile",
        style: { padding: 0 },
        ref: pageRef,
        onScroll: (event) => {
          const node = event.currentTarget;
          setStuck(node.scrollTop > 128);
          /* images arrive as you reach the bottom of the page */
          const nearEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 900;
          if (nearEnd && (tab === "images" || media === "images") && imagesRef.current.length) {
            loadImages(imgPage + 1, false);
          }
        },
      },
      stuck &&
        performer &&
        h(
          "div",
          {
            className: "stk-minihead",
            onClick: () => pageRef.current && pageRef.current.scrollTo({ top: 0, behavior: "smooth" }),
          },
          h("div", { className: "stk-mini-avatar", style: { backgroundImage: `url("${cover}")` } }),
          h("span", { className: "stk-mini-name" }, performer.name),
          h(
            "button",
            {
              className: "stk-mini-play",
              onClick: (event) => {
                event.stopPropagation();
                onPlay({});
              },
            },
            h(Icon, { name: "play", size: 12 }),
            " Play"
          )
        ),
      /* no cover art: the identity block is a plain row -- avatar, then the name,
         one counts line, links. A banner here only pushed the name below the fold. */
      /* the same back control the player uses: one circle, one size, one corner */
      h("button", { className: "stk-feed-back stk-back-fixed", onClick: onBack, title: "Back", "aria-label": "Back" }, h(Icon, { name: "back", size: 22 })),
      h(
        "div",
        { className: "stk-xhead" },
        h("div", { className: "stk-avatar", style: { backgroundImage: `url("${cover}")` } }),
        h(
          "div",
          { className: "stk-xid" },
          h(
            "div",
            { className: "stk-xname" },
            h("span", { className: "stk-xname-text" }, performer.name),
            favoritesOnly ? h("span", { className: "stk-fav-chip" }, "Favorites") : null
          ),
          /* one line, never two: "526 scenes, 0 images, 283 markers" -- each count
             still taps through to its own tab */
          h(
            "div",
            { className: "stk-xcounts" },
            stats.map(([label, value, onClick], index) =>
              h(
                React.Fragment,
                { key: label },
                index > 0 ? h("span", { className: "stk-xcounts-sep" }, ", ") : null,
                h(
                  "button",
                  { type: "button", className: "stk-xcount", onClick },
                  h("b", null, typeof value === "number" ? fmtCount(value) : value),
                  " " + label.toLowerCase()
                )
              )
            )
          ),
          /* ethnicity | country | natural-or-fake, then the links */
          metaLine ? h("div", { className: "stk-xmeta" }, metaLine) : null,
          links.length > 0
            ? h(
                "div",
                { className: "stk-xlinks" },
                links.map((link) =>
                  h(
                    "a",
                    {
                      key: link.url,
                      className: "stk-xlink",
                      href: link.url,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      title: link.url,
                    },
                    "(",
                    link.label,
                    ")"
                  )
                )
              )
            : null,
          /* folders are identified by their path; a performer is not. One clip filed
             under another site's folder was enough to label a person /SiteRip/NetVideoGirls,
             which is a statement about a download, not about them. */
          isFolder && handleText ? h("div", { className: "stk-xhandle" }, handleText) : null
        )
      ),
      h(
        "div",
        { className: "stk-xbody" },
        bioText ? h("div", { className: "stk-xbio" }, bioText) : null,
        h(
          "div",
          { className: "stk-xactions" },
          h(
            "a",
            {
              className: "stk-xbtn stk-xbtn-primary",
              href: reelHref(),
              target: "_blank",
              rel: "noopener noreferrer",
              title: "Play highlights from this library",
            },
            h(Icon, { name: "play", size: 14 }),
            "Highlight reel"
          ),
          h(
            "button",
            {
              type: "button",
              className: "stk-xfav" + (performer.favorite ? " stk-xfav-on" : ""),
              title: performer.favorite ? "Remove from favorites" : "Add to favorites",
              "aria-label": "Favorite",
              "aria-pressed": performer.favorite ? "true" : "false",
              onClick: toggleFollow,
            },
            h(Icon, { name: "heart", size: 19, filled: !!performer.favorite })
          ),
          h(
            "div",
            { className: "stk-xmenu stk-xmenu-inline" + (menuOpen ? " stk-xmenu-open" : "") },
            h(
              "button",
              {
                className: "stk-xmore",
                onClick: () => setMenuOpen(!menuOpen),
                "aria-label": "Profile actions",
                "aria-haspopup": "dialog",
                "aria-expanded": menuOpen ? "true" : "false",
              },
              h(Icon, { name: "more", size: 22 })
            ),
            menuOpen && menuPopup()
          )
        )
      ),

      h(
        "div",
        { className: "stk-tabwrap" },
        h(
          "div",
          { className: "stk-tabs stk-tabbar" },
          /* each category carries its own sort: the caret opens that list, the icon
             switches to it. No more global sort icon, no more density toggle -- both
             live inside the dropdown now. */
          h(
            "div",
            { className: "stk-cat" + (menuKind === "scenes" ? " stk-cat-open" : "") },
            h(
              "button",
              {
                className: tab === "scenes" && media === "videos" ? "stk-active" : "",
                title: "Scenes",
                onClick: () => {
                  setTab("scenes");
                  setMedia("videos");
                },
              },
              h(Icon, { name: "video", size: 21 }),
              h("span", { className: "stk-tab-label" }, "Scenes")
            ),
            h(
              "button",
              {
                className: "stk-caret",
                title: "Sort scenes",
                "aria-haspopup": "menu",
                "aria-expanded": menuKind === "scenes" ? "true" : "false",
                onClick: () => setMenuKind(menuKind === "scenes" ? null : "scenes"),
              },
              h(Icon, { name: menuKind === "scenes" ? "chevronUp" : "chevronDown", size: 13 })
            ),
            menuKind === "scenes" &&
              categoryPopover({
                options: SCENE_SORT_OPTIONS,
                value: sort,
                dir: sortDir,
                onPick: (key) => {
                  setSort(key);
                  setSortDir("DESC");
                  /* picking a row that is not active starts that sort at its natural
                     direction (largest, latest, longest...) */
                  writePinned(sortKey, key);
                  writePinned(dirKey, "DESC");
                  setMenuKind(null);
                },
                onFlip: () => {
                  const next = sortDir === "DESC" ? "ASC" : "DESC";
                  setSortDir(next);
                  writePinned(dirKey, next);
                  setMenuKind(null);
                },
                onClose: () => setMenuKind(null),
                favorite: {
                  on: favFirst,
                  label: "Favorites on top",
                  onToggle: () => {
                    const next = !favFirst;
                    setFavFirst(next);
                    writePinned(favKey, next);
                  },
                },
              })
          ),
          h(
            "div",
            { className: "stk-cat" + (menuKind === "images" ? " stk-cat-open" : "") },
            h(
              "button",
              {
                className: tab === "images" ? "stk-active" : "",
                title: "Images",
                style: prefs && prefs.performerImages === false ? { display: "none" } : null,
                onClick: () => {
                  setTab("images");
                  setMedia("images");
                },
              },
              h(Icon, { name: "image", size: 21 }),
              h("span", { className: "stk-tab-label" }, "Images")
            ),
            h(
              "button",
              {
                className: "stk-caret",
                title: "Sort images",
                "aria-haspopup": "menu",
                "aria-expanded": menuKind === "images" ? "true" : "false",
                onClick: () => setMenuKind(menuKind === "images" ? null : "images"),
              },
              h(Icon, { name: menuKind === "images" ? "chevronUp" : "chevronDown", size: 13 })
            ),
            menuKind === "images" &&
              categoryPopover({
                options: IMAGE_SORT_OPTIONS,
                value: imgSort,
                dir: imgDir,
                onPick: (key) => {
                  setImgSort(key);
                  setImgDir("DESC");
                  writePinned(imgSortKey, key);
                  writePinned(imgDirKey, "DESC");
                  setMenuKind(null);
                },
                onFlip: () => {
                  const next = imgDir === "DESC" ? "ASC" : "DESC";
                  setImgDir(next);
                  writePinned(imgDirKey, next);
                  setMenuKind(null);
                },
                onClose: () => setMenuKind(null),
                favorite: {
                  on: imgFavFirst,
                  label: "Favorites on top",
                  onToggle: () => {
                    const next = !imgFavFirst;
                    setImgFavFirst(next);
                    writePinned(imgFavKey, next);
                  },
                },
              })
          ),
          h(
            "button",
            {
              className: tab === "markers" && media === "videos" ? "stk-active" : "",
              title: markerCount ? "Markers " + markerCount : "Markers",
              /* no markers for this performer: the tab would open an empty grid */
              style:
                (prefs && prefs.performerMarkers === false) || !markerCount ? { display: "none" } : null,
              onClick: () => {
                setTab("markers");
                setMedia("videos");
              },
            },
            h(Icon, { name: "chapter", size: 21 }),
            h("span", { className: "stk-tab-label" }, "Markers")
          ),
          /* tile size: the only control left in this bar. Off = 200 px tiles,
             on = the smaller packed grid. Icon only, on the far right. */
          h(
            "button",
            {
              type: "button",
              className: "stk-density" + (density === 5 ? " stk-density-on" : ""),
              title: density === 5 ? "Larger tiles" : "Smaller tiles",
              "aria-label": density === 5 ? "Larger tiles" : "Smaller tiles",
              "aria-pressed": density === 5 ? "true" : "false",
              onClick: () => pickDensity(density === 5 ? 3 : 5),
            },
            h(Icon, { name: "gallery", size: 19 })
          )
        )
      ),

      (() => {
        if (!prefs || prefs.foldersOnTop === false || tab !== "scenes" || media === "images" || !scenes.length) return null;
        return null; // chips are rendered from the grouped scene list above
      })(),

      media === "images" || tab === "images"
        ? gridWrap(
            /* one list drives both the grid and the viewer, so "favorites on top"
               cannot open the wrong photo when a tile is tapped */
            (imgFavFirst
              ? images.slice().sort((a, b) => (b.rating100 > 0 ? 1 : 0) - (a.rating100 > 0 ? 1 : 0))
              : images
            ).map((image, imageIndex, imageList) =>
              h(
                "button",
                Object.assign(
                  { key: image.id, className: "stk-tile", "data-idx": imageIndex, "data-image": image.id },
                  photoTileProps(image, (event) =>
                    setViewer({ image, items: imageList, index: imageIndex, rect: event.currentTarget.getBoundingClientRect() })
                  )
                ),
                h("div", { className: "stk-tile-photo" }, h(Thumb, { src: rel(image.paths && image.paths.thumbnail) }) )
              )
            )
          )
        : tab === "scenes"
        ? (() => {
            const list = folderPick
              ? scenes.filter((scene) => (prettyPath(((scene.files && scene.files[0]) || {}).path) || "(root)") === folderPick)
              : scenes;
            const ratios = list.map((scene) => tileRatio((scene.files && scene.files[0]) || {}));
            const tiles = list.map((scene, tileIndex) => {
              return h(
                "button",
                {
                  key: scene.id,
                  className: "stk-tile" + (sel === tileIndex ? " stk-sel" : ""),
                  "data-scene": scene.id,
                  "data-idx": tileIndex,
                  /* portrait clips give back 10% of their height to the grid; a
                     landscape clip keeps its true ratio so the cover is not cut */
                  style: density === 5 ? { aspectRatio: String(ratios[tileIndex]) } : undefined,
                  onPointerDown: () => {
                    holdRef.current.fired = false;
                    window.clearTimeout(holdRef.current.timer);
                    holdRef.current.timer = window.setTimeout(() => {
                      holdRef.current.fired = true;
                      setContactScene(scene);
                    }, 380);
                  },
                  onPointerUp: () => window.clearTimeout(holdRef.current.timer),
                  onPointerLeave: () => window.clearTimeout(holdRef.current.timer),
                  onPointerCancel: () => window.clearTimeout(holdRef.current.timer),
                  onClick: () => {
                    window.clearTimeout(holdRef.current.timer);
                    if (holdRef.current.fired) {
                      holdRef.current.fired = false;
                      return;
                    }
                    setSel(tileIndex);
                    openScene(scene);
                  },
                  onMouseEnter: hoverOn
                    ? () => {
                        if (window.innerWidth >= 900) setHoverScene(scene.id);
                      }
                    : undefined,
                  onMouseLeave: hoverOn ? () => setHoverScene((cur) => (cur === scene.id ? null : cur)) : undefined,
                },
                h("div", { className: "stk-tile-photo" }, h(Thumb, { src: rel(scene.paths && scene.paths.screenshot) })),
                hoverOn &&
                  hoverScene === scene.id &&
                  h(HoverPreview, {
                    key: "hover-" + scene.id,
                    /* the unsigned path: Stash signs stream URLs for its own host,
                       and the signature 404s behind the LAN proxy */
                    src: rel(scene.paths && scene.paths.stream).split("?")[0],
                  }),
                h("span", { className: "stk-tile-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0)),
                scene.rating100 >= 60 && h("span", { className: "stk-tile-heart" }, h(Icon, { name: "heart", size: 12, filled: true }))
              );
            });
            return [
              gridWrap(tiles, ratios),
              favoritesOnly && tiles.length === 0
                ? h("p", { className: "stk-sub stk-fav-none" }, "No favorited scenes for this performer yet.")
                : null,
            ];
          })()
        : tab === "markers"
        ? gridWrap(
            markers.map((marker) =>
              h(
                "button",
                {
                  key: marker.id,
                  className: "stk-tile",
                  onClick: () =>
                    onPlay({ sceneId: marker.scene && marker.scene.id, startAt: marker.seconds, tab: "markers", sort }),
                },
                h("div", { className: "stk-tile-photo" }, h(Thumb, { src: rel(marker.scene && marker.scene.paths && marker.scene.paths.screenshot) })),
                h("span", { className: "stk-tile-dur" }, fmtTime(marker.seconds))
              )
            )
          )
        : gridWrap(
            images.map((image, imageIndex) =>
              h(
                "button",
                Object.assign(
                  { key: image.id, className: "stk-tile", "data-image": image.id },
                  photoTileProps(image, (event) =>
                    setViewer({ image, items: images, index: imageIndex, rect: event.currentTarget.getBoundingClientRect() })
                  )
                ),
                h("div", { className: "stk-tile-photo" }, h(Thumb, { src: rel(image.paths && image.paths.thumbnail) }) )
              )
            )
          ),

      /* how much of the grid you are looking at: the old build silently stopped
         at 60 images, so a performer with 900 looked half empty */
      (media === "images" || tab === "images") &&
        images.length > 0 &&
        h(
          "div",
          { className: "stk-more" },
          imgBusy
            ? "Loading more…"
            : imageTotal != null && images.length < imageTotal
            ? h(
                "button",
                { type: "button", className: "stk-more-btn", onClick: () => loadImages(imgPage + 1, false) },
                "Show more · " + images.length + " of " + imageTotal
              )
            : (imageTotal != null ? imageTotal : images.length) + " images"
        ),

      /* ---- duplicate report ------------------------------------------ */
      dupes &&
        h(
          "div",
          { className: "stk-sheet-backdrop", onClick: () => setDupes(null) },
          h(
            "div",
            { className: "stk-sheet stk-dupe-sheet", onClick: (event) => event.stopPropagation() },
            h("h4", null, "Duplicates"),
            h(
              "p",
              { className: "stk-dupe-note" },
              dupes.busy
                ? "Scanning… " + dupes.scanned + (dupes.total ? " of " + dupes.total : "") + " images"
                : dupes.error
                ? dupes.error
                : dupes.groups.length
                ? dupes.groups.length +
                  " set" +
                  (dupes.groups.length === 1 ? "" : "s") +
                  " across " +
                  dupes.scanned +
                  " images · exact copies only (size + dimensions)"
                : "No exact duplicates in " + dupes.scanned + " images"
            ),
            dupes.groups.map((group, groupIndex) => {
              const file = (group[0].files && group[0].files[0]) || {};
              return h(
                "div",
                { key: "g" + groupIndex, className: "stk-dupe-group" },
                h(
                  "div",
                  { className: "stk-dupe-head" },
                  group.length + " copies",
                  file.size ? " · " + fmtBytes(file.size) : "",
                  file.width ? " · " + file.width + "×" + file.height : ""
                ),
                h(
                  "div",
                  { className: "stk-dupe-row" },
                  group.slice(0, 8).map((row) =>
                    h("button", {
                      key: row.id,
                      className: "stk-dupe-thumb",
                      style: { backgroundImage: `url("${rel(row.paths && (row.paths.thumbnail || row.paths.image))}")` },
                      onClick: () => {
                        setDupes(null);
                        setViewer({ image: row, items: group, index: Math.max(0, group.indexOf(row)), rect: null });
                      },
                    })
                  )
                )
              );
            }),
            h("button", { type: "button", className: "stk-xbtn", style: { marginTop: 12 }, onClick: () => setDupes(null) }, "Close")
          )
        ),

      attrOpen && attrSheet(),

      viewer && h(ImageViewer, { image: viewer.image, items: viewer.items, index: viewer.index, rect: viewer.rect, onClose: () => setViewer(null) }),
      photoAction &&
        h(ImageActions, {
          image: photoAction,
          performer: performer,
          onClose: () => setPhotoAction(null),
          onChanged: (id, patch) => {
          /* "use as profile photo" rewrites the performer, not the image: refresh the
             avatar in place so the page shows the new picture immediately */
          if (patch && patch.performerPhoto) {
            const photo = patch.performerPhoto;
            if (String(photo.id) === String(performerId)) {
              setPerformer((cur) => (cur ? Object.assign({}, cur, { image_path: photo.image_path }) : cur));
            }
            const rest = Object.assign({}, patch);
            delete rest.performerPhoto;
            if (!Object.keys(rest).length) return;
            patch = rest;
          }
          setImages((cur) => cur.map((row) => (String(row.id) === String(id) ? Object.assign({}, row, patch) : row)));
        },
      }),
      contactScene &&
        h(ContactSheet, {
          scene: contactScene,
          duration: Number((contactScene.files && contactScene.files[0] && contactScene.files[0].duration) || 0),
          onClose: () => setContactScene(null),
          onPick: (at) => {
            const scene = contactScene;
            lastOpenedSceneId = String(scene && scene.id);
            setContactScene(null);
            if (scene && onPlay) onPlay({ sceneId: scene.id, startAt: at, tab: "performers", sort });
          },
        })
    );
  }

  /* One page for both faces of creativity:
     /performers — the searchable, sortable grid of creators (a profile at
     /performers/<name>);  /discover — the dashboard of picks and shelves. */
  function PerformersPage({ onPick, onBack, onOpenTag, initialPerformer, prefs, onProfileOpen, view, onSeeAll, favoritesOnly }) {
    const isDiscover = view === "discover";
    /* the floating settings button sits on top of the profile's own buttons */
    const [rows, setRows] = useState(null);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState(() => readSortPref("stashTok.performerListSort", "updated_at"));
    const [sortOpen, setSortOpen] = useState(false);
    const [selected, setSelected] = useState(initialPerformer || null);
    /* 200 cards at once stalls a big desktop viewport: render a slice, grow on scroll */
    const [shown, setShown] = useState(60);
    useEffect(() => {
      setShown(60);
    }, [query, sort]);
    useEffect(() => {
      /* capture: the list scrolls inside a container, and scroll events do not bubble */
      const onScroll = (event) => {
        const el = event.target;
        if (!el || el.nodeType !== 1 || typeof el.scrollHeight !== "number") return;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 900) {
          setShown((n) => Math.min(n + 40, 400));
        }
      };
      document.addEventListener("scroll", onScroll, { passive: true, capture: true });
      return () => document.removeEventListener("scroll", onScroll, { capture: true });
    }, []);

    /* the floating settings button sits on top of the profile's own buttons */
    useEffect(() => {
      if (onProfileOpen) onProfileOpen(!!(selected || initialPerformer));
    }, [selected, initialPerformer, onProfileOpen]);
    useEffect(() => () => onProfileOpen && onProfileOpen(false), [onProfileOpen]);
    const holdTimer = useRef(0);
    const holdFired = useRef(false);

    function cancelHold() {
      window.clearTimeout(holdTimer.current);
    }

    /** long-press a performer tile to favourite them in Stash */
    function startPerformerHold(event, performer) {
      cancelHold();
      holdFired.current = false;
      holdTimer.current = window.setTimeout(async () => {
        holdFired.current = true;
        const next = !performer.favorite;
        setRows((current) =>
          current ? current.map((row) => (row.id === performer.id ? Object.assign({}, row, { favorite: next }) : row)) : current
        );
        try {
          await gql(
            `mutation StashTokFavPerformer($id: ID!, $fav: Boolean!) {
              performerUpdate(input: { id: $id, favorite: $fav }) { id favorite }
            }`,
            { id: performer.id, fav: next }
          );
        } catch (err) {
          setRows((current) =>
            current ? current.map((row) => (row.id === performer.id ? Object.assign({}, row, { favorite: !next }) : row)) : current
          );
        }
      }, 550);
    }

    useEffect(() => {
      setSelected(initialPerformer || null);
    }, [initialPerformer]);

    /* dashboard: the front page of Discover, modelled on stashy's home.
       One document, one round trip: stats, then a row per sort. */
    const [dash, setDash] = useState(null);
    useEffect(() => {
      if (query || !isDiscover) return undefined;
      let alive = true;
      gql(
        /* Never ask for `stats` here: Stash's Stats resolver builds the whole
           struct (sizes, durations, play totals over every scene) regardless of
           the fields selected — 0.8 s on a 158k-scene library, and because it
           shared this document the shelves below waited for it. Four count
           queries answer the same numbers in ~0.02 s each. */
        `query StashTokDash {
           sceneCount: findScenes(filter: { per_page: 1 }) { count }
           performerCount: findPerformers(filter: { per_page: 1 }) { count }
           studioCount: findStudios(filter: { per_page: 1 }) { count }
           galleryCount: findGalleries(filter: { per_page: 1 }) { count }
           scenesNew: findScenes(filter: { per_page: 14, sort: "created_at", direction: DESC }) {
             scenes { id title paths { screenshot } files { duration } } }
           scenesPlayed: findScenes(filter: { per_page: 14, sort: "last_played_at", direction: DESC }) {
             scenes { id title paths { screenshot } files { duration } } }
           scenesViewed: findScenes(filter: { per_page: 14, sort: "play_count", direction: DESC }) {
             scenes { id title paths { screenshot } files { duration } } }
           scenesRandom: findScenes(filter: { per_page: 14, sort: "random" }) {
             scenes { id title paths { screenshot } files { duration } } }
           performersNew: findPerformers(filter: { per_page: 14, sort: "created_at", direction: DESC }) {
             performers { id name image_path scene_count } }
           performersTop: findPerformers(filter: { per_page: 14, sort: "scenes_count", direction: DESC }) {
             performers { id name image_path scene_count } }
           performersRated: findPerformers(filter: { per_page: 14, sort: "rating", direction: DESC }) {
             performers { id name image_path scene_count } }
           galleriesNew: findGalleries(filter: { per_page: 14, sort: "created_at", direction: DESC }) {
             galleries { id title image_count paths { cover } } }
           galleriesUpdated: findGalleries(filter: { per_page: 14, sort: "updated_at", direction: DESC }) {
             galleries { id title image_count paths { cover } } }
         }`
      )
        .then((data) => alive && setDash(data))
        .catch(() => alive && setDash({}));
      return () => {
        alive = false;
      };
    }, [query]);

    /* discover strips: random creators + the tags you use most */
    const [circles, setCircles] = useState(null);
    const [topTags, setTopTags] = useState(null);
    useEffect(() => {
      if (query || !isDiscover) return undefined;
      let alive = true;
      gql(
        `query StashTokDiscoverCircles { findPerformers(filter: { per_page: 24, sort: "random" }) {
           performers { id name image_path scene_count favorite } } }`
      )
        .then((data) => alive && setCircles(data.findPerformers.performers))
        .catch(() => alive && setCircles([]));
      gql(
        `query StashTokDiscoverTags { findTags(filter: { per_page: 14, sort: "scenes_count", direction: DESC }) {
           tags { id name scene_count } } }`
      )
        .then((data) => alive && setTopTags(data.findTags.tags))
        .catch(() => alive && setTopTags([]));
      return () => {
        alive = false;
      };
    }, [query]);

    useEffect(() => {
      if (isDiscover) return undefined;
      let alive = true;
      /* "Favorites first" is an ordering, not a Stash sort: there is no favorite
         sort key, so the server answers by recency and the hearts float up. */
      const serverSort = sort === "favorite" ? "updated_at" : sort;
      const direction = serverSort === "name" ? "ASC" : "DESC";
      /* "All Favorites" opens this same list scoped to hearted performers */
      const favOnlyArg = ", performer_filter: { filter_favorites: true }";
      gql(
        `query StashTokPerformers($q: String, $sort: String, $dir: SortDirectionEnum) {
          findPerformers(filter: { per_page: 200, sort: $sort, direction: $dir, q: $q }${favoritesOnly ? favOnlyArg : ""}) {
            count
            performers { id name image_path scene_count favorite updated_at }
          }
        }`,
        { q: query || null, sort: serverSort, dir: direction }
      )
        .then((data) => {
          if (!alive) return;
          const list = data.findPerformers.performers || [];
          /* stable enough: the server order is kept inside each group */
          setRows(sort === "favorite" ? list.slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)) : list);
        })
        .catch(() => alive && setRows([]));
      return () => {
        alive = false;
      };
    }, [query, sort, favoritesOnly]);

    /* the list and the profile are two pages of this one tab, so the swap between
       them fades like any other page arrival instead of cutting */
    if (selected) {
      return h(
        PageSwap,
        { swapKey: "profile:" + selected.id, tab: false },
        h(PerformerProfile, {
          performerId: selected.id,
          onBack: () => {
            setSelected(null);
            if (onBack) onBack();
          },
          onPlay: (payload) => onPick(selected, payload),
          onOpenTag,
          prefs,
          favoritesOnly: !!favoritesOnly,
        })
      );
    }

    const SORTS = [
      ["favorite", "Favorites first"],
      ["updated_at", "Recently added"],
      ["name", "A–Z"],
      ["scenes_count", "Most scenes"],
      ["rating", "Top rated"],
      ["random", "Random"],
    ];
    const sortLabel = (SORTS.find((entry) => entry[0] === sort) || SORTS[0])[1];

    return h(
      PageSwap,
      { swapKey: "list", tab: false },
      h(
      "div",
      { className: "stk-page", onContextMenu: (event) => event.preventDefault() },
      h("div", { className: "stk-page-head" },
        h("span", { className: "stk-page-title stk-page-title-lg" }, isDiscover ? "Discover" : "Performers")
      ),
      isDiscover &&
        onSeeAll &&
        h(
          "button",
          { className: "stk-btn stk-seeall", onClick: onSeeAll },
          "See all performers",
          h(Icon, { name: "chevron", size: 15 })
        ),
      !isDiscover &&
        h("div", { className: "stk-perf-tools" },
          h("input", {
            type: "search",
            className: "stk-field",
            placeholder: "Search creators",
            value: query,
            onChange: (event) => setQuery(event.currentTarget.value),
          }),
          h("button", {
            type: "button",
            className: "stk-sort-btn",
            "aria-expanded": !!sortOpen,
            onClick: () => setSortOpen(!sortOpen),
          }, sortLabel, h(Icon, { name: "chevronDown", size: 13 }))
        ),
      isDiscover &&
        !query &&
        circles &&
        circles.length > 0 &&
        h(
          React.Fragment,
          null,
          h("h4", { className: "stk-disc-h" }, "Creators we think you'll like"),
          h(
            "div",
            { className: "stk-circles" },
            circles.map((performer) =>
              h(
                "button",
                {
                  key: performer.id,
                  className: "stk-circle",
                  onClick: () => {
                    /* through the app's opener, so the profile knows where to go back to */
                    if (onPick) onPick(performer);
                    else setSelected(performer);
                  },
                },
                h("span", { className: "stk-circle-photo" }, h(Thumb, { src: rel(performer.image_path) })),
                h("span", { className: "stk-circle-name" }, performer.name)
              )
            )
          )
        ),
      isDiscover &&
        !query &&
        topTags &&
        topTags.length > 0 &&
        h(
          React.Fragment,
          null,
          h("h4", { className: "stk-disc-h" }, "Hashtags we think you'll like"),
          h(
            "div",
            { className: "stk-disc-chips" },
            topTags.map((tag) =>
              h(
                "button",
                { key: tag.id, className: "stk-chip", onClick: () => onOpenTag && onOpenTag(tag) },
                "#" + tag.name,
                h("small", null, fmtCount(tag.scene_count))
              )
            )
          )
        ),
      isDiscover &&
        !query &&
        dash &&
        h(
          "div",
          { className: "stk-stats" },
          [["Scenes", dash.sceneCount], ["Performers", dash.performerCount],
           ["Studios", dash.studioCount], ["Galleries", dash.galleryCount]]
            .map(([label, result]) => [label, result && result.count])
            .filter((entry) => entry[1] > 0)
            .map(([label, total]) =>
              h("div", { key: label, className: "stk-stat" }, h("b", null, fmtCount(total)), h("span", null, label))
            )
        ),
      isDiscover &&
        !query &&
        dash &&
        h(
          React.Fragment,
          null,
          h(DashRow, { title: "Scenes - Last played" },
            ((dash.scenesPlayed || {}).scenes || []).map((scene) =>
              h(SceneCard, { key: "p" + scene.id, scene, onOpen: (item) => goTo("scene/" + item.id) }))),
          h(DashRow, { title: "Scenes - Recently added" },
            ((dash.scenesNew || {}).scenes || []).map((scene) =>
              h(SceneCard, { key: "n" + scene.id, scene, onOpen: (item) => goTo("scene/" + item.id) }))),
          h(DashRow, { title: "Scenes - Most viewed" },
            ((dash.scenesViewed || {}).scenes || []).map((scene) =>
              h(SceneCard, { key: "v" + scene.id, scene, onOpen: (item) => goTo("scene/" + item.id) }))),
          h(DashRow, { title: "Scenes - Random" },
            ((dash.scenesRandom || {}).scenes || []).map((scene) =>
              h(SceneCard, { key: "r" + scene.id, scene, onOpen: (item) => goTo("scene/" + item.id) }))),
          h(DashRow, { title: "Performers - New" },
            ((dash.performersNew || {}).performers || []).map((performer) =>
              h(PerformerCard, { key: "pn" + performer.id, performer, onOpen: (item) => {
                if (onPick) onPick(item); else setSelected(item);
              } }))),
          h(DashRow, { title: "Performers - Top" },
            ((dash.performersTop || {}).performers || []).map((performer) =>
              h(PerformerCard, { key: "pt" + performer.id, performer, onOpen: (item) => {
                if (onPick) onPick(item); else setSelected(item);
              } }))),
          h(DashRow, { title: "Performers - Rating" },
            ((dash.performersRated || {}).performers || []).map((performer) =>
              h(PerformerCard, { key: "pr" + performer.id, performer, onOpen: (item) => {
                if (onPick) onPick(item); else setSelected(item);
              } }))),
          h(DashRow, { title: "Galleries - New" },
            ((dash.galleriesNew || {}).galleries || []).map((gallery) =>
              h(GalleryCard, { key: "gn" + gallery.id, gallery, onOpen: (item) => window.open(rel("/gallery/" + item.id), "_blank") }))),
          h(DashRow, { title: "Galleries - Updated" },
            ((dash.galleriesUpdated || {}).galleries || []).map((gallery) =>
              h(GalleryCard, { key: "gu" + gallery.id, gallery, onOpen: (item) => window.open(rel("/gallery/" + item.id), "_blank") })))
        ),
      !isDiscover &&
        rows &&
        h("p", { className: "stk-sub" }, rows.length + " creators"),
      !isDiscover &&
        sortOpen &&
        h(
          "div",
          { className: "stk-sort-menu" },
          SORTS.map(([key, label]) =>
            h(
              "button",
              {
                key,
                className: key === sort ? "stk-sort-on" : "",
                onClick: () => {
                  setSort(key);
                  try {
                    window.localStorage.setItem("stashTok.perfSort", key);
                  } catch (e) {
                    /* ignore */
                  }
                  setSortOpen(false);
                },
              },
              label
            )
          )
        ),
      !isDiscover &&
        (!rows
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : rows.length === 0
        ? h("div", { className: "stk-state" }, h("p", null, "No performers match that."))
        : h(
            "div",
            { className: "stk-grid" },
            rows.slice(0, shown).map((performer) =>
              h(
                "button",
                {
                  key: performer.id,
                  className: "stk-account",
                  onClick: () => {
                    if (holdFired.current) {
                      holdFired.current = false;
                      return;
                    }
                    goTo("performers/" + encodeURIComponent(performer.name));
                    setSelected(performer);
                  },
                  onPointerDown: (event) => startPerformerHold(event, performer),
                  onPointerUp: cancelHold,
                  onPointerLeave: cancelHold,
                  onPointerCancel: cancelHold,
                  onContextMenu: (event) => event.preventDefault(),
                },
                h("div", { className: "stk-account-photo" }, h(Thumb, { src: rel(performer.image_path) })),
                h(
                  "div",
                  { className: "stk-account-body" },
                  h("div", { className: "stk-account-name" }, performer.name),
                  h("div", { className: "stk-account-meta" }, `${fmtCount(performer.scene_count)} scenes`, performer.favorite ? " · ♥" : "")
                )
              )
            )
          ))
    )
    );
  }


  /* ---- folders ----------------------------------------------------- */

  const FOLDER_LIST_SORTS = [
    ["az", "A–Z"],
    ["za", "Z–A"],
    ["modified", "Last modified"],
  ];

  /* ---- folders: libraries first, then a real tree ------------------- */

  let FOLDER_TREE = null;

  function loadFolderTree() {
    if (FOLDER_TREE) return Promise.resolve(FOLDER_TREE);
    return (async () => {
      const libs = await gql(
        `query StashTokStashes { configuration { general { stashes { path } } } }`,
        {}
      )
        .then((data) => (((data.configuration || {}).general || {}).stashes || []).map((row) => row.path).filter(Boolean))
        .catch(() => []);

      let all = [];
      for (let page = 1; page <= 30; page += 1) {
        const data = await gql(
          `query StashTokFolders($page: Int!) {
            findFolders(filter: { per_page: 1000, page: $page }) {
              folders { path updated_at }
            }
          }`,
          { page }
        );
        const batch = (data.findFolders && data.findFolders.folders) || [];
        all = all.concat(batch.map((row) => ({ path: row.path, time: Date.parse(row.updated_at) || 0 })));
        if (batch.length < 1000) break;
      }

      const nodes = {};
      all.forEach((row) => {
        nodes[row.path] = { path: row.path, name: row.path.slice(row.path.lastIndexOf("/") + 1) || row.path, time: row.time, children: [] };
      });
      all.forEach((row) => {
        const cut = row.path.lastIndexOf("/");
        const parent = cut > 0 ? row.path.slice(0, cut) : "";
        if (parent && nodes[parent]) nodes[parent].children.push(row.path);
      });
      Object.keys(nodes).forEach((path) => {
        nodes[path].children.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
      });
      /* cheap "size": how many folders live underneath each one */
      Object.keys(nodes).sort((a, b) => b.length - a.length).forEach((path) => {
        let total = nodes[path].children.length;
        nodes[path].children.forEach((child) => {
          total += nodes[child] ? nodes[child].weight || 0 : 0;
        });
        nodes[path].weight = total;
      });

      /* a stash that lives inside another stash is not a separate library */
      const libraries = (libs.length ? libs : all.filter((path) => {
        const cut = path.lastIndexOf("/");
        return !(cut > 0 && nodes[path.slice(0, cut)]);
      }))
        .filter((path, index, list) => list.indexOf(path) === index)
        .filter((path) => !libs.some((other) => other !== path && path.indexOf(other + "/") === 0))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))
        .map((path) => {
          if (!nodes[path]) {
            nodes[path] = { path, name: path.slice(path.lastIndexOf("/") + 1) || path, time: 0, weight: 0, children: [] };
          }
          return path;
        });

      FOLDER_TREE = { nodes, libraries };
      return FOLDER_TREE;
    })();
  }

  function FoldersPage({ onPick, onBack }) {
    const [tree, setTree] = useState(null);
    const [path, setPath] = useState("");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState("date");
    const [desc, setDesc] = useState(true);

    useEffect(() => {
      let alive = true;
      loadFolderTree()
        .then((data) => {
          if (!alive) return;
          setTree(data);
          if (data.libraries.length === 1) setPath(data.libraries[0]);
        })
        .catch(() => {
          if (alive) setTree({ nodes: {}, libraries: [] });
        });
      return () => {
        alive = false;
      };
    }, []);

    useEffect(() => {
      setQuery("");
    }, [path]);

    const nodes = tree ? tree.nodes : {};
    const libraries = tree ? tree.libraries : [];
    const atRoot = !path;
    const kids = path && nodes[path] ? nodes[path].children : [];
    const term = query.trim().toLowerCase();

    const trail = [];
    if (path) {
      /* no back button on this page: the crumbs are the way up */
      trail.push({ label: "Library", path: "" });
      const lib = libraries
        .filter((entry) => path === entry || path.indexOf(entry + "/") === 0)
        .sort((a, b) => b.length - a.length)[0] || "";
      if (lib) trail.push({ label: nodes[lib] ? nodes[lib].name : lib.slice(lib.lastIndexOf("/") + 1), path: lib });
      let acc = lib;
      path.slice(lib.length).split("/").filter(Boolean).forEach((part) => {
        acc += "/" + part;
        trail.push({ label: part, path: acc });
      });
    }

    const junk = (name) =>
      /^@eaDir/i.test(name) || name[0] === "<" || name.indexOf("\u2044") !== -1 || name[0] === "." || /^_delete$/i.test(name);

    let rows = atRoot
      ? libraries.map((lib) => lib)
      : kids.slice();

    if (term) {
      const base = path || "";
      rows = Object.keys(nodes).filter((candidate) => {
        if (base && candidate.indexOf(base + "/") !== 0) return false;
        const rest = base ? candidate.slice(base.length + 1) : candidate.slice(1);
        if (!rest || rest.indexOf("/") !== -1) return false;
        return nodes[candidate].name.toLowerCase().indexOf(term) !== -1;
      });
    }

    rows = rows
      .map((folderPath) => nodes[folderPath] || { path: folderPath, name: folderPath.slice(folderPath.lastIndexOf("/") + 1), time: 0, weight: 0, children: [] })
      .filter((node) => !junk(node.name))
      .sort((a, b) => {
        let order;
        /* every comparator ascends; `desc` flips the whole list */
        if (sort === "name") order = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
        else if (sort === "size") order = (a.weight || 0) - (b.weight || 0);
        else if (sort === "type") order = (a.children.length ? 0 : 1) - (b.children.length ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
        else order = (a.time || 0) - (b.time || 0);
        return desc ? -order : order;
      });

    const SORTS = [["name", "Name"], ["date", "Date"], ["size", "Size"], ["type", "Type"]];

    const title = atRoot ? "Library" : nodes[path] ? nodes[path].name : "Folders";

    function goUp() {
      if (!path) {
        if (onBack) onBack();
        return;
      }
      if (libraries.length === 1 && libraries[0] === path) {
        setPath("");
        return;
      }
      setPath(path.slice(0, path.lastIndexOf("/")) || "");
    }

    function open(folderPath) {
      const node = nodes[folderPath];
      if (node && node.children.length) setPath(folderPath);
      else onPick({ name: node ? node.name : folderPath, folder: folderPath });
    }

    return h(
      "div",
      { className: "stk-page stk-fb" },
      h("h2", { className: "stk-fb-title" }, title),
      trail.length > 0 &&
        h(
          "div",
          { className: "stk-crumbs" },
          trail.map((crumb, index) =>
            h(
              "button",
              { key: crumb.path, className: "stk-crumb", onClick: () => setPath(crumb.path) },
              crumb.label,
              index < trail.length - 1 && h("span", { className: "stk-crumb-sep" }, "/")
            )
          )
        ),
      h("input", {
        type: "search",
        className: "stk-fb-search",
        placeholder: "Search",
        value: query,
        onChange: (event) => setQuery(event.currentTarget.value),
      }),
      h(
        "div",
        { className: "stk-fb-sorts" },
        SORTS.map(([value, label]) =>
          h(
            "button",
            {
              key: value,
              className: "stk-fb-sort" + (value === sort ? " stk-on" : ""),
              onClick: () => {
                if (value === sort) setDesc((on) => !on);
                else {
                  setSort(value);
                  setDesc(value === "date" || value === "size");
                }
              },
            },
            label,
            value === sort && h("span", { className: "stk-fb-arrow" }, desc ? "↓" : "↑")
          )
        )
      ),
      !tree
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : h(
            React.Fragment,
            null,
            path &&
              h(
                "button",
                { className: "stk-fb-open", onClick: () => onPick({ name: title, folder: path }) },
                h(Icon, { name: "video", size: 15 }),
                "Play clips in this folder"
              ),
            h(
              "div",
              { className: "stk-fb-list" },
              rows.length
                ? rows.map((node) => {
                    const hasKids = node.children.length > 0;
                    return h(
                      "button",
                      {
                        key: node.path,
                        className: "stk-fb-row",
                        onClick: () => open(node.path),
                      },
                      h(
                        "svg",
                        { viewBox: "0 0 24 24", width: 28, height: 28, className: "stk-fb-ico", "aria-hidden": "true" },
                        h("path", {
                          d: ICONS.folder,
                          fill: hasKids ? "#4a9dff" : "#3a7bc4",
                          stroke: hasKids ? "#7cc0ff" : "#5f9ad4",
                          strokeWidth: 1,
                          strokeLinejoin: "round",
                        })
                      ),
                      h(
                        "span",
                        { className: "stk-fb-text" },
                        h("span", { className: "stk-fb-name" }, node.name),
                        h(
                          "span",
                          { className: "stk-fb-sub" },
                          hasKids ? node.children.length + (node.children.length === 1 ? " folder" : " folders") : "clips"
                        )
                      ),
                      h(Icon, { name: "chevron", size: 16, className: "stk-fb-chev" })
                    );
                  })
                : h("div", { className: "stk-state" }, "Nothing here.")
            )
          ),
    );
  }

  /* ---- global search ------------------------------------------------ */

  /* the reel service lives beside Stash; a plain anchor because CSP blocks
     fetches to it, not navigations */
  function reelServiceBase() {
    const asked = new URLSearchParams(window.location.search).get("reel");
    return (asked || "http://" + window.location.hostname + ":19000").replace(/\/$/, "");
  }

  function SearchPage({ onPickScene, onPickPerformer, onPickFolder, onBack }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState({ folders: [], performers: [], markers: [], scenes: [], busy: false, term: "" });

    useEffect(() => {
      const term = query.trim();
      if (term.length < 2) {
        setResults({ folders: [], performers: [], markers: [], scenes: [], busy: false, term: "" });
        return undefined;
      }
      let alive = true;
      setResults((current) => Object.assign({}, current, { busy: true }));
      const timer = window.setTimeout(() => {
        gql(
          `query StashTokSearch($q: String!) {
            findFolders(filter: { q: $q, per_page: 6 }) {
              folders { path }
            }
            findPerformers(filter: { q: $q, per_page: 8, sort: "scenes_count", direction: DESC }) {
              performers { id name image_path scene_count }
            }
            findSceneMarkers(filter: { q: $q, per_page: 12 }) {
              scene_markers { id title seconds scene { id paths { screenshot } performers { name } } }
            }
            findScenes(filter: { q: $q, per_page: 12, sort: "date", direction: DESC }) {
              scenes { id title paths { screenshot } files { path duration } performers { name } }
            }
          }`,
          { q: term }
        )
          .then((data) => {
            if (!alive) return;
            setResults({
              folders: ((data.findFolders && data.findFolders.folders) || []).map((row) => ({
                name: String(row.path).split("/").filter(Boolean).pop() || row.path,
                folder: row.path,
              })),
              performers: (data.findPerformers && data.findPerformers.performers) || [],
              markers: (data.findSceneMarkers && data.findSceneMarkers.scene_markers) || [],
              scenes: (data.findScenes && data.findScenes.scenes) || [],
              busy: false,
              term,
            });
          })
          .catch(() => alive && setResults({ folders: [], performers: [], markers: [], scenes: [], busy: false, term }));
      }, 280);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }, [query]);

    function section(title, rows) {
      if (!rows.length) return null;
      return h(
        "div",
        { className: "stk-search-section" },
        h("h4", null, title),
        rows
      );
    }

    return h(
      "div",
      { className: "stk-page stk-search-page" },
      h(
        "div",
        { className: "stk-search-head" },
        h("button", { className: "stk-search-back", onClick: onBack }, h(Icon, { name: "chevron", size: 18 })),
        h("input", {
          type: "search",
          autoFocus: true,
          placeholder: "Search folders, scenes, performers, markers",
          value: query,
          onChange: (event) => setQuery(event.currentTarget.value),
          className: "stk-search-input",
        }),
        query.trim().length >= 2 &&
          h(
            "a",
            {
              className: "stk-search-reel",
              title: "Highlight reel for this search",
              target: "_blank",
              rel: "noopener",
              href: reelServiceBase() + "/player?q=" + encodeURIComponent(query.trim()) +
                "&port=" + encodeURIComponent(String(window.location.port || "")) +
                "&name=" + encodeURIComponent(query.trim()),
            },
            h(Icon, { name: "play", size: 18 })
          )
      ),
      query.trim().length < 2
        ? h("div", { className: "stk-state" }, h("p", null, "Type at least two characters."))
        : results.busy
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : h(
            "div",
            null,
            section(
              "Folders",
              results.folders.map((row) =>
                h(
                  "button",
                  { key: "folder-" + row.folder, className: "stk-search-row", onClick: () => onPickFolder(row) },
                  h("div", { className: "stk-search-thumb stk-search-thumb-round stk-search-thumb-folder" },
                    h(Icon, { name: "folder", size: 18 })),
                  h(
                    "div",
                    { className: "stk-search-body" },
                    h("div", { className: "stk-account-name" }, row.name),
                    h("div", { className: "stk-account-meta" }, row.folder)
                  )
                )
              )
            ),
            section(
              "Performers",
              results.performers.map((performer) =>
                h(
                  "button",
                  { key: performer.id, className: "stk-search-row", onClick: () => onPickPerformer(performer) },
                  h("div", {
                    className: "stk-search-thumb stk-search-thumb-round",
                    style: { backgroundImage: `url("${rel(performer.image_path)}")` },
                  }),
                  h(
                    "div",
                    { className: "stk-search-body" },
                    h("div", { className: "stk-account-name" }, performer.name),
                    h("div", { className: "stk-account-meta" }, fmtCount(performer.scene_count) + " scenes")
                  )
                )
              )
            ),
            section(
              "Markers",
              results.markers.map((marker) =>
                h(
                  "button",
                  {
                    key: marker.id,
                    className: "stk-search-row",
                    onClick: () => onPickScene(marker.scene && marker.scene.id, marker.seconds, marker.title),
                  },
                  h("div", {
                    className: "stk-search-thumb",
                    style: { backgroundImage: `url("${rel(marker.scene && marker.scene.paths && marker.scene.paths.screenshot)}")` },
                  }),
                  h(
                    "div",
                    { className: "stk-search-body" },
                    h("div", { className: "stk-account-name" }, marker.title || "Marker"),
                    h(
                      "div",
                      { className: "stk-account-meta" },
                      [fmtTime(marker.seconds), (marker.scene && marker.scene.performers || []).map((row) => row.name).join(", ")]
                        .filter(Boolean)
                        .join(" · ")
                    )
                  )
                )
              )
            ),
            section(
              "Scenes",
              results.scenes.map((scene) =>
                h(
                  "button",
                  { key: scene.id, className: "stk-search-row", onClick: () => onPickScene(scene.id, 0, scene.title) },
                  h("div", {
                    className: "stk-search-thumb",
                    style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` },
                  }),
                  h(
                    "div",
                    { className: "stk-search-body" },
                    h("div", { className: "stk-account-name" }, scene.title || ((scene.files[0] || {}).path || "").split("/").pop()),
                    h(
                      "div",
                      { className: "stk-account-meta" },
                      [(scene.performers || []).map((row) => row.name).join(", "), fmtTime((scene.files[0] || {}).duration || 0)]
                        .filter(Boolean)
                        .join(" · ")
                    )
                  )
                )
              )
            ),
            !results.performers.length && !results.markers.length && !results.scenes.length
              ? h("div", { className: "stk-state" }, h("p", null, "Nothing matches “" + results.term + "”."))
              : null
          )
    );
  }

  const FOLDER_SORTS = [
    ["updated_at", "Recently added"],
    ["duration", "Duration"],
    ["filesize", "File size"],
    ["resolution", "Resolution"],
    ["rating", "Favorites first"],
    ["title", "A–Z"],
    ["random", "Random"],
  ];

  function FolderProfile({ name, folder, onBack, onPlay, prefs, view }) {
    const [tab, setTab] = useState("scenes");
    const folderSortKey = "stashTok.folderSort." + folder;
    const [fvSort, setFvSort] = useState(() => {
      const saved = readSortPref(folderSortKey, "date");
      return ["name", "date", "size", "type"].indexOf(saved) >= 0 ? saved : "date";
    });
    const [isFav, setIsFav] = useState(() => loadFolderFavs().indexOf(folder) !== -1);
    const [media, setMedia] = useState("videos");
    const [viewer, setViewer] = useState(null);
    const [photoAction, setPhotoAction] = useState(null);
    const photoTileProps = usePhotoHold(setPhotoAction);
    const [stuck, setStuck] = useState(false);
    const pageRef = useRef(null);
    const [sort, setSort] = useState(() => readSortPref(folderSortKey, "updated_at"));
    const [sortOpen, setSortOpen] = useState(false);
    const [scenes, setScenes] = useState([]);
    const [images, setImages] = useState([]);
    const [markers, setMarkers] = useState([]);
    const [count, setCount] = useState(0);
    const [imageCount, setImageCount] = useState(0);
    const [markerCount, setMarkerCount] = useState(0);
    const [cover, setCover] = useState("");
    const [loading, setLoading] = useState(true);

    const sortArg = sortClause({ sort, direction: sort === "random" ? null : "DESC" });
    const sortLabel = (FOLDER_SORTS.find((entry) => entry[0] === sort) || FOLDER_SORTS[0])[1];
    /* the same folder in Stash, filtered the way this page queries it */
    const stashLink = stashHref({ folder });

    useEffect(() => {
      let alive = true;
      setLoading(true);
      gql(
        `query StashTokFolderScenes($path: String!) {
          findScenes(scene_filter: { path: { value: $path, modifier: INCLUDES } },
                     filter: { per_page: 200, ${sortArg} }) {
            count
            scenes { id title created_at date paths { screenshot } files { path size duration } }
          }
        }`,
        { path: folder }
      )
        .then((data) => {
          if (!alive) return;
          const next = (data.findScenes && data.findScenes.scenes) || [];
          setScenes(next);
          setCount((data.findScenes && data.findScenes.count) || 0);
          if (next[0]) setCover(rel(next[0].paths && next[0].paths.screenshot));
          setLoading(false);
        })
        .catch(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [folder, sortArg]);

    useEffect(() => {
      let alive = true;
      gql(
        `query StashTokFolderMarkers($path: String!) {
          findSceneMarkers(filter: { per_page: 1 },
            scene_marker_filter: { scene_filter: { path: { value: $path, modifier: INCLUDES } } }) { count }
        }`,
        { path: folder }
      )
        .then((data) => alive && setMarkerCount((data.findSceneMarkers && data.findSceneMarkers.count) || 0))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [folder]);

    useEffect(() => {
      if (media !== "images") return undefined;
      let alive = true;
      gql(
        `query StashTokFolderImages($path: String!) {
          findImages(image_filter: { path: { value: $path, modifier: INCLUDES } },
                     filter: { per_page: 60, ${sortArg} }) {
            count
            images { id title rating100 paths { thumbnail image } }
          }
        }`,
        { path: folder }
      )
        .then((data) => {
          if (!alive) return;
          setImages((data.findImages && data.findImages.images) || []);
          setImageCount((data.findImages && data.findImages.count) || 0);
        })
        .catch(() => alive && setImages([]));
      return () => {
        alive = false;
      };
    }, [folder, media, sortArg]);

    useEffect(() => {
      if (tab !== "markers" || media === "images") return undefined;
      let alive = true;
      gql(
        `query StashTokFolderMarkerList($path: String!) {
          findSceneMarkers(filter: { per_page: 60 },
            scene_marker_filter: { scene_filter: { path: { value: $path, modifier: INCLUDES } } }) {
            count
            scene_markers { id title seconds scene { id paths { screenshot } } }
          }
        }`,
        { path: folder }
      )
        .then((data) => {
          if (!alive) return;
          setMarkers((data.findSceneMarkers && data.findSceneMarkers.scene_markers) || []);
          setMarkerCount((data.findSceneMarkers && data.findSceneMarkers.count) || 0);
        })
        .catch(() => alive && setMarkers([]));
      return () => {
        alive = false;
      };
    }, [folder, tab, media]);

    if (prefs && prefs.folderView !== "gallery" && view !== "gallery") {
      const base = String(folder || "").replace(/\/+$/, "");
      const relOf = (scene) => {
        const path = String(((scene.files && scene.files[0]) || {}).path || "");
        return path.indexOf(base + "/") === 0 ? path.slice(base.length + 1) : path.split("/").pop();
      };
      const dirs = new Map();
      const files = [];
      // the profile keeps rows as {scene} wrappers; accept either shape
      const plain = scenes.map((row) => (row && row.scene ? row.scene : row)).filter((row) => row && row.id);
      plain.forEach((scene) => {
        const file = (scene.files && scene.files[0]) || {};
        const rel = relOf(scene);
        const parts = rel.split("/");
        if (parts.length > 1) {
          const key = parts[0];
          const row = dirs.get(key) || { key, count: 0, size: 0, at: "" };
          row.count += 1;
          row.size += Number(file.size) || 0;
          const stamp = scene.created_at || scene.date || "";
          if (stamp > row.at) row.at = stamp;
          dirs.set(key, row);
        } else {
          files.push({
            scene,
            name: rel,
            size: Number(file.size) || 0,
            at: scene.created_at || scene.date || "",
            type: (rel.split(".").pop() || "").toLowerCase(),
          });
        }
      });

      const cmp = (a, b) => String(a).localeCompare(String(b));
      const sortRows = (list, keyOf) => {
        const copy = list.slice();
        if (fvSort === "name") copy.sort((x, y) => cmp(keyOf(x).name, keyOf(y).name));
        else if (fvSort === "type") copy.sort((x, y) => cmp(keyOf(x).type || "", keyOf(y).type || "") || cmp(keyOf(x).name, keyOf(y).name));
        else if (fvSort === "size") copy.sort((x, y) => (keyOf(y).size || 0) - (keyOf(x).size || 0));
        else copy.sort((x, y) => cmp(keyOf(y).at || "", keyOf(x).at || ""));
        return copy;
      };

      const folderRows = sortRows(Array.from(dirs.values()), (row) => ({ name: row.key, size: row.size, at: row.at, type: "" }));
      const fileRows = sortRows(files, (row) => row);
      const fmtSize = (bytes) => {
        const n = Number(bytes) || 0;
        if (!n) return "";
        if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB";
        return (n / (1024 * 1024)).toFixed(1) + " MB";
      };
      const stamp = (value) => String(value || "").slice(0, 10);

      return h(
        "div",
        { className: "stk-page stk-fv", style: { padding: 0 } },
        h(
          "div",
          { className: "stk-fv-head" },
          h(
            "button",
            { className: "stk-fv-back", onClick: onBack, title: "Back" },
            h(Icon, { name: "chevron", size: 18, className: "stk-back-icon" })
          ),
          h("div", { className: "stk-fv-title" }, h("strong", null, name), h("small", null, base))
        ),
        h(
          "div",
          { className: "stk-fv-sorts" },
          [["name", "Name"], ["date", "Date"], ["size", "Size"], ["type", "Type"]].map(([key, label]) =>
            h(
              "button",
              {
                key,
                className: "stk-fv-sort" + (fvSort === key ? " stk-active" : ""),
                onClick: () => {
                  setFvSort(key);
                  writeSortPref(folderSortKey, key);
                },
              },
              label,
              fvSort === key ? "↓" : ""
            )
          )
        ),
        loading
          ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
          : h(
              "div",
              { className: "stk-fv-list" },
              folderRows.map((row) =>
                h(
                  "button",
                  {
                    key: "d-" + row.key,
                    className: "stk-fv-row",
                    onClick: () => {
                      const next = base + "/" + row.key;
                      goTo("folder/" + encodeURIComponent(next));
                    },
                  },
                  h("span", { className: "stk-fv-ico stk-fv-ico-dir" }, h(Icon, { name: "folder", size: 19 })),
                  h(
                    "span",
                    { className: "stk-fv-copy" },
                    h("span", { className: "stk-fv-name" }, row.key),
                    h("span", { className: "stk-fv-meta" }, [stamp(row.at), row.count + " item" + (row.count === 1 ? "" : "s"), fmtSize(row.size)].filter(Boolean).join("  ·  "))
                  ),
                  h(Icon, { name: "chevron", size: 16, className: "stk-fv-caret" })
                )
              ),
              fileRows.map((row) =>
                h(
                  "button",
                  {
                    key: "f-" + row.scene.id,
                    className: "stk-fv-row",
                    onClick: () => onPlay({ sceneId: row.scene.id, tab: "scenes", sort }),
                  },
                  h("span", { className: "stk-fv-ico stk-fv-ico-vid" }, h(Icon, { name: "video", size: 18 })),
                  h(
                    "span",
                    { className: "stk-fv-copy" },
                    h("span", { className: "stk-fv-name" }, row.name),
                    h("span", { className: "stk-fv-meta" }, [stamp(row.at), fmtSize(row.size)].filter(Boolean).join("  ·  "))
                  )
                )
              ),
              !folderRows.length && !fileRows.length && h("div", { className: "stk-state" }, h("p", null, "Nothing in this folder."))
            )
      );
    }

    return h(
      "div",
      {
        className: "stk-page stk-profile",
        style: { padding: 0 },
        ref: pageRef,
        onScroll: (event) => setStuck(event.currentTarget.scrollTop > 128),
      },
      stashLink
        ? h(
            "a",
            {
              className: "stk-stash-link",
              href: stashLink,
              target: "_blank",
              rel: "noopener noreferrer",
              title: "Open this folder in Stash",
            },
            h(Icon, { name: "external", size: 13 }),
            h("span", null, "View on Stash")
          )
        : null,
      stuck &&
        h(
          "div",
          {
            className: "stk-minihead",
            onClick: () => pageRef.current && pageRef.current.scrollTo({ top: 0, behavior: "smooth" }),
          },
          h("div", { className: "stk-mini-avatar", style: cover ? { backgroundImage: `url("${cover}")` } : undefined }, cover ? null : initials(name)),
          h("span", { className: "stk-mini-name" }, name),
          h(
            "button",
            {
              className: "stk-mini-play",
              onClick: (event) => {
                event.stopPropagation();
                onPlay({ sceneId: null });
              },
            },
            h(Icon, { name: "play", size: 12 }),
            " Play"
          )
        ),
      h(
        "div",
        { className: "stk-cover", style: cover ? { backgroundImage: `url("${cover}")` } : undefined },
        /* the same back control the player uses: one circle, one size, one corner */
      h("button", { className: "stk-feed-back stk-back-fixed", onClick: onBack, title: "Back", "aria-label": "Back" }, h(Icon, { name: "back", size: 22 })),
        h(
          "button",
          {
            className: "stk-cover-fav" + (isFav ? " stk-cover-fav-on" : ""),
            title: isFav ? "Remove favorite" : "Add to favorites",
            onClick: () => {
              const current = loadFolderFavs();
              const next = current.indexOf(folder) === -1 ? current.concat([folder]) : current.filter((row) => row !== folder);
              saveFolderFavs(next);
              setIsFav(next.indexOf(folder) !== -1);
            },
          },
          h(Icon, { name: "heart", size: 19, filled: isFav })
        )
      ),
      h(
        "div",
        { className: "stk-profile-head" },
        h(
          "div",
          { className: "stk-avatar stk-avatar-text", style: cover ? { backgroundImage: `url("${cover}")` } : undefined },
          cover ? null : initials(name)
        ),
        h(
          "div",
          { style: { flex: "1 1 auto", minWidth: 0 } },
          h("div", { className: "stk-profile-name" }, name),
          h("div", { className: "stk-account-meta" }, folder)
        ),
        h("button", { className: "stk-follow", onClick: () => onPlay({ sceneId: null }) }, h(Icon, { name: "play", size: 13 }), " Play")
      ),

      h(
        "div",
        { className: "stk-tabwrap" },
        h(
          "div",
          { className: "stk-tabs stk-tabbar" },
          h(
            "button",
            {
              className: tab === "scenes" && media === "videos" ? "stk-active" : "",
              title: "Scenes",
              onClick: () => { setTab("scenes"); setMedia("videos"); },
            },
            h(Icon, { name: "video", size: 21 })
          ),
          h(
            "button",
            {
              className: tab === "images" ? "stk-active" : "",
              title: "Images",
              onClick: () => { setTab("images"); setMedia("images"); },
            },
            h(Icon, { name: "image", size: 21 })
          ),
          h(
            "button",
            {
              className: tab === "markers" && media === "videos" ? "stk-active" : "",
              title: markerCount ? "Markers " + markerCount : "Markers",
              onClick: () => { setTab("markers"); setMedia("videos"); },
            },
            h(Icon, { name: "chapter", size: 21 })
          ),
          h(
            "button",
            {
              className: sortOpen ? "stk-active" : "",
              title: "Sort: " + sortLabel,
              onClick: () => setSortOpen(!sortOpen),
            },
            h(Icon, { name: "sort", size: 20 })
          )
        ),
        sortOpen &&
          sortMenuTree({
            options: FOLDER_SORTS,
            value: sort,
            onPick: (key) => {
              setSort(key);
              writeSortPref(folderSortKey, key);
              setSortOpen(false);
            },
            onClose: () => setSortOpen(false),
          })
      ),

      media === "images" || tab === "images"
        ? h(
            "div",
            { className: "stk-grid-3" },
            images.map((image, imageIndex) =>
              h(
                "button",
                Object.assign(
                  { key: image.id, className: "stk-tile", "data-image": image.id },
                  photoTileProps(image, (event) =>
                    setViewer({ image, items: images, index: imageIndex, rect: event.currentTarget.getBoundingClientRect() })
                  )
                ),
                h("div", { className: "stk-tile-photo" }, h(Thumb, { src: rel(image.paths && image.paths.thumbnail) }) )
              )
            )
          )
        : tab === "markers"
        ? h(
            "div",
            { className: "stk-grid-3" },
            markers.map((marker) =>
              h(
                "button",
                {
                  key: marker.id,
                  className: "stk-tile",
                  onClick: () => onPlay({ sceneId: marker.scene && marker.scene.id, startAt: marker.seconds, tab: "markers", sort }),
                },
                h("div", {
                  className: "stk-tile-photo",
                  style: { backgroundImage: `url("${rel(marker.scene && marker.scene.paths && marker.scene.paths.screenshot)}")` },
                }),
                h("span", { className: "stk-tile-dur" }, fmtTime(marker.seconds || 0))
              )
            )
          )
        : h(
            "div",
            { className: "stk-grid-3" },
            scenes.map((scene) =>
              h(
                "button",
                { key: scene.id, className: "stk-tile", onClick: () => onPlay({ sceneId: scene.id, sort }) },
                h("div", { className: "stk-tile-photo" }, h(Thumb, { src: rel(scene.paths && scene.paths.screenshot) })),
                h("span", { className: "stk-tile-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0))
              )
            )
          ),

      viewer && h(ImageViewer, { image: viewer.image, items: viewer.items, index: viewer.index, rect: viewer.rect, onClose: () => setViewer(null) }),
      photoAction &&
        h(ImageActions, {
          image: photoAction,
          onClose: () => setPhotoAction(null),
          onChanged: (id, patch) =>
            setImages((cur) => cur.map((row) => (String(row.id) === String(id) ? Object.assign({}, row, patch) : row))),
        })
    );
  }

  /* Favorites, as a discovery page: the performers you have favourited, then rows
     of favourite scenes by recent / largest / most viewed. Every row is its own feed --
     the row header, the "View all" card and a tap on a tile all open one, built from
     the same Stash query the row was drawn from, so a swipe keeps walking that row. */
  const FAVORITE_SORTS = [
    ["recent", "Recent", "updated_at", "DESC"],
    ["oldest", "Oldest", "updated_at", "ASC"],
    ["title", "A–Z", "title", "ASC"],
    ["filesize", "Size", "filesize", "DESC"],
    ["duration", "Duration", "duration", "DESC"],
  ];

  const FAVORITE_ROWS = [
    { key: "recent", title: "Recently favorited", sort: "updated_at", direction: "DESC" },
    /* a fresh draw of the same favourites on every visit: the rows below are
       stable sorts, so this is the one that never shows the same order twice */
    { key: "random", title: "Random Favorites", sort: "random", direction: "DESC" },
    { key: "largest", title: "Largest", sort: "filesize", direction: "DESC" },
    /* play_count is Stash's own view counter, so "most viewed" is the library's
       real history rather than a proxy for it */
    { key: "viewed", title: "Most viewed", sort: "play_count", direction: "DESC" },
  ];

  /* first performer on the scene: the byline a favourites tile shows */
  function performerName(scene) {
    const list = (scene && scene.performers) || [];
    return (list[0] && list[0].name) || "";
  }

  /* favourite performers come back "recently updated", which parks the same
     faces in the same slots on every visit. Shuffle per mount so the row feels
     alive; the order is local only, no query or sort changes. */
  function shuffleRows(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  function FavoritesPage({ prefs, onPlay, setPref, onOpenPerformer, onOpenRow = () => {}, onAllPerformers = () => {} }) {
    const [perfRows, setPerfRows] = useState(null);
    const [rows, setRows] = useState({});
    const [error, setError] = useState("");
    const pageRef = useRef(null);

    /* A short page cannot scroll vertically, so a wheel over a row used to do
       nothing at all and the tab read as frozen. When the page itself has no
       room to scroll, the row under the cursor takes the wheel instead: it is
       the only thing on screen with more to show. */
    useEffect(() => {
      const node = pageRef.current;
      if (!node) return;
      const onWheel = (event) => {
        const strip = event.target.closest && event.target.closest(".stk-fav-perfs, .stk-fav-strip");
        if (!strip) return;
        if (node.scrollHeight - node.clientHeight > 2) return;
        const max = strip.scrollWidth - strip.clientWidth;
        if (max <= 1) return;
        const step = event.deltaX || event.deltaY;
        const next = Math.max(0, Math.min(max, strip.scrollLeft + step));
        if (next === strip.scrollLeft) return;
        event.preventDefault();
        strip.scrollLeft = next;
      };
      node.addEventListener("wheel", onWheel, { passive: false });
      return () => node.removeEventListener("wheel", onWheel);
    }, []);

    useEffect(() => {
      let cancelled = false;
      gql(
        /* the heart on a performer is Stash's `favorite` flag, not a rating:
           filtering on rating100 > 80 found 5 of the 16 hearted performers */
        `query StashTokFavPerformers {
          findPerformers(performer_filter: { filter_favorites: true },
                         filter: { per_page: 60, sort: "updated_at", direction: DESC }) {
            performers { id name image_path scene_count }
          }
        }`
      )
        .then((data) => {
          if (!cancelled) setPerfRows(shuffleRows((data.findPerformers && data.findPerformers.performers) || []));
        })
        .catch(() => {
          if (!cancelled) setPerfRows([]);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      let cancelled = false;
      FAVORITE_ROWS.forEach((row) => {
        gql(
          `query StashTokFavoriteRow($sort: String!, $dir: SortDirectionEnum!) {
            findScenes(scene_filter: { rating100: { value: 0, modifier: GREATER_THAN } },
                       filter: { per_page: 20, sort: $sort, direction: $dir }) {
              scenes { id title rating100 paths { screenshot preview } performers { id name } files { duration size } }
            }
          }`,
          { sort: row.sort, dir: row.direction }
        )
          .then((data) => {
            if (cancelled) return;
            setRows((cur) => Object.assign({}, cur, { [row.key]: (data.findScenes && data.findScenes.scenes) || [] }));
          })
          .catch((err) => {
            if (cancelled) return;
            setRows((cur) => Object.assign({}, cur, { [row.key]: [] }));
            setError(String(err.message || err));
          });
      });
      return () => {
        cancelled = true;
      };
    }, []);

    function openRowFeed(row, scene) {
      const list = rows[row.key] || [];
      onPlay(scene || list[0], {
        ids: list.map((item) => String(item.id)),
        sort: row.sort,
        direction: row.direction,
        name: row.title,
      });
    }

    const tile = (scene, row, at) =>
      h(
        "button",
        {
          key: "t" + scene.id,
          className: "stk-fav-tile",
          onClick: () => openRowFeed(row, scene),
        },
        h("div", {
          className: "stk-fav-photo",
          style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` },
        }),
        h("span", { className: "stk-fav-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0)),
        /* the heart was identical on every favourite, so it said nothing; the
           performer name is the one thing that tells two tiles apart */
        performerName(scene) ? h("span", { className: "stk-fav-user" }, performerName(scene)) : null
      );

    return h(
      "div",
      { className: "stk-page stk-fav-page", ref: pageRef },
      h(
        "h2",
        { className: "stk-fav-h1", onClick: () => openRowFeed(FAVORITE_ROWS[0]) },
        h("span", null, "Favorites"),
        h("small", null, "tap for the full feed")
      ),

      /* performers you have favourited: circles that walk into their own page */
      perfRows &&
        perfRows.length > 0 &&
        h(
          "section",
          { className: "stk-fav-section" },
          h("h3", { className: "stk-fav-rowhead" }, h("span", null, "Favorite performers")),
          h(
            "div",
            { className: "stk-fav-perfs" },
            /* ten circles, then a card to the full favourites gallery: a
               horizontal row hides everything past the first screenful, so the
               rest needs a door rather than a scroll */
            perfRows.slice(0, 10).map((performer) =>
              h(
                "button",
                {
                  key: performer.id,
                  className: "stk-fav-perf",
                  onClick: () => onOpenPerformer && onOpenPerformer(performer),
                },
                h("span", {
                  className: "stk-fav-perf-img",
                  style: { backgroundImage: `url("${rel(performer.image_path)}")` },
                }),
                h("span", { className: "stk-fav-perf-name" }, performer.name)
              )
            ),
            perfRows.length > 0
              ? h(
                  "button",
                  { className: "stk-fav-more stk-fav-perf-all", onClick: () => onAllPerformers() },
                  h(Icon, { name: "chevron", size: 18 }),
                  h("span", null, "All Favorites")
                )
              : null
          )
        ),

      FAVORITE_ROWS.map((row) =>
        h(
          "section",
          { key: row.key, className: "stk-fav-section" },
          h(
            "h3",
            { className: "stk-fav-rowhead", onClick: () => onOpenRow(row) },
            h("span", null, row.title),
            h("small", null, "View all")
          ),
          !rows[row.key]
            ? h("div", { className: "stk-fav-strip" }, h("div", { className: "stk-fav-ghost" }))
            : rows[row.key].length === 0
            ? h("p", { className: "stk-sub" }, error || "Nothing here yet.")
            : h(
                "div",
                { className: "stk-fav-strip" },
                rows[row.key].map((scene, at) => tile(scene, row, at)),
                h(
                  "button",
                  { className: "stk-fav-more", onClick: () => onOpenRow(row) },
                  h(Icon, { name: "chevron", size: 20 }),
                  h("span", null, "View all")
                )
              )
        )
      )
    );
  }

    /* ------------------------------------------------------------------ */
  /* favorites: one row opened as a gallery ("View all")                */
  /* ------------------------------------------------------------------ */

  /* "View all" used to drop straight into the feed, which hid the rest of the
     row behind a swipe. It is a gallery now: the row's whole list as a grid and
     one Play Feed button for the old behaviour. Tapping a tile plays that scene
     in the row's own order, so grid and player can never disagree. */
  function FavoritesGallery({ row, onPlay, onBack }) {
    const [scenes, setScenes] = useState(null);
    const [error, setError] = useState("");

    useEffect(() => {
      let cancelled = false;
      setScenes(null);
      setError("");
      gql(
        `query StashTokFavoriteGallery($sort: String!, $dir: SortDirectionEnum!) {
          findScenes(scene_filter: { rating100: { value: 0, modifier: GREATER_THAN } },
                     filter: { per_page: 240, sort: $sort, direction: $dir }) {
            scenes { id title rating100 paths { screenshot preview } performers { id name } files { duration size } }
          }
        }`,
        { sort: row.sort, dir: row.direction }
      )
        .then((data) => {
          if (cancelled) return;
          const list = ((data.findScenes && data.findScenes.scenes) || []).filter(
            (scene) => scene.files && scene.files.length
          );
          setScenes(list);
        })
        .catch((err) => {
          if (cancelled) return;
          setScenes([]);
          setError(String((err && err.message) || err));
        });
      return () => {
        cancelled = true;
      };
    }, [row.key]);

    const list = scenes || [];
    const playFrom = (scene) =>
      onPlay(scene || list[0], {
        ids: list.map((item) => String(item.id)),
        sort: row.sort,
        direction: row.direction,
        name: row.title,
      });

    return h(
      "div",
      { className: "stk-page stk-fav-gallery" },
      h(
        "div",
        { className: "stk-page-head" },
        h("button", { className: "stk-page-back", title: "Back", onClick: onBack }, h(Icon, { name: "back", size: 19 })),
        h("span", { className: "stk-page-title" }, row.title),
        list.length
          ? h(
              "button",
              { className: "stk-fav-playfeed", onClick: () => playFrom(null) },
              h(Icon, { name: "play", size: 13 }),
              h("span", null, "Play Feed")
            )
          : null
      ),
      !scenes
        ? h(
            "div",
            { className: "stk-grid-3" },
            [0, 1, 2, 3, 4, 5].map((n) => h("div", { key: "g" + n, className: "stk-fav-ghost" }))
          )
        : list.length === 0
        ? h("p", { className: "stk-sub" }, error || "Nothing here yet.")
        : h(
            "div",
            { className: "stk-grid-3" },
            list.map((scene) =>
              h(
                "button",
                { key: "g" + scene.id, className: "stk-tile", onClick: () => playFrom(scene) },
                h("div", { className: "stk-tile-photo" }, h(Thumb, { src: rel(scene.paths && scene.paths.screenshot) })),
                h("span", { className: "stk-fav-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0)),
                performerName(scene) ? h("span", { className: "stk-fav-user" }, performerName(scene)) : null
              )
            )
          )
    );
  }

    /* ------------------------------------------------------------------ */
  /* markers page: every marker, grouped under its own tag             */
  /* ------------------------------------------------------------------ */

  /* Stash answers /markers?q=Tag&sortby=title with markers filtered by the
     marker's primary tag. This page does the same but keeps the tag values on
     screen as chips, and sorts what it got by tag then title, so the list reads
     grouped by tag instead of as one long stream. Tapping a marker drops into
     the feed at that marker's in point. */
  /* ---- markers, by name ----------------------------------------------- *
   * One row per marker was a wall of near-identical entries ("Blowjob" forty
   * times, "blowjob" twelve, "Blow Job" nine). What the page is good for is the
   * set: every marker sharing a name, played as one reel. So the page loads
   * titles only — 13k of them is ~300 KB and a third of a second — folds them
   * into name + count, and draws pills. Tapping a pill plays that name's
   * collection; nothing per-marker is listed. */
  const MARKER_PILL_PAGE = 40;

  function MarkersPage({ onBack, onPlayTag, onPlayName }) {
    const [names, setNames] = useState(null);
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(MARKER_PILL_PAGE);

    useEffect(() => {
      let alive = true;
      gql(`query StashTokMarkerNames { findSceneMarkers(filter: { per_page: -1 }) { count scene_markers { title } } }`)
        .then((data) => {
          if (!alive) return;
          const found = (data.findSceneMarkers && data.findSceneMarkers.scene_markers) || [];
          const total = (data.findSceneMarkers && data.findSceneMarkers.count) || found.length;
          const seen = {};
          const list = [];
          let untitled = 0;
          found.forEach((marker) => {
            const name = String(marker.title || "").trim();
            if (!name) {
              untitled += 1;
              return;
            }
            const key = name.toLowerCase();
            if (!seen[key]) {
              seen[key] = { key, name, n: 0 };
              list.push(seen[key]);
            }
            seen[key].n += 1;
          });
          list.sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
          setNames({ list, total, untitled });
        })
        .catch(() => alive && setNames({ list: [], total: 0, untitled: 0 }));
      return () => {
        alive = false;
      };
    }, []);

    const needle = query.trim().toLowerCase();
    const shown = names
      ? names.list.filter((row) => !needle || row.name.toLowerCase().includes(needle))
      : [];

    return h(
      "div",
      { className: "stk-page" },
      h("div", { className: "stk-page-head" },
        onBack && h("button", { className: "stk-page-back", title: "Back", onClick: onBack }, h(Icon, { name: "back", size: 19 })),
        h("span", { className: "stk-page-title stk-page-title-lg" }, "Markers")
      ),
      h("input", {
        type: "search",
        className: "stk-tag-search",
        placeholder: "Search marker names",
        value: query,
        onChange: (event) => {
          setQuery(event.currentTarget.value);
          setLimit(MARKER_PILL_PAGE);
        },
      }),
      names
        ? h(
            "p",
            { className: "stk-sub" },
            names.total.toLocaleString() + " markers \u00b7 " + names.list.length + " names" +
              (names.untitled ? " \u00b7 " + names.untitled.toLocaleString() + " untitled" : "")
          )
        : null,
      h(
        "div",
        { className: "stk-chips stk-marker-pills" },
        h(
          "button",
          { className: "stk-chip stk-chip-primary", onClick: () => onPlayTag && onPlayTag(null) },
          "Play all markers"
        ),
        shown.slice(0, limit).map((row) =>
          h(
            "button",
            {
              key: row.key,
              className: "stk-chip",
              title: "Play every marker named " + row.name,
              onClick: () => onPlayName && onPlayName(row.name),
            },
            row.name,
            h("b", { className: "stk-chip-n" }, String(row.n))
          )
        ),
        shown.length > limit
          ? h(
              "button",
              { className: "stk-chip stk-chip-more", onClick: () => setLimit((cur) => cur + MARKER_PILL_PAGE) },
              "+ " + Math.min(MARKER_PILL_PAGE, shown.length - limit) + " more"
            )
          : shown.length > MARKER_PILL_PAGE
          ? h(
              "button",
              { className: "stk-chip stk-chip-more", onClick: () => setLimit(MARKER_PILL_PAGE) },
              "Show less"
            )
          : null
      ),
      !names
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : !shown.length
        ? h("div", { className: "stk-state" }, query.trim() ? "No marker names match this search" : "No markers yet")
        : null
    );
  }

  /* one tag's own page: a discovery wall for that tag instead of a jump
     straight into the feed. A tag click used to start a feed of whole scenes,
     which is not what a tag means — a scene is the unit you land on, and the
     ordering chips decide what the grid shows. Play turns the order you just
     picked into the feed, and tapping a tile starts it at that scene. */
  /* ---- a tag, as a set of rows ----------------------------------------- *
   * A tag page used to be one flat grid with a sort switch, which says nothing
   * about a tag: the same 48 scenes whatever you asked for. A tag is a slice of
   * the library, so the page reads like discovery — a few dozen scenes per row,
   * each row a different question ("what is newest", "what rates best", "what
   * else does this tag travel with"), each with its own Play pill. Nothing here
   * promises a moment inside the video; these are whole scenes that carry the
   * tag, which is exactly what a tag means. */
  const TAG_CARD_FIELDS = "id title rating100 paths { screenshot } files { duration }";

  function TagRow({ title, hint, scenes, onPlay, onOpen, loading }) {
    if (!loading && (!scenes || !scenes.length)) return null;
    return h(
      "section",
      { className: "stk-row" },
      h(
        "div",
        { className: "stk-row-head" },
        h("span", { className: "stk-row-title" }, title),
        hint ? h("span", { className: "stk-row-hint" }, hint) : null,
        h(
          "button",
          { type: "button", className: "stk-row-play", onClick: onPlay, title: "Play this row as a feed" },
          h(Icon, { name: "play", size: 13 }),
          "Play"
        )
      ),
      loading
        ? h("div", { className: "stk-row-strip" }, [0, 1, 2, 3].map((n) => h("div", { key: n, className: "stk-card stk-card-skel" })))
        : h(
            "div",
            { className: "stk-row-strip" },
            scenes.map((scene) => h(SceneCard, { key: scene.id, scene, onOpen: () => onOpen(scene) }))
          )
    );
  }

  function TagPage({ tagId, name, onBack, onPlay, onPlayPair }) {
    const [tag, setTag] = useState(null);
    const [rows, setRows] = useState(null);
    const [pair, setPair] = useState(null);
    const [pairScenes, setPairScenes] = useState([]);

    useEffect(() => {
      let alive = true;
      setRows(null);
      setPair(null);
      /* the tag id is inlined as a quoted string: a MultiCriterionInput value is
         [String!], not [ID!], so a variable typed ID fails the whole query */
      const id = JSON.stringify(String(tagId).replace(/\D/g, ""));
      const slice = (alias, sort, dir) =>
        `${alias}: findScenes(filter: { per_page: 12, sort: "${sort}", direction: ${dir} },
           scene_filter: { tags: { value: [${id}], modifier: INCLUDES } }) { scenes { ${TAG_CARD_FIELDS} } }`;
      gql(
        `query StashTokTagRows {
          findTag(id: ${id}) { id name scene_count scene_marker_count description }
          ${slice("latest", "date", "DESC")}
          ${slice("shuffle", "random", "DESC")}
          ${slice("rated", "rating", "DESC")}
          ${slice("watched", "play_count", "DESC")}
          ${slice("longest", "duration", "DESC")}
          cooccur: findScenes(filter: { per_page: 150 },
            scene_filter: { tags: { value: [${id}], modifier: INCLUDES } }) { scenes { tags { id name } } }
        }`
      )
        .then((data) => {
          if (!alive) return;
          setTag(data.findTag);
          setRows([
            { id: "latest", title: "Latest", hint: "newest first", sort: "date", scenes: data.latest.scenes },
            { id: "shuffle", title: "Shuffle", hint: "random from the tag", sort: "random", scenes: data.shuffle.scenes },
            { id: "rated", title: "Top rated", hint: "your stars", sort: "rating", scenes: data.rated.scenes },
            { id: "watched", title: "Most watched", hint: "by play count", sort: "play_count", scenes: data.watched.scenes },
            { id: "longest", title: "Longest", hint: "the slow ones", sort: "duration", scenes: data.longest.scenes },
          ]);
          /* what this tag keeps company with: counted across its scenes, and the
             usual wallpaper (All Sex, HD, …) never wins a row */
          const selfId = String(tagId).replace(/\D/g, "");
          const skip = new Set(["all sex", "hardcore", "sex", "hd", "amateur", "porn", "straight"]);
          const seen = {};
          (data.cooccur.scenes || []).forEach((scene) => {
            (scene.tags || []).forEach((t) => {
              const key = String(t.name || "").toLowerCase();
              /* skip by id as well as by the wallpaper list: matching the id
                 against a name never fires, and the tag would pair with itself */
              if (!t.id || String(t.id) === selfId || skip.has(key)) return;
              if (!seen[t.id]) seen[t.id] = { id: String(t.id), name: t.name, n: 0 };
              seen[t.id].n += 1;
            });
          });
          const best = Object.keys(seen).map((k) => seen[k]).sort((x, y) => y.n - x.n)[0];
          if (!best || best.n < 2) return;
          setPair(best);
          /* the pair's own row is not this tag's scenes: it is the scenes that
             carry both, which is a different (and much better) strip */
          const both = JSON.stringify([String(tagId).replace(/\D/g, ""), best.id]);
          gql(
            `query StashTokTagPair {
              findScenes(filter: { per_page: 12, sort: "random" },
                scene_filter: { tags: { value: ${both}, modifier: INCLUDES_ALL } }) {
                scenes { ${TAG_CARD_FIELDS} }
              }
            }`
          )
            .then((data) => alive && setPairScenes((data.findScenes && data.findScenes.scenes) || []))
            .catch(() => undefined);
        })
        .catch(() => alive && setRows([]));
      return () => {
        alive = false;
      };
    }, [tagId]);

    const label = (tag && tag.name) || name || "Tag";
    const latest = rows && rows.length ? rows[0].scenes : null;

    return h(
      "div",
      { className: "stk-page stk-tagpage" },
      h(
        "div",
        { className: "stk-page-head" },
        h("button", { className: "stk-page-back", title: "Back", onClick: onBack }, h(Icon, { name: "back", size: 19 })),
        h("span", { className: "stk-page-title stk-page-title-lg" }, label),
        h(
          "button",
          { type: "button", className: "stk-row-play stk-page-play", onClick: () => onPlay({ id: tagId, name: label }, "random") },
          h(Icon, { name: "play", size: 13 }),
          "Play"
        )
      ),
      h(
        "p",
        { className: "stk-sub" },
        tag
          ? fmtCount(tag.scene_count) + " scenes" +
            (tag.scene_marker_count ? " \u00b7 " + fmtCount(tag.scene_marker_count) + " markers" : "")
          : " "
      ),
      !rows
        ? h("div", null, [0, 1].map((n) => h(TagRow, { key: n, title: "", loading: true })))
        : !latest || !latest.length
        ? h("div", { className: "stk-state" }, "No scenes carry this tag yet")
        : h(
            "div",
            null,
            rows.map((row) =>
              h(TagRow, {
                key: row.id,
                title: row.title,
                hint: row.hint,
                scenes: row.scenes,
                loading: false,
                onPlay: () => onPlay({ id: tagId, name: label }, row.sort),
                onOpen: (scene) => onPlay({ id: tagId, name: label }, row.sort, scene),
              })
            ),
            pair && onPlayPair
              ? h(TagRow, {
                  key: "pair",
                  title: "Often with " + pair.name,
                  hint: "the same scenes, both tags",
                  scenes: pairScenes,
                  loading: false,
                  onPlay: () => onPlayPair([String(tagId), pair.id], label + " + " + pair.name),
                  onOpen: () => onPlayPair([String(tagId), pair.id], label + " + " + pair.name),
                })
              : null
          )
    );
  }

function TagsPage({ onPick, onMarkers, onBack }) {
    const [rows, setRows] = useState(null);
    const [query, setQuery] = useState("");

    useEffect(() => {
      let alive = true;
      gql(
        `query StashTokTags($q: String) {
          findTags(filter: { per_page: 300, sort: "scenes_count", direction: DESC, q: $q }) {
            count
            tags { id name scene_count scene_marker_count }
          }
        }`,
        { q: query || null }
      )
        .then((data) => alive && setRows(data.findTags.tags))
        .catch(() => alive && setRows([]));
      return () => {
        alive = false;
      };
    }, [query]);

    return h(
      "div",
      { className: "stk-page" },
      h("div", { className: "stk-page-head" },
        onBack && h("button", { className: "stk-page-back", title: "Back", onClick: onBack }, h(Icon, { name: "back", size: 19 })),
        h("span", { className: "stk-page-title stk-page-title-lg" }, "Tags")
      ),
      h("input", {
        type: "search",
        placeholder: "Search tags",
        value: query,
        onChange: (event) => setQuery(event.currentTarget.value),
        style: { width: "100%", marginBottom: "12px", padding: "9px 11px", borderRadius: "10px", background: "#171717", border: "1px solid #2a2a2a", color: "#fff" },
      }),
      !rows
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : h(
            "div",
            null,
            rows.map((tag) =>
              h(
                "span",
                { key: tag.id, style: { display: "inline-flex", alignItems: "center", gap: "6px", margin: "0 8px 8px 0" } },
                h(
                  "button",
                  {
                    className: "stk-tagpill",
                    style: { margin: 0 },
                    title: "Every scene with this tag",
                    onClick: () => onPick(tag),
                  },
                  h(Icon, { name: "tag", size: 13 }),
                  tag.name,
                  h("b", null, tag.scene_count)
                ),
                tag.scene_marker_count > 0 &&
                  h(
                    "button",
                    {
                      className: "stk-tagpill",
                      style: { margin: 0 },
                      title: "Markers tagged " + tag.name,
                      onClick: () => onMarkers && onMarkers(tag),
                    },
                    h(Icon, { name: "chapter", size: 13 }),
                    h("b", null, tag.scene_marker_count)
                  )
              )
            )
          )
    );
  }

  /* ------------------------------------------------------------------ */
  /* feed builder                                                       */
  /* ------------------------------------------------------------------ */

  /* [value, direction, label] — the same sort vocabulary the Favorites rows use */
  const FEED_SORT_UI = [
    ["random", "DESC", "Shuffle"],
    ["created_at", "DESC", "Newest"],
    ["rating", "DESC", "Top rated"],
    ["play_count", "DESC", "Most viewed"],
    ["filesize", "DESC", "Size"],
    ["duration", "DESC", "Longest"],
    ["title", "ASC", "A–Z"],
  ];

  const FEED_TYPES = [
    { type: "foryou", label: "For You", hint: "Random scenes from the whole library" },
    { type: "favorites", label: "Favorites", hint: "Every scene you have rated or hearted" },
    { type: "tags", label: "Tags", hint: "One or more tags, any or all" },
    { type: "markers", label: "Markers", hint: "Random scene markers" },
    { type: "fresh", label: "Fresh", hint: "Never played" },
    { type: "shorts", label: "Shorts", hint: "Under five minutes" },
    { type: "portrait", label: "Vertical", hint: "Portrait video only" },
    { type: "saved", label: "Saved filter", hint: "Reuse a filter from Stash" },
  ];

  /* Type-to-search tag field: results come from the library as you type, so any
     tag in the library can be picked (the old picker only listed the top 200 by
     scene count). Escape closes the results before the sheet. */
  function TagPicker({ selected, onToggle }) {
    const [query, setQuery] = useState("");
    const [rows, setRows] = useState([]);
    const [names, setNames] = useState({});
    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState(-1);
    const [busy, setBusy] = useState(false);
    const rootRef = useRef(null);
    const selKey = selected.join(",");

    /* chips for tags that came from an existing feed have no name yet */
    useEffect(() => {
      const missing = selected.filter((id) => !names[id]);
      if (!missing.length) return undefined;
      let alive = true;
      const body = missing
        .map((id, index) => `t${index}: findTag(id: ${JSON.stringify(String(id))}) { id name }`)
        .join(" ");
      gql(`query StashTokTagNames { ${body} }`)
        .then((data) => {
          if (!alive) return;
          const add = {};
          Object.keys(data || {}).forEach((key) => {
            const tag = data[key];
            if (tag) add[tag.id] = tag.name;
          });
          setNames((current) => Object.assign({}, current, add));
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [selKey]);

    useEffect(() => {
      if (!open) return undefined;
      let alive = true;
      setBusy(true);
      const timer = window.setTimeout(() => {
        gql(
          `query StashTokTagPick($q: String!) {
            findTags(filter: { q: $q, per_page: 8, sort: "scenes_count", direction: DESC }) {
              count
              tags { id name scene_count }
            }
          }`,
          { q: query.trim() }
        )
          .then((data) => {
            if (!alive) return;
            const list = (data.findTags && data.findTags.tags) || [];
            const add = {};
            list.forEach((tag) => {
              add[tag.id] = tag.name;
            });
            if (Object.keys(add).length) setNames((current) => Object.assign({}, current, add));
            setRows(list);
            setCursor(list.length ? 0 : -1);
            setBusy(false);
          })
          .catch(() => {
            if (!alive) return;
            setRows([]);
            setCursor(-1);
            setBusy(false);
          });
      }, 180);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }, [query, open]);

    /* the dialog's own Escape listener is a capture handler on document, so the
       first Escape has to be taken one node earlier or it closes the whole sheet */
    useEffect(() => {
      if (!open) return undefined;
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);

    useEffect(() => {
      if (!open) return undefined;
      const onDown = (event) => {
        if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    function pick(tag) {
      if (!tag) return;
      onToggle(tag.id);
      setQuery("");
      setOpen(true);
    }

    function onKeyDown(event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) setOpen(true);
        else setCursor((current) => Math.min(current + 1, rows.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (open && rows.length) pick(rows[cursor >= 0 ? cursor : 0]);
        return;
      }
      if (event.key === "Backspace" && !query && selected.length) {
        onToggle(selected[selected.length - 1]);
        return;
      }
      if (event.key === "Tab") setOpen(false);
    }

    return h(
      "div",
      { className: "stk-tagac", ref: rootRef },
      selected.length > 0 &&
        h(
          "div",
          { className: "stk-tagac-chips" },
          selected.map((id) =>
            h(
              "button",
              { key: id, className: "stk-tagac-chip", onClick: () => onToggle(id), title: "Remove tag" },
              h("span", null, names[id] || "Tag " + id),
              h("b", null, "×")
            )
          )
        ),
      h(
        "div",
        { className: "stk-tagac-field" },
        h(Icon, { name: "search", size: 14 }),
        h("input", {
          type: "text",
          className: "stk-tagac-input",
          placeholder: selected.length ? "Add another tag" : "Type a tag name",
          value: query,
          autoComplete: "off",
          autoCorrect: "off",
          autoCapitalize: "off",
          spellCheck: false,
          onChange: (event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
          },
          onFocus: () => setOpen(true),
          onKeyDown,
        }),
        busy && h("span", { className: "stk-tagac-busy" }, "…")
      ),
      open &&
        h(
          "div",
          { className: "stk-tagac-menu" },
          rows.length === 0
            ? h(
                "div",
                { className: "stk-tagac-empty" },
                busy ? "Searching…" : query.trim() ? `No tags match “${query.trim()}”` : "No tags found"
              )
            : rows.map((tag, index) => {
                const on = selected.indexOf(tag.id) >= 0;
                return h(
                  "button",
                  {
                    key: tag.id,
                    className:
                      "stk-tagac-row" + (index === cursor ? " stk-hot" : "") + (on ? " stk-on" : ""),
                    onMouseEnter: () => setCursor(index),
                    onClick: () => pick(tag),
                  },
                  h("span", null, tag.name),
                  h("b", null, on ? "✓" : tag.scene_count)
                );
              })
        )
    );
  }

  function FeedBuilder({ spec, feeds, onSave, onDelete, onClose, onUse }) {
    const dialogRef = useDialog(true, onClose);
    const [draft, setDraft] = useState(
      spec || { name: "New feed", type: "foryou", tags: [], tagMode: "OR" }
    );
    const [savedFilters, setSavedFilters] = useState([]);

    useEffect(() => {
      gql(`query StashTokSavedFilters { findSavedFilters(mode: SCENES) { id name } }`)
        .then((data) => setSavedFilters(data.findSavedFilters || []))
        .catch(() => setSavedFilters([]));
    }, []);

    const selected = new Set(draft.tags || []);

    function toggleTag(id) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setDraft(Object.assign({}, draft, { tags: Array.from(next) }));
    }

    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-sheet", ref: dialogRef, onClick: (event) => event.stopPropagation() },
        h("h3", null, h("span", null, spec ? "Edit feed" : "New feed"), h("button", { className: "stk-btn", onClick: onClose }, h(Icon, { name: "x", size: 16 }))),

        h("h4", null, "Name"),
        h("input", {
          type: "text",
          value: draft.name,
          onChange: (event) => setDraft(Object.assign({}, draft, { name: event.currentTarget.value })),
          style: { width: "100%", padding: "9px 11px", borderRadius: "10px", background: "#1b1b1b", border: "1px solid #333", color: "#fff" },
        }),

        h("h4", null, "What goes in it"),
        h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          FEED_TYPES.map((entry) =>
            h(
              "button",
              {
                key: entry.type,
                className: "stk-tagpill",
                style: draft.type === entry.type ? { background: "#ff2d55", borderColor: "#ff2d55" } : undefined,
                onClick: () => setDraft(Object.assign({}, draft, { type: entry.type })),
                title: entry.hint,
              },
              entry.label
            )
          )
        ),

        h("h4", null, "How recent"),
        h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          [["0", "Everything"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]].map(([value, label]) =>
            h(
              "button",
              {
                key: value,
                className: "stk-tagpill",
                style: (String(draft.windowDays || "0") === value ? { background: "#ff2d55", borderColor: "#ff2d55" } : undefined),
                onClick: () => setDraft(Object.assign({}, draft, { windowDays: Number(value) })),
              },
              label
            )
          )
        ),

        h("h4", null, "Sort"),
        h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          FEED_SORT_UI.map((entry) =>
            h(
              "button",
              {
                key: entry[0],
                className: "stk-tagpill",
                style: (draft.sort || "random") === entry[0] ? { background: "#ff2d55", borderColor: "#ff2d55" } : undefined,
                onClick: () => setDraft(Object.assign({}, draft, { sort: entry[0], direction: entry[1] })),
              },
              entry[2]
            )
          )
        ),

        h("h4", null, "Performers"),
        h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          [["all", "Anyone"], ["favorites", "My favorites"]].map(([mode, label]) =>
            h(
              "button",
              {
                key: mode,
                className: "stk-tagpill",
                style: ((draft.performerScope || {}).mode || "all") === mode ? { background: "#ff2d55", borderColor: "#ff2d55" } : undefined,
                onClick: () => setDraft(Object.assign({}, draft, { performerScope: { mode, ids: [] } })),
              },
              label
            )
          )
        ),

        h("h4", null, "Exclude paths"),
        h("p", { className: "stk-hint" }, "One path fragment per line — anything containing it is kept out of this feed."),
        h("textarea", {
          value: (draft.excludePaths || []).join("\n"),
          rows: 3,
          placeholder: "/mnt/Vault/trailers",
          onChange: (event) =>
            setDraft(
              Object.assign({}, draft, {
                excludePaths: event.currentTarget.value.split("\n").map((line) => line.trim()).filter(Boolean),
              })
            ),
          style: { width: "100%", padding: "9px 11px", borderRadius: "10px", background: "#1b1b1b", border: "1px solid #333", color: "#fff", fontSize: "12px", resize: "vertical" },
        }),

        /* tags narrow every feed type, not only the "Tags" one, so the field is
           always on screen instead of hiding behind a type choice */
        h("h4", null, "Tags"),
        h("p", { className: "stk-hint" }, "Optional — type a tag name and pick it from the results."),
        h(TagPicker, { selected: Array.from(selected), onToggle: toggleTag }),
        selected.size > 0 &&
          h(
            "div",
            { style: { display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" } },
            h(
              "button",
              {
                className: "stk-btn",
                onClick: () => setDraft(Object.assign({}, draft, { tagMode: draft.tagMode === "AND" ? "OR" : "AND" })),
              },
              draft.tagMode === "AND" ? "All tags (AND)" : "Any tag (OR)"
            ),
            h("span", { style: { fontSize: "11px", color: "rgba(255,255,255,.5)" } }, `${selected.size} selected`)
          ),

        draft.type === "saved" &&
          h(
            React.Fragment,
            null,
            h("h4", null, "Saved filter"),
            savedFilters.length === 0
              ? h("p", { style: { fontSize: "12px", color: "rgba(255,255,255,.5)" } }, "No saved scene filters found.")
              : savedFilters.map((filter) =>
                  h(
                    "button",
                    {
                      key: filter.id,
                      className: "stk-tagpill",
                      style: draft.savedFilterId === filter.id ? { background: "#ff2d55", borderColor: "#ff2d55" } : undefined,
                      onClick: () => setDraft(Object.assign({}, draft, { savedFilterId: filter.id })),
                    },
                    filter.name
                  )
                )
          ),

        h(
          "div",
          { className: "stk-sheet-actions" },
          h("button", { className: "stk-btn stk-primary", onClick: () => onSave(draft) }, "Save feed"),
          onUse && h("button", { className: "stk-btn", onClick: () => onUse(draft) }, "Use now"),
          spec && onDelete && h("button", { className: "stk-btn", onClick: () => onDelete(spec.id) }, "Delete")
        ),

        feeds && feeds.length > 0 &&
          h(
            React.Fragment,
            null,
            h("h4", null, "Your feeds"),
            feeds.map((feed) =>
              h(
                "div",
                { key: feed.id, style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" } },
                h("button", { className: "stk-marker-row", style: { marginBottom: 0 }, onClick: () => onUse && onUse(feed) }, h(Icon, { name: "sparkle", size: 14 }), feed.name, h("span", null, feed.type))
              )
            )
          )
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* settings                                                           */
  /* ------------------------------------------------------------------ */

  function PrefRow({ title, hint, children, stack }) {
    return h(
      "div",
      { className: "stk-pref" + (stack ? " stk-pref-stack" : "") },
      h("div", { className: "stk-pref-copy" }, h("span", null, title), hint && h("small", null, hint)),
      h("div", { className: "stk-pref-control" }, children)
    );
  }

  function PrefToggle({ on, onChange, label }) {
    return h(
      "button",
      {
        className: "stk-switch-row stk-switch-inline" + (on ? " stk-on" : ""),
        role: "switch",
        "aria-checked": !!on,
        "aria-label": label || "Toggle",
        onClick: () => onChange(!on),
      },
      h("span", { className: "stk-switch" }, h("span", { className: "stk-knob" }))
    );
  }

  function PrefPills({ value, options, onChange }) {
    return h(
      "div",
      { className: "stk-pills" },
      options.map(([key, label]) =>
        h(
          "button",
          { key, className: "stk-pill" + (key === value ? " stk-active" : ""), onClick: () => onChange(key) },
          label
        )
      )
    );
  }

  /* --------------------------------------------------------------- operations */
  const OPS_ACTIONS = [
    { id: "scan", label: "Scan library", hint: "Pick up new folders and files", icon: "search" },
    { id: "rescan", label: "Full rescan", hint: "Re-read every file on disk", icon: "sort" },
    { id: "generate", label: "Generate", hint: "Sprites, previews, phashes", icon: "play" },
    { id: "markers", label: "Detect markers", hint: "Marker images and screenshots", icon: "flag" },
    { id: "identify", label: "Identify", hint: "Match scenes against stash-box", icon: "tag" },
    { id: "clean", label: "Clean", hint: "Drop entries whose files are gone", icon: "x" },
  ];

  const OPS_MUTATIONS = {
    scan: "mutation { metadataScan(input: { rescan: false }) }",
    rescan: "mutation { metadataScan(input: { rescan: true }) }",
    generate:
      "mutation { metadataGenerate(input: { sprites: true, previews: true, phashes: true, imagePreviews: true, imageThumbnails: true }) }",
    markers:
      "mutation { metadataGenerate(input: { markers: true, markerImagePreviews: true, markerScreenshots: true }) }",
    identify: "mutation { metadataIdentify(input: {}) }",
    clean: "mutation { metadataClean }",
  };

  function OperationsPanel() {
    const [jobs, setJobs] = useState(null);
    const [boxes, setBoxes] = useState([]);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState("");
    /* bulk tag syncs leave a reversal record behind: this is where they are
       found again, including the ones started on another device or long after
       the panel that started them was closed */
    const [undos, setUndos] = useState([]);

    const load = useCallback(() => {
      gql(`query StashTokJobs { jobQueue { id status description progress startTime endTime error } }`)
        .then((data) => setJobs(data.jobQueue || []))
        .catch(() => setJobs((cur) => cur || []));
    }, []);

    const loadUndos = useCallback(() => {
      const rows = [];
      try {
        const prefix = "stashTok.attrUndo.v1.";
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (!key || key.indexOf(prefix) !== 0) continue;
          const rec = JSON.parse(window.localStorage.getItem(key) || "null");
          if (!rec || !rec.entries || !rec.entries.length) continue;
          let scenes = 0;
          let images = 0;
          rec.entries.forEach((entry) => {
            scenes += (entry.scenes || []).length;
            images += (entry.images || []).length;
          });
          rows.push({
            key,
            performerId: key.slice(prefix.length),
            label: rec.label || "sync",
            at: rec.at || 0,
            scenes,
            images,
            entries: rec.entries,
          });
        }
      } catch (err) {
        /* private mode or a corrupt record: nothing to show, nothing to break */
      }
      rows.sort((a, b) => b.at - a.at);
      setUndos(rows);
    }, []);

    useEffect(() => {
      load();
      loadUndos();
      gql(`query StashTokBoxes { configuration { general { stashBoxes { endpoint api_key } } } }`)
        .then((data) => {
          const general = (data && data.configuration && data.configuration.general) || {};
          setBoxes(general.stashBoxes || []);
        })
        .catch(() => {});
      const tick = window.setInterval(() => {
        load();
        loadUndos();
      }, 2500);
      return () => window.clearInterval(tick);
    }, [load, loadUndos]);

    function reverse(row) {
      const args = {
        mode: "remove",
        performerId: row.performerId,
        entries: JSON.stringify(row.entries),
        chunk: "100",
      };
      gql(
        `mutation StashTokReverseSync($p: ID!, $t: String!, $a: Map, $d: String) {
          runPluginTask(plugin_id: $p, task_name: $t, args_map: $a, description: $d)
        }`,
        { p: "stashTok", t: "TagSync", a: args, d: "StashTok undo: " + row.label }
      )
        .then(() => {
          try {
            window.localStorage.removeItem(row.key);
          } catch (err) {}
          setNote("Reversal queued — it runs on the server like any other task.");
          load();
          loadUndos();
        })
        .catch((err) => setNote(String((err && err.message) || err)));
    }

    function run(id) {
      setBusy(id);
      setNote("");
      gql(OPS_MUTATIONS[id])
        .then(() => {
          setNote("Queued. It runs on the server — this window keeps polling.");
          load();
        })
        .catch((err) => setNote(String((err && err.message) || err)))
        .finally(() => setBusy(""));
    }

    function stop(jobId) {
      gql(`mutation StashTokStopJob($id: ID!) { stopJob(job_id: $id) }`, { id: jobId })
        .then(load)
        .catch((err) => setNote(String((err && err.message) || err)));
    }

    return h(
      "div",
      { className: "stk-page stk-ops" },
      h(
        "div",
        { className: "stk-ops-actions" },
        OPS_ACTIONS.map((action) =>
          h(
            "button",
            {
              key: action.id,
              className: "stk-ops-btn" + (busy === action.id ? " stk-on" : ""),
              onClick: () => run(action.id),
            },
            h(Icon, { name: action.icon, size: 17 }),
            h("span", { className: "stk-ops-label" }, action.label),
            h("span", { className: "stk-ops-hint" }, action.hint)
          )
        )
      ),

      note ? h("p", { className: "stk-ops-note" }, note) : null,

      h("h4", { style: { marginTop: "18px" } }, "Tasks"),
      !jobs || jobs.length === 0
        ? h("p", { className: "stk-sub" }, jobs ? "Nothing running." : "Loading…")
        : h(
            "div",
            { className: "stk-ops-jobs" },
            jobs.map((job) =>
              h(
                "div",
                { key: job.id, className: "stk-ops-job" },
                h(
                  "div",
                  { className: "stk-ops-job-top" },
                  h("span", { className: "stk-ops-job-desc" }, job.description || job.status),
                  h("span", { className: "stk-ops-job-status" }, job.status)
                ),
                h(
                  "div",
                  { className: "stk-ops-bar" },
                  h("div", { className: "stk-ops-bar-fill", style: { width: `${Math.round((job.progress || 0) * 100)}%` } })
                ),
                h(
                  "div",
                  { className: "stk-ops-job-foot" },
                  h("span", null, `${Math.round((job.progress || 0) * 100)}%`),
                  job.error ? h("span", { className: "stk-ops-err" }, job.error) : null,
                  h("button", { className: "stk-btn", onClick: () => stop(job.id) }, "Stop")
                )
              )
            )
          ),

      h("h4", { style: { marginTop: "18px" } }, "Reversible syncs"),
      undos.length === 0
        ? h("p", { className: "stk-sub" }, "No bulk tag sync waiting to be reversed.")
        : h(
            "div",
            { className: "stk-ops-jobs" },
            undos.map((row) =>
              h(
                "div",
                { key: row.key, className: "stk-ops-job" },
                h(
                  "div",
                  { className: "stk-ops-job-top" },
                  h("span", { className: "stk-ops-job-desc" }, row.label),
                  h(
                    "span",
                    { className: "stk-ops-job-status" },
                    row.at ? new Date(row.at).toLocaleDateString() : "—"
                  )
                ),
                h(
                  "div",
                  { className: "stk-ops-job-foot" },
                  h(
                    "span",
                    null,
                    row.scenes + " scene" + (row.scenes === 1 ? "" : "s") +
                      (row.images ? ", " + row.images + " image" + (row.images === 1 ? "" : "s") : "")
                  ),
                  h(
                    "button",
                    { className: "stk-btn stk-btn-danger", onClick: () => reverse(row) },
                    "Reverse"
                  )
                )
              )
            )
          ),

      h("h4", { style: { marginTop: "18px" } }, "StashDB"),
      h(
        "p",
        { className: "stk-sub" },
        boxes.length
          ? "Connected endpoints on this server:"
          : "No stash-box endpoint configured on this server yet."
      ),
      boxes.length
        ? h(
            "div",
            { className: "stk-ops-boxes" },
            boxes.map((box) =>
              h(
                "div",
                { key: box.endpoint, className: "stk-ops-box" },
                h("span", { className: "stk-ops-box-url" }, box.endpoint.replace("https://", "").replace("/graphql", "")),
                h("span", { className: "stk-ops-box-key" }, box.api_key ? "key set" : "no key")
              )
            )
          )
        : null,
      h(
        "ol",
        { className: "stk-ops-steps" },
        h("li", null, "Make a stashdb.org account, then Settings → API Keys → create a key."),
        h("li", null, "In Stash: Settings → Metadata Providers → Add stash-box → endpoint https://stashdb.org/graphql, paste the key."),
        h("li", null, "Come back here and tap Identify to pull titles, performers, tags and markers into matching scenes.")
      )
    );
  }

  /* Stash renders this panel from its own settings page too, where the app's
     context is not mounted: every field has to survive being handed nothing. */
  function PlaybackSettings({ prefs, setPref, onOpenHistory, sfw, expanded }) {
    const [history, setHistory] = useState(() => readLocalList(WATCH_HISTORY_KEY));
    const [upload, setUpload] = useState("");
    const [sending, setSending] = useState(false);

    async function sendReport() {
      setSending(true);
      setUpload("");
      try {
        const url = new URL(prefs.diagnosticsUrl.trim(), window.location.origin);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
          throw new Error("Enter an HTTP or HTTPS endpoint without a username or password.");
        }
        const response = await fetch(url.href, {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: playbackReport(),
        });
        setUpload(response.ok ? "Report sent." : "Server returned HTTP " + response.status + ".");
      } catch (error) {
        setUpload(error instanceof TypeError
          ? "Upload blocked or the server is unreachable. Download the report to share it manually."
          : error.message);
      } finally {
        setSending(false);
      }
    }

    return h(React.Fragment, null,
      h("details", { className: "stk-settings-details", open: !!expanded },
        h("summary", null, "Watch history", h("span", null, history.length + " / 100")),
        history.length ? h(React.Fragment, null,
          h("ol", { className: "stk-watch-history" }, history.map((row) =>
            h("li", { key: row.id },
              h("button", { type: "button", className: "stk-marker-row", onClick: () => onOpenHistory(row) },
                h(Icon, { name: "play", size: 14 }),
                sfw ? "Scene " + row.id : row.title,
                h("span", null, fmtTime(row.time))
              )
            )
          )),
          h("button", { className: "stk-btn", type: "button", onClick: () => {
            writeLocalList(WATCH_HISTORY_KEY, []);
            setHistory([]);
          } }, "Clear history")
        ) : h("p", { className: "stk-sub" }, "Played videos will appear here.")
      ),
      h("details", { className: "stk-settings-details", open: !!expanded },
        h("summary", null, "Playback diagnostics"),
        h(PrefRow, { title: "Record playback events", hint: "Frame counts, timing and media errors are kept on this device. Reports omit scene titles, IDs and media URLs." },
          h(PrefToggle, { label: "Record playback events", on: prefs.playbackDiagnostics !== false,
            onChange: (value) => setPref("playbackDiagnostics", value) })
        ),
        h("label", { className: "stk-diagnostics-endpoint" }, "Report endpoint",
          h("input", { type: "text", inputMode: "url", placeholder: "https://your-server.example/reports",
            value: prefs.diagnosticsUrl || "", onChange: (event) => setPref("diagnosticsUrl", event.target.value) })
        ),
        h("div", { className: "stk-diagnostics-actions" },
          h("button", { className: "stk-btn", type: "button", onClick: downloadPlaybackReport }, "Download JSON"),
          h("button", { className: "stk-btn", type: "button", disabled: sending || !prefs.diagnosticsUrl?.trim(),
            onClick: sendReport }, sending ? "Sending…" : "Send report"),
          h("button", { className: "stk-btn", type: "button", onClick: () => {
            writeLocalList(PLAYBACK_LOG_KEY, []);
            setUpload("Local log cleared.");
          } }, "Clear log")
        ),
        upload && h("p", { className: "stk-sub", role: "status" }, upload)
      )
    );
  }

  /* Settings, TikTok shape: a short grouped index — one line per subject — where
     each line is a route (`#/settings/<section>`), not local state, so the
     browser's back gesture, a deep link and the in-app chevron all agree. */

  const SETTINGS_GROUPS = [
    { id: "Preferences", rank: 1, rows: ["feeds", "performer", "genders", "blur", "lock"] },
    { id: "App Settings", rank: 2, rows: ["server", "appearance", "navigation", "operations", "about"] },
  ];

  /* titles double as the shell's page header, so keep them here */
  const SETTINGS_SECTION_TITLES = {
    feeds: "Your Feeds",
    "feeds/performers": "Performers",
    "feeds/new-feed": "Create Feed",
    "feeds/new-feed/performers": "Performers",
    performer: "Performer Page",
    genders: "Show performers",
    appearance: "Appearance",
    navigation: "Navigation",
    server: "This Server",
    about: "About",
  };

  const WINDOW_OPTIONS = [
    { value: "all", label: "All" },
    { value: "7", label: "Added this week" },
    { value: "30", label: "Added within 30 Days" },
    { value: "90", label: "Added within 90 Days" },
  ];
  const FAV_SORT_OPTIONS = [
    { value: "updated_at", label: "Recent" },
    { value: "random", label: "Random" },
    { value: "filesize", label: "Size" },
    { value: "duration", label: "Duration" },
    { value: "resolution", label: "Resolution" },
    { value: "title", label: "Alphabetical" },
  ];
  const PERFORMER_SCOPE_OPTIONS = [
    { value: "all", label: "All" },
    { value: "favorites", label: "Favorites" },
    { value: "filter", label: "Filter" },
  ];
  const PERF_SORTS = [
    { value: "name", direction: "ASC", label: "Alphabetical" },
    { value: "updated_at", direction: "DESC", label: "Recently updated" },
    { value: "created_at", direction: "DESC", label: "Recently added" },
  ];
  const performerScopeLabel = (scope) => {
    const live = scope || DEFAULT_PERFORMER_SCOPE;
    if (live.mode === "favorites") return "Favorites";
    const ids = live.ids || [];
    if (live.mode === "filter" && ids.length) return ids.length + " performer" + (ids.length === 1 ? "" : "s");
    return "All";
  };

  const ALGO_OPTIONS = [
    { value: "performers", label: "Performers" },
    { value: "favorites", label: "Favorites" },
    { value: "recent", label: "Recently Added" },
  ];

  const labelOf = (options, value, fallback) => {
    const hit = options.find((option) => option.value === String(value));
    return hit ? hit.label : fallback;
  };
  const tagCountLabel = (list) => {
    const n = (list || []).length;
    return n ? n + " tag" + (n === 1 ? "" : "s") : "All Tags";
  };
  const algoKeys = (algo) => ALGO_OPTIONS.filter((option) => algo && algo[option.value]).map((option) => option.value);
  const algoLabel = (algo) => {
    const on = algoKeys(algo);
    return on.length ? on.map((key) => labelOf(ALGO_OPTIONS, key, key)).join(", ") : "No Preferences";
  };
  const nextAlgo = (current, pick) => {
    if (pick === "none") return {};
    const next = Object.assign({}, current || {});
    if (next[pick]) delete next[pick];
    else next[pick] = true;
    return next;
  };

  function SettingsRow({ icon, title, onClick }) {
    return h(
      "button",
      { type: "button", className: "stk-set-row", onClick },
      h("span", { className: "stk-set-icon" }, h(Icon, { name: icon || "info", size: 19 })),
      h("span", { className: "stk-set-copy" }, h("span", null, title)),
      h("span", { className: "stk-set-chev" }, h(Icon, { name: "chevron", size: 15 }))
    );
  }

  function SettingsToggleRow({ icon, title, on, onChange }) {
    return h(
      "div",
      { className: "stk-set-row stk-set-toggle" },
      h("span", { className: "stk-set-icon" }, h(Icon, { name: icon || "info", size: 19 })),
      h("span", { className: "stk-set-copy" }, h("span", null, title)),
      h(PrefToggle, { label: title, on: !!on, onChange })
    );
  }

  /* label on the left, the current value on the right, chevron last: the row a
     tap opens a picker from. TikTok's own settings rows are exactly this. */
  function SettingsChoiceRow({ icon, title, value, onClick, last }) {
    return h(
      "button",
      { type: "button", className: "stk-set-row stk-set-choice" + (last ? " stk-set-last" : ""), onClick },
      icon ? h("span", { className: "stk-set-icon" }, h(Icon, { name: icon, size: 19 })) : null,
      h("span", { className: "stk-set-copy" }, h("span", null, title)),
      h("span", { className: "stk-set-value" }, value || ""),
      h("span", { className: "stk-set-chev" }, h(Icon, { name: "chevron", size: 15 }))
    );
  }

  /* The picker is a centred sheet, not a bottom drawer, and its backdrop only
     darkens — a blur over the library was noise on a page that has no video. */
  function SettingsPicker({ title, options, value, multi, onPick, onClose }) {
    const ref = useDialog(true, onClose);
    return h(
      Portal,
      null,
      h("div", { className: "stk-pick-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-pick", ref },
        h("h3", { className: "stk-pick-title" }, title),
        h(
          "div",
          { className: "stk-pick-list" },
          options.map((option) => {
            const on = option.selected !== undefined ? option.selected : option.value === value;
            return h(
              "button",
              {
                key: option.value,
                type: "button",
                className: "stk-pick-row" + (on ? " stk-on" : ""),
                "aria-pressed": !!on,
                onClick: () => {
                  if (option.disabled) return;
                  onPick(option.value);
                  if (!multi) onClose();
                },
              },
              h("span", null, option.label),
              on ? h(Icon, { name: "check", size: 16 }) : null
            );
          })
        ),
        h("button", { type: "button", className: "stk-pick-done", onClick: onClose }, "Done")
      )
    );
  }

  function TagSheet({ title, selected, onToggle, onClose, hint, mode, onMode }) {
    const ref = useDialog(true, onClose);
    return h(
      Portal,
      null,
      h("div", { className: "stk-pick-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-pick stk-pick-tags", ref },
        h("h3", { className: "stk-pick-title" }, title),
        h("p", { className: "stk-pick-hint" }, hint || "Leave every tag off to mean All Tags."),
        /* only meaningful with two or more picks, and the same switch the scene tag
           list has: INCLUDES_ALL is Stash's spelling of "all of these" */
        onMode && h(
          "div",
          { className: "stk-pick-mode" },
          [["OR", "Any of these"], ["AND", "All of these"]].map((pair) =>
            h(
              "button",
              {
                key: pair[0],
                type: "button",
                className: "stk-tagpill" + (mode === pair[0] ? " stk-on" : ""),
                /* on press, not on click: the autocomplete's outside-press handler
                   closes its menu and re-renders the sheet, which replaces this node
                   between mousedown and mouseup — the click never lands, so the
                   first tap on a mode pill did nothing */
                onMouseDown: (event) => {
                  event.preventDefault();
                  onMode(pair[0]);
                },
                onTouchStart: (event) => {
                  event.preventDefault();
                  onMode(pair[0]);
                },
              },
              pair[1]
            )
          )
        ),
        h(TagPicker, { selected, onToggle }),
        h("button", { type: "button", className: "stk-pick-done", onClick: onClose },
          selected.length ? `Done — ${selected.length} tag${selected.length === 1 ? "" : "s"}` : "Done — all tags")
      )
    );
  }

  /* A full page, not a sheet: with a search field and a sortable list of every
     performer, a modal is the wrong container on a phone. */
  function PerformerFilterPage({ scope, onChange, onDone }) {
    const [live, setLive] = useState(scope || DEFAULT_PERFORMER_SCOPE);
    const [q, setQ] = useState("");
    const [sort, setSort] = useState("name");
    const [rows, setRows] = useState(null);
    const [error, setError] = useState("");
    const ids = live.ids || [];

    useEffect(() => {
      let alive = true;
      const entry = PERF_SORTS.find((item) => item.value === sort) || PERF_SORTS[0];
      setRows(null);
      const timer = window.setTimeout(() => {
        gql(
          `query StashTokPerformerPick($q: String!) {
            findPerformers(filter: { q: $q, per_page: 80, sort: "${entry.value}", direction: ${entry.direction} }) {
              count
              performers { id name image_path scene_count }
            }
          }`,
          { q: q.trim() }
        )
          .then((data) => {
            if (!alive) return;
            setRows((data.findPerformers && data.findPerformers.performers) || []);
            setError("");
          })
          .catch((err) => {
            if (!alive) return;
            setRows([]);
            setError(String((err && err.message) || err));
          });
      }, 200);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }, [q, sort]);

    function toggle(id) {
      const next = ids.indexOf(id) >= 0 ? ids.filter((tag) => tag !== id) : ids.concat([id]);
      const value = Object.assign({}, live, { mode: "filter", ids: next });
      setLive(value);
      onChange(value);
    }

    function chooseScope(mode) {
      const value = Object.assign({}, live, { mode });
      setLive(value);
      onChange(value);
    }

    return h(
      "div",
      { className: "stk-perf-filter" },
      h("div", { className: "stk-perf-scope" },
        PERFORMER_SCOPE_OPTIONS.map((option) =>
          h("button", {
            key: option.value,
            type: "button",
            className: "stk-pill" + ((live.mode || "all") === option.value ? " stk-active" : ""),
            onClick: () => chooseScope(option.value),
          }, option.label)
        )
      ),
      h("div", { className: "stk-perf-search" },
        h(Icon, { name: "search", size: 15 }),
        h("input", {
          type: "text",
          value: q,
          placeholder: "Search performers",
          autoComplete: "off",
          onChange: (event) => setQ(event.currentTarget.value),
        })
      ),
      h("div", { className: "stk-perf-sorts" },
        PERF_SORTS.map((entry) =>
          h("button", {
            key: entry.value,
            type: "button",
            className: "stk-pill" + (sort === entry.value ? " stk-active" : ""),
            onClick: () => setSort(entry.value),
          }, entry.label)
        )
      ),
      error ? h("p", { className: "stk-sub" }, error) : null,
      !rows
        ? h("p", { className: "stk-sub" }, "Loading…")
        : rows.length === 0
          ? h("p", { className: "stk-sub" }, q.trim() ? `No performers match “${q.trim()}”` : "No performers found")
          : h("div", { className: "stk-perf-list" },
              rows.map((performer) => {
                const on = ids.indexOf(performer.id) >= 0;
                return h("button", {
                  key: performer.id,
                  type: "button",
                  className: "stk-perf-row" + (on ? " stk-on" : ""),
                  "aria-pressed": on,
                  onClick: () => toggle(performer.id),
                },
                  h("span", { className: "stk-perf-avatar", style: performer.image_path ? { backgroundImage: `url("${rel(performer.image_path)}")` } : undefined },
                    performer.image_path ? null : initials(performer.name)),
                  h("span", { className: "stk-perf-name" }, performer.name),
                  h("span", { className: "stk-perf-count" }, performer.scene_count ? performer.scene_count + " scenes" : ""),
                  h("span", { className: "stk-perf-check" + (on ? " stk-on" : "") },
                    on ? h(Icon, { name: "check", size: 14 }) : null)
                );
              })
            ),
      h("div", { className: "stk-perf-foot" },
        h("span", null, live.mode === "filter" && ids.length ? ids.length + " selected" : live.mode === "favorites" ? "Favourited performers" : "Every performer"),
        h("button", { type: "button", className: "stk-pick-done", onClick: onDone }, "Done")
      )
    );
  }

  /* A custom feed and the For You algorithm are the same question: what does
     this feed draw from. The editor reuses the same rows as Settings. */
  function FeedEditorPage({ initial, onSave, onDelete, onDone, onDraft, onOpenPerformers }) {
    const [draft, setDraft] = useState(() =>
      Object.assign({
        name: "", type: "foryou", sort: "random", tags: [], tagMode: "OR", algo: {},
        performerScope: DEFAULT_PERFORMER_SCOPE,
        performerTags: { tags: [], mode: "OR" }, performerEthnicity: "",
      }, initial || {})
    );
    /* the draft has to survive a trip to the performer picker page */
    useEffect(() => {
      if (onDraft) onDraft(draft);
    }, [draft]);
    const [picker, setPicker] = useState("");
    const [tagOpen, setTagOpen] = useState(false);
    const [ptagOpen, setPtagOpen] = useState(false);
    const [savedFilters, setSavedFilters] = useState([]);
    const tags = draft.tags || [];
    const tagLabel = tags.length
      ? tagCountLabel(tags) + ((draft.tagMode || "OR") === "AND" ? " (all)" : "")
      : tagCountLabel(tags);
    const ptagSel = draft.performerTags || { tags: [], mode: "OR" };
    const ptagLabel = (ptagSel.tags || []).length
      ? ptagSel.tags.length + " tag" + (ptagSel.tags.length === 1 ? "" : "s") + (ptagSel.mode === "AND" ? " (all)" : "")
      : "Any Performer Tag";
    /* Stash's own scene filters are the import path for a library someone has
       already curated: pick one and the feed runs that filter */
    useEffect(() => {
      gql(`query StashTokSavedFilters { findSavedFilters(mode: SCENES) { id name } }`)
        .then((data) => setSavedFilters(data.findSavedFilters || []))
        .catch(() => setSavedFilters([]));
    }, []);
    const windowValue = draft.windowDays === undefined ? "all" : String(draft.windowDays);
    /* the draft is mirrored into a ref so it survives the performer page; a new
       feed therefore comes back with a draft too — only an id means "editing" */
    const editing = !!(initial && initial.id);
    const sortEntry = FEED_SORT_UI.find((entry) => entry[0] === (draft.sort || "random")) || FEED_SORT_UI[0];

    function toggleTag(id) {
      setDraft((cur) => {
        const list = cur.tags || [];
        return Object.assign({}, cur, {
          tags: list.indexOf(id) >= 0 ? list.filter((tag) => tag !== id) : list.concat([id]),
        });
      });
    }

    return h(
      "div",
      { className: "stk-feed-edit" },
      h("label", { className: "stk-feed-edit-name" }, "Feed name",
        h("input", {
          type: "text",
          value: draft.name,
          placeholder: "e.g. Late night",
          maxLength: 40,
          onChange: (event) => setDraft(Object.assign({}, draft, { name: event.currentTarget.value })),
        })
      ),
      h("section", { className: "stk-set-block" },
        h("h4", { className: "stk-set-block-head" }, "What goes in it"),
        h("p", { className: "stk-set-block-sub" }, "A feed is a saved filter: pick the source, then narrow it below."),
        h(
          "div",
          { className: "stk-feed-types" },
          FEED_TYPES.map((entry) =>
            h(
              "button",
              {
                key: entry.type,
                type: "button",
                className: "stk-tagpill",
                style: (draft.type || "foryou") === entry.type ? { background: "#ff2d55", borderColor: "#ff2d55" } : undefined,
                onClick: () => setDraft(Object.assign({}, draft, { type: entry.type })),
                title: entry.hint,
              },
              entry.label
            )
          )
        ),
        (draft.type || "foryou") === "saved" &&
          h(SettingsChoiceRow, {
            title: "Saved filter",
            value: (savedFilters.filter((row) => row.id === draft.savedFilterId)[0] || {}).name || "Pick a filter",
            onClick: () => setPicker("saved"),
          })
      ),

      h("section", { className: "stk-set-block" },
        h("h4", { className: "stk-set-block-head" }, "Algorithm"),
        h("p", { className: "stk-set-block-sub" }, "What this feed draws from. Same weighting the For You feed uses."),
        h(SettingsChoiceRow, {
          title: "Algorithm Preferences", value: algoLabel(draft.algo),
          onClick: () => setPicker("algo"),
        }),
        h(SettingsChoiceRow, {
          title: "Content Time Range", value: labelOf(WINDOW_OPTIONS, windowValue, "All"),
          onClick: () => setPicker("window"),
        }),
        h(SettingsChoiceRow, {
          title: "Filter by Tag", value: tagLabel,
          onClick: () => setPicker("tags"),
        }),
        h(SettingsChoiceRow, {
          title: "Performer Tags", value: ptagLabel,
          onClick: () => setPicker("ptags"),
        }),
        h(SettingsChoiceRow, {
          title: "Performer Ethnicity", value: draft.performerEthnicity || "Any",
          onClick: () => setPicker("peth"),
        }),
        h(SettingsChoiceRow, {
          title: "Performers", value: performerScopeLabel(draft.performerScope),
          onClick: () => setPicker("performers"), last: true,
        })
      ),
      h("section", { className: "stk-set-block" },
        h("h4", { className: "stk-set-block-head" }, "Order"),
        h("p", { className: "stk-set-block-sub" }, "How the clips are picked and ranked."),
        h(SettingsChoiceRow, { title: "Sort", value: sortEntry[2], onClick: () => setPicker("sort"), last: true })
      ),

      h("section", { className: "stk-set-block" },
        h("h4", { className: "stk-set-block-head" }, "Exclusions"),
        h("p", { className: "stk-set-block-sub" }, "One path fragment per line. Anything containing it stays out of this feed."),
        h("textarea", {
          value: (draft.excludePaths || []).join("\n"),
          rows: 3,
          placeholder: "/mnt/Vault/trailers",
          onChange: (event) =>
            setDraft(Object.assign({}, draft, {
              excludePaths: event.currentTarget.value.split("\n").map((line) => line.trim()).filter(Boolean),
            })),
        })
      ),

      h("div", { className: "stk-feed-edit-actions" },
        h("button", {
          type: "button",
          className: "stk-btn stk-primary",
          onClick: () => onSave(Object.assign({}, draft, { name: draft.name.trim() || "New feed" })),
        }, editing ? "Save feed" : "Create feed"),
        editing
          ? h("button", { type: "button", className: "stk-btn stk-btn-danger", onClick: () => onDelete(initial.id) }, "Delete")
          : null,
        h("button", { type: "button", className: "stk-btn", onClick: onDone }, "Cancel")
      ),

      picker === "algo" && h(SettingsPicker, {
        title: "Algorithm Preferences", multi: true,
        options: [{ value: "none", label: "No Preferences", selected: !algoKeys(draft.algo).length }].concat(
          ALGO_OPTIONS.map((option) => ({ value: option.value, label: option.label, selected: !!draft.algo[option.value] }))
        ),
        onPick: (value) => setDraft(Object.assign({}, draft, { algo: nextAlgo(draft.algo, value) })),
        onClose: () => setPicker(""),
      }),
      picker === "saved" && h(SettingsPicker, {
        title: "Saved filter",
        value: draft.savedFilterId || "",
        options: savedFilters.length
          ? savedFilters.map((row) => ({ value: row.id, label: row.name }))
          : [{ value: "", label: "No saved scene filters found" }],
        onPick: (value) => setDraft(Object.assign({}, draft, { savedFilterId: value })),
        onClose: () => setPicker(""),
      }),
      picker === "sort" && h(SettingsPicker, {
        title: "Sort", value: sortEntry[0],
        options: FEED_SORT_UI.map((entry) => ({ value: entry[0], label: entry[2] })),
        onPick: (value) => {
          const picked = FEED_SORT_UI.find((entry) => entry[0] === value) || FEED_SORT_UI[0];
          setDraft(Object.assign({}, draft, { sort: picked[0], direction: picked[1] }));
        },
        onClose: () => setPicker(""),
      }),
      picker === "window" && h(SettingsPicker, {
        title: "Content Time Range", value: windowValue, options: WINDOW_OPTIONS,
        onPick: (value) => setDraft(Object.assign({}, draft, { windowDays: value === "all" ? 0 : Number(value) })),
        onClose: () => setPicker(""),
      }),
      picker === "performers" && h(SettingsPicker, {
        title: "Performers", value: (draft.performerScope || DEFAULT_PERFORMER_SCOPE).mode,
        options: PERFORMER_SCOPE_OPTIONS,
        onPick: (value) => {
          if (value === "filter") {
            const next = Object.assign({}, draft, { performerScope: Object.assign({}, draft.performerScope || {}, { mode: "filter" }) });
            if (onDraft) onDraft(next);
            if (onOpenPerformers) onOpenPerformers();
            else setDraft(next);
            return;
          }
          setDraft(Object.assign({}, draft, { performerScope: { mode: value, ids: [] } }));
        },
        onClose: () => setPicker(""),
      }),
      picker === "tags" && h(SettingsPicker, {
        title: "Filter by Tag", value: tags.length ? "select" : "all",
        options: [{ value: "all", label: "All Tags" }, { value: "select", label: "Select Tags" }],
        onPick: (value) => {
          if (value === "all") setDraft(Object.assign({}, draft, { tags: [] }));
          else setTagOpen(true);
        },
        onClose: () => setPicker(""),
      }),
      tagOpen && h(TagSheet, {
        title: "Select Tags", selected: tags, onToggle: toggleTag,
        /* the same switch the performer tags get: "oil and big tits" is a scene
           tag list in AND mode, which is INCLUDES_ALL */
        mode: draft.tagMode || "OR",
        /* functional update: the sheet is a child of this render, and a click that
           lands before the parent re-renders would otherwise write a stale draft */
        onMode: (mode) => setDraft((cur) => Object.assign({}, cur, { tagMode: mode })),
        onClose: () => setTagOpen(false),
      }),
      picker === "ptags" && h(SettingsPicker, {
        title: "Performer Tags", value: (ptagSel.tags || []).length ? "select" : "all",
        options: [{ value: "all", label: "Any Performer Tag" }, { value: "select", label: "Select Performer Tags" }],
        onPick: (value) => {
          if (value === "all") {
            setDraft(Object.assign({}, draft, { performerTags: { tags: [], mode: ptagSel.mode } }));
            return;
          }
          setPtagOpen(true);
        },
        onClose: () => setPicker(""),
      }),
      picker === "peth" && h(SettingsPicker, {
        title: "Performer Ethnicity", value: draft.performerEthnicity || "",
        options: [{ value: "", label: "Any ethnicity" }].concat(
          ETHNICITY_OPTIONS.map((value) => ({ value, label: value }))
        ),
        onPick: (value) => setDraft(Object.assign({}, draft, { performerEthnicity: value })),
        onClose: () => setPicker(""),
      }),
      ptagOpen && h(TagSheet, {
        title: "Performer Tags",
        hint: "Tags that are on the performer, not on the scene.",
        selected: ptagSel.tags || [],
        mode: ptagSel.mode,
        onMode: (mode) => setDraft((cur) => {
          const sel = cur.performerTags || { tags: [], mode: "OR" };
          return Object.assign({}, cur, { performerTags: { tags: sel.tags || [], mode } });
        }),
        onToggle: (id) => setDraft((cur) => {
          const sel = cur.performerTags || { tags: [], mode: "OR" };
          const list = sel.tags || [];
          return Object.assign({}, cur, {
            performerTags: {
              tags: list.indexOf(id) >= 0 ? list.filter((tag) => tag !== id) : list.concat([id]),
              mode: sel.mode || "OR",
            },
          });
        }),
        onClose: () => setPtagOpen(false),
      })
    );
  }

  function SettingsPanel({ cfg = {}, feeds = [], onEditFeed = () => {}, onSaveFeed = () => {},
    onDeleteFeed = () => {}, onDraftFeed = () => {}, onBack = () => {},
    feedDraft = null, section = "", onSection = () => {},
    pin, onSetPin = () => {}, onClearPin = () => {}, sfw, onToggleSfw = () => {},
    prefs = {}, setPref = () => {}, onOpenHistory, onOpenOps = () => {}, onRunSetup = () => {} }) {
    const [draft, setDraft] = useState("");
    const [saved, setSaved] = useState(false);
    const [pinEntry, setPinEntry] = useState(false);
    const [confirmOff, setConfirmOff] = useState(false);
    const [picker, setPicker] = useState("");
    const [tagSheet, setTagSheet] = useState("");

    /* Turning the lock off always erases the PIN: there is no way to keep a
       secret the user has just said they no longer want guarded, and a PIN left
       behind would silently lock the next session out. */
    function requestLockOff() {
      setPinEntry(false);
      setConfirmOff(true);
    }

    function requestLockOn() {
      setConfirmOff(false);
      if (pin) return;
      setSaved(false);
      setPinEntry(true);
    }

    const rowById = {
      feeds: { icon: "feed", title: "Your Feeds" },
      performer: { icon: "user", title: "Performer Page" },
      genders: { icon: "user", title: "Show performers" },
      blur: { icon: "image", title: "Blur Content Thumbnails" },
      lock: { icon: "lock", title: "Privacy Lock" },
      appearance: { icon: "image", title: "Appearance" },
      navigation: { icon: "menu", title: "Navigation" },
      server: { icon: "gear", title: "This Server" },
      operations: { icon: "ops", title: "Stash Operations" },
      about: { icon: "info", title: "About" },
    };

    /* every saved feed is a custom feed. Filtering on `type` hid them all: the
       editor writes type "foryou" for a random feed, which is also the built-in
       feed's type, so the list read "No custom feeds yet" right after a save. */
    const customFeeds = (feeds || []).filter((feed) => feed.id !== "foryou" && feed.id !== "favorites");

    function feedsPage() {
      const favTags = prefs.favoriteTags || [];
      return h(React.Fragment, null,
        h("section", { className: "stk-set-block" },
          h("h4", { className: "stk-set-block-head" }, "For You"),
          h("p", { className: "stk-set-block-sub" }, "Filters for the For You feed"),
          h(SettingsChoiceRow, {
            title: "Content Time Range",
            value: labelOf(WINDOW_OPTIONS, prefs.feedWindow || "all", "All"),
            onClick: () => setPicker("window"),
          }),
          h(SettingsChoiceRow, {
            title: "Filter by Tag",
            value: tagCountLabel(prefs.foryouTags),
            onClick: () => setPicker("foryouTags"),
          }),
          h(SettingsChoiceRow, {
            title: "Performers",
            value: performerScopeLabel(prefs.foryouPerformers),
            onClick: () => setPicker("performers"), last: true,
          })
        ),

        h("section", { className: "stk-set-block" },
          h("h4", { className: "stk-set-block-head" }, "Favorites"),
          h("p", { className: "stk-set-block-sub" }, "How Favorites are sorted"),
          h(SettingsChoiceRow, {
            title: "Sort Order",
            value: labelOf(FAV_SORT_OPTIONS, prefs.favoritesSort || "updated_at", "Recent"),
            onClick: () => setPicker("favSort"),
          }),
          h(SettingsChoiceRow, {
            title: "Filter by Tag",
            value: tagCountLabel(favTags),
            onClick: () => setPicker("favTags"),
          }),
          h(SettingsChoiceRow, {
            title: "Algorithm Preferences",
            value: algoLabel(prefs.favoritesAlgo),
            onClick: () => setPicker("algo"), last: true,
          })
        ),

        h("section", { className: "stk-set-block" },
          h("h4", { className: "stk-set-block-head" }, "Built-in Feeds"),
          h("p", { className: "stk-set-block-sub" }, "Start from one and change anything: filters, sort, exclusions."),
          [
            {
              key: "tpl-foryou",
              name: "For You",
              note: "Shuffle · your settings",
              spec: {
                type: "foryou",
                name: "For You (mine)",
                sort: "random",
                direction: "DESC",
                tags: prefs.foryouTags || [],
                tagMode: prefs.foryouTagMode || "OR",
                windowDays: prefs.feedWindow === "all" ? 0 : Number(prefs.feedWindow) || 0,
                performerScope: prefs.foryouPerformers || { mode: "all", ids: [] },
              },
            },
            {
              key: "tpl-favorites",
              name: "Favorites",
              note: "Everything you rated or hearted",
              spec: {
                type: "favorites",
                name: "Favorites (mine)",
                sort: prefs.favoritesSort || "updated_at",
                direction: (prefs.favoritesSort || "updated_at") === "title" ? "ASC" : "DESC",
                tags: prefs.favoriteTags || [],
                tagMode: "OR",
              },
            },
          ].map((tpl) =>
            h("button", { key: tpl.key, type: "button", className: "stk-set-row", onClick: () => onEditFeed(tpl.spec) },
              h("span", { className: "stk-set-icon" }, h(Icon, { name: tpl.spec.type === "favorites" ? "heart" : "sparkle", size: 18 })),
              h("span", { className: "stk-set-copy" }, h("span", null, tpl.name), h("small", { className: "stk-set-note" }, tpl.note)),
              h("span", { className: "stk-set-chev" }, h(Icon, { name: "chevron", size: 15 }))
            )
          )
        ),

        h("section", { className: "stk-set-block" },
          h("h4", { className: "stk-set-block-head" }, "Custom Feeds"),
          customFeeds.length
            ? customFeeds.map((feed) =>
                h("button", { key: feed.id, type: "button", className: "stk-set-row", onClick: () => onEditFeed(feed) },
                  h("span", { className: "stk-set-icon" }, h(Icon, { name: "sparkle", size: 18 })),
                  h("span", { className: "stk-set-copy" }, h("span", null, feed.name)),
                  h("span", { className: "stk-set-chev" }, h(Icon, { name: "chevron", size: 15 }))
                )
              )
            : h("p", { className: "stk-set-empty" }, "No custom feeds yet"),
          h("button", { type: "button", className: "stk-set-add", onClick: () => onEditFeed(null) },
            h(Icon, { name: "plus", size: 16 }), "Create New Feed")
        )
      );
    }

    function SectionBody() {
      if (section === "genders") {
        const shown = shownGenders(prefs);
        const allOn = shown.length === GENDER_VALUES.length;
        return h("div", { className: "stk-set-block" },
          h("p", { className: "stk-set-block-sub" },
            "Which performers the app shows. Untick a gender and its clips drop out of every feed — scenes with no performer set are never hidden."),
          h("div", { className: "stk-pick-list" },
            GENDER_OPTIONS.map((option) => {
              const on = shown.indexOf(option.value) >= 0;
              return h("button", {
                key: option.value,
                type: "button",
                className: "stk-pick-row" + (on ? " stk-on" : ""),
                "aria-pressed": on,
                onClick: () => {
                  if (on && shown.length === 1) return;   /* never hide every gender */
                  const next = on
                    ? shown.filter((value) => value !== option.value)
                    : shown.concat([option.value]);
                  setPref("genders", next.length === GENDER_VALUES.length ? [] : next);
                },
              },
                h("span", null, option.label),
                on ? h(Icon, { name: "check", size: 16 }) : null
              );
            })
          ),
          h("button", {
            type: "button",
            className: "stk-btn",
            onClick: () => setPref("genders", []),
            style: { marginTop: "10px" },
          }, allOn ? "All genders shown" : "Show every gender again")
        );
      }
      if (section === "feeds") return feedsPage();
      if (section === "feeds/performers") {
        return h(PerformerFilterPage, {
          scope: prefs.foryouPerformers,
          onChange: (next) => setPref("foryouPerformers", next),
          onDone: onBack,
        });
      }
      if (section === "feeds/new-feed/performers") {
        const draft = feedDraft || {};
        return h(PerformerFilterPage, {
          scope: draft.performerScope,
          onChange: (next) => onDraftFeed(Object.assign({}, draft, { performerScope: next })),
          onDone: onBack,
        });
      }
      if (section === "feeds/new-feed") {
        return h(FeedEditorPage, {
          key: (feedDraft && feedDraft.id) || "new",
          initial: feedDraft,
          onSave: onSaveFeed,
          onDelete: onDeleteFeed,
          onDraft: onDraftFeed,
          onOpenPerformers: () => onSection("feeds/new-feed/performers"),
          onDone: () => onSection("feeds"),
        });
      }
      if (section === "performer") {
        return h(React.Fragment, null,
          h(PrefRow, { title: "Default sort", hint: "Used the first time you open a performer", stack: true },
            h(PrefPills, {
              value: prefs.performerSort,
              options: [["filesize", "Size"], ["updated_at", "Recent"], ["duration", "Length"], ["resolution", "Res"], ["title", "A–Z"], ["random", "Random"]],
              onChange: (value) => setPref("performerSort", value),
            })),
          h(PrefRow, { title: "Folders on top", hint: "Group a performer's clips by folder above the grid" },
            h(PrefToggle, { label: "Folders on top", on: prefs.foldersOnTop, onChange: (value) => setPref("foldersOnTop", value) })),
          h(PrefRow, { title: "Hover previews", hint: "Plays the clip's own file when the pointer rests on a tile, skipping ahead every second. Off by default — it streams the real file and is heavy for a decoration." },
            h(PrefToggle, { label: "Hover previews", on: prefs.hoverPreview === true, onChange: (value) => setPref("hoverPreview", value) })),
          h(PrefRow, { title: "Show Images tab", hint: "Adds an Images tab next to Scenes on every performer page" },
            h(PrefToggle, { label: "Images tab", on: prefs.performerImages, onChange: (value) => setPref("performerImages", value) })),
          h(PrefRow, { title: "Show Markers tab", hint: "Adds a Markers tab next to Scenes on every performer page" },
            h(PrefToggle, { label: "Markers tab", on: prefs.performerMarkers, onChange: (value) => setPref("performerMarkers", value) }))
        );
      }
      if (section === "appearance") {
        return h(React.Fragment, null,
          h(PrefRow, { title: "Black & white", hint: "Desaturate the whole UI — pairs with a red or greyscale colour filter" },
            h(PrefToggle, { label: "Black & white", on: !!prefs.mono, onChange: (value) => setPref("mono", value) })),
          h(PrefRow, { title: "Auto-crop to fill", hint: "Fill a portrait screen: the middle half of a 16:9 clip, or an even top-and-bottom crop when a clip is only a little off the screen's ratio. Off = always letterbox." },
            h(PrefToggle, { label: "Auto-crop", on: prefs.autoCrop !== false, onChange: (value) => setPref("autoCrop", value) })),
          h(PrefRow, { title: "Show file path", hint: "Print the folder path under the caption in the feed" },
            h(PrefToggle, { label: "Show path", on: !!prefs.showPath, onChange: (value) => setPref("showPath", value) })),
          h(PrefRow, { title: "Drag-scrub the stage", hint: "Press and sweep sideways across the video to seek. Off by default — a sideways thumb at the end of a swipe was seeking the clip. Tap the caption to open the scrub bar instead." },
            h(PrefToggle, { label: "Drag-scrub", on: prefs.dragScrub === true, onChange: (value) => setPref("dragScrub", value) })),
          h(PrefRow, { title: "Double-tap edges to seek", hint: "A double tap in the outer stripe of the video jumps 5 seconds back or forward, like an arrow key, and leaves a ring on that half. The middle stripe still steps the portrait crop. Stripe = 200 px, or a third of the width on a phone." },
            h(PrefToggle, { label: "Edge seek", on: prefs.edgeSeek !== false, onChange: (value) => setPref("edgeSeek", value) }))
        );
      }
      if (section === "server") {
        const serverCfg = cfg || {};
        const thumbLabel = serverCfg.thumbBase === "off"
          ? "Stash images"
          : serverCfg.thumbBase
          ? String(serverCfg.thumbBase).replace(/^https?:\/\//, "")
          : THUMB_BASE
          ? String(THUMB_BASE).replace(/^https?:\/\//, "") + " (auto)"
          : "Stash images";
        const minLabel = Number(serverCfg.minDuration) > 0
          ? "under " + serverCfg.minDuration + "s skipped"
          : "no minimum";
        return h(React.Fragment, null,
          h("p", { className: "stk-set-block-sub" },
            "These are stored on this Stash server, so every instance you run keeps its own. A new server starts from the defaults until setup runs there."),
          h("section", { className: "stk-set-block" },
            h("h4", { className: "stk-set-block-head" }, "Server defaults"),
            h("dl", { className: "stk-setup-summary" },
              h("div", null, h("dt", null, "Plays"), h("dd", null, serverCfg.source === "markers" ? "Markers" : "All scenes")),
              h("div", null, h("dt", null, "Short clips"), h("dd", null, minLabel)),
              h("div", null, h("dt", null, "Flag tag"), h("dd", null, serverCfg.flagTag || FLAG_TAG_FALLBACK)),
              h("div", null, h("dt", null, "Thumbnails"), h("dd", null, thumbLabel))
            )
          ),
          !serverCfg.setupDone && h("p", { className: "stk-set-block-sub" }, "Setup has not been completed on this server."),
          h("button", { type: "button", className: "stk-btn stk-primary", onClick: () => onRunSetup() }, "Run setup again"),
          h("p", { className: "stk-sub" },
            "Feed definitions, the privacy lock and every appearance switch stay in this browser. Only the settings above are shared by every device that opens this server.")
        );
      }
      if (section === "navigation") {
        return h(React.Fragment, null,
          h(PrefRow, { title: "Settings button in the top bar", hint: "Shows the gear beside Search on the feed, so Settings is one tap away. Turn it off for a bare stage; Settings is always in the drawer." },
            h(PrefToggle, { label: "Top bar settings", on: prefs.topSettings !== false, onChange: (value) => setPref("topSettings", value) })),
          h(PrefRow, { title: "Bottom bar", hint: "Long-press the last three buttons to change what they open" },
            h("button", { className: "stk-btn", onClick: () => setPref("navSlots", DEFAULT_NAV_SLOTS.slice()) }, "Reset")),
          h("p", { className: "stk-sub" }, "Settings lives in the drawer, not on the bar. Feed is fixed on the far left.")
        );
      }
      return h(React.Fragment, null,
        h("p", { className: "stk-sub" }, "Hearts are written to Stash as rating100. Any rated scene appears in the Favorites feed, and in Stash's own rating filter. Feed definitions live in this browser only."),
        h("p", { className: "stk-sub" }, "Long-press the middle of the video for actions · hold the right side to fast-forward · hold the left to rewind · pinch to zoom · long-press then drag to move the frame · double-tap the middle to step the crop · double-tap the left or right edge to jump 5 s · scrub the bar, then push up for a Marker."),
        h("h4", { className: "stk-set-sub-head" }, "Playback"),
        h(PlaybackSettings, { prefs, setPref, onOpenHistory, sfw, expanded: true })
      );
    }

    function renderRow(id) {
      const meta = rowById[id] || { icon: "info", title: id };
      if (id === "genders") {
        return h(SettingsChoiceRow, {
          key: id, icon: meta.icon, title: meta.title,
          value: genderLabel(prefs), onClick: () => onSection("genders"),
          last: id === SETTINGS_GROUPS[0].rows[SETTINGS_GROUPS[0].rows.length - 1],
        });
      }
      if (id === "blur") {
        return h(SettingsToggleRow, {
          key: id, icon: meta.icon, title: meta.title,
          on: !!sfw, onChange: (value) => onToggleSfw(value),
        });
      }
      if (id === "lock") {
        return h(React.Fragment, { key: id },
          h(SettingsToggleRow, {
            icon: meta.icon, title: meta.title,
            on: !!pin, onChange: (value) => (value ? requestLockOn() : requestLockOff()),
          }),
          confirmOff && h("div", { className: "stk-set-notice" },
            h("p", null, "Turning the Privacy Lock off resets the PIN. You will set a new one the next time you switch it on."),
            h("div", { className: "stk-set-notice-actions" },
              h("button", { type: "button", className: "stk-btn", onClick: () => setConfirmOff(false) }, "Keep it on"),
              h("button", {
                type: "button",
                className: "stk-btn stk-btn-danger",
                onClick: () => {
                  onClearPin();
                  setDraft("");
                  setSaved(false);
                  setConfirmOff(false);
                },
              }, "Turn off & reset PIN")
            )
          ),
          pinEntry && !pin && h("div", { className: "stk-set-notice" },
            h("p", null, "Choose a 4-digit PIN. It saves the moment the fourth digit lands."),
            h("div", { className: "stk-pin-row" },
              h("input", {
                type: "tel",
                inputMode: "numeric",
                placeholder: "PIN (4 digits)",
                value: draft,
                maxLength: 4,
                autoFocus: true,
                onChange: (event) => {
                  const next = event.currentTarget.value.replace(/\D/g, "").slice(0, 4);
                  setDraft(next);
                  if (next.length === 4) {
                    onSetPin(pinDigest(next));
                    setPinEntry(false);
                    setSaved(true);
                  }
                },
                className: "stk-pin-input",
              })
            ),
            h("div", { className: "stk-set-notice-actions" },
              h("button", { type: "button", className: "stk-btn", onClick: () => { setPinEntry(false); setDraft(""); } }, "Cancel")
            )
          ),
          saved && h("p", { className: "stk-set-notice-ok" }, "PIN set — the lock is on.")
        );
      }
      return h(SettingsRow, {
        key: id, icon: meta.icon, title: meta.title,
        onClick: id === "operations" ? () => onOpenOps() : () => onSection(id),
      });
    }

    function renderPicker() {
      if (!picker) return null;
      const close = () => setPicker("");
      if (picker === "window") {
        return h(SettingsPicker, {
          title: "Content Time Range", value: prefs.feedWindow || "all", options: WINDOW_OPTIONS,
          onPick: (value) => setPref("feedWindow", value), onClose: close,
        });
      }
      if (picker === "favSort") {
        return h(SettingsPicker, {
          title: "Sort Order", value: prefs.favoritesSort || "updated_at", options: FAV_SORT_OPTIONS,
          onPick: (value) => setPref("favoritesSort", value), onClose: close,
        });
      }
      if (picker === "foryouTags" || picker === "favTags") {
        const key = picker === "foryouTags" ? "foryouTags" : "favoriteTags";
        const current = prefs[key] || [];
        return h(SettingsPicker, {
          title: "Filter by Tag", value: current.length ? "select" : "all",
          options: [{ value: "all", label: "All Tags" }, { value: "select", label: "Select Tags" }],
          onPick: (value) => {
            close();
            if (value === "select") setTagSheet(key);
            else setPref(key, []);
          },
          onClose: close,
        });
      }
      if (picker === "performers") {
        return h(SettingsPicker, {
          title: "Performers", value: (prefs.foryouPerformers || DEFAULT_PERFORMER_SCOPE).mode,
          options: PERFORMER_SCOPE_OPTIONS,
          onPick: (value) => {
            if (value === "filter") {
              setPref("foryouPerformers", Object.assign({}, prefs.foryouPerformers || {}, { mode: "filter" }));
              onSection("feeds/performers");
              return;
            }
            setPref("foryouPerformers", { mode: value, ids: [] });
          },
          onClose: close,
        });
      }
      return h(SettingsPicker, {
        title: "Algorithm Preferences", multi: true,
        options: [{ value: "none", label: "No Preferences", selected: !algoKeys(prefs.favoritesAlgo).length }].concat(
          ALGO_OPTIONS.map((option) => ({ value: option.value, label: option.label, selected: !!(prefs.favoritesAlgo || {})[option.value] }))
        ),
        onPick: (value) => setPref("favoritesAlgo", nextAlgo(prefs.favoritesAlgo, value)),
        onClose: close,
      });
    }

    function renderTagSheet() {
      if (!tagSheet) return null;
      const selected = prefs[tagSheet] || [];
      return h(TagSheet, {
        title: "Select Tags",
        selected,
        onToggle: (id) => setPref(tagSheet, selected.indexOf(id) >= 0 ? selected.filter((tag) => tag !== id) : selected.concat([id])),
        onClose: () => setTagSheet(""),
      });
    }

    if (section) {
      return h(
        "div",
        { className: "stk-settings stk-set-page" },
        /* called, not mounted: a fresh component type each render would remount
           the PIN input on every keystroke and drop the keyboard focus */
        SectionBody(),
        renderPicker(),
        renderTagSheet()
      );
    }

    return h(
      "div",
      { className: "stk-settings stk-set-index" },
      SETTINGS_GROUPS.map((group) =>
        h("section", { key: group.id, className: "stk-set-group" },
          h("h1", { className: "stk-set-group-head" + (group.rank === 1 ? " stk-set-h1" : "") }, group.id),
          group.rows.map((id) => renderRow(id))
        )
      ),
      renderPicker(),
      renderTagSheet()
    );
  }

  /* ------------------------------------------------------------------ */
  /* first-run setup                                                     */
  /* ------------------------------------------------------------------ */

  /* A new installation — new server, or a server whose plugin config is still
     empty — has nothing worth showing until one thing is answered: what does
     the feed play from? Everything else here is a default the user can change
     later, so the wizard never blocks, and Skip leaves the coded defaults in
     place. Each step writes to the server on the last tap, not per step, so a
     half-finished run leaves the config exactly as it found it. */

  const SETUP_STEPS = ["welcome", "source", "duration", "flag", "thumbs", "done"];

  const DURATION_OPTIONS = [
    { value: 0, label: "Off", note: "Play everything, however short" },
    { value: 5, label: "5s", note: "Anything under 5 seconds is skipped" },
    { value: 10, label: "10s", note: "Recommended — drops 2-second clips" },
    { value: 30, label: "30s", note: "Only clips worth half a minute" },
    { value: 60, label: "60s", note: "Only real scenes" },
  ];

  function SetupDots({ index }) {
    return h(
      "div",
      { className: "stk-setup-dots", "aria-hidden": "true" },
      SETUP_STEPS.slice(1, -1).map((id, i) =>
        h("span", { key: id, className: "stk-setup-dot" + (i <= index - 1 ? " stk-on" : "") })
      )
    );
  }

  function SetupCard({ on, title, note, detail, badge, disabled, onClick }) {
    return h(
      "button",
      {
        type: "button",
        className: "stk-setup-card" + (on ? " stk-on" : "") + (disabled ? " stk-off" : ""),
        onClick: disabled ? undefined : onClick,
        "aria-pressed": !!on,
        disabled: !!disabled,
      },
      h(
        "span",
        { className: "stk-setup-card-head" },
        h("span", { className: "stk-setup-card-title" }, title),
        badge ? h("span", { className: "stk-setup-card-badge" }, badge) : null
      ),
      note ? h("span", { className: "stk-setup-card-note" }, note) : null,
      detail ? h("span", { className: "stk-setup-card-detail" }, detail) : null,
      on ? h("span", { className: "stk-setup-card-check" }, h(Icon, { name: "check", size: 15 })) : null
    );
  }

  function SetupWizard({ cfg, loaded, onDone, onSkip }) {
    const [step, setStep] = useState(0);
    /* which way the next step comes from: 1 forward, -1 back */
    const [dir, setDir] = useState(1);
    const [source, setSource] = useState(cfg.source === "markers" ? "markers" : "scenes");
    const [minDuration, setMinDuration] = useState(
      cfg.minDuration == null ? 10 : Number(cfg.minDuration)
    );
    const [flagTag, setFlagTag] = useState(cfg.flagTag || FLAG_TAG_FALLBACK);
    const [useThumbs, setUseThumbs] = useState(cfg.thumbBase !== "off");
    const [counts, setCounts] = useState(null);
    const [probe, setProbe] = useState("idle");
    const [tagState, setTagState] = useState("idle"); /* idle | found | new */
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const id = SETUP_STEPS[step];

    /* the library in one round-trip: the choice between scenes and markers is
       only meaningful next to how many of each this server actually has */
    useEffect(() => {
      let alive = true;
      gql(
        `query StashTokSetupCounts {
          findScenes(filter: { per_page: 0 }) { count }
          findSceneMarkers(filter: { per_page: 0 }) { count }
          findPerformers(filter: { per_page: 0 }) { count }
        }`
      )
        .then((data) => {
          if (!alive || !data) return;
          setCounts({
            scenes: (data.findScenes && data.findScenes.count) || 0,
            markers: (data.findSceneMarkers && data.findSceneMarkers.count) || 0,
            performers: (data.findPerformers && data.findPerformers.count) || 0,
          });
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    /* does the delete-flag tag already exist here? says whether flagging will
       file scenes under something the user recognises or mint a new tag */
    useEffect(() => {
      if (id !== "flag") return undefined;
      const name = (flagTag || "").trim();
      if (!name) {
        setTagState("idle");
        return undefined;
      }
      let alive = true;
      const timer = window.setTimeout(() => {
        gql(
          `query StashTokSetupTag($q: String) { findTags(filter: { q: $q, per_page: 20 }) { tags { id name } } }`,
          { q: name }
        )
          .then((data) => {
            if (!alive) return;
            const list = (data.findTags && data.findTags.tags) || [];
            const hit = list.some((tag) => tag.name.toLowerCase() === name.toLowerCase());
            setTagState(hit ? "found" : "new");
          })
          .catch(() => alive && setTagState("idle"));
      }, 350);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }, [id, flagTag]);

    /* thumbnail sidecar: the port guess covers 9997/9998 only, so a fresh
       server on another port silently loses it — say so instead of pretending */
    useEffect(() => {
      if (id !== "thumbs") return undefined;
      if (!THUMB_BASE) {
        setProbe("none");
        return undefined;
      }
      let alive = true;
      setProbe("checking");
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = window.setTimeout(() => controller && controller.abort(), 2500);
      fetch(THUMB_BASE + "/healthz", controller ? { signal: controller.signal } : undefined)
        .then((res) => alive && setProbe(res && res.ok ? "ok" : "down"))
        .catch(() => alive && setProbe("down"))
        .then(() => window.clearTimeout(timer));
      return () => {
        alive = false;
        window.clearTimeout(timer);
        if (controller) controller.abort();
      };
    }, [id]);

    /* the step body slides in from the side you are travelling towards, so Back
       reads as going back rather than as another forward step */
    const next = () => { setDir(1); setStep((n) => Math.min(SETUP_STEPS.length - 1, n + 1)); };
    const back = () => {
      if (step === 0) { onSkip(); return; }
      setDir(-1);
      setStep((n) => Math.max(0, n - 1));
    };

    async function finish() {
      setSaving(true);
      setError("");
      try {
        await writeServerSettings({
          source,
          minDuration: Number(minDuration) || 0,
          flagTag: (flagTag || "").trim() || FLAG_TAG_FALLBACK,
          /* "off" always uses Stash's own images; "" keeps the port guess */
          thumbBase: useThumbs ? (cfg.thumbBase === "off" ? "" : cfg.thumbBase || "") : "off",
          setupDone: true,
        });
        onDone();
      } catch (err) {
        setError(String((err && (err.message || err)) || "Could not save to Stash."));
        setSaving(false);
      }
    }

    const countLine = (n) => (counts == null ? "…" : Number(n || 0).toLocaleString());

    function body() {
      if (id === "welcome") {
        return h(
          React.Fragment,
          null,
          h("div", { className: "stk-setup-mark" }, "S"),
          h("h1", { className: "stk-setup-title" }, "StashTok"),
          h(
            "p",
            { className: "stk-setup-sub" },
            "A social media-inspired way to view all your scenes."
          ),
          counts &&
            h(
              "p",
              { className: "stk-setup-meta" },
              countLine(counts.scenes) + " scenes · " +
                countLine(counts.markers) + " markers · " +
                countLine(counts.performers) + " performers"
            )
        );
      }

      if (id === "source") {
        return h(
          React.Fragment,
          null,
          h("h1", { className: "stk-setup-title" }, "What should a feed play?"),
          h("p", { className: "stk-setup-sub" }, "First, let's set up your For You feed. You can change it later."),
          h(
            "div",
            { className: "stk-setup-cards" },
            h(SetupCard, {
              on: source === "scenes",
              title: "All scenes",
              badge: "Recommended",
              note: "Every video from start to finish.",
              detail: countLine(counts && counts.scenes) + " scenes",
              onClick: () => setSource("scenes"),
            }),
            h(SetupCard, {
              on: source === "markers",
              title: "Markers only",
              note: "The moments you tagged — skips the lead-in.",
              detail: counts && counts.markers === 0 ? "No markers on this server yet" : countLine(counts && counts.markers) + " markers",
              disabled: !!counts && counts.markers === 0,
              onClick: () => setSource("markers"),
            })
          ),
          counts && counts.markers === 0 &&
            h("p", { className: "stk-setup-hint" }, "Markers come from Stash: add a few and this option opens up.")
        );
      }

      if (id === "duration") {
        return h(
          React.Fragment,
          null,
          h("h1", { className: "stk-setup-title" }, "Skip the very short clips"),
          h("p", { className: "stk-setup-sub" }, "Anything under the limit drops out of every feed. The Shorts feed ignores this."),
          h(
            "div",
            { className: "stk-setup-chips" },
            DURATION_OPTIONS.map((option) =>
              h(
                "button",
                {
                  key: option.value,
                  type: "button",
                  className: "stk-setup-chip" + (Number(minDuration) === option.value ? " stk-on" : ""),
                  onClick: () => setMinDuration(option.value),
                  "aria-pressed": Number(minDuration) === option.value,
                },
                option.label
              )
            )
          ),
          h(
            "p",
            { className: "stk-setup-hint" },
            (DURATION_OPTIONS.find((option) => option.value === Number(minDuration)) || {}).note || ""
          )
        );
      }

      if (id === "flag") {
        return h(
          React.Fragment,
          null,
          h("h1", { className: "stk-setup-title" }, "Where do flagged scenes go?"),
          h(
            "p",
            { className: "stk-setup-sub" },
            "Flagging hides a scene from the feed and tags it in Stash. Nothing is deleted here — you review the tag in Stash."
          ),
          h("input", {
            className: "stk-setup-input",
            value: flagTag,
            spellCheck: false,
            autoCapitalize: "off",
            autoCorrect: "off",
            onChange: (event) => setFlagTag(event.currentTarget.value),
            placeholder: FLAG_TAG_FALLBACK,
            "aria-label": "Deletion flag tag name",
          }),
          h(
            "p",
            { className: "stk-setup-hint" },
            tagState === "found"
              ? "This tag already exists on this server — flagged scenes join it."
              : tagState === "new"
              ? "No such tag yet: it is created the first time you flag something."
              : "The tag is created on demand, so nothing changes until you use it."
          )
        );
      }

      if (id === "thumbs") {
        return h(
          React.Fragment,
          null,
          h("h1", { className: "stk-setup-title" }, "Thumbnails"),
          h(
            "p",
            { className: "stk-setup-sub" },
            "A small service beside Stash renders 320 px tiles. Without it grids use Stash's own full-size images: it works, it is just slower."
          ),
          h(
            "div",
            { className: "stk-setup-status stk-" + probe },
            h("span", { className: "stk-setup-dot-live" }),
            probe === "checking" && "Checking…",
            probe === "ok" && "Service found at " + String(THUMB_BASE || "").replace(/^https?:\/\//, ""),
            probe === "down" && "No answer from " + String(THUMB_BASE || "").replace(/^https?:\/\//, ""),
            probe === "none" && "No thumbnail service detected on this server",
            probe === "idle" && "Not checked yet"
          ),
          h(
            "div",
            { className: "stk-setup-toggle-row" },
            h("span", null, "Use thumbnails"),
            h(PrefToggle, {
              label: "Use thumbnails",
              on: useThumbs,
              onChange: (value) => setUseThumbs(value),
            })
          ),
          probe === "none" &&
            h(
              "p",
              { className: "stk-setup-hint" },
              "Set the service URL in Stash → Settings → Plugins → StashTok if you run one on another port."
            )
        );
      }

      const sourceLabel = source === "markers" ? "Markers" : "All scenes";
      const durationLabel =
        Number(minDuration) === 0 ? "No minimum" : "Under " + minDuration + "s skipped";
      return h(
        React.Fragment,
        null,
        h("div", { className: "stk-setup-mark stk-ok" }, h(Icon, { name: "check", size: 26 })),
        h("h1", { className: "stk-setup-title" }, "Ready"),
        h("p", { className: "stk-setup-sub" }, "Saved to this server the moment you tap Start watching. Change any of it later in Settings → This Server."),
        h(
          "dl",
          { className: "stk-setup-summary" },
          h("div", null, h("dt", null, "Plays"), h("dd", null, sourceLabel)),
          h("div", null, h("dt", null, "Short clips"), h("dd", null, durationLabel)),
          h("div", null, h("dt", null, "Flag tag"), h("dd", null, (flagTag || "").trim() || FLAG_TAG_FALLBACK)),
          h("div", null, h("dt", null, "Thumbnails"), h("dd", null, useThumbs ? (THUMB_BASE ? "Service" : "Stash images") : "Stash images"))
        ),
        error && h("p", { className: "stk-setup-error", role: "alert" }, error)
      );
    }

    const primary =
      id === "welcome"
        ? "Get started"
        : id === "done"
        ? saving
          ? "Saving…"
          : "Start watching"
        : "Next";

    return h(
      "div",
      { className: "stk-setup", role: "dialog", "aria-modal": "true", "aria-label": "StashTok setup" },
      h(
        "div",
        { className: "stk-setup-top" },
        h(
          "button",
          {
            type: "button",
            className: "stk-setup-back",
            onClick: back,
            title: id === "welcome" ? "Skip setup" : "Back",
            "aria-label": id === "welcome" ? "Skip setup" : "Back",
          },
          h(Icon, { name: id === "welcome" ? "x" : "back", size: 18 })
        ),
        h(SetupDots, { index: step }),
        id !== "welcome" && id !== "done"
          ? h("button", { type: "button", className: "stk-setup-skip", onClick: onSkip }, "Skip")
          : h("span", { className: "stk-setup-skip stk-ghost" }, "")
      ),
      /* keyed by step so the body remounts and its entrance runs per step */
      h("div", { key: id, className: "stk-setup-body" + (dir < 0 ? " stk-step-back" : "") }, body()),
      h(
        "div",
        { className: "stk-setup-foot" },
        h(
          "button",
          {
            type: "button",
            className: "stk-setup-cta",
            disabled: saving || !loaded || (id === "source" && counts && counts.markers === 0 && source === "markers"),
            onClick: id === "done" ? finish : next,
          },
          primary
        )
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* root                                                               */
  /* ------------------------------------------------------------------ */

  function usePluginConfig() {
    const [cfg, setCfg] = useState(() => readConfig(null));
    /* `loaded` gates the setup wizard: until this server's map has come back
       there is no way to tell a fresh instance from a configured one */
    const [loaded, setLoaded] = useState(false);
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
      let alive = true;
      gql("{ configuration { plugins } }")
        .then((data) => {
          if (!alive) return;
          setCfg(readConfig({ plugins: data.configuration && data.configuration.plugins }));
          setLoaded(true);
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
      return () => {
        alive = false;
      };
    }, [nonce]);
    return { cfg, loaded, reload: () => setNonce((n) => n + 1) };
  }


  /* ---- privacy lock ------------------------------------------------ */

  const SFW_KEY = "stashtok.sfw";
  const PIN_KEY = "stashTok.pin";
  const RAIL_KEY = "stashTok.railPin";

  /** Cheap, salted digest. crypto.subtle needs a secure context, and Stash on a
   *  LAN IP is plain http, so it is unavailable exactly where this matters. */
  function pinDigest(pin) {
    const text = "stashtok:" + pin;
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16);
  }

  function LockScreen({ stored, onUnlock }) {
    const [entry, setEntry] = useState("");
    const [wrong, setWrong] = useState(false);

    /* four digits, no confirm key: the pad checks on the last one */
    function press(digit) {
      if (entry.length >= 4) return;
      const next = entry + digit;
      setEntry(next);
      setWrong(false);
      if (next.length !== 4) return;
      if (pinDigest(next) === stored) {
        onUnlock();
        return;
      }
      setWrong(true);
      buzz(60);
      window.setTimeout(() => setEntry(""), 340);
    }

    return h(
      "div",
      { className: "stk-lock" },
      h("div", { className: "stk-lock-title" }, "Locked"),
      h("div", { className: "stk-lock-dots" }, entry.replace(/./g, "•") || "Enter PIN"),
      h(
        "div",
        { className: "stk-lock-pad" },
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", ""].map((key) =>
          h(
            "button",
            {
              key,
              className: "stk-lock-key" + (wrong ? " stk-lock-wrong" : "") + (key ? "" : " stk-lock-blank"),
              onClick: () => {
                if (!key) return;
                if (key === "⌫") setEntry((current) => current.slice(0, -1));
                else press(key);
              },
            },
            key === "⌫" ? "⌫" : key
          )
        )
      )
    );
  }

  function StashTokApp() {
    const { cfg: baseCfg, loaded: cfgLoaded, reload: reloadCfg } = usePluginConfig();
    /* thumbnails: explicit setting wins, "off" disables, otherwise guess from the port */
    const thumbSetting = baseCfg.thumbBase;
    THUMB_BASE = thumbSetting === "off" ? "" : thumbSetting || guessThumbBase();
    const [prefs, setPrefs] = useState(loadPrefs);
    /* setup owns the screen on a server that has never been configured and on
       a device that has never finished it. Both flags are set by the wizard;
       either one alone is enough to keep it away. */
    const [setupOpen, setSetupOpen] = useState(false);
    const [navPicker, setNavPicker] = useState(null);
    const [feedOptions, setFeedOptions] = useState(false);

    /* iPadOS reports itself as a Mac once "request desktop site" is on, so touch
       points decide whether this is a tablet, not the user agent. A touch-screen
       Windows laptop stays a desktop: it reports Windows, never Macintosh. */
    const isTablet = () =>
      typeof navigator !== "undefined" &&
      (navigator.maxTouchPoints || 0) > 1 &&
      /iPad|Macintosh/.test(navigator.userAgent || "");

    /* wide screens get the desktop shell: sidebar + video pane. A tablet portrait
       is wide enough to trip that breakpoint but a finger there wants the bottom
       tab bar, not a hover rail. Landscape is the opposite: there is width for the
       rail and the tab bar is the only thing standing between the clip and the
       bottom edge — so landscape runs the desktop shell and goes full-bleed. */
    const wantsDesktop = () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 900px)").matches &&
      (!isTablet() || window.innerWidth > window.innerHeight);
    const [desktop, setDesktop] = useState(wantsDesktop);
    const [tablet, setTablet] = useState(isTablet);
    useEffect(() => {
      const mq = window.matchMedia("(min-width: 900px)");
      const onChange = () => {
        setTablet(isTablet());
        setDesktop(mq.matches && (!isTablet() || window.innerWidth > window.innerHeight));
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
      window.addEventListener("orientationchange", onChange);
      window.addEventListener("resize", onChange);
      return () => {
        if (mq.removeEventListener) mq.removeEventListener("change", onChange);
        else if (mq.removeListener) mq.removeListener(onChange);
        window.removeEventListener("orientationchange", onChange);
        window.removeEventListener("resize", onChange);
      };
    }, []);

    /* tiles fade and rise as they scroll into view: one entrance each, never replayed */
    useEffect(() => {
      if (!("IntersectionObserver" in window)) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.body.classList.add("stk-anim");
      const seen = new WeakSet();
      const watcher = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            const parent = el.parentElement;
            const index = parent ? Array.prototype.indexOf.call(parent.children, el) : 0;
            if (!reduced) el.style.transitionDelay = `${Math.min(index, 7) * 38}ms`;
            el.dataset.in = "1";
            watcher.unobserve(el);
          });
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
      );
      const scan = () => {
        document.querySelectorAll(".stk-tile, .stk-account, .stk-fv-row").forEach((el) => {
          if (seen.has(el) || el.dataset.in) return;
          seen.add(el);
          watcher.observe(el);
        });
      };
      let queued = 0;
      const scanSoon = () => {
        if (queued) return;
        queued = window.requestAnimationFrame(() => {
          queued = 0;
          scan();
        });
      };
      scan();
      const mutations = new MutationObserver(scanSoon);
      mutations.observe(document.body, { childList: true, subtree: true });
      return () => {
        watcher.disconnect();
        mutations.disconnect();
        document.body.classList.remove("stk-anim");
      };
    }, []);
    /* settings moved into the drawer, so a slot still pointing at it becomes Tags */
    const navSlots = (prefs.navSlots && prefs.navSlots.length >= 4 ? prefs.navSlots : DEFAULT_NAV_SLOTS)
      .map((id) => (id === "settings" ? "tags" : id));

    function runNav(id) {
      /* every sidebar item is a fresh section: clear whatever page we were on first */
      setBuilder(null);
      setFolderProfile(null);
      setFolderView(null);
      setPerformersOpen(false);
      setTagProfile(null);
      if (id === "performers") {
        setPerformerFilter(null);
        setTab("performers");
        goTo("performers");
      } else if (id === "discover") {
        setPerformerFilter(null);
        setTab("discover");
        goTo("discover");
      } else if (id === "search") {
        setTab("search");
        goTo("search");
      } else if (id === "favorites") {
        setPerformerFilter(null);
        setTab("favorites");
        goTo("favorites");
      } else if (id === "tags") {
        setTab("tags");
        goTo("tags");
      } else if (id === "folders") {
        setTab("folders");
        goTo("folders");
      } else if (id === "markers") {
        setPerformerFilter(null);
        setTab("markers");
        goTo("markers");
      } else if (id === "random") {
        setPerformerFilter(null);
        setActiveFeed({ id: "foryou", name: "Random", type: "foryou", sort: "random" });
        setTab("home");
        setRefreshKey((n) => n + 1);
        goTo("");
      } else if (id === "settings") {
        setTab("settings");
        goTo("settings");
      } else if (id === "ops") {
        setTab("ops");
        goTo("ops");
      }
    }

    /* a bottom-bar slot: Feed is fixed first, these four follow in order */
    function navSlotButton(id, slot) {
      const option = NAV_OPTIONS.find((entry) => entry.id === id) || NAV_OPTIONS[0];
      const target = option.id === "random" ? "home" : option.id;
      return h(NavButton, {
        key: "slot-" + slot,
        active: tab === target,
        icon: option.icon,
        label: option.label,
        onClick: () => runNav(option.id),
        onLongPress: () => setNavPicker({ slot, id: option.id }),
      });
    }

    const setPref = useCallback((key, value) => {
      setPrefs((cur) => {
        const next = Object.assign({}, cur, { [key]: value });
        savePrefs(next);
        return next;
      });
    }, []);

    /* the decision waits for this server's config: before it arrives baseCfg is
       the coded default, which looks exactly like a fresh installation.
       A server with any saved key, or a device that already had prefs, is an
       existing installation — an upgrade must not suddenly own the screen. */
    useEffect(() => {
      if (!cfgLoaded) return;
      if (baseCfg.serverConfigured || PREFS_SEEN) return;
      setSetupOpen(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cfgLoaded]);

    function finishSetup() {
      setPref("setupDone", true);
      setSetupOpen(false);
      reloadCfg();
      /* a new source changes what every feed asks for, so start clean */
      setRefreshKey((n) => n + 1);
    }

    /* Skip means "the defaults are fine, stop asking" — it marks the server and
       this device as done and writes no settings at all. */
    async function skipSetup() {
      finishSetup();
      try {
        await writeServerSettings({ setupDone: true });
      } catch (err) {
        /* offline or a read-only Stash: the device flag is enough for now */
      }
    }
    const [sfw, setSfw] = useState(() => {
      try {
        return window.localStorage.getItem(SFW_KEY) === "1";
      } catch (e) {
        return false;
      }
    });
    const cfg = { ...baseCfg, sfw };
    function setSfwMode(next) {
      try {
        if (next) window.localStorage.setItem(SFW_KEY, "1");
        else window.localStorage.removeItem(SFW_KEY);
      } catch (e) {
        /* ignore */
      }
      setSfw(next);
    }

    /* the desktop rail is open by default; the pin collapses it to an icon strip
       and that choice survives reloads. Collapsed never re-expands on hover —
       the icons carry a tooltip instead, so the pane keeps its width. */
    const [railPin, setRailPin] = useState(() => {
      try {
        return window.localStorage.getItem(RAIL_KEY) !== "0";
      } catch (e) {
        return true;
      }
    });
    const railMin = desktop && !railPin && !isTablet();
    /* The rail must offer everything the tab bar does, or switching shells loses a
       tab: it is built from the user's own nav slots, then the extra sections that
       only exist on a wide screen. Deduped, Feed always first. */
    const railItems = (() => {
      const ids = ["feed"].concat(prefs.navSlots || DEFAULT_NAV_SLOTS, ["search", "tags", "markers", "folders"]);
      const seen = new Set();
      return ids
        .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
        .map((id) => {
          if (id === "feed") return ["feed", "Feed", "play"];
          if (id === "search") return ["search", "Search", "search"];
          const opt = NAV_OPTIONS.find((entry) => entry.id === id);
          return [id, opt ? opt.label : id, opt ? opt.icon : "search"];
        });
    })();
    function toggleRailPin() {
      setRailPin((cur) => {
        const next = !cur;
        try {
          window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
        } catch (e) {
          /* ignore */
        }
        return next;
      });
    }
    const shellRef = useRef(null);
    const coverRef = useRef(null);
    const [pin, setPin] = useState(() => {
      try {
        return window.localStorage.getItem(PIN_KEY) || "";
      } catch (e) {
        return "";
      }
    });
    const [locked, setLocked] = useState(() => {
      try {
        return Boolean(window.localStorage.getItem(PIN_KEY));
      } catch (e) {
        return false;
      }
    });

    function savePin(value) {
      try {
        if (value) window.localStorage.setItem(PIN_KEY, value);
        else window.localStorage.removeItem(PIN_KEY);
      } catch (e) {
        /* ignore */
      }
      setPin(value);
      setLocked(Boolean(value));
    }

    /* cover the screen the moment attention leaves, before React can re-render */
    useEffect(() => {
      if (!pin) return undefined;
      const hide = () => {
        const cover = coverRef.current;
        if (cover) {
          cover.style.visibility = "visible";
          cover.style.opacity = "1";
        }
        document.querySelectorAll(".stk-video").forEach((video) => {
          try {
            video.pause();
          } catch (e) {
            /* ignore */
          }
        });
        setLocked(true);
      };
      const onVisibility = () => {
        if (document.visibilityState !== "visible") hide();
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("blur", hide);
      window.addEventListener("pagehide", hide);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("blur", hide);
        window.removeEventListener("pagehide", hide);
      };
    }, [pin]);
    /* deep links must not render one branch and then swap to another: that is a hook-order
       crash in react. hold the shell until the first applyRoute has run. */
    const [routed, setRouted] = useState(false);
    const [tab, setTab] = useState("home");
    /* /clip/<id>: one scene on its own page, no bottom nav, back button only */
    const [clipScene, setClipScene] = useState(null);
    const historyClipRef = useRef(null);
    /* /favorites/<row>: one favourite row opened as a gallery (View all) */
    const [favRow, setFavRow] = useState(null);
    const [feeds, setFeeds] = useState(() => loadFeeds());
    const [activeFeed, setActiveFeed] = useState(defaultFeed());
    /* which settings page is open: "" is the index, "feeds" the feeds page, ... */
    const [settingsRoute, setSettingsRoute] = useState("");
    const [duo, setDuo] = useState(false);

    const [refreshKey, setRefreshKey] = useState(0);
    const [builder, setBuilder] = useState(null); // {spec} | 'new' | null
    const feedOptionsRef = useDialog(!!feedOptions, () => setFeedOptions(false));
    const navPickerRef = useDialog(!!navPicker, () => setNavPicker(null));
    const [performersOpen, setPerformersOpen] = useState(false);

    const [performerFilter, setPerformerFilter] = useState(null);
    /* one tag's own page: the Tags tab shows it in place of the list */
    const [tagProfile, setTagProfile] = useState(null);
    /* the favourites page opens a performer filtered to the scenes you hearted */
    const [favOnlyProfile, setFavOnlyProfile] = useState(false);
    /* applyRoute and resolvePerformerSlug are captured once (empty deps), so they
       read the favourites-only flag through a ref; without this the deep link
       threw a ReferenceError and fell back to the performers list */
    const favOnlyRef = useRef(false);
    useEffect(() => {
      favOnlyRef.current = favOnlyProfile;
    }, [favOnlyProfile]);
    /* the left drawer: settings, tags, performers and the rest live behind it */
    const [navOpen, setNavOpen] = useState(false);
    /* Esc closes the drawer like every other layer; without this the only way
       out on a phone was the scrim, which a keyboard user cannot reach */
    useEffect(() => {
      if (!navOpen) return;
      const onKey = (event) => {
        if (event.key === "Escape" || event.keyCode === 27) {
          event.preventDefault();
          setNavOpen(false);
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }, [navOpen]);
    const [tagFilter, setTagFilter] = useState(null);
    const [folderView, setFolderView] = useState(null);
    const [folderProfile, setFolderProfile] = useState(null);
    const [profileOpen, setProfileOpen] = useState(false);

    /* thumbnails stay blurred; pressing one peeks at it, nothing switches the blur off */
    useEffect(() => {
      const down = (event) => {
        const target = event.target;
        const host = target && target.closest && target.closest(".stk-tile, .stk-account, .stk-search-row, .stk-cover, .stk-card");
        if (host) host.classList.add("stk-peek");
      };
      const up = () => {
        document.querySelectorAll(".stk-peek").forEach((el) => el.classList.remove("stk-peek"));
      };
      document.addEventListener("pointerdown", down, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", up, true);
      return () => {
        document.removeEventListener("pointerdown", down, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", up, true);
      };
    }, []);

    /* the display is held by the feed itself, only while a clip is playing:
       see createAwake above */

    /* ---- routing: the URL is the source of truth --------------------- */

    const liveRef = useRef({});
    liveRef.current = { tab, activeFeed };
    /* a feed we just opened on a scene, so the scene route does not replace it
       with a one-clip feed (the URL write lands before React re-renders) */
    const selfSceneRef = useRef(null);
    /* exact route we just wrote, so the router can skip re-applying it */
    const routeClaimRef = useRef(null);
    /* the feed the settings editor was opened with (null = a new one) */
    const feedDraftRef = useRef(null);

    const applyRoute = useCallback((rest) => {
      if (routeClaimRef.current && routeClaimRef.current === rest) {
        routeClaimRef.current = null;
        return;
      }
      const live = liveRef.current || {};
      const feedNow = live.activeFeed || null;
      /* every route but /clip/<id> leaves the single-scene page behind */
      if (!rest.startsWith("clip/")) {
        setClipScene(null);
        historyClipRef.current = null;
      }
      if (!rest) {
        setTab("home");
        setFavRow(null);
        setPerformerFilter(null);
        /* keep the feed you were on; only a second tap on Feed asks for new clips */
        setActiveFeed((cur) => cur && !scopedFeed(cur) ? cur : defaultFeed());
        return;
      }
      if (rest === "favorites") {
        setTab("favorites");
        setPerformerFilter(null);
        setFavRow(null);
        return;
      }
      /* /favorites/<row> is a gallery of that row: the "View all" destination.
         Keeping it a route means back and a cold reload both land on the grid. */
      if (rest.indexOf("favorites/") === 0) {
        const key = rest.slice("favorites/".length);
        setTab("favorites");
        setPerformerFilter(null);
        setFavRow(FAVORITE_ROWS.some((row) => row.key === key) ? key : null);
        return;
      }
      if (rest === "performers") {
        setPerformerFilter(null);
        setTab("performers");
        return;
      }
      if (rest === "discover") {
        setPerformerFilter(null);
        setTab("discover");
        return;
      }
      if (rest === "tags") {
        setTab("tags");
        return;
      }
      if (rest === "markers") {
        setTab("markers");
        return;
      }
      /* /tagpage/<id>/<name> is that tag's own page */
      if (rest.indexOf("tagpage/") === 0) {
        const tail = rest.slice("tagpage/".length);
        const slash = tail.indexOf("/");
        const id = String(slash === -1 ? tail : tail.slice(0, slash)).replace(/\D/g, "");
        const name = slash === -1 ? "" : decodeURIComponent(tail.slice(slash + 1));
        if (!id) {
          setTab("tags");
          return;
        }
        setPerformerFilter(null);
        setTagProfile({ id, name: name || "Tag" });
        setTab("tags");
        return;
      }
      /* /tag/<id>/<name> is one tag's scenes: the same page Stash serves as
         /tags/<id>/scenes, so a reload lands on the feed and not on the list */
      if (rest.indexOf("tag/") === 0) {
        const tail = rest.slice("tag/".length);
        const slash = tail.indexOf("/");
        const id = String(slash === -1 ? tail : tail.slice(0, slash)).replace(/\D/g, "");
        if (!id) {
          setTab("home");
          return;
        }
        const name = slash === -1 ? "" : decodeURIComponent(tail.slice(slash + 1));
        setPerformerFilter(null);
        setActiveFeed({
          id: "tag-" + id,
          name: name || "Tag",
          type: "tags",
          tags: [id],
          tagMode: "OR",
          sort: "date",
          origin: { kind: "tag", tagId: id, name: name || "Tag" },
        });
        setTab("home");
        return;
      }
      /* /marker/<id> is one marker's feed: that marker, then every marker Stash
         gives the same name. Cold-loading the URL rebuilds it, so back and a
         reload both land somewhere real instead of on the markers list. */
      if (rest.indexOf("marker/") === 0) {
        const markerId = rest.slice("marker/".length).replace(/\D/g, "");
        setPerformerFilter(null);
        setTab("home");
        if (markerId) {
          /* there is no findSceneMarker on this schema: the single-marker read
             is findSceneMarkers(ids: [...]) */
          gql(
            `query StashTokMarkerRoute($ids: [ID!]) {
              findSceneMarkers(ids: $ids) { scene_markers { id title seconds scene { id } } }
            }`,
            { ids: [markerId] }
          )
            .then((data) => {
              const marker = data && data.findSceneMarkers && (data.findSceneMarkers.scene_markers || [])[0];
              if (!marker || !marker.id) return;
              setActiveFeed({
                id: "marker-" + marker.id,
                name: marker.title || "Marker",
                type: "markers",
                markerTitle: marker.title || "",
                startSceneId: marker.scene && marker.scene.id ? String(marker.scene.id) : null,
                startAt: Number(marker.seconds) || 0,
                sort: "random",
                origin: { kind: "markers" },
              });
              setRefreshKey((n) => n + 1);
            })
            .catch(() => {
              /* the route stays; the feed falls back to the default */
            });
        }
        return;
      }
      /* /markers/<id>/<name> is the marker feed for one tag; the name rides in
         the route so the feed is identifiable before its first page lands */
      /* /tagpair/<id>/<id> is two tags ANDed: the "often with" row's feed */
      if (rest.indexOf("tagpair/") === 0) {
        const ids = rest.split("/").slice(1).map((part) => part.replace(/\D/g, "")).filter(Boolean);
        setPerformerFilter(null);
        setTagProfile(null);
        setActiveFeed({
          id: "tagpair-" + ids.join("-"),
          name: "Two tags",
          type: "tags",
          tags: ids,
          tagMode: "AND",
          sort: "random",
          origin: { kind: "tag", tagId: ids[0] || "", name: "Two tags" },
        });
        setTab("home");
        return;
      }
      if (rest.indexOf("markers/") === 0) {
        const parts = rest.split("/");
        /* /markers/name/<name> is a marker-NAME collection: every marker that
           shares the name, played as one reel */
        if (parts[1] === "name") {
          let markerName = "";
          try {
            markerName = decodeURIComponent(parts.slice(2).join("/"));
          } catch (err) {
            markerName = "";
          }
          setPerformerFilter(null);
          setActiveFeed({
            id: "markername-" + markerName.toLowerCase(),
            name: markerName || "Markers",
            type: "markers",
            markerTitle: markerName,
            sort: "random",
            origin: { kind: "markers" },
          });
          setTab("home");
          return;
        }
        const id = (parts[1] || "").replace(/\D/g, "");
        let tagName = "";
        try {
          tagName = decodeURIComponent(parts[2] || "");
        } catch (err) {
          tagName = "";
        }
        setPerformerFilter(null);
        setActiveFeed({
          id: "markers-" + id,
          name: tagName ? (id ? "Markers \u00b7 " + tagName : tagName) : "Markers",
          type: "markers",
          markerTagId: id,
          sort: "random",
          origin: { kind: "markers" },
        });
        setTab("home");
        return;
      }
      /* /settings/<section> is a real route: the chevron, browser back and a
         cold deep link all land on the same page, and back has something to
         return to. */
      if (rest === "settings" || rest.indexOf("settings/") === 0) {
        setTab("settings");
        setSettingsRoute(rest === "settings" ? "" : rest.slice("settings/".length));
        return;
      }
      if (rest === "ops") {
        setTab("ops");
        return;
      }
      if (rest === "folders") {
        setTab("folders");
        return;
      }
      if (rest === "search") {
        setTab("search");
        return;
      }
      if (rest.indexOf("folder/") === 0) {
        const raw = rest.slice("folder/".length);
        /* a trailing numeric segment is a scene id, not part of the folder path */
        const parts = raw.split("/");
        const tail = parts[parts.length - 1] || "";
        const sceneId = /^\d+$/.test(tail) ? tail : null;
        const path = decodeURIComponent(sceneId ? parts.slice(0, -1).join("/") : raw);
        setFolderProfile(path);
        if (sceneId) {
          /* /folder/<path>/<scene> is a clip opened from the folder page: play it, keep the folder as origin */
          const name = String(path).split("/").filter(Boolean).pop() || path;
          setActiveFeed({
            id: "folder-" + path,
            name,
            type: "foryou",
            pathIncludes: path,
            sort: "filesize",
            startSceneId: sceneId,
            origin: { kind: "folder", folder: path },
          });
          setTab("home");
          return;
        }
        setTab("folderProfile");
        return;
      }
      if (rest.indexOf("performer/") === 0 || rest.indexOf("performers/") === 0) {
        const prefix = rest.indexOf("performers/") === 0 ? "performers/" : "performer/";
        const tail = rest.slice(prefix.length);
        const slash = tail.indexOf("/");
        const slug = decodeURIComponent(slash === -1 ? tail : tail.slice(0, slash));
        const sceneId = slash === -1 ? null : tail.slice(slash + 1).replace(/\D/g, "");
        // the feed itself rewrites this URL on every swipe; re-applying it would
        // rebuild the feed (and snap back to item 0), so ignore our own writes
        if (
          live.tab === "home" &&
          feedNow &&
          feedNow.type === "performer" &&
          String(feedNow.name || "").toLowerCase() === slug.toLowerCase() &&
          String(clipState.sceneId || "") === String(sceneId || "")
        ) {
          return;
        }
        if (!sceneId) {
          // /performer/<name> is the profile page; only /performer/<name>/<clip> plays
          resolvePerformerSlug(slug, null, true);
          return;
        }
        resolvePerformerSlug(slug, sceneId);
        return;
      }
      /* /clip/<id> is one scene as its own page: the card a performer page opens,
         but with nowhere to swipe. The highlight reel's Full Scene lands here.
         A different route from /scene/<id>, which joins the performer's feed. */
      if (rest.indexOf("clip/") === 0) {
        const id = rest.slice("clip/".length).replace(/\D/g, "");
        if (!id) {
          setTab("home");
          return;
        }
        setClipScene(id);
        setTab("clip");
        return;
      }
      if (rest.indexOf("scene/") === 0) {
        const id = rest.slice("scene/".length).replace(/\D/g, "");
        if (live.tab === "home" && feedNow && feedNow.type === "scene" && String(feedNow.sceneId) === String(id)) return;
        if (String(selfSceneRef.current || "") === String(id)) {
          selfSceneRef.current = null;
          return;
        }
        resolveSceneId(id);
        return;
      }
      setTab("home");
    }, []);

    /* black & white UI: set on <html>, because the shell has more than one render
       path (placeholder vs full app) and a class on the shell misses some of them */
    /* the single-scene page has no bottom nav and no gear: the back chevron is the
       only chrome that belongs on it */
    useEffect(() => {
      document.body.classList.toggle("stk-clip-mode", tab === "clip");
      return () => document.body.classList.remove("stk-clip-mode");
    }, [tab]);

    useEffect(() => {
      document.documentElement.classList.toggle("stk-mono", !!prefs.mono);
      /* inline, not just the class: the plugin stylesheet can be served from cache,
         and then the toggle would appear to do nothing until a hard reload */
      document.documentElement.style.filter = prefs.mono ? "grayscale(1) contrast(1.06)" : "";
      return () => {
        document.documentElement.classList.remove("stk-mono");
        document.documentElement.style.filter = "";
      };
    }, [prefs.mono]);

    /* ---- keep the shell inside the visible viewport --------------------
       Safari's toolbars shrink visualViewport.height without touching the layout
       viewport, and `position: fixed; inset: 0` is sized to the layout viewport:
       the bottom tab bar then lands behind the toolbar and reads as missing. Size
       the shell to the *visual* height instead, which is what the user can see. */
    useEffect(() => {
      const view = window.visualViewport;
      if (!view) return undefined;
      let cancelled = false;
      const apply = () => {
        if (cancelled) return;
        const shell = shellRef.current;
        const box = shell && shell.querySelector(".stk-fixed");
        if (!box) return;
        const h = Math.round(view.height || window.innerHeight || 0);
        if (h > 0) box.style.height = h + "px";
      };
      apply();
      view.addEventListener("resize", apply);
      window.addEventListener("orientationchange", apply);
      const timer = window.setTimeout(apply, 250);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        view.removeEventListener("resize", apply);
        window.removeEventListener("orientationchange", apply);
      };
    }, [routed]);

    /* ---- the on-screen keyboard -----------------------------------------
       iOS shrinks visualViewport when the keyboard opens and leaves the layout
       viewport alone, so a `position: fixed; bottom: 0` sheet keeps its bottom
       edge underneath the keyboard: its rows paint into the black strip above
       the keys and the panel looks torn. Publish the visible box as two custom
       properties and flag the state, so a sheet can ride above the keyboard
       instead of hanging off the layout viewport. */
    useEffect(() => {
      const view = window.visualViewport;
      if (!view) return undefined;
      const root = document.documentElement;
      let frame = 0;
      const apply = () => {
        frame = 0;
        const h = Math.round(view.height || 0);
        const bottom = Math.round((view.offsetTop || 0) + (view.height || 0));
        if (h > 0) root.style.setProperty("--stk-vv-h", h + "px");
        if (bottom > 0) root.style.setProperty("--stk-vv-b", bottom + "px");
        /* 120 px of shrink cannot be a toolbar: this is a keyboard */
        const kb = h > 0 && h < (window.innerHeight || 0) - 120;
        root.classList.toggle("stk-kb", kb);
      };
      const soon = () => {
        if (frame) return;
        frame = window.setTimeout(apply, 60);
      };
      apply();
      view.addEventListener("resize", soon);
      view.addEventListener("scroll", soon);
      return () => {
        window.clearTimeout(frame);
        view.removeEventListener("resize", soon);
        view.removeEventListener("scroll", soon);
        root.classList.remove("stk-kb");
        root.style.removeProperty("--stk-vv-h");
        root.style.removeProperty("--stk-vv-b");
      };
    }, [routed]);

    /* Stash ships `width=device-width, initial-scale=1, maximum-scale=1` and no
       viewport-fit: without it env(safe-area-inset-*) is always 0, so nothing can
       keep the tab bar out of the home-indicator / app-switch strip at the bottom
       of an iPad. Re-assert it with cover once. */
    useEffect(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      if (!meta) return;
      const content = meta.getAttribute("content") || "";
      if (/viewport-fit/.test(content)) return;
      meta.setAttribute("content", content.replace(/\s*$/, "") + ", viewport-fit=cover");
    }, []);

    /* the page itself must never zoom: pinch belongs to the video only.
       BUT if the page is already page-zoomed (Safari restores a site zoom on
       reload) pinching must pass through, otherwise there is no way back out.
       Bound to document, not to the shell ref: the shell only exists after the
       first render, so a []-effect keyed on the ref would never run. */
    useEffect(() => {
      const pageZoomed = () => window.visualViewport && window.visualViewport.scale > 1.01;
      const blockPinch = (event) => {
        if (!event.touches || event.touches.length < 2) return;
        if (pageZoomed()) return;
        // pinch is ours (video zoom); letting it through page-zoomed the whole UI
        event.preventDefault();
      };
      const blockGesture = (event) => {
        if (pageZoomed()) return;
        event.preventDefault();
      };
      document.addEventListener("touchmove", blockPinch, { passive: false });
      document.addEventListener("gesturestart", blockGesture, { passive: false });

      /* Safari remembers a pinch zoom per site and restores it on reload: nudge the
         viewport back to 1 so a refresh never comes up pre-zoomed, and keep the
         document from scrolling (a scrolling page is what drifts into page zoom). */
      const resetPageZoom = () => {
        const view = window.visualViewport;
        if (!view || view.scale <= 1.01) return;
        const meta = document.querySelector('meta[name="viewport"]');
        if (meta) meta.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1");
        window.scrollTo(0, 0);
      };
      document.documentElement.classList.add("stk-noscroll");
      document.body.classList.add("stk-noscroll");
      const timer = window.setTimeout(resetPageZoom, 60);
      if (window.visualViewport) window.visualViewport.addEventListener("resize", resetPageZoom);

      return () => {
        document.documentElement.classList.remove("stk-noscroll");
        document.body.classList.remove("stk-noscroll");
        window.clearTimeout(timer);
        if (window.visualViewport) window.visualViewport.removeEventListener("resize", resetPageZoom);
        document.removeEventListener("touchmove", blockPinch);
        document.removeEventListener("gesturestart", blockGesture);
      };
    }, []);

    /* scroll position per route: coming back lands where you left off, not at the top.
       saved continuously on scroll, because a passive-effect cleanup runs after the
       new page has already replaced the DOM (which would record a misleading 0). */
    const scrollMemo = useRef(new Map());
    const routeKeyRef = useRef("home");

    useEffect(() => {
      routeKeyRef.current = currentRoute() || "home";
      const key = routeKeyRef.current;
      let cancelled = false;
      let tries = 0;
      const apply = () => {
        if (cancelled) return;
        const node = document.querySelector(".stk-page");
        if (!node) {
          if (tries++ < 6) window.setTimeout(apply, 250);
          return;
        }
        const target = scrollMemo.current.get(key) || 0;
        if (target && Math.abs(node.scrollTop - target) > 4 && tries < 14) {
          node.scrollTop = target;
          tries += 1;
          window.setTimeout(apply, 250);
        }
      };
      apply();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, performerFilter, folderProfile]);

    useEffect(() => {
      const onScroll = (event) => {
        const node = event.target;
        if (node && node.classList && node.classList.contains("stk-page")) {
          scrollMemo.current.set(routeKeyRef.current, node.scrollTop);
        }
      };
      document.addEventListener("scroll", onScroll, true);
      return () => document.removeEventListener("scroll", onScroll, true);
    }, []);

    useEffect(() => {
      applyRoute(currentRoute());
      setRouted(true);
      const onNav = () => applyRoute(currentRoute());
      window.addEventListener("hashchange", onNav);
      window.addEventListener("popstate", onNav);
      return () => {
        window.removeEventListener("hashchange", onNav);
        window.removeEventListener("popstate", onNav);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function resolvePerformerSlug(name, sceneId, asProfile) {
      const route = currentRoute();
      try {
        const data = await gql(
          `query StashTokFindByName($q: String) { findPerformers(filter: { q: $q, per_page: 20 }) { performers { id name image_path scene_count } } }`,
          { q: name }
        );
        if (currentRoute() !== route) return;
        const list = (data.findPerformers && data.findPerformers.performers) || [];
        const exact = list.find((row) => row.name.toLowerCase() === name.toLowerCase()) || list[0];
        if (exact) {
          if (asProfile) openProfile(exact, false, favOnlyRef.current);
          else if (sceneId) openPerformer(exact, { sceneId }, false);
          else openProfile(exact, false, favOnlyRef.current);
        } else {
          setTab("performers");
        }
      } catch (err) {
        if (currentRoute() !== route) return;
        window.__stkRouteErr = String((err && (err.message || err)) || "unknown");
        setTab("performers");
      }
    }

    async function resolveSceneId(id) {
      // if a real feed is already sitting on this clip (opened from a folder or
      // profile), keep it: rebuilding a single-scene feed would kill swiping
      const cur = (liveRef.current || {}).activeFeed;
      if (cur && cur.type !== "scene" && String(cur.startSceneId || "") === String(id)) return;
      try {
        const data = await gql(
          `query StashTokScenePerformer($id: ID!) { findScene(id: $id) { id performers { id name image_path scene_count } } }`,
          { id }
        );
        const scene = data.findScene;
        const performer = scene && scene.performers && scene.performers[0];
        if (performer) openPerformer(performer, { sceneId: id }, false);
        else {
          setTab("home");
          setActiveFeed({ id: "scene-" + id, name: "Scene", type: "scene", sceneId: id });
        }
      } catch (err) {
        setTab("home");
      }
    }

    /* a feed opened from a page (folder, performer, markers, tag, single clip) is not "home" */
    function scopedFeed(feed) {
      if (!feed) return false;
      if (feed.origin) return true;
      if (feed.id === "markers" || feed.id === "favorites") return true;
      return /^(folder-|perf-|scene-|tag-)/.test(String(feed.id || ""));
    }

    function shuffleActiveFeed() {
      const feed = activeFeed || defaultFeed();
      reshufflePools();
      forgetResume(feedResumeKey(feed));
      setActiveFeed(Object.assign({}, feed, { startSceneId: null, startAt: null }));
      setRefreshKey((n) => n + 1);
    }

    function goHome() {
      if (tab === "home" && !builder) {
        if (scopedFeed(activeFeed)) {
          // you are on a scoped feed: Feed means the root For You, not "refresh this page"
          setActiveFeed(defaultFeed());
          setRefreshKey((n) => n + 1);
          goTo("");
          return;
        }
        shuffleActiveFeed();
        return;
      }
      setFolderProfile(null);
      setFolderView(null);
      setBuilder(null);
      setPerformerFilter(null);
      if (scopedFeed(activeFeed)) setActiveFeed(defaultFeed());
      setTab("home");
      goTo("");
    }

    /* where a profile was opened from, so its back chevron returns there */
    const profileOriginRef = useRef({ id: null, tab: "performers" });

    /** the profile page: /performers/<name> */
    function openFavoritePerformer(performer) {
      /* a circle in the favourites row is a shortcut to the performer, not a
         scoped view: it opens their whole page, favourites chip and all off */
      openProfile(performer);
    }

    function openProfile(performer, push, favoriteOnly) {
      if (!performer) {
        setPerformersOpen(true);
        setTab("performers");
        return;
      }
      /* liveRef, not the closed-over tab: applyRoute holds the first render's
         openProfile, where tab was still "home", so back went to the feed */
      const now = (liveRef.current && liveRef.current.tab) || tab;
      const id = String(performer.id);
      if (push !== false || profileOriginRef.current.id !== id) {
        const from = push === false ? "performers" : now;
        profileOriginRef.current = {
          id,
          tab: ["discover", "performers", "favorites"].includes(from) ? from : "home",
        };
      }
      setFavOnlyProfile(!!favoriteOnly);
      setPerformersOpen(false);
      setPerformerFilter(performer);
      setTagFilter(null);
      setTab("performers");
      if (push !== false) {
        const route = "performers/" + encodeURIComponent(performer.name);
        if (route !== currentRoute()) {
          routeClaimRef.current = route;
          goTo(route);
        }
      }
    }

    /** back out of a profile: to the index page it came from, or to the feed */
    function closeProfile() {
      setPerformerFilter(null);
      const back = profileOriginRef.current.tab;
      profileOriginRef.current = { id: null, tab: "performers" };
      setTab(back);
      if (back === "home") {
        setActiveFeed((cur) => cur && !scopedFeed(cur) ? cur : defaultFeed());
      }
      goTo(back === "home" ? "" : back, true);
    }

    /** the clip feed for a performer: /performer/<name>/<sceneId> */
    function openPerformer(performer, payload, push) {
      /* the router rebuilds this call with {sceneId} only; the grid that opened the
         clip knew the order, so reuse it while it still matches */
      if (
        performer &&
        payload &&
        payload.sceneId &&
        !payload.orderIds &&
        gridPlay &&
        gridPlay.sceneId === String(payload.sceneId) &&
        gridPlay.performerId === String(performer.id)
      ) {
        payload = Object.assign({}, payload, {
          sort: gridPlay.sort,
          dir: gridPlay.dir,
          orderIds: gridPlay.orderIds,
        });
      }
      if (!performer) {
        setPerformersOpen(true);
        setTab("performers");
        return;
      }
      setPerformersOpen(false);
      setPerformerFilter(performer);
      setTagFilter(null);
      setActiveFeed({
        id: "perf-" + performer.id + (payload && payload.sceneId ? ":" + payload.sceneId : ""),
        name: performer.name,
        type: "performer",
        performerId: performer.id,
        sort: (payload && payload.sort) || "filesize",
        direction: (payload && payload.dir) || "DESC",
        /* the exact sequence the grid was showing, so a swipe advances to the next
           tile the user was looking at and not to whatever Stash sorts next */
        orderIds: (payload && payload.orderIds) || null,
        startSceneId: (payload && payload.sceneId) || null,
        startAt: (payload && payload.startAt) || null,
        origin: { kind: "performer", id: performer.id, performer },
      });
      setTab("home");
      setRefreshKey((n) => n + 1);
      if (push !== false && !(payload && payload.noPush)) {
        const route = "performers/" + encodeURIComponent(performer.name) + (payload && payload.sceneId ? "/" + payload.sceneId : "");
        // we just built this feed; the router must not rebuild it from the URL
        routeClaimRef.current = route;
        goTo(route);
      }
    }

    /* ---- tags ----------------------------------------------------------
       A tap on a tag opens that tag's own page, not a feed: a feed of whole
       scenes is what the markers page is for, and a tag click should land on
       something you can look at. The page's Play button (or a tile) is what
       starts the feed, in the order the page was showing. */
    function openTagPage(tag) {
      if (!tag || tag.id == null) return;
      const id = String(tag.id);
      setTagProfile({ id, name: tag.name || "Tag" });
      setTab("tags");
      const route = "tagpage/" + id + "/" + encodeURIComponent(tag.name || "");
      routeClaimRef.current = route;
      goTo(route);
    }

    function startTagFeed(tag, sort, scene) {
      const id = String(tag.id);
      setTagFilter(tag);
      setPerformerFilter(null);
      setTagProfile(null);
      setActiveFeed({
        id: "tag-" + id + (scene ? ":" + scene.id : ""),
        name: tag.name,
        type: "tags",
        tags: [id],
        tagMode: "OR",
        sort: sort || "random",
        startSceneId: scene && scene.id ? String(scene.id) : null,
        origin: { kind: "tag", tagId: id, name: tag.name },
      });
      setTab("home");
      setRefreshKey((n) => n + 1);
      // we just built this feed; the router must not rebuild it from the URL
      const route = "tag/" + id + "/" + encodeURIComponent(tag.name || "");
      routeClaimRef.current = route;
      goTo(route);
    }

    /* two tags at once: the "often with" row runs on AND, not OR, because the
       point is the scenes that carry both */
    function startTagPairFeed(ids, name) {
      const list = (ids || []).map((id) => String(id));
      if (!list.length) return;
      setTagFilter(null);
      setPerformerFilter(null);
      setTagProfile(null);
      setActiveFeed({
        id: "tagpair-" + list.join("-"),
        name: name || "Two tags",
        type: "tags",
        tags: list,
        tagMode: "AND",
        sort: "random",
        origin: { kind: "tag", tagId: list[0], name: name || "Two tags" },
      });
      setTab("home");
      setRefreshKey((n) => n + 1);
      routeClaimRef.current = "tagpair/" + list.join("/");
      goTo("tagpair/" + list.join("/"));
    }

    /* the markers button on a tag row: the marker feed for that one tag */
    function openMarkers(tag) {
      const id = tag ? String(tag.id) : "";
      setPerformerFilter(null);
      setActiveFeed({
        id: "markers-" + (id || "all"),
        name: id ? "Markers \u00b7 " + tag.name : "Markers",
        type: "markers",
        markerTagId: id,
        sort: "random",
        origin: { kind: "markers" },
      });
      setTab("home");
      setRefreshKey((n) => n + 1);
      const route = id
        ? "markers/" + id + "/" + encodeURIComponent(tag.name || "")
        : "markers/all/" + encodeURIComponent("All markers");
      routeClaimRef.current = route;
      goTo(route);
    }

    /* the markers page is a wall of names, so a pill opens that name as a feed:
       every marker sharing it, in random order, each from its own in point */
    function openMarkerName(name) {
      const wanted = String(name || "").trim();
      if (!wanted) return;
      setPerformerFilter(null);
      setActiveFeed({
        id: "markername-" + wanted.toLowerCase(),
        name: wanted,
        type: "markers",
        markerTitle: wanted,
        sort: "random",
        origin: { kind: "markers" },
      });
      setTab("home");
      setRefreshKey((n) => n + 1);
      const route = "markers/name/" + encodeURIComponent(wanted);
      routeClaimRef.current = route;
      goTo(route);
    }

    /* a marker on the markers page opens that marker, and every marker with the
       same NAME, as one feed. It used to open the scene, which then resolved to
       the performer's feed and lost both the marker and the route. */
    function markerFeedSpec(marker) {
      const scene = marker && marker.scene;
      return {
        id: "marker-" + (marker && marker.id),
        name: (marker && marker.title) || "Marker",
        type: "markers",
        markerTitle: (marker && marker.title) || "",
        startSceneId: scene && scene.id ? String(scene.id) : null,
        startAt: Number(marker && marker.seconds) || 0,
        sort: "random",
        origin: { kind: "markers" },
      };
    }

    function openMarker(marker) {
      if (!marker || !marker.id) return;
      setPerformerFilter(null);
      setActiveFeed(markerFeedSpec(marker));
      setTab("home");
      setRefreshKey((n) => n + 1);
      routeClaimRef.current = "marker/" + marker.id;
      goTo("marker/" + marker.id);
    }

    function useFeed(spec) {
      const next = Object.assign({ id: "f" + Date.now(), name: spec.name || "Feed" }, spec);
      setActiveFeed(next);
      setBuilder(null);
      setTab("home");
      setRefreshKey((n) => n + 1);
    }

    function saveFeed(spec) {
      const next = Object.assign({ id: spec.id || "f" + Date.now(), name: spec.name || "Feed" }, spec);
      const list = feeds.filter((feed) => feed.id !== next.id).concat([next]);
      setFeeds(list);
      saveFeeds(list);
      setBuilder(null);
      setActiveFeed(next);
      setTab("home");
      /* the URL has to follow the feed: created from #/settings/feeds/new-feed,
         leaving the hash there meant a reload dropped the user back into an
         empty editor and the feed looked like it had never been saved */
      goTo("");
      setRefreshKey((n) => n + 1);
    }

    function deleteFeed(id) {
      const list = feeds.filter((feed) => feed.id !== id);
      setFeeds(list);
      saveFeeds(list);
      setBuilder(null);
    }

    function onTab(nextTab) {
      if (nextTab === "home") {
        if (tab === "home") setRefreshKey((n) => n + 1); // tapping Home re-rolls the feed
        else {
          setTab("home");
          setPerformerFilter(null);
          setActiveFeed(defaultFeed());
        }
        goTo("");
        return;
      }
      setTab(nextTab);
      goTo(nextTab);
    }

    let body;
    if (tab === "performers") {
      body = h(PerformersPage, {
        view: "performers",
        onPick: openProfile,
        onBack: closeProfile,
        onOpenTag: openTagPage,
        onProfileOpen: setProfileOpen,
        initialPerformer: performerFilter,
        prefs,
        favoritesOnly: favOnlyProfile,
      });
    } else if (tab === "discover") {
      body = h(PerformersPage, {
        view: "discover",
        onPick: openProfile,
        onBack: closeProfile,
        onOpenTag: openTagPage,
        onProfileOpen: setProfileOpen,
        initialPerformer: performerFilter,
        prefs,
        favoritesOnly: favOnlyProfile,
        onSeeAll: () => {
          setPerformerFilter(null);
          setTab("performers");
          goTo("performers");
        },
      });
    } else if (tab === "folder" && folderView) {
      body = h(FolderProfile, {
        name: folderView.name,
        folder: folderView.folder,
        view: folderView.view || null,
        prefs,
        onBack: () => {
          setFolderView(null);
          setTab("home");
        },
        onPlay: (payload) => {
          const sceneId = (payload && payload.sceneId) || null;
          useFeed({
            type: payload && payload.tab === "markers" ? "markers" : "foryou",
            name: folderView.name,
            pathIncludes: folderView.folder,
            sort: (payload && payload.sort) || "date",
            direction: (payload && payload.sort) === "title" ? "ASC" : "DESC",
            startSceneId: sceneId,
            startAt: (payload && payload.startAt) || null,
          });
          // the folder route would otherwise keep re-selecting the folder page
          selfSceneRef.current = sceneId ? String(sceneId) : null;
          goTo(sceneId ? "scene/" + sceneId : "");
        },
      });
    } else if (tab === "favorites") {
      const playFavorites = (scene, meta) => {
        const info = meta || { sort: "updated_at", direction: "DESC", name: "Favorites" };
        useFeed({
          id: "favorites-" + info.sort,
          name: info.name || "Favorites",
          type: "favorites",
          sort: info.sort,
          direction: info.direction,
          /* the row's own ids, in its own order: the feed then swipes through the
             carousel you tapped instead of re-sorting from scratch */
          orderIds: info.ids || null,
          startSceneId: scene && scene.id,
          origin: { kind: "favorites" },
        });
        if (scene && scene.id) {
          selfSceneRef.current = String(scene.id);
          goTo("scene/" + scene.id);
        }
      };
      const favRowSpec = favRow ? FAVORITE_ROWS.filter((item) => item.key === favRow)[0] : null;
      body = favRowSpec
        ? h(FavoritesGallery, {
            key: "favgal:" + favRowSpec.key,
            row: favRowSpec,
            onPlay: playFavorites,
            onBack: () => {
              if (NAV_DEPTH > 0 && window.history.length > 1) window.history.back();
              else goTo("favorites");
            },
          })
        : h(FavoritesPage, {
            prefs,
            setPref,
            onOpenPerformer: (performer) => openFavoritePerformer(performer),
            onOpenRow: (row) => {
              if (!row || !row.key) return;
              setFavRow(row.key);
              goTo("favorites/" + row.key);
            },
            onAllPerformers: () => {
              setFavOnlyProfile(true);
              setPerformerFilter(null);
              setPerformersOpen(false);
              setTab("performers");
              goTo("performers");
            },
            onPlay: playFavorites,
          });
    } else if (tab === "tags") {
      body = tagProfile
        ? h(TagPage, {
            tagId: tagProfile.id,
            name: tagProfile.name,
            onBack: () => {
              setTagProfile(null);
              routeClaimRef.current = "tags";
              goTo("tags");
            },
            onPlay: startTagFeed,
            onPlayPair: startTagPairFeed,
          })
        : h(TagsPage, { onPick: openTagPage, onMarkers: openMarkers, onBack: () => setTab("home") });
    } else if (tab === "markers") {
      body = h(MarkersPage, { onPlayTag: openMarkers, onPlayName: openMarkerName, onBack: () => setTab("home") });
    } else if (tab === "folders") {
      body = h(FoldersPage, {
        onBack: () => setTab("home"),
        onPick: (row) => {
          setFolderView(row);
          setTab("folder");
          goTo("folder/" + encodeURIComponent(row.folder));
        },
      });
    } else if (tab === "search") {
      body = h(SearchPage, {
        onBack: () => {
          if (window.history.length > 1) window.history.back();
          else {
            setTab("home");
            goTo("");
          }
        },
        onPickPerformer: openPerformer,
        onPickFolder: (row) => {
          if (!row || !row.folder) return;
          setFolderView(Object.assign({ view: "list" }, row));
          setTab("folder");
          goTo("folder/" + encodeURIComponent(row.folder));
        },
        onPickScene: (sceneId, startAt, title) => {
          if (!sceneId) return;
          setPerformerFilter(null);
          setActiveFeed({
            id: "scene-" + sceneId,
            name: title || "Scene",
            type: "scene",
            sceneId: String(sceneId),
            startAt: startAt || 0,
          });
          setTab("home");
          setRefreshKey((n) => n + 1);
          goTo("scene/" + sceneId);
        },
      });
    } else if (tab === "folderProfile" && folderProfile) {
      body = h(PerformerProfile, {
        folder: folderProfile,
        onBack: () => {
          if (window.history.length > 1) window.history.back();
          else {
            setTab("home");
            goHome();
          }
        },
        onPlay: (payload) => {
          const name = String(folderProfile).split("/").filter(Boolean).pop() || folderProfile;
          setActiveFeed({
            id: "folder-" + folderProfile,
            name,
            type: "foryou",
            pathIncludes: folderProfile,
            sort: (payload && payload.sort) || "filesize",
            startSceneId: (payload && payload.sceneId) || null,
            startAt: (payload && payload.startAt) || null,
            origin: { kind: "folder", folder: folderProfile },
          });
          setTab("home");
          setRefreshKey((n) => n + 1);
          if (!(payload && payload.noPush)) {
            goTo(payload && payload.sceneId ? "scene/" + payload.sceneId : "folder/" + encodeURIComponent(folderProfile));
          }
        },
        onOpenTag: openTagPage,
        prefs,
      });
    } else if (tab === "ops") {
      body = h(
        "div",
        { className: "stk-page" },
        h(
          "div",
          { className: "stk-page-head" },
          "Operations",
          h(
            "button",
            { className: "stk-page-x", title: "Close", onClick: () => { setTab("home"); goTo(""); } },
            h(Icon, { name: "x", size: 18 })
          )
        ),
        h(OperationsPanel, null)
      );
    } else if (tab === "settings") {
      /* a section page keeps the top bar's left slot as its own back button, so
         the header names where you are instead of repeating "Settings" */
      const openSection = (path) => {
        if (path) goTo("settings/" + path);
        else goTo("settings");
      };
      /* back replaces the current entry instead of pushing another one: pushing
         left the section in front of the index in history, so one chevron tap
         needed two browser backs to leave settings */
      const backSection = () => {
        const parent = settingsRoute.indexOf("/") > 0
          ? settingsRoute.slice(0, settingsRoute.lastIndexOf("/"))
          : "";
        /* we pushed the section, so one browser-back is the parent. replaceState
           would be tidier but it fires no hashchange and is refused outright on
           file:// origins, which is where this gets tested. */
        if (NAV_DEPTH > 0 && window.history.length > 1) {
          window.history.back();
          return;
        }
        goTo(parent ? "settings/" + parent : "settings");
      };
      body = h(
        "div",
        { className: "stk-page" },
        h(
          "h2",
          { className: "stk-page-head" + (settingsRoute ? " stk-page-head-sub" : "") },
          settingsRoute
            ? h("button", { className: "stk-page-back", title: "Back", onClick: backSection },
                h(Icon, { name: "back", size: 19 }))
            : null,
          h("span", { className: "stk-page-title" }, settingsRoute ? (SETTINGS_SECTION_TITLES[settingsRoute] || "Settings") : "Settings"),
          h(
            "button",
            { className: "stk-page-x", title: "Close settings", onClick: () => { setTab("home"); goTo(""); } },
            h(Icon, { name: "x", size: 18 })
          )
        ),
        h(SettingsPanel, {
          cfg,
          prefs,
          setPref,
          feeds,
          section: settingsRoute,
          onSection: openSection,
          onRunSetup: () => setSetupOpen(true),
          onOpenOps: () => {
            setTab("ops");
            goTo("ops");
          },
          feedDraft: feedDraftRef.current,
          onBack: backSection,
          onDraftFeed: (next) => { feedDraftRef.current = next; },
          onEditFeed: (spec) => {
            feedDraftRef.current = spec || null;
            openSection("feeds/new-feed");
          },
          onSaveFeed: (spec) => { feedDraftRef.current = null; saveFeed(spec); },
          onDeleteFeed: (id) => { feedDraftRef.current = null; deleteFeed(id); openSection("feeds"); },
          onOpenHistory: (row) => {
            if (!/^\d+$/.test(row.id)) return;
            historyClipRef.current = row;
            goTo("clip/" + row.id);
          },
          pin,
          onSetPin: savePin,
          onClearPin: () => savePin(""),
          sfw,
          onToggleSfw: setSfwMode,
        })
      );
    } else if (tab === "clip" && clipScene) {
      /* One scene, opened from the highlight reel's Full Scene: the same card a
         performer page opens, but a page of its own - no bottom nav, no gear, and
         nothing to swipe to. Back (history, i.e. the reel) is the only way out. */
      body = h(FeedView, {
        key: "clip:" + clipScene + ":" + refreshKey,
        desktop,
        prefs,
        spec: {
          id: "clip-" + clipScene,
          name: "Scene",
          type: "scene",
          sceneId: clipScene,
          startAt: historyClipRef.current?.id === clipScene ? historyClipRef.current.time : undefined,
          single: true,
          sort: "date",
          origin: { kind: "clip", sceneId: clipScene },
        },
        cfg,
        refreshKey,
        onOpenPerformer: openProfile,
        onOpenTag: openTagPage,
        feeds,
        onBack: () => {
          if (window.history.length > 1) {
            window.history.back();
            return;
          }
          goTo("");
        },
      });
    } else {
      body = h(FeedView, {
        key: activeFeed.id + ":" + refreshKey,
        desktop,
        prefs,
        spec: activeFeed,
        cfg: Object.assign({}, cfg, {
          windowDays: prefs.feedWindow === "all" ? 0 : Number(prefs.feedWindow) || 0,
          foryouTags: prefs.foryouTags || [],
          foryouTagMode: prefs.foryouTagMode || "OR",
          favoriteTags: prefs.favoriteTags || [],
          foryouAlgo: prefs.favoritesAlgo || {},
          foryouPerformers: prefs.foryouPerformers || DEFAULT_PERFORMER_SCOPE,
          genders: prefs.genders || [],
        }),
        refreshKey,
        onMenu: () => setNavOpen(true),
        onSearch: () => {
          setTab("search");
          goTo("search");
        },
        onSettings: () => {
          setTab("settings");
          goTo("settings");
        },
        onOpenPerformer: openProfile,
        onOpenTag: openTagPage,
        onDeriveFeed: useFeed,
        onEditFeed: (spec) => setBuilder({ spec }),
        onOpenFolderProfile: (target) => {
          if (!target || !target.folder) return;
          setFolderProfile(target.folder);
          setTab("folderProfile");
          goTo("folder/" + encodeURIComponent(target.folder));
        },
        onOpenFolder: (target) => {
          setFolderView(Object.assign({ view: "gallery" }, target));
          setTab("folder");
        },
        feeds,
        onSwitchFeed: useFeed,
        onDuo: () => {
          /* a fresh shuffle each time the split opens, shared by both panes */
          FEED_SHARED.clear();
          setDuo(true);
        },
        onNewFeed: () => setBuilder({ spec: null }),
        onManageFeeds: () => {
          setTab("settings");
          goTo("settings/feeds");
        },
        onBack: () => {
          /* go back the way the user came: same page entry, same scroll, no reload */
          if (NAV_DEPTH > 0) {
            window.history.back();
            return;
          }
          const origin = (activeFeed && activeFeed.origin) || null;
          if (origin && origin.kind === "performer" && origin.performer) {
            openProfile(origin.performer, false);
            goTo("performers/" + encodeURIComponent(origin.performer.name), true);
            return;
          }
          if (origin && origin.kind === "favorites") {
            setTab("favorites");
            goTo("favorites", true);
            return;
          }
          if (origin && origin.kind === "markers") {
            setTab("markers");
            goTo("markers", true);
            return;
          }
          if (origin && origin.kind === "tag") {
            setTab("tags");
            goTo("tags", true);
            return;
          }
          if (origin && origin.kind === "folder" && origin.folder) {
            setFolderProfile(origin.folder);
            setTab("folderProfile");
            goTo("folder/" + encodeURIComponent(origin.folder), true);
            return;
          }
          goHome();
        },
      });
    }

    /* What the shell is showing right now — the key the page wrapper fades on. Only
       identity changes belong here: a sub-page swap inside one tab (a settings
       section, a tag's own page) must fade without remounting the page's component. */
    const pageSwapKey = [
      tab,
      settingsRoute,
      clipScene || "",
      favRow || "",
      tagProfile ? tagProfile.id : "",
      folderView ? folderView.folder : "",
      folderProfile || "",
      duo ? "duo" : "",
    ].join("|");

    const feedOptionRows = [
      {
        id: "all",
        label: "All videos",
        note: "default",
        run: () => {
          setActiveFeed(Object.assign({}, defaultFeed(), { windowDays: 0, minDuration: 0 }));
          setRefreshKey((n) => n + 1);
          setTab("home");
          goTo("");
        },
      },
      {
        id: "new30",
        label: "New videos",
        note: "last 30 days",
        run: () => {
          setActiveFeed(Object.assign({}, defaultFeed(), { windowDays: 30, minDuration: 0 }));
          setRefreshKey((n) => n + 1);
          setTab("home");
          goTo("");
        },
      },
      {
        id: "shuffle",
        label: "Re-shuffle",
        note: "same filters, new order",
        run: () => {
          shuffleActiveFeed();
          setTab("home");
          goTo("");
        },
      },
      {
        id: "long",
        label: "Long videos only",
        note: "15 minutes and up",
        run: () => {
          setActiveFeed(Object.assign({}, defaultFeed(), { windowDays: 0, minDuration: 900 }));
          setRefreshKey((n) => n + 1);
          setTab("home");
          goTo("");
        },
      },
    ];

    if (!routed) {
      return h(
        "div",
        {
          className: "stash-tok-wrap" + (desktop ? " stk-desktop" : ""),
          style: { background: "#101010" },
        },
        h("div", { className: "stk-fixed", style: { background: "#101010" } })
      );
    }

    /* setup takes the whole screen: mounting the feed behind it would fire the
       first dozen queries for a source the user is about to change */
    if (setupOpen) {
      return h(SetupWizard, {
        cfg: baseCfg,
        loaded: cfgLoaded,
        onDone: finishSetup,
        onSkip: skipSetup,
      });
    }

    return h(
      "div",
      {
        className:
          "stash-tok-wrap" +
          (locked ? " stk-locked" : "") +
          (sfw ? " stk-sfw" : "") +
          (prefs.mono ? " stk-mono" : "") +
          (desktop ? " stk-desktop" : "") +
          (tablet ? " stk-tablet" : "") +
          (railMin ? " stk-rail-min" : ""),
        ref: shellRef,
      },
      h(
        "div",
        {
          className: "stk-fixed",
          style: { position: "fixed", inset: 0, zIndex: 9000, display: "flex", flexDirection: "column", background: "#000" },
        },
        desktop &&
          h(
            "aside",
            {
              className: "stk-desk-rail" + (railMin ? " stk-min" : ""),
            },
            h(
              "div",
              { className: "stk-desk-logo" },
              h("span", { className: "stk-desk-mark" }, "S"),
              h("span", { className: "stk-desk-word" }, "StashTok"),
              h(
                "button",
                {
                  className: "stk-desk-pin" + (railPin ? " stk-on" : ""),
                  title: railPin ? "Collapse the sidebar to icons" : "Keep the sidebar open",
                  "aria-label": railPin ? "Collapse the sidebar" : "Pin the sidebar",
                  "aria-expanded": railPin ? "true" : "false",
                  onClick: toggleRailPin,
                },
                h(Icon, { name: "chevron", size: 14 })
              )
            ),
            railItems.map(([id, label, icon]) =>
              h(
                "button",
                {
                  key: id,
                  className: "stk-desk-link" +
                    ((id === "feed" && tab === "home") || tab === id ? " stk-on" : ""),
                  title: railMin ? label : undefined,
                  "data-label": label,
                  "aria-label": label,
                  onClick: () => (id === "feed" ? goHome() : runNav(id)),
                },
                h(Icon, { name: icon, size: 18 }),
                h("span", { className: "stk-desk-label" }, label)
              )
            )
          ),
        duo
          ? h(
              "div",
              { className: "stk-duo" },
              [0, 1].map((side) =>
                h(
                  "div",
                  { className: "stk-duo-pane", key: "gd" + side },
                  h(FeedView, {
                    key: "gd" + side + ":" + refreshKey,
                    duo: true,
                    desktop: false,
                    prefs,
                    cfg: Object.assign({}, cfg, { windowDays: 0 }),
                    spec: { id: "gd" + side, cacheKey: "gd", parity: side, name: side === 0 ? "Feed A" : "Feed B", type: "foryou", sort: "random" },
                    refreshKey,
                    feeds,
                    onOpenPerformer: openProfile,
                    onDeriveFeed: useFeed,
                    onSwitchFeed: useFeed,
                    onNewFeed: () => setBuilder({ spec: null }),
                    onDuo: () => setDuo(false),
                    onBack: () => setDuo(false),
                  })
                )
              ),
              h(
                "button",
                { className: "stk-duo-exit", onClick: () => setDuo(false) },
                h(Icon, { name: "x", size: 14 }),
                "Gooners Delight"
              )
            )
          : h(
              PageSwap,
              { swapKey: pageSwapKey, tab: NAV_TABS.indexOf(tab) >= 0 },
              body
            ),

        /* one settings entry point for every screen that isn't the feed itself */
        tab !== "settings" && tab !== "ops" &&
          tab !== "home" && tab !== "folderProfile" && !profileOpen &&
          h(
            "button",
            {
              className: "stk-gear-fab",
              title: "Settings",
              onClick: () => {
                setTab("settings");
                goTo("settings");
              },
            },
            h(Icon, { name: "gear", size: 18 })
          ),

                /* the bottom nav belongs to the main pages only: a performer page,
           a folder page, or any feed opened from one is a drill-down, and the
           nav there is just clutter on top of the thing you went in to look at */
                /* the drawer: the app's own destinations, out of the way until asked for */
                navOpen &&
                  h(
                    "div",
                    { className: "stk-drawer-scrim", onClick: () => setNavOpen(false) },
                    h(
                      "aside",
                      {
                        className: "stk-drawer",
                        onClick: (event) => event.stopPropagation(),
                      },
                      h(
                        "div",
                        { className: "stk-drawer-head" },
                        h("div", { className: "stk-drawer-title" }, "StashTok"),
                        h(
                          "button",
                          {
                            className: "stk-drawer-close",
                            title: "Close menu",
                            "aria-label": "Close menu",
                            onClick: () => setNavOpen(false),
                          },
                          h(Icon, { name: "x", size: 18 })
                        )
                      ),
                      [
                        ["home", "Feed", "play"],
                        ["discover", "Discover", "sparkle"],
                        ["performers", "Performers", "user"],
                        ["favorites", "Favorites", "heart"],
                        ["tags", "Tags", "tag"],
                        ["markers", "Markers", "chapter"],
                        ["search", "Search", "search"],
                        ["settings", "Settings", "gear"],
                      ].map((row) =>
                        h(
                          "button",
                          {
                            key: row[0],
                            className: "stk-drawer-row" + (tab === row[0] ? " stk-on" : ""),
                            onClick: () => {
                              setNavOpen(false);
                              if (row[0] === "home") {
                                setPerformerFilter(null);
                                setActiveFeed(defaultFeed());
                              }
                              setTab(row[0]);
                              goTo(row[0] === "home" ? "" : row[0]);
                            },
                          },
                          h(Icon, { name: row[2], size: 18 }),
                          h("span", null, row[1])
                        )
                      )
                    )
                  ),

                !(
                  performerFilter ||
                  profileOpen ||
                  folderProfile ||
                  tab === "folder" ||
                  tab === "folderProfile" ||
                  (tab === "home" && activeFeed && activeFeed.origin)
                ) &&
                h(
          "nav",
          { className: "stk-nav" },
          (tab === "home" || tab === "feed") &&
            h("div", {
              className: "stk-nav-scrub",
              onPointerDown: (event) => {
                event.stopPropagation();
                document.dispatchEvent(new CustomEvent("stashtok-scrub", { detail: { x: event.clientX } }));
              },
            }),
          h(NavButton, {
            active: tab === "home" && activeFeed.type !== "performer",
            icon: "play",
            label: "Feed",
            onClick: goHome,
            onLongPress: () => setFeedOptions(true),
          }),
          navSlots.map((id, slot) => navSlotButton(id, slot))
        ),

        feedOptions &&
          h(
            React.Fragment,
            null,
            h("div", { className: "stk-sheet-backdrop", onClick: () => setFeedOptions(false) }),
            h(
              "div",
              { className: "stk-sheet", ref: feedOptionsRef, onClick: (event) => event.stopPropagation() },
              h(
                "h3",
                null,
                h("span", null, "Feed"),
                h("button", { className: "stk-btn", onClick: () => setFeedOptions(false) }, h(Icon, { name: "x", size: 16 }))
              ),
              h("p", { className: "stk-sub" }, "Long-press Feed to pick what it shows."),
              feedOptionRows.map((row) =>
                h(
                  "button",
                  {
                    key: row.id,
                    className: "stk-marker-row",
                    onClick: () => {
                      setFeedOptions(false);
                      row.run();
                    },
                  },
                  h("span", null, row.label),
                  h("small", null, row.note)
                )
              )
            )
          ),

        navPicker &&
          h(
            React.Fragment,
            null,
            h("div", { className: "stk-sheet-backdrop", onClick: () => setNavPicker(null) }),
            h(
              "div",
              { className: "stk-sheet", ref: navPickerRef, onClick: (event) => event.stopPropagation() },
              h(
                "h3",
                null,
                h("span", null, "Navigation button"),
                h("button", { className: "stk-btn", onClick: () => setNavPicker(null) }, h(Icon, { name: "x", size: 16 }))
              ),
              h("p", { className: "stk-sub" }, "Long-press any nav button except Feed to change what it opens."),
              NAV_OPTIONS.map((option) =>
                h(
                  "button",
                  {
                    key: option.id,
                    className: "stk-marker-row" + (option.id === navPicker.id ? " stk-on" : ""),
                    onClick: () => {
                      const next = navSlots.slice();
                      next[navPicker.slot] = option.id;
                      setPref("navSlots", next);
                      setNavPicker(null);
                    },
                  },
                  h(Icon, { name: option.icon, size: 15 }),
                  option.label,
                  h("span", null, option.id === navPicker.id ? "current" : "")
                )
              )
            )
          ),

        tab !== "settings" && tab !== "home" && tab !== "feed" &&
          h(
            "button",
            {
              className: "stk-gear-fab",
              onClick: () => {
                setTab("settings");
                goTo("settings");
              },
            },
            h(Icon, { name: "gear", size: 17 })
          ),

        builder &&
          h(FeedBuilder, {
            spec: builder.spec || null,
            feeds,
            onSave: saveFeed,
            onUse: useFeed,
            onDelete: deleteFeed,
            onClose: () => setBuilder(null),
          }),

        h("div", { className: "stk-lock-cover", ref: coverRef, style: locked ? { visibility: "visible", opacity: 1 } : undefined }),

        locked &&
          pin &&
          h(LockScreen, {
            stored: pin,
            onUnlock: () => {
              const cover = coverRef.current;
              if (cover) {
                cover.style.visibility = "hidden";
                cover.style.opacity = "0";
              }
              setLocked(false);
              const video = document.querySelector(".stk-video.stk-active");
              if (video) video.play().catch(() => {});
            },
          })
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* registration                                                       */
  /* ------------------------------------------------------------------ */

  api.register.route(ROUTE, StashTokApp);
  LEGACY_ROUTES.forEach((route) => api.register.route(route, StashTokApp));

  api.patch.before("MainNavBar.MenuItems", function (props) {
    const Nav = api.libraries.Bootstrap.Nav;
    const NavLink = RouterDOM.NavLink;
    if (!NavLink) return [props];
    return [
      {
        children: h(
          React.Fragment,
          null,
          props.children,
          h(
            Nav.Link,
            { as: "div", key: "stash-tok-nav", className: "col-4 col-sm-3 col-md-2 col-lg-auto" },
            h(
              NavLink,
              {
                to: ROUTE,
                className: "btn minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center",
                activeClassName: "active",
              },
              h(Icon, { name: "play", size: 18, className: "nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0" }),
              h("span", null, "StashTok")
            )
          )
        ),
      },
    ];
  });

  function PluginSettingsHost({ children }) {
    const [feeds, setFeeds] = useState(() => loadFeeds());
    const [builder, setBuilder] = useState(null);

    function saveFeed(spec) {
      const next = Object.assign({ id: spec.id || "f" + Date.now(), name: spec.name || "Feed" }, spec);
      const list = feeds.filter((feed) => feed.id !== next.id).concat([next]);
      setFeeds(list);
      saveFeeds(list);
      setBuilder(null);
    }

    function deleteFeed(id) {
      const list = feeds.filter((feed) => feed.id !== id);
      setFeeds(list);
      saveFeeds(list);
      setBuilder(null);
    }

    return h(
      React.Fragment,
      null,
      children,
      h(SettingsPanel, { cfg: null, feeds, onEdit: (spec) => { setBuilder({ spec }); setTab("home"); goTo(""); } }),
      builder &&
        h(FeedBuilder, {
          spec: builder.spec || null,
          feeds,
          onSave: saveFeed,
          onUse: saveFeed,
          onDelete: deleteFeed,
          onClose: () => setBuilder(null),
        })
    );
  }

  api.patch.after("PluginSettings", function () {
    const args = Array.prototype.slice.call(arguments);
    const props = args[0];
    const result = args[args.length - 1];
    if (!props || props.pluginID !== PLUGIN_ID) return result;
    return h(
      React.Fragment,
      null,
      result,
      h("div", { className: "stash-tok-settings-host", "data-plugin": PLUGIN_ID }, h(PluginSettingsHost, null, null))
    );
  });

  window.StashTok = { version: "0.1.1", feeds: loadFeeds };
})();
