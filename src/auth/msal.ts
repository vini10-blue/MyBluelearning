import {
  LogLevel,
  PublicClientApplication,
  type Configuration,
  type RedirectRequest,
} from '@azure/msal-browser';

/**
 * MSAL configuration for the Blue Lagoon Consulting tenant.
 *
 * Ported from the expenses-app chassis. Identical shape and identical
 * trade-offs; only the scope rationale below differs.
 *
 * - Single-tenant authority: only Blue Lagoon work accounts can sign in.
 * - SPA flow with PKCE (default in @azure/msal-browser): no client secret in
 *   the browser, no implicit-grant tokens.
 * - localStorage cache: login persists across tabs and PWA cold-starts. The
 *   trade-off vs sessionStorage is XSS exposure; that exposure is contained
 *   by the strict Content-Security-Policy shipped in vercel.json (no inline
 *   scripts, no foreign script origins), which is the realistic XSS vector
 *   for an app of this shape.
 *
 * Why redirect (not popup) flow: popups are flaky on iOS Safari and unfriendly
 * inside a PWA installed to the home screen. Redirect is the only flow that's
 * reliable across iPhone Safari, Android Chrome, and desktop.
 */

const clientId = import.meta.env.VITE_MSAL_CLIENT_ID;
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID;
const rawAppUrl = import.meta.env.VITE_APP_URL;

if (!clientId || !tenantId || !rawAppUrl) {
  // Log the specifics for the developer; show the user something generic.
  // eslint-disable-next-line no-console
  console.error(
    '[MSAL config] Missing env vars —',
    `VITE_MSAL_CLIENT_ID=${clientId ? 'set' : 'missing'}`,
    `VITE_MSAL_TENANT_ID=${tenantId ? 'set' : 'missing'}`,
    `VITE_APP_URL=${rawAppUrl ? 'set' : 'missing'}`,
  );
  throw new Error('App configuration is incomplete. Contact your administrator.');
}

/**
 * Sanity-check the configured app URL. This is ADVISORY ONLY and must never
 * throw: the redirect URI is ultimately enforced by Microsoft Entra, which
 * refuses to redirect to any URI not registered in the app registration. A
 * wrong VITE_APP_URL therefore cannot divert the auth flow — it is worth a
 * console warning, but a hard failure here would brick the whole app at
 * startup before React can mount.
 */
function looksLikeValidAppUrl(url: string): boolean {
  if (url === 'http://localhost:5173') return true;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// Normalize: a trailing slash is a common misconfiguration and is subtly
// wrong as an OAuth redirect URI.
const appUrl: string = rawAppUrl.replace(/\/+$/, '');

if (!looksLikeValidAppUrl(appUrl)) {
  // eslint-disable-next-line no-console
  console.warn('[MSAL config] VITE_APP_URL looks unexpected:', appUrl);
}

/** App origin used as the redirect / post-logout URI. */
export const APP_URL: string = appUrl;

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: APP_URL,
    postLogoutRedirectUri: APP_URL,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      // Quiet in production, surface warnings+ in dev.
      logLevel: import.meta.env.DEV ? LogLevel.Info : LogLevel.Warning,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        const tag = `[MSAL ${LogLevel[level]}]`;
        // eslint-disable-next-line no-console
        if (level === LogLevel.Error) console.error(tag, message);
        else if (level === LogLevel.Warning) console.warn(tag, message);
        else if (import.meta.env.DEV) console.log(tag, message);
      },
      piiLoggingEnabled: false,
    },
  },
};

/**
 * Scopes requested at sign-in.
 * - User.Read: signed-in user's basic profile (name, email) for the UI.
 * - Files.ReadWrite: read/write the user's own OneDrive files. Course packs
 *   (process models + generated items) and study progress are stored as JSON
 *   under a MyBlueLearning folder in Vini's business OneDrive — that is what
 *   gives phone/laptop sync without us running a database.
 * - offline_access: gives us a refresh token so silent re-auth keeps the
 *   session alive without re-prompting Microsoft every hour.
 *
 * If course packs ever need to be shared with other learners, upgrade to
 * `Files.ReadWrite.All` here AND in the Entra portal.
 */
export const loginRequest: RedirectRequest = {
  scopes: ['User.Read', 'Files.ReadWrite', 'offline_access'],
};

/** For silent token acquisition once the user is signed in (Graph API calls). */
export const graphTokenRequest = {
  scopes: ['User.Read', 'Files.ReadWrite'],
};

/**
 * The single MSAL instance for the app. Created here (rather than in main.tsx)
 * so non-React modules — e.g. the /api/ingest client — can import it to
 * acquire tokens. main.tsx is still responsible for initialize() and
 * handleRedirectPromise() before the app renders.
 */
export const msalInstance = new PublicClientApplication(msalConfig);
