import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openAudio } from "@/lib/audio/open";
import { mixToMono, OverflowFixer } from "@/lib/audio/reconstruct";
import { resample } from "@/lib/audio/resample";
import { bytesSource } from "@/lib/audio/source";
import type { AudioStream } from "@/lib/audio/types";
import { parseWavHeader, readWavFrames } from "@/lib/audio/wav";
import { makeWav, sine } from "./helpers";

async function collect(stream: AudioStream): Promise<Int16Array[]> {
  const parts: Int16Array[][] = [];
  for await (const c of stream.chunks()) parts.push(c);
  return Array.from({ length: stream.info.channels }, (_, ch) => {
    const n = parts.reduce((a, p) => a + p[ch].length, 0);
    const out = new Int16Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p[ch], o);
      o += p[ch].length;
    }
    return out;
  });
}

describe("WAV", () => {
  it("parses header and streams 16-bit stereo", async () => {
    const l = sine(440, 8000, 1);
    const r = sine(880, 8000, 1);
    const src = bytesSource(makeWav([l, r], 8000));
    const stream = await openAudio(src);
    expect(stream.info).toMatchObject({ format: "wav", sampleRate: 8000, channels: 2, totalFrames: 8000 });
    const [cl, cr] = await collect(stream);
    expect(cl).toEqual(l);
    expect(cr).toEqual(r);
  });

  it("reads 24-bit as the top 16 bits", async () => {
    const x = sine(100, 8000, 0.1);
    const [c] = await collect(await openAudio(bytesSource(makeWav([x], 8000, 24))));
    expect(c).toEqual(x);
  });

  it("reads arbitrary frame ranges", async () => {
    const x = Int16Array.from({ length: 1000 }, (_, i) => i);
    const src = bytesSource(makeWav([x], 8000));
    const info = await parseWavHeader(src);
    const [part] = await readWavFrames(src, info, 990, 50); // clamps at the end
    expect(Array.from(part)).toEqual([990, 991, 992, 993, 994, 995, 996, 997, 998, 999]);
  });

  it("rejects non-audio", async () => {
    await expect(openAudio(bytesSource(new TextEncoder().encode("hello world!")))).rejects.toThrow(/Unsupported/);
  });
});

describe("FLAC", () => {
  it("decodes to the same samples as the source WAV", async () => {
    const flac = await openAudio(bytesSource(readFileSync("tests/fixtures/stereo-22k.flac")));
    const wav = await openAudio(bytesSource(readFileSync("tests/fixtures/stereo-22k.wav")));
    expect(flac.info).toMatchObject({ format: "flac", sampleRate: 22050, channels: 2, totalFrames: 33075 });
    const a = await collect(flac);
    const b = await collect(wav);
    expect(a[0]).toEqual(b[0]);
    expect(a[1]).toEqual(b[1]);
  });
});

describe("OverflowFixer", () => {
  it("replaces a wrapped-around run with int16 max, across chunk boundaries", () => {
    const data = [0, 20000, -32000, -31000, -20000, -10000, 500];
    const expected = [0, 20000, 32767, 32767, 32767, -10000, 500];
    const fixer = new OverflowFixer();
    const a = fixer.process(Int16Array.from(data.slice(0, 3)));
    const b = fixer.process(Int16Array.from(data.slice(3)));
    expect([...a, ...b]).toEqual(expected);
  });

  it("leaves normal audio untouched", () => {
    const x = sine(440, 8000, 0.5, 30000);
    expect(new OverflowFixer().process(x.slice())).toEqual(x);
  });
});

describe("mixToMono", () => {
  it("averages channels", () => {
    expect(Array.from(mixToMono([Int16Array.of(2, 4), Int16Array.of(4, -4)]))).toEqual([3, 0]);
  });
});

describe("resample", () => {
  const amplitudeAt = (x: Float32Array, freq: number, rate: number) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      re += x[i] * Math.cos((2 * Math.PI * freq * i) / rate);
      im += x[i] * Math.sin((2 * Math.PI * freq * i) / rate);
    }
    return (2 * Math.hypot(re, im)) / x.length;
  };

  it.each([48000, 44100, 96000, 16000, 32000])("keeps a 1 kHz tone at %i Hz → 32 kHz", (rate) => {
    const x = Float32Array.from(sine(1000, rate, 1, 10000));
    const y = resample(x, 32000);
    expect(y.length).toBe(32000);
    expect(amplitudeAt(y, 1000, 32000)).toBeCloseTo(10000, -2);
  });

  it("removes content above the new Nyquist when downsampling", () => {
    const x = Float32Array.from(sine(20000, 48000, 1, 10000));
    expect(amplitudeAt(resample(x, 32000), 20000 - 16000, 32000)).toBeLessThan(200);
  });
});
