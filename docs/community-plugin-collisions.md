# Community plugins that break the page

Two plugins each declaring the same top-level identifier abort the whole script, and
Stash shows *Something went wrong* until you reload.

## `Identifier 'stash' has already been declared`

Seen with **hotCards** + **cjCardTweaks** installed together:

- `hotCards/utils/stashHandler.js` declares a global `const stash`.
- `cjCardTweaks` loaded a helper of the same name from jsDelivr, which declares its own
  `const stash`. Stash injects remote scripts as separate `<script>` tags, so the second
  declaration is a parse-time SyntaxError. On the Plugins page the script is injected
  twice, which is why the error appears twice.

Fix that keeps both plugins working: self-host the helper inside `cjCardTweaks` and
make it attach to the existing global instead of declaring one.

```js
// was: const stash = { galleries: {}, ... };
if (!window.stash) {
  window.stash = { galleries: {}, images: {}, movies: {}, performers: {}, scenes: {}, studios: {} };
}
// and reference it as window.stash.<key> from then on
```

Then point `cjCardTweaks.yml` at the local file and restart Stash (the plugin manifest
is read at startup, and `reloadPlugins` does not refresh the served paths).

Disabling either plugin also clears the error.

## Checklist when a page dies but the server is fine

1. Open the page with a fresh browser context and capture `Runtime.exceptionThrown`.
2. The failing script's URL usually names the plugin; a URL from a CDN means the plugin
   pulled a helper at runtime.
3. Check which plugin bundles declare the same identifier:
   `grep -rn --include=*.js -E '^(const|let) +<name>\b' plugins/`
4. Patch or disable, then restart the container - plugin manifests are read at boot.
