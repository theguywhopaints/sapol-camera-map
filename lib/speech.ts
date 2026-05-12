// Queued speech synthesis — one utterance at a time, no overlap
let queue: SpeechSynthesisUtterance[] = [];
let busy = false;

function flush() {
  if (busy || !queue.length || typeof window === 'undefined') return;
  const u = queue.shift()!;
  busy = true;
  u.onend = () => { busy = false; flush(); };
  u.onerror = () => { busy = false; flush(); };
  window.speechSynthesis.speak(u);
}

function make(text: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-AU';
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1.0;
  return u;
}

export function speak(text: string, interrupt = false): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (interrupt) {
    window.speechSynthesis.cancel();
    busy = false;
    queue = [make(text)];
  } else {
    queue.push(make(text));
  }
  flush();
}

export function cancelSpeech(): void {
  if (typeof window === 'undefined') return;
  window.speechSynthesis.cancel();
  queue = [];
  busy = false;
}

// Call inside a user-gesture handler to pre-unlock speech on iOS
export function unlockSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  u.rate = 10;
  window.speechSynthesis.speak(u);
}

// Format km as natural-language distance for speech
export function spokenDistance(km: number): string {
  if (km <= 0.15) return 'ahead';
  if (km < 1) {
    const m = Math.round(km * 1000 / 100) * 100;
    return `${m} metres`;
  }
  const k = Math.round(km * 2) / 2; // nearest 0.5km
  return k === 1 ? 'one kilometre' : `${k} kilometres`;
}
