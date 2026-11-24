#!/usr/bin/env python3
"""Highlight reel for StashTok -- an endless playlist of the originals.

The first edition decoded 3 s out of every clip and stitched the pieces into one
MP4. The second was a fixed 60-window playlist. This one is an endless stream:
position N is a deterministic 3 s window somewhere in the library, so the player
can walk forward forever and walk backward into what it already played without
anything being rendered, cut or written.

Routes
  GET  /player?performerId=|tagId=&port=&name=   the player page
  GET  /stream?performerId=|tagId=&port=&start=&count=
                                                 windows [start, start+count)
  GET  /stream.m3u8?same args                    the same windows as an M3U index
  GET  /src/scene/<sceneId>?port=                original stream, Range passed
                                                 through, ApiKey added server-side
  GET  /plan ...  /reel/<job>.m3u8  /src/<job>/<i>   the old fixed plan, kept
  POST /favorite  {sceneId, port, rating}        write rating100 (a heart)
  GET  /healthz

Env
  REEL_PORT        listen port                     (default 19000)
  REEL_CACHE       where plans are kept            (default ~/.cache/stashtok-reels)
  REEL_SEC         window length in seconds        (default 3)
  REEL_STASH_9998  Stash base url for the 9998 app (default http://127.0.0.1:9998)
  REEL_STASH_9997  Stash base url for the 9997 app (default http://127.0.0.1:9997)
  REEL_KEYCMD_9998 how to read that instance's key (default docker exec stash-wario ...)

The API key is read with the key command at request time, kept in memory, and
never logged, returned, or put in a URL the browser can see.
"""
import hashlib
import json
import os
import random
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("REEL_PORT", "19000"))
CACHE = os.path.expanduser(os.environ.get("REEL_CACHE", "~/.cache/stashtok-reels"))
SEG = max(1.0, float(os.environ.get("REEL_SEC", "3")))
MAX_WINDOWS = 60
MAX_TOTAL_SECONDS = 200
# A scene is only worth putting in the playlist if the browser can decode the
# bytes as they are: an export is exactly what this service exists to avoid.
CONTAINERS = {".mp4", ".m4v", ".mov", ".webm", ".ogv"}
VIDEO_CODECS = {"h264", "vp8", "vp9", "av1", "theora"}
AUDIO_CODECS = {"", "aac", "mp3", "opus", "vorbis"}
PLAN_TTL = 60
SCENE_TTL = 120
CHUNK = 20

INSTANCES = {
    "9998": {
        "url": os.environ.get("REEL_STASH_9998", "http://127.0.0.1:9998").rstrip("/"),
        "keycmd": os.environ.get(
            "REEL_KEYCMD_9998",
            "docker exec stash-wario sed -n 's/^api_key: *//p' /root/.stash/config.yml",
        ),
    },
    "9997": {
        "url": os.environ.get("REEL_STASH_9997", "http://127.0.0.1:9997").rstrip("/"),
        "keycmd": os.environ.get(
            "REEL_KEYCMD_9997",
            "docker exec stash-of sed -n 's/^api_key: *//p' /root/.stash/config.yml",
        ),
    },
}

JOBS = {}
KEYS = {}
PLANS = {}
SCENES = {}
LOCK = threading.Lock()


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, flush=True)


def key_for(port):
    """The instance's Stash API key, cached for the process lifetime."""
    with LOCK:
        if port in KEYS:
            return KEYS[port]
        inst = INSTANCES.get(port)
        if not inst:
            raise RuntimeError("unknown Stash instance on port %s" % port)
        if inst.get("key"):
            KEYS[port] = inst["key"]
            return KEYS[port]
        out = subprocess.run(inst["keycmd"], shell=True, capture_output=True, text=True)
        key = out.stdout.strip()
        if not key:
            raise RuntimeError("could not read the %s api key" % port)
        KEYS[port] = key
        return key


def gql(port, query, variables=None):
    inst = INSTANCES[port]
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        inst["url"] + "/graphql",
        data=body,
        headers={"Content-Type": "application/json", "ApiKey": key_for(port)},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read())
    if payload.get("errors"):
        raise RuntimeError("; ".join(e.get("message", "?") for e in payload["errors"]))
    return payload["data"]


PLAYER_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Highlight reel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  body { color: #fff; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         -webkit-user-select: none; user-select: none; overscroll-behavior: none; }
  #stage { position: fixed; inset: 0; background: #000; }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
          background: #000; opacity: 0; z-index: 1; transition: opacity .2s linear; }
  video.on { opacity: 1; z-index: 2; }
  video.cover { object-fit: cover; }
  #hud { position: fixed; inset: 0; z-index: 5; pointer-events: none;
         display: flex; flex-direction: column; justify-content: space-between;
         transition: opacity .25s ease; }
  #hud.away { opacity: 0; }
  header { display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top)) 14px 10px;
           font-size: 12px; letter-spacing: .07em; text-transform: uppercase;
           color: rgba(255,255,255,.72);
           background: linear-gradient(rgba(0,0,0,.55), transparent); }
  header b { font-size: 13px; letter-spacing: 0; text-transform: none; color: #fff; font-weight: 600;
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .sp { flex: 1; }
  header a { pointer-events: auto; color: inherit; text-decoration: none; border: 1px solid rgba(255,255,255,.22);
             border-radius: 999px; padding: 5px 11px; }
  footer { padding: 10px 14px calc(12px + env(safe-area-inset-bottom));
           background: linear-gradient(transparent, rgba(0,0,0,.6)); }
  #bar { height: 3px; border-radius: 999px; background: rgba(255,255,255,.16); overflow: hidden; }
  #fill { display: block; height: 100%; width: 0; background: #ff2d55; }
  #note { margin-top: 8px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
          color: rgba(255,255,255,.55); display: flex; gap: 12px; }
  #note span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #note span:last-child { margin-left: auto; white-space: nowrap; }
  #start { position: fixed; inset: 0; z-index: 9; display: flex; align-items: center; justify-content: center;
           flex-direction: column; gap: 10px; background: rgba(0,0,0,.55); cursor: pointer; }
  #start.gone { display: none; }
  #start b { font-size: 15px; font-weight: 600; }
  #start i { font-style: normal; font-size: 12px; color: rgba(255,255,255,.6); text-align: center; padding: 0 28px; }
  #err { position: fixed; left: 0; right: 0; bottom: 40%; z-index: 10; text-align: center;
         color: #ff8098; font-size: 13px; padding: 0 24px; display: none; }
  /* paused: the clip you are looking at, where it lives, and what you can do with it */
  #pause { position: fixed; left: 0; right: 0; bottom: 0; z-index: 7;
           padding: 16px 14px calc(18px + env(safe-area-inset-bottom));
           background: linear-gradient(transparent, rgba(0,0,0,.82) 34%);
           display: flex; flex-direction: column; gap: 10px;
           transition: opacity .2s ease, transform .2s ease; }
  #pause.gone { opacity: 0; transform: translateY(12px); pointer-events: none; }
  #ptitle { font-size: 15px; font-weight: 650; line-height: 1.25; }
  #pmeta { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: rgba(255,255,255,.6); }
  #prow { display: flex; gap: 8px; flex-wrap: wrap; }
  #prow a, #prow button { font: inherit; font-size: 13px; font-weight: 600; color: #fff;
    background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.18);
    border-radius: 999px; padding: 9px 15px; text-decoration: none; cursor: pointer; }
  #prow a:active, #prow button:active { background: rgba(255,255,255,.22); }
  #prow button.on { background: rgba(255,45,85,.85); border-color: rgba(255,45,85,.9); }
</style></head>
<body>
<div id="stage">
  <video id="a" playsinline preload="auto"></video>
  <video id="b" playsinline preload="auto"></video>
  <video id="c" playsinline preload="auto"></video>
</div>
<div id="hud">
  <header><b id="name">highlight reel</b><span class="sp"></span>
    <span id="count"></span><a id="stash" target="_blank" rel="noopener">stash</a></header>
  <footer>
    <div id="bar"><i id="fill"></i></div>
    <div id="note"><span id="what">loading&hellip;</span><span id="clock"></span></div>
  </footer>
</div>
<div id="pause" class="gone">
  <div id="ptitle"></div>
  <div id="pmeta"></div>
  <div id="prow">
    <a id="popen" target="_blank" rel="noopener">Open in Stash</a>
    <button id="pfav" type="button">&#9829; Favorite</button>
    <button id="pnext" type="button">Next &#8594;</button>
  </div>
</div>
<div id="start"><b>Tap to play</b><i id="startsub"></i></div>
<div id="err"></div>
<script>
(() => {
  const q = new URLSearchParams(location.search);
  const port = q.get("port") || "9998";
  const byId = (id) => document.getElementById(id);
  const vids = [byId("a"), byId("b"), byId("c")];
  const hud = byId("hud"), start = byId("start"), pauseEl = byId("pause");
  const nameEl = byId("name"), countEl = byId("count");
  const whatEl = byId("what"), clockEl = byId("clock"), fill = byId("fill");
  const stashEl = byId("stash"), errEl = byId("err");
  const ptitle = byId("ptitle"), pmeta = byId("pmeta"), popen = byId("popen");
  const pfav = byId("pfav"), pnext = byId("pnext");

  let buf = [], base = 0, pos = 0;
  let active = null, ahead = null, behind = null;
  let playing = false, switched = 0, hideTimer = 0, busy = false, lastTouch = 0;
  const failed = new Set();
  let sceneBase = "";

  const mmss = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + String(s).padStart(2, "0"); };
  const keyOf = (w) => String(w.key);

  function reveal() {
    hud.classList.remove("away");
    clearTimeout(hideTimer);
    if (playing) hideTimer = setTimeout(() => hud.classList.add("away"), 3200);
  }

  function fit(v) {
    if (!v.videoWidth || !v.videoHeight) return;
    const a = v.videoWidth / v.videoHeight, b = innerWidth / innerHeight;
    v.classList.toggle("cover", a / b > 0.8 && a / b < 1.25);
  }

  function loadInto(v, w) {
    if (!v || !w) return;
    const src = "/src/scene/" + w.scene + "?port=" + port;
    v.dataset.key = String(w.key);
    v.dataset.at = String(w.at);
    v.dataset.dur = String(w.dur);
    v.dataset.scene = String(w.scene);
    v.dataset.title = w.title || "";
    if (v.getAttribute("src") === src && v.readyState >= 1) {
      try { v.currentTime = w.at; } catch (e) {}
      return;
    }
    v.src = src;
    v.load();
  }

  vids.forEach((v) => {
    v.addEventListener("loadedmetadata", () => {
      fit(v);
      const at = Number(v.dataset.at || 0);
      if (v.duration && at > v.duration - 0.5) {
        try { v.currentTime = Math.max(0, v.duration - 1); } catch (e) {}
      } else {
        try { v.currentTime = at; } catch (e) {}
      }
      if (v === active && playing) v.play().catch(() => {});
    });
    v.addEventListener("canplay", () => {
      if (v === active && playing) v.play().catch(() => {});
    });
    v.addEventListener("ended", () => { if (v === active) go(1); });
    v.addEventListener("error", () => {
      const k = v.dataset.key;
      if (k !== undefined) failed.add(k);
      if (v === active) {
        flash("skipping a clip (cannot load)");
        go(1);
      }
    });
  });

  function flash(msg) {
    errEl.textContent = msg;
    errEl.style.display = "block";
    setTimeout(() => { errEl.style.display = "none"; }, 1500);
  }

  async function fetchRange(from, count) {
    const p = new URLSearchParams(q);
    p.set("start", String(from));
    p.set("count", String(count));
    const res = await fetch("/stream?" + p.toString(), { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "stream failed");
    return data.windows || [];
  }

  async function ensureAhead() {
    if (pos + 3 < buf.length) return;
    const chunk = await fetchRange(base + buf.length, CHUNK);
    if (chunk.length) buf = buf.concat(chunk);
  }

  async function ensureBehind() {
    if (pos >= 3) return;
    const chunk = await fetchRange(base - CHUNK, CHUNK);
    if (chunk.length) { buf = chunk.concat(buf); base -= chunk.length; pos += chunk.length; }
  }

  function hudFor() {
    const w = buf[pos];
    if (!w) return;
    countEl.textContent = "#" + (w.key + 1);
    whatEl.textContent = w.title || ("scene " + w.scene);
    const at = Number(w.at) || 0;
    clockEl.textContent = mmss(at) + " \u2013 " + mmss(at + Number(w.dur || 0));
    if (sceneBase) {
      stashEl.href = sceneBase + "/scenes/" + w.scene;
      stashEl.style.display = "";
      popen.href = stashEl.href;
    } else {
      stashEl.style.display = "none";
      popen.removeAttribute("href");
    }
    ptitle.textContent = w.title || ("scene " + w.scene);
    pmeta.textContent = "scene " + w.scene + " \u00b7 " + mmss(at) + " \u2013 " + mmss(at + Number(w.dur || 0));
    pfav.classList.remove("on");
    pfav.textContent = "\u2665 Favorite";
  }

  async function go(delta) {
    if (busy) return;
    busy = true;
    try {
      if (delta > 0) await ensureAhead(); else await ensureBehind();
      const target = pos + delta;
      if (target < 0 || target >= buf.length) return;
      const w = buf[target];
      const candidate = delta > 0 ? ahead : behind;
      const oldActive = active;
      const oldAhead = ahead, oldBehind = behind;
      if (!candidate) return;
      pos = target;
      active = candidate;
      if (delta > 0) { ahead = oldBehind; behind = oldActive; }
      else { behind = oldAhead; ahead = oldActive; }
      loadInto(active, w);
      active.classList.add("on");
      for (const v of vids) if (v !== active) v.classList.remove("on");
      switched = Date.now();
      if (playing) active.play().catch(() => {});
      hudFor();
      reveal();
      /* the outgoing element is still fading: give the crossfade its 200 ms
         before its src is replaced, or the frame goes black mid-dissolve */
      setTimeout(() => {
        loadInto(ahead, buf[pos + 1]);
        loadInto(behind, buf[pos - 1]);
      }, 220);
    } catch (err) {
      flash(err.message || "load failed");
    } finally {
      busy = false;
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    const w = buf[pos];
    if (!w || !active) return;
    const at = Number(active.dataset.at || w.at || 0);
    const dur = Number(active.dataset.dur || w.dur || 1);
    const t = active.currentTime || 0;
    const p = Math.max(0, Math.min(1, (t - at) / Math.max(0.2, dur)));
    fill.style.width = (100 * p) + "%";
    if (t >= at + dur - 0.04) { go(1); return; }
    /* readyState 1 means the metadata is in and the seek worked: it is just
       buffering a 4K original, which is the whole point of this player. Only a
       clip that never even parsed is worth skipping. */
    if (switched && Date.now() - switched > 20000 && active.readyState === 0) {
      switched = 0;
      failed.add(String(w.key));
      go(1);
    }
  }

  function setPlaying(on) {
    playing = on;
    if (on) {
      pauseEl.classList.add("gone");
      reveal();
    } else {
      pauseEl.classList.remove("gone");
      hud.classList.remove("away");
      clearTimeout(hideTimer);
    }
  }

  function toggle() {
    if (!active) return;
    if (active.paused) {
      setPlaying(true);
      active.play().catch((err) => { if (err.name !== "AbortError") setPlaying(false); });
    } else {
      active.pause();
      setPlaying(false);
    }
  }

  async function favorite() {
    const w = buf[pos];
    if (!w) return;
    pfav.disabled = true;
    try {
      const res = await fetch("/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: w.scene, port: port, rating: 100 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "favorite failed");
      pfav.classList.add("on");
      pfav.textContent = "\u2665 Favorited";
    } catch (err) {
      flash(err.message || "favorite failed");
    } finally {
      pfav.disabled = false;
    }
  }

  addEventListener("keydown", (e) => {
    if (!start.classList.contains("gone")) return;
    if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); go(-1); }
    else if (e.key === "m") vids.forEach((v) => { v.muted = !v.muted; });
    else if (e.key === "f") favorite();
  });

  addEventListener("click", (e) => {
    if (e.target.closest("a") || e.target.closest("button")) return;
    if (!start.classList.contains("gone")) return;
    if (Date.now() - lastTouch < 700) return;
    toggle();
  });

  /* mobile: a swipe is the next/previous, a tap is pause. The crossfade is the
     transition, not a scroll: the clip fades rather than sliding. */
  let touch0 = null;
  addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { touch0 = null; return; }
    touch0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  addEventListener("touchend", (e) => {
    lastTouch = Date.now();
    if (!touch0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch0.x, dy = t.clientY - touch0.y;
    const dt = Date.now() - touch0.t;
    touch0 = null;
    if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx)) {
      go(dy < 0 ? 1 : -1);
    } else if (dt < 320 && Math.abs(dx) < 14 && Math.abs(dy) < 14) {
      if (!start.classList.contains("gone")) return;
      toggle();
    }
  }, { passive: true });

  addEventListener("mousemove", reveal);
  addEventListener("resize", () => vids.forEach(fit));

  pnext.addEventListener("click", (e) => { e.stopPropagation(); go(1); });
  pfav.addEventListener("click", (e) => { e.stopPropagation(); favorite(); });

  (async () => {
    try {
      sceneBase = location.protocol + "//" + location.hostname + ":" + port;
      const first = await fetchRange(-CHUNK, CHUNK * 3 + 1);
      if (!first.length) throw new Error("no clip in this library can be played as-is");
      buf = first;
      base = -CHUNK;
      pos = CHUNK;
      active = vids[0]; ahead = vids[1]; behind = vids[2];
      loadInto(active, buf[pos]);
      loadInto(ahead, buf[pos + 1]);
      loadInto(behind, buf[pos - 1]);
      active.classList.add("on");
      const plan = await fetch("/plan?" + q.toString(), { cache: "no-store" });
      const meta = await plan.json().catch(() => ({}));
      nameEl.textContent = meta.name || "highlight reel";
      document.getElementById("startsub").textContent =
        "3 s at a time, straight from the originals \\u00b7 swipe or arrow keys to move, tap to pause";
      hudFor();
      start.addEventListener("click", (e) => {
        e.stopPropagation();
        start.classList.add("gone");
        setPlaying(true);
        active.play().catch((err) => { if (err.name !== "AbortError") setPlaying(false); });
      }, { once: true });
      requestAnimationFrame(tick);
    } catch (err) {
      errEl.textContent = "failed: " + err.message;
      errEl.style.display = "block";
      start.classList.add("gone");
    }
  })();
})();
</script>
</body></html>"""

REEL_QUERY = """
query ReelScenes($id: ID!) {
  findScenes(scene_filter: { performers: { value: [$id], modifier: INCLUDES } },
             filter: { per_page: 400, sort: "date", direction: DESC }) {
    count
    scenes { id title files { duration video_codec audio_codec path } }
  }
}
"""

TAG_QUERY = """
query ReelTagScenes($id: ID!) {
  findScenes(scene_filter: { tags: { value: [$id], modifier: INCLUDES } },
             filter: { per_page: 400, sort: "date", direction: DESC }) {
    count
    scenes { id title files { duration video_codec audio_codec path } }
  }
}
"""

FAV_MUT = """
mutation Fav($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id rating100 } }
"""


def windows_for(duration):
    """How many windows a clip of this length gets in the legacy fixed plan."""
    if duration < 45:
        return 1
    if duration < 120:
        return 2
    if duration < 300:
        return 3
    return 5


def playable(path, vcodec, acodec):
    """Whether the browser can decode this file untouched. A .mkv or a .wmv can
    only be replayed by transcoding it, and transcoding is the thing this
    service set out to stop doing, so those clips are left out and counted."""
    ext = os.path.splitext(path or "")[1].lower()
    return (
        ext in CONTAINERS
        and (vcodec or "").lower() in VIDEO_CODECS
        and (acodec or "").lower() in AUDIO_CODECS
    )


def primary_file(scene):
    """The longest file of a scene: a split scene should be sampled from its
    longest part, which is also the one that carries the scene's duration."""
    best, best_dur = None, -1.0
    for f in scene.get("files") or []:
        try:
            dur = float(f.get("duration") or 0)
        except (TypeError, ValueError):
            dur = 0.0
        if dur > best_dur:
            best, best_dur = f, dur
    return best, max(0.0, best_dur)


def _rng(seed, key):
    digest = hashlib.blake2b(("%s|%d" % (seed, key)).encode(), digest_size=8).digest()
    return random.Random(int.from_bytes(digest, "big"))


def scenes_for(port, kind, ident):
    """Playable scenes for a performer or a tag, cached for a couple of minutes.

    Returns [(scene_id, title, duration)] in the order Stash gave them, so the
    same seed produces the same stream on every request."""
    cache_key = (port, kind, ident)
    now = time.time()
    with LOCK:
        hit = SCENES.get(cache_key)
    if hit and now - hit[0] < SCENE_TTL:
        return hit[1]
    query = TAG_QUERY if kind == "tag" else REEL_QUERY
    data = gql(port, query, {"id": ident})
    rows = []
    skipped = 0
    for scene in (data.get("findScenes") or {}).get("scenes") or []:
        f, duration = primary_file(scene)
        if not f or duration < SEG + 3:
            continue
        if not playable(f.get("path"), f.get("video_codec"), f.get("audio_codec")):
            skipped += 1
            continue
        rows.append((str(scene["id"]), scene.get("title") or "", duration))
    with LOCK:
        SCENES[cache_key] = (now, rows)
    log("scenes", kind, ident, len(rows), "playable,", skipped, "left out")
    return rows


def stream_seed(rows):
    return hashlib.blake2b(
        ("|".join(sorted(r[0] for r in rows))).encode(), digest_size=4
    ).hexdigest()


def stream_windows(port, kind, ident, start, count):
    """Windows [start, start+count) of the endless stream.

    Each position is a pure function of the seed and the position, so going back
    to #412 asks for the same 3 s of the same file it played the first time, and
    nothing has to be remembered between requests."""
    rows = scenes_for(port, kind, ident)
    if not rows:
        return []
    seed = stream_seed(rows)
    n = len(rows)
    out = []
    for key in range(start, start + count):
        r = _rng(seed, key)
        idx = r.randrange(n)
        if key > 0 and n > 1:
            prev = _rng(seed, key - 1).randrange(n)
            if idx == prev:
                idx = (idx + 1) % n
        scene_id, title, duration = rows[idx]
        high = max(1.0, duration - SEG - 0.5)
        at = round(r.uniform(1.0, high), 2)
        out.append({
            "key": key,
            "scene": scene_id,
            "title": title,
            "at": at,
            "dur": round(min(SEG, max(0.5, duration - at - 0.2)), 2),
            "src": "/src/scene/%s?port=%s" % (scene_id, port),
        })
    return out


def stream_m3u8(port, kind, ident, start, count):
    windows = stream_windows(port, kind, ident, start, count)
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "# StashTok highlight index -- not HLS segments. Each entry is an",
        "# original file; EXT-X-STASHTOK-START says where the browser starts.",
        "#EXT-X-STASHTOK-WINDOWS:%d" % len(windows),
        "#EXT-X-TARGETDURATION:%d" % (int(SEG) + 1),
        "#EXT-X-PLAYLIST-TYPE:VOD",
    ]
    for w in windows:
        stamp = time.strftime("%H:%M:%S", time.gmtime(int(w["at"])))
        lines.append("#EXTINF:%.2f,%s @ %s" % (
            w["dur"], (w["title"] or "scene " + w["scene"])[:70], stamp))
        lines.append("#EXT-X-STASHTOK-SCENE:" + w["scene"])
        lines.append("#EXT-X-STASHTOK-START:%.2f" % w["at"])
        lines.append(w["src"])
    lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"


def plan_windows(scenes, seed, seg):
    """The legacy fixed plan: 3 s windows, five of them in a long video,
    round-robin across clips so the playlist alternates scenes."""
    rng = random.Random(seed)
    per_scene = []
    skipped = 0
    taken = 0
    for scene in scenes:
        if taken >= MAX_WINDOWS or taken * seg >= MAX_TOTAL_SECONDS:
            break
        f, duration = primary_file(scene)
        if not f or duration < seg + 3:
            continue
        if not playable(f.get("path"), f.get("video_codec"), f.get("audio_codec")):
            skipped += 1
            continue
        count = windows_for(duration)
        low, high = 1.0, max(1.0, duration - seg - 0.5)
        row = []
        for _ in range(count):
            at = round(rng.uniform(low, high), 2)
            row.append({
                "scene": str(scene["id"]),
                "title": scene.get("title") or "",
                "at": at,
                "dur": round(min(seg, duration - at - 0.2), 2),
            })
        per_scene.append(row)
        taken += count

    windows = []
    depth = 0
    while len(windows) < MAX_WINDOWS:
        added = False
        for row in per_scene:
            if depth < len(row) and len(windows) < MAX_WINDOWS:
                windows.append(row[depth])
                added = True
        if not added:
            break
        depth += 1
    return windows[:MAX_WINDOWS], skipped


def build_plan(port, performer_id, name):
    data = gql(port, REEL_QUERY, {"id": performer_id})
    scenes = (data.get("findScenes") or {}).get("scenes") or []
    seed = int(hashlib.blake2b(
        ("|".join(sorted(str(s["id"]) for s in scenes))).encode(), digest_size=4
    ).hexdigest(), 16)
    windows, skipped = plan_windows(scenes, seed, SEG)
    job = hashlib.blake2b(
        json.dumps([port, performer_id, windows, SEG]).encode(), digest_size=8
    ).hexdigest()
    for i, w in enumerate(windows):
        w["src"] = "/src/%s/%d" % (job, i)
    plan = {
        "job": job,
        "performerId": performer_id,
        "port": port,
        "name": name or "",
        "seg": SEG,
        "seconds": round(sum(w["dur"] for w in windows), 1),
        "unplayable": skipped,
        "stash": INSTANCES[port]["url"],
        "windows": windows,
    }
    with LOCK:
        JOBS[job] = plan
    try:
        os.makedirs(CACHE, exist_ok=True)
        with open(os.path.join(CACHE, job + ".json"), "w") as fh:
            json.dump(plan, fh)
    except OSError as exc:
        log("could not persist plan", job, exc)
    log("plan", job, "performer", performer_id, len(windows), "windows,", skipped,
        "left out,", "%ss" % plan["seconds"])
    return plan


def m3u8(plan):
    """The playlist as an extended M3U. This is an index, not HLS: each entry is
    a whole original file plus where in it to start, which is why it carries
    StashTok tags and a plain HLS player would play it wrong."""
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "# StashTok highlight index -- not HLS segments. Each entry is an",
        "# original file; EXT-X-STASHTOK-START says where the browser starts.",
        "#EXT-X-STASHTOK-NAME:" + (plan["name"] or plan["performerId"]),
        "#EXT-X-STASHTOK-WINDOWS:%d" % len(plan["windows"]),
        "#EXT-X-TARGETDURATION:%d" % (int(SEG) + 1),
        "#EXT-X-PLAYLIST-TYPE:VOD",
    ]
    for w in plan["windows"]:
        stamp = time.strftime("%H:%M:%S", time.gmtime(int(w["at"])))
        lines.append("#EXTINF:%.2f,%s @ %s" % (
            w["dur"], (w["title"] or "scene " + w["scene"])[:70], stamp))
        lines.append("#EXT-X-STASHTOK-SCENE:" + w["scene"])
        lines.append("#EXT-X-STASHTOK-START:%.2f" % w["at"])
        lines.append(w["src"])
    lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    server_version = "StashTokReel/3.0"
    protocol_version = "HTTP/1.1"

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _html(self, body):
        body = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _m3u(self, text):
        body = text.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802 - http.server naming
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _target(self, params):
        """(port, kind, ident) from the query, or an error string."""
        port = str(params.get("port") or "9998")
        if port not in INSTANCES:
            return None, None, None, "unknown instance"
        performer = str(params.get("performerId") or "").strip()
        tag = str(params.get("tagId") or "").strip()
        if performer.isdigit():
            return port, "performer", performer, None
        if tag.isdigit():
            return port, "tag", tag, None
        return None, None, None, "performerId or tagId required"

    def _stream(self, params):
        port, kind, ident, err = self._target(params)
        if err:
            return self._json(400, {"error": err})
        try:
            start = int(params.get("start") or 0)
            count = max(1, min(200, int(params.get("count") or CHUNK)))
        except ValueError:
            return self._json(400, {"error": "start and count must be integers"})
        try:
            windows = stream_windows(port, kind, ident, start, count)
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            return self._json(502, {"error": "Stash query failed: %s" % str(exc)[:200]})
        if not windows:
            return self._json(422, {"error": "no clip in this library can be played as-is"})
        return self._json(200, {
            "port": port,
            "kind": kind,
            "id": ident,
            "start": start,
            "count": len(windows),
            "seg": SEG,
            "windows": windows,
        })

    def _plan(self, params):
        performer_id = str(params.get("performerId", "")).strip()
        if not performer_id.isdigit():
            return self._json(400, {"error": "performerId required"})
        port = str(params.get("port") or "9998")
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        name = params.get("name") or ""
        cache_key = (port, performer_id, name)
        now = time.time()
        with LOCK:
            hit = PLANS.get(cache_key)
        if hit and now - hit[0] < PLAN_TTL and not params.get("refresh"):
            return self._json(200, hit[1])
        try:
            plan = build_plan(port, performer_id, name)
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            return self._json(502, {"error": "Stash query failed: %s" % str(exc)[:200]})
        if not plan["windows"]:
            return self._json(422, {"error": "no clip in this library can be played as-is"})
        with LOCK:
            PLANS[cache_key] = (now, plan)
        return self._json(200, plan)

    def _favorite(self, body):
        scene_id = str(body.get("sceneId") or "").strip()
        port = str(body.get("port") or "9998")
        if not scene_id.isdigit():
            return self._json(400, {"error": "sceneId required"})
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        try:
            rating = int(body.get("rating", 100))
        except (TypeError, ValueError):
            rating = 100
        rating = max(0, min(100, rating))
        try:
            data = gql(port, FAV_MUT, {"input": {"id": scene_id, "rating100": rating}})
        except Exception as exc:  # noqa: BLE001
            return self._json(502, {"error": "Stash update failed: %s" % str(exc)[:200]})
        scene = (data or {}).get("sceneUpdate") or {}
        return self._json(200, {"ok": True, "id": scene.get("id", scene_id),
                                "rating100": scene.get("rating100", rating)})

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        if path == "/healthz":
            with LOCK:
                return self._json(200, {"ok": True, "plans": len(JOBS)})
        if path == "/player":
            return self._html(PLAYER_HTML)
        if path == "/stream":
            return self._stream(params)
        if path == "/stream.m3u8":
            port, kind, ident, err = self._target(params)
            if err:
                return self._json(400, {"error": err})
            try:
                start = int(params.get("start") or 0)
                count = max(1, min(200, int(params.get("count") or MAX_WINDOWS)))
            except ValueError:
                return self._json(400, {"error": "start and count must be integers"})
            return self._m3u(stream_m3u8(port, kind, ident, start, count))
        if path == "/plan":
            return self._plan(params)
        if path.startswith("/reel/") and path.endswith(".m3u8"):
            job = path.split("/")[2][: -len(".m3u8")]
            plan = self._plan_for(job)
            if not plan:
                return self._json(404, {"error": "no such playlist"})
            return self._m3u(m3u8(plan))
        if path.startswith("/src/"):
            return self._proxy(path, params)
        return self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        route = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})
        if route == "/favorite":
            return self._favorite(body)
        if route == "/reel":
            return self._plan({k: str(v) for k, v in body.items() if v is not None})
        return self._json(404, {"error": "not found"})

    def _plan_for(self, job):
        with LOCK:
            plan = JOBS.get(job)
        if plan:
            return plan
        try:
            with open(os.path.join(CACHE, job + ".json")) as fh:
                plan = json.load(fh)
        except (OSError, ValueError):
            return None
        with LOCK:
            JOBS[job] = plan
        return plan

    def _proxy(self, path, params):
        """Hand the browser the original bytes, with the instance's key attached
        here so it never reaches the page, and Range forwarded untouched: the
        seek the player does is a byte range, not an export.

        /src/scene/<sceneId>?port=  streams one scene directly.
        /src/<job>/<i>              the legacy fixed-plan window.
        """
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[1] == "scene":
            scene_id = parts[2]
            port = str(params.get("port") or "9998")
            if port not in INSTANCES:
                return self._json(400, {"error": "unknown instance"})
        elif len(parts) == 3:
            plan = self._plan_for(parts[1])
            if not plan:
                return self._json(404, {"error": "no such playlist"})
            try:
                win = plan["windows"][int(parts[2])]
            except (ValueError, IndexError):
                return self._json(404, {"error": "no such window"})
            scene_id = win["scene"]
            port = plan["port"]
        else:
            return self._json(404, {"error": "not found"})
        inst = INSTANCES[port]
        url = "%s/scene/%s/stream" % (inst["url"], scene_id)
        headers = {"ApiKey": key_for(port)}
        rng = self.headers.get("Range")
        if rng:
            headers["Range"] = rng
        try:
            resp = urllib.request.urlopen(
                urllib.request.Request(url, headers=headers), timeout=45
            )
        except urllib.error.HTTPError as exc:
            return self._json(502, {"error": "stash answered %s" % exc.code})
        except Exception as exc:  # noqa: BLE001
            return self._json(502, {"error": "stash unreachable: %s" % type(exc).__name__})
        with resp:
            self.send_response(resp.status)
            for head in ("Content-Type", "Content-Length", "Content-Range",
                         "Accept-Ranges", "Last-Modified", "ETag"):
                value = resp.headers.get(head)
                if value:
                    self.send_header(head, value)
            if not resp.headers.get("Accept-Ranges"):
                self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            try:
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                # the player seeked away or moved on. The Content-Length is still
                # owed, so the socket cannot be reused: close it and drop out.
                self.close_connection = True
                return

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        if self.path.startswith(("/src/", "/plan", "/stream", "/status/")):
            return
        log("%s %s" % (self.command, getattr(self, "path", "")))


def main():
    os.makedirs(CACHE, exist_ok=True)
    for port, inst in INSTANCES.items():
        try:
            inst["key"] = key_for(port)
            log("instance %s -> %s (key ok)" % (port, inst["url"]))
        except Exception as exc:  # noqa: BLE001
            log("instance %s unavailable: %s" % (port, exc))
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log("highlight reels on :%d, %.0fs windows, cache %s" % (PORT, SEG, CACHE))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
