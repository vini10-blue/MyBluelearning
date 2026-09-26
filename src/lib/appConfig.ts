/**
 * Read the browser-side configuration before anything MSAL-related loads.
 *
 * `src/auth/msal.ts` throws at import time when its env vars are missing, and
 * ES imports are hoisted — so any module that statically imports it takes the
 * whole app down before React can mount, and the user sees a blank page. That
 * is the first thing anyone hits on a fresh deploy with the env vars not yet
 * set, and a blank page reads as "broken", not "unconfigured".
 *
 * This module has no imports of its own, so it is safe to evaluate first.
 */

export const REQUIRED_VARS = ['VITE_MSAL_CLIENT_ID', 'VITE_MSAL_TENANT_ID', 'VITE_APP_URL'] as const;

export type AppConfigCheck = { ok: true } | { ok: false; missing: string[] };

export function checkAppConfig(): AppConfigCheck {
  const env = import.meta.env as Record<string, string | undefined>;
  const missing = REQUIRED_VARS.filter((k) => !env[k] || env[k]?.trim() === '');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
