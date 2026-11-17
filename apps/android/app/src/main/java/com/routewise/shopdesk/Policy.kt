package com.routewise.shopdesk

import com.google.firebase.Firebase
import com.google.firebase.remoteconfig.ConfigUpdate
import com.google.firebase.remoteconfig.ConfigUpdateListener
import com.google.firebase.remoteconfig.ConfigUpdateListenerRegistration
import com.google.firebase.remoteconfig.FirebaseRemoteConfigException
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume

/** One step's route. [model] is the on-device model measured best for this step, when the routes name one. */
data class Route(val mode: Mode, val maxWords: Int?, val sensitive: Boolean, val model: Nano? = null)

data class LoadedPolicy(val routes: Map<String, Route>, val source: String, val phoneMeasured: Boolean, val updatedAt: Long = System.currentTimeMillis())

/**
 * Routes come from Remote Config: "routewise_policy_android" (measured on a phone) for the steps it
 * covers, then "routewise_policy" (measured in Chrome) for the rest, then safe defaults.
 */
object Policy {
    /** Phone models accept about 4,000 tokens per request. */
    const val MOBILE_MAX_WORDS = 2500

    /** Steps that see the ticket as written, names included. */
    val READS_RAW_TICKET = setOf("triage", "extract", "pii")

    /**
     * Steps that never go to the cloud, whatever the route or the owner's answer. Finding personal details
     * exists to keep them out of the cloud, so sending the ticket there to find them would defeat it.
     * Without an on-device answer, fixed rules find emails and phone numbers and the owner adds the rest.
     */
    val NEVER_CLOUD = setOf("pii")

    val DEFAULTS = mapOf(
        "triage" to Route(Mode.ONLY_ON_DEVICE, null, true),
        "extract" to Route(Mode.ONLY_ON_DEVICE, null, true),
        "pii" to Route(Mode.ONLY_ON_DEVICE, null, true),
        "reply" to Route(Mode.ONLY_IN_CLOUD, null, false),
        "summary" to Route(Mode.PREFER_IN_CLOUD, 150, false),
    )

    private fun parse(json: String): Pair<Map<String, Route>, String?>? = try {
        val o = JSONObject(json)
        if (o.optInt("version") != 1) null else {
            val tasks = o.getJSONObject("tasks")
            val routes = tasks.keys().asSequence().mapNotNull { id ->
                val t = tasks.getJSONObject(id)
                val mode = Mode.entries.firstOrNull { it.name == t.optString("mode") } ?: return@mapNotNull null
                val max = if (t.isNull("maxWords")) MOBILE_MAX_WORDS else minOf(t.optInt("maxWords"), MOBILE_MAX_WORDS)
                val model = Nano.entries.firstOrNull { it.name == t.optString("model") }
                id to Route(mode, max, t.optBoolean("sensitive"), model)
            }.toMap()
            routes to o.optString("measuredOn").ifBlank { null }
        }
    } catch (_: Exception) {
        null
    }

    private fun current(fetched: Boolean): LoadedPolicy {
        val rc = Firebase.remoteConfig
        val phone = parse(rc.getString("routewise_policy_android"))
        val web = parse(rc.getString("routewise_policy"))
        val routes = DEFAULTS + (web?.first ?: emptyMap()) + (phone?.first ?: emptyMap())
        val source = when {
            phone != null && web != null -> "Routes measured on ${phone.second ?: "this phone"}, the rest in ${web.second ?: "Chrome"}"
            phone != null -> "Routes measured on ${phone.second ?: "this phone"}"
            web != null -> "Routes measured in ${web.second ?: "Chrome"}; calibrate to measure this phone"
            fetched -> "No published routes yet, so safe defaults apply"
            else -> "Remote Config could not be reached, so safe defaults apply"
        }
        return LoadedPolicy(routes, source, phone != null)
    }

    suspend fun load(): LoadedPolicy {
        val rc = Firebase.remoteConfig
        rc.setConfigSettingsAsync(remoteConfigSettings { minimumFetchIntervalInSeconds = 60 })
        val fetched = suspendCancellableCoroutine { c -> rc.fetchAndActivate().addOnCompleteListener { c.resume(it.isSuccessful) } }
        return current(fetched)
    }

    /** A route changed in Remote Config reaches the open app without a restart. */
    fun listen(onChange: (LoadedPolicy) -> Unit): ConfigUpdateListenerRegistration {
        val rc = Firebase.remoteConfig
        return rc.addOnConfigUpdateListener(object : ConfigUpdateListener {
            override fun onUpdate(configUpdate: ConfigUpdate) {
                rc.activate().addOnCompleteListener { onChange(current(true)) }
            }

            override fun onError(error: FirebaseRemoteConfigException) {}
        })
    }
}
