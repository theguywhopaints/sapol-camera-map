let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return ctx;
}

// Call this inside a user-gesture handler to pre-unlock AudioContext on iOS
export function unlockAudio(): void {
  if (typeof window === 'undefined' || !('AudioContext' in window || 'webkitAudioContext' in window)) return;
  try {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
  } catch {
    // ignore
  }
}

// Three ascending tones: short-short-long (like a radar ping)
export function playAlert(): void {
  if (typeof window === 'undefined') return;
  try {
    const c = getCtx();
    const tones: Array<[number, number, number]> = [
      [880,  0.00, 0.10], // A5  — short
      [1100, 0.15, 0.10], // C#6 — short
      [1320, 0.30, 0.22], // E6  — longer
    ];
    const doPlay = () => {
      for (const [freq, start, dur] of tones) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.connect(gain);
        gain.connect(c.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = c.currentTime + start;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.4, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      }
    };
    if (c.state === 'suspended') c.resume().then(doPlay);
    else doPlay();
  } catch {
    // Web Audio unavailable
  }
}
