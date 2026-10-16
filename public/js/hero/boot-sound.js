// Boot sounds for the computer, synthesised with WebAudio so nothing is sampled
// from any real machine: a power-switch clunk, a soft rising chime, the floppy
// drive seeking during the self-test, a quiet fan hum, and a "ready" blip.
// Everything starts from a user gesture (the Enter click), as browsers require.

let ctx = null, hum = null;
const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
const now = () => ac().currentTime;

function tone(freq, t0, dur, { type = 'sine', gain = 0.2, attack = 0.01, release = 0.1, detune = 0 } = {}) {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.setValueAtTime(gain, t0 + Math.max(attack, dur - release));
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(t0, dur, { gain = 0.08, lp = 1200, hp = 80 } = {}) {
  const c = ac(), n = Math.ceil(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(), g = c.createGain(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
  s.buffer = buf; f1.type = 'lowpass'; f1.frequency.value = lp; f2.type = 'highpass'; f2.frequency.value = hp;
  g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  s.connect(f1).connect(f2).connect(g).connect(c.destination);
  s.start(t0); s.stop(t0 + dur);
}

export const bootSound = {
  async unlock() { try { await ac().resume(); } catch { /* no audio */ } },

  // Power switch + chime: the moment the screen comes on.
  powerOn() {
    const t = now();
    noise(t, 0.09, { gain: 0.25, lp: 400, hp: 60 });                         // clunk
    tone(55, t, 0.12, { type: 'triangle', gain: 0.25, release: 0.08 });
    // A gentle, original start-up chord: rises through a fifth and an octave.
    [[261.6, 0.00], [392.0, 0.12], [523.3, 0.24], [784.0, 0.40]].forEach(([f, dt]) => {
      tone(f, t + 0.35 + dt, 1.9 - dt, { gain: 0.11, attack: 0.08, release: 1.0 });
      tone(f * 2, t + 0.35 + dt, 1.4 - dt, { gain: 0.03, attack: 0.1, release: 0.9, detune: 4 });
    });
    // Fan spins up and stays as a very quiet bed.
    const c = ac(), o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 48; f.type = 'lowpass'; f.frequency.value = 220;
    g.gain.setValueAtTime(0, t + 0.2); g.gain.linearRampToValueAtTime(0.018, t + 1.6);
    o.connect(f).connect(g).connect(c.destination); o.start(t + 0.2);
    hum = { o, g };
  },

  // Floppy / disk seeking while the self-test scrolls: a short burst of ticks.
  seek(n = 6) {
    const t = now();
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.07 + Math.random() * 0.05);
      noise(at, 0.03, { gain: 0.12, lp: 2500, hp: 600 });
      tone(180 + Math.random() * 60, at, 0.03, { type: 'square', gain: 0.03, release: 0.02 });
    }
  },

  // One tick for each line the BIOS prints.
  tick() { noise(now(), 0.018, { gain: 0.05, lp: 3000, hp: 900 }); },

  // Desktop is up.
  ready() {
    const t = now();
    tone(880, t, 0.09, { type: 'triangle', gain: 0.07, release: 0.05 });
    tone(1318.5, t + 0.1, 0.16, { type: 'triangle', gain: 0.07, release: 0.1 });
  },

  // Leaving the computer: fan down, a soft off blip.
  powerOff() {
    const t = now();
    if (hum) { hum.g.gain.linearRampToValueAtTime(0, t + 0.6); hum.o.stop(t + 0.7); hum = null; }
    tone(220, t, 0.25, { type: 'sine', gain: 0.08, release: 0.2 });
    noise(t, 0.08, { gain: 0.15, lp: 500, hp: 60 });
  },
};
