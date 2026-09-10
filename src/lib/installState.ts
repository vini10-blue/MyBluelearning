/**
 * Detect whether the PWA is currently running as an installed home-screen app
 * vs. a regular browser tab, and whether the install hint should be shown.
 *
 * iOS Safari quirks:
 *  - It does NOT support `beforeinstallprompt`. The only way to install on
 *    iOS is the user manually picking Share → Add to Home Screen.
 *  - When running from the home-screen icon, `(navigator as any).standalone`
 *    is `true`.
 *  - Outside the home-screen mode, no API tells us "the user has installed it
 *    but is currently in Safari" — we can only show or hide the hint based on
 *    the current mode.
 *
 * The install hint matters here because study happens in dead time — on a
 * commute, in a queue — and an app behind two Safari taps does not get opened
 * in those moments. Installed also means the offline app shell is available
 * when the network is not.
 */

import { STORAGE_KEYS } from './storageKeys';

const DISMISSED_KEY = STORAGE_KEYS.installHintDismissed;

export interface InstallState {
  /** App is running as an installed PWA (standalone display mode). */
  isStandalone: boolean;
  /** Best-effort: user is on iOS Safari (where install requires Share → Add to Home Screen). */
  isIOSSafari: boolean;
  /** User has dismissed the install hint at least once. */
  isDismissed: boolean;
}

export function getInstallState(): InstallState {
  return {
    isStandalone: detectStandalone(),
    isIOSSafari: detectIOSSafari(),
    isDismissed: isDismissed(),
  };
}

/** True when the page is running as a home-screen PWA (any platform). */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Modern browsers (Android Chrome, desktop Chromium) — display-mode media query.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari — non-standard `standalone` on navigator.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function detectIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  if (!isIOS) return false;
  // Reject in-app browsers (Instagram, Gmail, etc.) — Add-to-Home-Screen
  // doesn't reach the underlying Safari from inside those, so the hint
  // would be misleading.
  if (/CriOS|FxiOS|EdgiOS|Instagram|FBAN|FBAV|Line/.test(ua)) return false;
  return true;
}

function isDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(DISMISSED_KEY) === '1';
}

export function dismissInstallHint() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DISMISSED_KEY, '1');
}

export function resetInstallHint() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DISMISSED_KEY);
}
