#!/usr/bin/env python3
"""Build the StashTok plugin zip and a Community-style index.yml.

Usage:
    python3 tools/build.py --base-url https://raw.githubusercontent.com/ilovep4k/stashtok/main/dist

Writes dist/stashTok.zip and index.yml (with a real sha256), so the repo can be
added in Stash via Settings -> Plugins -> Available Plugins -> Add Source.
"""
import argparse
import datetime
import hashlib
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "stashTok"
DIST = ROOT / "dist"
FILES = ["stashTok.yml", "stashTok.js", "stashTok.css"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://raw.githubusercontent.com/ilovep4k/stashtok/main/dist")
    args = parser.parse_args()

    DIST.mkdir(exist_ok=True)
    zip_path = DIST / "stashTok.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            source = PLUGIN / name
            if not source.exists():
                raise SystemExit(f"missing {source}")
            archive.write(source, f"stashTok/{name}")

    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    version = "0.1.0"
    for line in (PLUGIN / "stashTok.yml").read_text().splitlines():
        if line.startswith("version:"):
            version = line.split(":", 1)[1].strip()

    index = f"""- id: stashTok
  name: StashTok
  metadata:
    description: Full-screen vertical feed for scenes and markers with swipe, pinch zoom and a marker scrub bar.
  version: {version}
  date: {datetime.date.today().isoformat()} 00:00:00
  path: {args.base_url.rstrip('/')}/stashTok.zip
  sha256: {digest}
"""
    (ROOT / "index.yml").write_text(index)
    # the gh-pages publish directory is dist/, so the index must live there too
    (DIST / "index.yml").write_text(index)
    print(f"wrote {zip_path} ({zip_path.stat().st_size} bytes)")
    print(f"sha256 {digest}")
    print("wrote index.yml")


if __name__ == "__main__":
    main()
