/**
 * Append-only store of mono int16 PCM, used to play clips from formats we cannot seek in (FLAC).
 * Backed by an OPFS file via a sync access handle (worker only); falls back to memory.
 */
export interface PcmStore {
  append(samples: Int16Array): void;
  /** Returns up to `count` samples starting at `start` (clamped to what has been written). */
  read(start: number, count: number): Int16Array;
  readonly length: number;
  close(): Promise<void>;
}

interface SyncHandle {
  write(buf: ArrayBufferView, opts: { at: number }): number;
  read(buf: ArrayBufferView, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

class OpfsPcmStore implements PcmStore {
  length = 0;
  constructor(
    private handle: SyncHandle,
    private dir: FileSystemDirectoryHandle,
    private name: string,
  ) {}

  append(samples: Int16Array) {
    this.handle.write(samples, { at: this.length * 2 });
    this.length += samples.length;
  }

  read(start: number, count: number) {
    const s = Math.max(0, Math.min(this.length, Math.floor(start)));
    const n = Math.max(0, Math.min(this.length - s, Math.floor(count)));
    const out = new Int16Array(n);
    this.handle.read(out, { at: s * 2 });
    return out;
  }

  async close() {
    this.handle.close();
    await this.dir.removeEntry(this.name).catch(() => {});
  }
}

class MemoryPcmStore implements PcmStore {
  private chunks: Int16Array[] = [];
  private starts: number[] = [];
  length = 0;

  append(samples: Int16Array) {
    this.starts.push(this.length);
    this.chunks.push(samples);
    this.length += samples.length;
  }

  read(start: number, count: number) {
    const s = Math.max(0, Math.min(this.length, Math.floor(start)));
    const e = Math.min(this.length, s + Math.max(0, Math.floor(count)));
    const out = new Int16Array(e - s);
    this.chunks.forEach((c, i) => {
      const cs = this.starts[i];
      const lo = Math.max(s, cs);
      const hi = Math.min(e, cs + c.length);
      if (lo < hi) out.set(c.subarray(lo - cs, hi - cs), lo - s);
    });
    return out;
  }

  async close() {
    this.chunks = [];
  }
}

export async function createPcmStore(name: string): Promise<PcmStore> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("pcm", { create: true });
    const file = await dir.getFileHandle(name, { create: true });
    const handle = (await (
      file as unknown as { createSyncAccessHandle(): Promise<SyncHandle & { truncate(n: number): void }> }
    ).createSyncAccessHandle());
    handle.truncate(0);
    return new OpfsPcmStore(handle, dir, name);
  } catch (e) {
    console.warn("OPFS unavailable, keeping clip audio in memory", e);
    return new MemoryPcmStore();
  }
}

/** Removes PCM files left behind by previous sessions. */
export async function clearPcmStores(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("pcm", { recursive: true });
  } catch {
    // nothing to clear
  }
}
