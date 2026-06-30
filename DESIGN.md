---
version: alpha
name: Orc Camp
description: >-
  A dot (pixel) game UI for observing AND operating live developer work — tmux
  sessions are rendered as camps and the AI-agent sessions inside them as orcs.
  Built for developers, so the game surface runs at production-tool density and
  never hides real state, raw tmux targets, or controls behind the metaphor.
colors:
  # Core palette (values realized in web/src/styles/tokens.css)
  ink: "#171C1F"
  charcoal: "#262D2F"
  moss: "#4F6F52"
  ember: "#D6723F"
  mana: "#4AA3DF"
  parchment: "#F3E7C4"
  bone: "#D8C9A3"
  danger: "#C94C4C"
  warning: "#D6A43F"
  border: "rgba(216, 201, 163, 0.24)"
  # Semantic roles (reference the palette)
  surfaceBase: "{colors.ink}"
  surfaceRaised: "{colors.charcoal}"
  primary: "{colors.ember}"
  accent: "{colors.mana}"
  success: "{colors.moss}"
  text: "{colors.parchment}"
  textMuted: "{colors.bone}"
  onPrimary: "#1A1206"
  onDanger: "#FFFFFF"
  overlay: "rgba(0, 0, 0, 0.6)"
typography:
  ui:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 14px
    lineHeight: 1.45
    letterSpacing: 0
  mono:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
    fontSize: 13px
    letterSpacing: 0
  pixel:
    fontFamily: "'Courier New', monospace" # placeholder pixel face until a bundled bitmap font
    letterSpacing: 0
  heading:
    fontFamily: "{typography.ui.fontFamily}"
    fontSize: 22px
    fontWeight: 600
    letterSpacing: 0
  label:
    fontFamily: "{typography.ui.fontFamily}"
    fontSize: 12px
    letterSpacing: 0
rounded:
  pixel: 4px
  card: 8px
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 24px
components:
  campCard:
    background: "{colors.surfaceRaised}"
    border: "1px solid {colors.border}"
    radius: "{rounded.card}"
    padding: "{spacing.3}"
  statusBadge:
    radius: "{rounded.pixel}"
    fontSize: "{typography.label.fontSize}"
    paddingX: "{spacing.2}"
    # color is a SECONDARY channel; icon + label + chip border-style carry the meaning
  orcSprite:
    rendering: pixelated
    scale: 0.20 # mapSpriteScale (SPEC-301 §2.1) — applied equally to asset and placeholder
  campMap:
    ground: "linear-gradient(160deg, {colors.moss} 0%, {colors.ink} 100%)"
    zStation: 1
    zSprite: 10
    zOverlay: 12
    zLabel: 13
    zBubble: 20
  terminalPreview:
    background: "{colors.ink}"
    fontFamily: "{typography.mono.fontFamily}"
    userSelect: text
  commandDock:
    background: "{colors.surfaceRaised}"
    border: "1px solid {colors.border}"
    inputFontFamily: "{typography.mono.fontFamily}"
  interruptButton:
    background: "{colors.danger}"
    color: "{colors.onDanger}"
    minSize: 44px # destructive targets are large and explicit, never decorative
  confirmModal:
    backdrop: "{colors.overlay}"
    background: "{colors.surfaceRaised}"
    initialFocus: cancel # destructive button is never auto-focused
  focusRing:
    outline: "2px solid {colors.accent}"
    offset: 2px
---

# Orc Camp — DESIGN.md

> Visual-identity contract for agents that generate or modify the Orc Camp UI.
> Tokens above are normative; the prose below explains their application. This
> document is derived from and stays consistent with the implementation specs
> (`docs/specs/SPEC-201` screens, `SPEC-202` design/accessibility, `SPEC-300`
> asset rendering, `SPEC-301` camp map/movement, `SPEC-400` control actions,
> `SPEC-500` settings) and the design-system contract (`docs/design/DESIGN.md`).
> Where a value and a spec disagree, the spec is the behavioral SSOT.

## Overview

Orc Camp is a **local-first CLI dashboard** that makes running developer work
legible and operable through a **dot (pixel) game world**. The metaphor is
load-bearing, not cosmetic:

- a **tmux session = a camp**,
- an **AI-agent session inside a pane (Claude Code, Codex, …) = an orc**.

**Core concept — a dot game UI to _view and manage_ sessions.** The pixel world
is the operating surface, not a decorative skin. Through it a developer can:

- **View** — see every camp at a glance (camp list + global status summary),
  open a camp as a **full-bleed pixel map** where orcs **roam to stations that
  encode their current activity** (active → workbench, waiting → campfire, idle →
  bedroll, error → notice-board, …), inspect one orc's metadata / status /
  inferred work summary, and read a redacted terminal preview.
- **Manage** — act on a selected orc through a **command dock**: send text input,
  send an allowlisted key, or **interrupt** (with a confirm modal). Control is
  the product's only state-changing path and is deliberately explicit.

**Audience & temperament.** The players are developers, so the game runs at
**production-tool density and honesty**. Three commitments override any
game-flavored instinct:

1. **Never fabricate state.** Inferred `status` always renders with its
   `statusConfidence`; an estimated work summary always carries an estimated
   marker. Uncertainty is shown, not smoothed over.
2. **Never hide the truth behind the metaphor.** The raw `tmuxTarget`, plain-text
   status label, and controls are **always reachable** — the dots decorate the
   data, they never replace it.
3. **Read-only by default; private by default.** Scanning is read-only; terminal
   output passes a redaction chokepoint before it is ever shown and is never
   auto-saved or sent anywhere. The map is **client-derived**: an orc's position
   is a pure function of existing fields — no coordinates are added to the data.

**Visual direction.** A camp at dusk: dark earth-and-charcoal surfaces, a warm
campfire **ember** accent, cool **mana** for selection/active, mossy terrain.
Flat and pixel-crisp — no SaaS purple/blue gradients, no glassmorphism, no
marketing hero. The first screen is an operational dashboard.

## Colors

The palette is a warm-dark fantasy-camp scheme. Status hue is always a
**secondary channel** layered on top of icon + label + shape (see Do's and
Don'ts); color alone never carries meaning.

| Token | Value | Role |
| --- | --- | --- |
| `ink` | `#171C1F` | base background, terminal preview surface |
| `charcoal` | `#262D2F` | raised panels, toolbars, docks |
| `moss` | `#4F6F52` | camp terrain, success |
| `ember` | `#D6723F` | primary action, campfire accent |
| `mana` | `#4AA3DF` | selection, active agent, focus ring |
| `parchment` | `#F3E7C4` | primary text on dark |
| `bone` | `#D8C9A3` | secondary / muted text |
| `danger` | `#C94C4C` | error status, interrupt/destructive |
| `warning` | `#D6A43F` | waiting, caution |
| `border` | `bone @ 24% α` | 1px dividers and panel edges (flat depth) |

**Status → hue (secondary only).** `active` → `mana`, `waiting` → `warning`,
`idle` → `bone`, `stale` → `bone` (dimmed), `error` → `danger`, `unknown` →
`bone`, `terminated` → `bone` (dimmed). Each is paired with a distinct icon and
chip border-style so the seven states survive a grayscale render.

**Usage rules.**

- Keep terrain, fire, panel, and selection hues **distinct** so the dashboard
  never reads as one monochrome wash.
- Reserve `ember` for the single primary action in a context and `danger` for
  destructive/error only — do not decorate with them.
- `parchment` on `ink`/`charcoal` is the default text pairing; verify ≥ 4.5:1
  body contrast (≥ 3:1 large) per SPEC-202.

## Typography

- **UI** — system sans (`{typography.ui}`) for all chrome and labels.
- **Mono** — `{typography.mono}` for everything that is literally terminal or
  code: `tmuxTarget`, `paneId`, `command`, `cwd`, and the terminal preview. Code
  identity always looks like code.
- **Pixel** — `{typography.pixel}` is restricted to the logo, camp titles, and
  small badges; never body copy.
- **Scale is compact and operational.** Heading ≤ 22px, body 14px, label 12px.
  No hero-scale type. `letter-spacing` is `0` everywhere.

## Layout

- **Operational first screen.** Root route is the **camp list** plus a global
  **status summary bar** — where work is and where it's stuck, immediately. No
  landing/marketing hero.
- **Camp detail is the map.** A camp opens as a full-bleed **pixel camp map**
  (the operating surface) that spans the whole row, with a single **tabbed dock**
  below it (Details / Preview / Activity) — one column at every width (no right
  column, no mobile bottom sheet). This gives the map the full width and merges
  the old inspector + activity rail into one switchable panel (SPEC-201 §2.3).
- **The map is a coordinate space, not wallpaper** (SPEC-301): the default camp is
  a **single background image** at native resolution that the user **drags to pan**
  (image-ground mode); orcs are placed inside the image's walkable **ground** and
  gather at the **station for their status**; multiple same-status orcs **fan out
  by a deterministic, pane-stable slot offset**. (A background without a ground
  polygon falls back to the legacy zone-per-window grid.) Window grouping and pane
  identity
  are preserved spatially.
- **Density & spacing.** Base unit `{spacing.1}` (4px). Dense toolbars use
  `{spacing.1}`, panel interiors `{spacing.2}`, major sections `{spacing.4}`.
- **Cards only for repeated items** (camp cards). Never nest a card in a card;
  page sections are full-width bands or unframed.
- **Stable geometry.** Zones, slots, and sprite boxes hold a fixed aspect ratio
  so status changes, hover, roaming, asset load, and data refresh cause **zero
  layout shift** and never move the scroll position.

## Elevation & Depth

Orc Camp is **flat**: there is no drop-shadow elevation language and no
glassmorphism. Raised surfaces are expressed by `surfaceRaised` + a 1px
`border`, not by shadow.

The **only** real depth model is the camp map's painter's-order **z-layer
stack** (SPEC-301 §2.7), back to front:

```
background → terrain/ground → zone header + station props → terminated (edge,
static) → active sprites (sorted by ground-y) → status overlay icon →
status label + raw tmux target → selection/hover marker → activity speech bubble
```

The invariant: **information always sits above decoration**. Station props are
ground-layer; status labels, raw targets, and overlays always render above the
sprite so the metaphor can never occlude operational truth. A single
`shadow-pixel` token (a hard 2px offset) is allowed only to ground a sprite on
terrain — never to fake panel elevation.

## Shapes

- **Pixel-first geometry.** Pixel panels use `{rounded.pixel}` (4px) or square
  corners; cards cap at `{rounded.card}` (8px). No pill/fully-round chrome.
- **Crisp rendering.** Sprites and pixel art render with `image-rendering:
  pixelated`; never bilinear-smoothed.
- **Fixed sprite boxes.** A sprite's box is its manifest `frame_size` ×
  `orcSprite.scale` (0.20), applied **identically to the loaded asset and the
  CSS placeholder** so asset presence never shifts layout. Aspect ratio is
  always preserved (uniform scale only — never non-uniform squish).
- **Shape as a status channel.** The status-badge **chip border-style** is a
  non-color encoding: `solid` (active/waiting/idle), `dashed` (stale), `double`
  (error), `dotted` (unknown/terminated). Shape distinguishes states without
  relying on hue.

## Components

| Component | Role | Key behavior / tokens |
| --- | --- | --- |
| **Camp Card** | one tmux session in the list | session name, `sessionId`, window/pane/orc counts, active/waiting/error/stale counts (icon+label+number), last activity. `components.campCard`. |
| **Status Summary Bar** | global roll-up on the first screen | sum of all camps' status counts; "where is work stuck" at a glance. |
| **Orc Sprite** | one agent session, on the map | agentType → character; status → animation; **roams** to its status station on change; 8-direction walk; reduced-motion → static frame. `components.orcSprite`. |
| **Camp Map + Station Layer** | the operating surface | zone-per-window, station-per-status, slot-per-pane; single shared animation clock; zero layout shift. `components.campMap`. |
| **Status Badge** | a status anywhere | `[icon][label][confidence/estimated affix]`; color secondary; chip border-style channel. `components.statusBadge`. |
| **Orc Inspector** | selected orc detail | agentType+confidence, raw `tmuxTarget`+`paneId`, cwd, command, status+confidence, work summary (+source, estimated marker), terminal preview, control entry points. |
| **Terminal Preview** | redacted output tail | exposure toggle + line-count; shows `redacted`/`truncated` badges; renders backend-redacted text only (no client re-redaction); text is selectable/copyable. `components.terminalPreview`. |
| **Command Dock** | **manage** a selected orc | text input → send (with `expected` target), allowlisted key buttons, interrupt; disabled when terminated/stale/disconnected/no-token; pessimistic flow. `components.commandDock`. |
| **Confirm Modal** | destructive confirm (interrupt) | focus-trapped, **initial focus on Cancel**, Escape cancels, shows the agent/target/cwd it will act on. `components.confirmModal`. |
| **Activity Bubble** | an orc's current work | `currentWorkSummary` (+source, estimated marker) on hover/focus/select; never occludes label/target. |
| **Toasts** | control outcome | success / aborted (target changed → refresh) / failed, mapped from API result codes. |
| **Activity Rail** | event history | scan, status change, control result, tmux error — newest first. |
| **Settings Panel** | preferences | scan interval, preview exposure + line-count, redaction (floor-locked), aliases, asset pack (SPEC-500). |

## Do's and Don'ts

**Do**

- ✅ Open on an **operational** camp list + status summary.
- ✅ Encode every status with **icon + label + shape**, with color as a bonus;
  it must survive grayscale.
- ✅ Keep the **raw `tmuxTarget`, status label, and controls always visible** —
  the dots are an overlay on the truth, not a substitute.
- ✅ Show **confidence** with inferred status and an **estimated marker** on
  auto-derived summaries.
- ✅ Make destructive actions (**interrupt**, send-key) **explicit**: clear
  label, clear target, ≥ 44px hit area, and a confirm modal for interrupt.
- ✅ Honor `prefers-reduced-motion` (freeze sprites to the fallback frame) and
  keep **zero layout shift** on every data refresh.
- ✅ Keep all UI reachable by **keyboard** (per-zone roving tabindex on the map);
  give every icon button an accessible name.
- ✅ Reference design **tokens** (CSS variables), never raw hex/px literals.

**Don't**

- ❌ Don't ship a marketing landing page or hero as the first screen.
- ❌ Don't convey status by **color alone**.
- ❌ Don't let the pixel concept **hide** real state, raw tmux targets, or
  controls.
- ❌ Don't disguise destructive actions as cute/decorative buttons, or
  auto-focus the confirm button.
- ❌ Don't assert a status the system isn't sure of, or present an estimated
  summary as fact.
- ❌ Don't auto-save or transmit terminal output; don't render un-redacted text.
- ❌ Don't add server-side coordinates for the map — position stays a pure
  client function of existing fields.
- ❌ Don't use purple/blue SaaS gradients, drop-shadow elevation, nested cards,
  hero-scale type, or non-zero letter-spacing.
- ❌ Don't reuse third-party game IP (named characters, faction emblems,
  recognizable weapons/armor/faces) in assets or prompts.
