/** Perch v2 (no-DFT ONNX export) model constants. */
export const PERCH = {
  modelId: "perch_v2_no_dft",
  inputName: "inputs",
  outputName: "label",
  sampleRate: 32000,
  windowSeconds: 5,
  windowSamples: 5 * 32000,
  numClasses: 14795,
  penguinClassIndex: 4878,
} as const;

/**
 * How int16 audio is mapped to model input.
 * - `poc`: same as the Python PoC, int16 range → [0, 1] (adds a +0.5 DC offset).
 * - `signed`: int16 / 32768 → [-1, 1], the usual waveform convention.
 */
export type InputScaling = "poc" | "signed";

export interface AnalysisSettings {
  inputScaling: InputScaling;
  /** Windows sent to the model per inference call. */
  batchSize: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  inputScaling: "poc",
  batchSize: 4,
};

/**
 * Minimum sigmoid(penguin logit) for a window to count as a call.
 * 0 = no cutoff, which together with "top class only" matches the Python PoC.
 * The default is high so that calls are not lost to the strict "top class" rule.
 */
export const DEFAULT_THRESHOLD = 0.95;