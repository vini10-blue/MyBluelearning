/**
 * Sound and haptics for drills.
 *
 * Vini asked for the app to feel like a game, and immediate feedback is also
 * the part of deliberate practice with the best evidence behind it — so this is
 * not decoration. It is kept deliberately small: two short tones synthesised on
 * the fly rather than audio assets, so there is nothing to precache and nothing
 * to fail offline.
 *
 * Everything here is best-effort. Audio is blocked until a user gesture on iOS,
 * `vibrate` does not exist on iOS Safari at all, and a browser may refuse an
 * AudioContext entirely. None of that should ever interrupt a drill, so every
 * call is wrapped and failure is silent.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // Safari suspends the context until a gesture; resuming is a no-op if live.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqs: number[], durationMs: number, gain = 0.06): void {
  const ac = audio();
  if (!ac) return;
  try {
    const now = ac.currentTime;
    freqs.forEach((f, i) => {
      const osc = ac.createOscillator();
      const vol = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = now + i * (durationMs / 1000 / freqs.length);
      const end = start + durationMs / 1000 / freqs.length;
      vol.gain.setValueAtTime(0, start);
      vol.gain.linearRampToValueAtTime(gain, start + 0.01);
      vol.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(vol).connect(ac.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    });
  } catch {
    // An audio failure must never interrupt a drill.
  }
}

function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported on iOS Safari; nothing to do.
  }
}

/** Rising third — right. */
export function playCorrect(): void {
  tone([660, 880], 180);
  buzz(12);
}

/**
 * Falling tone — not right.
 *
 * Deliberately gentle. A harsh buzzer punishes the attempt, and the whole
 * feedback design here is that a wrong answer is where the learning happens:
 * the screen shows what would break, not a red cross.
 */
export function playWrong(): void {
  tone([392, 294], 260);
  buzz([18, 40, 18]);
}

/** Short flourish at the end of a run. */
export function playComplete(): void {
  tone([523, 659, 784, 1047], 420);
  buzz([10, 30, 10, 30, 20]);
}
