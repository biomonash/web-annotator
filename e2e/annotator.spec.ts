import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// 62 s of quiet pink noise, 48 kHz stereo, as WAV and FLAC (needs sox + flac on PATH).
const dir = mkdtempSync(join(tmpdir(), "annotator-e2e-"));
const wav = join(dir, "noise.wav");
const flac = join(dir, "noise.flac");
execFileSync("sox", ["-n", "-r", "48000", "-c", "2", "-b", "16", wav, "synth", "62", "pinknoise", "vol", "0.05"]);
execFileSync("flac", ["-s", "-f", "-o", flac, wav]);

for (const [label, file] of [
  ["WAV", wav],
  ["FLAC", flac],
] as const) {
  test(`analyses a ${label} file, streams windows and plays clips`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);

    await page.locator('input[type="file"][accept^=".wav"]').setInputFiles(file);
    await expect(page.getByText(/Ready \((WebGPU|WASM)/)).toBeVisible({ timeout: 5 * 60_000 });
    await expect(page.getByText(/Done in/)).toBeVisible({ timeout: 5 * 60_000 });
    await expect(page.getByText(/48000 Hz · 2 ch/)).toBeVisible();

    // Noise has no real calls: drop the top-class rule and use a low threshold so most windows count as
    // detections and the table/playback/export paths are exercised.
    await page.getByLabel("Penguin must be top class").uncheck();
    await page.locator('input[type="range"]').fill("0.05");
    const playButtons = page.getByRole("button", { name: "▶ Play" });
    await expect(playButtons.first()).toBeVisible();

    await playButtons.first().click();
    await expect(page.getByRole("button", { name: "■ Stop" })).toBeVisible();
    await expect(page.getByText(/Could not play clip/)).toHaveCount(0);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download TSV (Raven)" }).click();
    expect((await download).suggestedFilename()).toBe("noise.Table.1.selections.tsv");

    expect(errors).toEqual([]);
  });
}
