/**
 * SPEC-001 §3.3 — human-readable table rendering (renders the column contract that
 * SPEC-005 §2.8 owns: TARGET → AGENT → STATUS → SUMMARY → CMD → CWD → ACTIVITY).
 *
 * Rules enforced here:
 *  - status is ALWAYS shown with its confidence (never asserted as fact, R-ORC-005);
 *  - estimated summaries get a `~ ` marker; user_label summaries do not;
 *  - the raw tmuxTarget is always exposed (R-UI-007);
 *  - status is shown as a text label, color is supplementary (accessibility / --no-color);
 *  - empty/no-agent states render four distinct human messages (R-TMUX-006).
 *
 * Input is already redacted (SPEC-006 chokepoint); this renderer never reads raw buffers.
 */
import { type Camp, type Orc, type OrcStatus, type ScanResult } from '../types';

export interface TableOptions {
  color: boolean;
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

const STATUS_COLOR: Record<OrcStatus, keyof typeof ANSI> = {
  active: 'green',
  waiting: 'yellow',
  idle: 'gray',
  stale: 'gray',
  error: 'red',
  unknown: 'dim',
  terminated: 'red',
};

function colorize(text: string, color: keyof typeof ANSI, enabled: boolean): string {
  if (!enabled) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

function conf(n: number): string {
  return n.toFixed(2);
}

function timeOf(iso: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? m[1]! : iso;
}

const HEADERS = ['TARGET', 'AGENT', 'STATUS', 'SUMMARY', 'CMD', 'CWD', 'ACTIVITY'] as const;

function orcRow(orc: Orc): string[] {
  const summaryText = orc.currentWorkSummary ?? '-';
  const summary = orc.summaryIsEstimated && orc.currentWorkSummary !== null ? `~ ${summaryText}` : summaryText;
  return [
    `${orc.tmuxTarget} ${orc.paneId}`,
    `${orc.agentType} ${conf(orc.agentTypeConfidence)}`,
    `${orc.status} ${conf(orc.statusConfidence)}`,
    summary,
    orc.command,
    orc.cwd,
    timeOf(orc.lastActivityAt),
  ];
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Render the orc table for one camp (column-aligned). */
function renderCampOrcs(camp: Camp, color: boolean): string[] {
  const rows = camp.orcs.map(orcRow);
  const widths = HEADERS.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const lines: string[] = [];
  lines.push('  ' + HEADERS.map((h, i) => pad(h, widths[i]!)).join('  '));
  camp.orcs.forEach((orc, ri) => {
    const cells = rows[ri]!.map((c, i) => pad(c, widths[i]!));
    // Colorize the STATUS cell (index 2) value while keeping the text label.
    if (color) cells[2] = colorize(cells[2]!, STATUS_COLOR[orc.status], true);
    lines.push('  ' + cells.join('  '));
  });
  return lines;
}

function tmuxHeader(result: ScanResult, color: boolean): string {
  const t = result.tmux;
  const parts: string[] = [];
  parts.push(t.installed ? 'installed' : 'not installed');
  if (t.installed) parts.push(t.serverRunning ? 'server running' : 'server not running');
  if (t.version) parts.push(`v${t.version}`);
  parts.push(`scanned ${timeOf(result.scannedAt)}`);
  let line = `tmux: ${parts.join(' · ')}`;
  if (result.stale) {
    const badge = `[stale${result.lastGoodAt ? ` · last good ${timeOf(result.lastGoodAt)}` : ''}]`;
    line += ' ' + colorize(badge, 'yellow', color);
  }
  return line;
}

/** Distinct empty-state message (R-TMUX-006). Returns null when camps exist. */
function emptyStateMessage(result: ScanResult): string | null {
  if (result.camps.length > 0) return null;
  if (!result.tmux.installed) {
    return 'tmux is not installed. Install tmux to discover camps.\n(no camps)';
  }
  if (!result.tmux.serverRunning) {
    return 'tmux is installed but no server is running. Start a tmux session to create camps.\n(no camps)';
  }
  return 'tmux is running but has no sessions. Create a tmux session to make a camp.\n(no camps)';
}

export function renderTable(result: ScanResult, opts: TableOptions): string {
  const color = opts.color;
  const out: string[] = [];
  out.push(tmuxHeader(result, color));

  const empty = emptyStateMessage(result);
  if (empty !== null) {
    out.push('');
    out.push(empty);
    return out.join('\n');
  }

  let anyOrc = false;
  for (const camp of result.camps) {
    out.push('');
    const head = colorize(`CAMP ${camp.tmuxSessionName}`, 'bold', color);
    const meta =
      `session "${camp.tmuxSessionName}" · ${camp.windowCount} win · ${camp.paneCount} pane · ` +
      `${camp.orcCount} orcs · last ${camp.lastActivityAt ? timeOf(camp.lastActivityAt) : '-'}`;
    out.push(`${head}   ${colorize(meta, 'dim', color)}`);
    if (camp.orcCount === 0) {
      out.push('  (no agents detected)');
      continue;
    }
    anyOrc = true;
    out.push(...renderCampOrcs(camp, color));
  }

  if (anyOrc) {
    out.push('');
    out.push(
      colorize(
        'legend: ~ = estimated summary · AGENT/STATUS trailing number = confidence (0–1) · TARGET = tmuxTarget + paneId',
        'dim',
        color,
      ),
    );
  }
  return out.join('\n');
}
