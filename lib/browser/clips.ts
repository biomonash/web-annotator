import { mixToMono, OverflowFixer } from "@/lib/audio/reconstruct";
import { blobSource } from "@/lib/audio/source";
import { parseWavHeader, readWavFrames } from "@/lib/audio/wav";

export interface Clip {
  sampleRate: number;
  samples: Float32Array;
}

export type ClipLoader = (startSec: number, endSec: number) => Promise<Clip>;

/** WAV supports random access, so clips are read straight from the file on the main thread. */
export async function wavClipLoader(file: Blob): Promise<ClipLoader> {
  const src = blobSource(file);
  const info = await parseWavHeader(src);
  return async (startSec, endSec) => {
    const start = Math.floor(startSec * info.sampleRate);
    const frames = Math.ceil((endSec - startSec) * info.sampleRate);
    const chans = await readWavFrames(src, info, start, frames);
    const mono = mixToMono(chans.map((c) => new OverflowFixer().process(c)));
    for (let i = 0; i < mono.length; i++) mono[i] /= 32768;
    return { sampleRate: info.sampleRate, samples: mono };
  };
}
