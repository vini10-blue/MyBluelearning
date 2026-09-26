import { extractText, getDocumentProxy } from 'unpdf';

/**
 * PDF text extraction for the ingest pipeline.
 *
 * ── Why text and not a native document block ──
 *
 * The Anthropic API can read a PDF directly, and it reads one better than
 * extracted text does: it sees layout, tables and figures. It was tempting.
 *
 * It is unusable here, because the accuracy guard needs the source text on the
 * server. Verification works by locating the model's quote inside the document
 * we hold; if the model reads a PDF we never parsed, we hold nothing to compare
 * against and `quoteFound` silently becomes unanswerable. Handing the reading to
 * the model would buy slightly better comprehension at the cost of the only
 * mechanism standing between generated content and a spaced-repetition
 * schedule. Not a trade worth making.
 *
 * Extracting text also means the PDF path feeds the exact same chunk contract as
 * the HTML path, so nothing downstream of `SourceChunk` knows the difference —
 * and it removes any need to split the PDF, so `pdf-lib` is not involved.
 *
 * The side benefit is locators. The HTML path can only say "part 3"; a PDF knows
 * its page numbers, so citations become "p. 412" with a `#page=412` deep link —
 * which is what a reader can actually act on in a 2,000-page bundle.
 */

export interface PdfPage {
  /** 1-indexed, as printed in a PDF viewer. */
  page: number;
  text: string;
}

export class PdfError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Extract per-page text.
 *
 * `pageFrom`/`pageTo` are 1-indexed and inclusive. SAP publishes Application
 * Help as single bundles running to hundreds or thousands of pages, so the
 * caller walks through one window at a time rather than trying to ingest a whole
 * book in one function invocation.
 */
export async function extractPdfPages(
  data: Uint8Array,
  opts: { pageFrom?: number; pageTo?: number } = {},
): Promise<{ pages: PdfPage[]; totalPages: number }> {
  let pdf;
  try {
    // pdfjs transfers ownership of the buffer it is given and detaches it, so
    // a caller that reuses `data` afterwards would find it empty and get a
    // misleading "unreadable PDF" error. Hand it a copy; the caller's bytes
    // stay theirs.
    pdf = await getDocumentProxy(data.slice());
  } catch {
    throw new PdfError('pdf_unreadable', 422, 'That file could not be read as a PDF.');
  }

  const totalPages = pdf.numPages;
  if (totalPages === 0) {
    throw new PdfError('pdf_empty', 422, 'That PDF has no pages.');
  }

  const from = Math.max(1, opts.pageFrom ?? 1);
  const to = Math.min(totalPages, opts.pageTo ?? totalPages);
  if (from > to) {
    throw new PdfError(
      'page_range_empty',
      400,
      `Requested pages ${from}-${to} but the document has ${totalPages}.`,
    );
  }

  // unpdf returns one string per page when mergePages is false.
  const { text } = await extractText(pdf, { mergePages: false });
  const perPage = Array.isArray(text) ? text : [text];

  const pages: PdfPage[] = [];
  for (let p = from; p <= to; p += 1) {
    const raw = perPage[p - 1] ?? '';
    const cleaned = normalizePdfText(raw);
    // Skip pages that carry no prose — covers, blank pages and pure figure
    // pages would otherwise produce chunks with nothing citable in them.
    if (cleaned.length >= 120) pages.push({ page: p, text: cleaned });
  }

  if (pages.length === 0) {
    throw new PdfError(
      'no_readable_text',
      422,
      `Pages ${from}-${to} contain almost no extractable text. If this is a scanned document it needs OCR first.`,
    );
  }

  return { pages, totalPages };
}

/**
 * Tidy extracted PDF text.
 *
 * Extraction artifacts matter more here than in HTML because quote matching is
 * a substring comparison: a hyphen the extractor inserted at a line break, or a
 * run of spaces from column alignment, would make a quote the model copied
 * faithfully fail to match. The normaliser in `_verifyQuotes.ts` handles
 * whitespace and dash width, but it cannot rejoin a word split across lines —
 * so that is done here, before the text is ever chunked or quoted.
 */
export function normalizePdfText(s: string): string {
  return (
    s
      // Rejoin words broken by a hyphen at a line end: "ware-\nhouse".
      .replace(/([a-zÀ-ɏ])-\s*\n\s*([a-zÀ-ɏ])/g, '$1$2')
      // A single newline inside a sentence is a line wrap, not a break.
      .replace(/([^\n.!?:;])\n(?!\n)/g, '$1 ')
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
