#!/usr/bin/env python3
"""Resized thumbnail service for StashTok.

Stash v0.32 cannot resize on the fly, so the app 165 KB screenshots into 200 px
boxes. This sits beside Stash, fetches the original once, and serves a small
cached JPEG instead.

Routes
  GET /t/scene/<id>?w=320&q=78
  GET /t/performer/<id>?w=320&q=78
  GET /t/image/<id>?w=320&q=78
  GET /healthz

Env
  STASH_URL   base url of the Stash instance      (default http://172.17.0.1:9997)
  STASH_KEY   that instance's api key             (required)
  CACHE_DIR   where rendered thumbnails live      (default /cache)
  MAX_WIDTH   largest width accepted              (default 1280)
"""
import hashlib
import io
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image

STASH_URL = os.environ.get("STASH_URL", "http://172.17.0.1:9997").rstrip("/")
STASH_KEY = os.environ.get("STASH_KEY", "")
CACHE_DIR = os.environ.get("CACHE_DIR", "/cache")
MAX_WIDTH = int(os.environ.get("MAX_WIDTH", "1280"))

UPSTREAM = {
    "scene": "/scene/%s/screenshot",
    "performer": "/performer/%s/image",
    "image": "/image/%s/thumbnail",
}

_lock = threading.Lock()


def fetch(kind, ident):
    url = STASH_URL + UPSTREAM[kind] % ident
    req = urllib.request.Request(url, headers={"ApiKey": STASH_KEY})
    with urllib.request.urlopen(req, timeout=45) as resp:
        ctype = resp.headers.get("Content-Type", "")
        # Stash answers with an SVG placeholder when a performer has no image
        if not ctype.startswith("image/") or "svg" in ctype:
            raise LookupError("no raster image upstream (" + ctype + ")")
        return resp.read()


def render(kind, ident, width, quality):
    key = "%s_%s_%s_%s" % (kind, ident, width, quality)
    path = os.path.join(CACHE_DIR, key[:2], key + ".jpg")
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return fh.read()

    raw = fetch(kind, ident)
    try:
        img = Image.open(io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001
        raise LookupError("cannot decode upstream image: %s" % exc)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if img.width > width:
        height = max(1, round(img.height * width / img.width))
        img = img.resize((width, height), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    data = buf.getvalue()

    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
    return data


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, body=b"", ctype="text/plain", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            return self._send(200, b"ok")

        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) != 3 or parts[0] != "t" or parts[1] not in UPSTREAM:
            return self._send(404, b"unknown route")
        kind, ident = parts[1], parts[2]
        if not ident.isalnum():
            return self._send(400, b"bad id")

        qs = parse_qs(parsed.query)
        try:
            width = int(qs.get("w", ["320"])[0])
            quality = int(qs.get("q", ["78"])[0])
        except ValueError:
            return self._send(400, b"bad w/q")
        width = max(64, min(width, MAX_WIDTH))
        quality = max(40, min(quality, 95))

        try:
            with _lock:
                data = render(kind, ident, width, quality)
        except urllib.error.HTTPError as exc:
            return self._send(404, ("upstream %s" % exc.code).encode())
        except LookupError as exc:
            return self._send(404, str(exc)[:200].encode())
        except Exception as exc:  # noqa: BLE001
            return self._send(502, str(exc)[:200].encode())

        etag = '"%s"' % hashlib.sha1(data).hexdigest()[:16]
        if self.headers.get("If-None-Match") == etag:
            return self._send(304, b"", "image/jpeg", {"ETag": etag})
        self._send(200, data, "image/jpeg",
                   {"ETag": etag, "Cache-Control": "public, max-age=604800, immutable"})

    do_HEAD = do_GET


if __name__ == "__main__":
    if not STASH_KEY:
        sys.exit("STASH_KEY is required")
    os.makedirs(CACHE_DIR, exist_ok=True)
    port = int(os.environ.get("PORT", "8080"))
    print("thumb service on :%d upstream %s" % (port, STASH_URL), flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()