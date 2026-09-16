import { safeSetItem } from './safeStorage';
import { STORAGE_KEYS } from './storageKeys';
import type { ContentFlag } from './types';

/**
 * The learner marking generated content as wrong.
 *
 * This is the only accuracy mechanism in the app that reaches the things no
 * check can: whether a `why` is sound, and whether an answer key is right.
 * Quotes are verified automatically and literal tokens are matched
 * character-by-character, but `correctIndices` is model judgement and nothing
 * mechanical can test it. Vini is an SAP consultant — on any of those questions
 * he outranks every heuristic in this codebase.
 *
 * Flags live separately from packs on purpose. A pack is generated content and
 * will be regenerated; a flag is his judgement about it and must survive that.
 * Keying by (packId, targetId) rather than by array position means a
 * regenerated pack keeps the verdicts on every node whose id is unchanged.
 *
 * Stored in localStorage for now. The same keying moves to OneDrive unchanged
 * when pack storage does — see src/lib/packs.ts.
 */

function readAll(): ContentFlag[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.contentFlags);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Trust boundary: this was written by an earlier version of the app and may
    // predate a schema change.
    return parsed.filter(
      (f): f is ContentFlag =>
        Boolean(f) &&
        typeof f === 'object' &&
        typeof (f as ContentFlag).targetId === 'string' &&
        typeof (f as ContentFlag).packId === 'string',
    );
  } catch {
    return [];
  }
}

function writeAll(flags: ContentFlag[]): void {
  safeSetItem(STORAGE_KEYS.contentFlags, JSON.stringify(flags));
}

export function flagsForPack(packId: string): ContentFlag[] {
  return readAll().filter((f) => f.packId === packId);
}

export function isFlagged(packId: string, targetId: string): ContentFlag | undefined {
  return readAll().find((f) => f.packId === packId && f.targetId === targetId);
}

export function flagContent(
  packId: string,
  targetId: string,
  targetKind: ContentFlag['targetKind'],
  reason: string,
): void {
  const flags = readAll().filter((f) => !(f.packId === packId && f.targetId === targetId));
  flags.push({
    packId,
    targetId,
    targetKind,
    reason: reason.trim(),
    flaggedAt: new Date().toISOString(),
  });
  writeAll(flags);
}

export function unflagContent(packId: string, targetId: string): void {
  writeAll(readAll().filter((f) => !(f.packId === packId && f.targetId === targetId)));
}

/**
 * Flagged content is suppressed, not merely annotated.
 *
 * Leaving a known-wrong node visible with a warning on it would be the same
 * mistake as the old "unverified" badge: it puts the burden back on the reader
 * to remember, every time, that this particular thing is untrue. If he has
 * judged it wrong, it stops teaching.
 */
export function rejectFlagged<T extends { id: string }>(packId: string, list: T[]): T[] {
  const flagged = new Set(flagsForPack(packId).map((f) => f.targetId));
  return list.filter((x) => !flagged.has(x.id));
}
