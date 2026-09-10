import { useEffect } from 'react';

/**
 * Shared modal chrome, factored out of every full-screen dialog:
 *  - lock background page scroll while the modal is mounted
 *  - close on Escape, unless `escapeDisabled` (e.g. mid-save, so a half-sent
 *    request doesn't leave the user unsure whether it completed)
 *
 * Pass whatever close callback the modal uses (onClose / onCancel).
 */
export function useModalChrome(
  onClose: () => void,
  escapeDisabled = false,
): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !escapeDisabled) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, escapeDisabled]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}
