package com.routewise.shopdesk.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

enum class Lane { DEVICE, CLOUD }
enum class StationState { DONE, ACTIVE, PLANNED, KEPT }

data class Station(val id: String, val label: String, val detail: String, val lane: Lane, val state: StationState)

/**
 * Two lanes, this phone on the left and the cloud on the right, with one station per AI step in the
 * lane where it ran (or, before it runs, where its route sends it). The phone version of the web
 * app's lanes, used for the live trace of a ticket and for the route map.
 */
@Composable
fun Lanes(stations: List<Station>, crossing: String?, label: String, onPick: ((String) -> Unit)? = null) {
    val c = P.c
    val crossAt = stations.indices.firstOrNull { i -> i > 0 && stations[i].lane == Lane.CLOUD && stations[i - 1].lane == Lane.DEVICE } ?: -1
    Column(Modifier.fillMaxWidth().semantics { contentDescription = label }) {
        Row(Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
            Text("This phone", color = c.device, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
            Text("Cloud", color = c.cloud, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
        }
        Column(
            Modifier.fillMaxWidth().drawBehind {
                val x1 = 7.dp.toPx()
                val x2 = size.width / 2 + 7.dp.toPx()
                drawLine(c.device.copy(alpha = 0.28f), Offset(x1, 8.dp.toPx()), Offset(x1, size.height - 8.dp.toPx()), strokeWidth = 2.dp.toPx())
                drawLine(c.cloud.copy(alpha = 0.28f), Offset(x2, 8.dp.toPx()), Offset(x2, size.height - 8.dp.toPx()), strokeWidth = 2.dp.toPx())
            },
        ) {
            stations.forEachIndexed { i, s ->
                if (i == crossAt && crossing != null) {
                    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
                        Text(
                            crossing, color = c.ink2, style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.background(c.surface, RoundedCornerShape(50)).border(1.dp, c.ruleStrong, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 2.dp),
                        )
                    }
                }
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Box(Modifier.weight(1f)) { if (s.lane == Lane.DEVICE) StationItem(s, onPick) }
                    Box(Modifier.weight(1f)) { if (s.lane == Lane.CLOUD) StationItem(s, onPick) }
                }
            }
        }
    }
}

@Composable
private fun StationItem(s: Station, onPick: ((String) -> Unit)?) {
    val c = P.c
    val color = if (s.lane == Lane.DEVICE) c.device else c.cloud
    val wash = if (s.lane == Lane.DEVICE) c.deviceWash else c.cloudWash
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(1f, 0.35f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "alpha")
    Row(
        modifier = Modifier.then(if (onPick != null) Modifier.clickable { onPick(s.id) } else Modifier).padding(end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val dot = Modifier.size(16.dp).then(if (s.state == StationState.ACTIVE) Modifier.alpha(pulse) else Modifier)
        when (s.state) {
            StationState.DONE, StationState.ACTIVE -> Box(dot.background(wash, CircleShape).padding(2.dp).background(color, CircleShape))
            StationState.KEPT -> Box(dot.background(wash, CircleShape).padding(2.dp).background(c.surface, CircleShape).border(2.dp, color, CircleShape))
            StationState.PLANNED -> Box(dot.background(c.surface, CircleShape).border(2.dp, color, CircleShape))
        }
        Column {
            Text(s.label, color = if (s.state == StationState.PLANNED) c.ink3 else c.ink, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
            Text(s.detail, color = if (s.state == StationState.DONE) color else c.ink3, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.width(0.dp))
    }
}

/** The ledger bar: one line split by where this visit's steps ran. */
@Composable
fun SplitBar(device: Int, cloud: Int) {
    val c = P.c
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp).background(c.sunken, RoundedCornerShape(5.dp))) {
        if (device > 0) Box(Modifier.weight(device.toFloat()).height(10.dp).background(c.device, RoundedCornerShape(5.dp)))
        if (cloud > 0) Box(Modifier.weight(cloud.toFloat()).height(10.dp).background(c.cloud, RoundedCornerShape(5.dp)))
        if (device + cloud == 0) Box(Modifier.weight(1f).height(10.dp))
    }
}
