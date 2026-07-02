/**
 * SPEC-401 §2.4/§2.7 + SPEC-203 §2.5/§2.6 — client-side keyboard routing for the terminal
 * viewport (the testable brain). `routeKey` maps a keyboard event to exactly one action:
 *
 *  - control shortcuts that ALWAYS win over the terminal (disarm, quick-switch, digit-jump);
 *  - observe-mode rail nav ([ / ]) when NOT armed;
 *  - armed egress: named allowlist keys (/key), printable literals (/input literal), the C-c
 *    interrupt CONFIRM route (never raw passthrough), and destructive chords that are BLOCKED
 *    (never egress — PASSTHROUGH_FORBIDDEN_CHORDS, AC-05/AC-07).
 *
 * Egress never happens without `armed` (Observe = no egress, invariant ③). This module decides;
 * the component performs the effect (arm/disarm calls, sendInput/sendKey passthrough, confirm modal).
 */

// SPEC-401 §2.2 — server value the UI inherits (never its own). Countdown uses the arm response.
export const PASSTHROUGH_IDLE_MS = 240_000;
// SPEC-401 §2.2 — client literal batching hint (≤ MAX_INPUT_BYTES).
export const PASSTHROUGH_LITERAL_BURST_MAX = 256;

/** SPEC-203 §2.6 — dedicated disarm chord (Escape/C-c/Tab are deliberately NOT used). */
export const DISARM_KEY_LABEL = 'Ctrl+Alt+.';

/** SPEC-401 §2.7 — permanently excluded from passthrough (never opened by arming). */
export const PASSTHROUGH_FORBIDDEN_CHORDS = ['C-c', 'C-d', 'C-z', 'C-\\', 'C-q', 'C-s', 'C-]'];

/**
 * SPEC-401 §2.7 — superset of the base KEY_ALLOWLIST, used ONLY for armed passthrough `/key`.
 * Destructive chords are excluded by construction (see PASSTHROUGH_FORBIDDEN_CHORDS).
 */
export const INTERACTIVE_KEY_ALLOWLIST = new Set<string>([
  // base navigation / editing (SPEC-400 §2.4)
  'Enter', 'Tab', 'BTab', 'Escape', 'Space', 'BSpace',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Delete',
  // TUI function keys
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  // readline edit/navigation (non-destructive)
  'C-a', 'C-e', 'C-k', 'C-u', 'C-w', 'C-l', 'C-b', 'C-f', 'C-p', 'C-n', 'C-r',
  // word-wise motion (non-destructive)
  'M-b', 'M-f',
]);

/** Minimal keyboard-event shape (so the router is testable without a real DOM event). */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type KeyRoute =
  | { kind: 'disarm' } // Ctrl+Alt+. — always intercepted before the terminal
  | { kind: 'quick-switch' } // Cmd/Ctrl+K — primary jump (wins over C-k even when armed)
  | { kind: 'digit-jump'; n: number } // Alt+1..9
  | { kind: 'prev' } // [ (observe-mode rail nav only)
  | { kind: 'next' } // ] (observe-mode rail nav only)
  | { kind: 'interrupt' } // C-c → confirm modal → /interrupt (never raw passthrough)
  | { kind: 'blocked'; chord: string } // destructive chord — no egress, notify
  | { kind: 'key'; key: string } // named allowlist key → /key passthrough
  | { kind: 'literal'; text: string } // printable → /input literal passthrough
  | { kind: 'ignore' }; // not handled here (let the browser/host decide)

/** tmux key token for a non-letter named key, or null if it isn't one. */
function namedKeyToken(e: KeyEventLike): string | null {
  switch (e.key) {
    case 'Enter':
      return 'Enter';
    case 'Tab':
      return e.shiftKey ? 'BTab' : 'Tab';
    case 'Escape':
      return 'Escape';
    case 'Backspace':
      return 'BSpace';
    case 'Delete':
      return 'Delete';
    case 'ArrowUp':
      return 'Up';
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case 'Home':
      return 'Home';
    case 'End':
      return 'End';
    case 'PageUp':
      return 'PageUp';
    case 'PageDown':
      return 'PageDown';
    default:
      break;
  }
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return e.key; // F1..F12
  return null;
}

/** tmux chord token for a Ctrl/Alt + letter combo (e.g. 'C-a', 'M-f'), or null. */
function chordToken(e: KeyEventLike): string | null {
  const isLetter = e.key.length === 1 && /[a-zA-Z]/.test(e.key);
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key === '\\') return 'C-\\';
    if (e.key === ']') return 'C-]';
    if (isLetter) return `C-${e.key.toLowerCase()}`;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && isLetter) return `M-${e.key.toLowerCase()}`;
  return null;
}

export function routeKey(e: KeyEventLike, opts: { armed: boolean }): KeyRoute {
  // 1) Disarm — highest priority; must escape the trap even while xterm holds focus (§2.6).
  if (e.ctrlKey && e.altKey && e.key === '.') return { kind: 'disarm' };

  // 2) Quick switcher — Cmd/Ctrl+K, non-printable modifier combo that wins over the terminal (§2.5).
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
    return { kind: 'quick-switch' };
  }

  // 3) Digit jump — Alt+1..9 (unreserved chord; does not clash with browser tab switching, §2.5).
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
    return { kind: 'digit-jump', n: Number(e.key) };
  }

  if (!opts.armed) {
    // Observe mode: no egress. Plain [ / ] navigate the rail (§2.5 S2).
    if (e.key === '[' && !e.ctrlKey && !e.altKey && !e.metaKey) return { kind: 'prev' };
    if (e.key === ']' && !e.ctrlKey && !e.altKey && !e.metaKey) return { kind: 'next' };
    return { kind: 'ignore' };
  }

  // --- armed (Control) egress -----------------------------------------------

  // C-c → interrupt confirm route (never raw passthrough, §2.6/§2.7).
  if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) {
    return { kind: 'interrupt' };
  }

  const chord = chordToken(e);
  if (chord && PASSTHROUGH_FORBIDDEN_CHORDS.includes(chord)) {
    return { kind: 'blocked', chord }; // destructive → no egress (AC-05/AC-07)
  }

  const named = namedKeyToken(e);
  if (named && INTERACTIVE_KEY_ALLOWLIST.has(named)) return { kind: 'key', key: named };
  if (chord && INTERACTIVE_KEY_ALLOWLIST.has(chord)) return { kind: 'key', key: chord };
  if (chord) return { kind: 'blocked', chord }; // ctrl/alt chord not on the allowlist → no egress

  // Printable literal (no ctrl/meta). Space and punctuation included.
  if (!e.ctrlKey && !e.metaKey && e.key.length === 1) return { kind: 'literal', text: e.key };

  return { kind: 'ignore' };
}

/**
 * Literal burst batcher (SPEC-401 §2.8 client responsibility): coalesce printable characters into
 * ≤`PASSTHROUGH_LITERAL_BURST_MAX`-byte bursts to cut request/revalidation count, flushing on a
 * short idle, on the size cap, or when a non-literal event forces an ordered flush.
 */
export interface LiteralBatcher {
  push(text: string): void;
  /** Flush now (e.g. before a named-key egress to preserve ordering, or on unmount). */
  flush(): void;
  dispose(): void;
}

export function createLiteralBatcher(
  sendBurst: (text: string) => void,
  opts: { maxBytes?: number; flushMs?: number; encode?: (s: string) => number } = {},
): LiteralBatcher {
  const maxBytes = opts.maxBytes ?? PASSTHROUGH_LITERAL_BURST_MAX;
  const flushMs = opts.flushMs ?? 16;
  const byteLen = opts.encode ?? ((s: string) => new TextEncoder().encode(s).length);
  let buf = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const flush = (): void => {
    clear();
    if (buf.length === 0) return;
    const out = buf;
    buf = '';
    sendBurst(out);
  };
  const push = (text: string): void => {
    buf += text;
    if (byteLen(buf) >= maxBytes) {
      flush();
      return;
    }
    clear();
    timer = setTimeout(flush, flushMs);
  };
  return { push, flush, dispose: clear };
}
