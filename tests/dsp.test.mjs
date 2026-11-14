import { describe, expect, it } from 'vitest';
import { FFT, MdxStft, demix } from '../worker/dsp.mjs';

function naiveDft(re, im) {
  const n = re.length;
  const oRe = new Float64Array(n);
  const oIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      oRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      oIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
  }
  return [oRe, oIm];
}

const rand = (n, seed = 1) => {
  let s = seed;
  return Float64Array.from({ length: n }, () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1);
};

describe('FFT', () => {
  for (const n of [8, 12, 30, 60, 120, 7680 / 16]) {
    it(`matches a naive DFT for n=${n}`, () => {
      const re = rand(n, 3);
      const im = rand(n, 7);
      const [eRe, eIm] = naiveDft(re, im);
      const oRe = new Float64Array(n);
      const oIm = new Float64Array(n);
      new FFT(n).forward(re, im, oRe, oIm);
      for (let k = 0; k < n; k++) {
        expect(oRe[k]).toBeCloseTo(eRe[k], 8);
        expect(oIm[k]).toBeCloseTo(eIm[k], 8);
      }
    });
  }

  it('inverts exactly for n=7680', () => {
    const n = 7680;
    const re = rand(n, 5);
    const im = rand(n, 9);
    const fft = new FFT(n);
    const fRe = new Float64Array(n);
    const fIm = new Float64Array(n);
    const bRe = new Float64Array(n);
    const bIm = new Float64Array(n);
    fft.forward(re, im, fRe, fIm);
    fft.inverse(fRe, fIm, bRe, bIm);
    let err = 0;
    for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(bRe[i] - re[i]), Math.abs(bIm[i] - im[i]));
    expect(err).toBeLessThan(1e-9);
  });
});

describe('MDX STFT', () => {
  const sine = (n, f, phase = 0) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / 44100 + phase));

  it('round-trips a band-limited chunk', () => {
    const stft = new MdxStft();
    const l = sine(stft.chunk, 440);
    const r = sine(stft.chunk, 1000, 1);
    const spec = stft.forward(l, r);
    const outL = new Float32Array(stft.chunk);
    const outR = new Float32Array(stft.chunk);
    stft.inverse(spec, outL, outR);
    let err = 0;
    for (let i = 100; i < stft.chunk - 100; i++) err = Math.max(err, Math.abs(outL[i] - l[i]), Math.abs(outR[i] - r[i]));
    expect(err).toBeLessThan(1e-4);
  });

  it('puts a 440 Hz tone in the expected bin of the left real/imag planes', () => {
    const stft = new MdxStft();
    const spec = stft.forward(sine(stft.chunk, 440), new Float32Array(stft.chunk));
    const T = stft.dimT;
    const F = stft.dimF;
    const mag = (f) => Math.hypot(spec[f * T + 100], spec[F * T + f * T + 100]);
    const bin = Math.round((440 * 7680) / 44100); // 77
    expect(mag(bin)).toBeGreaterThan(100 * mag(bin + 20));
    expect(Math.abs(spec[2 * F * T + bin * T + 100])).toBeLessThan(1e-6); // right channel is silent
  });

  it('demix with an identity model reconstructs the mix (all chunk seams included)', async () => {
    const n = 44100 * 13 + 777;
    const l = sine(n, 523);
    const r = sine(n, 330, 0.5);
    const { voiceL, voiceR } = await demix(l, r, async (spec) => spec);
    let err = 0;
    for (let i = 2000; i < n - 2000; i++) err = Math.max(err, Math.abs(voiceL[i] - l[i]), Math.abs(voiceR[i] - r[i]));
    expect(err).toBeLessThan(1e-3);
  });
});
