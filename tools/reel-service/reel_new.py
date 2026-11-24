#!/usr/bin/env python3
"""Highlight reel for StashTok -- a playlist of the originals, nothing rendered.

The first edition decoded 3 s out of every clip, re-encoded it to 720p and
stitched the pieces into one MP4: minutes per performer, one file per library,
and a cache to sweep. This one is a player instead. The same windows are chosen
from the same scenes, but the playlist points at the original streams and the
browser seeks to each window and cuts on the clock. Nothing is transcoded,
nothing is written to disk, and a reel is ready the moment it is asked for.

The playlist is endless. Position 0, -1, 1 and 9999 are all well defined: each
index is a deterministic draw from the seeded scene list, so the browser can
walk forward forever, walk back over what it already played, and reload without
the order shifting under it.

Routes
  GET  /player?performerId=|tagId=&port=&name=   the player page
  GET  /stream?performerId=|tagId=&port=&start=&count=
                                                 windows [start, start+count)
  GET  /stream.m3u8?same params                  the same windows as an M3U index
  GET  /plan?performerId=&port=&name=            the fixed 60-window plan (legacy)
  POST /reel  {performerId, port, name}          the same, for older callers
  GET  /reel/<job>.m3u8                          the plan as an M3U8 index
  GET  /src/scene/<sceneId>?port=                original stream for one scene
  GET  /src/<job>/<i>                            original stream for plan window i
  POST /favorite {port, sceneId, rating}         write rating100 (heart)
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
MAX_STREAM_COUNT = 60
SCENE_TTL = 300
# A scene is only worth putting in the playlist if the browser can decode the
# bytes as they are: an export is exactly what this service exists to avoid.
CONTAINERS = {".mp4", ".m4v", ".mov", ".webm", ".ogv"}
VIDEO_CODECS = {"h264", "vp8", "vp9", "av1", "theora"}
AUDIO_CODECS = {"", "aac", "mp3", "opus", "vorbis"}
PLAN_TTL = 60

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
         -webkit-user-select: none; user-select: none; touch-action: none; }
  #stage { position: fixed; inset: 0; background: #000; }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
          background: #000; opacity: 0; z-index: 1; transition: opacity .2s linear;
          pointer-events: none; }
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
  #start i { font-style: normal; font-size: 12px; color: rgba(255,255,255,.6); }
  #err { position: fixed; left: 0; right: 0; bottom: 40%; z-index: 10; text-align: center;
         color: #ff8098; font-size: 13px; padding: 0 24px; display: none; }

  /* paused: the only moment the reel offers a way out of itself */
  #pause { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6;
           padding: 0 14px calc(74px + env(safe-area-inset-bottom));
           display: flex; justify-content: center; pointer-events: none;
           opacity: 0; transform: translateY(10px);
           transition: opacity .2s ease, transform .2s ease; }
  #pause.on { opacity: 1; transform: none; }
  #pause .card { pointer-events: auto; width: min(520px, 100%);
                 background: rgba(20,20,20,.92); border: 1px solid rgba(255,255,255,.12);
                 border-radius: 16px; padding: 14px 16px;
                 box-shadow: 0 18px 40px rgba(0,0,0,.5); }
  #pause .t { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis;
              white-space: nowrap; }
  #pause .m { margin-top: 3px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
              color: rgba(255,255,255,.5); }
  #pause .row { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
  #pause a, #pause button { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 13px;
              font-weight: 600; text-align: center; text-decoration: none; cursor: pointer;
              border-radius: 10px; padding: 9px 12px; border: 1px solid rgba(255,255,255,.16);
              background: rgba(255,255,255,.06); color: #fff; white-space: nowrap; }
  #pause a:hover, #pause button:hover { background: rgba(255,255,255,.12); }
  #pause #pfav.on { background: rgba(254,44,85,.22); border-color: rgba(254,44,85,.5); color: #ff2d55; }
  #pause #pnext { flex: 0 0 auto; }
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
<div id="pause"><div class="card">
  <div class="t" id="ptitle">&nbsp;</div>
  <div class="m" id="pmeta">&nbsp;</div>
  <div class="row">
    <a id="popen" target="_blank" rel="noopener">Open in Stash</a>
    <button id="pfav" type="button">&#9825; Favorite</button>
    <button id="pnext" type="button">Next &#8594;</button>
  </div>
</div></div>
<div id="start"><b>Tap to play</b><i id="startsub"></i></div>
<div id="err"></div>
<script>
(() => {
  const q = new URLSearchParams(location.search);
  const PORT = q.get("port") || "9998";
  const TAG = q.get("tagId") || "";
  const PERF = q.get("performerId") || "";
  const vids = [document.getElementById("a"), document.getElementById("b"), document.getElementById("c")];
  const hud = document.getElementById("hud"), start = document.getElementById("start");
  const nameEl = document.getElementById("name"), countEl = document.getElementById("count");
  const whatEl = document.getElementById("what"), clockEl = document.getElementById("clock");
  const fill = document.getElementById("fill"), stashEl = document.getElementById("stash");
  const errEl = document.getElementById("err");
  const pauseEl = document.getElementById("pause"), ptitle = document.getElementById("ptitle");
  const pmeta = document.getElementById("pmeta"), popen = document.getElementById("popen");
  const pfav = document.getElementById("pfav"), pnext = document.getElementById("pnext");

  /* buf is every window the player knows, pos is where it is in buf. Keys are
     absolute stream positions, so a window fetched later lands where it belongs
     and back-navigation always finds the same segment again. */
  let buf = [], pos = 0, base = 0;
  let active = vids[0], nextEl = vids[1], prevEl = vids[2];
  let playing = false, ready = false, moving = false, hideTimer = 0, wheelAt = 0;
  let stashBase = q.get("stash") || "";
  const failed = new Set();
  const mmss = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + String(s).padStart(2, "0"); };

  function reveal() {
    hud.classList.remove("away");
    clearTimeout(hideTimer);
    if (playing) hideTimer = setTimeout(() => hud.classList.add("away"), 3200);
  }

  function fit(el) {
    if (!el.videoWidth || !el.videoHeight) return;
    const a = el.videoWidth / el.videoHeight, b = innerWidth / innerHeight;
    el.classList.toggle("cover", a / b > 0.8 && a / b < 1.25);
  }

  const cur = () => buf[pos];

  function srcFor(w) { return "/src/scene/" + encodeURIComponent(w.scene) + "?port=" + encodeURIComponent(PORT); }

  function sceneUrl(w) {
    const base = stashBase || (location.protocol + "//" + location.hostname + ":" + PORT);
    return base + "/scenes/" + w.scene;
  }

  function loadInto(el, w) {
    if (!el) return;
    if (!w) { el.dataset.key = ""; el.removeAttribute("src"); return; }
    if (el.dataset.key === String(w.key)) return;
    el.dataset.key = String(w.key);
    el.dataset.at = String(w.at);
    el.dataset.dur = String(w.dur);
    el.src = srcFor(w);
    try { el.load(); } catch (e) {}
  }

  vids.forEach((el) => {
    el.addEventListener("loadedmetadata", () => {
      const w = buf.find((x) => String(x.key) === el.dataset.key);
      if (!w) return;
      fit(el);
      const dur = el.duration || (w.at + w.dur + 1);
      const at = Math.max(0, Math.min(w.at, dur - 0.45));
      try { el.currentTime = at; } catch (e) {}
      if (el === active && playing) el.play().catch(() => {});
    });
    el.addEventListener("canplay", () => {
      if (el === active && playing) el.play().catch(() => {});
    });
    el.addEventListener("error", () => {
      const k = el.dataset.key;
      if (k) failed.add(String(k));
      if (el === active && playing) advance();
    });
  });

  async function fetchWindows(at, count) {
    const p = new URLSearchParams({ port: PORT, start: String(at), count: String(count) });
    if (TAG) p.set("tagId", TAG); else p.set("performerId", PERF);
    const res = await fetch("/stream?" + p.toString(), { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "stream failed");
    return data.windows || [];
  }

  function appendWindows(list) {
    for (const w of list) {
      if (failed.has(String(w.key))) continue;
      buf.push(w);
    }
  }

  async function ensureAhead() {
    while (pos + 2 >= buf.length) {
      const from = base + buf.length;
      const more = await fetchWindows(from, 20);
      if (!more.length) break;
      appendWindows(more);
      if (buf.length === 0) break;
    }
  }

  async function ensureBehind() {
    while (pos <= 1) {
      const from = base - 20;
      const more = await fetchWindows(from, 20);
      if (!more.length) break;
      buf = more.concat(buf);
      base = from;
      pos += more.length;
    }
  }

  /* park the two spare elements on the neighbours of pos */
  function refill() {
    const free = vids.filter((v) => v !== active);
    nextEl = free[0]; prevEl = free[1];
    loadInto(nextEl, buf[pos + 1]);
    loadInto(prevEl, buf[pos - 1]);
  }

  function show() {
    const w = cur();
    if (!w) return;
    const incoming = active === nextEl ? prevEl : nextEl;
    /* the incoming element is whichever spare already holds this key, else the
       one that is not active: loadInto is a no-op when the key already matches */
    const holder = vids.find((v) => v !== active && v.dataset.key === String(w.key));
    const next = holder || (active === nextEl ? prevEl : nextEl);
    if (!next) return;
    loadInto(next, w);
    const old = active;
    active = next;
    active.classList.add("on");
    old.classList.remove("on");
    if (playing) active.play().catch(() => {});
    hudFor(); reveal();
    setTimeout(() => { old.pause(); }, 220);
    refill();
  }

  async function advance() {
    if (moving) return;
    moving = true;
    try {
      await ensureAhead();
      if (pos + 1 >= buf.length) return;
      pos += 1;
      show();
    } finally { moving = false; }
  }

  async function back() {
    if (moving) return;
    moving = true;
    try {
      await ensureBehind();
      if (pos <= 0) return;
      pos -= 1;
      show();
    } finally { moving = false; }
  }

  function hudFor() {
    const w = cur();
    if (!w) return;
    countEl.textContent = "#" + w.key;
    whatEl.textContent = w.title || ("scene " + w.scene);
    ptitle.textContent = w.title || ("scene " + w.scene);
    pmeta.textContent = "at " + mmss(w.at) + " \u00b7 " + w.dur.toFixed(1) + "s";
    popen.href = sceneUrl(w);
    const rated = Number(w.rating || 0) >= 100;
    pfav.classList.toggle("on", rated);
    pfav.textContent = rated ? "\u2665 Favorited" : "\u2661 Favorite";
    if (stashBase) { stashEl.href = sceneUrl(w); stashEl.style.display = ""; }
    else stashEl.style.display = "none";
  }

  function tick() {
    requestAnimationFrame(tick);
    const w = cur();
    if (!w) return;
    const t = active.currentTime;
    const span = Math.max(0.1, w.dur);
    const played = Math.max(0, Math.min(span, t - w.at));
    fill.style.width = (100 * played / span) + "%";
    clockEl.textContent = mmss(played) + " / " + mmss(span);
    if (active.dataset.key === String(w.key) && t >= w.at + w.dur - 0.05) advance();
  }

  function setPaused(on) {
    playing = !on;
    pauseEl.classList.toggle("on", on);
    if (on) { hud.classList.remove("away"); clearTimeout(hideTimer); }
    else { pauseEl.classList.remove("on"); reveal(); }
  }

  function toggle() {
    if (active.paused) { active.play().then(() => setPaused(false)).catch(() => {}); }
    else { active.pause(); setPaused(true); }
  }

  async function favorite() {
    const w = cur();
    if (!w) return;
    const rated = Number(w.rating || 0) >= 100;
    pfav.disabled = true;
    try {
      const res = await fetch("/favorite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: PORT, sceneId: w.scene, rating: rated ? 0 : 100 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      w.rating = Number(data.rating100 || 0);
      hudFor();
    } catch (err) {
      errEl.textContent = "could not favorite: " + err.message;
      errEl.style.display = "block";
      setTimeout(() => { errEl.style.display = "none"; }, 1800);
    } finally { pfav.disabled = false; }
  }

  addEventListener("keydown", (e) => {
    if (!start.classList.contains("gone")) return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight" || e.key === "j") { e.preventDefault(); advance(); }
    else if (e.key === "ArrowLeft" || e.key === "k") { e.preventDefault(); back(); }
    else if (e.key === "m") vids.forEach((v) => { v.muted = !v.muted; });
  });

  /* touch: swipe up = next, swipe down = previous, a still tap = pause */
  let touchY = 0, touchX = 0, touchAt = 0, swiped = false;
  addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    touchY = t.clientY; touchX = t.clientX; touchAt = Date.now(); swiped = false;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (swiped) return;
    const t = e.touches[0];
    const dy = t.clientY - touchY, dx = t.clientX - touchX;
    if (Math.abs(dy) > 56 && Math.abs(dy) > Math.abs(dx)) {
      swiped = true;
      if (dy < 0) advance(); else back();
    }
  }, { passive: true });
  addEventListener("touchend", (e) => {
    if (swiped || !start.classList.contains("gone")) return;
    if (Date.now() - touchAt > 450) return;
    if (e.target.closest("a,button")) return;
    toggle();
  }, { passive: true });

  addEventListener("wheel", (e) => {
    if (!start.classList.contains("gone")) return;
    if (Math.abs(e.deltaY) < 12) return;
    const now = Date.now();
    if (now - wheelAt < 520) return;
    wheelAt = now;
    if (e.deltaY > 0) advance(); else back();
  }, { passive: true });

  addEventListener("click", (e) => {
    if (e.target.closest("a,button") || !start.classList.contains("gone")) return;
    toggle();
  });
  addEventListener("mousemove", reveal);
  addEventListener("resize", () => vids.forEach(fit));

  popen.addEventListener("click", (e) => e.stopPropagation());
  pnext.addEventListener("click", (e) => { e.stopPropagation(); advance(); });
  pfav.addEventListener("click", (e) => { e.stopPropagation(); favorite(); });

  (async () => {
    try {
      const first = await fetchWindows(-20, 61);
      if (!first.length) throw new Error("no clip in this library can be played as-is");
      buf = first;
      base = -20;
      pos = buf.findIndex((w) => w.key === 0);
      if (pos < 0) pos = 0;
      stashBase = location.protocol + "//" + location.hostname + ":" + PORT;
      const meta = await fetch("/stream?port=" + encodeURIComponent(PORT) + "&start=0&count=1" +
        (TAG ? "&tagId=" + encodeURIComponent(TAG) : "&performerId=" + encodeURIComponent(PERF)),
        { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      nameEl.textContent = meta.name || (TAG ? "tag " + TAG : "performer " + PERF);
      document.getElementById("startsub").textContent =
        "endless \u00b7 " + SEGLABEL + "s from each clip, replayed from the originals" +
        (meta.unplayable ? " \u00b7 " + meta.unplayable + " left out (would need a transcode)" : "");
      loadInto(active, cur());
      refill();
      hudFor();
      ready = true;
      start.addEventListener("click", (e) => {
        e.stopPropagation();
        start.classList.add("gone");
        setPaused(false);
        active.play().catch((err) => { if (err.name !== "AbortError") setPaused(true); });
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
    scenes { id title rating100 files { duration video_codec audio_codec path } }
  }
}
"""

TAG_QUERY = """
query ReelTagScenes($id: ID!) {
  findScenes(scene_filter: { tags: { value: [$id], modifier: INCLUDES } },
             filter: { per_page: 400, sort: "date", direction: DESC }) {
    count
    scenes { id title rating100 files { duration video_codec audio_codec path } }
  }
}
"""

FAVORITE_MUTATION = """
mutation RateScene($input: SceneUpdateInput!) {
  sceneUpdate(input: $input) { id rating100 }
}
"""


def windows_for(duration):
    """How many windows a clip of this length gets in the fixed plan. Unchanged
    from the cut version: one window in a short clip, five in a long one."""
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


def scenes_for(port, kind, sid):
    """The scene list behind a reel, cached briefly. kind is 'tag' or 'performer'."""
    key = (port, kind, str(sid))
    now = time.time()
    with LOCK:
        hit = SCENES.get(key)
    if hit and now - hit[0] < SCENE_TTL:
        return hit[1]
    data = gql(port, TAG_QUERY if kind == "tag" else REEL_QUERY, {"id": str(sid)})
    scenes = (data.get("findScenes") or {}).get("scenes") or []
    with LOCK:
        SCENES[key] = (now, scenes)
    return scenes


def clips_for(port, kind, sid):
    """The scenes a browser can actually play, with the length to draw from."""
    clips = []
    for scene in scenes_for(port, kind, sid):
        f, duration = primary_file(scene)
        if not f or duration < SEG + 2:
            continue
        if not playable(f.get("path"), f.get("video_codec"), f.get("audio_codec")):
            continue
        clips.append({
            "scene": str(scene["id"]),
            "title": scene.get("title") or "",
            "dur": duration,
            "rating": int(scene.get("rating100") or 0),
        })
    return clips


def seed_for(clips, kind, sid):
    return hashlib.blake2b(
        ("%s|%s|" % (kind, sid) + "|".join(sorted(c["scene"] for c in clips))).encode(),
        digest_size=8,
    ).hexdigest()


def _pick(clips, seed, i):
    rng = random.Random(int.from_bytes(
        hashlib.blake2b(("%s|%d" % (seed, i)).encode(), digest_size=8).digest(), "big"))
    return rng.randrange(len(clips))


def _at(clips, seed, i, ci):
    clip = clips[ci]
    rng = random.Random(int.from_bytes(
        hashlib.blake2b(("%s|%d|at" % (seed, i)).encode(), digest_size=8).digest(), "big"))
    high = max(1.0, clip["dur"] - SEG - 0.5)
    return round(rng.uniform(1.0, high), 2)


def window_at(clips, seed, i):
    """One 3 s window, deterministic in i. Positions are absolute: i = -1 is the
    window before the start of the reel, i = 10**6 is an hour into the scroll."""
    ci = _pick(clips, seed, i)
    if len(clips) > 1 and ci == _pick(clips, seed, i - 1):
        ci = (ci + 1) % len(clips)
    clip = clips[ci]
    at = _at(clips, seed, i, ci)
    return {
        "key": i,
        "scene": clip["scene"],
        "title": clip["title"],
        "at": at,
        "dur": round(min(SEG, clip["dur"] - at - 0.2), 2),
        "rating": clip["rating"],
    }


def stream_windows(port, kind, sid, start, count):
    clips = clips_for(port, kind, sid)
    if not clips:
        return [], 0
    seed = seed_for(clips, kind, sid)
    count = max(1, min(int(count), MAX_STREAM_COUNT))
    windows = [window_at(clips, seed, i) for i in range(start, start + count)]
    for w in windows:
        w["src"] = "/src/scene/%s?port=%s" % (w["scene"], port)
    return windows, len(clips)


def plan_windows(scenes, seed, seg):
    """3 s windows, five of them in a long video, round-robin across clips so the
    playlist alternates scenes instead of showing one clip five times running."""
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
        # keep the window inside the clip, and never start in the first second
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


def stream_m3u8(windows, name):
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "# StashTok highlight index -- not HLS segments. Each entry is an",
        "# original file; EXT-X-STASHTOK-START says where the browser starts.",
        "#EXT-X-STASHTOK-NAME:" + (name or "highlight reel"),
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

    def _m3u8(self, body, filename):
        body = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", 'inline; filename="%s.m3u8"' % filename)
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

    def _stream(self, params):
        port = str(params.get("port") or "9998")
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        tag_id = str(params.get("tagId") or "").strip()
        perf_id = str(params.get("performerId") or "").strip()
        kind, sid = ("tag", tag_id) if tag_id else ("performer", perf_id)
        if not sid.isdigit():
            return self._json(400, {"error": "performerId or tagId required"})
        try:
            start = int(params.get("start") or 0)
        except (TypeError, ValueError):
            start = 0
        try:
            count = int(params.get("count") or 20)
        except (TypeError, ValueError):
            count = 20
        count = max(1, min(count, MAX_STREAM_COUNT))
        try:
            windows, total = stream_windows(port, kind, sid, start, count)
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            return self._json(502, {"error": "Stash query failed: %s" % str(exc)[:200]})
        if not windows:
            return self._json(422, {"error": "no clip in this library can be played as-is"})
        name = str(params.get("name") or "")
        if not name:
            try:
                name = (scenes_for(port, kind, sid) and kind) or ""
            except Exception:  # noqa: BLE001
                name = ""
        payload = {
            "port": port,
            "kind": kind,
            "id": sid,
            "name": name,
            "start": start,
            "count": count,
            "total": total,
            "seg": SEG,
            "windows": windows,
        }
        return self._json(200, payload)

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

    def _favorite(self, params):
        port = str(params.get("port") or "9998")
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        scene_id = str(params.get("sceneId") or "").strip()
        if not scene_id.isdigit():
            return self._json(400, {"error": "sceneId required"})
        try:
            rating = int(params.get("rating", 100))
        except (TypeError, ValueError):
            rating = 100
        rating = max(0, min(100, rating))
        try:
            data = gql(port, FAVORITE_MUTATION, {"input": {"id": scene_id, "rating100": rating}})
        except Exception as exc:  # noqa: BLE001
            return self._json(502, {"error": "Stash update failed: %s" % str(exc)[:200]})
        scene = data.get("sceneUpdate") or {}
        return self._json(200, {"id": scene.get("id", scene_id),
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
            tag_id = str(params.get("tagId") or "").strip()
            perf_id = str(params.get("performerId") or "").strip()
            kind, sid = ("tag", tag_id) if tag_id else ("performer", perf_id)
            if not sid.isdigit():
                return self._json(400, {"error": "performerId or tagId required"})
            port = str(params.get("port") or "9998")
            if port not in INSTANCES:
                return self._json(400, {"error": "unknown instance"})
            try:
                start = int(params.get("start") or 0)
                count = int(params.get("count") or 20)
                windows, _ = stream_windows(port, kind, sid, start, count)
            except Exception as exc:  # noqa: BLE001
                return self._json(502, {"error": "Stash query failed: %s" % str(exc)[:200]})
            if not windows:
                return self._json(422, {"error": "no clip in this library can be played as-is"})
            return self._m3u8(stream_m3u8(windows, params.get("name") or ""), "reel-%s-%s" % (kind, sid))
        if path == "/plan":
            return self._plan(params)
        if path.startswith("/reel/") and path.endswith(".m3u8"):
            job = path.split("/")[2][: -len(".m3u8")]
            plan = self._plan_for(job)
            if not plan:
                return self._json(404, {"error": "no such playlist"})
            return self._m3u8(m3u8(plan), job)
        if path.startswith("/src/"):
            return self._proxy(path, params)
        return self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})
        if path == "/favorite":
            return self._favorite({k: str(v) for k, v in body.items() if v is not None})
        if path != "/reel":
            return self._json(404, {"error": "not found"})
        return self._plan({k: str(v) for k, v in body.items() if v is not None})

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
        seek the player does is a byte range, not an export."""
        parts = path.strip("/").split("/")
        port = str(params.get("port") or "9998")
        if len(parts) == 3 and parts[1] == "scene":
            scene_id = parts[2]
            if not scene_id.isdigit():
                return self._json(404, {"error": "no such scene"})
            if port not in INSTANCES:
                return self._json(400, {"error": "unknown instance"})
            return self._forward(port, scene_id)
        if len(parts) != 3:
            return self._json(404, {"error": "not found"})
        plan = self._plan_for(parts[1])
        if not plan:
            return self._json(404, {"error": "no such playlist"})
        try:
            win = plan["windows"][int(parts[2])]
        except (ValueError, IndexError):
            return self._json(404, {"error": "no such window"})
        return self._forward(plan["port"], win["scene"])

    def _forward(self, port, scene_id):
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
