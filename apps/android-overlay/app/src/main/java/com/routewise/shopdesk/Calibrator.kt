package com.routewise.shopdesk

import android.os.Build
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.Instant
import kotlin.math.ceil
import kotlin.math.sqrt

data class Trial(val ticket: Int, val device: Answer, val cloud: Answer, val deviceGood: Boolean, val cloudGood: Boolean)

data class Outcome(
    val taskId: String,
    val trials: List<Trial>,
    val mode: Mode,
    val reasons: List<String>,
    val good: Int,
    val lowerBound: Double,
    val deviceP50: Long,
    val deviceP90: Long,
    val cloudP50: Long,
)

/**
 * On-phone calibration for the steps that have known answers (sorting, order details,
 * finding personal details), so no reviewing model is needed. Same decision rules as the web.
 */
object Calibrator {
    val STEPS = listOf("triage", "extract", "pii")
    private const val CLOUD_GAP_MS = 7000L // stays under the free tier's 10 requests a minute

    private fun pct(p: Int, xs: List<Long>): Long {
        if (xs.isEmpty()) return 0
        val s = xs.sorted()
        return s[(ceil(p / 100.0 * s.size).toInt() - 1).coerceIn(0, s.size - 1)]
    }

    /** One-sided 95% Wilson lower bound. */
    fun wilson(k: Int, n: Int, z: Double = 1.645): Double {
        if (n == 0) return 0.0
        val p = k.toDouble() / n
        val z2 = z * z
        return ((p + z2 / (2 * n) - z * sqrt(p * (1 - p) / n + z2 / (4.0 * n * n))) / (1 + z2 / n)).coerceAtLeast(0.0)
    }

    suspend fun run(steps: List<String>, onProgress: (done: Int, total: Int, label: String) -> Unit): List<Outcome> {
        val total = steps.size * TICKETS.size
        var done = 0
        var lastCloud = 0L
        return steps.map { id ->
            val trials = TICKETS.mapIndexed { i, t ->
                onProgress(done, total, "${Tasks.NAMES[id]}: ticket ${i + 1} of ${TICKETS.size}")
                val prompt = Tasks.prompt(id, t.text)
                val device = Ai.generate(Mode.ONLY_ON_DEVICE, prompt)
                val wait = lastCloud + CLOUD_GAP_MS - System.currentTimeMillis()
                if (wait > 0) delay(wait)
                lastCloud = System.currentTimeMillis()
                val cloud = Ai.generate(Mode.ONLY_IN_CLOUD, prompt)
                done++
                Trial(
                    i, device, cloud,
                    deviceGood = device.ok && Tasks.valid(id, device.text) && Tasks.correct(id, device.text, t),
                    cloudGood = cloud.ok && Tasks.valid(id, cloud.text) && Tasks.correct(id, cloud.text, t),
                )
            }
            decide(id, trials)
        }.also { onProgress(total, total, "Finished") }
    }

    fun decide(id: String, trials: List<Trial>): Outcome {
        val n = trials.size
        val good = trials.count { it.deviceGood }
        val rate = if (n == 0) 0.0 else good.toDouble() / n
        val lb = wilson(good, n)
        val devMs = trials.filter { it.device.ok }.map { it.device.ms }
        val p90 = pct(90, devMs)
        val sensitive = id in Policy.READS_RAW_TICKET
        val reasons = mutableListOf<String>()
        val p = { x: Double -> "${(x * 100).toInt()}%" }
        var mode: Mode = when {
            trials.all { !it.device.ok } -> Mode.ONLY_IN_CLOUD.also { reasons += "Gemini Nano could not complete this step on this phone." }
            lb >= 0.7 -> (if (sensitive) Mode.ONLY_ON_DEVICE else Mode.PREFER_ON_DEVICE).also { reasons += "$good of $n phone answers were right (at least ${p(lb)} with 95% confidence)." }
            rate >= 0.85 && sensitive -> Mode.ONLY_ON_DEVICE.also { reasons += "$good of $n phone answers were right. Personal data stays on the phone; more examples would raise confidence." }
            rate >= 0.5 -> Mode.PREFER_IN_CLOUD.also { reasons += "$good of $n phone answers were right, not enough to lead." }
            else -> Mode.ONLY_IN_CLOUD.also { reasons += "Only $good of $n phone answers were right." }
        }
        val budget = Tasks.BUDGET_MS[id] ?: Long.MAX_VALUE
        if (mode == Mode.PREFER_ON_DEVICE && p90 > budget) {
            mode = Mode.PREFER_IN_CLOUD
            reasons += "But the phone's slowest typical answer ($p90 ms) is over the $budget ms budget."
        }
        return Outcome(id, trials, mode, reasons, good, lb, pct(50, devMs), p90, pct(50, trials.filter { it.cloud.ok }.map { it.cloud.ms }))
    }

    fun device(): String = "${Build.MANUFACTURER.replaceFirstChar(Char::uppercase)} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}"

    /** The routes in the same format as the web app, for the Remote Config parameter "routewise_policy_android". */
    fun policyJson(outcomes: List<Outcome>): String {
        val tasks = JSONObject()
        outcomes.forEach { o ->
            tasks.put(o.taskId, JSONObject().put("mode", o.mode.name).put("maxWords", JSONObject.NULL).put("sensitive", o.taskId in Policy.READS_RAW_TICKET))
        }
        return JSONObject()
            .put("version", 1)
            .put("createdAt", Instant.now().toString())
            .put("measuredOn", device())
            .put("cloudModel", Ai.CLOUD_MODEL)
            .put("tasks", tasks)
            .toString()
    }
}
