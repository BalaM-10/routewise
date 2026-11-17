package com.routewise.shopdesk

/** One routed step, with where it ran and why. */
data class Step(
    val taskId: String,
    val answer: Answer?,
    val mode: Mode,
    val reason: String,
    val blocked: Boolean = false,
    val escalated: Boolean = false,
    /** The on-device model that answered, when the answer came from the phone. */
    val model: Nano? = null,
    val at: Long = System.currentTimeMillis(),
)

/**
 * Applies the published routes at run time, with the same rules as packages/core/src/router.ts:
 * length limit, on-device availability, consent before personal data leaves the phone, a cloud retry
 * when an on-device answer fails, and a 30-second limit on any one step.
 */
class Router(
    private val routes: Map<String, Route>,
    private val deviceReady: Boolean,
    private val askConsent: suspend (taskId: String, reason: String) -> Boolean,
    private val onStep: (Step) -> Unit,
) {
    private val text = mapOf(
        Mode.PREFER_ON_DEVICE to "phone first",
        Mode.ONLY_ON_DEVICE to "phone only",
        Mode.PREFER_IN_CLOUD to "cloud first",
        Mode.ONLY_IN_CLOUD to "cloud only",
    )

    fun routeOf(taskId: String): Route = (routes[taskId] ?: Policy.DEFAULTS.getValue(taskId)).let { r ->
        // Steps that read the raw ticket always handle personal data, whatever an older policy says.
        if (taskId in Policy.READS_RAW_TICKET) r.copy(sensitive = true) else r
    }

    suspend fun run(taskId: String, input: String): Step {
        val route = routeOf(taskId)
        var mode = if (route.sensitive && route.mode == Mode.PREFER_ON_DEVICE) Mode.ONLY_ON_DEVICE else route.mode
        var reason = "Policy says ${text[mode]}."
        val words = Data.words(input)

        if (route.maxWords != null && words > route.maxWords && mode != Mode.ONLY_IN_CLOUD) {
            mode = Mode.ONLY_IN_CLOUD
            reason = "$words words is over the ${route.maxWords}-word limit on this phone, so it went to the cloud."
        }
        if ((mode == Mode.ONLY_ON_DEVICE || mode == Mode.PREFER_ON_DEVICE) && !deviceReady) {
            mode = Mode.ONLY_IN_CLOUD
            reason = "Gemini Nano is not ready on this phone."
        }
        if (taskId in Policy.NEVER_CLOUD && (mode == Mode.ONLY_IN_CLOUD || mode == Mode.PREFER_IN_CLOUD)) {
            return done(Step(taskId, null, mode, "$reason This step only runs on the phone, so nothing was sent; fixed rules looked for emails and phone numbers instead.", blocked = true))
        }
        // "Cloud first" sends the ticket to the cloud too, so it asks just like "cloud only", as on the web.
        if (route.sensitive && (mode == Mode.ONLY_IN_CLOUD || mode == Mode.PREFER_IN_CLOUD) && !askConsent(taskId, reason)) {
            return done(Step(taskId, null, mode, "$reason The customer's details stayed on this phone.", blocked = true))
        }

        val prompt = Tasks.prompt(taskId, input)
        val model = route.model ?: Ai.nano
        var answer = Ai.generate(mode, prompt, n = model)
        // Android only lets the app in front use Gemini Nano. Being in the background is not a failed answer,
        // so it never leads to the cloud: wait for the app to come back (up to two minutes) and ask again.
        var waited = 0
        while (answer.error?.contains("Background usage is blocked", ignoreCase = true) == true && waited < 60) {
            kotlinx.coroutines.delay(2_000)
            waited++
            answer = Ai.generate(mode, prompt, n = model)
        }
        if (answer.error?.contains("Background usage is blocked", ignoreCase = true) == true) {
            return done(Step(taskId, null, mode, "Shopdesk was in the background, so Gemini Nano could not answer. Nothing was sent.", blocked = true))
        }
        // A route can name a model this phone does not have. Try the phone's own model before anything else.
        var used = model
        if (!answer.ok && answer.error?.contains("Background usage is blocked", ignoreCase = true) != true &&
            model != Ai.nano && (mode == Mode.ONLY_ON_DEVICE || mode == Mode.PREFER_ON_DEVICE)) {
            val again = Ai.generate(mode, prompt, n = Ai.nano)
            if (again.ok) {
                answer = again.copy(ms = again.ms + answer.ms)
                used = Ai.nano
                reason = "$reason ${model.label} did not answer on this phone, so ${Ai.nano.label} did."
            }
        }
        var escalated = false
        val onDeviceRoute = mode == Mode.ONLY_ON_DEVICE || mode == Mode.PREFER_ON_DEVICE
        val missed = (answer.ok && answer.onDevice && !Tasks.valid(taskId, answer.text)) || (!answer.ok && onDeviceRoute)
        if (missed && taskId in Policy.NEVER_CLOUD) {
            val why = if (answer.ok) "The phone's answer failed the format check." else "Gemini Nano did not answer (${answer.error})."
            return done(Step(taskId, answer, mode, "$why This step only runs on the phone, so nothing was sent; fixed rules looked for emails and phone numbers instead.", model = used))
        }
        if (missed) {
            val why = if (answer.ok) "The phone's answer failed the format check, so it was retried in the cloud." else "Gemini Nano did not answer (${answer.error}), so it was retried in the cloud."
            if (route.sensitive && !askConsent(taskId, why)) {
                return done(Step(taskId, null, mode, "$why The customer's details stayed on this phone.", blocked = true))
            }
            val retry = Ai.generate(Mode.ONLY_IN_CLOUD, prompt)
            answer = retry.copy(ms = retry.ms + answer.ms)
            escalated = true
            reason = why
        }
        return done(Step(taskId, answer, mode, reason, escalated = escalated, model = if (answer.onDevice) used else null))
    }

    private fun done(s: Step): Step { onStep(s); return s }
}
