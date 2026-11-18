import { defineConfig } from "@playwright/test";

// E2E needs the model served locally: `ln -s ../models public/models` and
// NEXT_PUBLIC_MODEL_URL=/models/perch_v2_no_dft.onnx in .env.local.
export default defineConfig({
  testDir: "e2e",
  timeout: 10 * 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_CHANNEL ?? "chrome",
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
