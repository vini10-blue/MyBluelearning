import { Link } from 'react-router-dom';

/**
 * Honest placeholder for modes that are routed but not implemented.
 *
 * Deliberately not a fake screen: a study app that shows plausible-looking
 * content it cannot actually source is the same failure as an uncited drill
 * item. Better to say plainly what is missing.
 */
export function NotBuiltYet({ mode }: { mode: string }) {
  return (
    <main className="min-h-full px-5 py-10">
      <div className="mx-auto w-full max-w-md text-center">
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-900">{mode} is not built yet</p>
          <p className="mt-2 text-sm text-slate-600">
            The route exists so the navigation and deep links are real, but this mode
            has no implementation behind it.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white active:scale-[0.98] transition"
          >
            Back
          </Link>
        </div>
      </div>
    </main>
  );
}
