/**
 * All localStorage keys used by the app, in one place.
 *
 * Namespaced under `mybluelearning:` so this app and the expenses app can be
 * installed side by side without one clearing the other's state — they are
 * different origins in production, but share localhost:5173 in dev.
 */
export const STORAGE_KEYS = {
  lastEmail: 'mybluelearning:last-email',
  installHintDismissed: 'mybluelearning:install-hint-dismissed',
  /** Id of the pack the learner was last studying, for resuming on open. */
  lastPack: 'mybluelearning:last-pack',
  /** Audio narration on/off, and rate. */
  audioPrefs: 'mybluelearning:audio-prefs',
  /**
   * The learner's judgements about generated content being wrong. Deliberately
   * separate from pack storage: packs get regenerated, verdicts must not.
   */
  contentFlags: 'mybluelearning:content-flags',
} as const;
