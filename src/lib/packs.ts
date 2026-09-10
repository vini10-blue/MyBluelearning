import { SEED_PACK } from '../content/seedPack';
import type { Citation, CoursePack } from './types';

/**
 * Course-pack access.
 *
 * Today this serves the bundled development fixture. Once the ingest pipeline
 * is reachable, packs are read from OneDrive via the ported Graph file
 * helpers and cached locally for offline study — this module is the seam that
 * change lands on, so screens never talk to storage directly.
 */

export function listPacks(): CoursePack[] {
  return [SEED_PACK];
}

export function getPack(packId: string | undefined): CoursePack | null {
  if (!packId) return null;
  return listPacks().find((p) => p.id === packId) ?? null;
}

/** Every citation attached to anything in the pack. */
export function allCitations(pack: CoursePack): Citation[] {
  return [
    ...pack.process.nodes.flatMap((n) => n.citations),
    ...pack.process.edges.flatMap((e) => e.citations),
    ...pack.process.failureModes.flatMap((f) => f.citations),
    ...pack.items.flatMap((i) => i.citations),
  ];
}

/**
 * How much of a pack rests on unchecked sources.
 *
 * Surfaced prominently rather than buried: a pack that looks complete but is
 * entirely unverified is the most misleading state the app can be in, so the
 * UI says so before the learner invests time in it.
 */
export function verificationStatus(pack: CoursePack): {
  total: number;
  verified: number;
  fullyVerified: boolean;
} {
  const cits = allCitations(pack);
  const verified = cits.filter((c) => c.verified).length;
  return {
    total: cits.length,
    verified,
    fullyVerified: cits.length > 0 && verified === cits.length,
  };
}
