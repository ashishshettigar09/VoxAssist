import os
import pyttsx3
import numpy as np
import scipy.io.wavfile as wavfile
from scipy import signal

TARGET_SAMPLE_RATE = 16000
TARGET_SAMPLES = 16000  # 1 second of audio at 16 kHz

dataset_dir = "dataset"
classes = ["parity", "hello_parity", "hey_parity", "noise"]

# Create output subdirectories
for c in classes:
    os.makedirs(os.path.join(dataset_dir, c), exist_ok=True)

engine = pyttsx3.init()

# List available voices (Windows typically has Microsoft David and Zira)
voices = engine.getProperty('voices')

phrases = {
    "parity": "parity",
    "hello_parity": "hello parity",
    "hey_parity": "hey parity"
}

# Speeds (Words Per Minute)
rates = [90, 110, 125, 140, 155, 170, 185, 200]

def normalize_and_resample(file_path):
    """Ensure the audio file is strictly 16 kHz, 16-bit mono, 1-second long."""
    sr, data = wavfile.read(file_path)
    
    # If stereo, take first channel
    if len(data.shape) > 1:
        data = data[:, 0]
    
    # Resample to 16 kHz if not already
    if sr != TARGET_SAMPLE_RATE:
        num_target_samples = int(len(data) * TARGET_SAMPLE_RATE / sr)
        data = signal.resample(data, num_target_samples)
    
    data = data.astype(np.float32)
    
    # Peak normalize
    max_val = np.max(np.abs(data))
    if max_val > 0:
        data = (data / max_val) * 28000.0
    
    data = data.astype(np.int16)
    
    # Pad with silence or center inside 1 second (16000 samples)
    if len(data) < TARGET_SAMPLES:
        pad_total = TARGET_SAMPLES - len(data)
        pad_front = pad_total // 2
        pad_back = pad_total - pad_front
        data = np.pad(data, (pad_front, pad_back), mode='constant')
    else:
        # Trim to 1 second
        data = data[:TARGET_SAMPLES]
        
    wavfile.write(file_path, TARGET_SAMPLE_RATE, data)

print("1/2: Synthesizing wake phrase audio files...")
file_count = 0

for label, phrase_text in phrases.items():
    for v_idx, v in enumerate(voices[:2]):  # Use available system voices (male / female)
        engine.setProperty('voice', v.id)
        for r_idx, rate in enumerate(rates):
            filename = os.path.join(dataset_dir, label, f"{label}_v{v_idx}_r{rate}.wav")
            engine.setProperty('rate', rate)
            engine.save_to_file(phrase_text, filename)
            engine.runAndWait()
            
            # Post-process to strict 16 kHz 1-second format
            normalize_and_resample(filename)
            file_count += 1

print(f"Generated {file_count} speech audio files across multiple voices and speeds.")

# 2. Synthesize Background Silence & Ambient Noise
print("2/2: Generating ambient noise & silence samples...")
noise_count = 0
for i in range(25):
    # Gaussian ambient noise
    noise_level = np.random.randint(50, 300)
    noise_data = (np.random.randn(TARGET_SAMPLES) * noise_level).astype(np.int16)
    filename = os.path.join(dataset_dir, "noise", f"noise_ambient_{i}.wav")
    wavfile.write(filename, TARGET_SAMPLE_RATE, noise_data)
    noise_count += 1

# Low frequency hum (simulating fans / electronics)
t = np.linspace(0, 1.0, TARGET_SAMPLES, endpoint=False)
for freq in [50, 60, 100, 120]:
    hum = (np.sin(2 * np.pi * freq * t) * 400).astype(np.int16)
    filename = os.path.join(dataset_dir, "noise", f"noise_hum_{freq}hz.wav")
    wavfile.write(filename, TARGET_SAMPLE_RATE, hum)
    noise_count += 1

print(f"Generated {noise_count} ambient noise/silence files.")
print(f"\nSUCCESS: Dataset successfully created in {os.path.abspath(dataset_dir)}")
