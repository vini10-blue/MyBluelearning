import { useState } from 'react';
import type { Choices } from '../lib/types';
import { playCorrect, playWrong } from '../lib/drillFeedback';

interface ChoiceDrillProps {
  /** The situation or requirement, shown above the question. */
  context?: string;
  question: string;
  choices: Choices;
  onResolved: (correct: boolean) => void;
}

/**
 * Multiple-response question — the shape Trace-it and Configure-it both take.
 *
 * Multi-select is the default rather than a special case because SAP
 * certification questions routinely ask for two or three answers, and a drill
 * that only ever has one right answer trains a habit the exam punishes.
 * `revealCount` mirrors SAP's own convention of stating how many to pick;
 * hiding it would make the practice harder than the real thing, which is not
 * the same as making it better.
 *
 * After answering, EVERY option's rationale is shown — including the ones not
 * picked. Knowing why a distractor was wrong is most of the learning, and it is
 * lost if feedback only addresses the choice made.
 */
export function ChoiceDrill({ context, question, choices, onResolved }: ChoiceDrillProps) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const correct = new Set(choices.correctIndices);
  const isRight =
    picked.size === correct.size && [...picked].every((i) => correct.has(i));

  function toggle(i: number) {
    if (submitted) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function submit() {
    if (picked.size === 0) return;
    setSubmitted(true);
    const right = picked.size === correct.size && [...picked].every((i) => correct.has(i));
    if (right) playCorrect();
    else playWrong();
  }

  return (
    <div>
      {context && (
        <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
          {context}
        </div>
      )}

      <p className="mt-4 text-base font-medium text-slate-900">{question}</p>

      {choices.revealCount && !submitted && (
        <p className="mt-1 text-xs text-slate-500">
          Choose {correct.size} answer{correct.size === 1 ? '' : 's'}.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {choices.options.map((option, i) => {
          const chosen = picked.has(i);
          const isCorrect = correct.has(i);

          let tone = 'bg-white ring-slate-200';
          if (!submitted && chosen) tone = 'bg-slate-900/5 ring-slate-900';
          if (submitted && isCorrect) tone = 'bg-emerald-50 ring-emerald-300';
          if (submitted && chosen && !isCorrect) tone = 'bg-rose-50 ring-rose-300';

          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={submitted}
                className={`w-full rounded-xl p-3 text-left ring-1 transition active:scale-[0.99] disabled:active:scale-100 ${tone}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 ${
                      chosen ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-300'
                    }`}
                  >
                    {chosen && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-slate-800">{option}</span>
                  {submitted && isCorrect && (
                    <span className="shrink-0 text-xs font-semibold text-emerald-700">correct</span>
                  )}
                </div>

                {/* Every rationale, not just the chosen one — knowing why a
                    distractor is wrong is most of what there is to learn. */}
                {submitted && choices.rationales[i] && (
                  <p className="mt-2 border-t border-slate-200/70 pt-2 text-xs text-slate-600">
                    {choices.rationales[i]}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {!submitted ? (
        <button
          type="button"
          onClick={submit}
          disabled={picked.size === 0}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
        >
          Check
        </button>
      ) : (
        <div className="mt-5">
          <p
            className={`text-sm font-semibold ${isRight ? 'text-emerald-700' : 'text-rose-700'}`}
          >
            {isRight ? 'Right.' : 'Not quite — read the rationales above.'}
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
