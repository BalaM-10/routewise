package com.routewise.shopdesk

import com.google.firebase.Firebase
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume

data class Route(val mode: Mode, val maxWords: Int?, val sensitive: Boolean)

data class LoadedPolicy(val routes: Map<String, Route>, val source: String, val measuredOn: String?)

/**
 * Routes come from Remote Config: "routewise_policy_android" (measured on a phone) for the steps it
 * covers, then "routewise_policy" (measured in Chrome) for the rest, then safe defaults.
 */
object Policy {
    /** Phone models accept about 4,000 tokens per request. */
    const val MOBILE_MAX_WORDS = 2500

    /** Steps that see the ticket as written, names included. */
    val READS_RAW_TICKET = setOf("triage", "extract", "pii")

    val DEFAULTS = mapOf(
        "triage" to Route(Mode.ONLY_ON_DEVICE, null, true),
        "extract" to Route(Mode.ONLY_ON_DEVICE, null, true),
        "pii" to Route(Mode.ONLY_ON_DEVICE, null, true),
        "reply" to Route(Mode.PREFER_IN_CLOUD, null, false),
        "summary" to Route(Mode.ONLY_IN_CLOUD, null, false),
    )

    fun parse(json: String): Pair<Map<String, Route>, String?>? = try {
        val o = JSONObject(json)
        if (o.optInt("version") != 1) null else {
            val tasks = o.getJSONObject("tasks")
            val routes = tasks.keys().asSequence().mapNotNull { id ->
                val t = tasks.getJSONObject(id)
                val mode = Mode.entries.firstOrNull { it.name == t.optString("mode") } ?: return@mapNotNull null
                val max = if (t.isNull("maxWords")) MOBILE_MAX_WORDS else minOf(t.optInt("maxWords"), MOBILE_MAX_WORDS)
                id to Route(mode, max, t.optBoolean("sensitive"))
            }.toMap()
            routes to o.optString("measuredOn").ifBlank { null }
        }
    } catch (_: Exception) {
        null
    }

    suspend fun load(): LoadedPolicy {
        val rc = Firebase.remoteConfig
        rc.setConfigSettingsAsync(remoteConfigSettings { minimumFetchIntervalInSeconds = 60 })
        val fetched = suspendCancellableCoroutine { c -> rc.fetchAndActivate().addOnCompleteListener { c.resume(it.isSuccessful) } }
        val phone = parse(rc.getString("routewise_policy_android"))
        val web = parse(rc.getString("routewise_policy"))
        val routes = DEFAULTS + (web?.first ?: emptyMap()) + (phone?.first ?: emptyMap())
        val source = when {
            phone != null && web != null -> "Routes measured on ${phone.second ?: "a phone"}, with the rest measured on ${web.second ?: "the web"}"
            phone != null -> "Routes measured on ${phone.second ?: "a phone"}"
            web != null -> "Routes measured on ${web.second ?: "the web"}; calibrate on this phone to measure it here"
            fetched -> "No published routes yet; using safe defaults"
            else -> "Remote Config could not be reached; using safe defaults"
        }
        return LoadedPolicy(routes, source, phone?.second)
    }
}
