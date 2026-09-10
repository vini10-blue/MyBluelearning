/**
 * Verification harness for the accuracy guard.
 *
 * Run with: npm run check:pack
 *
 * This is the check that matters most in the codebase. The guard is what
 * stands between model-generated SAP content and a spaced-repetition schedule
 * that would drill any error it contains until it feels true — so it is
 * exercised against both content that should survive and content that must
 * not.
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

console.log('\nSeed pack passes validation intact');
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
  check('happy path intact', seed.pack.process.happyPath.length === SEED_PACK.process.happyPath.length);
}

/** Deep clone so each mutation test starts from a clean pack. */
function mutate(fn: (p: CoursePack) => void): CoursePack {
  const copy = structuredClone(SEED_PACK) as CoursePack;
  fn(copy);
  return copy;
}

console.log('\nUncited content is rejected');
const uncitedItem = validateCoursePack(
  mutate((p) => {
    p.items.push({
      id: 'made-up',
      kind: 'recall',
      nodeIds: ['warehouse-task'],
      citations: [],
      front: 'Which T-code confirms a putaway warehouse task?',
      back: '/SCWM/TO_CONF',
    });
  }),
);
check(
  'an item with no citations is dropped',
  uncitedItem?.pack.items.every((i) => i.id !== 'made-up') ?? false,
);
check(
  'the drop is reported, not silent',
  uncitedItem?.dropped.some((d) => d.includes('made-up')) ?? false,
);

console.log('\nA citation that does not resolve is not a citation');
const danglingSource = validateCoursePack(
  mutate((p) => {
    p.items.push({
      id: 'dangling',
      kind: 'recall',
      nodeIds: ['warehouse-task'],
      citations: [
        {
          sourceId: 'a-source-that-was-never-declared',
          sourceTitle: 'SAP Help Portal',
          locator: 'p. 1',
          quote: 'Looks authoritative, resolves to nothing.',
          verified: true,
        },
      ],
      front: 'x',
      back: 'y',
    });
  }),
);
check(
  'an item citing an unknown source is dropped',
  danglingSource?.pack.items.every((i) => i.id !== 'dangling') ?? false,
);

console.log('\nA missing verified flag is treated as malformed, not as false');
const noFlag = validateCoursePack(
  mutate((p) => {
    const item = p.items.push({
      id: 'unflagged',
      kind: 'recall',
      nodeIds: ['warehouse-task'],
      citations: [
        {
          sourceId: p.sources[0].id,
          sourceTitle: p.sources[0].title,
          locator: 'p. 1',
          quote: 'A real quote with no verification flag.',
          // deliberately omitted: verified
        } as unknown as CoursePack['items'][number]['citations'][number],
      ],
      front: 'x',
      back: 'y',
    });
    void item;
  }),
);
check(
  'an item whose only citation lacks the flag is dropped',
  noFlag?.pack.items.every((i) => i.id !== 'unflagged') ?? false,
);

console.log('\nNodes must be able to say why they exist');
const noWhy = validateCoursePack(
  mutate((p) => {
    p.process.nodes[2].why = '';
  }),
);
check(
  'a node with no "why" is dropped',
  (noWhy?.pack.process.nodes.length ?? 0) === SEED_PACK.process.nodes.length - 1,
);
check(
  'edges pointing at the dropped node are dropped too, leaving no dangling arrows',
  noWhy?.pack.process.edges.every(
    (e) =>
      noWhy.pack.process.nodes.some((n) => n.id === e.from) &&
      noWhy.pack.process.nodes.some((n) => n.id === e.to),
  ) ?? false,
);

console.log(
  failures === 0
    ? '\nAll guard checks passed.\n'
    : `\n${failures} guard check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
