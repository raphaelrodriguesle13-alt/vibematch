package com.vibematch.app.video.rtc

import android.util.Log
import com.vibematch.app.BuildConfig

/**
 * Sanitized RTC lifecycle markers for debug/device-farm diagnostics.
 *
 * Never accepts tokens, URLs, room names, participant identities, user ids, or
 * exception messages. Release builds remain silent.
 */
internal object RtcDiagnostics {
    const val TAG = "VibeMatchRtc"

    private val safeLabel = Regex("[^A-Za-z0-9_.$]")

    fun event(name: String, remoteCount: Int? = null) {
        emit(Log.INFO, name, remoteCount, null)
    }

    fun warning(name: String, remoteCount: Int? = null) {
        emit(Log.WARN, name, remoteCount, null)
    }

    fun error(name: String, throwable: Throwable? = null) {
        emit(Log.ERROR, name, null, throwable?.javaClass?.simpleName)
    }

    private fun emit(
        priority: Int,
        name: String,
        remoteCount: Int?,
        errorClass: String?,
    ) {
        if (!BuildConfig.DEBUG) return
        val event = name.uppercase().replace(safeLabel, "_")
        val message = buildString {
            append("RTC_DIAG event=")
            append(event)
            remoteCount?.let {
                append(" remote_count=")
                append(it.coerceAtLeast(0))
            }
            errorClass?.let {
                append(" error_class=")
                append(it.replace(safeLabel, "_"))
            }
        }
        Log.println(priority, TAG, message)
    }
}
