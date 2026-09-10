import { Link } from 'react-router-dom';
import { listPacks, verificationStatus } from '../lib/packs';
import { VersionFooter } from './VersionFooter';

/** Study home: the packs available, and the ways into each. */
export function HomeScreen() {
  const packs = listPacks();

  return (
    <main className="min-h-full px-5 pt-8 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto w-full max-w-md">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            MyBlueLearning
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Understand the process, not the flashcard.
          </p>
        </header>

        <section className="mt-8 space-y-4">
          {packs.map((pack) => {
            const v = verificationStatus(pack);
            return (
              <article
                key={pack.id}
                className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-5"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {pack.process.module}
                </p>
                <h2 className="mt-1 text-base font-semibold text-slate-900">
                  {pack.process.title}
                </h2>
                <p className="mt-2 text-sm text-slate-600">{pack.process.summary}</p>

                {!v.fullyVerified && (
                  <div className="mt-4 rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3">
                    <p className="text-xs font-semibold text-amber-900">
                      {v.verified} of {v.total} sources verified
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      This pack is a development fixture. Its quotes have not been
                      checked against the live SAP Help pages, and the reasoning on
                      each step is model-authored. Read it to judge the format, not
                      to learn the facts.
                    </p>
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <ModeLink to={`/pack/${pack.id}/map`} label="Map" primary />
                  <ModeLink to={`/pack/${pack.id}/walkthrough`} label="Walkthrough" />
                  <ModeLink to={`/pack/${pack.id}/drill/sequence`} label="Drills" />
                  <ModeLink to={`/pack/${pack.id}/explain`} label="Explain" />
                </div>

                <p className="mt-3 text-xs text-slate-400">
                  {pack.process.nodes.length} steps · {pack.items.length} item
                  {pack.items.length === 1 ? '' : 's'} ·{' '}
                  {pack.process.failureModes.length} known failure modes
                </p>
              </article>
            );
          })}
        </section>

        <div className="mt-6 flex gap-2">
          <Link
            to="/review"
            className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-medium text-white active:scale-[0.98] transition"
          >
            Review queue
          </Link>
          <Link
            to="/ingest"
            className="flex-1 rounded-xl bg-white px-4 py-3 text-center text-sm font-medium text-slate-700 ring-1 ring-slate-200 active:scale-[0.98] transition"
          >
            Add a source
          </Link>
        </div>

        <VersionFooter />
      </div>
    </main>
  );
}

function ModeLink({ to, label, primary }: { to: string; label: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={`rounded-xl px-4 py-3 text-center text-sm font-medium active:scale-[0.98] transition ${
        primary
          ? 'bg-slate-900 text-white'
          : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
      }`}
    >
      {label}
    </Link>
  );
}
