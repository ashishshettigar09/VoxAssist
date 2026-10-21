/**
 * VoxAssist - Voice-to-WhatsApp Assistive Companion Logic
 * Microcontroller (FRDM-RW612 + INMP441) & Mobile App Interface
 */

document.addEventListener('DOMContentLoaded', () => {
  // =========================================================================
  // State Management
  // =========================================================================
  const state = {
    isRecording: false,
    bleConnected: true,
    ttsEnabled: true,
    audioContext: null,
    analyser: null,
    microphoneStream: null,
    recognition: null,
    speechSynthesis: window.speechSynthesis,
    txPacketCount: 0,
    currentTranscript: '',
    animationFrameId: null,
    contacts: [
      { id: 1, name: 'Mom', phone: '+919876543210', relation: 'Family' },
      { id: 2, name: 'Dad', phone: '+919876543211', relation: 'Family' },
      { id: 3, name: 'Doctor', phone: '+919876543212', relation: 'Medical' },
      { id: 4, name: 'Alex', phone: '+919876543213', relation: 'Friend' },
      { id: 5, name: 'Caregiver', phone: '+919876543214', relation: 'Caregiver' },
      { id: 6, name: 'Ashish Shettigar', phone: '+919876543215', relation: 'Friend' }
    ],
    outbox: []
  };

  // Restore custom contacts from localStorage if available
  const savedContacts = localStorage.getItem('voxassist_contacts');
  if (savedContacts) {
    try {
      state.contacts = JSON.parse(savedContacts);
    } catch (e) {
      console.error('Failed to parse saved contacts', e);
    }
  }

  // =========================================================================
  // Real Phone Contacts Synchronization (From Android Native)
  // =========================================================================
  window.loadDeviceContacts = function(deviceContactsData) {
    try {
      let contactsList = deviceContactsData;
      if (typeof deviceContactsData === 'string') {
        contactsList = JSON.parse(deviceContactsData);
      }
      if (Array.isArray(contactsList) && contactsList.length > 0) {
        state.contacts = contactsList;
        renderContacts();
        logBlePacket(`[CONTACTS] Synced ${contactsList.length} real phone contacts`, 'success');
      }
    } catch (e) {
      console.error('Failed to parse device contacts:', e);
    }
  };

  // If AndroidBridge exists, request contacts immediately
  if (window.AndroidBridge && typeof window.AndroidBridge.getDeviceContactsJson === 'function') {
    try {
      const json = window.AndroidBridge.getDeviceContactsJson();
      if (json) {
        window.loadDeviceContacts(json);
      }
    } catch (e) {
      console.warn('Failed to call getDeviceContactsJson on startup:', e);
    }
  }

  // =========================================================================
  // DOM Elements
  // =========================================================================
  const pttButton = document.getElementById('pttButton');
  const pttLabel = document.getElementById('pttLabel');
  const pttSubLabel = document.getElementById('pttSubLabel');
  const waveformCanvas = document.getElementById('waveformCanvas');
  const canvasCtx = waveformCanvas.getContext('2d');
  const micLevelLabel = document.getElementById('micLevelLabel');
  const transcriptDisplay = document.getElementById('transcriptDisplay');
  const intentContact = document.getElementById('intentContact');
  const intentPhone = document.getElementById('intentPhone');
  const intentMessage = document.getElementById('intentMessage');
  const intentStatusBadge = document.getElementById('intentStatusBadge');
  const intentTime = document.getElementById('intentTime');
  const speechFeedbackText = document.getElementById('speechFeedbackText');
  const blePacketLog = document.getElementById('blePacketLog');
  const txPktCount = document.getElementById('txPktCount');
  const contactsList = document.getElementById('contactsList');
  const outboxList = document.getElementById('outboxList');
  const clearOutboxBtn = document.getElementById('clearOutboxBtn');
  const ttsVoiceToggleBtn = document.getElementById('ttsVoiceToggleBtn');
  const ttsBtnText = document.getElementById('ttsBtnText');
  const ttsStatusPill = document.getElementById('ttsStatusPill');
  const bleStatusPill = document.getElementById('bleStatusPill');
  const reconnectBleBtn = document.getElementById('reconnectBleBtn');
  const openAddContactBtn = document.getElementById('openAddContactBtn');
  const contactModalBackdrop = document.getElementById('contactModalBackdrop');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const addContactForm = document.getElementById('addContactForm');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const contactSearchInput = document.getElementById('contactSearchInput');
  const voiceSearchBtn = document.getElementById('voiceSearchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const contactsCountBadge = document.getElementById('contactsCountBadge');
  const a11yBanner = document.getElementById('a11yBanner');
  const enableA11yBtn = document.getElementById('enableA11yBtn');

  // Microcontroller Buffer Telemetry & Filter Selectors
  const mcuBufferCard = document.getElementById('mcuBufferCard');
  const bufferStatusBadge = document.getElementById('bufferStatusBadge');
  const bufPacketCount = document.getElementById('bufPacketCount');
  const bufByteCount = document.getElementById('bufByteCount');
  const bleStateLabel = document.getElementById('bleStateLabel');
  const bleRssiLabel = document.getElementById('bleRssiLabel');
  const bufferProgressBar = document.getElementById('bufferProgressBar');
  const bufferPreviewBox = document.getElementById('bufferPreviewBox');
  const simulateBlePttBtn = document.getElementById('simulateBlePttBtn');
  const flushBufferBtn = document.getElementById('flushBufferBtn');
  const clearBufferBtn = document.getElementById('clearBufferBtn');
  const contactFilterChips = document.getElementById('contactFilterChips');

  state.activeFilterCategory = 'all';
  state.bufferedBytesCount = 0;
  state.bufferedPacketsCount = 0;
  state.bufferedPayloadPreview = '';

  // =========================================================================
  // Web Audio & Sound Effects (Assistive Audio Feedback for Blind Users)
  // =========================================================================
  function getAudioContext() {
    if (!state.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        state.audioContext = new AudioContextClass();
      }
    }
    if (state.audioContext && state.audioContext.state === 'suspended') {
      state.audioContext.resume();
    }
    return state.audioContext;
  }

  function playStartChime() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  function playSuccessChime() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.2);
      });
    } catch (e) {
      console.warn('Success chime error:', e);
    }
  }

  function playErrorChime() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.linearRampToValueAtTime(160, now + 0.25);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) {
      console.warn('Error chime error:', e);
    }
  }

  // =========================================================================
  // Text-To-Speech (TTS Spoken Accessibility Feedback)
  // =========================================================================
  function speakAloud(text, interrupt = true) {
    speechFeedbackText.textContent = `"${text}"`;

    // Forward to native Android TTS if inside APK
    if (window.AndroidBridge && typeof window.AndroidBridge.speak === 'function') {
      window.AndroidBridge.speak(text);
      return;
    }

    if (!state.ttsEnabled || !state.speechSynthesis) return;

    if (interrupt) {
      state.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = state.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }

    state.speechSynthesis.speak(utterance);
  }

  // =========================================================================
  // Live Audio Waveform Animation (Canvas)
  // =========================================================================
  let wavePhase = 0;
  function drawWaveform() {
    canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const centerY = height / 2;

    canvasCtx.lineWidth = 2.5;

    if (state.isRecording) {
      wavePhase += 0.18;
      canvasCtx.strokeStyle = '#25D366'; // WhatsApp Emerald Green
      canvasCtx.shadowBlur = 10;
      canvasCtx.shadowColor = '#25D366';

      canvasCtx.beginPath();
      for (let x = 0; x < width; x++) {
        const normalizedX = x / width;
        const envelope = Math.sin(normalizedX * Math.PI);
        const wave1 = Math.sin(x * 0.04 + wavePhase) * 18;
        const wave2 = Math.sin(x * 0.09 - wavePhase * 1.5) * 10;
        const wave3 = Math.sin(x * 0.02 + wavePhase * 0.7) * 8;
        const y = centerY + (wave1 + wave2 + wave3) * envelope;
        if (x === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
      }
      canvasCtx.stroke();

      const randomDb = -18 + Math.floor(Math.sin(wavePhase * 2) * 8);
      micLevelLabel.textContent = `${randomDb} dB (INMP441 active)`;
      micLevelLabel.style.color = '#25D366';
    } else {
      canvasCtx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      canvasCtx.shadowBlur = 0;
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, centerY);
      for (let x = 0; x < width; x += 4) {
        const ambient = Math.sin(x * 0.03 + Date.now() * 0.002) * 1.5;
        canvasCtx.lineTo(x, centerY + ambient);
      }
      canvasCtx.stroke();
      micLevelLabel.textContent = 'Muted / Idle';
      micLevelLabel.style.color = '#64748b';
    }

    state.animationFrameId = requestAnimationFrame(drawWaveform);
  }
  drawWaveform();

  // =========================================================================
  // Speech Recognition Engine (Web Speech API)
  // =========================================================================
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
      transcriptDisplay.classList.add('live');
    };

    state.recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const text = finalTranscript || interimTranscript;
      if (text) {
        state.currentTranscript = text;
        transcriptDisplay.textContent = `"${text}"`;
        logBlePacket(`[I2S->BLE] ${generateHexPreview(text)} (${text.length * 2}B)`);
      }
    };

    state.recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
    };

    state.recognition.onend = () => {
      transcriptDisplay.classList.remove('live');
      if (state.isRecording) {
        stopRecording();
      }
    };
  }

  // =========================================================================
  // Push-To-Talk (PTT) Controls
  // =========================================================================
  function startRecording() {
    if (state.isRecording) return;
    state.isRecording = true;
    getAudioContext();
    playStartChime();

    pttButton.classList.add('recording');
    pttLabel.textContent = 'LISTENING...';
    pttSubLabel.textContent = 'Release or tap to send';

    state.currentTranscript = '';
    transcriptDisplay.innerHTML = '<span class="placeholder-text">Listening for: "Send message to [Contact] - [Message]"...</span>';
    intentStatusBadge.textContent = 'LISTENING';
    intentStatusBadge.className = 'intent-status-badge';

    speakAloud('Listening. State your command.', false);
    logBlePacket('[BLE] PTT Asserted -> INMP441 I2S DMA Stream Started');

    if (state.recognition) {
      try {
        state.recognition.start();
      } catch (e) {
        console.warn('Recognition already started or error:', e);
      }
    }
  }

  function stopRecording() {
    if (!state.isRecording) return;
    state.isRecording = false;

    pttButton.classList.remove('recording');
    pttLabel.textContent = 'HOLD TO SPEAK';
    pttSubLabel.textContent = 'or tap once to toggle';

    logBlePacket('[BLE] PTT Released -> Stream Flush & Process');

    if (state.recognition) {
      try {
        state.recognition.stop();
      } catch (e) {
        console.warn('Recognition stop error:', e);
      }
    }

    setTimeout(() => {
      if (state.currentTranscript.trim()) {
        processVoiceCommand(state.currentTranscript);
      } else {
        transcriptDisplay.innerHTML = '<span class="placeholder-text">No voice input detected. Tap button or use a preset below.</span>';
        intentStatusBadge.textContent = 'NO INPUT';
        intentStatusBadge.className = 'intent-status-badge';
      }
    }, 250);
  }

  let pttHoldTimeout = null;
  let isHoldMode = false;

  pttButton.addEventListener('mousedown', (e) => {
    isHoldMode = false;
    pttHoldTimeout = setTimeout(() => {
      isHoldMode = true;
      startRecording();
    }, 180);
  });

  window.addEventListener('mouseup', () => {
    if (pttHoldTimeout) clearTimeout(pttHoldTimeout);
    if (isHoldMode && state.isRecording) {
      stopRecording();
      isHoldMode = false;
    }
  });

  pttButton.addEventListener('click', () => {
    if (!isHoldMode) {
      if (!state.isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    }
  });

  // Touch handlers for mobile phones
  pttButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isHoldMode = true;
    startRecording();
  });

  pttButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (state.isRecording) {
      stopRecording();
    }
  });

  // Keyboard Spacebar PTT
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      startRecording();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      stopRecording();
    }
  });

  // =========================================================================
  // Microcontroller Real-Time BLE Buffer Engine Telemetry
  // =========================================================================
  window.updateBufferTelemetry = function(stateName, packetCount, byteCount, preview) {
    state.bufferedPacketsCount = packetCount || 0;
    state.bufferedBytesCount = byteCount || 0;
    state.bufferedPayloadPreview = preview || '';

    if (bufPacketCount) bufPacketCount.textContent = `${state.bufferedPacketsCount} pkts`;
    if (bufByteCount) {
      bufByteCount.textContent = byteCount >= 1024 
        ? `${(byteCount / 1024).toFixed(1)} KB` 
        : `${byteCount} B`;
    }

    if (bufferProgressBar) {
      // Progress fill based on byte accumulation
      const pct = Math.min(100, Math.max(byteCount > 0 ? 8 : 0, (byteCount / 400) * 100));
      bufferProgressBar.style.width = `${pct}%`;
    }

    if (bufferPreviewBox) {
      bufferPreviewBox.textContent = preview || (byteCount > 0 ? `Accumulated Audio PCM (${byteCount} bytes)...` : 'Buffer is empty. Waiting for PTT trigger...');
    }

    if (bufferStatusBadge) {
      const s = (stateName || '').toUpperCase();
      bufferStatusBadge.className = 'buffer-status-badge';
      if (s.includes('RECORD')) {
        bufferStatusBadge.classList.add('recording');
        bufferStatusBadge.textContent = '● RECORDING (PTT)';
        logBlePacket(`[MCU BUFFER] PTT Asserted -> Accumulating data chunks...`, 'tx');
      } else if (s.includes('BUFFER')) {
        bufferStatusBadge.classList.add('buffering');
        bufferStatusBadge.textContent = 'BUFFERING DATA';
      } else if (s.includes('PROCESS') || s.includes('READY')) {
        bufferStatusBadge.classList.add('ready');
        bufferStatusBadge.textContent = 'BUFFER FLUSHED';
        logBlePacket(`[MCU BUFFER] Flushed ${byteCount} bytes (${packetCount} packets)`, 'success');
      } else if (s.includes('SENT') || s.includes('DISPATCH')) {
        bufferStatusBadge.classList.add('sent');
        bufferStatusBadge.textContent = 'DISPATCHED ✓';
      } else {
        bufferStatusBadge.classList.add('idle');
        bufferStatusBadge.textContent = 'BUFFER IDLE';
      }
    }
  };

  window.updateBleStatus = function(statusText, connected, deviceName, rssi) {
    state.bleConnected = connected;
    if (bleStatusPill) {
      bleStatusPill.className = connected ? 'status-pill connected' : 'status-pill';
      bleStatusPill.querySelector('.status-label').textContent = connected 
        ? `BLE: Connected (${deviceName || 'FRDM-RW612'})` 
        : `BLE: ${statusText || 'Scanning...'}`;
    }
    if (bleStateLabel) {
      bleStateLabel.textContent = connected ? (deviceName || 'FRDM-RW612') : 'Scanning...';
      bleStateLabel.className = connected ? 'buf-metric-val highlight' : 'buf-metric-val';
    }
    if (bleRssiLabel) {
      bleRssiLabel.textContent = rssi ? `${rssi} dBm` : (connected ? '-48 dBm' : '-- dBm');
    }
  };

  window.handleNativeVoiceCommand = function(text) {
    if (!text) return;
    transcriptDisplay.textContent = `"${text}"`;
    processVoiceCommand(text);
  };

  // =========================================================================
  // Advanced Closest Name & Fuzzy Contact Matching Engine
  // Resolves misrecognized / misspelled speech transcriptions to closest contact
  // =========================================================================

  const aliasMap = {
    'mom': ['mom', 'mother', 'mummy', 'mum', 'amma', 'maa', 'mommy', 'momma', 'aai', 'mataji'],
    'dad': ['dad', 'father', 'papa', 'daddy', 'dada', 'appa', 'pop', 'pops', 'pitaji', 'babuji'],
    'doctor': ['doctor', 'dr', 'dr.', 'clinic', 'physician', 'doc', 'hospital', 'dentist'],
    'caregiver': ['caregiver', 'nurse', 'assistant', 'helper', 'attendant', 'carer', 'guardian'],
    'sister': ['sister', 'sis', 'didi', 'akka'],
    'brother': ['brother', 'bro', 'bhai', 'bhaiya', 'anna'],
    'wife': ['wife', 'wifey', 'patni', 'spouse', 'partner'],
    'husband': ['husband', 'hubby', 'pati', 'spouse', 'partner'],
    'friend': ['friend', 'buddy', 'mate', 'pal', 'yaar', 'dost']
  };

  /**
   * Damerau-Levenshtein distance calculation accounting for insertions,
   * deletions, substitutions, and adjacent transpositions.
   */
  function getDamerauLevenshtein(s1, s2) {
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0) return len2;
    if (len2 === 0) return len1;

    const d = [];
    for (let i = 0; i <= len1; i++) {
      d[i] = new Array(len2 + 1);
      d[i][0] = i;
    }
    for (let j = 0; j <= len2; j++) {
      d[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        d[i][j] = Math.min(
          d[i - 1][j] + 1,       // deletion
          d[i][j - 1] + 1,       // insertion
          d[i - 1][j - 1] + cost // substitution
        );
        if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost); // transposition
        }
      }
    }
    return d[len1][len2];
  }

  /**
   * Phonetic simplification transformer for speech recognition sound-alikes:
   * maps phonetic variants ('ph'->'f', 'sh'->'s', 'ck'/'c'/'q'->'k', 'wh'/'w'->'v', etc.)
   * and collapses duplicate letters so misrecognized speech (e.g. "Ashis" vs "Ashish", "Alec" vs "Alex") matches.
   */
  function phoneticSimplify(s) {
    if (!s) return '';
    let str = String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!str) return '';

    str = str
      .replace(/ph/g, 'f')
      .replace(/gh/g, 'f')
      .replace(/ck/g, 'k')
      .replace(/sh/g, 's')
      .replace(/ch/g, 'c')
      .replace(/th/g, 't')
      .replace(/dh/g, 'd')
      .replace(/bh/g, 'b')
      .replace(/kh/g, 'k')
      .replace(/jh/g, 'j')
      .replace(/qu/g, 'k')
      .replace(/q/g, 'k')
      .replace(/x/g, 'ks')
      .replace(/z/g, 's')
      .replace(/c(?=[eiy])/g, 's')
      .replace(/c/g, 'k')
      .replace(/wh/g, 'v')
      .replace(/w/g, 'v')
      .replace(/ee/g, 'i')
      .replace(/ea/g, 'i')
      .replace(/oo/g, 'u')
      .replace(/ou/g, 'u')
      .replace(/ai/g, 'e')
      .replace(/ay/g, 'e')
      .replace(/ey/g, 'e')
      .replace(/y/g, 'i');

    let result = '';
    let prev = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch !== prev) {
        result += ch;
        prev = ch;
      }
    }
    return result;
  }

  /**
   * Computes similarity score [0.0..1.0] and edit distance between query and target
   */
  function computeSimilarity(query, target) {
    const qClean = (query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const tClean = (target || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!qClean || !tClean) return { score: 0, distance: 99 };

    if (qClean === tClean) {
      return { score: 1.0, distance: 0, isExact: true };
    }

    // Substring / containment match
    if (tClean.includes(qClean) && qClean.length >= 2) {
      const ratio = qClean.length / tClean.length;
      return { score: 0.88 + 0.12 * ratio, distance: 0, isSubstring: true };
    }
    if (qClean.includes(tClean) && tClean.length >= 2) {
      const ratio = tClean.length / qClean.length;
      return { score: 0.85 + 0.12 * ratio, distance: 0, isSubstring: true };
    }

    // Prefix match with length ratio bonus
    if (tClean.startsWith(qClean) && qClean.length >= 2) {
      const ratio = qClean.length / tClean.length;
      return { score: 0.90 + 0.10 * ratio, distance: 0, isPrefix: true };
    }
    if (qClean.startsWith(tClean) && tClean.length >= 2) {
      const ratio = tClean.length / qClean.length;
      return { score: 0.86 + 0.10 * ratio, distance: 0, isPrefix: true };
    }

    const dist = getDamerauLevenshtein(qClean, tClean);
    const maxLen = Math.max(qClean.length, tClean.length);
    const levSim = 1.0 - (dist / maxLen);

    const qPhon = phoneticSimplify(qClean);
    const tPhon = phoneticSimplify(tClean);
    let phonSim = 0;
    if (qPhon && qPhon === tPhon) {
      phonSim = 1.0;
    } else {
      const pDist = getDamerauLevenshtein(qPhon, tPhon);
      const pMax = Math.max(qPhon.length, tPhon.length);
      phonSim = pMax > 0 ? 1.0 - (pDist / pMax) : 0;
    }

    const compositeScore = phonSim >= 0.88
      ? Math.max(levSim, 0.82 + 0.18 * phonSim)
      : (0.55 * levSim + 0.45 * phonSim);

    return { score: compositeScore, distance: dist, phonSim, levSim };
  }

  /**
   * Scores a candidate query against a Contact object, testing against
   * full name, first name, last name, individual words, relations, and aliases.
   */
  function scoreContact(query, contact) {
    if (!contact) return { score: 0, distance: 99, matchedTarget: '' };
    const qClean = (query || '').toLowerCase().trim();
    const cName = String(contact.name || '').toLowerCase().trim();
    const cRelation = String(contact.relation || '').toLowerCase().trim();

    let bestScore = 0;
    let minDistance = 99;
    let matchedTarget = '';

    // 1. Full name
    const full = computeSimilarity(qClean, cName);
    if (full.score > bestScore) {
      bestScore = full.score;
      minDistance = full.distance;
      matchedTarget = contact.name || '';
    }

    // 2. Name tokens (first name, last name, individual words)
    const tokens = cName.split(/\s+/).filter(w => w.length >= 2);
    for (const token of tokens) {
      const t = computeSimilarity(qClean, token);
      if (t.score > bestScore) {
        bestScore = t.score;
        minDistance = t.distance;
        matchedTarget = token;
      }
    }

    // 3. Relation
    if (cRelation) {
      const r = computeSimilarity(qClean, cRelation);
      if (r.score > bestScore) {
        bestScore = r.score;
        minDistance = r.distance;
        matchedTarget = contact.relation || '';
      }
    }

    // 4. Aliases
    for (const [key, synonyms] of Object.entries(aliasMap)) {
      const matchesContact = synonyms.some(s => cName.includes(s) || (cRelation && cRelation.includes(s)));
      if (matchesContact) {
        for (const syn of synonyms) {
          const sRes = computeSimilarity(qClean, syn);
          if (sRes.score > bestScore) {
            bestScore = sRes.score;
            minDistance = sRes.distance;
            matchedTarget = syn;
          }
        }
      }
    }

    return { score: bestScore, distance: minDistance, matchedTarget };
  }

  /**
   * Finds the closest matching Contact in state.contacts for a candidate name query.
   * Selects the highest similarity score that passes the acceptance threshold.
   */
  function findClosestContact(query, contactsList = state.contacts) {
    if (!query || !contactsList || contactsList.length === 0) return null;
    const cleanQ = query.trim();
    const qLen = cleanQ.replace(/[^a-zA-Z0-9]/g, '').length;
    if (qLen === 0) return null;

    let bestMatch = null;
    let bestScore = 0;
    let bestDist = 99;
    let bestTarget = '';

    for (const contact of contactsList) {
      const res = scoreContact(cleanQ, contact);
      if (res.score > bestScore) {
        bestScore = res.score;
        bestDist = res.distance;
        bestTarget = res.matchedTarget;
        bestMatch = contact;
      }
    }

    if (!bestMatch) return null;

    // Acceptance thresholds (adaptive to length)
    let isAcceptable = false;
    if (bestScore >= 0.80) {
      isAcceptable = true;
    } else if (qLen <= 4 && bestDist <= 1 && bestScore >= 0.60) {
      isAcceptable = true; // "Jon" -> "John", "Alec" -> "Alex", "Mum" -> "Mom"
    } else if (qLen >= 5 && qLen <= 8 && bestDist <= 2 && bestScore >= 0.60) {
      isAcceptable = true; // "Ashis" -> "Ashish", "Docter" -> "Doctor"
    } else if (qLen > 8 && bestDist <= 3 && bestScore >= 0.60) {
      isAcceptable = true;
    } else {
      isAcceptable = bestScore >= 0.68;
    }

    if (isAcceptable) {
      return {
        contact: bestMatch,
        score: bestScore,
        distance: bestDist,
        matchedTarget: bestTarget,
        isExact: cleanQ.toLowerCase() === String(bestMatch.name || '').toLowerCase()
      };
    }
    return null;
  }

  // Unified findContact calling closest match engine
  function findContact(query) {
    const res = findClosestContact(query);
    return res ? res.contact : null;
  }

  // Compatibility helper
  function getEditDistance(a, b) {
    return getDamerauLevenshtein(a, b);
  }

  /**
   * Contact-Aware Voice Command Parser (WhatsApp Dedicated)
   * Resolves voice command to closest contact name (handling recognition misspellings),
   * extracts message body, announces spoken feedback, and dispatches via WhatsApp.
   */
  function processVoiceCommand(rawText) {
    const cleanText = rawText.trim();
    transcriptDisplay.textContent = `"${cleanText}"`;
    const now = new Date();
    intentTime.textContent = now.toTimeString().split(' ')[0];

    // 1. Comprehensive Conversational Trigger Prefixes
    const prefixes = [
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?send\s+(?:a\s+)?whatsapp\s+message\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?send\s+(?:a\s+)?message\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?send\s+(?:a\s+)?whatsapp\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?send\s+(?:a\s+)?message\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?send\s+(?:a\s+)?whatsapp\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?send\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?send\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?whatsapp\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?whatsapp\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?message\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?message\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?text\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?text\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?tell\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?ask\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?say\s+to\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?notify\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?contact\s+/i
    ];

    let stripped = cleanText;
    for (const prefix of prefixes) {
      const m = stripped.match(prefix);
      if (m) {
        stripped = stripped.substring(m[0].length).trim();
        break;
      }
    }

    // 2. Multi-Candidate Evaluation (Delimiters & Word Spans)
    const candidates = [];

    // Delimiter Separation (-, :, that, saying, to say, please, telling, about)
    const delimMatch = stripped.match(/^(.+?)\s*(?:[-:]|(?:\s+(?:that|saying|to say|please|telling|about)))\s+(.+)$/i);
    if (delimMatch) {
      const query = delimMatch[1].trim();
      const rawBody = delimMatch[2].trim();
      const match = findClosestContact(query);
      if (match) {
        const cleanBody = rawBody
          .replace(/^[-:]\s*/, '')
          .replace(/^(?:that|saying|to say)\s+/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();
        candidates.push({
          contact: match.contact,
          score: match.score + 0.05,
          distance: match.distance,
          query: query,
          message: cleanBody,
          isExact: match.isExact
        });
      }
    }

    // N-gram word spans (1 to 3 words from start of stripped text)
    const words = stripped.split(/\s+/).filter(Boolean);
    const maxWords = Math.min(3, words.length);

    for (let count = 1; count <= maxWords; count++) {
      const queryCandidate = words.slice(0, count).join(' ');
      const remainder = words.slice(count).join(' ');
      const match = findClosestContact(queryCandidate);
      if (match) {
        const cleanBody = remainder
          .replace(/^[-:]\s*/, '')
          .replace(/^(?:that|saying|to say)\s+/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();
        const multiWordBonus = (count > 1 && String(match.contact.name || '').includes(' ')) ? 0.08 : 0;
        candidates.push({
          contact: match.contact,
          score: match.score + multiWordBonus,
          distance: match.distance,
          query: queryCandidate,
          message: cleanBody,
          isExact: match.isExact
        });
      }
    }

    // Select the candidate with the highest similarity score
    candidates.sort((a, b) => b.score - a.score);
    const champion = candidates[0] || null;

    if (champion) {
      const resolvedContact = champion.contact;
      let messageBody = champion.message;
      if (!messageBody) {
        messageBody = 'Hello, this is a voice message from VoxAssist.';
      }

      const isExactMatch = champion.isExact;
      if (isExactMatch) {
        intentStatusBadge.textContent = 'WHATSAPP READY';
        intentStatusBadge.className = 'intent-status-badge parsed';
        intentContact.textContent = resolvedContact.name;
        speakAloud(`Sending WhatsApp message to ${resolvedContact.name}: "${messageBody}".`);
        logBlePacket(`[WHATSAPP DISPATCH] Recipient: ${resolvedContact.name} (${resolvedContact.phone})`, 'success');
      } else {
        // Misrecognized / fuzzy closest match
        intentStatusBadge.textContent = 'MATCHED (CLOSEST)';
        intentStatusBadge.className = 'intent-status-badge closest';
        intentContact.innerHTML = `${escapeHtml(resolvedContact.name)} <span class="closest-tag" title="Matched from '${escapeHtml(champion.query)}'">Matched from "${escapeHtml(champion.query)}" (${Math.round(champion.score * 100)}%)</span>`;
        speakAloud(`Matched closest contact ${resolvedContact.name} for ${champion.query}. Sending WhatsApp message: "${messageBody}".`);
        logBlePacket(`[CLOSEST MATCH] Resolved "${champion.query}" -> ${resolvedContact.name} (${Math.round(champion.score * 100)}% match)`, 'success');
      }

      intentPhone.textContent = resolvedContact.phone;
      intentMessage.textContent = messageBody;
      playSuccessChime();

      // Update buffer telemetry
      window.updateBufferTelemetry('SENT', state.bufferedPacketsCount, state.bufferedBytesCount, `To ${resolvedContact.name}: ${messageBody}`);

      // Add to outbox history
      addMessageToOutbox(resolvedContact, messageBody);

      // Send via Native Android Bridge
      if (window.AndroidBridge && typeof window.AndroidBridge.sendWhatsApp === 'function') {
        try {
          window.AndroidBridge.sendWhatsApp(resolvedContact.phone, messageBody, resolvedContact.name);
        } catch (e) {
          console.warn('AndroidBridge WhatsApp dispatch error:', e);
        }
      } else {
        // Browser fallback
        let cleanPhone = String(resolvedContact.phone || '').replace(/[^0-9+]/g, '');
        if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
        window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageBody)}`, '_blank');
      }
    } else {
      // Contact could not be identified
      intentStatusBadge.textContent = 'CONTACT NOT FOUND';
      intentStatusBadge.className = 'intent-status-badge failed';
      intentContact.textContent = `"${stripped.split(' ')[0] || 'Unknown'}" (?)`;
      intentPhone.textContent = 'Not in Contacts';
      intentMessage.textContent = cleanText;

      playErrorChime();
      const topNames = state.contacts.slice(0, 3).map(c => c.name).filter(Boolean).join(', ');
      speakAloud(`Could not find ${stripped.split(' ')[0] || 'that contact'}. Available contacts include: ${topNames}.`);
      logBlePacket(`[PARSER] Unresolved contact query in: "${cleanText}"`, 'err');
    }
  }

  // =========================================================================
  // WhatsApp Outbox Management
  // =========================================================================
  function addMessageToOutbox(contact, messageText) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const msgItem = {
      id: Date.now(),
      recipientName: contact.name || 'Unknown',
      phoneNumber: contact.phone || '',
      text: messageText,
      time: timeStr
    };

    state.outbox.unshift(msgItem);
    renderOutbox();
  }

  function renderOutbox() {
    if (state.outbox.length === 0) {
      outboxList.innerHTML = '<p class="empty-state">No WhatsApp messages dispatched yet. Trigger a voice command above.</p>';
      return;
    }

    outboxList.innerHTML = state.outbox.map(msg => `
      <div class="outbox-item" id="msg-${msg.id}">
        <div class="outbox-header">
          <span class="outbox-recipient">To: ${escapeHtml(msg.recipientName)} (${escapeHtml(msg.phoneNumber)})</span>
          <span class="outbox-time">${msg.time}</span>
        </div>
        <div class="outbox-body">"${escapeHtml(msg.text)}"</div>
        <div class="outbox-footer">
          <span>WhatsApp Chat: Opened ✓</span>
          <button class="speak-sms-btn" data-text="WhatsApp message to ${escapeHtml(msg.recipientName)}: ${escapeHtml(msg.text)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            Speak Aloud
          </button>
        </div>
      </div>
    `).join('');

    outboxList.querySelectorAll('.speak-sms-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        speakAloud(btn.getAttribute('data-text'));
      });
    });
  }

  clearOutboxBtn.addEventListener('click', () => {
    state.outbox = [];
    renderOutbox();
  });

  // =========================================================================
  // Contact Directory Rendering, Filtering & Highlighting
  // =========================================================================
  function highlightText(text, query) {
    if (!text) return '';
    const safeText = String(text);
    if (!query) return escapeHtml(safeText);
    const cleanQ = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!cleanQ) return escapeHtml(safeText);
    const regex = new RegExp(`(${cleanQ})`, 'gi');
    return escapeHtml(safeText).replace(regex, '<span class="match-highlight">$1</span>');
  }

  function contactMatchesCategory(c, category) {
    if (!category || category === 'all') return true;
    const cat = category.toLowerCase().trim();
    const rel = String(c.relation || '').toLowerCase();
    const name = String(c.name || '').toLowerCase();

    if (cat === 'family') {
      return rel.includes('family') ||
        /\b(mom|mother|mummy|mum|amma|maa|dad|father|papa|daddy|dada|appa|sister|sis|didi|brother|bro|bhai|bhaiya|wife|husband|son|daughter|grandma|grandpa|nani|dadi|uncle|aunt|chacha|mama)\b/i.test(name) ||
        /\b(mom|mother|mummy|mum|dad|father|papa|sister|brother|wife|husband)\b/i.test(rel);
    }
    if (cat === 'medical') {
      return rel.includes('medical') ||
        /\b(doctor|dr|dr\.|clinic|hospital|physician|dentist|doc|med)\b/i.test(name) ||
        /\b(medical|doctor|clinic|hospital)\b/i.test(rel);
    }
    if (cat === 'friend') {
      return rel.includes('friend') ||
        /\b(friend|buddy|mate|pal|yaar|dost)\b/i.test(rel) ||
        (!rel.includes('family') && !rel.includes('medical') && !rel.includes('caregiver'));
    }
    if (cat === 'caregiver') {
      return rel.includes('caregiver') ||
        /\b(caregiver|nurse|assistant|helper|attendant|carer|guardian)\b/i.test(name) ||
        /\b(caregiver|nurse|assistant|helper|attendant|carer)\b/i.test(rel);
    }
    if (cat === 'phone') {
      return rel.includes('phone') || rel.includes('device') || rel.includes('contact');
    }
    return rel.includes(cat) || name.includes(cat);
  }

  function renderContacts(listToRender = null, searchQuery = '') {
    if (!listToRender) {
      const q = (contactSearchInput ? contactSearchInput.value : '').toLowerCase().trim();
      searchQuery = q;
      const allContacts = state.contacts || [];

      if (!q) {
        // No search query: filter strictly by category chip
        listToRender = allContacts.filter(c => contactMatchesCategory(c, state.activeFilterCategory));
      } else {
        // Multi-tier Search Filter:
        // 1. Direct Substring Matches (name, phone, relation)
        const exactMatches = [];
        const nonExactCandidates = [];
        const cleanQDigits = q.replace(/[^0-9]/g, '');

        for (const c of allContacts) {
          const cName = String(c.name || '').toLowerCase();
          const cPhone = String(c.phone || '');
          const cCleanPhone = cPhone.replace(/[^0-9]/g, '');
          const cRel = String(c.relation || '').toLowerCase();

          const nameMatch = cName.includes(q);
          const phoneMatch = (cleanQDigits.length >= 2 && cCleanPhone.includes(cleanQDigits)) || cPhone.toLowerCase().includes(q);
          const relationMatch = cRel.includes(q);

          if (nameMatch || phoneMatch || relationMatch) {
            exactMatches.push({
              ...c,
              _matchType: 'exact',
              _score: nameMatch ? 1.0 : 0.9
            });
          } else {
            nonExactCandidates.push(c);
          }
        }

        // 2. Fuzzy & Closest Spelling Matches
        const fuzzyMatches = [];
        for (const c of nonExactCandidates) {
          const res = scoreContact(q, c);
          if (res.score >= 0.60 || res.distance <= 2) {
            fuzzyMatches.push({
              ...c,
              _matchType: 'fuzzy',
              _score: res.score,
              _matchedTarget: res.matchedTarget
            });
          }
        }

        // Sort fuzzy matches by similarity score descending
        fuzzyMatches.sort((a, b) => b._score - a._score);

        // Combine exact first, then fuzzy matches
        let combined = [...exactMatches, ...fuzzyMatches];

        // If category filter is active (and not 'all'), prioritize in-category matches
        if (state.activeFilterCategory && state.activeFilterCategory !== 'all') {
          const inCat = combined.filter(c => contactMatchesCategory(c, state.activeFilterCategory));
          if (inCat.length > 0) {
            combined = inCat;
          }
        }

        listToRender = combined;
      }
    }

    // Update contacts count badge
    if (contactsCountBadge) {
      const total = (state.contacts || []).length;
      if (!searchQuery && state.activeFilterCategory === 'all') {
        contactsCountBadge.textContent = `${total} contacts`;
      } else {
        contactsCountBadge.textContent = `Showing ${listToRender.length} of ${total}`;
      }
    }

    // Handle Empty State
    if (listToRender.length === 0) {
      contactsList.innerHTML = `
        <div class="empty-state">
          <p>No contacts found matching "${escapeHtml(searchQuery || state.activeFilterCategory)}".</p>
          <button class="small-outline-btn" id="resetContactFilterBtn" style="margin-top: 8px;">Reset Filter</button>
        </div>
      `;
      const resetBtn = document.getElementById('resetContactFilterBtn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (contactSearchInput) contactSearchInput.value = '';
          if (clearSearchBtn) clearSearchBtn.hidden = true;
          state.activeFilterCategory = 'all';
          updateActiveFilterChip();
          renderContacts();
          if (contactSearchInput) contactSearchInput.focus();
        });
      }
      return;
    }

    // Render Contact Items
    contactsList.innerHTML = listToRender.map(c => {
      const name = String(c.name || 'Unknown');
      const phone = String(c.phone || '');
      const relation = String(c.relation || 'Contact');
      const firstChar = (name.trim().charAt(0) || '?').toUpperCase();
      const isFuzzy = c._matchType === 'fuzzy' || (searchQuery && !name.toLowerCase().includes(searchQuery) && !phone.includes(searchQuery));
      const scorePct = c._score ? Math.round(c._score * 100) : null;

      return `
        <div class="contact-item" data-name="${escapeHtml(name)}" data-phone="${escapeHtml(phone)}" title="Tap to send WhatsApp to ${escapeHtml(name)}">
          <div class="contact-info-wrap">
            <div class="contact-avatar">${escapeHtml(firstChar)}</div>
            <div class="contact-meta">
              <span class="contact-name">${highlightText(name, searchQuery)}${isFuzzy ? ` <span class="closest-match-tag">Closest Match${scorePct ? ` (${scorePct}%)` : ''}</span>` : ''}</span>
              <span class="contact-phone">${highlightText(phone, searchQuery)}</span>
            </div>
          </div>
          <div class="contact-item-actions">
            <span class="contact-relation">${highlightText(relation, searchQuery)}</span>
            <button class="contact-action-btn quick-send-btn" title="Send WhatsApp to ${escapeHtml(name)}">💬 WhatsApp</button>
          </div>
        </div>
      `;
    }).join('');

    // Smooth scroll to top of list when filter changes
    contactsList.scrollTop = 0;

    // Attach click handlers
    contactsList.querySelectorAll('.contact-item').forEach(item => {
      const name = item.getAttribute('data-name');
      const phone = item.getAttribute('data-phone');

      item.querySelector('.quick-send-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const testCmd = `Send message to ${name} - Hello, I am sending this voice test from VoxAssist.`;
        processVoiceCommand(testCmd);
      });

      item.addEventListener('click', () => {
        const testCmd = `Send message to ${name} - I am on my way.`;
        processVoiceCommand(testCmd);
      });
    });
  }
  renderContacts();

  // Instant Live Search Filter Handlers (input, keyup, search, change)
  if (contactSearchInput) {
    const handleSearchInput = (e) => {
      const q = (e.target.value || '').trim();
      if (clearSearchBtn) {
        clearSearchBtn.hidden = !q;
      }
      renderContacts(null, q.toLowerCase());
    };

    ['input', 'keyup', 'search', 'change'].forEach(ev => {
      contactSearchInput.addEventListener(ev, handleSearchInput);
    });
  }

  // Clear Search Button Handler
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (contactSearchInput) {
        contactSearchInput.value = '';
        contactSearchInput.focus();
      }
      clearSearchBtn.hidden = true;
      renderContacts();
    });
  }

  // Voice Search Mic in Search Bar
  if (voiceSearchBtn) {
    let searchRecognition = null;
    voiceSearchBtn.addEventListener('click', () => {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        speakAloud('Voice search is not supported on this browser. Type in the search box.');
        return;
      }

      if (searchRecognition) {
        searchRecognition.abort();
        searchRecognition = null;
        voiceSearchBtn.classList.remove('listening');
        return;
      }

      try {
        searchRecognition = new SpeechRec();
        searchRecognition.lang = 'en-US';
        searchRecognition.continuous = false;
        searchRecognition.interimResults = false;

        voiceSearchBtn.classList.add('listening');
        playStartChime();
        speakAloud('Listening for contact name to search...');

        searchRecognition.onresult = (event) => {
          const spoken = event.results[0][0].transcript.trim().replace(/[.]/g, '');
          if (contactSearchInput) {
            contactSearchInput.value = spoken;
            if (clearSearchBtn) clearSearchBtn.hidden = false;
            renderContacts(null, spoken.toLowerCase());
            speakAloud(`Searching for ${spoken}`);
          }
        };

        searchRecognition.onerror = (err) => {
          console.warn('Voice search error:', err);
          voiceSearchBtn.classList.remove('listening');
          searchRecognition = null;
        };

        searchRecognition.onend = () => {
          voiceSearchBtn.classList.remove('listening');
          searchRecognition = null;
        };

        searchRecognition.start();
      } catch (err) {
        console.warn('Could not start voice search:', err);
        voiceSearchBtn.classList.remove('listening');
      }
    });
  }

  // Category Filter Chips Handler
  function updateActiveFilterChip() {
    if (contactFilterChips) {
      contactFilterChips.querySelectorAll('.filter-chip').forEach(chip => {
        const cat = chip.getAttribute('data-filter');
        chip.classList.toggle('active', cat === state.activeFilterCategory);
      });
    }
  }

  if (contactFilterChips) {
    contactFilterChips.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.activeFilterCategory = chip.getAttribute('data-filter');
        updateActiveFilterChip();
        renderContacts();
      });
    });
  }

  // =========================================================================
  // Microcontroller Buffer Simulation Controls
  // =========================================================================
  if (simulateBlePttBtn) {
    simulateBlePttBtn.addEventListener('click', () => {
      // Pick random contact from state.contacts
      const contact = state.contacts[Math.floor(Math.random() * state.contacts.length)] || { name: 'Mom' };
      const testMsg = `Send message to ${contact.name} - Please call me when you are free`;

      logBlePacket(`[MCU SIM] Simulating PTT Press & Audio Stream from FRDM-RW612...`, 'tx');

      // 1. Send START Opcode (0x01)
      if (window.AndroidBridge && typeof window.AndroidBridge.simulateBlePacket === 'function') {
        window.AndroidBridge.simulateBlePacket(1, '');
      } else {
        window.updateBufferTelemetry('RECORDING', 0, 0, 'Microcontroller PTT Pressed');
      }

      // 2. Stream Data Chunks (Opcode 0x02)
      let packetIdx = 0;
      const totalPackets = 8;
      const streamInterval = setInterval(() => {
        packetIdx++;
        const currentBytes = packetIdx * 64;
        const partialText = testMsg.substring(0, Math.floor((packetIdx / totalPackets) * testMsg.length));

        if (window.AndroidBridge && typeof window.AndroidBridge.simulateBlePacket === 'function') {
          window.AndroidBridge.simulateBlePacket(2, partialText);
        } else {
          window.updateBufferTelemetry('BUFFERING', packetIdx, currentBytes, partialText);
        }

        if (packetIdx >= totalPackets) {
          clearInterval(streamInterval);

          // 3. Send END Opcode (0x03) -> Flushes and triggers WhatsApp!
          setTimeout(() => {
            logBlePacket(`[MCU SIM] PTT Released -> Buffer Flushed -> Processing payload!`, 'success');
            if (window.AndroidBridge && typeof window.AndroidBridge.simulateBlePacket === 'function') {
              window.AndroidBridge.simulateBlePacket(3, '');
            } else {
              window.updateBufferTelemetry('PROCESSING', totalPackets, totalPackets * 64, testMsg);
              setTimeout(() => {
                processVoiceCommand(testMsg);
              }, 400);
            }
          }, 300);
        }
      }, 150);
    });
  }

  if (flushBufferBtn) {
    flushBufferBtn.addEventListener('click', () => {
      if (window.AndroidBridge && typeof window.AndroidBridge.simulateBlePacket === 'function') {
        window.AndroidBridge.simulateBlePacket(3, '');
      } else {
        const preview = state.bufferedPayloadPreview || 'Send message to Mom - I am home';
        processVoiceCommand(preview);
      }
    });
  }

  if (clearBufferBtn) {
    clearBufferBtn.addEventListener('click', () => {
      if (window.AndroidBridge && typeof window.AndroidBridge.clearBleBuffer === 'function') {
        window.AndroidBridge.clearBleBuffer();
      } else {
        window.updateBufferTelemetry('IDLE', 0, 0, 'Buffer cleared');
      }
      speakAloud('Buffer memory cleared.');
    });
  }

  // Accessibility Auto-Send Status Handler
  window.setAccessibilityStatus = function(isEnabled) {
    if (a11yBanner) {
      if (isEnabled) {
        a11yBanner.innerHTML = `
          <div class="a11y-icon">✅</div>
          <div class="a11y-text">
            <strong>Hands-Free Auto-Send: Active</strong>
            <span>WhatsApp messages are sent automatically without touching the screen.</span>
          </div>
        `;
        a11yBanner.style.borderColor = 'rgba(37, 211, 102, 0.6)';
        a11yBanner.style.background = 'rgba(37, 211, 102, 0.12)';
      } else {
        a11yBanner.hidden = false;
      }
    }
  };

  if (enableA11yBtn) {
    enableA11yBtn.addEventListener('click', () => {
      if (window.AndroidBridge && typeof window.AndroidBridge.openAccessibilitySettings === 'function') {
        window.AndroidBridge.openAccessibilitySettings();
      } else {
        alert('To enable Hands-Free Auto-Send on your phone:\n\n1. Open Settings > Accessibility.\n2. Tap "Installed Apps" or "VoxAssist".\n3. Turn VoxAssist ON.\n\nNow messages will send automatically without tapping Send in WhatsApp!');
      }
    });
  }

  // Add Contact Modal Handlers
  openAddContactBtn.addEventListener('click', () => {
    contactModalBackdrop.hidden = false;
    document.getElementById('newContactName').focus();
  });

  function closeContactModal() {
    contactModalBackdrop.hidden = true;
    addContactForm.reset();
  }

  closeModalBtn.addEventListener('click', closeContactModal);
  cancelModalBtn.addEventListener('click', closeContactModal);

  addContactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newContactName').value.trim();
    const phone = document.getElementById('newContactPhone').value.trim();
    const relation = document.getElementById('newContactRelation').value.trim() || 'Custom';

    if (name && phone) {
      state.contacts.unshift({ id: Date.now(), name, phone, relation });
      localStorage.setItem('voxassist_contacts', JSON.stringify(state.contacts));
      renderContacts();
      closeContactModal();
      speakAloud(`Added ${name} to contacts.`);
      logBlePacket(`[CONTACTS] Added new entry: ${name} (${phone})`, 'success');
    }
  });

  // Preset Buttons
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const command = btn.getAttribute('data-command');
      playStartChime();
      transcriptDisplay.textContent = `"${command}"`;
      state.currentTranscript = command;
      logBlePacket(`[PRESET] Injected voice sample: "${command}"`);
      setTimeout(() => {
        processVoiceCommand(command);
      }, 350);
    });
  });

  // =========================================================================
  // BLE Terminal Logger & Helpers
  // =========================================================================
  function logBlePacket(msg, type = 'tx') {
    state.txPacketCount++;
    txPktCount.textContent = `TX: ${state.txPacketCount} pkts`;

    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    line.textContent = `[${timestamp}] ${msg}`;
    blePacketLog.appendChild(line);
    blePacketLog.scrollTop = blePacketLog.scrollHeight;
  }

  function generateHexPreview(str) {
    let hex = '';
    for (let i = 0; i < Math.min(str.length, 6); i++) {
      hex += str.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase() + ' ';
    }
    return hex.trim() + '...';
  }

  reconnectBleBtn.addEventListener('click', () => {
    logBlePacket('[BLE] Initiating peripheral discovery...');
    bleStatusPill.className = 'status-pill';
    bleStatusPill.querySelector('.status-label').textContent = 'BLE: Scanning...';
    setTimeout(() => {
      bleStatusPill.className = 'status-pill connected';
      bleStatusPill.querySelector('.status-label').textContent = 'BLE: Connected (FRDM-RW612)';
      logBlePacket('[BLE] Re-connected to FRDM-RW612 EdgeFast peripheral', 'success');
      playSuccessChime();
      speakAloud('Bluetooth reconnected.');
    }, 900);
  });

  ttsVoiceToggleBtn.addEventListener('click', () => {
    state.ttsEnabled = !state.ttsEnabled;
    if (state.ttsEnabled) {
      ttsBtnText.textContent = 'Spoken Feedback: ON';
      ttsStatusPill.className = 'status-pill connected';
      ttsStatusPill.querySelector('.status-label').textContent = 'TTS Audio: Active';
      speakAloud('Spoken feedback enabled.');
    } else {
      if (state.speechSynthesis) state.speechSynthesis.cancel();
      ttsBtnText.textContent = 'Spoken Feedback: OFF';
      ttsStatusPill.className = 'status-pill';
      ttsStatusPill.querySelector('.status-label').textContent = 'TTS Audio: Muted';
    }
  });

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('ServiceWorker registered:', reg.scope))
        .catch(err => console.log('ServiceWorker skipped:', err));
    });
  }
});
