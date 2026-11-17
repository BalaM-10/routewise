package com.routewise.shopdesk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.routewise.shopdesk.AppState
import com.routewise.shopdesk.Mode
import com.routewise.shopdesk.Policy
import com.routewise.shopdesk.Tasks

private val ROUTE_TEXT = mapOf(
    Mode.PREFER_ON_DEVICE to "Phone first",
    Mode.ONLY_ON_DEVICE to "Phone only",
    Mode.PREFER_IN_CLOUD to "Cloud first",
    Mode.ONLY_IN_CLOUD to "Cloud only",
)

private val WHY = mapOf(
    Mode.PREFER_ON_DEVICE to "Runs on this phone; the cloud answers if the phone cannot.",
    Mode.ONLY_ON_DEVICE to "Runs on this phone. It reads the customer's personal details, so the cloud is never used without asking.",
    Mode.PREFER_IN_CLOUD to "The cloud answers first; this phone is the fallback.",
    Mode.ONLY_IN_CLOUD to "The cloud answers. Replies and summaries are written from text with personal details removed.",
)

/** The published routes, in the order Shopdesk meets the steps for one ticket. */
@Composable
fun RoutesScreen(state: AppState, focus: String?) {
    val c = P.c
    val router = state.router()
    val order = listOf("triage", "extract", "pii", "reply", "summary")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Routes", style = MaterialTheme.typography.headlineLarge, color = c.ink)
        Note(state.policy?.source ?: "Loading routes…")
        if (state.routesNote.isNotBlank()) Muted(state.routesNote)
        Panel {
            Text("Route map", style = MaterialTheme.typography.titleMedium, color = c.ink)
            val stations = order.map { id ->
                val mode = router?.routeOf(id)?.mode ?: Policy.DEFAULTS.getValue(id).mode
                val onPhone = mode == Mode.ONLY_ON_DEVICE || mode == Mode.PREFER_ON_DEVICE
                Station(id, Tasks.NAMES.getValue(id), ROUTE_TEXT.getValue(mode), if (onPhone) Lane.DEVICE else Lane.CLOUD, StationState.DONE)
            }
            val cross = stations.indices.firstOrNull { i -> i > 0 && stations[i].lane == Lane.CLOUD && stations[i - 1].lane == Lane.DEVICE }
            Lanes(stations, if (cross != null && stations[cross].id == "reply") "Personal details removed" else null, "Route map")
        }
        order.forEach { id ->
            val route = router?.routeOf(id) ?: Policy.DEFAULTS.getValue(id)
            val onPhone = route.mode == Mode.ONLY_ON_DEVICE || route.mode == Mode.PREFER_ON_DEVICE
            Panel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(Tasks.NAMES.getValue(id), color = c.ink, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyLarge)
                    Text(ROUTE_TEXT.getValue(route.mode), color = if (onPhone) c.device else c.cloud, fontWeight = FontWeight.SemiBold)
                }
                Note(WHY.getValue(route.mode))
                route.maxWords?.let { Muted("Up to ${"%,d".format(it)} words on the phone; longer text goes to the cloud.") }
                if (focus == id) Muted("You came here from this step in Shopdesk.")
            }
        }
        Muted("Phone models accept less text than Chrome, so every route is limited to ${"%,d".format(Policy.MOBILE_MAX_WORDS)} words here. Steps measured on this phone use routewise_policy_android; the rest use the routes measured in Chrome.")
    }
}
