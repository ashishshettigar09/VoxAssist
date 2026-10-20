package com.voxassist.iot

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * WhatsApp Accessibility Service
 * Automatically clicks the "Send" button in WhatsApp when a voice message is dispatched,
 * providing a 100% hands-free experience for blind and visually impaired users.
 */
class WhatsAppAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "VoxAssistA11y"
        var autoSendPending = false
        var isServiceRunning = false
    }

    private val handler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceRunning = true
        Log.d(TAG, "WhatsAppAccessibilityService connected and active.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!autoSendPending) return

        val rootNode = rootInActiveWindow ?: return
        val packageName = event?.packageName?.toString() ?: ""
        if (!packageName.contains("whatsapp")) return

        // 1. Try finding by WhatsApp standard View ID
        val sendNodeById = rootNode.findAccessibilityNodeInfosByViewId("com.whatsapp:id/send")
        if (sendNodeById.isNotEmpty()) {
            for (node in sendNodeById) {
                if (clickNode(node)) return
            }
        }

        // WhatsApp Business View ID
        val sendNodeByW4bId = rootNode.findAccessibilityNodeInfosByViewId("com.whatsapp.w4b:id/send")
        if (sendNodeByW4bId.isNotEmpty()) {
            for (node in sendNodeByW4bId) {
                if (clickNode(node)) return
            }
        }

        // 2. Try finding by content description "Send" or "Enviar" / "Envoyer"
        findAndClickSendButton(rootNode)
    }

    private fun findAndClickSendButton(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false

        val desc = node.contentDescription?.toString()?.lowercase() ?: ""
        val text = node.text?.toString()?.lowercase() ?: ""
        val viewId = node.viewIdResourceName?.lowercase() ?: ""

        if (desc == "send" || text == "send" || viewId.endsWith(":id/send")) {
            if (clickNode(node)) return true
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (findAndClickSendButton(child)) {
                return true
            }
        }
        return false
    }

    private fun clickNode(node: AccessibilityNodeInfo): Boolean {
        if (node.isClickable) {
            val success = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            if (success) {
                Log.d(TAG, "Successfully clicked WhatsApp Send button automatically!")
                autoSendPending = false

                // Return back to VoxAssist after 1.5 seconds
                handler.postDelayed({
                    performGlobalAction(GLOBAL_ACTION_BACK)
                }, 1500)

                return true
            }
        } else {
            // Parent might be clickable
            val parent = node.parent
            if (parent != null && parent.isClickable) {
                val success = parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (success) {
                    autoSendPending = false
                    handler.postDelayed({
                        performGlobalAction(GLOBAL_ACTION_BACK)
                    }, 1500)
                    return true
                }
            }
        }
        return false
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted.")
    }

    override fun onDestroy() {
        super.onDestroy()
        isServiceRunning = false
    }
}
