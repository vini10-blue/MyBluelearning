import { useMsal } from '@azure/msal-react';
import { useState } from 'react';
import { loginRequest } from '../auth/msal';
import { STORAGE_KEYS } from '../lib/storageKeys';
import { APP_VERSION } from './VersionFooter';

interface SignInScreenProps {
  bootError: string | null;
}

/** Landing screen shown to anyone not signed in. */
export function SignInScreen({ bootError }: SignInScreenProps) {
  const { instance } = useMsal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      let loginHint: string | undefined;
      try {
        loginHint = localStorage.getItem(STORAGE_KEYS.lastEmail) ?? undefined;
      } catch {
        // localStorage may be unavailable in private mode — fall back to no hint.
      }
      await instance.loginRedirect({ ...loginRequest, loginHint });
      // Redirect navigates away; setBusy(false) only runs on error below.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setBusy(false);
    }
  }

  function handleReset() {
    // Wipe ALL site storage — MSAL keys, any stuck interaction locks,
    // service worker caches, the lot — and reload from scratch.
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore — some browsers throw if storage is disabled
    }
    if ('caches' in window) {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .finally(() => location.replace(location.pathname));
    } else {
      location.replace(location.pathname);
    }
  }

  const displayError = error ?? bootError;

  return (
    <main className="min-h-full flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          MyBlueLearning
        </h1>
        <p className="mt-1 text-sm text-slate-500">Understand the process, not the flashcard.</p>

        <div className="mt-10 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-6">
          <p className="text-sm text-slate-700">
            Sign in with your Blue Lagoon work account to reach your course packs.
          </p>

          <button
            type="button"
            onClick={handleSignIn}
            disabled={busy}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0067b8] px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-[#005ba1] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            <MicrosoftLogo />
            {busy ? 'Redirecting…' : 'Sign in with Microsoft'}
          </button>

          {displayError && (
            <div className="mt-5 rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3 text-left">
              <p className="text-xs font-semibold text-rose-700">
                {bootError ? 'Auth setup error' : 'Sign-in error'}
              </p>
              <p className="mt-1 text-xs text-rose-600 whitespace-pre-wrap break-words">
                {displayError}
              </p>
              <button
                type="button"
                onClick={handleReset}
                className="mt-3 text-xs font-medium text-rose-700 underline underline-offset-2 hover:text-rose-900"
              >
                Reset &amp; try again
              </button>
            </div>
          )}
        </div>

        <p className="mt-8 text-xs text-slate-400">{APP_VERSION}</p>
      </div>
    </main>
  );
}

/** Microsoft 4-square logo, inline SVG so we don't need an asset roundtrip. */
function MicrosoftLogo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 23 23"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}
