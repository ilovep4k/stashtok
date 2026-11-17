#!/usr/bin/env python3
"""Highlight reel for StashTok -- a playlist of the originals, nothing rendered.

The first edition decoded 3 s out of every clip, re-encoded it to 720p and
stitched the pieces into one MP4: minutes per performer, one file per library,
and a cache to sweep. This one is a player instead. The same windows are chosen
from the same scenes, but the playlist points at the original streams and the
browser seeks to each window and cuts on the clock. Nothing is transcoded,
nothing is written to disk, and a reel is ready the moment it is asked for.

Routes
  GET  /player?performerId=&port=&name=      the player page
  GET  /plan?performerId=&port=&name=        the playlist as JSON
  POST /reel  {performerId, port, name}      the same, for older callers
  GET  /reel/<job>.m3u8                      the playlist as an M3U8 index
  GET  /src/<job>/<i>                        original stream for window i,
                                             Range passed through, ApiKey
                                             added server-side
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
         -webkit-user-select: none; user-select: none; }
  #stage { position: fixed; inset: 0; background: #000; }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
          background: #000; opacity: 0; z-index: 1; transition: opacity .18s linear; }
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
</style></head>
<body>
<div id="stage"><video id="a" playsinline preload="auto"></video><video id="b" playsinline preload="auto"></video></div>
<div id="hud">
  <header><b id="name">highlight reel</b><span class="sp"></span>
    <span id="count"></span><a id="stash" target="_blank" rel="noopener">stash</a></header>
  <footer>
    <div id="bar"><i id="fill"></i></div>
    <div id="note"><span id="what">loading&hellip;</span><span id="clock"></span></div>
  </footer>
</div>
<div id="start"><b>Tap to play</b><i id="startsub"></i></div>
<div id="err"></div>
<script>
(() => {
  const q = new URLSearchParams(location.search);
  const vids = [document.getElementById("a"), document.getElementById("b")];
  const hud = document.getElementById("hud"), start = document.getElementById("start");
  const nameEl = document.getElementById("name"), countEl = document.getElementById("count");
  const whatEl = document.getElementById("what"), clockEl = document.getElementById("clock");
  const fill = document.getElementById("fill"), stashEl = document.getElementById("stash");
  const errEl = document.getElementById("err");
  let wins = [], idx = 0, active = vids[0], spare = vids[1], span = 1;
  const failed = new Set();
  let playing = false, switched = 0, hideTimer = 0;
  let stashBase = q.get("stash") || "";
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

  vids.forEach((el) => {
    el.addEventListener("loadedmetadata", () => {
      const i = +el.dataset.idx, w = wins[i];
      if (!w) return;
      fit(el);
      const dur = el.duration || (w.at + w.dur + 1);
      const at = Math.max(0, Math.min(w.at, dur - 0.45));
      try { el.currentTime = at; } catch (e) {}
      if (el === active && i === idx && playing) el.play().catch(() => {});
    });
    el.addEventListener("canplay", () => {
      const i = +el.dataset.idx;
      if (el === active && playing && i === idx) el.play().catch(() => {});
    });
    el.addEventListener("ended", () => { if (el === active) advance(); });
    el.addEventListener("error", () => {
      failed.add(+el.dataset.idx);
      if (el === active) skip(el.dataset.idx, playing ? "cannot load" : "unreadable");
    });
  });

  function load(el, i) {
    if (!wins.length) return;
    let j = i % wins.length, guard = 0;
    while (failed.has(j) && guard++ < wins.length) j = (j + 1) % wins.length;
    const w = wins[j];
    if (!w || failed.has(j)) return;
    el.dataset.idx = String(j);
    el.src = w.src;
    if (el === active) switched = Date.now();
    el.load();
  }

  function hudFor() {
    const w = wins[idx];
    if (!w) return;
    countEl.textContent = (idx + 1) + " / " + wins.length;
    whatEl.textContent = w.title || ("scene " + w.scene);
    if (stashBase) { stashEl.href = stashBase + "/scenes/" + w.scene; stashEl.style.display = ""; }
    else stashEl.style.display = "none";
  }

  function advance() {
    if (!wins.length || failed.size >= wins.length) return;
    /* the spare was prefetched with the next good window; if it died or never
       loaded, replace it before the swap rather than showing a dead frame */
    let target = +spare.dataset.idx;
    if (!Number.isFinite(target) || failed.has(target)) { load(spare, idx + 1); target = +spare.dataset.idx; }
    if (!Number.isFinite(target) || failed.has(target)) return;
    const old = active, next = spare;
    active = next; spare = old;
    next.classList.add("on"); old.classList.remove("on");
    idx = target;
    switched = Date.now();
    if (playing) next.play().catch(() => {});
    hudFor(); reveal();
    setTimeout(() => {
      old.pause(); old.removeAttribute("src");
      try { old.load(); } catch (e) {}
      load(old, idx + 1);
    }, 240);
  }

  function skip(i, why) {
    if (wins.length < 2) return;
    if (why.length && playing) {
      errEl.textContent = "skipping a clip (" + why + ")";
      errEl.style.display = "block";
      setTimeout(() => { errEl.style.display = "none"; }, 1400);
    }
    if (String(i) === String(idx)) advance();
  }

  function tick() {
    requestAnimationFrame(tick);
    const w = wins[idx];
    if (!w) return;
    const t = active.currentTime;
    const before = wins.slice(0, idx).reduce((n, x) => n + x.dur, 0);
    const played = before + Math.max(0, Math.min(w.dur, t - w.at));
    fill.style.width = (100 * Math.min(1, played / span)) + "%";
    clockEl.textContent = mmss(played) + " / " + mmss(span);
    if (t >= w.at + w.dur - 0.04) { advance(); return; }
    /* readyState 1 means the metadata is in and the seek worked: it is just
       buffering a 4K original, which is the whole point of this player. Only a
       clip that never even parsed is worth skipping. */
    if (switched && Date.now() - switched > 20000 && active.readyState === 0) {
      switched = 0; skip(idx, playing ? "slow to start" : "");
    }
  }

  function toggle() {
    if (active.paused) { active.play().then(() => { playing = true; reveal(); }).catch(() => {}); }
    else { active.pause(); playing = false; hud.classList.remove("away"); clearTimeout(hideTimer); }
  }

  addEventListener("keydown", (e) => {
    if (!start.classList.contains("gone")) return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight" || e.key === "j") advance();
    else if (e.key === "ArrowLeft") { idx = (idx + wins.length - 2) % wins.length; advance(); }
    else if (e.key === "m") vids.forEach((v) => { v.muted = !v.muted; });
  });
  addEventListener("click", (e) => {
    if (e.target.closest("a") || !start.classList.contains("gone")) return;
    toggle();
  });
  addEventListener("mousemove", reveal);
  addEventListener("resize", () => vids.forEach(fit));

  (async () => {
    try {
      const res = await fetch("/plan?" + q.toString(), { cache: "no-store" });
      const plan = await res.json();
      if (!res.ok) throw new Error(plan.error || "playlist failed");
      wins = plan.windows || [];
      if (!wins.length) throw new Error("no clip in this library can be played as-is");
      span = wins.reduce((n, w) => n + w.dur, 0) || 1;
      // the plan carries the instance's loopback url; the browser needs its own
      // idea of the same host, on the port the plugin passed in
      stashBase = location.protocol + "//" + location.hostname + ":" + (q.get("port") || "9998");
      nameEl.textContent = plan.name || ("performer " + plan.performerId);
      const missing = plan.unplayable
        ? " \\u00b7 " + plan.unplayable + " left out (would need a transcode)" : "";
      document.getElementById("startsub").textContent =
        wins.length + " clips \\u00b7 " + Math.round(span) + "s, replayed from the originals" + missing;
      load(active, 0); load(spare, 1);
      hudFor();
      start.addEventListener("click", (e) => {
        /* this same tap bubbles to the window listener, which would read
           active.paused === false and pause the clip it just started */
        e.stopPropagation();
        start.classList.add("gone");
        playing = true; reveal();
        active.play().catch((err) => { if (err.name !== "AbortError") playing = false; });
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


def windows_for(duration):
    """How many windows a clip of this length gets. Unchanged from the cut
    version: one window in a short clip, five in a long one."""
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


class Handler(BaseHTTPRequestHandler):
    server_version = "StashTokReel/2.0"
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

    def do_OPTIONS(self):  # noqa: N802 - http.server naming
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

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

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/healthz":
            with LOCK:
                return self._json(200, {"ok": True, "plans": len(JOBS)})
        if path == "/player":
            return self._html(PLAYER_HTML)
        if path == "/plan":
            return self._plan({k: v[0] for k, v in parse_qs(parsed.query).items()})
        if path.startswith("/reel/") and path.endswith(".m3u8"):
            job = path.split("/")[2][: -len(".m3u8")]
            plan = self._plan_for(job)
            if not plan:
                return self._json(404, {"error": "no such playlist"})
            body = m3u8(plan).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Disposition", 'inline; filename="%s.m3u8"' % job)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/src/"):
            return self._proxy(path)
        return self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if urlparse(self.path).path != "/reel":
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})
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

    def _proxy(self, path):
        """Hand the browser the original bytes, with the instance's key attached
        here so it never reaches the page, and Range forwarded untouched: the
        seek the player does is a byte range, not an export."""
        parts = path.strip("/").split("/")
        if len(parts) != 3:
            return self._json(404, {"error": "not found"})
        plan = self._plan_for(parts[1])
        if not plan:
            return self._json(404, {"error": "no such playlist"})
        try:
            win = plan["windows"][int(parts[2])]
        except (ValueError, IndexError):
            return self._json(404, {"error": "no such window"})
        inst = INSTANCES[plan["port"]]
        url = "%s/scene/%s/stream" % (inst["url"], win["scene"])
        headers = {"ApiKey": key_for(plan["port"])}
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
        if self.path.startswith(("/src/", "/plan", "/status/")):
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
