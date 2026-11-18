import type { Clip } from "./clips";

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

export function stopClip() {
  if (current) {
    current.onended = null;
    try {
      current.stop();
    } catch {
      // already stopped
    }
    current = null;
  }
}

/** Plays a mono clip; resolves when playback ends or is stopped. */
export function playClip(clip: Clip, onEnded: () => void): void {
  stopClip();
  ctx ??= new AudioContext();
  void ctx.resume();
  if (clip.samples.length === 0) {
    onEnded();
    return;
  }
  const buffer = ctx.createBuffer(1, clip.samples.length, clip.sampleRate);
  buffer.copyToChannel(clip.samples as Float32Array<ArrayBuffer>, 0);
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(ctx.destination);
  node.onended = () => {
    if (current === node) current = null;
    onEnded();
  };
  current = node;
  node.start();
}
