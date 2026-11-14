// Signal processing for MDX-Net voice/music separation (plain JavaScript so it
// runs in a separate Node process without a build step).

/**
 * Mixed-radix complex FFT (radix 4, 2 and generic), following the KISS FFT
 * algorithm. Works for any size; 7680 = 4^4 · 2 · 3 · 5 for MDX-Net.
 */
export class FFT {
  constructor(n) {
    this.n = n;
    this.factors = [];
    let m = n;
    let p = 4;
    const limit = Math.floor(Math.sqrt(n));
    do {
      while (m % p) {
        p = p === 4 ? 2 : p === 2 ? 3 : p + 2;
        if (p > limit) p = m;
      }
      m /= p;
      this.factors.push(p, m);
    } while (m > 1);
    this.twRe = new Float64Array(n);
    this.twIm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * i) / n;
      this.twRe[i] = Math.cos(a);
      this.twIm[i] = Math.sin(a);
    }
    this.scRe = new Float64Array(Math.max(...this.factors.filter((_, i) => i % 2 === 0)));
    this.scIm = new Float64Array(this.scRe.length);
  }

  /** Forward DFT: (inRe, inIm) → (outRe, outIm). Inputs are not modified. */
  forward(inRe, inIm, outRe, outIm) {
    this.work(outRe, outIm, 0, inRe, inIm, 0, 1, 0);
  }

  /** Inverse DFT including the 1/n scaling. Uses the conjugation trick; `inIm` is negated in place and restored. */
  inverse(inRe, inIm, outRe, outIm) {
    const n = this.n;
    for (let i = 0; i < n; i++) inIm[i] = -inIm[i];
    this.forward(inRe, inIm, outRe, outIm);
    for (let i = 0; i < n; i++) {
      inIm[i] = -inIm[i];
      outRe[i] /= n;
      outIm[i] = -outIm[i] / n;
    }
  }

  work(oRe, oIm, out, iRe, iIm, inp, fstride, fi) {
    const p = this.factors[fi];
    const m = this.factors[fi + 1];
    const end = out + p * m;
    if (m === 1) {
      for (let o = out, i = inp; o < end; o++, i += fstride) {
        oRe[o] = iRe[i];
        oIm[o] = iIm[i];
      }
    } else {
      for (let o = out, i = inp; o < end; o += m, i += fstride) this.work(oRe, oIm, o, iRe, iIm, i, fstride * p, fi + 2);
    }
    if (p === 2) this.bfly2(oRe, oIm, out, fstride, m);
    else if (p === 4) this.bfly4(oRe, oIm, out, fstride, m);
    else this.bflyGeneric(oRe, oIm, out, fstride, m, p);
  }

  bfly2(re, im, out, fstride, m) {
    const { twRe, twIm } = this;
    for (let k = 0, tw = 0; k < m; k++, tw += fstride) {
      const a = out + k;
      const b = a + m;
      const tr = re[b] * twRe[tw] - im[b] * twIm[tw];
      const ti = re[b] * twIm[tw] + im[b] * twRe[tw];
      re[b] = re[a] - tr;
      im[b] = im[a] - ti;
      re[a] += tr;
      im[a] += ti;
    }
  }

  bfly4(re, im, out, fstride, m) {
    const { twRe, twIm } = this;
    for (let k = 0; k < m; k++) {
      const i0 = out + k;
      const i1 = i0 + m;
      const i2 = i0 + 2 * m;
      const i3 = i0 + 3 * m;
      const t1 = k * fstride;
      const t2 = 2 * t1;
      const t3 = 3 * t1;
      const s0r = re[i1] * twRe[t1] - im[i1] * twIm[t1];
      const s0i = re[i1] * twIm[t1] + im[i1] * twRe[t1];
      const s1r = re[i2] * twRe[t2] - im[i2] * twIm[t2];
      const s1i = re[i2] * twIm[t2] + im[i2] * twRe[t2];
      const s2r = re[i3] * twRe[t3] - im[i3] * twIm[t3];
      const s2i = re[i3] * twIm[t3] + im[i3] * twRe[t3];
      const s5r = re[i0] - s1r;
      const s5i = im[i0] - s1i;
      const f0r = re[i0] + s1r;
      const f0i = im[i0] + s1i;
      const s3r = s0r + s2r;
      const s3i = s0i + s2i;
      const s4r = s0r - s2r;
      const s4i = s0i - s2i;
      re[i2] = f0r - s3r;
      im[i2] = f0i - s3i;
      re[i0] = f0r + s3r;
      im[i0] = f0i + s3i;
      re[i1] = s5r + s4i;
      im[i1] = s5i - s4r;
      re[i3] = s5r - s4i;
      im[i3] = s5i + s4r;
    }
  }

  bflyGeneric(re, im, out, fstride, m, p) {
    const { twRe, twIm, scRe, scIm, n } = this;
    for (let u = 0; u < m; u++) {
      for (let q = 0, k = u; q < p; q++, k += m) {
        scRe[q] = re[out + k];
        scIm[q] = im[out + k];
      }
      for (let q1 = 0, k = u; q1 < p; q1++, k += m) {
        let accR = scRe[0];
        let accI = scIm[0];
        let tw = 0;
        for (let q = 1; q < p; q++) {
          tw += fstride * k;
          if (tw >= n) tw -= n;
          accR += scRe[q] * twRe[tw] - scIm[q] * twIm[tw];
          accI += scRe[q] * twIm[tw] + scIm[q] * twRe[tw];
        }
        re[out + k] = accR;
        im[out + k] = accI;
      }
    }
  }
}

/**
 * STFT / inverse STFT matching torch.stft / torch.istft with center=True,
 * reflect padding and a periodic Hann window, laid out as MDX-Net expects:
 * [4 planes (L re, L im, R re, R im), dimF bins, dimT frames].
 */
export class MdxStft {
  constructor({ nFft = 7680, hop = 1024, dimF = 3072, dimT = 256 } = {}) {
    Object.assign(this, { nFft, hop, dimF, dimT });
    this.chunk = hop * (dimT - 1);
    this.fft = new FFT(nFft);
    this.win = new Float64Array(nFft);
    for (let i = 0; i < nFft; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft);
    this.aRe = new Float64Array(nFft);
    this.aIm = new Float64Array(nFft);
    this.bRe = new Float64Array(nFft);
    this.bIm = new Float64Array(nFft);
    const padded = nFft + hop * (dimT - 1);
    this.accL = new Float64Array(padded);
    this.accR = new Float64Array(padded);
    this.env = new Float64Array(padded);
    for (let t = 0; t < dimT; t++) for (let i = 0; i < nFft; i++) this.env[t * hop + i] += this.win[i] * this.win[i];
  }

  /** Two channels of `chunk` samples → spectrogram (Float32Array of 4·dimF·dimT). */
  forward(left, right, out = new Float32Array(4 * this.dimF * this.dimT)) {
    const { nFft, hop, dimF, dimT, win, aRe, aIm, bRe, bIm } = this;
    const half = nFft / 2;
    const len = left.length;
    for (let t = 0; t < dimT; t++) {
      const start = t * hop - half;
      for (let i = 0; i < nFft; i++) {
        let idx = start + i;
        if (idx < 0) idx = -idx;
        else if (idx >= len) idx = 2 * (len - 1) - idx;
        aRe[i] = left[idx] * win[i];
        aIm[i] = right[idx] * win[i];
      }
      this.fft.forward(aRe, aIm, bRe, bIm);
      // Two real signals packed in one complex FFT: unpack both spectra.
      for (let f = 0; f < dimF; f++) {
        const g = f === 0 ? 0 : nFft - f;
        const at = f * dimT + t;
        out[at] = (bRe[f] + bRe[g]) / 2;
        out[dimF * dimT + at] = (bIm[f] - bIm[g]) / 2;
        out[2 * dimF * dimT + at] = (bIm[f] + bIm[g]) / 2;
        out[3 * dimF * dimT + at] = (bRe[g] - bRe[f]) / 2;
      }
    }
    return out;
  }

  /** Spectrogram → two channels of `chunk` samples (bins above dimF are zero). */
  inverse(spec, outL, outR) {
    const { nFft, hop, dimF, dimT, win, aRe, aIm, bRe, bIm, accL, accR, env } = this;
    const half = nFft / 2;
    const plane = dimF * dimT;
    accL.fill(0);
    accR.fill(0);
    for (let t = 0; t < dimT; t++) {
      aRe.fill(0);
      aIm.fill(0);
      for (let f = 0; f < dimF; f++) {
        const at = f * dimT + t;
        const x0r = spec[at];
        const x0i = f === 0 ? 0 : spec[plane + at];
        const x1r = spec[2 * plane + at];
        const x1i = f === 0 ? 0 : spec[3 * plane + at];
        aRe[f] = x0r - x1i;
        aIm[f] = x0i + x1r;
        if (f > 0 && f < half) {
          aRe[nFft - f] = x0r + x1i;
          aIm[nFft - f] = x1r - x0i;
        }
      }
      this.fft.inverse(aRe, aIm, bRe, bIm);
      const pos = t * hop;
      for (let i = 0; i < nFft; i++) {
        accL[pos + i] += bRe[i] * win[i];
        accR[pos + i] += bIm[i] * win[i];
      }
    }
    for (let i = 0; i < this.chunk; i++) {
      const j = i + half;
      const e = env[j] > 1e-11 ? env[j] : 1;
      outL[i] = accL[j] / e;
      outR[i] = accR[j] / e;
    }
  }
}

/**
 * Separates the target stem (voice) from a stereo mix, chunk by chunk with
 * 25 % overlap and Hann cross-fades, like Ultimate Vocal Remover's MDX demix.
 * `runModel(spec)` returns the predicted spectrogram of the target stem.
 */
export async function demix(mixL, mixR, runModel, onProgress = () => {}, opts = {}) {
  const stft = new MdxStft(opts);
  const { chunk } = stft;
  const trim = stft.nFft / 2;
  const len = mixL.length;
  const gen = chunk - 2 * trim;
  const total = trim + len + (gen + trim - (len % gen));
  const step = Math.floor(0.75 * chunk);
  const resL = new Float32Array(total);
  const resR = new Float32Array(total);
  const div = new Float32Array(total);
  const partL = new Float32Array(chunk);
  const partR = new Float32Array(chunk);
  const outL = new Float32Array(chunk);
  const outR = new Float32Array(chunk);
  const spec = new Float32Array(4 * stft.dimF * stft.dimT);
  const steps = Math.ceil(total / step);
  for (let s = 0, start = 0; start < total; s++, start += step) {
    const actual = Math.min(chunk, total - start);
    let energy = 0;
    for (let i = 0; i < chunk; i++) {
      const src = start + i - trim;
      const inside = i < actual && src >= 0 && src < len;
      partL[i] = inside ? mixL[src] : 0;
      partR[i] = inside ? mixR[src] : 0;
      energy += Math.abs(partL[i]) + Math.abs(partR[i]);
    }
    const w = (i) => (actual > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (actual - 1)) : 1);
    if (energy > 0) {
      stft.forward(partL, partR, spec);
      // MDX-Net ignores the three lowest bins.
      for (let p = 0; p < 4; p++) spec.fill(0, p * stft.dimF * stft.dimT, p * stft.dimF * stft.dimT + 3 * stft.dimT);
      const pred = await runModel(spec);
      stft.inverse(pred, outL, outR);
      for (let i = 0; i < actual; i++) {
        resL[start + i] += outL[i] * w(i);
        resR[start + i] += outR[i] * w(i);
      }
    }
    for (let i = 0; i < actual; i++) div[start + i] += w(i);
    onProgress(Math.min(1, (s + 1) / steps));
  }
  const voiceL = new Float32Array(len);
  const voiceR = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const d = div[trim + i];
    voiceL[i] = d > 1e-8 ? resL[trim + i] / d : 0;
    voiceR[i] = d > 1e-8 ? resR[trim + i] / d : 0;
  }
  return { voiceL, voiceR };
}
