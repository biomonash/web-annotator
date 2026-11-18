/**
 * Streaming port of the PoC's `get_reconstruction` clipping fix.
 *
 * Some recorders wrap around on overflow: a loud positive sample (> 10000) is followed by
 * a run of very negative samples. That run is replaced with int16 max until the signal
 * comes back above -15000. State carries across chunks so wraps at chunk edges are fixed too.
 */
export class OverflowFixer {
  private prev = 0;
  private inOverflow = false;

  /** Fixes `data` in place and returns it. */
  process(data: Int16Array): Int16Array {
    let prev = this.prev;
    let inOverflow = this.inOverflow;
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      if (inOverflow) {
        if (x > -15000) inOverflow = false;
        else data[i] = 32767;
      } else if (prev > 10000 && x < -30000) {
        inOverflow = true;
        data[i] = 32767;
      }
      prev = x;
    }
    this.prev = prev;
    this.inOverflow = inOverflow;
    return data;
  }
}

/** Averages planar channels into one mono float channel (still int16-scaled). */
export function mixToMono(channels: Int16Array[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  if (channels.length === 1) {
    out.set(channels[0]);
    return out;
  }
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}
