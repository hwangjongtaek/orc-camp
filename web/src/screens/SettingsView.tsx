/**
 * SPEC-500 (consumer) — local settings panel. Reads/writes scanInterval + preview
 * exposure/lineCount via GET/PATCH /api/settings. Validation errors (422) are surfaced.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../app/services';
import { useStore } from '../store/store';

export function SettingsView(): JSX.Element {
  const { api } = useServices();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings === null) {
      void api.getSettings().then((res) => {
        if (res.ok) setSettings(res.data);
      });
    }
  }, [settings, api, setSettings]);

  const patch = (body: Record<string, unknown>): void => {
    setSaving(true);
    setError(null);
    void api.patchSettings(body).then((res) => {
      setSaving(false);
      if (res.ok) {
        setSettings(res.data);
      } else {
        setError(res.error.message);
      }
    });
  };

  if (settings === null) {
    return (
      <div className="oc-state" role="status">
        <div className="oc-spinner" aria-hidden="true" />
        <div>Loading settings…</div>
      </div>
    );
  }

  const { scanInterval, preview, bounds } = settings;

  return (
    <div>
      <h1 style={{ marginBottom: 'var(--oc-space-3)' }}>Settings</h1>
      {error && (
        <div className="oc-banner oc-banner--error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <div className="oc-form">
        <div className="oc-form__row">
          <label htmlFor="scanInterval">
            Scan interval (seconds) — {bounds.scanInterval.min}–{bounds.scanInterval.max}
          </label>
          <input
            id="scanInterval"
            type="number"
            min={bounds.scanInterval.min}
            max={bounds.scanInterval.max}
            value={scanInterval}
            disabled={saving}
            onChange={(e) => patch({ scanInterval: Number(e.target.value) })}
          />
        </div>

        <div className="oc-form__row">
          <label>
            <input
              type="checkbox"
              checked={preview.exposureEnabled}
              disabled={saving}
              onChange={(e) => patch({ preview: { exposureEnabled: e.target.checked } })}
            />{' '}
            Expose terminal preview text
          </label>
          <span className="oc-muted" style={{ fontSize: '12px' }}>
            When off, preview text is never requested or shown (only metadata badges).
          </span>
        </div>

        <div className="oc-form__row">
          <label htmlFor="lineCount">
            Preview line count — {bounds.previewLineCount.min}–{bounds.previewLineCount.max}
          </label>
          <input
            id="lineCount"
            type="number"
            min={bounds.previewLineCount.min}
            max={bounds.previewLineCount.max}
            value={preview.lineCount}
            disabled={saving || !preview.exposureEnabled}
            onChange={(e) => patch({ preview: { lineCount: Number(e.target.value) } })}
          />
        </div>

        <p className="oc-muted" style={{ fontSize: '12px' }}>
          Redaction is always on (floor-locked) and cannot be disabled.
        </p>
      </div>
    </div>
  );
}
