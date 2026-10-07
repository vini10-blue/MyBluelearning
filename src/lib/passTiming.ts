import { safeSetItem } from './safeStorage';

/**
 * How long each ingest pass took last time, so the busy screen can show an
 * honest estimate instead of a spinner. A single model call reports nothing
 * about its own progress — the only thing we know is how long the previous
 * one took on this device — so the estimate is labelled as one and never
 * reaches 100% on its own.
 */
export type PassName = 'process' | 'items';

const KEY = 'mybluelearning:pass-timing';
const DEFAULT_MS: Record<PassName, number> = { process: 180_000, items: 150_000 };

function read(): Partial<Record<PassName, number>> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Partial<Record<PassName, number>> = {};
    for (const k of ['process', 'items'] as const) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function expectedPassMs(pass: PassName): number {
  return read()[pass] ?? DEFAULT_MS[pass];
}

/** Record a completed pass. Blends with the previous value so one outlier doesn't swing the bar. */
export function recordPassMs(pass: PassName, ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const prev = read();
  const blended = prev[pass] ? Math.round(prev[pass] * 0.5 + ms * 0.5) : Math.round(ms);
  safeSetItem(KEY, JSON.stringify({ ...prev, [pass]: blended }));
}
