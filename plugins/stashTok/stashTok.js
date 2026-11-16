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
  const FOLDER_FAV_KEY = "stashTok.folderFavs.v1";
  const PAGE_SIZE = 8;
  const HOLD_MS = 380;
  const LONG_PRESS_MS = 250;
  const SWIPE_PX = 70;
  const MAX_ZOOM = 8;
  const HEART_POP_MS = 700;

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
    chevronUp: "M6 15l6-6 6 6",
    chevronDown: "M6 9l6 6 6-6",
    sort: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5 16 16",
    folder: "M3.5 7.5A1.5 1.5 0 0 1 5 6h3.6l1.9 2.4H19a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V7.5z",
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
  };

  function Icon({ name, size = 22, className = "", filled = false }) {
    return h(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        fill: filled && name === "heart" ? "currentColor" : "none",
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

  function forgetResume(key) {
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
    performers { id name image_path }
    studio { id name }
    tags { id name }
    scene_markers { id title seconds end_seconds primary_tag { id name } }
  `;

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
      const since = new Date(Date.now() - Number(windowDays) * 86400000);
      parts.push(`date: { value: "${since.toISOString().slice(0, 10)}", modifier: GREATER_THAN }`);
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
    // a remembered clip whose file has gone missing must not strand the feed
    if (!scene.files || !scene.files.length) return { count: 0, items: [] };
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
      sfw: raw.sfw === true,
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

  /* Leaving a feed (tap a performer, open search) must not cost the user their place:
     remember the clip and the playhead for an hour, and reopen there. */
  const RESUME_KEY = "stashTok.resume.v1";
  const RESUME_TTL_MS = 60 * 60 * 1000;

  function readResumeMap() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RESUME_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeResume(key, sceneId, time) {
    try {
      const map = readResumeMap();
      map[key] = { sceneId, time: Number(time) || 0, at: Date.now() };
      window.localStorage.setItem(RESUME_KEY, JSON.stringify(map));
    } catch (e) {
      /* ignore quota errors */
    }
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

  function shortDate(value) {
    const raw = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  }

  /* in-app preferences (the plugin's own config lives in Stash's settings page) */
  const PREFS_KEY = "stashTok.prefs.v1";
  const PREF_DEFAULTS = {
    performerSort: "filesize",
    performerImages: true,
    performerMarkers: true,
    foldersOnTop: true,
    showPath: false,
    favoritesSort: "updated_at",
    favoritesOpen: "gallery",
    feedWindow: "all",
    folderView: "list",
    navSlots: ["favorites", "tags", "folders"],
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
      parsed = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") || {};
    } catch (e) {
      parsed = {};
    }
    const merged = Object.assign({}, PREF_DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
    if (merged.sortDefaultsV !== 2) {
      merged.performerSort = "filesize";
      merged.sortDefaultsV = 2;
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
  float theta = acos(clamp(-d.z, -1.0, 1.0));
  float phi = atan(d.y, d.x);
  float r = theta / (PI * 0.5);
  if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  /* left eye occupies x in [0, 0.5]; its fisheye circle fills that half */
  vec2 s = vec2(0.25 + 0.25 * r * cos(phi), 0.5 + 0.5 * r * sin(phi));
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

  function VrCanvas({ videoRef, layout, sceneKey, previewUrl, onTap, onSource }) {
    const canvasRef = useRef(null);
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
    }, [sceneKey]);

    useEffect(() => {
      if (!layout) return undefined;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas) return undefined;
      const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
      if (!gl) return undefined;
      const shader = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
      };
      const vs = shader(gl.VERTEX_SHADER, VR_VS);
      const fs = shader(gl.FRAGMENT_SHADER, VR_FS);
      if (!vs || !fs) return undefined;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return undefined;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const u = {
        tex: gl.getUniformLocation(prog, "tex"),
        yaw: gl.getUniformLocation(prog, "yaw"),
        pitch: gl.getUniformLocation(prog, "pitch"),
        fov: gl.getUniformLocation(prog, "fov"),
        aspect: gl.getUniformLocation(prog, "aspect"),
        kind: gl.getUniformLocation(prog, "kind"),
      };
      const scratch = document.createElement("canvas");
      scratch.width = 2048;
      scratch.height = 1024;
      const sctx = scratch.getContext("2d");

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

      let raf = 0;
      let last = 0;
      let lastFrame = -1;
      let lastKind = "";
      let uploadIdle = true;
      const draw = (now) => {
        raf = requestAnimationFrame(draw);
        if (now - last < 16) return;
        last = now;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(320, Math.round((canvas.clientWidth || 640) * dpr));
        const h = Math.max(180, Math.round((canvas.clientHeight || 360) * dpr));
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
        /* a 30fps source does not need 60 uploads a second: the texture is only
           re-uploaded when a new frame has actually been decoded */
        if (source.currentTime === lastFrame) {
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          return;
        }
        lastFrame = source.currentTime;
        const vw = source.videoWidth || 1920;
        const vh = source.videoHeight || 960;
        const texW = Math.max(720, Math.min(2048, Math.round(w * 1.15), vw));
        const texH = Math.max(2, Math.round((texW * vh) / Math.max(1, vw)));
        const master = videoRef.current;
        if (source === fallback && master && master.currentTime > 1 && fallback.duration > 2) {
          /* keep the stand-in roughly where the timeline says we are */
          const want = master.currentTime % fallback.duration;
          if (Math.abs(fallback.currentTime - want) > 1.5) fallback.currentTime = want;
        }
        const view = viewRef.current;
        const paint = () => {
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.uniform1i(u.tex, 0);
          gl.uniform1f(u.yaw, view.yaw);
          gl.uniform1f(u.pitch, view.pitch);
          gl.uniform1f(u.fov, view.fov);
          gl.uniform1f(u.aspect, canvas.width / canvas.height);
          gl.uniform1i(u.kind, layout === "equirect" ? 1 : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        /* Upload through createImageBitmap so the resize happens on the GPU: an 8K
           frame pushed through a 2D canvas every frame is what stutters on iOS. */
        if (window.createImageBitmap) {
          if (!uploadIdle) {
            /* an upload is already in flight: repaint the last texture, do not queue another */
            paint();
            return;
          }
          uploadIdle = false;
          createImageBitmap(source, { resizeWidth: texW, resizeHeight: texH, resizeQuality: "low" })
            .then((bitmap) => {
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
              bitmap.close();
              uploadIdle = true;
              paint();
            })
            .catch(() => {
              uploadIdle = true;
              legacyUpload(texW, texH);
              paint();
            });
        } else {
          legacyUpload(texW, texH);
          paint();
        }

        function legacyUpload(width, height) {
          if (scratch.width !== width || scratch.height !== height) {
            scratch.width = width;
            scratch.height = height;
          }
          try {
            sctx.drawImage(source, 0, 0, scratch.width, scratch.height);
          } catch (err) {
            return;
          }
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
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
          view.yaw -= dx * 0.0052;
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

    return h("canvas", { className: "stk-vr-canvas", ref: canvasRef });
  }

  function FeedView({ prefs, spec, cfg, refreshKey, onBack, onSearch, onSettings, onOpenPerformer, onOpenTag, onDeriveFeed, onEditFeed, onOpenFolder, onOpenFolderProfile, feeds, onSwitchFeed, onNewFeed, desktop }) {
    const sfw = !!cfg.sfw;
    const [items, setItems] = useState([]);
    const [index, setIndex] = useState(0);
    const [count, setCount] = useState(0);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState(false);
    const [ready, setReady] = useState(false);
    const [streamFallback, setStreamFallback] = useState(false);
    const [failCount, setFailCount] = useState(0);
    const [revealed, setRevealed] = useState(false);
    const [rotation, setRotation] = useState(0);
    const [speed, setSpeed] = useState(() => Number(window.localStorage.getItem("stashTok.speed")) || 1);
    const [muted, setMuted] = useState(cfg.autoplayMuted);
    /* VR clips default to the 2D rectilinear view; v toggles back to raw */
    const [vrMode, setVrMode] = useState(true);
    const [people, setPeople] = useState(false);
    const [vrSource, setVrSource] = useState("");
    const [scrubPreview, setScrubPreview] = useState(null);
    const spriteRef = useRef({ key: "", cues: [], ok: false });
    const [spriteTick, setSpriteTick] = useState(0);
    const [hud, setHud] = useState(true);
    const [hudTick, setHudTick] = useState(0);
    const [sheet, setSheet] = useState(null); // 'actions' | 'details'
    const [press, setPress] = useState(null); // {x,y} pip while a long press builds
    const [quick, setQuick] = useState(null); // {x,y} quick menu anchored at the thumb
    const [rating, setRating] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [scrubbing, setScrubbing] = useState(false);
    const [tip, setTip] = useState(null);
    const [scrubTime, setScrubTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [time, setTime] = useState(0);
    const [rateBadge, setRateBadge] = useState("");
    const [heartBurst, setHeartBurst] = useState(0);
    const [dragY, setDragY] = useState(0);
    /* fill the screen unless that would throw away a big slice of the frame */
    const [fitMode, setFitMode] = useState("cover");

    const stageRef = useRef(null);
    const videoRef = useRef(null);
    const wrapRef = useRef(null);
    const pageRef = useRef(1);
    const busyRef = useRef(false);
    const exhaustedRef = useRef(false);
    const pts = useRef(new Map());
    const gesture = useRef(null);
    const holdTimer = useRef(null);
    const pressTimer = useRef(0);
    const tapTimer = useRef(null);
    const lastTapAt = useRef(0);
    const rafRef = useRef(0);
    const tf = useRef({ s: 1, x: 0, y: 0 });

    /* React can leave videoRef pointing at the clip we just swiped away from, so
       always resolve the element that is actually marked active on screen. */
    const fitFor = useCallback((video) => {
      const stage = stageRef.current;
      if (!video || !stage) return "cover";
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      const sw = stage.clientWidth || 0;
      const sh = stage.clientHeight || 0;
      if (!vw || !vh || !sw || !sh) return "cover";
      const vr = vw / vh;
      const sr = sw / sh;
      // share of the frame that `cover` would crop away
      const lost = vr >= sr ? 1 - sr / vr : 1 - vr / sr;
      return lost <= 0.25 ? "cover" : "contain";
    }, []);

    const activeVideo = useCallback(() => {
      const stage = stageRef.current;
      const live = stage && stage.querySelector(".stk-video.stk-active");
      return live || videoRef.current;
    }, []);

    const item = items[index] || null;

    const [, setRootsReady] = useState(0);

    const feedKey = String(spec.key || spec.id || (spec.type + ":" + (spec.name || spec.sort || "")));
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
      const onResize = () => {
        const video = activeVideo();
        if (video) setFitMode(fitFor(video));
      };
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      };
    }, [activeVideo, fitFor]);

    /* remember the seat as we move, not only on the way out */
    useEffect(() => {
      if (!hydratedRef.current) return;
      const cur = items[index];
      if (!cur || !cur.scene) return;
      const kept = readResume(feedKey);
      const same = kept && String(kept.sceneId) === String(cur.scene.id);
      writeResume(feedKey, cur.scene.id, same ? kept.time : 0);
    }, [feedKey, index, items]);

    /* walking away must not reset the feed: remember where we were */
    useEffect(
      () => () => {
        const cur = itemsRef.current[indexRef.current];
        // the element may already be detached by now; the state mirror is reliable
        if (cur && cur.scene) writeResume(feedKey, cur.scene.id, timeRef.current);
      },
      [feedKey, activeVideo]
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
          const result = await fetchFeedPage(spec, cfg, page);
          setCount(result.count);
          if (reset) {
            pageRef.current = 2;
            exhaustedRef.current = result.items.length === 0;
            let list = result.items.slice();
            const resume = resumeRef.current;
            const startId = spec.startSceneId || (resume && resume.sceneId);
            const startTime = spec.startAt || (resume && resume.time) || null;
            if (startId) {
              // open on the scene the user tapped, wherever it sits in the list
              const at = list.findIndex((entry) => String(entry.scene.id) === String(startId));
              if (at > 0) list.unshift(list.splice(at, 1)[0]);
              else if (at < 0) {
                // it may not be on page 1 at all: fetch it and lead with it
                try {
                  const single = await fetchSceneById({ sceneId: startId, startAt: startTime });
                  if (single.items.length) list.unshift(single.items[0]);
                } catch (err) {
                  /* fall through to the normal order */
                }
              }
            }
            if (reset && startTime && list.length) list[0] = Object.assign({}, list[0], { startAt: startTime });
            setItems(list);
            setIndex(0);
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
      if (spec.type === "performer") target = "performer/" + encodeURIComponent(spec.name) + "/" + sceneId;
      else if (spec.type === "scene") target = "scene/" + sceneId;
      if (!target) return;
      clipState.sceneId = String(sceneId);
      if (currentRoute() !== target) goTo(target, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item && item.scene && item.scene.id, spec.type, spec.name]);

    useEffect(() => {
      if (item) setRating(item.scene.rating100 == null ? null : Number(item.scene.rating100));
      setReady(false);
      setStreamFallback(false);
      setDuration(0);
      setTime((item && Number(item.startAt)) || 0);
      setRevealed(false);
      resetZoom();
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
      const onLoaded = () => {
        setFitMode(fitFor(video));
        const total = video.duration || 0;
        setDuration(total);
        /* canplay fires again every time the browser re-buffers, so seek to the start
           frame ONCE per clip: otherwise scrubbing back lands in an unbuffered gap,
           triggers a refill, and this yanks the playhead forward again */
        if (positionedRef.current === item.key) return;
        positionedRef.current = item.key;
        // a remembered playhead can outlive the file it came from: never seek past the end
        const seekTo = total > 0 ? Math.min(start, Math.max(0, total - 3)) : start;
        seekThenPlay(video, seekTo, playGuarded);
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
      const video = activeVideo();
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
      const key = item.key;
      setSheet(null);
      buzz(40);
      /* flagged clips leave the feed immediately: the next one slides into this slot,
         so there is nothing to "scroll" and nothing to come back to when swiping up */
      setItems((prev) => {
        const at = prev.findIndex((entry) => entry.key === key);
        if (at < 0) return prev;
        return prev.slice(0, at).concat(prev.slice(at + 1));
      });
      /* the next clip slides into this slot; only clamp when we flagged the last one */
      setIndex((cur) => Math.max(0, Math.min(cur, items.length - 2)));
      flagScene(item.scene, cfg).catch(() => {});
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
      const video = activeVideo();
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
      const video = activeVideo();
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

    /* desktop keyboard map: arrows scroll and scrub, space pauses, L likes, M mutes */
    useEffect(() => {
      if (!desktop) return undefined;
      function onKey(event) {
        const tag = (event.target && event.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || (event.target && event.target.isContentEditable)) return;
        const video = activeVideo ? activeVideo() : null;
        const key = event.key;
        if (key === "ArrowDown" || key === "PageDown") {
          event.preventDefault();
          goNext();
        } else if (key === "ArrowUp" || key === "PageUp") {
          event.preventDefault();
          goPrev();
        } else if (key === "Enter") {
          /* enter opens whoever posted this clip */
          event.preventDefault();
          openHandle();
        } else if (key === "Backspace") {
          event.preventDefault();
          if (onBack) onBack();
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
        } else if (key === " " || key === "k") {
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
        } else if (key === "v" || key === "V") {
          event.preventDefault();
          setVrMode((on) => !on);
        } else if (key === "m" || key === "M") {
          event.preventDefault();
          if (!video) return;
          const next = !video.muted;
          video.muted = next;
          setMuted(next);
        }
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [desktop, goNext, goPrev, toggleHeart, flagCurrent, vrMode]);

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
      spriteRef.current = { key: String(scene.id), cues: [], ok: false, src: spritePath || "" };
      if (spriteTick) setSpriteTick(0);
      if (!vttPath) return undefined;
      let alive = true;
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
          spriteRef.current = { key: String(scene.id), cues, ok: true, src: spritePath || "" };
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
        if (wasPlaying && video && video.paused) {
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

    function onPointerDown(event) {
      if (sheet) return;
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
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            /* open upward unless the thumb is near the top of the video */
            below: event.clientY - rect.top < 190,
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
        clearPress();
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
          // slide the strip out, then swap underneath it with no return animation
          const duration = 190;
          wrap.style.transition = `transform ${duration}ms cubic-bezier(.22,.61,.36,1)`;
          setDragY(direction > 0 ? -height : height);
          window.setTimeout(() => {
            wrap.style.transition = "none";
            wrap.style.transform = "translateY(0px) rotate(0deg)";
            if (direction > 0) goNext();
            else goPrev();
            setDragY(0);
            // give React a frame to commit the swap before transitions come back
            window.setTimeout(() => {
              wrap.style.transition = "";
            }, 80);
          }, duration);
        }
      }
      if (g.mode === "seek") {
        setScrubbing(false);
        setTip(null);
      }
      if (g.mode === "pan") poke();
      poke();
    }

    /* ---- timeline -------------------------------------------------- */

    function seekAt(clientX) {
      const video = activeVideo();
      const bar = document.querySelector(".stk-timeline-inner");
      const rect = (bar || stageRef.current || document.body).getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / (rect.width || 1), 0, 1);
      const total = duration || (video && video.duration) || 0;
      const target = ratio * total;
      if (video) video.currentTime = target;
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

    function onTimelineDown(event) {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setScrubbing(true);
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
      setScrubPreview({
        pct,
        time: at,
        hasSprite: Boolean(store.ok && cue),
        x: cue ? cue.x : 0,
        y: cue ? cue.y : 0,
        w: cue ? cue.w : 0,
        h: cue ? cue.h : 0,
        src: store.src,
        sceneId: item && item.scene ? item.scene.id : "",
      });
      if (!scrubbing) return;
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
      if (handle.folder && onOpenFolderProfile) return onOpenFolderProfile({ name: handle.name, folder: handle.folder });
      setSheet("details");
    }

    const onTimeUpdate = () => {
      const video = activeVideo();
      if (!video) return;
      setTime(video.currentTime);
      if (!duration && video.duration) setDuration(video.duration);
      // real frames only: timeupdate never fires before the clip is rolling
      if (!revealed && video.currentTime > 0.05 && video.readyState >= 2) setRevealed(true);
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
    const TAG_LIMIT = 4;



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
          [index - 1, index, index + 1, index + 2]
            .filter((at) => at >= 0 && items[at])
            .map((at) => {
              const entry = items[at];
              const active = at === index;
              if (sfw) {
                // safe-for-work: no stream is ever requested, only the still frame
                return h("img", {
                  key: entry.key,
                  className: "stk-frame" + (active ? " stk-active" : ""),
                  src: rel(entry.scene.paths && entry.scene.paths.screenshot),
                  draggable: false,
                  style: {
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
              }
              const source = streamSource(entry.scene);
              return h("video", {
                key: entry.key,
                ref: active
                  ? videoRef
                  : (el) => {
                      if (el) prewarm(el, entry.startAt);
                    },
                className: "stk-video" + (active ? " stk-active" : ""),
                style: { objectFit: active ? fitMode : "cover" },
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
              style: { left: `${quick.x}px`, top: `${quick.y}px` },
            },
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
                onClick: () => {
                  setQuick(null);
                  flagCurrent();
                },
              },
              h(Icon, { name: "flag", size: 15 }),
              "Flag",
              h("span", { className: "stk-qm-key" }, "mark for delete")
            ),
            h("button", { onClick: () => setQuick(null) }, h(Icon, { name: "x", size: 15 }), "Close")
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

        onBack &&
          (spec.origin && ["performer", "folder", "tag", "markers"].indexOf(spec.origin.kind) >= 0) &&
          h("button", { className: "stk-feed-back", onClick: onBack, title: "Back" }, h(Icon, { name: "back", size: 22 })),

        h(
          "div",
          { className: "stk-pause" + (!playing && ready ? " stk-show" : "") },
          h(Icon, { name: playing ? "pause" : "play", size: 32 })
        ),

        heartBurst > 0 &&
          h(
            "div",
            { key: heartBurst, className: "stk-big-heart stk-fire" },
            h(Icon, { name: "heart", size: 110, filled: true })
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
            { className: "stk-handle-row stk-handle-row-text" },
            h(
              "button",
              { className: "stk-handle-at", onClick: (event) => { event.stopPropagation(); openHandle(); } },
              String(handle.name || "").replace(/\s+/g, " ").trim()
            ),
            handle.performer &&
              h(
                "span",
                { className: "stk-verified", title: "Performer", "aria-label": "Performer" },
                h(Icon, { name: "verified", size: 14 })
              )
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
          tags.length > 0 &&
            h(
              "div",
              { className: "stk-hashtags" },
              tags.map((tag, tagIndex) =>
                h(
                  "button",
                  {
                    key: tag.id,
                    className: "stk-hashtext" + (tagIndex >= TAG_LIMIT ? " stk-tag-extra" : ""),
                    onClick: (event) => {
                      event.stopPropagation();
                      onOpenTag(tag);
                    },
                  },
                  "#" + tag.name.replace(/\s+/g, "-").toLowerCase()
                )
              ),
              tags.length > TAG_LIMIT &&
                h(
                  "button",
                  {
                    className: "stk-hashtext stk-hashtext-more",
                    /* toggled on the DOM node: a state change here re-renders the feed
                       card and the current clip can jump underneath you */
                    onClick: (event) => {
                      event.stopPropagation();
                      const box = event.currentTarget.parentElement;
                      const open = box.classList.toggle("stk-tags-open");
                      event.currentTarget.textContent = open ? "less" : "+" + (tags.length - TAG_LIMIT) + " more";
                    },
                  },
                  "+" + (tags.length - TAG_LIMIT) + " more"
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
              onClick: (event) => {
                event.stopPropagation();
                toggleHeart();
              },
              className: rating != null && rating >= cfg.heartRating ? "stk-on" : "",
            },
            h(Icon, { name: "heart", size: 26, filled: rating != null && rating >= cfg.heartRating }),
            h("span", null, "Heart")
          ),
          performers.length > 0 &&
            h(
              "button",
              {
                onClick: (event) => {
                  event.stopPropagation();
                  /* more than one person: let the user pick from a small sheet */
                  if (performers.length > 1) setPeople(true);
                  else onOpenPerformer(performers[0]);
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
          !sfw &&
          zoom > 1.02 &&
          h("div", { className: "stk-time" }, `${zoom.toFixed(1)}x`),

        !sfw &&
        h(
          "div",
          {
            className: "stk-timeline" + (scrubbing ? " stk-scrubbing" : ""),
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
    { id: "favorites", label: "Favorites", icon: "heart" },
    { id: "tags", label: "Tags", icon: "tag" },
    { id: "folders", label: "Folders", icon: "folder" },
    { id: "markers", label: "Markers", icon: "chapter" },
    { id: "random", label: "Random", icon: "sparkle" },
    { id: "settings", label: "Settings", icon: "gear" },
    { id: "ops", label: "Ops", icon: "ops" },
  ];
  const DEFAULT_NAV_SLOTS = ["favorites", "tags", "folders"];

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
    ["filesize", "File size"],
    ["updated_at", "Recently added"],
    ["duration", "Duration"],
    ["resolution", "Resolution"],
    ["title", "A–Z"],
    ["random", "Random"],
  ];

  function ImageViewer({ image, rect, onClose }) {
    const [mode, setMode] = useState("fit");
    const [natural, setNatural] = useState(null);
    const [hero, setHero] = useState(rect || null);
    const [scale, setScale] = useState(1);
    const stageRef = useRef(null);
    const imgRef = useRef(null);
    const view = useRef({ s: 1, x: 0, y: 0 });
    const gesture = useRef(null);
    const pts = useRef(new Map());
    const lastTap = useRef(0);

    const src = image && image.paths ? rel(image.paths.image || image.paths.thumbnail) : "";

    useEffect(() => {
      // grow out of the thumbnail instead of popping in
      const t = window.setTimeout(() => setHero(null), 40);
      const onKey = (event) => {
        if (event.key === "Escape") onClose();
      };
      window.addEventListener("keydown", onKey);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener("keydown", onKey);
      };
    }, []);

    const geometry = useCallback(() => {
      const el = stageRef.current;
      if (!el || !natural) return { contain: 1, fill: 1 };
      const cw = el.clientWidth || 1;
      const ch = el.clientHeight || 1;
      return { contain: Math.min(cw / natural.w, ch / natural.h), fill: Math.max(cw / natural.w, ch / natural.h) };
    }, [natural]);

    // 1 = fit, fill = cover the frame, original = one image pixel per CSS pixel
    const scaleFor = useCallback(
      (next) => {
        const geo = geometry();
        if (next === "fill") return geo.fill / geo.contain;
        if (next === "original") return 1 / geo.contain;
        return 1;
      },
      [geometry]
    );

    const apply = useCallback(() => {
      const img = imgRef.current;
      if (!img) return;
      const { s, x, y } = view.current;
      img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
      setScale(s);
    }, []);

    const clampPan = useCallback(() => {
      const el = stageRef.current;
      if (!el) return;
      const { s } = view.current;
      const maxX = Math.max(0, (el.clientWidth * s - el.clientWidth) / 2);
      const maxY = Math.max(0, (el.clientHeight * s - el.clientHeight) / 2);
      view.current.x = clamp(view.current.x, -maxX, maxX);
      view.current.y = clamp(view.current.y, -maxY, maxY);
    }, []);

    useEffect(() => {
      const img = imgRef.current;
      if (!img || !natural) return undefined;
      img.style.transition = "transform 220ms cubic-bezier(.2,.7,.2,1)";
      view.current = { s: scaleFor(mode), x: 0, y: 0 };
      apply();
      const t = window.setTimeout(() => {
        if (img) img.style.transition = "none";
      }, 240);
      return () => window.clearTimeout(t);
    }, [mode, natural, scaleFor, apply]);

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
        };
        return;
      }
      const now = performance.now();
      const isDouble = now - lastTap.current < 280;
      lastTap.current = isDouble ? 0 : now;
      if (isDouble) {
        gesture.current = { mode: "tap" };
        setMode((prev) => (prev === "original" ? "fit" : "original"));
        return;
      }
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
        const ratio = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) / g.d0;
        view.current.s = clamp(g.s0 * ratio, 0.6, 8);
        clampPan();
        apply();
        return;
      }
      if (g.mode !== "drag") return;
      view.current.x = g.px + (event.clientX - g.x0);
      view.current.y = g.py + (event.clientY - g.y0);
      clampPan();
      apply();
    }

    function onUp(event) {
      pts.current.delete(event.pointerId);
      if (pts.current.size === 0) gesture.current = null;
      if (pts.current.size === 1) {
        const only = Array.from(pts.current.values())[0];
        gesture.current = { mode: "drag", x0: only.x, y0: only.y, px: view.current.x, py: view.current.y };
      }
    }

    const frame = hero
      ? { left: hero.left + "px", top: hero.top + "px", width: hero.width + "px", height: hero.height + "px", borderRadius: "14px" }
      : { left: "0px", top: "0px", width: window.innerWidth + "px", height: window.innerHeight + "px", borderRadius: "0px" };

    return h(
      "div",
      {
        className: "stk-img-overlay",
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
          src &&
            h("img", {
              ref: imgRef,
              className: "stk-img",
              src,
              draggable: false,
              onLoad: (event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight }),
            })
        )
      ),
      h("button", { className: "stk-img-close", onClick: onClose, "aria-label": "Close" }, h(Icon, { name: "chevron", size: 22 })),
      h(
        "div",
        { className: "stk-img-pill" },
        [
          ["fit", "Fit"],
          ["fill", "Fill"],
          ["original", "Original"],
        ].map(([value, label]) =>
          h(
            "button",
            { key: value, className: mode === value ? "stk-on" : "", onClick: () => setMode(value) },
            label
          )
        )
      )
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

    /* keep the popup inside the viewport with a 10% margin on every side */
    const vw = (typeof window !== "undefined" ? window.innerWidth : 380) || 380;
    const vh = (typeof window !== "undefined" ? window.innerHeight : 700) || 700;
    const boxW = Math.min(380, vw * 0.8);
    const boxH = vh * 0.8;
    const byWidth = Math.floor((boxW - 46) / COLS);
    const byHeight = Math.floor((boxH - 90) / ROWS / 0.5625);
    const TILE = Math.max(64, Math.min(104, byWidth, byHeight));
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
              { className: "stk-contact-grid" },
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

  function PerformerProfile({ performerId, folder, onBack, onPlay, onOpenTag, prefs }) {
    /* one view for both: a performer record, or a bare folder standing in for one */
    const isFolder = !!folder;
    const profileKey = isFolder ? "folder:" + folder : performerId;
    const [performer, setPerformer] = useState(null);
    const [scenes, setScenes] = useState([]);
    const [markers, setMarkers] = useState([]);
    const [images, setImages] = useState([]);
    const [markerCount, setMarkerCount] = useState(null);
    const [tab, setTab] = useState("scenes");
    const [media, setMedia] = useState("videos");
    const [viewer, setViewer] = useState(null);
    const [stuck, setStuck] = useState(false);
    const pageRef = useRef(null);
    // v2: older builds stored their own default ("updated_at") per performer, which
    // would keep overriding the file-size default for a day after this change
    const sortKey = "stashTok.perfSort.v2." + profileKey;
    const favKey = "stashTok.perfFavFirst." + profileKey;
    const [sort, setSort] = useState(() => (prefs && prefs.performerSort) || "filesize");
    const [favFirst, setFavFirst] = useState(() => readSortPref(favKey, false));
    const [sortOpen, setSortOpen] = useState(false);
    const [density, setDensity] = useState(3);
    const [folderPick, setFolderPick] = useState(null);
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
      if (isFolder) {
        gql(
          `query StashTokFolderScenes($p: String!, $sort: String, $dir: SortDirectionEnum) {
            findScenes(scene_filter: { path: { value: $p, modifier: INCLUDES } },
                       filter: { per_page: 200, sort: $sort, direction: $dir }) {
              count
              scenes { id title date rating100 paths { screenshot preview vtt sprite } files { duration size width height } }
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
        `query StashTokPerformerScenes($id: ID!, $sort: String, $dir: SortDirectionEnum) {
          findScenes(scene_filter: { performers: { value: [$id], modifier: INCLUDES } },
                     filter: { per_page: 100, sort: $sort, direction: $dir }) {
            count
            scenes {
              id title date rating100
              paths { screenshot preview vtt sprite }
              files { duration size width height }
            }
          }
        }`,
        { id: performerId, sort, dir: direction }
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
    }, [performerId, sort, favFirst, folder, isFolder]);

    useEffect(() => {
      if (media !== "images") return undefined;
      let alive = true;
      if (isFolder) {
        gql(
          `query StashTokFolderImages($p: String!, $sort: String) {
            findImages(image_filter: { path: { value: $p, modifier: INCLUDES } },
                       filter: { per_page: 60, sort: $sort, direction: DESC }) {
              count
              images { id title paths { thumbnail image } }
            }
          }`,
          { p: folder, sort: sort === "filesize" || sort === "resolution" ? sort : "updated_at" }
        )
          .then((data) => {
            if (!alive) return;
            setImages(data.findImages.images || []);
            setPerformer((cur) => (cur ? Object.assign({}, cur, { image_count: data.findImages.count }) : cur));
          })
          .catch(() => alive && setImages([]));
        return () => {
          alive = false;
        };
      }
      gql(
        `query StashTokPerformerImages($id: ID!, $sort: String) {
          findImages(image_filter: { performers: { value: [$id], modifier: INCLUDES } },
                     filter: { per_page: 60, sort: $sort, direction: DESC }) {
            count
            images { id title paths { thumbnail image } }
          }
        }`,
        { id: performerId, sort: sort === "filesize" || sort === "resolution" ? sort : "updated_at" }
      )
        .then((data) => alive && setImages(data.findImages.images || []))
        .catch(() => alive && setImages([]));
      return () => {
        alive = false;
      };
    }, [performerId, media, sort, folder, isFolder]);

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
        const stride = (() => {
          const grid = document.querySelector(".stk-page .stk-grid-3, .stk-page .stk-grid-5");
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
        const node = document.querySelectorAll(".stk-page .stk-tile")[next];
        if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [sel, scenes, folderPick, onBack]);

    if (error) {
      return h("div", { className: "stk-page" }, h("div", { className: "stk-state" }, h("p", null, error)));
    }
    if (!performer) {
      return h("div", { className: "stk-page" }, h("div", { className: "stk-state" }, h("div", { className: "stk-spinner" })));
    }

    const cover = rel(performer.image_path);
    const stats = [
      ["Scenes", performer.scene_count == null ? scenes.length : performer.scene_count],
      ["Markers", markerCount == null ? "—" : markerCount],
      ["Images", performer.image_count == null ? images.length : performer.image_count],
    ];
    /* no location/birthdate: aliases for a performer, the path for a folder */
    const metaLine = isFolder
      ? String(folder).indexOf("/") >= 0
        ? folder
        : ""
      : (performer.alias_list || []).slice(0, 3).join(" · ");
    const gridClass = density === 5 ? "stk-grid-5" : "stk-grid-3";

    const sortLabel = (SCENE_SORTS.find((entry) => entry[0] === sort) || SCENE_SORTS[0])[1];

    function openScene(scene) {
      lastOpenedSceneId = String(scene.id);
      // the URL names the performer and the exact clip, like tiktok.com/@user/video/<id>
      /* one history entry: this goTo below is the push, the feed switch must not add another */
      onPlay({ sceneId: scene.id, tab: "scenes", sort, noPush: true });
      if (isFolder) goTo("folder/" + encodeURIComponent(folder) + "/" + scene.id);
      else goTo("performer/" + encodeURIComponent(performer.name) + "/" + scene.id);
    }

    return h(
      "div",
      {
        className: "stk-page stk-profile",
        style: { padding: 0 },
        ref: pageRef,
        onScroll: (event) => setStuck(event.currentTarget.scrollTop > 128),
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
      h(
        "div",
        { className: "stk-cover", style: { backgroundImage: `url("${cover}")` } },
        h("button", { className: "stk-cover-back", onClick: onBack }, h(Icon, { name: "chevron", size: 20 })),
        h(
          "button",
          {
            className: "stk-cover-fav" + (performer.favorite ? " stk-cover-fav-on" : ""),
            title: performer.favorite ? "Remove favorite" : "Add to favorites",
            onClick: toggleFollow,
          },
          h(Icon, { name: "heart", size: 19, filled: !!performer.favorite })
        )
      ),
      h(
        "div",
        { className: "stk-profile-head" },
        h("div", { className: "stk-avatar", style: { backgroundImage: `url("${cover}")` } }),
        h(
          "div",
          { style: { flex: "1 1 auto", minWidth: 0 } },
          h("div", { className: "stk-profile-name" }, performer.name),

          metaLine ? h("div", { className: "stk-account-meta stk-account-path" }, metaLine) : null
        )
      ),
      h(
        "div",
        { className: "stk-stats" },
        stats.map(([label, value]) =>
          h(
            "div",
            { key: label, className: "stk-stat" },
            h("b", null, typeof value === "number" ? fmtCount(value) : value),
            h("span", null, label)
          )
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
              style: prefs && prefs.performerImages === false ? { display: "none" } : null,
              onClick: () => { setTab("images"); setMedia("images"); },
            },
            h(Icon, { name: "image", size: 21 })
          ),
          h(
            "button",
            {
              className: tab === "markers" && media === "videos" ? "stk-active" : "",
              title: markerCount ? "Markers " + markerCount : "Markers",
              style: prefs && prefs.performerMarkers === false ? { display: "none" } : null,
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
          ),
          h(
            "button",
            { className: "stk-density", title: "Grid density", onClick: () => setDensity(density === 3 ? 5 : 3) },
            density === 3 ? "▦" : "▥"
          )
        ),
        sortOpen &&
          sortMenuTree({
            options: SCENE_SORTS,
            value: sort,
            onPick: (key) => {
              setSort(key);
              setSortOpen(false);
            },
            onClose: () => setSortOpen(false),
            favorite: {
              on: favFirst,
              onToggle: () => {
                const next = !favFirst;
                setFavFirst(next);
                writeSortPref(favKey, next);
              },
            },
          })
      ),

      (() => {
        if (!prefs || prefs.foldersOnTop === false || tab !== "scenes" || media === "images" || !scenes.length) return null;
        return null; // chips are rendered from the grouped scene list above
      })(),

      media === "images" || tab === "images"
        ? h(
            "div",
            { className: gridClass },
            images.map((image) =>
              h(
                "button",
                {
                  key: image.id,
                  className: "stk-tile",
                  onClick: (event) => setViewer({ image, rect: event.currentTarget.getBoundingClientRect() }),
                },
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(image.paths && image.paths.thumbnail)}")` } })
              )
            )
          )
        : tab === "scenes"
        ? h(
            "div",
            { className: gridClass },
            (folderPick
              ? scenes.filter((scene) => (prettyPath(((scene.files && scene.files[0]) || {}).path) || "(root)") === folderPick)
              : scenes
            ).map((scene, tileIndex) => {
              const file = (scene.files && scene.files[0]) || {};
              const tileStyle =
                density === 5 && file.width && file.height ? { aspectRatio: file.width + " / " + file.height } : undefined;
              return h(
                "button",
                {
                  key: scene.id,
                  className: "stk-tile" + (sel === tileIndex ? " stk-sel" : ""),
                  "data-scene": scene.id,
                  style: tileStyle,
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
                  onMouseEnter: () => {
                    if (window.innerWidth >= 900) setHoverScene(scene.id);
                  },
                  onMouseLeave: () => setHoverScene((cur) => (cur === scene.id ? null : cur)),
                },
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` } }),
                hoverScene === scene.id &&
                  scene.paths &&
                  scene.paths.preview &&
                  h("video", {
                    className: "stk-tile-preview",
                    src: rel(scene.paths.preview),
                    autoPlay: true,
                    muted: true,
                    loop: true,
                    playsInline: true,
                    /* only reveal the preview once it can actually paint a frame */
                    onLoadedData: (event) => {
                      if (event && event.currentTarget) event.currentTarget.classList.add("stk-preview-ready");
                    },
                    onError: (event) => {
                      /* no generated preview for this scene: keep the still, don't blank the tile */
                      if (event && event.currentTarget) event.currentTarget.style.display = "none";
                    },
                  }),
                h("span", { className: "stk-tile-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0)),
                scene.rating100 >= 60 && h("span", { className: "stk-tile-heart" }, h(Icon, { name: "heart", size: 12, filled: true }))
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
                "button",
                {
                  key: image.id,
                  className: "stk-tile",
                  onClick: (event) => setViewer({ image, rect: event.currentTarget.getBoundingClientRect() }),
                },
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(image.paths && image.paths.thumbnail)}")` } })
              )
            )
          ),

      viewer && h(ImageViewer, { image: viewer.image, rect: viewer.rect, onClose: () => setViewer(null) }),
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

  function PerformersPage({ onPick, onBack, onOpenTag, initialPerformer, prefs, onProfileOpen }) {
    /* the floating settings button sits on top of the profile's own buttons */
    const [rows, setRows] = useState(null);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState(() => readSortPref("stashTok.performerListSort", "updated_at"));
    const [sortOpen, setSortOpen] = useState(false);
    const [selected, setSelected] = useState(initialPerformer || null);

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
        prefs,
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
                  h("div", { className: "stk-account-meta" }, `${fmtCount(performer.scene_count)} scenes`, performer.favorite ? " · ♥" : "")
                )
              )
            )
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
            images { id title paths { thumbnail image } }
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
        h("button", { className: "stk-cover-back", onClick: onBack }, h(Icon, { name: "chevron", size: 20 })),
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
            images.map((image) =>
              h(
                "button",
                {
                  key: image.id,
                  className: "stk-tile",
                  onClick: (event) => setViewer({ image, rect: event.currentTarget.getBoundingClientRect() }),
                },
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(image.paths && image.paths.thumbnail)}")` } })
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
                h("div", { className: "stk-tile-photo", style: { backgroundImage: `url("${rel(scene.paths && scene.paths.screenshot)}")` } }),
                h("span", { className: "stk-tile-dur" }, fmtTime((scene.files && scene.files[0] && scene.files[0].duration) || 0))
              )
            )
          ),

      viewer && h(ImageViewer, { image: viewer.image, rect: viewer.rect, onClose: () => setViewer(null) })
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

    const load = useCallback(() => {
      gql(`query StashTokJobs { jobQueue { id status description progress startTime endTime error } }`)
        .then((data) => setJobs(data.jobQueue || []))
        .catch(() => setJobs((cur) => cur || []));
    }, []);

    useEffect(() => {
      load();
      gql(`query StashTokBoxes { configuration { general { stashBoxes { endpoint api_key } } } }`)
        .then((data) => {
          const general = (data && data.configuration && data.configuration.general) || {};
          setBoxes(general.stashBoxes || []);
        })
        .catch(() => {});
      const tick = window.setInterval(load, 2500);
      return () => window.clearInterval(tick);
    }, [load]);

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
      gql(`mutation StashTokStopJob($id: ID!) { stopJob(input: { job_id: $id }) }`, { id: jobId })
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

  function SettingsPanel({ cfg, feeds, onEdit, pin, onSetPin, onClearPin, sfw, onToggleSfw, prefs, setPref }) {
    const [draft, setDraft] = useState("");
    const [saved, setSaved] = useState(false);

    return h(
      "div",
      { className: "stk-settings", style: { marginTop: "16px" } },
      h("h4", null, "Blur (safe for work)"),
      h(
        "button",
        {
          className: "stk-switch-row" + (sfw ? " stk-on" : ""),
          onClick: () => onToggleSfw(!sfw),
        },
        h(
          "span",
          { className: "stk-switch-copy" },
          sfw ? "On — frames only" : "Off — playback",
          h(
            "small",
            null,
            sfw
              ? "Videos are never requested or played; the feed shows still frames."
              : "Videos stream and autoplay as usual."
          )
        ),
        h("span", { className: "stk-switch" }, h("span", { className: "stk-knob" }))
      ),
      h("h4", null, "Feed"),
      h(
        PrefRow,
        { title: "What lands in the feed", hint: "For You draws from this window", stack: true },
        h(PrefPills, {
          value: prefs.feedWindow,
          options: [["all", "Everything"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]],
          onChange: (value) => setPref("feedWindow", value),
        })
      ),
      h(
        PrefRow,
        { title: "Show file path", hint: "Print the folder path under the caption in the feed" },
        h(PrefToggle, { label: "Show path", on: !!prefs.showPath, onChange: (value) => setPref("showPath", value) })
      ),
      h("h4", { style: { marginTop: "18px" } }, "Performer page"),
      h(
        PrefRow,
        { title: "Default sort", hint: "Used the first time you open a performer", stack: true },
        h(PrefPills, {
          value: prefs.performerSort,
          options: [["filesize", "Size"], ["updated_at", "Recent"], ["duration", "Length"], ["resolution", "Res"], ["title", "A–Z"], ["random", "Random"]],
          onChange: (value) => setPref("performerSort", value),
        })
      ),
      h(
        PrefRow,
        { title: "Folders on top", hint: "Group a performer's clips by folder above the grid" },
        h(PrefToggle, { label: "Folders on top", on: prefs.foldersOnTop, onChange: (value) => setPref("foldersOnTop", value) })
      ),
      h(
        PrefRow,
        { title: "Show Images tab", hint: "" },
        h(PrefToggle, { label: "Images tab", on: prefs.performerImages, onChange: (value) => setPref("performerImages", value) })
      ),
      h(
        PrefRow,
        { title: "Show Markers tab", hint: "" },
        h(PrefToggle, { label: "Markers tab", on: prefs.performerMarkers, onChange: (value) => setPref("performerMarkers", value) })
      ),
      h("h4", { style: { marginTop: "18px" } }, "Favorites"),
      h(
        PrefRow,
        { title: "Sort order", hint: "How your hearted scenes are ordered", stack: true },
        h(PrefPills, {
          value: prefs.favoritesSort,
          options: [["updated_at", "Recent"], ["filesize", "Size"], ["duration", "Length"], ["resolution", "Res"], ["title", "A–Z"], ["random", "Random"]],
          onChange: (value) => setPref("favoritesSort", value),
        })
      ),
      h("h4", { style: { marginTop: "18px" } }, "Folder view"),
      h(
        PrefRow,
        { title: "Folders on top in any sort", hint: "Subfolders always lead, whatever the sort" },
        h(PrefToggle, { label: "Folders first", on: prefs.foldersOnTop, onChange: (value) => setPref("foldersOnTop", value) })
      ),
      h("h4", { style: { marginTop: "18px" } }, "Navigation"),
      h(
        PrefRow,
        { title: "Bottom bar", hint: "Long-press the last three buttons to change what they open" },
        h(
          "button",
          { className: "stk-btn", onClick: () => setPref("navSlots", DEFAULT_NAV_SLOTS.slice()) },
          "Reset"
        )
      ),
      h("h4", { style: { marginTop: "18px" } }, "Privacy lock"),
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

  const SFW_KEY = "stashtok.sfw";
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
    const baseCfg = usePluginConfig();
    const [prefs, setPrefs] = useState(loadPrefs);
    const [navPicker, setNavPicker] = useState(null);
    const [feedOptions, setFeedOptions] = useState(false);

    /* wide screens get the desktop shell: sidebar + one rounded video pane */
    const [desktop, setDesktop] = useState(
      () => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches
    );
    useEffect(() => {
      const mq = window.matchMedia("(min-width: 900px)");
      const onChange = () => setDesktop(mq.matches);
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
      return () => {
        if (mq.removeEventListener) mq.removeEventListener("change", onChange);
        else if (mq.removeListener) mq.removeListener(onChange);
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
            el.classList.add("stk-in");
            watcher.unobserve(el);
          });
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
      );
      const scan = () => {
        document.querySelectorAll(".stk-tile, .stk-account, .stk-fv-row").forEach((el) => {
          if (seen.has(el) || el.classList.contains("stk-in")) return;
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
    const navSlots = (prefs.navSlots && prefs.navSlots.length === 3 ? prefs.navSlots : DEFAULT_NAV_SLOTS).slice();

    function runNav(id) {
      /* every sidebar item is a fresh section: clear whatever page we were on first */
      setBuilder(null);
      setFolderProfile(null);
      setFolderView(null);
      setPerformersOpen(false);
      if (id === "performers") {
        setPerformerFilter(null);
        setTab("performers");
        goTo("performers");
      } else if (id === "search") {
        setTab("search");
        goTo("search");
      } else if (id === "favorites") {
        setPerformerFilter(null);
        setActiveFeed({ id: "favorites", name: "Favorites", type: "favorites" });
        setTab("home");
        setRefreshKey((n) => n + 1);
        goTo("favorites");
      } else if (id === "tags") {
        setTab("tags");
        goTo("tags");
      } else if (id === "folders") {
        setTab("folders");
        goTo("folders");
      } else if (id === "markers") {
        setPerformerFilter(null);
        setActiveFeed({ id: "markers", name: "Markers", type: "markers", sort: "random" });
        setTab("home");
        setRefreshKey((n) => n + 1);
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

    const setPref = useCallback((key, value) => {
      setPrefs((cur) => {
        const next = Object.assign({}, cur, { [key]: value });
        savePrefs(next);
        return next;
      });
    }, []);
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
    const [feeds, setFeeds] = useState(() => loadFeeds());
    const [activeFeed, setActiveFeed] = useState(defaultFeed());
    const [refreshKey, setRefreshKey] = useState(0);
    const [builder, setBuilder] = useState(null); // {spec} | 'new' | null
    const [performersOpen, setPerformersOpen] = useState(false);

    const [performerFilter, setPerformerFilter] = useState(null);
    const [tagFilter, setTagFilter] = useState(null);
    const [folderView, setFolderView] = useState(null);
    const [folderProfile, setFolderProfile] = useState(null);
    const [profileOpen, setProfileOpen] = useState(false);

    /* thumbnails stay blurred; pressing one peeks at it, nothing switches the blur off */
    useEffect(() => {
      const down = (event) => {
        const target = event.target;
        const host = target && target.closest && target.closest(".stk-tile, .stk-account, .stk-search-row, .stk-cover");
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

    /* ---- routing: the URL is the source of truth --------------------- */

    const liveRef = useRef({});
    liveRef.current = { tab, activeFeed };
    /* a feed we just opened on a scene, so the scene route does not replace it
       with a one-clip feed (the URL write lands before React re-renders) */
    const selfSceneRef = useRef(null);
    /* exact route we just wrote, so the router can skip re-applying it */
    const routeClaimRef = useRef(null);

    const applyRoute = useCallback((rest) => {
      if (routeClaimRef.current && routeClaimRef.current === rest) {
        routeClaimRef.current = null;
        return;
      }
      const live = liveRef.current || {};
      const feedNow = live.activeFeed || null;
      if (!rest) {
        setTab("home");
        setPerformerFilter(null);
        /* keep the feed you were on; only a second tap on Feed asks for new clips */
        setActiveFeed((cur) => cur || defaultFeed());
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
      if (rest.indexOf("performer/") === 0) {
        const tail = rest.slice("performer/".length);
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

    /* the page itself must never zoom: pinch belongs to the video only */
    useEffect(() => {
      const el = shellRef.current;
      if (!el) return undefined;
      const blockPinch = (event) => {
        if (!event.touches || event.touches.length < 2) return;
        // pinch is ours (video zoom); letting it through page-zoomed the whole UI
        event.preventDefault();
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
      try {
        const data = await gql(
          `query StashTokFindByName($q: String) { findPerformers(filter: { q: $q, per_page: 20 }) { performers { id name image_path scene_count } } }`,
          { q: name }
        );
        const list = (data.findPerformers && data.findPerformers.performers) || [];
        const exact = list.find((row) => row.name.toLowerCase() === name.toLowerCase()) || list[0];
        if (exact) {
          if (asProfile) openProfile(exact, false);
          else if (sceneId) openPerformer(exact, { sceneId }, false);
          else openProfile(exact, false);
        } else {
          setTab("performers");
        }
      } catch (err) {
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

    function goHome() {
      if (tab === "home" && !builder) {
        if (scopedFeed(activeFeed)) {
          // you are on a scoped feed: Feed means the root For You, not "refresh this page"
          setActiveFeed(defaultFeed());
          setRefreshKey((n) => n + 1);
          goTo("");
          return;
        }
        // second press on Feed: new clips, so forget where we were
        if (activeFeed) forgetResume(String(activeFeed.key || activeFeed.id || "foryou"));
        setActiveFeed((cur) =>
          cur ? Object.assign({}, cur, { startSceneId: null, startAt: null }) : defaultFeed()
        );
        setRefreshKey((n) => n + 1);
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

    /** the profile page: /performer/<name> */
    function openProfile(performer, push) {
      if (!performer) {
        setPerformersOpen(true);
        setTab("performers");
        return;
      }
      setPerformersOpen(false);
      setPerformerFilter(performer);
      setTagFilter(null);
      setTab("performers");
      if (push !== false) goTo("performer/" + encodeURIComponent(performer.name));
    }

    /** the clip feed for a performer: /performer/<name>/<sceneId> */
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
        sort: (payload && payload.sort) || "date",
        direction: (payload && payload.sort) === "title" ? "ASC" : "DESC",
        startSceneId: (payload && payload.sceneId) || null,
        startAt: (payload && payload.startAt) || null,
        origin: { kind: "performer", id: performer.id, performer },
      });
      setTab("home");
      setRefreshKey((n) => n + 1);
      if (push !== false && !(payload && payload.noPush)) {
        const route = "performer/" + encodeURIComponent(performer.name) + (payload && payload.sceneId ? "/" + payload.sceneId : "");
        // we just built this feed; the router must not rebuild it from the URL
        routeClaimRef.current = route;
        goTo(route);
      }
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
        onPick: openProfile,
        onBack: () => setTab("home"),
        onOpenTag: openTag,
        onProfileOpen: setProfileOpen,
        initialPerformer: performerFilter,
        prefs,
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
        onOpenTag: openTag,
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
      body = h(
        "div",
        { className: "stk-page" },
        h(
          "h2",
          { className: "stk-page-head" },
          "Settings",
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
          onEdit: (spec) => setBuilder({ spec }),
          pin,
          onSetPin: savePin,
          onClearPin: () => savePin(""),
          sfw,
          onToggleSfw: setSfwMode,
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
        desktop,
        prefs,
        spec: activeFeed,
        cfg: Object.assign({}, cfg, { windowDays: prefs.feedWindow === "all" ? 0 : Number(prefs.feedWindow) || 0 }),
        refreshKey,
        onSearch: () => {
          setTab("search");
          goTo("search");
        },
        onSettings: () => {
          setTab("settings");
          goTo("settings");
        },
        onOpenPerformer: openProfile,
        onOpenTag: openTag,
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
        onNewFeed: () => setBuilder({ spec: null }),
        onBack: () => {
          /* go back the way the user came: same page entry, same scroll, no reload */
          if (NAV_DEPTH > 0) {
            window.history.back();
            return;
          }
          const origin = (activeFeed && activeFeed.origin) || null;
          if (origin && origin.kind === "performer" && origin.performer) {
            openProfile(origin.performer, false);
            goTo("performer/" + encodeURIComponent(origin.performer.name), true);
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
          setActiveFeed((cur) => Object.assign({}, cur || defaultFeed(), { startSceneId: null, startAt: null }));
          setRefreshKey((n) => n + 1);
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

    return h(
      "div",
      {
        className:
          "stash-tok-wrap" +
          (locked ? " stk-locked" : "") +
          (sfw ? " stk-sfw" : "") +
          (desktop ? " stk-desktop" : ""),
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
            { className: "stk-desk-rail" },
            h("div", { className: "stk-desk-logo" }, "StashTok"),
            [
              ["feed", "Feed"],
              ["search", "Search"],
              ["performers", "Performers"],
              ["favorites", "Favorites"],
              ["tags", "Tags"],
              ["markers", "Markers"],
              ["folders", "Folders"],
            ].map(([id, label]) =>
              h(
                "button",
                {
                  key: id,
                  className:
                    "stk-desk-link" +
                    ((id === "feed" && tab === "home") || tab === id ? " stk-on" : ""),
                  onClick: () => (id === "feed" ? goHome() : runNav(id)),
                },
                label
              )
            )
          ),
        body,

        /* operations sits beside settings: one tap, never buried in settings */
        tab !== "settings" && tab !== "ops" && tab !== "home" && tab !== "folderProfile" && !profileOpen &&
          h(
            "button",
            {
              className: "stk-gear-fab stk-ops-fab",
              title: "Operations",
              onClick: () => {
                setTab("ops");
                goTo("ops");
              },
            },
            h(Icon, { name: "ops", size: 18 })
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
            icon: "feed",
            label: "Feed",
            onClick: goHome,
            onLongPress: () => setFeedOptions(true),
          }),
          h(NavButton, {
            active: tab === "performers",
            icon: "user",
            label: "Performers",
            onClick: () => {
              setTab("performers");
              goTo("performers");
            },
          }),
          navSlots.map((id, slot) => {
            const option = NAV_OPTIONS.find((entry) => entry.id === id) || NAV_OPTIONS[0];
            return h(NavButton, {
              key: "slot-" + slot,
              active: false,
              icon: option.icon,
              label: option.label,
              onClick: () => runNav(option.id),
              onLongPress: () => setNavPicker({ slot, id: option.id }),
            });
          })
        ),

        feedOptions &&
          h(
            React.Fragment,
            null,
            h("div", { className: "stk-sheet-backdrop", onClick: () => setFeedOptions(false) }),
            h(
              "div",
              { className: "stk-sheet", onClick: (event) => event.stopPropagation() },
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
              { className: "stk-sheet", onClick: (event) => event.stopPropagation() },
              h(
                "h3",
                null,
                h("span", null, "Navigation button"),
                h("button", { className: "stk-btn", onClick: () => setNavPicker(null) }, h(Icon, { name: "x", size: 16 }))
              ),
              h("p", { className: "stk-sub" }, "Long-press the last three nav buttons to change what they open."),
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
