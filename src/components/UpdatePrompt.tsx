import { useRegisterSW } from 'virtual:pwa-register/react';

/** Re-check for a new build at most this often (ms). */
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

/**
 * Ask the browser to re-fetch the service worker script. iOS only checks on
 * its own during a real navigation — and a standalone PWA resumed from the
 * app switcher never navigates — so without these explicit checks the app
 * can serve a stale build for weeks. Called on registration, hourly, and
 * every time the app returns to the foreground.
 */
function scheduleUpdateChecks(registration: ServiceWorkerRegistration) {
  let lastCheck = Date.now();
  const check = () => {
    lastCheck = Date.now();
    registration.update().catch(() => {
      // Offline or transient network failure — the next check will retry.
    });
  };

  setInterval(check, UPDATE_CHECK_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    // Throttle foreground checks so rapid app-switching doesn't spam requests.
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60_000) {
      check();
    }
  });
}

/**
 * Tiny non-intrusive banner that appears when a new build is downloaded but
 * not yet active. Tapping "Reload" calls updateServiceWorker() which swaps
 * the waiting SW into control and reloads the page with fresh assets.
 *
 * vite-plugin-pwa is configured with registerType: 'prompt' (vite.config.ts),
 * so without this component the new SW would sit waiting forever and the
 * user would keep seeing the cached old version on every visit.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) scheduleUpdateChecks(registration);
    },
    onRegisterError(error) {
      // eslint-disable-next-line no-console
      console.error('[pwa] SW registration failed', error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-900 text-white text-sm font-medium pl-4 pr-2 py-2 shadow-lg ring-1 ring-black/10">
        <span>New version available</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-full bg-white text-slate-900 text-xs font-semibold px-3 py-1.5 hover:bg-slate-100 active:scale-[0.98] transition"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          aria-label="Dismiss update prompt"
          className="rounded-full text-slate-400 hover:text-white hover:bg-white/10 px-2 py-1 transition"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
