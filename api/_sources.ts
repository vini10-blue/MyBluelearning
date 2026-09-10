/**
 * Source adapters for the ingest pipeline.
 *
 * Every adapter turns a source reference into `SourceChunk[]`. A chunk is the
 * unit a citation points at, so its `locator` has to be something a human can
 * act on — a page number, a section heading — and its `url` has to land the
 * reader on the passage, not merely on the right document.
 *
 * `help.sap.com` is blocked by the development environment's network egress
 * proxy, so the SAP adapters cannot be exercised locally. That is the whole
 * reason this lives behind an interface with a fixture mode: everything
 * downstream (chunking contract, quote verification, generation, validation)
 * stays testable offline, and only the fetch itself needs a preview deploy to
 * verify.
 */

export type SourceKind = 'sap-help-pdf' | 'sap-help-page' | 'user-pdf';

export interface SourceChunk {
  /** Id of the SourceDocument this chunk belongs to. */
  sourceId: string;
  /** Human-readable position, e.g. "p. 412" or a section heading. */
  locator: string;
  /** Deep link to this passage, when the source supports one. */
  url?: string;
  /** The chunk's text. Quote verification matches against exactly this. */
  text: string;
}

export interface SourceRef {
  kind: SourceKind;
  /** URL for Help Portal sources; filename for uploads. */
  origin: string;
  title: string;
  /** base64 payload, for `user-pdf` only. */
  dataBase64?: string;
}

export class SourceError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Only SAP's own documentation host is fetchable. This is an SSRF guard, not a
 * convenience check: the origin arrives from the client, and without an
 * allowlist this endpoint would fetch arbitrary URLs — including cloud metadata
 * endpoints — using the server's network position.
 */
const ALLOWED_HOSTS = new Set(['help.sap.com']);

export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceError('invalid_url', 400, 'Not a URL.');
  }
  if (url.protocol !== 'https:') {
    throw new SourceError('invalid_url', 400, 'Only https is allowed.');
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new SourceError(
      'host_not_allowed',
      400,
      'Only help.sap.com may be fetched. Upload other material as a PDF instead.',
    );
  }
  return url;
}

/** Cap on fetched bytes, so a huge PDF cannot exhaust function memory. */
const MAX_FETCH_BYTES = 25 * 1024 * 1024;

async function fetchWithLimit(url: URL, accept: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { accept, 'user-agent': 'MyBlueLearning/0.1 (personal study tool)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new SourceError('fetch_failed', 502, `Source responded ${res.status}.`);
  }
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_FETCH_BYTES) {
    throw new SourceError('source_too_large', 413, 'Source document is too large.');
  }
  return res;
}

/* ───────────────────────── HTML pages ───────────────────────── */

/**
 * The Help Portal serves two URL shapes — modern
 * (`/docs/<PRODUCT>/<guid>/<page>.html`) and legacy
 * (`/saphelp_ewm900/helpdata/en/.../content.htm`). Both are handled the same
 * way; the distinction matters only for how the deep link is built, and both
 * shapes already are the deep link.
 */
export async function fetchSapHelpPage(ref: SourceRef, sourceId: string): Promise<SourceChunk[]> {
  const url = assertFetchableUrl(ref.origin);
  const res = await fetchWithLimit(url, 'text/html');
  const html = await res.text();

  const text = htmlToText(html);

  // A JS-shell page yields almost no prose. Failing loudly beats silently
  // generating a course pack from an empty document — which would produce
  // uncited content, get dropped by the guard, and look like a model failure
  // rather than a fetch failure.
  if (text.length < 400) {
    throw new SourceError(
      'page_not_readable',
      422,
      'That page returned almost no readable text. It is probably rendered by JavaScript — use the PDF bundle for this topic instead.',
    );
  }

  return chunkText(text, { sourceId, url: url.toString(), baseLocator: ref.title });
}

/**
 * Minimal HTML → text. Deliberately not a parser dependency: we need prose for
 * the model and for quote matching, not a faithful DOM.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    // Keep block boundaries so headings don't fuse into the following sentence.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ───────────────────────── chunking ───────────────────────── */

/**
 * Target chunk size in characters. Large enough that a process step and its
 * explanation stay together — splitting them is what produces nodes that can
 * state `what` but not `why` — and small enough that a citation points
 * somewhere a reader can actually scan.
 */
const CHUNK_CHARS = 6_000;
const CHUNK_OVERLAP = 400;

export function chunkText(
  text: string,
  opts: { sourceId: string; url?: string; baseLocator: string },
): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let start = 0;
  let index = 1;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);

    // Prefer to break at a paragraph boundary so a chunk does not end
    // mid-sentence — a quote spanning the seam would fail verification even
    // though the model copied it faithfully.
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      if (para > start + CHUNK_CHARS / 2) end = para;
    }

    const slice = text.slice(start, end).trim();
    if (slice.length > 0) {
      chunks.push({
        sourceId: opts.sourceId,
        locator: `${opts.baseLocator} — part ${index}`,
        url: opts.url,
        text: slice,
      });
      index += 1;
    }

    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}
