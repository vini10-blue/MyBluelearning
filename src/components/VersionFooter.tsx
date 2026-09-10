/** Single source of truth for the displayed app version. */
export const APP_VERSION = 'MyBlueLearning · Blue Lagoon Consulting · v0.1.0';

/** Build identifier injected at build time (short git commit on Vercel). */
export const BUILD_ID =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** App version line shown at the bottom of every screen. The build id makes
 *  it possible to tell at a glance whether a device is running the latest
 *  deploy — the whole point, given how sticky the iOS PWA cache is. */
export function VersionFooter() {
  return (
    <footer className="px-6 pt-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-center text-xs text-slate-400">
      {APP_VERSION} · {BUILD_ID}
    </footer>
  );
}
