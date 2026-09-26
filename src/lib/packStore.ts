import { safeSetItem } from './safeStorage';
import { STORAGE_KEYS } from './storageKeys';
import type { CoursePack } from './types';
import { validateCoursePack } from './validateCoursePack';

/**
 * Persistence for ingested course packs.
 *
 * localStorage for now, behind the same seam that OneDrive will sit behind:
 * `packs.ts` merges whatever this module returns with the bundled seed, and no
 * screen reads storage directly. Moving to OneDrive via the ported Graph
 * helpers changes this file and nothing else.
 *
 * Everything loaded is re-validated. A stored pack is untrusted for the same
 * reason a generated one is — it was written by an earlier version of this
 * code, possibly on an older schema — and the guard is cheap. A pack that no
 * longer passes is dropped from the list rather than shown broken; it is still
 * in storage, so nothing is silently destroyed.
 */

function readRaw(): unknown[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.packs);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadStoredPacks(): CoursePack[] {
  const out: CoursePack[] = [];
  for (const raw of readRaw()) {
    const report = validateCoursePack(raw);
    if (report && report.fatal.length === 0) out.push(report.pack);
  }
  return out;
}

/** Insert or replace by id. Returns false if storage refused (quota). */
export function savePack(pack: CoursePack): boolean {
  const others = readRaw().filter(
    (p) => !(p && typeof p === 'object' && (p as CoursePack).id === pack.id),
  );
  return safeSetItem(STORAGE_KEYS.packs, JSON.stringify([...others, pack]));
}

export function deletePack(packId: string): void {
  const kept = readRaw().filter(
    (p) => !(p && typeof p === 'object' && (p as CoursePack).id === packId),
  );
  safeSetItem(STORAGE_KEYS.packs, JSON.stringify(kept));
}
