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

function playTones(tones: Array<[number, number, number]>, gain: number): void {
  if (typeof window === 'undefined') return;
  try {
    const c = getCtx();
    const doPlay = () => {
      for (const [freq, start, dur] of tones) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.connect(g);
        g.connect(c.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = c.currentTime + start;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
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

// Three ascending tones: short-short-long (like a radar ping)
export function playAlert(): void {
  playTones([
    [880,  0.00, 0.10],
    [1100, 0.15, 0.10],
    [1320, 0.30, 0.22],
  ], 0.4);
}

// Urgent double-burst siren for ≤500m — louder and harder to miss
export function playUrgentAlert(): void {
  playTones([
    // First burst
    [1480, 0.00, 0.12],
    [1760, 0.14, 0.12],
    [1480, 0.28, 0.12],
    [1760, 0.42, 0.12],
    // Second burst (louder repeat)
    [1760, 0.65, 0.14],
    [2093, 0.81, 0.14],
    [1760, 0.97, 0.14],
    [2093, 1.13, 0.22],
  ], 0.72);
}
