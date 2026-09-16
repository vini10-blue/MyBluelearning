/**
 * End-to-end check: model output → settling → guard.
 *
 * Run with: npm run check:pipeline
 *
 * This is the test that was missing. `check-pack.ts` exercises the guard
 * against hand-crafted packs and `check-quotes.ts` exercises the matcher
 * against hand-crafted quotes, but neither ran the actual shape the pipeline
 * emits through both stages. That gap is exactly how a guard can look thorough
 * and drop nothing in production: the generation schema forces every field
 * non-empty, so malformed input never arrives — the realistic failure is
 * well-formed content that is quietly wrong.
 *
 * Each case below is raw JSON of the kind Opus returns under PROCESS_SCHEMA,
 * settled against real chunks, then validated.
 */
import { settleProcessModel } from '../api/ingest.js';
import type { SourceChunk } from '../api/_sources.js';
import { validateCoursePack } from '../src/lib/validateCoursePack';
import type { CoursePack } from '../src/lib/types';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const SOURCE_ID = 'src-test';
const REAL_TEXT =
  'Extended Warehouse Management (EWM) automatically creates warehouse tasks for the putaway ' +
  'based on a warehouse request for an inbound delivery, so that you can put away products. ' +
  'EWM can create warehouse tasks for an inbound delivery using an action from the Post ' +
  'Processing Framework (PPF). If you want EWM to automatically group warehouse tasks into ' +
  'warehouse orders, you must have made the settings in Customizing for warehouse order ' +
  'creation. In the Implementation Guide (IMG) for EWM, choose Cross-Process Settings -> ' +
  'Warehouse Order.';

const chunks: SourceChunk[] = [
  {
    sourceId: SOURCE_ID,
    locator: 'Creation of Warehouse Tasks for Putaway — part 1',
    url: 'https://help.sap.com/docs/example.html',
    text: REAL_TEXT,
  },
];

const citing = (quote: string) => ({
  sourceId: SOURCE_ID,
  sourceTitle: 'Creation of Warehouse Tasks for Putaway',
  locator: 'invented by the model',
  quote,
});

/** Wrap a settled process model as a pack the guard can validate. */
function asPack(model: unknown): CoursePack {
  return {
    id: 'p',
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    sources: [
      {
        id: SOURCE_ID,
        kind: 'sap-help-page',
        title: 'Creation of Warehouse Tasks for Putaway',
        origin: 'https://help.sap.com/docs/example.html',
        ingestedAt: new Date().toISOString(),
      },
    ],
    process: model as CoursePack['process'],
    items: [],
  };
}

/** A well-formed generation, of the kind the schema guarantees. */
function generation(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Inbound putaway',
    module: 'SAP EWM',
    summary: 'Test process.',
    nodes: [
      {
        id: 'warehouse-task',
        label: 'Warehouse task',
        kind: 'object',
        what: {
          text: 'The instruction to move stock to a destination.',
          citations: [
            citing(
              'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
            ),
          ],
        },
        why: {
          text: 'It is the unit of physical work — the first object that tells someone to move something.',
          origin: 'inferred',
          basedOn: [
            citing(
              'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
            ),
          ],
        },
        breaksIf: {
          text: 'No putaway work reaches the floor even though the goods receipt posted.',
          origin: 'inferred',
          basedOn: [],
        },
        tcodes: [] as string[],
        configPath: null as string | null,
      },
      {
        id: 'warehouse-order',
        label: 'Warehouse order',
        kind: 'object',
        what: {
          text: 'A grouping of warehouse tasks issued as one piece of work.',
          citations: [
            citing(
              'If you want EWM to automatically group warehouse tasks into warehouse orders, you must have made the settings in Customizing for warehouse order creation.',
            ),
          ],
        },
        why: { text: 'It exists for the picker, not the system.', origin: 'inferred', basedOn: [] },
        breaksIf: { text: 'Work arrives in an inefficient shape.', origin: 'inferred', basedOn: [] },
        tcodes: [] as string[],
        configPath: 'Cross-Process Settings -> Warehouse Order' as string | null,
      },
    ],
    edges: [
      {
        id: 'e1',
        from: 'warehouse-task',
        to: 'warehouse-order',
        label: {
          text: 'Tasks are grouped into an order per Customizing.',
          citations: [
            citing(
              'If you want EWM to automatically group warehouse tasks into warehouse orders, you must have made the settings in Customizing for warehouse order creation.',
            ),
          ],
        },
      },
    ],
    failureModes: [],
    happyPath: ['warehouse-task', 'warehouse-order'],
    ...overrides,
  };
}

console.log('\nA faithful generation survives settling and validation');
{
  const { model, stats } = settleProcessModel(generation(), chunks, 'Test source');
  const report = validateCoursePack(asPack(model));
  check('every quote is located', stats.citationsFound === stats.citationsTotal,
    `${stats.citationsFound}/${stats.citationsTotal}`);
  check('no fatal problems', report?.fatal.length === 0, report?.fatal.join('; '));
  check('both nodes survive', report?.pack.process.nodes.length === 2);
  check('the config path is kept', Boolean(
    report?.pack.process.nodes.find((n) => n.id === 'warehouse-order')?.configPath));
  check(
    'the arrow-separated IMG path matched despite a different arrow glyph',
    stats.tokensFound === 1,
    `${stats.tokensFound}/${stats.tokensTotal}`,
  );
}

console.log('\nA paraphrased quote loses the node it was supposed to support');
{
  const g = generation();
  g.nodes[0].what.citations = [
    citing('EWM is able to generate warehouse tasks for inbound deliveries via a PPF action.'),
  ];
  const { model } = settleProcessModel(g, chunks, 'Test source');
  const report = validateCoursePack(asPack(model));
  check(
    'the node whose definition was paraphrased is dropped',
    report?.pack.process.nodes.every((n) => n.id !== 'warehouse-task') ?? false,
  );
  check(
    'and the edge depending on it goes too',
    report?.pack.process.edges.length === 0,
  );
}

console.log('\nAn invented transaction code never reaches the learner');
{
  const g = generation();
  g.nodes[0].tcodes = ['/SCWM/TO_CONF', '/SCWM/PRDI'];
  const { model, stats } = settleProcessModel(g, chunks, 'Test source');
  const report = validateCoursePack(asPack(model));
  const node = report?.pack.process.nodes.find((n) => n.id === 'warehouse-task');
  // Three literal tokens are claimed: two invented T-codes and the one real
  // config path. Exactly one should be located. An assertion that accepted
  // either 0 or 1 could barely fail and was not worth having.
  check('all three claimed tokens were checked', stats.tokensTotal === 3, String(stats.tokensTotal));
  check(
    'only the genuine config path was located',
    stats.tokensFound === 1,
    String(stats.tokensFound),
  );
  check('no unfound T-code survives to the pack', node?.tcodes.every((t) => t.foundInSource) ?? false);
  check('the node itself still survives', Boolean(node));
}

console.log('\nSynthesis with no supporting passage is kept, not dropped');
{
  const { model } = settleProcessModel(generation(), chunks, 'Test source');
  const report = validateCoursePack(asPack(model));
  const node = report?.pack.process.nodes.find((n) => n.id === 'warehouse-task');
  check('breaksIf survived with an empty basedOn', node?.breaksIf.basedOn.length === 0);
  check('and is labelled as inference', node?.breaksIf.origin === 'inferred');
}

console.log('\nA happy path asserting an unsupported ordering is rejected');
{
  const g = generation({ happyPath: ['warehouse-order', 'warehouse-task'] });
  const { model } = settleProcessModel(g, chunks, 'Test source');
  const report = validateCoursePack(asPack(model));
  check('the reversed ordering is fatal', (report?.fatal.length ?? 0) > 0, report?.fatal.join('; '));
}

console.log(
  failures === 0
    ? '\nAll pipeline checks passed.\n'
    : `\n${failures} pipeline check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
