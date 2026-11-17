package com.routewise.shopdesk.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.routewise.shopdesk.Ai
import com.routewise.shopdesk.Nano
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import com.routewise.shopdesk.AppState
import com.routewise.shopdesk.Calibrator
import com.routewise.shopdesk.Data
import com.routewise.shopdesk.Mode
import com.routewise.shopdesk.Outcome
import com.routewise.shopdesk.Tasks
import kotlinx.coroutines.Job
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.launch

@Composable
fun CalibrateScreen(state: AppState) {
    val c = P.c
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var download by remember { mutableStateOf<String?>(null) }
    var downloadProblem by remember { mutableStateOf<String?>(null) }
    var progress by remember { mutableStateOf<Triple<Int, Int, String>?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    val outcomes = remember { mutableStateListOf<Outcome>() }
    val ready = state.deviceReady
    val tickets = Data.tickets.size

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Calibrate", style = MaterialTheme.typography.headlineLarge, color = c.ink)
        Note("Sorting, order details and finding personal details run on Gemini Nano and in the cloud for $tickets fictional tickets each, and are checked against known answers. Keep the app open while it runs: Android only lets apps in the foreground use Gemini Nano.")
        Panel {
            Text("On-device model", style = MaterialTheme.typography.titleSmall, color = c.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Nano.entries.forEach { n ->
                    val on = state.nano == n
                    Text(
                        n.label, style = MaterialTheme.typography.labelMedium, color = if (on) c.surface else c.ink2,
                        modifier = Modifier.background(if (on) c.ink else c.surface, RoundedCornerShape(8.dp)).border(1.dp, if (on) c.ink else c.ruleStrong, RoundedCornerShape(8.dp))
                            .clickable(enabled = job == null) { scope.launch { downloadProblem = null; state.chooseNano(n) } }.padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
            }
            Muted(state.nano.detail + ". Each run records which one it used.")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val word = when (state.status) { "AVAILABLE" -> "Ready"; "DOWNLOADABLE" -> "Not downloaded"; "DOWNLOADING" -> "Downloading"; "UNAVAILABLE" -> "Not supported"; "CHECKING" -> "Checking"; else -> "Unknown" }
                if (ready) Pill(word, c.device, c.deviceWash) else Pill(word, c.signal, c.signalWash)
                Text("${state.nano.label} on ${Calibrator.device()}", color = c.ink, style = MaterialTheme.typography.bodyMedium)
            }
            if (state.status == "DOWNLOADABLE") {
                PrimaryButton(download ?: "Download Gemini Nano", enabled = download == null) {
                    scope.launch {
                        downloadProblem = Ai.download { download = it }
                        state.status = Ai.status()
                        if (downloadProblem == null && state.status == "DOWNLOADABLE") downloadProblem = "AICore did not start the download. Try again on Wi-Fi with the phone charging."
                        download = null
                    }
                }
                downloadProblem?.let { Callout(it, warn = true) }
            }
            if (state.status == "UNAVAILABLE" && state.nano != Nano.STABLE) {
                Callout("AICore does not offer ${state.nano.label} on this phone yet. Gemini Nano 4 needs the AICore developer preview; or choose Standard.", warn = true)
            }
            Muted("${3 * tickets} examples need about ${3 * tickets} cloud requests, which takes about ${3 * tickets / 8 + 1} minutes at about 8 a minute.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("Run calibration", enabled = ready && job == null) {
                    outcomes.clear()
                    job = scope.launch {
                        try {
                            Calibrator.run(Calibrator.STEPS, onProgress = { d, t, l -> progress = Triple(d, t, l) }, onStepDone = { outcomes += it })
                        } finally {
                            if (outcomes.isNotEmpty()) Calibrator.saveFiles(context, outcomes.toList())
                            progress = null
                            job = null
                        }
                    }
                }
                if (job != null) QuietButton("Stop") { job?.cancel() }
            }
            progress?.let { (d, t, l) ->
                LinearProgressIndicator(progress = { if (t == 0) 0f else d.toFloat() / t }, modifier = Modifier.fillMaxWidth(), color = c.ink, trackColor = c.sunken)
                Muted("$d of $t. $l")
                Calibrator.STEPS.forEachIndexed { i, id ->
                    val doneHere = (d - i * tickets).coerceIn(0, tickets)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(Tasks.NAMES.getValue(id), color = if (doneHere > 0) c.ink else c.ink3, style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(140.dp))
                        LinearProgressIndicator(
                            progress = { doneHere.toFloat() / tickets }, modifier = Modifier.weight(1f),
                            color = if (doneHere == tickets) c.device else c.ink, trackColor = c.sunken,
                        )
                        Muted("$doneHere of $tickets")
                    }
                }
            }
        }
        outcomes.forEach { o ->
            StepResult(o.taskId, o.mode, o.good, o.trials.size, o.lowerBound, o.deviceP50, o.deviceP90, o.cloudP50, o.cloudP90, o.reasons)
        }
        // With no run open, the last complete run on the chosen model, so the evidence is always on screen.
        val last = remember(state.nano, job) { if (job == null) Calibrator.lastRun(context, state.nano) else null }
        if (outcomes.isEmpty() && job == null && last != null) {
            val time = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(last.createdAt)
            Text("Last complete run", style = MaterialTheme.typography.titleMedium, color = c.ink)
            Muted("${last.modelName} on ${Calibrator.device()}, $time. Run calibration again to replace it.")
            last.steps.forEach { st ->
                StepResult(st.id, st.mode, st.good, st.n, st.lowerBound, st.deviceP50, st.deviceP90, st.cloudP50, st.cloudP90, st.reasons)
            }
        } else if (outcomes.isEmpty() && job == null) {
            Muted("No complete run on ${state.nano.label} on this phone yet.")
        }
        // With complete runs on two or more models, the route for each step can name its best model.
        val runs = remember(job) { if (job == null) Nano.entries.mapNotNull { n -> Calibrator.lastRun(context, n)?.let { n to it } }.toMap() else emptyMap() }
        if (outcomes.isEmpty() && job == null && runs.size >= 2) {
            val choices = remember(runs) { Calibrator.chooseModels(runs) }
            Panel {
                Text("A model for each step", style = MaterialTheme.typography.titleMedium, color = c.ink)
                Muted("From the complete runs on ${runs.keys.sortedBy { it.ordinal }.map { it.label }.let { l -> if (l.size > 1) l.dropLast(1).joinToString(", ") + " and " + l.last() else l.first() }}. Each step gets the quickest model that clears its bar; finding names must clear 90%, the other steps 70%.")
                choices.forEach { ch ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(Tasks.NAMES.getValue(ch.id), fontWeight = FontWeight.SemiBold, color = c.ink)
                        Text(ch.model.label, fontWeight = FontWeight.SemiBold, color = c.device)
                    }
                    Note(ch.reason)
                }
                PrimaryButton("Share these routes") {
                    val json = Calibrator.modelPolicyJson(choices)
                    Calibrator.saveChoice(context, json)
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, json)
                    context.startActivity(Intent.createChooser(send, "Share the phone's routes"))
                }
                Muted("Paste the shared text into the Remote Config parameter routewise_policy_android and publish. Open copies of the app pick it up within a minute.")
            }
        }
        if (outcomes.isNotEmpty() && job == null) {
            PrimaryButton("Share the routes") {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, Calibrator.policyJson(outcomes.toList()))
                context.startActivity(Intent.createChooser(send, "Share the phone's routes"))
            }
            Muted("Paste the shared text into the Remote Config parameter routewise_policy_android and publish. Open copies of the app pick it up within a minute.")
        }
    }
}

/** One step's measured result: how often the phone was right, how fast each side was, and the route it earned. */
@Composable
private fun StepResult(id: String, mode: Mode, good: Int, n: Int, lowerBound: Double, deviceP50: Long, deviceP90: Long, cloudP50: Long, cloudP90: Long, reasons: List<String>) {
    val c = P.c
    val onPhone = mode == Mode.ONLY_ON_DEVICE || mode == Mode.PREFER_ON_DEVICE
    Panel {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(Tasks.NAMES.getValue(id), fontWeight = FontWeight.SemiBold, color = c.ink)
            Text(
                when (mode) { Mode.PREFER_ON_DEVICE -> "Phone first"; Mode.ONLY_ON_DEVICE -> "Phone only"; Mode.PREFER_IN_CLOUD -> "Cloud first"; Mode.ONLY_IN_CLOUD -> "Cloud only" },
                color = if (onPhone) c.device else c.cloud, fontWeight = FontWeight.SemiBold,
            )
        }
        Text("$good of $n right on the phone, at least ${(lowerBound * 100).toInt()}% with 95% confidence.", color = c.ink, style = MaterialTheme.typography.bodyMedium)
        Muted("Phone: median ${"%,d".format(deviceP50)} ms, slowest typical ${"%,d".format(deviceP90)} ms. Cloud: median ${"%,d".format(cloudP50)} ms, slowest typical ${"%,d".format(cloudP90)} ms.")
        // The score is already the headline, so only the reasons that add something are listed.
        reasons.filterNot { it.startsWith("$good of $n phone answers were right (") }.forEach { Note(it) }
    }
}
