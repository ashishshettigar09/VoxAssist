import os
import numpy as np
import tensorflow as tf
from scipy.io import wavfile

SAMPLE_RATE = 16000
DURATION = 1.0  # 1 second
NUM_SAMPLES = int(SAMPLE_RATE * DURATION)
CLASSES = ["noise", "parity", "hello_parity", "hey_parity"]

base_dir = r"c:\Users\ashis\.gemini\antigravity-ide\scratch\Iotproject\kws\dataset"

def compute_spectrogram(waveform):
    # 512 frame length, 256 step -> 61 frames x 257 freq bins
    stft = tf.signal.stft(waveform, frame_length=512, frame_step=256)
    spectrogram = tf.abs(stft)
    # Downsample to 32 time frames x 16 frequency bands
    spectrogram = tf.image.resize(spectrogram[..., tf.newaxis], [32, 16])
    return spectrogram.numpy()

print("1/4: Loading dataset and computing audio spectrogram features...")
X, y = [], []
for label_idx, label in enumerate(CLASSES):
    folder = os.path.join(base_dir, label)
    if not os.path.exists(folder):
        continue
    for f in os.listdir(folder):
        if f.endswith(".wav"):
            sr, data = wavfile.read(os.path.join(folder, f))
            if len(data.shape) > 1:
                data = data[:, 0]
            if len(data) < NUM_SAMPLES:
                data = np.pad(data, (0, NUM_SAMPLES - len(data)))
            else:
                data = data[:NUM_SAMPLES]
            norm_audio = data.astype(np.float32) / 32768.0
            spec = compute_spectrogram(norm_audio)
            X.append(spec)
            y.append(label_idx)

X = np.array(X)
y = tf.keras.utils.to_categorical(y, num_classes=len(CLASSES))

print(f"Total dataset samples: {len(X)}")

# -------------------------------------------------------------
# 2. Build and Train Compact Convolutional Neural Network
# -------------------------------------------------------------
print("2/4: Training Neural Network...")

model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(32, 16, 1)),
    tf.keras.layers.Conv2D(8, (3, 3), activation='relu', padding='same'),
    tf.keras.layers.MaxPooling2D((2, 2)),
    tf.keras.layers.Conv2D(16, (3, 3), activation='relu', padding='same'),
    tf.keras.layers.GlobalAveragePooling2D(),
    tf.keras.layers.Dense(16, activation='relu'),
    tf.keras.layers.Dense(len(CLASSES), activation='softmax')
])

model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=0.005),
              loss='categorical_crossentropy',
              metrics=['accuracy'])

history = model.fit(X, y, epochs=50, batch_size=8, verbose=0)
final_acc = history.history['accuracy'][-1]
final_loss = history.history['loss'][-1]
print(f"Training Complete! Accuracy: {final_acc*100:.1f}%, Loss: {final_loss:.4f}")

# -------------------------------------------------------------
# 3. Export TFLite Model
# -------------------------------------------------------------
print("3/4: Converting to TensorFlow Lite (int8)...")
converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()

tflite_path = "parity_kws_model.tflite"
with open(tflite_path, "wb") as f:
    f.write(tflite_model)
print(f"Saved: {tflite_path} ({len(tflite_model)} bytes)")

# -------------------------------------------------------------
# 4. Export C Source and Header Files for MCUXpresso
# -------------------------------------------------------------
print("4/4: Exporting C Headers for MCUXpresso FRDM-MCXW71...")

# Extract model weights
w_conv1, b_conv1 = model.layers[0].get_weights()
w_conv2, b_conv2 = model.layers[2].get_weights()
w_dense1, b_dense1 = model.layers[4].get_weights()
w_dense2, b_dense2 = model.layers[5].get_weights()

def format_c_array(arr, name):
    flat = arr.flatten()
    s = f"static const float {name}[{len(flat)}] = {{\n  "
    for i, val in enumerate(flat):
        s += f"{val:.6f}f, "
        if (i + 1) % 8 == 0:
            s += "\n  "
    s += "\n};\n\n"
    return s

c_code = """/*
 * ============================================================================
 * Parity Keyword Spotting (KWS) Embedded Inference Engine
 * Target: NXP FRDM-MCXW71 (ARM Cortex-M33)
 * Classes: [0: noise, 1: parity, 2: hello_parity, 3: hey_parity]
 * ============================================================================
 */
#ifndef PARITY_KWS_MODEL_H
#define PARITY_KWS_MODEL_H

#include <stdint.h>
#include <stdbool.h>
#include <math.h>

#define KWS_INPUT_SAMPLES    16000U
#define KWS_TIME_FRAMES      32U
#define KWS_FREQ_BINS        16U
#define KWS_NUM_CLASSES      4U

/* Class Labels */
#define KWS_CLASS_NOISE          0U
#define KWS_CLASS_PARITY         1U
#define KWS_CLASS_HELLO_PARITY   2U
#define KWS_CLASS_HEY_PARITY     3U

"""

c_code += format_c_array(w_conv1, "g_kws_w_conv1")
c_code += format_c_array(b_conv1, "g_kws_b_conv1")
c_code += format_c_array(w_conv2, "g_kws_w_conv2")
c_code += format_c_array(b_conv2, "g_kws_b_conv2")
c_code += format_c_array(w_dense1, "g_kws_w_dense1")
c_code += format_c_array(b_dense1, "g_kws_b_dense1")
c_code += format_c_array(w_dense2, "g_kws_w_dense2")
c_code += format_c_array(b_dense2, "g_kws_b_dense2")

c_code += """
/* Fast feature extraction: Envelope & Spectral Energy into 32x16 Grid */
static void KWS_ExtractSpectrogram(const int16_t *audio, float spec[32][16])
{
    for (uint32_t t = 0; t < 32; t++)
    {
        uint32_t offset = t * 500;
        for (uint32_t f = 0; f < 16; f++)
        {
            float energy = 0.0f;
            uint32_t step = f + 1;
            for (uint32_t k = 0; k < 30; k++)
            {
                uint32_t idx = offset + (k * step) % 500;
                float val = ((float)audio[idx]) / 32768.0f;
                energy += val * val;
            }
            spec[t][f] = sqrtf(energy / 30.0f);
        }
    }
}

/* Run inference directly on the ARM Cortex-M33 */
static int KWS_ClassifyAudio(const int16_t *audio, float *out_confidence)
{
    static float spec[32][16];
    static float conv1[32][16][8];
    static float pool1[16][8][8];
    static float conv2[16][8][16];
    static float gap[16];
    static float dense1[16];
    static float output[4];

    /* 1. Feature Extraction */
    KWS_ExtractSpectrogram(audio, spec);

    /* 2. Conv1D / Conv2D Layer 1 (3x3, 8 filters, ReLU, padding=same) */
    for (int t = 0; t < 32; t++) {
        for (int f = 0; f < 16; f++) {
            for (int k = 0; k < 8; k++) {
                float sum = g_kws_b_conv1[k];
                for (int di = -1; di <= 1; di++) {
                    int it = t + di;
                    if (it < 0 || it >= 32) continue;
                    for (int dj = -1; dj <= 1; dj++) {
                        int jf = f + dj;
                        if (jf < 0 || jf >= 16) continue;
                        int w_idx = ((di + 1) * 3 + (dj + 1)) * 8 + k;
                        sum += spec[it][jf] * g_kws_w_conv1[w_idx];
                    }
                }
                conv1[t][f][k] = (sum > 0.0f) ? sum : 0.0f; /* ReLU */
            }
        }
    }

    /* 3. MaxPool (2x2) */
    for (int t = 0; t < 16; t++) {
        for (int f = 0; f < 8; f++) {
            for (int k = 0; k < 8; k++) {
                float max_v = conv1[t*2][f*2][k];
                if (conv1[t*2+1][f*2][k] > max_v) max_v = conv1[t*2+1][f*2][k];
                if (conv1[t*2][f*2+1][k] > max_v) max_v = conv1[t*2][f*2+1][k];
                if (conv1[t*2+1][f*2+1][k] > max_v) max_v = conv1[t*2+1][f*2+1][k];
                pool1[t][f][k] = max_v;
            }
        }
    }

    /* 4. Conv2D Layer 2 (3x3, 16 filters, ReLU) */
    for (int t = 0; t < 16; t++) {
        for (int f = 0; f < 8; f++) {
            for (int k = 0; k < 16; k++) {
                float sum = g_kws_b_conv2[k];
                for (int di = -1; di <= 1; di++) {
                    int it = t + di;
                    if (it < 0 || it >= 16) continue;
                    for (int dj = -1; dj <= 1; dj++) {
                        int jf = f + dj;
                        if (jf < 0 || jf >= 8) continue;
                        for (int c = 0; c < 8; c++) {
                            int w_idx = (((di + 1) * 3 + (dj + 1)) * 8 + c) * 16 + k;
                            sum += pool1[it][jf][c] * g_kws_w_conv2[w_idx];
                        }
                    }
                }
                conv2[t][f][k] = (sum > 0.0f) ? sum : 0.0f; /* ReLU */
            }
        }
    }

    /* 5. Global Average Pooling (16x8 -> 16) */
    for (int k = 0; k < 16; k++) {
        float sum = 0.0f;
        for (int t = 0; t < 16; t++) {
            for (int f = 0; f < 8; f++) {
                sum += conv2[t][f][k];
            }
        }
        gap[k] = sum / 128.0f;
    }

    /* 6. Dense Layer 1 (16 -> 16, ReLU) */
    for (int j = 0; j < 16; j++) {
        float sum = g_kws_b_dense1[j];
        for (int i = 0; i < 16; i++) {
            sum += gap[i] * g_kws_w_dense1[i * 16 + j];
        }
        dense1[j] = (sum > 0.0f) ? sum : 0.0f;
    }

    /* 7. Output Dense (16 -> 4, Softmax) */
    float max_logit = -1e9f;
    for (int j = 0; j < 4; j++) {
        float sum = g_kws_b_dense2[j];
        for (int i = 0; i < 16; i++) {
            sum += dense1[i] * g_kws_w_dense2[i * 4 + j];
        }
        output[j] = sum;
        if (sum > max_logit) max_logit = sum;
    }

    /* Softmax */
    float sum_exp = 0.0f;
    for (int j = 0; j < 4; j++) {
        output[j] = expf(output[j] - max_logit);
        sum_exp += output[j];
    }

    int best_class = 0;
    float best_prob = 0.0f;
    for (int j = 0; j < 4; j++) {
        output[j] /= sum_exp;
        if (output[j] > best_prob) {
            best_prob = output[j];
            best_class = j;
        }
    }

    if (out_confidence != 0) {
        *out_confidence = best_prob;
    }
    return best_class;
}

#endif /* PARITY_KWS_MODEL_H */
"""

with open("parity_kws_model.h", "w") as f:
    f.write(c_code)

print("Saved: parity_kws_model.h (Stand-alone C inference engine)")

# -------------------------------------------------------------
# 5. Export Test Audio Vector (Actual 1-second sample of "parity")
# -------------------------------------------------------------
parity_folder = os.path.join(base_dir, "parity")
sample_file = os.path.join(parity_folder, os.listdir(parity_folder)[0])
sr, sample_pcm = wavfile.read(sample_file)
if len(sample_pcm.shape) > 1: sample_pcm = sample_pcm[:, 0]
if len(sample_pcm) < NUM_SAMPLES: sample_pcm = np.pad(sample_pcm, (0, NUM_SAMPLES - len(sample_pcm)))
else: sample_pcm = sample_pcm[:NUM_SAMPLES]

test_vector_code = f"""#ifndef TEST_AUDIO_VECTOR_H
#define TEST_AUDIO_VECTOR_H

#include <stdint.h>

#define TEST_AUDIO_SAMPLES {NUM_SAMPLES}U

/* 1 Second of 16 kHz 16-bit PCM Audio containing the spoken word "parity" */
static const int16_t g_test_audio_sample[TEST_AUDIO_SAMPLES] = {{
  """

for i, val in enumerate(sample_pcm):
    test_vector_code += f"{int(val)}, "
    if (i + 1) % 12 == 0:
        test_vector_code += "\n  "

test_vector_code += "\n};\n\n#endif /* TEST_AUDIO_VECTOR_H */\n"

with open("test_audio_vector.h", "w") as f:
    f.write(test_vector_code)

print("Saved: test_audio_vector.h (16,000 PCM samples of 'parity')")
print("\nAll Step 3 outputs successfully generated!")
