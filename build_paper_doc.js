/**
 * Main Content Compiler for VisioTinyML IEEE Conference Manuscript
 * Strictly follows IEEE_Conference_Template__6_/conference_101719.pdf two-column layout,
 * builds on the scholarly structure and prose depth of the original paper while upgrading
 * all content to reflect the current VisioTinyML architecture, verified MCU ELF metrics,
 * real KWS 5-fold cross-validation & TFLite data, official NXP MCXW71 datasheet figures,
 * and 30 strictly verified Google Scholar / IEEE / ACM / MDPI citations.
 *
 * Output: Single file -> VoxAssist_IEEE_Research_Paper.docx
 */

const {
  createTitle,
  createAuthorBlock,
  createAbstractInColumn,
  p,
  pRich,
  secHeading,
  subHeading,
  subSubHeading,
  eq,
  figPlaceholder,
  tableElement,
  refItem,
  Document,
  Packer,
  SectionType
} = require('./generate_ieee_paper.js');
const fs = require('fs');

console.log("Compiling enhanced VisioTinyML IEEE Conference manuscript...");

const titleText = "VisioTinyML: An Ultra-Low-Power TinyML Acoustic Gateway with Wired Earphone Interfacing for Visually Impaired Mobile Messaging";

const authorsList = [
  {
    name: "Ashish Shettigar",
    dept: "Dept. of Electronics & Comm. Eng.",
    org: "IoT & Embedded Systems Lab",
    city: "Bengaluru, India",
    email: "ashishshettigar09@github"
  },
  {
    name: "Co-Author / Collaborator",
    dept: "Dept. of Computer Science & Eng.",
    org: "Human-Computer Interaction Group",
    city: "Bengaluru, India",
    email: "orcid.org/0000-0000-0000-0000"
  },
  {
    name: "Faculty Mentor / PI",
    dept: "School of Electrical Engineering",
    org: "Center for Assistive Computing",
    city: "Bengaluru, India",
    email: "mentor@institution.edu"
  }
];

// IEEE conference rule: No symbols, footnotes, or math in Paper Title or Abstract
const abstractText = "Seamless digital communication on modern smartphones depends almost exclusively upon flat capacitive glass touchscreens, creating an exclusionary barrier for millions of blind and visually impaired users who lack tactile spatial landmarks. While screen readers and commercial smart speakers such as Amazon Alexa provide conversational interfaces, their deployment in personal wearable messaging is constrained by costly far-field MEMS beamforming hardware, continuous standby power exceeding 1.5 W that exhausts portable batteries, public loudspeaker privacy leakage, cloud connectivity dependency, and closed proprietary application ecosystems. This paper presents VisioTinyML, an ultra-low-cost cyber-physical acoustic gateway integrating an NXP FRDM-MCXW71 dual-core wireless microcontroller with ubiquitous 3.5 mm CTIA wired earphones featuring an inline microphone and tactile push-to-talk trigger. Rather than costly digital microphone arrays, VisioTinyML couples a self-calibrated 16-bit ADC front-end with a fixed-point exponential moving-average baseline drift filter, hands-free voice activity detection, and a 16.25 KB lossless circular FIFO ring buffer over Bluetooth Low Energy 5.3 with MTU 512 negotiation. For edge intelligence, a compact two-dimensional Convolutional Neural Network trained on a 73-clip synthetic acoustic corpus detects multi-wake phrases (parity, hello parity, hey parity) using only 1,588 trainable parameters (6.35 KB weights in Flash), achieving 94.83 percent mean accuracy in stratified five-fold cross-validation and 100.0 percent wake-versus-noise discrimination, alongside an exported 6,672-byte TensorFlow Lite model scoring 94.52 percent accuracy. The companion Android service bridges BLE packets to a dual-metric Damerau-Levenshtein and phonetic contact matcher, automating zero-touch WhatsApp message dispatch via AccessibilityService DOM traversal and private in-ear reply readout via NotificationListenerService.";

const indexTerms = "TinyML, visual impairment, assistive technology, keyword spotting, NXP FRDM-MCXW71, Bluetooth Low Energy 5.3, wired earphone interface, lossless ring buffer, Android Accessibility Service, speech-to-WhatsApp automation.";

const colChildren = [];

// Abstract and Index Terms appear at the start of the first column (per conference_101719.pdf)
createAbstractInColumn(abstractText, indexTerms).forEach(el => colChildren.push(el));

// =========================================================================
// I. INTRODUCTION
// =========================================================================
colChildren.push(secHeading("I", "Introduction"));

colChildren.push(p(
  "Global epidemiological assessments by the World Health Organization (WHO) and the Vision Loss Expert Group report that at least 2.2 billion people worldwide experience near or distance vision impairment, among whom over 1 billion cases remain unaddressed and approximately 43 million individuals live with blindness [1], [2]. In contemporary society, over-the-top (OTT) mobile messaging services—predominantly WhatsApp across billions of active users—constitute essential infrastructure for emergency coordination, occupational productivity, education, and autonomous daily living [3]. However, mainstream smartphones have consolidated exclusively around smooth, capacitive glass displays devoid of physical tactile landmarks. Interacting with multi-screen graphical instant messaging interfaces without sight remains an acute usability barrier [4], [5]."
));

colChildren.push(p(
  "Modern mobile operating systems ship assistive screen readers such as Android TalkBack and Apple VoiceOver. Nonetheless, longitudinal field evaluations by Kane et al. [4] and Rodrigues et al. [6] reveal steep cognitive friction when blind users rely on linear gesture-based exploration to manage messaging tasks. Dictating and sending a single message entails sweeping sequentially across user interface elements, focusing text entry boxes, invoking on-screen keyboards, and auditing speech-to-text transcription. Empirical studies by Azenkot and Lee [7] (surveying 169 participants alongside a controlled lab study with blind users) demonstrated that while speech input is nearly five times faster than virtual keyboard typing with VoiceOver, participants spent an average of 80.3% of total task time manually locating and correcting editing errors. Moreover, screen-reader broadcasts emitted from phone loudspeakers undermine conversational privacy in crowded transit and workplace environments [5]."
));

colChildren.push(subHeading("A", "Why Commercial Smart Speakers Fail as Mobile Assistive Aids"));
colChildren.push(p(
  "Conversational voice assistants—including Amazon Echo (Alexa) and Google Nest—offer hands-free interaction that disability studies show blind users appreciate for simple domestic queries [8], [9]. Yet analyzing commercial smart-speaker architectures against untethered assistive mobile messaging exposes four structural barriers:"
));

colChildren.push(subSubHeading(
  "1)",
  "Prohibitive Hardware Cost",
  "Far-field voice pickup depends on multi-microphone circular beamforming arrays (four to eight digital I2S MEMS sensors) paired with dedicated DSP chips costing $50 to $250+ USD per unit, whereas dedicated wearable vision systems retail far higher [10], [11]. Frugal assistive solutions under $20 USD are vital for broad adoption."
));

colChildren.push(subSubHeading(
  "2)",
  "Continuous Standby Power Penalty",
  "Always-on far-field acoustic listening continuously samples multi-channel microphone arrays and runs continuous beamforming DSP inference, consuming 1.5 W to 2.5 W or higher continuously [12]. This power profile dictates wall mains power and depletes portable wearable cells within hours."
));

colChildren.push(subSubHeading(
  "3)",
  "Public Privacy Exposure and Acoustic Masking",
  "Smart speakers project spoken notifications omnidirectionally into rooms [12]. Announcing incoming personal messages, family updates, or banking alerts via open speakers compromises user dignity and privacy, while street noise masks intelligibility outdoors."
));

colChildren.push(subSubHeading(
  "4)",
  "Cloud Lock-In and Closed Messaging Ecosystems",
  "Proprietary smart assistants depend on uninterrupted cloud connectivity and remain sandboxed from autonomously populating or clicking third-party end-to-end encrypted apps such as WhatsApp without paid enterprise cloud APIs [13]."
));

colChildren.push(subHeading("B", "The VisioTinyML Wired-Earphone Paradigm"));
colChildren.push(p(
  "To capture the hands-free responsiveness of an Alexa-like conversational assistant while keeping total component cost under $20 USD, VisioTinyML adopts a pragmatic cyber-physical architecture: replacing expensive far-field digital microphone arrays with a universal 3.5 mm CTIA female AUX jack interfacing ubiquitous $1.80 wired earphones. This deliberate engineering pivot delivers four decisive operational advantages:"
));

colChildren.push(p(
  "First, placing the inline electret condenser microphone 2–3 cm from the speaker's mouth achieves high near-field signal-to-noise ratio (SNR) and passive rejection of room reverberation without beamforming DSP arrays. Second, private in-ear transducers play synthesized chimes and incoming message alerts strictly inside the user's ear canal. Third, pairing ultra-low-power ARM Cortex-M33 sleep management (WFI idle gating), dynamic Voice Activity Detection (VAD), and an inline Push-to-Talk (PTT) switch suppresses false wakeups and saves power. Fourth, because dedicated high-sensitivity digital MEMS microphone modules add significant prototype procurement cost, our architecture permits immediate real-world testing using everyday wired headsets while validating the embedded TinyML wake classifier via an in-memory PCM self-test vector (g_test_audio_sample) at microcontroller boot."
));

colChildren.push(p(
  "Specifically, the engineering contributions of this paper resolve four critical challenges in edge TinyML and wireless assistive IoT:"
));
colChildren.push(p(
  "• Resolving BLE ATT Payload Bottlenecks: Whereas legacy BLE 4.2 profiles limit Attribute Protocol payloads to 20 bytes [14], choking raw 16 kHz audio streaming, VisioTinyML negotiates BLE 5.3 MTU 512 transfers [15] backed by a 16.25 KB (128-packet) circular FIFO ring buffer cushioning gBleOverflow_c backpressure across 480 ms with zero speech loss.",
  false
));
colChildren.push(p(
  "• Ultra-Compact TinyML CNN Integration: Compared to external-DRAM Cortex-M7 KWS models requiring 119,936 weights (468.5 KB) [16], our Global-Average-Pooled 2D-CNN executes keyword spotting (parity, hello parity, hey parity) using only 1,588 trainable weights (6.35 KB in Flash) completely inside internal MCU memory.",
  false
));
colChildren.push(p(
  "• Drift-Immune Mixed-Signal Conditioning: A 10 µF / 10 kΩ AC-coupled analog divider with fixed-point exponential IIR baseline tracking (>> 7 bit-shift) eliminates DC drift from resistor tolerances automatically.",
  false
));
colChildren.push(p(
  "• Closed-Loop Bidirectional Mobile Automation: Unifies dual-metric Damerau-Levenshtein and phonetic contact matching with zero-touch Android AccessibilityService WhatsApp dispatch and NotificationListenerService in-ear reply readouts.",
  false
));

// =========================================================================
// II. RELATED WORK AND COMPARATIVE LITERATURE ANALYSIS
// =========================================================================
colChildren.push(secHeading("II", "Related Work and Comparative Literature Analysis"));

colChildren.push(subHeading("A", "Microcontroller Keyword Spotting (TinyML) Architectures"));
colChildren.push(p(
  "Deploying spoken keyword spotting (KWS) onto milliwatt microcontrollers has evolved rapidly from deep fully-connected networks [17] and depthwise-separable CNNs [18] toward memory-bounded TinyML deployments [19], [20]. In Jurnal Teknologi, Abbas and Ahmad (2023) [21] deployed an Edge Impulse KWS system onto an Arduino Nano 33 BLE Sense (ARM Cortex-M4F @ 64 MHz, 1 MB Flash, 256 KB SRAM, built-in PDM microphone). Extracting 650 Mel-Frequency Cepstral Coefficient (MFCC) features into three 1D convolutional layers (8, 16, and 32 filters, Dropout 0.25) trained on 7,425 clips from Google Speech Commands v1 ('On', 'Off', 'Noise', 'Unknown'), their EON-quantized INT8 network attained 84.51% dataset accuracy and 26 ms inference latency, occupying 6.5 KB RAM and 37.6 KB Flash (vs. 84.24%, 25 ms, 9.6 KB RAM, 45.3 KB Flash in Float32). Across six live speakers, accuracy averaged 92.67% ('On') and 91.33% ('Off'). However, their node operated strictly standalone via RGB LEDs, lacking BLE mobile integration or private earphone feedback."
));

colChildren.push(p(
  "Wang and Li (2022) [16] evaluated acoustic CNN pruning and quantization on an Apollo STM32F767IGT6 platform (ARM Cortex-M7 @ 216 MHz, WM8978 I2S codec @ 16 kHz, FreeRTOS, plus 32 MB external DRAM). Evaluating a modified cnn-one-fstride4 topology [22] on 40-band Log-Mel spectrograms across six speech classes, their baseline model consumed 119,936 parameters (468.5 KB weights) and 476,576 MACs at ~90% accuracy while dissipating 1.18–1.25 W board power (6 ms feature extraction + 30.8 ms Float32 inference). Quantizing Float32 weights to INT16 cut inference latency to 21.4 ms—and 15.6 ms using Cortex-M SIMD SMLAD intrinsics—confirming that structured channel pruning accelerates edge inference whereas unstructured pruning can stall pipelines. Nevertheless, relying on external SDRAM and an energy-intensive Cortex-M7 undermines wearable assistive portability."
));

colChildren.push(p(
  "Targeting severe resource constraints, Shili et al. (2025) [23] implemented real-time command recognition on 8-bit PIC microcontrollers (PIC18F45K22 / PIC18F4550) fed by an analog MEMS microphone @ 8 kHz with a 300–3400 Hz FIR bandpass filter. Avoiding FFT complexity, they fed 200 time-domain Zero-Crossing Rate (ZCR) and Short-Time Energy (STE) features into a fixed-point Q15 10-neuron MLP, classifying four motor commands ('ON', 'OFF', 'LEFT', 'RIGHT') at >90% accuracy (88–97% precision) under 50 ms latency (45 ms mean) and ~8 mA active draw. Yet as noted in [23], time-domain ZCR/STE descriptors suffer spectral ambiguity across similar words and noisy environments while lacking wake-word gating or smartphone BLE integration. VisioTinyML synthesizes the strengths of [16], [21], [23]: retaining lightweight STE gating for low-power wake triggering while executing a 1,588-parameter 2D-CNN on Cortex-M33 integrated seamlessly with Android automation."
));

colChildren.push(subHeading("B", "Smart Speakers, Wearable Aids, and Frugal Engineering"));
colChildren.push(p(
  "Pradhan et al. [8] and Abdolrahmani et al. [9], [24] documented how visually impaired adults utilize smart speakers effectively in quiet homes yet encounter major privacy, environmental noise, and third-party app barriers outdoors [12]. Camera-guided smart glasses and ultrasonic wearable travel aids surveyed by Tapu et al. [11] and Bai et al. [25] demonstrate high travel utility but introduce prohibitive BOM costs ($450–$2,000+) and multi-watt power dissipation. Adopting the user-centered frugal assistive philosophy advocated by Petrie et al. [26], VisioTinyML transfers heavyweight speech recognition and social messaging APIs onto the user's smartphone while preserving ultra-frugal analog headset hardware."
));

colChildren.push(subHeading("C", "Low-Power BLE Streaming and Accessibility UI Traversal"));
colChildren.push(p(
  "Classic BLE 4.2 performance analyses by Gomez et al. [14] highlighted tight throughput ceilings imposed by legacy 20-byte ATT payloads and connection interval scheduling, frequently forcing embedded audio nodes toward lossy ADPCM codecs. Modern Bluetooth 5.3 extensions [15] lift ATT payloads up to 512 bytes via Data Length Extension (DLE), permitting reliable raw PCM bursts. At the mobile tier, Google Android AccessibilityService node APIs [27] allow non-visual workflow automation without device rooting, though closing the loop with private NotificationListenerService readouts over wearable BLE links remains largely unexplored."
));

// TABLE I: Comparative Benchmark
tableElement(
  "I",
  "Comparative Benchmark Against Published Embedded KWS and Assistive Systems",
  ["System / Reference", "MCU & Transducer", "Features & Classifier", "Footprint / Latency / Power", "Mobile Link & Privacy"],
  [
    ["Abbas & Ahmad [21]\n(Jurnal Tek. 2023)", "Nano 33 BLE (M4F)\nOnboard PDM Mic", "MFCC (650) +\nINT8 3× 1D-CNN", "37.6 KB Flash; 6.5 KB RAM\n26 ms; 84.51% test acc.", "Standalone RGB LED\nNo BLE app or headset"],
    ["Wang & Li [16]\n(DCASE 2022)", "STM32F767 + DRAM\nWM8978 I2S @ 16kHz", "40-Mel Spectrogram\nCNN+4FC (119.9k params)", "468.5 KB weights; 476.6k MAC\n15.6–30.8 ms; 1.18 W total", "Standalone UART log\nNo wireless mobile link"],
    ["Shili et al. [23]\n(MDPI Autom. 2025)", "PIC18F45K22 / 4550\nAnalog MEMS @ 8kHz", "Time ZCR + STE (200)\nQ15 10-Neuron MLP", "Q15 array; ~45 ms\n~8 mA; >90% quiet acc.", "Local L293D motor\nNo BLE or wake trigger"],
    ["Amazon Echo / VAPA\n[8], [12]", "7-Mic Array + DSP\nCloud Backend", "Far-Field Beamforming\n+ Cloud Neural ASR", "1.5–2.5 W continuous draw\nMains tethered", "Closed API lock-in\nPublic speaker broadcast"],
    ["TalkBack Baseline [6]", "Capacitive Glass\nTouchscreen (Phone)", "Gesture Touch +\nScreen Reader TTS", "Smartphone baseline\n46.8 s mean msg time [6]", "Manual multi-swipe GUI\nOpen loudspeaker"],
    {
      cells: ["VisioTinyML (Ours)", "NXP MCXW71 (M33)\n$1.80 3.5mm Aux Mic", "STFT/RMS 32×16 +\n1,588-Param 2D-CNN", "6.35 KB C / 6.67 KB TFL\n94.83% CV / 94.52% TFL", "Zero-Touch WhatsApp A11y\nPrivate In-Ear Chimes"],
      _highlight: true
    }
  ],
  "External values are sourced directly from cited literature [6], [8], [12], [16], [21], [23]. VisioTinyML metrics are measured directly from compiled ELF symbols and model evaluation.",
  [20, 20, 20, 21, 19]
).forEach(el => colChildren.push(el));

// Figure 1 Placeholder
figPlaceholder(
  1,
  "End-to-End VisioTinyML Cyber-Physical Architecture and Bidirectional Interaction Flow.",
  "Block diagram detailing: (a) 3.5 mm TRRS wired headset microphone and speaker stage; (b) NXP FRDM-MCXW71 conditioning, VAD, 16.25 KB FIFO ring buffer, and on-chip TinyML KWS engine; (c) BLE 5.3 Wireless UART transport; and (d) Android companion services (MainActivity, Dual-Metric NLP matcher, WhatsAppAccessibilityService, and VoxNotificationListenerService).",
  2700
).forEach(el => colChildren.push(el));

// =========================================================================
// III. HARDWARE ARCHITECTURE AND ANALOG FRONT-END DESIGN
// =========================================================================
colChildren.push(secHeading("III", "Hardware Architecture and Analog Front-End Design"));

colChildren.push(subHeading("A", "Dual-Core Wireless MCU: NXP FRDM-MCXW71"));
colChildren.push(p(
  "The embedded cyber-physical gateway executes on the NXP FRDM-MCXW71 development board (MCXW716CxxxA) [28]. Architecturally, the SoC combines an ARM Cortex-M33 application processor clocked up to 96 MHz (with hardware FPU, DSP extensions, and TrustZone-M) alongside an isolated Cortex-M3 Narrowband Radio Unit (NBU) running the Bluetooth 5.3 Link Layer controller. As specified in the compiled project linker memory map (frdmmcxw7x_wireless_uart_bm_Debug_memory.ld), onboard memory partitions into 984 KB PROGRAM_FLASH (origin 0x00000000), 32 KB NVM_region (0x000F6000) for BLE bonding storage, 8 KB PROD_DATA, 111 KB user SRAM (0x20000400), a 1 KB RAM_VECTOR_TABLE, and 6 KB shared IPC SRAM (rpmsg_sh_mem at 0x489c8800). Under integrated DC-DC buck operation (VDD = 3.3 V), official NXP datasheet figures [28] report <55 µA/MHz typical active current (~5.3 mA @ 96 MHz), 4.60 mA TX current (0 dBm), 4.68 mA RX current, and <3.0 µA Power-Down sleep with 32 KB RAM and RTC retention (<1.5 µA Deep Power-Down)."
));

colChildren.push(subHeading("B", "Female 3.5 mm CTIA AUX Audio Conditioning & Pin Mapping"));
colChildren.push(p(
  "Standard mobile headsets follow the CTIA 4-pole TRRS pinout: Tip (Left/Mono Audio), Ring 1 (Right/Jack Detect), Ring 2 (Ground Reference), and Sleeve (Inline Microphone / PTT Switch). Electret microphone elements generate low-amplitude AC voltages (±10–100 mV) centered on ground, which would experience negative-cycle clipping if fed directly to a unipolar 0–3.3 V ADC. Pin PTA16 (LPADC0 Channel 0 / Arduino A0) therefore incorporates a C_1 = 10 µF series AC-coupling capacitor followed by a symmetric resistive divider (R_1 = R_2 = 10 kΩ) tied between VDD = 3.3 V and GND:"
));

colChildren.push(eq("V_bias = V_DD · [ R₂ / (R₁ + R₂) ] = 3.3 V · (10 kΩ / 20 kΩ) = 1.65 V", 1));

colChildren.push(p(
  "With Thévenin resistance R_eq = R_1 ∥ R_2 = 5 kΩ, the high-pass cutoff frequency f_c,HPF of the AC-coupling stage is:"
));

colChildren.push(eq("f_c,HPF = 1 / (2π · R_eq · C₁) = 1 / [ 2π · 5000 Ω · 10 µF ] ≈ 3.18 Hz", 2));

colChildren.push(p(
  "Sitting well below fundamental vocal pitch frequencies (85–255 Hz), this network maintains linear passband fidelity across human speech. Physical cable seating connects Ring 1 to PTA21 (Arduino D2) via internal pull-up (kPORT_PullUp, kPORT_HighPullResistor), pulling LOW upon insertion, while tactile inline PTT closure connects the Sleeve line to PTB0 (Arduino D4, Active LOW)."
));

colChildren.push(subHeading("C", "Fixed-Point Dynamic DC Baseline Drift Tracking"));
colChildren.push(p(
  "Resistor tolerances (±1–5%) and battery voltage variations shift the true DC midpoint away from nominal 16-bit half-scale (32768). Left uncompensated, static DC bias triggers erroneous amplitude crossings inside the VAD energy detector. Inside Aux_SampleAudio(), LPADC0 samples single-ended input (kLPADC_SampleChannelSingleEndSideA, enableInDozeMode = true) and continuously tracks DC baseline B[n] via integer arithmetic bit-shifts (>> 7):"
));

colChildren.push(eq("B[n] = B[n − 1] + ⌊ (x_ADC[n] − B[n − 1]) / 128 ⌋", 3));
colChildren.push(eq("x̃[n] = x_ADC[n] − B[n]", 4));

colChildren.push(p(
  "This single-pole integer IIR high-pass filter places a pole at α = 127/128 ≈ 0.9922 (~20 Hz tracking time constant at 16 kHz), eliminating hardware DC offset drift deterministically in integer registers without floating-point division."
));

// Figure 2 Placeholder
figPlaceholder(
  2,
  "Mixed-Signal 3.5 mm AUX Conditioning, Jack-Detect, and PAM8403 Earphone Circuit Schematic.",
  "Complete hardware schematic detailing 3.5 mm CTIA female jack wiring, 10 µF AC-coupling capacitor, dual 10 kΩ 1.65 V biasing network on PTA16, PTA21 jack-insertion detect, PTB0 PTT switch, and PTB1 RC-filtered output into the PAM8403 Class-D amplifier with active-low SHDN_N gating on PTB2.",
  2700
).forEach(el => colChildren.push(el));

colChildren.push(subHeading("D", "Acoustic Feedback Chimes and Anti-Pop Hardware Gating"));
colChildren.push(p(
  "Earphone notification chimes and status prompts are synthesized digitally on PTB1 (SPK_AUDIO_PIN, Arduino D3) via Speaker_Tone() synchronized against core clock frequency via SDK_DelayAtLeastUs(), then smoothed by a first-order RC reconstruction low-pass filter (R_f = 1 kΩ, C_f = 10 nF):"
));

colChildren.push(eq("f_c,LPF = 1 / (2π · R_f · C_f) = 1 / [ 2π · 1000 Ω · 10 nF ] ≈ 15.92 kHz", 5));

colChildren.push(p(
  "Filtered signals feed a Class-D PAM8403 power stage driving the earphone earpiece or miniature 8 Ω speaker, with shutdown pin SHDN_N controlled by PTB2 (Arduino D5). Holding PTB2 LOW when idle suppresses background amplifier hiss and eliminates power-on pop transients. Speaker_PlayChime() renders three intuitive acoustic earcons: Chime 1 (880 Hz A5 -> 1320 Hz E6) for incoming WhatsApp alerts (opcode 0x10), Chime 2 (660 Hz -> 880 Hz) for recording/KWS wake activation, and Chime 3 (ascending C major arpeggio 523 -> 659 -> 784 -> 1046 Hz) for system boot and dispatch confirmation. Table II summarizes the prototype BOM."
));

// TABLE II: BOM
tableElement(
  "II",
  "Prototype Hardware Bill of Materials (BOM) Breakdown",
  ["Subsystem / Component", "Part Specification", "MCU Pinout", "Unit Cost ($)"],
  [
    ["Wireless MCU Board", "NXP FRDM-MCXW71 (Cortex-M33, BLE 5.3)", "USB-C MCU-Link", "12.50"],
    ["Wired Headset + Mic", "Commercial 3.5 mm TRRS CTIA Earphones", "AUX Tip & Sleeve", "1.80"],
    ["3.5 mm Female Jack", "4-Pole CTIA Socket w/ Insertion Switch", "PTA16, PTA21, PTB0", "0.35"],
    ["Conditioning Passives", "10 µF Cap + 10 kΩ Divider + 1 kΩ / 10 nF RC", "PTA16 / PTB1", "0.45"],
    ["Class-D Audio Amp", "PAM8403 Miniature Stereo/Mono Module", "PTB1 (In+), PTB2 (Mute)", "0.65"],
    ["Miniature Speaker", "8 Ω 1 W Auxiliary Feedback Load", "PAM8403 SPK+/SPK-", "0.55"],
    ["Battery & Charger", "3.7 V LiPo Cell + TP4056 Protection Module", "3.3V System Rail", "2.40"],
    { cells: ["Total Prototype Cost", "Complete Accessible Cyber-Physical Node", "Sub-$20 Objective Met", "$18.70"], _highlight: true }
  ],
  "Representative single-unit prototype cost vs. $50–$250+ commercial smart speakers [10], [12].",
  [27, 36, 22, 15]
).forEach(el => colChildren.push(el));

// =========================================================================
// IV. TINYML KEYWORD SPOTTING ENGINE AND EMBEDDED FIRMWARE
// =========================================================================
colChildren.push(secHeading("IV", "TinyML Keyword Spotting Engine and Embedded Firmware"));

colChildren.push(subHeading("A", "Synthetic 16 kHz Audio Corpus Pipeline (generate_dataset.ps1)"));
colChildren.push(p(
  "Because generic speech benchmarks [29] exclude specialized wake triggers tailored to visually impaired voice gateways, an automated dataset generator (generate_dataset.ps1) was scripted around the .NET System.Speech.Synthesis engine configured cleanly for 16.0 kHz, 16-bit Signed Mono PCM formatting (16,000 samples / 1.0 s duration per clip). Three target wake triggers—'parity', 'hello parity', and 'hey parity'—were synthesized across dual male (David) and female (Zira) voice profiles sweeping seven distinct speaking rates (-6, -4, -2, 0, +2, +4, +6), centrally padded and peak-normalized to ±26,000 LSB. To enforce resilience against noise and mains hum, 29 negative recordings were synthesized in Python: 25 Gaussian ambient noise profiles (std 60–250 LSB) and 4 narrowband power-line hum signals (50, 60, 100, and 120 Hz at 350 LSB). The curated corpus comprises 73 balanced clips (noise: 29, parity: 16, hello_parity: 14, hey_parity: 14)."
));

colChildren.push(subHeading("B", "Spectral Extraction and Compact 2D-CNN Topology (train_kws.py)"));
colChildren.push(p(
  "During offline training (train_kws.py), each 16,000-sample waveform passes through a Short-Time Fourier Transform (frame_length = 512, frame_step = 256 -> 61 × 257 magnitude matrix) resized bilinearly into a compact 32 × 16 (512-element) time-frequency grid. On-device in parity_kws_model.h, KWS_ExtractSpectrogram() extracts matching 32-time-slice × 16-band RMS subband envelopes (500 samples/slice) directly from raw int16_t arrays within 148 bytes of compiled Thumb-2 code."
));

colChildren.push(p(
  "To preserve compatibility with microcontroller Flash budgets without sacrificing spatial spectral selectivity, our TensorFlow/Keras CNN substitutes parameter-heavy Flatten+Dense tails [16] with a GlobalAveragePooling2D() layer following the second convolutional stage (Conv2D(16, 3×3)). Pooling across spatial feature maps (16, 8, 16) condenses feature representation into 16 compact scalar descriptors before classification. Total trainable weights shrink to just 1,588 parameters (6,352 bytes in Flash rodata, Table III)—75.5× smaller than the STM32 CNN baseline reported in [16] (119,936 weights) while requiring only 184,640 multiply-accumulate (MAC) operations per classification."
));

// TABLE III: Model Architecture & Exact ELF Sizes
tableElement(
  "III",
  "VisioTinyML 2D-CNN Topology and Verified ELF Symbol Sizes",
  ["Layer / C Symbol", "Output Shape", "Params", "ELF Flash (B)", "MAC Ops"],
  [
    ["Input (spec[32][16])", "(32, 16, 1)", "0", "—", "—"],
    ["Conv2D_1 (8× 3×3, same, ReLU)\ng_kws_w_conv1 / b_conv1", "(32, 16, 8)", "80", "288 + 32\n(320 B)", "36,864"],
    ["MaxPooling2D (2×2)", "(16, 8, 8)", "0", "—", "—"],
    ["Conv2D_2 (16× 3×3, same, ReLU)\ng_kws_w_conv2 / b_conv2", "(16, 8, 16)", "1,168", "4,608 + 64\n(4,672 B)", "147,456"],
    ["GlobalAveragePooling2D", "(16)", "0", "—", "~2,048 adds"],
    ["Dense_1 (16 -> 16, ReLU)\ng_kws_w_dense1 / b_dense1", "(16)", "272", "1,024 + 64\n(1,088 B)", "256"],
    ["Dense_2 (16 -> 4, Softmax)\ng_kws_w_dense2 / b_dense2", "(4)", "68", "256 + 16\n(272 B)", "64"],
    ["Executable KWS Routines\nKWS_ClassifyAudio + ExtractSpec", "ARM Thumb-2", "—", "996 + 148\n(1,144 B)", "—"],
    { cells: ["Total Standalone C Engine", "4 Classes", "1,588", "7,496 B\n(7.32 KB)", "184,640 MACs"], _highlight: true }
  ],
  "Symbol byte counts verified via arm-none-eabi-nm --size-sort on Debug/frdmmcxw7x_wireless_uart_bm.axf.",
  [33, 18, 13, 20, 16]
).forEach(el => colChildren.push(el));

// Figure 3 Placeholder
figPlaceholder(
  3,
  "TinyML Spectrogram Feature Extraction and Global-Average-Pooled 2D-CNN Architecture.",
  "Block architecture tracing 16 kHz raw PCM (16,000 samples) -> 32×16 spectrogram extraction -> Conv2D (8 filters, 3×3) -> MaxPool (2×2) -> Conv2D (16 filters, 3×3) -> GlobalAveragePooling2D -> Dense (16) -> 4-Class Softmax (noise, parity, hello_parity, hey_parity).",
  2600
).forEach(el => colChildren.push(el));

colChildren.push(subHeading("C", "Standalone C Inference and Headless Boot Verification"));
colChildren.push(p(
  "The training pipeline outputs both a 6,672-byte dynamic-range quantized flatbuffer (parity_kws_model.tflite) and a dependency-free C inference header (parity_kws_model.h) defining KWS_ClassifyAudio(const int16_t *audio, float *out_confidence). Inside VoxAssist_Init() at startup, the Cortex-M33 executes a self-diagnostic pass over g_test_audio_sample (test_audio_vector.h, 16,000 signed 16-bit PCM samples = 32,000 bytes of spoken 'parity'), playing acoustic Chime 2 upon positive wake verification—allowing complete neural validation on hardware prior to attaching physical microphone capsules."
));

colChildren.push(subHeading("D", "Hands-Free VAD and 16.25 KB Lossless Ring Buffer"));
colChildren.push(p(
  "Inside the real-time loop VoxAssist_Process(), idle polling checks baseline-subtracted voice amplitude |x̃[n]| > VAD_THRESHOLD_AMPLITUDE (1400 LSB). Triggering across VAD_TRIGGER_CONSECUTIVE_CNT = 2 consecutive samples—or physical PTB0 PTT depression—switches s_voice_active = true, emits OPCODE_START (0x01), and packs 60-sample (120-byte) audio frames (~16 kHz, 3.75 ms duration) alongside OPCODE_DATA (0x02) into 121-byte BLE packets. Once minimum utterance duration (VAD_MIN_SPEECH_CHUNKS = 35, ~131 ms) passes, VAD_SILENCE_TIMEOUT_CHUNKS = 320 (~1.2 s continuous quiet) signals OPCODE_END (0x03) automatically and permits WFI low-power sleep."
));

colChildren.push(p(
  "Because mobile BLE central stacks occasionally stall notifications across connection events, streaming directly from interrupt loops causes irreversible audio clipping. In wireless_uart.c, a static circular FIFO ring buffer s_audio_ring_buf[128] (128 packets × 130 B struct = 16,640 bytes / 16.25 KB in .bss) stores up to 480 ms of active speech. Calling BleApp_NotifyPacket() appends frames atomically at s_ring_head via BleApp_QueuePacket(), while BleApp_ProcessTxQueue() dispatches packets at s_ring_tail via GattServer_SendInstantValueNotification(). Whenever controller buffers return gBleOverflow_c or gBleOutOfMemory_c, s_ring_tail pauses without incrementing while VoxAssist_IsBusy() blocks WFI sleep, ensuring lossless queue flushing once RF congestion clears."
));

// Figure 4 Placeholder
figPlaceholder(
  4,
  "Lossless 16.25 KB Circular FIFO Ring Buffer, BLE Backpressure FSM, and VAD Timing Flow.",
  "Timing and finite-state diagram mapping LPADC0 sampling -> IIR baseline subtraction -> VAD trigger/silence timers -> 128-slot ring buffer queue/dequeue -> gBleOverflow_c retry holding read pointer -> Three-Opcode transport (0x01 START, 0x02 DATA, 0x03 END).",
  2600
).forEach(el => colChildren.push(el));

// =========================================================================
// V. ANDROID COMPANION APPLICATION AND WHATSAPP AUTOMATION
// =========================================================================
colChildren.push(secHeading("V", "Android Companion Application and Zero-Touch Automation"));

colChildren.push(subHeading("A", "Multi-Profile BLE GATT Discovery Engine (MainActivity.kt)"));
colChildren.push(p(
  "Implemented in Kotlin (minSdk 26, targetSdk 34) with an accessible high-contrast WebView front-end and AndroidBridge hooks, the companion application initiates BluetoothLeScanner in SCAN_MODE_LOW_LATENCY, isolating boards advertising 'FRDM-VOX', 'FRDM-MCXW71-VOX', 'MCXW71', or 'Vox'. Following connection, MainActivity calls gatt.requestMtu(512) prior to discoverServices(), binding flexibly across Custom Assistive Service (0xFFF0/0xFFF1/0xFFF2), NXP Wireless UART (01ff5550-... / 01ff0100-...), or falling back to the first PROPERTY_NOTIFY characteristic (uuid_uart_stream) before writing ENABLE_NOTIFICATION_VALUE to its CCCD (0x2902) [15]."
));

colChildren.push(subHeading("B", "Multi-Wake-Phrase Regex and Hybrid NLP Contact Matcher"));
colChildren.push(p(
  "Recognized voice transcripts are screened against the multi-trigger wake pattern \\b((hello|hey|hi)\\s+)?(parity|parody|perry|pairity)\\b, accepting 'parity', 'hello parity', and 'hey parity' alongside common speech-recognizer homophones. Because proper nouns in regional accents routinely defeat literal string equality, computeContactSimilarity() evaluates a weighted fusion of orthographic and phonetic similarity. First, Damerau-Levenshtein edit distance d_DL(s_1, s_2) accounts for insertions, deletions, substitutions, and adjacent transpositions [30]:"
));

colChildren.push(eq("StringSim(s₁, s₂) = 1.0 − [ d_DL(s₁, s₂) / max(|s₁|, |s₂|) ]", 6));

colChildren.push(p(
  "Second, a rule-based phonetic transformer P(s) collapses homophonic English and South-Asian consonant/vowel variants (ph,gh->f; ck,kh,qu->k; sh->s; th->t; dh->d; bh->b; wh,w->v; c->s/k) and consecutive duplicates, generating composite score S:"
));

colChildren.push(eq("S(s₁, s₂) = 0.45 · StringSim(s₁, s₂) + 0.55 · StringSim(P(s₁), P(s₂))", 7));

colChildren.push(p(
  "Scores S ≥ 0.55 accept the target recipient, augmented by a nine-category kinship alias lexicon (mom -> mother, mum, amma, maa, aai; dad -> father, papa, appa; sister -> didi, akka; brother -> bhai, anna) awarding 0.98 confidence."
));

colChildren.push(subHeading("C", "Zero-Touch WhatsAppAccessibilityService and Reply Interception"));
colChildren.push(p(
  "Resolved E.164 phone numbers launch WhatsApp directly via Android deep linking:"
));

colChildren.push(eq("https://api.whatsapp.com/send?phone=[E164]&text=[UTF8_Msg]", 8));

colChildren.push(p(
  "When WhatsApp opens, WhatsAppAccessibilityService.kt intercepts TYPE_WINDOW_STATE_CHANGED events [27], searches the AccessibilityNodeInfo tree for com.whatsapp:id/send or com.whatsapp.w4b:id/send (with recursive 'Send' text fallback), invokes performAction(ACTION_CLICK) with zero screen contact, and triggers GLOBAL_ACTION_BACK after 1,500 ms to return autonomously to VisioTinyML. In parallel, VoxNotificationListenerService.kt listens on incoming com.whatsapp notifications, suppresses background sync banners, caches the latest 20 messages, dispatches BLE opcode 0x10 to sound a private in-ear chime, and answers spoken queries ('Read out' / 'What is the reply') through TTS and BLE opcode 0x20."
));

// Figure 5 Placeholder
figPlaceholder(
  5,
  "Dual-Metric Phonetic Contact Matching and WhatsApp Accessibility DOM Auto-Send Flowchart.",
  "Sequence workflow mapping Speech Transcript -> Wake Phrase Stripping -> Orthographic/Phonetic Matching Matrix -> WhatsApp Intent Launch -> AccessibilityNodeInfo View ID Search (com.whatsapp:id/send) -> Synthetic ACTION_CLICK -> NotificationListener In-Ear Alert Loop.",
  2600
).forEach(el => colChildren.push(el));

// =========================================================================
// VI. EXPERIMENTAL RESULTS, MEMORY DATASHEET, AND VERIFICATION
// =========================================================================
colChildren.push(secHeading("VI", "Experimental Results, Memory Datasheet, and Verification"));

colChildren.push(p(
  "To ensure full empirical transparency and technical credibility, every quantitative figure presented below derives directly from verified toolchain artifacts: (1) stratified 5-fold cross-validation and quantized TFLite evaluation across the 73-clip corpus, (2) arm-none-eabi-size and arm-none-eabi-nm inspection of the compiled firmware ELF binary (frdmmcxw7x_wireless_uart_bm.axf), and (3) documented electrical limits from the NXP MCXW71 datasheet [28]."
));

colChildren.push(subHeading("A", "TinyML KWS 5-Fold Cross-Validation and TFLite Metrics"));
colChildren.push(p(
  "The compact 2D-CNN (Adam lr = 0.005, categorical cross-entropy, 50 epochs, batch size 8) was evaluated using stratified 5-fold cross-validation (seed = 42) over all 73 audio samples. Across the five held-out test folds, classification accuracies measured 87.50%, 93.33%, 100.00%, 93.33%, and 100.00%, achieving an overall mean validation accuracy of 94.83% ± 4.73%. Concurrently, evaluating the exported dynamic-range INT8 quantized flatbuffer (parity_kws_model.tflite, 6,672 bytes) yielded 94.52% accuracy (69/73 correct, 83.06% mean softmax confidence)."
));

colChildren.push(p(
  "As reflected in the pooled 5-fold validation confusion matrix (Table IV), zero negative noise or 50–120 Hz power-line hum clips (0/29) caused false wake activations (100.0% precision and recall on noise), and zero target utterances (0/44) were dropped as background noise. All four intra-class substitutions occurred strictly among phonetically overlapping wake phrases (hello_parity vs. hey_parity vs. parity)—demonstrating 100.0% (73/73) binary Wake-versus-Noise reliability."
));

// TABLE IV: Confusion Matrix & Per-Class Metrics
tableElement(
  "IV",
  "Pooled 5-Fold Stratified Cross-Validation Confusion Matrix and F1 Scores",
  ["True \\ Pred", "noise", "parity", "hello_parity", "hey_parity", "Prec / Rec / F1"],
  [
    ["noise (n=29)", "29", "0", "0", "0", "100 / 100 / 100%"],
    ["parity (n=16)", "0", "15", "1", "0", "93.8 / 93.8 / 93.8%"],
    ["hello_parity (n=14)", "0", "0", "13", "1", "86.7 / 92.9 / 89.7%"],
    ["hey_parity (n=14)", "0", "1", "1", "12", "92.3 / 85.7 / 88.9%"],
    { cells: ["5-Fold Mean Acc", "—", "—", "—", "—", "94.83% ± 4.73%"], _highlight: true }
  ],
  "100.0% (73/73) Wake-vs-Noise discrimination across held-out validation splits. Exported 6,672 B TFLite achieved 94.52% (69/73).",
  [23, 10, 10, 13, 13, 31]
).forEach(el => colChildren.push(el));

// Figure 6 Placeholder
figPlaceholder(
  6,
  "KWS 4-Class Confusion Matrix Heatmap and 50-Epoch Training Convergence Curves.",
  "Two-panel experimental figure: (Left) 4×4 confusion matrix confirming zero false noise triggers across noise, parity, hello_parity, and hey_parity; (Right) Training accuracy and cross-entropy loss progression across 50 epochs.",
  2600
).forEach(el => colChildren.push(el));

colChildren.push(subHeading("B", "Verified ARM Cortex-M33 ELF Memory Footprint Datasheet"));
colChildren.push(p(
  "Static link analysis on the compiled binary (frdmmcxw7x_wireless_uart_bm.axf) via arm-none-eabi-size and arm-none-eabi-nm verifies balanced Flash and SRAM consumption within internal SoC boundaries (Table V). Program Flash utilizes 205,512 bytes (20.40% of 984 KB), while SRAM consumes 76,296 bytes (67.12% of 111 KB user SRAM)—jointly housing the full NXP BLE 5.3 Host Stack, 16.25 KB lossless audio ring buffer, and 30.14 KB TinyML activation buffers without external DRAM."
));

// TABLE V: Compiled Memory Footprint
tableElement(
  "V",
  "Compiled MCXW71 ELF Memory Datasheet (arm-none-eabi-size)",
  ["Memory Region / Component", "Allocated", "Available", "Utilization"],
  [
    ["PROGRAM_FLASH (.text+.data+.exidx)", "205,512 B", "1,007,616 B (984 KB)", "20.40%"],
    ["  ├─ TinyML C Weights (6,352 B) + Code (1,144 B)", "7,496 B", "984 KB", "0.74%"],
    ["  ├─ PCM Test Vector (g_test_audio_sample)", "32,000 B", "984 KB", "3.18%"],
    ["  └─ BLE Host Stack, SDK & App Logic", "166,016 B", "984 KB", "16.48%"],
    ["NVM_region (BLE Bonding Flash)", "32,768 B", "32,768 B (32 KB)", "100.0%"],
    ["Application SRAM (.data+.bss+.heap)", "76,296 B", "113,664 B (111 KB)", "67.12%"],
    ["  ├─ TinyML Activation Tensors (conv1/conv2/pool1/spec)", "30,864 B", "111 KB", "27.15%"],
    ["  ├─ Lossless Ring Buffer (s_audio_ring_buf[128])", "16,640 B", "111 KB", "14.64%"],
    ["  └─ BLE memHeap (13,000 B) + Stack/SDK", "28,792 B", "111 KB", "25.33%"],
    ["Shared NBU Radio IPC (rpmsg_sh_mem)", "6,144 B", "6,144 B (6 KB)", "100.0%"]
  ],
  "Exact linker section sizes directly extracted from Debug/frdmmcxw7x_wireless_uart_bm.axf and output.map.",
  [44, 18, 24, 14]
).forEach(el => colChildren.push(el));

colChildren.push(subHeading("C", "Packet Timing Budget and NXP Datasheet Power Envelopes"));
colChildren.push(p(
  "Sampling at 16 kHz across 60-sample segments (AUDIO_CHUNK_SAMPLES = 60) yields 120 bytes of uncompressed PCM payload every 3.75 ms, enclosed with opcode 0x02 into a 121-byte BLE notification cleanly accommodated by the negotiated 512-byte ATT MTU. Even at 256 kbps peak continuous PCM throughput, the 128-slot ring buffer buffers 480 ms of uninterrupted speech during transient RF congestion. Grounded in NXP's MCXW71 DC-DC buck electrical datasheet [28], active radio TX bursts draw 4.60 mA (0 dBm, 15.2 mW @ 3.3 V), RX draws 4.68 mA, active 96 MHz Cortex-M33 execution draws ~5.3 mA, and Power-Down standby sleep draws <3.0 µA (<0.01 mW)—representing orders-of-magnitude power reduction compared against 1.5–2.5 W smart speakers [12] and 1.18 W Cortex-M7 external-RAM rigs [16]."
));

colChildren.push(subHeading("D", "Technical Benchmark Against Referenced KWS Papers"));
colChildren.push(p(
  "Table VI directly contrasts VisioTinyML's model compactness and functional integration against the three peer-reviewed embedded KWS reference systems [16], [21], [23]. Replacing flattened fully connected matrices with Global Average Pooling shrinks trainable parameters by 75.5× relative to [16], cuts MAC operations by 61.3%, improves hold-out classification accuracy relative to [21], and uniquely adds BLE 5.3 + Android UI automation."
));

// TABLE VI: KWS Literature Comparison
tableElement(
  "VI",
  "Direct Quantitative Comparison Against Referenced KWS Studies",
  ["Metric / Capability", "Abbas & Ahmad [21]", "Wang & Li [16]", "Shili et al. [23]", "VisioTinyML (Ours)"],
  [
    ["Audio Transducer", "PDM MEMS (16 kHz)", "WM8978 I2S (16 kHz)", "Analog MEMS (8 kHz)", "3.5mm Aux (16 kHz)"],
    ["Trainable Params", "Edge Impulse CNN", "119,936 params", "2,040 weights (MLP)", "1,588 params"],
    ["Weight Memory", "37.6 KB (INT8 Flash)", "468.5 KB (Float32)", "Q15 static array", "6.35 KB C / 6.67 KB TFL"],
    ["MAC Complexity", "3× 1D-Conv MFCC", "476,576 MACs", "2,050 MACs (Time)", "184,640 MACs"],
    ["Reported Accuracy", "84.51% (GSC Test)", "~90.0% (GSC Val)", ">90.0% (Quiet Lab)", "94.83% CV / 94.52% TFL"],
    { cells: ["Mobile OS Action", "None (Board LEDs)", "None (UART terminal)", "None (Motor GPIO)", "BLE 5.3 + WhatsApp A11y"], _highlight: true }
  ],
  "VisioTinyML memory sizes and MAC figures are verified directly from compiled ELF symbols and parity_kws_model.h.",
  [21, 20, 19, 19, 21]
).forEach(el => colChildren.push(el));

// =========================================================================
// VII. LIMITATIONS, CHALLENGES, AND FUTURE SCOPE
// =========================================================================
colChildren.push(secHeading("VII", "Limitations, Challenges, and Future Scope"));

colChildren.push(subHeading("A", "Current Prototype Limitations"));
colChildren.push(p(
  "Three practical constraints define immediate boundaries for field deployment. First, while the 73-clip synthetic SAPI5 dataset validated on-device wake detection with zero noise false positives, synthetic vocal synthesizers do not replicate natural dysarthria, heavy regional accents, or sudden impulsive traffic noise; blending multi-speaker recordings and negative Google Speech Commands slices [29] is essential before large-scale trials. Second, inexpensive third-party wired headsets vary in microphone bias impedance (1.2–3.8 kΩ) and wiring pinout (CTIA vs. OMTP), motivating a software-programmable gain stage. Third, static float32 intermediate tensors inside KWS_ClassifyAudio() consume 30,864 bytes of SRAM (27.15% of RAM), constraining concurrent SRAM headroom."
));

colChildren.push(subHeading("B", "Future Engineering Roadmap"));
colChildren.push(p(
  "Ongoing development prioritizes four enhancements: (1) migrating inference loops from float32 to INT8 fixed-point CMSIS-NN kernels (arm_convolve_s8) leveraging Cortex-M33 DSP SIMD extensions [16], which shrinks activation SRAM below 8 KB and accelerates execution; (2) interfacing open-ear bone-conduction headset transducers [11] so blind pedestrians hear approaching traffic unimpeded; (3) upgrading KWS_ExtractSpectrogram() with ARM CMSIS-DSP 512-point real FFT (arm_rfft_fast_f32) and training multilingual keywords (Hindi, Kannada, Tamil); and (4) harnessing the MCXW71's IEEE 802.15.4 radio [28] to bridge Matter/Thread domestic IoT devices via whispered headset commands."
));

// =========================================================================
// VIII. CONCLUSION
// =========================================================================
colChildren.push(secHeading("VIII", "Conclusion"));

colChildren.push(p(
  "VisioTinyML demonstrates an ultra-low-cost, privacy-preserving cyber-physical voice gateway that empowers visually impaired individuals to conduct hands-free WhatsApp communication independently. By intentionally substituting expensive far-field beamforming arrays and mains-tethered smart speakers with a sub-$19 NXP FRDM-MCXW71 node interfaced to ubiquitous $1.80 wired earphones, the platform restores mobile autonomy while guaranteeing conversational privacy. Verified ELF link diagnostics and empirical cross-validation establish a lightweight 20.40% Flash and 67.12% SRAM footprint containing a 16.25 KB lossless audio ring buffer and a 1,588-parameter 2D-CNN wake classifier achieving 94.83% five-fold CV accuracy with zero background noise false positives. Unified with automated Android Accessibility DOM dispatch and private in-ear reply readouts, VisioTinyML charts a credible, reproducible path toward affordable edge intelligence for accessible computing."
));

// =========================================================================
// ACKNOWLEDGMENT
// =========================================================================
colChildren.push(secHeading("", "Acknowledgment"));
colChildren.push(p(
  "The authors acknowledge the Embedded Systems and Assistive Computing Laboratory for MCUXpresso hardware development facilities and NXP Semiconductors for public technical documentation on the MCXW71 wireless microcontroller family.",
  false
));

// =========================================================================
// REFERENCES (EXACTLY 30 STRICTLY VERIFIED CITATIONS IN IEEE STYLE)
// =========================================================================
colChildren.push(secHeading("", "References"));

const referencesList = [
  "World Health Organization (WHO), \"World report on vision,\" Geneva: World Health Organization, Tech. Rep. ISBN 978-92-4-151657-0, Oct. 2019.",
  "R. R. A. Bourne et al., \"Trends in prevalence of blindness and distance and near vision impairment over 30 years: an analysis for the Global Burden of Disease Study,\" Lancet Global Health, vol. 9, no. 2, pp. e130–e143, Feb. 2021.",
  "E. Karapanos, P. Teixeira, and R. Gouveia, \"Need fulfillment and experiences on social media: A case on WhatsApp and Facebook,\" Comput. Hum. Behav., vol. 55, pp. 888–897, Feb. 2016.",
  "S. K. Kane, C. Jayant, J. O. Wobbrock, and R. E. Ladner, \"Freedom to roam: A study of mobile device adoption and accessibility for people with visual and motor disabilities,\" in Proc. 11th Int. ACM SIGACCESS Conf. Comput. Access. (ASSETS '09), Oct. 2009, pp. 115–122.",
  "J. Guerreiro, P. Santana, and J. Jorge, \"Assisting touch screen interaction for visually impaired users: A systematic review,\" IEEE Trans. Hum.-Mach. Syst., vol. 49, no. 5, pp. 414–427, Oct. 2019.",
  "A. Rodrigues, K. Montague, H. Nicolau, and T. Guerreiro, \"Getting smartphones to Talkback: Understanding the smartphone adoption process of blind users,\" in Proc. 17th Int. ACM SIGACCESS Conf. Comput. Access. (ASSETS '15), Oct. 2015, pp. 23–32.",
  "S. Azenkot and N. B. Lee, \"Exploring the use of speech input by blind people on mobile devices,\" in Proc. 15th Int. ACM SIGACCESS Conf. Comput. Access. (ASSETS '13), Oct. 2013, pp. 1–8.",
  "A. Pradhan, K. Mehta, and L. Findlater, \"Accessibility came by accident: Use of voice-controlled intelligent personal assistants by people with disabilities,\" in Proc. 2018 CHI Conf. Hum. Factors Comput. Syst. (CHI '18), Apr. 2018, pp. 1–13.",
  "A. Abdolrahmani, K. M. Storer, A. R. M. Roy, R. Kuber, and S. M. Branham, \"Blind leading the sighted: Drawing design insights from blind users towards more productivity-oriented voice interfaces,\" ACM Trans. Access. Comput., vol. 12, no. 4, pp. 1–35, Jan. 2020.",
  "M. Hersh and M. A. Johnson, Assistive Technology for Visually Impaired and Blind People. London, U.K.: Springer-Verlag, 2008.",
  "R. Tapu, B. Mocanu, and T. Zaharia, \"Wearable assistive devices for visually impaired: A state of the art survey,\" Pattern Recognit. Lett., vol. 137, pp. 37–52, Sep. 2020.",
  "A. Sciuto, A. Saini, J. Forlizzi, and J. I. Hong, \"'Hey Alexa, what's up?': A mixed-methods study of in-home conversational agent usage,\" in Proc. 2018 Designing Interactive Systems Conf. (DIS '18), Jun. 2018, pp. 857–868.",
  "Meta Platforms Inc., \"WhatsApp Business Platform Cloud API Overview and Developer Documentation,\" Menlo Park, CA, USA, Tech. Spec., 2024.",
  "C. Gomez, J. Oller, and J. Paradells, \"Overview and evaluation of Bluetooth Low Energy: An emerging low-power wireless technology,\" Sensors, vol. 12, no. 9, pp. 11734–11753, Sep. 2012.",
  "Bluetooth Special Interest Group (SIG), \"Bluetooth Core Specification Version 5.3,\" Kirkland, WA, USA, Tech. Spec., Jul. 2021.",
  "J. Wang and S. Li, \"Keyword spotting system and evaluation of pruning and quantization methods on low-power edge microcontrollers,\" in Proc. Detect. Classif. Acoust. Scenes Events (DCASE) Workshop, Nancy, France, Nov. 2022, pp. 1–5.",
  "G. Chen, C. Parada, and G. Heigold, \"Small-footprint keyword spotting using deep neural networks,\" in Proc. IEEE Int. Conf. Acoust., Speech Signal Process. (ICASSP), May 2014, pp. 4087–4091.",
  "P. M. Sørensen, B. Epp, and T. May, \"A depthwise separable convolutional neural network for keyword spotting on an embedded system,\" EURASIP J. Audio, Speech, Music Process., vol. 2020, art. 10, 2020.",
  "Y. Zhang, N. Suda, L. Lai, and V. Chandra, \"Hello Edge: Keyword spotting on microcontrollers,\" arXiv preprint arXiv:1711.07128, Feb. 2018.",
  "P. P. Ray, \"A review on TinyML: State-of-the-art and prospects,\" J. King Saud Univ. - Comput. Inf. Sci., vol. 34, no. 4, pp. 1595–1623, Apr. 2022.",
  "N. A. Abbas and M. R. Ahmad, \"Keyword spotting system with Nano 33 BLE Sense using embedded machine learning approach,\" Jurnal Teknologi, vol. 85, no. 3, pp. 175–182, May 2023.",
  "T. N. Sainath and C. Parada, \"Convolutional neural networks for small-footprint keyword spotting,\" in Proc. Interspeech, Sep. 2015, pp. 1478–1482.",
  "M. Shili, S. Hammedi, A. Gawanmeh, and K. Nouri, \"Embedded implementation of real-time voice command recognition on PIC microcontroller,\" MDPI Automation, vol. 6, no. 4, art. 79, pp. 1–22, Nov. 2025.",
  "A. Abdolrahmani, R. Kuber, and S. M. Branham, \"'Siri talks at you': An empirical investigation of voice-activated personal assistant (VAPA) usage by individuals who are blind,\" in Proc. 20th Int. ACM SIGACCESS Conf. Comput. Access. (ASSETS '18), Oct. 2018, pp. 249–258.",
  "J. Bai, S. Lian, Z. Liu, K. Wang, and D. Liu, \"Smart guiding glasses for visually impaired people in indoor environment,\" IEEE Trans. Consum. Electron., vol. 63, no. 3, pp. 258–266, Aug. 2017.",
  "H. Petrie, V. Johnson, T. McNally, and I. Hamilton, \"Evaluation of peripheral tactile and voice interfaces for visually impaired users,\" IEEE Trans. Neural Syst. Rehabil. Eng., vol. 14, no. 4, pp. 450–458, Dec. 2006.",
  "Google Open Source Project, \"Android AccessibilityService API Architecture and Window Node Traversal Reference,\" Google Developers Documentation, 2024.",
  "NXP Semiconductors, \"MCX W71x Wireless Microcontrollers: Reference Manual and Datasheet (Arm Cortex-M33, BLE 5.3, IEEE 802.15.4),\" Document MCXW71RM / MCXW71DS, NXP B.V., Oct. 2024.",
  "P. Warden, \"Speech Commands: A dataset for limited-vocabulary speech recognition,\" arXiv preprint arXiv:1804.03209, Apr. 2018.",
  "F. J. Damerau, \"A technique for computer detection and correction of spelling errors,\" Commun. ACM, vol. 7, no. 3, pp. 171–176, Mar. 1964."
];

referencesList.forEach((refText, idx) => {
  colChildren.push(refItem(idx + 1, refText));
});

// Construct IEEE Conference Document Sections matching conference_101719.pdf
// Section 1: Single-Column Title + Author Grid
// Section 2: Continuous Two-Column Flow (Abstract + Index Terms -> Body -> References)
const doc = new Document({
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter 8.5 x 11 in
          margin: { top: 1080, bottom: 1440, left: 900, right: 900 } // 0.75 in top, 1.0 in bottom, 0.625 in L/R
        }
      },
      children: [
        createTitle(titleText),
        createAuthorBlock(authorsList)
      ]
    },
    {
      properties: {
        type: SectionType.CONTINUOUS,
        column: {
          count: 2,
          space: 360 // 0.25 inch gutter between 3.5 in columns
        },
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, bottom: 1440, left: 900, right: 900 }
        }
      },
      children: colChildren
    }
  ]
});

const outputPath = 'VoxAssist_IEEE_Research_Paper.docx';
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputPath, buffer);
  console.log("=======================================================");
  console.log(`Compiled single IEEE Conference paper: ${outputPath}`);
  console.log(`Total file size: ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`References included: ${referencesList.length}`);
  console.log("=======================================================");
}).catch(err => {
  console.error("Error packaging document:", err);
  process.exit(1);
});
