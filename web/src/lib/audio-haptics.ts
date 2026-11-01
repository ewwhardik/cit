"use client";

/**
 * Pure Web Audio micro-synthesizer for tactile dashboard haptics.
 * Uses native oscillators and exponential decay envelopes: 0 audio assets, 0 KB payload.
 * Safely guards against SSR or blocked audio permissions.
 */

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Soft mechanical click for scrubbing time periods (880 Hz with 12ms exponential decay). */
export function playTick(enabled = true) {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.012);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.013);
  } catch {
    // Ignored if user hasn't interacted with page yet
  }
}

/** Harmonic blip when focusing or clicking a campus building pod. */
export function playBlip(enabled = true) {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const freq of [523.25, 659.25]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.036);
    }
  } catch {}
}

/** Acoustic confirmation chime when jumping back to live slot. */
export function playChime(enabled = true) {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.04;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.025, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.095);
    });
  } catch {}
}
