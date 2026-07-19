# Asset Pack License

The pixel-art assets in this directory (sprites, rotations, animations, portraits,
backgrounds, brand art, and `manifest.json`) are generated with **PixelLab.ai** and
are **NOT** covered by the repository's root MIT `LICENSE` (which applies to the
runtime code only).

- **Source**: PixelLab.ai (generated on a **paid plan**)
- **Terms of Service**: https://pixellab.ai/termsofservice
- **Commercial use**: **Allowed** — the paid PixelLab.ai plan grants commercial-use rights to the generated assets.
- **Redistribution** (npm / package artifacts / public release): **Allowed**.
- **Attribution requirement**: **Not required** — an informational `ATTRIBUTION.md` with generation provenance is provided as a courtesy, but crediting is optional.

See decision **D-009** (asset-pack model) and **D-054** (license confirmation, 2026-07-19).

## Distribution model

- The asset pack is distributed as a **separate, optional npm package** (`orc-camp-assets`),
  NOT inside the core `orc-camp` runtime package. The core package stays code-only
  (`package.json#files` allowlist; enforced by `npm run smoke`), so its license gate is
  unchanged. The dashboard renders real sprites only when the asset pack is present —
  otherwise it falls back to CSS placeholders (SPEC-300 §3.8 parity).
- The published `orc-camp-assets` package excludes runtime-irrelevant generation metadata
  (`generation/`) and repository brand art (`brand/`).

Copyright of the generated art is governed by the PixelLab.ai Terms of Service (paid plan).
