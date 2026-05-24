## Problem

`vite.config.ts` hardcodes `base: "/stellar-money-map/"` for any non-development build. That path is correct for GitHub Pages (served at `username.github.io/stellar-money-map/`) but wrong for the Lovable publish target `https://stellar-money-map.lovable.app`, which serves from the root `/`.

Result: the published Lovable site requests `/stellar-money-map/assets/index-*.js`, gets a 404 (SPA fallback returns `index.html`), no JS executes → blank white page.

## Fix

Switch the base on an env flag rather than `mode`, so GitHub Pages keeps its subpath base and every other build (including Lovable publish) uses `/`.

In `vite.config.ts`:

```ts
// GitHub Actions sets GITHUB_ACTIONS=true automatically
base: process.env.GITHUB_PAGES === "true" ? "/stellar-money-map/" : "/",
```

Then update `.github/workflows/deploy.yml` to set the flag on the build step:

```yaml
- run: bun run build
  env:
    GITHUB_PAGES: "true"
```

## Why this works

- Lovable preview + Lovable publish + local `vite build`: base `/` → assets resolve correctly at the root.
- GitHub Pages CI build: `GITHUB_PAGES=true` → base `/stellar-money-map/` preserved, existing deploy keeps working.

## Out of scope

No app code, router, or asset changes. Republish via the Publish button after the change lands.
