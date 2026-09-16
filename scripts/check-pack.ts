/**
 * Verification harness for the accuracy guard.
 *
 * Run with: npm run check:pack
 *
 * The cases below are chosen from failures that actually happened rather than
 * from what felt worth testing. The old version of this harness reported
 * "nothing dropped" on a seed pack that taught a false step ordering — it
 * exercised hand-crafted malformed packs while the real defect was well-formed
 * content that was simply wrong. The `happyPath` cases are the direct answer to
 * that.
 */
import { SEED_PACK } from '../src/content/seedPack';
import { validateCoursePack } from '../src/lib/validateCoursePack';
import type { CoursePack } from '../src/lib/types';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Deep clone so each mutation test starts from a clean pack. */
function mutate(fn: (p: CoursePack) => void): CoursePack {
  const copy = structuredClone(SEED_PACK) as CoursePack;
  fn(copy);
  return copy;
}

console.log('\nThe seed pack passes validation intact');
const seed = validateCoursePack(SEED_PACK);
check('validator returns a report', seed !== null);
if (seed) {
  check('no fatal problems', seed.fatal.length === 0, seed.fatal.join('; '));
  check('nothing dropped', seed.dropped.length === 0, seed.dropped.join('; '));
  check(
    `all ${SEED_PACK.process.nodes.length} nodes survive`,
    seed.pack.process.nodes.length === SEED_PACK.process.nodes.length,
  );
  check(
    `all ${SEED_PACK.process.edges.length} edges survive`,
    seed.pack.process.edges.length === SEED_PACK.process.edges.length,
  );
}

console.log('\nA happy path may not assert an ordering no edge supports');
console.log('  (this is the check that would have caught the real bug)');
const phantomOrder = validateCoursePack(
  mutate((p) => {
    // Exactly the original defect: bin determination listed as a step AFTER
    // warehouse-order, when it actually happens during warehouse-task creation.
    p.process.happyPath = [
      'inbound-delivery',
      'goods-receipt',
      'warehouse-task',
      'warehouse-order',
      'storage-bin',
    ];
  }),
);
check(
  'a step with no edge asserting it is fatal, not a silent pass',
  (phantomOrder?.fatal.length ?? 0) > 0,
);
check(
  'and the message names both ends of the false ordering',
  phantomOrder?.fatal.some((f) => f.includes('warehouse-order') && f.includes('storage-bin')) ??
    false,
  phantomOrder?.fatal.join('; '),
);

console.log('\nSourced claims must rest on a quote that was actually located');
const unfoundQuote = validateCoursePack(
  mutate((p) => {
    p.process.nodes[2].what.citations.forEach((c) => {
      c.quoteFound = false;
    });
  }),
);
check(
  'a node whose definition has no located quote is dropped',
  (unfoundQuote?.pack.process.nodes.length ?? 0) === SEED_PACK.process.nodes.length - 1,
);
check(
  'edges touching the dropped node go too, leaving no dangling arrows',
  unfoundQuote?.pack.process.edges.every(
    (e) =>
      unfoundQuote.pack.process.nodes.some((n) => n.id === e.from) &&
      unfoundQuote.pack.process.nodes.some((n) => n.id === e.to),
  ) ?? false,
);

console.log('\nSynthesis is kept, not dropped — but never promoted');
const unfoundSynthesis = validateCoursePack(
  mutate((p) => {
    // Replace rather than mutate in place. The fixture deliberately reuses one
    // citation object across a node's `what` and its `why`, and structuredClone
    // preserves that sharing — so mutating the shared object would flip the
    // definition's evidence too and drop the node for the wrong reason.
    const node = p.process.nodes[0];
    node.why = {
      ...node.why,
      basedOn: node.why.basedOn.map((c) => ({ ...c, quoteFound: false })),
    };
  }),
);
check(
  'a node whose why has no located support still survives',
  (unfoundSynthesis?.pack.process.nodes.length ?? 0) === SEED_PACK.process.nodes.length,
);
check(
  'but the unlocatable passage is stripped from its support',
  unfoundSynthesis?.pack.process.nodes[0].why.basedOn.length === 0,
);

const overclaimed = validateCoursePack(
  mutate((p) => {
    p.process.nodes[0].why.origin = 'stated';
    p.process.nodes[0].why.basedOn = [];
  }),
);
check(
  'synthesis claiming the source "states" it, with nothing found, is demoted to inferred',
  overclaimed?.pack.process.nodes[0].why.origin === 'inferred',
  overclaimed?.pack.process.nodes[0].why.origin,
);

console.log('\nLiteral tokens are dropped unless found verbatim');
const fakeTcode = validateCoursePack(
  mutate((p) => {
    p.process.nodes[2].tcodes = [
      { value: '/SCWM/TO_CONF', foundInSource: false },
      { value: '/SCWM/PRDI', foundInSource: true },
    ];
  }),
);
const survivingTcodes = fakeTcode?.pack.process.nodes.find((n) => n.id === 'warehouse-task')?.tcodes;
check(
  'a T-code not found in the source is dropped',
  survivingTcodes?.every((t) => t.value !== '/SCWM/TO_CONF') ?? false,
);
check('a T-code that was found is kept', survivingTcodes?.length === 1);
check(
  'the drop is reported rather than silent',
  fakeTcode?.dropped.some((d) => d.includes('/SCWM/TO_CONF')) ?? false,
);

const fakeConfigPath = validateCoursePack(
  mutate((p) => {
    const wo = p.process.nodes.find((n) => n.id === 'warehouse-order');
    if (wo?.configPath) wo.configPath.foundInSource = false;
  }),
);
check(
  'a config path not found in the source is dropped',
  fakeConfigPath?.pack.process.nodes.find((n) => n.id === 'warehouse-order')?.configPath ===
    undefined,
);

console.log('\nA citation that does not resolve is not a citation');
const danglingSource = validateCoursePack(
  mutate((p) => {
    p.process.nodes[1].what.citations = [
      {
        sourceId: 'a-source-that-was-never-declared',
        sourceTitle: 'SAP Help Portal',
        locator: 'p. 1',
        quote: 'Looks authoritative, resolves to nothing.',
        quoteFound: true,
      },
    ];
  }),
);
check(
  'a node citing an undeclared source is dropped',
  (danglingSource?.pack.process.nodes.length ?? 0) === SEED_PACK.process.nodes.length - 1,
);

console.log('\nA pack with no sources cannot be checked at all');
const noSources = validateCoursePack(mutate((p) => { p.sources = []; }));
check('declaring no sources is fatal', (noSources?.fatal.length ?? 0) > 0);

console.log(
  failures === 0
    ? '\nAll guard checks passed.\n'
    : `\n${failures} guard check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
