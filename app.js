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
      { id: 5, name: 'Caregiver', phone: '+919876543214', relation: 'Caregiver' }
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
  // Contact-Aware Voice Command Parser (WhatsApp Dedicated)
  // Handles:
  // - "Send message to [Contact] [Message]"
  // - "Send message to [Contact] - [Message]"
  // - "Send message to [Contact] that [Message]"
  // - "Send WhatsApp message to [Contact] [Message]"
  // - "Send WhatsApp to [Contact] [Message]"
  // - "WhatsApp [Contact] [Message]"
  // - "Message to [Contact] [Message]"
  // - "Tell [Contact] [Message]"
  // - "Text [Contact] [Message]"
  // =========================================================================
  function processVoiceCommand(rawText) {
    const cleanText = rawText.trim();
    transcriptDisplay.textContent = `"${cleanText}"`;
    const now = new Date();
    intentTime.textContent = now.toTimeString().split(' ')[0];

    // 1. Strip trigger prefix
    const prefixes = [
      /^send\s+(?:a\s+)?whatsapp\s+message\s+to\s+/i,
      /^send\s+(?:a\s+)?message\s+to\s+/i,
      /^send\s+(?:a\s+)?whatsapp\s+to\s+/i,
      /^send\s+to\s+/i,
      /^whatsapp\s+to\s+/i,
      /^whatsapp\s+/i,
      /^message\s+to\s+/i,
      /^tell\s+/i,
      /^text\s+to\s+/i,
      /^text\s+/i
    ];

    let stripped = cleanText;
    for (const prefix of prefixes) {
      const m = stripped.match(prefix);
      if (m) {
        stripped = stripped.substring(m[0].length).trim();
        break;
      }
    }

    // 2. Identify Contact using intelligent matcher against state.contacts
    let resolvedContact = null;
    let messageBody = '';

    // Strategy A: Check contacts sorted by longest name first (so "Alex Smith" matches before "Alex")
    const sortedContacts = [...state.contacts].sort((a, b) => b.name.length - a.name.length);
    const lowerStripped = stripped.toLowerCase();

    for (const contact of sortedContacts) {
      const cNameLower = contact.name.toLowerCase();
      const firstName = cNameLower.split(' ')[0];

      // Exact full name at beginning of stripped phrase
      if (lowerStripped.startsWith(cNameLower)) {
        resolvedContact = contact;
        messageBody = stripped.substring(cNameLower.length).trim();
        break;
      }
      // First name match (at least 3 characters)
      else if (firstName.length >= 3 && (lowerStripped.startsWith(firstName + ' ') || lowerStripped === firstName)) {
        resolvedContact = contact;
        messageBody = stripped.substring(firstName.length).trim();
        break;
      }
      // Relation match (e.g. "mom", "dad", "doctor", "caregiver")
      else if (contact.relation && lowerStripped.startsWith(contact.relation.toLowerCase())) {
        resolvedContact = contact;
        messageBody = stripped.substring(contact.relation.length).trim();
        break;
      }
    }

    // Strategy B: Check common aliases if no direct contact matched
    if (!resolvedContact) {
      const aliasMap = {
        'mom': ['mom', 'mother', 'mummy', 'amma', 'maa'],
        'dad': ['dad', 'father', 'papa', 'daddy', 'appa'],
        'doctor': ['doctor', 'dr', 'dr.', 'clinic', 'physician'],
        'caregiver': ['caregiver', 'nurse', 'assistant', 'helper'],
        'sis': ['sis', 'sister'],
        'bro': ['bro', 'brother']
      };

      for (const [alias, synonyms] of Object.entries(aliasMap)) {
        if (lowerStripped.startsWith(alias)) {
          const match = state.contacts.find(c => {
            const nameL = c.name.toLowerCase();
            const relL = (c.relation || '').toLowerCase();
            return synonyms.some(s => nameL.includes(s) || relL.includes(s));
          });
          if (match) {
            resolvedContact = match;
            messageBody = stripped.substring(alias.length).trim();
            break;
          }
        }
      }
    }

    // Strategy C: Check for explicit delimiters (-, :, that, saying)
    if (!resolvedContact) {
      const delimiterMatch = stripped.match(/^([^-:]+?)\s*[-:]\s*(.+)$/i) || 
                             stripped.match(/^(.+?)\s+(?:saying|that|to say)\s+(.+)$/i);
      if (delimiterMatch) {
        const query = delimiterMatch[1].trim();
        const found = findContact(query);
        if (found) {
          resolvedContact = found;
          messageBody = delimiterMatch[2].trim();
        }
      }
    }

    // Strategy D: Check first word or two against findContact
    if (!resolvedContact) {
      const words = stripped.split(/\s+/);
      if (words.length >= 2) {
        // Try first 2 words
        let tryName = words.slice(0, 2).join(' ');
        let found = findContact(tryName);
        if (found) {
          resolvedContact = found;
          messageBody = words.slice(2).join(' ').trim();
        } else {
          // Try 1st word
          tryName = words[0];
          found = findContact(tryName);
          if (found) {
            resolvedContact = found;
            messageBody = words.slice(1).join(' ').trim();
          }
        }
      }
    }

    // Clean up messageBody (remove leading delimiters & filler conjunctions)
    messageBody = messageBody
      .replace(/^[-:]\s*/, '')
      .replace(/^(?:that|saying|to say|to)\s+/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    // 3. Dispatch or report result
    if (resolvedContact) {
      if (!messageBody) {
        messageBody = 'Hello, this is a voice message from VoxAssist.';
      }

      intentStatusBadge.textContent = 'WHATSAPP READY';
      intentStatusBadge.className = 'intent-status-badge parsed';
      intentContact.textContent = resolvedContact.name;
      intentPhone.textContent = resolvedContact.phone;
      intentMessage.textContent = messageBody;

      playSuccessChime();
      speakAloud(`Sending WhatsApp message to ${resolvedContact.name}: "${messageBody}".`);
      logBlePacket(`[WHATSAPP DISPATCH] Recipient: ${resolvedContact.name} (${resolvedContact.phone})`, 'success');

      // Update buffer telemetry monitor
      window.updateBufferTelemetry('SENT', state.bufferedPacketsCount, state.bufferedBytesCount, `To ${resolvedContact.name}: ${messageBody}`);

      // Add to UI outbox history
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
        let cleanPhone = resolvedContact.phone.replace(/[^0-9+]/g, '');
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
      const topNames = state.contacts.slice(0, 3).map(c => c.name).join(', ');
      speakAloud(`Could not find ${stripped.split(' ')[0] || 'that contact'}. Available contacts include: ${topNames}.`);
      logBlePacket(`[PARSER] Unresolved contact query in: "${cleanText}"`, 'err');
    }
  }

  // Robust contact search: Exact -> Relation -> Prefix -> Substring -> Distance
  function findContact(query) {
    if (!query) return null;
    const q = query.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    if (!q) return null;

    // 1. Exact Name match
    let match = state.contacts.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === q);
    if (match) return match;

    // 2. Exact Relation match
    match = state.contacts.find(c => (c.relation || '').toLowerCase().replace(/[^a-z0-9]/g, '') === q);
    if (match) return match;

    // 3. Name starts with query
    match = state.contacts.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(q));
    if (match) return match;

    // 4. Query starts with contact name
    match = state.contacts.find(c => {
      const name = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return name.length >= 3 && q.startsWith(name);
    });
    if (match) return match;

    // 5. Individual word match
    const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    match = state.contacts.find(c => {
      const nameWords = c.name.toLowerCase().split(/\s+/);
      return qWords.some(qw => nameWords.some(nw => nw === qw || nw.startsWith(qw)));
    });
    if (match) return match;

    // 6. Fuzzy edit distance (Levenshtein <= 2 for words >= 4)
    if (q.length >= 4) {
      match = state.contacts.find(c => {
        const cClean = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return getEditDistance(q, cClean) <= 2;
      });
      if (match) return match;
    }

    return null;
  }

  function getEditDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // =========================================================================
  // WhatsApp Outbox Management
  // =========================================================================
  function addMessageToOutbox(contact, messageText) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const msgItem = {
      id: Date.now(),
      recipientName: contact.name,
      phoneNumber: contact.phone,
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
    if (!query) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const cleanQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${cleanQ})`, 'gi');
    return escapedText.replace(regex, '<span class="match-highlight">$1</span>');
  }

  function renderContacts(listToRender = null, searchQuery = '') {
    // If no list passed, filter based on active category chip and search input
    if (!listToRender) {
      const q = (contactSearchInput ? contactSearchInput.value : '').toLowerCase().trim();
      searchQuery = q;
      let filtered = state.contacts;

      // Category chip filter
      if (state.activeFilterCategory && state.activeFilterCategory !== 'all') {
        filtered = filtered.filter(c => 
          (c.relation || '').toLowerCase().includes(state.activeFilterCategory.toLowerCase())
        );
      }

      // Search query filter (matches name, phone numbers, or relation)
      if (q) {
        filtered = filtered.filter(c => {
          const nameMatch = c.name.toLowerCase().includes(q);
          const phoneMatch = (c.phone || '').replace(/[^0-9]/g, '').includes(q.replace(/[^0-9]/g, ''));
          const relationMatch = (c.relation || '').toLowerCase().includes(q);
          return nameMatch || phoneMatch || relationMatch;
        });
      }
      listToRender = filtered;
    }

    if (contactsCountBadge) {
      if (listToRender.length === state.contacts.length) {
        contactsCountBadge.textContent = `${state.contacts.length} contacts`;
      } else {
        contactsCountBadge.textContent = `Showing ${listToRender.length} of ${state.contacts.length}`;
      }
    }

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
        });
      }
      return;
    }

    contactsList.innerHTML = listToRender.map(c => `
      <div class="contact-item" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone)}" title="Tap to test WhatsApp command for ${escapeHtml(c.name)}">
        <div class="contact-info-wrap">
          <div class="contact-avatar">${escapeHtml(c.name.charAt(0).toUpperCase())}</div>
          <div class="contact-meta">
            <span class="contact-name">${highlightText(c.name, searchQuery)}</span>
            <span class="contact-phone">${highlightText(c.phone, searchQuery)}</span>
          </div>
        </div>
        <div class="contact-item-actions">
          <span class="contact-relation">${highlightText(c.relation || 'Contact', searchQuery)}</span>
          <button class="contact-action-btn quick-send-btn" title="Send WhatsApp to ${escapeHtml(c.name)}">💬 WhatsApp</button>
        </div>
      </div>
    `).join('');

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

  // Instant Live Search Filter Handlers (input, keyup, change)
  if (contactSearchInput) {
    const handleSearchInput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (clearSearchBtn) {
        clearSearchBtn.hidden = !q;
      }
      renderContacts(null, q);
    };

    ['input', 'keyup', 'search', 'change'].forEach(ev => {
      contactSearchInput.addEventListener(ev, handleSearchInput);
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      contactSearchInput.value = '';
      clearSearchBtn.hidden = true;
      renderContacts();
      contactSearchInput.focus();
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
    return str.replace(/[&<>'"]/g, 
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
