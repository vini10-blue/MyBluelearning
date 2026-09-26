import { REQUIRED_VARS } from '../lib/appConfig';
import { APP_VERSION, BUILD_ID } from './VersionFooter';

/**
 * Shown instead of a blank page when the deployment has no MSAL configuration.
 *
 * Says exactly which variables are missing, by their real names, because the
 * person reading this is standing in the Vercel settings page trying to work
 * out what they typed wrong. Nothing here is a secret: client and tenant ids
 * are public by design, and the app URL is the page they are looking at.
 */
export function ConfigMissing({ missing }: { missing: string[] }) {
  return (
    <main className="min-h-full flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Not configured yet
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          The app built and deployed, but it has no sign-in configuration, so it
          cannot start. This is expected on a first deploy.
        </p>

        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Missing environment variables
          </p>
          <ul className="mt-2 space-y-1.5">
            {REQUIRED_VARS.map((name) => {
              const isMissing = missing.includes(name);
              return (
                <li key={name} className="flex items-center gap-2 font-mono text-xs">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      isMissing ? 'bg-rose-500' : 'bg-emerald-500'
                    }`}
                    aria-hidden="true"
                  />
                  <span className={isMissing ? 'text-rose-700' : 'text-slate-500'}>
                    {name}
                  </span>
                </li>
              );
            })}
          </ul>

          <ol className="mt-4 list-decimal space-y-1 pl-4 text-xs text-slate-600">
            <li>Vercel → this project → Settings → Environment Variables.</li>
            <li>Add each missing name above, for Production, Preview and Development.</li>
            <li>Deployments → latest → Redeploy, with build cache off.</li>
          </ol>
          <p className="mt-3 text-[11px] text-slate-400">
            Values only take effect on a new build; editing them does not change this
            deployment.
          </p>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          {APP_VERSION} · {BUILD_ID}
        </p>
      </div>
    </main>
  );
}
