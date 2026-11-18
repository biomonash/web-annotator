import type { ByteSource } from "./source";
import {
  UnsupportedAudioError,
  type AudioInfo,
  type AudioStream,
  type PcmChunk,
} from "./types";

export interface WavInfo extends AudioInfo {
  format: "wav";
  /** 1 = integer PCM, 3 = IEEE float. */
  sampleFormat: 1 | 3;
  blockAlign: number;
  dataOffset: number;
  dataLength: number;
  totalFrames: number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

/** Parses RIFF/WAVE chunks up to the `data` chunk. Does not read sample data. */
export async function parseWavHeader(src: ByteSource): Promise<WavInfo> {
  const head = await src.read(0, 12);
  if (head.length < 12 || fourcc(head, 0) !== "RIFF" || fourcc(head, 8) !== "WAVE") {
    throw new UnsupportedAudioError("Not a RIFF/WAVE file");
  }

  let offset = 12;
  let fmt: { sampleFormat: 1 | 3; channels: number; sampleRate: number; blockAlign: number; bits: number } | null =
    null;

  while (offset + 8 <= src.size) {
    const hdr = await src.read(offset, 8);
    const id = fourcc(hdr, 0);
    const size = new DataView(hdr.buffer, hdr.byteOffset, 8).getUint32(4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      const f = await src.read(body, Math.min(size, 40));
      const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
      let tag = v.getUint16(0, true);
      if (tag === WAVE_FORMAT_EXTENSIBLE && f.byteLength >= 26) {
        tag = v.getUint16(24, true); // first two bytes of the SubFormat GUID
      }
      if (tag !== WAVE_FORMAT_PCM && tag !== WAVE_FORMAT_IEEE_FLOAT) {
        throw new UnsupportedAudioError(`Unsupported WAV encoding (format tag ${tag})`);
      }
      fmt = {
        sampleFormat: tag as 1 | 3,
        channels: v.getUint16(2, true),
        sampleRate: v.getUint32(4, true),
        blockAlign: v.getUint16(12, true),
        bits: v.getUint16(14, true),
      };
      const okInt = fmt.sampleFormat === 1 && [8, 16, 24, 32].includes(fmt.bits);
      const okFloat = fmt.sampleFormat === 3 && [32, 64].includes(fmt.bits);
      if (!okInt && !okFloat) {
        throw new UnsupportedAudioError(`Unsupported WAV bit depth: ${fmt.bits}`);
      }
    } else if (id === "data") {
      if (!fmt) throw new UnsupportedAudioError("WAV data chunk before fmt chunk");
      // Some recorders write 0 or 0xFFFFFFFF for the size of streamed files.
      const available = src.size - body;
      const dataLength = size === 0 || size === 0xffffffff || size > available ? available : size;
      const usable = dataLength - (dataLength % fmt.blockAlign);
      return {
        format: "wav",
        sampleFormat: fmt.sampleFormat,
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        blockAlign: fmt.blockAlign,
        dataOffset: body,
        dataLength: usable,
        totalFrames: usable / fmt.blockAlign,
      };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  throw new UnsupportedAudioError("WAV file has no data chunk");
}

/** Converts interleaved little-endian frames to planar int16. */
export function decodeWavFrames(info: WavInfo, bytes: Uint8Array): PcmChunk {
  const { channels, bitsPerSample: bits, sampleFormat, blockAlign } = info;
  const frames = Math.floor(bytes.byteLength / blockAlign);
  const out: PcmChunk = Array.from({ length: channels }, () => new Int16Array(frames));
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bps = bits / 8;

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const p = i * blockAlign + c * bps;
      let s: number;
      if (sampleFormat === 3) {
        const x = bits === 32 ? v.getFloat32(p, true) : v.getFloat64(p, true);
        s = Math.round(x * 32768);
        s = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
      } else if (bits === 16) {
        s = v.getInt16(p, true);
      } else if (bits === 24) {
        // keep the top 16 bits so int16 wrap-around artefacts look the same as in 16-bit files
        s = (v.getInt8(p + 2) << 8) | v.getUint8(p + 1);
      } else if (bits === 32) {
        s = v.getInt32(p, true) >> 16;
      } else {
        s = (v.getUint8(p) - 128) << 8; // 8-bit WAV is unsigned
      }
      out[c][i] = s;
    }
  }
  return out;
}

export async function readWavFrames(
  src: ByteSource,
  info: WavInfo,
  startFrame: number,
  frameCount: number,
): Promise<PcmChunk> {
  const start = Math.max(0, Math.min(info.totalFrames, Math.floor(startFrame)));
  const end = Math.max(start, Math.min(info.totalFrames, Math.floor(startFrame + frameCount)));
  const bytes = await src.read(info.dataOffset + start * info.blockAlign, (end - start) * info.blockAlign);
  return decodeWavFrames(info, bytes);
}

export function wavStream(src: ByteSource, info: WavInfo, framesPerChunk = 1 << 16): AudioStream {
  return {
    info,
    async *chunks() {
      for (let f = 0; f < info.totalFrames; f += framesPerChunk) {
        yield await readWavFrames(src, info, f, framesPerChunk);
      }
    },
  };
}
