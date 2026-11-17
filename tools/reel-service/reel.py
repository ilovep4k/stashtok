#!/usr/bin/env python3
"""Highlight-reel service for StashTok.

Given a performer, cut a tight edit out of their scenes: 3 seconds from a random
spot in each clip, more windows in longer videos, stitched into one MP4. Nothing
is re-encoded twice -- every segment is normalised to 720p/H.264/AAC so the
concat demuxer can just join the parts.

Routes
  POST /reel                 {"performerId": "123", "name": "…", "port": "9998"}
                             -> {"job": "<id>"} (a cache hit returns status=done)
  GET  /status/<job>         -> {"status": queued|running|done|error, "pct": 0-100, …}
  GET  /reel/<job>/<name>.mp4  the finished reel, Range supported
  GET  /healthz

Env
  REEL_PORT        listen port                        (default 19000)
  REEL_CACHE       where reels live                   (default ~/.cache/stashtok-reels)
  REEL_STASH_9998  Stash base url for the 9998 app    (default http://127.0.0.1:9998)
  REEL_STASH_9997  Stash base url for the 9997 app    (default http://127.0.0.1:9997)
  REEL_KEYCMD_9998 how to read that instance's key    (default docker exec stash-wario …)

The API key is read with the key command at request time and never logged or
returned; only its presence is reported.
"""
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("REEL_PORT", "19000"))
CACHE = os.path.expanduser(os.environ.get("REEL_CACHE", "~/.cache/stashtok-reels"))
SEG_SECONDS = 3
HEIGHT = 720
MAX_SEGMENTS = 60
MAX_TOTAL_SECONDS = 200
# A scene served as a live transcode cannot seek cheaply: the cut crawls through
# the file instead of range-seeking. Give up on that one and keep the reel moving.
SEG_TIMEOUT = 45
# Hard ceiling for the whole build, so a slow library still yields a reel.
BUILD_DEADLINE = 240

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
LOCK = threading.Lock()
SLOTS = threading.Semaphore(2)


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
  body { margin: 0; background: #000; color: #fff; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         min-height: 100dvh; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
           padding: calc(12px + env(safe-area-inset-top)) 16px 12px; font-size: 12px;
           letter-spacing: .09em; text-transform: uppercase; color: rgba(255,255,255,.7); }
  header b { font-size: 13px; letter-spacing: 0; text-transform: none; color: #fff; font-weight: 600; }
  header a { color: inherit; text-decoration: none; border: 1px solid rgba(255,255,255,.2);
             border-radius: 999px; padding: 6px 12px; }
  main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 16px; }
  video { width: 100%; max-height: 78dvh; background: #000; border-radius: 12px; display: none; }
  video.ready { display: block; }
  .card { width: min(420px, 100%); text-align: center; }
  .bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,.12); overflow: hidden; margin: 14px 0 8px; }
  .bar i { display: block; height: 100%; width: 0; background: #ff2d55; transition: width .4s ease; }
  .sub { color: rgba(255,255,255,.6); font-size: 12px; }
  .err { color: #ff8098; font-size: 13px; }
  button { margin-top: 14px; background: #ff2d55; color: #fff; border: 0; border-radius: 10px;
           padding: 10px 16px; font-size: 13px; cursor: pointer; }
</style></head>
<body>
<header><span>highlight reel</span><a href="#" onclick="history.length>1?history.back():window.close();return false">close</a></header>
<main>
  <div class="card" id="card">
    <div id="title" style="font-size:16px;font-weight:600"></div>
    <div class="bar"><i id="fill"></i></div>
    <div class="sub" id="status">queued…</div>
  </div>
  <video id="v" controls playsinline autoplay></video>
</main>
<script>
  const q = new URLSearchParams(location.search);
  const pid = q.get("performerId") || "";
  const name = q.get("name") || "";
  document.getElementById("title").textContent = name || "performer " + pid;
  const fill = document.getElementById("fill");
  const status = document.getElementById("status");
  const video = document.getElementById("v");
  const card = document.getElementById("card");
  const setStatus = (t) => { status.textContent = t; };

  function show(data) {
    const src = "/reel/" + data.job + "/" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reel") + ".mp4";
    video.src = src;
    video.classList.add("ready");
    card.style.display = "none";
    video.play().catch(() => {});
  }

  async function poll(job) {
    try {
      const res = await fetch("/status/" + job, { cache: "no-store" });
      const data = await res.json();
      if (data.status === "done") return show(data);
      if (data.status === "error") throw new Error(data.error || "reel failed");
      fill.style.width = (data.pct || 0) + "%";
      setStatus(data.status === "running" ? "cutting " + (data.kept || 0) + " of " + (data.segments || 1) + " clips · " + (data.pct || 0) + "%" : "queued…");
      setTimeout(() => poll(job), 1500);
    } catch (err) {
      setStatus("failed: " + err.message);
      status.className = "err";
      document.getElementById("card").innerHTML += '<br><button onclick="location.reload()">Try again</button>';
    }
  }

  (async () => {
    try {
      const res = await fetch("/reel", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performerId: pid, port: q.get("port") || "", name }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "reel failed");
      if (data.status === "done") return show(data);
      setStatus(data.cached ? "cached" : "queued…");
      poll(data.job);
    } catch (err) {
      setStatus("failed: " + err.message);
      status.className = "err";
    }
  })();
</script>
</body></html>"""

REEL_QUERY = """
query ReelScenes($id: ID!) {
  findScenes(scene_filter: { performers: { value: [$id], modifier: INCLUDES } },
             filter: { per_page: 300, sort: "date", direction: DESC }) {
    count
    scenes { id title files { duration } }
  }
}
"""


def plan_segments(scenes, seed):
    """3 s windows, five of them in a long video, skipping around each clip."""
    rng = random.Random(seed)
    plan = []
    total = 0
    for scene in scenes:
        if len(plan) >= MAX_SEGMENTS or total >= MAX_TOTAL_SECONDS:
            break
        duration = 0.0
        for f in scene.get("files") or []:
            try:
                duration = max(duration, float(f.get("duration") or 0))
            except (TypeError, ValueError):
                pass
        if duration < SEG_SECONDS + 3:
            continue
        if duration < 45:
            count = 1
        elif duration < 120:
            count = 2
        elif duration < 300:
            count = 3
        else:
            count = 5  # "any long video" gets five
        # keep the last window inside the clip, and never start in the first second
        low, high = 1.0, max(1.0, duration - SEG_SECONDS - 0.5)
        for _ in range(count):
            if len(plan) >= MAX_SEGMENTS or total >= MAX_TOTAL_SECONDS:
                break
            at = round(rng.uniform(low, high), 2)
            plan.append({"scene": str(scene["id"]), "at": at})
            total += SEG_SECONDS
    return plan


def local_audio(path):
    """Whether the just-cut segment carries an audio stream (a local ffprobe:
    probing the remote stream itself stalls on files whose moov sits at the end)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=codec_type", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=20,
        )
    except subprocess.TimeoutExpired:
        return False
    return "audio" in out.stdout


def grab(url, key, at, dest):
    """Pull three seconds out of the remote clip by *stream copy*.

    Copying needs no decode: ffmpeg range-seeks to the nearest keyframe and
    downloads a few MB. Decoding 3 s straight off a 2 GB remote file was the
    slow path (15 s per segment); this is a second or two."""
    try:
        run = subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-y",
             "-headers", "ApiKey: %s\r\n" % key,
             "-ss", "%.2f" % at, "-i", url, "-t", str(SEG_SECONDS + 1),
             "-c", "copy", "-avoid_negative_ts", "make_zero", dest],
            capture_output=True, text=True, timeout=SEG_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        # never str() the exception: its repr holds the command line, and the
        # command line holds the API key
        raise RuntimeError("stream copy timed out (slow seek)") from None
    if run.returncode != 0:
        raise RuntimeError("stream copy failed: %s" % (run.stderr.strip()[-160:]))
    if not os.path.exists(dest) or os.path.getsize(dest) < 1024:
        raise RuntimeError("empty cut")


def normalise(raw, dest, with_audio):
    """Re-encode the small local cut to the one shape the concat demuxer needs:
    720p, 30 fps, H.264 + AAC stereo, three seconds exactly."""
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", raw]
    if with_audio:
        cmd += ["-map", "0:v:0", "-map", "0:a:0"]
    else:
        cmd += ["-f", "lavfi", "-t", str(SEG_SECONDS), "-i",
                "anullsrc=channel_layout=stereo:sample_rate=48000",
                "-map", "0:v:0", "-map", "1:a:0", "-shortest"]
    cmd += [
        "-t", str(SEG_SECONDS),
        "-vf", "scale=-2:%d,fps=30,setsar=1" % HEIGHT,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", dest,
    ]
    try:
        run = subprocess.run(cmd, capture_output=True, text=True, timeout=SEG_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise RuntimeError("normalise timed out") from None
    if run.returncode != 0:
        raise RuntimeError("normalise failed: %s" % (run.stderr.strip()[-160:]))


def cut(url, key, at, dest):
    raw = dest + ".raw.mkv"
    try:
        grab(url, key, at, raw)
        normalise(raw, dest, local_audio(raw))
    finally:
        if os.path.exists(raw):
            os.remove(raw)


def build(job_id, port, performer_id, name, plan, out_path):
    inst = INSTANCES[port]
    key = key_for(port)
    work = tempfile.mkdtemp(prefix="reel-", dir=os.path.join(CACHE, "work"))
    try:
        parts = []
        started = time.time()
        skipped = 0
        for i, seg in enumerate(plan):
            if time.time() - started > BUILD_DEADLINE:
                log("build deadline hit, keeping", len(parts), "segments")
                break
            with LOCK:
                JOBS[job_id]["pct"] = int(100 * i / max(1, len(plan)))
                JOBS[job_id]["kept"] = len(parts)
            url = "%s/scene/%s/stream" % (inst["url"], seg["scene"])
            dest = os.path.join(work, "seg-%03d.mp4" % i)
            try:
                cut(url, key, seg["at"], dest)
            except Exception as exc:  # noqa: BLE001 - one bad scene must not kill the reel
                skipped += 1
                log("skip scene", seg["scene"], str(exc).replace(key, "<redacted>")[:120])
                continue
            parts.append(dest)
        if len(parts) < 2:
            raise RuntimeError("no scene in this list could be cut (the stream may not seek)")
        listing = os.path.join(work, "list.txt")
        with open(listing, "w") as fh:
            for part in parts:
                fh.write("file '%s'\n" % part)
        tmp_out = out_path + ".part.mp4"
        run = subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
             "-i", listing, "-c", "copy", "-movflags", "+faststart", tmp_out],
            capture_output=True, text=True, timeout=300,
        )
        if run.returncode != 0:
            raise RuntimeError("ffmpeg concat failed: %s" % run.stderr.strip()[-300:])
        os.replace(tmp_out, out_path)
        with LOCK:
            JOBS[job_id].update(
                status="done", pct=100, seconds=len(parts) * SEG_SECONDS,
                segments=len(parts), finished=time.time(),
            )
        log("reel ready", job_id, name, "%d segments" % len(parts))
    except Exception as exc:  # noqa: BLE001 - every failure is reported, never fatal
        with LOCK:
            JOBS[job_id].update(status="error", error=str(exc).replace(key, "<redacted>")[:300])
        log("reel failed", job_id, exc)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        SLOTS.release()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "reel").lower()).strip("-")[:40] or "reel"


class Handler(BaseHTTPRequestHandler):
    server_version = "StashTokReel/1.0"

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

    def do_OPTIONS(self):  # noqa: N802 - http.server naming
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/healthz":
            with LOCK:
                return self._json(200, {"ok": True, "jobs": len(JOBS)})
        if path.startswith("/status/"):
            job_id = path.split("/", 2)[2]
            with LOCK:
                job = JOBS.get(job_id)
            if not job:
                return self._json(404, {"error": "unknown job"})
            return self._json(200, job)
        if path == "/player":
            body = PLAYER_HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/reel/"):
            return self._media(path)
        return self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if urlparse(self.path).path != "/reel":
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})
        performer_id = str(body.get("performerId") or "").strip()
        if not performer_id.isdigit():
            return self._json(400, {"error": "performerId required"})
        port = str(body.get("port") or "9998")
        if port not in INSTANCES:
            return self._json(400, {"error": "unknown instance"})
        name = body.get("name") or ""

        try:
            data = gql(port, REEL_QUERY, {"id": performer_id})
            scenes = (data.get("findScenes") or {}).get("scenes") or []
        except Exception as exc:  # noqa: BLE001
            return self._json(502, {"error": "Stash query failed: %s" % str(exc)[:200]})

        seed = int(hashlib.blake2b(("|".join(sorted(str(s["id"]) for s in scenes))).encode(),
                                   digest_size=4).hexdigest(), 16)
        plan = plan_segments(scenes, seed)
        if not plan:
            return self._json(422, {"error": "no scenes long enough for a reel"})

        fingerprint = hashlib.blake2b(
            json.dumps([performer_id, plan, HEIGHT, SEG_SECONDS]).encode(), digest_size=8
        ).hexdigest()
        job_id = fingerprint
        out_path = os.path.join(CACHE, "%s-%s.mp4" % (performer_id, fingerprint))

        with LOCK:
            existing = JOBS.get(job_id)
            if existing and existing["status"] in ("queued", "running"):
                return self._json(200, dict(existing, cached=False))
            if os.path.exists(out_path) and not body.get("refresh"):
                info = {
                    "job": job_id, "status": "done", "pct": 100, "cached": True,
                    "segments": len(plan), "seconds": len(plan) * SEG_SECONDS,
                    "name": name, "url": "/reel/%s/%s.mp4" % (job_id, slug(name)),
                }
                JOBS[job_id] = dict(info)
                return self._json(200, info)
            JOBS[job_id] = {
                "job": job_id, "status": "queued", "pct": 0, "cached": False,
                "performerId": performer_id, "name": name, "segments": len(plan),
                "seconds": len(plan) * SEG_SECONDS, "started": time.time(),
            }
            job = dict(JOBS[job_id])

        SLOTS.acquire()
        with LOCK:
            JOBS[job_id]["status"] = "running"
        os.makedirs(os.path.join(CACHE, "work"), exist_ok=True)
        threading.Thread(
            target=build, args=(job_id, port, performer_id, name, plan, out_path), daemon=True
        ).start()
        return self._json(200, job)

    def _media(self, path):
        parts = path.strip("/").split("/")
        if len(parts) < 3:
            return self._json(404, {"error": "not found"})
        job_id = parts[1]
        with LOCK:
            job = JOBS.get(job_id) or {}
        file_path = os.path.join(CACHE, "%s-%s.mp4" % (job.get("performerId", ""), job_id))
        if not os.path.exists(file_path):
            # a cached job recovered from disk after a restart: find it by suffix
            hits = [f for f in os.listdir(CACHE) if f.endswith(job_id + ".mp4")]
            if not hits:
                return self._json(404, {"error": "no such reel"})
            file_path = os.path.join(CACHE, hits[0])
        size = os.path.getsize(file_path)
        start, end = 0, size - 1
        header = self.headers.get("Range") or ""
        m = re.match(r"bytes=(\d*)-(\d*)", header)
        code = 200
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            else:
                start = max(0, size - int(m.group(2)))
            code = 206
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Access-Control-Allow-Origin", "*")
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        with open(file_path, "rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                chunk = fh.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        if "/status/" not in self.path and "/healthz" not in self.path:
            log("%s %s" % (self.command, getattr(self, "path", "")))


def main():
    os.makedirs(CACHE, exist_ok=True)
    for port, inst in INSTANCES.items():
        try:
            key_for(port)
            inst["key"] = KEYS[port]
            log("instance %s -> %s (key ok)" % (port, inst["url"]))
        except Exception as exc:  # noqa: BLE001
            log("instance %s unavailable: %s" % (port, exc))
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log("highlight reels on :%d, cache %s" % (PORT, CACHE))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
