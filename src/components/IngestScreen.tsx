import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IngestError,
  fileToBase64,
  kindForUrl,
  runItemsPass,
  runProcessPass,
} from '../lib/ingestClient';
import type { ProcessPassResponse, SourceRefInput } from '../lib/ingestClient';
import { savePack } from '../lib/packStore';
import type { CoursePack, Item } from '../lib/types';
import { validateCoursePack } from '../lib/validateCoursePack';
import type { ValidationReport } from '../lib/validateCoursePack';

/**
 * Add a source and turn it into a course pack.
 *
 * The screen is shaped around one decision point. After pass 1 the learner
 * sees the process model — every node's definition and reasoning, the
 * verification numbers, what the guard dropped — and only then chooses whether
 * to spend a second model call generating drills against it. Judging the map
 * before the drills exist is the cheapest moment to reject a bad ingest, and
 * the only moment before wrong answer keys can be created.
 */

type Phase =
  | { kind: 'input' }
  | { kind: 'pass1' }
  | { kind: 'review'; pass1: ProcessPassResponse; report: ValidationReport }
  | { kind: 'pass2'; pass1: ProcessPassResponse; report: ValidationReport }
  | { kind: 'done'; pack: CoursePack; report: ValidationReport; unverifiable: string; itemsDropped: number }
  | { kind: 'error'; message: string; code: string; requestId?: string; retry: Phase };

const DEFAULT_PDF_WINDOW = 25;

export function IngestScreen() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pageFrom, setPageFrom] = useState(1);

  async function startPass1() {
    let source: SourceRefInput;
    try {
      if (file) {
        source = {
          kind: 'user-pdf',
          origin: file.name,
          title: title.trim() || file.name.replace(/\.pdf$/i, ''),
          dataBase64: await fileToBase64(file),
          pageFrom,
          pageTo: pageFrom + DEFAULT_PDF_WINDOW - 1,
        };
      } else {
        const trimmed = url.trim();
        if (!trimmed) return;
        const kind = kindForUrl(trimmed);
        source = {
          kind,
          origin: trimmed,
          title: title.trim() || trimmed.split('/').pop() || 'SAP Help',
          ...(kind === 'sap-help-pdf'
            ? { pageFrom, pageTo: pageFrom + DEFAULT_PDF_WINDOW - 1 }
            : {}),
        };
      }
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message, code: 'file', retry: { kind: 'input' } });
      return;
    }

    setPhase({ kind: 'pass1' });
    try {
      const pass1 = await runProcessPass(source);
      // Validate the process on its own so the learner sees what the guard
      // makes of it before any items exist.
      const report = validateCoursePack({
        id: crypto.randomUUID(),
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        sources: pass1.sources,
        process: pass1.process,
        items: [],
      });
      if (!report) {
        setPhase({ kind: 'error', message: 'The response could not be validated.', code: 'validate', retry: { kind: 'input' } });
        return;
      }
      setPhase({ kind: 'review', pass1, report });
    } catch (e) {
      setPhase(toError(e, { kind: 'input' }));
    }
  }

  async function startPass2(pass1: ProcessPassResponse, report: ValidationReport) {
    setPhase({ kind: 'pass2', pass1, report });
    try {
      // Generate against the VALIDATED process, not the raw one — items must
      // not reference nodes the guard removed.
      const pass2 = await runItemsPass(report.pack.process, pass1.chunks);
      const full = validateCoursePack({
        ...report.pack,
        items: pass2.items as Item[],
      });
      if (!full) {
        setPhase({ kind: 'error', message: 'The items could not be validated.', code: 'validate', retry: { kind: 'review', pass1, report } });
        return;
      }
      setPhase({
        kind: 'done',
        pack: full.pack,
        report: full,
        unverifiable: pass2.unverifiable,
        itemsDropped: pass2.items.length - full.pack.items.length,
      });
    } catch (e) {
      setPhase(toError(e, { kind: 'review', pass1, report }));
    }
  }

  function save(pack: CoursePack) {
    if (!savePack(pack)) {
      setPhase({ kind: 'error', message: 'Storage is full — the pack could not be saved on this device.', code: 'quota', retry: { kind: 'input' } });
      return;
    }
    navigate(`/pack/${pack.id}/map`);
  }

  return (
    <main className="min-h-full px-5 pt-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto w-full max-w-md">
        <Link to="/" className="text-sm font-medium text-slate-500 hover:text-slate-700">← Packs</Link>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Add a source</h1>

        {phase.kind === 'input' && (
          <div className="mt-5 space-y-4">
            <Field label="SAP Help URL">
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); if (e.target.value) setFile(null); }}
                placeholder="https://help.sap.com/docs/…"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-500">
                A page, or a PDF bundle. Only help.sap.com can be fetched — anything else, upload it below.
              </p>
            </Field>

            <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-400">or</p>

            <Field label="Upload a PDF">
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setUrl(''); }}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white"
              />
              {file && <p className="mt-1 text-xs text-slate-500">{file.name}</p>}
            </Field>

            {(file || kindForUrl(url) === 'sap-help-pdf') && (
              <Field label={`Start page (${DEFAULT_PDF_WINDOW} pages per run)`}>
                <input
                  type="number"
                  min={1}
                  value={pageFrom}
                  onChange={(e) => setPageFrom(Math.max(1, Number(e.target.value) || 1))}
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Big bundles are ingested a window at a time. Each run makes one pack.
                </p>
              </Field>
            )}

            <Field label="Title (optional)">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. EWM inbound — goods receipt to putaway"
                className={inputCls}
              />
            </Field>

            <button
              type="button"
              onClick={startPass1}
              disabled={!url.trim() && !file}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              Build the process model
            </button>
            <p className="text-xs text-slate-500">
              Step 1 of 2. You will see the model and its verification before any drills are written.
            </p>
          </div>
        )}

        {(phase.kind === 'pass1' || phase.kind === 'pass2') && (
          <Busy
            title={phase.kind === 'pass1' ? 'Reading the source…' : 'Writing drills…'}
            detail={
              phase.kind === 'pass1'
                ? 'Fetching, chunking, and building the process model. Up to a few minutes.'
                : 'Generating items against the approved model and checking every quote.'
            }
          />
        )}

        {phase.kind === 'review' && (
          <ReviewProcess
            pass1={phase.pass1}
            report={phase.report}
            onApprove={() => startPass2(phase.pass1, phase.report)}
            onDiscard={() => setPhase({ kind: 'input' })}
          />
        )}

        {phase.kind === 'done' && (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pack ready</p>
              <h2 className="mt-1 text-base font-semibold text-slate-900">{phase.pack.process.title}</h2>
              <p className="mt-2 text-sm text-slate-600">
                {phase.pack.process.nodes.length} steps · {phase.pack.items.length} items
                {phase.itemsDropped > 0 && ` · ${phase.itemsDropped} item${phase.itemsDropped === 1 ? '' : 's'} dropped by the guard`}
              </p>
            </div>

            <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
              <p className="text-xs font-semibold text-amber-900">Read before drilling</p>
              <p className="mt-1 text-xs text-amber-800">{phase.unverifiable}</p>
              <p className="mt-1 text-xs text-amber-800">
                Quotes were checked. Answer keys were not — mark anything wrong the moment you see it.
              </p>
            </div>

            <Dropped report={phase.report} />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => save(phase.pack)}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98]"
              >
                Save and open
              </button>
              <button
                type="button"
                onClick={() => setPhase({ kind: 'input' })}
                className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="mt-5 rounded-2xl bg-rose-50 p-5 ring-1 ring-rose-200">
            <p className="text-sm font-semibold text-rose-800">That didn&rsquo;t work</p>
            <p className="mt-2 text-sm text-rose-700">{phase.message}</p>
            <p className="mt-2 font-mono text-[11px] text-rose-500">
              {phase.code}{phase.requestId ? ` · ${phase.requestId}` : ''}
            </p>
            <button
              type="button"
              onClick={() => setPhase(phase.retry)}
              className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98]"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * The decision point. Everything the learner needs to judge the map is here:
 * the verification numbers, what the guard dropped and why, and every node's
 * definition and reasoning with its origin visible.
 */
function ReviewProcess({
  pass1,
  report,
  onApprove,
  onDiscard,
}: {
  pass1: ProcessPassResponse;
  report: ValidationReport;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const v = pass1.verification;
  const proc = report.pack.process;
  const fatal = report.fatal.length > 0;

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 1 of 2 · process model</p>
        <h2 className="mt-1 text-base font-semibold text-slate-900">{proc.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{proc.summary}</p>

        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <Stat label="Steps kept" value={`${proc.nodes.length}`} />
          <Stat label="Quotes located" value={`${v.citationsFound}/${v.citationsTotal}`} />
          <Stat label="T-codes / paths located" value={`${v.tokensFound ?? 0}/${v.tokensTotal ?? 0}`} />
          <Stat label="Path steps" value={`${proc.happyPath.length}`} />
        </dl>

        {pass1.pageWindow && (
          <p className="mt-3 text-xs text-slate-500">
            Pages {pass1.pageWindow.pageFrom}–{pass1.pageWindow.pageTo} of {pass1.pageWindow.totalPages}.
          </p>
        )}
        {v.citationsTotal > 0 && v.citationsFound / v.citationsTotal < 0.5 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Fewer than half the quotes were found in the source. The model may be paraphrasing —
            what survived is trustworthy, but expect a thin pack.
          </p>
        )}
      </div>

      <Dropped report={report} />

      <div className="space-y-2">
        {proc.nodes.map((n) => (
          <div key={n.id} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-900">{n.label}</p>
            <p className="mt-1 text-xs text-slate-600">{n.what.text}</p>
            <p className="mt-2 rounded-md border border-dashed border-violet-300 bg-violet-50/60 p-2 text-xs text-violet-950">
              <span className="font-semibold">Why: </span>{n.why.text}
              <span className="ml-1 text-[10px] text-violet-700">
                ({n.why.origin === 'stated' ? 'stated' : "Claude's reading"})
              </span>
            </p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={fatal}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
        >
          Looks right — write drills
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
        >
          Discard
        </button>
      </div>
      {fatal && (
        <p className="text-xs text-rose-700">
          This model cannot be used as-is — see the problems above. Try a different page or window.
        </p>
      )}
    </div>
  );
}

function Dropped({ report }: { report: ValidationReport }) {
  if (report.fatal.length === 0 && report.dropped.length === 0) return null;
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      {report.fatal.length > 0 && (
        <>
          <p className="text-xs font-semibold text-rose-700">Cannot use this model</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-rose-700">
            {report.fatal.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </>
      )}
      {report.dropped.length > 0 && (
        <>
          <p className={`text-xs font-semibold text-slate-700 ${report.fatal.length > 0 ? 'mt-3' : ''}`}>
            Removed by the guard ({report.dropped.length})
          </p>
          <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">
            {report.dropped.slice(0, 12).map((d, i) => <li key={i}>{d}</li>)}
            {report.dropped.length > 12 && <li>…and {report.dropped.length - 12} more</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function Busy({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-5 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
      <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" aria-hidden="true" />
      <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border-0 bg-white p-2.5 text-sm text-slate-800 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-500';

function toError(e: unknown, retry: Phase): Phase {
  if (e instanceof IngestError) {
    return { kind: 'error', message: e.message, code: e.code, requestId: e.requestId, retry };
  }
  return { kind: 'error', message: e instanceof Error ? e.message : 'Unknown error', code: 'unknown', retry };
}
