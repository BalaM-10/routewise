package com.routewise.shopdesk

import org.json.JSONObject

/**
 * Hiding personal details before text goes to the cloud, and putting them back after.
 * The model only finds the details; masking and unmasking are plain string operations.
 * Same behaviour as packages/core/src/mask.ts in the web app.
 */
enum class EntityType { NAME, EMAIL, PHONE, ADDRESS, DETAIL }

data class Entity(val type: EntityType, val value: String)

/** [missed]: details that were found but could not be located in the text, so nothing was hidden for them. */
data class Masked(val text: String, val map: Map<String, String>, val hidden: List<Entity>, val missed: List<Entity> = emptyList())

object Mask {
    private val EMAIL = Regex("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", RegexOption.IGNORE_CASE)
    /** North American numbers, such as (512) 555-0176 or 214-555-0147. */
    private val PHONE = Regex("(?:\\+?1[\\s.-]?)?\\(?\\b\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}\\b")
    /** International numbers written with a country code, such as +44 20 7946 0321. */
    private val PHONE_INTL = Regex("\\+\\d{1,3}(?:[\\s.-]?\\(?\\d{1,5}\\)?){2,6}(?!\\d)")
    /** National numbers that start with 0, such as 07700 900482 or 0491 570 156. */
    private val PHONE_LOCAL = Regex("\\b0\\d{2,4}[\\s.-]?\\d{3,4}[\\s.-]?\\d{3,4}\\b")
    private val PHONE_SHAPE = Regex("^[\\d\\s().+-]+$")
    private val NAME_PART = Regex("^\\p{Lu}[\\p{L}'-]+$")
    private fun digits(s: String) = s.count(Char::isDigit)
    private val STARTS_WITH_NUMBER = Regex("^\\d+\\s")
    private val NAME_SHAPE = Regex("^\\p{Lu}[\\p{L}'.-]*( \\p{Lu}[\\p{L}'.-]*){0,2}$")

    private fun wholeWord(value: String) = Regex("(?<![\\p{L}\\p{N}])${Regex.escape(value)}(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)

    /** Emails and phone numbers have fixed shapes, so code finds them without a model. */
    fun detectWithRules(text: String): List<Entity> {
        val found = EMAIL.findAll(text).map { Entity(EntityType.EMAIL, it.value) }.toMutableList()
        for (re in listOf(PHONE_INTL, PHONE, PHONE_LOCAL)) {
            for (m in re.findAll(text)) {
                val v = m.value.trim()
                // Skip a shorter match inside a number already found, and anything too short or long to be a phone number.
                if (digits(v) !in 9..15 || found.any { v in it.value }) continue
                found += Entity(EntityType.PHONE, v)
            }
        }
        return found
    }

    fun guessType(value: String): EntityType = when {
        '@' in value -> EntityType.EMAIL
        PHONE_SHAPE.matches(value) && digits(value) in 9..15 -> EntityType.PHONE
        STARTS_WITH_NUMBER.containsMatchIn(value) -> EntityType.ADDRESS
        else -> EntityType.NAME
    }

    /** For text the owner hides by hand: a capitalised name stays a name, anything else is a detail. */
    fun guessHiddenType(value: String): EntityType {
        val t = guessType(value)
        return if (t != EntityType.NAME || NAME_SHAPE.matches(value.trim())) t else EntityType.DETAIL
    }

    fun merge(vararg lists: List<Entity>): List<Entity> {
        val seen = mutableSetOf<String>()
        return lists.flatMap { it }.mapNotNull { e ->
            val v = e.value.trim()
            if (v.length < 2 || !seen.add(v.lowercase())) null else Entity(e.type, v)
        }
    }

    /**
     * A pattern that finds a detail even when the model wrote it a little differently from the ticket:
     * any spacing, and for phone numbers any punctuation between the digits. Whole words only.
     */
    private fun locate(e: Entity): Regex {
        val v = e.value.trim()
        val body = if (e.type == EntityType.PHONE && digits(v) >= 7) {
            "\\+?\\(?" + v.filter(Char::isDigit).toList().joinToString("[\\s().+-]*")
        } else {
            v.split(Regex("\\s+")).joinToString("\\s+") { Regex.escape(it) }
        }
        return Regex("(?<![\\p{L}\\p{N}])$body(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)
    }

    /** Words of a name that can stand alone in a ticket: "Marcus" and "Bell" from "Marcus Bell", not "M." or "de". */
    private fun nameParts(name: String): List<String> {
        val parts = name.trim().split(Regex("\\s+"))
        return if (parts.size < 2) emptyList() else parts.filter { NAME_PART.matches(it) }
    }

    fun mask(text: String, entities: List<Entity>): Masked {
        val counters = mutableMapOf<EntityType, Int>()
        val map = linkedMapOf<String, String>()
        val hidden = mutableListOf<Entity>()
        val missed = mutableListOf<Entity>()
        var out = text
        fun hide(type: EntityType, re: Regex): Boolean {
            val first = re.find(out) ?: return false
            val n = (counters[type] ?: 0) + 1
            counters[type] = n
            val token = "[${type.name} $n]"
            map[token] = first.value
            hidden += Entity(type, first.value)
            out = re.replace(out, Regex.escapeReplacement(token))
            return true
        }
        // Longest first, so "Marcus Bell" is replaced before "Marcus".
        val sorted = entities.sortedByDescending { it.value.length }
        for (e in sorted) if (!hide(e.type, locate(e))) missed += e
        // Then any word of a full name that appears on its own, such as "Thanks, Marcus", "thanks marcus" or "Mr. Bell".
        // Whole words only, so "Bell" does not touch "doorbell". Each spelling gets its own placeholder, so the text
        // comes back exactly as written. A lowercase match is only taken for parts of three letters or more.
        for (e in sorted.filter { it.type == EntityType.NAME }) {
            for (part in nameParts(e.value)) {
                val bounded = "(?<![\\p{L}\\p{N}])${Regex.escape(part)}(?![\\p{L}\\p{N}])"
                val any = if (part.length >= 3) Regex(bounded, RegexOption.IGNORE_CASE) else Regex(bounded)
                for (spelling in any.findAll(out).map { it.value }.toSet()) {
                    hide(EntityType.NAME, Regex("(?<![\\p{L}\\p{N}])${Regex.escape(spelling)}(?![\\p{L}\\p{N}])"))
                }
            }
        }
        return Masked(out, map, hidden, missed.filter { m -> hidden.none { it.value.contains(m.value, ignoreCase = true) } })
    }

    /** Applies placeholders already chosen for a ticket to other text sent with it, such as order facts. */
    fun maskWith(text: String, map: Map<String, String>): String =
        map.entries.sortedByDescending { it.value.length }.fold(text) { acc, (token, original) ->
            wholeWord(original).replace(acc, Regex.escapeReplacement(token))
        }

    /** A name's first word when it reads as a first name ("Marcus" in "Marcus Bell"), or null ("M. Johnson", "SAM"). */
    fun firstName(name: String): String? {
        val parts = name.trim().split(Regex("\\s+"))
        return if (parts.size > 1 && Regex("^\\p{Lu}\\p{Ll}[\\p{L}'-]*$").matches(parts[0])) parts[0] else null
    }

    private fun tokenPattern(token: String): String {
        val m = Regex("^\\[(\\w+) (\\d+)]$").find(token) ?: return Regex.escape(token)
        return "\\[\\s*${m.groupValues[1]}\\s*${m.groupValues[2]}\\s*]"
    }

    private const val GREETING = "\\b(Hi|Hello|Hey|Dear|Good (?:morning|afternoon|evening))(,?\\s+)"

    /**
     * Restores the details; tolerant of the model changing a placeholder's case or spacing. A full name
     * right after a greeting comes back as the first name, so a reply opens "Hello Marcus," as a person would write it.
     */
    fun unmask(text: String, map: Map<String, String>): String {
        var out = text
        for ((token, original) in map) {
            val first = if (Regex("^\\[NAME \\d+]$", RegexOption.IGNORE_CASE).matches(token)) firstName(original) else null
            if (first != null) out = Regex(GREETING + tokenPattern(token), RegexOption.IGNORE_CASE).replace(out) { it.groupValues[1] + it.groupValues[2] + first }
        }
        return map.entries.fold(out) { acc, (token, original) ->
            Regex(tokenPattern(token), RegexOption.IGNORE_CASE).replace(acc, Regex.escapeReplacement(original))
        }
    }

    /** Placeholders still in the text after restoring, for example one the model invented. */
    fun leftoverTokens(text: String): List<String> =
        Regex("\\[\\s*[A-Z]+\\s*\\d+\\s*]", RegexOption.IGNORE_CASE).findAll(text).map { it.value }.toList()

    fun leaked(text: String, values: List<String>): List<String> = values.filter { text.contains(it, ignoreCase = true) }

    /** Reads the model's list of details; tolerant of code fences and missing types. */
    fun parseEntities(raw: String): List<Entity> = tryParseEntities(raw) ?: emptyList()

    /** The details the model found, or null when its answer is not the JSON asked for (so nothing can be trusted from it). */
    fun tryParseEntities(raw: String): List<Entity>? {
        val items = Json.obj(raw)?.optJSONArray("items") ?: return null
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
