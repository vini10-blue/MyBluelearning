import { useState } from 'react';
import type { ProcessNode, SequenceItem } from '../lib/types';
import { playCorrect, playWrong } from '../lib/drillFeedback';

interface SequenceDrillProps {
  item: SequenceItem;
  /** Node lookup, for labels. */
  nodes: Map<string, ProcessNode>;
  onResolved: (correct: boolean) => void;
}

/**
 * Put the process steps in order.
 *
 * Tap-to-place rather than drag-and-drop. DnD on a phone means long-press,
 * scroll conflicts and a drag preview that fights the viewport; tapping the
 * next step in sequence is unambiguous, works one-handed, and is undoable.
 *
 * The feedback design is the point. A step in the wrong position does not get a
 * red cross — it shows what breaks downstream because of where it landed,
 * taken from that node's `breaksIf`. A verdict tells you that you were wrong; a
 * consequence tells you why the order matters, which is the thing being taught.
 */
export function SequenceDrill({ item, nodes, onResolved }: SequenceDrillProps) {
  const [placed, setPlaced] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const remaining = item.correctOrder.filter((id) => !placed.includes(id));
  // Stable shuffle: seeded off the item id so the options do not reorder on
  // every render, which would make the list jump under the user's thumb.
  const options = [...remaining].sort((a, b) =>
    (a + item.id).localeCompare(b + item.id),
  );

  const label = (id: string) => nodes.get(id)?.label ?? id;
  const allPlaced = placed.length === item.correctOrder.length;
  const isRight = allPlaced && placed.every((id, i) => id === item.correctOrder[i]);

  function submit() {
    setSubmitted(true);
    if (placed.every((id, i) => id === item.correctOrder[i])) playCorrect();
    else playWrong();
  }

  return (
    <div>
      <p className="text-base font-medium text-slate-900">{item.prompt}</p>

      <ol className="mt-4 space-y-2">
        {placed.map((id, i) => {
          const wrong = submitted && id !== item.correctOrder[i];
          return (
            <li
              key={id}
              className={`rounded-xl p-3 ring-1 ${
                submitted
                  ? wrong
                    ? 'bg-rose-50 ring-rose-300'
                    : 'bg-emerald-50 ring-emerald-300'
                  : 'bg-white ring-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm text-slate-800">{label(id)}</span>
                {!submitted && (
                  <button
                    type="button"
                    onClick={() => setPlaced((p) => p.filter((x) => x !== id))}
                    aria-label={`Remove ${label(id)}`}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Consequence, not verdict. */}
              {wrong && item.consequences[id] && (
                <p className="mt-2 border-t border-rose-200 pt-2 text-xs text-rose-800">
                  {item.consequences[id]}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {!submitted && options.length > 0 && (
        <>
          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-400">
            Tap the next step
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {options.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setPlaced((p) => [...p, id])}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200 transition active:scale-[0.97]"
              >
                {label(id)}
              </button>
            ))}
          </div>
        </>
      )}

      {!submitted ? (
        <button
          type="button"
          onClick={submit}
          disabled={!allPlaced}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
        >
          Check
        </button>
      ) : (
        <div className="mt-5">
          <p className={`text-sm font-semibold ${isRight ? 'text-emerald-700' : 'text-rose-700'}`}>
            {isRight ? 'Right order.' : 'Not the order the process runs in.'}
          </p>
          <button
            type="button"
            onClick={() => onResolved(isRight)}
            className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98]"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
