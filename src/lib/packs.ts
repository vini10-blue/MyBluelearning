import { SEED_PACK } from '../content/seedPack';
import type { Citation, CoursePack } from './types';

/**
 * Course-pack access.
 *
 * Today this serves the bundled development fixture. Once the ingest pipeline
 * is reachable, packs are read from OneDrive via the ported Graph file helpers
 * and cached locally for offline study — this module is the seam that change
 * lands on, so screens never talk to storage directly.
 */

export function listPacks(): CoursePack[] {
  return [SEED_PACK];
}

export function getPack(packId: string | undefined): CoursePack | null {
  if (!packId) return null;
  return listPacks().find((p) => p.id === packId) ?? null;
}

/** Every citation attached to anything in the pack, sourced or supporting. */
export function allCitations(pack: CoursePack): Citation[] {
  const { nodes, edges, failureModes } = pack.process;
  return [
    ...nodes.flatMap((n) => [
      ...n.what.citations,
      ...n.why.basedOn,
      ...n.breaksIf.basedOn,
      ...n.tcodes.flatMap((t) => (t.citation ? [t.citation] : [])),
      ...(n.configPath?.citation ? [n.configPath.citation] : []),
    ]),
    ...edges.flatMap((e) => e.label.citations),
    ...failureModes.flatMap((f) => [
      ...f.symptom.citations,
      ...f.cause.basedOn,
      ...f.resolution.citations,
    ]),
    ...pack.items.flatMap((i) => i.basedOn),
  ];
}

export interface PackStanding {
  /** Claims the pack presents as coming from the documentation. */
  sourcedClaims: number;
  /** How many of those rest on a quote located in the source. */
  sourcedClaimsWithFoundQuote: number;
  /** Passages of Claude's reasoning — the `why` and `breaksIf` fields. */
  synthesisCount: number;
  /** Sources whose text was not fetched from their stated origin. */
  provenanceNotes: string[];
}

/**
 * What the learner should know about this pack before trusting it.
 *
 * Deliberately reports two different things rather than one percentage. A
 * single "87% verified" number would be the same overclaim the old `verified`
 * flag made: it would fold together "the documentation says this" and "Claude
 * reasoned this from the documentation", which are not the same kind of
 * content and should not average into one score.
 */
export function packStanding(pack: CoursePack): PackStanding {
  const { nodes, edges, failureModes } = pack.process;

  const sourced = [
    ...nodes.map((n) => n.what),
    ...edges.map((e) => e.label),
    ...failureModes.flatMap((f) => [f.symptom, f.resolution]),
  ];

  const synthesis = [
    ...nodes.flatMap((n) => [n.why, n.breaksIf]),
    ...failureModes.map((f) => f.cause),
  ];

  return {
    sourcedClaims: sourced.length,
    sourcedClaimsWithFoundQuote: sourced.filter((c) =>
      c.citations.some((cit) => cit.quoteFound),
    ).length,
    synthesisCount: synthesis.length,
    provenanceNotes: pack.sources
      .map((s) => s.provenanceNote)
      .filter((n): n is string => Boolean(n)),
  };
}
