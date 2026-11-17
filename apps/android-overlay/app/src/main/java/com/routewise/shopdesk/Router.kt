package com.routewise.shopdesk

/** One routed step, with where it ran and why. */
data class Step(
    val taskId: String,
    val answer: Answer?,
    val mode: Mode,
    val reason: String,
    val blocked: Boolean = false,
    val escalated: Boolean = false,
)

/**
 * Applies the published routes at run time, the same rules as packages/core/src/router.ts:
 * length limit, on-device availability, consent before personal data leaves the phone,
 * and a cloud retry when an on-device answer fails its format check.
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

    suspend fun run(taskId: String, input: String): Step {
        val route = (routes[taskId] ?: Policy.DEFAULTS.getValue(taskId)).let { r ->
            // Steps that read the raw ticket always handle personal data, whatever an older policy says.
            if (taskId in Policy.READS_RAW_TICKET) r.copy(sensitive = true) else r
        }
        var mode = if (route.sensitive && route.mode == Mode.PREFER_ON_DEVICE) Mode.ONLY_ON_DEVICE else route.mode
        var reason = "Route: ${text[mode]}."
        val words = input.trim().split(Regex("\\s+")).size

        if (route.maxWords != null && words > route.maxWords && mode != Mode.ONLY_IN_CLOUD) {
            mode = Mode.ONLY_IN_CLOUD
            reason = "$words words is over the ${route.maxWords}-word limit for this phone, so it went to the cloud."
        }
        if (mode == Mode.ONLY_ON_DEVICE && !deviceReady) {
            mode = Mode.ONLY_IN_CLOUD
            reason = "Gemini Nano is not ready on this phone."
        }
        if (route.sensitive && (mode == Mode.ONLY_IN_CLOUD || mode == Mode.PREFER_IN_CLOUD) && !askConsent(taskId, reason)) {
            return done(Step(taskId, null, mode, "$reason The customer's details stayed on this phone.", blocked = true))
        }

        val prompt = Tasks.prompt(taskId, input)
        var answer = Ai.generate(mode, prompt)
        var escalated = false
        val missed = (answer.ok && answer.onDevice && !Tasks.valid(taskId, answer.text)) || (!answer.ok && (mode == Mode.ONLY_ON_DEVICE || mode == Mode.PREFER_ON_DEVICE))
        if (missed) {
            val why = if (answer.ok) "The phone's answer failed the format check, so it was retried in the cloud." else "Gemini Nano failed, so it was retried in the cloud."
            if (route.sensitive && !askConsent(taskId, why)) {
                return done(Step(taskId, null, mode, "$why The customer's details stayed on this phone.", blocked = true))
            }
            val retry = Ai.generate(Mode.ONLY_IN_CLOUD, prompt)
            answer = retry.copy(ms = retry.ms + answer.ms)
            escalated = true
            reason = why
        }
        return done(Step(taskId, answer, mode, reason, escalated = escalated))
    }

    private fun done(s: Step): Step { onStep(s); return s }
}
