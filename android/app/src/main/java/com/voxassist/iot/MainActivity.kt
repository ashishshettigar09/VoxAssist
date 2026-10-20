package com.voxassist.iot

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
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
import java.net.URLEncoder
import java.util.*

/**
 * VoxAssist Android Companion App
 * - Dispatches messages to contacts via WhatsApp (100% Free, zero carrier SMS costs)
 * - Synchronizes real phonebook contacts into the voice assistant
 * - Receives BLE voice triggers/audio from FRDM-RW612 + INMP441
 * - Provides spoken accessibility feedback via TextToSpeech
 */
class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {

    private val TAG = "VoxAssist"
    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var webView: WebView? = null

    // Target GATT UUIDs for FRDM-RW612 EdgeFast BLE Service
    private val SERVICE_UUID = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB")
    private val CHAR_AUDIO_CMD_UUID = UUID.fromString("0000FFF1-0000-1000-8000-00805F9B34FB")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize TextToSpeech engine
        tts = TextToSpeech(this, this)

        // Setup WebView for tactile accessibility UI
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

    // Sync real device contacts into WebView
    fun syncContactsToWebView() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            val json = getDeviceContactsJson()
            runOnUiThread {
                webView?.evaluateJavascript("if (window.loadDeviceContacts) { window.loadDeviceContacts($json); }", null)
            }
        }
    }

    // Read real contacts from phone
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

    // Bridge between Web UI and Native WhatsApp & Hardware
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
        fun speak(text: String) {
            runOnUiThread {
                this@MainActivity.speak(text)
            }
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.US
            speak("VoxAssist WhatsApp gateway is ready.")
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
        }
    }

    // =========================================================================
    // WhatsApp Message Dispatcher (Replaces SMS - Zero Carrier Charges)
    // =========================================================================
    private fun sendWhatsAppMessage(phoneNumber: String, message: String, contactName: String) {
        try {
            // Normalize phone number (strip non-numeric characters)
            var cleanNumber = phoneNumber.replace("[^0-9+]".toRegex(), "")
            if (cleanNumber.startsWith("+")) {
                cleanNumber = cleanNumber.substring(1)
            } else if (cleanNumber.length == 10) {
                // If standard 10-digit Indian number, prepend India country code 91
                cleanNumber = "91$cleanNumber"
            }

            val encodedMessage = URLEncoder.encode(message, "UTF-8")
            val whatsappUrl = "https://api.whatsapp.com/send?phone=$cleanNumber&text=$encodedMessage"

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(whatsappUrl)).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                val pm = packageManager
                if (isPackageInstalled("com.whatsapp", pm)) {
                    setPackage("com.whatsapp")
                } else if (isPackageInstalled("com.whatsapp.w4b", pm)) {
                    setPackage("com.whatsapp.w4b") // WhatsApp Business
                }
            }

            startActivity(intent)
            speak("Opening WhatsApp message to $contactName.")
            Toast.makeText(this, "Opening WhatsApp for $contactName", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.e(TAG, "WhatsApp dispatch error", e)
            speak("WhatsApp could not be opened. Please make sure WhatsApp is installed.")
            Toast.makeText(this, "WhatsApp is not installed on this device", Toast.LENGTH_LONG).show()
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
    // Bluetooth LE Connection to FRDM-RW612
    // =========================================================================
    @SuppressLint("MissingPermission")
    private fun initBluetooth() {
        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager.adapter

        val scanner = bluetoothAdapter?.bluetoothLeScanner
        scanner?.startScan(object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                val device = result?.device
                if (device?.name == "FRDM-RW612-VOX") {
                    scanner.stopScan(this)
                    connectToDevice(device)
                }
            }
        })
    }

    @SuppressLint("MissingPermission")
    private fun connectToDevice(device: BluetoothDevice) {
        bluetoothGatt = device.connectGatt(this, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    gatt?.discoverServices()
                    runOnUiThread { speak("Microcontroller device connected.") }
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                val service = gatt?.getService(SERVICE_UUID)
                val characteristic = service?.getCharacteristic(CHAR_AUDIO_CMD_UUID)
                if (characteristic != null) {
                    gatt.setCharacteristicNotification(characteristic, true)
                }
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?) {
                runOnUiThread {
                    val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                    }
                    speechRecognizer?.startListening(intent)
                }
            }
        })
    }

    private fun initSpeechRecognizer() {
        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
            speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onResults(results: Bundle?) {}
                override fun onError(error: Int) {}
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
        bluetoothGatt?.close()
    }
}
