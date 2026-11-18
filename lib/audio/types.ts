export type AudioFormat = "wav" | "flac";

export interface AudioInfo {
  format: AudioFormat;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Total frames (samples per channel), if known from the header. */
  totalFrames: number | null;
}

/** Planar int16 PCM: one array per channel, all the same length. */
export type PcmChunk = Int16Array[];

export interface AudioStream {
  info: AudioInfo;
  /** Streams the whole file as planar int16 chunks, in order. */
  chunks(): AsyncIterable<PcmChunk>;
}

export class UnsupportedAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedAudioError";
  }
}

export function floatToInt16(x: number): number {
  const v = Math.round(x * 32768);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}
