'use strict';

/**
 * All audio is synthesised at runtime with the Web Audio API.
 * -> no audio files in the bundle, so there are no music/sample copyright or licence concerns.
 *
 * Playables rules handled here:
 *  - nothing plays until the player interacts (the context is created/resumed from a gesture)
 *  - YouTube mute (isAudioEnabled / onAudioEnabledChange) fully silences + suspends the context
 *  - onPause suspends the context; onResume wakes it again
 */
const Sfx = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = true;      // YouTube-level audio setting
  let pausedByHost = false;
  let engine = null;
  const MASTER_VOL = 0.7;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? MASTER_VOL : 0;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function canPlay() {
    return !!ctx && enabled && !pausedByHost && ctx.state === 'running';
  }

  /** Call from a user gesture (pointerdown / keydown). */
  function unlock() {
    if (!ensure()) return;
    if (enabled && !pausedByHost && ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) engineStop();
    if (!ctx) return;
    try {
      master.gain.value = enabled ? MASTER_VOL : 0;
      if (!enabled) ctx.suspend();
      else if (!pausedByHost) ctx.resume();
    } catch (e) { /* ignore */ }
  }

  function hostPause() {
    pausedByHost = true;
    engineStop();
    if (ctx) { try { ctx.suspend(); } catch (e) { /* ignore */ } }
  }

  function hostResume() {
    pausedByHost = false;
    if (ctx && enabled) { try { ctx.resume(); } catch (e) { /* ignore */ } }
  }

  /* ---------------------------------------------------------- primitives */

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!canPlay()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function noise(dur, vol, filterType, f0, f1, delay) {
    if (!canPlay()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* -------------------------------------------------------------- sounds */

  const click = () => { tone(520, 0.07, 'triangle', 0.22, 780); };
  const start = () => { tone(220, 0.35, 'sawtooth', 0.12, 660); noise(0.3, 0.1, 'bandpass', 400, 2400); };
  const coin = () => { tone(988, 0.09, 'triangle', 0.22); tone(1480, 0.16, 'triangle', 0.2, null, 0.07); };
  const whoosh = () => { noise(0.28, 0.16, 'bandpass', 700, 3000); };
  const levelUp = () => {
    tone(523, 0.12, 'triangle', 0.2);
    tone(659, 0.12, 'triangle', 0.2, null, 0.1);
    tone(784, 0.2, 'triangle', 0.22, null, 0.2);
  };
  const crash = () => {
    noise(0.75, 0.6, 'lowpass', 2200, 90);
    tone(110, 0.55, 'sine', 0.5, 38);
    tone(300, 0.2, 'square', 0.14, 70);
  };
  const newBest = () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.2, null, i * 0.09));
  };

  /* -------------------------------------------------------------- engine */

  function engineStart() {
    if (engine || !canPlay()) return;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o1.type = 'sawtooth';
    o2.type = 'square';
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.4);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(master);
    o1.start();
    o2.start();
    engine = { o1, o2, lp, g };
    engineSet(0);
  }

  /** t = 0..1 speed. */
  function engineSet(t) {
    if (!engine || !ctx) return;
    const now = ctx.currentTime;
    const f = 48 + t * 64;
    engine.o1.frequency.setTargetAtTime(f, now, 0.1);
    engine.o2.frequency.setTargetAtTime(f * 2.01, now, 0.1);
    engine.lp.frequency.setTargetAtTime(320 + t * 520, now, 0.1);
  }

  function engineStop() {
    if (!engine) return;
    const e = engine;
    engine = null;
    try {
      const now = ctx.currentTime;
      e.g.gain.cancelScheduledValues(now);
      e.g.gain.setTargetAtTime(0.0001, now, 0.05);
      e.o1.stop(now + 0.3);
      e.o2.stop(now + 0.3);
    } catch (err) { /* ignore */ }
  }

  return {
    unlock, setEnabled, hostPause, hostResume,
    click, start, coin, whoosh, levelUp, crash, newBest,
    engineStart, engineSet, engineStop
  };
})();
