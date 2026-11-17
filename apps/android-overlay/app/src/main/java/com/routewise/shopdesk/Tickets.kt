package com.routewise.shopdesk

import android.content.Context
import org.json.JSONArray

/** Fictional support tickets with known answers. Every person, email, phone and address is invented. */
data class Ticket(
    val text: String,
    val category: String,
    val orderId: String?,
    val product: String?,
    val pii: List<String>,
)

/**
 * Loaded once at start-up from assets/tickets.json, the same file the web app uses
 * (packages/core/src/data/tickets.json), so both platforms are tested on identical tickets.
 */
lateinit var TICKETS: List<Ticket>
    private set

fun loadTickets(context: Context) {
    val arr = JSONArray(context.assets.open("tickets.json").bufferedReader().use { it.readText() })
    TICKETS = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        val pii = o.getJSONArray("pii")
        Ticket(
            text = o.getString("text"),
            category = o.getString("category"),
            orderId = if (o.isNull("orderId")) null else o.getString("orderId"),
            product = if (o.isNull("product")) null else o.getString("product"),
            pii = (0 until pii.length()).map(pii::getString),
        )
    }
}

/** The customer's name, for the inbox. */
fun Ticket.who(): String = pii.firstOrNull { '@' !in it && it.none(Char::isDigit) } ?: "Customer"
