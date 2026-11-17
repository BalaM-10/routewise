package com.routewise.shopdesk

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

// The web app's palette: teal for the phone, steel blue for the cloud, amber for caution.
private val Ink = Color(0xFF18211D)
private val Ink3 = Color(0xFF6B7671)
private val Ground = Color(0xFFEEF1EF)
private val Surface = Color(0xFFFFFFFF)
private val Device = Color(0xFF0E6B58)
private val DeviceWash = Color(0xFFE3F1EC)
private val Cloud = Color(0xFF2D58A0)
private val CloudWash = Color(0xFFE6EDF8)
private val Signal = Color(0xFFA86A12)
private val SignalWash = Color(0xFFFBF1DF)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Ink, background = Ground, surface = Surface)) {
                Shopdesk()
            }
        }
    }
}

private data class Consent(val taskId: String, val reason: String, val answer: CompletableDeferred<Boolean>)

private sealed interface Draft {
    data object Finding : Draft
    data class Review(val find: Step, val masked: Masked) : Draft
    data class Writing(val find: Step, val masked: Masked) : Draft
    data class Done(val find: Step, val write: Step, val masked: Masked, val text: String) : Draft
    data class Stopped(val message: String) : Draft
}

@Composable
private fun Shopdesk() {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    var policy by remember { mutableStateOf<LoadedPolicy?>(null) }
    var status by remember { mutableStateOf("CHECKING") }
    var consent by remember { mutableStateOf<Consent?>(null) }
    val steps = remember { mutableStateListOf<Step>() }
    var hidden by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        status = Ai.status()
        policy = Policy.load()
    }

    val router = remember(policy, status) {
        policy?.let { p ->
            Router(
                routes = p.routes,
                deviceReady = status.contains("AVAILABLE") && !status.contains("UNAVAILABLE"),
                askConsent = { id, reason ->
                    val d = CompletableDeferred<Boolean>()
                    consent = Consent(id, reason, d)
                    d.await()
                },
                onStep = { steps.add(0, it) },
            )
        }
    }

    Scaffold(
        containerColor = Ground,
        topBar = {
            Column(Modifier.background(Surface).statusBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp)) {
                Text("Shopdesk", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text(policy?.source ?: "Loading routes…", fontSize = 12.sp, color = Ink3)
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Surface) {
                listOf("Inbox", "Routes", "Calibrate").forEachIndexed { i, label ->
                    NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = {}, label = { Text(label) })
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                0 -> if (router != null) Inbox(router, steps, hidden) { hidden += it } else Loading()
                1 -> RoutesScreen(policy)
                2 -> CalibrateScreen(status) { status = it }
            }
        }
    }

    consent?.let { c ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Send this ticket to the cloud?") },
            text = { Text("${c.reason} ${Tasks.NAMES[c.taskId]} would send the customer's personal details to Gemini in the cloud.") },
            confirmButton = { TextButton(onClick = { consent = null; c.answer.complete(true) }) { Text("Send to the cloud") } },
            dismissButton = { TextButton(onClick = { consent = null; c.answer.complete(false) }) { Text("Keep it on this phone") } },
        )
    }
}

@Composable
private fun Loading() = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Ink) }

@Composable
private fun Ran(step: Step) {
    val a = step.answer
    val (label, fg, bg) = when {
        step.blocked -> Triple("Kept on this phone", Ink3, Ground)
        a == null || !a.ok -> Triple("No answer", Signal, SignalWash)
        a.onDevice -> Triple("On this phone, ${a.ms} ms", Device, DeviceWash)
        else -> Triple("In the cloud, ${a.ms} ms", Cloud, CloudWash)
    }
    Text(label, color = fg, fontSize = 12.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
private fun Inbox(router: Router, steps: List<Step>, hidden: Int, addHidden: (Int) -> Unit) {
    val scope = rememberCoroutineScope()
    val labels = remember { mutableStateMapOf<Int, Step>() }
    var open by remember { mutableStateOf<Int?>(null) }

    // New tickets are sorted one at a time as the inbox loads.
    LaunchedEffect(router) {
        TICKETS.indices.take(12).forEach { i -> if (labels[i] == null) labels[i] = router.run("triage", TICKETS[i].text) }
    }

    open?.let { i ->
        BackHandler { open = null }
        TicketScreen(i, router, labels[i], addHidden) { open = null }
        return
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Row(Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Stat(steps.count { it.answer?.onDevice == true }, "on this phone")
                Stat(steps.count { it.answer?.ok == true && it.answer.onDevice == false }, "in the cloud")
                Stat(hidden, "details hidden")
            }
        }
        itemsIndexed(TICKETS.take(12)) { i, t ->
            val l = labels[i]
            Column(Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).clickable { open = i }.padding(14.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(t.who(), fontWeight = FontWeight.Medium, color = Ink)
                    when {
                        l == null -> Text("Sorting", fontSize = 12.sp, color = Ink3)
                        l.answer?.ok == true -> {
                            val onPhone = l.answer.onDevice
                            Text(Tasks.label(l.answer.text).replaceFirstChar(Char::uppercase), fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                color = if (onPhone) Device else Cloud,
                                modifier = Modifier.background(if (onPhone) DeviceWash else CloudWash, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp))
                        }
                        else -> Text("Not sorted", fontSize = 12.sp, color = Signal)
                    }
                }
                Text(t.text, color = Ink3, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun Stat(n: Int, label: String) = Column {
    Text("$n", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ink)
    Text(label, fontSize = 12.sp, color = Ink3)
}

@Composable
private fun TicketScreen(index: Int, router: Router, label: Step?, addHidden: (Int) -> Unit, back: () -> Unit) {
    val t = TICKETS[index]
    val scope = rememberCoroutineScope()
    var order by remember { mutableStateOf<Step?>(null) }
    var draft by remember { mutableStateOf<Draft?>(null) }

    LaunchedEffect(index) { order = router.run("extract", t.text) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = back, contentPadding = PaddingValues(0.dp)) { Text("Back to inbox", color = Cloud) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(t.who(), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ink)
            label?.let { Ran(it) }
        }
        Text(t.text, color = Ink, modifier = Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).padding(14.dp))

        Column(Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val o = order
            if (o == null) Text("Reading order details…", color = Ink3) else {
                val j = o.answer?.text?.let(Json::obj)
                if (j == null) Text("The order details could not be read from this ticket.", color = Ink3) else {
                    Field("Order", j.optString("order_id").ifBlank { "None given" })
                    Field("Product", j.optString("product").ifBlank { "None given" })
                    Field("Issue", j.optString("issue").ifBlank { "Not stated" })
                }
                Ran(o)
            }
        }

        Button(
            onClick = {
                scope.launch {
                    draft = Draft.Finding
                    val find = router.run("pii", t.text)
                    draft = if (find.blocked || find.answer?.ok != true) {
                        Draft.Stopped(if (find.blocked) "Stopped. The details could not be checked on this phone, and you chose to keep the ticket here." else "Finding personal details failed: ${find.answer?.error}")
                    } else {
                        val entities = Mask.merge(Mask.parseEntities(find.answer.text), Mask.detectWithRules(t.text))
                        Draft.Review(find, Mask.mask(t.text, entities))
                    }
                }
            },
            enabled = draft !is Draft.Finding && draft !is Draft.Writing,
            colors = ButtonDefaults.buttonColors(containerColor = Ink),
        ) { Text("Draft a reply") }

        when (val d = draft) {
            null -> {}
            Draft.Finding -> Text("Finding personal details…", color = Ink3)
            is Draft.Stopped -> Text(d.message, color = Signal)
            is Draft.Review -> Column(Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (d.masked.hidden.isEmpty()) "No personal details were found. Check the ticket before it goes to the cloud." else "These ${d.masked.hidden.size} details will be replaced before anything goes to the cloud, and put back afterwards:", color = Ink)
                d.masked.hidden.forEach { e ->
                    Text("${e.type.name.lowercase().replaceFirstChar(Char::uppercase)}: ${e.value}", color = Device, fontSize = 14.sp,
                        modifier = Modifier.background(DeviceWash, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 3.dp))
                }
                Text("The cloud receives:", color = Ink3, fontSize = 12.sp)
                Text(d.masked.text, color = Ink3, fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        scope.launch {
                            draft = Draft.Writing(d.find, d.masked)
                            val write = router.run("reply", d.masked.text)
                            if (write.answer?.ok == true) addHidden(d.masked.hidden.size)
                            draft = if (write.answer?.ok == true) Draft.Done(d.find, write, d.masked, Mask.unmask(write.answer.text, d.masked.map))
                            else Draft.Stopped("The cloud request failed: ${write.answer?.error ?: write.reason}")
                        }
                    }, colors = ButtonDefaults.buttonColors(containerColor = Ink)) { Text("Write it in the cloud") }
                    OutlinedButton(onClick = { draft = null }) { Text("Cancel", color = Ink) }
                }
                Ran(d.find)
            }
            is Draft.Writing -> Text("Writing the reply in the cloud…", color = Ink3)
            is Draft.Done -> Column(Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                var text by remember(d) { mutableStateOf(d.text) }
                OutlinedTextField(value = text, onValueChange = { text = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Reply") })
                val leftovers = Mask.leftoverTokens(d.text)
                if (leftovers.isNotEmpty()) Text("The answer contains ${leftovers.joinToString()}, which does not match a hidden detail. Edit it before sending.", color = Signal, fontSize = 13.sp)
                Text(
                    if (d.find.answer?.onDevice == true) "${d.masked.hidden.size} personal details were found on this phone and replaced before the cloud saw the ticket, then put back here."
                    else "${d.masked.hidden.size} personal details were replaced before the reply was written. Finding them needed the cloud, which you agreed to.",
                    color = Ink3, fontSize = 13.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { Text("Details", color = Ink3, fontSize = 12.sp); Ran(d.find) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { Text("Reply", color = Ink3, fontSize = 12.sp); Ran(d.write) }
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String) = Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    Text(label, color = Ink3, fontSize = 13.sp, modifier = Modifier.width(64.dp))
    Text(value, color = Ink, fontWeight = FontWeight.Medium)
}

@Composable
private fun RoutesScreen(policy: LoadedPolicy?) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Where each step runs", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Text(policy?.source ?: "Loading…", color = Ink3, fontSize = 13.sp)
        policy?.routes?.forEach { (id, r) ->
            val phone = r.mode == Mode.PREFER_ON_DEVICE || r.mode == Mode.ONLY_ON_DEVICE
            Row(Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(Tasks.NAMES[id] ?: id, color = Ink, fontWeight = FontWeight.Medium)
                Text(
                    when (r.mode) { Mode.PREFER_ON_DEVICE -> "Phone first"; Mode.ONLY_ON_DEVICE -> "Phone only"; Mode.PREFER_IN_CLOUD -> "Cloud first"; Mode.ONLY_IN_CLOUD -> "Cloud only" },
                    color = if (phone) Device else Cloud, fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Text("Phone models accept less text than Chrome, so every route is limited to ${Policy.MOBILE_MAX_WORDS} words here; longer tickets go to the cloud.", color = Ink3, fontSize = 12.sp)
    }
}

@Composable
private fun CalibrateScreen(status: String, setStatus: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var download by remember { mutableStateOf<String?>(null) }
    var progress by remember { mutableStateOf<Triple<Int, Int, String>?>(null) }
    var outcomes by remember { mutableStateOf<List<Outcome>>(emptyList()) }
    val ready = status.contains("AVAILABLE") && !status.contains("UNAVAILABLE")

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Calibrate on this phone", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Text("Sorting, order details and finding personal details run on Gemini Nano and in the cloud for ${TICKETS.size} fictional tickets each, and are checked against known answers. Keep the app open while it runs.", color = Ink3, fontSize = 13.sp)
        Text("Gemini Nano on ${Calibrator.device()}: ${status.lowercase()}", color = Ink)
        if (!ready && status.contains("DOWNLOAD")) {
            OutlinedButton(onClick = { scope.launch { Ai.download { download = it }; setStatus(Ai.status()) } }) { Text("Download Gemini Nano", color = Ink) }
            download?.let { Text(it, color = Ink3, fontSize = 12.sp) }
        }
        Button(
            onClick = { scope.launch { outcomes = Calibrator.run(Calibrator.STEPS) { d, t, l -> progress = Triple(d, t, l) }; progress = null } },
            enabled = ready && progress == null,
            colors = ButtonDefaults.buttonColors(containerColor = Ink),
        ) { Text("Run calibration") }
        progress?.let { (d, t, l) ->
            LinearProgressIndicator(progress = { d.toFloat() / t }, modifier = Modifier.fillMaxWidth(), color = Ink)
            Text("$d of $t. $l", color = Ink3, fontSize = 12.sp)
        }
        outcomes.forEach { o ->
            Column(Modifier.fillMaxWidth().background(Surface, RoundedCornerShape(10.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(Tasks.NAMES[o.taskId] ?: o.taskId, fontWeight = FontWeight.Medium, color = Ink)
                    Text(o.mode.name.replace('_', ' ').lowercase(), color = if (o.mode.name.contains("DEVICE")) Device else Cloud, fontWeight = FontWeight.SemiBold)
                }
                Text("${o.good} of ${o.trials.size} right on the phone. Typical ${o.deviceP50} ms, slowest typical ${o.deviceP90} ms; cloud typical ${o.cloudP50} ms.", color = Ink3, fontSize = 13.sp)
                o.reasons.forEach { Text(it, color = Ink, fontSize = 13.sp) }
            }
        }
        if (outcomes.isNotEmpty()) {
            Button(onClick = {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, Calibrator.policyJson(outcomes))
                context.startActivity(Intent.createChooser(send, "Share the phone's routes"))
            }, colors = ButtonDefaults.buttonColors(containerColor = Ink)) { Text("Share the routes") }
            Text("Paste the shared text into the Remote Config parameter routewise_policy_android, then publish.", color = Ink3, fontSize = 12.sp)
        }
    }
}
