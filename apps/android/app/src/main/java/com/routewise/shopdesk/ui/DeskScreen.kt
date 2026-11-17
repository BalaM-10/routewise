@file:OptIn(ExperimentalLayoutApi::class)

package com.routewise.shopdesk.ui

import androidx.compose.foundation.layout.FlowRow

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.routewise.shopdesk.AppState
import com.routewise.shopdesk.Data
import com.routewise.shopdesk.Draft
import com.routewise.shopdesk.EntityType
import com.routewise.shopdesk.InboxTicket
import com.routewise.shopdesk.Mask
import com.routewise.shopdesk.Mode
import com.routewise.shopdesk.Policy
import com.routewise.shopdesk.Step
import com.routewise.shopdesk.Tasks
import com.routewise.shopdesk.Voice
import kotlinx.coroutines.launch

private val LABEL_TEXT = mapOf("shipping" to "Shipping", "refund" to "Refund", "product" to "Product", "account" to "Account", "other" to "Other")
private const val LONG = 250

@Composable
fun DeskScreen(state: AppState, openId: String?, onOpen: (String?) -> Unit, onWhy: (String) -> Unit) {
    // Tickets are sorted one at a time as the inbox loads, and again whenever the routes or the model change.
    LaunchedEffect(state.policy, state.status, state.cloudOk) {
        while (state.sortNext()) Unit
    }
    if (openId != null) {
        BackHandler { onOpen(null) }
        TicketScreen(state, openId, onBack = { onOpen(null) }, onWhy = onWhy)
    } else {
        Inbox(state, onOpen)
    }
}

@Composable
private fun Inbox(state: AppState, onOpen: (String) -> Unit) {
    var view by remember { mutableStateOf("open") }
    var editingVoice by remember { mutableStateOf(false) }
    val c = P.c
    val visible = state.inbox.filter { (view == "resolved") == (it.id in state.resolved) }
    val onPhone = state.log.count { s -> s.answer.let { it != null && it.ok && it.onDevice } }
    val inCloud = state.log.count { s -> s.answer.let { it != null && it.ok && !it.onDevice } }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item(key = "head") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 4.dp)) {
                Text("Shopdesk", style = MaterialTheme.typography.headlineLarge, color = c.ink)
                Note("The example app for Routewise. Tickets are sorted and read on this phone; replies are written in the cloud with the customer's name, email, phone number and address replaced, and you see exactly what is sent.")
                Muted(listOf(state.policy?.source ?: "Loading routes", state.routesNote).map { it.trim().removeSuffix(".") }.filter { it.isNotBlank() }.joinToString(". ") + ".")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Muted("Replies are written for ${state.voice.shop}. ")
                    Text(
                        "Change shop voice", color = c.cloud, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.clickable(onClickLabel = "Change shop voice") { editingVoice = true },
                    )
                }
            }
        }
        if (!state.deviceReady && state.status != "CHECKING" && state.cloudOk == null) {
            item(key = "decision") { Decision(state) }
        }
        if (!state.deviceReady && state.cloudOk == false) {
            item(key = "kept") { Callout("Tickets stay on this phone for this visit. Sorting and order details are off; replies still work, with personal details hidden before sending.", warn = false) }
        }
        item(key = "ledger") {
            Panel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column {
                        Text("$onPhone", color = c.device, style = MaterialTheme.typography.titleLarge)
                        Muted(if (onPhone == 1) "step on this phone" else "steps on this phone")
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("$inCloud", color = c.cloud, style = MaterialTheme.typography.titleLarge)
                        Muted(if (inCloud == 1) "step in the cloud" else "steps in the cloud")
                    }
                }
                SplitBar(onPhone, inCloud)
                val n = state.hiddenCount
                Muted(
                    if (state.rawToCloud) "$n personal ${if (n == 1) "detail" else "details"} masked before writing; tickets went to the cloud as written for other steps, as you agreed"
                    else "$n personal ${if (n == 1) "detail" else "details"} kept out of the cloud this visit",
                )
            }
        }
        item(key = "views") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                Segment("Open ${state.inbox.count { it.id !in state.resolved }}", view == "open") { view = "open" }
                Segment("Resolved ${state.resolved.count { r -> state.inbox.any { it.id == r } }}", view == "resolved") { view = "resolved" }
            }
        }
        if (visible.isEmpty()) item(key = "empty") { Muted(if (view == "open") "Nothing open. Every ticket is resolved." else "No resolved tickets yet.") }
        items(visible, key = { it.id }) { t -> TicketRow(state, t) { onOpen(t.id) } }
    }

    if (editingVoice) VoiceDialog(state.voice, onSave = { state.saveVoice(it); editingVoice = false }, onDismiss = { editingVoice = false })
}

@Composable
private fun Segment(text: String, selected: Boolean, onClick: () -> Unit) {
    val c = P.c
    Text(
        text, style = MaterialTheme.typography.labelMedium, color = if (selected) c.surface else c.ink2,
        modifier = Modifier.background(if (selected) c.ink else c.surface, RoundedCornerShape(8.dp)).border(1.dp, if (selected) c.ink else c.ruleStrong, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun Decision(state: AppState) {
    val scope = rememberCoroutineScope()
    var progress by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val waiting = state.status == "DOWNLOADING"
    Panel {
        Text(if (state.status == "DOWNLOADABLE" || waiting) "Gemini Nano is not ready on this phone yet" else if (state.nano != com.routewise.shopdesk.Nano.STABLE) "${state.nano.label} is not available on this phone" else "This phone has no on-device model", style = MaterialTheme.typography.titleMedium, color = P.c.ink)
        Note("Sorting tickets and reading order details normally happen on this phone. Without Gemini Nano they need the cloud, which means sending the tickets as written. Replies are always written from text with personal details removed.")
        if (state.status == "UNAVAILABLE" && state.nano != com.routewise.shopdesk.Nano.STABLE) {
            Muted("Gemini Nano 4 needs the AICore developer preview. The Calibrate tab can switch to the standard model.")
        }
        if (state.status == "DOWNLOADABLE" || waiting) {
            PrimaryButton(progress ?: if (waiting) "Downloading Gemini Nano" else "Download Gemini Nano", enabled = progress == null && !waiting) {
                problem = null
                progress = "Starting the download"
                scope.launch {
                    problem = com.routewise.shopdesk.Ai.download { progress = it }
                    // AICore keeps downloading in the background; check every few seconds for up to 20 minutes.
                    var s = com.routewise.shopdesk.Ai.status()
                    state.status = s
                    var checks = 0
                    while (problem == null && s == "DOWNLOADING" && checks < 240) {
                        kotlinx.coroutines.delay(5_000)
                        s = com.routewise.shopdesk.Ai.status(); state.status = s; checks++
                    }
                    android.util.Log.i(com.routewise.shopdesk.Ai.TAG, "download finished with status $s")
                    if (problem == null && s == "DOWNLOADABLE") problem = "AICore did not start the download. Try again on Wi-Fi with the phone charging."
                    progress = null
                }
            }
            if (waiting) Muted("Gemini Nano is a large download. AICore fetches it in the background, usually on Wi-Fi, and this panel closes by itself when it is ready.")
            problem?.let { Callout(it, warn = true) }
        }
        QuietButton("Use the cloud for this visit") { state.cloudOk = true }
        QuietButton("Keep tickets on this phone") { state.cloudOk = false }
    }
}

@Composable
private fun TicketRow(state: AppState, t: InboxTicket, onClick: () -> Unit) {
    val c = P.c
    val l = state.labels[t.id]
    Column(
        Modifier.fillMaxWidth().background(c.surface, Radius).border(1.dp, c.rule, Radius).clickable(onClick = onClick).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(t.who, fontWeight = FontWeight.SemiBold, color = c.ink, style = MaterialTheme.typography.bodyLarge)
            when {
                t.id in state.sorting -> Pill("Sorting", c.ink3, c.sunken)
                l?.answer?.ok == true -> {
                    val a = l.answer!!
                    val label = LABEL_TEXT[Tasks.label(a.text)] ?: Tasks.label(a.text)
                    if (a.onDevice) Pill(label, c.device, c.deviceWash) else Pill(label, c.cloud, c.cloudWash)
                }
                l != null -> Pill(if (l.blocked) "Kept here" else "Not sorted", c.ink3, c.sunken)
            }
        }
        Text(t.text, color = c.ink3, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** The trace for one ticket: each step on the lane where it ran, or where its route will send it. */
private fun trace(state: AppState, t: InboxTicket): Pair<List<Station>, String?> {
    val router = state.router()
    fun planned(id: String): Lane {
        // Without Gemini Nano, a visit that chose the cloud sends every step there.
        if (!state.deviceReady && state.cloudOk == true) return Lane.CLOUD
        val mode = router?.routeOf(id)?.mode ?: Policy.DEFAULTS.getValue(id).mode
        return if (mode == Mode.ONLY_ON_DEVICE || mode == Mode.PREFER_ON_DEVICE) Lane.DEVICE else Lane.CLOUD
    }
    val off = !state.deviceReady && state.cloudOk == false
    fun station(id: String, name: String, step: Step?, running: Boolean): Station {
        val a = step?.answer
        return when {
            running -> Station(id, name, "Running", planned(id), StationState.ACTIVE)
            step == null -> Station(id, name, if (off && id != "pii") "Off this visit" else "Not run yet", planned(id), StationState.PLANNED)
            step.blocked -> Station(id, name, "Kept here", Lane.DEVICE, StationState.KEPT)
            a == null || !a.ok -> Station(id, name, "No answer", planned(id), StationState.PLANNED)
            a.onDevice -> Station(id, name, "${"%,d".format(a.ms)} ms" + (step.model?.let { " on ${it.label}" } ?: ""), Lane.DEVICE, StationState.DONE)
            else -> Station(id, name, "${"%,d".format(a.ms)} ms", Lane.CLOUD, StationState.DONE)
        }
    }
    val draft = state.drafts[state.key(t.id, "reply")] ?: state.drafts[state.key(t.id, "summary")]
    val kind = draft?.kind ?: "reply"
    val declined = if (draft == null) state.declined[state.key(t.id, "reply")] ?: state.declined[state.key(t.id, "summary")] else null
    val review = when (draft) { is Draft.Review -> draft; is Draft.Writing -> draft.review; is Draft.Done -> draft.review; else -> declined }
    val order = state.orders[t.id]
    val find = station("pii", "Find personal details", review?.find, draft is Draft.Finding)
    val stations = listOf(
        station("triage", "Sort", state.labels[t.id], t.id in state.sorting),
        station("extract", "Read the order", order?.step, order != null && order.step == null),
        if (review?.rulesOnly == true) find.copy(detail = "By rules, on this phone", lane = Lane.DEVICE, state = StationState.KEPT) else find,
        if (declined != null) Station(declined.kind, if (declined.kind == "reply") "Write the reply" else "Summarise", "Cancelled, nothing sent", Lane.DEVICE, StationState.KEPT)
        else station(kind, if (kind == "reply") "Write the reply" else "Summarise", (draft as? Draft.Done)?.write, draft is Draft.Writing),
    )
    val cross = stations.indices.firstOrNull { i -> i > 0 && stations[i].lane == Lane.CLOUD && stations[i - 1].lane == Lane.DEVICE }
    // Only the writing step receives masked text; any other crossing would carry the ticket as written.
    return stations to (if (cross == 3) "Personal details removed" else null)
}

@Composable
private fun TicketScreen(state: AppState, id: String, onBack: () -> Unit, onWhy: (String) -> Unit) {
    val c = P.c
    val t = state.ticket(id)
    val scope = rememberCoroutineScope()
    LaunchedEffect(id, state.policy, state.status, state.cloudOk) { state.readOrder(id) }
    val label = state.labels[id]
    val order = state.orders[id]

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LinkButton("Back to inbox", onBack)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(t.who, style = MaterialTheme.typography.headlineLarge, color = c.ink)
            if (id in state.resolved) QuietButton("Reopen") { state.toggleResolved(id) }
        }
        val sorted = label?.answer?.takeIf { it.ok }
        if (sorted != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Muted("Sorted as")
                Text(LABEL_TEXT[Tasks.label(sorted.text)] ?: "", fontWeight = FontWeight.SemiBold, color = c.ink)
                LinkButton("Why?") { onWhy("triage") }
            }
        }
        Panel {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Where this ticket's AI steps run", style = MaterialTheme.typography.titleMedium, color = c.ink)
            }
            val (stations, crossing) = trace(state, t)
            Lanes(stations, crossing, "Where this ticket's AI steps run", onPick = onWhy)
        }
        Text(t.text, color = c.ink, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.fillMaxWidth().background(c.sunken, Radius).border(1.dp, c.rule, Radius).padding(14.dp))
        Muted("${"%,d".format(Data.words(t.text))} words")

        Panel {
            val orderStep = order?.step
            val fields = order?.fields
            when {
                order == null && !state.mayRun -> Muted("Order details are read on this phone, which needs Gemini Nano.")
                orderStep == null -> Muted("Reading order details…")
                fields == null -> Muted("The order details could not be read from this ticket. ${orderStep.answer?.error ?: ""}")
                else -> {
                    Field("Order", fields["order_id"].orEmpty().ifBlank { "None given" })
                    Field("Product", fields["product"].orEmpty().ifBlank { "None given" })
                    Field("Issue", fields["issue"].orEmpty().ifBlank { "Not stated" })
                }
            }
            if (orderStep != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) { Ran(orderStep); LinkButton("Why?") { onWhy("extract") } }
        }

        val busy = state.drafts.values.any { it is Draft.Finding || it is Draft.Writing }
        PrimaryButton("Draft a reply", enabled = !busy) { scope.launch { state.startDraft(id, "reply") } }
        if (Data.words(t.text) > LONG) QuietButton("Summarise the conversation", enabled = !busy) { scope.launch { state.startDraft(id, "summary") } }

        listOf("summary", "reply").forEach { kind -> state.drafts[state.key(id, kind)]?.let { DraftPanel(state, id, it, onWhy) } }
    }
}

@Composable
private fun Field(label: String, value: String) = Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    Muted(label, Modifier.width(64.dp))
    Text(value, color = P.c.ink, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun DraftPanel(state: AppState, id: String, d: Draft, onWhy: (String) -> Unit) {
    val c = P.c
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val title = if (d.kind == "reply") "Reply" else "Summary"
    Panel {
        Text(title, style = MaterialTheme.typography.titleMedium, color = c.ink)
        when (d) {
            is Draft.Finding -> Muted("Finding personal details in the ticket…")
            is Draft.Stopped -> Text(d.message, color = c.signal, style = MaterialTheme.typography.bodyMedium)
            is Draft.Review, is Draft.Writing -> {
                val r = if (d is Draft.Review) d else (d as Draft.Writing).review
                if (r.rulesOnly) Callout("Without an on-device model, only emails and phone numbers are found automatically, by their shape. Add the customer's name and address below before sending; nothing goes to the cloud until you choose to.")
                val n = r.masked.hidden.size
                Note(
                    when (n) {
                        0 -> "No personal details were found. Check the text below before it goes to the cloud."
                        1 -> "This detail will be replaced before anything goes to the cloud, and put back afterwards:"
                        else -> "These $n details will be replaced before anything goes to the cloud, and put back afterwards:"
                    },
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    r.masked.hidden.forEach { e ->
                        Row(Modifier.background(c.deviceWash, SmallRadius).padding(horizontal = 9.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(typeText(e.type), color = c.device, style = MaterialTheme.typography.labelMedium)
                            Text(e.value, color = c.ink, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                if (r.masked.missed.isNotEmpty()) {
                    val m = r.masked.missed
                    Callout("The model also named ${m.joinToString(", ") { "\"${it.value}\"" }}, but ${if (m.size == 1) "it was" else "they were"} not found in the ticket as written, so nothing was hidden for ${if (m.size == 1) "it" else "them"}. Check the text below and hide anything that is still there.")
                }
                if (r.facts.isNotEmpty()) {
                    Muted("Order facts from your order system, sent with it so the reply states only what is true:")
                    r.facts.forEach { Text("• $it", color = c.ink2, style = MaterialTheme.typography.bodyMedium) }
                }
                var showInput by remember { mutableStateOf(false) }
                LinkButton(if (showInput) "Hide what the cloud will receive" else "Show exactly what the cloud will receive") { showInput = !showInput }
                if (showInput) SelectionContainer { Text(r.input, color = c.ink2, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth().background(c.sunken, SmallRadius).padding(10.dp)) }
                if (d is Draft.Review) {
                    var extra by remember { mutableStateOf("") }
                    OutlinedTextField(value = extra, onValueChange = { extra = it }, label = { Text("Hide something else, for example a nickname") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        QuietButton("Hide it", enabled = extra.isNotBlank()) { state.hideExtra(id, d.kind, extra); extra = "" }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton(if (d.kind == "reply") "Write the reply in the cloud" else "Summarise in the cloud") { scope.launch { state.write(id, d.kind) } }
                        QuietButton("Cancel") { state.cancel(id, d.kind) }
                    }
                } else {
                    Muted("Writing in the cloud…")
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) { Muted("Personal details"); Ran(r.find); LinkButton("Why?") { onWhy("pii") } }
            }
            is Draft.Done -> {
                var text by remember(d) { mutableStateOf(d.text) }
                var copied by remember { mutableStateOf(false) }
                OutlinedTextField(value = text, onValueChange = { text = it }, modifier = Modifier.fillMaxWidth(), minLines = 6)
                val leftovers = Mask.leftoverTokens(d.text)
                if (leftovers.isNotEmpty()) Callout("The answer contains ${leftovers.joinToString()}, which does not match a hidden detail. Edit it before sending.")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (d.kind == "reply") PrimaryButton(if (copied) "Copied" else "Copy reply") { clipboard.setText(AnnotatedString(text)); copied = true }
                    if (d.kind == "reply" && id !in state.resolved) QuietButton("Mark resolved") { state.toggleResolved(id) }
                }
                if (d.kind == "reply") Muted("You send it from your own email; Shopdesk never sends anything to a customer.")
                val n = d.review.masked.hidden.size
                Muted(
                    if (d.review.find?.answer?.onDevice == true) "$n personal ${if (n == 1) "detail was" else "details were"} found on this phone and replaced before the cloud saw the ticket, then put back here."
                    else "$n personal ${if (n == 1) "detail was" else "details were"} replaced before the cloud saw the ticket, then put back here.",
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) { Muted("Personal details"); Ran(d.review.find); LinkButton("Why?") { onWhy("pii") } }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) { Muted(title); Ran(d.write); LinkButton("Why?") { onWhy(d.kind) } }
            }
        }
    }
}

private fun typeText(t: EntityType) = when (t) {
    EntityType.NAME -> "Name"; EntityType.EMAIL -> "Email"; EntityType.PHONE -> "Phone"; EntityType.ADDRESS -> "Address"; EntityType.DETAIL -> "Detail"
}

@Composable
private fun VoiceDialog(voice: Voice, onSave: (Voice) -> Unit, onDismiss: () -> Unit) {
    var shop by remember { mutableStateOf(voice.shop) }
    var signOff by remember { mutableStateOf(voice.signOff) }
    var tone by remember { mutableStateOf(voice.tone) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Shop voice") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(shop, { shop = it }, label = { Text("Shop name") }, singleLine = true)
                OutlinedTextField(signOff, { signOff = it }, label = { Text("Sign off as") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("warm" to "Warm", "formal" to "Formal", "brief" to "Brief").forEach { (v, l) -> Segment(l, tone == v) { tone = v } }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(Voice(shop.ifBlank { Voice.DEFAULT.shop }, signOff.ifBlank { Voice.DEFAULT.signOff }, tone)) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

