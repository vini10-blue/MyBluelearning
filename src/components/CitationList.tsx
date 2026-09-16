import { useState } from 'react';
import type { Citation } from '../lib/types';

interface CitationListProps {
  citations: Citation[];
  /**
   * What these passages are doing.
   *
   * `source` — the documentation states the claim above; the quote is evidence.
   * `support` — the claim above is Claude's reasoning and these are the
   *   passages it drew on. They give the reader something to judge the
   *   inference against; they do not establish it.
   *
   * The distinction is the whole point of the sourced/synthesis split, so the
   * copy differs rather than reusing one neutral label for both.
   */
  role?: 'source' | 'support';
}

/**
 * Renders the passages behind a claim.
 *
 * A quote that could not be located in the cited document gets amber chrome and
 * says so in plain words. It is not called "unverified", which invited the
 * reader to hear "not yet checked" when the accurate reading is "this text was
 * not found where it claims to come from".
 */
export function CitationList({ citations, role = 'source' }: CitationListProps) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;

  const missing = citations.filter((c) => !c.quoteFound).length;
  const label =
    role === 'support'
      ? `${citations.length} supporting passage${citations.length === 1 ? '' : 's'}`
      : `${citations.length} source${citations.length === 1 ? '' : 's'}`;

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
        {label}
        {missing > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
            {missing} not found
          </span>
        )}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {citations.map((c, i) => (
            <li
              key={i}
              className={`rounded-lg p-3 text-xs ring-1 ${
                c.quoteFound ? 'bg-slate-50 ring-slate-200' : 'bg-amber-50 ring-amber-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-slate-700">{c.sourceTitle}</span>
                {!c.quoteFound && (
                  <span className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                    not found
                  </span>
                )}
              </div>
              <p className="mt-1 text-slate-500">{c.locator}</p>
              <p className="mt-2 italic text-slate-600">&ldquo;{c.quote}&rdquo;</p>
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-medium text-blue-700 underline underline-offset-2"
                >
                  Read it on SAP Help
                </a>
              )}
              {!c.quoteFound && (
                <p className="mt-2 text-[11px] text-amber-800">
                  This wording could not be located in the document it cites. Treat the
                  claim above as unsupported until you have checked the page yourself.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
