import { useState } from 'react';
import type { BreakItem } from '../lib/types';
import { playCorrect, playWrong } from '../lib/drillFeedback';

interface BreakDrillProps {
  item: BreakItem;
  onResolved: (correct: boolean) => void;
}

/**
 * Diagnose a failure, one step at a time.
 *
 * The most valuable drill type here and the closest to the certification's own
 * scenario format: read a situation, decide what it means, decide what to do.
 *
 * What makes it teach rather than test is `outcomes`. After a choice, the
 * screen says what the learner would OBSERVE as a result — including for wrong
 * choices, which is where the value is. Being told "incorrect" ends the
 * thought; being told "the task is created but lands in the wrong storage type"
 * continues it. The step still records right/wrong for scoring, but the
 * consequence is what is shown first and largest.
 */
export function BreakDrill({ item, onResolved }: BreakDrillProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [wrongSteps, setWrongSteps] = useState(0);

  const step = item.steps[stepIndex];
  const isLast = stepIndex === item.steps.length - 1;
  const correct = new Set(step.choices.correctIndices);

  function choose(i: number) {
    if (picked !== null) return;
    setPicked(i);
    if (correct.has(i)) {
      playCorrect();
    } else {
      playWrong();
      setWrongSteps((n) => n + 1);
    }
  }

  function next() {
    if (isLast) {
      onResolved(wrongSteps === 0);
      return;
    }
    setStepIndex((i) => i + 1);
    setPicked(null);
  }

  return (
    <div>
      <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          What happened
        </p>
        <p className="mt-1 text-sm text-amber-950">{item.scenario}</p>
      </div>

      {item.steps.length > 1 && (
        <p className="mt-4 text-xs font-medium text-slate-400">
          Step {stepIndex + 1} of {item.steps.length}
        </p>
      )}

      <p className="mt-2 text-base font-medium text-slate-900">{step.question}</p>

      <ul className="mt-4 space-y-2">
        {step.choices.options.map((option, i) => {
          const chosen = picked === i;
          const isCorrect = correct.has(i);

          let tone = 'bg-white ring-slate-200';
          if (picked !== null && isCorrect) tone = 'bg-emerald-50 ring-emerald-300';
          if (chosen && !isCorrect) tone = 'bg-rose-50 ring-rose-300';

          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => choose(i)}
                disabled={picked !== null}
                className={`w-full rounded-xl p-3 text-left ring-1 transition active:scale-[0.99] disabled:active:scale-100 ${tone}`}
              >
                <span className="block text-sm text-slate-800">{option}</span>

                {/* The consequence leads. A verdict ends the thought; an
                    observation continues it. */}
                {chosen && step.outcomes[i] && (
                  <span className="mt-2 block border-t border-slate-200/70 pt-2 text-xs text-slate-700">
                    <span className="font-semibold">You would see: </span>
                    {step.outcomes[i]}
                  </span>
                )}
                {picked !== null && !chosen && step.choices.rationales[i] && (
                  <span className="mt-2 block border-t border-slate-200/70 pt-2 text-xs text-slate-500">
                    {step.choices.rationales[i]}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {picked !== null && (
        <button
          type="button"
          onClick={next}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98]"
        >
          {isLast ? 'Finish' : 'Next step'}
        </button>
      )}
    </div>
  );
}
