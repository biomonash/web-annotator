import type { NextConfig } from "next";

// Cross-origin isolation enables SharedArrayBuffer, which onnxruntime-web needs for multi-threaded WASM.
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

// `next build` produces a static site in `out/` (no server needed). Static export cannot set headers,
// so production hosts read them from `public/_headers` instead; `next dev` sets them here.
const isBuild = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  ...(isBuild
    ? { output: "export" }
    : { headers: async () => [{ source: "/:path*", headers: isolationHeaders }] }),
  experimental: {
    agentFeedback: true,
  },
  // cacheComponents / partialPrefetching are left off: they need a server (PPR) and break `output: "export"`.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
