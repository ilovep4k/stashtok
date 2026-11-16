# Thumbnail service

Stash v0.32 cannot resize on the fly: `/scene/{id}/screenshot` and
`/performer/{id}/image` ignore `?width=`, `?w=` and `?quality=`, and there is no
thumbnail route. A 200 px card therefore downloads the full screenshot.

This sidecar fixes that. It fetches an original once, resizes it, caches the JPEG on
disk and serves it with a long-lived `immutable` cache header.

```
GET /t/scene/<id>?w=320&q=78
GET /t/performer/<id>?w=320&q=78
GET /t/image/<id>?w=320&q=78
GET /healthz
```


## Run it

```bash
cp docker-compose.example.yml docker-compose.yml
STASH_KEY=... STASH_KEY_SECOND=... docker compose up -d --build
```

Or add the two services as a stack in Portainer. `STASH_URL` must be reachable from
inside the container: on the same host that is the published port over the docker
bridge gateway, `http://172.17.0.1:9997`.

## Wire it into the plugin

Nothing to configure in the common case: the plugin guesses the service from the port
the app is served on (9997 -> :18997, 9998 -> :18996). Override with the
`thumbBase` plugin setting:

- empty - guess from the port
- `off` - disable, always load Stash's originals
- a URL - use that base

If the service is unreachable or has no image for an id (Stash answers with an SVG
placeholder for performers without a picture), it returns 404 and the `<img>` falls
back to the original URL, so a stopped service degrades rather than breaks.

## Measured

Discover screen, 1600x1000, 100 cards in the DOM:

- before: 200 full screenshots downloaded up front, ~9.4 MB
- after: 87 resized thumbs at ~12.5 KB each, ~1.1 MB, and only what is near the viewport

