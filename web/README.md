# Orc Camp Dashboard SPA (`web/`)

Vite + React + TypeScript dashboard for Epic 3 (SPEC-200/201/202) + Epic 4 asset rendering
(SPEC-300). Self-contained: its own `package.json`, install and build. It consumes the
local server (Epic 2) REST + WebSocket API; it does not modify anything outside `web/`.

## Run

```bash
cd web
npm install
npm run dev          # Vite dev server on http://localhost:5173
```

The dashboard needs the server's one-time token. Start `orc-camp serve` (it prints a boot
URL like `http://127.0.0.1:<port>/?token=<token>`), then open the dev server pointed at it:

```
http://localhost:5173/?token=<TOKEN>&api=http://127.0.0.1:<PORT>
```

- `token` is read once, moved to an in-memory holder, and stripped from the URL.
- `api` (dev override) sets the REST/WS origin. In a production build served by the server
  itself, omit it — the app uses same-origin. You can also set `VITE_API_BASE`.
- `assets` (or `VITE_ASSET_BASE`) overrides the asset-pack base; default `/asset-pack`,
  which the dev server proxies from the repo-root `asset-packs/orc-camp-default/`. In a
  production build the pack is not bundled (license gate), so sprites fall back to CSS
  placeholders — fully functional (SPEC-300 §3.6/§3.8).

## Verify

```bash
npm run typecheck    # tsc --noEmit, strict
npm run build        # tsc + vite production build
npm run test         # vitest unit tests (reconcile / view-status / sprite resolver)
```

## Layout

- `src/api/` — in-memory token holder + REST client (Bearer auth, error mapping).
- `src/realtime/` — `reconcile.ts` (pure version-ordering + id-merge) and `engine.ts`
  (WS-first buffering bootstrap, reconnect/backoff, resync).
- `src/store/` — Zustand store (server/connection/ui slices), normalized `serverData`,
  `viewStatus` derivation.
- `src/assets/` — manifest loader + deterministic `spriteResolver` (SPEC-300).
- `src/components/`, `src/screens/` — camp list / detail / inspector / preview / settings.
