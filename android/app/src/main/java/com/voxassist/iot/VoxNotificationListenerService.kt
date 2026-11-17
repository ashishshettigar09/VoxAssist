package com.voxassist.iot

import android.app.Notification
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * VoxNotificationListenerService
 * Intercepts incoming WhatsApp notifications in real-time.
 * - Extracts contact/sender name and reply body
 * - Triggers audio announcements: "New message from [Contact]"
 * - Alerts FRDM-MCXW71 microcontroller over BLE to chime its speaker
 * - Saves last reply for interactive voice queries: "Read out" / "What is the reply"
 */
class VoxNotificationListenerService : NotificationListenerService() {

    data class WhatsAppMessage(
        val sender: String,
        val text: String,
        val timestamp: Long = System.currentTimeMillis()
    )

    companion object {
        private const val TAG = "VoxNotifListener"
        var isServiceActive = false
        var lastSender: String? = null
        var lastMessage: String? = null
        var lastTimestamp: Long = 0L
        val messageHistory = mutableListOf<WhatsAppMessage>()

        var onMessageReceivedListener: ((sender: String, message: String) -> Unit)? = null

        fun getLastReplyFormatted(): String {
            val sender = lastSender
            val msg = lastMessage
            return if (!sender.isNullOrBlank() && !msg.isNullOrBlank()) {
                "Message from $sender: $msg"
            } else {
                "You have no new WhatsApp replies."
            }
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        isServiceActive = true
        Log.d(TAG, "VoxNotificationListenerService connected and active.")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isServiceActive = false
        Log.w(TAG, "VoxNotificationListenerService disconnected.")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val pkgName = sbn.packageName ?: return
        if (pkgName != "com.whatsapp" && pkgName != "com.whatsapp.w4b") return

        val notification = sbn.notification ?: return
        val extras: Bundle = notification.extras ?: return

        // Extract Title (Sender Name) and Message Text
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
            ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim() ?: ""

        // Filter system notifications or background sync events
        if (title.isEmpty() || text.isEmpty()) return
        if (title.equals("WhatsApp", ignoreCase = true) && text.contains("Checking for new messages", ignoreCase = true)) return
        if (text.contains("WhatsApp Web is currently active", ignoreCase = true)) return
        if (text.contains("backup in progress", ignoreCase = true)) return

        Log.d(TAG, "Incoming WhatsApp Message -> Sender: '$title' | Text: '$text'")

        lastSender = title
        lastMessage = text
        lastTimestamp = System.currentTimeMillis()
        val record = WhatsAppMessage(title, text, lastTimestamp)
        synchronized(messageHistory) {
            messageHistory.add(0, record)
            if (messageHistory.size > 20) {
                messageHistory.removeAt(messageHistory.size - 1)
            }
        }

        // Notify active MainActivity
        onMessageReceivedListener?.invoke(title, text)
    }

    override fun onDestroy() {
        super.onDestroy()
        isServiceActive = false
    }
}

