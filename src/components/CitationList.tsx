import { useState } from 'react';
import type { Citation } from '../lib/types';

/**
 * Renders the sources behind a claim, and makes an unverified one look
 * unverified.
 *
 * The visual distinction is the point. A citation that carries a real SAP URL
 * but an unchecked quote is more dangerous than an obviously missing one,
 * because it reads as authority. Unverified citations therefore get amber
 * chrome and an explicit label rather than a quiet footnote.
 */
export function CitationList({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;

  const unverified = citations.filter((c) => !c.verified).length;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        {citations.length} source{citations.length === 1 ? '' : 's'}
        {unverified > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
            {unverified} unverified
          </span>
        )}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {citations.map((c, i) => (
            <li
              key={i}
              className={`rounded-lg p-3 text-xs ring-1 ${
                c.verified
                  ? 'bg-slate-50 ring-slate-200'
                  : 'bg-amber-50 ring-amber-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-slate-700">{c.sourceTitle}</span>
                {!c.verified && (
                  <span className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                    unverified
                  </span>
                )}
              </div>
              <p className="mt-1 text-slate-500">{c.locator}</p>
              <p className="mt-2 italic text-slate-600">“{c.quote}”</p>
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-medium text-blue-700 underline underline-offset-2"
                >
                  Check on SAP Help
                </a>
              )}
              {!c.verified && (
                <p className="mt-2 text-[11px] text-amber-800">
                  This quote has not been checked against the live page. Confirm it
                  before trusting anything built on it.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
