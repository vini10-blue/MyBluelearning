/**
 * Verification harness for mechanical citation checking.
 *
 * Run with: npm run check:quotes
 *
 * These cases are the ones that decide whether the `verified` flag means
 * anything. In particular: a model must not be able to earn verification by
 * quoting a common word, by paraphrasing, or by attributing real text to the
 * wrong document.
 */
import type { SourceChunk } from '../api/_sources.js';
import { chunkText, htmlToText } from '../api/_sources.js';
import { normalizeForMatch, settleCitations, verifyQuote } from '../api/_verifyQuotes.js';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const REAL_TEXT =
  'Extended Warehouse Management (EWM) automatically creates warehouse tasks for the putaway ' +
  'based on a warehouse request for an inbound delivery, so that you can put away products. ' +
  'EWM can create warehouse tasks for an inbound delivery using an action from the Post ' +
  'Processing Framework (PPF).';

const chunks: SourceChunk[] = [
  {
    sourceId: 'sap-wt-putaway',
    locator: 'Creation of Warehouse Tasks for Putaway — part 1',
    url: 'https://help.sap.com/docs/example.html',
    text: REAL_TEXT,
  },
  {
    sourceId: 'sap-other',
    locator: 'Some other page — part 1',
    url: 'https://help.sap.com/docs/other.html',
    text: 'An unrelated page about outbound delivery processing and wave management.',
  },
];

console.log('\nA genuine verbatim quote verifies');
check(
  'exact substring verifies',
  verifyQuote(
    'sap-wt-putaway',
    'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
    chunks,
  ).verified,
);

console.log('\nCopying artifacts do not break a real quote');
check(
  'curly quotes, non-breaking spaces and ragged whitespace are tolerated',
  verifyQuote(
    'sap-wt-putaway',
    'EWM  can create warehouse tasks for an inbound delivery using an action from the Post\nProcessing Framework (PPF).',
    chunks,
  ).verified,
);
check(
  'case differences are tolerated',
  verifyQuote(
    'sap-wt-putaway',
    'ewm can create warehouse tasks for an inbound delivery using an action from the post processing framework (ppf).',
    chunks,
  ).verified,
);

console.log('\nA paraphrase is not a quote');
const paraphrase = verifyQuote(
  'sap-wt-putaway',
  'EWM is able to generate warehouse tasks for inbound deliveries by means of a PPF action.',
  chunks,
);
check('paraphrase does not verify', !paraphrase.verified);
check('and the reason says so', paraphrase.reason === 'quote_not_in_source', paraphrase.reason);

console.log('\nA short common phrase cannot buy verification');
const tiny = verifyQuote('sap-wt-putaway', 'EWM', chunks);
check('a 3-character quote is rejected', !tiny.verified);
check('rejected for length, not absence', tiny.reason === 'quote_too_short', tiny.reason);
check(
  'a real but trivially common phrase is still too short',
  !verifyQuote('sap-wt-putaway', 'warehouse tasks', chunks).verified,
);

console.log('\nReal text attributed to the wrong document does not verify');
const misattributed = verifyQuote(
  'sap-other',
  'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
  chunks,
);
check('quote from another source does not verify', !misattributed.verified);
check(
  'because the citation would point at a page without the text',
  misattributed.reason === 'quote_not_in_source',
  misattributed.reason,
);
check(
  'an unknown source id does not verify',
  verifyQuote('never-declared', REAL_TEXT, chunks).reason === 'source_not_found',
);

console.log('\nThe server owns locator and url, not the model');
const settled = settleCitations(
  [
    {
      sourceId: 'sap-wt-putaway',
      sourceTitle: 'Creation of Warehouse Tasks for Putaway',
      locator: 'p. 999 (invented by the model)',
      url: 'https://help.sap.com/docs/wrong-page.html',
      quote:
        'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
    },
  ],
  chunks,
);
check('the citation verifies', settled.citations[0].verified);
check(
  'the model-supplied locator is overwritten with the chunk’s',
  settled.citations[0].locator === 'Creation of Warehouse Tasks for Putaway — part 1',
  settled.citations[0].locator,
);
check(
  'the model-supplied url is overwritten too',
  settled.citations[0].url === 'https://help.sap.com/docs/example.html',
  settled.citations[0].url,
);

console.log('\nChunking keeps quotes findable across the seam');
const long = Array.from(
  { length: 40 },
  (_, i) => `Paragraph ${i}. ${REAL_TEXT}`,
).join('\n\n');
const many = chunkText(long, { sourceId: 's', baseLocator: 'Doc' });
check('long text splits into several chunks', many.length > 1, `${many.length} chunks`);
check(
  'every chunk carries the source id and a locator',
  many.every((c) => c.sourceId === 's' && c.locator.length > 0),
);
check(
  'a sentence from the middle is still findable',
  verifyQuote('s', REAL_TEXT, many).verified,
);

console.log('\nHTML extraction produces matchable prose');
const text = htmlToText(
  '<html><head><style>.a{color:red}</style><script>var x=1</script></head>' +
    `<body><h1>Putaway</h1><p>${REAL_TEXT}</p></body></html>`,
);
check('script and style content is stripped', !text.includes('var x') && !text.includes('color:red'));
check('prose survives', normalizeForMatch(text).includes(normalizeForMatch(REAL_TEXT)));
check(
  'the heading does not fuse into the paragraph',
  /putaway\s*\n/i.test(text),
  JSON.stringify(text.slice(0, 60)),
);

console.log(
  failures === 0
    ? '\nAll quote-verification checks passed.\n'
    : `\n${failures} quote-verification check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
