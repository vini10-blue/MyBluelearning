/**
 * In-memory sliding-window rate limiter for /api/extract.
 *
 * State lives in module scope, so it persists across invocations on a warm
 * Vercel instance and resets on cold start. That is acceptable here: the app
 * is single-user, a cold-start reset only ever loosens the limit briefly,
 * and the ID-token auth check already blocks anonymous traffic. This limiter
 * is the second line of defence — it caps Anthropic spend if a signed-in
 * token is ever stolen or abused.
 *
 * Files in api/ whose name starts with `_` are not treated as routes.
 */

interface RateWindow {
  ms: number;
  max: number;
}

const WINDOWS: readonly RateWindow[] = [
  { ms: 10 * 60_000, max: 60 }, // burst: 60 ingest calls / 10 min
  { ms: 24 * 60 * 60_000, max: 500 }, // sustained: 500 ingest calls / day
];
const LONGEST = Math.max(...WINDOWS.map((w) => w.ms));

const hits = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
}

/** Record a hit for `key` and report whether it is within limits. */
export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < LONGEST);

  for (const w of WINDOWS) {
    const inWindow = recent.filter((t) => now - t < w.ms);
    if (inWindow.length >= w.max) {
      const oldest = Math.min(...inWindow);
      return { ok: false, retryAfterSec: Math.ceil((w.ms - (now - oldest)) / 1000) };
    }
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic cleanup so the Map cannot grow unbounded.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= LONGEST)) hits.delete(k);
    }
  }
  return { ok: true };
}
