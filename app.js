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
  // Natural Language & Contact Parsing Engine (WhatsApp Dedicated)
  // Format: Send message to "<contact name>" - "<message>"
  // =========================================================================
  function processVoiceCommand(rawText) {
    const cleanText = rawText.trim();
    transcriptDisplay.textContent = `"${cleanText}"`;
    const now = new Date();
    intentTime.textContent = now.toTimeString().split(' ')[0];

    const patterns = [
      /send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to\s+([^-:]+?)\s*[-:]\s*(.+)/i,
      /send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to\s+(.+?)\s+(?:saying|that)\s+(.+)/i,
      /send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to\s+([A-Za-z]+)\s+(.+)/i,
      /whatsapp\s+([^-:]+?)\s*[-:]\s*(.+)/i
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
      intentStatusBadge.textContent = 'FORMAT ERROR';
      intentStatusBadge.className = 'intent-status-badge failed';
      intentContact.textContent = 'Unknown';
      intentPhone.textContent = 'None';
      intentMessage.textContent = cleanText;

      playErrorChime();
      speakAloud('Command not recognized. Say: Send message to Contact Name, dash, message.');
      logBlePacket(`[PARSER ERR] Could not parse format from: "${cleanText}"`, 'err');
      return;
    }

    contactQuery = contactQuery.replace(/^["']|["']$/g, '').trim();
    messageBody = messageBody.replace(/^["']|["']$/g, '').trim();

    // Look up contact in Address Book (Accurate matching)
    const resolvedContact = findContact(contactQuery);

    if (resolvedContact) {
      // SUCCESS: Contact found!
      intentStatusBadge.textContent = 'WHATSAPP READY';
      intentStatusBadge.className = 'intent-status-badge parsed';
      intentContact.textContent = resolvedContact.name;
      intentPhone.textContent = resolvedContact.phone;
      intentMessage.textContent = messageBody;

      playSuccessChime();
      speakAloud(`Opening WhatsApp message to ${resolvedContact.name}: "${messageBody}".`);

      logBlePacket(`[WHATSAPP RX] Opening chat -> ${resolvedContact.name} (${resolvedContact.phone})`, 'success');

      // Dispatch to WhatsApp Outbox history
      addMessageToOutbox(resolvedContact, messageBody);

      // Trigger Native WhatsApp via Android Bridge
      if (window.AndroidBridge && typeof window.AndroidBridge.sendWhatsApp === 'function') {
        try {
          window.AndroidBridge.sendWhatsApp(resolvedContact.phone, messageBody, resolvedContact.name);
        } catch (e) {
          console.warn('AndroidBridge WhatsApp dispatch error:', e);
        }
      } else {
        // Fallback for regular browser: open WhatsApp Web / Deep Link directly
        let cleanPhone = resolvedContact.phone.replace(/[^0-9+]/g, '');
        if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
        window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageBody)}`, '_blank');
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
      logBlePacket(`[CONTACT ERR] Name "${contactQuery}" not resolved in phone contacts.`, 'err');
    }
  }

  // Robust contact search: Exact -> Relation -> Prefix -> Word Match
  function findContact(query) {
    if (!query) return null;
    const q = query.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    if (!q) return null;

    // 1. Exact Name match (e.g., "rahul" === "rahul")
    let match = state.contacts.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === q);
    if (match) return match;

    // 2. Exact Relation match (e.g. "mom", "dad", "doctor")
    match = state.contacts.find(c => (c.relation || '').toLowerCase().replace(/[^a-z0-9]/g, '') === q);
    if (match) return match;

    // 3. Name starts with query (e.g. query "ash" matches "Ashish", "doc" matches "Doctor")
    match = state.contacts.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(q));
    if (match) return match;

    // 4. Query starts with contact name (e.g. query "dr smith clinic" matches "dr smith")
    match = state.contacts.find(c => {
      const name = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return name.length >= 3 && q.startsWith(name);
    });
    if (match) return match;

    // 5. Individual word match
    const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    return state.contacts.find(c => {
      const nameWords = c.name.toLowerCase().split(/\s+/);
      return qWords.some(qw => nameWords.some(nw => nw === qw || nw.startsWith(qw)));
    });
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
  // Contact Directory Rendering & Filtering
  // =========================================================================
  function renderContacts(listToRender = state.contacts) {
    if (contactsCountBadge) {
      if (listToRender.length === state.contacts.length) {
        contactsCountBadge.textContent = `${state.contacts.length} contacts`;
      } else {
        contactsCountBadge.textContent = `Showing ${listToRender.length} of ${state.contacts.length}`;
      }
    }

    if (listToRender.length === 0) {
      contactsList.innerHTML = '<p class="empty-state">No contacts found matching your search.</p>';
      return;
    }

    contactsList.innerHTML = listToRender.map(c => `
      <div class="contact-item" data-name="${escapeHtml(c.name)}" title="Tap to test WhatsApp command for ${escapeHtml(c.name)}">
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

    contactsList.querySelectorAll('.contact-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.getAttribute('data-name');
        const testCmd = `Send message to ${name} - This is a voice test from VoxAssist.`;
        processVoiceCommand(testCmd);
      });
    });
  }
  renderContacts();

  // Search Filter Handler
  if (contactSearchInput) {
    contactSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (clearSearchBtn) {
        clearSearchBtn.hidden = !q;
      }
      if (!q) {
        renderContacts(state.contacts);
        return;
      }
      const filtered = state.contacts.filter(c => {
        const nameMatch = c.name.toLowerCase().includes(q);
        const phoneMatch = (c.phone || '').replace(/[^0-9]/g, '').includes(q.replace(/[^0-9]/g, ''));
        const relationMatch = (c.relation || '').toLowerCase().includes(q);
        return nameMatch || phoneMatch || relationMatch;
      });
      renderContacts(filtered);
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      contactSearchInput.value = '';
      clearSearchBtn.hidden = true;
      renderContacts(state.contacts);
      contactSearchInput.focus();
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
