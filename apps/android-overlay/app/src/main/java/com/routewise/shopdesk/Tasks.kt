package com.routewise.shopdesk

/**
 * The AI steps Shopdesk uses, with the same instructions as the web app. On Android the
 * on-device structured-output API needs generated schema classes, so these prompts ask for
 * JSON in words and the answers are checked here; calibration measures how often that works.
 */
object Tasks {
    val LABELS = listOf("shipping", "refund", "product", "account", "other")

    val NAMES = mapOf(
        "triage" to "Triage the ticket",
        "extract" to "Extract order details",
        "pii" to "Find personal details",
        "reply" to "Draft a reply",
        "summary" to "Summarize the thread",
    )

    /** Slowest acceptable p90 latency per step, as on the web. */
    val BUDGET_MS = mapOf("triage" to 2000L, "extract" to 4000L, "pii" to 6000L)

    private val INSTRUCTIONS = mapOf(
        "triage" to "Classify this support ticket by the customer's main request, as exactly one of: shipping (delivery, tracking or where an order is), refund (the customer asks for money back, a return, or a wrong or double charge to be fixed), product (questions or problems with a product, without asking for money back), account (login, password, profile, saved details, email preferences or account security), other (anything else, such as wholesale, press, gift cards, compliments or empty messages). Reply with the single word only.",
        "extract" to "Extract the order id (without #), the product and a short issue description from this support ticket. Use an empty string when a value is not present. Reply with only JSON in this shape: {\"order_id\": string, \"product\": string, \"issue\": string}",
        "pii" to "List every personal detail in this support ticket: names of people, email addresses, phone numbers and street addresses. Copy each value exactly as written. Reply with only JSON in this shape: {\"items\": [{\"type\": \"name\" or \"email\" or \"phone\" or \"address\", \"value\": string}]}",
        "reply" to "Write a short, friendly reply from the support agent to this ticket (at most 120 words). Personal details are replaced by placeholders such as [NAME 1]; keep any placeholder you use exactly as written. Do not promise anything the ticket does not justify. Reply with the message only.",
        "summary" to "Summarize this support conversation in at most two sentences for the next agent. Reply with the summary only.",
    )

    fun prompt(taskId: String, input: String) = "${INSTRUCTIONS.getValue(taskId)}\n\n---\n$input\n---"

    fun label(text: String) = text.lowercase().filter(Char::isLetter)

    private fun words(text: String) = text.trim().split(Regex("\\s+")).count { it.isNotEmpty() }

    /** Format check: is this answer usable by the app at all? */
    fun valid(taskId: String, text: String): Boolean = when (taskId) {
        "triage" -> label(text) in LABELS
        "extract" -> Json.obj(text)?.let { o -> listOf("order_id", "product", "issue").all(o::has) } == true
        "pii" -> Json.obj(text)?.optJSONArray("items") != null
        "reply" -> text.isNotBlank() && words(text) <= 150
        "summary" -> text.isNotBlank() && words(text) <= 70
        else -> text.isNotBlank()
    }

    private fun norm(s: String?) = s.orEmpty().lowercase().filter(Char::isLetterOrDigit)

    /** Score against the known answer: true when the answer would be acceptable to ship. */
    fun correct(taskId: String, text: String, t: Ticket): Boolean = when (taskId) {
        "triage" -> label(text) == t.category
        "extract" -> {
            val o = Json.obj(text)
            fun match(key: String, want: String?): Boolean {
                val got = o?.optString(key).orEmpty().let { if (it == "null") "" else it }
                return if (want == null) norm(got).isEmpty() else norm(got).let { it.isNotEmpty() && (it.contains(norm(want)) || norm(want).contains(it)) }
            }
            o != null && match("order_id", t.orderId) && match("product", t.product)
        }
        "pii" -> {
            // Would any personal detail reach the cloud if the app masked with what was found?
            val entities = Mask.merge(Mask.parseEntities(text), Mask.detectWithRules(t.text))
            Mask.leaked(Mask.mask(t.text, entities).text, t.pii).isEmpty()
        }
        else -> false
    }
}
