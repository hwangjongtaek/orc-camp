/**
 * SPEC-402 — command broadcast orchestration.
 *
 * broadcast makes NO new write path. It reuses the SPEC-400 `ControlService`
 * `/input` gate pipeline (schema → controllability → fresh `expected` re-validation
 * → execute → per-action audit) per-orc, SEQUENTIALLY, preserving the per-pane
 * single-writer serialization (D-050, §2.2/§2.5). N≥2 requires a server-forced
 * confirm; results are aggregated best-effort; a single `control.broadcast` batch
 * audit stores aggregate scalars + per-orc {orcId, ok, errorCode} ONLY — never the
 * command text/keys/token (D-051, §2.7, non-storage extension of D-028).
 */
import { redact } from '../redaction/redact';
import type { SnapshotRuntime } from './runtime';
import { CONTROL_BYTE_RE, MAX_INPUT_BYTES, type ControlOutcomeResponse, type ControlService } from './control';
import type { ExpectedTarget } from './passthrough';
import type { ActivitySeverity, NewActivity } from './activity';

/** §2.8 target cap (hypothesis) — after de-dup; bounds blast radius + batch volume. */
export const BROADCAST_MAX_TARGETS = 20;

const ORC_ID_RE = /^pane:%[0-9]+$/;
const EXPECTED_KEYS = new Set(['paneId', 'tmuxTarget', 'command', 'agentType']);

interface BroadcastTarget {
  orcId: string;
  expected: ExpectedTarget;
}
interface ParsedBroadcast {
  text: string;
  submit: boolean;
  targets: BroadcastTarget[];
  confirmed: boolean;
  requestId: string | null;
}
type ParseErr = { code: string; status: number; message: string };

interface PerOrcResult {
  orcId: string;
  paneId: string;
  ok: boolean;
  outcome: 'success' | 'partial' | null;
  errorCode: string | null;
  auditEventId: string | null;
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function validateExpected(v: unknown): ExpectedTarget | null {
  const o = asObject(v);
  if (!o) return null;
  if (Object.keys(o).some((k) => !EXPECTED_KEYS.has(k))) return null;
  if (typeof o.paneId !== 'string' || typeof o.tmuxTarget !== 'string' || typeof o.command !== 'string' || typeof o.agentType !== 'string') return null;
  return { paneId: o.paneId, tmuxTarget: o.tmuxTarget, command: o.command, agentType: o.agentType };
}

const MAX_REQUEST_ID = 128;

export class BroadcastService {
  constructor(
    private readonly runtime: SnapshotRuntime,
    private readonly control: ControlService,
    private readonly now: () => Date = () => new Date(),
    private readonly maxTargets: number = BROADCAST_MAX_TARGETS,
  ) {}

  /** POST /api/camps/:campId/broadcast (§2.1). */
  async handle(campId: string, body: unknown): Promise<ControlOutcomeResponse> {
    // Gate — camp resolution (cold start → 503; unknown camp → 404).
    if (this.runtime.snapshotVersion === 0) return this.err(503, 'snapshot_not_ready', 'snapshot not ready');
    const camp = this.runtime.getCamp(campId);
    if (!camp) return this.err(404, 'camp_not_found', 'camp not found');

    const parsed = this.parse(body);
    if ('code' in parsed) return this.err(parsed.status, parsed.code, parsed.message);

    // §2.4/§2.8 — every target must belong to :campId (structural cross-camp block).
    const campOrcIds = new Set(camp.orcs.map((o) => o.id));
    if (parsed.targets.some((t) => !campOrcIds.has(t.orcId))) {
      return this.err(422, 'out_of_camp_scope', 'target outside camp');
    }

    // §2.8 P1-I — de-dup by orcId (first occurrence wins); count removed duplicates.
    const seen = new Set<string>();
    const unique: BroadcastTarget[] = [];
    for (const t of parsed.targets) {
      if (seen.has(t.orcId)) continue;
      seen.add(t.orcId);
      unique.push(t);
    }
    const duplicatesRemoved = parsed.targets.length - unique.length;

    // §2.8 — cap AFTER de-dup.
    if (unique.length > this.maxTargets) return this.err(422, 'too_many_targets', 'too many targets');
    // §2.3 — N≥2 requires a server-forced confirm (all targets listed by the UI).
    if (unique.length >= 2 && !parsed.confirmed) return this.err(422, 'confirm_required', 'broadcast requires confirmed:true');

    // §2.5 — per-orc SEQUENTIAL; each reuses the SPEC-400 /input gate pipeline
    // (fresh expected re-validation + per-pane single-writer + per-action audit).
    const results: PerOrcResult[] = [];
    for (const t of unique) {
      const paneId = t.orcId.slice('pane:'.length);
      const inputBody = { text: parsed.text, submit: parsed.submit, expected: t.expected };
      const r = await this.control.handle('input', t.orcId, inputBody);
      results.push(this.mapResult(t.orcId, paneId, r));
    }

    const successCount = results.filter((r) => r.ok).length;
    const failureCount = results.length - successCount;
    const audit = this.runtime.recordActivity(this.batchAudit(campId, parsed, results, successCount, failureCount));

    return {
      status: 200,
      body: {
        ok: true,
        campId,
        targetCount: results.length,
        successCount,
        failureCount,
        ...(duplicatesRemoved > 0 ? { duplicatesRemoved } : {}),
        results,
        batchAuditEventId: audit.id,
        requestId: parsed.requestId,
      },
    };
  }

  private parse(body: unknown): ParsedBroadcast | ParseErr {
    const o = asObject(body);
    if (!o) return { code: 'validation_error', status: 422, message: 'body must be an object' };
    const allowed = new Set(['input', 'targets', 'confirmed', 'requestId']);
    if (Object.keys(o).some((k) => !allowed.has(k))) return { code: 'validation_error', status: 422, message: 'unknown field' };

    // input { text, submit? } — inherits SPEC-400 §2.2/§2.3.1 text constraints.
    const input = asObject(o.input);
    if (!input) return { code: 'validation_error', status: 422, message: 'input must be an object' };
    if (Object.keys(input).some((k) => k !== 'text' && k !== 'submit')) return { code: 'validation_error', status: 422, message: 'unknown input field' };
    if (typeof input.text !== 'string') return { code: 'validation_error', status: 422, message: 'input.text must be a string' };
    if (Buffer.byteLength(input.text, 'utf8') > MAX_INPUT_BYTES) return { code: 'validation_error', status: 422, message: 'text too long' };
    if (CONTROL_BYTE_RE.test(input.text)) return { code: 'control_char_not_allowed', status: 422, message: 'text contains control bytes' };
    if (input.submit !== undefined && typeof input.submit !== 'boolean') return { code: 'validation_error', status: 422, message: 'submit must be a boolean' };

    // targets [{ orcId, expected }]
    if (!Array.isArray(o.targets) || o.targets.length === 0) return { code: 'validation_error', status: 422, message: 'targets must be a non-empty array' };
    const targets: BroadcastTarget[] = [];
    for (const raw of o.targets) {
      const t = asObject(raw);
      if (!t || Object.keys(t).some((k) => k !== 'orcId' && k !== 'expected')) return { code: 'validation_error', status: 422, message: 'invalid target shape' };
      if (typeof t.orcId !== 'string' || !ORC_ID_RE.test(t.orcId)) return { code: 'validation_error', status: 422, message: 'invalid target orcId' };
      const expected = validateExpected(t.expected);
      if (!expected) return { code: 'validation_error', status: 422, message: 'invalid target expected' };
      // expected.paneId must be the orcId's pane (the ControlService re-checks too).
      if (expected.paneId !== t.orcId.slice('pane:'.length)) return { code: 'validation_error', status: 422, message: 'expected.paneId mismatch' };
      targets.push({ orcId: t.orcId, expected });
    }

    if (o.confirmed !== undefined && typeof o.confirmed !== 'boolean') return { code: 'validation_error', status: 422, message: 'confirmed must be a boolean' };
    const requestId = typeof o.requestId === 'string' && o.requestId.length <= MAX_REQUEST_ID ? o.requestId : null;

    return { text: input.text, submit: input.submit !== false, targets, confirmed: o.confirmed === true, requestId };
  }

  /** Map a per-orc ControlService response → aggregated per-orc result. */
  private mapResult(orcId: string, paneId: string, r: ControlOutcomeResponse): PerOrcResult {
    const b = r.body as Record<string, unknown>;
    const ok = b.ok === true;
    const err = asObject(b.error);
    return {
      orcId,
      paneId,
      ok,
      outcome: ok ? ((b.outcome as 'success' | 'partial' | undefined) ?? null) : null,
      errorCode: ok ? null : (typeof err?.code === 'string' ? err.code : 'unknown'),
      auditEventId: typeof b.auditEventId === 'string' ? b.auditEventId : null,
    };
  }

  private batchAudit(campId: string, parsed: ParsedBroadcast, results: PerOrcResult[], successCount: number, failureCount: number): NewActivity {
    const severity: ActivitySeverity = failureCount === 0 ? 'info' : failureCount === results.length ? 'error' : 'warn';
    return {
      type: 'control.result',
      severity,
      code: 'control.broadcast',
      target: { campId },
      message: `control broadcast ${successCount}/${results.length} ok`,
      detail: {
        action: 'broadcast',
        targetCount: results.length,
        successCount,
        failureCount,
        inputByteLength: Buffer.byteLength(parsed.text, 'utf8'),
        inputRedactedFlag: redact(parsed.text).redacted,
        perOrc: results.map((r) => ({ orcId: r.orcId, ok: r.ok, errorCode: r.errorCode })),
        ...(parsed.requestId ? { correlationId: parsed.requestId } : {}),
      },
    };
  }

  private err(status: number, code: string, message: string): ControlOutcomeResponse {
    return { status, body: { ok: false, error: { code, message } } };
  }
}
