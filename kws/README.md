# VoxAssist Keyword Spotting (KWS) Machine Learning Subsystem

This directory contains the dataset synthesis and neural network training pipeline for on-board wake phrase detection (**"parity"**, **"hello parity"**, and **"hey parity"**).

---

## Directory & File Guide

| File / Folder | Purpose | Description |
| :--- | :--- | :--- |
| **`generate_dataset.ps1`** | **Audio Dataset Generator** | Synthesizes native 16 kHz 16-bit Mono PCM audio files across multiple speech rates (100–200 wpm) and voices using Windows Speech Synthesis. Generates 4 classes: `parity`, `hello_parity`, `hey_parity`, and `noise`. |
| **`train_kws.py`** | **Neural Network Trainer & Exporter** | Converts audio into 32x16 spectrogram features, trains a compact Conv2D neural network, quantizes it to `int8`, and exports `parity_kws_model.h` (standalone C inference) and `test_audio_vector.h`. |
| **`parity_kws_model.tflite`** | **Quantized Model File** | 6.6 KB TensorFlow Lite quantized flatbuffer model ready for edge deployment. |
| **`parity_kws_model.h`** | **Exported C Code** | Header-only neural network ready to compile with MCUXpresso SDK for ARM Cortex-M33. |
| **`test_audio_vector.h`** | **Test Audio Sample** | 16,000 PCM samples (1 sec @ 16 kHz) of spoken *"parity"* for in-memory board verification without a physical mic. |
| **`dataset/`** | **Training Audio Dataset** | 73 normalized `.wav` audio files categorized by class (`parity`, `hello_parity`, `hey_parity`, `noise`). |

---

## How to Re-Train

```powershell
# 1. Generate audio files
powershell -ExecutionPolicy Bypass -File generate_dataset.ps1

# 2. Train and export C headers
python train_kws.py
```
