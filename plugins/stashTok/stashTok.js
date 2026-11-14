/*
 * StashTok — a full-screen, TikTok-style vertical feed for Stash.
 *
 * Feeds: For You (random), Favorites, one or many tags, performer, markers,
 * fresh (never played), shorts, portrait-only, and any saved Stash filter.
 * Gestures: swipe up/down, tap pause, long-press centre = actions,
 * hold right = fast-forward, hold left = rewind, pinch = zoom (video only),
 * double-tap = heart, drag the scrub bar to seek.
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
  const { useState, useEffect, useRef, useCallback } = React;
  const RouterDOM = api.libraries.ReactRouterDOM || {};
  const Link = RouterDOM.Link || "a";

  const PLUGIN_ID = "stashTok";
  const ROUTE = "/stash-tok";
  const LEGACY_ROUTE = "/plugin/stashTok";
  const FEEDS_KEY = "stashTok.feeds.v1";
  const PAGE_SIZE = 8;
  const HOLD_MS = 380;
  const SWIPE_PX = 70;
  const MAX_ZOOM = 8;
  const HEART_POP_MS = 700;

  /* ------------------------------------------------------------------ */
  /* icons                                                              */
  /* ------------------------------------------------------------------ */

  const ICONS = {
    home: "M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5",
    heart: "M12 20.5S3.5 15 3.5 9.4A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 8.5 3c0 5.6-8.5 11.1-8.5 11.1z",
    user: "M4.5 21a7.5 7.5 0 0 1 15 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    tag: "M3.5 11.5v8a1 1 0 0 0 1 1h8L21 12 12 3l-8.5 8.5zM7.5 8.5h.01",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 8L4.2 8a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.3V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4.9z",
    play: "M8 5.5v13l11-6.5-11-6.5z",
    pause: "M9 5v14M15 5v14",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.6h.01",
    volume: "M4 9.5v5h3.5L12 19V5L7.5 9.5H4zM16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12",
    mute: "M4 9.5v5h3.5L12 19V5L7.5 9.5H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
    flag: "M5 21V4M5 4h11l-1.5 4L16 12H5",
    x: "M6 6l12 12M18 6 6 18",
    plus: "M12 5v14M5 12h14",
    chevron: "M9 6l6 6-6 6",
    sort: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5 16 16",
    folder: "M3.5 7.5A1.5 1.5 0 0 1 5 6h3.6l1.9 2.4H19a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V7.5z",
    sparkle: "M12 3.5 13.8 9l5.7 1.8L13.8 13 12 18.5 10.2 13 4.5 10.8 10.2 9 12 3.5z",
    rotate: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4",
  };

  function Icon({ name, size = 22, className = "" }) {
    return h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: name === "heart" ? 1.8 : 1.7,
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

  let flagTagId = null;

  async function ensureFlagTag(name) {
    if (flagTagId) return flagTagId;
    const found = await gql(
      `query StashTokFindFlagTag($q: String) { findTags(filter: { q: $q, per_page: 20 }) { tags { id name } } }`,
      { q: name }
    );
    const exact = ((found.findTags && found.findTags.tags) || []).find(
      (tag) => tag.name.toLowerCase() === name.toLowerCase()
    );
    if (exact) {
      flagTagId = exact.id;
      return flagTagId;
    }
    const created = await gql(
      `mutation StashTokMakeFlagTag($name: String!) { tagCreate(input: { name: $name }) { id name } }`,
      { name }
    );
    flagTagId = created.tagCreate.id;
    return flagTagId;
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
    details
    rating100
    o_counter
    play_count
    paths { stream preview screenshot }
    files { path size duration width height video_codec audio_codec frame_rate bit_rate }
    performers { id name image_path }
    studio { id name }
    tags { id name }
    scene_markers { id title seconds end_seconds primary_tag { id name } }
  `;

  function sceneFilterBody(spec, cfg) {
    const parts = [];
    const type = spec.type || "foryou";

    if (type !== "shorts" && Number(cfg.minDuration) > 0) {
      parts.push(`duration: { value: ${Number(cfg.minDuration)}, modifier: GREATER_THAN }`);
    }
    if (type === "favorites") {
      parts.push(`rating100: { value: 0, modifier: GREATER_THAN }`);
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
    if (spec.tags && spec.tags.length) {
      const modifier = spec.tagMode === "OR" ? "INCLUDES" : "INCLUDES_ALL";
      parts.push(
        `tags: { value: [${spec.tags.map((id) => `"${id}"`).join(",")}], modifier: ${modifier} }`
      );
    }
    return parts.join(", ");
  }

  function sortClause(spec) {
    const sort = spec.sort || (spec.type === "favorites" ? "rating" : "random");
    const direction = spec.direction || "DESC";
    return `sort: "${sort}", direction: ${direction}`;
  }

  async function fetchSceneFeed(spec, cfg, page) {
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
    return { count: 1, items: [{ key: "s" + scene.id, scene, startAt: Number(spec.startAt) || 0, endAt: 0 }] };
  }

  async function fetchMarkerFeed(spec, cfg, page) {
    const body = sceneFilterBody(spec, cfg);
    const sceneFilterArg = body ? `scene_filter: { ${body} }` : "";
    const query = `query StashTokMarkers($n: Int!, $page: Int!) {
      findSceneMarkers(
        filter: { per_page: $n, page: $page, sort: "random" }
        scene_marker_filter: { ${sceneFilterArg} }
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
    const markers = (data.findSceneMarkers && data.findSceneMarkers.scene_markers) || [];
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
    const match = window.location.pathname.match(/^(.*?\/stash-tok)(\/|$)/);
    return match ? match[1] : "/stash-tok";
  }

  function currentRoute() {
    return window.location.hash.replace(/^#\/?/, "");
  }

  function goTo(path, replace) {
    const clean = String(path || "").replace(/^\/+/, "");
    const next = clean ? "#/" + clean : "#/";
    if (window.location.hash === next) return;
    if (replace) window.history.replaceState({}, "", baseRoot() + next);
    else window.location.hash = next;
  }

  function fetchFeedPage(spec, cfg, page) {
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
      // 10s keeps 2-second clips out without cutting whole folders
      minDuration: raw.minDuration == null ? 10 : Number(raw.minDuration),
    };
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

  /** Play, but never start before a pending seek has landed: that race is the black flash. */
  function seekThenPlay(video, startAt, playVideo) {
    const start = Number(startAt) || 0;
    const duration = video.duration || 0;
    if (start > 0 && duration && start < duration && Math.abs(video.currentTime - start) > 1) {
      try {
        video.currentTime = start;
      } catch (e) {
        /* ignore */
      }
      video.addEventListener("seeked", () => playVideo(video), { once: true });
      return;
    }
    playVideo(video);
  }

  function FeedView({ spec, cfg, refreshKey, onBack, onSearch, onSettings, onOpenPerformer, onOpenTag, onDeriveFeed, onEditFeed, onOpenFolder, feeds, onSwitchFeed, onNewFeed }) {
    const [items, setItems] = useState([]);
    const [index, setIndex] = useState(0);
    const [count, setCount] = useState(0);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState(false);
    const [ready, setReady] = useState(false);
    const [streamFallback, setStreamFallback] = useState(false);
    const [failCount, setFailCount] = useState(0);
    const [rotation, setRotation] = useState(0);
    const [speed, setSpeed] = useState(() => Number(window.localStorage.getItem("stashTok.speed")) || 1);
    const [muted, setMuted] = useState(cfg.autoplayMuted);
    const [hud, setHud] = useState(true);
    const [hudTick, setHudTick] = useState(0);
    const [sheet, setSheet] = useState(null); // 'actions' | 'details'
    const [rating, setRating] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [scrubbing, setScrubbing] = useState(false);
    const [scrubTime, setScrubTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [time, setTime] = useState(0);
    const [rateBadge, setRateBadge] = useState("");
    const [heartBurst, setHeartBurst] = useState(0);
    const [dragY, setDragY] = useState(0);

    const stageRef = useRef(null);
    const videoRef = useRef(null);
    const wrapRef = useRef(null);
    const pageRef = useRef(1);
    const busyRef = useRef(false);
    const exhaustedRef = useRef(false);
    const pts = useRef(new Map());
    const gesture = useRef(null);
    const holdTimer = useRef(null);
    const tapTimer = useRef(null);
    const lastTapAt = useRef(0);
    const rafRef = useRef(0);
    const tf = useRef({ s: 1, x: 0, y: 0 });

    const item = items[index] || null;
    const [, setRootsReady] = useState(0);

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
          const result = await fetchFeedPage(spec, cfg, page);
          setCount(result.count);
          if (reset) {
            pageRef.current = 2;
            exhaustedRef.current = result.items.length === 0;
            let list = result.items.slice();
            if (spec.startSceneId) {
              // open on the scene the user tapped, wherever it sits in the list
              const at = list.findIndex((entry) => String(entry.scene.id) === String(spec.startSceneId));
              if (at > 0) list.unshift(list.splice(at, 1)[0]);
              else if (at < 0) {
                // it may not be on page 1 at all: fetch it and lead with it
                try {
                  const single = await fetchSceneById({ sceneId: spec.startSceneId, startAt: spec.startAt });
                  if (single.items.length) list.unshift(single.items[0]);
                } catch (err) {
                  /* fall through to the normal order */
                }
              }
            }
            if (reset && spec.startAt && list.length) list[0] = Object.assign({}, list[0], { startAt: spec.startAt });
            setItems(list);
            setIndex(0);
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

    useEffect(() => {
      pageRef.current = 1;
      exhaustedRef.current = false;
      setItems([]);
      setIndex(0);
      loadPage(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spec.id, spec.type, refreshKey, cfg.heartRating, cfg.source]);

    useEffect(() => {
      const stage = stageRef.current;
      if (stage) {
        Array.from(stage.querySelectorAll("video")).forEach((video) => {
          if (video.classList.contains("stk-active")) {
            const start = Number(item && item.startAt) || 0;
            if (video.paused) {
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
      if (spec.type === "performer") target = "performer/" + encodeURIComponent(spec.name) + "/" + sceneId;
      else if (spec.type === "scene") target = "scene/" + sceneId;
      if (!target) return;
      if (currentRoute() !== target) goTo(target, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item && item.scene && item.scene.id, spec.type, spec.name]);

    useEffect(() => {
      if (item) setRating(item.scene.rating100 == null ? null : Number(item.scene.rating100));
      setReady(false);
      setStreamFallback(false);
    }, [item && item.key]);

    /* ---- video ----------------------------------------------------- */

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !item) return;
      const start = Number(item.startAt) || 0;
      const onLoaded = () => {
        setDuration(video.duration || 0);
        seekThenPlay(video, start, playGuarded);
      };
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("canplay", onLoaded);
      return () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("canplay", onLoaded);
        video.pause();
      };
    }, [item && item.key]);

    /* play/pause is driven directly on the active element: a state-driven pause
       races the layer swap and kills the incoming video */

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      video.muted = muted;
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
      const video = videoRef.current;
      if (video && !rateBadge) video.playbackRate = speed;
      try {
        window.localStorage.setItem("stashTok.speed", String(speed));
      } catch (e) {
        /* ignore */
      }
    }, [speed, index]);

    /** the scale at which the video covers the stage, i.e. a pinch-fill */
    function coverScale() {
      const video = videoRef.current;
      const stage = stageRef.current;
      if (!video || !stage) return 1;
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const ew = stage.clientWidth || 1;
      const eh = stage.clientHeight || 1;
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
      tf.current = { s: target, x: 0, y: 0 };
      applyTransform();
      buzz(6);
    }

    function flagCurrent() {
      if (!item) return;
      setSheet(null);
      flagScene(item.scene, cfg)
        .then(() => {
          buzz(40);
          goNext();
        })
        .catch(() => {});
    }

    function rotate(delta) {
      setRotation((value) => (value + delta + 360) % 360);
      buzz(8);
    }

    /* ---- hud auto hide --------------------------------------------- */

    const poke = useCallback(() => {
      setHud(true);
      setHudTick((n) => n + 1);
    }, []);

    useEffect(() => {
      if (!playing || sheet || scrubbing) return;
      const timer = window.setTimeout(() => setHud(false), 3200);
      return () => window.clearTimeout(timer);
    }, [playing, sheet, scrubbing, hudTick, index]);

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

    const applyTransform = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      const { s, x, y } = tf.current;
      video.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
      video.style.transition = "none";
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

    /* ---- navigation ------------------------------------------------ */

    const loopCurrent = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = item && item.startAt ? item.startAt : 0;
      playGuarded(video);
    }, [item]);

    const goNext = useCallback(() => {
      resetZoom();
      setDragY(0);
      setSheet(null);
      setPlaying(true);
      setIndex((i) => (i + 1 < items.length ? i + 1 : 0));
    }, [resetZoom, items.length]);

    const goPrev = useCallback(() => {
      resetZoom();
      setDragY(0);
      setSheet(null);
      setPlaying(true);
      setIndex((i) => Math.max(0, i - 1));
    }, [resetZoom]);

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

    /* ---- hold to speed -------------------------------------------- */

    const stopHold = useCallback(() => {
      const video = videoRef.current;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (video) video.playbackRate = speed;
      setRateBadge("");
    }, []);

    const startHold = useCallback(
      (side) => {
        const video = videoRef.current;
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

    function onPointerDown(event) {
      if (sheet) return;
      // a tap on a rail button / HUD must not also toggle playback
      if (event.target && event.target.closest && event.target.closest("button, input, .stk-rail, .stk-nav, .stk-timeline, .stk-sheet, .stk-top, a")) return;
      const stage = stageRef.current;
      if (!stage) return;
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
        };
        return;
      }

      const rect = stage.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / rect.width;
      const side = relX < 0.32 ? "left" : relX > 0.68 ? "right" : "center";
      gesture.current = {
        mode: "press",
        side,
        x0: event.clientX,
        y0: event.clientY,
        t0: performance.now(),
        moved: false,
        startTime: videoRef.current ? videoRef.current.currentTime : 0,
        seekTo: null,
      };
      window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => {
        if (gesture.current && !gesture.current.moved && gesture.current.mode === "press") {
          gesture.current.mode = "hold";
          startHold(gesture.current.side);
        }
      }, HOLD_MS);
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
        const [a, b] = Array.from(pts.current.values());
        const ratio = dist(a, b) / g.d0;
        const next = clamp(g.s0 * ratio, 1, MAX_ZOOM);
        const scaleRatio = next / g.s0;
        tf.current.s = next;
        tf.current.x = g.cx - (g.cx - g.x0) * scaleRatio;
        tf.current.y = g.cy - (g.cy - g.y0) * scaleRatio;
        clampPan();
        applyTransform();
        return;
      }

      if (g.mode === "hold") return;

      const dx = event.clientX - g.x0;
      const dy = event.clientY - g.y0;
      if (!g.moved && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        g.moved = true;
        window.clearTimeout(holdTimer.current);
      }
      if (!g.moved) return;

      if (g.mode === "press") {
        if (tf.current.s > 1.02) {
          g.mode = "pan";
          g.panX = tf.current.x;
          g.panY = tf.current.y;
        } else if (Math.abs(dy) > Math.abs(dx)) {
          g.mode = "swipe";
        } else {
          g.mode = "seek";
        }
      }

      if (g.mode === "pan") {
        tf.current.x = g.panX + dx;
        tf.current.y = g.panY + dy;
        clampPan();
        applyTransform();
      } else if (g.mode === "swipe") {
        setDragY(dy);
      } else if (g.mode === "seek") {
        const rect = stage.getBoundingClientRect();
        const span = Math.min(duration || 600, 600);
        const target = clamp(g.startTime + (dx / rect.width) * span, 0, duration || 0);
        g.seekTo = target;
        setScrubTime(target);
        setScrubbing(true);
        if (videoRef.current) videoRef.current.currentTime = target;
      }
    }

    function onPointerUp(event) {
      if (event.target && event.target.closest && event.target.closest("button, input, .stk-rail, .stk-nav, .stk-timeline, .stk-sheet, .stk-top, a")) return;
      const g = gesture.current;
      window.clearTimeout(holdTimer.current);
      if (g && g.mode === "hold") stopHold();

      const remaining = pts.current.size;
      pts.current.delete(event.pointerId);
      if (g && g.mode === "pinch") {
        if (pts.current.size < 2) gesture.current = null;
        return;
      }
      if (!g) return;
      gesture.current = null;

      if (g.mode === "press" && !g.moved) {
        const video = videoRef.current;
        if (!video) return;
        if (tf.current.s > 1.02) {
          resetZoom();
          return;
        }
        const now = performance.now();
        const isDouble = lastTapAt.current && now - lastTapAt.current < 280;
        lastTapAt.current = isDouble ? 0 : now;
        if (isDouble) {
          // second tap: undo the toggle the first tap applied, then fill the frame
          if (video.paused) playGuarded(video);
          else {
            video.pause();
            setPlaying(false);
          }
          toggleFill();
          return;
        }
        // toggle immediately: waiting for a double-tap timer puts play() outside
        // the user gesture, and the browser then refuses to start playback
        if (video.paused) playGuarded(video);
        else {
          video.pause();
          setPlaying(false);
        }
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
        } else {
          // slide the strip all the way out, then swap underneath it
          wrap.style.transition = "transform 180ms ease-out";
          setDragY(direction > 0 ? -height : height);
          window.setTimeout(() => {
            if (direction > 0) goNext();
            else goPrev();
            wrap.style.transition = "none";
            setDragY(0);
            requestAnimationFrame(() => {
              wrap.style.transition = "";
            });
          }, 180);
        }
      }
      if (g.mode === "seek") setScrubbing(false);
      if (g.mode === "pan") poke();
      poke();
    }

    /* ---- timeline -------------------------------------------------- */

    function seekFromEvent(event) {
      const video = videoRef.current;
      const bar = event.currentTarget.querySelector(".stk-timeline-inner") || event.currentTarget;
      const rect = bar.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const total = duration || (video && video.duration) || 0;
      const target = ratio * total;
      if (video) video.currentTime = target;
      setScrubTime(target);
      return target;
    }

    function onTimelineDown(event) {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setScrubbing(true);
      poke();
      seekFromEvent(event);
    }

    function onTimelineMove(event) {
      if (!scrubbing) return;
      event.stopPropagation();
      seekFromEvent(event);
    }

    function onTimelineUp(event) {
      event.stopPropagation();
      setScrubbing(false);
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
      if (handle.folder) return onOpenFolder({ name: handle.name, folder: handle.folder });
      setSheet("details");
    }

    const onTimeUpdate = () => {
      const video = videoRef.current;
      if (!video) return;
      setTime(video.currentTime);
      if (!duration && video.duration) setDuration(video.duration);
    };

    /* ---- render ---------------------------------------------------- */

    if (failCount >= 8) {
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

    return h(
      "div",
      { className: "stash-tok stk-embedded" + (hud ? "" : " stk-hud-hidden") },
      h(
        "div",
        {
          className: "stk-stage",
          ref: stageRef,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onContextMenu: (event) => event.preventDefault(),
        },
        cfg.blurBackdrop &&
          h("div", {
            className: "stk-backdrop",
            style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` },
          }),
        h("div", { className: "stk-scan" }),

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
          [index - 1, index, index + 1, index + 2]
            .filter((at) => at >= 0 && items[at])
            .map((at) => {
              const entry = items[at];
              const active = at === index;
              const source = streamSource(entry.scene);
              return h("video", {
                key: entry.key,
                ref: active
                  ? videoRef
                  : (el) => {
                      if (el) prewarm(el, entry.startAt);
                    },
                className: "stk-video" + (active ? " stk-active" : ""),
                src: active && streamFallback ? source.signed : source.plain,
                playsInline: true,
                autoPlay: active,
                muted: active ? muted : true,
                preload: "auto",
                onCanPlay: active
                  ? () => {
                      setReady(true);
                      setFailCount(0);
                    }
                  : undefined,
                onTimeUpdate: active ? onTimeUpdate : undefined,
                onPlay: active ? () => setPlaying(true) : undefined,
                onPause: active ? () => setPlaying(false) : undefined,
                onEnded: active ? loopCurrent : undefined,
                onError: active
                  ? () => {
                      setPlaying(false);
                      if (!streamFallback) {
                        setStreamFallback(true);
                        return;
                      }
                      setFailCount((count) => count + 1);
                      window.setTimeout(goNext, 600);
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
                  objectFit: "contain",
                  opacity: 1,
                  pointerEvents: active ? "auto" : "none",
                  zIndex: active ? 2 : 1,
                },
              });
            }),
        ),


        onBack &&
          h("button", { className: "stk-feed-back", onClick: onBack }, h(Icon, { name: "chevron", size: 22 })),

        h(
          "div",
          { className: "stk-pause" + (!playing && ready ? " stk-show" : "") },
          h(Icon, { name: playing ? "pause" : "play", size: 32 })
        ),

        heartBurst > 0 &&
          h(
            "div",
            { key: heartBurst, className: "stk-big-heart stk-fire" },
            h(Icon, { name: "heart", size: 110 })
          ),

        rateBadge && h("div", { className: "stk-rate" }, rateBadge),

        h(
          "div",
          { className: "stk-top stk-top-center" },
          h(
            "button",
            {
              className: "stk-feed-pill",
              onClick: (event) => {
                event.stopPropagation();
                setSheet("feeds");
              },
            },
            h(Icon, { name: "sparkle", size: 11 }),
            spec.name || "For You",
            h(Icon, { name: "chevron", size: 10, className: "stk-pill-caret" })
          )
        ),

        h(
          "div",
          { className: "stk-top stk-top-right" },
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
          ),
          h(
            "button",
            {
              className: "stk-top-btn",
              onClick: (event) => {
                event.stopPropagation();
                if (onSettings) onSettings();
              },
            },
            h(Icon, { name: "gear", size: 18 })
          )
        ),

        h(
          "div",
          { className: "stk-info" },
          h(
            "div",
            { className: "stk-handle-row" },
            handle.image
              ? h("img", {
                  className: "stk-handle-avatar",
                  src: handle.image,
                  alt: "",
                  onClick: (event) => {
                    event.stopPropagation();
                    openHandle();
                  },
                })
              : h(
                  "button",
                  { className: "stk-handle-avatar stk-handle-initials", onClick: (event) => { event.stopPropagation(); openHandle(); } },
                  initials(handle.name)
                ),
            h(
              "button",
              { className: "stk-handle-name", onClick: (event) => { event.stopPropagation(); openHandle(); } },
              handle.name
            )
          ),
          performers.length > 1 &&
            h("div", { className: "stk-info-with" }, "with " + performers.slice(1, 4).map((performer) => performer.name).join(", ")),
          tags.length > 0 &&
            h(
              "div",
              { className: "stk-hashtags" },
              tags.slice(0, 8).map((tag) =>
                h(
                  "button",
                  {
                    key: tag.id,
                    className: "stk-hashtext",
                    onClick: (event) => {
                      event.stopPropagation();
                      onOpenTag(tag);
                    },
                  },
                  "#" + tag.name.replace(/\s+/g, "-").toLowerCase()
                )
              )
            )
        ),

        h(
          "div",
          { className: "stk-rail" },
          h(
            "button",
            {
              onClick: (event) => {
                event.stopPropagation();
                toggleHeart();
              },
              className: rating != null && rating >= cfg.heartRating ? "stk-on" : "",
            },
            h(Icon, { name: "heart", size: 26 }),
            h("span", null, "Heart")
          ),
          performers.length > 0 &&
            h(
              "button",
              {
                onClick: (event) => {
                  event.stopPropagation();
                  onOpenPerformer(performers[0]);
                },
              },
              h(Icon, { name: "user", size: 26 }),
              h("span", null, performers.length > 1 ? performers.length + " people" : "Performer")
            ),
          h(
            "button",
            {
              onClick: (event) => {
                event.stopPropagation();
                setMuted((value) => !value);
              },
            },
            h(Icon, { name: muted ? "mute" : "volume", size: 26 }),
            h("span", null, muted ? "Muted" : "Sound")
          ),
          h(
            "button",
            {
              onClick: (event) => {
                event.stopPropagation();
                setSheet("actions");
              },
            },
            h(Icon, { name: "sparkle", size: 26 }),
            h("span", null, speed === 1 ? "More" : speed + "x")
          )
        ),

        hud &&
          h(
            "div",
            { className: "stk-time" },
            `${fmtTime(time)} / ${fmtTime(duration)}${zoom > 1.02 ? ` · ${zoom.toFixed(1)}x` : ""}`
          ),

        h(
          "div",
          {
            className: "stk-timeline" + (scrubbing ? " stk-scrubbing" : ""),
            onPointerDown: onTimelineDown,
            onPointerMove: onTimelineMove,
            onPointerUp: onTimelineUp,
            onPointerCancel: onTimelineUp,
          },
          h(
            "div",
            { className: "stk-timeline-inner" },
            h("div", { className: "stk-timeline-fill", style: { width: `${scrubbingRatio * 100}%` } }),
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
            onClose: () => setSheet(null),
          }),

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
            onClose: () => setSheet(null),
            onOpenPerformer,
            onOpenTag,
            onDeriveFeed,
            onJump: (seconds) => {
              const video = videoRef.current;
              if (video) video.currentTime = seconds;
              setSheet(null);
              setPlaying(true);
            },
            onNext: goNext,
          })
      ),
    );
  }

  function NavButton({ active, icon, label, onClick }) {
    return h(
      "button",
      { className: active ? "stk-active" : "", onClick },
      h(Icon, { name: icon, size: 21 }),
      h("span", null, label)
    );
  }

  /* ------------------------------------------------------------------ */
  /* sheet                                                              */
  /* ------------------------------------------------------------------ */

  function FeedPicker({ feeds, current, onPick, onNew, onClose }) {
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
        { className: "stk-sheet", onClick: (event) => event.stopPropagation() },
        h(
          "h3",
          null,
          h("span", null, "Feeds"),
          h("button", { className: "stk-btn", onClick: onClose }, h(Icon, { name: "x", size: 16 }))
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

  function Sheet({ mode, item, cfg, rating, onRate, onHeart, speed, onSpeed, onRotate, onFlag, onClose, onOpenPerformer, onOpenTag, onDeriveFeed, onJump, onNext }) {
    const scene = item.scene;
    const file = (scene.files && scene.files[0]) || {};
    const markers = scene.scene_markers || [];
    const performers = scene.performers || [];
    const tags = scene.tags || [];
    const handle = resolveHandle(scene, file);
    const [draft, setDraft] = useState(rating == null ? 0 : rating);

    useEffect(() => {
      setDraft(rating == null ? 0 : rating);
    }, [rating]);

    return h(
      React.Fragment,
      null,
      h("div", { className: "stk-sheet-backdrop", onClick: onClose }),
      h(
        "div",
        { className: "stk-sheet", onClick: (event) => event.stopPropagation() },
        h(
          "h3",
          null,
          h("span", null, scene.title || (file.path || "").split("/").pop() || "Scene"),
          h("button", { className: "stk-btn", onClick: onClose }, h(Icon, { name: "x", size: 16 }))
        ),
        h(
          "div",
          { style: { color: "rgba(255,255,255,.5)", fontSize: "11px" } },
          [scene.date, scene.studio && scene.studio.name, file.width && `${file.width}x${file.height}`, fmtTime(file.duration)]
            .filter(Boolean)
            .join(" · ")
        ),

        h(
          "h4",
          null,
          "Rating"
        ),
        h(
          "div",
          { className: "stk-row", style: { display: "flex", alignItems: "center", gap: "10px" } },
          h(
            "button",
            { className: "stk-btn" + (rating != null && rating >= cfg.heartRating ? " stk-primary" : ""), onClick: onHeart },
            h(Icon, { name: "heart", size: 16 }),
            rating != null && rating >= cfg.heartRating ? "Hearted" : "Heart"
          ),
          h("input", {
            type: "range",
            min: 0,
            max: 100,
            step: 1,
            value: draft,
            style: { flex: "1 1 auto" },
            onChange: (event) => setDraft(Number(event.currentTarget.value)),
            onPointerUp: () => onRate(draft === 0 ? null : draft),
            onKeyUp: () => onRate(draft === 0 ? null : draft),
          }),
          h("b", { style: { fontVariantNumeric: "tabular-nums", fontSize: "12px" } }, draft || "—")
        ),

        h("h4", null, "Playback speed"),
        h(
          "div",
          { className: "stk-speed-row" },
          [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
            h(
              "button",
              {
                key: rate,
                className: "stk-tagpill" + (speed === rate ? " stk-speed-on" : ""),
                onClick: () => onSpeed(rate),
              },
              rate + "x"
            )
          )
        ),

        performers.length > 0 &&
          h(
            React.Fragment,
            null,
            h("h4", null, performers.length > 1 ? "Performers" : "Performer"),
            h(
              "div",
              { className: "stk-perf-row" },
              performers.map((performer) =>
                h(
                  "button",
                  { key: performer.id, className: "stk-chip", onClick: () => onOpenPerformer(performer) },
                  h("img", { src: rel(performer.image_path), alt: "" }),
                  h("span", null, performer.name)
                )
              )
            )
          ),

        tags.length > 0 &&
          h(
            React.Fragment,
            null,
            h("h4", null, "Tags"),
            h(
              "div",
              null,
              tags.map((tag) =>
                h(
                  "button",
                  { key: tag.id, className: "stk-tagpill", onClick: () => onOpenTag(tag) },
                  h(Icon, { name: "tag", size: 13 }),
                  tag.name
                )
              )
            )
          ),

        h(
          "div",
          { className: "stk-sheet-actions" },
          h(
            "a",
            { className: "stk-btn", href: `/scenes/${scene.id}`, target: "_blank", rel: "noopener noreferrer" },
            h(Icon, { name: "play", size: 16 }),
            "Whole scene"
          ),
          h(
            "button",
            { className: "stk-btn", onClick: () => onRotate(90) },
            h(Icon, { name: "rotate", size: 16 }),
            "Rotate"
          ),
          h(
            "button",
            { className: "stk-btn stk-btn-danger", onClick: onFlag },
            h(Icon, { name: "flag", size: 16 }),
            "Flag for deletion"
          ),
          h(
            "button",
            {
              className: "stk-btn",
              onClick: () =>
                onDeriveFeed({
                  type: "tags",
                  name: "More like this",
                  tags: tags.slice(0, 4).map((tag) => tag.id),
                  tagMode: "OR",
                }),
            },
            h(Icon, { name: "sparkle", size: 16 }),
            "More like this"
          ),
          h("button", { className: "stk-btn", onClick: onNext }, h(Icon, { name: "chevron", size: 16 }), "Next")
        ),

        markers.length > 0 &&
          h(
            React.Fragment,
            null,
            h("h4", null, `Markers (${markers.length})`),
            markers.map((marker) =>
              h(
                "button",
                { key: marker.id, className: "stk-marker-row", onClick: () => onJump(Number(marker.seconds)) },
                h("b", null, fmtTime(marker.seconds)),
                h("div", null, marker.primary_tag ? marker.primary_tag.name : "Marker", h("br"), h("span", null, marker.title || "")),
                h(Icon, { name: "play", size: 14 })
              )
            )
          ),

        mode === "details" &&
          h(
            React.Fragment,
            null,
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
            )
          )
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* library pages                                                      */
  /* ------------------------------------------------------------------ */

  const SCENE_SORTS = [
    ["updated_at", "Recently added"],
    ["duration", "Duration"],
    ["filesize", "File size"],
    ["resolution", "Resolution"],
    ["rating", "Favorites first"],
    ["title", "A–Z"],
    ["random", "Random"],
  ];

  function PerformerProfile({ performerId, onBack, onPlay, onOpenTag }) {
    const [performer, setPerformer] = useState(null);
    const [scenes, setScenes] = useState([]);
    const [markers, setMarkers] = useState([]);
    const [images, setImages] = useState([]);
    const [markerCount, setMarkerCount] = useState(null);
    const [tab, setTab] = useState("scenes");
    const [sort, setSort] = useState("updated_at");
    const [sortOpen, setSortOpen] = useState(false);
    const [density, setDensity] = useState(3);
    const [error, setError] = useState("");

    useEffect(() => {
      let alive = true;
      gql(
        `query StashTokPerformer($id: ID!) {
          findPerformer(id: $id) {
            id name alias_list image_path scene_count image_count gallery_count o_counter rating100 favorite
            birthdate country height_cm measurements
            tags { id name }
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
      const direction = sort === "title" ? "ASC" : "DESC";
      gql(
        `query StashTokPerformerScenes($id: ID!, $sort: String, $dir: SortDirectionEnum) {
          findScenes(scene_filter: { performers: { value: [$id], modifier: INCLUDES } },
                     filter: { per_page: 100, sort: $sort, direction: $dir }) {
            count
            scenes {
              id title date rating100
              paths { screenshot }
              files { duration size width height }
            }
          }
        }`,
        { id: performerId, sort, dir: direction }
      )
        .then((data) => alive && setScenes(data.findScenes.scenes))
        .catch(() => alive && setScenes([]));
      return () => {
        alive = false;
      };
    }, [performerId, sort]);

    useEffect(() => {
      if (tab !== "images") return undefined;
      let alive = true;
      gql(
        `query StashTokPerformerImages($id: ID!, $sort: String) {
          findImages(image_filter: { performers: { value: [$id], modifier: INCLUDES } },
                     filter: { per_page: 60, sort: $sort, direction: DESC }) {
            count
            images { id title paths { thumbnail } }
          }
        }`,
        { id: performerId, sort: sort === "filesize" || sort === "resolution" ? sort : "updated_at" }
      )
        .then((data) => alive && setImages(data.findImages.images || []))
        .catch(() => alive && setImages([]));
      return () => {
        alive = false;
      };
    }, [performerId, tab, sort]);

    async function toggleFollow() {
      if (!performer) return;
      const next = !performer.favorite;
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

    if (error) {
      return h("div", { className: "stk-page" }, h("div", { className: "stk-state" }, h("p", null, error)));
    }
    if (!performer) {
      return h("div", { className: "stk-page" }, h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" })));
    }

    const cover = rel(performer.image_path);
    const stats = [
      ["Scenes", performer.scene_count],
      ["Markers", markerCount == null ? "—" : markerCount],
      ["Images", performer.image_count],
      ["O", performer.o_counter || 0],
    ];
    const gridClass = density === 5 ? "stk-grid-5" : "stk-grid-3";
    const sortLabel = (SCENE_SORTS.find((entry) => entry[0] === sort) || SCENE_SORTS[0])[1];

    function openScene(scene) {
      // the URL names the performer and the exact clip, like tiktok.com/@user/video/<id>
      onPlay({ sceneId: scene.id, tab: "scenes", sort });
      goTo("performer/" + encodeURIComponent(performer.name) + "/" + scene.id);
    }

    return h(
      "div",
      { className: "stk-page stk-profile", style: { padding: 0 } },
      h(
        "div",
        { className: "stk-cover", style: { backgroundImage: `url("${cover}")` } },
        h("button", { className: "stk-cover-back", onClick: onBack }, h(Icon, { name: "chevron", size: 20 })),
        performer.favorite && h("div", { className: "stk-cover-badge" }, h(Icon, { name: "heart", size: 13 }), " Following")
      ),
      h(
        "div",
        { className: "stk-profile-head" },
        h("div", { className: "stk-avatar", style: { backgroundImage: `url("${cover}")` } }),
        h(
          "div",
          { style: { flex: "1 1 auto", minWidth: 0 } },
          h("div", { className: "stk-profile-name" }, performer.name),
          performer.alias_list && performer.alias_list.length > 0
            ? h("div", { className: "stk-account-meta" }, performer.alias_list.slice(0, 3).join(" · "))
            : null,
          performer.birthdate || performer.country
            ? h("div", { className: "stk-account-meta" }, [performer.birthdate, performer.country].filter(Boolean).join(" · "))
            : null
        ),
        h(
          "button",
          { className: "stk-follow" + (performer.favorite ? " stk-follow-on" : ""), onClick: toggleFollow },
          performer.favorite ? "Following" : "Follow"
        )
      ),
      h(
        "div",
        { className: "stk-stats" },
        stats.map(([label, value]) =>
          h("div", { key: label, className: "stk-stat" }, h("b", null, value), h("span", null, label))
        )
      ),
      performer.tags && performer.tags.length > 0 &&
        h(
          "div",
          { className: "stk-profile-tags" },
          performer.tags.map((tag) => h("button", { key: tag.id, className: "stk-tagpill", onClick: () => onOpenTag(tag) }, tag.name))
        ),

      h(
        "div",
        { className: "stk-tabs stk-tabs-wide" },
        h("button", { className: tab === "scenes" ? "stk-active" : "", onClick: () => setTab("scenes") }, `Scenes ${performer.scene_count}`),
        h("button", { className: tab === "markers" ? "stk-active" : "", onClick: () => setTab("markers") }, markerCount ? `Markers ${markerCount}` : "Markers"),
        h("button", { className: tab === "images" ? "stk-active" : "", onClick: () => setTab("images") }, `Images ${performer.image_count || 0}`),
        h(
          "button",
          { className: "stk-sort-btn stk-sort-pill", onClick: () => setSortOpen(!sortOpen) },
          h(Icon, { name: "sort", size: 13 }),
          sortLabel,
          " ▾"
        ),
        h(
          "button",
          { className: "stk-sort-btn stk-sort-pill", onClick: () => setDensity(density === 3 ? 5 : 3) },
          density === 3 ? "▦" : "▥"
        )
      ),

      sortOpen &&
        h(
          "div",
          { className: "stk-sort-menu" },
          SCENE_SORTS.map(([key, label]) =>
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

      tab === "scenes"
        ? h(
            "div",
            { className: gridClass },
            scenes.map((scene) => {
              const file = (scene.files && scene.files[0]) || {};
              const tileStyle =
                density === 5 && file.width && file.height ? { aspectRatio: file.width + " / " + file.height } : undefined;
              return h(
                "button",
                {
                  key: scene.id,
                  className: "stk-tile",
                  "data-scene": scene.id,
                  style: tileStyle,
                  onClick: () => openScene(scene),
                },
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` } }),
                h("span", { className: "stk-tile-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0)),
                scene.rating100 >= 60 && h("span", { className: "stk-tile-heart" }, h(Icon, { name: "heart", size: 12 }))
              );
            })
          )
        : tab === "markers"
        ? h(
            "div",
            { className: gridClass },
            markers.map((marker) =>
              h(
                "button",
                {
                  key: marker.id,
                  className: "stk-tile",
                  onClick: () =>
                    onPlay({ sceneId: marker.scene && marker.scene.id, startAt: marker.seconds, tab: "markers", sort }),
                },
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(marker.scene && marker.scene.paths && marker.scene.paths.screenshot)}")` } }),
                h("span", { className: "stk-tile-dur" }, fmtTime(marker.seconds))
              )
            )
          )
        : h(
            "div",
            { className: gridClass },
            images.map((image) =>
              h(
                "a",
                {
                  key: image.id,
                  className: "stk-tile",
                  href: `/images/${image.id}`,
                  target: "_blank",
                  rel: "noopener noreferrer",
                },
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(image.paths && image.paths.thumbnail)}")` } })
              )
            )
          )
    );
  }

  function PerformersPage({ onPick, onBack, onOpenTag, initialPerformer }) {
    const [rows, setRows] = useState(null);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState("updated_at");
    const [sortOpen, setSortOpen] = useState(false);
    const [selected, setSelected] = useState(initialPerformer || null);
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

    useEffect(() => {
      let alive = true;
      const direction = sort === "name" ? "ASC" : "DESC";
      gql(
        `query StashTokPerformers($q: String, $sort: String, $dir: SortDirectionEnum) {
          findPerformers(filter: { per_page: 200, sort: $sort, direction: $dir, q: $q }) {
            count
            performers { id name image_path scene_count favorite updated_at }
          }
        }`,
        { q: query || null, sort, dir: direction }
      )
        .then((data) => {
          if (alive) setRows(data.findPerformers.performers);
        })
        .catch(() => alive && setRows([]));
      return () => {
        alive = false;
      };
    }, [query, sort]);

    if (selected) {
      return h(PerformerProfile, {
        performerId: selected.id,
        onBack: () => {
          setSelected(null);
          if (onBack) onBack();
        },
        onPlay: (payload) => onPick(selected, payload),
        onOpenTag,
      });
    }

    const SORTS = [
      ["updated_at", "Recently added"],
      ["name", "A–Z"],
      ["scenes_count", "Most scenes"],
      ["rating", "Top rated"],
      ["random", "Random"],
    ];
    const sortLabel = (SORTS.find((entry) => entry[0] === sort) || SORTS[0])[1];

    return h(
      "div",
      { className: "stk-page", onContextMenu: (event) => event.preventDefault() },
      h("h2", null, onBack && h("button", { onClick: onBack }, h(Icon, { name: "chevron", size: 18 })), "Performers"),
      h("input", {
        type: "search",
        placeholder: "Search performers",
        value: query,
        onChange: (event) => setQuery(event.currentTarget.value),
        style: { width: "100%", marginBottom: "10px", padding: "9px 11px", borderRadius: "10px", background: "#171717", border: "1px solid #2a2a2a", color: "#fff" },
      }),
      h(
        "div",
        { className: "stk-sort-bar" },
        h("button", { className: "stk-sort-btn", onClick: () => setSortOpen(!sortOpen) }, sortLabel, " ▾"),
        rows && h("span", { className: "stk-sub" }, rows.length + " performers")
      ),
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
      !rows
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : rows.length === 0
        ? h("div", { className: "stk-state" }, h("p", null, "No performers match that."))
        : h(
            "div",
            { className: "stk-grid" },
            rows.map((performer) =>
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
                    goTo("performer/" + encodeURIComponent(performer.name));
                    setSelected(performer);
                  },
                  onPointerDown: (event) => startPerformerHold(event, performer),
                  onPointerUp: cancelHold,
                  onPointerLeave: cancelHold,
                  onPointerCancel: cancelHold,
                  onContextMenu: (event) => event.preventDefault(),
                },
                h("div", { className: "stk-account-photo", style: { backgroundImage: `url("${rel(performer.image_path)}")` } }),
                h(
                  "div",
                  { className: "stk-account-body" },
                  h("div", { className: "stk-account-name" }, performer.name),
                  h("div", { className: "stk-account-meta" }, `${performer.scene_count} scenes`, performer.favorite ? " · ♥" : "")
                )
              )
            )
          )
    );
  }


  /* ---- folders ----------------------------------------------------- */

  function FoldersPage({ onPick, onBack }) {
    const [rows, setRows] = useState(null);
    const [query, setQuery] = useState("");

    useEffect(() => {
      let alive = true;
      (async () => {
        const roots = await loadLibraryRoots();
        let all = [];
        for (let page = 1; page <= 20; page += 1) {
          const data = await gql(
            `query StashTokFolders($page: Int!) {
              findFolders(filter: { per_page: 1000, page: $page }) { folders { path } }
            }`,
            { page }
          );
          const batch = (data.findFolders && data.findFolders.folders) || [];
          all = all.concat(batch);
          if (batch.length < 1000) break;
        }
        const seen = {};
        const out = [];
        all.forEach((folder) => {
          const root = roots.find((candidate) => folder.path.indexOf(candidate + "/") === 0);
          if (!root) return;
          const rest = folder.path.slice(root.length + 1);
          if (!rest || rest.indexOf("/") !== -1) return;
          if (seen[folder.path]) return;
          seen[folder.path] = true;
          out.push({ name: rest, folder: folder.path });
        });
        out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        if (alive) setRows(out);
      })().catch(() => alive && setRows([]));
      return () => {
        alive = false;
      };
    }, []);

    const term = query.trim().toLowerCase();
    const list = (rows || []).filter((row) => !term || row.name.toLowerCase().indexOf(term) !== -1);

    return h(
      "div",
      { className: "stk-page" },
      h("h2", null, onBack && h("button", { onClick: onBack }, h(Icon, { name: "chevron", size: 18 })), "Folders"),
      h("input", {
        type: "search",
        placeholder: "Filter folders",
        value: query,
        onChange: (event) => setQuery(event.currentTarget.value),
        style: {
          width: "100%",
          marginBottom: "10px",
          padding: "9px 11px",
          borderRadius: "10px",
          background: "#171717",
          border: "1px solid #2a2a2a",
          color: "#fff",
        },
      }),
      !rows
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : h(
            "div",
            { className: "stk-folder-list" },
            h("div", { className: "stk-sub", style: { padding: "0 0 8px" } }, list.length + " folders"),
            list.map((row) =>
              h(
                "button",
                { key: row.folder, className: "stk-folder-row", onClick: () => onPick(row) },
                h(Icon, { name: "folder", size: 17 }),
                h("span", null, row.name)
              )
            )
          )
    );
  }

  /* ---- global search ------------------------------------------------ */

  function SearchPage({ onPickScene, onPickPerformer, onBack }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState({ performers: [], markers: [], scenes: [], busy: false, term: "" });

    useEffect(() => {
      const term = query.trim();
      if (term.length < 2) {
        setResults({ performers: [], markers: [], scenes: [], busy: false, term: "" });
        return undefined;
      }
      let alive = true;
      setResults((current) => Object.assign({}, current, { busy: true }));
      const timer = window.setTimeout(() => {
        gql(
          `query StashTokSearch($q: String!) {
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
              performers: (data.findPerformers && data.findPerformers.performers) || [],
              markers: (data.findSceneMarkers && data.findSceneMarkers.scene_markers) || [],
              scenes: (data.findScenes && data.findScenes.scenes) || [],
              busy: false,
              term,
            });
          })
          .catch(() => alive && setResults({ performers: [], markers: [], scenes: [], busy: false, term }));
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
          placeholder: "Search scenes, performers, markers",
          value: query,
          onChange: (event) => setQuery(event.currentTarget.value),
          className: "stk-search-input",
        })
      ),
      query.trim().length < 2
        ? h("div", { className: "stk-state" }, h("p", null, "Type at least two characters."))
        : results.busy
        ? h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" }))
        : h(
            "div",
            null,
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
                    h("div", { className: "stk-account-meta" }, performer.scene_count + " scenes")
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

  function FolderProfile({ name, folder, onBack, onPlay }) {
    const [scenes, setScenes] = useState([]);
    const [count, setCount] = useState(0);
    const [markers, setMarkers] = useState(0);
    const [cover, setCover] = useState("");

    useEffect(() => {
      let alive = true;
      gql(
        `query StashTokFolder($path: String!) {
          findScenes(scene_filter: { path: { value: $path, modifier: INCLUDES } },
                     filter: { per_page: 60, sort: "date", direction: DESC }) {
            count
            scenes { id paths { screenshot } files { duration } }
          }
        }`,
        { path: folder }
      )
        .then((data) => {
          if (!alive) return;
          setScenes(data.findScenes.scenes || []);
          setCount(data.findScenes.count || 0);
          const first = data.findScenes.scenes && data.findScenes.scenes[0];
          if (first) setCover(rel(first.paths && first.paths.screenshot));
        })
        .catch(() => {});
      gql(
        `query StashTokFolderMarkers($path: String!) {
          findSceneMarkers(filter: { per_page: 1 },
            scene_marker_filter: { scene_filter: { path: { value: $path, modifier: INCLUDES } } }) { count }
        }`,
        { path: folder }
      )
        .then((data) => alive && setMarkers(data.findSceneMarkers.count || 0))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [folder]);

    return h(
      "div",
      { className: "stk-page stk-profile", style: { padding: 0 } },
      h(
        "div",
        { className: "stk-cover", style: cover ? { backgroundImage: `url("${cover}")` } : undefined },
        h("button", { className: "stk-cover-back", onClick: onBack }, h(Icon, { name: "chevron", size: 20 }))
      ),
      h(
        "div",
        { className: "stk-profile-head" },
        h("div", { className: "stk-avatar stk-avatar-text", style: cover ? { backgroundImage: `url("${cover}")` } : undefined }, cover ? null : initials(name)),
        h(
          "div",
          { style: { flex: "1 1 auto", minWidth: 0 } },
          h("div", { className: "stk-profile-name" }, name),
          h("div", { className: "stk-account-meta" }, folder)
        ),
        h("button", { className: "stk-follow", onClick: onPlay }, h(Icon, { name: "play", size: 13 }), " Play")
      ),
      h(
        "div",
        { className: "stk-stats" },
        [
          ["Scenes", count],
          ["Markers", markers],
        ].map(([label, value]) => h("div", { key: label, className: "stk-stat" }, h("b", null, value), h("span", null, label)))
      ),
      h(
        "div",
        { className: "stk-grid-3" },
        scenes.map((scene) =>
          h(
            "button",
            { key: scene.id, className: "stk-tile", onClick: onPlay },
            h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` } }),
            h("span", { className: "stk-tile-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0))
          )
        )
      )
    );
  }

  function TagsPage({ onPick, onBack }) {
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
      h("h2", null, onBack && h("button", { onClick: onBack }, h(Icon, { name: "chevron", size: 18 })), "Tags"),
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
                "button",
                { key: tag.id, className: "stk-tagpill", onClick: () => onPick(tag) },
                h(Icon, { name: "tag", size: 13 }),
                tag.name,
                h("b", null, tag.scene_count)
              )
            )
          )
    );
  }

  /* ------------------------------------------------------------------ */
  /* feed builder                                                       */
  /* ------------------------------------------------------------------ */

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

  function FeedBuilder({ spec, feeds, onSave, onDelete, onClose, onUse }) {
    const [draft, setDraft] = useState(
      spec || { name: "New feed", type: "foryou", tags: [], tagMode: "OR" }
    );
    const [tags, setTags] = useState([]);
    const [savedFilters, setSavedFilters] = useState([]);
    const [tagQuery, setTagQuery] = useState("");

    useEffect(() => {
      gql(`query StashTokTagPicker { findTags(filter: { per_page: 200, sort: "scenes_count", direction: DESC }) { tags { id name scene_count } } }`)
        .then((data) => setTags(data.findTags.tags))
        .catch(() => setTags([]));
      gql(`query StashTokSavedFilters { findSavedFilters(mode: SCENES) { id name } }`)
        .then((data) => setSavedFilters(data.findSavedFilters || []))
        .catch(() => setSavedFilters([]));
    }, []);

    const filteredTags = tags.filter((tag) => !tagQuery || tag.name.toLowerCase().includes(tagQuery.toLowerCase()));
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
        { className: "stk-sheet", onClick: (event) => event.stopPropagation() },
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

        draft.type === "tags" &&
          h(
            React.Fragment,
            null,
            h(
              "div",
              { style: { display: "flex", gap: "8px", marginTop: "12px", alignItems: "center" } },
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
            h("input", {
              type: "search",
              placeholder: "Filter tags",
              value: tagQuery,
              onChange: (event) => setTagQuery(event.currentTarget.value),
              style: { width: "100%", margin: "10px 0", padding: "8px 10px", borderRadius: "9px", background: "#171717", border: "1px solid #2a2a2a", color: "#fff" },
            }),
            h(
              "div",
              { style: { maxHeight: "220px", overflowY: "auto" } },
              filteredTags.map((tag) =>
                h(
                  "button",
                  {
                    key: tag.id,
                    className: "stk-tagpill",
                    style: selected.has(tag.id) ? { background: "#243", borderColor: "#3a7" } : undefined,
                    onClick: () => toggleTag(tag.id),
                  },
                  tag.name,
                  h("b", null, tag.scene_count)
                )
              )
            )
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

  function SettingsPanel({ cfg, feeds, onEdit, pin, onSetPin, onClearPin }) {
    const [draft, setDraft] = useState("");
    const [saved, setSaved] = useState(false);

    return h(
      "div",
      { className: "stk-settings", style: { marginTop: "16px" } },
      h("h4", null, "Privacy lock"),
      h(
        "p",
        { className: "stk-sub" },
        pin
          ? "A PIN is set. StashTok black-screens the moment this tab loses focus and asks for the PIN when you come back."
          : "Set a PIN to black-screen StashTok whenever you leave the tab."
      ),
      h(
        "div",
        { className: "stk-pin-row" },
        h("input", {
          type: "tel",
          inputMode: "numeric",
          placeholder: pin ? "New PIN (4–8 digits)" : "PIN (4–8 digits)",
          value: draft,
          maxLength: 8,
          onChange: (event) => {
            setDraft(event.currentTarget.value.replace(/\D/g, ""));
            setSaved(false);
          },
          className: "stk-pin-input",
        }),
        h(
          "button",
          {
            className: "stk-btn",
            onClick: () => {
              if (draft.length < 4) return;
              onSetPin(pinDigest(draft));
              setDraft("");
              setSaved(true);
            },
          },
          pin ? "Change" : "Set PIN"
        ),
        pin &&
          h(
            "button",
            {
              className: "stk-btn stk-btn-danger",
              onClick: () => {
                onClearPin();
                setDraft("");
                setSaved(false);
              },
            },
            "Remove"
          )
      ),
      saved && h("p", { className: "stk-sub" }, "PIN saved."),
      h("h4", { style: { marginTop: "18px" } }, "Feeds"),
      (feeds || []).map((feed) =>
        h(
          "button",
          { key: feed.id, className: "stk-marker-row", onClick: () => onEdit(feed) },
          h(Icon, { name: "sparkle", size: 14 }),
          feed.name,
          h("span", null, feed.type)
        )
      ),
      h(
        "button",
        { className: "stk-btn", onClick: () => onEdit(null), style: { marginTop: "8px" } },
        h(Icon, { name: "plus", size: 14 }),
        "New feed"
      ),
      h(
        "p",
        { className: "stk-sub", style: { marginTop: "16px" } },
        "Hearts are written to Stash as rating100. Any rated scene appears in the Favorites feed, and in Stash's own rating filter. Feed definitions live in this browser only."
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* root                                                               */
  /* ------------------------------------------------------------------ */

  function usePluginConfig() {
    const [cfg, setCfg] = useState(() => readConfig(null));
    useEffect(() => {
      let alive = true;
      gql("{ configuration { plugins } }")
        .then((data) => {
          if (alive) setCfg(readConfig({ plugins: data.configuration && data.configuration.plugins }));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);
    return cfg;
  }


  /* ---- privacy lock ------------------------------------------------ */

  const PIN_KEY = "stashTok.pin";

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

    function press(digit) {
      setWrong(false);
      setEntry((current) => (current + digit).slice(0, 8));
    }

    function submit() {
      if (pinDigest(entry) === stored) {
        onUnlock();
        return;
      }
      setWrong(true);
      setEntry("");
      buzz(60);
    }

    return h(
      "div",
      { className: "stk-lock" },
      h("div", { className: "stk-lock-title" }, "Locked"),
      h("div", { className: "stk-lock-dots" }, entry.replace(/./g, "•") || "Enter PIN"),
      h(
        "div",
        { className: "stk-lock-pad" },
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "→"].map((key) =>
          h(
            "button",
            {
              key,
              className: "stk-lock-key" + (wrong ? " stk-lock-wrong" : ""),
              onClick: () => {
                if (key === "⌫") setEntry((current) => current.slice(0, -1));
                else if (key === "→") submit();
                else press(key);
              },
            },
            key
          )
        )
      )
    );
  }

  function StashTokApp() {
    const cfg = usePluginConfig();
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
    const [tab, setTab] = useState("home");
    const [feeds, setFeeds] = useState(() => loadFeeds());
    const [activeFeed, setActiveFeed] = useState(defaultFeed());
    const [refreshKey, setRefreshKey] = useState(0);
    const [builder, setBuilder] = useState(null); // {spec} | 'new' | null
    const [performersOpen, setPerformersOpen] = useState(false);
    const [tagsOpen, setTagsOpen] = useState(false);
    const [performerFilter, setPerformerFilter] = useState(null);
    const [tagFilter, setTagFilter] = useState(null);
    const [folderView, setFolderView] = useState(null);

    /* ---- routing: the URL is the source of truth --------------------- */

    const applyRoute = useCallback((rest) => {
      if (!rest) {
        setTab("home");
        setPerformerFilter(null);
        setActiveFeed(defaultFeed());
        return;
      }
      if (rest === "favorites") {
        setTab("home");
        setPerformerFilter(null);
        setActiveFeed({ id: "favorites", name: "Favorites", type: "favorites" });
        return;
      }
      if (rest === "performers") {
        setPerformerFilter(null);
        setTab("performers");
        return;
      }
      if (rest === "tags") {
        setTab("tags");
        return;
      }
      if (rest === "settings") {
        setTab("settings");
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
        const path = decodeURIComponent(rest.slice("folder/".length));
        setFolderView({ name: path.split("/").filter(Boolean).pop() || path, folder: path });
        setTab("folder");
        return;
      }
      if (rest.indexOf("performer/") === 0) {
        const tail = rest.slice("performer/".length);
        const slash = tail.indexOf("/");
        const slug = decodeURIComponent(slash === -1 ? tail : tail.slice(0, slash));
        const sceneId = slash === -1 ? null : tail.slice(slash + 1).replace(/\D/g, "");
        resolvePerformerSlug(slug, sceneId || null);
        return;
      }
      if (rest.indexOf("scene/") === 0) {
        resolveSceneId(rest.slice("scene/".length));
        return;
      }
      setTab("home");
    }, []);

    /* the page itself must never zoom: pinch belongs to the video only */
    useEffect(() => {
      const el = shellRef.current;
      if (!el) return undefined;
      const blockPinch = (event) => {
        if (!event.touches || event.touches.length < 2) return;
        const target = event.target;
        const inStage = target && target.closest && target.closest(".stk-stage");
        if (!inStage) event.preventDefault();
      };
      const blockGesture = (event) => event.preventDefault();
      el.addEventListener("touchmove", blockPinch, { passive: false });
      el.addEventListener("gesturestart", blockGesture, { passive: false });
      document.addEventListener("gesturestart", blockGesture, { passive: false });
      return () => {
        el.removeEventListener("touchmove", blockPinch);
        el.removeEventListener("gesturestart", blockGesture);
        document.removeEventListener("gesturestart", blockGesture);
      };
    }, []);

    useEffect(() => {
      applyRoute(currentRoute());
      const onNav = () => applyRoute(currentRoute());
      window.addEventListener("hashchange", onNav);
      window.addEventListener("popstate", onNav);
      return () => {
        window.removeEventListener("hashchange", onNav);
        window.removeEventListener("popstate", onNav);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function resolvePerformerSlug(name, sceneId) {
      try {
        const data = await gql(
          `query StashTokFindByName($q: String) { findPerformers(filter: { q: $q, per_page: 20 }) { performers { id name image_path scene_count } } }`,
          { q: name }
        );
        const list = (data.findPerformers && data.findPerformers.performers) || [];
        const exact = list.find((row) => row.name.toLowerCase() === name.toLowerCase()) || list[0];
        if (exact) {
          setPerformerFilter(exact);
          setTab("performers");
          if (sceneId) openPerformer(exact, { sceneId }, false);
        } else {
          setTab("performers");
        }
      } catch (err) {
        setTab("performers");
      }
    }

    async function resolveSceneId(id) {
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

    function openPerformer(performer, payload, push) {
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
        sort: "date",
        direction: "DESC",
        startSceneId: (payload && payload.sceneId) || null,
        startAt: (payload && payload.startAt) || null,
        origin: { kind: "performer", id: performer.id },
      });
      setTab("home");
      setRefreshKey((n) => n + 1);
      if (push !== false && !(payload && payload.noPush)) goTo("performer/" + encodeURIComponent(performer.name));
    }

    function openTag(tag) {
      setTagFilter(tag);
      setPerformerFilter(null);
      setActiveFeed({ id: "tag-" + tag.id, name: tag.name, type: "tags", tags: [tag.id], tagMode: "OR", sort: "random" });
      setTagsOpen(false);
      setTab("home");
      setRefreshKey((n) => n + 1);
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
        onPick: openPerformer,
        onBack: () => setTab("home"),
        onOpenTag: openTag,
        initialPerformer: performerFilter,
      });
    } else if (tab === "folder" && folderView) {
      body = h(FolderProfile, {
        name: folderView.name,
        folder: folderView.folder,
        onBack: () => {
          setFolderView(null);
          setTab("home");
        },
        onPlay: () =>
          useFeed({ type: "foryou", name: folderView.name, pathIncludes: folderView.folder, sort: "date", direction: "DESC" }),
      });
    } else if (tab === "tags") {
      body = h(TagsPage, { onPick: openTag, onBack: () => setTab("home") });
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
    } else if (tab === "settings") {
      body = h(
        "div",
        { className: "stk-page" },
        h("h2", null, "Settings"),
        h(SettingsPanel, {
          cfg,
          feeds,
          onEdit: (spec) => setBuilder({ spec }),
          pin,
          onSetPin: savePin,
          onClearPin: () => savePin(""),
        }),
        h(
          "p",
          { className: "stk-sub" },
          "Long-press the middle of the video for actions · hold the right side to fast-forward · hold the left to rewind · pinch to zoom · double-tap to heart."
        )
      );
    } else {
      body = h(FeedView, {
        key: activeFeed.id + ":" + refreshKey,
        spec: activeFeed,
        cfg,
        refreshKey,
        onSearch: () => {
          setTab("search");
          goTo("search");
        },
        onSettings: () => {
          setTab("settings");
          goTo("settings");
        },
        onOpenPerformer: openPerformer,
        onOpenTag: openTag,
        onDeriveFeed: useFeed,
        onEditFeed: (spec) => setBuilder({ spec }),
        onOpenFolder: (target) => {
          setFolderView(target);
          setTab("folder");
        },
        feeds,
        onSwitchFeed: useFeed,
        onNewFeed: () => setBuilder({ spec: null }),
        onBack: () => {
          if (window.history.length > 1) window.history.back();
          else setTab("performers");
        },
      });
    }

    return h(
      "div",
      { className: "stash-tok-wrap" + (locked ? " stk-locked" : ""), ref: shellRef },
      h(
        "div",
        { style: { position: "fixed", inset: 0, zIndex: 9000, display: "flex", flexDirection: "column", background: "#000" } },
        body,

        (tab === "feed" || tab === "home") &&
          h(
            "nav",
            { className: "stk-nav" },
            h(NavButton, { active: tab === "home", icon: "home", label: "Home", onClick: () => onTab("home") }),
            h(NavButton, { active: false, icon: "user", label: "Performers", onClick: () => { setTab("performers"); goTo("performers"); } }),
            h(NavButton, {
              active: activeFeed.type === "favorites",
              icon: "heart",
              label: "Favorites",
              onClick: () => {
                setPerformerFilter(null);
                setActiveFeed({ id: "favorites", name: "Favorites", type: "favorites" });
                setTab("home");
                setRefreshKey((n) => n + 1);
                goTo("favorites");
              },
            }),
            h(NavButton, { active: false, icon: "tag", label: "Tags", onClick: () => { setTab("tags"); goTo("tags"); } }),
            h(NavButton, { active: false, icon: "folder", label: "Folders", onClick: () => { setTab("folders"); goTo("folders"); } })
          ),

        tab === "performers" || tab === "tags" || tab === "settings" || tab === "folder" || tab === "folders"
          ? h(
              "nav",
              { className: "stk-nav" },
              h(NavButton, { active: false, icon: "home", label: "Home", onClick: () => setTab("home") }),
              h(NavButton, { active: tab === "performers", icon: "user", label: "Performers", onClick: () => setTab("performers") }),
              h(NavButton, {
                active: false,
                icon: "heart",
                label: "Favorites",
                onClick: () => {
                  setPerformerFilter(null);
                  setActiveFeed({ id: "favorites", name: "Favorites", type: "favorites" });
                  setTab("home");
                  setRefreshKey((n) => n + 1);
                  goTo("favorites");
                },
              }),
              h(NavButton, { active: tab === "tags", icon: "tag", label: "Tags", onClick: () => { setTab("tags"); goTo("tags"); } }),
              h(NavButton, { active: tab === "folders", icon: "folder", label: "Folders", onClick: () => { setTab("folders"); goTo("folders"); } })
            )
          : null,

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
  api.register.route(LEGACY_ROUTE, StashTokApp);

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
      h(SettingsPanel, { cfg: null, feeds, onEdit: (spec) => setBuilder({ spec }) }),
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

  window.StashTok = { version: "0.1.0", feeds: loadFeeds };
})();
