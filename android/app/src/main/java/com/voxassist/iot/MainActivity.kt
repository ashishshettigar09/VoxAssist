package com.voxassist.iot

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.ParcelUuid
import android.provider.ContactsContract
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.*

/**
 * VoxAssist Android Companion App
 * - Establishes BLE connection with NXP FRDM-RW612 microcontroller
 * - Streams and buffers voice/audio data from INMP441 until PTT release
 * - Processes buffered voice command and automatically dispatches to WhatsApp contact
 * - Automatically clicks "Send" via WhatsAppAccessibilityService (Zero Clicks)
 */
class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {

    private val TAG = "VoxAssist"
    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var webView: WebView? = null
    private var isScanning = false

    // Target GATT UUIDs for FRDM-RW612 EdgeFast BLE Service
    private val SERVICE_UUID = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB")
    private val CHAR_AUDIO_CMD_UUID = UUID.fromString("0000FFF1-0000-1000-8000-00805F9B34FB")
    private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    // =========================================================================
    // Microcontroller Audio & Command Buffer
    // =========================================================================
    private val dataBuffer = ByteArrayOutputStream()
    private var isBuffering = false
    private var packetsReceivedCount = 0

    // Framing opcodes
    private val OPCODE_START: Byte = 0x01 // Microcontroller PTT Button Pressed
    private val OPCODE_DATA: Byte  = 0x02 // Streaming Data Chunk (Audio/PCM/Text)
    private val OPCODE_END: Byte   = 0x03 // Microcontroller PTT Button Released (Flush)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tts = TextToSpeech(this, this)

        initWebView()
        checkAndRequestPermissions()
        initSpeechRecognizer()
        initBluetooth()
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun initWebView() {
        webView = findViewById(R.id.webView)
        webView?.apply {
            isFocusable = true
            isFocusableInTouchMode = true
            requestFocus()
            setOnTouchListener { v, event ->
                when (event.action) {
                    android.view.MotionEvent.ACTION_DOWN, android.view.MotionEvent.ACTION_UP -> {
                        if (!v.hasFocus()) {
                            v.requestFocus()
                        }
                    }
                }
                false
            }
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    syncContactsToWebView()
                    notifyAccessibilityStatus()
                    notifyBleStatus("Scanning for FRDM-RW612...", false, "", 0)
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) {
                    request?.grant(request.resources)
                }
            }
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                databaseEnabled = true
            }
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            loadUrl("file:///android_asset/index.html")
        }
    }

    override fun onResume() {
        super.onResume()
        notifyAccessibilityStatus()
    }

    private fun notifyAccessibilityStatus() {
        val enabled = isAccessibilityServiceEnabled()
        runOnUiThread {
            webView?.evaluateJavascript("if (window.setAccessibilityStatus) { window.setAccessibilityStatus($enabled); }", null)
        }
    }

    private fun notifyBleStatus(status: String, connected: Boolean, deviceName: String, rssi: Int) {
        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.updateBleStatus) { window.updateBleStatus('$status', $connected, '$deviceName', $rssi); }",
                null
            )
        }
    }

    private fun notifyBufferTelemetry(state: String, packetCount: Int, byteCount: Int, preview: String) {
        runOnUiThread {
            val safePreview = preview.replace("'", "\\'").replace("\n", " ")
            webView?.evaluateJavascript(
                "if (window.updateBufferTelemetry) { window.updateBufferTelemetry('$state', $packetCount, $byteCount, '$safePreview'); }",
                null
            )
        }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        if (WhatsAppAccessibilityService.isServiceRunning) return true
        return try {
            val enabledServices = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
            enabledServices.contains(packageName)
        } catch (e: Exception) {
            false
        }
    }

    fun syncContactsToWebView() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            val json = getDeviceContactsJson()
            val base64 = android.util.Base64.encodeToString(json.toByteArray(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP)
            runOnUiThread {
                webView?.evaluateJavascript(
                    "if (window.loadDeviceContacts) { try { window.loadDeviceContacts(decodeURIComponent(escape(atob('$base64')))); } catch(e) { console.error('Sync err:', e); } }",
                    null
                )
            }
        }
    }

    private fun inferRelationCategory(name: String): String {
        val lower = name.lowercase().trim()
        return when {
            lower.contains("mom") || lower.contains("mother") || lower.contains("mummy") || lower.contains("mum") ||
            lower.contains("amma") || lower.contains("maa") || lower.contains("dad") || lower.contains("father") ||
            lower.contains("papa") || lower.contains("appa") || lower.contains("sister") || lower.contains("sis") ||
            lower.contains("didi") || lower.contains("brother") || lower.contains("bro") || lower.contains("bhai") ||
            lower.contains("bhaiya") || lower.contains("wife") || lower.contains("husband") || lower.contains("son") ||
            lower.contains("daughter") || lower.contains("grandma") || lower.contains("grandpa") || lower.contains("nani") ||
            lower.contains("dadi") || lower.contains("uncle") || lower.contains("aunt") || lower.contains("chacha") ||
            lower.contains("mama") -> "Family"

            lower.contains("doctor") || lower.contains("dr.") || lower.contains("dr ") || lower.contains("clinic") ||
            lower.contains("hospital") || lower.contains("physician") || lower.contains("dentist") || lower.contains("doc") -> "Medical"

            lower.contains("caregiver") || lower.contains("nurse") || lower.contains("assistant") ||
            lower.contains("helper") || lower.contains("attendant") || lower.contains("carer") -> "Caregiver"

            else -> "Phone Contact"
        }
    }

    fun getDeviceContactsJson(): String {
        val list = JSONArray()
        try {
            val cursor = contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                ),
                null, null,
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
            )
            cursor?.use {
                val nameIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                val seen = HashSet<String>()
                while (it.moveToNext()) {
                    val name = it.getString(nameIdx)?.trim() ?: continue
                    val rawNum = it.getString(numIdx) ?: continue
                    val cleanNum = rawNum.replace("[^0-9+]".toRegex(), "")
                    if (name.isNotEmpty() && cleanNum.isNotEmpty() && !seen.contains(name.lowercase())) {
                        seen.add(name.lowercase())
                        val obj = JSONObject()
                        obj.put("id", list.length() + 1)
                        obj.put("name", name)
                        obj.put("phone", cleanNum)
                        obj.put("relation", inferRelationCategory(name))
                        list.put(obj)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching contacts", e)
        }
        return list.toString()
    }

    // =========================================================================
    // JavaScript Bridge
    // =========================================================================
    inner class AndroidBridge {
        @JavascriptInterface
        fun sendWhatsApp(phoneNumber: String, message: String, contactName: String) {
            runOnUiThread {
                sendWhatsAppMessage(phoneNumber, message, contactName)
            }
        }

        @JavascriptInterface
        fun getDeviceContactsJson(): String {
            return this@MainActivity.getDeviceContactsJson()
        }

        @JavascriptInterface
        fun isAccessibilityEnabled(): Boolean {
            return isAccessibilityServiceEnabled()
        }

        @JavascriptInterface
        fun openAccessibilitySettings() {
            runOnUiThread {
                try {
                    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(intent)
                    speak("Please turn on VoxAssist in accessibility settings.")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to open accessibility settings", e)
                }
            }
        }

        @JavascriptInterface
        fun startBleScan() {
            runOnUiThread {
                this@MainActivity.startBleScan()
            }
        }

        @JavascriptInterface
        fun disconnectBle() {
            runOnUiThread {
                this@MainActivity.disconnectGatt()
            }
        }

        @JavascriptInterface
        fun speak(text: String) {
            runOnUiThread {
                this@MainActivity.speak(text)
            }
        }

        @JavascriptInterface
        fun simulateBlePacket(opcode: Int, payloadText: String) {
            runOnUiThread {
                val bytes = when (opcode) {
                    1 -> byteArrayOf(OPCODE_START)
                    2 -> {
                        val payload = payloadText.toByteArray(StandardCharsets.UTF_8)
                        val full = ByteArray(payload.size + 1)
                        full[0] = OPCODE_DATA
                        System.arraycopy(payload, 0, full, 1, payload.size)
                        full
                    }
                    3 -> byteArrayOf(OPCODE_END)
                    else -> payloadText.toByteArray(StandardCharsets.UTF_8)
                }
                handleIncomingBlePacket(bytes)
            }
        }

        @JavascriptInterface
        fun clearBleBuffer() {
            runOnUiThread {
                dataBuffer.reset()
                isBuffering = false
                packetsReceivedCount = 0
                notifyBufferTelemetry("IDLE", 0, 0, "Buffer cleared")
            }
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.US
            speak("VoxAssist is ready. Connecting to microcontroller.")
        }
    }

    private fun speak(text: String) {
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vox_feedback")
    }

    private fun checkAndRequestPermissions() {
        val permissions = arrayOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.ACCESS_FINE_LOCATION
        )

        val ungranted = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (ungranted.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, ungranted.toTypedArray(), 101)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 101) {
            syncContactsToWebView()
            startBleScan()
        }
    }

    // =========================================================================
    // WhatsApp Dispatcher (Auto-Clicks "Send" without screen taps)
    // =========================================================================
    private fun sendWhatsAppMessage(phoneNumber: String, message: String, contactName: String) {
        try {
            var cleanNumber = phoneNumber.replace("[^0-9+]".toRegex(), "")
            if (cleanNumber.startsWith("+")) {
                cleanNumber = cleanNumber.substring(1)
            } else if (cleanNumber.length == 10) {
                cleanNumber = "91$cleanNumber"
            }

            if (isAccessibilityServiceEnabled()) {
                WhatsAppAccessibilityService.autoSendPending = true
                speak("Sending WhatsApp message to $contactName automatically.")
            } else {
                speak("Opening WhatsApp for $contactName.")
                Toast.makeText(this, "Enable Accessibility for hands-free auto-sending", Toast.LENGTH_LONG).show()
            }

            val encodedMessage = URLEncoder.encode(message, "UTF-8")
            val whatsappUrl = "https://api.whatsapp.com/send?phone=$cleanNumber&text=$encodedMessage"

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(whatsappUrl)).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                val pm = packageManager
                if (isPackageInstalled("com.whatsapp", pm)) {
                    setPackage("com.whatsapp")
                } else if (isPackageInstalled("com.whatsapp.w4b", pm)) {
                    setPackage("com.whatsapp.w4b")
                }
            }

            startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "WhatsApp dispatch error", e)
            speak("WhatsApp could not be opened.")
        }
    }

    private fun isPackageInstalled(packageName: String, packageManager: PackageManager): Boolean {
        return try {
            packageManager.getPackageInfo(packageName, 0)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    // =========================================================================
    // Bluetooth LE Connection & Data Buffering Engine
    // =========================================================================
    @SuppressLint("MissingPermission")
    private fun initBluetooth() {
        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager.adapter
        startBleScan()
    }

    @SuppressLint("MissingPermission")
    private fun startBleScan() {
        if (bluetoothAdapter == null || !bluetoothAdapter!!.isEnabled) {
            notifyBleStatus("Bluetooth is disabled on phone", false, "", 0)
            return
        }

        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: return
        if (isScanning) return

        isScanning = true
        notifyBleStatus("Scanning for FRDM-RW612...", false, "", 0)

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        scanner.startScan(listOf(filter), settings, scanCallback)

        // Also fallback general scan if name matches
        scanner.startScan(object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                val device = result?.device ?: return
                val name = device.name ?: ""
                if (name.contains("FRDM", ignoreCase = true) || name.contains("RW612", ignoreCase = true) || name.contains("Vox", ignoreCase = true)) {
                    stopScan()
                    connectToDevice(device)
                }
            }
        })
    }

    @SuppressLint("MissingPermission")
    private fun stopScan() {
        if (isScanning) {
            isScanning = false
            bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        }
    }

    private val scanCallback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            val device = result?.device ?: return
            stopScan()
            connectToDevice(device)
        }

        override fun onScanFailed(errorCode: Int) {
            isScanning = false
            notifyBleStatus("Scan failed (Error $errorCode)", false, "", 0)
        }
    }

    @SuppressLint("MissingPermission")
    private fun connectToDevice(device: BluetoothDevice) {
        val deviceName = device.name ?: "FRDM-RW612-VOX"
        notifyBleStatus("Connecting to $deviceName...", false, deviceName, 0)

        bluetoothGatt = device.connectGatt(this, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    // Request high MTU for audio streaming throughput
                    gatt?.requestMtu(512)
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    notifyBleStatus("Disconnected. Retrying scan...", false, "", 0)
                    runOnUiThread { speak("Microcontroller disconnected.") }
                    startBleScan()
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
                super.onMtuChanged(gatt, mtu, status)
                Log.d(TAG, "Negotiated BLE MTU: $mtu")
                gatt?.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    val service = gatt?.getService(SERVICE_UUID)
                    val characteristic = service?.getCharacteristic(CHAR_AUDIO_CMD_UUID)

                    if (characteristic != null) {
                        // 1. Enable local notification
                        gatt.setCharacteristicNotification(characteristic, true)

                        // 2. Write CCCD Descriptor (Critical for Android notifications)
                        val descriptor = characteristic.getDescriptor(CCCD_UUID)
                        if (descriptor != null) {
                            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            gatt.writeDescriptor(descriptor)
                        }

                        val name = gatt.device.name ?: "FRDM-RW612"
                        notifyBleStatus("Connected ($name)", true, name, -45)
                        runOnUiThread { speak("Microcontroller connected. Ready for voice commands.") }
                    }
                }
            }

            // =================================================================
            // INCOMING PACKET RECEPTION & BUFFERING
            // =================================================================
            @Deprecated("Deprecated in Java")
            override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?) {
                val data = characteristic?.value ?: return
                handleIncomingBlePacket(data)
            }
        })
    }

    @SuppressLint("MissingPermission")
    private fun disconnectGatt() {
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        notifyBleStatus("Disconnected", false, "", 0)
    }

    /**
     * Handles incoming packets from the microcontroller:
     * - [0x01] = START: PTT Button Pressed. Clear buffer, begin accumulating.
     * - [0x02, ...] = DATA: Chunk of voice audio/text. Append to buffer.
     * - [0x03] = END: PTT Button Released. Flush buffer and dispatch to WhatsApp!
     */
    private fun handleIncomingBlePacket(packet: ByteArray) {
        if (packet.isEmpty()) return

        val opcode = packet[0]

        when (opcode) {
            OPCODE_START -> {
                // Microcontroller started recording
                dataBuffer.reset()
                isBuffering = true
                packetsReceivedCount = 0
                notifyBufferTelemetry("RECORDING", 0, 0, "Microcontroller PTT Pressed")
                runOnUiThread {
                    speak("Listening from microcontroller...")
                }
            }

            OPCODE_DATA -> {
                if (isBuffering && packet.size > 1) {
                    // Append data payload (skipping the 1-byte opcode)
                    dataBuffer.write(packet, 1, packet.size - 1)
                    packetsReceivedCount++
                    val bytesCount = dataBuffer.size()

                    // Try to generate a preview string if it's text
                    val preview = try {
                        val s = String(dataBuffer.toByteArray(), StandardCharsets.UTF_8)
                        if (s.any { it.isLetter() }) s else "Audio PCM Data ($bytesCount bytes)"
                    } catch (e: Exception) {
                        "Audio PCM Data ($bytesCount bytes)"
                    }

                    notifyBufferTelemetry("BUFFERING", packetsReceivedCount, bytesCount, preview)
                }
            }

            OPCODE_END -> {
                // Microcontroller finished recording -> FLUSH & PROCESS BUFFER
                isBuffering = false
                val totalBytes = dataBuffer.size()
                val bufferedBytes = dataBuffer.toByteArray()

                notifyBufferTelemetry("PROCESSING", packetsReceivedCount, totalBytes, "Flushing buffer...")

                // Process the complete buffered data
                processBufferedPayload(bufferedBytes)
            }

            else -> {
                // Handle raw text transmission (without opcode headers)
                try {
                    val rawText = String(packet, StandardCharsets.UTF_8).trim()
                    if (rawText.isNotEmpty()) {
                        notifyBufferTelemetry("DISPATCHING", 1, packet.size, rawText)
                        runOnUiThread {
                            processVoiceCommandString(rawText)
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Unrecognized packet format", e)
                }
            }
        }
    }

    /**
     * Processes the buffered voice/text data accumulated from the microcontroller
     */
    private fun processBufferedPayload(bytes: ByteArray) {
        if (bytes.isEmpty()) {
            notifyBufferTelemetry("IDLE", 0, 0, "Empty buffer received")
            return
        }

        // 1. Check if the microcontroller transmitted a direct UTF-8 command string
        val asString = try {
            String(bytes, StandardCharsets.UTF_8).trim()
        } catch (e: Exception) {
            ""
        }

        val lower = asString.lowercase()
        if (lower.startsWith("send") || lower.startsWith("whatsapp") || lower.startsWith("tell") || lower.startsWith("message") || asString.contains("-")) {
            // It's a text command!
            notifyBufferTelemetry("SENT", packetsReceivedCount, bytes.size, asString)
            runOnUiThread {
                processVoiceCommandString(asString)
            }
        } else {
            // It's raw PCM audio from INMP441!
            notifyBufferTelemetry("PROCESSING AUDIO", packetsReceivedCount, bytes.size, "Transcribing PCM Audio (${bytes.size} bytes)...")
            runOnUiThread {
                // Awaken the phone's speech recognizer to transcribe the voice
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                }
                speechRecognizer?.startListening(intent)
            }
        }
    }

    // =========================================================================
    // Advanced Closest Name & Fuzzy Contact Matching Engine
    // Handles misrecognized / wrongly spoken names and resolves to the closest contact
    // =========================================================================

    data class ContactRecord(val name: String, val phone: String, val relation: String = "")

    data class ContactMatch(
        val contact: ContactRecord,
        val score: Double,
        val editDistance: Int,
        val matchedCandidate: String,
        val remainderMessage: String,
        val isExact: Boolean
    )

    private val aliasMap = mapOf(
        "mom" to listOf("mom", "mother", "mummy", "mum", "amma", "maa", "mommy", "momma", "aai", "mataji"),
        "dad" to listOf("dad", "father", "papa", "daddy", "dada", "appa", "pop", "pops", "pitaji", "babuji"),
        "doctor" to listOf("doctor", "dr", "dr.", "clinic", "physician", "doc", "hospital", "dentist"),
        "caregiver" to listOf("caregiver", "nurse", "assistant", "helper", "attendant", "carer", "guardian"),
        "sister" to listOf("sister", "sis", "didi", "akka"),
        "brother" to listOf("brother", "bro", "bhai", "bhaiya", "anna"),
        "wife" to listOf("wife", "wifey", "patni", "spouse", "partner"),
        "husband" to listOf("husband", "hubby", "pati", "spouse", "partner"),
        "friend" to listOf("friend", "buddy", "mate", "pal", "yaar", "dost")
    )

    /**
     * Damerau-Levenshtein distance calculation accounting for insertions,
     * deletions, substitutions, and adjacent transpositions.
     */
    private fun damerauLevenshtein(s1: String, s2: String): Int {
        val len1 = s1.length
        val len2 = s2.length
        if (len1 == 0) return len2
        if (len2 == 0) return len1

        val d = Array(len1 + 1) { IntArray(len2 + 1) }
        for (i in 0..len1) d[i][0] = i
        for (j in 0..len2) d[0][j] = j

        for (i in 1..len1) {
            for (j in 1..len2) {
                val cost = if (s1[i - 1] == s2[j - 1]) 0 else 1
                d[i][j] = minOf(
                    d[i - 1][j] + 1,       // deletion
                    d[i][j - 1] + 1,       // insertion
                    d[i - 1][j - 1] + cost // substitution
                )
                if (i > 1 && j > 1 && s1[i - 1] == s2[j - 2] && s1[i - 2] == s2[j - 1]) {
                    d[i][j] = minOf(d[i][j], d[i - 2][j - 2] + cost) // transposition
                }
            }
        }
        return d[len1][len2]
    }

    /**
     * Phonetic simplification transformer for speech recognition sound-alikes:
     * maps phonetic variants ('ph'->'f', 'sh'->'s', 'ck'/'c'/'q'->'k', 'wh'/'w'->'v', etc.)
     * and collapses duplicate letters so misrecognized speech (e.g. "Ashis" vs "Ashish", "Alec" vs "Alex") matches.
     */
    private fun phoneticSimplify(s: String): String {
        var str = s.lowercase().replace("[^a-z0-9]".toRegex(), "")
        if (str.isEmpty()) return ""

        str = str.replace("ph", "f")
            .replace("gh", "f")
            .replace("ck", "k")
            .replace("sh", "s")
            .replace("ch", "c")
            .replace("th", "t")
            .replace("dh", "d")
            .replace("bh", "b")
            .replace("kh", "k")
            .replace("jh", "j")
            .replace("qu", "k")
            .replace("q", "k")
            .replace("x", "ks")
            .replace("z", "s")
            .replace("c(?=[eiy])".toRegex(), "s")
            .replace("c", "k")
            .replace("wh", "v")
            .replace("w", "v")
            .replace("ee", "i")
            .replace("ea", "i")
            .replace("oo", "u")
            .replace("ou", "u")
            .replace("ai", "e")
            .replace("ay", "e")
            .replace("ey", "e")
            .replace("y", "i")

        val sb = StringBuilder()
        var prev = ' '
        for (ch in str) {
            if (ch != prev) {
                sb.append(ch)
                prev = ch
            }
        }
        return sb.toString()
    }

    /**
     * Computes similarity score [0.0..1.0] and edit distance between query and target
     */
    private fun computeSimilarity(query: String, target: String): Pair<Double, Int> {
        val qClean = query.lowercase().replace("[^a-z0-9]".toRegex(), "")
        val tClean = target.lowercase().replace("[^a-z0-9]".toRegex(), "")

        if (qClean.isEmpty() || tClean.isEmpty()) return Pair(0.0, 99)

        // Exact match
        if (qClean == tClean) {
            return Pair(1.0, 0)
        }

        // Substring / containment match
        if (tClean.contains(qClean) && qClean.length >= 2) {
            val ratio = qClean.length.toDouble() / tClean.length.toDouble()
            return Pair(0.88 + 0.12 * ratio, 0)
        }
        if (qClean.contains(tClean) && tClean.length >= 2) {
            val ratio = tClean.length.toDouble() / qClean.length.toDouble()
            return Pair(0.85 + 0.12 * ratio, 0)
        }

        // Prefix match with length ratio bonus
        if (tClean.startsWith(qClean) && qClean.length >= 2) {
            val ratio = qClean.length.toDouble() / tClean.length.toDouble()
            return Pair(0.90 + 0.10 * ratio, 0)
        }
        if (qClean.startsWith(tClean) && tClean.length >= 2) {
            val ratio = tClean.length.toDouble() / qClean.length.toDouble()
            return Pair(0.86 + 0.10 * ratio, 0)
        }

        val dist = damerauLevenshtein(qClean, tClean)
        val maxLen = maxOf(qClean.length, tClean.length)
        val levSim = 1.0 - (dist.toDouble() / maxLen.toDouble())

        val qPhon = phoneticSimplify(qClean)
        val tPhon = phoneticSimplify(tClean)
        val phonSim: Double
        if (qPhon.isNotEmpty() && qPhon == tPhon) {
            phonSim = 1.0
        } else {
            val pDist = damerauLevenshtein(qPhon, tPhon)
            val pMax = maxOf(qPhon.length, tPhon.length)
            phonSim = if (pMax > 0) 1.0 - (pDist.toDouble() / pMax.toDouble()) else 0.0
        }

        val compositeScore = if (phonSim >= 0.88) {
            maxOf(levSim, 0.82 + 0.18 * phonSim)
        } else {
            0.55 * levSim + 0.45 * phonSim
        }

        return Pair(compositeScore, dist)
    }

    /**
     * Scores a spoken candidate query against a ContactRecord, testing against
     * full name, first name, last name, individual words, relations, and aliases.
     */
    private fun scoreContact(query: String, contact: ContactRecord): Pair<Double, Int> {
        val qClean = query.lowercase().trim()
        val cName = contact.name.lowercase().trim()
        val cRelation = contact.relation.lowercase().trim()

        var bestScore = 0.0
        var minDistance = 99

        // Full name
        val (fullScore, fullDist) = computeSimilarity(qClean, cName)
        if (fullScore > bestScore) {
            bestScore = fullScore
            minDistance = fullDist
        }

        // First name and name tokens (e.g. "Ashish" in "Ashish Shettigar")
        val tokens = cName.split("\\s+".toRegex()).filter { it.length >= 2 }
        for (token in tokens) {
            val (tScore, tDist) = computeSimilarity(qClean, token)
            if (tScore > bestScore) {
                bestScore = tScore
                minDistance = tDist
            }
        }

        // Relation
        if (cRelation.isNotEmpty()) {
            val (rScore, rDist) = computeSimilarity(qClean, cRelation)
            if (rScore > bestScore) {
                bestScore = rScore
                minDistance = rDist
            }
        }

        // Aliases
        for ((_, synonyms) in aliasMap) {
            val matchesContact = synonyms.any { s -> cName.contains(s) || (cRelation.isNotEmpty() && cRelation.contains(s)) }
            if (matchesContact) {
                for (syn in synonyms) {
                    val (synScore, synDist) = computeSimilarity(qClean, syn)
                    if (synScore > bestScore) {
                        bestScore = synScore
                        minDistance = synDist
                    }
                }
            }
        }

        return Pair(bestScore, minDistance)
    }

    /**
     * Finds the closest matching ContactRecord in the list for a candidate name query.
     * Selects the highest similarity score that passes the acceptance threshold.
     */
    private fun findClosestContact(query: String, contacts: List<ContactRecord>): Pair<ContactRecord, Double>? {
        if (query.isBlank() || contacts.isEmpty()) return null

        var bestContact: ContactRecord? = null
        var bestScore = 0.0
        var bestDist = 99
        val qLen = query.replace("[^a-zA-Z0-9]".toRegex(), "").length

        for (contact in contacts) {
            val (score, dist) = scoreContact(query, contact)
            if (score > bestScore) {
                bestScore = score
                bestDist = dist
                bestContact = contact
            }
        }

        val contact = bestContact ?: return null

        val isAcceptable = when {
            bestScore >= 0.80 -> true
            qLen <= 4 && bestDist <= 1 && bestScore >= 0.60 -> true // "Jon" -> "John", "Alec" -> "Alex", "Mum" -> "Mom"
            qLen in 5..8 && bestDist <= 2 && bestScore >= 0.60 -> true // "Ashis" -> "Ashish", "Docter" -> "Doctor"
            qLen > 8 && bestDist <= 3 && bestScore >= 0.60 -> true
            else -> bestScore >= 0.68
        }

        return if (isAcceptable) Pair(contact, bestScore) else null
    }

    /**
     * Resolves a voice command to the closest contact even if the name was recognized incorrectly.
     * Evaluates delimiter forms as well as 1, 2, and 3-word candidate name spans.
     */
    private fun resolveVoiceCommandToClosestMatch(voiceText: String, contacts: List<ContactRecord>): ContactMatch? {
        val clean = voiceText.trim()
        val prefixes = listOf(
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:send\\s+(?:a\\s+)?whatsapp\\s+message\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:send\\s+(?:a\\s+)?message\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:send\\s+(?:a\\s+)?whatsapp\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:send\\s+(?:a\\s+)?message\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:send\\s+(?:a\\s+)?whatsapp\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:send\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:send\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:whatsapp\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:whatsapp\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:message\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:message\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:text\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:text\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:tell\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:ask\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:say\\s+to\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:notify\\s+)"),
            Regex("(?i)^(?:please\\s+)?(?:can\\s+you\\s+)?(?:could\\s+you\\s+)?(?:contact\\s+)")
        )

        var stripped = clean
        for (prefix in prefixes) {
            val match = prefix.find(stripped)
            if (match != null) {
                stripped = stripped.substring(match.range.last + 1).trim()
                break
            }
        }

        if (stripped.isEmpty()) return null

        val candidates = mutableListOf<ContactMatch>()

        // Strategy 1: Delimiter Separation (-, :, that, saying, to say, please, telling, about)
        val delimiterRegex = Regex("(?i)^(.+?)\\s*(?:[-:]|(?:\\s+(?:that|saying|to say|please|telling|about)))\\s+(.+)$")
        val delimMatch = delimiterRegex.find(stripped)
        if (delimMatch != null) {
            val query = delimMatch.groupValues[1].trim()
            val rawBody = delimMatch.groupValues[2].trim()
            val result = findClosestContact(query, contacts)
            if (result != null) {
                val cleanBody = rawBody.replace(Regex("(?i)^[-:]\\s*"), "")
                    .replace(Regex("(?i)^(?:that|saying|to say)\\s+"), "")
                    .replace(Regex("^[\"']|[\"']$"), "")
                    .trim()
                val isExact = query.equals(result.first.name, ignoreCase = true)
                candidates.add(ContactMatch(result.first, result.second + 0.05, 0, query, cleanBody, isExact))
            }
        }

        // Strategy 2: N-gram word spans from beginning (1 to 3 words)
        val words = stripped.split("\\s+".toRegex()).filter { it.isNotBlank() }
        val maxWordsToTry = minOf(3, words.size)

        for (count in 1..maxWordsToTry) {
            val queryCandidate = words.take(count).joinToString(" ")
            val remainder = words.drop(count).joinToString(" ")
            val result = findClosestContact(queryCandidate, contacts)
            if (result != null) {
                val cleanBody = remainder.replace(Regex("(?i)^[-:]\\s*"), "")
                    .replace(Regex("(?i)^(?:that|saying|to say)\\s+"), "")
                    .replace(Regex("^[\"']|[\"']$"), "")
                    .trim()
                val isExact = queryCandidate.equals(result.first.name, ignoreCase = true)
                val multiWordBonus = if (count > 1 && result.first.name.contains(" ")) 0.08 else 0.0
                candidates.add(ContactMatch(result.first, result.second + multiWordBonus, 0, queryCandidate, cleanBody, isExact))
            }
        }

        if (candidates.isEmpty()) return null

        // Return candidate with the highest similarity score
        return candidates.maxByOrNull { it.score }
    }

    /**
     * Intelligent Contact-Aware Voice Command Parser:
     * Resolves voice command to closest contact name (handling recognition misspellings),
     * extracts message body, announces spoken feedback, and dispatches via WhatsApp.
     */
    private fun processVoiceCommandString(voiceText: String) {
        val clean = voiceText.trim()
        Log.d(TAG, "Processing voice command: $clean")

        // Notify web UI of the incoming transcript
        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.handleNativeVoiceCommand) { window.handleNativeVoiceCommand('${clean.replace("'", "\\'")}'); }",
                null
            )
        }

        val contacts = getAllContactsList()
        val match = resolveVoiceCommandToClosestMatch(clean, contacts)

        if (match != null) {
            val matchedContact = match.contact
            var messageBody = match.remainderMessage
            if (messageBody.isBlank()) {
                messageBody = "Hello, this is a voice message from VoxAssist."
            }

            if (match.isExact) {
                speak("Sending WhatsApp message to ${matchedContact.name} automatically.")
            } else {
                // Name was recognized with spelling difference: matched to closest contact!
                speak("Matched closest contact ${matchedContact.name} for ${match.matchedCandidate}. Sending WhatsApp message automatically.")
            }

            Log.d(TAG, "Closest contact match: ${matchedContact.name} (from '${match.matchedCandidate}') with score: ${match.score}")
            notifyBufferTelemetry("SENT", packetsReceivedCount, dataBuffer.size(), "To ${matchedContact.name}: $messageBody")
            sendWhatsAppMessage(matchedContact.phone, messageBody, matchedContact.name)
        } else {
            speak("Could not recognize who to send the message to. Please say: Send message to Contact Name, followed by your message.")
        }
    }

    private fun getAllContactsList(): List<ContactRecord> {
        val list = mutableListOf<ContactRecord>()
        try {
            val cursor = contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                ),
                null, null, null
            )
            cursor?.use {
                val nameIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                val seen = HashSet<String>()
                while (it.moveToNext()) {
                    val name = it.getString(nameIdx) ?: continue
                    val num = it.getString(numIdx) ?: continue
                    val cleanNum = num.replace("[^0-9+]".toRegex(), "")
                    if (cleanNum.isNotEmpty() && !seen.contains(name.lowercase())) {
                        seen.add(name.lowercase())
                        list.add(ContactRecord(name, cleanNum, "Phone Contact"))
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching contact list", e)
        }

        // Default assistive contacts if device contacts are empty
        if (list.isEmpty()) {
            list.add(ContactRecord("Mom", "+919876543210", "Family"))
            list.add(ContactRecord("Dad", "+919876543211", "Family"))
            list.add(ContactRecord("Doctor", "+919876543212", "Medical"))
            list.add(ContactRecord("Alex", "+919876543213", "Friend"))
            list.add(ContactRecord("Caregiver", "+919876543214", "Caregiver"))
        }

        return list
    }

    private fun queryPhoneNumberByName(name: String): String? {
        val contacts = getAllContactsList()
        val match = findClosestContact(name, contacts)
        if (match != null) {
            return match.first.phone
        }

        // Direct SQL fallback
        val uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI
        val projection = arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER)
        val selection = "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?"
        val selectionArgs = arrayOf("%$name%")

        contentResolver.query(uri, projection, selection, selectionArgs, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                if (numberIndex >= 0) {
                    return cursor.getString(numberIndex)
                }
            }
        }
        return null
    }

    private fun initSpeechRecognizer() {
        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
            speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onResults(results: Bundle?) {
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (!matches.isNullOrEmpty()) {
                        val text = matches[0]
                        processVoiceCommandString(text)
                    }
                }
                override fun onError(error: Int) {
                    speak("Voice recognition could not process the audio.")
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        tts?.shutdown()
        speechRecognizer?.destroy()
        disconnectGatt()
    }
}
