@file:OptIn(PublicPreviewAPI::class)

package com.routewise.shopdesk

import com.google.firebase.Firebase
import com.google.firebase.ai.*
import com.google.firebase.ai.ondevice.*
import com.google.firebase.ai.type.*

/** The four routes, matching InferenceMode in Firebase AI Logic. */
enum class Mode { PREFER_ON_DEVICE, ONLY_ON_DEVICE, PREFER_IN_CLOUD, ONLY_IN_CLOUD }

data class Answer(val text: String, val onDevice: Boolean, val ms: Long, val error: String? = null) {
    val ok get() = error == null
}

/** Every model call in the app goes through Firebase AI Logic hybrid inference. */
object Ai {
    const val CLOUD_MODEL = "gemini-3.5-flash-lite"
    private val models = mutableMapOf<Mode, GenerativeModel>()

    private fun inference(m: Mode) = when (m) {
        Mode.PREFER_ON_DEVICE -> InferenceMode.PREFER_ON_DEVICE
        Mode.ONLY_ON_DEVICE -> InferenceMode.ONLY_ON_DEVICE
        Mode.PREFER_IN_CLOUD -> InferenceMode.PREFER_IN_CLOUD
        Mode.ONLY_IN_CLOUD -> InferenceMode.ONLY_IN_CLOUD
    }

    private fun model(m: Mode): GenerativeModel = models.getOrPut(m) {
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = CLOUD_MODEL,
            generationConfig = generationConfig { temperature = 0f },
            onDeviceConfig = OnDeviceConfig(mode = inference(m)),
        )
    }

    suspend fun generate(m: Mode, prompt: String): Answer {
        val t0 = System.currentTimeMillis()
        return try {
            val r = model(m).generateContent(prompt)
            // The SDK reports where the answer came from: ON_DEVICE or IN_CLOUD.
            Answer(r.text.orEmpty(), r.inferenceSource.toString().contains("DEVICE", ignoreCase = true), System.currentTimeMillis() - t0)
        } catch (e: Exception) {
            Answer("", false, System.currentTimeMillis() - t0, e.message ?: e.javaClass.simpleName)
        }
    }

    /** UNAVAILABLE, DOWNLOADABLE, DOWNLOADING or AVAILABLE. */
    suspend fun status(): String = try {
        FirebaseAIOnDevice.checkStatus().toString()
    } catch (e: Exception) {
        "UNKNOWN"
    }

    /** Downloads Gemini Nano; reports progress as text. */
    suspend fun download(onEvent: (String) -> Unit) {
        FirebaseAIOnDevice.download().collect { event -> onEvent(event.toString()) }
    }
}
