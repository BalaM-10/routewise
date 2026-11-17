package com.routewise.shopdesk

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A fictional support ticket with known answers. Every name, email, phone number and address is invented. */
data class Ticket(
    val text: String,
    val category: String,
    val orderId: String?,
    val product: String?,
    val pii: List<String>,
)

/** A fictional order, as a shop's order system would return it. Contains no personal details. */
data class Order(
    val id: String,
    val product: String,
    val status: String,
    val placed: String,
    val total: Double,
    val shipped: String?,
    val carrier: String?,
    val tracking: String?,
    val delivered: String?,
    val returnReceived: String?,
    val refund: String?,
    val note: String?,
)

/** A ticket in the Shopdesk inbox. */
data class InboxTicket(val id: String, val who: String, val text: String)

/** How replies should sound. Kept on the phone only. */
data class Voice(val shop: String, val signOff: String, val tone: String) {
    companion object {
        val DEFAULT = Voice("Hearth & Grain", "The Hearth & Grain team", "warm")
    }
}

/**
 * The same tickets and orders as the web app: the build reads packages/core/src/data directly,
 * so both platforms are tested on identical data.
 */
object Data {
    lateinit var tickets: List<Ticket>
        private set
    lateinit var orders: List<Order>
        private set

    fun load(context: Context) {
        fun read(name: String) = context.assets.open(name).bufferedReader().use { it.readText() }
        fun JSONObject.str(key: String): String? = if (isNull(key) || !has(key)) null else getString(key)

        val t = JSONArray(read("tickets.json"))
        tickets = (0 until t.length()).map { i ->
            val o = t.getJSONObject(i)
            val pii = o.getJSONArray("pii")
            Ticket(o.getString("text"), o.getString("category"), o.str("orderId"), o.str("product"), (0 until pii.length()).map(pii::getString))
        }
        val r = JSONArray(read("orders.json"))
        orders = (0 until r.length()).map { i ->
            val o = r.getJSONObject(i)
            Order(
                o.getString("id"), o.getString("product"), o.getString("status"), o.getString("placed"), o.getDouble("total"),
                o.str("shipped"), o.str("carrier"), o.str("tracking"), o.str("delivered"), o.str("returnReceived"), o.str("refund"), o.str("note"),
            )
        }
    }

    /** The customer's name, for the inbox. */
    fun nameOf(pii: List<String>): String = pii.firstOrNull { '@' !in it && it.none(Char::isDigit) } ?: "Customer"

    private val FOLLOW_UPS = listOf(
        "Agent: Thanks for reaching out. I have opened a case and asked the warehouse team to look into it. Could you confirm the best time to contact you?",
        "Customer: Any time after 5pm works. I would also like to know whether this affects my other open order, which I placed the following week.",
        "Agent: I checked the second order and it is on schedule. For the first one, the carrier says the parcel was scanned at the regional hub but missed the onward truck.",
        "Customer: That is frustrating, this is the second time this has happened with this carrier. Is there a way to choose a different courier in future?",
        "Agent: I understand. I have added a note to your account to prefer the alternative courier, and I have applied a discount code to your next purchase as an apology.",
        "Customer: Thank you. If the parcel does not arrive by Friday I would rather have a refund than a replacement, because I needed it for an event this weekend.",
        "Agent: Noted. I have set a reminder for Friday morning. If tracking has not moved by then I will process the refund without you needing to contact us again.",
        "Customer: One more thing, the confirmation email showed the wrong apartment number. Can you make sure the courier has the correct one?",
    )

    fun words(text: String) = text.trim().split(Regex("\\s+")).count { it.isNotEmpty() }

    /** A support thread of roughly [target] words, starting from a real ticket. */
    fun buildThread(ticket: Ticket, target: Int): String {
        val parts = mutableListOf("Customer: ${ticket.text}")
        var i = 0
        while (words(parts.joinToString("\n")) < target) parts += FOLLOW_UPS[i++ % FOLLOW_UPS.size]
        return parts.joinToString("\n")
    }

    /** The same morning inbox as the web app: tidy and messy tickets, one shouting, one not about an order, and a long thread. */
    fun samples(): List<InboxTicket> =
        listOf(0, 1, 2, 3, 16, 19, 24, 25, 47).map { n -> InboxTicket("s$n", nameOf(tickets[n].pii), tickets[n].text) } +
            InboxTicket("thread", "Marcus Bell", buildThread(tickets[0], 1200))

    /** The order number in a ticket, found by plain pattern matching (for example #B2210 or H-2291). */
    fun orderIdIn(text: String): String? = Regex("#?\\b([A-Z]-?\\d{4})\\b", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.uppercase()

    private fun key(id: String) = id.uppercase().filter(Char::isLetterOrDigit)

    /** Plain lookup, no model involved: the order a ticket refers to, if the shop has it. */
    fun findOrder(id: String?): Order? = id?.let { orders.firstOrNull { o -> key(o.id) == key(it) } }

    private val DATE = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
    private fun fmt(d: String) = LocalDate.parse(d).format(DATE)

    /** The facts the shop's order system holds, as short lines, worded exactly as on the web. */
    fun orderFacts(o: Order): List<String> {
        val lines = mutableListOf("Order ${o.id}: ${o.product}, $${String.format(Locale.US, "%.2f", o.total)}, placed ${fmt(o.placed)}.", "Status: ${o.status}.")
        if (o.shipped != null) lines += "Shipped ${fmt(o.shipped)}${o.carrier?.let { " by $it" } ?: ""}${o.tracking?.let { ", tracking $it" } ?: ""}."
        else if (o.carrier != null) lines += "Carrier: ${o.carrier}${o.tracking?.let { ", tracking $it" } ?: ""}."
        o.delivered?.let { lines += "Delivered ${fmt(it)}." }
        o.returnReceived?.let { lines += "Return received ${fmt(it)}." }
        o.note?.let { lines += "Note: $it" }
        o.refund?.let { lines += "Refund: $it." }
        return lines
    }

    /** What the cloud receives for a reply: the masked ticket, the order facts and the shop's voice. */
    fun composeReplyInput(maskedTicket: String, facts: List<String>, voice: Voice?): String {
        val parts = mutableListOf(maskedTicket)
        if (facts.isNotEmpty()) parts += "ORDER FACTS (from the shop's order system):\n" + facts.joinToString("\n") { "- $it" }
        if (voice != null) {
            val tone = when (voice.tone) { "formal" -> "formal and courteous"; "brief" -> "brief and to the point"; else -> "warm and friendly" }
            parts += "SHOP VOICE: write for ${voice.shop}, in a $tone tone, and sign off as \"${voice.signOff}\"."
        }
        return parts.joinToString("\n\n")
    }
}
