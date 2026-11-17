package com.routewise.shopdesk

import android.os.Build
import kotlinx.coroutines.delay
import org.json.JSONArray
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
    val cloudP90: Long,
)

/**
 * On-phone calibration for the steps that have known answers (sorting, order details and finding
 * personal details), so no reviewing model is needed. The decision rules are the web's.
 */
object Calibrator {
    val STEPS = listOf("triage", "extract", "pii")

    /** About 8.5 cloud requests a minute, under the free tier's 10. */
    private const val CLOUD_GAP_MS = 7000L
    private const val DEVICE_TIMEOUT_MS = 90_000L
    private const val CLOUD_TIMEOUT_MS = 60_000L

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

    /**
     * Runs every ticket through each step on the phone and in the cloud. Each finished step is
     * handed back at once through [onStepDone], so stopping part-way keeps what was measured.
     */
    suspend fun run(
        steps: List<String>,
        onProgress: (done: Int, total: Int, label: String) -> Unit,
        onStepDone: (Outcome) -> Unit,
    ) {
        val tickets = Data.tickets
        val total = steps.size * tickets.size
        var done = 0
        var lastCloud = 0L
        onProgress(0, total, "Warming up Gemini Nano")
        Ai.warmUp()
        for (id in steps) {
            val trials = tickets.mapIndexed { i, t ->
                onProgress(done, total, "${Tasks.NAMES[id]}: ticket ${i + 1} of ${tickets.size}")
                val prompt = Tasks.prompt(id, t.text)
                var device = Ai.generate(Mode.ONLY_ON_DEVICE, prompt, DEVICE_TIMEOUT_MS)
                // Android only lets the app in front use Gemini Nano. If the owner switched away, that is not a
                // wrong answer: wait for the app to come back (up to 10 minutes) and ask again.
                var waited = 0
                while (device.error?.contains("Background usage is blocked", ignoreCase = true) == true && waited < 120) {
                    onProgress(done, total, "Paused: open Shopdesk again to continue")
                    delay(5_000)
                    waited++
                    device = Ai.generate(Mode.ONLY_ON_DEVICE, prompt, DEVICE_TIMEOUT_MS)
                }
                if (waited > 0) onProgress(done, total, "${Tasks.NAMES[id]}: ticket ${i + 1} of ${tickets.size}")
                val wait = lastCloud + CLOUD_GAP_MS - System.currentTimeMillis()
                if (wait > 0) delay(wait)
                lastCloud = System.currentTimeMillis()
                val cloud = Ai.generate(Mode.ONLY_IN_CLOUD, prompt, CLOUD_TIMEOUT_MS)
                done++
                Trial(
                    i, device, cloud,
                    deviceGood = device.ok && device.onDevice && Tasks.valid(id, device.text) && Tasks.correct(id, device.text, t),
                    cloudGood = cloud.ok && Tasks.valid(id, cloud.text) && Tasks.correct(id, cloud.text, t),
                )
            }
            onStepDone(decide(id, trials))
        }
        onProgress(total, total, "Finished")
    }

    fun decide(id: String, trials: List<Trial>): Outcome {
        val n = trials.size
        val good = trials.count { it.deviceGood }
        val rate = if (n == 0) 0.0 else good.toDouble() / n
        val lb = wilson(good, n)
        val devMs = trials.filter { it.device.ok }.map { it.device.ms }
        val cloudMs = trials.filter { it.cloud.ok }.map { it.cloud.ms }
        val p90 = pct(90, devMs)
        val sensitive = id in Policy.READS_RAW_TICKET
        val reasons = mutableListOf<String>()
        val p = { x: Double -> "${(x * 100).toInt()}%" }
        var mode: Mode = when {
            trials.all { !it.device.ok } -> Mode.ONLY_IN_CLOUD.also { reasons += "Gemini Nano could not complete this step on this phone." }
            lb >= 0.7 -> (if (sensitive) Mode.ONLY_ON_DEVICE else Mode.PREFER_ON_DEVICE).also {
                reasons += "$good of $n phone answers were right (at least ${p(lb)} with 95% confidence)."
                if (sensitive) reasons += "This step reads personal data, so it stays on the phone."
            }
            rate >= 0.85 && sensitive -> Mode.ONLY_ON_DEVICE.also { reasons += "$good of $n phone answers were right. This step reads personal data, so it stays on the phone; more examples would raise confidence." }
            rate >= 0.5 -> Mode.PREFER_IN_CLOUD.also { reasons += "$good of $n phone answers were right, not enough to lead." }
            else -> Mode.ONLY_IN_CLOUD.also { reasons += "Only $good of $n phone answers were right." }
        }
        val budget = Tasks.BUDGET_MS[id] ?: Long.MAX_VALUE
        if (mode == Mode.PREFER_ON_DEVICE && p90 > budget) {
            mode = Mode.PREFER_IN_CLOUD
            reasons += "But the phone's slowest typical answer ($p90 ms) is over the $budget ms budget."
        }
        if (sensitive && mode == Mode.ONLY_ON_DEVICE && p90 > budget) {
            reasons += "The phone's slowest typical answer ($p90 ms) is over the $budget ms budget; privacy wins, so show progress while it runs."
        }
        val timedOut = trials.count { it.device.error?.startsWith("No answer within") == true }
        if (timedOut > 0) reasons += "$timedOut phone ${if (timedOut == 1) "answer" else "answers"} took too long and counted as wrong."
        return Outcome(id, trials, mode, reasons, good, lb, pct(50, devMs), p90, pct(50, cloudMs), pct(90, cloudMs))
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
            .put("measuredOn", "${device()}, ${Ai.nano.model}")
            .put("onDeviceModel", Ai.nano.name)
            .put("cloudModel", Ai.CLOUD_MODEL)
            .put("tasks", tasks)
            .toString()
    }

    /** The full evidence of a run: every example's answer, result and time on the phone and in the cloud. Tickets are referred to by number. */
    fun reportJson(outcomes: List<Outcome>): String {
        fun answer(a: Answer, good: Boolean) = JSONObject().put("text", a.text).put("ms", a.ms).put("onDevice", a.onDevice).put("good", good).put("error", a.error ?: JSONObject.NULL)
        val tasks = JSONArray()
        outcomes.forEach { o ->
            val trials = JSONArray()
            o.trials.forEach { t -> trials.put(JSONObject().put("ticket", t.ticket).put("device", answer(t.device, t.deviceGood)).put("cloud", answer(t.cloud, t.cloudGood))) }
            tasks.put(
                JSONObject().put("id", o.taskId).put("mode", o.mode.name).put("good", o.good).put("n", o.trials.size)
                    .put("lowerBound", o.lowerBound).put("deviceP50", o.deviceP50).put("deviceP90", o.deviceP90)
                    .put("cloudP50", o.cloudP50).put("cloudP90", o.cloudP90).put("reasons", JSONArray(o.reasons)).put("trials", trials),
            )
        }
        return JSONObject().put("createdAt", Instant.now().toString()).put("device", device()).put("onDeviceModel", Ai.nano.name).put("onDeviceModelName", Ai.nano.model).put("cloudModel", Ai.CLOUD_MODEL).put("tasks", tasks).toString(2)
    }

    /**
     * Writes the routes and the evidence where adb can read them (Android/data/com.routewise.shopdesk/files).
     * A run that measured every step is also kept per model, so the Calibrate tab can show it later.
     */
    fun saveFiles(context: android.content.Context, outcomes: List<Outcome>) {
        try {
            val dir = context.getExternalFilesDir(null) ?: return
            val report = reportJson(outcomes)
            java.io.File(dir, "routewise_policy_android.json").writeText(policyJson(outcomes))
            java.io.File(dir, "routewise_report_android.json").writeText(report)
            if (outcomes.map { it.taskId }.containsAll(STEPS)) java.io.File(dir, "routewise_report_${Ai.nano.name}.json").writeText(report)
            android.util.Log.i(Ai.TAG, "calibration saved to ${dir.absolutePath}")
        } catch (e: Exception) {
            android.util.Log.w(Ai.TAG, "could not save calibration files", e)
        }
    }

    /** One step of a saved run, as the Calibrate tab shows it. */
    data class SavedStep(
        val id: String, val mode: Mode, val good: Int, val n: Int, val lowerBound: Double,
        val deviceP50: Long, val deviceP90: Long, val cloudP50: Long, val cloudP90: Long, val reasons: List<String>,
    )

    data class SavedRun(val createdAt: java.time.Instant, val modelName: String, val steps: List<SavedStep>)

    /** The last run that measured every step on this model, or null when there is none on this phone. */
    fun lastRun(context: android.content.Context, nano: Nano): SavedRun? = try {
        val f = java.io.File(context.getExternalFilesDir(null) ?: return null, "routewise_report_${nano.name}.json")
        if (!f.exists()) null else {
            val o = JSONObject(f.readText())
            val tasks = o.getJSONArray("tasks")
            val steps = (0 until tasks.length()).mapNotNull { i ->
                val t = tasks.getJSONObject(i)
                val mode = Mode.entries.firstOrNull { it.name == t.optString("mode") } ?: return@mapNotNull null
                val r = t.optJSONArray("reasons") ?: JSONArray()
                SavedStep(
                    t.getString("id"), mode, t.getInt("good"), t.getInt("n"), t.getDouble("lowerBound"),
                    t.getLong("deviceP50"), t.getLong("deviceP90"), t.getLong("cloudP50"), t.getLong("cloudP90"),
                    (0 until r.length()).map { r.getString(it) },
                )
            }
            if (o.optString("onDeviceModel") != nano.name || steps.isEmpty()) null
            else SavedRun(java.time.Instant.parse(o.getString("createdAt")), o.optString("onDeviceModelName", nano.model), steps)
        }
    } catch (e: Exception) {
        android.util.Log.w(Ai.TAG, "could not read the saved calibration", e)
        null
    }

    /** The bar a model must clear for a step: 95% confidence lower bound. Finding names is held higher. */
    fun modelBar(id: String) = if (id == "pii") 0.9 else 0.7

    /** One step's model choice, with the evidence in words. */
    data class ModelChoice(val id: String, val model: Nano, val step: SavedStep, val reason: String)

    /**
     * Picks, per step, the quickest model whose saved run clears the step's bar; if none does, the one
     * with the strongest evidence. Uses only complete runs already measured on this phone.
     */
    fun chooseModels(runs: Map<Nano, SavedRun>): List<ModelChoice> = STEPS.mapNotNull { id ->
        val measured = runs.mapNotNull { (n, r) -> r.steps.firstOrNull { it.id == id }?.let { n to it } }
        if (measured.isEmpty()) return@mapNotNull null
        val bar = modelBar(id)
        val pct = { x: Double -> "${(x * 100).toInt()}%" }
        val passing = measured.filter { it.second.lowerBound >= bar }
        val (model, step) = passing.minByOrNull { it.second.deviceP50 } ?: measured.maxBy { it.second.lowerBound }
        val others = measured.filter { it.first != model }.joinToString("; ") { (n, s) ->
            "${n.label}: ${s.good} of ${s.n}" + (if (s.lowerBound < bar) ", below the ${pct(bar)} bar" else ", median ${"%,d".format(s.deviceP50)} ms")
        }
        val why = when {
            passing.isEmpty() -> "No model cleared the ${pct(bar)} bar; ${model.label} has the strongest evidence."
            passing.size > 1 -> "${model.label} is the quickest that clears the ${pct(bar)} bar."
            else -> "${model.label} is the only one that clears the ${pct(bar)} bar."
        }
        ModelChoice(id, model, step, "$why ${model.label}: ${step.good} of ${step.n}, median ${"%,d".format(step.deviceP50)} ms." + (if (others.isNotEmpty()) " $others." else ""))
    }

    /** Routes that name a model per step, in the same format as routewise_policy_android. */
    fun modelPolicyJson(choices: List<ModelChoice>): String {
        val tasks = JSONObject()
        choices.forEach { ch ->
            tasks.put(ch.id, JSONObject().put("mode", ch.step.mode.name).put("maxWords", JSONObject.NULL).put("sensitive", ch.id in Policy.READS_RAW_TICKET).put("model", ch.model.name))
        }
        val names = choices.map { it.model }.distinct().sortedBy { it.ordinal }.joinToString(" and ") { it.model }
        return JSONObject()
            .put("version", 1)
            .put("createdAt", Instant.now().toString())
            .put("measuredOn", "${device()}, $names")
            .put("onDeviceModel", "PER_STEP")
            .put("cloudModel", Ai.CLOUD_MODEL)
            .put("tasks", tasks)
            .toString()
    }

    /** Saves the per-step routes where adb can read them. */
    fun saveChoice(context: android.content.Context, json: String) {
        try {
            val dir = context.getExternalFilesDir(null) ?: return
            java.io.File(dir, "routewise_policy_android_models.json").writeText(json)
        } catch (e: Exception) {
            android.util.Log.w(Ai.TAG, "could not save the model routes", e)
        }
    }
}
