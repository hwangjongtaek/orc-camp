import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only static server for the local PixelLab asset pack.
 *
 * The pack lives OUTSIDE web/ (repo-root `asset-packs/orc-camp-default/`) and is NOT
 * bundled into the production build (SPEC-300 §3.8 license gate, D-009 non-redistribution).
 * In dev we proxy `/asset-pack/<rel>` -> `<repoRoot>/asset-packs/orc-camp-default/<rel>`
 * so real sprites render locally. In a production build the route is absent, the manifest
 * fetch fails, and the renderer degrades to the CSS pixel placeholder (SPEC-300 L2).
 */
function assetPackDevServer(): Plugin {
  const packRoot = resolve(here, '..', 'asset-packs', 'orc-camp-default');
  const prefix = '/asset-pack/';
  const mime: Record<string, string> = {
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return {
    name: 'orc-camp-asset-pack-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith(prefix)) return next();
        const rel = decodeURIComponent(url.slice(prefix.length).split('?')[0] ?? '');
        const filePath = normalize(resolve(packRoot, rel));
        // Path traversal guard: must stay inside the pack root.
        if (!filePath.startsWith(packRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end('asset not found');
          return;
        }
        res.setHeader('Content-Type', mime[extname(filePath).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), assetPackDevServer()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
