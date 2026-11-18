const CACHE_NAME = "web-annotator-models-v1";

export interface ModelDownloadProgress {
  loaded: number;
  total: number | null;
  cached: boolean;
}

/**
 * Fetches the ONNX model, keeping a copy in the Cache API so later visits skip the download.
 * Works in windows and workers.
 */
export async function fetchModel(
  url: string,
  onProgress: (p: ModelDownloadProgress) => void,
): Promise<Uint8Array> {
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE_NAME) : null;
  const hit = await cache?.match(url);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    onProgress({ loaded: bytes.byteLength, total: bytes.byteLength, cached: true });
    return bytes;
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || null;

  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  let lastReport = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      throw new Error(`Model download interrupted after ${Math.round(loaded / 2 ** 20)} MB: ${(e as Error)?.message ?? e}`);
    }
    const { done, value } = chunk;
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    if (loaded - lastReport > 1 << 20) {
      onProgress({ loaded, total, cached: false });
      lastReport = loaded;
    }
  }

  const bytes = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.byteLength;
  }
  onProgress({ loaded, total: loaded, cached: false });

  try {
    await cache?.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  } catch (e) {
    console.warn("Could not cache model (storage quota?)", e);
  }
  return bytes;
}

export async function isModelCached(url: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(url)) != null;
}
