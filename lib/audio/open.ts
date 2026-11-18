import { flacStream, parseFlacHeader } from "./flac";
import type { ByteSource } from "./source";
import { UnsupportedAudioError, type AudioStream } from "./types";
import { parseWavHeader, wavStream } from "./wav";

/** Detects the container from magic bytes and returns a streaming decoder. */
export async function openAudio(src: ByteSource): Promise<AudioStream> {
  const magic = await src.read(0, 4);
  const tag = String.fromCharCode(...magic);
  if (tag === "RIFF") return wavStream(src, await parseWavHeader(src));
  if (tag === "fLaC") return flacStream(src, await parseFlacHeader(src));
  throw new UnsupportedAudioError("Unsupported audio file: only WAV and FLAC are supported");
}
