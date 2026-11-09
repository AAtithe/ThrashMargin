/**
 * Fireline's sound, synthesised with the Web Audio API. No audio files, for the same reason the art
 * is drawn in code: nothing to license, download, cache or keep in step with the game.
 *
 * - Browsers refuse to start audio before the player has touched the page, so the context is only
 *   created on the first pointer or key press (`unlock`). Until then every `play` is a no-op.
 * - Battle sounds are placed in the world: panned by where they happen on screen and quieter the
 *   further they are from the middle of the view. Fire under the fog is not heard at all, so sound
 *   never gives away what the player cannot see.
 * - A busy battle fires dozens of guns a second. Each sound has a minimum gap and the whole mix a
 *   voice cap, so a firefight reads as a firefight rather than as white noise.
 * - The choice of volume and mute is per browser (`fireline_sound`), like the light/dark choice.
 *
 * Renderer-side only. The simulation never reads anything here, so it stays pure.
 */

export type SoundKind =
  | 'bullet'
  | 'shell'
  | 'rocket'
  | 'artillery'
  | 'boomSmall'
  | 'boomVehicle'
  | 'boomBuilding'
  | 'sold'
  | 'place'
  | 'ready'
  | 'queue'
  | 'denied'
  | 'order'
  | 'select'
  | 'alarm'
  | 'victory'
  | 'defeat'
  // Campaign: hero abilities and support powers.
  | 'infiltrate'
  | 'charge'
  | 'capture'
  | 'levelup'
  | 'recon'
  | 'barrage'
  | 'reinforce'
  // Advanced tech: new weapons, support units and the missile strike.
  | 'flame'
  | 'grenade'
  | 'heal'
  | 'repair'
  | 'missileLaunch'
  | 'missileImpact';

const PREF_KEY = 'fireline_sound';

/** Least time, in ms, between two plays of the same sound. */
const GAP: Record<SoundKind, number> = {
  bullet: 45,
  shell: 70,
  rocket: 90,
  artillery: 120,
  boomSmall: 60,
  boomVehicle: 90,
  boomBuilding: 200,
  sold: 150,
  place: 100,
  ready: 250,
  queue: 40,
  denied: 150,
  order: 80,
  select: 60,
  alarm: 4000,
  victory: 5000,
  defeat: 5000,
  infiltrate: 400,
  charge: 300,
  capture: 400,
  levelup: 600,
  recon: 500,
  barrage: 800,
  reinforce: 1000,
  flame: 140,
  grenade: 90,
  heal: 700,
  repair: 500,
  missileLaunch: 1500,
  missileImpact: 1500,
};

const MAX_VOICES = 24;

export interface SoundPrefs {
  muted: boolean;
  volume: number;
}

export function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { muted: !!p.muted, volume: Math.max(0, Math.min(1, Number(p.volume) || 0)) };
    }
  } catch {
    /* blocked storage: defaults */
  }
  return { muted: false, volume: 0.6 };
}

function savePrefs(p: SoundPrefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SoundKind, number>();
  private voices = 0;
  prefs: SoundPrefs = loadPrefs();
  /** Plays per kind, for the browser checks (read in dev builds through window.__firelineSound). */
  readonly counts: Partial<Record<SoundKind, number>> = {};

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);
    this.applyVolume();
    // One second of white noise, reused by every gun and explosion.
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get unlocked(): boolean {
    return !!this.ctx;
  }

  setPrefs(p: Partial<SoundPrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.master || !this.ctx) return;
    const v = this.prefs.muted ? 0 : this.prefs.volume * 0.7;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /**
   * Plays a sound. `pan` is -1 (left) to 1 (right); `gain` scales it, for distance. Returns whether
   * it actually played (not throttled, not muted, audio unlocked).
   */
  play(kind: SoundKind, pan = 0, gain = 1): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.prefs.muted || this.prefs.volume <= 0 || gain <= 0.02) return false;
    const now = performance.now();
    if (now - (this.last.get(kind) ?? -Infinity) < GAP[kind]) return false;
    if (this.voices >= MAX_VOICES) return false;
    this.last.set(kind, now);
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;

    const out = ctx.createGain();
    out.gain.value = gain;
    let node: AudioNode = out;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(p);
      node = p;
    }
    node.connect(this.master);
    const t = ctx.currentTime + 0.005;
    const dur = this.voice(kind, out, t);
    this.voices++;
    window.setTimeout(() => {
      this.voices--;
      try {
        out.disconnect();
        if (node !== out) node.disconnect();
      } catch {
        /* already gone */
      }
    }, (dur + 0.1) * 1000);
    return true;
  }

  // ---- Building blocks ---------------------------------------------------------------------

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseHit(dest: AudioNode, t: number, o: { type: BiquadFilterType; freq: number; to?: number; q?: number; peak: number; decay: number; attack?: number }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.attack ?? 0.005) + o.decay);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    this.env(g, t, o.peak, o.attack ?? 0.004, o.decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + (o.attack ?? 0.004) + o.decay + 0.05);
  }

  private tone(dest: AudioNode, t: number, o: { type: OscillatorType; freq: number; to?: number; peak: number; decay: number; attack?: number }) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.attack ?? 0.005) + o.decay);
    const g = ctx.createGain();
    this.env(g, t, o.peak, o.attack ?? 0.005, o.decay);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + (o.attack ?? 0.005) + o.decay + 0.05);
  }

  /** Builds one sound into `out` starting at `t`; returns its length in seconds. */
  private voice(kind: SoundKind, out: GainNode, t: number): number {
    switch (kind) {
      case 'bullet':
        this.noiseHit(out, t, { type: 'highpass', freq: 1800, peak: 0.35, decay: 0.05 });
        this.tone(out, t, { type: 'square', freq: 420, to: 180, peak: 0.06, decay: 0.03 });
        return 0.08;
      case 'shell':
        this.noiseHit(out, t, { type: 'lowpass', freq: 1400, to: 300, peak: 0.6, decay: 0.22 });
        this.tone(out, t, { type: 'sine', freq: 160, to: 45, peak: 0.55, decay: 0.2 });
        return 0.3;
      case 'rocket':
        this.noiseHit(out, t, { type: 'bandpass', freq: 500, to: 2600, q: 2.5, peak: 0.35, decay: 0.38, attack: 0.03 });
        return 0.45;
      case 'artillery':
        this.noiseHit(out, t, { type: 'lowpass', freq: 900, to: 150, peak: 0.8, decay: 0.5 });
        this.tone(out, t, { type: 'sine', freq: 110, to: 30, peak: 0.8, decay: 0.45 });
        return 0.6;
      case 'boomSmall':
        this.noiseHit(out, t, { type: 'lowpass', freq: 1600, to: 250, peak: 0.45, decay: 0.28 });
        return 0.35;
      case 'boomVehicle':
        this.noiseHit(out, t, { type: 'lowpass', freq: 1000, to: 120, peak: 0.85, decay: 0.7 });
        this.tone(out, t, { type: 'sine', freq: 75, to: 28, peak: 0.7, decay: 0.6 });
        return 0.8;
      case 'boomBuilding':
        this.noiseHit(out, t, { type: 'lowpass', freq: 700, to: 80, peak: 1, decay: 1.5, attack: 0.01 });
        this.tone(out, t, { type: 'sine', freq: 55, to: 22, peak: 0.9, decay: 1.3 });
        this.noiseHit(out, t + 0.18, { type: 'bandpass', freq: 1800, to: 400, q: 1, peak: 0.25, decay: 0.9 });
        return 1.7;
      case 'sold':
        this.tone(out, t, { type: 'triangle', freq: 660, peak: 0.25, decay: 0.15 });
        this.tone(out, t + 0.1, { type: 'triangle', freq: 990, peak: 0.25, decay: 0.3 });
        return 0.45;
      case 'place':
        this.tone(out, t, { type: 'sine', freq: 190, to: 70, peak: 0.6, decay: 0.16 });
        this.noiseHit(out, t, { type: 'lowpass', freq: 900, peak: 0.3, decay: 0.08 });
        this.noiseHit(out, t + 0.09, { type: 'bandpass', freq: 2400, q: 3, peak: 0.12, decay: 0.05 });
        return 0.25;
      case 'ready':
        this.tone(out, t, { type: 'square', freq: 880, peak: 0.09, decay: 0.08 });
        this.tone(out, t + 0.1, { type: 'square', freq: 1320, peak: 0.09, decay: 0.14 });
        return 0.3;
      case 'queue':
        this.tone(out, t, { type: 'triangle', freq: 740, to: 980, peak: 0.16, decay: 0.06 });
        return 0.1;
      case 'denied':
        this.tone(out, t, { type: 'square', freq: 150, peak: 0.12, decay: 0.16 });
        this.tone(out, t, { type: 'square', freq: 158, peak: 0.1, decay: 0.16 });
        return 0.22;
      case 'order':
        this.tone(out, t, { type: 'triangle', freq: 520, peak: 0.16, decay: 0.05 });
        this.tone(out, t + 0.05, { type: 'triangle', freq: 690, peak: 0.12, decay: 0.06 });
        return 0.14;
      case 'select':
        this.tone(out, t, { type: 'sine', freq: 1200, peak: 0.08, decay: 0.035 });
        return 0.06;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.tone(out, t + i * 0.32, { type: 'square', freq: 620, peak: 0.1, decay: 0.14 });
          this.tone(out, t + i * 0.32 + 0.15, { type: 'square', freq: 465, peak: 0.1, decay: 0.14 });
        }
        return 1.0;
      case 'victory': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => this.tone(out, t + i * 0.16, { type: 'triangle', freq: f, peak: 0.22, decay: i === 3 ? 0.9 : 0.2 }));
        return 1.6;
      }
      case 'defeat': {
        const notes = [392, 349.23, 311.13, 233.08];
        notes.forEach((f, i) => this.tone(out, t + i * 0.24, { type: 'sawtooth', freq: f, peak: 0.1, decay: i === 3 ? 1.1 : 0.26 }));
        return 2.0;
      }
      case 'infiltrate':
        // A soft two-note chime over a hiss of radio static: data slipping out.
        this.tone(out, t, { type: 'sine', freq: 1046.5, peak: 0.14, decay: 0.5, attack: 0.02 });
        this.tone(out, t + 0.12, { type: 'sine', freq: 1568, peak: 0.1, decay: 0.6, attack: 0.02 });
        this.noiseHit(out, t, { type: 'bandpass', freq: 3200, q: 0.7, peak: 0.07, decay: 0.55, attack: 0.08 });
        this.noiseHit(out, t + 0.3, { type: 'highpass', freq: 5000, peak: 0.05, decay: 0.25 });
        return 0.8;
      case 'charge':
        // A charge armed: three quick beeps, rising.
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.14, { type: 'square', freq: 1400 + i * 220, peak: 0.08, decay: 0.06 });
        return 0.5;
      case 'capture':
        // A structure taken: a clunk and a confident major third.
        this.tone(out, t, { type: 'sine', freq: 140, to: 70, peak: 0.4, decay: 0.12 });
        this.tone(out, t + 0.08, { type: 'triangle', freq: 523.25, peak: 0.18, decay: 0.25 });
        this.tone(out, t + 0.2, { type: 'triangle', freq: 659.25, peak: 0.18, decay: 0.25 });
        this.tone(out, t + 0.32, { type: 'triangle', freq: 783.99, peak: 0.2, decay: 0.5 });
        return 0.9;
      case 'levelup': {
        // A rising arpeggio, ending on a held octave with a shimmer above it.
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        notes.forEach((f, i) => this.tone(out, t + i * 0.07, { type: 'triangle', freq: f, peak: 0.14, decay: i === 4 ? 0.7 : 0.14 }));
        this.tone(out, t + 0.28, { type: 'sine', freq: 2093, peak: 0.05, decay: 0.6 });
        return 1.1;
      }
      case 'recon':
        // A radar ping: a pure tone with a long, falling tail, echoed once.
        this.tone(out, t, { type: 'sine', freq: 1750, to: 1500, peak: 0.2, decay: 0.9, attack: 0.003 });
        this.tone(out, t + 0.45, { type: 'sine', freq: 1750, to: 1500, peak: 0.06, decay: 0.6, attack: 0.003 });
        return 1.2;
      case 'barrage':
        // Incoming: a falling whistle; the shells' own blasts are the normal booms.
        this.tone(out, t, { type: 'sine', freq: 2400, to: 520, peak: 0.12, decay: 1.2, attack: 0.15 });
        this.tone(out, t + 0.25, { type: 'sine', freq: 2100, to: 480, peak: 0.07, decay: 1.0, attack: 0.15 });
        return 1.5;
      case 'reinforce':
        // Radio squelch, a clipped burst of chatter, squelch again.
        this.noiseHit(out, t, { type: 'bandpass', freq: 1800, q: 1.4, peak: 0.22, decay: 0.08 });
        this.tone(out, t + 0.1, { type: 'square', freq: 310, to: 360, peak: 0.05, decay: 0.12 });
        this.tone(out, t + 0.24, { type: 'square', freq: 280, to: 330, peak: 0.05, decay: 0.1 });
        this.noiseHit(out, t + 0.1, { type: 'bandpass', freq: 1200, q: 2, peak: 0.08, decay: 0.3 });
        this.noiseHit(out, t + 0.42, { type: 'bandpass', freq: 2200, q: 1.4, peak: 0.2, decay: 0.06 });
        return 0.6;
      case 'flame':
        // A roaring whoosh: a swell of filtered noise over a low rumble.
        this.noiseHit(out, t, { type: 'bandpass', freq: 520, to: 1300, q: 0.7, peak: 0.42, decay: 0.42, attack: 0.05 });
        this.noiseHit(out, t, { type: 'lowpass', freq: 260, peak: 0.3, decay: 0.45, attack: 0.04 });
        return 0.55;
      case 'grenade':
        // A soft launch thump and the rattle of the pin.
        this.tone(out, t, { type: 'sine', freq: 300, to: 110, peak: 0.32, decay: 0.1 });
        this.noiseHit(out, t, { type: 'highpass', freq: 2600, peak: 0.08, decay: 0.05 });
        return 0.16;
      case 'heal':
        // A gentle rising chime.
        this.tone(out, t, { type: 'sine', freq: 880, to: 1175, peak: 0.07, decay: 0.3, attack: 0.04 });
        this.tone(out, t + 0.1, { type: 'sine', freq: 1318.5, peak: 0.05, decay: 0.35, attack: 0.04 });
        return 0.5;
      case 'repair':
        // A ratchet's clicks and a hiss of welding.
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.06, { type: 'square', freq: 950, peak: 0.045, decay: 0.02 });
        this.noiseHit(out, t + 0.2, { type: 'bandpass', freq: 3400, q: 1.2, peak: 0.09, decay: 0.3, attack: 0.02 });
        return 0.55;
      case 'missileLaunch':
        // A long rising roar as the motor lights and the missile climbs away.
        this.noiseHit(out, t, { type: 'lowpass', freq: 240, to: 2200, peak: 0.6, decay: 2.2, attack: 0.35 });
        this.tone(out, t, { type: 'sawtooth', freq: 70, to: 170, peak: 0.07, decay: 2.1, attack: 0.3 });
        this.tone(out, t + 0.5, { type: 'sine', freq: 600, to: 900, peak: 0.05, decay: 1.4, attack: 0.3 });
        return 2.7;
      case 'missileImpact':
        // The biggest sound in the game: a deep blast, a long rolling rumble, debris pattering down.
        this.noiseHit(out, t, { type: 'lowpass', freq: 600, to: 40, peak: 1, decay: 3.4, attack: 0.02 });
        this.tone(out, t, { type: 'sine', freq: 48, to: 18, peak: 1, decay: 3 });
        this.noiseHit(out, t + 0.05, { type: 'bandpass', freq: 1500, to: 300, q: 0.8, peak: 0.35, decay: 1.4 });
        this.noiseHit(out, t + 0.9, { type: 'highpass', freq: 3000, peak: 0.08, decay: 1.2, attack: 0.2 });
        return 4;
    }
  }
}

/** One engine for the page: the build menu, the battlefield and the top bar all share it. */
export const sound = new SoundEngine();

if (import.meta.env.DEV) (window as unknown as { __firelineSound?: SoundEngine }).__firelineSound = sound;
