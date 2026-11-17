package com.routewise.shopdesk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.routewise.shopdesk.Step

val Radius = RoundedCornerShape(12.dp)
val SmallRadius = RoundedCornerShape(8.dp)

/** A surface that holds one task. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) = Column(
    modifier.fillMaxWidth().background(P.c.surface, Radius).border(1.dp, P.c.rule, Radius).padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
    content = content,
)

@Composable
fun Pill(text: String, fg: androidx.compose.ui.graphics.Color, bg: androidx.compose.ui.graphics.Color) = Text(
    text, color = fg, style = MaterialTheme.typography.labelMedium,
    modifier = Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp),
)

/** Where one step ran, in the same words as the web app. */
@Composable
fun Ran(step: Step?, running: Boolean = false) {
    val a = step?.answer
    when {
        running -> Pill("Running", P.c.ink3, P.c.sunken)
        step == null -> Pill("Not run yet", P.c.ink3, P.c.sunken)
        step.blocked -> Pill("Kept on this phone", P.c.ink2, P.c.sunken)
        a == null || !a.ok -> Pill("No answer", P.c.signal, P.c.signalWash)
        a.onDevice -> Pill("On this phone" + (step.model?.let { ", ${it.label}" } ?: "") + ", ${"%,d".format(a.ms)} ms", P.c.device, P.c.deviceWash)
        else -> Pill("In the cloud, ${"%,d".format(a.ms)} ms", P.c.cloud, P.c.cloudWash)
    }
}

@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) = Button(
    onClick = onClick, enabled = enabled, shape = SmallRadius,
    colors = ButtonDefaults.buttonColors(containerColor = P.c.ink, contentColor = P.c.surface),
    contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
) { Text(text, fontWeight = FontWeight.Medium) }

@Composable
fun QuietButton(text: String, enabled: Boolean = true, onClick: () -> Unit) = OutlinedButton(
    onClick = onClick, enabled = enabled, shape = SmallRadius,
    border = androidx.compose.foundation.BorderStroke(1.dp, P.c.ruleStrong),
    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
) { Text(text, color = P.c.ink, fontWeight = FontWeight.Medium) }

@Composable
fun LinkButton(text: String, onClick: () -> Unit) = TextButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp)) {
    Text(text, color = P.c.cloud, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
}

@Composable
fun Note(text: String, modifier: Modifier = Modifier) = Text(text, color = P.c.ink2, style = MaterialTheme.typography.bodyMedium, modifier = modifier)

@Composable
fun Muted(text: String, modifier: Modifier = Modifier) = Text(text, color = P.c.ink3, style = MaterialTheme.typography.bodySmall, modifier = modifier)

@Composable
fun Callout(text: String, warn: Boolean = true) = Row(
    Modifier.fillMaxWidth().background(if (warn) P.c.signalWash else P.c.sunken, SmallRadius).padding(12.dp),
    verticalAlignment = Alignment.Top,
) { Text(text, color = P.c.ink, style = MaterialTheme.typography.bodyMedium) }
