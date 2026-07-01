/**
 * Tiny WebAudio SFX engine. All sounds are synthesized (no assets) so the
 * game stays a zero-dependency static build. Respects a persisted mute flag.
 */
const MUTE_KEY = "pulse.muted";

type ToneOpts = {
  freq: number;
  freqTo?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
};

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
  }

  /** Must be called from a user gesture to unlock audio on mobile. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    return this.muted;
  }

  private tone(o: ToneOpts) {
    if (this.muted || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type ?? "square";
    osc.frequency.setValueAtTime(o.freq, now);
    if (o.freqTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, o.freqTo),
        now + o.dur
      );
    }
    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + o.dur + 0.02);
  }

  /** Short blip when passing an obstacle; pitch rises with the combo. */
  pass(combo: number) {
    const step = Math.min(24, combo) * 40;
    this.tone({ freq: 440 + step, dur: 0.08, type: "triangle", gain: 0.22 });
  }

  /** Bright sparkle on a near-miss. */
  nearMiss() {
    this.tone({ freq: 1200, freqTo: 2000, dur: 0.12, type: "sine", gain: 0.2 });
  }

  /** Rising arpeggio-ish sweep on a milestone. */
  milestone() {
    this.tone({ freq: 660, freqTo: 1320, dur: 0.25, type: "sawtooth", gain: 0.25 });
    setTimeout(
      () => this.tone({ freq: 990, freqTo: 1980, dur: 0.2, type: "sine", gain: 0.2 }),
      70
    );
  }

  /** Crunchy noise-ish descending hit. */
  hit() {
    this.tone({ freq: 220, freqTo: 40, dur: 0.4, type: "sawtooth", gain: 0.35 });
    this.tone({ freq: 90, freqTo: 30, dur: 0.5, type: "square", gain: 0.25 });
  }

  /** Soft confirm when a new run starts. */
  start() {
    this.tone({ freq: 330, freqTo: 660, dur: 0.15, type: "triangle", gain: 0.2 });
  }
}
