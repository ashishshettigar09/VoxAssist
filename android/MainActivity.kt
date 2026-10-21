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
    // Advanced Closest Name & Fuzzy Contact Matching Engine
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

    private fun computeSimilarity(query: String, target: String): Pair<Double, Int> {
        val qClean = query.lowercase().replace("[^a-z0-9]".toRegex(), "")
        val tClean = target.lowercase().replace("[^a-z0-9]".toRegex(), "")

        if (qClean.isEmpty() || tClean.isEmpty()) return Pair(0.0, 99)

        if (qClean == tClean) return Pair(1.0, 0)

        // Substring / containment match
        if (tClean.contains(qClean) && qClean.length >= 2) {
            val ratio = qClean.length.toDouble() / tClean.length.toDouble()
            return Pair(0.88 + 0.12 * ratio, 0)
        }
        if (qClean.contains(tClean) && tClean.length >= 2) {
            val ratio = tClean.length.toDouble() / qClean.length.toDouble()
            return Pair(0.85 + 0.12 * ratio, 0)
        }

        // Prefix match
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
        val phonSim = if (qPhon.isNotEmpty() && qPhon == tPhon) 1.0 else {
            val pDist = damerauLevenshtein(qPhon, tPhon)
            val pMax = maxOf(qPhon.length, tPhon.length)
            if (pMax > 0) 1.0 - (pDist.toDouble() / pMax.toDouble()) else 0.0
        }

        val compositeScore = if (phonSim >= 0.88) {
            maxOf(levSim, 0.82 + 0.18 * phonSim)
        } else {
            0.55 * levSim + 0.45 * phonSim
        }

        return Pair(compositeScore, dist)
    }

    private fun scoreContact(query: String, contact: ContactRecord): Pair<Double, Int> {
        val qClean = query.lowercase().trim()
        val cName = contact.name.lowercase().trim()
        val cRelation = contact.relation.lowercase().trim()

        var bestScore = 0.0
        var minDistance = 99

        val (fullScore, fullDist) = computeSimilarity(qClean, cName)
        if (fullScore > bestScore) {
            bestScore = fullScore
            minDistance = fullDist
        }

        val tokens = cName.split("\\s+".toRegex()).filter { it.length >= 2 }
        for (token in tokens) {
            val (tScore, tDist) = computeSimilarity(qClean, token)
            if (tScore > bestScore) {
                bestScore = tScore
                minDistance = tDist
            }
        }

        if (cRelation.isNotEmpty()) {
            val (rScore, rDist) = computeSimilarity(qClean, cRelation)
            if (rScore > bestScore) {
                bestScore = rScore
                minDistance = rDist
            }
        }

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
            qLen <= 4 && bestDist <= 1 && bestScore >= 0.60 -> true
            qLen in 5..8 && bestDist <= 2 && bestScore >= 0.60 -> true
            qLen > 8 && bestDist <= 3 && bestScore >= 0.60 -> true
            else -> bestScore >= 0.68
        }

        return if (isAcceptable) Pair(contact, bestScore) else null
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

        // Strategy 1: Delimiter Separation
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

        // Strategy 2: N-gram word spans
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

        return candidates.maxByOrNull { it.score }
    }

    private fun processVoiceCommand(voiceText: String) {
        val clean = voiceText.trim()
        val contacts = getAllContactsList()
        val match = resolveVoiceCommandToClosestMatch(clean, contacts)

        if (match != null) {
            val matchedContact = match.contact
            var messageBody = match.remainderMessage
            if (messageBody.isBlank()) {
                messageBody = "Hello, this is a voice message from VoxAssist."
            }

            if (match.isExact) {
                speak("Sending message to ${matchedContact.name}: $messageBody")
            } else {
                speak("Matched closest contact ${matchedContact.name}. Sending message: $messageBody")
            }

            sendSms(matchedContact.phone, messageBody, matchedContact.name)
        } else {
            speak("Could not recognize who to send the message to. Please say: Send message to Name, dash, message.")
        }
    }

    private fun queryPhoneNumberByName(name: String): String? {
        val contacts = getAllContactsList()
        val match = findClosestContact(name, contacts)
        if (match != null) {
            return match.first.phone
        }

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
