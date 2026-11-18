/**
 * VoxAssist - Voice-to-WhatsApp Assistive Companion Logic
 * NXP FRDM-MCXW71 Microcontroller & Mobile App Interface
 * Professional High-Contrast White Theme & Settings Hub
 */

document.addEventListener('DOMContentLoaded', () => {
  // =========================================================================
  // State Management
  // =========================================================================
  const state = {
    isRecording: false,
    bleConnected: true,
    connectedDeviceName: 'FRDM-MCXW71-VOX',
    connectedMac: '00:04:9F:8A:2B:10',
    currentRssi: -42,
    ttsEnabled: true,
    speechRate: 1.0,
    theme: localStorage.getItem('voxassist_theme') || 'light',
    isScanning: false,
    activeTab: 'voice',
    activeDeviceFilter: 'all',
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
    outbox: [],
    repliesHistory: [
      {
        id: 101,
        sender: 'Mom',
        message: 'I am outside the clinic, waiting in the car.',
        time: 'Just now',
        timestamp: Date.now() - 60000,
        announced: true
      }
    ],
    scannedDevices: [
      {
        name: 'FRDM-MCXW71-VOX',
        address: '00:04:9F:8A:2B:10',
        rssi: -42,
        isTargetMcu: true,
        serviceUuid: '0xFFF0'
      },
      {
        name: 'FRDM-MCXW71-LAB',
        address: '00:04:9F:8A:2B:14',
        rssi: -58,
        isTargetMcu: true,
        serviceUuid: '0xFFF0'
      },
      {
        name: 'Wireless Headset',
        address: 'F4:7D:EF:12:34:56',
        rssi: -72,
        isTargetMcu: false
      }
    ]
  };

  // Apply Theme
  document.documentElement.setAttribute('data-theme', state.theme);

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
  const segmentTabs = document.querySelectorAll('.segment-tab');
  const tabViews = document.querySelectorAll('.tab-view');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeToggleIcon = document.getElementById('themeToggleIcon');
  const themeToggleText = document.getElementById('themeToggleText');

  const pttButton = document.getElementById('pttButton');
  const pttLabel = document.getElementById('pttLabel');
  const pttSubLabel = document.getElementById('pttSubLabel');
  const waveformCanvas = document.getElementById('waveformCanvas');
  const canvasCtx = waveformCanvas ? waveformCanvas.getContext('2d') : null;
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
  const ttsStatusPill = document.getElementById('ttsStatusPill');
  const bleStatusPill = document.getElementById('bleStatusPill');
  const bleStatusPillLabel = document.getElementById('bleStatusPillLabel');
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

  // Settings & Connected Devices Selectors
  const startScanBtn = document.getElementById('startScanBtn');
  const stopScanBtn = document.getElementById('stopScanBtn');
  const scanBtnText = document.getElementById('scanBtnText');
  const disconnectBleBtn = document.getElementById('disconnectBleBtn');
  const pingSpeakerBtn = document.getElementById('pingSpeakerBtn');
  const reconnectMcuBtn = document.getElementById('reconnectMcuBtn');
  const webBlePairBtn = document.getElementById('webBlePairBtn');
  const devicesGrid = document.getElementById('devicesGrid');
  const devicesListCount = document.getElementById('devicesListCount');
  const scannedCountBadge = document.getElementById('scannedCountBadge');
  const filterAllDevices = document.getElementById('filterAllDevices');
  const filterTargetMcu = document.getElementById('filterTargetMcu');
  const quickOpenBleTabBtn = document.getElementById('quickOpenBleTabBtn');
  const quickBleStateLabel = document.getElementById('quickBleStateLabel');
  const connectedNameDisplay = document.getElementById('connectedNameDisplay');
  const mcuRssiDisplay = document.getElementById('mcuRssiDisplay');
  const mcuLivePill = document.getElementById('mcuLivePill');
  const voiceFeedbackToggle = document.getElementById('voiceFeedbackToggle');
  const speechRateSelect = document.getElementById('speechRateSelect');
  const testSpkChimeSettingsBtn = document.getElementById('testSpkChimeSettingsBtn');
  const openA11ySettingsBtn = document.getElementById('openA11ySettingsBtn');
  const openNotifSettingsBtn = document.getElementById('openNotifSettingsBtn');

  // WhatsApp Replies & Speaker Selectors
  const simulateReplyMomBtn = document.getElementById('simulateReplyMomBtn');
  const enableNotifBtn = document.getElementById('enableNotifBtn');
  const notifListenerBanner = document.getElementById('notifListenerBanner');
  const notifStatusDesc = document.getElementById('notifStatusDesc');
  const readoutBox = document.getElementById('readoutBox');
  const readoutContent = document.getElementById('readoutContent');
  const repliesList = document.getElementById('repliesList');
  const feedCountBadge = document.getElementById('feedCountBadge');
  const replyNotifDot = document.getElementById('replyNotifDot');
  const queryTestChips = document.querySelectorAll('.query-test-chip');
  const testSpkChimeBtn = document.getElementById('testSpkChimeBtn');
  const testSpkReadoutBtn = document.getElementById('testSpkReadoutBtn');

  // Microcontroller Buffer Telemetry
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

  // =========================================================================
  // Theme Switching Logic (Light / Dark)
  // =========================================================================
  function updateThemeUI() {
    if (state.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (themeToggleIcon) themeToggleIcon.textContent = '🌙';
      if (themeToggleText) themeToggleText.textContent = 'Dark Contrast';
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      if (themeToggleIcon) themeToggleIcon.textContent = '☀️';
      if (themeToggleText) themeToggleText.textContent = 'Light Theme';
    }
  }
  updateThemeUI();

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('voxassist_theme', state.theme);
      updateThemeUI();
      speakAloud(`Switched to ${state.theme === 'light' ? 'light' : 'dark'} theme.`);
    });
  }

  // =========================================================================
  // Segmented Tab Navigation Logic
  // =========================================================================
  function switchTab(tabId) {
    state.activeTab = tabId;

    segmentTabs.forEach(tab => {
      const isTarget = tab.getAttribute('data-tab') === tabId;
      tab.classList.toggle('active', isTarget);
      tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });

    let targetViewId = 'viewVoice';
    if (tabId === 'settings' || tabId === 'ble-devices') targetViewId = 'viewSettings';
    else if (tabId === 'replies') targetViewId = 'viewReplies';
    else if (tabId === 'contacts') targetViewId = 'viewContacts';
    else if (tabId === 'hardware') targetViewId = 'viewHardware';

    tabViews.forEach(view => {
      view.classList.toggle('active', view.id === targetViewId);
    });

    if (tabId === 'settings' || tabId === 'ble-devices') {
      renderScannedDevices();
      updateConnectedDeviceUI();
    } else if (tabId === 'replies') {
      if (replyNotifDot) replyNotifDot.hidden = true;
      renderReplies();
    } else if (tabId === 'contacts') {
      renderContacts();
    }
  }

  segmentTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  if (bleStatusPill) {
    bleStatusPill.addEventListener('click', () => {
      switchTab('settings');
    });
  }

  if (quickOpenBleTabBtn) {
    quickOpenBleTabBtn.addEventListener('click', () => {
      switchTab('settings');
    });
  }

  // =========================================================================
  // Web Audio & Sound Effects
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

  function playNotificationChime() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.14);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1320, now + 0.15);
      gain2.gain.setValueAtTime(0.25, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.32);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.35);
    } catch (e) {
      console.warn('Notification chime error:', e);
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
    if (speechFeedbackText) {
      speechFeedbackText.textContent = `"${text}"`;
    }

    if (window.AndroidBridge && typeof window.AndroidBridge.speak === 'function') {
      window.AndroidBridge.speak(text);
      return;
    }

    if (!state.ttsEnabled || !state.speechSynthesis) return;

    if (interrupt) {
      state.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = state.speechRate;
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
  // Settings & Connected Devices Management
  // =========================================================================
  function updateConnectedDeviceUI() {
    if (connectedNameDisplay) {
      connectedNameDisplay.textContent = state.bleConnected ? state.connectedDeviceName : 'None (Disconnected)';
    }
    if (mcuRssiDisplay) {
      mcuRssiDisplay.textContent = state.bleConnected ? `${state.currentRssi} dBm (Excellent)` : '-- dBm';
    }
    if (mcuLivePill) {
      mcuLivePill.textContent = state.bleConnected ? '● Connected (GATT Ready)' : 'Disconnected';
      mcuLivePill.style.background = state.bleConnected ? '#dcfce7' : '#fee2e2';
      mcuLivePill.style.color = state.bleConnected ? '#065f46' : '#991b1b';
      mcuLivePill.style.borderColor = state.bleConnected ? '#86efac' : '#fca5a5';
    }
  }

  let renderDebounceTimer = null;
  function scheduleRenderScannedDevices() {
    if (renderDebounceTimer) return;
    renderDebounceTimer = setTimeout(() => {
      renderDebounceTimer = null;
      renderScannedDevices();
    }, 200);
  }

  function renderScannedDevices() {
    if (!devicesGrid) return;

    let filtered = state.scannedDevices;
    if (state.activeDeviceFilter === 'target') {
      filtered = state.scannedDevices.filter(d => d.isTargetMcu);
    }

    if (devicesListCount) {
      devicesListCount.textContent = filtered.length;
    }
    if (scannedCountBadge) {
      scannedCountBadge.textContent = state.scannedDevices.length;
    }

    if (filtered.length === 0) {
      devicesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 28px; text-align: center; color: var(--text-muted); background: var(--bg-surface); border-radius: var(--radius-md); border: 1px dashed var(--border-subtle);">
          <div style="font-size: 1.5rem; margin-bottom: 8px;">📡</div>
          <div style="font-weight: 600; color: var(--text-main); margin-bottom: 4px;">No devices detected yet</div>
          <div style="font-size: 0.85rem;">Tap "Scan Nearby Devices" to scan for any Bluetooth peripheral, smartwatch, or microcontroller.</div>
        </div>
      `;
      return;
    }

    devicesGrid.innerHTML = filtered.map(dev => {
      const isConnected = state.bleConnected && (dev.name === state.connectedDeviceName || dev.address === state.connectedDeviceAddress);
      const rssi = dev.rssi || -60;
      const barsActive = rssi >= -50 ? 4 : rssi >= -65 ? 3 : rssi >= -80 ? 2 : 1;

      return `
        <div class="device-card ${dev.isTargetMcu ? 'is-target' : ''}">
          <div class="device-info-col">
            <div class="device-name-row">
              <span class="device-name" title="${escapeHtml(dev.name)}">${escapeHtml(dev.name)}</span>
              ${dev.isTargetMcu ? '<span class="target-badge-sm">TARGET MCU</span>' : '<span class="generic-badge-sm">BLE DEVICE</span>'}
            </div>
            <div class="device-mac">${escapeHtml(dev.address)}</div>
            <div class="device-rssi-row">
              <div class="rssi-bars">
                <span class="rssi-bar ${barsActive >= 1 ? 'active' : ''}" style="height: 4px;"></span>
                <span class="rssi-bar ${barsActive >= 2 ? 'active' : ''}" style="height: 7px;"></span>
                <span class="rssi-bar ${barsActive >= 3 ? 'active' : ''}" style="height: 10px;"></span>
                <span class="rssi-bar ${barsActive >= 4 ? 'active' : ''}" style="height: 13px;"></span>
              </div>
              <span class="rssi-val">${rssi} dBm</span>
            </div>
          </div>
          <div>
            <button class="device-connect-btn ${isConnected ? 'connected' : ''}"
                    data-address="${escapeHtml(dev.address)}"
                    data-name="${escapeHtml(dev.name)}">
              ${isConnected ? '✓ Connected' : 'Connect'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    devicesGrid.querySelectorAll('.device-connect-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const addr = btn.getAttribute('data-address');
        const name = btn.getAttribute('data-name');
        connectDevice(addr, name);
      });
    });
  }

  function startScanning() {
    state.isScanning = true;
    if (startScanBtn) {
      startScanBtn.classList.add('scanning');
      if (scanBtnText) scanBtnText.textContent = 'Scanning...';
    }

    logBlePacket('[BLE SCAN] Started Bluetooth LE nearby discovery...', 'sys');

    if (window.AndroidBridge && typeof window.AndroidBridge.startBleScan === 'function') {
      window.AndroidBridge.startBleScan();
    } else {
      setTimeout(() => {
        if (!state.scannedDevices.some(d => d.address === '00:04:9F:8A:2B:10')) {
          state.scannedDevices.unshift({
            name: 'FRDM-MCXW71-VOX',
            address: '00:04:9F:8A:2B:10',
            rssi: -42,
            isTargetMcu: true,
            serviceUuid: '0xFFF0'
          });
        }
        renderScannedDevices();
      }, 700);
    }
  }

  function stopScanning() {
    state.isScanning = false;
    if (startScanBtn) {
      startScanBtn.classList.remove('scanning');
      if (scanBtnText) scanBtnText.textContent = '🔍 Scan Nearby Devices';
    }

    if (window.AndroidBridge && typeof window.AndroidBridge.stopBleScan === 'function') {
      window.AndroidBridge.stopBleScan();
    }
    logBlePacket('[BLE SCAN] Scan stopped.', 'sys');
  }

  function connectDevice(address, name) {
    logBlePacket(`[BLE] Connecting to ${name} (${address})...`, 'tx');

    if (window.AndroidBridge && typeof window.AndroidBridge.connectToDevice === 'function') {
      window.AndroidBridge.connectToDevice(address);
    } else {
      setTimeout(() => {
        updateBleStatus(`Connected (${name})`, true, name, -42);
        playSuccessChime();
        speakAloud(`Connected to ${name}. AUX microphone and speaker are ready.`);
        logBlePacket(`[BLE] Connected and bonded with ${name}! MTU: 512 bytes.`, 'success');
      }, 500);
    }
  }

  function disconnectBle() {
    if (window.AndroidBridge && typeof window.AndroidBridge.disconnectBle === 'function') {
      window.AndroidBridge.disconnectBle();
    } else {
      updateBleStatus('Disconnected', false, '', 0);
      speakAloud('Microcontroller disconnected.');
      logBlePacket('[BLE] Disconnected from peripheral.', 'err');
    }
  }

  if (startScanBtn) startScanBtn.addEventListener('click', startScanning);
  if (stopScanBtn) stopScanBtn.addEventListener('click', stopScanning);
  if (disconnectBleBtn) disconnectBleBtn.addEventListener('click', disconnectBle);

  if (pingSpeakerBtn) {
    pingSpeakerBtn.addEventListener('click', () => {
      playNotificationChime();
      speakAloud('Speaker test successful. NXP board audio is ready.');
      logBlePacket('[SPEAKER TEST] Ping sent to board speaker on PTB1 (Opcode 0x10)', 'tx');
    });
  }

  if (reconnectMcuBtn) {
    reconnectMcuBtn.addEventListener('click', () => {
      connectDevice('00:04:9F:8A:2B:10', 'FRDM-MCXW71-VOX');
    });
  }

  if (voiceFeedbackToggle) {
    voiceFeedbackToggle.addEventListener('change', (e) => {
      state.ttsEnabled = e.target.checked;
      speakAloud(state.ttsEnabled ? 'Spoken feedback enabled.' : 'Spoken feedback muted.');
    });
  }

  if (speechRateSelect) {
    speechRateSelect.addEventListener('change', (e) => {
      state.speechRate = parseFloat(e.target.value) || 1.0;
      speakAloud(`Speech rate set to ${state.speechRate} speed.`);
    });
  }

  if (testSpkChimeSettingsBtn) {
    testSpkChimeSettingsBtn.addEventListener('click', () => {
      playNotificationChime();
    });
  }

  if (openA11ySettingsBtn) {
    openA11ySettingsBtn.addEventListener('click', () => {
      if (window.AndroidBridge && typeof window.AndroidBridge.openAccessibilitySettings === 'function') {
        window.AndroidBridge.openAccessibilitySettings();
      } else {
        alert('To enable Hands-Free Auto-Send on Android:\n\n1. Open Settings > Accessibility.\n2. Tap "Installed Apps" or "VoxAssist".\n3. Turn VoxAssist ON.');
      }
    });
  }

  if (openNotifSettingsBtn) {
    openNotifSettingsBtn.addEventListener('click', () => {
      if (window.AndroidBridge && typeof window.AndroidBridge.openNotificationListenerSettings === 'function') {
        window.AndroidBridge.openNotificationListenerSettings();
      } else {
        alert('To enable WhatsApp notification reading on Android:\n\n1. Open Settings > Apps > Special App Access > Device & app notifications.\n2. Enable "VoxAssist".');
      }
    });
  }

  if (filterAllDevices) {
    filterAllDevices.addEventListener('click', () => {
      state.activeDeviceFilter = 'all';
      filterAllDevices.classList.add('active');
      if (filterTargetMcu) filterTargetMcu.classList.remove('active');
      renderScannedDevices();
    });
  }

  if (filterTargetMcu) {
    filterTargetMcu.addEventListener('click', () => {
      state.activeDeviceFilter = 'target';
      filterTargetMcu.classList.add('active');
      if (filterAllDevices) filterAllDevices.classList.remove('active');
      renderScannedDevices();
    });
  }

  if (webBlePairBtn) {
    webBlePairBtn.addEventListener('click', async () => {
      if (!navigator.bluetooth) {
        alert('Web Bluetooth API is not supported in this browser. Please use Chrome on Android/Desktop or open in our Android APK.');
        return;
      }
      try {
        logBlePacket('[WEB BLE] Opening Bluetooth device pairing dialog...');
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [0xFFF0, '0000fff0-0000-1000-8000-00805f9b34fb']
        });
        logBlePacket(`[WEB BLE] User selected: ${device.name || 'Unknown'} (${device.id})`);
        connectDevice(device.id, device.name || 'FRDM-MCXW71');
      } catch (err) {
        logBlePacket(`[WEB BLE] Pairing cancelled: ${err.message}`, 'err');
      }
    });
  }

  window.updateScannedDevices = function(data) {
    try {
      let list = data;
      if (typeof data === 'string') {
        list = JSON.parse(data);
      }
      if (Array.isArray(list)) {
        state.scannedDevices = list;
        scheduleRenderScannedDevices();
      }
    } catch (e) {
      console.error('Failed to parse scanned devices:', e);
    }
  };

  window.updateBleStatus = function(statusText, connected, deviceName, rssi) {
    state.bleConnected = connected;
    state.connectedDeviceName = deviceName || 'FRDM-MCXW71-VOX';
    state.currentRssi = rssi || -42;

    if (bleStatusPill) {
      bleStatusPill.className = connected ? 'status-pill connected' : 'status-pill';
      if (bleStatusPillLabel) {
        bleStatusPillLabel.textContent = connected
          ? `BLE: Connected (${state.connectedDeviceName})`
          : `BLE: ${statusText || 'Scanning...'}`;
      }
    }

    if (bleStateLabel) {
      bleStateLabel.textContent = connected ? state.connectedDeviceName : 'Scanning...';
      bleStateLabel.className = connected ? 'buf-metric-val highlight' : 'buf-metric-val';
    }

    if (quickBleStateLabel) {
      quickBleStateLabel.textContent = connected ? `Connected (${state.currentRssi} dBm)` : 'Disconnected';
      quickBleStateLabel.className = connected ? 'spec-value highlight' : 'spec-value';
    }

    if (bleRssiLabel) {
      bleRssiLabel.textContent = rssi ? `${rssi} dBm` : (connected ? '-42 dBm' : '-- dBm');
    }

    updateConnectedDeviceUI();
    renderScannedDevices();
  };

  // =========================================================================
  // WhatsApp Incoming Replies & Speaker Subsystem
  // =========================================================================
  function renderReplies() {
    if (!repliesList) return;

    if (state.repliesHistory.length === 0) {
      repliesList.innerHTML = '<p class="empty-state">No incoming WhatsApp replies yet. Click "+ Test Reply from Mom" above to test the speaker announcement!</p>';
      if (feedCountBadge) feedCountBadge.textContent = '0 replies';
      return;
    }

    if (feedCountBadge) {
      feedCountBadge.textContent = `${state.repliesHistory.length} replies`;
    }

    repliesList.innerHTML = state.repliesHistory.map(rep => `
      <div class="reply-card">
        <div class="reply-card-header">
          <span class="reply-sender">From: ${escapeHtml(rep.sender)}</span>
          <span class="reply-time">${escapeHtml(rep.time || 'Recently')}</span>
        </div>
        <div class="reply-text">"${escapeHtml(rep.message)}"</div>
        <div class="reply-footer">
          <span class="announced-tag">📢 Announced via Speaker</span>
          <button class="reply-read-btn" data-text="Message from ${escapeHtml(rep.sender)}: ${escapeHtml(rep.message)}">
            🔊 Read Out
          </button>
        </div>
      </div>
    `).join('');

    repliesList.querySelectorAll('.reply-read-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-text');
        speakAloud(text);
        if (readoutContent) readoutContent.textContent = `"${text}"`;
      });
    });
  }

  function readOutLastReply() {
    if (state.repliesHistory.length === 0) {
      const msg = 'You have no new WhatsApp replies.';
      speakAloud(msg);
      if (readoutContent) readoutContent.textContent = `"${msg}"`;
      return;
    }

    const latest = state.repliesHistory[0];
    const text = `Message from ${latest.sender}: ${latest.message}`;
    speakAloud(text);
    if (readoutContent) readoutContent.textContent = `"${text}"`;

    logBlePacket(`[SPEAKER] Streamed WhatsApp reply to FRDM-MCXW71 speaker (Opcode 0x20)`, 'success');

    if (window.AndroidBridge && typeof window.AndroidBridge.readLastWhatsAppReply === 'function') {
      window.AndroidBridge.readLastWhatsAppReply();
    }
  }

  queryTestChips.forEach(chip => {
    chip.addEventListener('click', () => {
      readOutLastReply();
    });
  });

  if (testSpkChimeBtn) {
    testSpkChimeBtn.addEventListener('click', () => {
      playNotificationChime();
      logBlePacket('[SPEAKER] Sent notification chime test (Opcode 0x10) to board speaker', 'tx');
    });
  }

  if (testSpkReadoutBtn) {
    testSpkReadoutBtn.addEventListener('click', () => {
      readOutLastReply();
    });
  }

  if (simulateReplyMomBtn) {
    simulateReplyMomBtn.addEventListener('click', () => {
      const sampleReplies = [
        'I am outside the clinic, please pick me up',
        'I am waiting by the gate in the silver car',
        'Can we meet in 15 minutes at the lobby?'
      ];
      const randomText = sampleReplies[Math.floor(Math.random() * sampleReplies.length)];
      handleIncomingReply('Mom', randomText);
    });
  }

  function handleIncomingReply(sender, message, timestamp) {
    const timeStr = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    state.repliesHistory.unshift({
      id: Date.now(),
      sender,
      message,
      time: timeStr,
      timestamp: timestamp || Date.now(),
      announced: true
    });

    renderReplies();

    playNotificationChime();
    setTimeout(() => {
      speakAloud(`New message from ${sender}.`);
    }, 300);

    if (replyNotifDot) replyNotifDot.hidden = false;

    logBlePacket(`[WHATSAPP RECEPTION] New reply from "${sender}": "${message}"`, 'success');
  }

  window.onIncomingWhatsAppReply = function(sender, message, timestamp) {
    handleIncomingReply(sender, message, timestamp);
  };

  window.onReadoutTriggered = function(text) {
    if (readoutContent) {
      readoutContent.textContent = `"${text}"`;
    }
  };

  window.setNotificationListenerStatus = function(enabled) {
    if (notifListenerBanner) {
      if (enabled) {
        notifListenerBanner.style.borderColor = '#86efac';
        notifListenerBanner.style.background = '#ecfdf5';
        if (notifStatusDesc) {
          notifStatusDesc.textContent = 'Active: incoming WhatsApp replies are automatically intercepted and announced!';
        }
        if (enableNotifBtn) enableNotifBtn.style.display = 'none';
      } else {
        if (enableNotifBtn) enableNotifBtn.style.display = 'inline-block';
      }
    }
  };

  if (enableNotifBtn) {
    enableNotifBtn.addEventListener('click', () => {
      if (window.AndroidBridge && typeof window.AndroidBridge.openNotificationListenerSettings === 'function') {
        window.AndroidBridge.openNotificationListenerSettings();
      } else {
        alert('To enable WhatsApp notification reading on Android:\n\n1. Open Settings > Apps > Special App Access > Device & app notifications.\n2. Tap "VoxAssist".\n3. Allow notification access.');
      }
    });
  }

  // =========================================================================
  // Live Audio Waveform Animation (Canvas)
  // =========================================================================
  let wavePhase = 0;
  function drawWaveform() {
    if (!waveformCanvas || !canvasCtx) return;

    canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const centerY = height / 2;

    canvasCtx.lineWidth = 2.5;

    if (state.isRecording) {
      wavePhase += 0.18;
      canvasCtx.strokeStyle = '#059669';
      canvasCtx.shadowBlur = 10;
      canvasCtx.shadowColor = '#059669';

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
      if (micLevelLabel) {
        micLevelLabel.textContent = `${randomDb} dB (AUX In active)`;
        micLevelLabel.style.color = '#059669';
      }
    } else {
      canvasCtx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      canvasCtx.shadowBlur = 0;
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, centerY);
      for (let x = 0; x < width; x += 4) {
        const ambient = Math.sin(x * 0.03 + Date.now() * 0.002) * 1.5;
        canvasCtx.lineTo(x, centerY + ambient);
      }
      canvasCtx.stroke();
      if (micLevelLabel) {
        micLevelLabel.textContent = 'Muted / Idle';
        micLevelLabel.style.color = '#64748b';
      }
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
      if (transcriptDisplay) transcriptDisplay.classList.add('live');
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
        if (transcriptDisplay) transcriptDisplay.textContent = `"${text}"`;
        logBlePacket(`[AUX->BLE] ${generateHexPreview(text)} (${text.length * 2}B)`);
      }
    };

    state.recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
    };

    state.recognition.onend = () => {
      if (transcriptDisplay) transcriptDisplay.classList.remove('live');
      if (state.isRecording) {
        stopRecording();
      }
    };
  }

  // Push-To-Talk Controls
  function startRecording() {
    if (state.isRecording) return;
    state.isRecording = true;
    getAudioContext();
    playStartChime();

    if (pttButton) pttButton.classList.add('recording');
    if (pttLabel) pttLabel.textContent = 'LISTENING...';
    if (pttSubLabel) pttSubLabel.textContent = 'Release to dispatch via WhatsApp';
    if (transcriptDisplay) {
      transcriptDisplay.textContent = 'Listening to speech from AUX In / Mic...';
    }

    logBlePacket('[AUX PTT] Button pressed -> START frame (0x01)', 'tx');

    if (state.recognition) {
      try {
        state.recognition.start();
      } catch (e) {
        console.warn('Speech rec already active');
      }
    }
  }

  function stopRecording() {
    if (!state.isRecording) return;
    state.isRecording = false;

    if (pttButton) pttButton.classList.remove('recording');
    if (pttLabel) pttLabel.textContent = 'HOLD TO SPEAK';
    if (pttSubLabel) pttSubLabel.textContent = 'or press AUX switch on FRDM board';

    logBlePacket('[AUX PTT] Button released -> END frame (0x03)', 'tx');

    if (state.recognition) {
      try {
        state.recognition.stop();
      } catch (e) {}
    }

    setTimeout(() => {
      if (state.currentTranscript.trim()) {
        processVoiceCommand(state.currentTranscript.trim());
      } else {
        speakAloud('No speech detected. Please hold the button and speak clearly.');
      }
    }, 300);
  }

  if (pttButton) {
    pttButton.addEventListener('mousedown', startRecording);
    pttButton.addEventListener('mouseup', stopRecording);
    pttButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startRecording();
    });
    pttButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopRecording();
    });
  }

  // Spacebar Hotkey
  let spacePressed = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !spacePressed && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      spacePressed = true;
      e.preventDefault();
      startRecording();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && spacePressed) {
      spacePressed = false;
      e.preventDefault();
      stopRecording();
    }
  });

  // =========================================================================
  // Contact Search & Fuzzy Matcher Engine
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
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + cost
        );
        if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
        }
      }
    }
    return d[len1][len2];
  }

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

    let out = '';
    let last = ' ';
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c !== last) {
        out += c;
        last = c;
      }
    }
    return out;
  }

  function computeContactSimilarity(spoken, contactName) {
    const spClean = String(spoken || '').toLowerCase().trim();
    const cClean = String(contactName || '').toLowerCase().trim();

    if (!spClean || !cClean) return 0;
    if (spClean === cClean) return 1.0;

    for (const [key, aliases] of Object.entries(aliasMap)) {
      const contactIsAlias = cClean === key || aliases.includes(cClean);
      const spokenIsAlias = spClean === key || aliases.includes(spClean);
      if (contactIsAlias && spokenIsAlias) return 0.98;
    }

    if (cClean.includes(' ')) {
      const tokens = cClean.split(/\s+/);
      for (const t of tokens) {
        if (spClean === t) return 0.92;
      }
    }

    const dist = getDamerauLevenshtein(spClean, cClean);
    const maxLen = Math.max(spClean.length, cClean.length);
    if (maxLen === 0) return 0;

    const stringSim = 1.0 - (dist / maxLen);
    const phonSp = phoneticSimplify(spClean);
    const phonC = phoneticSimplify(cClean);
    let phonSim = 0;
    if (phonSp && phonC) {
      const pDist = getDamerauLevenshtein(phonSp, phonC);
      phonSim = 1.0 - (pDist / Math.max(phonSp.length, phonC.length));
    }

    const combined = (stringSim * 0.45) + (phonSim * 0.55);
    return Math.max(0, Math.min(1, combined));
  }

  function findClosestContact(query, contactsList) {
    if (!contactsList || contactsList.length === 0 || !query) return null;
    let best = null;
    let bestScore = 0;

    for (const c of contactsList) {
      const score = computeContactSimilarity(query, c.name);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return (best && bestScore >= 0.55) ? { contact: best, score: bestScore } : null;
  }

  function resolveVoiceCommandToClosestMatch(spokenText, contactsList) {
    const clean = String(spokenText || '').trim();
    const prefixRegex = /^(?:send(?: a)? message to|send message|send sms to|message to|whatsapp to|whatsapp|tell|msg to)\s+/i;
    const stripped = clean.replace(prefixRegex, '').trim();

    const candidates = [];

    const delimMatch = stripped.match(/^(.*?)(?:\s*[-:]\s*|\s+that\s+|\s+saying\s+|\s+to say\s+)(.*)$/i);
    if (delimMatch) {
      const query = delimMatch[1].trim();
      const rawBody = delimMatch[2].trim();
      const res = findClosestContact(query, contactsList);
      if (res) {
        const cleanBody = rawBody.replace(/^[-:]\s*/i, '').replace(/^(?:that|saying|to say)\s+/i, '').replace(/^["']|["']$/g, '').trim();
        const isExact = query.toLowerCase() === res.contact.name.toLowerCase();
        candidates.push({
          contact: res.contact,
          score: res.score + 0.05,
          matchedCandidate: query,
          remainderMessage: cleanBody,
          isExact
        });
      }
    }

    const words = stripped.split(/\s+/).filter(Boolean);
    const maxWords = Math.min(3, words.length);
    for (let count = 1; count <= maxWords; count++) {
      const query = words.slice(0, count).join(' ');
      const remainder = words.slice(count).join(' ');
      const res = findClosestContact(query, contactsList);
      if (res) {
        const cleanBody = remainder.replace(/^[-:]\s*/i, '').replace(/^(?:that|saying|to say)\s+/i, '').replace(/^["']|["']$/g, '').trim();
        const isExact = query.toLowerCase() === res.contact.name.toLowerCase();
        const bonus = (count > 1 && res.contact.name.includes(' ')) ? 0.08 : 0.0;
        candidates.push({
          contact: res.contact,
          score: res.score + bonus,
          matchedCandidate: query,
          remainderMessage: cleanBody,
          isExact
        });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  // =========================================================================
  // Process Voice Commands & NLP Dispatcher
  // =========================================================================
  function processVoiceCommand(commandText) {
    const cleanText = String(commandText || '').trim();
    if (!cleanText) return;

    const lower = cleanText.toLowerCase();

    if (lower.includes('read out') || lower.includes('what is the reply') || lower.includes('read reply') || lower.includes('what did') || lower.includes('read message')) {
      readOutLastReply();
      return;
    }

    const match = resolveVoiceCommandToClosestMatch(cleanText, state.contacts);

    if (intentTime) {
      intentTime.textContent = new Date().toLocaleTimeString();
    }

    if (match) {
      const resolvedContact = match.contact;
      let messageBody = match.remainderMessage || 'Hello, this is an automated voice message from VoxAssist.';

      if (intentStatusBadge) {
        intentStatusBadge.textContent = 'READY TO DISPATCH';
        intentStatusBadge.className = 'intent-status-badge success';
      }
      if (intentContact) intentContact.textContent = resolvedContact.name;
      if (intentPhone) intentPhone.textContent = resolvedContact.phone;
      if (intentMessage) intentMessage.textContent = `"${messageBody}"`;

      playSuccessChime();

      if (match.isExact) {
        speakAloud(`Sending WhatsApp message to ${resolvedContact.name} automatically.`);
      } else {
        speakAloud(`Matched closest contact ${resolvedContact.name} for ${match.matchedCandidate}. Sending WhatsApp message automatically.`);
      }

      addMessageToOutbox(resolvedContact, messageBody);
      logBlePacket(`[DISPATCH] Target Contact: ${resolvedContact.name} (${resolvedContact.phone})`, 'success');

      if (window.AndroidBridge && typeof window.AndroidBridge.sendWhatsApp === 'function') {
        window.AndroidBridge.sendWhatsApp(resolvedContact.phone, messageBody, resolvedContact.name);
      } else {
        let cleanPhone = String(resolvedContact.phone || '').replace(/[^0-9+]/g, '');
        if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
        window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageBody)}`, '_blank');
      }
    } else {
      if (intentStatusBadge) {
        intentStatusBadge.textContent = 'CONTACT NOT FOUND';
        intentStatusBadge.className = 'intent-status-badge failed';
      }
      playErrorChime();
      speakAloud('Could not recognize who to send the message to. Please say: Send message to Contact Name, followed by your message.');
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
    if (!outboxList) return;

    if (state.outbox.length === 0) {
      outboxList.innerHTML = '<p class="empty-state">No WhatsApp messages dispatched yet. Trigger a voice command on the left.</p>';
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
          <span>WhatsApp Auto-Send: Active ✓</span>
          <button class="speak-sms-btn" data-text="WhatsApp message to ${escapeHtml(msg.recipientName)}: ${escapeHtml(msg.text)}">
            🔊 Speak Aloud
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

  if (clearOutboxBtn) {
    clearOutboxBtn.addEventListener('click', () => {
      state.outbox = [];
      renderOutbox();
    });
  }

  // =========================================================================
  // Contact Directory Rendering & Filtering
  // =========================================================================
  function renderContacts() {
    if (!contactsList) return;

    const query = contactSearchInput ? contactSearchInput.value.trim().toLowerCase() : '';
    let filtered = state.contacts;

    if (state.activeFilterCategory && state.activeFilterCategory !== 'all') {
      const cat = state.activeFilterCategory.toLowerCase();
      filtered = filtered.filter(c => (c.relation || '').toLowerCase().includes(cat));
    }

    if (query) {
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.phone.includes(query) ||
        (c.relation && c.relation.toLowerCase().includes(query))
      );
    }

    if (contactsCountBadge) {
      contactsCountBadge.textContent = `${filtered.length} contacts`;
    }

    if (filtered.length === 0) {
      contactsList.innerHTML = '<p class="empty-state">No contacts found matching search.</p>';
      return;
    }

    contactsList.innerHTML = filtered.map(c => `
      <div class="contact-card" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone)}">
        <div class="contact-avatar">${escapeHtml(c.name.charAt(0).toUpperCase())}</div>
        <div class="contact-details">
          <div class="contact-name">${escapeHtml(c.name)}</div>
          <div class="contact-phone">${escapeHtml(c.phone)}</div>
          ${c.relation ? `<span class="contact-rel-badge">${escapeHtml(c.relation)}</span>` : ''}
        </div>
        <button class="quick-send-btn" title="Quick voice message to ${escapeHtml(c.name)}">
          💬 Send
        </button>
      </div>
    `).join('');

    contactsList.querySelectorAll('.contact-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.getAttribute('data-name');
        processVoiceCommand(`Send message to ${name} - I am on my way.`);
      });
    });
  }

  if (contactSearchInput) {
    contactSearchInput.addEventListener('input', () => {
      if (clearSearchBtn) clearSearchBtn.hidden = !contactSearchInput.value;
      renderContacts();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      contactSearchInput.value = '';
      clearSearchBtn.hidden = true;
      renderContacts();
    });
  }

  if (contactFilterChips) {
    contactFilterChips.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        contactFilterChips.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeFilterCategory = chip.getAttribute('data-filter') || 'all';
        renderContacts();
      });
    });
  }

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
        a11yBanner.style.borderColor = '#86efac';
        a11yBanner.style.background = '#f0fdf4';
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
        alert('To enable Hands-Free Auto-Send on your phone:\n\n1. Open Settings > Accessibility.\n2. Tap "Installed Apps" or "VoxAssist".\n3. Turn VoxAssist ON.');
      }
    });
  }

  // Modal Handlers
  if (openAddContactBtn) {
    openAddContactBtn.addEventListener('click', () => {
      if (contactModalBackdrop) contactModalBackdrop.hidden = false;
      document.getElementById('newContactName')?.focus();
    });
  }

  function closeContactModal() {
    if (contactModalBackdrop) contactModalBackdrop.hidden = true;
    if (addContactForm) addContactForm.reset();
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', closeContactModal);
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeContactModal);

  if (addContactForm) {
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
  }

  // Presets
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const command = btn.getAttribute('data-command');
      playStartChime();
      if (transcriptDisplay) transcriptDisplay.textContent = `"${command}"`;
      state.currentTranscript = command;
      logBlePacket(`[PRESET] Injected voice sample: "${command}"`);
      setTimeout(() => {
        processVoiceCommand(command);
      }, 350);
    });
  });

  // Microcontroller Buffer Telemetry
  window.updateBufferTelemetry = function(stateName, packetCount, byteCount, preview) {
    if (bufPacketCount) bufPacketCount.textContent = `${packetCount} pkts`;
    if (bufByteCount) bufByteCount.textContent = `${(byteCount / 1024).toFixed(1)} KB`;

    if (bufferProgressBar) {
      const pct = Math.min(100, Math.floor((byteCount / 4096) * 100));
      bufferProgressBar.style.width = `${pct}%`;
    }

    if (bufferPreviewBox) {
      bufferPreviewBox.textContent = preview || (byteCount > 0 ? `Accumulated Audio PCM (${byteCount} bytes)...` : 'Buffer is empty. Waiting for AUX PTT trigger...');
    }

    if (bufferStatusBadge) {
      const s = (stateName || '').toUpperCase();
      bufferStatusBadge.className = 'buffer-status-badge';
      if (s.includes('RECORD')) {
        bufferStatusBadge.classList.add('recording');
        bufferStatusBadge.textContent = '● RECORDING (AUX)';
        logBlePacket('[MCU BUFFER] AUX PTT Asserted -> Streaming PCM chunks...', 'tx');
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

  if (simulateBlePttBtn) {
    simulateBlePttBtn.addEventListener('click', () => {
      logBlePacket('[TEST] Simulating MCU AUX Voice Input Stream...');
      playStartChime();
      updateBufferTelemetry('RECORDING', 0, 0, 'AUX PTT Pressed on FRDM-MCXW71');

      let pkts = 0;
      const interval = setInterval(() => {
        pkts++;
        updateBufferTelemetry('BUFFERING', pkts, pkts * 240, `Send message to Mom - I am outside clinic`);
        if (pkts >= 5) {
          clearInterval(interval);
          updateBufferTelemetry('PROCESSING', pkts, pkts * 240, 'Flushing buffer...');
          setTimeout(() => {
            processVoiceCommand('Send message to Mom - I am outside the clinic, please pick me up');
          }, 400);
        }
      }, 150);
    });
  }

  if (flushBufferBtn) {
    flushBufferBtn.addEventListener('click', () => {
      processVoiceCommand('Send message to Mom - I am on my way.');
    });
  }

  if (clearBufferBtn) {
    clearBufferBtn.addEventListener('click', () => {
      updateBufferTelemetry('IDLE', 0, 0, 'Buffer cleared');
    });
  }

  function logBlePacket(msg, type = 'tx') {
    state.txPacketCount++;
    if (txPktCount) txPktCount.textContent = `TX: ${state.txPacketCount} pkts`;

    if (!blePacketLog) return;
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

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // Initial UI Render
  renderContacts();
  renderOutbox();
  renderReplies();
  renderScannedDevices();
  updateConnectedDeviceUI();

  // PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('ServiceWorker registered:', reg.scope))
        .catch(err => console.log('ServiceWorker skipped:', err));
    });
  }
});
