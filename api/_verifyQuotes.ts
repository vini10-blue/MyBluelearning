import type { SourceChunk } from './_sources.js';

/**
 * Mechanical citation verification.
 *
 * The model is asked to copy a verbatim quote from the chunk it cites. This
 * module then checks that the quote is actually there, and *the server* sets
 * the `quoteFound` flag. The model never sets it.
 *
 * The flag is named for what it measures. It was called `verified`, which
 * overclaimed: locating a string proves the string exists, not that it supports
 * the claim printed above it.
 *
 * Why this matters more than it looks: the dangerous artifact is not an uncited
 * claim — those are obvious and the guard drops them. It is a citation carrying
 * a real SAP Help URL and a fabricated quote, because it reads as already
 * checked. Anything that lets the model assert its own verification reproduces
 * exactly that failure, so verification has to be something the model cannot
 * influence except by actually copying the source.
 *
 * The check is deliberately strict: an exact substring match after
 * normalisation. A paraphrase is not a quote, and accepting "close enough"
 * would hand back the guarantee the flag exists to provide.
 */

export type VerificationFailure =
  | 'source_not_found'
  | 'quote_too_short'
  | 'quote_not_in_source';

export interface VerificationResult {
  quoteFound: boolean;
  /** Why the lookup failed, for reporting at ingest. Absent when found. */
  reason?: VerificationFailure;
  /** The chunk the quote was found in — supplies the authoritative locator/url. */
  chunk?: SourceChunk;
}

/**
 * Minimum quote length, in normalised characters.
 *
 * Without a floor, a model could "verify" anything by quoting a single common
 * word: "EWM" appears in every chunk, so it would match, and the citation would
 * be marked found while supporting nothing. The floor is what makes a located
 * quote evidence rather than a formality.
 */
const MIN_QUOTE_CHARS = 40;

/**
 * Normalise text for comparison.
 *
 * Handles the differences that are artifacts of copying rather than of meaning:
 * HTML and PDF extraction produce curly quotes, non-breaking spaces, soft
 * hyphens and ragged whitespace, and a model re-emitting a passage will
 * frequently regularise them. None of those change what the source says.
 * Case is folded for the same reason. Nothing else is loosened.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    // Curly quotes and apostrophes -> ASCII.
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    // Dashes of every width -> hyphen.
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    // Soft hyphens and zero-width characters vanish entirely.
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')
    // Every run of whitespace, including non-breaking, becomes one space.
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Check one claimed quote against the chunks of the source it names.
 *
 * `sourceId` scopes the search: a quote must be found in the document it claims
 * to come from. Finding it in some *other* source is not a pass — the citation
 * would then point the reader at a page that does not contain the text.
 */
export function verifyQuote(
  claimedSourceId: string,
  quote: string,
  chunks: readonly SourceChunk[],
): VerificationResult {
  const candidates = chunks.filter((c) => c.sourceId === claimedSourceId);
  if (candidates.length === 0) {
    return { quoteFound: false, reason: 'source_not_found' };
  }

  const needle = normalizeForMatch(quote);
  if (needle.length < MIN_QUOTE_CHARS) {
    return { quoteFound: false, reason: 'quote_too_short' };
  }

  for (const chunk of candidates) {
    if (normalizeForMatch(chunk.text).includes(needle)) {
      return { quoteFound: true, chunk };
    }
  }

  return { quoteFound: false, reason: 'quote_not_in_source' };
}

export interface ClaimedCitation {
  sourceId: string;
  sourceTitle: string;
  locator: string;
  url?: string;
  quote: string;
}

export interface SettledCitation extends ClaimedCitation {
  quoteFound: boolean;
}

/**
 * Settle every citation on a generated object.
 *
 * On a located quote the chunk's own `locator` and `url` overwrite whatever
 * the model supplied. The model is a reliable copier of text and an unreliable
 * source of metadata — a plausible-looking page number it invented would send
 * the reader to the wrong place while the quote itself checked out.
 */
export function settleCitations(
  claimed: readonly ClaimedCitation[],
  chunks: readonly SourceChunk[],
): { citations: SettledCitation[]; failures: VerificationFailure[] } {
  const citations: SettledCitation[] = [];
  const failures: VerificationFailure[] = [];

  for (const c of claimed) {
    const result = verifyQuote(c.sourceId, c.quote, chunks);
    if (result.quoteFound && result.chunk) {
      citations.push({
        ...c,
        locator: result.chunk.locator,
        url: result.chunk.url,
        quoteFound: true,
      });
    } else {
      if (result.reason) failures.push(result.reason);
      citations.push({ ...c, quoteFound: false });
    }
  }

  return { citations, failures };
}

/* ─────────────────────── literal token verification ─────────────────────── */

export interface ClaimedToken {
  value: string;
  sourceId?: string;
}

export interface SettledToken {
  value: string;
  foundInSource: boolean;
  citation?: SettledCitation;
}

/**
 * Check a literal token — a transaction code, an IMG path, a table or object
 * name — against the source.
 *
 * This is a stronger test than the prose quote match, and for a while it was
 * the one the codebase did not do at all. A T-code is a literal string, so
 * "does this exact token occur in the document" answers the question directly,
 * with none of the paraphrase ambiguity that makes quote matching approximate.
 *
 * It also guards the highest-risk content in the app. A model produces
 * plausible, well-formed, entirely fictional transaction codes readily, and an
 * invented T-code inside a spaced-repetition schedule is drilled until it feels
 * true. Everything else the guard does matters less than this.
 *
 * IMG and menu paths are normalised on their arrow separators, because the same
 * path is written with `->`, `→` and `>` across SAP's own documentation and a
 * learner searching for it will not care which.
 */
export function normalizeToken(s: string): string {
  return normalizeForMatch(s)
    .replace(/\s*(->|=>|>|\u2192|\u00bb)\s*/g, ' > ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function verifyToken(
  token: string,
  chunks: readonly SourceChunk[],
  claimedSourceId?: string,
): { foundInSource: boolean; chunk?: SourceChunk } {
  const needle = normalizeToken(token);
  // A one- or two-character "token" would match almost anything.
  if (needle.length < 3) return { foundInSource: false };

  const candidates = claimedSourceId
    ? chunks.filter((c) => c.sourceId === claimedSourceId)
    : chunks;

  for (const chunk of candidates) {
    if (normalizeToken(chunk.text).includes(needle)) {
      return { foundInSource: true, chunk };
    }
  }
  return { foundInSource: false };
}

/** Settle a list of claimed tokens, dropping nothing — the guard decides that. */
export function settleTokens(
  claimed: readonly ClaimedToken[],
  chunks: readonly SourceChunk[],
  sourceTitle: string,
): SettledToken[] {
  return claimed.map((t) => {
    const { foundInSource, chunk } = verifyToken(t.value, chunks, t.sourceId);
    if (!foundInSource || !chunk) return { value: t.value, foundInSource: false };
    return {
      value: t.value,
      foundInSource: true,
      citation: {
        sourceId: chunk.sourceId,
        sourceTitle,
        locator: chunk.locator,
        url: chunk.url,
        quote: t.value,
        quoteFound: true,
      },
    };
  });
}
