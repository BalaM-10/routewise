package com.routewise.shopdesk

import org.json.JSONObject

/**
 * Hiding personal details before text goes to the cloud, and putting them back after.
 * The model only finds the details; masking and unmasking are plain string operations.
 * Same behaviour as packages/core/src/mask.ts in the web app.
 */
enum class EntityType { NAME, EMAIL, PHONE, ADDRESS }

data class Entity(val type: EntityType, val value: String)

data class Masked(val text: String, val map: Map<String, String>, val hidden: List<Entity>)

object Mask {
    private val EMAIL = Regex("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", RegexOption.IGNORE_CASE)
    private val PHONE = Regex("(?:\\+?1[\\s.-]?)?\\(?\\b\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}\\b")
    private val PHONE_SHAPE = Regex("^\\D*\\d{3}\\D*\\d{3}\\D*\\d{4}\\D*$")
    private val STARTS_WITH_NUMBER = Regex("^\\d+\\s")

    /** Emails and phone numbers have fixed shapes, so code finds them without a model. */
    fun detectWithRules(text: String): List<Entity> =
        EMAIL.findAll(text).map { Entity(EntityType.EMAIL, it.value) }.toList() +
            PHONE.findAll(text).map { Entity(EntityType.PHONE, it.value.trim()) }.toList()

    fun guessType(value: String): EntityType = when {
        '@' in value -> EntityType.EMAIL
        PHONE_SHAPE.matches(value) -> EntityType.PHONE
        STARTS_WITH_NUMBER.containsMatchIn(value) -> EntityType.ADDRESS
        else -> EntityType.NAME
    }

    fun merge(vararg lists: List<Entity>): List<Entity> {
        val seen = mutableSetOf<String>()
        return lists.flatMap { it }.mapNotNull { e ->
            val v = e.value.trim()
            if (v.length < 2 || !seen.add(v.lowercase())) null else Entity(e.type, v)
        }
    }

    fun mask(text: String, entities: List<Entity>): Masked {
        val counters = mutableMapOf<EntityType, Int>()
        val map = linkedMapOf<String, String>()
        val hidden = mutableListOf<Entity>()
        var out = text
        // Longest first, so "Marcus Bell" is replaced before "Marcus".
        for (e in entities.sortedByDescending { it.value.length }) {
            // Whole words only, so hiding "Ben" leaves "benefit" alone.
            val re = Regex("(?<![\\p{L}\\p{N}])${Regex.escape(e.value)}(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)
            val first = re.find(out) ?: continue
            val n = (counters[e.type] ?: 0) + 1
            counters[e.type] = n
            val token = "[${e.type.name} $n]"
            map[token] = first.value
            hidden += Entity(e.type, first.value)
            out = re.replace(out, Regex.escapeReplacement(token))
        }
        return Masked(out, map, hidden)
    }

    /** Restores the details; tolerant of the model changing a placeholder's case or spacing. */
    fun unmask(text: String, map: Map<String, String>): String =
        map.entries.fold(text) { acc, (token, original) ->
            val m = Regex("^\\[(\\w+) (\\d+)]$").find(token)
            val pattern = if (m == null) Regex(Regex.escape(token)) else Regex("\\[\\s*${m.groupValues[1]}\\s*${m.groupValues[2]}\\s*]", RegexOption.IGNORE_CASE)
            pattern.replace(acc, Regex.escapeReplacement(original))
        }

    /** Placeholders still in the text after restoring, for example one the model invented. */
    fun leftoverTokens(text: String): List<String> =
        Regex("\\[\\s*(NAME|EMAIL|PHONE|ADDRESS)\\s*\\d+\\s*]", RegexOption.IGNORE_CASE).findAll(text).map { it.value }.toList()

    fun leaked(text: String, values: List<String>): List<String> =
        values.filter { text.contains(it, ignoreCase = true) }

    /** Reads the model's list of details; tolerant of code fences and missing types. */
    fun parseEntities(raw: String): List<Entity> {
        val obj = Json.obj(raw) ?: return emptyList()
        val items = obj.optJSONArray("items") ?: return emptyList()
        return (0 until items.length()).mapNotNull { i ->
            val item = items.optJSONObject(i) ?: return@mapNotNull null
            val value = item.optString("value").trim()
            if (value.isEmpty()) return@mapNotNull null
            val type = EntityType.entries.firstOrNull { it.name.equals(item.optString("type"), ignoreCase = true) } ?: guessType(value)
            Entity(type, value)
        }
    }
}

object Json {
    /** The first JSON object in a model answer, ignoring code fences and surrounding text. */
    fun obj(raw: String): JSONObject? {
        val start = raw.indexOf('{')
        val end = raw.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        return try { JSONObject(raw.substring(start, end + 1)) } catch (_: Exception) { null }
    }
}
