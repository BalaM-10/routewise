package com.routewise.shopdesk

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONArray

data class Consent(val taskId: String, val reason: String, val answer: CompletableDeferred<Boolean>)

/** Order details for one ticket: running, or read with the step that read them. */
data class OrderRead(val step: Step?, val fields: Map<String, String>?)

/** A reply or summary for one ticket, through the private cloud flow. */
sealed interface Draft {
    val kind: String

    data class Finding(override val kind: String) : Draft
    data class Review(
        override val kind: String,
        val find: Step?,
        val entities: List<Entity>,
        val masked: Masked,
        val facts: List<String>,
        val input: String,
        /** No on-device model could look for names and addresses; emails and phone numbers were found by rules. */
        val rulesOnly: Boolean,
    ) : Draft
    data class Writing(override val kind: String, val review: Review) : Draft
    data class Done(override val kind: String, val review: Review, val write: Step, val text: String) : Draft
    data class Stopped(override val kind: String, val message: String) : Draft
}

/**
 * Everything Shopdesk holds for this visit. Lives at the top of the app, so switching tabs keeps
 * the sorted inbox, order details and drafts. Tickets are never stored; the shop voice and the
 * resolved list are kept on the phone.
 */
class AppState(context: Context) {
    private val prefs = context.getSharedPreferences("shopdesk", Context.MODE_PRIVATE)

    /** The Gemini Nano category the owner chose on the Calibrate tab; kept on the phone. */
    var nano by mutableStateOf(Nano.entries.firstOrNull { it.name == prefs.getString("nano", null) } ?: Nano.PREVIEW)
        private set

    init {
        Ai.nano = nano
    }

    /** Switches the on-device model and checks whether AICore has it. */
    suspend fun chooseNano(n: Nano) {
        if (n == nano) return
        nano = n
        Ai.nano = n
        prefs.edit().putString("nano", n.name).apply()
        status = "CHECKING"
        status = Ai.status()
    }

    var policy by mutableStateOf<LoadedPolicy?>(null)
    var status by mutableStateOf("CHECKING")
    var routesNote by mutableStateOf("")

    /** One decision per visit when the phone has no on-device model: null means not asked yet. */
    var cloudOk by mutableStateOf<Boolean?>(null)
    /** Requests waiting for the owner, answered one at a time; several steps can ask at once. */
    val consents = mutableStateListOf<Consent>()

    /** Answers the first waiting request, or every waiting request and the rest of the visit. */
    fun answerConsent(ok: Boolean, forVisit: Boolean) {
        if (forVisit) {
            cloudOk = ok
            consents.toList().forEach { it.answer.complete(ok) }
            consents.clear()
        } else {
            consents.removeFirstOrNull()?.answer?.complete(ok)
        }
    }

    val inbox = mutableStateListOf<InboxTicket>().apply { addAll(Data.samples()) }
    val sorting = mutableStateListOf<String>()
    val labels = mutableStateMapOf<String, Step>()
    val orders = mutableStateMapOf<String, OrderRead>()
    val drafts = mutableStateMapOf<String, Draft>()
    /** Drafts the owner cancelled at review: the details were found on the phone and nothing was sent. */
    val declined = mutableStateMapOf<String, Draft.Review>()
    val log = mutableStateListOf<Step>()
    var hiddenCount by mutableIntStateOf(0)

    val resolved = mutableStateListOf<String>().apply {
        val raw = prefs.getString("resolved", "[]") ?: "[]"
        val arr = JSONArray(raw)
        addAll((0 until arr.length()).map(arr::getString))
    }
    var voice by mutableStateOf(
        Voice(
            prefs.getString("voice.shop", null) ?: Voice.DEFAULT.shop,
            prefs.getString("voice.signOff", null) ?: Voice.DEFAULT.signOff,
            prefs.getString("voice.tone", null) ?: Voice.DEFAULT.tone,
        ),
    )

    val deviceReady get() = Ai.ready(status)
    val mayRun get() = deviceReady || cloudOk == true

    /** Steps that read the ticket as written; if any ran in the cloud, the visit did send personal details there. */
    val rawToCloud get() = log.any { s -> s.taskId in Policy.READS_RAW_TICKET && s.answer.let { it != null && it.ok && !it.onDevice } }

    private var router: Router? = null
    private var routerKey: Any? = null

    fun router(): Router? {
        val p = policy ?: return null
        val key = p to status
        if (key != routerKey) {
            routerKey = key
            router = Router(
                routes = p.routes,
                deviceReady = deviceReady,
                askConsent = { id, reason ->
                    cloudOk ?: run {
                        val d = CompletableDeferred<Boolean>()
                        consents += Consent(id, reason, d)
                        d.await()
                    }
                },
                onStep = { log.add(0, it) },
            )
        }
        return router
    }

    fun key(ticketId: String, kind: String) = "$ticketId:$kind"
    fun ticket(id: String) = inbox.first { it.id == id }

    suspend fun sortNext(): Boolean {
        val r = router() ?: return false
        if (!mayRun) return false
        val next = inbox.firstOrNull { it.id !in labels && it.id !in sorting } ?: return false
        sorting += next.id
        labels[next.id] = r.run("triage", next.text)
        sorting -= next.id
        return true
    }

    suspend fun readOrder(id: String) {
        val r = router() ?: return
        if (id in orders || !mayRun) return
        orders[id] = OrderRead(null, null)
        val step = r.run("extract", ticket(id).text)
        val o = step.answer?.takeIf { it.ok }?.text?.let(Json::obj)
        orders[id] = OrderRead(step, o?.let { mapOf("order_id" to it.optString("order_id"), "product" to it.optString("product"), "issue" to it.optString("issue")) })
    }

    /** The order facts sent with a reply: found by plain lookup on the order number, no model involved. */
    private fun factsFor(t: InboxTicket): List<String> {
        val id = orders[t.id]?.fields?.get("order_id")?.takeIf { it.isNotBlank() && it != "null" } ?: Data.orderIdIn(t.text)
        return Data.findOrder(id)?.let(Data::orderFacts) ?: emptyList()
    }

    private fun build(kind: String, t: InboxTicket, find: Step?, entities: List<Entity>, rulesOnly: Boolean): Draft.Review {
        val masked = Mask.mask(t.text, entities)
        val facts = if (kind == "reply") factsFor(t) else emptyList()
        val input = if (kind == "reply") Data.composeReplyInput(masked.text, facts.map { Mask.maskWith(it, masked.map) }, voice) else masked.text
        return Draft.Review(kind, find, entities, masked, facts, input, rulesOnly)
    }

    suspend fun startDraft(id: String, kind: String) {
        val r = router() ?: return
        val k = key(id, kind)
        declined.remove(k)
        drafts[k] = Draft.Finding(kind)
        val t = ticket(id)
        val find = r.run("pii", t.text)
        // An answer that is not the expected JSON counts as no answer: the owner reviews and adds details by hand.
        val parsed = if (find.blocked || find.answer?.ok != true) null else Mask.tryParseEntities(find.answer!!.text)
        val rulesOnly = parsed == null
        val found = parsed ?: emptyList()
        drafts[k] = build(kind, t, find, Mask.merge(found, Mask.detectWithRules(t.text)), rulesOnly)
    }

    fun hideExtra(id: String, kind: String, value: String) {
        val k = key(id, kind)
        val d = drafts[k] as? Draft.Review ?: return
        val v = value.trim()
        if (v.length < 2) return
        drafts[k] = build(kind, ticket(id), d.find, Mask.merge(d.entities, listOf(Entity(Mask.guessHiddenType(v), v))), d.rulesOnly)
    }

    suspend fun write(id: String, kind: String) {
        val r = router() ?: return
        val k = key(id, kind)
        val d = drafts[k] as? Draft.Review ?: return
        drafts[k] = Draft.Writing(kind, d)
        val step = r.run(kind, d.input)
        val a = step.answer
        drafts[k] = if (a != null && a.ok) {
            hiddenCount += d.masked.hidden.size
            Draft.Done(kind, d, step, Mask.unmask(a.text, d.masked.map))
        } else {
            Draft.Stopped(kind, "The cloud request failed: ${a?.error ?: step.reason}")
        }
    }

    fun cancel(id: String, kind: String) {
        val k = key(id, kind)
        (drafts.remove(k) as? Draft.Review)?.let { declined[k] = it }
    }

    fun toggleResolved(id: String) {
        if (id in resolved) resolved -= id else resolved += id
        prefs.edit().putString("resolved", JSONArray(resolved.toList()).toString()).apply()
    }

    fun saveVoice(v: Voice) {
        voice = v
        prefs.edit().putString("voice.shop", v.shop).putString("voice.signOff", v.signOff).putString("voice.tone", v.tone).apply()
    }
}
