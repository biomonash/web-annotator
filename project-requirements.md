# Desired Website Features

## Stage 1

- AI model running in browser, predict approximate start time, end time and confidence level of Little Penguin Calls in 1 hour recordings.
- Selection table format checking.
- CSV/TSV Generation; Easy selection table modification.

## Tech Stack Plan

- NextJS (SSG)
- onnxruntime-web
- audio.js for loading audio files formats

## Other possible future features

Identificaci�n de aves por sonogramas

## **1. Interactive audio and spectrogram viewer**

**Top priority**

Display the waveform and spectrogram of a recording, with detected calls marked along the timeline. Users can click a detection to jump to that moment and listen to a short audio clip.

- Highlight the predicted start and end of each call.
- Show model confidence for each detection.
- Let users play a few seconds before and after a call.
- Allow users to correct inaccurate boundaries.

**Why it matters:** Users can validate the AI's output without manually listening to the entire one-hour recording.

AI Animal Tracking and Conservation: 10 Advances (2025) - Yenra

## **2. Human verification and annotation**

Allow researchers to label detections as:

- Correct Little Penguin call
- False positive
- Missed call
- Uncertain detection

Users could add their own annotations, correct timestamps, and save the reviewed results separately from the original AI predictions.

**Why it matters:** It makes the output more trustworthy and provides labelled examples for improving future model versions.

[](https://images.openai.com/static-rsc-4/qYxjwzZMsH9FyoW2S5LMFPSyCrKCtjK-RtKE2jkNJD0gZeQcj6Cfmu5DDpSR55Po9QgpJvXBfhw6VXWSNuNUdJhK8lGupNqyOXu8wQkIUp2ijFCgfs5-xdHXE38wHE_RhjDN0nR4vG3MiVAhSXyDAib9ZpfHPrMtrvXcifmKedE?purpose=inline)

## **3. Call activity visualisations**

Automatically generate useful summaries from the detected timestamps.

- Number of calls per minute or hour.
- A timeline showing periods of high calling activity.
- Call duration distributions.
- Time between consecutive calls.
- Comparisons between different recording sessions.

**Why it matters:** Researchers can explore patterns immediately instead of writing their own scripts to analyse every CSV file.

About — Out There Audio

## **4. Recording metadata and searchable archive**

Store information alongside each recording, such as:

- Recording date, start time, and location.
- Recorder model, sample rate, and microphone.
- Colony or monitoring site.
- Weather or environmental notes, when available.
- Research project, uploader, and tags.

Users could filter their archive by date, site, project, and detection count.

**Why it matters:** The database becomes a reusable research archive rather than just a collection of downloadable files.

Wildlife Monitoring for Species Conservation | Wildlife Acoustics

## **5. Compare call activity across dates and sites**

Let users compare recordings from different days, seasons, or monitoring locations.

For example, they could investigate whether calling activity is higher at certain times of night or changes across a breeding season.

**Why it matters:** This is where your platform starts supporting ecological research, not just audio processing.

Bioscreen C User's Manual - Oy Growth Curves Ab Ltd

## **6. Flexible exports and integrations**

Provide downloadable CSV and TSV files, with optional JSON exports and summary reports.

Useful additions include:

- Choose which columns to export.
- Export only detections within a selected time range.
- Download the original audio or selected audio clips.
- Export reviewed annotations separately from raw predictions.
- Provide an API for batch processing and integration with R or Python workflows.

**Why it matters:** Researchers can use the output in their existing analytical tools without being locked into your website.

## **2. Features that would make the website stand out**

These are particularly valuable once the basic upload, detection, and download workflow works.

| **Feature**              | **What it does**                                                                     | **Priority** |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------ |
| Batch uploads            | Upload many one-hour recordings and queue them for processing                        | High         |
| Processing status        | Show queued, processing, completed, or failed jobs                                   | High         |
| Resume and retry         | Recover from interrupted processing without restarting everything                    | High         |
| Duplicate detection      | Detect if the same audio has already been uploaded using a file hash                 | High         |
| Confidence filtering     | Let users include only detections above a chosen confidence threshold                | High         |
| Model version history    | Record which model version produced each result                                      | High         |
| Search within recordings | Find recordings with calls in a specific time interval or above a certain call count | Medium       |
| Scheduled reports        | Generate daily or weekly summaries of calling activity                               | Medium       |
| Team collaboration       | Share recordings, annotations, and results with other researchers                    | Medium       |
| Alerts                   | Notify users when processing finishes or unusual activity is detected                | Medium       |

One feature I particularly recommend is **reprocessing with a newer model without losing the old results**. AI models improve, and researchers may need to compare results from different versions to understand whether a change in detected calling activity is biological or simply due to a better detector.

## **3. Make the results more scientifically useful**

There are several important distinctions worth incorporating into the design.

### **A. Separate calls, call bouts, and calling activity**

A detector might identify individual vocal events, but users may also care about groups of calls occurring close together.

For example, a results table could contain:

| **Start (s)** | **End (s)** | **Duration (s)** | **Confidence** |
| ------------- | ----------- | ---------------- | -------------- |
| 125.40        | 126.10      | 0.70             | 0.96           |
| 127.25        | 127.80      | 0.55             | 0.91           |
| 134.10        | 135.20      | 1.10             | 0.84           |

These are illustrative detections, not actual model results.

From these events, your website could calculate call counts, total detected calling duration, and bouts of calling based on a configurable gap between calls.

Be careful not to treat every detected event as a distinct penguin. Unless your model supports individual identification, the website should report detected calls rather than the number of birds.

### **B. Make timestamps unambiguous**

Store the start and end times relative to the beginning of the WAV file, preferably in seconds with adequate precision. Also retain the recording's original start time and timezone if known.

This lets users move between relative timestamps such as **`00:02:05.400`** and real-world timestamps, while avoiding confusion when recordings are compared.

### **C. Communicate uncertainty**

A confidence score is useful, but it should not automatically be presented as the probability that a detection is correct unless the model has been calibrated accordingly.

Consider offering:

- A user-adjustable confidence threshold.
- A list of low-confidence detections to review.
- An indication of recordings where audio quality may make results unreliable.
- Evaluation metrics based on manually verified samples, such as precision and recall.

### **D. Preserve provenance**

For each processed recording, save the model version, inference settings, processing date, and output version. Preserve the original predictions even if users edit their annotations.

This makes the data reproducible and helps researchers explain how a result was produced.

## **4. Design the website around a simple workflow**

I would start with five main pages.

**1. Upload recordings**

Select WAV files, enter optional metadata, and submit them for processing.

**2. Processing queue**

View progress, errors, and estimated remaining work. Allow retries for failed jobs.

**3. Recording library**

Search previous uploads, view processing history, and download existing results without rerunning inference.

**4. Recording analysis**

View the waveform, spectrogram, detections, confidence scores, and editable annotations.

**5. Project dashboard**

Compare call activity across recordings, dates, and monitoring sites, and export summaries.

## **5. Recommended backend and database design**

Your requirement to avoid processing the same recording twice is important. I would separate the uploaded audio, the processing job, and the generated results.

A possible architecture is:

mermaid

```

flowchart TD
    A[User uploads WAV] --> B[Object storage]
    A --> C[API and metadata database]
    C --> D[Background job queue]
    D --> E[AI inference worker]
    E --> F[CSV or TSV output in object storage]
    E --> G[Update database status]
    G --> H[Recording library and download]
    H --> I[Audio review and visualisations]
```

### **Suggested database tables**

| **Table**              | **Purpose**                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| **`users`**            | User accounts and permissions                                           |
| **`projects`**         | Research projects or monitoring campaigns                               |
| **`recordings`**       | File name, storage key, file hash, duration, metadata, and upload owner |
| **`processing_jobs`**  | Status, model version, settings, errors, and timestamps                 |
| **`analysis_results`** | Output file location, format, version, and associated processing job    |
| **`annotations`**      | Human corrections and verification labels                               |

The files themselves should generally live in object storage, such as S3-compatible storage, rather than directly inside the relational database. The database stores their identifiers and metadata.

### **How to avoid redundant processing**

When a user uploads a recording:

1. Calculate a cryptographic hash, such as SHA-256, of the audio file.
2. Check whether the same audio content already has a completed analysis for the requested model version and settings.
3. If it does, reuse the existing result, subject to the user's access permissions.
4. Otherwise, enqueue a background processing job.
5. Save the output file and update the job status when processing finishes.

A key detail: **a WAV filename is not a reliable identifier for the audio content**. Different users may upload the same recording under different filenames, or reuse a filename for different audio.

Also, the same audio may legitimately need processing again if the model version or inference settings change. Track those separately so that caching does not return an outdated result.

For reliability, use unique constraints or equivalent safeguards so that simultaneous uploads cannot accidentally start duplicate jobs.

## **6. A sensible roadmap**

I would avoid building every feature at once. Start with the smallest version that provides real value to researchers.

## **Phase 1**

Core MVP

**Load, process, store, retrieve**

- Run ONNX model in web using onnxruntime-web
- Support WAV and FLAC file types
- CSV/TSV generation.

## **Phase 2**

Review

**Make the results trustworthy**

- Interactive audio player and spectrogram.
- Clickable detections.
- Confidence filtering.
- Manual verification and timestamp correction.
- Model version tracking.
- Recording library with persistent results.

## **Phase 3**

Research tools

**Turn detections into insights**

- Call activity dashboards.
- Comparison across dates and sites.
- Batch processing.
- Project-level access and collaboration.
- APIs and richer exports.
