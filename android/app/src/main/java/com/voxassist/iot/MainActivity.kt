package com.voxassist.iot

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
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
import java.util.concurrent.ConcurrentHashMap

/**
 * VoxAssist Android Companion App
 * - Discovers, connects, and bonds with NXP FRDM-MCXW71 microcontroller over BLE 5.3
 * - Displays all available Bluetooth devices in a dedicated selectable segment
 * - Receives audio data from FRDM-MCXW71 female AUX connector and dispatches to WhatsApp
 * - Automatically sends WhatsApp messages via WhatsAppAccessibilityService (Zero Clicks)
 * - Intercepts incoming WhatsApp notifications via VoxNotificationListenerService
 * - Announces incoming notifications ("New message from [Contact]") via phone and board speaker
 * - Handles interactive voice queries ("Read out" / "What is the reply") to read messages aloud
 */
class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {

    private val TAG = "VoxAssist"
    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var webView: WebView? = null
    private var isScanning = false

    // Target GATT UUIDs for NXP FRDM-MCXW71 Custom Assistive Service
    private val SERVICE_UUID = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB")
    private val CHAR_AUDIO_TX_UUID = UUID.fromString("0000FFF1-0000-1000-8000-00805F9B34FB") // MCU -> Phone (Notify)
    private val CHAR_AUDIO_RX_UUID = UUID.fromString("0000FFF2-0000-1000-8000-00805F9B34FB") // Phone -> MCU Speaker (Write)
    private val CHAR_STATUS_UUID   = UUID.fromString("0000FFF3-0000-1000-8000-00805F9B34FB") // Status
    private val CCCD_UUID          = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    // NXP Wireless UART (Freescale/NXP Custom Service) UUIDs
    private val NXP_WU_SERVICE_UUID = UUID.fromString("01ff5550-ba5e-f4ee-5ca1-eb1e5e4b1ce0")
    private val NXP_WU_CHAR_UUID    = UUID.fromString("01ff5551-ba5e-f4ee-5ca1-eb1e5e4b1ce0")

    // Scanned Bluetooth Devices Registry
    data class ScannedBleDevice(
        val name: String,
        val address: String,
        var rssi: Int,
        val isTargetMcu: Boolean,
        val serviceUuid: String? = null
    )

    private val scannedDevices = ConcurrentHashMap<String, ScannedBleDevice>()

    // =========================================================================
    // Microcontroller Audio & Command Buffer
    // =========================================================================
    private val dataBuffer = ByteArrayOutputStream()
    private var isBuffering = false
    private var packetsReceivedCount = 0

    // Framing opcodes
    private val OPCODE_START: Byte        = 0x01 // PTT Button Pressed / AUX Audio Start
    private val OPCODE_DATA: Byte         = 0x02 // Streaming PCM Audio / Text Chunks
    private val OPCODE_END: Byte          = 0x03 // PTT Button Released / Audio End (Flush)
    private val OPCODE_NOTIF_ALERT: Byte  = 0x10 // Alert board speaker: "New message from <contact>"
    private val OPCODE_READOUT_REPLY: Byte = 0x20 // Stream reply body to board speaker

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tts = TextToSpeech(this, this)

        initWebView()
        checkAndRequestPermissions()
        initSpeechRecognizer()
        initBluetooth()
        initNotificationListenerHook()
    }

    private fun initNotificationListenerHook() {
        VoxNotificationListenerService.onMessageReceivedListener = { sender, message ->
            runOnUiThread {
                handleIncomingWhatsAppNotification(sender, message)
            }
        }
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
                    notifyNotificationListenerStatus()
                    notifyBleStatus("Scanning for FRDM-MCXW71...", false, "", 0)
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
        notifyNotificationListenerStatus()
    }

    private fun notifyAccessibilityStatus() {
        val enabled = isAccessibilityServiceEnabled()
        runOnUiThread {
            webView?.evaluateJavascript("if (window.setAccessibilityStatus) { window.setAccessibilityStatus($enabled); }", null)
        }
    }

    private fun notifyNotificationListenerStatus() {
        val enabled = isNotificationListenerEnabled()
        runOnUiThread {
            webView?.evaluateJavascript("if (window.setNotificationListenerStatus) { window.setNotificationListenerStatus($enabled); }", null)
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

    private var lastBroadcastTime = 0L

    private fun broadcastScannedDevices() {
        val now = System.currentTimeMillis()
        if (now - lastBroadcastTime < 250) {
            return
        }
        lastBroadcastTime = now
        val jsonArray = JSONArray()
        for (dev in scannedDevices.values) {
            val obj = JSONObject()
            obj.put("name", dev.name)
            obj.put("address", dev.address)
            obj.put("rssi", dev.rssi)
            obj.put("isTargetMcu", dev.isTargetMcu)
            if (dev.serviceUuid != null) {
                obj.put("serviceUuid", dev.serviceUuid)
            }
            jsonArray.put(obj)
        }
        val rawJson = jsonArray.toString()
        val base64 = android.util.Base64.encodeToString(rawJson.toByteArray(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP)
        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.updateScannedDevices) { try { window.updateScannedDevices(decodeURIComponent(escape(atob('$base64')))); } catch(e){} }",
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

    private fun isNotificationListenerEnabled(): Boolean {
        if (VoxNotificationListenerService.isServiceActive) return true
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val names = flat.split(":".toRegex()).toTypedArray()
        for (name in names) {
            val cn = ComponentName.unflattenFromString(name)
            if (cn != null && cn.packageName == packageName) {
                return true
            }
        }
        return false
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
        fun isNotificationListenerEnabled(): Boolean {
            return this@MainActivity.isNotificationListenerEnabled()
        }

        @JavascriptInterface
        fun openNotificationListenerSettings() {
            runOnUiThread {
                try {
                    val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(intent)
                    speak("Please permit VoxAssist to read WhatsApp notifications.")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to open notification listener settings", e)
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
        fun stopBleScan() {
            runOnUiThread {
                this@MainActivity.stopScan()
            }
        }

        @JavascriptInterface
        fun connectToDevice(address: String) {
            runOnUiThread {
                this@MainActivity.connectToDeviceByAddress(address)
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
        fun readLastWhatsAppReply() {
            runOnUiThread {
                this@MainActivity.handleVoiceQueryReadout()
            }
        }

        @JavascriptInterface
        fun simulateIncomingWhatsApp(sender: String, message: String) {
            runOnUiThread {
                this@MainActivity.handleIncomingWhatsAppNotification(sender, message)
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
            speak("VoxAssist is ready. Scanning for FRDM-MCXW71 microcontroller.")
        }
    }

    private fun speak(text: String) {
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vox_feedback")
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_SCAN)
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            permissions.add(Manifest.permission.BLUETOOTH)
            permissions.add(Manifest.permission.BLUETOOTH_ADMIN)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

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
    // Incoming WhatsApp Notification & Interactive Speaker Alert
    // =========================================================================
    private fun handleIncomingWhatsAppNotification(sender: String, message: String) {
        Log.d(TAG, "WhatsApp notification received -> Sender: $sender, Msg: $message")

        // 1. Spoken Announcement through Phone Speaker
        val spokenAlert = "New message from $sender."
        speak(spokenAlert)

        // 2. Alert Microcontroller Speaker over BLE Characteristic (0xFFF2)
        sendAlertToMcuSpeaker(OPCODE_NOTIF_ALERT, spokenAlert)

        // 3. Notify WebView to display incoming reply card
        val safeSender = sender.replace("'", "\\'")
        val safeMsg = message.replace("'", "\\'")
        val time = System.currentTimeMillis()
        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.onIncomingWhatsAppReply) { window.onIncomingWhatsAppReply('$safeSender', '$safeMsg', $time); }",
                null
            )
        }
    }

    /**
     * Sends notification alert / reply text to FRDM-MCXW71 speaker characteristic (0xFFF2)
     */
    @SuppressLint("MissingPermission")
    private fun sendAlertToMcuSpeaker(opcode: Byte, text: String) {
        val gatt = bluetoothGatt ?: return
        val service = gatt.getService(SERVICE_UUID) ?: return
        val charRx = service.getCharacteristic(CHAR_AUDIO_RX_UUID) ?: return

        try {
            val textBytes = text.toByteArray(StandardCharsets.UTF_8)
            val packet = ByteArray(minOf(textBytes.size + 1, 240))
            packet[0] = opcode
            System.arraycopy(textBytes, 0, packet, 1, packet.size - 1)

            charRx.value = packet
            charRx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            gatt.writeCharacteristic(charRx)
            Log.d(TAG, "Sent opcode 0x${String.format("%02X", opcode)} to FRDM-MCXW71 speaker")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to write to MCU speaker characteristic", e)
        }
    }

    /**
     * Handles user asking: "Read out" or "What is the reply"
     */
    private fun handleVoiceQueryReadout() {
        val replyText = VoxNotificationListenerService.getLastReplyFormatted()
        speak(replyText)

        // Also stream to FRDM-MCXW71 board speaker
        sendAlertToMcuSpeaker(OPCODE_READOUT_REPLY, replyText)

        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.onReadoutTriggered) { window.onReadoutTriggered('${replyText.replace("'", "\\'")}'); }",
                null
            )
        }
    }

    // =========================================================================
    // Bluetooth LE Connection & Multi-Device Scanner Engine
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
        scannedDevices.clear()
        notifyBleStatus("Scanning for FRDM-MCXW71...", false, "", 0)

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        scanner.startScan(null, settings, generalScanCallback)
    }

    @SuppressLint("MissingPermission")
    private fun stopScan() {
        if (isScanning) {
            isScanning = false
            bluetoothAdapter?.bluetoothLeScanner?.stopScan(generalScanCallback)
        }
    }

    private val generalScanCallback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            val device = result?.device ?: return
            val name = device.name ?: ""
            val address = device.address ?: return
            val rssi = result.rssi

            val isTarget = name.contains("FRDM", ignoreCase = true) ||
                    name.contains("MCXW71", ignoreCase = true) ||
                    name.contains("RW612", ignoreCase = true) ||
                    name.contains("Vox", ignoreCase = true)

            val serviceUuids = result.scanRecord?.serviceUuids?.joinToString(",") { it.uuid.toString() }

            val scanned = ScannedBleDevice(
                name = if (name.isNotBlank()) name else "Unnamed BLE ($address)",
                address = address,
                rssi = rssi,
                isTargetMcu = isTarget,
                serviceUuid = serviceUuids
            )

            scannedDevices[address] = scanned
            broadcastScannedDevices()
        }

        override fun onScanFailed(errorCode: Int) {
            isScanning = false
            notifyBleStatus("Scan failed (Error $errorCode)", false, "", 0)
        }
    }

    @SuppressLint("MissingPermission")
    private fun connectToDeviceByAddress(address: String) {
        val device = bluetoothAdapter?.getRemoteDevice(address)
        if (device != null) {
            stopScan()
            connectToDevice(device)
        } else {
            Toast.makeText(this, "Device not found for address $address", Toast.LENGTH_SHORT).show()
        }
    }

    @SuppressLint("MissingPermission")
    private fun connectToDevice(device: BluetoothDevice) {
        val deviceName = device.name ?: "FRDM-MCXW71-VOX"
        notifyBleStatus("Connecting to $deviceName...", false, deviceName, 0)

        // Close previous connection if exists
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()

        bluetoothGatt = device.connectGatt(this, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    // Request high MTU for audio streaming throughput
                    gatt?.requestMtu(512)
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    notifyBleStatus("Disconnected. Tap to scan...", false, "", 0)
                    runOnUiThread { speak("Microcontroller disconnected.") }
                    bluetoothGatt?.close()
                    bluetoothGatt = null
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
                super.onMtuChanged(gatt, mtu, status)
                Log.d(TAG, "Negotiated BLE MTU: $mtu")
                gatt?.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS && gatt != null) {
                    val name = gatt.device.name ?: "BLE Peripheral"

                    // Try Custom Assistive Service first
                    var service = gatt.getService(SERVICE_UUID)
                    var charNotify = service?.getCharacteristic(CHAR_AUDIO_TX_UUID)

                    // If not found, try standard NXP Wireless UART Service
                    if (charNotify == null) {
                        service = gatt.getService(NXP_WU_SERVICE_UUID)
                        charNotify = service?.getCharacteristic(NXP_WU_CHAR_UUID)
                    }

                    // If still null, try finding any characteristic that supports Notify
                    if (charNotify == null) {
                        for (srv in gatt.services) {
                            for (ch in srv.characteristics) {
                                if ((ch.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
                                    charNotify = ch
                                    break
                                }
                            }
                            if (charNotify != null) break
                        }
                    }

                    if (charNotify != null) {
                        gatt.setCharacteristicNotification(charNotify, true)
                        val descriptor = charNotify.getDescriptor(CCCD_UUID)
                        if (descriptor != null) {
                            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            gatt.writeDescriptor(descriptor)
                        }
                    }

                    notifyBleStatus("Connected ($name)", true, name, -42)
                    runOnUiThread { speak("Connected to $name.") }
                }
            }

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
     * - [0x01] = START: AUX PTT Button Pressed. Clear buffer, begin accumulating.
     * - [0x02, ...] = DATA: Chunk of voice audio/text from AUX ADC. Append to buffer.
     * - [0x03] = END: AUX PTT Released. Flush buffer and dispatch to WhatsApp!
     */
    private fun handleIncomingBlePacket(packet: ByteArray) {
        if (packet.isEmpty()) return

        val opcode = packet[0]

        when (opcode) {
            OPCODE_START -> {
                dataBuffer.reset()
                isBuffering = true
                packetsReceivedCount = 0
                notifyBufferTelemetry("RECORDING", 0, 0, "FRDM-MCXW71 AUX Mic Triggered")
                runOnUiThread {
                    speak("Listening from AUX microphone...")
                }
            }

            OPCODE_DATA -> {
                if (isBuffering && packet.size > 1) {
                    dataBuffer.write(packet, 1, packet.size - 1)
                    packetsReceivedCount++
                    val bytesCount = dataBuffer.size()

                    val preview = try {
                        val s = String(dataBuffer.toByteArray(), StandardCharsets.UTF_8)
                        if (s.any { it.isLetter() }) s else "AUX PCM Audio ($bytesCount bytes)"
                    } catch (e: Exception) {
                        "AUX PCM Audio ($bytesCount bytes)"
                    }

                    notifyBufferTelemetry("BUFFERING", packetsReceivedCount, bytesCount, preview)
                }
            }

            OPCODE_END -> {
                isBuffering = false
                val totalBytes = dataBuffer.size()
                val bufferedBytes = dataBuffer.toByteArray()

                notifyBufferTelemetry("PROCESSING", packetsReceivedCount, totalBytes, "Processing AUX Voice...")
                processBufferedPayload(bufferedBytes)
            }

            else -> {
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

    private fun processBufferedPayload(bytes: ByteArray) {
        if (bytes.isEmpty()) {
            notifyBufferTelemetry("IDLE", 0, 0, "Empty buffer received")
            return
        }

        val asString = try {
            String(bytes, StandardCharsets.UTF_8).trim()
        } catch (e: Exception) {
            ""
        }

        val lower = asString.lowercase()
        // Check if user is asking to read out the reply
        if (isReplyReadoutQuery(lower)) {
            runOnUiThread { handleVoiceQueryReadout() }
            return
        }

        if (lower.startsWith("send") || lower.startsWith("whatsapp") || lower.startsWith("tell") || lower.startsWith("message") || asString.contains("-")) {
            notifyBufferTelemetry("SENT", packetsReceivedCount, bytes.size, asString)
            runOnUiThread {
                processVoiceCommandString(asString)
            }
        } else {
            notifyBufferTelemetry("PROCESSING AUDIO", packetsReceivedCount, bytes.size, "Transcribing AUX Audio (${bytes.size} bytes)...")
            runOnUiThread {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                }
                speechRecognizer?.startListening(intent)
            }
        }
    }

    private fun isReplyReadoutQuery(text: String): Boolean {
        val lower = text.lowercase()
        return lower.contains("read out") ||
                lower.contains("what is the reply") ||
                lower.contains("read the reply") ||
                lower.contains("read reply") ||
                lower.contains("read message") ||
                lower.contains("what is the message") ||
                lower.contains("what did they say") ||
                lower.contains("any new message")
    }

    // =========================================================================
    // Advanced Contact Matching & NLP Parser
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
                    d[i - 1][j] + 1,
                    d[i][j - 1] + 1,
                    d[i - 1][j - 1] + cost
                )
                if (i > 1 && j > 1 && s1[i - 1] == s2[j - 2] && s1[i - 2] == s2[j - 1]) {
                    d[i][j] = minOf(d[i][j], d[i - 2][j - 2] + cost)
                }
            }
        }
        return d[len1][len2]
    }

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
            .replace("qu", "k")
            .replace("x", "ks")
            .replace("z", "s")
            .replace("c(?=[eiy])".toRegex(), "s")
            .replace("c", "k")
            .replace("wh", "v")
            .replace("w", "v")
            .replace("ee", "i")
            .replace("ea", "i")
            .replace("oo", "u")
            .replace("ai", "e")
            .replace("ay", "e")
            .replace("y", "i")

        val sb = StringBuilder()
        var lastChar = ' '
        for (c in str) {
            if (c != lastChar) {
                sb.append(c)
                lastChar = c
            }
        }
        return sb.toString()
    }

    private fun computeContactSimilarity(spoken: String, contactName: String): Double {
        val spClean = spoken.lowercase().trim()
        val cClean = contactName.lowercase().trim()

        if (spClean == cClean) return 1.0

        for ((key, aliases) in aliasMap) {
            val contactIsAlias = cClean == key || aliases.contains(cClean)
            val spokenIsAlias = spClean == key || aliases.contains(spClean)
            if (contactIsAlias && spokenIsAlias) return 0.98
        }

        if (cClean.contains(" ")) {
            val tokens = cClean.split("\\s+".toRegex())
            for (t in tokens) {
                if (spClean == t) return 0.92
            }
        }

        val dist = damerauLevenshtein(spClean, cClean)
        val maxLen = maxOf(spClean.length, cClean.length)
        if (maxLen == 0) return 0.0

        val stringSim = 1.0 - (dist.toDouble() / maxLen.toDouble())
        val phonSp = phoneticSimplify(spClean)
        val phonC = phoneticSimplify(cClean)
        val phonSim = if (phonSp.isNotEmpty() && phonC.isNotEmpty()) {
            val pDist = damerauLevenshtein(phonSp, phonC)
            1.0 - (pDist.toDouble() / maxOf(phonSp.length, phonC.length).toDouble())
        } else 0.0

        val combined = (stringSim * 0.45) + (phonSim * 0.55)
        return maxOf(0.0, minOf(1.0, combined))
    }

    private fun findClosestContact(query: String, contacts: List<ContactRecord>): Pair<ContactRecord, Double>? {
        if (contacts.isEmpty() || query.isBlank()) return null
        var bestContact: ContactRecord? = null
        var bestScore = 0.0

        for (c in contacts) {
            val score = computeContactSimilarity(query, c.name)
            if (score > bestScore) {
                bestScore = score
                bestContact = c
            }
        }

        return if (bestContact != null && bestScore >= 0.55) {
            Pair(bestContact, bestScore)
        } else null
    }

    private fun resolveVoiceCommandToClosestMatch(spokenText: String, contacts: List<ContactRecord>): ContactMatch? {
        val clean = spokenText.trim()
        val prefixRegex = Regex("(?i)^(?:send(?: a)? message to|send message|send sms to|message to|whatsapp to|whatsapp|tell|msg to)\\s+")
        val stripped = clean.replace(prefixRegex, "").trim()

        val candidates = mutableListOf<ContactMatch>()
        val delimiterRegex = Regex("(?i)^(.*?)(?:\\s*[-:]\\s*|\\s+that\\s+|\\s+saying\\s+|\\s+to say\\s+)(.*)$")
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
        return candidates.maxByOrNull { it.score }
    }

    private fun processVoiceCommandString(voiceText: String) {
        val clean = voiceText.trim()
        Log.d(TAG, "Processing voice command: $clean")

        // Wake phrase detection: accepts "hello parity", "hey parity", "hi parity", or "parity"
        val codewordRegex = Regex("\\b((hello|hey|hi)\\s+)?(parity|parody|perry|pairity)\\b", RegexOption.IGNORE_CASE)
        val hasCodeword = codewordRegex.containsMatchIn(clean)

        // Strip wake phrase to extract command payload
        val effectiveCommand = if (hasCodeword) {
            clean.replace(codewordRegex, "").trim().replace(Regex("^[,\\s-]+"), "")
        } else {
            clean
        }

        // Check if user is asking to read out reply
        if (isReplyReadoutQuery(effectiveCommand)) {
            handleVoiceQueryReadout()
            return
        }

        runOnUiThread {
            webView?.evaluateJavascript(
                "if (window.handleNativeVoiceCommand) { window.handleNativeVoiceCommand('${effectiveCommand.replace("'", "\\'")}'); }",
                null
            )
        }

        val contacts = getAllContactsList()
        val match = resolveVoiceCommandToClosestMatch(effectiveCommand, contacts)

        if (match != null) {
            val matchedContact = match.contact
            var messageBody = match.remainderMessage
            if (messageBody.isBlank()) {
                messageBody = "Hello, this is a voice message from VoxAssist."
            }

            if (match.isExact) {
                speak("Sending WhatsApp message to ${matchedContact.name} automatically.")
            } else {
                speak("Matched closest contact ${matchedContact.name} for ${match.matchedCandidate}. Sending WhatsApp message automatically.")
            }

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

        if (list.isEmpty()) {
            list.add(ContactRecord("Mom", "+919876543210", "Family"))
            list.add(ContactRecord("Dad", "+919876543211", "Family"))
            list.add(ContactRecord("Doctor", "+919876543212", "Medical"))
            list.add(ContactRecord("Alex", "+919876543213", "Friend"))
            list.add(ContactRecord("Caregiver", "+919876543214", "Caregiver"))
        }

        return list
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
