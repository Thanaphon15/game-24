/* sound.js — tiny Web Audio beeps for game feedback, no audio files needed.
   Muted state persists in localStorage so it survives reloads/pages. */
(function (global) {
  const MUTE_KEY = 'game24_sound_muted';
  let ctx = null;

  function getCtx() {
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function isMuted() {
    return localStorage.getItem(MUTE_KEY) === '1';
  }

  function setMuted(muted) {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  }

  function tone(freq, duration, type, startTime, gainPeak) {
    if (isMuted()) return;
    const audioCtx = getCtx();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + (startTime || 0);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.12, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function correct() {
    tone(523.25, 0.12, 'sine', 0, 0.12);
    tone(783.99, 0.18, 'sine', 0.09, 0.12);
  }

  function wrong() {
    tone(196, 0.22, 'sawtooth', 0, 0.07);
  }

  function tick() {
    tone(1046.5, 0.045, 'sine', 0, 0.05);
  }

  function complete() {
    tone(523.25, 0.12, 'sine', 0, 0.1);
    tone(659.25, 0.12, 'sine', 0.1, 0.1);
    tone(783.99, 0.22, 'sine', 0.2, 0.1);
  }

  global.Sound24 = { isMuted, setMuted, correct, wrong, tick, complete };
})(window);
