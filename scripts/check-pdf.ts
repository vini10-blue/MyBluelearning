/**
 * End-to-end check of the PDF ingest path.
 *
 * Run with: npm run check:pdf
 *
 * `help.sap.com` is unreachable from the development environment, so this
 * fabricates a small PDF with pdf-lib and runs it through the same extraction,
 * cleanup, chunking and quote-verification the real path uses. What it proves:
 * that unpdf works in this Node runtime at all, that page numbers survive,
 * that a word hyphenated across a line break is rejoined before anything tries
 * to quote it, and that a quote copied from page 2 verifies against the chunk
 * that claims to contain page 2.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractPdfPages, normalizePdfText } from '../api/_pdf.js';
import { chunkPages } from '../api/_sources.js';
import { verifyQuote } from '../api/_verifyQuotes.js';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const PAGE_TEXTS = [
  // Page 1: enough prose to clear the "readable page" floor.
  'Creation of Warehouse Tasks for Putaway. Extended Warehouse Management automatically creates warehouse tasks for the putaway based on a warehouse request for an inbound delivery, so that you can put away products in the correct storage bins.',
  // Page 2: the sentence a later test will quote.
  'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework. If you want to create a warehouse task manually, choose Work Scheduling and then Putaway for Inbound Delivery from the menu.',
  // Page 3: enough prose to be kept.
  'When EWM creates a warehouse task for a warehouse request, it uses putaway strategies to determine the storage bin. The strategy encodes the business intent of the warehouse as an automatic per-item decision at task creation time.',
];

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of PAGE_TEXTS) {
    const page = doc.addPage([595, 842]);
    // Wrap crudely at ~90 chars so the text spans several lines like real docs.
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > 90) {
        lines.push(line.trim());
        line = w;
      } else {
        line = `${line} ${w}`;
      }
    }
    if (line.trim()) lines.push(line.trim());
    lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 18, size: 11, font }));
  }
  return doc.save();
}

console.log('\nExtraction works in this runtime');
const bytes = await makePdf();
const { pages, totalPages } = await extractPdfPages(bytes);
check('reports the right page count', totalPages === 3, String(totalPages));
check('extracts every page', pages.length === 3, String(pages.length));
check('page numbers are 1-indexed', pages.map((p) => p.page).join(',') === '1,2,3');
check(
  'page 2 contains its own sentence',
  pages[1]?.text.includes('Post Processing Framework') ?? false,
  pages[1]?.text.slice(0, 80),
);

console.log('\nPage windows are honoured');
const windowed = await extractPdfPages(bytes, { pageFrom: 2, pageTo: 2 });
check('a single-page window returns one page', windowed.pages.length === 1);
check('and it is the page asked for', windowed.pages[0]?.page === 2);
let ranged = false;
try {
  await extractPdfPages(bytes, { pageFrom: 5, pageTo: 9 });
} catch (e) {
  ranged = (e as { code?: string }).code === 'page_range_empty';
}
check('an out-of-range window is a typed error, not a silent empty result', ranged);

console.log('\nExtraction artifacts are cleaned before anything can quote them');
check(
  'a word hyphenated across a line break is rejoined',
  normalizePdfText('creates ware-\nhouse tasks') === 'creates warehouse tasks',
  JSON.stringify(normalizePdfText('creates ware-\nhouse tasks')),
);
check(
  'a mid-sentence line wrap becomes a space',
  normalizePdfText('creates warehouse\ntasks for') === 'creates warehouse tasks for',
);
check(
  'a paragraph break is preserved',
  normalizePdfText('First sentence.\n\nSecond paragraph.').includes('\n\n'),
);

console.log('\nChunks carry page locators and deep links');
const chunks = chunkPages(pages, {
  sourceId: 'src-pdf',
  originUrl: 'https://help.sap.com/doc/example/en-US/ewm.pdf',
});
check('three pages fit one chunk at the configured size', chunks.length === 1, String(chunks.length));
check('the locator is a page range, not "part N"', chunks[0]?.locator === 'pp. 1–3', chunks[0]?.locator);
check(
  'the url deep-links to the first page of the chunk',
  chunks[0]?.url === 'https://help.sap.com/doc/example/en-US/ewm.pdf#page=1',
  chunks[0]?.url,
);

console.log('\nA quote from the PDF verifies through the normal path');
const result = verifyQuote(
  'src-pdf',
  'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework.',
  chunks,
);
check('a verbatim sentence from page 2 is located', result.quoteFound, result.reason);
check(
  'a paraphrase of it is not',
  !verifyQuote('src-pdf', 'EWM is able to generate warehouse tasks via a PPF action for inbound deliveries.', chunks).quoteFound,
);

console.log(
  failures === 0 ? '\nAll PDF checks passed.\n' : `\n${failures} PDF check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
