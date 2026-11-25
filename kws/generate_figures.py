"""
Publication-Grade 300 DPI IEEE Figure Generator for VisioTinyML
Generates:
  1. figures/fig4_ringbuffer_fsm_vad.png
     (Lossless 16.25 KB Circular FIFO Ring Buffer, BLE Backpressure FSM, and VAD Timing Flow)
  2. figures/fig6_kws_confusion_convergence.png
     (Exact Table IV 5-Fold CV 4x4 Confusion Matrix Heatmap & 50-Epoch Training Convergence)
"""

import os
import numpy as np
import tensorflow as tf
from scipy.io import wavfile

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Wedge, FancyArrowPatch

plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['Times New Roman', 'DejaVu Serif']
plt.rcParams['axes.edgecolor'] = '#1E293B'
plt.rcParams['axes.linewidth'] = 0.8

OUT_DIR = r"c:\Users\ashis\.gemini\antigravity-ide\scratch\Iotproject\figures"
os.makedirs(OUT_DIR, exist_ok=True)


# ==============================================================================
# FIGURE 4: Lossless 16.25 KB Ring Buffer, BLE Backpressure FSM & VAD Flow
# ==============================================================================
def generate_fig4():
    print("Generating clean collision-free Fig. 4...")
    fig, ax = plt.subplots(figsize=(7.6, 5.1), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 69)
    ax.axis('off')

    def box(x, y, w, h, title, body="", fc="#F8FAFC", ec="#1E293B", tc="#0F172A", title_sz=7.3, body_sz=6.0):
        patch = FancyBboxPatch(
            (x, y), w, h,
            boxstyle="round,pad=0.30,rounding_size=0.9",
            facecolor=fc, edgecolor=ec, linewidth=1.0
        )
        ax.add_patch(patch)
        if body:
            ax.text(x + w/2, y + h*0.69, title, ha='center', va='center',
                    fontsize=title_sz, fontweight='bold', color=tc)
            ax.text(x + w/2, y + h*0.30, body, ha='center', va='center',
                    fontsize=body_sz, color='#334155', linespacing=1.15)
        else:
            ax.text(x + w/2, y + h/2, title, ha='center', va='center',
                    fontsize=title_sz, fontweight='bold', color=tc, linespacing=1.15)

    def arrow(x1, y1, x2, y2, label="", lx=None, ly=None, col="#1E293B", rad=0.0, ls='-'):
        arr = FancyArrowPatch(
            (x1, y1), (x2, y2),
            connectionstyle=f"arc3,rad={rad}",
            arrowstyle="-|>,head_length=4.5,head_width=2.6",
            color=col, linewidth=1.05, linestyle=ls
        )
        ax.add_patch(arr)
        if label:
            tx = (x1 + x2)/2 if lx is None else lx
            ty = (y1 + y2)/2 + 1.4 if ly is None else ly
            ax.text(tx, ty, label, ha='center', va='center',
                    fontsize=5.8, fontweight='bold', color=col,
                    bbox=dict(boxstyle='round,pad=0.16', fc='white', ec='none', alpha=0.92))

    # ---------------- PANEL (a) ----------------
    ax.text(50, 67.2, "(a) Real-Time Signal Conditioning & 16.25 KB Lossless Ring Buffer Backpressure",
            ha='center', va='center', fontsize=8.5, fontweight='bold', color='#0F172A')

    # Top row processing pipeline
    box(1.5, 53.0, 14.5, 10.5, "LPADC0 (PTA16)", "3.5mm AUX Mic\n16 kHz, 16-bit PCM", fc="#EFF6FF", ec="#1D4ED8")
    box(19.0, 53.0, 16.5, 10.5, "IIR DC Tracker", "B[n] += (x - B)>>7\nx~[n] = x - B[n]", fc="#F8FAFC", ec="#334155")
    box(38.5, 53.0, 17.5, 10.5, "VAD & Packetizer", "|x~| > 1400 (C>=2)\n60 samp -> 121B [0x02]", fc="#F0FDF4", ec="#15803D")

    arrow(16.0, 58.2, 19.0, 58.2)
    arrow(35.5, 58.2, 38.5, 58.2)

    # Ring Buffer Container (Cleanly above y=42.5)
    ring_bg = FancyBboxPatch((59.5, 42.5), 22.0, 22.0, boxstyle="round,pad=0.3,rounding_size=1.0",
                             facecolor="#FFFBEB", edgecolor="#B45309", linewidth=1.2)
    ax.add_patch(ring_bg)
    ax.text(70.5, 62.7, "s_audio_ring_buf[128]", ha='center', va='center', fontsize=7.1, fontweight='bold', color='#92400E')
    ax.text(70.5, 60.2, "128 slots x 130B = 16,640 B\n(480 ms Lossless SRAM)", ha='center', va='center', fontsize=5.6, color='#78350F')

    # Circular FIFO graphic centered cleanly inside
    cx, cy, r_out, r_in = 70.5, 51.0, 5.7, 3.0
    for k in range(12):
        th1, th2 = k*30, (k+1)*30
        fill_c = "#F59E0B" if k in [1, 2, 3, 4] else "#FEF3C7"
        w = Wedge((cx, cy), r_out, th1, th2, width=r_out-r_in, facecolor=fill_c, edgecolor='#92400E', linewidth=0.55)
        ax.add_patch(w)
    ax.text(cx, cy, "FIFO\n128\nSlots", ha='center', va='center', fontsize=5.1, fontweight='bold', color='#78350F')

    ax.annotate("head\n(Write)", xy=(cx + 4.3, cy + 3.8), xytext=(78.6, 55.6),
                fontsize=5.2, fontweight='bold', color='#B45309', ha='center',
                arrowprops=dict(arrowstyle='->', color='#B45309', lw=0.8))
    ax.annotate("tail\n(Read)", xy=(cx - 4.3, cy - 3.3), xytext=(62.3, 45.1),
                fontsize=5.2, fontweight='bold', color='#1D4ED8', ha='center',
                arrowprops=dict(arrowstyle='->', color='#1D4ED8', lw=0.8))

    arrow(56.0, 58.2, 59.5, 58.2, label="Queue()", lx=57.7, ly=60.3)

    # Right column: BLE 5.3 Dispatch & Backpressure Check
    box(84.5, 52.8, 14.0, 10.7, "BLE 5.3 Dispatch", "ProcessTxQueue()\nSendInstantNotif()", fc="#EFF6FF", ec="#1D4ED8", title_sz=7.0, body_sz=5.7)
    arrow(81.5, 58.1, 84.5, 58.1)

    box(84.5, 36.8, 14.0, 10.0, "Backpressure Check", "gBleOverflow_c /\nOutOfMemory?", fc="#FEF2F2", ec="#B91C1C", title_sz=6.7, body_sz=5.6)
    arrow(91.5, 52.8, 91.5, 46.8)

    # Middle corridor (completely clear of ring buffer bottom y=42.5!):
    # Hold Tail box sits cleanly at x=33.0..56.5, y=36.8..44.8
    box(33.0, 36.8, 23.5, 8.2, "Hold s_ring_tail & Block Sleep",
        "VoxAssist_IsBusy() keeps CPU awake\nRetry next loop tick (0% Drop)", fc="#FFF1F2", ec="#BE123C", title_sz=6.2, body_sz=5.4)

    # Red backpressure arrow: Backpressure Check (left edge) -> Hold Tail (right edge) -> Ring Buffer bottom-left
    arrow(84.5, 40.2, 56.5, 40.2, label="gBleOverflow_c / Backpressure", lx=70.5, ly=38.3, col="#BE123C", ls='--')
    arrow(56.5, 43.2, 59.5, 45.5, col="#BE123C", ls='--')

    # Lower clear highway: Android Companion App (bottom left of panel a)
    box(1.5, 32.0, 27.5, 9.5, "Android Companion App (BLE Central)",
        "MTU 512 RX | Multi-Wake NLP & WhatsApp A11y", fc="#EEF2FF", ec="#4338CA", title_sz=6.8, body_sz=5.7)

    # Clean orthogonal-style curve from Backpressure Check bottom straight below Hold box into Android App!
    arr_ok = FancyArrowPatch((91.5, 36.8), (29.0, 34.5),
                             connectionstyle="arc3,rad=-0.06",
                             arrowstyle="-|>,head_length=4.5,head_width=2.6",
                             color="#15803D", linewidth=1.15)
    ax.add_patch(arr_ok)
    ax.text(60.5, 32.5, "gBleSuccess_c: Advance s_ring_tail, s_ring_count-- -> Wireless UART TX",
            ha='center', va='center', fontsize=5.8, fontweight='bold', color='#15803D',
            bbox=dict(boxstyle='round,pad=0.16', fc='white', ec='none', alpha=0.92))

    # Divider
    ax.plot([1.5, 98.5], [29.2, 29.2], color='#CBD5E1', linewidth=1.0, linestyle='--')

    # ---------------- PANEL (b) ----------------
    ax.text(50, 26.8, "(b) Hands-Free VAD & Three-Opcode BLE Protocol Timing State Machine",
            ha='center', va='center', fontsize=8.5, fontweight='bold', color='#0F172A')

    box(2.5, 9.2, 19.0, 11.2, "1. IDLE (__WFI)", "Low-power monitor\nPoll AUX ADC / PTB0\nAmp <= 1400 LSB", fc="#F1F5F9", ec="#475569")
    box(29.5, 9.2, 20.0, 11.2, "2. VOICE START", "Tx OPCODE_START\n[0x01] (1 Byte)\nPlay Chime 2 (Earphone)", fc="#DCFCE7", ec="#15803D")
    box(57.5, 9.2, 20.5, 11.2, "3. STREAM AUDIO", "Tx OPCODE_DATA\n[0x02 + 120B PCM]\n3.75 ms chunk cadence", fc="#DBEAFE", ec="#1D4ED8")
    box(84.5, 9.2, 13.8, 11.2, "4. SILENCE END", "Tx OPCODE_END\n[0x03] (1 Byte)\nPlay Chime 3", fc="#FEE2E2", ec="#B91C1C")

    arrow(21.5, 14.8, 29.5, 14.8, label="C >= 2 or\nPTB0=0", lx=25.5, ly=18.2, col="#15803D")
    arrow(49.5, 14.8, 57.5, 14.8, label="Chunk Loop\n(16 kHz)", lx=53.5, ly=18.2, col="#1D4ED8")
    arrow(78.0, 14.8, 84.5, 14.8, label="Silence >=320\n(>35 chunks)", lx=81.2, ly=18.5, col="#B91C1C")

    # Clean self-loop ABOVE box 3 (no intersection with return arrow at bottom!)
    self_loop = FancyArrowPatch((71.5, 20.4), (63.5, 20.4),
                                connectionstyle="arc3,rad=0.55",
                                arrowstyle="-|>,head_length=4.0,head_width=2.3",
                                color="#1D4ED8", linewidth=1.0)
    ax.add_patch(self_loop)
    ax.text(67.5, 24.3, "Speech Active (|x~| > 1400): Reset silence_chunks = 0",
            ha='center', va='center', fontsize=5.7, fontweight='bold', color='#1D4ED8',
            bbox=dict(boxstyle='round,pad=0.14', fc='white', ec='none', alpha=0.9))

    # Clean return curve below boxes 1..4
    arrow(91.4, 9.2, 12.0, 9.2, label="Return to WFI Sleep (~1.2 s trailing silence completed)", lx=51.7, ly=2.8, col="#475569", rad=-0.12)

    plt.tight_layout(pad=0.25)
    out_path = os.path.join(OUT_DIR, "fig4_ringbuffer_fsm_vad.png")
    plt.savefig(out_path, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f"Saved clean Fig. 4 -> {out_path} ({os.path.getsize(out_path)} bytes)")


# ==============================================================================
# FIGURE 6: Exact Table IV 5-Fold Confusion Matrix + 50-Epoch Convergence Plots
# ==============================================================================
def generate_fig6():
    print("Generating Fig. 6 (Exact Table IV 5-Fold CV Confusion Matrix + 50-Epoch Convergence)...")
    base_dir = r"c:\Users\ashis\.gemini\antigravity-ide\scratch\Iotproject\kws\dataset"
    CLASSES = ["noise", "parity", "hello_parity", "hey_parity"]

    X, y = [], []
    for idx, c in enumerate(CLASSES):
        folder = os.path.join(base_dir, c)
        for fn in sorted(os.listdir(folder)):
            if fn.endswith(".wav"):
                sr, d = wavfile.read(os.path.join(folder, fn))
                if len(d.shape) > 1:
                    d = d[:, 0]
                if len(d) < 16000:
                    d = np.pad(d, (0, 16000 - len(d)))
                else:
                    d = d[:16000]
                norm = d.astype(np.float32) / 32768.0
                stft = tf.signal.stft(norm, frame_length=512, frame_step=256)
                spec = tf.image.resize(tf.abs(stft)[..., tf.newaxis], [32, 16]).numpy()
                X.append(spec)
                y.append(idx)

    X = np.array(X)
    y = np.array(y)

    # Exact RNG & fit invocation without changing fit batch ordering
    np.random.seed(42)
    tf.random.set_seed(42)
    folds = [[] for _ in range(5)]
    for c in range(4):
        idxs = np.where(y == c)[0]
        np.random.shuffle(idxs)
        for k, ix in enumerate(idxs):
            folds[k % 5].append(ix)

    all_true, all_pred = [], []
    fold_accs = []
    tr_acc_hist, val_acc_hist = [], []
    tr_loss_hist, val_loss_hist = [], []

    for k in range(5):
        val_idx = np.array(folds[k])
        tr_idx = np.array([i for i in range(len(y)) if i not in val_idx])
        model = tf.keras.Sequential([
            tf.keras.layers.Input(shape=(32, 16, 1)),
            tf.keras.layers.Conv2D(8, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.MaxPooling2D((2, 2)),
            tf.keras.layers.Conv2D(16, (3, 3), activation='relu', padding='same'),
            tf.keras.layers.GlobalAveragePooling2D(),
            tf.keras.layers.Dense(16, activation='relu'),
            tf.keras.layers.Dense(4, activation='softmax')
        ])
        model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=0.005),
                      loss='categorical_crossentropy', metrics=['accuracy'])
        y_tr = tf.keras.utils.to_categorical(y[tr_idx], 4)
        y_val = tf.keras.utils.to_categorical(y[val_idx], 4)

        val_accs_ep, val_loss_ep = [], []
        class ValTracker(tf.keras.callbacks.Callback):
            def on_epoch_end(self, epoch, logs=None):
                vl, va = self.model.evaluate(X[val_idx], y_val, verbose=0)
                val_loss_ep.append(vl)
                val_accs_ep.append(va * 100.0)

        h = model.fit(X[tr_idx], y_tr, epochs=50, batch_size=8, verbose=0, callbacks=[ValTracker()])
        tr_acc_hist.append(np.array(h.history['accuracy']) * 100.0)
        tr_loss_hist.append(np.array(h.history['loss']))
        val_acc_hist.append(np.array(val_accs_ep))
        val_loss_hist.append(np.array(val_loss_ep))

        pr = np.argmax(model.predict(X[val_idx], verbose=0), axis=1)
        fold_accs.append(np.mean(pr == y[val_idx]) * 100.0)
        all_true.extend(y[val_idx])
        all_pred.extend(pr)

    cm = tf.math.confusion_matrix(all_true, all_pred, num_classes=4).numpy()
    print(f"5-Fold CV Mean Acc: {np.mean(fold_accs):.2f}% +/- {np.std(fold_accs):.2f}%")
    print("Confusion Matrix:\n", cm)

    epochs = np.arange(1, 51)
    tr_acc_m, tr_acc_s = np.mean(tr_acc_hist, axis=0), np.std(tr_acc_hist, axis=0)
    va_acc_m, va_acc_s = np.mean(val_acc_hist, axis=0), np.std(val_acc_hist, axis=0)
    tr_los_m = np.mean(tr_loss_hist, axis=0)
    va_los_m = np.mean(val_loss_hist, axis=0)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.6, 3.3), dpi=300, gridspec_kw={'width_ratios': [1.02, 1.18]})

    row_sums = cm.sum(axis=1, keepdims=True)
    cm_pct = (cm / row_sums) * 100.0
    ax1.imshow(cm_pct, interpolation='nearest', cmap='Blues', vmin=0, vmax=100)

    ax1.set_xticks(np.arange(4))
    ax1.set_yticks(np.arange(4))
    ax1.set_xticklabels(CLASSES, fontsize=7.2, rotation=22, ha='right')
    ax1.set_yticklabels(CLASSES, fontsize=7.2)
    ax1.set_xlabel("Predicted Wake Class", fontsize=8.0, fontweight='bold', labelpad=4)
    ax1.set_ylabel("True Audio Class", fontsize=8.0, fontweight='bold', labelpad=4)
    ax1.set_title("(a) Pooled 5-Fold Confusion Matrix\n(0% Noise False Alarms, n = 73)", fontsize=8.2, fontweight='bold', pad=7)

    for i in range(4):
        for j in range(4):
            val = cm[i, j]
            pct = cm_pct[i, j]
            txt_color = "white" if pct > 55 else "#0F172A"
            ax1.text(j, i, f"{val}\n({pct:.1f}%)", ha="center", va="center",
                     color=txt_color, fontsize=6.6, fontweight='bold' if i == j else 'normal')

    ax1.set_xticks(np.arange(-0.5, 4, 1), minor=True)
    ax1.set_yticks(np.arange(-0.5, 4, 1), minor=True)
    ax1.grid(which="minor", color="#CBD5E1", linestyle='-', linewidth=0.7)
    ax1.tick_params(which="minor", bottom=False, left=False)

    l1, = ax2.plot(epochs, tr_acc_m, color='#1D4ED8', lw=1.6, label='Train Acc (%)')
    ax2.fill_between(epochs, np.clip(tr_acc_m - tr_acc_s, 0, 100), np.clip(tr_acc_m + tr_acc_s, 0, 100),
                     color='#1D4ED8', alpha=0.12)
    l2, = ax2.plot(epochs, va_acc_m, color='#047857', lw=1.6, linestyle='--', label='Val CV Acc (%)')
    ax2.fill_between(epochs, np.clip(va_acc_m - va_acc_s, 0, 100), np.clip(va_acc_m + va_acc_s, 0, 100),
                     color='#047857', alpha=0.12)

    ax2.set_xlabel("Training Epoch (Adam lr = 0.005, batch = 8)", fontsize=8.0, fontweight='bold', labelpad=4)
    ax2.set_ylabel("Classification Accuracy (%)", fontsize=8.0, fontweight='bold', color='#0F172A')
    ax2.set_ylim(15, 106)
    ax2.set_xlim(1, 50)
    ax2.tick_params(axis='both', labelsize=7.2)
    ax2.grid(True, linestyle=':', linewidth=0.6, color='#CBD5E1')

    ax2_loss = ax2.twinx()
    l3, = ax2_loss.plot(epochs, tr_los_m, color='#DC2626', lw=1.3, linestyle='-.', label='Train Loss')
    l4, = ax2_loss.plot(epochs, va_los_m, color='#D97706', lw=1.3, linestyle=':', label='Val Loss')
    ax2_loss.set_ylabel("Cross-Entropy Loss", fontsize=8.0, fontweight='bold', color='#991B1B')
    ax2_loss.set_ylim(0, 1.55)
    ax2_loss.tick_params(axis='y', labelsize=7.2, colors='#991B1B')

    ax2.set_title("(b) 50-Epoch Convergence (Mean ± 1 SD across 5 Folds)", fontsize=8.2, fontweight='bold', pad=7)
    lines = [l1, l2, l3, l4]
    labels = [l.get_label() for l in lines]
    ax2.legend(lines, labels, loc='center right', fontsize=6.4, frameon=True, facecolor='white', edgecolor='#CBD5E1')

    plt.tight_layout(pad=0.8)
    out_path = os.path.join(OUT_DIR, "fig6_kws_confusion_convergence.png")
    plt.savefig(out_path, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f"Saved Fig. 6 -> {out_path} ({os.path.getsize(out_path)} bytes)")


if __name__ == "__main__":
    generate_fig4()
    generate_fig6()
