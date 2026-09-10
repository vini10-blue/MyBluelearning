import { useEffect, useState } from 'react';
import { dismissInstallHint, getInstallState } from '../lib/installState';

/**
 * Dismissible "Add to Home Screen" banner shown on the home screen when:
 *  - The app is open in iOS Safari (not yet installed)
 *  - The user hasn't dismissed it before
 *
 * Why: the iOS Share Target — the highest-quality scan path, using Apple's
 * native document scanner from inside Notes — only shows up in the share
 * sheet once the PWA is installed via Add to Home Screen. Without this hint,
 * a non-technical user would never discover that.
 */
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const state = getInstallState();
    setShow(state.isIOSSafari && !state.isStandalone && !state.isDismissed);
  }, []);

  if (!show) return null;

  function handleDismiss() {
    dismissInstallHint();
    setShow(false);
  }

  return (
    <div className="rounded-2xl bg-sky-50 ring-1 ring-sky-200 p-5 relative mb-6">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-sky-600 hover:text-sky-800 active:scale-95 transition"
        aria-label="Dismiss install hint"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>

      <h2 className="text-sm font-semibold text-sky-900">Install it to actually use it</h2>
      <p className="mt-1 text-xs text-sky-800">
        Add MyBlueLearning to your Home Screen. Study happens in dead time —
        a commute, a queue — and an app behind two Safari taps does not get
        opened in those moments. Installed also means it works offline.
      </p>

      <ol className="mt-3 space-y-2 text-xs text-sky-900">
        <li className="flex gap-2">
          <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-sky-200 text-sky-900 text-[10px] font-semibold">1</span>
          <span>
            Tap{' '}
            <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-white ring-1 ring-sky-200 align-middle">
              <ShareIcon />
            </span>{' '}
            in Safari's bottom toolbar
          </span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-sky-200 text-sky-900 text-[10px] font-semibold">2</span>
          <span>Scroll down and pick <strong>Add to Home Screen</strong></span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-sky-200 text-sky-900 text-[10px] font-semibold">3</span>
          <span>Tap <strong>Add</strong> in the top-right — open MyBlueLearning from your home screen from now on</span>
        </li>
      </ol>

      <button
        type="button"
        onClick={handleDismiss}
        className="mt-3 text-[11px] font-medium text-sky-700 hover:text-sky-900 underline-offset-2 hover:underline"
      >
        Don't show again
      </button>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v12" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}
