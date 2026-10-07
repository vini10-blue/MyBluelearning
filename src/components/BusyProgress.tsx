import { useEffect, useState } from 'react';

/**
 * Elapsed time, an estimated percentage, and a bar — for a single long server
 * call that reports no progress of its own.
 *
 * The percentage is elapsed ÷ expected, where expected is the last run's
 * duration. It is capped at 95% so the bar never claims to be finished before
 * the response arrives, and it keeps creeping after the estimate is spent so
 * a slow run still looks alive rather than stuck.
 */
export function BusyProgress({
  title,
  detail,
  expectedMs,
}: {
  title: string;
  detail: string;
  expectedMs: number;
}) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = now - startedAt;
  const pct = estimatePercent(elapsedMs, expectedMs);
  const overrun = elapsedMs > expectedMs;

  return (
    <div className="mt-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-sm tabular-nums text-slate-700" aria-live="polite">
          ~{pct}%
        </p>
      </div>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className="h-full rounded-full bg-slate-900 transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span className="tabular-nums">{formatClock(elapsedMs)} elapsed</span>
        <span className="tabular-nums">
          {overrun ? 'longer than last time — still working' : `last run ≈ ${formatClock(expectedMs)}`}
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

/**
 * Linear to 90% over the expected time, then asymptotic toward 95%. Exported
 * so the shape can be checked without rendering.
 */
export function estimatePercent(elapsedMs: number, expectedMs: number): number {
  if (expectedMs <= 0) return 0;
  const ratio = elapsedMs / expectedMs;
  if (ratio <= 1) return Math.floor(ratio * 90);
  // Each additional "expected" interval closes half the remaining gap to 95.
  const extra = ratio - 1;
  return Math.floor(95 - 5 / (1 + extra));
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
