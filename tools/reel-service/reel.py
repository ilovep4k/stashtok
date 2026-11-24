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
import math
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
# one lock per transcoded window: two players asking for the same cut wait for
# the first encode instead of running ffmpeg twice
WINDOW_LOCKS = {}


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


PLAYER_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "player.html")


def player_html():
    """The player page lives next to this file so it can be edited without
    touching the server. The fallback only exists so a missing file still
    answers with something readable."""
    try:
        with open(PLAYER_FILE, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ("<!doctype html><title>Highlight reel</title>"
                "<p style=\"font:14px sans-serif;color:#ccc;background:#000;padding:20px\">"
                "player.html is missing next to reel.py</p>")

REEL_QUERY = """
query ReelScenes($id: ID!, $page: Int!) {
  findScenes(scene_filter: { performers: { value: [$id], modifier: INCLUDES } },
             filter: { per_page: 400, page: $page, sort: "date", direction: DESC }) {
    count
    scenes { id title rating100 files { duration video_codec audio_codec path }
             scene_markers { id title seconds end_seconds primary_tag { id name } } }
  }
}
"""


TAG_QUERY = """
query ReelScenes($id: ID!, $page: Int!) {
  findScenes(scene_filter: { tags: { value: [$id], modifier: INCLUDES } },
             filter: { per_page: 400, page: $page, sort: "date", direction: DESC }) {
    count
    scenes { id title rating100 files { duration video_codec audio_codec path }
             scene_markers { id title seconds end_seconds primary_tag { id name } } }
  }
}
"""

FOLDER_QUERY = """
query ReelScenes($p: String!, $page: Int!) {
  findScenes(scene_filter: { path: { value: $p, modifier: INCLUDES } },
             filter: { per_page: 400, page: $page, sort: "date", direction: DESC }) {
    count
    scenes { id title rating100 files { duration video_codec audio_codec path }
             scene_markers { id title seconds end_seconds primary_tag { name } } }
  }
}
"""


SEARCH_QUERY = """
query ReelScenes($q: String!, $page: Int!) {
  findScenes(filter: { q: $q, per_page: 400, page: $page, sort: "date", direction: DESC }) {
    count
    scenes { id title rating100 files { duration video_codec audio_codec path }
             scene_markers { id title seconds end_seconds primary_tag { id name } } }
  }
}
"""

NAME_QUERY = """
query ReelName($id: ID!) {
  findPerformer(id: $id) { name }
}
"""

TAG_NAME_QUERY = """
query ReelName($id: ID!) {
  findTag(id: $id) { name }
}
"""

FAVORITE_MUTATION = """
mutation ReelFavorite($id: ID!, $rating: Int) {
  sceneUpdate(input: { id: $id, rating100: $rating }) { id rating100 }
}
"""

# ---- tuning -------------------------------------------------------------
# These numbers are the whole character of the reel, so they are settings, not
# constants: a 3 s window spread over at least 30 s of each clip is the default
# for a library of long scenes, and a library of short clips wants different
# numbers. /settings reads and writes them; the player asks for them at boot.
SETTINGS_PATH = os.path.expanduser("~/.config/stashtok/reel.json")
SETTINGS = {
    "seg": 3.0,           # seconds of each window
    "min_span": 30.0,     # snapshots of one clip sit at least this far apart
    "max_per_clip": 5,    # windows one clip may contribute per cycle
    "short_max": 45.0,    # a clip this short is shown once and not spread
    "keep_behind": 30,    # player buffer, clips behind the cursor
    "keep_ahead": 12,     # player buffer, clips ahead of the cursor
    "transcode": 0,       # 0 = never transcode; a clip the browser cannot play is skipped
    "favorites_first": 1, # 1 = favorited scenes lead the shuffle (all scenes still play)
}

RUN = 12  # kept only so old clients that read "run" still get a number
POOL_TTL = 120
POOLS = {}
SKIPPED = {}
CYCLES = {}
NAMES = {}


def load_settings():
    """Settings live in a file so a tweak survives a restart, and in memory so
    a change takes effect without one."""
    try:
        with open(SETTINGS_PATH) as fh:
            disk = json.load(fh)
    except (OSError, ValueError):
        return
    for key, value in disk.items():
        if key in SETTINGS:
            try:
                SETTINGS[key] = float(value) if key in ("seg", "min_span", "short_max") else int(value)
            except (TypeError, ValueError):
                pass


def save_settings():
    try:
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        with open(SETTINGS_PATH, "w") as fh:
            json.dump(SETTINGS, fh, indent=2)
    except OSError as exc:
        log("could not save settings", exc)


def update_settings(patch):
    """Apply a partial settings update. Anything that changes how a window is
    cut invalidates the cached pool and the cached cycle, so both are dropped."""
    changed = False
    for key, value in (patch or {}).items():
        if key not in SETTINGS:
            continue
        try:
            value = float(value) if key in ("seg", "min_span", "short_max") else int(value)
        except (TypeError, ValueError):
            continue
        if key == "seg":
            value = max(1.0, min(15.0, value))
        elif key == "min_span":
            value = max(0.0, min(600.0, value))
        elif key == "max_per_clip":
            value = max(1, min(40, value))
        elif key == "short_max":
            value = max(0.0, min(600.0, value))
        elif key in ("keep_behind", "keep_ahead"):
            value = max(0, min(200, value))
        elif key in ("transcode", "favorites_first"):
            value = 1 if value else 0
        if SETTINGS[key] != value:
            SETTINGS[key] = value
            changed = True
    if changed:
        with LOCK:
            POOLS.clear()
            SKIPPED.clear()
            CYCLES.clear()
        save_settings()
    return changed


def seg():
    return float(SETTINGS["seg"])


def name_for(port, kind, ident):
    """The performer or tag name, for the player's header."""
    key = (port, kind, ident)
    with LOCK:
        if key in NAMES:
            return NAMES[key]
    try:
        if kind in ("search", "folder"):
            name = ident.rstrip("/").rsplit("/", 1)[-1] or ident
        else:
            query = TAG_NAME_QUERY if kind == "tag" else NAME_QUERY
            data = gql(port, query, {"id": ident})
            name = ((data.get("findTag") or data.get("findPerformer") or {}).get("name") or "")
    except Exception:  # noqa: BLE001 - a missing name is cosmetic
        name = ""
    with LOCK:
        NAMES[key] = name
    return name


def scenes_for(port, kind, ident):
    """Every clip in the pool the browser can play untouched. Cached briefly so
    a scroll of 20 windows costs one GraphQL call, not twenty."""
    key = (port, kind, ident)
    now = time.time()
    with LOCK:
        hit = POOLS.get(key)
    if hit and now - hit[0] < POOL_TTL:
        return hit[1]
    if kind == "tag":
        query, variables = TAG_QUERY, {"id": ident}
    elif kind == "search":
        query, variables = SEARCH_QUERY, {"q": ident}
    elif kind == "folder":
        query, variables = FOLDER_QUERY, {"p": ident}
    else:
        query, variables = REEL_QUERY, {"id": ident}
    # One page is 400 scenes. A performer with more than that used to be cut
    # off at the first 400, so the reel only ever knew a slice of the library.
    # Walk the pages until the count is reached.
    scenes, total, page = [], None, 1
    while True:
        variables = dict(variables, page=page)
        data = gql(port, query, variables)
        found = data.get("findScenes") or {}
        chunk = found.get("scenes") or []
        total = found.get("count") if total is None else total
        scenes.extend(chunk)
        if not chunk or len(chunk) < 400 or (total is not None and len(scenes) >= total):
            break
        page += 1
        if page > 25:            # 10k scenes: stop rather than hammer Stash
            break
    pool = []
    skipped = 0
    for scene in scenes:
        f, duration = primary_file(scene)
        if not f or duration < 3:
            continue
        # A file the browser cannot decode is only usable if transcoding is on.
        # Transcoding is off by default: a clip the browser cannot play as-is is
        # skipped and counted, so playback stays seamless and nothing is re-encoded.
        tc = not playable(f.get("path"), f.get("video_codec"), f.get("audio_codec"))
        if tc and not SETTINGS["transcode"]:
            skipped += 1
            continue
        marks = []
        for m in scene.get("scene_markers") or []:
            try:
                at = float(m.get("seconds") or 0)
            except (TypeError, ValueError):
                continue
            if at <= 5:                      # an opening marker is not a highlight
                continue
            try:
                end = float(m.get("end_seconds") or 0)
            except (TypeError, ValueError):
                end = 0.0
            marks.append({"id": str(m.get("id") or ""), "title": m.get("title") or "",
                          "at": at, "end": end,
                          "tag": ((m.get("primary_tag") or {}).get("name") or "")})
        pool.append({"id": str(scene["id"]), "title": scene.get("title") or "",
                     "dur": duration, "markers": marks, "tc": tc,
                     # the heart state travels with the clip, so the player can show
                     # it before the first tap instead of guessing "not favorited"
                     "rating": int(scene.get("rating100") or 0)})
    with LOCK:
        POOLS[key] = (now, pool)
        SKIPPED[key] = skipped
    return pool


def pool_seed(pool):
    return hashlib.blake2b(
        ("|".join(sorted(s["id"] for s in pool))).encode(), digest_size=8
    ).hexdigest()


def windows_for(duration, width=None):
    """How many snapshots one clip gets. A clip long enough to spread gets as
    many as fit at min_span apart, capped; a short clip gets exactly one, which
    is what keeps it from taking over the reel."""
    width = seg() if width is None else width
    if duration <= SETTINGS["short_max"]:
        return 1
    usable = max(0.0, duration - width - 0.4)
    if usable < SETTINGS["min_span"]:
        return 1
    fit = 1 + int(usable // max(1.0, SETTINGS["min_span"]))
    return max(1, min(int(SETTINGS["max_per_clip"]), fit))


def snapshots(scene, width, rng):
    """Where in one clip its windows start. Markers drive the pick first: a
    marker is the editor's own in/out range, so the window starts inside it and
    never runs past end_seconds. Clips with no usable marker fall back to even
    snapshots across the timeline. Either way the spread is what makes the reel
    feel like it is jumping around the video rather than stuttering."""
    dur = float(scene["dur"])
    high = max(0.0, dur - width - 0.2)
    low = min(0.4, high)
    starts = []
    marks = sorted(scene.get("markers") or [], key=lambda mk: float(mk.get("at") or 0))
    for pos, mark in enumerate(marks):
        at = float(mark.get("at") or 0)
        end = float(mark.get("end") or 0)
        if at < 1 or at > high:          # opening marker / past the end
            continue
        # a marker with an out point owns [in, out]; one without runs until the
        # next marker, so a window never spills into the following scene beat
        if end > at:
            limit = min(end, dur)
        elif pos + 1 < len(marks):
            limit = min(float(marks[pos + 1].get("at") or dur), dur)
        else:
            limit = dur
        room = limit - at - width
        if room >= 0:
            # land somewhere inside the marker, biased to its opening seconds
            start = at + rng.uniform(0.0, min(room, width * 2))
        else:
            # marker shorter than one window: keep the in point, fit the clip
            start = max(0.0, min(at, limit - width))
        starts.append(round(max(0.0, min(high, start)), 2))
    out = []
    for start in starts:
        if all(abs(start - previous) >= 1.0 for previous in out):
            out.append(start)
    count = windows_for(dur, width)
    if len(out) >= count:
        return out[:max(1, int(SETTINGS["max_per_clip"]))]
    if count <= 1:
        return [round(low, 2)]
    # Keep useful markers and fill out a long clip from the rest of its timeline.
    spacing = max(width, float(SETTINGS["min_span"]))
    count = min(count, 1 + int((high - low) // spacing))
    room = max(0.0, high - low - spacing * (count - 1))
    offsets = sorted(rng.uniform(0.0, room) for _ in range(count))
    candidates = [round(low + i * spacing + offset, 2) for i, offset in enumerate(offsets)]
    for gap in (spacing, width):
        for start in candidates:
            if len(out) >= count:
                return out
            if all(abs(start - previous) >= gap - 0.01 for previous in out):
                out.append(start)
    return out


def cycle_for(port, kind, ident, visit="", width=None):
    """One full pass over the pool: every snapshot of every clip, ordered so
    consecutive windows come from different clips. A three clip pool gives
    1 2 3 1 2 3 1 2 3, which is the order the reel is supposed to serve.

    `visit` is a per-page-load token from the player. It goes into the shuffle
    seed, so opening the same performer twice gives a different order -- the
    reel is a random walk through the library, not a fixed playlist you learn
    by heart. Cached per visit, because a scroll of 20 windows must not
    reshuffle under the cursor."""
    width = seg() if width is None else width
    key = (port, kind, ident, visit, width)
    now = time.time()
    with LOCK:
        hit = CYCLES.get(key)
    if hit and now - hit[0] < POOL_TTL:
        return hit[1]
    pool = [scene for scene in scenes_for(port, kind, ident) if scene["dur"] >= width + 2]
    if not pool:
        return []
    seed = pool_seed(pool) + "|" + str(visit)
    rng = random.Random(hashlib.blake2b(seed.encode(), digest_size=8).digest())
    rows = []
    for scene in pool:
        row = []
        for at in snapshots(scene, width, rng):
            # never run past a marker's out point when the window sits inside one
            limit = scene["dur"]
            for mark in scene.get("markers") or []:
                end = float(mark.get("end") or 0)
                if end > at and float(mark.get("at") or 0) <= at:
                    limit = min(limit, end)
                    break
            dur = round(min(width, limit - at - 0.2), 2)
            if dur <= 0:
                continue
            if scene.get("tc"):
                # a file the browser cannot open: this window is cut out and
                # transcoded on demand, so the URL is a small clip, not a seek
                src = "/src/window/%s?port=%s&at=%s&d=%s" % (scene["id"], port, at, dur)
            else:
                src = "/src/scene/%s?port=%s" % (scene["id"], port)
            row.append({
                "scene": scene["id"],
                "title": scene["title"],
                "rating": int(scene.get("rating") or 0),
                "at": at,
                "dur": dur,
                "src": src,
                "tc": bool(scene.get("tc")),
            })
        rows.append(row)
    # Every clip is in the shuffle -- this is a random walk over the whole pool,
    # not a "best of" list. A favorite is only weighted to come up earlier and
    # more often between passes; nothing is dropped for being unfavorited.
    order = list(range(len(rows)))
    if SETTINGS["favorites_first"]:
        # Favorites lead the pass, then the rest of the library follows in its
        # own shuffle. Every clip is still in the order exactly once, so this
        # prioritizes without filtering anything out.
        fav = [i for i in order if int(pool[i].get("rating") or 0) >= 80]
        favorites = set(fav)
        rest = [i for i in order if i not in favorites]
        rng.shuffle(fav)
        rng.shuffle(rest)
        order = fav + rest
    else:
        rng.shuffle(order)
    # each clip's own snapshots are shuffled too, so the first pass through the
    # reel is not the opening three seconds of every clip in a row: one clip
    # leads with its middle, the next with its end
    for row in rows:
        rng.shuffle(row)
    cycle = []
    depth = 0
    while True:
        added = False
        for idx in order:
            if depth < len(rows[idx]):
                cycle.append(rows[idx][depth])
                added = True
        if not added:
            break
        depth += 1
    with LOCK:
        for expired in [stored for stored, (at, _) in CYCLES.items() if now - at >= POOL_TTL]:
            del CYCLES[expired]
        CYCLES[key] = (now, cycle)
        if len(CYCLES) > 32:
            del CYCLES[next(iter(CYCLES))]
    return cycle


def stream_windows(port, kind, ident, start, count, visit="", width=None):
    """Windows are addressed by a global integer key. Key k always resolves to
    the same clip and offset, which is what lets the player walk backwards over
    ground it has already covered without a server-side cursor. Each pass over
    the cycle is rotated so the loop does not replay in the same order twice."""
    cycle = cycle_for(port, kind, ident, visit, width)
    if not cycle:
        return []
    total = len(cycle)
    out = []
    for key in range(start, start + count):
        turn, slot = divmod(key, total)
        if turn:
            rot = (turn * 7) % total or 1
            slot = (slot + rot) % total
        w = dict(cycle[slot])
        w["key"] = key
        # a distinct URL per window: the browser must not treat two windows of
        # one scene as the same resource, or it reuses the first one's buffer
        # and every window plays from the top of the file
        w["src"] = w["src"] + "&k=%d" % key
        out.append(w)
    return out


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


def plan_windows(scenes, seed, width):
    """The playlist form of the same sampling the stream uses: each clip's
    snapshots, interleaved so the playlist alternates clips instead of showing
    one clip five times running."""
    per_scene = []
    skipped = 0
    taken = 0
    for scene in scenes:
        if taken >= MAX_WINDOWS or taken * width >= MAX_TOTAL_SECONDS:
            break
        f, duration = primary_file(scene)
        if not f or duration < width + 2:
            continue
        if not playable(f.get("path"), f.get("video_codec"), f.get("audio_codec")):
            skipped += 1
            continue
        row = [{
            "scene": str(scene["id"]),
            "title": scene.get("title") or "",
            "at": at,
            "dur": round(min(width, duration - at - 0.2), 2),
        } for at in snapshots({"id": str(scene["id"]), "dur": duration}, width,
                               random.Random("%s:%s" % (seed, scene["id"])))]
        per_scene.append(row)
        taken += len(row)

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
    windows, skipped = plan_windows(scenes, seed, seg())
    job = hashlib.blake2b(
        json.dumps([port, performer_id, windows, seg()]).encode(), digest_size=8
    ).hexdigest()
    for i, w in enumerate(windows):
        w["src"] = "/src/%s/%d" % (job, i)
    plan = {
        "job": job,
        "performerId": performer_id,
        "port": port,
        "name": name or "",
        "seg": seg(),
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
        "#EXT-X-TARGETDURATION:%d" % (int(seg()) + 1),
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

    def _stream(self, params):
        """A slice of the endless stream: `start` and `count` are global window
        keys, so the browser can ask for anything, in any order, and always get
        the same bytes for the same key."""
        port = str(params.get("port") or "9998")
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        kind = str(params.get("kind") or "performer").lower()
        if kind not in ("performer", "tag", "search", "folder"):
            kind = "performer"
        ident = str(params.get("id") or "").strip()
        if not ident:
            return self._json(400, {"error": "id required"})
        if kind not in ("search", "folder") and not ident.isdigit():
            return self._json(400, {"error": "id must be numeric for a performer or tag"})
        try:
            start = int(params.get("start") or 0)
            count = max(1, min(120, int(params.get("count") or 20)))
        except ValueError:
            return self._json(400, {"error": "bad start or count"})
        visit = str(params.get("visit") or "")[:32]
        try:
            width = float(params.get("seg") or seg())
        except (TypeError, ValueError):
            return self._json(400, {"error": "bad window duration"})
        if not math.isfinite(width) or not 1 <= width <= 15:
            return self._json(400, {"error": "window duration must be between 1 and 15 seconds"})
        width = round(width, 1)
        try:
            windows = stream_windows(port, kind, ident, start, count, visit, width)
            pool = scenes_for(port, kind, ident)
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            return self._json(502, {"error": "Stash query failed: %s" % str(exc)[:200]})
        if not windows:
            return self._json(422, {"error": "no clip in this library can be played as-is"})
        return self._json(200, {
            "port": port, "kind": kind, "id": ident,
            "name": name_for(port, kind, ident),
            "scenes": sum(scene["dur"] >= width + 2 for scene in pool),
            "skipped": SKIPPED.get((port, kind, ident), 0),
            "cycle": len(cycle_for(port, kind, ident, visit, width)),
            "seg": width, "settings": dict(SETTINGS, seg=width),
            "start": start, "count": len(windows), "windows": windows,
        })

    def _favorite(self, body):
        """Set or clear a scene's rating from the player. 100 means the heart is
        on, 0 means it is off -- Stash's own favorite flag."""
        scene_id = str(body.get("sceneId") or "").strip()
        port = str(body.get("port") or "9998")
        if not scene_id.isdigit():
            return self._json(400, {"error": "sceneId required"})
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        try:
            rating = 100 if int(body.get("rating") or 0) else 0
        except (TypeError, ValueError):
            rating = 0
        try:
            data = gql(port, FAVORITE_MUTATION, {"id": scene_id, "rating": rating})
        except Exception as exc:  # noqa: BLE001
            return self._json(502, {"error": "Stash rejected the update: %s" % str(exc)[:200]})
        scene = (data.get("sceneUpdate") or {})
        told = int(scene.get("rating100", rating) or 0)
        # Both caches already hold this scene (the player is looking at it), and a
        # stale rating there would make the heart flip back on the next window.
        with LOCK:
            for pool in POOLS.values():
                for item in pool:
                    if str(item.get("id")) == scene_id:
                        item["rating"] = told
            for cycle in CYCLES.values():
                for window in cycle:
                    if str(window.get("scene")) == scene_id:
                        window["rating"] = told
        return self._json(200, {"ok": True, "sceneId": scene_id, "rating": told})

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
            return self._html(player_html())
        if path == "/settings":
            return self._json(200, dict(SETTINGS))
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
        if path == "/stream":
            return self._stream({k: v[0] for k, v in parse_qs(parsed.query).items()})
        if path.startswith("/src/window/"):
            return self._window_clip(path, {k: v[0] for k, v in parse_qs(parsed.query).items()})
        if path.startswith("/src/scene/"):
            return self._scene_proxy(path, {k: v[0] for k, v in parse_qs(parsed.query).items()})
        if path.startswith("/src/"):
            return self._proxy(path)
        return self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})
        if path == "/favorite":
            return self._favorite(body)
        if path == "/settings":
            changed = update_settings(body)
            return self._json(200, {"ok": True, "changed": changed, "settings": dict(SETTINGS)})
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
        return self._relay(url, plan["port"])

    def _scene_proxy(self, path, params):
        """The same original-bytes relay, addressed by scene id. This is what
        the endless stream uses: a window names a scene and an offset, and the
        browser pulls the file itself with Range."""
        scene_id = path.rstrip("/").split("/")[-1]
        port = str(params.get("port") or "9998")
        if not scene_id.isdigit():
            return self._json(404, {"error": "no such scene"})
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        url = "%s/scene/%s/stream" % (INSTANCES[port]["url"], scene_id)
        return self._relay(url, port)

    def _window_clip(self, path, params):
        """Cut one window out of a file the browser cannot decode and transcode
        it to H.264 MP4. Cached on disk, so a window is only ever cut once and
        the second pass through a reel is instant."""
        scene_id = path.rstrip("/").split("/")[-1]
        port = str(params.get("port") or "9998")
        try:
            at = float(params.get("at") or 0)
            dur = float(params.get("d") or 3)
        except ValueError:
            return self._json(400, {"error": "bad at/d"})
        if not scene_id.isdigit() or port not in INSTANCES:
            return self._json(404, {"error": "no such scene"})
        key = hashlib.blake2b(
            ("%s|%s|%.3f|%.3f" % (port, scene_id, at, dur)).encode(), digest_size=8
        ).hexdigest()
        out = os.path.join(CACHE, "win-%s.mp4" % key)
        if not os.path.exists(out):
            with WINDOW_LOCKS.setdefault(key, threading.Lock()):
                if not os.path.exists(out):
                    tmp = out + ".part"
                    url = "%s/scene/%s/stream" % (INSTANCES[port]["url"], scene_id)
                    cmd = [
                        "ffmpeg", "-nostdin", "-loglevel", "error",
                        "-ss", "%.3f" % at, "-t", "%.3f" % dur,
                        "-headers", "ApiKey: %s\r\n" % key_for(port),
                        "-i", url,
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-c:a", "aac", "-b:a", "128k",
                        "-movflags", "+faststart", "-f", "mp4", "-y", tmp,
                    ]
                    try:
                        subprocess.run(cmd, timeout=180, check=True,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        os.replace(tmp, out)
                    except Exception as exc:  # noqa: BLE001
                        try:
                            os.unlink(tmp)
                        except OSError:
                            pass
                        return self._json(502, {"error": "transcode failed: %s" % type(exc).__name__})
        return self._send_file(out)

    def _send_file(self, path):
        """Serve a cached clip with byte-range support, so the browser can seek
        inside the window and the player can keep its usual buffering."""
        try:
            size = os.path.getsize(path)
        except OSError:
            return self._json(404, {"error": "no such clip"})
        start, end = 0, size - 1
        status = 200
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            try:
                first, _, last = rng[6:].partition("-")
                start = int(first) if first else 0
                end = int(last) if last else size - 1
                end = min(end, size - 1)
                if start > end:
                    raise ValueError
                status = 206
            except ValueError:
                start, end = 0, size - 1
        length = end - start + 1
        try:
            with open(path, "rb") as fh:
                fh.seek(start)
                self.send_response(status)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges", "bytes")
                if status == 206:
                    self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
                self.end_headers()
                remaining = length
                while remaining > 0:
                    chunk = fh.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def _relay(self, url, port):
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
        if self.path.startswith(("/src/", "/plan", "/status/")):
            return
        log("%s %s" % (self.command, getattr(self, "path", "")))


def main():
    os.makedirs(CACHE, exist_ok=True)
    load_settings()
    for env, key in (("REEL_SEC", "seg"), ("REEL_MIN_SPAN", "min_span"),
                     ("REEL_MAX_PER_CLIP", "max_per_clip")):
        if os.environ.get(env):
            update_settings({key: os.environ[env]})
    for port, inst in INSTANCES.items():
        try:
            inst["key"] = key_for(port)
            log("instance %s -> %s (key ok)" % (port, inst["url"]))
        except Exception as exc:  # noqa: BLE001
            log("instance %s unavailable: %s" % (port, exc))
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log("highlight reels on :%d, %.0fs windows, cache %s" % (PORT, seg(), CACHE))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
