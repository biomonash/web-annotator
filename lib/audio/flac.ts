import { FLACDecoder } from "@wasm-audio-decoders/flac";
import type { ByteSource } from "./source";
import { floatToInt16, UnsupportedAudioError, type AudioInfo, type AudioStream, type PcmChunk } from "./types";

export interface FlacInfo extends AudioInfo {
  format: "flac";
}

/** Reads STREAMINFO (always the first metadata block) for rate, channels and length. */
export async function parseFlacHeader(src: ByteSource): Promise<FlacInfo> {
  const b = await src.read(0, 42);
  if (b.length < 42 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== "fLaC") {
    throw new UnsupportedAudioError("Not a FLAC file");
  }
  if ((b[4] & 0x7f) !== 0) throw new UnsupportedAudioError("FLAC file is missing STREAMINFO");
  const s = 8; // STREAMINFO body
  const sampleRate = (b[s + 10] << 12) | (b[s + 11] << 4) | (b[s + 12] >> 4);
  const channels = ((b[s + 12] >> 1) & 0x07) + 1;
  const bitsPerSample = (((b[s + 12] & 0x01) << 4) | (b[s + 13] >> 4)) + 1;
  const total =
    (b[s + 13] & 0x0f) * 2 ** 32 + ((b[s + 14] << 24) >>> 0) + (b[s + 15] << 16) + (b[s + 16] << 8) + b[s + 17];
  return { format: "flac", sampleRate, channels, bitsPerSample, totalFrames: total > 0 ? total : null };
}

function toPcm(channelData: Float32Array[], channels: number): PcmChunk {
  return Array.from({ length: channels }, (_, c) => {
    const f = channelData[c] ?? channelData[0];
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = floatToInt16(f[i]);
    return out;
  });
}

export function flacStream(src: ByteSource, info: FlacInfo, bytesPerRead = 1 << 20): AudioStream {
  return {
    info,
    async *chunks() {
      const decoder = new FLACDecoder();
      await decoder.ready;
      try {
        for (let off = 0; off < src.size; off += bytesPerRead) {
          const decoded = await decoder.decode(await src.read(off, bytesPerRead));
          if (decoded.samplesDecoded > 0) yield toPcm(decoded.channelData, info.channels);
        }
        const tail = await decoder.flush();
        if (tail.samplesDecoded > 0) yield toPcm(tail.channelData, info.channels);
      } finally {
        decoder.free();
      }
    },
  };
}
