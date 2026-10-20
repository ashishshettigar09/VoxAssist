package com.voxassist.iot

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.ContactsContract
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.telephony.SmsManager
import android.util.Log
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.util.*

/**
 * VoxAssist Android Companion App
 * Receives BLE audio/trigger from FRDM-RW612 + INMP441,
 * parses recipient & message, resolves phone number, sends SMS,
 * and provides spoken audio feedback via TextToSpeech for blind users.
 */
class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {

    private val TAG = "VoxAssist"
    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothGatt: BluetoothGatt? = null

    // Target GATT UUIDs for FRDM-RW612 EdgeFast BLE Service
    private val SERVICE_UUID = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB")
    private val CHAR_AUDIO_CMD_UUID = UUID.fromString("0000FFF1-0000-1000-8000-00805F9B34FB")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Initialize TextToSpeech engine for auditory feedback
        tts = TextToSpeech(this, this)

        checkAndRequestPermissions()
        initSpeechRecognizer()
        initBluetooth()
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.US
            speak("VoxAssist is active and connected to your voice assistant.")
        }
    }

    private fun speak(text: String) {
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vox_feedback")
    }

    private fun checkAndRequestPermissions() {
        val permissions = arrayOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.SEND_SMS,
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

    // =========================================================================
    // Speech Recognition
    // =========================================================================
    private fun initSpeechRecognizer() {
        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
            speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    speak("Listening. Speak your message command.")
                }
                override fun onResults(results: Bundle?) {
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (!matches.isNullOrEmpty()) {
                        val spokenText = matches[0]
                        Log.d(TAG, "Recognized: $spokenText")
                        processVoiceCommand(spokenText)
                    }
                }
                override fun onError(error: Int) {
                    speak("Voice not recognized. Please try again.")
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

    // =========================================================================
    // Command Parser & Contact Resolution
    // Pattern: "Send message to <Name> - <Message>"
    // =========================================================================
    private fun processVoiceCommand(voiceText: String) {
        val regex = Regex("(?i)send\\s+(?:a\\s+)?message\\s+to\\s+([^-:]+?)\\s*[-:]\\s*(.+)")
        val match = regex.find(voiceText)

        if (match != null) {
            val contactName = match.groupValues[1].trim()
            val messageBody = match.groupValues[2].trim()

            val phoneNumber = queryPhoneNumberByName(contactName)

            if (phoneNumber != null) {
                speak("Sending message to $contactName: $messageBody")
                sendSms(phoneNumber, messageBody, contactName)
            } else {
                speak("Could not find $contactName in your phone contacts.")
            }
        } else {
            speak("Command format not recognized. Please say: Send message to Name, dash, message.")
        }
    }

    // Lookup phone number from Android native contacts database
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

    // Send Carrier SMS
    @android.annotation.SuppressLint("MissingPermission")
    private fun sendSms(phoneNumber: String, message: String, contactName: String) {
        try {
            val smsManager: SmsManager = getSystemService(SmsManager::class.java)
            smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            speak("Message sent successfully to $contactName.")
            Toast.makeText(this, "SMS Sent to $contactName ($phoneNumber)", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.e(TAG, "SMS failed", e)
            speak("Failed to send text message. Please check signal or carrier permissions.")
        }
    }

    // =========================================================================
    // Bluetooth LE Connection to FRDM-RW612
    // =========================================================================
    @android.annotation.SuppressLint("MissingPermission")
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
                // Microcontroller triggered Push-to-Talk or sent audio chunk
                runOnUiThread {
                    // Trigger the speech recognition
                    val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                    }
                    speechRecognizer?.startListening(intent)
                }
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        tts?.shutdown()
        speechRecognizer?.destroy()
        bluetoothGatt?.close()
    }
}
