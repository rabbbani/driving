// js/audio.js
// Lightweight procedural Web Audio synthesizer for engine RPM, gear shifts, stalls, collisions, and chimes.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.engineGain = null;
    this.oscMain = null;
    this.oscSub = null;
    this.filter = null;
    this.volume = 0.55;
    this.active = false;
    this.unlocked = false;
  }

  unlock() {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 180;
      this.filter.Q.value = 1.6;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      // Warm 4-cylinder firing-order fundamental + octave harmonic
      this.oscMain = this.ctx.createOscillator();
      this.oscMain.type = 'sawtooth';
      this.oscMain.frequency.value = 46;

      this.oscSub = this.ctx.createOscillator();
      this.oscSub.type = 'triangle';
      this.oscSub.frequency.value = 23;

      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.65;

      this.oscMain.connect(this.filter);
      this.oscSub.connect(subGain);
      subGain.connect(this.filter);

      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.oscMain.start();
      this.oscSub.start();
      this.unlocked = true;

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    } catch (_) {
      this.unlocked = false;
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  setEngineActive(isActive) {
    this.active = Boolean(isActive);
    if (!this.unlocked || !this.ctx || !this.engineGain) return;
    if (!this.active) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  updateEngine(rpm, throttle, stalled, lugging) {
    if (!this.unlocked || !this.ctx || !this.engineGain) return;
    const now = this.ctx.currentTime;

    if (!this.active || stalled || this.volume <= 0.001) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.04);
      return;
    }

    // 4-stroke 4-cylinder firing frequency = (RPM / 60) * 2
    const clampedRpm = Math.max(350, Math.min(6600, rpm));
    const baseHz = 28 + (clampedRpm / 60) * 1.65;
    const wobble = lugging ? Math.sin(now * 44) * 4.5 : 0;

    this.oscMain.frequency.setTargetAtTime(Math.max(20, baseHz + wobble), now, 0.03);
    this.oscSub.frequency.setTargetAtTime(Math.max(14, (baseHz + wobble) * 0.5), now, 0.03);

    const cutoff = 140 + (clampedRpm / 6200) * 520 + throttle * 260;
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.04);

    const level = 0.075 + throttle * 0.065 + (clampedRpm / 6200) * 0.045;
    this.engineGain.gain.setTargetAtTime(level, now, 0.04);
  }

  playShift(grind = false) {
    if (!this.unlocked || !this.ctx || this.volume <= 0.001) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (grind) {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(145, now);
      osc.frequency.linearRampToValueAtTime(88, now + 0.16);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.18);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(290, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.055);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.065);
    }
  }

  playStall() {
    if (!this.unlocked || !this.ctx || this.volume <= 0.001) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.28);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.31);
  }

  playRestart() {
    if (!this.unlocked || !this.ctx || this.volume <= 0.001) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.linearRampToValueAtTime(210, now + 0.16);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playCollision(impactSpeedKmh = 8) {
    if (!this.unlocked || !this.ctx || this.volume <= 0.001) return;
    const now = this.ctx.currentTime;
    const intensity = Math.min(0.32, 0.08 + impactSpeedKmh * 0.012);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.16);
    gain.gain.setValueAtTime(intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playMissionSuccess() {
    if (!this.unlocked || !this.ctx || this.volume <= 0.001) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const now = this.ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + i * 0.085;
      osc.frequency.setValueAtTime(notes[i], t0);
      gain.gain.setValueAtTime(0.14, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.34);
    }
  }
}
