import { useState } from 'react';
import { flagContent, isFlagged, unflagContent } from '../lib/contentFlags';
import type { ContentFlag } from '../lib/types';

interface FlagButtonProps {
  packId: string;
  targetId: string;
  targetKind: ContentFlag['targetKind'];
  /** Called after a flag changes so the parent can re-read and re-render. */
  onChange: () => void;
}

/**
 * "This is wrong" — the one accuracy control that uses the learner's expertise.
 *
 * Deliberately low-friction. A reason is invited but not required: the value is
 * in the content being removed the moment he knows it is wrong, and demanding
 * an explanation first is how a correction gets postponed and then forgotten.
 * The reason, when given, is what a regeneration would need in order to not
 * make the same mistake again.
 */
export function FlagButton({ packId, targetId, targetKind, onChange }: FlagButtonProps) {
  const existing = isFlagged(packId, targetId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (existing) {
    return (
      <div className="mt-4 rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
        <p className="text-xs font-semibold text-rose-800">You marked this wrong</p>
        {existing.reason && (
          <p className="mt-1 text-xs text-rose-700">&ldquo;{existing.reason}&rdquo;</p>
        )}
        <button
          type="button"
          onClick={() => {
            unflagContent(packId, targetId);
            onChange();
          }}
          className="mt-2 text-xs font-medium text-rose-700 underline underline-offset-2 hover:text-rose-900"
        >
          Undo
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-rose-700"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />
        </svg>
        This is wrong
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <label htmlFor={`flag-${targetId}`} className="text-xs font-medium text-slate-700">
        What&rsquo;s wrong with it? (optional)
      </label>
      <textarea
        id={`flag-${targetId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. bin determination happens at task creation, not after"
        className="mt-1.5 w-full rounded-lg border-0 bg-white p-2 text-xs text-slate-800 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-500"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            flagContent(packId, targetId, targetKind, reason);
            setOpen(false);
            setReason('');
            onChange();
          }}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white active:scale-[0.98] transition"
        >
          Mark wrong
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason('');
          }}
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
