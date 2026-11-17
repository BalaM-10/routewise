@file:OptIn(PublicPreviewAPI::class)

package com.routewise.shopdesk

import com.google.firebase.Firebase
import com.google.firebase.ai.*
import com.google.firebase.ai.type.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout

/** The four routes, matching InferenceMode in Firebase AI Logic. */
enum class Mode { PREFER_ON_DEVICE, ONLY_ON_DEVICE, PREFER_IN_CLOUD, ONLY_IN_CLOUD }

data class Answer(val text: String, val onDevice: Boolean, val ms: Long, val error: String? = null) {
    val ok get() = error == null
}

/**
 * Which Gemini Nano AICore should use, as Firebase AI Logic's on-device model categories.
 * The preview categories are Gemini Nano 4 and need the AICore developer preview on the phone.
 */
enum class Nano(val label: String, val model: String, val detail: String) {
    STABLE("Standard", "Gemini Nano (standard)", "Gemini Nano 2 or 3, whichever AICore offers on this phone"),
    PREVIEW("Nano 4 Full", "Gemini Nano 4 Full", "Gemini Nano 4 Full (preview), for harder tasks"),
    PREVIEW_FAST("Nano 4 Fast", "Gemini Nano 4 Fast", "Gemini Nano 4 Fast (preview), for lower latency"),
}

/** Every model call in the app goes through Firebase AI Logic hybrid inference. */
object Ai {
    const val CLOUD_MODEL = "gemini-3.5-flash-lite"
    private val models = mutableMapOf<Pair<Mode, Nano>, GenerativeModel>()

    /**
     * The on-device model category the owner chose. A published route can name its own model for a step
     * (for example Nano 4 Fast to sort and Nano 4 Full to find names); otherwise this one answers.
     */
    var nano: Nano = Nano.PREVIEW

    private fun option(n: Nano) = when (n) {
        Nano.STABLE -> OnDeviceModelOption.STABLE
        Nano.PREVIEW -> OnDeviceModelOption.PREVIEW
        Nano.PREVIEW_FAST -> OnDeviceModelOption.PREVIEW_FAST
    }

    private fun inference(m: Mode) = when (m) {
        Mode.PREFER_ON_DEVICE -> InferenceMode.PREFER_ON_DEVICE
        Mode.ONLY_ON_DEVICE -> InferenceMode.ONLY_ON_DEVICE
        Mode.PREFER_IN_CLOUD -> InferenceMode.PREFER_IN_CLOUD
        Mode.ONLY_IN_CLOUD -> InferenceMode.ONLY_IN_CLOUD
    }

    private fun model(m: Mode, n: Nano = nano): GenerativeModel = models.getOrPut(m to n) {
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = CLOUD_MODEL,
            // Temperature applies to the cloud model; the phone uses its own defaults.
            generationConfig = generationConfig { temperature = 0f },
            onDeviceConfig = OnDeviceConfig(mode = inference(m), modelOption = option(n)),
        )
    }

    /**
     * One answer, with where it ran and how long it took. A stalled answer counts as failed after
     * [timeoutMs]; AICore's "busy" signal is retried twice with a short backoff.
     */
    private val RETRY_IN = Regex("retry in ([0-9.]+)s", RegexOption.IGNORE_CASE)
    private val RATE_LIMITED = Regex("quota|rate.?limit|exceeded|\\b429\\b", RegexOption.IGNORE_CASE)
    private val TRANSIENT = Regex("BUSY|unexpected|\\b50[03]\\b|unavailable|overloaded|deadline", RegexOption.IGNORE_CASE)

    /**
     * One model call. The time reported is that of the attempt that answered, so waiting out a
     * rate limit or a busy model does not count as slowness. A per-minute cloud limit is waited out
     * (as long as the server asks, up to four times); a busy or failed call is tried twice more.
     * A daily limit or anything else is returned as the error it is.
     */
    suspend fun generate(m: Mode, prompt: String, timeoutMs: Long = 30_000, n: Nano = nano): Answer {
        var waits = 0
        var retries = 0
        while (true) {
            val t0 = System.currentTimeMillis()
            try {
                val r = withTimeout(timeoutMs) { model(m, n).generateContent(prompt) }
                // The SDK reports where the answer came from: on the device or in the cloud.
                return Answer(r.text.orEmpty(), r.inferenceSource == InferenceSource.ON_DEVICE, System.currentTimeMillis() - t0)
            } catch (e: TimeoutCancellationException) {
                return Answer("", false, System.currentTimeMillis() - t0, "No answer within ${timeoutMs / 1000} s")
            } catch (e: CancellationException) {
                // Stopping a calibration must stop it, not count as a failed answer.
                throw e
            } catch (e: Exception) {
                val message = e.message ?: e.javaClass.simpleName
                val perMinute = m != Mode.ONLY_ON_DEVICE && RATE_LIMITED.containsMatchIn(message) && !Regex("per ?day", RegexOption.IGNORE_CASE).containsMatchIn(message)
                if (perMinute && waits < 4) {
                    waits++
                    val seconds = RETRY_IN.find(message)?.groupValues?.get(1)?.toDoubleOrNull() ?: 30.0
                    android.util.Log.i(TAG, "cloud rate limit, waiting ${seconds.toInt() + 1} s")
                    delay(((seconds + 1) * 1000).toLong())
                    continue
                }
                if (!perMinute && TRANSIENT.containsMatchIn(message) && retries < 2) {
                    retries++
                    delay(2000L * retries)
                    continue
                }
                return Answer("", false, System.currentTimeMillis() - t0, message)
            }
        }
    }

    /** On-device controls for Gemini Nano, from firebase-ai's OnDeviceExtension. */
    private fun device() = model(Mode.ONLY_ON_DEVICE).onDeviceExtension

    /**
     * UNAVAILABLE, DOWNLOADABLE, DOWNLOADING or AVAILABLE. The status is an object, not text,
     * so it is compared with the library's own constants.
     */
    suspend fun status(): String = try {
        when (device()?.checkStatus()) {
            OnDeviceModelStatus.AVAILABLE -> "AVAILABLE"
            OnDeviceModelStatus.DOWNLOADABLE -> "DOWNLOADABLE"
            OnDeviceModelStatus.DOWNLOADING -> "DOWNLOADING"
            OnDeviceModelStatus.UNAVAILABLE -> "UNAVAILABLE"
            else -> "UNKNOWN"
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        "UNKNOWN"
    }

    const val TAG = "Routewise"

    fun ready(status: String) = status == "AVAILABLE"

    /**
     * Asks AICore to download Gemini Nano and reports progress in words. Returns null when AICore
     * accepted the request, or the reason it did not. AICore may keep downloading after the flow ends,
     * so callers check [status] afterwards.
     */
    suspend fun download(onEvent: (String) -> Unit): String? = try {
        var failure: String? = null
        val flow = device()?.download() ?: return "This phone did not offer a download"
        flow.collect { event ->
            android.util.Log.i(TAG, "download event: $event")
            onEvent(
                when (event) {
                    is DownloadStatus.DownloadStarted -> "Starting the download"
                    is DownloadStatus.DownloadInProgress -> "Downloading Gemini Nano"
                    is DownloadStatus.DownloadCompleted -> "Downloaded"
                    is DownloadStatus.DownloadFailed -> "The download failed".also { failure = "AICore reported that the download failed" }
                    else -> "Downloading Gemini Nano"
                },
            )
        }
        failure
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        android.util.Log.w(TAG, "download failed", e)
        e.message ?: e.javaClass.simpleName
    }

    /** Loads the model into memory, so the first real answer does not pay the load time. */
    suspend fun warmUp(): Long {
        val t0 = System.currentTimeMillis()
        try {
            device()?.warmUp()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            generate(Mode.ONLY_ON_DEVICE, "Reply with the word ready.", 60_000)
        }
        return System.currentTimeMillis() - t0
    }
}
