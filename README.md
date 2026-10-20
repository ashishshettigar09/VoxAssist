# VoxAssist - Voice-to-WhatsApp Assistive System for Blind Users

An end-to-end assistive IoT system designed for blind and visually impaired users. It captures voice commands through an **INMP441 digital MEMS microphone** connected to an **NXP FRDM-RW612** microcontroller, streams the command over **Bluetooth Low Energy (BLE)** to a companion smartphone app, automatically identifies the contact from the address book, opens the pre-filled chat via **WhatsApp** (100% Free, zero carrier SMS costs), and gives **spoken audio feedback (Text-to-Speech)**.

---

## 🎙️ Command Syntax
The user speaks the natural voice command:
> **"Send message to [Contact Name] - [Message Body]"**

* **Example 1:** *"Send message to Mom - I am outside the clinic, please pick me up"*
* **Example 2:** *"Send message to Dad - Can you call me back when you are free"*
* **Example 3:** *"Send message to Doctor - Can we confirm my appointment for tomorrow"*

---

## ⚡ Hands-Free WhatsApp Auto-Send (Zero Clicks Required)

For blind and visually impaired users, touching the screen to tap "Send" in WhatsApp is inconvenient. VoxAssist solves this using an **Android Accessibility Service**:
1. When you say: *"Send message to [Name] - [Message]"*, VoxAssist opens the chat and automatically clicks the **"Send"** button for you!
2. It then automatically returns back to VoxAssist.
3. **One-Time Setup:** On your phone, go to **Settings > Accessibility > Installed Apps > Turn VoxAssist ON**.

---

## 🔍 Instant Contact Search

A real-time search bar is built into the Contacts panel:
* Search by **Name** (e.g. "Mom", "Rahul", "Doctor")
* Search by **Phone Number** (e.g. "9876", "+91")
* Search by **Relationship/Category** (e.g. "Family", "Medical")

---

## 📂 Repository Structure

```
Iotproject/
├── index.html              # Interactive Web Companion App & IoT Simulator
├── style.css               # Modern High-Contrast Accessibility Theme
├── app.js                  # Speech recognition, Web Audio chimes, NLP parser & BLE sim
├── android/
│   ├── MainActivity.kt     # Production Android App (BLE, Contacts, SMS, TTS)
│   └── AndroidManifest.xml # Android permissions configuration
├── firmware/
│   └── main.c              # NXP FRDM-RW612 MCUXpresso C Firmware (I2S DMA + BLE)
└── README.md               # Complete System Documentation
```

---

## 📱 How to Get the App on Your Mobile Phone (4 Methods)

### Method 1: Instant Install as a Mobile App (PWA - No Setup Needed)
1. Open [`index.html`](file:///c:/Users/ashis/.gemini/antigravity-ide/scratch/Iotproject/index.html) in Chrome or Edge on your phone (or host on GitHub Pages / Vercel).
2. Tap the **"📱 Install on Phone"** button in the header (or tap browser menu `⋮` > **"Add to Home screen"** / **"Install app"**).
3. The app installs directly onto your phone's home screen with the **VoxAssist 3D launcher icon**, full offline support, and runs fullscreen as a standalone app!

---

### Method 2: Convert to a Signed `.apk` in 1 Minute (PWABuilder)
1. Host your project on GitHub Pages or any free static host (e.g. Netlify/Vercel).
2. Go to **[PWABuilder.com](https://www.pwabuilder.com/)** (Microsoft's official PWA-to-APK packaging tool).
3. Enter your URL and click **"Package for Android"**.
4. Download the compiled `.apk` file and transfer it to any Android device.

---

### Method 3: Cloud APK Auto-Build (Free via GitHub Actions)
If you do not have Android Studio installed on your computer, a pre-configured GitHub Actions workflow is included at [`.github/workflows/build-apk.yml`](file:///c:/Users/ashis/.gemini/antigravity-ide/scratch/Iotproject/.github/workflows/build-apk.yml):
1. Push this project to a GitHub repository.
2. Go to the **Actions** tab on GitHub.
3. The build will run automatically and provide a downloadable **`VoxAssist-Debug-APK.zip`** containing the installable `.apk` file!

---

### Method 4: Build Native APK in Android Studio
The complete standard Android Studio project is organized in the [`android/`](file:///c:/Users/ashis/.gemini/antigravity-ide/scratch/Iotproject/android) folder:
1. Open **Android Studio**.
2. Select **Open** and choose the [`android`](file:///c:/Users/ashis/.gemini/antigravity-ide/scratch/Iotproject/android) directory.
3. Wait for Gradle sync to complete.
4. Click **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. Your compiled APK will be created at:
   `android/app/build/outputs/apk/debug/app-debug.apk`

---

## ⚡ How to Run the Interactive Application (Now)

You can launch and test the interactive application immediately in your web browser:

1. Double-click or open **[`index.html`](file:///c:/Users/ashis/.gemini/antigravity-ide/scratch/Iotproject/index.html)** in **Google Chrome**, **Microsoft Edge**, or any modern browser.
2. **Push to Talk:**
   - Click and hold the large glowing **HOLD TO SPEAK** button (or press and hold the <kbd>SPACE</kbd> bar).
   - Say: *"Send message to Mom - I am on my way"*
   - Release the button.
3. **Listen for Spoken Feedback:**
   - The browser's speech synthesis will speak aloud: *"Sending message to Mom: 'I am on my way'. Message sent successfully."*
4. **Preset Testing:**
   - You can also click any of the 4 quick preset buttons to test immediately without needing microphone access.
5. **Manage Contacts:**
   - Click **+ Add Contact** to add custom family members, doctors, or friends with their real phone numbers.

---

## 🔌 Hardware Wiring Guide (INMP441 to FRDM-RW612)

The INMP441 MEMS microphone communicates with the NXP FRDM-RW612 via the **Flexcomm I²S controller**:

| INMP441 Pin | Description | FRDM-RW612 Arduino Header Pin |
| :--- | :--- | :--- |
| **VDD** | 3.3V Power | **3.3V** |
| **GND** | Ground | **GND** |
| **SD** | Serial Audio Data Output | **Flexcomm I²S RX Data (e.g. GPIO40 / FC3_DATA_IN)** |
| **SCK** (BCLK) | Bit Clock | **Flexcomm I²S Bit Clock (e.g. GPIO39 / FC3_SCK)** |
| **WS** (LRCLK) | Word Select / Frame Sync | **Flexcomm I²S Frame Sync (e.g. GPIO38 / FC3_WS)** |
| **L/R** | Channel Select | Connect to **GND** for Left channel mono |
| **PTT Button** | Tactile Push-to-Talk | Connect between **GPIO0_12** and **GND** (internal pull-up enabled) |

---

## 📱 Android Companion App Architecture

Located in [`android/MainActivity.kt`](file:///c:/Users/ashis/.gemini/antigravity-ide/scratch/Iotproject/android/MainActivity.kt):

1. **Bluetooth GATT Client:** Connects to the board's advertising name `FRDM-RW612-VOX`.
2. **Audio/Trigger Listener:** Awakens when the tactile PTT button on the board is pressed.
3. **Speech-to-Text (`SpeechRecognizer`):** Transcribes the speech into text.
4. **NLP Pattern Matcher:** Parses `(?i)send message to\s+(.*?)\s*[-:]\s*(.*)`.
5. **Contact Resolution (`ContactsContract`):** Queries native Android address book to resolve the exact phone number.
6. **Carrier SMS (`SmsManager`):** Sends the SMS silently in the background using the user's mobile carrier.
7. **Audio Accessibility (`TextToSpeech`):** Speaks confirmations and error handling aloud at every step so the user never needs to touch the screen.
