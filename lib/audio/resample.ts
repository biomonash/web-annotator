/**
 * Windowed-sinc (Hann) resampler that maps a buffer to an exact output length.
 * Kernels are cached per phase when the length ratio reduces to a small fraction
 * (e.g. 48 kHz → 32 kHz has 2 phases), which covers common recorder rates.
 */
const HALF_TAPS = 16;
const MAX_CACHED_PHASES = 4096;

interface Kernel {
  /** Offset of the first tap relative to `phase * step`. */
  lo: number;
  weights: Float32Array;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function makeKernel(center: number, cutoff: number, width: number): Kernel {
  const lo = Math.ceil(center - width);
  const hi = Math.floor(center + width);
  const weights = new Float32Array(hi - lo + 1);
  let sum = 0;
  for (let j = lo; j <= hi; j++) {
    const x = j - center;
    const t = cutoff * x;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const hann = 0.5 + 0.5 * Math.cos((Math.PI * x) / width);
    const w = sinc * hann;
    weights[j - lo] = w;
    sum += w;
  }
  for (let k = 0; k < weights.length; k++) weights[k] /= sum; // unity DC gain
  return { lo, weights };
}

const cache = new Map<string, Kernel[]>();

export function resample(input: Float32Array, outLength: number): Float32Array {
  const inLength = input.length;
  const out = new Float32Array(outLength);
  if (inLength === 0 || outLength === 0) return out;
  if (inLength === outLength) {
    out.set(input);
    return out;
  }

  const g = gcd(inLength, outLength);
  const L = outLength / g; // phases
  const M = inLength / g; // input advance per L outputs
  const ratio = inLength / outLength;
  const cutoff = Math.min(1, 1 / ratio);
  const width = HALF_TAPS / cutoff;
  const centerOf = (i: number) => (i + 0.5) * ratio - 0.5;

  let kernels: Kernel[] | null = null;
  if (L <= MAX_CACHED_PHASES) {
    const key = `${L}/${M}`;
    kernels = cache.get(key) ?? null;
    if (!kernels) {
      kernels = Array.from({ length: L }, (_, p) => makeKernel(centerOf(p), cutoff, width));
      cache.set(key, kernels);
    }
  }

  const last = inLength - 1;
  for (let i = 0; i < outLength; i++) {
    let lo: number;
    let w: Float32Array;
    if (kernels) {
      const p = i % L;
      const k = kernels[p];
      lo = k.lo + ((i - p) / L) * M;
      w = k.weights;
    } else {
      const k = makeKernel(centerOf(i), cutoff, width);
      lo = k.lo;
      w = k.weights;
    }
    let acc = 0;
    if (lo >= 0 && lo + w.length - 1 <= last) {
      for (let k = 0; k < w.length; k++) acc += input[lo + k] * w[k];
    } else {
      for (let k = 0; k < w.length; k++) {
        const j = lo + k;
        acc += input[j < 0 ? 0 : j > last ? last : j] * w[k];
      }
    }
    out[i] = acc;
  }
  return out;
}
