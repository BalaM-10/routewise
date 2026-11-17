package com.routewise.shopdesk

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import com.routewise.shopdesk.ui.CalibrateScreen
import com.routewise.shopdesk.ui.DeskScreen
import com.routewise.shopdesk.ui.P
import com.routewise.shopdesk.ui.RoutesScreen
import com.routewise.shopdesk.ui.ShopdeskTheme
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { ShopdeskTheme { App() } }
    }
}

/** The app reads in the same order as the web: the inbox, why it routes as it does, how that was measured. */
@Composable
private fun App() {
    val context = LocalContext.current
    val state = remember { AppState(context.applicationContext) }
    var tab by remember { mutableIntStateOf(0) }
    var openTicket by remember { mutableStateOf<String?>(null) }
    var focus by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        state.status = Ai.status()
        state.policy = Policy.load()
    }
    DisposableEffect(Unit) {
        val registration = Policy.listen { p ->
            state.policy = p
            state.routesNote = "Routes updated from Remote Config at ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())}."
        }
        onDispose { registration.remove() }
    }

    val c = P.c
    Scaffold(
        containerColor = c.ground,
        bottomBar = {
            NavigationBar(containerColor = c.surface) {
                listOf("Shopdesk" to R.drawable.ic_tab_inbox, "Routes" to R.drawable.ic_tab_routes, "Calibrate" to R.drawable.ic_tab_calibrate).forEachIndexed { i, (label, icon) ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i; if (i != 1) focus = null },
                        icon = { Icon(painterResource(icon), contentDescription = null) },
                        label = { Text(label) },
                        colors = NavigationBarItemDefaults.colors(selectedIconColor = c.ink, selectedTextColor = c.ink, indicatorColor = c.sunken, unselectedIconColor = c.ink3, unselectedTextColor = c.ink3),
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                0 -> DeskScreen(state, openTicket, onOpen = { openTicket = it }, onWhy = { focus = it; tab = 1 })
                1 -> RoutesScreen(state, focus)
                else -> CalibrateScreen(state)
            }
        }
    }

    state.consents.firstOrNull()?.let { c2 ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Send this ticket to the cloud?") },
            text = { Text("${c2.reason} ${Tasks.NAMES[c2.taskId]} would send the ticket, including the customer's personal details, to Gemini in the cloud.") },
            confirmButton = {
                Column(horizontalAlignment = Alignment.End) {
                    TextButton(onClick = { state.answerConsent(true, forVisit = false) }) { Text("Send this one") }
                    TextButton(onClick = { state.answerConsent(true, forVisit = true) }) { Text("Send for the rest of this visit") }
                    TextButton(onClick = { state.answerConsent(false, forVisit = false) }) { Text("Keep it on this phone") }
                }
            },
        )
    }
}
