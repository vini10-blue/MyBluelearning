/**
 * localStorage.setItem that never throws.
 *
 * Returns true on success, false when storage is unavailable (private mode)
 * or full (quota exceeded). On quota exhaustion it logs a single clear
 * warning, so a silent data-loss bug — a customer or form preference that
 * looked saved but wasn't — is at least visible in the console instead of
 * vanishing without trace.
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    const quotaExceeded =
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.code === 22);
    // eslint-disable-next-line no-console
    console.warn(
      quotaExceeded
        ? `[storage] quota exceeded — "${key}" was NOT saved. Free browser storage and retry.`
        : `[storage] could not write "${key}" (storage unavailable).`,
    );
    return false;
  }
}
