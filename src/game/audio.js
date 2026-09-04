import pingSound from "/audio/ping.mp3";

/**
 * Central audio manager.
 *
 * Paddle hits use a small pool of <audio> elements so overlapping hits don't
 * cut each other off, with playback rate scaled by impact velocity so hard
 * smashes sound sharper than soft touches. UI cues (level up, ball lost,
 * game over) are synthesized with WebAudio so no extra assets are needed.
 */
const POOL_SIZE = 6;

class AudioManager {
  constructor() {
    this.muted = false;
    this.pool = [];
    this.poolIndex = 0;
    this.ctx = null;
    if (typeof Audio !== "undefined") {
      for (let i = 0; i < POOL_SIZE; i++) this.pool.push(new Audio(pingSound));
    }
  }

  setMuted(muted) {
    this.muted = muted;
  }

  context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Paddle hit; velocity is the physics impact velocity. */
  ping(velocity) {
    if (this.muted || this.pool.length === 0) return;
    const audio = this.pool[this.poolIndex];
    this.poolIndex = (this.poolIndex + 1) % this.pool.length;
    audio.currentTime = 0;
    audio.volume = Math.min(Math.max(velocity / 20, 0.1), 1);
    audio.playbackRate = 0.85 + Math.min(velocity, 20) / 45;
    audio.play().catch(() => {});
  }

  beep(freq, { duration = 0.12, type = "sine", gain = 0.12, when = 0 } = {}) {
    if (this.muted) return;
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  levelUp() {
    this.beep(523.25, { when: 0, type: "triangle" });
    this.beep(659.25, { when: 0.1, type: "triangle" });
    this.beep(783.99, { when: 0.2, type: "triangle", duration: 0.25 });
  }

  ballLost() {
    this.beep(220, { type: "sawtooth", duration: 0.2, gain: 0.08 });
    this.beep(110, { when: 0.12, type: "sawtooth", duration: 0.3, gain: 0.08 });
  }

  gameOver() {
    this.beep(392, { when: 0, type: "triangle", duration: 0.2 });
    this.beep(311.13, { when: 0.18, type: "triangle", duration: 0.2 });
    this.beep(233.08, { when: 0.36, type: "triangle", duration: 0.5 });
  }

  start() {
    this.beep(440, { when: 0, type: "triangle" });
    this.beep(880, { when: 0.1, type: "triangle", duration: 0.2 });
  }

  serve() {
    this.beep(660, { type: "triangle", duration: 0.08, gain: 0.06 });
  }

  net() {
    this.beep(140, { type: "sawtooth", duration: 0.18, gain: 0.09 });
  }

  /** Ball clips the net cord and trickles over. */
  netCord() {
    this.beep(180, { type: "square", duration: 0.06, gain: 0.05 });
    this.beep(900, { when: 0.05, type: "sine", duration: 0.12, gain: 0.05 });
  }

  /** Heavy hit: the regular ping plus a low thump underneath. */
  smash() {
    this.beep(90, { type: "sine", duration: 0.16, gain: 0.14 });
  }

  point(won) {
    if (won) {
      this.beep(587.33, { when: 0, type: "triangle", duration: 0.12 });
      this.beep(880, { when: 0.09, type: "triangle", duration: 0.2 });
    } else {
      this.beep(330, { when: 0, type: "triangle", duration: 0.14 });
      this.beep(247, { when: 0.1, type: "triangle", duration: 0.22 });
    }
  }

  matchWin() {
    this.beep(523.25, { when: 0, type: "triangle" });
    this.beep(659.25, { when: 0.1, type: "triangle" });
    this.beep(783.99, { when: 0.2, type: "triangle" });
    this.beep(1046.5, { when: 0.3, type: "triangle", duration: 0.4 });
  }
}

export const audio = new AudioManager();
