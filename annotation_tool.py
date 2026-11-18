# Requires: pip install onnxruntime scipy soundfile
# (soundfile reads WAV, FLAC and MP3; MP3 needs libsndfile >= 1.1, which current soundfile wheels bundle)
#
# Download the model from https://huggingface.co/justinchuby/Perch-onnx/blob/main/perch_v2_no_dft.onnx
# and point MODEL_PATH at it.
#
# Usage:  python penguin_selections.py path/to/audio.wav
#         (or edit INPUT_FILEPATH below and run without arguments)
#
# Output: <audio dir>/selections/<Audio_File_Name>.Table.1.selections.tsv

import csv
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import scipy.signal
import soundfile as sf

# Replace with model path here
MODEL_PATH = "./models/perch_v2_no_dft.onnx"
# Testing purposes only
INPUT_FILEPATH = "./LISA_20260604_135402.wav"

PENGUIN_CLASS_INDEX = 4878
WINDOW_SECONDS = 5
MODEL_RATE = 32000

HEADERS = [
    "Selection",
    "View",
    "Channel",
    "Begin Time (s)",
    "End Time (s)",
    "Annotation",
    "call_type",
    "condition",
    "distance",
    "count",
]

ort_sess = ort.InferenceSession(MODEL_PATH)


def prepare_data(sample):
    resampled = np.asarray(
        scipy.signal.resample(sample, WINDOW_SECONDS * MODEL_RATE), dtype=np.float64
    )
    scaled = np.interp(
        resampled, [np.iinfo(np.int16).min, np.iinfo(np.int16).max], [0.0, 1.0]
    )
    return scaled.astype(np.float32)[None, :]


def get_reconstruction(data):
    # boolean array where starts[i] is True if data[i] > 10000 and data[i+1] < -30000
    starts = (data[:-1] > 10000) & (data[1:] < -30000)
    starts = np.where(starts)[0]

    # for each detected overflow start, figure out where the overflow region ends
    ends = np.zeros_like(starts)
    for i, s in enumerate(starts):
        for j in range(s + 1, len(data)):
            if data[j] > -15000:
                break
        ends[i] = j

    # overwrite the overflow values with the large positive clipped value it should've been recorded as
    reconstruction = data.copy()
    for s, e in zip(starts, ends):
        reconstruction[s + 1 : e] = np.iinfo(np.int16).max

    return reconstruction


def read_audio(input_filepath):
    """Returns (rate, mono int16 waveform with clipping fix applied, number of channels)."""
    data, rate = sf.read(str(input_filepath), dtype="int16", always_2d=True)
    n_channels = data.shape[1]

    # apply the clipping fix per channel, then mix down to mono for the model
    channels = [get_reconstruction(data[:, c]) for c in range(n_channels)]
    if n_channels == 1:
        mono = channels[0]
    else:
        mono = np.mean(np.stack(channels, axis=1), axis=1).astype(np.int16)

    return rate, mono, n_channels


def process_waveform(rate, waveform):
    outputs_list = []
    window = WINDOW_SECONDS * rate
    windows: int = waveform.shape[0] // window
    for i in range(windows):
        print(f"Processing {i + 1} / {windows} window")
        sample = waveform[i * window : (i + 1) * window]
        outputs = ort_sess.run(None, {"inputs": prepare_data(sample)})
        outputs_list.append(outputs)

    return [np.concatenate(A, axis=0) for A in zip(*outputs_list)]


def find_penguin_runs(class_logits):
    is_penguin = class_logits.argmax(axis=-1) == PENGUIN_CLASS_INDEX
    # pad one non-penguin window at the end so a run in the last window is closed correctly
    is_penguin = np.concatenate([is_penguin, np.zeros(1, dtype=bool)])

    runs = []
    run_start = None
    for i, flag in enumerate(is_penguin):
        if flag and run_start is None:
            run_start = i
        elif not flag and run_start is not None:
            runs.append((run_start * WINDOW_SECONDS, i * WINDOW_SECONDS))
            run_start = None
    return runs


def write_selection_table(input_filepath, runs, n_channels):
    input_filepath = Path(input_filepath)
    out_dir = input_filepath.resolve().parent / "selections"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{input_filepath.stem}.Table.1.selections.tsv"

    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f, delimiter="\t", lineterminator="\n")
        writer.writerow(HEADERS)
        for idx, (begin, end) in enumerate(runs, start=1):
            writer.writerow(
                [
                    idx,  # Selection (unique, incremental from 1)
                    "Spectrogram 1",  # View
                    n_channels,  # Channel (read from the audio)
                    begin,  # Begin Time (s)
                    end,  # End Time (s)
                    "penguin",  # Annotation
                    "",
                    "",
                    "",
                    "",  # call_type, condition, distance, count left empty
                ]
            )

    return out_path


def main():
    input_filepath = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILEPATH

    print(f"Read audio from {input_filepath}")
    rate, waveform, n_channels = read_audio(input_filepath)

    print("Processing waveform")
    class_logits = process_waveform(rate, waveform)[
        3
    ]  # outputs: embeddings, spatiotemporal_embeddings, spectrogram, class_logits

    print("Inference model")
    runs = find_penguin_runs(class_logits)

    print("Write result")
    out_path = write_selection_table(input_filepath, runs, n_channels)
    print(f"Wrote {len(runs)} selections to {out_path}")


if __name__ == "__main__":
    main()
