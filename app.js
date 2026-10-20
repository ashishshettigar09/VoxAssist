/**
 * VoxAssist - Voice-to-SMS Assistive Companion Logic
 * Microcontroller (FRDM-RW612 + INMP441) & Mobile App Simulator
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
      { id: 1, name: 'Mom', phone: '+1 (555) 234-5678', relation: 'Family' },
      { id: 2, name: 'Doctor Smith', phone: '+1 (555) 987-6543', relation: 'Medical' },
      { id: 3, name: 'Alex', phone: '+1 (555) 456-7890', relation: 'Friend' },
      { id: 4, name: 'Emergency Services', phone: '911', relation: 'Emergency' },
      { id: 5, name: 'Sarah Miller', phone: '+1 (555) 321-7654', relation: 'Caregiver' }
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

  // Play high chime when recording starts
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

  // Play positive ascending chime when SMS is dispatched
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

  // Play error descending buzz
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
    if (!state.ttsEnabled || !state.speechSynthesis) return;

    if (interrupt) {
      state.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05; // Slightly faster for responsiveness
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Pick a natural English voice if available
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
      // Dynamic active audio wave
      wavePhase += 0.18;
      canvasCtx.strokeStyle = '#06b6d4';
      canvasCtx.shadowBlur = 10;
      canvasCtx.shadowColor = '#06b6d4';

      canvasCtx.beginPath();
      for (let x = 0; x < width; x++) {
        const normalizedX = x / width;
        const envelope = Math.sin(normalizedX * Math.PI); // Windowing at edges
        const wave1 = Math.sin(x * 0.04 + wavePhase) * 18;
        const wave2 = Math.sin(x * 0.09 - wavePhase * 1.5) * 10;
        const wave3 = Math.sin(x * 0.02 + wavePhase * 0.7) * 8;
        const y = centerY + (wave1 + wave2 + wave3) * envelope;
        if (x === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
      }
      canvasCtx.stroke();

      // Render simulated dB level
      const randomDb = -18 + Math.floor(Math.sin(wavePhase * 2) * 8);
      micLevelLabel.textContent = `${randomDb} dB (INMP441 active)`;
      micLevelLabel.style.color = '#38bdf8';
    } else {
      // Idle flatline with subtle ambient pulse
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
        // Simulate BLE transmission packet
        logBlePacket(`[I2S->BLE] ${generateHexPreview(text)} (${text.length * 2}B)`);
      }
    };

    state.recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        speakAloud('Microphone permission denied. You can use the preset buttons to test commands.');
      }
    };

    state.recognition.onend = () => {
      transcriptDisplay.classList.remove('live');
      if (state.isRecording) {
        stopRecording();
      }
    };
  } else {
    console.warn('SpeechRecognition not supported in this browser. Presets will be used.');
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
    pttSubLabel.textContent = 'Release or click to finish';

    state.currentTranscript = '';
    transcriptDisplay.innerHTML = '<span class="placeholder-text">Listening for: "Send message to [Name] - [Message]"...</span>';
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
    pttSubLabel.textContent = 'or click once to toggle';

    logBlePacket('[BLE] PTT Released -> Stream Flush & Process');

    if (state.recognition) {
      try {
        state.recognition.stop();
      } catch (e) {
        console.warn('Recognition stop error:', e);
      }
    }

    // Process the final captured transcript
    setTimeout(() => {
      if (state.currentTranscript.trim()) {
        processVoiceCommand(state.currentTranscript);
      } else {
        transcriptDisplay.innerHTML = '<span class="placeholder-text">No voice input detected. Click a quick preset below or hold to speak.</span>';
        intentStatusBadge.textContent = 'NO INPUT';
        intentStatusBadge.className = 'intent-status-badge';
      }
    }, 250);
  }

  // Mouse & Touch events for PTT Button (Supports both Click-to-toggle and Press-and-hold)
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
      // Toggle mode
      if (!state.isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    }
  });

  // Keyboard Accessibility: Spacebar Push-To-Talk
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
  // Natural Language & Contact Parsing Engine
  // Format required: Send message to "<contact name>" - "<message>"
  // =========================================================================
  function processVoiceCommand(rawText) {
    const cleanText = rawText.trim();
    transcriptDisplay.textContent = `"${cleanText}"`;
    const now = new Date();
    intentTime.textContent = now.toTimeString().split(' ')[0];

    // Regex pattern matching:
    // 1. "send message to <Name> - <Message>"
    // 2. "send message to <Name> : <Message>"
    // 3. "send message to <Name> saying <Message>"
    // 4. "send a message to <Name> that <Message>"
    const patterns = [
      /send\s+(?:a\s+)?message\s+to\s+([^-:]+?)\s*[-:]\s*(.+)/i,
      /send\s+(?:a\s+)?message\s+to\s+(.+?)\s+(?:saying|that)\s+(.+)/i,
      /send\s+(?:a\s+)?message\s+to\s+(\w+)\s+(.+)/i
    ];

    let contactQuery = null;
    let messageBody = null;

    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        contactQuery = match[1].trim();
        messageBody = match[2].trim();
        break;
      }
    }

    if (!contactQuery || !messageBody) {
      // Failed to match structure
      intentStatusBadge.textContent = 'FORMAT ERROR';
      intentStatusBadge.className = 'intent-status-badge failed';
      intentContact.textContent = 'Unknown';
      intentPhone.textContent = 'None';
      intentMessage.textContent = cleanText;

      playErrorChime();
      speakAloud('Command not recognized. Please say: Send message to Contact Name, dash, message.');
      logBlePacket(`[PARSER ERR] Could not parse format from: "${cleanText}"`, 'err');
      return;
    }

    // Clean up punctuation (like accidental quotes)
    contactQuery = contactQuery.replace(/^["']|["']$/g, '').trim();
    messageBody = messageBody.replace(/^["']|["']$/g, '').trim();

    // Look up contact in Address Book (Fuzzy search)
    const resolvedContact = findContact(contactQuery);

    if (resolvedContact) {
      // SUCCESS: Contact found!
      intentStatusBadge.textContent = 'DISPATCHED';
      intentStatusBadge.className = 'intent-status-badge parsed';
      intentContact.textContent = resolvedContact.name;
      intentPhone.textContent = resolvedContact.phone;
      intentMessage.textContent = messageBody;

      // Spoken Feedback & Chime for Blind User
      playSuccessChime();
      speakAloud(`Sending message to ${resolvedContact.name}: "${messageBody}". Message sent successfully.`);

      // Log BLE dispatch
      logBlePacket(`[BLE RX] Dispatched SMS -> ${resolvedContact.name} (${resolvedContact.phone})`, 'success');

      // Dispatch to Carrier Outbox
      addMessageToOutbox(resolvedContact, messageBody);

      // Trigger Native Android SMS if running inside APK
      if (window.AndroidBridge && typeof window.AndroidBridge.sendNativeSms === 'function') {
        try {
          window.AndroidBridge.sendNativeSms(resolvedContact.phone, messageBody, resolvedContact.name);
        } catch (e) {
          console.warn('AndroidBridge SMS dispatch error:', e);
        }
      }
    } else {
      // Contact not found in phone book
      intentStatusBadge.textContent = 'CONTACT NOT FOUND';
      intentStatusBadge.className = 'intent-status-badge failed';
      intentContact.textContent = `"${contactQuery}" (?)`;
      intentPhone.textContent = 'Not in Contacts';
      intentMessage.textContent = messageBody;

      playErrorChime();
      speakAloud(`Could not find ${contactQuery} in your contacts. Please check the name and try again.`);
      logBlePacket(`[CONTACT ERR] Name "${contactQuery}" not resolved in phone book.`, 'err');
    }
  }

  // Address book matching (supports exact, case-insensitive, prefix, and alias matches)
  function findContact(query) {
    const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    return state.contacts.find(c => {
      const name = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const relation = (c.relation || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return name === q || name.includes(q) || q.includes(name) || relation === q;
    });
  }

  // =========================================================================
  // Carrier Outbox Management
  // =========================================================================
  function addMessageToOutbox(contact, messageText) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const smsItem = {
      id: Date.now(),
      recipientName: contact.name,
      phoneNumber: contact.phone,
      text: messageText,
      time: timeStr
    };

    state.outbox.unshift(smsItem);
    renderOutbox();
  }

  function renderOutbox() {
    if (state.outbox.length === 0) {
      outboxList.innerHTML = '<p class="empty-state">No messages dispatched yet. Trigger a voice command above.</p>';
      return;
    }

    outboxList.innerHTML = state.outbox.map(sms => `
      <div class="outbox-item" id="sms-${sms.id}">
        <div class="outbox-header">
          <span class="outbox-recipient">To: ${escapeHtml(sms.recipientName)} (${escapeHtml(sms.phoneNumber)})</span>
          <span class="outbox-time">${sms.time}</span>
        </div>
        <div class="outbox-body">"${escapeHtml(sms.text)}"</div>
        <div class="outbox-footer">
          <span>Carrier SMS: Delivered ✓</span>
          <button class="speak-sms-btn" data-text="Message to ${escapeHtml(sms.recipientName)}: ${escapeHtml(sms.text)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            Speak Aloud
          </button>
        </div>
      </div>
    `).join('');

    // Attach speak button listeners
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
  // Contact Directory Rendering & Management
  // =========================================================================
  function renderContacts() {
    contactsList.innerHTML = state.contacts.map(c => `
      <div class="contact-item" data-name="${escapeHtml(c.name)}" title="Click to test command for ${escapeHtml(c.name)}">
        <div class="contact-info-wrap">
          <div class="contact-avatar">${c.name.charAt(0).toUpperCase()}</div>
          <div class="contact-meta">
            <span class="contact-name">${escapeHtml(c.name)}</span>
            <span class="contact-phone">${escapeHtml(c.phone)}</span>
          </div>
        </div>
        <span class="contact-relation">${escapeHtml(c.relation || 'Contact')}</span>
      </div>
    `).join('');

    // Click contact to automatically populate a preset voice command
    contactsList.querySelectorAll('.contact-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.getAttribute('data-name');
        const testCmd = `Send message to ${name} - This is a test message from VoxAssist.`;
        processVoiceCommand(testCmd);
      });
    });
  }
  renderContacts();

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
      state.contacts.push({ id: Date.now(), name, phone, relation });
      localStorage.setItem('voxassist_contacts', JSON.stringify(state.contacts));
      renderContacts();
      closeContactModal();
      speakAloud(`Added ${name} to contacts.`);
      logBlePacket(`[CONTACTS] Added new entry: ${name} (${phone})`, 'success');
    }
  });

  // =========================================================================
  // Preset Voice Command Buttons (Instant Testing)
  // =========================================================================
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

  // Toggle Spoken Voice
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

  // =========================================================================
  // Progressive Web App (PWA) Mobile Install Handler
  // =========================================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('ServiceWorker registered:', reg.scope))
        .catch(err => console.log('ServiceWorker registration skipped:', err));
    });
  }

  const installPwaBtn = document.getElementById('installPwaBtn');
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installPwaBtn) {
      installPwaBtn.style.display = 'flex';
      installPwaBtn.classList.add('pulse');
    }
  });

  if (installPwaBtn) {
    installPwaBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          speakAloud('VoxAssist is being installed on your device.');
        }
        deferredInstallPrompt = null;
      } else {
        // Helpful alert for browsers where prompt isn't triggered directly
        speakAloud('To install, tap the three dots in your mobile browser menu and select Add to Home screen.');
        alert('To install on your mobile device:\n\n1. In Chrome / Edge: Tap the browser menu (⋮)\n2. Select "Add to Home screen" or "Install App".\n\nVoxAssist will run as a standalone fullscreen app on your phone!');
      }
    });
  }
});

