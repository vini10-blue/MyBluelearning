import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPack } from '../lib/packs';
import { rejectFlagged } from '../lib/contentFlags';
import { playComplete } from '../lib/drillFeedback';
import type { BreakItem, Item, ItemKind, ProcessNode, SequenceItem } from '../lib/types';
import { BreakDrill } from './BreakDrill';
import { ChoiceDrill } from './ChoiceDrill';
import { SequenceDrill } from './SequenceDrill';
import { FlagButton } from './FlagButton';

const KIND_TITLE: Record<string, string> = {
  sequence: 'Sequence it',
  trace: 'Trace it',
  break: 'Break it',
  configure: 'Configure it',
  all: 'Mixed practice',
};

/**
 * The drill runner.
 *
 * `all` interleaves every kind rather than blocking by type. Interleaving is
 * one of the better-evidenced findings in the retrieval-practice literature:
 * blocked practice feels smoother and produces worse retention, because
 * repeating one question type lets the learner pattern-match the format instead
 * of retrieving the knowledge. It is offered as the default route from Home for
 * that reason, with single-kind routes kept for deliberate focus on a weakness.
 */
export function DrillScreen() {
  const { packId, kind = 'all' } = useParams();
  const pack = getPack(packId);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState({ right: 0, wrong: 0 });
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [flagTick, setFlagTick] = useState(0);

  const items = useMemo(() => {
    if (!pack) return [];
    void flagTick;
    const live = rejectFlagged(pack.id, pack.items);
    const filtered =
      kind === 'all' ? live : live.filter((i) => i.kind === (kind as ItemKind));
    if (kind !== 'all') return filtered;
    // Interleave by rotating through kinds rather than shuffling, so the same
    // type never lands twice in a row while a pack is small.
    const byKind = new Map<string, Item[]>();
    for (const i of filtered) {
      const list = byKind.get(i.kind) ?? [];
      list.push(i);
      byKind.set(i.kind, list);
    }
    const out: Item[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const list of byKind.values()) {
        const next = list.shift();
        if (next) {
          out.push(next);
          added = true;
        }
      }
    }
    return out;
  }, [pack, kind, flagTick]);

  const nodes = useMemo(
    () => new Map<string, ProcessNode>((pack?.process.nodes ?? []).map((n) => [n.id, n])),
    [pack],
  );

  if (!pack) {
    return (
      <Shell title="Drill">
        <p className="text-sm text-slate-600">That course pack does not exist.</p>
      </Shell>
    );
  }

  if (items.length === 0) {
    return (
      <Shell packId={pack.id} title={KIND_TITLE[kind] ?? 'Drill'}>
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-semibold text-slate-900">Nothing to practise yet</p>
          <p className="mt-2 text-sm text-slate-600">
            This pack has no {kind === 'all' ? '' : `${KIND_TITLE[kind]?.toLowerCase()} `}items.
            Items are written by the ingest pipeline, which has not run against a real
            source document yet.
          </p>
        </div>
      </Shell>
    );
  }

  if (index >= items.length) {
    const total = score.right + score.wrong;
    return (
      <Shell packId={pack.id} title={KIND_TITLE[kind] ?? 'Drill'}>
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-3xl font-semibold tracking-tight text-slate-900">
            {score.right}/{total}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Best streak {bestStreak}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setIndex(0);
                setScore({ right: 0, wrong: 0 });
                setStreak(0);
              }}
              className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white active:scale-[0.98] transition"
            >
              Again
            </button>
            <Link
              to={`/pack/${pack.id}/map`}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-center text-sm font-medium text-slate-700 ring-1 ring-slate-200 active:scale-[0.98] transition"
            >
              Back to map
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  const item = items[index];

  function resolve(correct: boolean) {
    setScore((s) => ({
      right: s.right + (correct ? 1 : 0),
      wrong: s.wrong + (correct ? 0 : 1),
    }));
    setStreak((prev) => {
      const next = correct ? prev + 1 : 0;
      setBestStreak((b) => Math.max(b, next));
      return next;
    });
    if (index + 1 >= items.length) playComplete();
    setIndex((i) => i + 1);
  }

  return (
    <Shell packId={pack.id} title={KIND_TITLE[kind] ?? 'Drill'}>
      <div className="mb-4 flex items-center justify-between text-xs text-slate-500">
        <span>
          {index + 1} of {items.length}
        </span>
        {streak >= 2 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
            {streak} in a row
          </span>
        )}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {/* `key` forces a fresh component per item so answered state never
            leaks from one question into the next. */}
        {renderItem(item, nodes, resolve)}

        {/* On every item, because `correctIndices` is the one field nothing
            mechanical checks. */}
        <div className="mt-2 border-t border-slate-100 pt-2">
          <FlagButton
            packId={pack.id}
            targetId={item.id}
            targetKind="item"
            onChange={() => {
              setFlagTick((t) => t + 1);
              setIndex(0);
              setScore({ right: 0, wrong: 0 });
              setStreak(0);
            }}
          />
        </div>
      </div>
    </Shell>
  );
}

function renderItem(
  item: Item,
  nodes: Map<string, ProcessNode>,
  resolve: (correct: boolean) => void,
) {
  switch (item.kind) {
    case 'sequence':
      return (
        <SequenceDrill key={item.id} item={item as SequenceItem} nodes={nodes} onResolved={resolve} />
      );
    case 'break':
      return <BreakDrill key={item.id} item={item as BreakItem} onResolved={resolve} />;
    case 'trace':
      return (
        <ChoiceDrill
          key={item.id}
          context={item.given}
          question={item.question}
          choices={item.choices}
          onResolved={resolve}
        />
      );
    case 'configure':
      return (
        <ChoiceDrill
          key={item.id}
          context={item.requirement}
          question="Which configuration meets this requirement?"
          choices={item.choices}
          onResolved={resolve}
        />
      );
    case 'recall':
      return (
        <ChoiceDrill
          key={item.id}
          question={item.front}
          choices={{
            options: [item.back],
            correctIndices: [0],
            rationales: [''],
            revealCount: false,
          }}
          onResolved={resolve}
        />
      );
    default:
      return (
        <p className="text-sm text-slate-600">
          This item type has no drill yet.
        </p>
      );
  }
}

function Shell({
  packId,
  title,
  children,
}: {
  packId?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-full px-5 pt-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto w-full max-w-md">
        <Link
          to={packId ? `/pack/${packId}/map` : '/'}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back
        </Link>
        <h1 className="mt-4 mb-5 text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}
