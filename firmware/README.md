# VoxAssist Microcontroller Firmware (NXP FRDM-MCXW71)

Target MCU: **NXP FRDM-MCXW71** (ARM Cortex-M33 @ 96 MHz, BLE 5.3, 1 MB Flash, 128 KB SRAM)  
Build Framework: **MCUXpresso SDK with NXP Wireless BLE Host Stack & TinyML**

---

## File Directory & Component Guide

| File | Purpose | Description |
| :--- | :--- | :--- |
| **`main.c`** | **Main Application Loop & Peripherals** | Initializes hardware clocks, power management, PAM8403 speaker PWM, 3.5mm AUX jack detect (PTA21), and self-calibrating LPADC (PTA16). Executes Voice Activity Detection (VAD), silence detection, and boot self-test. |
| **`wireless_uart.c`** | **BLE Stack & Lossless Buffer** | Implements the Bluetooth Low Energy (BLE 5.3) GATT/GAP profiles, connection state machine, incoming command dispatcher (`0x10`, `0x20`, RGB LED commands), and the **16 KB Circular FIFO Ring Buffer** that prevents audio packet loss. |
| **`wireless_uart.h`** | **Public BLE & Audio API** | Exports prototypes: `BleApp_QueuePacket()`, `BleApp_ProcessTxQueue()`, `BleApp_IsTxQueueEmpty()`, `BleApp_NotifyPacket()`, `BleApp_IsConnected()`, and `Speaker_PlayChime()`. |
| **`parity_kws_model.h`** | **On-Board TinyML Inference Engine** | Standalone C neural network (Spectrogram + Conv2D + MaxPool + Dense + Softmax) trained to recognize the keywords: `"parity"`, `"hello parity"`, and `"hey parity"`. Requires zero third-party dependencies. |
| **`test_audio_vector.h`** | **In-Memory Audio Test Sample** | 16,000 real 16-bit PCM audio samples (1 second at 16 kHz) of the spoken word *"parity"*. Used for on-board verification when the microphone hardware is not connected. |
| **`app_config.c`** | **Board & Memory Configuration** | Allocates SDK timer manager buffers, serial manager memory pools, and low-power power management settings. |
| **`gatt_db.h`** | **GATT Database Handles** | Defines Bluetooth GATT attribute handles, service UUIDs, and Wireless UART stream characteristic handles. |

---

## Hardware Pinout Reference

- **3.5mm AUX Microphone Audio In:** `PTA16` (ADC0 Channel 0 / Arduino Header A0)
- **3.5mm AUX Jack Insertion Detect:** `PTA21` (GPIO Input with pull-up / Arduino Header D2)
- **Speaker Audio PWM Out:** `PTB1` (CTIMER0 PWM / Arduino Header D3) &rarr; PAM8403 Amp
- **Speaker Amplifier Shutdown/Mute:** `PTB2` (GPIO Output / Arduino Header D5)
- **MCU-Link Debugger USB Port:** `J1` (USB-C)

---

## How to Build & Flash

### 1. Build via Ninja / MCUXpresso
```powershell
cd Debug
ninja
```
Output executable: `Debug/frdmmcxw7x_wireless_uart_bm.axf`

### 2. Flash via NXP LinkServer
```powershell
LinkServer.exe flash MCXW716CxxxA:FRDM-MCXW71 load Debug/frdmmcxw7x_wireless_uart_bm.axf
```
