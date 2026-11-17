package com.routewise.shopdesk

/**
 * The AI steps Shopdesk uses, with the same instructions as the web app (packages/core/src/tasks.ts).
 * On Android, on-device structured output needs generated schema classes, so the JSON steps add
 * the expected shape in words and every answer is checked here; calibration measures how often that works.
 */
object Tasks {
    val LABELS = listOf("shipping", "refund", "product", "account", "other")

    val NAMES = linkedMapOf(
        "triage" to "Triage the ticket",
        "extract" to "Extract order details",
        "pii" to "Find personal details",
        "reply" to "Draft a reply",
        "summary" to "Summarize the thread",
    )

    /** Slowest acceptable p90 latency per step, as on the web. */
    val BUDGET_MS = mapOf("triage" to 2000L, "extract" to 4000L, "pii" to 6000L, "reply" to 10000L, "summary" to 8000L)

    private val INSTRUCTIONS = mapOf(
        "triage" to "Classify this support ticket by the customer's main request, as exactly one of: shipping (delivery, tracking or where an order is), refund (the customer asks for money back, a return, or a wrong or double charge to be fixed), product (questions or problems with a product, without asking for money back), account (login, password, profile, saved details, email preferences or account security), other (anything else, such as wholesale, press, gift cards, compliments or empty messages).",
        "extract" to "Extract the order id (without #), the product and a short issue description from this support ticket. Use an empty string when a value is not present.",
        "pii" to "List every personal detail in this support ticket: names of people, email addresses, phone numbers and street addresses. Copy each value exactly as written.",
        "reply" to "Write a short, friendly reply from the support agent to this ticket (at most 120 words). Personal details are replaced by placeholders such as [NAME 1]; keep any placeholder you use exactly as written. If order facts are given, rely only on them for status, dates and refunds, and promise nothing beyond them: keep their conditions and wording (if they say eligible for a refund by a date, say exactly that, not a full or guaranteed refund). Reply with the message only.",
        "summary" to "Summarize this support conversation in at most two sentences for the next agent. Reply with the summary only.",
    )

    /** The answer format, said in words because the phone has no schema for these steps. */
    private val FORMAT = mapOf(
        "triage" to "Reply with the single word only.",
        "extract" to "Reply with only JSON in this shape: {\"order_id\": string, \"product\": string, \"issue\": string}",
        "pii" to "Reply with only JSON in this shape: {\"items\": [{\"type\": \"name\" or \"email\" or \"phone\" or \"address\", \"value\": string}]}",
    )

    /** Instruction, then the input between separators: the same layout as the web's buildPrompt. */
    fun prompt(taskId: String, input: String) =
        listOfNotNull(INSTRUCTIONS.getValue(taskId), FORMAT[taskId]).joinToString(" ") + "\n\n---\n" + input + "\n---"

    fun label(text: String) = text.lowercase().filter(Char::isLetter)

    /** Format check: is this answer usable by the app at all? */
    fun valid(taskId: String, text: String): Boolean = when (taskId) {
        "triage" -> label(text) in LABELS
        "extract" -> Json.obj(text)?.let { o -> listOf("order_id", "product", "issue").all(o::has) } == true
        "pii" -> Json.obj(text)?.optJSONArray("items") != null
        "reply" -> text.isNotBlank() && Data.words(text) <= 150
        "summary" -> text.isNotBlank() && Data.words(text) <= 70
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
                // An order number must match exactly ("B2210", not "2210"); a product may be named more or less fully.
                return when {
                    want == null -> norm(got).isEmpty()
                    key == "order_id" -> norm(got) == norm(want)
                    else -> norm(got).let { it.isNotEmpty() && (it.contains(norm(want)) || norm(want).contains(it)) }
                }
            }
            o != null && match("order_id", t.orderId) && match("product", t.product)
        }
        "pii" -> {
            // Would any personal detail reach the cloud if the app masked with what was found?
            val entities = Mask.merge(Mask.parseEntities(text), Mask.detectWithRules(t.text))
            val out = Mask.mask(t.text, entities).text
            // A full name counts as leaked if any word of it is still there on its own ("Thanks, Marcus").
            val fullName = Regex("^\\p{Lu}[\\p{L}'-]+(\\s+\\p{Lu}[\\p{L}'-]+)+$")
            val partLeft = t.pii.filter { fullName.matches(it) }.flatMap { it.split(Regex("\\s+")) }
                .any { p ->
                    val bounded = "(?<![\\p{L}\\p{N}])${Regex.escape(p)}(?![\\p{L}\\p{N}])"
                    (if (p.length >= 3) Regex(bounded, RegexOption.IGNORE_CASE) else Regex(bounded)).containsMatchIn(out)
                }
            Mask.leaked(out, t.pii).isEmpty() && !partLeft
        }
        else -> false
    }
}
