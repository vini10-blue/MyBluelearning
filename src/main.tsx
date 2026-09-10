import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { msalInstance } from './auth/msal';
import './index.css';

/**
 * Boot order matters here. After Microsoft redirects back to the app,
 * MSAL processes the auth response inside `handleRedirectPromise()` and
 * emits `LOGIN_SUCCESS`. If our event callback is registered AFTER that
 * runs, we miss the event and the active account never gets set.
 *
 * If `handleRedirectPromise()` throws (most commonly: a stale
 * `interaction_in_progress` lock left over from a previous broken
 * sign-in attempt), we MUST NOT let it crash the page — wrap in
 * try/catch, surface the error in the UI, and let the user click
 * "Reset & try again" to wipe MSAL's localStorage and start over.
 *
 * Ported verbatim from expenses-app, where this ordering was arrived at the
 * hard way. Do not reorder.
 */

msalInstance.addEventCallback((event) => {
  if (
    event.eventType === EventType.LOGIN_SUCCESS &&
    event.payload &&
    typeof event.payload === 'object' &&
    'account' in event.payload &&
    event.payload.account
  ) {
    msalInstance.setActiveAccount(event.payload.account);
  }
});

let bootError: string | null = null;

try {
  await msalInstance.initialize();
  await msalInstance.handleRedirectPromise();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[Auth bootstrap failed]', e);
  bootError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

// Returning user, no fresh redirect — promote cached account to active.
if (!msalInstance.getActiveAccount()) {
  const cached = msalInstance.getAllAccounts();
  if (cached.length > 0) {
    msalInstance.setActiveAccount(cached[0]);
  }
}

// Defense-in-depth: when no account is signed in, ensure no stale MSAL token
// entries linger in localStorage from a previous (possibly broken) session.
// Runs only while logged out, so it cannot disrupt an active session.
if (!msalInstance.getActiveAccount() && msalInstance.getAllAccounts().length === 0) {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('msal.')) localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable (private mode) — nothing to clean up.
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MsalProvider instance={msalInstance}>
      <BrowserRouter>
        <App bootError={bootError} />
      </BrowserRouter>
    </MsalProvider>
  </StrictMode>,
);
