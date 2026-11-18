/** Builds a WAV file in memory from planar int16 channels. */
export function makeWav(channels: Int16Array[], sampleRate: number, bits: 16 | 24 = 16): Uint8Array {
  const n = channels[0].length;
  const nc = channels.length;
  const bps = bits / 8;
  const dataLen = n * nc * bps;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * bps, true);
  v.setUint16(32, nc * bps, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataLen, true);
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = channels[c][i];
      if (bits === 16) v.setInt16(p, s, true);
      else {
        const s24 = s * 256;
        v.setUint8(p, s24 & 0xff);
        v.setUint8(p + 1, (s24 >> 8) & 0xff);
        v.setInt8(p + 2, s24 >> 16);
      }
      p += bps;
    }
  }
  return new Uint8Array(buf);
}

export function sine(freq: number, rate: number, seconds: number, amp = 10000): Int16Array {
  const n = Math.round(rate * seconds);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate));
  return out;
}
