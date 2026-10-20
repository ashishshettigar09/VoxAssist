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

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
        webView = findViewById(R.id.webView)
        webView?.apply {
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
            runOnUiThread {
                webView?.evaluateJavascript("if (window.loadDeviceContacts) { window.loadDeviceContacts($json); }", null)
            }
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
                    val name = it.getString(nameIdx) ?: continue
                    val rawNum = it.getString(numIdx) ?: continue
                    val cleanNum = rawNum.replace("[^0-9+]".toRegex(), "")
                    if (cleanNum.isNotEmpty() && !seen.contains(name.lowercase())) {
                        seen.add(name.lowercase())
                        val obj = JSONObject()
                        obj.put("id", list.length() + 1)
                        obj.put("name", name)
                        obj.put("phone", cleanNum)
                        obj.put("relation", "Phone Contact")
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

    /**
     * Intelligent Contact-Aware Voice Command Parser:
     * Handles:
     * - "Send message to [Contact] [Message]"
     * - "Send message to [Contact] - [Message]"
     * - "Send message to [Contact] that [Message]"
     * - "Send WhatsApp message to [Contact] [Message]"
     * - "Send WhatsApp to [Contact] [Message]"
     * - "WhatsApp [Contact] [Message]"
     * - "Message to [Contact] [Message]"
     * - "Tell [Contact] [Message]"
     */
    private fun processVoiceCommandString(voiceText: String) {
        var clean = voiceText.trim()
        Log.d(TAG, "Processing voice command: $clean")

        // Notify web UI of the incoming transcript
        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.handleNativeVoiceCommand) { window.handleNativeVoiceCommand('${clean.replace("'", "\\'")}'); }",
                null
            )
        }

        // 1. Strip trigger prefix
        val prefixes = listOf(
            Regex("(?i)^send\\s+(?:a\\s+)?whatsapp\\s+message\\s+to\\s+"),
            Regex("(?i)^send\\s+(?:a\\s+)?message\\s+to\\s+"),
            Regex("(?i)^send\\s+(?:a\\s+)?whatsapp\\s+to\\s+"),
            Regex("(?i)^send\\s+to\\s+"),
            Regex("(?i)^whatsapp\\s+to\\s+"),
            Regex("(?i)^whatsapp\\s+"),
            Regex("(?i)^message\\s+to\\s+"),
            Regex("(?i)^tell\\s+"),
            Regex("(?i)^text\\s+to\\s+"),
            Regex("(?i)^text\\s+")
        )

        var stripped = clean
        for (prefix in prefixes) {
            val match = prefix.find(stripped)
            if (match != null) {
                stripped = stripped.substring(match.range.last + 1).trim()
                break
            }
        }

        // 2. Fetch all contacts from phone to match against
        val contacts = getAllContactsList()

        var matchedContactName = ""
        var matchedPhoneNumber = ""
        var messageBody = ""

        // Sort contacts by name length descending so "Alex Smith" matches before "Alex"
        val sortedContacts = contacts.sortedByDescending { it.name.length }

        // Try direct prefix matching with known contact names
        val lowerStripped = stripped.lowercase()
        for (c in sortedContacts) {
            val cLower = c.name.lowercase()
            val firstName = cLower.split(" ").firstOrNull() ?: cLower

            if (lowerStripped.startsWith(cLower)) {
                matchedContactName = c.name
                matchedPhoneNumber = c.phone
                messageBody = stripped.substring(cLower.length).trim()
                break
            } else if (firstName.length >= 3 && lowerStripped.startsWith(firstName)) {
                matchedContactName = c.name
                matchedPhoneNumber = c.phone
                messageBody = stripped.substring(firstName.length).trim()
                break
            }
        }

        // Check common aliases (Mom, Dad, Doctor)
        if (matchedContactName.isEmpty()) {
            val aliasMap = mapOf(
                "mom" to listOf("mom", "mother", "mummy", "amma", "maa"),
                "dad" to listOf("dad", "father", "papa", "daddy", "appa"),
                "doctor" to listOf("doctor", "dr", "dr.", "clinic")
            )

            for ((alias, candidates) in aliasMap) {
                if (lowerStripped.startsWith(alias)) {
                    val found = contacts.firstOrNull { c ->
                        candidates.any { cand -> c.name.lowercase().contains(cand) }
                    }
                    if (found != null) {
                        matchedContactName = found.name
                        matchedPhoneNumber = found.phone
                        messageBody = stripped.substring(alias.length).trim()
                        break
                    }
                }
            }
        }

        // Fallback: Check for delimiter like '-' or ':' or 'that' or 'saying'
        if (matchedContactName.isEmpty()) {
            val delimiterRegex = Regex("(?i)^([^-:]+?)\\s*[-:]\\s*(.+)$")
            val delimMatch = delimiterRegex.find(stripped)
            if (delimMatch != null) {
                val query = delimMatch.groupValues[1].trim()
                val phone = queryPhoneNumberByName(query)
                if (phone != null) {
                    matchedContactName = query
                    matchedPhoneNumber = phone
                    messageBody = delimMatch.groupValues[2].trim()
                }
            }
        }

        // Clean up messageBody (remove leading "that", "saying", "-", ":")
        messageBody = messageBody.replace(Regex("(?i)^[-:]\\s*"), "")
            .replace(Regex("(?i)^(?:that|saying|to say)\\s+"), "")
            .trim()

        if (matchedContactName.isNotEmpty() && matchedPhoneNumber.isNotEmpty() && messageBody.isNotEmpty()) {
            sendWhatsAppMessage(matchedPhoneNumber, messageBody, matchedContactName)
        } else if (matchedContactName.isNotEmpty() && matchedPhoneNumber.isNotEmpty() && messageBody.isEmpty()) {
            speak("What message would you like to send to $matchedContactName?")
        } else {
            // Check if user was trying to match by delimiter
            val delimFallback = Regex("(?i)send\\s+(?:a\\s+)?(?:whatsapp\\s+)?message\\s+to\\s+([^-:]+?)\\s*[-:]\\s*(.+)")
            val match = delimFallback.find(clean)
            if (match != null) {
                val contactName = match.groupValues[1].trim()
                val body = match.groupValues[2].trim()
                val phoneNumber = queryPhoneNumberByName(contactName)
                if (phoneNumber != null) {
                    sendWhatsAppMessage(phoneNumber, body, contactName)
                    return
                }
            }
            speak("Could not recognize who to send the message to. Please say: Send message to Contact Name, followed by your message.")
        }
    }

    data class ContactRecord(val name: String, val phone: String)

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
                while (it.moveToNext()) {
                    val name = it.getString(nameIdx) ?: continue
                    val num = it.getString(numIdx) ?: continue
                    val cleanNum = num.replace("[^0-9+]".toRegex(), "")
                    if (cleanNum.isNotEmpty()) {
                        list.add(ContactRecord(name, cleanNum))
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching contact list", e)
        }
        return list
    }

    private fun queryPhoneNumberByName(name: String): String? {
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
